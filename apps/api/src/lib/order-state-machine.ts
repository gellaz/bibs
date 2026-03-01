import type { OrderStatus, OrderType } from "@/db/schemas/order";
import { ServiceError } from "@/lib/errors";

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
			`Invalid transition: ${fromStatus} → ${toStatus} for order type '${orderType}'`,
		);
	}
	return true;
}
