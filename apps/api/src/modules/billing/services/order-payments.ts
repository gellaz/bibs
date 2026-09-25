import Stripe from "stripe";
import { ServiceError } from "@/lib/errors";
import { logger } from "@/lib/logger";
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
