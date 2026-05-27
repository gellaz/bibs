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

let currentEvent: any = null;

mock.module("@/lib/stripe", () => ({
	stripe: {
		webhooks: { constructEventAsync: async () => currentEvent },
	},
}));

mock.module("@/lib/env", () => ({
	env: { STRIPE_WEBHOOK_SECRET: "whsec_FAKE" },
}));

import { eq } from "drizzle-orm";
import { store } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { handleStripeWebhook } from "@/modules/webhooks/services/dispatcher";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller, createTestStore } from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

async function seedActiveSubscription(stripeSubId: string) {
	const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });
	const storeRow = await createTestStore(getTestDb(), profile.id);
	const [sub] = await getTestDb()
		.insert(storeSubscription)
		.values({
			storeId: storeRow.id,
			stripeSubscriptionId: stripeSubId,
			stripeCustomerId: "cus_FAKE",
			stripePriceId: "price_FAKE",
			feeAmountCents: 2900,
			currency: "EUR",
			status: "active",
			currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
		})
		.returning();
	return { sub, storeRow };
}

describe("customer.subscription.updated", () => {
	it("transitions to past_due on sub.status='past_due'", async () => {
		const { sub } = await seedActiveSubscription("sub_PD");
		currentEvent = {
			id: "evt_SUB_PD",
			type: "customer.subscription.updated",
			data: {
				object: {
					id: "sub_PD",
					status: "past_due",
					cancel_at_period_end: false,
					items: {
						data: [
							{
								current_period_end: Math.floor(
									sub.currentPeriodEnd.getTime() / 1000,
								),
							},
						],
					},
				},
			},
		};

		await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

		const after = await getTestDb()
			.select()
			.from(storeSubscription)
			.where(eq(storeSubscription.id, sub.id))
			.then((r) => r[0]);
		expect(after.status).toBe("past_due");
	});

	it("transitions to suspended (and sets suspendedAt) on sub.status='unpaid'", async () => {
		const { sub } = await seedActiveSubscription("sub_UNPAID");
		currentEvent = {
			id: "evt_SUB_UNPAID",
			type: "customer.subscription.updated",
			data: {
				object: {
					id: "sub_UNPAID",
					status: "unpaid",
					cancel_at_period_end: false,
					items: {
						data: [{ current_period_end: Math.floor(Date.now() / 1000) }],
					},
				},
			},
		};

		await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

		const after = await getTestDb()
			.select()
			.from(storeSubscription)
			.where(eq(storeSubscription.id, sub.id))
			.then((r) => r[0]);
		expect(after.status).toBe("suspended");
		expect(after.suspendedAt).toBeTruthy();
	});

	it("transitions to canceling on cancel_at_period_end=true", async () => {
		const { sub } = await seedActiveSubscription("sub_CXL");
		currentEvent = {
			id: "evt_SUB_CXL",
			type: "customer.subscription.updated",
			data: {
				object: {
					id: "sub_CXL",
					status: "active",
					cancel_at_period_end: true,
					items: {
						data: [
							{
								current_period_end: Math.floor(
									sub.currentPeriodEnd.getTime() / 1000,
								),
							},
						],
					},
				},
			},
		};

		await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

		const after = await getTestDb()
			.select()
			.from(storeSubscription)
			.where(eq(storeSubscription.id, sub.id))
			.then((r) => r[0]);
		expect(after.status).toBe("canceling");
		expect(after.cancelAtPeriodEnd).toBe(true);
	});

	it("clears suspendedAt when transitioning back to active", async () => {
		const { sub } = await seedActiveSubscription("sub_REVIVE");
		await getTestDb()
			.update(storeSubscription)
			.set({ status: "suspended", suspendedAt: new Date() })
			.where(eq(storeSubscription.id, sub.id));

		currentEvent = {
			id: "evt_SUB_REVIVE",
			type: "customer.subscription.updated",
			data: {
				object: {
					id: "sub_REVIVE",
					status: "active",
					cancel_at_period_end: false,
					items: {
						data: [
							{
								current_period_end: Math.floor(
									(Date.now() + 30 * 86400000) / 1000,
								),
							},
						],
					},
				},
			},
		};

		await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

		const after = await getTestDb()
			.select()
			.from(storeSubscription)
			.where(eq(storeSubscription.id, sub.id))
			.then((r) => r[0]);
		expect(after.status).toBe("active");
		expect(after.suspendedAt).toBeNull();
	});
});

describe("customer.subscription.deleted", () => {
	it("sets status=canceled, canceledAt, and soft-deletes the store", async () => {
		const { sub, storeRow } = await seedActiveSubscription("sub_DELETE");

		currentEvent = {
			id: "evt_SUB_DELETED",
			type: "customer.subscription.deleted",
			data: { object: { id: "sub_DELETE" } },
		};

		await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

		const afterSub = await getTestDb()
			.select()
			.from(storeSubscription)
			.where(eq(storeSubscription.id, sub.id))
			.then((r) => r[0]);
		expect(afterSub.status).toBe("canceled");
		expect(afterSub.canceledAt).toBeTruthy();

		const afterStore = await getTestDb()
			.select()
			.from(store)
			.where(eq(store.id, storeRow.id))
			.then((r) => r[0]);
		expect(afterStore.deletedAt).toBeTruthy();
	});
});
