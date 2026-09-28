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
export type OrderType =
	| "direct"
	| "reserve_pickup"
	| "pay_pickup"
	| "pay_deliver";

/** Badge di un singolo ordine: al singolare. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, () => string> = {
	pending: m.orders_status_pending,
	confirmed: m.orders_status_confirmed,
	ready_for_pickup: m.orders_status_ready_for_pickup,
	shipped: m.orders_status_shipped,
	delivered: m.orders_status_delivered,
	completed: m.orders_status_completed,
	cancelled: m.orders_status_cancelled,
	expired: m.orders_status_expired,
};

export const ORDER_TYPE_LABEL: Record<OrderType, () => string> = {
	reserve_pickup: m.orders_type_reserve_pickup,
	pay_pickup: m.orders_type_pay_pickup,
	pay_deliver: m.orders_type_pay_deliver,
	direct: m.orders_type_direct,
};

export function shortOrderId(id: string): string {
	return `#${id.slice(0, 8).toUpperCase()}`;
}

const PICKUP: readonly OrderType[] = ["reserve_pickup", "pay_pickup"];

// Rispecchiano la macchina a stati dell'API (lib/order-state-machine.ts): il
// bottone compare solo se la transizione è valida. L'API resta l'autorità.
export function canMarkReady(o: { status: OrderStatus; type: OrderType }) {
	return o.status === "confirmed" && o.type !== "direct";
}
export function canMarkPickedUp(o: { status: OrderStatus; type: OrderType }) {
	return (
		PICKUP.includes(o.type) &&
		(o.status === "confirmed" || o.status === "ready_for_pickup")
	);
}
export function canCancel(o: { status: OrderStatus; type: OrderType }) {
	// Un pay_* pending non si annulla a mano: il pagamento copre tutto il
	// checkout e l'ordine scade da solo (API: 409).
	return o.type !== "direct" && o.status === "confirmed";
}

/** Tempo alla scadenza di una prenotazione, in forma breve ("5 h", "40 min"). */
export function reservationTimeLeft(
	expiresAt: Date | string,
	now: number = Date.now(),
): { expired: boolean; label: string } {
	const ms = new Date(expiresAt).getTime() - now;
	if (ms <= 0) return { expired: true, label: m.orders_deadline_expired() };
	const minutes = Math.ceil(ms / 60_000);
	const time =
		minutes >= 60 ? `${Math.floor(minutes / 60)} h` : `${minutes} min`;
	return { expired: false, label: m.orders_deadline_left({ time }) };
}
