import { eq, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { customerProfile } from "@/db/schemas/customer";
import { pointTransaction } from "@/db/schemas/points";
import { storeProduct } from "@/db/schemas/product";

/**
 * Refunds stock and loyalty points for a cancelled/expired order.
 * Must be called within an existing transaction.
 */
export async function refundStockAndPoints(
	tx: PgTransaction<any, any, any>,
	order: {
		id: string;
		customerProfileId: string;
		pointsSpent: number;
		items: { storeProductId: string; quantity: number }[];
	},
) {
	// Restock items
	for (const item of order.items) {
		await tx
			.update(storeProduct)
			.set({ stock: sql`${storeProduct.stock} + ${item.quantity}` })
			.where(eq(storeProduct.id, item.storeProductId));
	}

	// Refund points spent
	if (order.pointsSpent > 0) {
		await tx
			.update(customerProfile)
			.set({
				points: sql`${customerProfile.points} + ${order.pointsSpent}`,
			})
			.where(eq(customerProfile.id, order.customerProfileId));

		await tx.insert(pointTransaction).values({
			customerProfileId: order.customerProfileId,
			orderId: order.id,
			amount: order.pointsSpent,
			type: "refunded",
			description: `Refunded ${order.pointsSpent} points`,
		});
	}
}
