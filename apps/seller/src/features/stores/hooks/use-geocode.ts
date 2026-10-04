import { unwrap } from "@bibs/ui/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

export async function fetchGeocodeSuggestions(q: string) {
	const res = await api().locations.geocode.get({ query: { q } });
	return unwrap(res, m.store_address_search_error()).data;
}

export type GeocodeSuggestionItem = Awaited<
	ReturnType<typeof fetchGeocodeSuggestions>
>[number];

/** Sotto i 3 caratteri l'endpoint risponde 400: non lo si chiama affatto. */
export const GEOCODE_MIN_QUERY = 3;

export const geocodeQueryKey = (q: string) => ["geocode", q] as const;

export function useGeocode(text: string) {
	const q = text.trim();
	return useQuery({
		queryKey: geocodeQueryKey(q),
		enabled: q.length >= GEOCODE_MIN_QUERY,
		staleTime: 5 * 60_000,
		// Un 503 del provider non si ritenta da soli: ritentare in loop peserebbe
		// su un servizio già in difficoltà.
		retry: false,
		queryFn: () => fetchGeocodeSuggestions(q),
	});
}
