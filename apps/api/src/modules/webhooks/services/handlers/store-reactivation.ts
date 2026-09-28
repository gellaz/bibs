import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { store } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { ServiceError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { stripe } from "@/lib/stripe";

/**
 * Ramo di `checkout.session.completed` per le sessioni create da
 * `POST /seller/stores/:storeId/reactivation-checkout`.
 *
 * `store_subscriptions.store_id` è UNIQUE (una riga per negozio), quindi la
 * riga esistente viene riusata: prende il nuovo `stripeSubscriptionId`, torna
 * `active` e perde i marcatori della cancellazione. Il negozio perde il
 * `deletedAt`; prodotti, stock, orari, immagini e dipendenti assegnati non sono
 * mai stati toccati dalla cancellazione, quindi tornano visibili così com'erano.
 */
export async function handleStoreReactivation(
	session: Stripe.Checkout.Session,
	storeId: string,
): Promise<void> {
	if (!session.subscription || typeof session.subscription !== "string") {
		logger.warn(
			{ sessionId: session.id, storeId },
			"Reactivation session has no subscription id",
		);
		return;
	}

	const sub = await stripe.subscriptions.retrieve(session.subscription);

	// Idempotency: replayed event (or a different event for the same session).
	const alreadyLinked = await db.query.storeSubscription.findFirst({
		where: eq(storeSubscription.stripeSubscriptionId, sub.id),
	});
	if (alreadyLinked) {
		logger.info(
			{ sessionId: session.id, storeId, stripeSubscriptionId: sub.id },
			"Reactivation already applied, skipping (idempotent)",
		);
		return;
	}

	const firstItem = sub.items.data[0];
	if (!firstItem?.price?.id) {
		throw new ServiceError(
			500,
			`Stripe subscription ${sub.id} has no usable line item; cannot reactivate store ${storeId}`,
		);
	}

	const update: Partial<typeof storeSubscription.$inferInsert> = {
		stripeSubscriptionId: sub.id,
		stripeCustomerId: sub.customer as string,
		stripePriceId: firstItem.price.id,
		status: "active",
		currentPeriodEnd: new Date(firstItem.current_period_end * 1000),
		cancelAtPeriodEnd: sub.cancel_at_period_end,
		cancelReason: null,
		canceledAt: null,
		suspendedAt: null,
	};
	// The fee is what the new subscription actually bills; keep the old value if
	// the price object carries no fixed amount.
	if (typeof firstItem.price.unit_amount === "number") {
		update.feeAmountCents = firstItem.price.unit_amount;
	}
	if (firstItem.price.currency) {
		update.currency = firstItem.price.currency.toUpperCase();
	}

	// CAS on status='canceled': a second paid reactivation checkout for the same
	// store (two tabs) finds the row already active and must not overwrite the
	// subscription that is now live.
	const reactivated = await db.transaction(async (tx) => {
		const rows = await tx
			.update(storeSubscription)
			.set(update)
			.where(
				and(
					eq(storeSubscription.storeId, storeId),
					eq(storeSubscription.status, "canceled"),
				),
			)
			.returning({ id: storeSubscription.id });
		if (rows.length === 0) return false;

		await tx
			.update(store)
			.set({ deletedAt: null })
			.where(eq(store.id, storeId));
		return true;
	});

	if (reactivated) {
		logger.info(
			{ storeId, stripeSubscriptionId: sub.id },
			"Store reactivated after paid checkout",
		);
		return;
	}

	// The store is not canceled any more (already reactivated by another
	// checkout) or has no subscription row: this new subscription has nothing to
	// attach to. Cancel it so the seller is not billed twice; the first invoice
	// needs a manual refund.
	if (sub.status === "canceled" || sub.status === "incomplete_expired") return;
	logger.error(
		{ sessionId: session.id, storeId, stripeSubscriptionId: sub.id },
		"Paid reactivation for a store that is not canceled; canceling the duplicate subscription — refund the first invoice manually",
	);
	try {
		await stripe.subscriptions.cancel(sub.id);
	} catch (err) {
		// Re-throw so the event stays reprocessable instead of stranding a live,
		// billing subscription.
		logger.error(
			{ err, stripeSubscriptionId: sub.id },
			"Failed to cancel duplicate reactivation subscription; still live — manual action required",
		);
		throw err;
	}
}
