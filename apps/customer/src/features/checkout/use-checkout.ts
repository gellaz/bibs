import { unwrapJson } from "@bibs/ui/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClientResponse } from "hono/client";
import { CART_KEY } from "@/features/cart/use-cart";
import { POINTS_KEY } from "@/features/points/use-points";
import { customerApi } from "@/lib/api";
import { m } from "@/paraglide/messages";
import {
	type CheckoutChoice,
	type CheckoutType,
	checkoutFailure,
	serializeChoice,
} from "./checkout-choice";
import { paymentState } from "./payment-state";
import type { ReservationInfo } from "./reservation-copy";

/** Errore di conferma con lo status HTTP (assente se la rete non ha risposto). */
export class CheckoutError extends Error {
	constructor(
		message: string,
		readonly status: number | undefined,
	) {
		super(message);
	}
}

/** Il messaggio che `unwrapJson` darebbe (testo dell'API o fallback). */
function errorMessage(res: ClientResponse<unknown, number>) {
	return unwrapJson(res, m.error_generic()).then(
		() => m.error_generic(),
		(e: Error) => e.message,
	);
}

export const ORDERS_KEY = ["customer", "orders"] as const;
export const CHECKOUT_PREVIEW_KEY = ["customer", "checkout-preview"] as const;

/** Scadenze «se confermi adesso» delle prenotazioni, per negozio. */
export function useReservationDeadlines(storeIds: string[]) {
	const ids = [...storeIds].sort();
	return useQuery({
		queryKey: ["customer", "reservation-deadlines", ids],
		enabled: ids.length > 0,
		queryFn: async () => {
			const { data } = await unwrapJson(
				await customerApi.checkout["reservation-deadlines"].$get({
					query: { storeIds: ids.join(",") },
				}),
				m.error_generic(),
			);
			return new Map<string, ReservationInfo>(
				data.map(({ storeId, ...info }) => [storeId, info]),
			);
		},
	});
}

/** Importi del riepilogo dall'API, con e senza punti: l'interruttore non fa chiamate. */
export function useCheckoutPreview(choice: CheckoutChoice, enabled: boolean) {
	const stores = serializeChoice(choice) ?? "";
	return useQuery({
		queryKey: [...CHECKOUT_PREVIEW_KEY, stores],
		enabled: enabled && stores !== "",
		retry: false,
		queryFn: async () => {
			const res = await customerApi.checkout.preview.$get({
				query: { stores },
			});
			if (!res.ok) throw new CheckoutError(await errorMessage(res), res.status);
			return (await res.json()).data;
		},
	});
}

export function useCreateCheckout() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (body: {
			idempotencyKey: string;
			stores: { storeId: string; type: CheckoutType }[];
			usePoints: boolean;
		}) => {
			const res = await customerApi.checkout.$post({ json: body });
			if (!res.ok) throw new CheckoutError(await errorMessage(res), res.status);
			return (await res.json()).data;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: CART_KEY });
			void qc.invalidateQueries({ queryKey: ORDERS_KEY });
			void qc.invalidateQueries({ queryKey: POINTS_KEY });
			void qc.invalidateQueries({ queryKey: CHECKOUT_PREVIEW_KEY });
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
			(
				await unwrapJson(
					await customerApi.checkouts[":checkoutId"].$get({
						param: { checkoutId },
					}),
					m.checkout_not_found(),
				)
			).data,
		// Dopo il pagamento la conferma arriva dal webhook: si rilegge finché i
		// PR2 escono da pending. Un PI ancora pagabile (payment != null) vuol dire
		// che il cliente deve agire: niente da confermare, niente da interrogare.
		refetchInterval: (q) => {
			const data = q.state.data;
			if (!opts.pollWhileAwaiting || !data) return false;
			return paymentState(data.orders) === "awaiting" && data.payment == null
				? 2000
				: false;
		},
	});
}
