import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";

type StatusFilter = "active" | "disabled" | "trashed";

// Categorie effettivamente assegnate ad almeno un prodotto del seller, opzionalmente
// scopate per store e per status. Set tipicamente piccolo (10-50 voci); cache breve.
export function useSellerCategoriesInUse(
	storeId: string | undefined,
	statusFilter: StatusFilter | undefined,
) {
	return useQuery({
		queryKey: ["seller-categories-in-use", storeId, statusFilter],
		enabled: Boolean(storeId),
		staleTime: 60 * 1000,
		queryFn: async () => {
			const response = await api().seller.products["categories-in-use"].get({
				query: {
					...(storeId ? { storeId } : {}),
					...(statusFilter ? { statusFilter } : {}),
				},
			});
			return unwrap(response, "Errore caricamento categorie in uso").data;
		},
	});
}
