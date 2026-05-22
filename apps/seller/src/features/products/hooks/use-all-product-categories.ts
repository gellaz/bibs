import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Paginazione lato API max 100; le categorie globali sono ~180 e crescono lente,
// quindi recuperiamo tutte le pagine in un singolo queryFn. Cache condivisa via
// queryKey costante.
export function useAllProductCategories() {
	return useQuery({
		queryKey: ["product-categories", "all"],
		staleTime: 5 * 60 * 1000,
		queryFn: async () => {
			const pageSize = 100;
			const first = await api()["product-categories"].get({
				query: { page: 1, limit: pageSize },
			});
			if (first.error) throw new Error("Errore caricamento categorie");
			const total = first.data.pagination.total;
			const all = [...first.data.data];

			let page = 2;
			while (all.length < total) {
				const next = await api()["product-categories"].get({
					query: { page, limit: pageSize },
				});
				if (next.error) throw new Error("Errore caricamento categorie");
				all.push(...next.data.data);
				if (next.data.data.length === 0) break;
				page += 1;
			}
			return all;
		},
	});
}
