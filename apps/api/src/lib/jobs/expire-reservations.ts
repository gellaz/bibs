import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { order } from "@/db/schemas/order";
import { refundStockAndPoints } from "@/lib/order-helpers";

/**
 * Expires a single reserve_pickup order by ID.
 * Sets status to "expired" and refunds any points spent.
 *
 * Returns true if the order was expired, false if it was no longer eligible.
 */
export async function expireSingleReservation(
	orderId: string,
): Promise<boolean> {
	return db.transaction(async (tx) => {
		const existing = await tx.query.order.findFirst({
			where: and(
				eq(order.id, orderId),
				eq(order.type, "reserve_pickup"),
				inArray(order.status, ["confirmed", "ready_for_pickup"]),
			),
			columns: { id: true, customerProfileId: true, pointsSpent: true },
			with: { items: true },
		});

		if (!existing) return false;

		await tx
			.update(order)
			.set({ status: "expired" })
			.where(eq(order.id, existing.id));

		await refundStockAndPoints(tx, existing);

		return true;
	});
}

/**
 * Bulk safety-net: expires all reserve_pickup orders whose reservation
 * window has passed. Called by the cron job to catch any orders that
 * were missed by the per-order setTimeout timers (e.g. after a restart).
 *
 * Returns the number of orders expired.
 */
export async function expireReservations(): Promise<number> {
	const now = new Date();

	const expiredOrders = await db.query.order.findMany({
		where: and(
			eq(order.type, "reserve_pickup"),
			inArray(order.status, ["confirmed", "ready_for_pickup"]),
			lt(order.reservationExpiresAt, now),
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
