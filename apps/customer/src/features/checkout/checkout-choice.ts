import { m } from "@/paraglide/messages";

export type CheckoutType = "reserve_pickup" | "pay_pickup";
/** storeId → tipologia scelta. Vive nei search params: sopravvive al refresh. */
export type CheckoutChoice = Record<string, CheckoutType>;

const TYPES: readonly CheckoutType[] = ["reserve_pickup", "pay_pickup"];

export function parseChoice(raw: unknown): CheckoutChoice {
	if (typeof raw !== "string") return {};
	const out: CheckoutChoice = {};
	for (const pair of raw.split(",")) {
		const [storeId, type] = pair.split(":");
		if (storeId && TYPES.includes(type as CheckoutType))
			out[storeId] = type as CheckoutType;
	}
	return out;
}

export function serializeChoice(c: CheckoutChoice): string | undefined {
	const pairs = Object.entries(c).map(([id, type]) => `${id}:${type}`);
	return pairs.length ? pairs.join(",") : undefined;
}

/**
 * Riconcilia la scelta in URL col carrello attuale: tiene solo negozi ancora
 * presenti e tipi ancora offerti, e preseleziona quando c'è una sola opzione.
 */
export function resolveChoice(
	groups: { store: { id: string; orderTypes: CheckoutType[] } }[],
	choice: CheckoutChoice,
): { choice: CheckoutChoice; complete: boolean } {
	const out: CheckoutChoice = {};
	for (const g of groups) {
		const picked = choice[g.store.id];
		if (picked && g.store.orderTypes.includes(picked)) out[g.store.id] = picked;
		else if (g.store.orderTypes.length === 1)
			out[g.store.id] = g.store.orderTypes[0];
	}
	return {
		choice: out,
		complete:
			groups.length > 0 && groups.every((g) => out[g.store.id] !== undefined),
	};
}

/** Il bottone dice cosa succede: prenotazione, pagamento, o entrambi. */
export function confirmLabel(types: CheckoutType[]): string {
	const reserve = types.includes("reserve_pickup");
	const pay = types.includes("pay_pickup");
	if (reserve && pay) return m.checkout_confirm_reserve_and_pay();
	return pay ? m.checkout_confirm_pay() : m.checkout_confirm_reserve();
}
