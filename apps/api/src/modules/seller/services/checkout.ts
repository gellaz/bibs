import type { Static } from "@sinclair/typebox";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { pendingStoreCreation } from "@/db/schemas/pending-store-creation";
import { pricingConfig } from "@/db/schemas/pricing-config";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { env } from "@/lib/env";
import { ServiceError } from "@/lib/errors";
import { validateOpeningHours } from "@/lib/opening-hours";
import type { CreateStoreBody } from "@/lib/schemas/forms";
import { stripe } from "@/lib/stripe";
import { getOrCreateStripeCustomer } from "@/modules/billing/services/customer";

type CreateStoreInput = Static<typeof CreateStoreBody>;

// The Stripe Checkout Session must expire strictly BEFORE the pending row, so a
// paid `checkout.session.completed` can never land after the expire-pending cron
// has flipped the pending to 'expired' — which would otherwise orphan a live,
// billing subscription with no store. Stripe bounds session expiry to [30min, 24h];
// we keep a 1h safety margin and stay clear of both ends of that window.
const SESSION_SAFETY_MARGIN_SECONDS = 60 * 60;
// Generous slack over Stripe's hard 30min floor so a slow DB round-trip or host
// clock skew between computing this and the create call can't push us under it.
const STRIPE_SESSION_MIN_SECONDS = 35 * 60;
const STRIPE_SESSION_MAX_SECONDS = 23 * 60 * 60; // safely under Stripe's 24h ceiling

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

	if (Array.isArray(body.openingHours)) {
		const hoursError = validateOpeningHours(body.openingHours);
		if (hoursError) throw new ServiceError(400, hoursError);
	}

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
		if (session.status === "open") {
			return {
				checkoutUrl: session.url ?? "",
				pendingStoreCreationId: existing.id,
			};
		}
		// Session is expired or otherwise unusable — expire the pending and fall through to create a fresh one
		await db
			.update(pendingStoreCreation)
			.set({ status: "expired" })
			.where(eq(pendingStoreCreation.id, existing.id));
	}

	const pricing = await getActivePricing();
	const customerId = await getOrCreateStripeCustomer(sellerProfileId);

	// Derive the Stripe session expiry from the configured pending TTL, clamped to
	// Stripe's valid window, then make the pending always outlive that session by the
	// safety margin (self-correcting even if pendingCreationExpiryHours is small).
	const nowMs = Date.now();
	const pendingTtlSeconds = pricing.pendingCreationExpiryHours * 60 * 60;
	const sessionTtlSeconds = Math.min(
		Math.max(
			pendingTtlSeconds - SESSION_SAFETY_MARGIN_SECONDS,
			STRIPE_SESSION_MIN_SECONDS,
		),
		STRIPE_SESSION_MAX_SECONDS,
	);
	const expiresAt = new Date(
		nowMs +
			Math.max(
				pendingTtlSeconds,
				sessionTtlSeconds + SESSION_SAFETY_MARGIN_SECONDS,
			) *
				1000,
	);
	const sessionExpiresAt = Math.floor(nowMs / 1000) + sessionTtlSeconds;

	// If there's an orphan pending (open, no Stripe session — left over from a previous
	// attempt that exploded mid-flight), reuse the row instead of inserting a new one,
	// otherwise the partial unique index on (seller_profile_id WHERE status='open') trips.
	const orphan =
		existing && !existing.stripeCheckoutSessionId ? existing : null;

	let pendingId: string;
	if (orphan) {
		await db
			.update(pendingStoreCreation)
			.set({
				formData: body,
				feeAmountCents: pricing.storeMonthlyFeeCents,
				currency: pricing.currency,
				expiresAt,
			})
			.where(eq(pendingStoreCreation.id, orphan.id));
		pendingId = orphan.id;
	} else {
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
		pendingId = pending.id;
	}

	const session = await stripe.checkout.sessions.create({
		mode: "subscription",
		customer: customerId,
		line_items: [{ price: pricing.stripePriceId, quantity: 1 }],
		payment_method_collection: "if_required",
		expires_at: sessionExpiresAt,
		metadata: { pendingStoreCreationId: pendingId },
		subscription_data: {
			metadata: { pendingStoreCreationId: pendingId },
		},
		success_url: `${env.SELLER_APP_URL}/store/new/processing?session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${env.SELLER_APP_URL}/store/new?cancel=${pendingId}`,
	});

	await db
		.update(pendingStoreCreation)
		.set({ stripeCheckoutSessionId: session.id })
		.where(eq(pendingStoreCreation.id, pendingId));

	return {
		checkoutUrl: session.url ?? "",
		pendingStoreCreationId: pendingId,
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
