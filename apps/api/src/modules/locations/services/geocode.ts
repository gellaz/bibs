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
// La chiave di cache è (provider, query, biasCell): non include `limit` perché
// al provider si chiede sempre il massimo consentito dalla route, quindi una
// riga soddisfa qualunque `limit` del chiamante senza mentire su quanti
// risultati esistono davvero. Il taglio al `limit` richiesto avviene solo alla
// fine, in `geocodeAddress`.
const PROVIDER_FETCH_LIMIT = 10;

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
	opts: Pick<GeocodeSearchOptions, "near">,
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
		const hits = await provider.search(query, {
			limit: PROVIDER_FETCH_LIMIT,
			near: opts.near,
		});
		// Una lista vuota va servita ma non scritta: se andasse in cache, uno
		// stale-if-error trasformerebbe una futura interruzione del provider in un
		// falso "indirizzo inesistente" invece di un errore, e nel frattempo la
		// tabella accumulerebbe una riga per ogni query di prefisso o typo che non
		// trova nulla.
		if (hits.length > 0) {
			await writeLookup({
				provider: provider.name,
				query,
				biasCell: cell,
				hits,
			});
		}
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
 *
 * Questa regola delle due chiamate e la promozione sono tarate sulla semantica
 * del bias di prossimità di Photon (sposta *quali* risultati arrivano, non
 * solo il loro ordine). Passare a un altro provider (Google in produzione)
 * non è solo "un file nuovo e una env": se il bias del nuovo provider si
 * comporta diversamente, questa politica va rivista, non solo l'adapter.
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
	const mentioned = findMunicipalityNamesInQuery(index, query);
	const mentionedIds = new Set(mentioned.map((m) => m.id));
	// Chi nomina un comune intende la sua zona: i risultati nei comuni limitrofi
	// (stessa provincia) sono la risposta giusta, non rumore da scartare.
	const mentionedProvinces = new Set(mentioned.map((m) => m.provinceAcronym));

	const biased = near ? await lookup(query, { near }) : [];
	// Senza bias la prima chiamata è già larga: la seconda serve solo quando il
	// bias c'è e il testo nomina un comune che il bias schiaccerebbe.
	const wide = !near || mentionedIds.size > 0 ? await lookup(query, {}) : [];

	const suggestions = dedupe([...biased, ...wide]).map((hit) =>
		toSuggestion(hit, index),
	);

	if (mentionedIds.size === 0) return suggestions.slice(0, limit);

	const isMentioned = (s: GeocodeSuggestion) =>
		s.municipality !== null &&
		(mentionedIds.has(s.municipality.id) ||
			mentionedProvinces.has(s.municipality.provinceAcronym));

	return [
		...suggestions.filter(isMentioned),
		...suggestions.filter((s) => !isMentioned(s)),
	].slice(0, limit);
}
