import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

/** Porta il titolare sull'onboarding Stripe. Il link scade in pochi minuti: si usa subito. */
export function useStartOnboarding() {
	return useMutation({
		mutationFn: async () => {
			const r = await api().seller.settings.payments.onboarding.post();
			const { url } = unwrap(r, m["payments.error.start"]()).data;
			window.location.assign(url);
		},
	});
}

export function useSyncOnlinePayments() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async () => {
			const r = await api().seller.settings.payments.sync.post();
			return unwrap(r, m["payments.error.sync"]()).data;
		},
		onSuccess: () =>
			void qc.invalidateQueries({ queryKey: ["seller", "settings"] }),
	});
}
