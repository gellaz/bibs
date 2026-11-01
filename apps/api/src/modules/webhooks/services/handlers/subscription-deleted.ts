import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { notifyStoreCanceled } from "@/domain/billing/billing-notifications";
import { archiveStore } from "@/domain/stores/store-archive";
import { logger } from "@/infra/logger";

export async function handleSubscriptionDeleted(
	event: Stripe.Event,
): Promise<void> {
	const sub = event.data.object as Stripe.Subscription;

	const existing = await db.query.storeSubscription.findFirst({
		where: eq(storeSubscription.stripeSubscriptionId, sub.id),
	});
	if (!existing) {
		logger.warn(
			{ stripeSubscriptionId: sub.id },
			"subscription.deleted for unknown sub, skipping",
		);
		return;
	}

	const cancelReason = existing.cancelReason ?? "payment_failed_auto";

	// The email goes out only for the delivery that actually archives the store.
	// The guard is the store's deletedAt (CAS), NOT the previous subscription
	// status: the auto-cancel job pre-flips the row to 'canceled' before calling
	// Stripe, so on its (main) path the status is already 'canceled' here even
	// though the seller has not been told anything yet. A store with open orders
	// is not archived here: the archiveEndedStores job does it, email included.
	const archived = await db.transaction(async (tx) => {
		await tx
			.update(storeSubscription)
			.set({
				status: "canceled",
				canceledAt: new Date(),
				cancelReason,
			})
			.where(eq(storeSubscription.id, existing.id));

		return archiveStore(tx, existing.storeId);
	});

	if (archived) {
		await notifyStoreCanceled({ storeId: existing.storeId, cancelReason });
	}
}
