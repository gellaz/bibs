import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Coords } from "@/features/location/coords";
import { api } from "@/lib/api";

export interface CategoryFacet {
	id: string;
	name: string;
	storeCount: number;
}

export interface MacroFacet extends CategoryFacet {
	categories: CategoryFacet[];
}

interface UseStoreFacetsArgs {
	q?: string;
	coords: Coords | null;
	radius?: number;
	openNow?: boolean;
}

/**
 * Conteggi della sidebar. Seguono testo e raggio ma NON la categoria scelta:
 * la domanda a cui rispondono è "quanti negozi restano se aggiungo questo
 * filtro", quindi le alternative devono restare visibili e contate.
 */
export function useStoreFacets({
	q,
	coords,
	radius,
	openNow,
}: UseStoreFacetsArgs) {
	const query = useQuery({
		queryKey: [
			"store-facets",
			q ?? "",
			coords?.lat ?? null,
			coords?.lng ?? null,
			radius ?? null,
			openNow ?? false,
		],
		staleTime: 60_000,
		// A ogni cambio di testo o filtro i conteggi vecchi restano finché
		// arrivano i nuovi, invece di ricadere nello skeleton.
		placeholderData: keepPreviousData,
		queryFn: async () => {
			const { data, error } = await api().customer.stores.facets.get({
				query: {
					...(q ? { q } : {}),
					...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
					...(coords && radius ? { radius } : {}),
					...(openNow ? { openNow } : {}),
				},
			});
			if (error) throw new Error(`Filtri non disponibili (${error.status})`);
			return data.data;
		},
	});

	return {
		macros: (query.data?.macros ?? []) as MacroFacet[],
		total: query.data?.total ?? 0,
		openNowTotal: query.data?.openNowTotal ?? 0,
		isPending: query.isPending,
		// Senza dati i totali varrebbero 0: il rail direbbe "nessun negozio
		// aperto" e spegnerebbe i filtri per un errore di rete.
		isError: query.isError && !query.data,
		refetch: query.refetch,
	};
}
