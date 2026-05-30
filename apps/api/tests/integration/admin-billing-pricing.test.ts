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

const priceCreate = mock(async () => ({ id: "price_NEW" }));
const priceUpdate = mock(async () => ({ id: "price_NEW", active: false }));
mock.module("@/lib/stripe", () => ({
	stripe: {
		prices: { create: priceCreate, update: priceUpdate },
	},
}));

import { pricingConfig } from "@/db/schemas/pricing-config";
import {
	getCurrentPricing,
	updatePricing,
} from "@/modules/admin/services/billing";
import { truncateAll } from "../helpers/cleanup";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
	await getTestDb().insert(pricingConfig).values({
		storeMonthlyFeeCents: 2900,
		currency: "EUR",
		stripePriceId: "price_OLD",
		suspendedAutoCancelDays: 60,
		pendingCreationExpiryHours: 24,
		isActive: true,
	});
	priceCreate.mockClear();
	priceUpdate.mockClear();
});

describe("getCurrentPricing", () => {
	it("returns the active pricing_config row", async () => {
		const cfg = await getCurrentPricing();
		expect(cfg.storeMonthlyFeeCents).toBe(2900);
		expect(cfg.stripePriceId).toBe("price_OLD");
	});
});

describe("updatePricing", () => {
	it("creates a new Stripe Price and flips is_active", async () => {
		await updatePricing({
			storeMonthlyFeeCents: 3500,
			currency: "EUR",
			suspendedAutoCancelDays: 60,
			pendingCreationExpiryHours: 24,
			productId: "prod_TEST",
			adminUserId: null,
		});

		expect(priceCreate).toHaveBeenCalledWith({
			product: "prod_TEST",
			unit_amount: 3500,
			currency: "eur",
			recurring: { interval: "month" },
		});

		const rows = await getTestDb().select().from(pricingConfig);
		expect(rows).toHaveLength(2);
		const active = rows.find((r) => r.isActive);
		expect(active?.stripePriceId).toBe("price_NEW");
		expect(active?.storeMonthlyFeeCents).toBe(3500);
	});

	it("deactivates the orphaned Stripe Price and rolls back when the DB tx fails", async () => {
		const db = getTestDb();
		// A non-existent createdByUserId triggers a FK violation on the INSERT
		// INSIDE the transaction — a real, deterministic tx failure.
		await expect(
			updatePricing({
				storeMonthlyFeeCents: 3500,
				currency: "EUR",
				suspendedAutoCancelDays: 60,
				pendingCreationExpiryHours: 24,
				productId: "prod_TEST",
				adminUserId: "nonexistent-user-id",
			}),
		).rejects.toThrow();

		// The Price was created before the tx...
		expect(priceCreate).toHaveBeenCalledTimes(1);
		// ...and the orphan was deactivated by the compensation.
		expect(priceUpdate).toHaveBeenCalledWith("price_NEW", { active: false });

		// The tx rolled back: only the original active config remains.
		const rows = await db.select().from(pricingConfig);
		expect(rows).toHaveLength(1);
		expect(rows[0].stripePriceId).toBe("price_OLD");
		expect(rows[0].isActive).toBe(true);
	});

	it("propagates the ORIGINAL tx error even when the Stripe compensation also fails", async () => {
		priceUpdate.mockImplementationOnce(async () => {
			throw new Error("CLEANUP_FAILED");
		});

		let caught: unknown;
		try {
			await updatePricing({
				storeMonthlyFeeCents: 3500,
				currency: "EUR",
				suspendedAutoCancelDays: 60,
				pendingCreationExpiryHours: 24,
				productId: "prod_TEST",
				adminUserId: "nonexistent-user-id",
			});
		} catch (e) {
			caught = e;
		}

		expect(caught).toBeDefined();
		// The original DB error propagates, not the compensation failure.
		expect((caught as Error).message).not.toBe("CLEANUP_FAILED");
		expect(priceUpdate).toHaveBeenCalledTimes(1);
	});
});
