import { env } from "@/lib/env";
import { photonProvider } from "./photon";
import type { GeocodingProvider } from "./provider";

/**
 * Un provider solo, oggi. Il ramo esiste perché in produzione si passerà a
 * Google: un file nuovo e una env, non un refactor dei chiamanti.
 */
export function getGeocodingProvider(): GeocodingProvider {
	switch (env.GEOCODING_PROVIDER) {
		case "photon":
			return photonProvider;
		default:
			throw new Error(
				`GEOCODING_PROVIDER non supportato: ${env.GEOCODING_PROVIDER}`,
			);
	}
}
