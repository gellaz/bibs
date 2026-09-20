import { unwrap } from "@bibs/ui/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

export interface BiasPosition {
	lat: number;
	lng: number;
}

async function fetchSuggestions(q: string, near: BiasPosition | null) {
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

export function useGeocode(text: string, near: BiasPosition | null) {
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

export type BiasStatus =
	| "unknown"
	| "unavailable"
	| "prompt"
	| "pending"
	| "granted";

/**
 * La posizione usata per ordinare i suggerimenti per vicinanza. Non fa scattare
 * il prompt dei permessi da sola: se il consenso c'è già, prende la posizione in
 * silenzio; altrimenti resta in `prompt` e tocca alla UI offrire il bottone.
 *
 * La PR 3 sostituirà questo hook con l'origine condivisa del chip globale.
 */
export function useBiasPosition() {
	const [position, setPosition] = useState<BiasPosition | null>(null);
	const [status, setStatus] = useState<BiasStatus>("unknown");

	const read = useCallback(() => {
		if (typeof navigator === "undefined" || !navigator.geolocation) {
			setStatus("unavailable");
			return;
		}
		setStatus("pending");
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
				setStatus("granted");
			},
			() => setStatus("prompt"),
			{ enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
		);
	}, []);

	useEffect(() => {
		let cancelled = false;
		async function detect() {
			if (typeof navigator === "undefined" || !navigator.geolocation) {
				setStatus("unavailable");
				return;
			}
			try {
				const result = await navigator.permissions.query({
					name: "geolocation" as PermissionName,
				});
				if (cancelled) return;
				if (result.state === "granted") read();
				else setStatus("prompt");
			} catch {
				// Permissions API assente o senza supporto per `geolocation`: non
				// indoviniamo, lasciamo decidere al cliente.
				if (!cancelled) setStatus("prompt");
			}
		}
		void detect();
		return () => {
			cancelled = true;
		};
	}, [read]);

	return { position, status, request: read };
}
