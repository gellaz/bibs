import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Hook to fetch the current onboarding status and data.
 */
export function useOnboardingStatus() {
	return useQuery({
		queryKey: ["seller", "onboarding", "status"],
		queryFn: async () => {
			const response = await api().seller.onboarding.status.get();

			if (response.error) {
				const errorMsg =
					typeof response.error.value === "string"
						? response.error.value
						: "Errore durante il caricamento dello stato onboarding";
				throw new Error(errorMsg);
			}

			return response.data.data;
		},
	});
}

/**
 * Generic mutation hook for onboarding steps.
 * Invalidates onboarding status query on success.
 */
function useOnboardingMutation<TParams>(
	mutationFn: (params: TParams) => Promise<unknown>,
) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn,
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["seller", "onboarding", "status"],
			});
		},
	});
}

/**
 * Hook for Step 1: Personal Info
 */
export function useUpdatePersonalInfo() {
	return useOnboardingMutation(
		async (params: {
			firstName: string;
			lastName: string;
			citizenship: string;
			birthCountry: string;
			birthDate: string;
			residenceCountry: string;
			residenceCity: string;
			residenceAddress: string;
			residenceZipCode: string;
		}) => {
			const response =
				await api().seller.onboarding["personal-info"].patch(params);
			if (response.error) {
				const errorMsg =
					typeof response.error.value === "string"
						? response.error.value
						: "Errore durante il salvataggio dei dati personali";
				throw new Error(errorMsg);
			}
			return response.data;
		},
	);
}

/**
 * Hook for Step 2: Document upload (multipart)
 */
export function useUpdateDocument() {
	return useOnboardingMutation(
		async (params: {
			documentNumber: string;
			documentExpiry: string;
			documentIssuedMunicipality: string;
			documentImage: File;
		}) => {
			const response = await api().seller.onboarding.document.patch(params);
			if (response.error) {
				const errorMsg =
					typeof response.error.value === "string"
						? response.error.value
						: "Errore durante il caricamento del documento";
				throw new Error(errorMsg);
			}
			return response.data;
		},
	);
}

/**
 * Hook for Step 3: Company info
 */
export function useUpdateCompany() {
	return useOnboardingMutation(
		async (params: {
			businessName: string;
			vatNumber: string;
			legalForm: string;
			addressLine1: string;
			country?: string;
			province?: string;
			city: string;
			zipCode: string;
		}) => {
			const response = await api().seller.onboarding.company.patch(params);
			if (response.error) {
				const errorMsg =
					typeof response.error.value === "string"
						? response.error.value
						: "Errore durante il salvataggio dei dati aziendali";
				throw new Error(errorMsg);
			}
			return response.data;
		},
	);
}

/**
 * Hook for Step 4: Store creation
 */
export function useCreateStore() {
	return useOnboardingMutation(
		async (params: {
			name: string;
			description?: string;
			addressLine1: string;
			province?: string;
			city: string;
			zipCode: string;
			categoryId?: string;
			openingHours?: unknown;
			useCompanyAddress?: boolean;
		}) => {
			const response = await api().seller.onboarding.store.post(params);
			if (response.error) {
				const errorMsg =
					typeof response.error.value === "string"
						? response.error.value
						: "Errore durante la creazione del negozio";
				throw new Error(errorMsg);
			}
			return response.data;
		},
	);
}

/**
 * Hook for Step 5: Payment
 */
export function useUpdatePayment() {
	return useOnboardingMutation(async (params: { stripeAccountId?: string }) => {
		const response = await api().seller.onboarding.payment.patch(params);
		if (response.error) {
			const errorMsg =
				typeof response.error.value === "string"
					? response.error.value
					: "Errore durante la configurazione del pagamento";
			throw new Error(errorMsg);
		}
		return response.data;
	});
}
