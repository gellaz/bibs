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

import { storeSubscription } from "@/db/schemas/store-subscription";
import { getBillingOverview } from "@/modules/admin/services/billing";
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

async function seedSubs(
	sellerProfileId: string,
	specs: Array<{
		status: "active" | "past_due" | "canceling" | "suspended" | "canceled";
		fee: number;
	}>,
) {
	for (let i = 0; i < specs.length; i++) {
		const storeRow = await createTestStore(getTestDb(), sellerProfileId);
		await getTestDb()
			.insert(storeSubscription)
			.values({
				storeId: storeRow.id,
				stripeSubscriptionId: `sub_${sellerProfileId}_${i}`,
				stripeCustomerId: "cus_FAKE",
				stripePriceId: "price_FAKE",
				feeAmountCents: specs[i].fee,
				currency: "EUR",
				status: specs[i].status,
				currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
			});
	}
}

describe("getBillingOverview", () => {
	it("aggregates MRR over billable subs and counts by state", async () => {
		const { profile: a } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});
		const { profile: b } = await createTestSeller(getTestDb(), {
			email: "b@c.it",
		});
		await seedSubs(a.id, [
			{ status: "active", fee: 2900 },
			{ status: "past_due", fee: 2900 },
			{ status: "suspended", fee: 2900 },
			{ status: "canceled", fee: 2900 },
		]);
		await seedSubs(b.id, [
			{ status: "active", fee: 1900 },
			{ status: "canceling", fee: 1900 },
		]);

		const o = await getBillingOverview();

		expect(o.mrrCents).toBe(2900 + 2900 + 1900 + 1900);
		expect(o.activeStoresCount).toBe(2);
		expect(o.pastDueCount).toBe(1);
		expect(o.suspendedCount).toBe(1);
		expect(o.cancelingCount).toBe(1);
	});
});
