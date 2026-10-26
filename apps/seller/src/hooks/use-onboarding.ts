import type { DocumentBody } from "@bibs/api/schemas";
import { unwrapJson } from "@bibs/ui/lib/api-client";
import type { Static } from "@sinclair/typebox";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sellerApi } from "@/lib/api";
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
			const response = await sellerApi.onboarding.status.$get();

			return (await unwrapJson(response, m.onboarding_status_load_error()))
				.data;
		},
		enabled,
	});
}

/**
 * Generic mutation hook for onboarding steps.
 * Invalidates onboarding status query on success.
 */
function useOnboardingMutation<TParams, TData>(
	mutationFn: (params: TParams) => Promise<TData>,
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
			const response = await sellerApi.onboarding["personal-info"].$patch({
				json: params,
			});
			return unwrapJson(response, m.onboarding_personal_save_error());
		},
	);
}

/**
 * Hook for Step 2: Document upload (multipart)
 */
export function useUpdateDocument() {
	return useOnboardingMutation(
		async (params: Static<typeof DocumentBody> & { documentImage: File }) => {
			const response = await sellerApi.onboarding.document.$patch({
				form: params,
			});
			return unwrapJson(response, m.onboarding_document_save_error());
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
			const response = await sellerApi.onboarding.company.$patch({
				json: params,
			});
			return unwrapJson(response, m.onboarding_company_save_error());
		},
	);
}

/**
 * Hook to go back to the previous onboarding step.
 */
export function useGoBack() {
	return useOnboardingMutation(async () => {
		const response = await sellerApi.onboarding["go-back"].$post();
		return unwrapJson(response, m.onboarding_go_back_error());
	});
}
