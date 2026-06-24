import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";

/**
 * Hook to fetch the authenticated seller's settings including organization data.
 */
export function useSellerSettings() {
	return useQuery({
		queryKey: ["seller", "settings"],
		queryFn: async () => {
			const response = await api().seller.settings.get();

			return unwrap(
				response,
				"Errore durante il caricamento delle impostazioni",
			).data;
		},
	});
}
