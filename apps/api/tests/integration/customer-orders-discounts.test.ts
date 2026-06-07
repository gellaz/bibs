import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";

// ── Module mocks (hoisted by Bun before all imports) ──────────────────────────
//
// @/db is replaced with a getter that always returns the live test DB instance.
// This ensures service functions use the Testcontainers DB, not the real one.
// The getter is called lazily (inside service function bodies), so it's safe
// even though the DB isn't set up until beforeAll() runs.
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

// ── Imports (resolved after mocks are registered) ─────────────────────────────

import { eq } from "drizzle-orm";
import { orderItem } from "@/db/schemas/order";
import { product as productTable } from "@/db/schemas/product";
import { config } from "@/lib/config";
import { createOrder } from "@/modules/customer/services/orders";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCustomer,
	createTestDiscount,
	createTestDiscountProduct,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
} from "../helpers/fixtures";

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function seedDiscountedFixtures(
	opts: { price?: string; percent?: number } = {},
) {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const testStore = await createTestStore(db, seller.profile.id);
	const prod = await createTestProduct(db, seller.profile.id, {
		price: opts.price ?? "100.00",
	});
	const sp = await createTestStoreProduct(db, testStore.id, prod.id, {
		stock: 10,
	});
	const customer = await createTestCustomer(db);
	return {
		db,
		seller,
		store: testStore,
		product: prod,
		storeProduct: sp,
		customer,
	};
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createOrder — seller percentage discounts", () => {
	it("charges the best active discount price, snapshots list price and percent", async () => {
		const {
			db,
			seller,
			store,
			product,
			storeProduct: sp,
			customer,
		} = await seedDiscountedFixtures();
		const disc = await createTestDiscount(db, seller.profile.id, {
			percent: 25,
		});
		await createTestDiscountProduct(db, disc.id, product.id);

		const result = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 2 }],
		});

		expect(result.total).toBe("150.00"); // 2 × 75.00, not 2 × 100.00
		expect(result.pointsEarned).toBe(150); // points on the charged amount

		const items = await db
			.select()
			.from(orderItem)
			.where(eq(orderItem.orderId, result.id));
		expect(items).toHaveLength(1);
		expect(items[0].unitPrice).toBe("75.00");
		expect(items[0].listPrice).toBe("100.00");
		expect(items[0].discountPercent).toBe(25);
	});

	it("ignores paused, expired and scheduled discounts", async () => {
		const {
			db,
			seller,
			store,
			product,
			storeProduct: sp,
			customer,
		} = await seedDiscountedFixtures();
		const now = Date.now();
		const paused = await createTestDiscount(db, seller.profile.id, {
			percent: 30,
			status: "paused",
		});
		const expired = await createTestDiscount(db, seller.profile.id, {
			percent: 40,
			startsAt: new Date(now - 2 * 86_400_000),
			endsAt: new Date(now - 1 * 86_400_000),
		});
		const scheduled = await createTestDiscount(db, seller.profile.id, {
			percent: 50,
			startsAt: new Date(now + 1 * 86_400_000),
			endsAt: new Date(now + 2 * 86_400_000),
		});
		for (const d of [paused, expired, scheduled])
			await createTestDiscountProduct(db, d.id, product.id);

		const result = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});

		expect(result.total).toBe("100.00");
		const items = await db
			.select()
			.from(orderItem)
			.where(eq(orderItem.orderId, result.id));
		expect(items[0].unitPrice).toBe("100.00");
		expect(items[0].listPrice).toBe("100.00"); // list price snapshot is ALWAYS set on new rows
		expect(items[0].discountPercent).toBeNull();
	});

	it("applies the highest percent when multiple discounts are active", async () => {
		const {
			db,
			seller,
			store,
			product,
			storeProduct: sp,
			customer,
		} = await seedDiscountedFixtures();
		const d10 = await createTestDiscount(db, seller.profile.id, {
			percent: 10,
		});
		const d30 = await createTestDiscount(db, seller.profile.id, {
			percent: 30,
		});
		await createTestDiscountProduct(db, d10.id, product.id);
		await createTestDiscountProduct(db, d30.id, product.id);

		const result = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});

		expect(result.total).toBe("70.00");
	});

	it("does not apply another seller's discount", async () => {
		const {
			db,
			store,
			product,
			storeProduct: sp,
			customer,
		} = await seedDiscountedFixtures();
		const otherSeller = await createTestSeller(db);
		const foreign = await createTestDiscount(db, otherSeller.profile.id, {
			percent: 90,
		});
		// link forced at fixture level (bypasses the service-level same-seller guard)
		await createTestDiscountProduct(db, foreign.id, product.id);

		const result = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});

		expect(result.total).toBe("100.00"); // pricing predicate requires d.seller_profile_id = p.seller_profile_id
	});

	it("applies the points redemption AFTER the seller discount", async () => {
		const {
			db,
			seller,
			store,
			product,
			storeProduct: sp,
		} = await seedDiscountedFixtures();
		const customer = await createTestCustomer(db, {
			points: config.pointsPerEuroDiscount,
		});
		const disc = await createTestDiscount(db, seller.profile.id, {
			percent: 25,
		});
		await createTestDiscountProduct(db, disc.id, product.id);

		const result = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: config.pointsPerEuroDiscount,
			type: "direct",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
			pointsToSpend: config.pointsPerEuroDiscount, // exactly €1 of points discount
		});

		expect(result.total).toBe("74.00"); // (100 → 75 seller discount) − 1.00 points
		expect(result.pointsSpent).toBe(config.pointsPerEuroDiscount);
	});

	it("reflects the discounted gross in vatBreakdown and per-line vatAmount", async () => {
		const {
			db,
			seller,
			store,
			product,
			storeProduct: sp,
			customer,
		} = await seedDiscountedFixtures({ price: "12.20" });
		await db
			.update(productTable)
			.set({ vatRate: "22" })
			.where(eq(productTable.id, product.id));
		const disc = await createTestDiscount(db, seller.profile.id, {
			percent: 50,
		});
		await createTestDiscountProduct(db, disc.id, product.id);

		const result = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});

		// 12.20 → 6.10 charged; scorporo(610, 22): net 500, vat 110
		expect(result.total).toBe("6.10");
		expect(result.vatBreakdown).toEqual([
			{ rate: 22, taxableAmount: "5.00", taxAmount: "1.10" },
		]);
		const items = await db
			.select()
			.from(orderItem)
			.where(eq(orderItem.orderId, result.id));
		expect(items[0].vatAmount).toBe("1.10");
	});

	it("rounds the discounted UNIT price exactly like the displayed price (half away from zero)", async () => {
		const {
			db,
			seller,
			store,
			product,
			storeProduct: sp,
			customer,
		} = await seedDiscountedFixtures({ price: "0.10" });
		const disc = await createTestDiscount(db, seller.profile.id, {
			percent: 25,
		});
		await createTestDiscountProduct(db, disc.id, product.id);

		const result = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 3 }],
		});

		// SQL display: ROUND(0.10 * 0.75, 2) = 0.08 per unit → line = 3 × 0.08 = 0.24
		// (NOT round(0.075 × 3) = 0.23 — unit-first, then × qty)
		const items = await db
			.select()
			.from(orderItem)
			.where(eq(orderItem.orderId, result.id));
		expect(items[0].unitPrice).toBe("0.08");
		expect(result.total).toBe("0.24");
	});
});
