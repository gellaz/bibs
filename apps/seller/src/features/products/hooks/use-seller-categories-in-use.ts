import { unwrapJson } from "@bibs/ui/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { sellerApi } from "@/lib/api";
import { m } from "@/paraglide/messages";

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
			const response = await sellerApi.products["categories-in-use"].$get({
				query: {
					...(storeId ? { storeId } : {}),
					...(statusFilter ? { statusFilter } : {}),
				},
			});
			return (
				await unwrapJson(response, m.products_categories_in_use_load_error())
			).data;
		},
	});
}
