import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";
import type { OrderStatus, OrderType } from "../order-labels";

const ORDERS_KEY = ["orders"] as const;

export function useOrdersList(params: {
	storeId?: string;
	page: number;
	limit: number;
	status?: OrderStatus;
	type?: OrderType;
}) {
	const { storeId, ...rest } = params;
	return useQuery({
		queryKey: [...ORDERS_KEY, "list", storeId, rest],
		queryFn: async () => {
			if (!storeId) throw new Error("missing store");
			const res = await api().seller.orders.get({
				query: { storeId, ...rest },
			});
			return unwrap(res, "Errore caricamento ordini");
		},
		enabled: !!storeId,
	});
}

export function useOrderCounts(params: { storeId?: string; type?: OrderType }) {
	const { storeId, type } = params;
	return useQuery({
		queryKey: [...ORDERS_KEY, "counts", storeId, type],
		queryFn: async () => {
			if (!storeId) throw new Error("missing store");
			const res = await api().seller.orders.counts.get({
				query: { storeId, type },
			});
			return unwrap(res, "Errore caricamento conteggi");
		},
		enabled: !!storeId,
	});
}

export function useOrder(orderId: string) {
	return useQuery({
		queryKey: [...ORDERS_KEY, "detail", orderId],
		queryFn: async () => {
			const res = await api().seller.orders({ orderId }).get();
			return unwrap(res, "Errore caricamento ordine");
		},
	});
}

function useOrderTransition(call: (orderId: string) => Promise<unknown>) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: call,
		// Anche sull'errore: un 400/409 vuol dire che l'ordine è cambiato sotto
		// (scaduto, annullato dal cliente) e la vista va riallineata.
		onSettled: () => {
			void qc.invalidateQueries({ queryKey: ORDERS_KEY });
		},
	});
}

export function useMarkReady() {
	return useOrderTransition(async (orderId) =>
		unwrap(await api().seller.orders({ orderId }).ready.patch(), "Errore"),
	);
}
export function useMarkPickedUp() {
	return useOrderTransition(async (orderId) =>
		unwrap(await api().seller.orders({ orderId }).complete.patch(), "Errore"),
	);
}
export function useCancelOrder() {
	return useOrderTransition(async (orderId) =>
		unwrap(await api().seller.orders({ orderId }).cancel.patch(), "Errore"),
	);
}
