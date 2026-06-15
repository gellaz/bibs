import { eq, isNull } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { stripeEvent } from "@/db/schemas/stripe-event";
import { env } from "@/lib/env";
import { ServiceError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { stripe } from "@/lib/stripe";
import { handleCheckoutCompleted } from "./handlers/checkout-completed";
import { handleInvoiceFailed } from "./handlers/invoice-failed";
import { handleInvoicePaid } from "./handlers/invoice-paid";
import { handleSubscriptionDeleted } from "./handlers/subscription-deleted";
import { handleSubscriptionUpdated } from "./handlers/subscription-updated";

interface HandleWebhookParams {
	payload: string;
	signature: string;
}

export async function handleStripeWebhook(
	params: HandleWebhookParams,
): Promise<void> {
	const { payload, signature } = params;

	if (!env.STRIPE_WEBHOOK_SECRET) {
		throw new ServiceError(500, "STRIPE_WEBHOOK_SECRET not configured");
	}

	// Use the async variant: Bun's runtime only exposes Web SubtleCrypto, which
	// the Stripe SDK can't use synchronously (constructEvent throws
	// CryptoProviderOnlySupportsAsyncError on Bun/Edge/Workers).
	let event: Stripe.Event;
	try {
		event = (await stripe.webhooks.constructEventAsync(
			payload,
			signature,
			env.STRIPE_WEBHOOK_SECRET,
		)) as Stripe.Event;
	} catch (err) {
		logger.warn({ err }, "Stripe webhook signature verification failed");
		throw new ServiceError(400, "Invalid Stripe signature");
	}

	// Claim the event for processing. The dedup ledger gates on processed_at, NOT
	// on row existence: a brand-new event inserts a row, an event left unprocessed
	// by a previously failed delivery is re-claimed (so Stripe redeliveries retry
	// it), and an already-processed event matches the WHERE on no row and is
	// skipped. This is what keeps a transient handler failure from permanently
	// stranding the event.
	const claimed = await db
		.insert(stripeEvent)
		.values({ eventId: event.id, eventType: event.type })
		.onConflictDoUpdate({
			target: stripeEvent.eventId,
			set: { eventType: event.type },
			setWhere: isNull(stripeEvent.processedAt),
		})
		.returning({ eventId: stripeEvent.eventId });

	if (claimed.length === 0) {
		logger.info(
			{ eventId: event.id, type: event.type },
			"Event already processed, skipping",
		);
		return;
	}

	try {
		await dispatch(event);
		await db
			.update(stripeEvent)
			.set({ processedAt: new Date() })
			.where(eq(stripeEvent.eventId, event.id));
	} catch (err) {
		// Leave processed_at NULL so the claim above re-acquires the event on the
		// next delivery. The route returns a 5xx on this throw, which makes Stripe
		// redeliver (with backoff) instead of considering the event done.
		logger.error(
			{ err, eventId: event.id, type: event.type },
			"Webhook handler failed",
		);
		throw err;
	}
}

async function dispatch(event: Stripe.Event): Promise<void> {
	switch (event.type) {
		case "checkout.session.completed":
			return handleCheckoutCompleted(event);
		case "customer.subscription.updated":
			return handleSubscriptionUpdated(event);
		case "customer.subscription.deleted":
			return handleSubscriptionDeleted(event);
		case "invoice.payment_succeeded":
			return handleInvoicePaid(event);
		case "invoice.payment_failed":
			return handleInvoiceFailed(event);
		default:
			logger.info(
				{ eventId: event.id, type: event.type },
				"Stripe event received but not handled",
			);
	}
}
