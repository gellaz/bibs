import { eq, isNull } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { stripeEvent } from "@/db/schemas/stripe-event";
import { env } from "@/lib/env";
import { ServiceError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { stripe } from "@/lib/stripe";
import {
	handleConnectAccountEvent,
	handleConnectAccountNotification,
} from "./handlers/account-updated";
import { handleCheckoutCompleted } from "./handlers/checkout-completed";
import { handleInvoiceFailed } from "./handlers/invoice-failed";
import { handleInvoicePaid } from "./handlers/invoice-paid";
import { handlePaymentIntentEvent } from "./handlers/payment-intent";
import { handleSubscriptionDeleted } from "./handlers/subscription-deleted";
import { handleSubscriptionUpdated } from "./handlers/subscription-updated";

interface HandleWebhookParams {
	payload: string;
	signature: string;
	/**
	 * platform: eventi del nostro conto (billing). connect: eventi dei conti
	 * collegati, che in produzione arrivano da una event destination separata
	 * con un segreto suo; `stripe listen --forward-connect-to` usa invece lo
	 * stesso segreto di --forward-to, da qui il fallback. thin: thin events v2
	 * (payload `v2.core.event`, solo id e oggetto collegato), anche loro da una
	 * destination dedicata; in locale arrivano da un secondo `stripe listen`.
	 */
	scope?: "platform" | "connect" | "thin";
}

export async function handleStripeWebhook(
	params: HandleWebhookParams,
): Promise<void> {
	const { payload, signature, scope = "platform" } = params;
	const secret =
		scope === "connect"
			? (env.STRIPE_CONNECT_WEBHOOK_SECRET ?? env.STRIPE_WEBHOOK_SECRET)
			: scope === "thin"
				? (env.STRIPE_THIN_WEBHOOK_SECRET ?? env.STRIPE_WEBHOOK_SECRET)
				: env.STRIPE_WEBHOOK_SECRET;
	if (!secret) {
		throw new ServiceError(500, "Stripe webhook secret not configured");
	}

	// Use the async variants: Bun's runtime only exposes Web SubtleCrypto, which
	// the Stripe SDK can't use synchronously (constructEvent throws
	// CryptoProviderOnlySupportsAsyncError on Bun/Edge/Workers).
	if (scope === "thin") {
		let notification: Stripe.V2.Core.EventNotification;
		try {
			notification = await stripe.parseEventNotificationAsync(
				payload,
				signature,
				secret,
			);
		} catch (err) {
			logger.warn({ err }, "Stripe webhook signature verification failed");
			throw new ServiceError(400, "Invalid Stripe signature");
		}
		return processOnce(notification.id, notification.type, () =>
			dispatchThin(notification),
		);
	}

	let event: Stripe.Event;
	try {
		event = (await stripe.webhooks.constructEventAsync(
			payload,
			signature,
			secret,
		)) as Stripe.Event;
	} catch (err) {
		logger.warn({ err }, "Stripe webhook signature verification failed");
		throw new ServiceError(400, "Invalid Stripe signature");
	}
	return processOnce(event.id, event.type, () => dispatch(event, scope));
}

/**
 * Runs the handler at most once per Stripe event id (snapshot and thin events
 * share the ledger: ids are unique across both).
 */
async function processOnce(
	eventId: string,
	eventType: string,
	handle: () => Promise<void>,
): Promise<void> {
	// Claim the event for processing. The dedup ledger gates on processed_at, NOT
	// on row existence: a brand-new event inserts a row, an event left unprocessed
	// by a previously failed delivery is re-claimed (so Stripe redeliveries retry
	// it), and an already-processed event matches the WHERE on no row and is
	// skipped. This is what keeps a transient handler failure from permanently
	// stranding the event.
	const claimed = await db
		.insert(stripeEvent)
		.values({ eventId, eventType })
		.onConflictDoUpdate({
			target: stripeEvent.eventId,
			set: { eventType },
			setWhere: isNull(stripeEvent.processedAt),
		})
		.returning({ eventId: stripeEvent.eventId });

	if (claimed.length === 0) {
		logger.info(
			{ eventId, type: eventType },
			"Event already processed, skipping",
		);
		return;
	}

	try {
		await handle();
		await db
			.update(stripeEvent)
			.set({ processedAt: new Date() })
			.where(eq(stripeEvent.eventId, eventId));
	} catch (err) {
		// Leave processed_at NULL so the claim above re-acquires the event on the
		// next delivery. The route returns a 5xx on this throw, which makes Stripe
		// redeliver (with backoff) instead of considering the event done.
		logger.error({ err, eventId, type: eventType }, "Webhook handler failed");
		throw err;
	}
}

/**
 * Thin events dei conti Accounts v2. L'attivazione di `stripe_transfers`
 * arriva solo come `capability_status_updated`: gli eventi v1
 * account.updated/capability.updated possono precederla di qualche secondo e
 * poi tacere, lasciando charges_enabled a false (issue #250).
 */
async function dispatchThin(
	notification: Stripe.V2.Core.EventNotification,
): Promise<void> {
	switch (notification.type) {
		case "v2.core.account[configuration.recipient].capability_status_updated":
		case "v2.core.account[requirements].updated":
			return handleConnectAccountNotification(notification);
		default:
			logger.info(
				{ eventId: notification.id, type: notification.type },
				"Stripe thin event received but not handled",
			);
	}
}

/**
 * connect scope handles account.updated and capability.updated: everything
 * else a connected account can emit (charges, payment intents, ...) is out of
 * scope for now and just logged, not routed into the platform-scope switch
 * below.
 */
async function dispatch(
	event: Stripe.Event,
	scope: "platform" | "connect",
): Promise<void> {
	if (scope === "connect") {
		if (event.type === "account.updated" || event.type === "capability.updated")
			return handleConnectAccountEvent(event);
		logger.info(
			{ eventId: event.id, type: event.type },
			"Stripe Connect event received but not handled",
		);
		return;
	}

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
		case "payment_intent.succeeded":
		case "payment_intent.payment_failed":
		case "payment_intent.canceled":
			return handlePaymentIntentEvent(event);
		default:
			// account.updated on the platform route is unexpected (it belongs to
			// the connect scope) and falls through here too: log + ignore.
			logger.info(
				{ eventId: event.id, type: event.type },
				"Stripe event received but not handled",
			);
	}
}
