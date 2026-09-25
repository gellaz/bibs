import { unwrap } from "@bibs/ui/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CART_KEY } from "@/features/cart/use-cart";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";
import type { CheckoutType } from "./checkout-choice";

export const ORDERS_KEY = ["customer", "orders"] as const;

export function useCreateCheckout() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (body: {
			idempotencyKey: string;
			stores: { storeId: string; type: CheckoutType }[];
		}) =>
			unwrap(await api().customer.checkout.post(body), m.error_generic()).data,
		// Anche sull'errore: un 409 vuol dire carrello cambiato.
		onSettled: () => {
			void qc.invalidateQueries({ queryKey: CART_KEY });
			void qc.invalidateQueries({ queryKey: ORDERS_KEY });
		},
	});
}

export function useCheckout(checkoutId: string) {
	return useQuery({
		queryKey: ["customer", "checkout", checkoutId],
		queryFn: async () =>
			unwrap(
				await api().customer.checkouts({ checkoutId }).get(),
				m.checkout_not_found(),
			).data,
	});
}
