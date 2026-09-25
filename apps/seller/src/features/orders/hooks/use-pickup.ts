import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";
import { isCompletePickupCode } from "../pickup-code";

/** Anteprima dell'ordine aperto del negozio con quel codice (al banco). */
export function usePickupPreview(storeId: string | undefined, code: string) {
	return useQuery({
		queryKey: ["orders", "pickup", storeId, code],
		queryFn: async () => {
			if (!storeId) throw new Error("missing store");
			const res = await api()
				.seller.orders.pickup({ code })
				.get({ query: { storeId } });
			if (res.error?.status === 404) throw new Error(m.pickup_not_found());
			return unwrap(res, m.pickup_preview_failed()).data;
		},
		enabled: !!storeId && isCompletePickupCode(code),
		retry: false,
	});
}

export function useConfirmPickup() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (p: { storeId: string; code: string }) => {
			const res = await api().seller.orders.pickup.post(p);
			if (res.error?.status === 404) throw new Error(m.pickup_not_found());
			return unwrap(res, m.pickup_confirm_failed()).data;
		},
		// Anche sull'errore: una prenotazione scaduta alla conferma cambia stato.
		onSettled: () => {
			void qc.invalidateQueries({ queryKey: ["orders"] });
		},
	});
}
