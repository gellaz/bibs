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
import { store } from "@/db/schemas/store";
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

	async function seedSuspendedSub(stripeSubscriptionId: string) {
		const { profile } = await createTestSeller(getTestDb(), {
			email: `s-${stripeSubscriptionId}@b.it`,
		});
		const storeRow = await createTestStore(getTestDb(), profile.id);
		await getTestDb()
			.insert(storeSubscription)
			.values({
				storeId: storeRow.id,
				stripeSubscriptionId,
				stripeCustomerId: "cus_FAKE",
				stripePriceId: "price_FAKE",
				feeAmountCents: 2900,
				currency: "EUR",
				status: "suspended",
				currentPeriodEnd: new Date(),
				suspendedAt: new Date(Date.now() - 61 * 86400000),
			});
		return { storeId: storeRow.id };
	}

	async function readStatus(stripeSubscriptionId: string) {
		const row = await getTestDb()
			.select()
			.from(storeSubscription)
			.where(eq(storeSubscription.stripeSubscriptionId, stripeSubscriptionId))
			.then((r) => r[0]);
		return row.status;
	}

	it("finalizes suspended → canceled so a second run selects zero rows", async () => {
		await seedSuspendedSub("sub_HAPPY");

		const first = await runAutoCancelSuspended();
		expect(first.canceled).toBe(1);
		expect(subCancel).toHaveBeenCalledWith("sub_HAPPY");
		// 'canceled' (not 'canceling') — the dead sub stays out of billable/MRR/
		// reactivate queries and is not re-selected.
		expect(await readStatus("sub_HAPPY")).toBe("canceled");

		// Second run: the row is no longer 'suspended', so nothing is re-selected.
		subCancel.mockClear();
		const second = await runAutoCancelSuspended();
		expect(second.canceled).toBe(0);
		expect(subCancel).not.toHaveBeenCalled();
	});

	it("already-canceled Stripe error finalizes to canceled and soft-deletes the store", async () => {
		const { storeId } = await seedSuspendedSub("sub_GONE");
		subCancel.mockImplementationOnce(async () => {
			throw Object.assign(new Error("No such subscription"), {
				code: "resource_missing",
			});
		});

		const result = await runAutoCancelSuspended();
		// Treated as success: the sub is provably gone on Stripe.
		expect(result.canceled).toBe(1);
		expect(await readStatus("sub_GONE")).toBe("canceled");
		// The store is finalized locally rather than relying on a webhook that may
		// never arrive for an out-of-band deletion.
		const [storeRow] = await getTestDb()
			.select()
			.from(store)
			.where(eq(store.id, storeId));
		expect(storeRow.deletedAt).not.toBeNull();

		subCancel.mockClear();
		const second = await runAutoCancelSuspended();
		expect(second.canceled).toBe(0);
		expect(subCancel).not.toHaveBeenCalled();
	});

	it("transient Stripe error reverts canceled → suspended so the next run retries", async () => {
		await seedSuspendedSub("sub_FLAKY");
		subCancel.mockImplementationOnce(async () => {
			throw Object.assign(new Error("Stripe is down"), { code: "api_error" });
		});

		const first = await runAutoCancelSuspended();
		expect(first.canceled).toBe(0);
		// Reverted, so it is re-selectable; the pre-set reason persists.
		expect(await readStatus("sub_FLAKY")).toBe("suspended");
		const reverted = await getTestDb()
			.select()
			.from(storeSubscription)
			.where(eq(storeSubscription.stripeSubscriptionId, "sub_FLAKY"))
			.then((r) => r[0]);
		expect(reverted.cancelReason).toBe("payment_failed_auto");
		expect(reverted.canceledAt).toBeNull();

		// Next run with the default resolving mock succeeds and finalizes the row.
		subCancel.mockClear();
		const second = await runAutoCancelSuspended();
		expect(second.canceled).toBe(1);
		expect(subCancel).toHaveBeenCalledWith("sub_FLAKY");
		expect(await readStatus("sub_FLAKY")).toBe("canceled");
	});
});
