import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Hook to fetch the seller's stores.
 * Uses a high limit to fetch all stores at once (sellers typically have few stores).
 */
export function useStores() {
	return useQuery({
		queryKey: ["stores"],
		queryFn: async () => {
			const response = await api().seller.stores.get({
				query: { page: 1, limit: 100 },
			});

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nel caricamento negozi",
				);
			}

			return response.data.data;
		},
	});
}
