import type { Static } from "@sinclair/typebox";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { pendingStoreCreation } from "@/db/schemas/pending-store-creation";
import { pricingConfig } from "@/db/schemas/pricing-config";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { env } from "@/lib/env";
import { ServiceError } from "@/lib/errors";
import type { CreateStoreBody } from "@/lib/schemas/forms";
import { stripe } from "@/lib/stripe";
import { getOrCreateStripeCustomer } from "@/modules/billing/services/customer";

type CreateStoreInput = Static<typeof CreateStoreBody>;

interface CreateCheckoutParams {
	sellerProfileId: string;
	body: CreateStoreInput;
}

interface CreateCheckoutResult {
	checkoutUrl: string;
	pendingStoreCreationId: string;
}

async function getActivePricing() {
	const cfg = await db.query.pricingConfig.findFirst({
		where: eq(pricingConfig.isActive, true),
	});
	if (!cfg) {
		throw new ServiceError(
			500,
			"Pricing config not initialized. Run stripe:bootstrap + db:seed.",
		);
	}
	return cfg;
}

export async function createCheckoutSession(
	params: CreateCheckoutParams,
): Promise<CreateCheckoutResult> {
	const { sellerProfileId, body } = params;

	// Idempotent: if there's already an "open" pending for this seller, return its session
	const existing = await db.query.pendingStoreCreation.findFirst({
		where: and(
			eq(pendingStoreCreation.sellerProfileId, sellerProfileId),
			eq(pendingStoreCreation.status, "open"),
		),
	});
	if (existing?.stripeCheckoutSessionId) {
		const session = await stripe.checkout.sessions.retrieve(
			existing.stripeCheckoutSessionId,
		);
		return {
			checkoutUrl: session.url ?? "",
			pendingStoreCreationId: existing.id,
		};
	}

	const pricing = await getActivePricing();
	const customerId = await getOrCreateStripeCustomer(sellerProfileId);

	// Compute expiry: now + pendingCreationExpiryHours hours
	const expiresAt = new Date(
		Date.now() + pricing.pendingCreationExpiryHours * 60 * 60 * 1000,
	);

	const [pending] = await db
		.insert(pendingStoreCreation)
		.values({
			sellerProfileId,
			formData: body,
			feeAmountCents: pricing.storeMonthlyFeeCents,
			currency: pricing.currency,
			status: "open",
			expiresAt,
		})
		.returning();

	const session = await stripe.checkout.sessions.create({
		mode: "subscription",
		customer: customerId,
		line_items: [{ price: pricing.stripePriceId, quantity: 1 }],
		payment_method_collection: "if_required",
		metadata: { pendingStoreCreationId: pending.id },
		subscription_data: {
			metadata: { pendingStoreCreationId: pending.id },
		},
		success_url: `${env.SELLER_APP_URL}/store/new/processing?session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${env.SELLER_APP_URL}/store/new?cancel=${pending.id}`,
	});

	await db
		.update(pendingStoreCreation)
		.set({ stripeCheckoutSessionId: session.id })
		.where(eq(pendingStoreCreation.id, pending.id));

	return {
		checkoutUrl: session.url ?? "",
		pendingStoreCreationId: pending.id,
	};
}

export async function getCheckoutStatus(params: {
	sellerProfileId: string;
	stripeCheckoutSessionId: string;
}): Promise<{
	status: "open" | "ready" | "expired" | "canceled";
	storeId?: string;
}> {
	const pending = await db.query.pendingStoreCreation.findFirst({
		where: and(
			eq(pendingStoreCreation.sellerProfileId, params.sellerProfileId),
			eq(
				pendingStoreCreation.stripeCheckoutSessionId,
				params.stripeCheckoutSessionId,
			),
		),
	});
	if (!pending) {
		throw new ServiceError(404, "Checkout session not found for this seller");
	}
	if (pending.status === "consumed") {
		const sub = pending.stripeSubscriptionId
			? await db.query.storeSubscription.findFirst({
					where: eq(
						storeSubscription.stripeSubscriptionId,
						pending.stripeSubscriptionId,
					),
				})
			: null;
		return { status: "ready", storeId: sub?.storeId };
	}
	if (pending.status === "open") return { status: "open" };
	if (pending.status === "expired") return { status: "expired" };
	return { status: "canceled" };
}

export async function getPendingForResume(params: {
	sellerProfileId: string;
	pendingId: string;
}) {
	const pending = await db.query.pendingStoreCreation.findFirst({
		where: and(
			eq(pendingStoreCreation.id, params.pendingId),
			eq(pendingStoreCreation.sellerProfileId, params.sellerProfileId),
		),
	});
	if (!pending || pending.status !== "open") {
		throw new ServiceError(
			404,
			"Pending checkout not found or already consumed",
		);
	}
	return { formData: pending.formData };
}
