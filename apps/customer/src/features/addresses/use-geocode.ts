import { unwrap } from "@bibs/ui/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import type { Coords } from "@/features/location/coords";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

async function fetchSuggestions(q: string, near: Coords | null) {
	const res = await api().locations.geocode.get({
		query: {
			q,
			...(near ? { lat: near.lat, lng: near.lng } : {}),
		},
	});
	return unwrap(res, m.address_geocode_failed()).data;
}

export type GeocodeSuggestionItem = Awaited<
	ReturnType<typeof fetchSuggestions>
>[number];

/** Sotto i 3 caratteri l'endpoint risponde 400: non lo si chiama affatto. */
const MIN_QUERY = 3;

export function useGeocode(text: string, near: Coords | null) {
	const q = text.trim();
	return useQuery({
		queryKey: ["geocode", q, near?.lat ?? null, near?.lng ?? null] as const,
		enabled: q.length >= MIN_QUERY,
		staleTime: 5 * 60_000,
		// Un 503 del provider non si ritenta da soli: la UI offre l'inserimento
		// a mano, e ritentare in loop peserebbe su un servizio già in difficoltà.
		retry: false,
		queryFn: () => fetchSuggestions(q, near),
	});
}
