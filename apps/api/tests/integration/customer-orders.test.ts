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
import { customerProfile } from "@/db/schemas/customer";
import { order, orderItem } from "@/db/schemas/order";
import { storeProduct } from "@/db/schemas/product";
import { ServiceError } from "@/lib/errors";
import {
	cancelOrder,
	createOrder,
	pickupOrder,
} from "@/modules/customer/services/orders";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCustomer,
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

async function seedBasicFixtures() {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const testStore = await createTestStore(db, seller.profile.id);
	const prod = await createTestProduct(db, seller.profile.id, {
		price: "10.00",
	});
	const sp = await createTestStoreProduct(db, testStore.id, prod.id, {
		stock: 10,
	});
	const customer = await createTestCustomer(db);
	return {
		seller,
		store: testStore,
		product: prod,
		storeProduct: sp,
		customer,
	};
}

// ── createOrder ───────────────────────────────────────────────────────────────

describe("createOrder — direct", () => {
	it("creates order with status 'completed' and decrements stock", async () => {
		const { store, storeProduct: sp, customer } = await seedBasicFixtures();
		const db = getTestDb();

		const result = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 2 }],
		});

		expect(result.status).toBe("completed");
		expect(result.type).toBe("direct");
		expect(result.total).toBe("20.00");

		// Stock decremented
		const [updatedSp] = await db
			.select()
			.from(storeProduct)
			.where(eq(storeProduct.id, sp.id));
		expect(updatedSp.stock).toBe(8);

		// Order items created
		const items = await db
			.select()
			.from(orderItem)
			.where(eq(orderItem.orderId, result.id));
		expect(items).toHaveLength(1);
		expect(items[0].quantity).toBe(2);
	});

	it("awards loyalty points for direct orders", async () => {
		// Use inline fixtures so we can control stock precisely
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const testStore = await createTestStore(db, seller.profile.id);
		const prod = await createTestProduct(db, seller.profile.id, {
			price: "10.00",
		});
		// 10 items * €10.00 = €100.00 → 100 points
		const sp = await createTestStoreProduct(db, testStore.id, prod.id, {
			stock: 10,
		});
		const customer = await createTestCustomer(db);

		const result = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: testStore.id,
			items: [{ storeProductId: sp.id, quantity: 10 }],
		});

		// 1 point per euro → 10 items × €10 = €100 = 100 points
		expect(result.pointsEarned).toBe(100);

		const [profile] = await db
			.select()
			.from(customerProfile)
			.where(eq(customerProfile.id, customer.profile.id));
		expect(profile.points).toBe(100);
	});
});

describe("createOrder — pay_pickup", () => {
	it("creates order with status 'confirmed'", async () => {
		const { store, storeProduct: sp, customer } = await seedBasicFixtures();

		const result = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "pay_pickup",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});

		expect(result.status).toBe("confirmed");
		expect(result.type).toBe("pay_pickup");
	});
});

describe("createOrder — reserve_pickup", () => {
	it("sets reservationExpiresAt 48h in the future", async () => {
		const { store, storeProduct: sp, customer } = await seedBasicFixtures();

		const before = Date.now();
		const result = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "reserve_pickup",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});

		expect(result.reservationExpiresAt).not.toBeNull();
		const expiresAt = result.reservationExpiresAt!.getTime();
		// Should be ~48h from now (allow ±5s)
		expect(expiresAt - before).toBeGreaterThan(48 * 3600 * 1000 - 5000);
		expect(expiresAt - before).toBeLessThan(48 * 3600 * 1000 + 5000);
	});
});

describe("createOrder — points discount", () => {
	it("deducts points from customer balance and reduces total", async () => {
		// Fully self-contained to avoid unique-constraint conflicts
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const testStore = await createTestStore(db, seller.profile.id);
		const prod = await createTestProduct(db, seller.profile.id, {
			price: "10.00",
		});
		const sp = await createTestStoreProduct(db, testStore.id, prod.id, {
			stock: 5,
		});
		const customer = await createTestCustomer(db, { points: 100 });

		const result = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 100,
			type: "direct",
			storeId: testStore.id,
			items: [{ storeProductId: sp.id, quantity: 1 }], // €10.00
			pointsToSpend: 100, // 100 pts = €1.00 discount
		});

		// €10.00 - €1.00 = €9.00
		expect(result.total).toBe("9.00");
		expect(result.pointsSpent).toBe(100);

		const [profile] = await db
			.select()
			.from(customerProfile)
			.where(eq(customerProfile.id, customer.profile.id));
		// Points deducted (some earned back from €9.00 direct order: 9 pts)
		expect(profile.points).toBeLessThan(100);
	});
});

describe("createOrder — validation errors", () => {
	it("throws ServiceError 400 when stock is insufficient", async () => {
		const { store, storeProduct: sp, customer } = await seedBasicFixtures();

		await expect(
			createOrder({
				customerProfileId: customer.profile.id,
				customerPoints: 0,
				type: "direct",
				storeId: store.id,
				items: [{ storeProductId: sp.id, quantity: 99 }], // only 10 in stock
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("throws ServiceError 400 when pointsToSpend exceeds balance", async () => {
		const { store, storeProduct: sp, customer } = await seedBasicFixtures();

		await expect(
			createOrder({
				customerProfileId: customer.profile.id,
				customerPoints: 0, // 0 available
				type: "direct",
				storeId: store.id,
				items: [{ storeProductId: sp.id, quantity: 1 }],
				pointsToSpend: 50, // but 0 available
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("throws ServiceError 400 when pay_deliver has no shipping address", async () => {
		const { store, storeProduct: sp, customer } = await seedBasicFixtures();

		await expect(
			createOrder({
				customerProfileId: customer.profile.id,
				customerPoints: 0,
				type: "pay_deliver",
				storeId: store.id,
				items: [{ storeProductId: sp.id, quantity: 1 }],
				// shippingAddressId missing
			}),
		).rejects.toMatchObject({ status: 400 });
	});
});

describe("createOrder — idempotency", () => {
	it("returns the same order when called twice with the same idempotencyKey", async () => {
		const { store, storeProduct: sp, customer } = await seedBasicFixtures();
		const db = getTestDb();
		const idempotencyKey = crypto.randomUUID();

		const first = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
			idempotencyKey,
		});

		const second = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
			idempotencyKey,
		});

		expect(second.id).toBe(first.id);

		// Only one order and one item in DB
		const orders = await db
			.select()
			.from(order)
			.where(eq(order.customerProfileId, customer.profile.id));
		expect(orders).toHaveLength(1);
	});
});

// ── cancelOrder ───────────────────────────────────────────────────────────────

describe("cancelOrder", () => {
	it("cancels a confirmed order and restores stock", async () => {
		const { store, storeProduct: sp, customer } = await seedBasicFixtures();
		const db = getTestDb();

		const newOrder = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "pay_pickup",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 3 }],
		});
		// Stock should now be 7
		const [spAfterOrder] = await db
			.select()
			.from(storeProduct)
			.where(eq(storeProduct.id, sp.id));
		expect(spAfterOrder.stock).toBe(7);

		await cancelOrder({
			orderId: newOrder.id,
			customerProfileId: customer.profile.id,
		});

		// Stock restored
		const [spAfterCancel] = await db
			.select()
			.from(storeProduct)
			.where(eq(storeProduct.id, sp.id));
		expect(spAfterCancel.stock).toBe(10);

		// Order status updated
		const [cancelled] = await db
			.select()
			.from(order)
			.where(eq(order.id, newOrder.id));
		expect(cancelled.status).toBe("cancelled");
	});

	it("refunds spent points when cancelling", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const testStore = await createTestStore(db, seller.profile.id);
		const prod = await createTestProduct(db, seller.profile.id, {
			price: "10.00",
		});
		const sp = await createTestStoreProduct(db, testStore.id, prod.id, {
			stock: 10,
		});
		const customer = await createTestCustomer(db, { points: 100 });

		const newOrder = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 100,
			type: "pay_pickup",
			storeId: testStore.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
			pointsToSpend: 100,
		});

		await cancelOrder({
			orderId: newOrder.id,
			customerProfileId: customer.profile.id,
		});

		const [profile] = await db
			.select()
			.from(customerProfile)
			.where(eq(customerProfile.id, customer.profile.id));
		expect(profile.points).toBe(100); // points refunded
	});

	it("throws ServiceError 400 when trying to cancel a completed order", async () => {
		const { store, storeProduct: sp, customer } = await seedBasicFixtures();

		const newOrder = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct", // direct → completed immediately
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});

		await expect(
			cancelOrder({
				orderId: newOrder.id,
				customerProfileId: customer.profile.id,
			}),
		).rejects.toBeInstanceOf(ServiceError);
	});
});

// ── pickupOrder ───────────────────────────────────────────────────────────────

describe("pickupOrder", () => {
	it("completes a confirmed pay_pickup order and awards points", async () => {
		const { store, storeProduct: sp, customer } = await seedBasicFixtures();
		const db = getTestDb();

		const newOrder = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "pay_pickup",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }], // 10.00€
		});
		expect(newOrder.status).toBe("confirmed");

		const completed = await pickupOrder({
			orderId: newOrder.id,
			customerProfileId: customer.profile.id,
		});

		expect(completed.status).toBe("completed");
		// 1 point per euro → 10 points (10.00€)
		expect(completed.pointsEarned).toBe(10);

		const [profile] = await db
			.select()
			.from(customerProfile)
			.where(eq(customerProfile.id, customer.profile.id));
		expect(profile.points).toBe(10);
	});

	it("throws ServiceError 404 when order does not belong to customer", async () => {
		const { store, storeProduct: sp, customer } = await seedBasicFixtures();
		const db = getTestDb();

		const newOrder = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "pay_pickup",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});

		const otherCustomer = await createTestCustomer(db);

		await expect(
			pickupOrder({
				orderId: newOrder.id,
				customerProfileId: otherCustomer.profile.id,
			}),
		).rejects.toMatchObject({ status: 404 });
	});
});
