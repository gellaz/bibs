import L from "leaflet";
import { useEffect } from "react";
import { useMap } from "react-leaflet";

/**
 * Pin di un negozio. L'HTML di un `divIcon` vive nel documento, quindi le
 * variabili CSS del brand risolvono e restano theme-aware.
 */
export const pinIcon = L.divIcon({
	className: "",
	html: `<svg width="32" height="40" viewBox="0 0 24 30" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C6.48 0 2 4.48 2 10c0 6.5 10 20 10 20s10-13.5 10-20C22 4.48 17.52 0 12 0z" fill="var(--saffron)" stroke="var(--ink)" stroke-width="1.5"/><circle cx="12" cy="10" r="3.2" fill="var(--ink)"/></svg>`,
	iconSize: [32, 40],
	iconAnchor: [16, 40],
});

/**
 * La posizione dell'utente: un punto, non un pin. Non è un negozio e non deve
 * sembrarlo.
 */
export const userLocationIcon = L.divIcon({
	className: "",
	html: `<span style="display:block;width:14px;height:14px;border-radius:9999px;background:var(--ink);border:2px solid var(--cream);box-shadow:0 1px 3px rgb(0 0 0 / 0.3)"></span>`,
	iconSize: [14, 14],
	iconAnchor: [7, 7],
});

/**
 * Leaflet calcola la dimensione una volta al mount: quando il contenitore
 * cambia larghezza col breakpoint, senza questo la mappa resta con i tile della
 * misura vecchia e una banda grigia.
 */
export function KeepSizeInSync() {
	const map = useMap();
	useEffect(() => {
		const container = map.getContainer();
		const observer = new ResizeObserver(() => map.invalidateSize());
		observer.observe(container);
		return () => observer.disconnect();
	}, [map]);
	return null;
}
