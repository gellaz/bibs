import { getGeocodingProvider } from "@/lib/geocoding";
import { readLookup, writeLookup } from "@/lib/geocoding/cache";
import { loadMunicipalityIndex } from "@/lib/geocoding/municipality-index";
import { biasCell, normalizeQuery } from "@/lib/geocoding/normalize";
import type {
	GeocodeHit,
	GeocodeSearchOptions,
} from "@/lib/geocoding/provider";
import {
	findMunicipalityNamesInQuery,
	type MunicipalityCompact,
	type MunicipalityIndex,
	resolveMunicipality,
} from "@/lib/geocoding/resolve-municipality";

const DEFAULT_LIMIT = 5;

export interface GeocodeSuggestion {
	/** Riga da mostrare, es. `Via Roma 12, Pioltello (MI)`. */
	label: string;
	addressLine1: string;
	zipCode: string | null;
	location: { x: number; y: number };
	municipality: MunicipalityCompact | null;
	/** Omonimi fra cui deve scegliere il cliente. */
	municipalityCandidates: MunicipalityCompact[];
	providerRef: string;
}

export interface GeocodeParams {
	q: string;
	limit?: number;
	lat?: number;
	lng?: number;
}

/** Una chiamata al provider, passando prima dalla cache. */
async function lookup(
	query: string,
	opts: GeocodeSearchOptions,
): Promise<GeocodeHit[]> {
	const provider = getGeocodingProvider();
	const cell = biasCell(opts.near);
	const cached = await readLookup({
		provider: provider.name,
		query,
		biasCell: cell,
	});
	if (cached && !cached.isStale) return cached.hits;

	try {
		const hits = await provider.search(query, opts);
		await writeLookup({
			provider: provider.name,
			query,
			biasCell: cell,
			hits,
		});
		return hits;
	} catch (error) {
		// Stale-if-error: una risposta vecchia è meglio di un form che non cerca.
		if (cached) return cached.hits;
		throw error;
	}
}

function dedupe(hits: GeocodeHit[]): GeocodeHit[] {
	const byRef = new Map<string, GeocodeHit>();
	for (const hit of hits) {
		if (!byRef.has(hit.providerRef)) byRef.set(hit.providerRef, hit);
	}
	return [...byRef.values()];
}

function toSuggestion(
	hit: GeocodeHit,
	index: MunicipalityIndex,
): GeocodeSuggestion {
	const { municipality, candidates } = resolveMunicipality(index, hit);
	const place = municipality
		? `${municipality.name} (${municipality.provinceAcronym})`
		: (hit.rawCity ?? "");

	return {
		label: place ? `${hit.addressLine1}, ${place}` : hit.addressLine1,
		addressLine1: hit.addressLine1,
		zipCode: hit.zipCode,
		location: hit.location,
		municipality,
		municipalityCandidates: candidates,
		providerRef: hit.providerRef,
	};
}

/**
 * Suggerimenti di indirizzo per un testo digitato.
 *
 * Il bias di prossimità è pieno per default: senza, `via roma 12` restituisce
 * risultati a 130 km. Ma il bias soffoca gli indirizzi lontani (`via roma 12
 * palermo` da Milano torna come `Via Palermo 12` a Parma), quindi quando il
 * testo nomina un comune parte anche una chiamata senza bias, e i risultati di
 * quel comune vanno in testa.
 */
export async function geocodeAddress(
	params: GeocodeParams,
): Promise<GeocodeSuggestion[]> {
	const limit = params.limit ?? DEFAULT_LIMIT;
	const query = normalizeQuery(params.q);
	const near =
		params.lat !== undefined && params.lng !== undefined
			? { lat: params.lat, lng: params.lng }
			: undefined;

	const index = await loadMunicipalityIndex();
	const mentionedIds = new Set(
		findMunicipalityNamesInQuery(index, query).map((m) => m.id),
	);

	const biased = near ? await lookup(query, { limit, near }) : [];
	// Senza bias la prima chiamata è già larga: la seconda serve solo quando il
	// bias c'è e il testo nomina un comune che il bias schiaccerebbe.
	const wide =
		!near || mentionedIds.size > 0 ? await lookup(query, { limit }) : [];

	const suggestions = dedupe([...biased, ...wide]).map((hit) =>
		toSuggestion(hit, index),
	);

	if (mentionedIds.size === 0) return suggestions.slice(0, limit);

	const isMentioned = (s: GeocodeSuggestion) =>
		s.municipality !== null && mentionedIds.has(s.municipality.id);

	return [
		...suggestions.filter(isMentioned),
		...suggestions.filter((s) => !isMentioned(s)),
	].slice(0, limit);
}
