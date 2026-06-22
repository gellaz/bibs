import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Coords {
	lat: number;
	lng: number;
}

/** Forma normalizzata di un risultato della ricerca pubblica prodotti. */
export interface NearbyProduct {
	id: string;
	name: string;
	description: string | null;
	price: string;
	/** Distanza in metri dal punto di ricerca (0 se nessun filtro geografico). */
	distance: number;
	images: { id: string; url: string; position: number }[];
	discountedPrice: string | null;
	discountPercent: number | null;
}

/**
 * Prodotti da scoprire nei negozi della zona, via endpoint pubblico
 * `/customer/search`. Senza coordinate ritorna i prodotti attivi ordinati per
 * recency; con coordinate l'ordinamento passa alla distanza e ogni risultato
 * porta la propria distanza in metri.
 *
 * La mappatura disaccoppia la UI dal tipo inferito da Eden (incluse le date
 * idratate a `Date`), tenendo i tile su una forma stabile.
 */
export function useNearbyProducts(coords: Coords | null, limit = 12) {
	return useQuery({
		queryKey: [
			"nearby-products",
			coords?.lat ?? null,
			coords?.lng ?? null,
			limit,
		],
		staleTime: 60_000,
		queryFn: async (): Promise<NearbyProduct[]> => {
			const { data, error } = await api().customer.search.get({
				query: coords ? { limit, lat: coords.lat, lng: coords.lng } : { limit },
			});

			if (error) {
				throw new Error(`Ricerca non riuscita (${error.status})`);
			}

			return data.data.map((p) => ({
				id: p.id,
				name: p.name,
				description: p.description,
				price: p.price,
				distance: p.distance,
				images: p.images.map((img) => ({
					id: img.id,
					url: img.url,
					position: img.position,
				})),
				discountedPrice: p.discountedPrice,
				discountPercent: p.discountPercent,
			}));
		},
	});
}
