import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { checkout } from "@/db/schemas/checkout";
import { order } from "@/db/schemas/order";
import { cancelUnpaidOrder } from "@/lib/jobs/expire-unpaid-orders";
import { logger } from "@/lib/logger";
import { settleCheckoutPayment } from "@/modules/billing/services/order-payments";

/**
 * Pagamento dei PR2 di un checkout. Un rifiuto della carta NON annulla gli
 * ordini: il PI torna in requires_payment_method e il cliente può riprovare
 * finché non scade la finestra di pagamento (cron expireUnpaidOrders).
 */
export async function handlePaymentIntentEvent(
	event: Stripe.Event,
): Promise<void> {
	const pi = event.data.object as Stripe.PaymentIntent;
	switch (event.type) {
		case "payment_intent.succeeded":
			return settleCheckoutPayment(pi);
		case "payment_intent.canceled": {
			const co = await db.query.checkout.findFirst({
				where: eq(checkout.stripePaymentIntentId, pi.id),
				columns: { id: true },
			});
			if (!co) return;
			const orders = await db
				.select({ id: order.id })
				.from(order)
				.where(eq(order.checkoutId, co.id));
			for (const o of orders) await cancelUnpaidOrder(o.id);
			return;
		}
		default:
			logger.info(
				{ eventId: event.id, type: event.type, paymentIntentId: pi.id },
				"PaymentIntent event: nessuna azione",
			);
	}
}
