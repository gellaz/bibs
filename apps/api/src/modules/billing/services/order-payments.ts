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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Rimborso di un PR2 pagato, dentro la tx di annullamento (dopo il CAS di
 * stato): se il rimborso fallisce la tx si annulla e l'ordine resta com'era.
 * Lo storno del trasferimento è best-effort: se il negozio ha già incassato e
 * non ha saldo, Stripe lo rifiuta, ma il cliente è già rimborsato; resta nel
 * log per il recupero manuale.
 */
export async function refundOrderPayment(
	tx: Tx,
	o: {
		id: string;
		total: string;
		platformFee: string;
		checkoutId: string | null;
		stripeTransferId: string | null;
	},
): Promise<void> {
	// Stripe rifiuta un rimborso di importo 0 (nessun pagamento da restituire):
	// un PR2 a saldo zero (es. interamente coperto da punti) si annulla senza
	// toccare Stripe.
	if (toCents(o.total) === 0) return;

	const co = o.checkoutId
		? await tx.query.checkout.findFirst({
				where: eq(checkout.id, o.checkoutId),
				columns: { stripePaymentIntentId: true },
			})
		: undefined;
	if (!co?.stripePaymentIntentId)
		throw new ServiceError(409, "Pagamento dell'ordine non trovato");

	let refundId: string;
	try {
		const refund = await stripe.refunds.create(
			{
				payment_intent: co.stripePaymentIntentId,
				amount: toCents(o.total),
				metadata: { orderId: o.id },
			},
			{ idempotencyKey: `refund:${o.id}` },
		);
		refundId = refund.id;
	} catch (err) {
		if (err instanceof Stripe.errors.StripeError) {
			logger.error({ err, orderId: o.id }, "stripe.refunds.create failed");
			throw new ServiceError(
				502,
				"Rimborso non riuscito. Riprova tra qualche minuto.",
			);
		}
		throw err;
	}
	await tx
		.update(order)
		.set({ stripeRefundId: refundId })
		.where(eq(order.id, o.id));

	if (o.stripeTransferId) {
		try {
			await stripe.transfers.createReversal(
				o.stripeTransferId,
				{
					amount: toCents(o.total) - toCents(o.platformFee),
					metadata: { orderId: o.id },
				},
				{ idempotencyKey: `reversal:${o.id}` },
			);
		} catch (err) {
			logger.error(
				{ err, orderId: o.id, transferId: o.stripeTransferId },
				"Storno del trasferimento non riuscito: recupero manuale",
			);
		}
	}
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

	// Un ordine già trasferito (payout al negozio già partito su una consegna
	// precedente dello stesso evento) NON va rimborsato: il rimborso qui è del
	// cliente sulla piattaforma, il trasferimento è già uscito verso il
	// negozio — rimborsarlo comunque sarebbe un doppio esborso. Quel caso
	// appartiene al flusso di cancellazione post-trasferimento, non a questo.
	const late = await db
		.select({ id: order.id, total: order.total })
		.from(order)
		.where(
			and(
				ofCheckout,
				eq(order.status, "cancelled"),
				isNull(order.stripeRefundId),
				isNull(order.stripeTransferId),
			),
		);
	const refundFailed: string[] = [];
	for (const o of late) {
		try {
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
		} catch (err) {
			logger.error({ err, orderId: o.id }, "stripe.refunds.create failed");
			refundFailed.push(o.id);
		}
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

	const transferFailed: string[] = [];
	for (const o of payable) {
		const amount = toCents(o.total) - toCents(o.platformFee);
		if (amount <= 0) continue;
		const destination = o.destination;
		if (!destination) {
			logger.error(
				{ orderId: o.id },
				"Trasferimento impossibile: negozio senza conto Connect",
			);
			transferFailed.push(o.id);
			continue;
		}
		try {
			await db.transaction(async (tx) => {
				// Rilettura lockata: `payable` sopra è una foto di prima. Tra quella
				// select e qui un cancel concorrente (refundOrderPayment) può aver già
				// annullato l'ordine. Il lock fa attendere il CAS di annullamento in
				// corso: o il cancel vince e qui si salta (ordine non più pagato), o
				// questo trasferimento scrive stripeTransferId per primo e il cancel,
				// che legge dopo, lo trova e lo storna.
				const [row] = await tx
					.select({
						status: order.status,
						stripeTransferId: order.stripeTransferId,
					})
					.from(order)
					.where(eq(order.id, o.id))
					.for("update");
				if (
					!row ||
					!(PAID_STATUSES as readonly string[]).includes(row.status) ||
					row.stripeTransferId
				)
					return;

				const transfer = await stripe.transfers.create(
					{
						amount,
						currency: "eur",
						destination,
						source_transaction: chargeId,
						transfer_group: co.id,
						metadata: { orderId: o.id, checkoutId: co.id },
					},
					{ idempotencyKey: `transfer:${o.id}` },
				);
				await tx
					.update(order)
					.set({ stripeTransferId: transfer.id })
					.where(eq(order.id, o.id));
			});
		} catch (err) {
			logger.error({ err, orderId: o.id }, "stripe.transfers.create failed");
			transferFailed.push(o.id);
		}
	}

	// Un solo errore per tutto ciò che è mancato in questa consegna (rimborsi e
	// trasferimenti): il webhook risponde 5xx una volta sola e la riconsegna di
	// Stripe ritenta solo ciò che manca ancora (le query sopra sono già CAS).
	if (refundFailed.length > 0 || transferFailed.length > 0) {
		const parts: string[] = [];
		if (refundFailed.length > 0)
			parts.push(
				`rimborsi non riusciti per gli ordini ${refundFailed.join(", ")}`,
			);
		if (transferFailed.length > 0)
			parts.push(
				`trasferimenti non riusciti per gli ordini ${transferFailed.join(", ")}`,
			);
		throw new Error(parts.join("; "));
	}
}
