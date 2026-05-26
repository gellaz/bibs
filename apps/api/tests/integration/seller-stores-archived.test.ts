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

import { eq } from "drizzle-orm";
import { store } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { listArchivedStores } from "@/modules/seller/services/stores";
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

describe("listArchivedStores", () => {
	it("returns only stores with deletedAt set", async () => {
		const { profile } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});
		const archived = await createTestStore(getTestDb(), profile.id);
		await createTestStore(getTestDb(), profile.id);

		await getTestDb()
			.update(store)
			.set({ deletedAt: new Date() })
			.where(eq(store.id, archived.id));

		await getTestDb().insert(storeSubscription).values({
			storeId: archived.id,
			stripeSubscriptionId: "sub_archived",
			stripeCustomerId: "cus_FAKE",
			stripePriceId: "price_FAKE",
			feeAmountCents: 2900,
			currency: "EUR",
			status: "canceled",
			currentPeriodEnd: new Date(),
			canceledAt: new Date(),
			cancelReason: "seller_canceled",
		});

		const result = await listArchivedStores({
			sellerProfileId: profile.id,
			page: 1,
			limit: 50,
		});

		expect(result.data).toHaveLength(1);
		expect(result.data[0].id).toBe(archived.id);
		expect(result.data[0].cancelReason).toBe("seller_canceled");
		expect(result.data[0].canceledAt).toBeTruthy();
	});
});
