import { m } from "@/paraglide/messages";

export type OrderStatus =
	| "pending"
	| "confirmed"
	| "ready_for_pickup"
	| "shipped"
	| "delivered"
	| "completed"
	| "cancelled"
	| "expired";

/** Badge di un ordine, dal punto di vista del cliente: al singolare. */
export const CUSTOMER_ORDER_STATUS: Record<OrderStatus, () => string> = {
	pending: m.orders_status_pending,
	confirmed: m.orders_status_confirmed,
	ready_for_pickup: m.orders_status_ready_for_pickup,
	shipped: m.orders_status_shipped,
	delivered: m.orders_status_delivered,
	completed: m.orders_status_completed,
	cancelled: m.orders_status_cancelled,
	expired: m.orders_status_expired,
};

const DATE_FMT: Intl.DateTimeFormatOptions = {
	weekday: "short",
	day: "numeric",
	month: "short",
	hour: "2-digit",
	minute: "2-digit",
};

/**
 * Scadenza del ritiro: data e ora, più il tempo residuo arrotondato. Il
 * conto alla rovescia vivo lo aggiunge PickupCountdown con formatCountdown.
 */
export function pickupDeadline(
	expiresAt: Date | string,
	now: number = Date.now(),
): { expired: boolean; date: string; left: string } {
	const at = new Date(expiresAt);
	const ms = at.getTime() - now;
	const date = at.toLocaleString("it-IT", DATE_FMT);
	if (ms <= 0) return { expired: true, date, left: m.orders_pickup_expired() };
	const minutes = Math.ceil(ms / 60_000);
	const time =
		minutes >= 60 ? `${Math.floor(minutes / 60)} h` : `${minutes} min`;
	return { expired: false, date, left: m.orders_pickup_left({ time }) };
}

/** Rispecchia l'API: si annulla finché il negozio non ha preparato; un Paga e
 *  ritira in attesa di pagamento no (si annulla da solo). L'API resta
 *  l'autorità. */
export function canCustomerCancel(o: { status: string; type: string }) {
	if (o.type === "reserve_pickup")
		return o.status === "pending" || o.status === "confirmed";
	return o.type === "pay_pickup" && o.status === "confirmed";
}

/** Conto alla rovescia di una prenotazione: hh:mm:ss, ore anche oltre 24. */
export function formatCountdown(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}
