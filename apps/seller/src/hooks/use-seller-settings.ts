import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Hook to fetch the authenticated seller's settings including organization data.
 */
export function useSellerSettings() {
	return useQuery({
		queryKey: ["seller", "settings"],
		queryFn: async () => {
			const response = await api().seller.settings.get();

			if (response.error) {
				const errorMsg =
					typeof response.error.value === "string"
						? response.error.value
						: "Errore durante il caricamento delle impostazioni";
				throw new Error(errorMsg);
			}

			return response.data.data;
		},
	});
}
