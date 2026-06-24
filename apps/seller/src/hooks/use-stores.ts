import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";

/**
 * Hook to fetch the seller's stores.
 * Uses a high limit to fetch all stores at once (sellers typically have few stores).
 */
export function useStores({ enabled = true }: { enabled?: boolean } = {}) {
	return useQuery({
		queryKey: ["stores"],
		queryFn: async () => {
			const response = await api().seller.stores.get({
				query: { page: 1, limit: 100 },
			});

			return unwrap(response, "Errore nel caricamento negozi").data;
		},
		enabled,
	});
}
