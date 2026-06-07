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
import {
	getBillingSummary,
	listBillingSubscriptions,
} from "@/modules/seller/services/billing";
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
		periodEnd: Date;
	}>,
) {
	for (let i = 0; i < specs.length; i++) {
		const s = specs[i];
		const storeRow = await createTestStore(getTestDb(), sellerProfileId);
		await getTestDb()
			.insert(storeSubscription)
			.values({
				storeId: storeRow.id,
				stripeSubscriptionId: `sub_${i}_${crypto.randomUUID()}`,
				stripeCustomerId: "cus_FAKE",
				stripePriceId: "price_FAKE",
				feeAmountCents: s.fee,
				currency: "EUR",
				status: s.status,
				currentPeriodEnd: s.periodEnd,
			});
	}
}

describe("getBillingSummary", () => {
	it("aggregates active+past_due+canceling, picks the soonest renewal", async () => {
		const { profile } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});
		await seedSubs(profile.id, [
			{ status: "active", fee: 2900, periodEnd: new Date("2027-01-24") },
			{ status: "past_due", fee: 2900, periodEnd: new Date("2027-01-10") },
			{ status: "canceling", fee: 2900, periodEnd: new Date("2027-01-05") },
			{ status: "suspended", fee: 2900, periodEnd: new Date("2027-01-01") },
			{ status: "canceled", fee: 2900, periodEnd: new Date("2027-01-01") },
		]);

		const summary = await getBillingSummary({ sellerProfileId: profile.id });

		expect(summary.activeStoresCount).toBe(3);
		expect(summary.totalMonthlyCents).toBe(2900 * 3);
		// nextRenewal = il primo rinnovo che AVVERRÀ davvero: solo 'active' rinnova.
		// canceling termina a fine periodo, past_due ha già fallito il rinnovo.
		expect(summary.nextRenewal?.date.toISOString()).toBe(
			new Date("2027-01-24").toISOString(),
		);
		expect(summary.nextRenewal?.storeId).toBeDefined();
	});

	it("returns nextRenewal null when no sub will actually renew", async () => {
		const { profile } = await createTestSeller(getTestDb(), {
			email: "norenew@b.it",
		});
		await seedSubs(profile.id, [
			{ status: "past_due", fee: 2900, periodEnd: new Date("2027-01-10") },
			{ status: "canceling", fee: 2900, periodEnd: new Date("2027-01-05") },
		]);

		const summary = await getBillingSummary({ sellerProfileId: profile.id });

		expect(summary.activeStoresCount).toBe(2); // billable set unchanged
		expect(summary.totalMonthlyCents).toBe(2900 * 2);
		expect(summary.nextRenewal).toBeNull();
	});

	it("returns zeroes for sellers with no active subscriptions", async () => {
		const { profile } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});
		const summary = await getBillingSummary({ sellerProfileId: profile.id });
		expect(summary.activeStoresCount).toBe(0);
		expect(summary.totalMonthlyCents).toBe(0);
		expect(summary.nextRenewal).toBeNull();
	});
});

describe("listBillingSubscriptions", () => {
	it("returns all non-canceled subs (backoffice statuses)", async () => {
		const { profile } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});
		await seedSubs(profile.id, [
			{ status: "active", fee: 2900, periodEnd: new Date("2027-01-24") },
			{ status: "suspended", fee: 2900, periodEnd: new Date("2027-01-01") },
			{ status: "canceled", fee: 2900, periodEnd: new Date("2027-01-01") },
		]);

		const rows = await listBillingSubscriptions({
			sellerProfileId: profile.id,
		});

		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.status).sort()).toEqual(["active", "suspended"]);
	});
});
