import { useCallback, useEffect, useState } from "react";
import type { Coords } from "./coords";

export type GeoStatus =
	/** Sonda dei permessi in corso: non si sa ancora niente. */
	"probing" | "idle" | "pending" | "granted" | "denied" | "unsupported";

/**
 * La geolocalizzazione del browser come flusso di permesso riusabile: una
 * lettura sola, bassa precisione, timeout 8s e cache 5 minuti.
 *
 * All'avvio **sonda** il permesso: se il consenso c'è già legge la posizione in
 * silenzio, altrimenti resta in `idle` e tocca a un gesto del cliente chiamare
 * `request()`. Nessun prompt parte da solo — è la regola della spec, e vale per
 * tutta l'app da quando questo hook è l'unico posto che chiama il browser.
 */
export function useGeolocation() {
	const [coords, setCoords] = useState<Coords | null>(null);
	const [status, setStatus] = useState<GeoStatus>("probing");

	const request = useCallback(() => {
		if (typeof navigator === "undefined" || !navigator.geolocation) {
			setStatus("unsupported");
			return;
		}
		setStatus("pending");
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
				setStatus("granted");
			},
			() => setStatus("denied"),
			{ enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
		);
	}, []);

	useEffect(() => {
		let cancelled = false;
		async function probe() {
			if (typeof navigator === "undefined" || !navigator.geolocation) {
				setStatus("unsupported");
				return;
			}
			try {
				const result = await navigator.permissions.query({
					name: "geolocation" as PermissionName,
				});
				if (cancelled) return;
				if (result.state === "granted") request();
				else if (result.state === "denied") setStatus("denied");
				else setStatus("idle");
			} catch {
				// Permissions API assente o senza `geolocation` (il supporto Safari
				// è irregolare): non indoviniamo, aspettiamo un gesto.
				if (!cancelled) setStatus("idle");
			}
		}
		void probe();
		return () => {
			cancelled = true;
		};
	}, [request]);

	return { coords, status, request };
}
