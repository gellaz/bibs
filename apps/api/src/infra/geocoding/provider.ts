/**
 * I provider previsti. Vive qui e non nello schema del DB perché la tabella
 * deriva dalla porta, non il contrario: una sola fonte di verità.
 */
export const geocodingProviderNames = ["photon", "google"] as const;

export type GeocodingProviderName = (typeof geocodingProviderNames)[number];

/** Un risultato del geocoder, già nella nostra forma: nessun GeoJSON in giro. */
export interface GeocodeHit {
	/** Via e civico quando il provider lo conosce, es. `Via Roma 12`. */
	addressLine1: string;
	zipCode: string | null;
	/** PostGIS point: `x` = longitudine, `y` = latitudine. */
	location: { x: number; y: number };
	/** Comune così come lo scrive il provider, prima della risoluzione. */
	rawCity: string | null;
	/** Provincia così come la scrive il provider. */
	rawCounty: string | null;
	/** Riferimento opaco del provider, es. `photon:N7137139871`. Usato per il dedup. */
	providerRef: string;
}

export interface GeocodeSearchOptions {
	limit: number;
	/** Bias di prossimità: sposta *quali* risultati arrivano, non solo il loro ordine. */
	near?: { lat: number; lng: number };
}

export interface GeocodingProvider {
	readonly name: GeocodingProviderName;
	search(q: string, opts: GeocodeSearchOptions): Promise<GeocodeHit[]>;
}
