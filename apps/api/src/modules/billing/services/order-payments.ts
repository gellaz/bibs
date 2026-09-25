import { and, eq, inArray, isNull } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "@/db";
import { checkout } from "@/db/schemas/checkout";
import { order } from "@/db/schemas/order";
import { paymentMethod } from "@/db/schemas/payment-method";
import { store } from "@/db/schemas/store";
import { ServiceError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { toCents } from "@/lib/money";
import { stripe } from "@/lib/stripe";

/** Stati in cui il cliente può ancora (ri)tentare il pagamento. */
const PAYABLE: readonly Stripe.PaymentIntent.Status[] = [
	"requires_payment_method",
	"requires_confirmation",
	"requires_action",
];

/**
 * Un PaymentIntent sulla piattaforma per tutti gli ordini pay_pickup del
 * checkout (separate charges and transfers): i soldi arrivano a bibs, i
 * trasferimenti ai negozi partono a incasso avvenuto (settleCheckoutPayment).
 * Solo carte (Apple/Google Pay inclusi): i metodi a notifica differita non
 * stanno in una finestra di 30 minuti. Chiamato dentro la tx del checkout: se
 * Stripe fallisce, nessun ordine nasce.
 */
export async function createCheckoutPaymentIntent(params: {
	checkoutId: string;
	customerProfileId: string;
	amountCents: number;
}): Promise<string> {
	try {
		const pi = await stripe.paymentIntents.create(
			{
				amount: params.amountCents,
				currency: "eur",
				payment_method_types: ["card"],
				transfer_group: params.checkoutId,
				metadata: {
					checkoutId: params.checkoutId,
					customerProfileId: params.customerProfileId,
				},
			},
			{ idempotencyKey: `checkout-pi:${params.checkoutId}` },
		);
		return pi.id;
	} catch (err) {
		if (err instanceof Stripe.errors.StripeError) {
			logger.error(
				{ err, checkoutId: params.checkoutId },
				"stripe.paymentIntents.create failed",
			);
			throw new ServiceError(
				502,
				"Il pagamento online non è disponibile in questo momento. Riprova tra qualche minuto.",
			);
		}
		throw err;
	}
}

/**
 * Il client secret per il Payment Element, riletto da Stripe (non si salva):
 * null se il PI non è più pagabile (riuscito, in elaborazione o annullato).
 */
export async function payableClientSecret(
	paymentIntentId: string,
): Promise<string | null> {
	const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
	return PAYABLE.includes(pi.status) ? pi.client_secret : null;
}

const PAID_STATUSES = ["confirmed", "ready_for_pickup", "completed"] as const;

/**
 * payment_intent.succeeded (o il cron che trova il PI riuscito). Rieseguibile:
 * 1. CAS pending → confirmed di tutti i PR2 del checkout;
 * 2. i PR2 già annullati (scaduti mentre il cliente pagava) si rimborsano;
 * 3. un trasferimento per ogni PR2 pagato senza stripe_transfer_id, con key per
 *    ordine: un evento riconsegnato non trasferisce due volte. Se un
 *    trasferimento fallisce gli altri proseguono, poi si lancia: il webhook
 *    risponde 5xx e Stripe riconsegna, e si ritenta solo ciò che manca.
 */
export async function settleCheckoutPayment(
	pi: Pick<Stripe.PaymentIntent, "id" | "latest_charge">,
): Promise<void> {
	const co = await db.query.checkout.findFirst({
		where: eq(checkout.stripePaymentIntentId, pi.id),
		columns: { id: true },
	});
	if (!co) {
		logger.warn(
			{ paymentIntentId: pi.id },
			"PaymentIntent senza checkout, ignorato",
		);
		return;
	}
	const chargeId =
		typeof pi.latest_charge === "string"
			? pi.latest_charge
			: pi.latest_charge?.id;
	if (!chargeId)
		throw new Error(`PaymentIntent ${pi.id} riuscito senza charge`);

	const ofCheckout = and(
		eq(order.checkoutId, co.id),
		eq(order.type, "pay_pickup"),
	);

	await db
		.update(order)
		.set({ status: "confirmed" })
		.where(and(ofCheckout, eq(order.status, "pending")));

	const late = await db
		.select({ id: order.id, total: order.total })
		.from(order)
		.where(
			and(
				ofCheckout,
				eq(order.status, "cancelled"),
				isNull(order.stripeRefundId),
			),
		);
	for (const o of late) {
		const refund = await stripe.refunds.create(
			{
				payment_intent: pi.id,
				amount: toCents(o.total),
				metadata: { orderId: o.id, reason: "paid_after_expiry" },
			},
			{ idempotencyKey: `refund:${o.id}` },
		);
		await db
			.update(order)
			.set({ stripeRefundId: refund.id })
			.where(and(eq(order.id, o.id), isNull(order.stripeRefundId)));
		logger.warn(
			{ orderId: o.id, refundId: refund.id },
			"Pagato dopo la scadenza: rimborsato",
		);
	}

	const payable = await db
		.select({
			id: order.id,
			total: order.total,
			platformFee: order.platformFee,
			destination: paymentMethod.stripeAccountId,
		})
		.from(order)
		.innerJoin(store, eq(store.id, order.storeId))
		.leftJoin(
			paymentMethod,
			and(
				eq(paymentMethod.sellerProfileId, store.sellerProfileId),
				eq(paymentMethod.isDefault, true),
			),
		)
		.where(
			and(
				ofCheckout,
				inArray(order.status, [...PAID_STATUSES]),
				isNull(order.stripeTransferId),
			),
		);

	const failed: string[] = [];
	for (const o of payable) {
		const amount = toCents(o.total) - toCents(o.platformFee);
		if (amount <= 0) continue;
		if (!o.destination) {
			logger.error(
				{ orderId: o.id },
				"Trasferimento impossibile: negozio senza conto Connect",
			);
			failed.push(o.id);
			continue;
		}
		try {
			const transfer = await stripe.transfers.create(
				{
					amount,
					currency: "eur",
					destination: o.destination,
					source_transaction: chargeId,
					transfer_group: co.id,
					metadata: { orderId: o.id, checkoutId: co.id },
				},
				{ idempotencyKey: `transfer:${o.id}` },
			);
			await db
				.update(order)
				.set({ stripeTransferId: transfer.id })
				.where(and(eq(order.id, o.id), isNull(order.stripeTransferId)));
		} catch (err) {
			logger.error({ err, orderId: o.id }, "stripe.transfers.create failed");
			failed.push(o.id);
		}
	}
	if (failed.length > 0)
		throw new Error(
			`Trasferimenti non riusciti per gli ordini ${failed.join(", ")}`,
		);
}
