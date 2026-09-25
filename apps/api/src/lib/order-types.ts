/** Tipi d'ordine che un negozio può offrire al checkout (colonna stores.order_types). */
export const storeOrderTypes = ["reserve_pickup", "pay_pickup"] as const;
export type StoreOrderType = (typeof storeOrderTypes)[number];

// Pagamento online non ancora attivo: arriva con Connect (PR E) e il pagamento
// (PR F). Fino ad allora un negozio può averlo configurato ma non lo offre.
const ONLINE_PAYMENT_LIVE = false;

/**
 * Unica regola su cosa si offre al checkout: la usano il carrello (per mostrare
 * la scelta) e il checkout (per validarla), così non possono divergere.
 */
export function offeredOrderTypes(
	configured: readonly string[],
): StoreOrderType[] {
	return storeOrderTypes.filter(
		(t) =>
			configured.includes(t) && (t !== "pay_pickup" || ONLINE_PAYMENT_LIVE),
	);
}
