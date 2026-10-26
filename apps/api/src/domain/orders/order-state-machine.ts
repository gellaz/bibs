import type { OrderStatus, OrderType } from "@/db/schemas/order";
import { ServiceError } from "@/lib/errors";
import { PAY_TYPES } from "./order-types";

/**
 * Defines valid (status → target_status) transitions per order type.
 * Key: current status → value: map of target status → allowed order types.
 */
const transitions: Partial<
	Record<OrderStatus, Partial<Record<OrderStatus, readonly OrderType[]>>>
> = {
	pending: {
		confirmed: ["pay_pickup", "pay_deliver", "reserve_pickup"],
		cancelled: ["pay_pickup", "pay_deliver", "reserve_pickup"],
	},
	confirmed: {
		ready_for_pickup: ["pay_pickup", "pay_deliver", "reserve_pickup"],
		completed: ["pay_pickup", "reserve_pickup"],
		cancelled: ["pay_pickup", "pay_deliver", "reserve_pickup"],
	},
	ready_for_pickup: {
		shipped: ["pay_deliver"],
		completed: ["pay_pickup", "reserve_pickup"],
	},
	shipped: {
		delivered: ["pay_deliver"],
		completed: ["pay_deliver"],
	},
};

// Arriva così nel toast di seller e customer: in italiano, con lo stato
// attuale (spesso è cambiato nel frattempo).
const STATUS_LABELS: Record<OrderStatus, string> = {
	pending: "in attesa",
	confirmed: "confermato",
	ready_for_pickup: "pronto per il ritiro",
	shipped: "spedito",
	delivered: "consegnato",
	completed: "completato",
	cancelled: "annullato",
	expired: "scaduto",
};

/**
 * Checks if a transition from `fromStatus` to `toStatus` is valid for the given order type.
 */
function canTransition(
	fromStatus: OrderStatus,
	toStatus: OrderStatus,
	orderType: OrderType,
): boolean {
	const targets = transitions[fromStatus];
	if (!targets) return false;
	const allowedTypes = targets[toStatus];
	if (!allowedTypes) return false;
	return allowedTypes.includes(orderType);
}

/**
 * Asserts a transition is valid, throwing a descriptive message if not.
 * Returns `true` on success.
 */
export function assertTransition(
	fromStatus: OrderStatus,
	toStatus: OrderStatus,
	orderType: OrderType,
): true {
	if (!canTransition(fromStatus, toStatus, orderType)) {
		throw new ServiceError(
			400,
			`Un ordine «${STATUS_LABELS[fromStatus]}» non può diventare «${STATUS_LABELS[toStatus]}»`,
		);
	}
	return true;
}

/**
 * Un pay_* in attesa di pagamento non si annulla a mano: il PaymentIntent copre
 * tutti i negozi del checkout, e l'ordine si annulla da solo allo scadere della
 * finestra di pagamento. Poi valgono le transizioni della macchina a stati.
 */
export function assertCancellable(o: { status: string; type: string }) {
	if (o.status === "pending" && PAY_TYPES.includes(o.type as OrderType))
		throw new ServiceError(
			409,
			"L'ordine è in attesa di pagamento: se non viene pagato si annulla da solo entro 30 minuti",
		);
	assertTransition(o.status as OrderStatus, "cancelled", o.type as OrderType);
}
