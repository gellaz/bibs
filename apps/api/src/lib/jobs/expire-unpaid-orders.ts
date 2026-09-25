import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { order } from "@/db/schemas/order";
import { refundStockAndPoints } from "@/lib/order-helpers";

/**
 * Annulla un ordine pay_* mai pagato e restituisce lo stock. CAS sullo stato:
 * se nel frattempo il pagamento l'ha confermato (o un altro sweep l'ha già
 * annullato), non fa nulla.
 */
export async function cancelUnpaidOrder(orderId: string): Promise<boolean> {
	return db.transaction(async (tx) => {
		const [claimed] = await tx
			.update(order)
			.set({ status: "cancelled" })
			.where(
				and(
					eq(order.id, orderId),
					eq(order.status, "pending"),
					inArray(order.type, ["pay_pickup", "pay_deliver"]),
				),
			)
			.returning();
		if (!claimed) return false;
		const items = await tx.query.orderItem.findMany({
			where: (i, { eq }) => eq(i.orderId, orderId),
		});
		await refundStockAndPoints(tx, { ...claimed, items });
		return true;
	});
}
