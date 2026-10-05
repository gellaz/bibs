import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

/**
 * Hook to fetch the current onboarding status and data.
 */
export function useOnboardingStatus({
	enabled = true,
}: {
	/** Only sellers have an onboarding: the route answers 403 to employees. */
	enabled?: boolean;
} = {}) {
	return useQuery({
		queryKey: ["seller", "onboarding", "status"],
		queryFn: async () => {
			const response = await api().seller.onboarding.status.get();

			return unwrap(response, m.onboarding_status_load_error()).data;
		},
		enabled,
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
			residenceMunicipalityId: string;
			residenceAddress: string;
			residenceZipCode: string;
		}) => {
			const response =
				await api().seller.onboarding["personal-info"].patch(params);
			return unwrap(response, m.onboarding_personal_save_error());
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
			documentIssuedMunicipalityId: string;
			documentImage: File;
		}) => {
			const response = await api().seller.onboarding.document.patch(params);
			return unwrap(response, m.onboarding_document_save_error());
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
			municipalityId: string;
			zipCode: string;
		}) => {
			const response = await api().seller.onboarding.company.patch(params);
			return unwrap(response, m.onboarding_company_save_error());
		},
	);
}

/**
 * Hook to go back to the previous onboarding step.
 */
export function useGoBack() {
	return useOnboardingMutation(async () => {
		const response = await api().seller.onboarding["go-back"].post();
		return unwrap(response, m.onboarding_go_back_error());
	});
}
