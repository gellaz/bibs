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
import {
	type OrderStatus,
	type OrderType,
	order,
	orderItem,
} from "@/db/schemas/order";
import { product as productTable, storeProduct } from "@/db/schemas/product";
import { productImage } from "@/db/schemas/product-image";
import { store as storeTable } from "@/db/schemas/store";
import type { StoreSubscriptionStatus } from "@/db/schemas/store-subscription";
import { ServiceError } from "@/lib/errors";
import {
	assignPickupCode,
	cancelOrder,
	createOrder,
	pickupOrder,
} from "@/modules/customer/services/orders";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestBrand,
	createTestCustomer,
	createTestCustomerAddress,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
	createTestStoreSubscription,
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
	await createTestStoreSubscription(db, testStore.id);
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

	it("populates snapshot fields on order_items at checkout", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db, { email: "snap@test.com" });
		const testStore = await createTestStore(db, seller.profile.id);
		await createTestStoreSubscription(db, testStore.id);
		const b = await createTestBrand(db, seller.profile.id, "Acme");
		const prod = await createTestProduct(db, seller.profile.id, {
			name: "Pizza Margherita",
		});
		// Imposta brand_id e ean dopo la creazione (createTestProduct fixture non li accetta)
		await db
			.update(productTable)
			.set({ brandId: b.id, ean: "12345678" })
			.where(eq(productTable.id, prod.id));
		await db.insert(productImage).values({
			productId: prod.id,
			url: "https://example.com/img.png",
			key: "img-key",
			position: 0,
		});
		const sp = await createTestStoreProduct(db, testStore.id, prod.id, {
			stock: 5,
		});
		const customer = await createTestCustomer(db, { email: "c@test.com" });

		const newOrder = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: testStore.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});

		const items = await db.query.orderItem.findMany({
			where: eq(orderItem.orderId, newOrder.id),
		});
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			productName: "Pizza Margherita",
			productEan: "12345678",
			brandName: "Acme",
			productImageUrl: "https://example.com/img.png",
			productId: prod.id,
			storeProductId: sp.id,
		});
	});

	it("awards loyalty points for direct orders", async () => {
		// Use inline fixtures so we can control stock precisely
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const testStore = await createTestStore(db, seller.profile.id);
		await createTestStoreSubscription(db, testStore.id);
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
		await createTestStoreSubscription(db, testStore.id);
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

describe("createOrder — points CAS guard", () => {
	it("rejects with 409 when the live balance is below a stale points snapshot", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const testStore = await createTestStore(db, seller.profile.id);
		await createTestStoreSubscription(db, testStore.id);
		const prod = await createTestProduct(db, seller.profile.id, {
			price: "10.00",
		});
		const sp = await createTestStoreProduct(db, testStore.id, prod.id, {
			stock: 5,
		});
		// The live balance is 0...
		const customer = await createTestCustomer(db, { points: 0 });

		// ...but we pass a STALE snapshot of 100, as if it were read before a
		// concurrent checkout drained the balance. The pre-tx affordability check
		// passes on the snapshot; the in-tx CAS must catch the real shortfall.
		await expect(
			createOrder({
				customerProfileId: customer.profile.id,
				customerPoints: 100,
				type: "direct",
				storeId: testStore.id,
				items: [{ storeProductId: sp.id, quantity: 1 }],
				pointsToSpend: 100,
			}),
		).rejects.toThrow(/punti insufficienti/i);

		// The transaction rolled back: balance untouched, no order persisted.
		const [profile] = await db
			.select()
			.from(customerProfile)
			.where(eq(customerProfile.id, customer.profile.id));
		expect(profile.points).toBe(0);
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

	// NOTE: the in-tx catch/refetch path (two concurrent callers both pass the
	// pre-tx findFirst, one wins the INSERT and the other gets a 23505 on
	// order_idempotency_key_idx → we re-fetch by key and return the winner
	// instead of surfacing a 409) is CONCURRENCY-ONLY. It cannot be reproduced
	// as a deterministic RED test here: the testcontainer harness serializes
	// transactions, and a sequential second call always hits the pre-tx
	// findFirst fast-path above before ever entering the transaction. The
	// fast-path is covered by the test above; the catch path is covered by
	// design + the isUniqueViolation unit tests in tests/lib/errors.test.ts.
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
		await createTestStoreSubscription(db, testStore.id);
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

// ── createOrder: pickup code ──────────────────────────────────────────────────

describe("createOrder — codice di ritiro", () => {
	it("gli ordini da ritirare hanno un codice, gli altri no", async () => {
		const { store, storeProduct: sp, customer } = await seedBasicFixtures();
		const reserve = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "reserve_pickup",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});
		const direct = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});
		expect(reserve.pickupCode).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
		expect(direct.pickupCode).toBeNull();
	});

	it("rigenera il codice se è già usato da un ordine aperto dello stesso negozio", async () => {
		const { store, customer } = await seedBasicFixtures();
		const db = getTestDb();
		await db.insert(order).values({
			customerProfileId: customer.profile.id,
			storeId: store.id,
			type: "reserve_pickup",
			status: "confirmed",
			total: "1.00",
			pickupCode: "AAAAAA",
		});
		const codes = ["AAAAAA", "BBBBBB"];
		const code = await db.transaction((tx) =>
			assignPickupCode(tx, store.id, () => codes.shift() as string),
		);
		expect(code).toBe("BBBBBB");
	});

	it("un codice di un ordine chiuso si può riusare", async () => {
		const { store, customer } = await seedBasicFixtures();
		const db = getTestDb();
		await db.insert(order).values({
			customerProfileId: customer.profile.id,
			storeId: store.id,
			type: "reserve_pickup",
			status: "completed",
			total: "1.00",
			pickupCode: "AAAAAA",
		});
		const code = await db.transaction((tx) =>
			assignPickupCode(tx, store.id, () => "AAAAAA"),
		);
		expect(code).toBe("AAAAAA");
	});
});

// ── createOrder: only sellable goods ──────────────────────────────────────────

describe("createOrder — sellable only", () => {
	/** A store with two products; `tweak` makes it (or them) unsellable. */
	async function seedSellable(opts: {
		subscription?: StoreSubscriptionStatus | null;
		archived?: boolean;
		secondStatus?: "active" | "disabled" | "trashed";
	}) {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const testStore = await createTestStore(db, seller.profile.id);
		if (opts.subscription !== null)
			await createTestStoreSubscription(db, testStore.id, {
				status: opts.subscription ?? "active",
			});
		if (opts.archived)
			await db
				.update(storeTable)
				.set({ deletedAt: new Date() })
				.where(eq(storeTable.id, testStore.id));
		const p1 = await createTestProduct(db, seller.profile.id);
		const p2 = await createTestProduct(db, seller.profile.id, {
			status: opts.secondStatus ?? "active",
		});
		const sp1 = await createTestStoreProduct(db, testStore.id, p1.id, {
			stock: 10,
		});
		const sp2 = await createTestStoreProduct(db, testStore.id, p2.id, {
			stock: 10,
		});
		const customer = await createTestCustomer(db);
		return { store: testStore, sp1, sp2, customer };
	}

	async function order2(f: Awaited<ReturnType<typeof seedSellable>>) {
		return createOrder({
			customerProfileId: f.customer.profile.id,
			customerPoints: 0,
			type: "pay_pickup",
			storeId: f.store.id,
			items: [
				{ storeProductId: f.sp1.id, quantity: 1 },
				{ storeProductId: f.sp2.id, quantity: 1 },
			],
		});
	}

	async function expectNothingOrdered(
		f: Awaited<ReturnType<typeof seedSellable>>,
	) {
		const db = getTestDb();
		const stocks = await db
			.select({ stock: storeProduct.stock })
			.from(storeProduct)
			.where(eq(storeProduct.storeId, f.store.id));
		expect(stocks.map((r) => r.stock)).toEqual([10, 10]);
		const orders = await db.select({ id: order.id }).from(order);
		expect(orders).toHaveLength(0);
	}

	const unsellable: Array<[string, Parameters<typeof seedSellable>[0]]> = [
		["a store without subscription", { subscription: null }],
		["a suspended store", { subscription: "suspended" }],
		["a canceled store", { subscription: "canceled" }],
		["an archived store", { archived: true }],
		["a disabled product next to a sellable one", { secondStatus: "disabled" }],
		["a trashed product", { secondStatus: "trashed" }],
	];

	for (const [label, opts] of unsellable) {
		it(`refuses an order with ${label}`, async () => {
			const f = await seedSellable(opts);
			await expect(order2(f)).rejects.toMatchObject({ status: 404 });
			await expectNothingOrdered(f);
		});
	}

	it("accepts an order from a canceling store (still public)", async () => {
		const f = await seedSellable({ subscription: "canceling" });
		const created = await order2(f);
		expect(created.status).toBe("confirmed");
	});
});

// ── pickupOrder ───────────────────────────────────────────────────────────────

describe("pickupOrder", () => {
	it("completes a ready_for_pickup pay_pickup order and awards points", async () => {
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
		// The store marks it ready; only then is the pickup the customer's move.
		await db
			.update(order)
			.set({ status: "ready_for_pickup" })
			.where(eq(order.id, newOrder.id));

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

	/** An order of `type` forced to `status`, as if the store had moved it. */
	async function orderAt(type: OrderType, status: OrderStatus) {
		const { store, storeProduct: sp, customer } = await seedBasicFixtures();
		const db = getTestDb();
		const address =
			type === "pay_deliver"
				? await createTestCustomerAddress(db, customer.profile.id)
				: null;
		const created = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: type as "pay_pickup" | "reserve_pickup" | "pay_deliver",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
			shippingAddressId: address?.id,
		});
		await db.update(order).set({ status }).where(eq(order.id, created.id));
		return { orderId: created.id, customer };
	}

	for (const [type, status] of [
		["pay_pickup", "confirmed"],
		["reserve_pickup", "confirmed"],
		["pay_deliver", "shipped"],
		["pay_deliver", "ready_for_pickup"],
	] as const) {
		it(`refuses a customer pickup of a ${type} order in ${status}`, async () => {
			const { orderId, customer } = await orderAt(type, status);
			const db = getTestDb();

			await expect(
				pickupOrder({ orderId, customerProfileId: customer.profile.id }),
			).rejects.toMatchObject({ status: 400 });

			const [after] = await db
				.select({ status: order.status })
				.from(order)
				.where(eq(order.id, orderId));
			expect(after.status).toBe(status);
			const [profile] = await db
				.select({ points: customerProfile.points })
				.from(customerProfile)
				.where(eq(customerProfile.id, customer.profile.id));
			expect(profile.points).toBe(0);
		});
	}

	it("expires a ready reservation past its deadline instead of completing it", async () => {
		const { orderId, customer } = await orderAt(
			"reserve_pickup",
			"ready_for_pickup",
		);
		const db = getTestDb();
		await db
			.update(order)
			.set({ reservationExpiresAt: new Date(Date.now() - 60_000) })
			.where(eq(order.id, orderId));

		await expect(
			pickupOrder({ orderId, customerProfileId: customer.profile.id }),
		).rejects.toMatchObject({ status: 400 });

		const [after] = await db
			.select({ status: order.status })
			.from(order)
			.where(eq(order.id, orderId));
		expect(after.status).toBe("expired");
		// The refund survives the 400: the reserved unit is back on the shelf.
		const [sp] = await db
			.select({ stock: storeProduct.stock })
			.from(storeProduct)
			.innerJoin(orderItem, eq(orderItem.storeProductId, storeProduct.id))
			.where(eq(orderItem.orderId, orderId));
		expect(sp.stock).toBe(10);
	});
});
