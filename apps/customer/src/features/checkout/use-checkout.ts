import { unwrap } from "@bibs/ui/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CART_KEY } from "@/features/cart/use-cart";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";
import { type CheckoutType, checkoutFailure } from "./checkout-choice";
import { paymentState } from "./payment-state";

/** Errore di conferma con lo status HTTP (assente se la rete non ha risposto). */
export class CheckoutError extends Error {
	constructor(
		message: string,
		readonly status: number | undefined,
	) {
		super(message);
	}
}

/** Il messaggio che `unwrap` darebbe (testo dell'API o fallback). */
function errorMessage(res: { data: unknown; error: unknown }) {
	try {
		unwrap(res, m.error_generic());
	} catch (e) {
		return (e as Error).message;
	}
	return m.error_generic();
}

export const ORDERS_KEY = ["customer", "orders"] as const;

export function useCreateCheckout() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (body: {
			idempotencyKey: string;
			stores: { storeId: string; type: CheckoutType }[];
		}) => {
			const res = await api().customer.checkout.post(body);
			if (res.error)
				throw new CheckoutError(
					errorMessage(res),
					(res.error as { status?: number }).status,
				);
			return unwrap(res, m.error_generic()).data;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: CART_KEY });
			void qc.invalidateQueries({ queryKey: ORDERS_KEY });
		},
		// Un 4xx vuol dire carrello cambiato: si rilegge. Dopo un errore di rete
		// no: il server potrebbe aver già svuotato il carrello, e rileggerlo
		// toglierebbe al cliente la pagina da cui ripremere con la stessa chiave.
		onError: (e) => {
			const status = e instanceof CheckoutError ? e.status : undefined;
			if (checkoutFailure(status) === "back_to_cart")
				void qc.invalidateQueries({ queryKey: CART_KEY });
		},
	});
}

export function useCheckout(
	checkoutId: string,
	opts: { pollWhileAwaiting?: boolean } = {},
) {
	return useQuery({
		queryKey: ["customer", "checkout", checkoutId],
		queryFn: async () =>
			unwrap(
				await api().customer.checkouts({ checkoutId }).get(),
				m.checkout_not_found(),
			).data,
		// Dopo il pagamento la conferma arriva dal webhook: si rilegge finché i
		// PR2 escono da pending.
		refetchInterval: (q) =>
			opts.pollWhileAwaiting &&
			paymentState(q.state.data?.orders ?? []) === "awaiting"
				? 2000
				: false,
	});
}
