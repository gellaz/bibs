import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { pendingStoreCreation } from "@/db/schemas/pending-store-creation";
import { store, storePhoneNumber } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";
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

	await db.transaction(async (tx) => {
		const pending = await tx.query.pendingStoreCreation.findFirst({
			where: and(
				eq(pendingStoreCreation.id, pendingId),
				eq(pendingStoreCreation.status, "open"),
			),
		});

		if (!pending) {
			logger.info(
				{ pendingId, sessionId: session.id },
				"Pending already consumed or missing, skipping (idempotent)",
			);
			return;
		}

		const formData = pending.formData as Record<string, unknown>;

		const [createdStore] = await tx
			.insert(store)
			.values({
				sellerProfileId: pending.sellerProfileId,
				name: formData.name as string,
				description: (formData.description as string | undefined) ?? null,
				addressLine1: formData.addressLine1 as string,
				addressLine2: (formData.addressLine2 as string | undefined) ?? null,
				city: formData.city as string,
				zipCode: formData.zipCode as string,
				province: (formData.province as string | undefined) ?? null,
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

		const firstItem = sub.items.data[0];
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
