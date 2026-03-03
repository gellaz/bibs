import { eq, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { customerProfile } from "@/db/schemas/customer";
import { pointTransaction } from "@/db/schemas/points";
import { storeProduct } from "@/db/schemas/product";
import { config } from "@/lib/config";

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

/**
 * Awards loyalty points for a completed order.
 * Calculates points from totalCents, updates the customer balance,
 * and inserts a point_transaction record.
 * Must be called within an existing transaction.
 * Returns the number of points awarded.
 */
export async function awardPoints(
	tx: PgTransaction<any, any, any>,
	params: {
		customerProfileId: string;
		orderId: string;
		totalCents: number;
		description?: string;
	},
): Promise<number> {
	const pointsEarned = Math.floor(
		(params.totalCents / 100) * config.pointsPerEuro,
	);

	if (pointsEarned > 0) {
		await tx
			.update(customerProfile)
			.set({
				points: sql`${customerProfile.points} + ${pointsEarned}`,
			})
			.where(eq(customerProfile.id, params.customerProfileId));

		await tx.insert(pointTransaction).values({
			customerProfileId: params.customerProfileId,
			orderId: params.orderId,
			amount: pointsEarned,
			type: "earned",
			description:
				params.description ??
				`Earned ${pointsEarned} points from completed order`,
		});
	}

	return pointsEarned;
}
