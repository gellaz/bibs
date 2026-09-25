import { toast } from "@bibs/ui/components/sonner";
import { unwrap } from "@bibs/ui/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ORDERS_KEY } from "@/features/checkout/use-checkout";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const ORDERS_PAGE_SIZE = 20;

export function useCustomerOrders(params: {
	type: "reserve_pickup" | "pay_pickup";
	page: number;
}) {
	return useQuery({
		queryKey: [...ORDERS_KEY, "list", params.type, params.page],
		queryFn: async () =>
			unwrap(
				await api().customer.orders.get({
					query: { ...params, limit: ORDERS_PAGE_SIZE },
				}),
				m.orders_load_failed(),
			),
	});
}

export function useCustomerOrder(orderId: string) {
	return useQuery({
		queryKey: [...ORDERS_KEY, "detail", orderId],
		queryFn: async () =>
			unwrap(
				await api().customer.orders({ orderId }).get(),
				m.orders_not_found(),
			).data,
	});
}

export function useCancelOrder() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (orderId: string) => {
			const res = await api().customer.orders({ orderId }).cancel.post();
			// 400/409: l'ordine è cambiato sotto (preparato, annullato dal negozio,
			// scaduto). Il messaggio tecnico dell'API non aiuta il cliente.
			if (res.error && (res.error.status === 400 || res.error.status === 409))
				throw new Error(m.orders_changed());
			return unwrap(res, m.error_generic()).data;
		},
		onSettled: () => {
			void qc.invalidateQueries({ queryKey: ORDERS_KEY });
		},
		onError: (e: Error) => toast.error(e.message),
	});
}
