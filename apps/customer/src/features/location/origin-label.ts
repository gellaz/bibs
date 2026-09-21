import { m } from "@/paraglide/messages";
import type { SearchOrigin } from "./search-origin-state";
import type { GeoStatus } from "./use-geolocation";

/**
 * Come si chiama l'origine nella UI. Il GPS in attesa ha un nome suo:
 * "Posizione attuale" mentre il browser sta ancora cercando è una promessa non
 * ancora mantenuta.
 */
export function originLabel(
	origin: SearchOrigin,
	geoStatus: GeoStatus,
): string {
	if (origin.kind === "address") return origin.label;
	if (origin.kind === "gps") {
		return geoStatus === "pending" ? m.origin_gps_locating() : m.origin_gps();
	}
	return m.origin_everywhere();
}
