import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

const sessionCreate = mock(async (_params: any) => ({
	id: "cs_REACT",
	url: "https://stripe.test/checkout/cs_REACT",
}));
const sessionList = mock(async (_params: any) => ({ data: [] as any[] }));

const NEW_PERIOD_END = Math.floor(Date.now() / 1000) + 30 * 86400;
const newSubscription = {
	id: "sub_NEW",
	customer: "cus_FAKE",
	status: "active",
	cancel_at_period_end: false,
	items: {
		data: [
			{
				price: { id: "price_FAKE", unit_amount: 3500, currency: "eur" },
				current_period_end: NEW_PERIOD_END,
			},
		],
	},
};
const subRetrieve = mock(async (_id: string) => newSubscription);
const subCancel = mock(async (_id: string) => ({
	id: _id,
	status: "canceled",
}));

let currentEvent: any = null;

mock.module("@/lib/stripe", () => ({
	stripe: {
		customers: { create: async () => ({ id: "cus_FAKE" }) },
		checkout: { sessions: { create: sessionCreate, list: sessionList } },
		subscriptions: { retrieve: subRetrieve, cancel: subCancel },
		webhooks: { constructEventAsync: async () => currentEvent },
	},
}));

mock.module("@/lib/env", () => ({
	env: {
		NODE_ENV: "test",
		STRIPE_SECRET_KEY: "sk_test_FAKE",
		STRIPE_WEBHOOK_SECRET: "whsec_FAKE",
		SELLER_APP_URL: "http://seller.test",
		CUSTOMER_APP_URL: "http://customer.test",
	},
}));

import { eq } from "drizzle-orm";
import { pricingConfig } from "@/db/schemas/pricing-config";
import { storeProduct } from "@/db/schemas/product";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { createReactivationCheckoutSession } from "@/modules/seller/services/checkout";
import { handleStripeWebhook } from "@/modules/webhooks/services/dispatcher";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
} from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
	sessionCreate.mockClear();
	sessionList.mockReset();
	sessionList.mockImplementation(async () => ({ data: [] }));
	subRetrieve.mockClear();
	subCancel.mockClear();

	await getTestDb().insert(pricingConfig).values({
		storeMonthlyFeeCents: 2900,
		currency: "EUR",
		stripePriceId: "price_FAKE",
		suspendedAutoCancelDays: 60,
		pendingCreationExpiryHours: 24,
		isActive: true,
	});
});

type SubStatus = "active" | "past_due" | "canceling" | "suspended" | "canceled";

async function seed(status: SubStatus) {
	const { profile } = await createTestSeller(getTestDb(), {
		email: "owner@forno.it",
	});
	await getTestDb()
		.update(sellerProfile)
		.set({ stripeCustomerId: "cus_FAKE" })
		.where(eq(sellerProfile.id, profile.id));
	const storeRow = await createTestStore(getTestDb(), profile.id, {
		name: "Forno Bianchi",
	});
	const archived = status === "canceled";
	if (archived) {
		await getTestDb()
			.update(store)
			.set({ deletedAt: new Date() })
			.where(eq(store.id, storeRow.id));
	}
	const [sub] = await getTestDb()
		.insert(storeSubscription)
		.values({
			storeId: storeRow.id,
			stripeSubscriptionId: "sub_OLD",
			stripeCustomerId: "cus_FAKE",
			stripePriceId: "price_OLD",
			feeAmountCents: 2900,
			currency: "EUR",
			status,
			currentPeriodEnd: new Date(Date.now() - 86400000),
			cancelReason: archived ? "payment_failed_auto" : null,
			canceledAt: archived ? new Date() : null,
			suspendedAt: archived ? new Date(Date.now() - 5 * 86400000) : null,
		})
		.returning();
	return { sellerProfileId: profile.id, storeId: storeRow.id, sub };
}

function completedEvent(eventId: string, storeId: string) {
	return {
		id: eventId,
		type: "checkout.session.completed",
		data: {
			object: {
				id: "cs_REACT",
				payment_status: "paid",
				subscription: "sub_NEW",
				customer: "cus_FAKE",
				metadata: { reactivateStoreId: storeId },
			},
		},
	};
}

async function deliver(event: any) {
	currentEvent = event;
	await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });
}

describe("createReactivationCheckoutSession", () => {
	it("creates a subscription Checkout on the store-creation price, tagged with the store", async () => {
		const { sellerProfileId, storeId } = await seed("canceled");

		const result = await createReactivationCheckoutSession({
			sellerProfileId,
			storeId,
		});

		expect(result.checkoutUrl).toBe("https://stripe.test/checkout/cs_REACT");
		expect(sessionCreate).toHaveBeenCalledTimes(1);
		const params = sessionCreate.mock.calls[0][0];
		expect(params.mode).toBe("subscription");
		expect(params.customer).toBe("cus_FAKE");
		expect(params.line_items).toEqual([{ price: "price_FAKE", quantity: 1 }]);
		expect(params.metadata).toEqual({ reactivateStoreId: storeId });
		expect(params.subscription_data.metadata).toEqual({
			reactivateStoreId: storeId,
		});
		expect(params.success_url).toStartWith("http://seller.test/billing");
		expect(params.cancel_url).toStartWith("http://seller.test/billing");
	});

	it("reuses a still-open reactivation session for the same store", async () => {
		const { sellerProfileId, storeId } = await seed("canceled");
		sessionList.mockImplementation(async () => ({
			data: [
				{
					id: "cs_OTHER",
					url: "https://stripe.test/other",
					metadata: { reactivateStoreId: "another-store" },
				},
				{
					id: "cs_OPEN",
					url: "https://stripe.test/open",
					metadata: { reactivateStoreId: storeId },
				},
			],
		}));

		const result = await createReactivationCheckoutSession({
			sellerProfileId,
			storeId,
		});

		expect(result.checkoutUrl).toBe("https://stripe.test/open");
		expect(sessionCreate).not.toHaveBeenCalled();
	});

	for (const status of [
		"active",
		"past_due",
		"canceling",
		"suspended",
	] as const) {
		it(`409 when the subscription is ${status}`, async () => {
			const { sellerProfileId, storeId } = await seed(status);
			await expect(
				createReactivationCheckoutSession({ sellerProfileId, storeId }),
			).rejects.toMatchObject({ status: 409 });
			expect(sessionCreate).not.toHaveBeenCalled();
		});
	}

	it("403 when the store belongs to another seller", async () => {
		const { storeId } = await seed("canceled");
		const { profile: intruder } = await createTestSeller(getTestDb(), {
			email: "intruder@test.it",
		});
		await expect(
			createReactivationCheckoutSession({
				sellerProfileId: intruder.id,
				storeId,
			}),
		).rejects.toMatchObject({ status: 403 });
		expect(sessionCreate).not.toHaveBeenCalled();
	});

	it("404 for an unknown store", async () => {
		const { sellerProfileId } = await seed("canceled");
		await expect(
			createReactivationCheckoutSession({
				sellerProfileId,
				storeId: "missing",
			}),
		).rejects.toMatchObject({ status: 404 });
	});
});

describe("checkout.session.completed with reactivateStoreId", () => {
	it("restores the store and attaches the new subscription as active", async () => {
		const { sellerProfileId, storeId, sub } = await seed("canceled");
		const product = await createTestProduct(getTestDb(), sellerProfileId);
		await createTestStoreProduct(getTestDb(), storeId, product.id, {
			stock: 7,
		});

		await deliver(completedEvent("evt_REACT_1", storeId));

		const [after] = await getTestDb()
			.select()
			.from(storeSubscription)
			.where(eq(storeSubscription.id, sub.id));
		expect(after.stripeSubscriptionId).toBe("sub_NEW");
		expect(after.stripePriceId).toBe("price_FAKE");
		expect(after.status).toBe("active");
		expect(after.feeAmountCents).toBe(3500);
		expect(after.currency).toBe("EUR");
		expect(after.cancelReason).toBeNull();
		expect(after.canceledAt).toBeNull();
		expect(after.suspendedAt).toBeNull();
		expect(after.cancelAtPeriodEnd).toBe(false);
		expect(Math.floor(after.currentPeriodEnd.getTime() / 1000)).toBe(
			NEW_PERIOD_END,
		);

		const [storeAfter] = await getTestDb()
			.select()
			.from(store)
			.where(eq(store.id, storeId));
		expect(storeAfter.deletedAt).toBeNull();

		// Catalog untouched by the whole cancel → reactivate cycle.
		const stock = await getTestDb()
			.select()
			.from(storeProduct)
			.where(eq(storeProduct.storeId, storeId));
		expect(stock).toHaveLength(1);
		expect(stock[0].stock).toBe(7);

		expect(subCancel).not.toHaveBeenCalled();
	});

	it("is idempotent on a second event for the same subscription", async () => {
		const { storeId } = await seed("canceled");
		await deliver(completedEvent("evt_REACT_A", storeId));
		await deliver(completedEvent("evt_REACT_B", storeId));

		const rows = await getTestDb()
			.select()
			.from(storeSubscription)
			.where(eq(storeSubscription.storeId, storeId));
		expect(rows).toHaveLength(1);
		expect(rows[0].stripeSubscriptionId).toBe("sub_NEW");
		expect(subCancel).not.toHaveBeenCalled();
	});

	it("cancels the new subscription when the store is no longer canceled", async () => {
		// e.g. two checkouts paid from two tabs: the first one already revived it.
		const { storeId, sub } = await seed("active");
		await deliver(completedEvent("evt_REACT_DUP", storeId));

		expect(subCancel).toHaveBeenCalledWith("sub_NEW");
		const [after] = await getTestDb()
			.select()
			.from(storeSubscription)
			.where(eq(storeSubscription.id, sub.id));
		expect(after.stripeSubscriptionId).toBe("sub_OLD");
		expect(after.status).toBe("active");
	});

	it("does not touch the store-creation path (no pending required)", async () => {
		const { storeId } = await seed("canceled");
		await deliver(completedEvent("evt_REACT_NOPENDING", storeId));
		const stores = await getTestDb().select().from(store);
		expect(stores).toHaveLength(1);
	});
});
