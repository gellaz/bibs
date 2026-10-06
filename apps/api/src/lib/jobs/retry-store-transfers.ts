import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { checkout } from "@/db/schemas/checkout";
import { order } from "@/db/schemas/order";
import { logger } from "@/lib/logger";
import { stripe } from "@/lib/stripe";
import { settleCheckoutPayment } from "@/modules/billing/services/order-payments";

/**
 * Rete dietro al webhook: un PR2 pagato con un trasferimento al negozio
 * ancora da fare (di solito la quota punti, rifiutata da Stripe perché il
 * saldo bibs non bastava). Rilegge il PaymentIntent e ripassa da
 * settleCheckoutPayment, che fa solo ciò che manca. Restituisce i checkout
 * completati; un errore su un checkout non ferma gli altri.
 */
export async function retryStoreTransfers(): Promise<number> {
	// Gemella SQL di storePayoutSplit: fromCharge > 0 ⇔ total > 0 e lordo
	// oltre la commissione; fromBalance > 0 ⇔ punti oltre la commissione.
	const rows = await db
		.selectDistinct({ paymentIntentId: checkout.stripePaymentIntentId })
		.from(order)
		.innerJoin(checkout, eq(checkout.id, order.checkoutId))
		.where(
			and(
				eq(order.type, "pay_pickup"),
				inArray(order.status, ["confirmed", "ready_for_pickup", "completed"]),
				isNotNull(checkout.stripePaymentIntentId),
				sql`(
					(${order.stripeTransferId} IS NULL AND ${order.total} > 0
						AND ${order.total} + ${order.pointsDiscount} > ${order.platformFee})
					OR (${order.stripePointsTransferId} IS NULL
						AND ${order.pointsDiscount} > ${order.platformFee})
				)`,
			),
		);

	let count = 0;
	for (const { paymentIntentId } of rows) {
		if (!paymentIntentId) continue;
		try {
			const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
			if (pi.status !== "succeeded") continue;
			await settleCheckoutPayment(pi);
			count++;
		} catch (err) {
			logger.error(
				{ err, paymentIntentId },
				"Trasferimenti al negozio ancora in sospeso: si riprova al prossimo giro",
			);
		}
	}
	return count;
}
