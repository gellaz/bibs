import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Hook to fetch the authenticated seller's profile including VAT status.
 */
export function useSellerProfile() {
	return useQuery({
		queryKey: ["seller", "profile"],
		queryFn: async () => {
			const response = await api().seller.profile.get();

			if (response.error) {
				const errorMsg =
					typeof response.error.value === "string"
						? response.error.value
						: "Errore durante il caricamento del profilo";
				throw new Error(errorMsg);
			}

			return response.data.data;
		},
	});
}

/**
 * Hook to update the seller's VAT number (only when status is rejected).
 */
export function useUpdateVat() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (vatNumber: string) => {
			const response = await api().seller.profile.vat.patch({
				vatNumber,
			});

			if (response.error) {
				const errorMsg =
					typeof response.error.value === "string"
						? response.error.value
						: "Errore durante l'aggiornamento della partita IVA";
				throw new Error(errorMsg);
			}

			return response.data.data;
		},
		onSuccess: () => {
			// Invalidate the seller profile query to refetch updated data
			void queryClient.invalidateQueries({ queryKey: ["seller", "profile"] });
		},
	});
}
