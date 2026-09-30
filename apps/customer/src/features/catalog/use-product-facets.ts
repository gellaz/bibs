import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Coords } from "@/features/location/coords";
import { api } from "@/lib/api";

export interface ProductCategoryFacetView {
	id: string;
	name: string;
	productCount: number;
}

export interface ProductMacroFacetView extends ProductCategoryFacetView {
	categories: ProductCategoryFacetView[];
}

interface UseProductFacetsArgs {
	q?: string;
	coords: Coords | null;
	radius?: number;
	openNow?: boolean;
	onSale?: boolean;
	minPrice?: number;
	maxPrice?: number;
}

/**
 * Conteggi del rail. Seguono testo, raggio, prezzo e offerta ma NON la
 * categoria scelta: la domanda è "quanti prodotti restano se aggiungo questo
 * filtro", quindi le alternative devono restare visibili e contate.
 */
export function useProductFacets({
	q,
	coords,
	radius,
	openNow,
	onSale,
	minPrice,
	maxPrice,
}: UseProductFacetsArgs) {
	const query = useQuery({
		queryKey: [
			"product-facets",
			q ?? "",
			coords?.lat ?? null,
			coords?.lng ?? null,
			radius ?? null,
			openNow ?? false,
			onSale ?? false,
			minPrice ?? null,
			maxPrice ?? null,
		],
		staleTime: 60_000,
		// A ogni cambio di testo o filtro i conteggi vecchi restano finché
		// arrivano i nuovi, invece di ricadere nello skeleton.
		placeholderData: keepPreviousData,
		queryFn: async () => {
			const { data, error } = await api().customer.products.facets.get({
				query: {
					...(q ? { q } : {}),
					...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
					...(coords && radius ? { radius } : {}),
					...(openNow ? { openNow } : {}),
					...(onSale ? { onSale } : {}),
					...(minPrice !== undefined ? { minPrice } : {}),
					...(maxPrice !== undefined ? { maxPrice } : {}),
				},
			});
			if (error) throw new Error(`Filtri non disponibili (${error.status})`);
			return data.data;
		},
	});

	return {
		macros: (query.data?.macros ?? []) as ProductMacroFacetView[],
		total: query.data?.total ?? 0,
		openNowTotal: query.data?.openNowTotal ?? 0,
		onSaleTotal: query.data?.onSaleTotal ?? 0,
		isPending: query.isPending,
		// Senza dati i totali varrebbero 0: il rail direbbe "nessun negozio
		// aperto" e spegnerebbe i filtri per un errore di rete.
		isError: query.isError && !query.data,
		refetch: query.refetch,
	};
}
