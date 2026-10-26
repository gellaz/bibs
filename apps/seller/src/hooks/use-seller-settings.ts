import { unwrapJson } from "@bibs/ui/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { sellerApi } from "@/lib/api";
import { m } from "@/paraglide/messages";

/**
 * Hook to fetch the authenticated seller's settings including organization data.
 *
 * `pollOnlinePayments`: finché il conto Connect non è attivo rilegge ogni 10 s
 * (solo a pagina visibile). Lo stato lo aggiorna il webhook, che può arrivare
 * dopo il ritorno dall'onboarding: senza polling la card resterebbe ferma.
 */
export function useSellerSettings({
	pollOnlinePayments = false,
}: {
	pollOnlinePayments?: boolean;
} = {}) {
	return useQuery({
		queryKey: ["seller", "settings"],
		queryFn: async () => {
			const response = await sellerApi.settings.$get();

			return (await unwrapJson(response, m.profile_settings_load_error())).data;
		},
		refetchInterval: (query) => {
			const status = query.state.data?.onlinePayments?.status;
			return pollOnlinePayments &&
				(status === "incomplete" || status === "in_review")
				? 10_000
				: false;
		},
	});
}
