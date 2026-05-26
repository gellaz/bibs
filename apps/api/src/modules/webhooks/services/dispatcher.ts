import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { stripeEvent } from "@/db/schemas/stripe-event";
import { env } from "@/lib/env";
import { ServiceError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { stripe } from "@/lib/stripe";
import { handleCheckoutCompleted } from "./handlers/checkout-completed";
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

	let event: Stripe.Event;
	try {
		event = stripe.webhooks.constructEvent(
			payload,
			signature,
			env.STRIPE_WEBHOOK_SECRET,
		) as Stripe.Event;
	} catch (err) {
		logger.warn({ err }, "Stripe webhook signature verification failed");
		throw new ServiceError(400, "Invalid Stripe signature");
	}

	const insertedRows = await db
		.insert(stripeEvent)
		.values({ eventId: event.id, eventType: event.type })
		.onConflictDoNothing({ target: stripeEvent.eventId })
		.returning({ eventId: stripeEvent.eventId });

	if (insertedRows.length === 0) {
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
		default:
			logger.info(
				{ eventId: event.id, type: event.type },
				"Stripe event received but not handled",
			);
	}
}
