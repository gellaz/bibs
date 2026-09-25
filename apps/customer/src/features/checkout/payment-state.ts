export type PaymentState = "none" | "awaiting" | "paid" | "failed";

/**
 * Stato del pagamento online di un checkout, letto dagli ordini dell'API (mai
 * dall'URL di ritorno di Stripe). failed = nessun PR2 è mai stato pagato: sono
 * scaduti o il pagamento è stato annullato.
 */
export function paymentState(
	orders: readonly { type: string; status: string }[],
): PaymentState {
	const pay = orders.filter((o) => o.type === "pay_pickup");
	if (pay.length === 0) return "none";
	if (pay.some((o) => o.status === "pending")) return "awaiting";
	if (pay.every((o) => o.status === "cancelled" || o.status === "expired"))
		return "failed";
	return "paid";
}
