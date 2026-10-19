import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const storeOrderTypesKey = (storeId: string) =>
	["store", storeId, "order-types"] as const;

/** Tipologie d'acquisto del negozio: scheda Vendita e sidebar leggono la stessa query. */
export function useStoreOrderTypes(storeId: string | undefined) {
	return useQuery({
		queryKey: storeOrderTypesKey(storeId ?? ""),
		queryFn: async () =>
			unwrap(
				await api()
					.seller.stores({ storeId: storeId ?? "" })
					["order-types"].get(),
				m.store_order_types_error(),
			).data,
		enabled: !!storeId,
	});
}
