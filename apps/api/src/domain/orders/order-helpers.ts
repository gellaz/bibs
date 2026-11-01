import { and, eq, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { db } from "@/db";
import { customerProfile } from "@/db/schemas/customer";
import { order } from "@/db/schemas/order";
import { pointTransaction } from "@/db/schemas/points";
import { storeProduct } from "@/db/schemas/product";
import { refundOrderPayment } from "@/domain/billing/order-payments";
import { assertCancellable } from "@/domain/orders/order-state-machine";
import { config } from "@/lib/config";
import { ServiceError } from "@/lib/errors";

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
		items: { storeProductId: string | null; quantity: number }[];
	},
) {
	// Restock items — skip orphans whose store_product was hard-deleted (FK now null)
	for (const item of order.items) {
		if (!item.storeProductId) continue;
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
 * Annullamento di un ordine già letto (con le righe) e autorizzato dal
 * chiamante, cliente o negozio: stesse regole della macchina a stati (da
 * `pending` o `confirmed`; un pay_* `pending` non si annulla, 409). CAS sullo
 * stato prima del rimborso, così due annullamenti concorrenti non rimborsano
 * due volte. Da `confirmed`, un PR2 rimborsa il pagamento e storna il
 * trasferimento nella stessa tx; poi tornano stock e punti.
 */
export async function cancelLoadedOrder(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	existing: typeof order.$inferSelect & {
		items: { storeProductId: string | null; quantity: number }[];
	},
) {
	assertCancellable(existing);

	const [updated] = await tx
		.update(order)
		.set({ status: "cancelled" })
		.where(and(eq(order.id, existing.id), eq(order.status, existing.status)))
		.returning();
	if (!updated) throw new ServiceError(409, "L'ordine è già stato aggiornato");

	// `updated` (la riga appena letta dal CAS), non `existing` (letta prima):
	// un trasferimento può essere partito tra le due letture (settleCheckoutPayment
	// concorrente), e senza lo storno rimborsiamo il cliente senza recuperare i
	// soldi dal negozio.
	if (existing.type === "pay_pickup" && existing.status === "confirmed")
		await refundOrderPayment(tx, updated);

	await refundStockAndPoints(tx, existing);

	return updated;
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
