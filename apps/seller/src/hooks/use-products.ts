// apps/seller/src/hooks/use-products.ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Fetches the seller's products filtered by the active store.
 * Disabled until storeId is set.
 */
export function useProducts(storeId: string | null, page = 1, limit = 50) {
	return useQuery({
		queryKey: ["products", storeId, page, limit],
		queryFn: async () => {
			if (!storeId) throw new Error("storeId required");
			const response = await api().seller.products.get({
				query: { storeId, page, limit },
			});
			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nel caricamento prodotti",
				);
			}
			return response.data;
		},
		enabled: storeId !== null,
	});
}
