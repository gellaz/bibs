import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { pricingConfig } from "@/db/schemas/pricing-config";
import { store } from "@/db/schemas/store";
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
		// Optimistically finalize suspended -> canceled (guarded CAS) BEFORE the
		// Stripe call. The auto-cancel is an IMMEDIATE cancel, so 'canceled' is the
		// correct terminal state: it removes the row from the next run's selection
		// set (no repeated cancel attempts on a delayed/missing webhook) AND keeps
		// the dead, non-paying subscription out of the billable / MRR / reactivate
		// queries — unlike 'canceling', which means "active until period end" and is
		// counted as billable. The subscription.deleted webhook re-affirms 'canceled'
		// and soft-deletes the store; its reason default preserves 'payment_failed_auto'.
		// A concurrent run that loses this CAS gets 0 rows back and skips.
		const [claimed] = await db
			.update(storeSubscription)
			.set({
				status: "canceled",
				canceledAt: new Date(),
				cancelReason: "payment_failed_auto",
			})
			.where(
				and(
					eq(storeSubscription.id, sub.id),
					eq(storeSubscription.status, "suspended"),
				),
			)
			.returning();
		if (!claimed) continue;

		try {
			await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
			canceled++;
			logger.info(
				{ stripeSubscriptionId: sub.stripeSubscriptionId },
				"Auto-cancelled suspended subscription",
			);
		} catch (err) {
			// Already canceled / missing on Stripe: the subscription is provably
			// gone. The subscription.deleted webhook may have already fired (and
			// soft-deleted the store) or — if the sub was removed out-of-band — may
			// never arrive, so finalize the store soft-delete here too rather than
			// depend on it. The row already sits at 'canceled' from the CAS above.
			if ((err as { code?: string }).code === "resource_missing") {
				await db
					.update(store)
					.set({ deletedAt: new Date() })
					.where(and(eq(store.id, sub.storeId), isNull(store.deletedAt)));
				canceled++;
				logger.warn(
					{ err, stripeSubscriptionId: sub.stripeSubscriptionId },
					"Subscription already canceled on Stripe; finalized locally",
				);
				continue;
			}
			// Transient error: revert canceled -> suspended (guarded) so the next
			// run retries, rather than stranding a still-live subscription.
			await db
				.update(storeSubscription)
				.set({ status: "suspended", canceledAt: null })
				.where(
					and(
						eq(storeSubscription.id, sub.id),
						eq(storeSubscription.status, "canceled"),
					),
				);
			logger.error(
				{ err, stripeSubscriptionId: sub.stripeSubscriptionId },
				"Failed to auto-cancel suspended subscription",
			);
		}
	}

	return { canceled };
}
