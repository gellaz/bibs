import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { pricingConfig } from "@/db/schemas/pricing-config";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import {
	type StoreSubscriptionStatus,
	storeSubscription,
} from "@/db/schemas/store-subscription";
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

interface ListAllSubsParams {
	page: number;
	limit: number;
	status?: StoreSubscriptionStatus;
	sellerEmail?: string;
	storeName?: string;
}

export async function listAllSubscriptions(params: ListAllSubsParams) {
	const limit = Math.min(params.limit, 100);
	const offset = (params.page - 1) * limit;

	const conditions = [];
	if (params.status)
		conditions.push(eq(storeSubscription.status, params.status));
	if (params.sellerEmail)
		conditions.push(ilike(user.email, `%${params.sellerEmail}%`));
	if (params.storeName)
		conditions.push(ilike(store.name, `%${params.storeName}%`));

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const dataQuery = db
		.select({
			id: storeSubscription.id,
			storeId: storeSubscription.storeId,
			storeName: store.name,
			sellerEmail: user.email,
			status: storeSubscription.status,
			feeAmountCents: storeSubscription.feeAmountCents,
			currentPeriodEnd: storeSubscription.currentPeriodEnd,
			createdAt: storeSubscription.createdAt,
			cancelReason: storeSubscription.cancelReason,
		})
		.from(storeSubscription)
		.innerJoin(store, eq(storeSubscription.storeId, store.id))
		.innerJoin(sellerProfile, eq(store.sellerProfileId, sellerProfile.id))
		.innerJoin(user, eq(sellerProfile.userId, user.id))
		.orderBy(desc(storeSubscription.createdAt));

	const data = where
		? await dataQuery.where(where).limit(limit).offset(offset)
		: await dataQuery.limit(limit).offset(offset);

	const totalQuery = db
		.select({ count: sql<number>`count(*)::int` })
		.from(storeSubscription)
		.innerJoin(store, eq(storeSubscription.storeId, store.id))
		.innerJoin(sellerProfile, eq(store.sellerProfileId, sellerProfile.id))
		.innerJoin(user, eq(sellerProfile.userId, user.id));

	const totalRow = where ? await totalQuery.where(where) : await totalQuery;

	return {
		data,
		pagination: {
			page: params.page,
			limit,
			total: totalRow[0]?.count ?? 0,
		},
	};
}
