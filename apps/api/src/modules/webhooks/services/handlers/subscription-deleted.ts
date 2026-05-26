import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { store } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { logger } from "@/lib/logger";

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

	await db.transaction(async (tx) => {
		await tx
			.update(storeSubscription)
			.set({
				status: "canceled",
				canceledAt: new Date(),
				cancelReason: existing.cancelReason ?? "payment_failed_auto",
			})
			.where(eq(storeSubscription.id, existing.id));

		await tx
			.update(store)
			.set({ deletedAt: new Date() })
			.where(eq(store.id, existing.storeId));
	});
}
