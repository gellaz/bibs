import { eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { pricingConfig } from "@/db/schemas/pricing-config";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import {
	type StoreSubscriptionStatus,
	storeSubscription,
} from "@/db/schemas/store-subscription";

/**
 * Seed store_subscriptions for every existing live store owned by an active
 * seller. Most are status='active'; a handful land in past_due / canceling /
 * suspended / canceled so the admin /billing overview and the seller banners
 * have realistic data without needing to trigger Stripe webhooks.
 *
 * Idempotent: skips stores that already have a subscription row.
 */

interface Plan {
	status: StoreSubscriptionStatus;
	currentPeriodEnd: Date;
	cancelAtPeriodEnd: boolean;
	suspendedAt: Date | null;
	canceledAt: Date | null;
	cancelReason: string | null;
	softDeleteStore: boolean;
}

function buildPlans(now: number): Plan[] {
	return [
		// 3 × past_due — renewal soon, payment failed
		...Array.from(
			{ length: 3 },
			(): Plan => ({
				status: "past_due",
				currentPeriodEnd: new Date(now + 5 * 86400000),
				cancelAtPeriodEnd: false,
				suspendedAt: null,
				canceledAt: null,
				cancelReason: null,
				softDeleteStore: false,
			}),
		),
		// 2 × canceling — cancel scheduled at period end
		...Array.from(
			{ length: 2 },
			(): Plan => ({
				status: "canceling",
				currentPeriodEnd: new Date(now + 15 * 86400000),
				cancelAtPeriodEnd: true,
				suspendedAt: null,
				canceledAt: null,
				cancelReason: "seller_canceled",
				softDeleteStore: false,
			}),
		),
		// 1 × suspended — invisible to customers, recoverable via portal
		{
			status: "suspended",
			currentPeriodEnd: new Date(now - 5 * 86400000),
			cancelAtPeriodEnd: false,
			suspendedAt: new Date(now - 5 * 86400000),
			canceledAt: null,
			cancelReason: null,
			softDeleteStore: false,
		},
		// 1 × canceled — store is archived (deletedAt set)
		{
			status: "canceled",
			currentPeriodEnd: new Date(now - 20 * 86400000),
			cancelAtPeriodEnd: false,
			suspendedAt: null,
			canceledAt: new Date(now - 15 * 86400000),
			cancelReason: "seller_canceled",
			softDeleteStore: true,
		},
	];
}

export async function seedBillingSubscriptions() {
	const activePricing = await db.query.pricingConfig.findFirst({
		where: eq(pricingConfig.isActive, true),
	});
	if (!activePricing) {
		console.log(
			"  ⏭ No active pricing_config — skipping billing subscriptions seed",
		);
		return;
	}

	// Find all stores belonging to active sellers (excluding already-deleted ones)
	const stores = await db
		.select({
			id: store.id,
			sellerProfileId: store.sellerProfileId,
			stripeCustomerId: sellerProfile.stripeCustomerId,
		})
		.from(store)
		.innerJoin(sellerProfile, eq(store.sellerProfileId, sellerProfile.id))
		.where(isNull(store.deletedAt));

	if (stores.length === 0) {
		console.log("  ⏭ No live stores to seed subscriptions for");
		return;
	}

	// Skip stores that already have a subscription (idempotent re-run)
	const existing = await db
		.select({ storeId: storeSubscription.storeId })
		.from(storeSubscription)
		.where(
			inArray(
				storeSubscription.storeId,
				stores.map((s) => s.id),
			),
		);
	const alreadyHasSub = new Set(existing.map((r) => r.storeId));
	const targets = stores.filter((s) => !alreadyHasSub.has(s.id));

	if (targets.length === 0) {
		console.log(
			`  ⏭ All ${stores.length} stores already have subscriptions, skipping`,
		);
		return;
	}

	const now = Date.now();
	const plans = buildPlans(now);

	// Apply the first `plans.length` non-active plans deterministically to the
	// first N stores; everything else gets a vanilla active subscription.
	const subscriptionRows = targets.map((s, idx) => {
		const plan: Plan = plans[idx] ?? {
			status: "active",
			currentPeriodEnd: new Date(now + 30 * 86400000),
			cancelAtPeriodEnd: false,
			suspendedAt: null,
			canceledAt: null,
			cancelReason: null,
			softDeleteStore: false,
		};
		const customerId =
			s.stripeCustomerId ?? `cus_seed_orphan_${s.id.slice(0, 8)}`;
		return {
			storeId: s.id,
			stripeSubscriptionId: `sub_seed_${s.id.slice(0, 16)}`,
			stripeCustomerId: customerId,
			stripePriceId: activePricing.stripePriceId,
			feeAmountCents: activePricing.storeMonthlyFeeCents,
			currency: activePricing.currency,
			status: plan.status,
			currentPeriodEnd: plan.currentPeriodEnd,
			cancelAtPeriodEnd: plan.cancelAtPeriodEnd,
			suspendedAt: plan.suspendedAt,
			canceledAt: plan.canceledAt,
			cancelReason: plan.cancelReason,
			_softDeleteStore: plan.softDeleteStore,
		};
	});

	console.log(
		`  💳 Seeding ${subscriptionRows.length} store subscriptions (${plans.length} mixed states, rest active)...`,
	);

	await db
		.insert(storeSubscription)
		.values(subscriptionRows.map(({ _softDeleteStore, ...row }) => row));

	// Soft-delete stores whose subscription is canceled
	const toSoftDelete = subscriptionRows
		.filter((r) => r._softDeleteStore)
		.map((r) => r.storeId);
	if (toSoftDelete.length > 0) {
		await db
			.update(store)
			.set({ deletedAt: new Date(now - 14 * 86400000) })
			.where(inArray(store.id, toSoftDelete));
	}

	console.log(
		`  ✓ ${subscriptionRows.length} subscriptions seeded${
			toSoftDelete.length > 0
				? ` (${toSoftDelete.length} stores soft-deleted)`
				: ""
		}`,
	);
}
