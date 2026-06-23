import { useCallback, useState } from "react";

export interface Coords {
	lat: number;
	lng: number;
}

export type GeoStatus =
	| "idle"
	| "pending"
	| "granted"
	| "denied"
	| "unsupported";

/**
 * Browser geolocation as a reusable permission flow. Mirrors the original
 * inline behavior of the discovery feed: one-shot low-accuracy request with an
 * 8s timeout and a 5-minute cache, surfacing the permission state to the UI.
 */
export function useGeolocation() {
	const [coords, setCoords] = useState<Coords | null>(null);
	const [status, setStatus] = useState<GeoStatus>("idle");

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

	return { coords, status, request };
}
