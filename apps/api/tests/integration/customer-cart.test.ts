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
import { cartItem } from "@/db/schemas/cart";
import { storeProduct as storeProductTable } from "@/db/schemas/product";
import { addCartItem } from "@/modules/customer/services/cart";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCartItem,
	createTestCustomer,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
	createTestStoreSubscription,
} from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

/** Negozio pubblicamente visibile: vivo e con abbonamento attivo. */
async function visibleStore(sellerProfileId: string, name = "Negozio") {
	const db = getTestDb();
	const s = await createTestStore(db, sellerProfileId, { name });
	await createTestStoreSubscription(db, s.id, { status: "active" });
	return s;
}

/** Scorciatoia: un negozio visibile con dentro un prodotto attivo e stoccato. */
async function sellableProduct(
	sellerProfileId: string,
	opts: { storeName?: string; price?: string; stock?: number } = {},
) {
	const db = getTestDb();
	const s = await visibleStore(sellerProfileId, opts.storeName ?? "Negozio");
	const p = await createTestProduct(db, sellerProfileId, {
		price: opts.price ?? "10.00",
	});
	const sp = await createTestStoreProduct(db, s.id, p.id, {
		stock: opts.stock ?? 10,
	});
	return { store: s, product: p, storeProduct: sp };
}

describe("cart_items — vincoli di schema", () => {
	it("rejects a quantity outside 1..99", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id);
		const { profile: cp } = await createTestCustomer(db);

		// Wrap in async fns so a real Promise (not the Drizzle query builder
		// thenable) reaches expect().rejects — see db-enum-check-constraints.test.ts.
		const insertWithQuantity = async (quantity: number) =>
			db.insert(cartItem).values({
				customerProfileId: cp.id,
				storeProductId: sp.id,
				quantity,
			});

		await expect(insertWithQuantity(0)).rejects.toThrow();
		await expect(insertWithQuantity(100)).rejects.toThrow();
	});

	it("rejects two rows for the same customer and store product", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id);
		const { profile: cp } = await createTestCustomer(db);

		await createTestCartItem(db, cp.id, sp.id, { quantity: 1 });

		await expect(
			createTestCartItem(db, cp.id, sp.id, { quantity: 2 }),
		).rejects.toThrow();
	});

	it("drops the row when the product leaves the store", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id);
		const { profile: cp } = await createTestCustomer(db);
		await createTestCartItem(db, cp.id, sp.id);

		await db.delete(storeProductTable).where(eq(storeProductTable.id, sp.id));

		const left = await db.select().from(cartItem);
		expect(left).toHaveLength(0);
	});
});

describe("addCartItem", () => {
	it("creates the row, then sums on the second add", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id, {
			stock: 10,
		});
		const { profile: cp } = await createTestCustomer(db);

		const first = await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 2,
		});
		expect(first.quantity).toBe(2);

		const second = await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 3,
		});
		expect(second.id).toBe(first.id);
		expect(second.quantity).toBe(5);

		const rows = await db.select().from(cartItem);
		expect(rows).toHaveLength(1);
	});

	it("refuses a quantity beyond the available stock", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id, {
			stock: 3,
		});
		const { profile: cp } = await createTestCustomer(db);

		await expect(
			addCartItem({
				customerProfileId: cp.id,
				storeProductId: sp.id,
				quantity: 4,
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("refuses when the sum of two adds exceeds the stock", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id, {
			stock: 3,
		});
		const { profile: cp } = await createTestCustomer(db);

		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 2,
		});

		await expect(
			addCartItem({
				customerProfileId: cp.id,
				storeProductId: sp.id,
				quantity: 2,
			}),
		).rejects.toMatchObject({ status: 400 });

		const [stored] = await db
			.select({ quantity: cartItem.quantity })
			.from(cartItem);
		expect(stored.quantity).toBe(2);
	});

	it("refuses to go past the per-row cap", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id, {
			stock: 500,
		});
		const { profile: cp } = await createTestCustomer(db);

		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 99,
		});

		await expect(
			addCartItem({
				customerProfileId: cp.id,
				storeProductId: sp.id,
				quantity: 1,
			}),
		).rejects.toMatchObject({ status: 400 });

		const [stored] = await db
			.select({ quantity: cartItem.quantity })
			.from(cartItem);
		expect(stored.quantity).toBe(99);
	});

	it("refuses a store that is not publicly visible", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		// Negozio senza abbonamento: publiclyVisibleStore() lo esclude
		const s = await createTestStore(db, profile.id, { name: "Invisibile" });
		const p = await createTestProduct(db, profile.id);
		const sp = await createTestStoreProduct(db, s.id, p.id, { stock: 5 });
		const { profile: cp } = await createTestCustomer(db);

		await expect(
			addCartItem({
				customerProfileId: cp.id,
				storeProductId: sp.id,
				quantity: 1,
			}),
		).rejects.toMatchObject({ status: 404 });
	});

	it("refuses a product that is not active", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id);
		const p = await createTestProduct(db, profile.id, { status: "disabled" });
		const sp = await createTestStoreProduct(db, s.id, p.id, { stock: 5 });
		const { profile: cp } = await createTestCustomer(db);

		await expect(
			addCartItem({
				customerProfileId: cp.id,
				storeProductId: sp.id,
				quantity: 1,
			}),
		).rejects.toMatchObject({ status: 404 });
	});

	it("keeps two customers' carts apart", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id);
		const { profile: a } = await createTestCustomer(db);
		const { profile: b } = await createTestCustomer(db);

		await addCartItem({
			customerProfileId: a.id,
			storeProductId: sp.id,
			quantity: 1,
		});
		await addCartItem({
			customerProfileId: b.id,
			storeProductId: sp.id,
			quantity: 4,
		});

		const rows = await db.select().from(cartItem);
		expect(rows).toHaveLength(2);
	});
});
