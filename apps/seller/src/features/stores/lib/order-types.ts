export type OrderType = "reserve_pickup" | "pay_pickup";

/** Cosa vede il cliente: Paga e ritira solo con i pagamenti abilitati (stessa regola dell'API). */
export function offeredTypes(
	draft: OrderType[],
	chargesEnabled: boolean,
): OrderType[] {
	return draft.filter((t) => t === "reserve_pickup" || chargesEnabled);
}

/**
 * Lo switch è bloccato? Spegnere l'ultima tipologia offerta lo rifiuterebbe
 * l'API; accendere Paga e ritira richiede i pagamenti abilitati.
 */
export function isToggleLocked(
	type: OrderType,
	draft: OrderType[],
	chargesEnabled: boolean,
): boolean {
	if (!draft.includes(type)) return type === "pay_pickup" && !chargesEnabled;
	const offered = offeredTypes(draft, chargesEnabled);
	return offered.length === 1 && offered[0] === type;
}
