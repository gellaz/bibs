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

const subCancel = mock(async () => ({}));
mock.module("@/lib/stripe", () => ({
	stripe: { subscriptions: { cancel: subCancel } },
}));

import { eq } from "drizzle-orm";
import { pricingConfig } from "@/db/schemas/pricing-config";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { runAutoCancelSuspended } from "@/jobs/auto-cancel-suspended-stores";
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

describe("runAutoCancelSuspended", () => {
	it("cancels subs suspended longer than threshold and pre-sets reason", async () => {
		const { profile } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});
		const oldStore = await createTestStore(getTestDb(), profile.id);
		const newStore = await createTestStore(getTestDb(), profile.id);

		const longAgo = new Date(Date.now() - 61 * 86400000);
		const recent = new Date(Date.now() - 10 * 86400000);

		await getTestDb()
			.insert(storeSubscription)
			.values([
				{
					storeId: oldStore.id,
					stripeSubscriptionId: "sub_OLD",
					stripeCustomerId: "cus_FAKE",
					stripePriceId: "price_FAKE",
					feeAmountCents: 2900,
					currency: "EUR",
					status: "suspended",
					currentPeriodEnd: new Date(),
					suspendedAt: longAgo,
				},
				{
					storeId: newStore.id,
					stripeSubscriptionId: "sub_NEW",
					stripeCustomerId: "cus_FAKE",
					stripePriceId: "price_FAKE",
					feeAmountCents: 2900,
					currency: "EUR",
					status: "suspended",
					currentPeriodEnd: new Date(),
					suspendedAt: recent,
				},
			]);

		const result = await runAutoCancelSuspended();

		expect(result.canceled).toBe(1);
		expect(subCancel).toHaveBeenCalledWith("sub_OLD");
		expect(subCancel).not.toHaveBeenCalledWith("sub_NEW");

		const oldSub = await getTestDb()
			.select()
			.from(storeSubscription)
			.where(eq(storeSubscription.stripeSubscriptionId, "sub_OLD"))
			.then((r) => r[0]);
		expect(oldSub.cancelReason).toBe("payment_failed_auto");
	});
});
