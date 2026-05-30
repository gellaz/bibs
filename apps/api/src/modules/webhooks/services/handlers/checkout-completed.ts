import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { pendingStoreCreation } from "@/db/schemas/pending-store-creation";
import { store, storePhoneNumber } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { ServiceError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { stripe } from "@/lib/stripe";

export async function handleCheckoutCompleted(
	event: Stripe.Event,
): Promise<void> {
	const session = event.data.object as Stripe.Checkout.Session;

	if (session.payment_status !== "paid") {
		logger.info(
			{ sessionId: session.id, payment_status: session.payment_status },
			"Checkout session not paid, skipping",
		);
		return;
	}

	const pendingId = session.metadata?.pendingStoreCreationId;
	if (!pendingId) {
		logger.warn(
			{ sessionId: session.id },
			"checkout.session.completed without pendingStoreCreationId metadata",
		);
		return;
	}

	if (!session.subscription || typeof session.subscription !== "string") {
		logger.warn({ sessionId: session.id }, "Session has no subscription id");
		return;
	}

	const sub = await stripe.subscriptions.retrieve(session.subscription);

	// Idempotency: if this subscription is already provisioned, there's nothing to
	// do. Guards against event replay and any path that already created the store.
	const existingSub = await db.query.storeSubscription.findFirst({
		where: eq(storeSubscription.stripeSubscriptionId, sub.id),
	});
	if (existingSub) {
		logger.info(
			{ pendingId, sessionId: session.id, stripeSubscriptionId: sub.id },
			"Subscription already provisioned, skipping (idempotent)",
		);
		return;
	}

	const pending = await db.query.pendingStoreCreation.findFirst({
		where: eq(pendingStoreCreation.id, pendingId),
	});

	// The pending row is gone (e.g. the seller profile was deleted → cascade), so we
	// have no form data to build a store from and cannot honor the payment. Cancel
	// the now-orphaned live subscription so the seller is not billed for nothing.
	if (!pending) {
		// If Stripe already has it in a terminal state, there is nothing to cancel.
		if (sub.status === "canceled" || sub.status === "incomplete_expired") {
			logger.warn(
				{
					pendingId,
					sessionId: session.id,
					stripeSubscriptionId: sub.id,
					status: sub.status,
				},
				"Paid checkout for a missing pending, but subscription is already terminal; nothing to cancel",
			);
			return;
		}
		logger.error(
			{ pendingId, sessionId: session.id, stripeSubscriptionId: sub.id },
			"Paid checkout for a missing pending; canceling orphaned subscription",
		);
		try {
			await stripe.subscriptions.cancel(sub.id);
		} catch (err) {
			// Re-throw so the event stays reprocessable (processedAt is left null) rather
			// than silently stranding a still-live, billing subscription.
			logger.error(
				{ err, stripeSubscriptionId: sub.id },
				"Failed to cancel orphaned subscription; it is still live and billing — manual action required",
			);
			throw err;
		}
		return;
	}

	// Already provisioned via a prior delivery or the resume path → truly idempotent.
	if (pending.status === "consumed") {
		logger.info(
			{ pendingId, sessionId: session.id },
			"Pending already consumed, skipping (idempotent)",
		);
		return;
	}

	// status is 'open' (happy path) or 'expired'/'canceled' (the expire-pending cron
	// raced a paid checkout). In every case the seller paid, so honor the payment and
	// create the store from the saved form data — reviving an expired/canceled pending.
	if (pending.status !== "open") {
		logger.warn(
			{ pendingId, sessionId: session.id, status: pending.status },
			"Paid checkout completed after pending was no longer open; reviving and creating the store",
		);
	}

	const firstItem = sub.items.data[0];
	if (!firstItem?.price?.id) {
		// A paid subscription with no usable line item is anomalous and we cannot build
		// a valid storeSubscription row (stripePriceId is NOT NULL). Surface loudly for
		// manual handling rather than writing a half-built row.
		throw new ServiceError(
			500,
			`Stripe subscription ${sub.id} has no usable line item; cannot provision store for pending ${pendingId}`,
		);
	}

	const formData = pending.formData as Record<string, unknown>;

	await db.transaction(async (tx) => {
		const [createdStore] = await tx
			.insert(store)
			.values({
				sellerProfileId: pending.sellerProfileId,
				name: formData.name as string,
				description: (formData.description as string | undefined) ?? null,
				addressLine1: formData.addressLine1 as string,
				addressLine2: (formData.addressLine2 as string | undefined) ?? null,
				municipalityId: formData.municipalityId as string,
				zipCode: formData.zipCode as string,
				country: (formData.country as string) ?? "IT",
				categoryId: (formData.categoryId as string | undefined) ?? null,
				openingHours:
					(formData.openingHours as
						| Array<{
								dayOfWeek: number;
								slots: Array<{ open: string; close: string }>;
						  }>
						| undefined) ?? null,
				websiteUrl: (formData.websiteUrl as string | undefined) ?? null,
			})
			.returning();

		await tx.insert(storeSubscription).values({
			storeId: createdStore.id,
			stripeSubscriptionId: sub.id,
			stripeCustomerId: sub.customer as string,
			stripePriceId: firstItem.price.id,
			feeAmountCents: pending.feeAmountCents,
			currency: pending.currency,
			status: "active",
			currentPeriodEnd: new Date(firstItem.current_period_end * 1000),
			cancelAtPeriodEnd: sub.cancel_at_period_end,
		});

		const phones =
			(formData.phoneNumbers as
				| Array<{ label?: string; number: string; position?: number }>
				| undefined) ?? [];

		if (phones.length > 0) {
			await tx.insert(storePhoneNumber).values(
				phones.map((p, idx) => ({
					storeId: createdStore.id,
					label: p.label ?? null,
					number: p.number,
					position: p.position ?? idx,
				})),
			);
		}

		await tx
			.update(pendingStoreCreation)
			.set({
				status: "consumed",
				stripeSubscriptionId: sub.id,
				consumedAt: new Date(),
			})
			.where(eq(pendingStoreCreation.id, pending.id));
	});
}
