import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { pricingConfig } from "@/db/schemas/pricing-config";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { logger } from "@/lib/logger";
import { stripe } from "@/lib/stripe";

export async function runAutoCancelSuspended(): Promise<{ canceled: number }> {
	const cfg = await db.query.pricingConfig.findFirst({
		where: eq(pricingConfig.isActive, true),
	});
	if (!cfg) {
		logger.warn("No active pricing_config, skipping auto-cancel job");
		return { canceled: 0 };
	}

	const cutoff = new Date(Date.now() - cfg.suspendedAutoCancelDays * 86400000);

	const subs = await db
		.select()
		.from(storeSubscription)
		.where(
			and(
				eq(storeSubscription.status, "suspended"),
				isNotNull(storeSubscription.suspendedAt),
				lte(storeSubscription.suspendedAt, cutoff),
			),
		);

	let canceled = 0;
	for (const sub of subs) {
		try {
			// Pre-set reason BEFORE Stripe call; the resulting subscription.deleted
			// webhook will preserve it.
			await db
				.update(storeSubscription)
				.set({ cancelReason: "payment_failed_auto" })
				.where(eq(storeSubscription.id, sub.id));

			await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
			canceled++;
			logger.info(
				{ stripeSubscriptionId: sub.stripeSubscriptionId },
				"Auto-cancelled suspended subscription",
			);
		} catch (err) {
			logger.error(
				{ err, stripeSubscriptionId: sub.stripeSubscriptionId },
				"Failed to auto-cancel suspended subscription",
			);
		}
	}

	return { canceled };
}
