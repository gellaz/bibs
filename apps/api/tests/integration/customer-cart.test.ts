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
import {
	product as productTable,
	storeProduct as storeProductTable,
} from "@/db/schemas/product";
import { store as storeTable } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";
import {
	addCartItem,
	getCart,
	removeCartItem,
	setCartItemQuantity,
} from "@/modules/customer/services/cart";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCartItem,
	createTestCustomer,
	createTestDiscount,
	createTestDiscountProduct,
	createTestProduct,
	createTestProductImage,
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

describe("getCart", () => {
	it("returns zeros for an empty cart", async () => {
		const db = getTestDb();
		const { profile: cp } = await createTestCustomer(db);

		const cart = await getCart(cp.id);

		expect(cart.groups).toEqual([]);
		expect(cart.itemCount).toBe(0);
		expect(cart.total).toBe("0.00");
	});

	it("groups rows by store, ordered by store name", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: spB } = await sellableProduct(profile.id, {
			storeName: "Bottega Zeta",
			price: "5.00",
		});
		const { storeProduct: spA } = await sellableProduct(profile.id, {
			storeName: "Alimentari Alfa",
			price: "3.00",
		});
		const { profile: cp } = await createTestCustomer(db);

		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: spB.id,
			quantity: 1,
		});
		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: spA.id,
			quantity: 2,
		});

		const cart = await getCart(cp.id);

		expect(cart.groups.map((g) => g.store.name)).toEqual([
			"Alimentari Alfa",
			"Bottega Zeta",
		]);
		expect(cart.groups[0].subtotal).toBe("6.00");
		expect(cart.groups[1].subtotal).toBe("5.00");
		expect(cart.itemCount).toBe(3);
		expect(cart.total).toBe("11.00");
	});

	it("prices the line at the discounted price when a promo is active", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id);
		const p = await createTestProduct(db, profile.id, { price: "10.00" });
		const sp = await createTestStoreProduct(db, s.id, p.id, { stock: 10 });
		const d = await createTestDiscount(db, profile.id, { percent: 20 });
		await createTestDiscountProduct(db, d.id, p.id);
		const { profile: cp } = await createTestCustomer(db);

		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 3,
		});

		const cart = await getCart(cp.id);
		const item = cart.groups[0].items[0];

		expect(item.unitPrice).toBe("10.00");
		expect(item.discountedPrice).toBe("8.00");
		expect(item.discountPercent).toBe(20);
		expect(item.lineTotal).toBe("24.00");
		expect(cart.total).toBe("24.00");
	});

	it("flags a line whose stock fell below the quantity, without failing", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id, {
			stock: 5,
			price: "4.00",
		});
		const { profile: cp } = await createTestCustomer(db);
		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 4,
		});

		// Il venditore vende altrove: lo stock scende sotto il carrello
		await db
			.update(storeProductTable)
			.set({ stock: 1 })
			.where(eq(storeProductTable.id, sp.id));

		const cart = await getCart(cp.id);
		const item = cart.groups[0].items[0];

		expect(item.issue).toBe("insufficient_stock");
		expect(item.availableStock).toBe(1);
		// Prezzabile comunque: la riga resta nei totali
		expect(item.lineTotal).toBe("16.00");
		expect(cart.total).toBe("16.00");
	});

	it("flags an unavailable line and keeps it out of the totals", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { store: s, storeProduct: sp } = await sellableProduct(profile.id, {
			price: "9.00",
		});
		const { storeProduct: spOk } = await sellableProduct(profile.id, {
			storeName: "Ancora Viva",
			price: "2.00",
		});
		const { profile: cp } = await createTestCustomer(db);
		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 1,
		});
		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: spOk.id,
			quantity: 1,
		});

		// Il negozio esce dalla visibilità pubblica (soft delete)
		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, s.id));

		const cart = await getCart(cp.id);
		const flagged = cart.groups
			.flatMap((g) => g.items)
			.find((i) => i.storeProductId === sp.id);

		expect(flagged?.issue).toBe("unavailable");
		// Fuori dai totali, ma ancora contata come "roba nel carrello"
		expect(cart.total).toBe("2.00");
		expect(cart.itemCount).toBe(2);
	});

	it("never returns another customer's rows", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id);
		const { profile: a } = await createTestCustomer(db);
		const { profile: b } = await createTestCustomer(db);
		await addCartItem({
			customerProfileId: b.id,
			storeProductId: sp.id,
			quantity: 2,
		});

		const cart = await getCart(a.id);

		expect(cart.groups).toEqual([]);
	});

	it("flags a line as unavailable when the shop's subscription lapses", async () => {
		const db = getTestDb();
		const { store: s, storeProduct: sp } = await sellableProduct(
			(await createTestSeller(db)).profile.id,
			{ price: "7.00" },
		);
		const { profile: cp } = await createTestCustomer(db);
		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 1,
		});

		// Il negozio è vivo, ma l'abbonamento esce dai tre stati "live":
		// publiclyVisibleStore() lo nasconde, e il carrello deve accorgersene.
		await db
			.update(storeSubscription)
			.set({ status: "suspended" })
			.where(eq(storeSubscription.storeId, s.id));

		const cart = await getCart(cp.id);

		expect(cart.groups[0].items[0].issue).toBe("unavailable");
		expect(cart.total).toBe("0.00");
	});

	it("flags a line as unavailable when the product is no longer active", async () => {
		const db = getTestDb();
		const { product: p, storeProduct: sp } = await sellableProduct(
			(await createTestSeller(db)).profile.id,
			{ price: "7.00" },
		);
		const { profile: cp } = await createTestCustomer(db);
		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 1,
		});

		// Qui il negozio resta visibile: a cadere è solo il prodotto.
		await db
			.update(productTable)
			.set({ status: "disabled" })
			.where(eq(productTable.id, p.id));

		const cart = await getCart(cp.id);

		expect(cart.groups[0].items[0].issue).toBe("unavailable");
		expect(cart.total).toBe("0.00");
	});

	it("reads stock 0 as insufficient, not as unavailable", async () => {
		const db = getTestDb();
		const { storeProduct: sp } = await sellableProduct(
			(await createTestSeller(db)).profile.id,
			{ stock: 2, price: "3.00" },
		);
		const { profile: cp } = await createTestCustomer(db);
		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 2,
		});

		await db
			.update(storeProductTable)
			.set({ stock: 0 })
			.where(eq(storeProductTable.id, sp.id));

		const cart = await getCart(cp.id);
		const item = cart.groups[0].items[0];

		expect(item.issue).toBe("insufficient_stock");
		expect(item.availableStock).toBe(0);
		// Ha ancora un prezzo, quindi resta nei totali.
		expect(cart.total).toBe("6.00");
	});

	it("prefers unavailable over insufficient_stock when both apply", async () => {
		const db = getTestDb();
		const { store: s, storeProduct: sp } = await sellableProduct(
			(await createTestSeller(db)).profile.id,
			{ stock: 5 },
		);
		const { profile: cp } = await createTestCustomer(db);
		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 3,
		});

		await db
			.update(storeProductTable)
			.set({ stock: 0 })
			.where(eq(storeProductTable.id, sp.id));
		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, s.id));

		const cart = await getCart(cp.id);

		expect(cart.groups[0].items[0].issue).toBe("unavailable");
	});

	it("returns the product's first image by position", async () => {
		const db = getTestDb();
		const { product: p, storeProduct: sp } = await sellableProduct(
			(await createTestSeller(db)).profile.id,
		);
		await createTestProductImage(db, p.id, {
			url: "https://img.test/second.jpg",
			position: 2,
		});
		await createTestProductImage(db, p.id, {
			url: "https://img.test/first.jpg",
			position: 0,
		});
		const { profile: cp } = await createTestCustomer(db);
		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 1,
		});

		const cart = await getCart(cp.id);

		expect(cart.groups[0].items[0].product.imageUrl).toBe(
			"https://img.test/first.jpg",
		);
	});
});

describe("setCartItemQuantity", () => {
	it("sets the quantity absolutely, not incrementally", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id, {
			stock: 10,
		});
		const { profile: cp } = await createTestCustomer(db);
		const row = await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 5,
		});

		const updated = await setCartItemQuantity({
			cartItemId: row.id,
			customerProfileId: cp.id,
			quantity: 2,
		});

		expect(updated.quantity).toBe(2);
	});

	it("refuses a quantity beyond the available stock", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id, {
			stock: 3,
		});
		const { profile: cp } = await createTestCustomer(db);
		const row = await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 1,
		});

		await expect(
			setCartItemQuantity({
				cartItemId: row.id,
				customerProfileId: cp.id,
				quantity: 4,
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("refuses to go past the per-row cap even when stock is plentiful", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id, {
			stock: 500,
		});
		const { profile: cp } = await createTestCustomer(db);
		const row = await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 1,
		});

		// Senza il tetto lato servizio questa finirebbe sul CHECK del database,
		// cioè un errore grezzo invece di un 400 leggibile.
		await expect(
			setCartItemQuantity({
				cartItemId: row.id,
				customerProfileId: cp.id,
				quantity: 150,
			}),
		).rejects.toMatchObject({ status: 400 });

		const [stored] = await db
			.select({ quantity: cartItem.quantity })
			.from(cartItem);
		expect(stored.quantity).toBe(1);
	});

	it("allows lowering the quantity when stock has fallen below it", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id, {
			stock: 5,
		});
		const { profile: cp } = await createTestCustomer(db);
		const row = await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 4,
		});

		// Il negozio vende quasi tutto: nel carrello resta più merce di quanta
		// ne esista.
		await db
			.update(storeProductTable)
			.set({ stock: 1 })
			.where(eq(storeProductTable.id, sp.id));

		// Ridurre deve restare possibile anche se 3 supera ancora lo stock:
		// altrimenti la riga sarebbe impossibile da correggere e resterebbe
		// bloccata nel carrello.
		const updated = await setCartItemQuantity({
			cartItemId: row.id,
			customerProfileId: cp.id,
			quantity: 3,
		});

		expect(updated.quantity).toBe(3);
	});

	it("still refuses to raise the quantity beyond the stock", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id, {
			stock: 5,
		});
		const { profile: cp } = await createTestCustomer(db);
		const row = await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 2,
		});

		await db
			.update(storeProductTable)
			.set({ stock: 3 })
			.where(eq(storeProductTable.id, sp.id));

		await expect(
			setCartItemQuantity({
				cartItemId: row.id,
				customerProfileId: cp.id,
				quantity: 4,
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("404s on another customer's row instead of 403", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id);
		const { profile: owner } = await createTestCustomer(db);
		const { profile: intruder } = await createTestCustomer(db);
		const row = await addCartItem({
			customerProfileId: owner.id,
			storeProductId: sp.id,
			quantity: 1,
		});

		await expect(
			setCartItemQuantity({
				cartItemId: row.id,
				customerProfileId: intruder.id,
				quantity: 2,
			}),
		).rejects.toMatchObject({ status: 404 });

		// E la riga della vittima è rimasta intatta
		const [untouched] = await db
			.select()
			.from(cartItem)
			.where(eq(cartItem.id, row.id));
		expect(untouched.quantity).toBe(1);
	});
});

describe("removeCartItem", () => {
	it("removes the caller's own row", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id);
		const { profile: cp } = await createTestCustomer(db);
		const row = await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 1,
		});

		await removeCartItem({ cartItemId: row.id, customerProfileId: cp.id });

		const left = await db.select().from(cartItem);
		expect(left).toHaveLength(0);
	});

	it("404s on another customer's row and leaves it alone", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id);
		const { profile: owner } = await createTestCustomer(db);
		const { profile: intruder } = await createTestCustomer(db);
		const row = await addCartItem({
			customerProfileId: owner.id,
			storeProductId: sp.id,
			quantity: 1,
		});

		await expect(
			removeCartItem({ cartItemId: row.id, customerProfileId: intruder.id }),
		).rejects.toMatchObject({ status: 404 });

		const left = await db.select().from(cartItem);
		expect(left).toHaveLength(1);
	});
});
