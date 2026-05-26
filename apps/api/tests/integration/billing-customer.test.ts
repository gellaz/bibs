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

const fakeStripeCustomer = { id: "cus_FAKE123" };
const customersCreate = mock(async () => fakeStripeCustomer);
const customersRetrieve = mock(async () => fakeStripeCustomer);

mock.module("@/lib/stripe", () => ({
	stripe: {
		customers: {
			create: customersCreate,
			retrieve: customersRetrieve,
		},
	},
}));

import { eq } from "drizzle-orm";
import { sellerProfile } from "@/db/schemas/seller";
import { getOrCreateStripeCustomer } from "@/modules/billing/services/customer";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller } from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
	customersCreate.mockClear();
	customersRetrieve.mockClear();
});

describe("getOrCreateStripeCustomer", () => {
	it("creates a Stripe customer on first call and persists it on sellerProfile", async () => {
		const { profile } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});

		const customerId = await getOrCreateStripeCustomer(profile.id);

		expect(customerId).toBe("cus_FAKE123");
		expect(customersCreate).toHaveBeenCalledTimes(1);

		const updated = await getTestDb()
			.select()
			.from(sellerProfile)
			.where(eq(sellerProfile.id, profile.id))
			.then((r) => r[0]);
		expect(updated.stripeCustomerId).toBe("cus_FAKE123");
	});

	it("returns the cached customer id on subsequent calls (no new create)", async () => {
		const { profile } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});
		await getTestDb()
			.update(sellerProfile)
			.set({ stripeCustomerId: "cus_EXISTING" })
			.where(eq(sellerProfile.id, profile.id));

		const customerId = await getOrCreateStripeCustomer(profile.id);

		expect(customerId).toBe("cus_EXISTING");
		expect(customersCreate).not.toHaveBeenCalled();
	});
});
