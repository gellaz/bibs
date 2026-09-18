import { env } from "@/lib/env";
import { ServiceError } from "@/lib/errors";
import type {
	GeocodeHit,
	GeocodeSearchOptions,
	GeocodingProvider,
} from "./provider";

const TIMEOUT_MS = 5_000;
const UNAVAILABLE = "Servizio di ricerca indirizzi non disponibile";

interface PhotonFeature {
	properties: {
		name?: string;
		street?: string;
		housenumber?: string;
		city?: string;
		county?: string;
		postcode?: string;
		countrycode?: string;
		osm_type?: string;
		osm_id?: number;
	};
	geometry: { coordinates: [number, number] };
}

function toHit(feature: PhotonFeature): GeocodeHit | null {
	const p = feature.properties;
	// Il marketplace è italiano: un risultato estero è rumore, non un'opzione.
	if (p.countrycode !== "IT") return null;

	// `street` manca sui POI, dove il nome è l'unica etichetta utile.
	const street = p.street ?? p.name;
	if (!street) return null;

	const [lon, lat] = feature.geometry.coordinates;
	return {
		addressLine1: p.housenumber ? `${street} ${p.housenumber}` : street,
		zipCode: p.postcode ?? null,
		location: { x: lon, y: lat },
		rawCity: p.city ?? null,
		rawCounty: p.county ?? null,
		providerRef: `photon:${p.osm_type ?? "?"}${p.osm_id ?? "?"}`,
	};
}

/**
 * Photon (OpenStreetMap). `lang` non viene inviato: verificato il 2026-09-18
 * che accetta solo `default`/`de`/`en`/`fr` e risponde 400 su `it`.
 */
export const photonProvider: GeocodingProvider = {
	name: "photon",
	async search(q, opts: GeocodeSearchOptions): Promise<GeocodeHit[]> {
		const url = new URL(env.PHOTON_URL);
		url.searchParams.set("q", q);
		url.searchParams.set("limit", String(opts.limit));
		if (opts.near) {
			url.searchParams.set("lat", String(opts.near.lat));
			url.searchParams.set("lon", String(opts.near.lng));
		}

		let response: Response;
		try {
			response = await fetch(url, {
				headers: { "user-agent": env.GEOCODING_USER_AGENT },
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
		} catch {
			throw new ServiceError(503, UNAVAILABLE);
		}

		if (!response.ok) throw new ServiceError(503, UNAVAILABLE);

		const body = (await response.json()) as { features?: PhotonFeature[] };
		const hits: GeocodeHit[] = [];
		for (const feature of body.features ?? []) {
			const hit = toHit(feature);
			if (hit) hits.push(hit);
		}
		return hits;
	},
};
