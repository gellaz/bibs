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
mock.module("@/lib/stripe", () => ({
	stripe: {
		prices: { create: priceCreate },
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
});
