import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { order } from "@/db/schemas/order";
import {
	expireSingleReservation,
	reservationGraceCutoff,
} from "@/domain/orders/reservation-expiry";

/**
 * Bulk safety-net: expires all reserve_pickup orders whose reservation
 * window has passed. Called by the cron job to catch any orders that
 * were missed by the per-order setTimeout timers (e.g. after a restart).
 *
 * Returns the number of orders expired.
 */
export async function expireReservations(): Promise<number> {
	const cutoff = reservationGraceCutoff();

	const expiredOrders = await db.query.order.findMany({
		where: and(
			eq(order.type, "reserve_pickup"),
			inArray(order.status, ["confirmed", "ready_for_pickup"]),
			lt(order.reservationExpiresAt, cutoff),
		),
		columns: { id: true },
	});

	if (expiredOrders.length === 0) return 0;

	let count = 0;
	for (const o of expiredOrders) {
		const expired = await expireSingleReservation(o.id);
		if (expired) count++;
	}

	return count;
}
