import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { checkout } from "@/db/schemas/checkout";
import { order } from "@/db/schemas/order";
import { logger } from "@/lib/logger";
import { refundStockAndPoints } from "@/lib/order-helpers";
import { stripe } from "@/lib/stripe";
import { settleCheckoutPayment } from "@/modules/billing/services/order-payments";

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

/**
 * Sweep ogni minuto dei pay_* ancora pending oltre payment_expires_at. Per ogni
 * PaymentIntent rilegge lo stato PRIMA di annullare: un pagamento riuscito
 * all'ultimo secondo si conferma (settleCheckoutPayment), uno in elaborazione
 * aspetta il prossimo giro, altrimenti si annulla il PI e poi gli ordini. Un
 * errore su un checkout non ferma gli altri.
 */
export async function expireUnpaidOrders(
	now: Date = new Date(),
): Promise<number> {
	const rows = await db
		.select({ id: order.id, paymentIntentId: checkout.stripePaymentIntentId })
		.from(order)
		.leftJoin(checkout, eq(checkout.id, order.checkoutId))
		.where(
			and(
				eq(order.status, "pending"),
				isNotNull(order.paymentExpiresAt),
				lt(order.paymentExpiresAt, now),
			),
		);
	if (rows.length === 0) return 0;

	const byIntent = new Map<string | null, string[]>();
	for (const r of rows) {
		const key = r.paymentIntentId ?? null;
		byIntent.set(key, [...(byIntent.get(key) ?? []), r.id]);
	}

	let count = 0;
	for (const [paymentIntentId, orderIds] of byIntent) {
		try {
			if (paymentIntentId) {
				const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
				if (pi.status === "succeeded") {
					await settleCheckoutPayment(pi);
					continue;
				}
				if (pi.status === "processing") continue;
				if (pi.status !== "canceled")
					await stripe.paymentIntents.cancel(paymentIntentId);
			}
			for (const id of orderIds) if (await cancelUnpaidOrder(id)) count++;
		} catch (err) {
			logger.error(
				{ err, paymentIntentId, orderIds },
				"Scadenza pagamento: checkout saltato, si riprova al prossimo giro",
			);
		}
	}
	return count;
}
