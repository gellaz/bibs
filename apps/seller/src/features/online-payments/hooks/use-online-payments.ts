import { unwrapJson } from "@bibs/ui/lib/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sellerApi } from "@/lib/api";
import { m } from "@/paraglide/messages";

/** Porta il titolare sull'onboarding Stripe. Il link scade in pochi minuti: si usa subito. */
export function useStartOnboarding() {
	return useMutation({
		mutationFn: async () => {
			const r = await sellerApi.settings.payments.onboarding.$post();
			const { url } = (await unwrapJson(r, m.payments_error_start())).data;
			window.location.assign(url);
		},
	});
}

export function useSyncOnlinePayments() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async () => {
			const r = await sellerApi.settings.payments.sync.$post();
			return (await unwrapJson(r, m.payments_error_sync())).data;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["seller", "settings"] });
			// Le tipologie offerte dipendono dall'account che incassa.
			void qc.invalidateQueries({
				predicate: (q) => q.queryKey[2] === "order-types",
			});
		},
	});
}
