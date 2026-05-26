import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { pricingConfig } from "@/db/schemas/pricing-config";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { ServiceError } from "@/lib/errors";
import { stripe } from "@/lib/stripe";

export async function getBillingOverview() {
	const rows = await db
		.select({
			status: storeSubscription.status,
			count: sql<number>`count(*)::int`,
			sumCents: sql<number>`coalesce(sum(${storeSubscription.feeAmountCents}), 0)::int`,
		})
		.from(storeSubscription)
		.groupBy(storeSubscription.status);

	let mrrCents = 0;
	let activeStoresCount = 0;
	let pastDueCount = 0;
	let cancelingCount = 0;
	let suspendedCount = 0;

	for (const r of rows) {
		if (r.status === "active") {
			activeStoresCount = r.count;
			mrrCents += r.sumCents;
		} else if (r.status === "past_due") {
			pastDueCount = r.count;
			mrrCents += r.sumCents;
		} else if (r.status === "canceling") {
			cancelingCount = r.count;
			mrrCents += r.sumCents;
		} else if (r.status === "suspended") {
			suspendedCount = r.count;
		}
	}

	return {
		mrrCents,
		activeStoresCount,
		pastDueCount,
		cancelingCount,
		suspendedCount,
	};
}

export async function getCurrentPricing() {
	const cfg = await db.query.pricingConfig.findFirst({
		where: eq(pricingConfig.isActive, true),
	});
	if (!cfg) throw new ServiceError(500, "Pricing config non inizializzato");
	return cfg;
}

export async function listPricingHistory() {
	return db.query.pricingConfig.findMany({
		orderBy: (p, { desc }) => [desc(p.createdAt)],
	});
}

interface UpdatePricingParams {
	storeMonthlyFeeCents: number;
	currency: string;
	suspendedAutoCancelDays: number;
	pendingCreationExpiryHours: number;
	productId: string;
	adminUserId: string | null;
}

export async function updatePricing(params: UpdatePricingParams) {
	if (params.currency !== "EUR") {
		throw new ServiceError(400, "Solo EUR supportato in MVP");
	}
	if (params.storeMonthlyFeeCents <= 0) {
		throw new ServiceError(400, "La quota deve essere maggiore di zero");
	}

	const newPrice = await stripe.prices.create({
		product: params.productId,
		unit_amount: params.storeMonthlyFeeCents,
		currency: params.currency.toLowerCase(),
		recurring: { interval: "month" },
	});

	await db.transaction(async (tx) => {
		await tx
			.update(pricingConfig)
			.set({ isActive: false })
			.where(eq(pricingConfig.isActive, true));
		await tx.insert(pricingConfig).values({
			storeMonthlyFeeCents: params.storeMonthlyFeeCents,
			currency: params.currency,
			stripePriceId: newPrice.id,
			suspendedAutoCancelDays: params.suspendedAutoCancelDays,
			pendingCreationExpiryHours: params.pendingCreationExpiryHours,
			isActive: true,
			createdByUserId: params.adminUserId,
		});
	});

	return { newPriceId: newPrice.id };
}
