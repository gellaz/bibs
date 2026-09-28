import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import {
	type StoreSubscriptionStatus,
	storeSubscription,
} from "@/db/schemas/store-subscription";
import { logger } from "@/lib/logger";
import { notifyStoreSuspended } from "../billing-notifications";

export function mapStripeStatus(
	sub: Stripe.Subscription,
): StoreSubscriptionStatus {
	if (sub.status === "canceled") return "canceled";
	if (sub.status === "unpaid") return "suspended";
	if (sub.status === "past_due") return "past_due";
	if (sub.cancel_at_period_end) return "canceling";
	if (sub.status === "active" || sub.status === "trialing") return "active";
	logger.warn(
		{ subId: sub.id, status: sub.status },
		"Unexpected Stripe subscription status, treating as past_due",
	);
	return "past_due";
}

export async function handleSubscriptionUpdated(
	event: Stripe.Event,
): Promise<void> {
	const sub = event.data.object as Stripe.Subscription;

	const existing = await db.query.storeSubscription.findFirst({
		where: eq(storeSubscription.stripeSubscriptionId, sub.id),
	});
	if (!existing) {
		logger.warn(
			{ stripeSubscriptionId: sub.id },
			"subscription.updated for unknown sub, skipping",
		);
		return;
	}

	const newStatus = mapStripeStatus(sub);

	const currentPeriodEnd = sub.items.data[0]?.current_period_end;
	if (!currentPeriodEnd) {
		logger.warn(
			{ stripeSubscriptionId: sub.id },
			"subscription.updated missing items[0].current_period_end, keeping existing value",
		);
	}

	const update: Partial<typeof storeSubscription.$inferInsert> = {
		status: newStatus,
		cancelAtPeriodEnd: sub.cancel_at_period_end,
	};
	if (currentPeriodEnd) {
		update.currentPeriodEnd = new Date(currentPeriodEnd * 1000);
	}

	// First entry into suspended (suspendedAt is cleared on the way back to
	// active, so a later relapse counts as a new suspension).
	const firstSuspension = newStatus === "suspended" && !existing.suspendedAt;
	if (firstSuspension) {
		update.suspendedAt = new Date();
	}
	if (newStatus === "active") {
		update.suspendedAt = null;
	}

	await db
		.update(storeSubscription)
		.set(update)
		.where(eq(storeSubscription.id, existing.id));

	if (firstSuspension) {
		await notifyStoreSuspended(existing.storeId);
	}
}
