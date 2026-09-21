import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type { Coords } from "@/features/location/coords";

import type { Coords } from "@/features/location/coords";

/** Raggio della striscia in home, in km. L'endpoint non ne ha uno di default: senza, "Vicino a te" pescherebbe mezza Italia quando la zona è vuota. */
const NEARBY_RADIUS_KM = 50;

/** Forma normalizzata di un risultato della ricerca pubblica prodotti. */
export interface NearbyProduct {
	id: string;
	name: string;
	description: string | null;
	price: string;
	/** Distanza in metri dall'origine, `null` senza origine. */
	distance: number | null;
	images: { id: string; url: string; position: number }[];
	discountedPrice: string | null;
	discountPercent: number | null;
	store: { id: string; name: string; city: string; province: string };
}

/**
 * Prodotti da scoprire nei negozi della zona, via endpoint pubblico
 * `/customer/products`. Senza coordinate ritorna i prodotti attivi ordinati per
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
			const { data, error } = await api().customer.products.get({
				query: coords
					? {
							limit,
							lat: coords.lat,
							lng: coords.lng,
							radius: NEARBY_RADIUS_KM,
						}
					: { limit },
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
				store: {
					id: p.store.id,
					name: p.store.name,
					city: p.store.municipality.name,
					province: p.store.municipality.provinceAcronym,
				},
			}));
		},
	});
}
