export type PaymentState = "none" | "awaiting" | "paid" | "failed";

export type DonePageState =
	| "none"
	| "awaiting_payment"
	| "awaiting_confirmation"
	| "paid"
	| "failed";

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

/**
 * Stato per la pagina "ordine effettuato": come paymentState, ma separa
 * l'attesa in due letture diverse per il cliente — un PI ancora pagabile
 * (deve completare il pagamento) da uno non più pagabile (il webhook sta
 * solo confermando, non c'è nulla da fare).
 */
export function donePageState(
	orders: readonly { type: string; status: string }[],
	hasPayment: boolean,
): DonePageState {
	const state = paymentState(orders);
	if (state !== "awaiting") return state;
	return hasPayment ? "awaiting_payment" : "awaiting_confirmation";
}
