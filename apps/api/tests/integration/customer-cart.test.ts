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
