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

const subUpdate = mock(async () => ({}));
const subCancel = mock(async () => ({}));

mock.module("@/lib/stripe", () => ({
	stripe: {
		subscriptions: { update: subUpdate, cancel: subCancel },
	},
}));

import { eq } from "drizzle-orm";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { ServiceError } from "@/lib/errors";
import {
	cancelStoreSubscription,
	reactivateStoreSubscription,
} from "@/modules/seller/services/stores";
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
	subUpdate.mockClear();
	subCancel.mockClear();
});

async function seedSub(
	status: "active" | "past_due" | "suspended" | "canceling" | "canceled",
) {
	const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });
	const storeRow = await createTestStore(getTestDb(), profile.id);
	const [sub] = await getTestDb()
		.insert(storeSubscription)
		.values({
			storeId: storeRow.id,
			stripeSubscriptionId: `sub_${status}`,
			stripeCustomerId: "cus_FAKE",
			stripePriceId: "price_FAKE",
			feeAmountCents: 2900,
			currency: "EUR",
			status,
			currentPeriodEnd: new Date(Date.now() + 15 * 86400000),
		})
		.returning();
	return { sellerProfileId: profile.id, storeId: storeRow.id, sub };
}

describe("cancelStoreSubscription", () => {
	it("active → calls subscriptions.update(cancel_at_period_end=true), sets cancelReason", async () => {
		const { sellerProfileId, storeId, sub } = await seedSub("active");
		const result = await cancelStoreSubscription({ sellerProfileId, storeId });
		expect(result.status).toBe("canceling");
		expect(subUpdate).toHaveBeenCalledWith("sub_active", {
			cancel_at_period_end: true,
		});
		const updated = await getTestDb()
			.select()
			.from(storeSubscription)
			.where(eq(storeSubscription.id, sub.id))
			.then((r) => r[0]);
		expect(updated.cancelReason).toBe("seller_canceled");
	});

	it("past_due → cancel_at_period_end=true", async () => {
		const { sellerProfileId, storeId } = await seedSub("past_due");
		const result = await cancelStoreSubscription({ sellerProfileId, storeId });
		expect(result.status).toBe("canceling");
		expect(subUpdate).toHaveBeenCalled();
	});

	it("suspended → calls subscriptions.cancel (immediate)", async () => {
		const { sellerProfileId, storeId } = await seedSub("suspended");
		const result = await cancelStoreSubscription({ sellerProfileId, storeId });
		expect(result.status).toBe("canceled");
		expect(subCancel).toHaveBeenCalledWith("sub_suspended");
	});

	it("canceling → idempotent", async () => {
		const { sellerProfileId, storeId } = await seedSub("canceling");
		const result = await cancelStoreSubscription({ sellerProfileId, storeId });
		expect(result.status).toBe("canceling");
		expect(subUpdate).not.toHaveBeenCalled();
		expect(subCancel).not.toHaveBeenCalled();
	});

	it("canceled → throws 404", async () => {
		const { sellerProfileId, storeId } = await seedSub("canceled");
		await expect(
			cancelStoreSubscription({ sellerProfileId, storeId }),
		).rejects.toBeInstanceOf(ServiceError);
	});

	it("active → Stripe update rejects → cancelReason is NOT persisted", async () => {
		const { sellerProfileId, storeId, sub } = await seedSub("active");
		// One-shot rejection; the resolving default is restored afterward.
		subUpdate.mockRejectedValueOnce(new Error("stripe down"));

		await expect(
			cancelStoreSubscription({ sellerProfileId, storeId }),
		).rejects.toThrow();

		const updated = await getTestDb()
			.select()
			.from(storeSubscription)
			.where(eq(storeSubscription.id, sub.id))
			.then((r) => r[0]);
		// Stripe ran first and failed, so the DB write never happened.
		expect(updated.cancelReason).toBeNull();
	});

	it("suspended → Stripe cancel rejects → cancelReason is NOT persisted", async () => {
		const { sellerProfileId, storeId, sub } = await seedSub("suspended");
		subCancel.mockRejectedValueOnce(new Error("stripe down"));

		await expect(
			cancelStoreSubscription({ sellerProfileId, storeId }),
		).rejects.toThrow();

		const updated = await getTestDb()
			.select()
			.from(storeSubscription)
			.where(eq(storeSubscription.id, sub.id))
			.then((r) => r[0]);
		expect(updated.cancelReason).toBeNull();
	});
});

describe("reactivateStoreSubscription", () => {
	it("canceling → calls subscriptions.update(cancel_at_period_end=false)", async () => {
		const { sellerProfileId, storeId } = await seedSub("canceling");
		const result = await reactivateStoreSubscription({
			sellerProfileId,
			storeId,
		});
		expect(result.status).toBe("active");
		expect(subUpdate).toHaveBeenCalledWith("sub_canceling", {
			cancel_at_period_end: false,
		});
	});

	it("active → throws 409", async () => {
		const { sellerProfileId, storeId } = await seedSub("active");
		await expect(
			reactivateStoreSubscription({ sellerProfileId, storeId }),
		).rejects.toBeInstanceOf(ServiceError);
	});
});
