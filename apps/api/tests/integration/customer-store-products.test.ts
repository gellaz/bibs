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
import { product } from "@/db/schemas/product";
import { store } from "@/db/schemas/store";
import { getStoreProducts } from "@/modules/customer/services/store-products";
import { truncateAll } from "../helpers/cleanup";
import {
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

async function visibleStore(sellerProfileId: string, name = "Negozio") {
	const db = getTestDb();
	const s = await createTestStore(db, sellerProfileId, { name });
	await createTestStoreSubscription(db, s.id, { status: "active" });
	return s;
}

describe("getStoreProducts — visible store", () => {
	it("returns only active, in-stock products of this store, with images + discount", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id);
		const other = await visibleStore(profile.id, "Altro");

		// Included: active + stock>0 here
		const p1 = await createTestProduct(db, profile.id, {
			name: "Incluso",
			price: "10.00",
		});
		await createTestStoreProduct(db, s.id, p1.id, { stock: 5 });
		await createTestProductImage(db, p1.id, {
			url: "https://img.test/b.jpg",
			position: 2,
		});
		await createTestProductImage(db, p1.id, {
			url: "https://img.test/a.jpg",
			position: 0,
		});
		// 20% discount on p1 → 10.00 → 8.00
		const d = await createTestDiscount(db, profile.id, { percent: 20 });
		await createTestDiscountProduct(db, d.id, p1.id);

		// Excluded: stock 0 here
		const p2 = await createTestProduct(db, profile.id, { name: "Esaurito" });
		await createTestStoreProduct(db, s.id, p2.id, { stock: 0 });
		// Excluded: disabled status
		const p3 = await createTestProduct(db, profile.id, {
			name: "Disattivato",
			status: "disabled",
		});
		await createTestStoreProduct(db, s.id, p3.id, { stock: 5 });
		// Excluded: stocked only in another store
		const p4 = await createTestProduct(db, profile.id, { name: "Altrove" });
		await createTestStoreProduct(db, other.id, p4.id, { stock: 5 });

		const result = await getStoreProducts(s.id, {});

		expect(result.data.map((p) => p.name)).toEqual(["Incluso"]);
		expect(result.pagination.total).toBe(1);
		const row = result.data[0];
		// images ordered by position
		expect(row.images.map((i) => i.url)).toEqual([
			"https://img.test/a.jpg",
			"https://img.test/b.jpg",
		]);
		// discount annotated
		expect(row.discountedPrice).toBe("8.00");
		expect(row.discountPercent).toBe(20);
	});

	it("orders products newest-first (created_at desc)", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id);

		const pOld = await createTestProduct(db, profile.id, { name: "Vecchio" });
		const pNew = await createTestProduct(db, profile.id, { name: "Nuovo" });
		await createTestStoreProduct(db, s.id, pOld.id, { stock: 5 });
		await createTestStoreProduct(db, s.id, pNew.id, { stock: 5 });
		await db
			.update(product)
			.set({ createdAt: new Date("2026-01-01T00:00:00Z") })
			.where(eq(product.id, pOld.id));
		await db
			.update(product)
			.set({ createdAt: new Date("2026-06-01T00:00:00Z") })
			.where(eq(product.id, pNew.id));

		const result = await getStoreProducts(s.id, {});
		expect(result.data.map((p) => p.name)).toEqual(["Nuovo", "Vecchio"]);
	});

	it("returns an empty page (200, not 404) for a visible store with no products", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id);
		const result = await getStoreProducts(s.id, {});
		expect(result.data).toEqual([]);
		expect(result.pagination.total).toBe(0);
	});

	it("paginates: total counts all, pages slice", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id);
		for (let i = 0; i < 3; i++) {
			const p = await createTestProduct(db, profile.id, { name: `P${i}` });
			await createTestStoreProduct(db, s.id, p.id, { stock: 5 });
		}
		const page1 = await getStoreProducts(s.id, { page: 1, limit: 2 });
		const page2 = await getStoreProducts(s.id, { page: 2, limit: 2 });
		expect(page1.pagination.total).toBe(3);
		expect(page1.data).toHaveLength(2);
		expect(page2.data).toHaveLength(1);
		// no overlap
		const ids = new Set([...page1.data, ...page2.data].map((p) => p.id));
		expect(ids.size).toBe(3);
	});
});

describe("getStoreProducts — visibility (404)", () => {
	it("404 for a non-existent id", async () => {
		await expect(getStoreProducts("does-not-exist", {})).rejects.toThrow(
			"Negozio non trovato",
		);
	});

	it("404 for a store with no subscription", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await createTestStore(db, profile.id, {
			name: "SenzaAbbonamento",
		});
		await expect(getStoreProducts(s.id, {})).rejects.toThrow(
			"Negozio non trovato",
		);
	});

	it("404 for suspended and canceled subscriptions", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const suspended = await createTestStore(db, profile.id, {
			name: "Sospeso",
		});
		await createTestStoreSubscription(db, suspended.id, {
			status: "suspended",
		});
		const canceled = await createTestStore(db, profile.id, {
			name: "Cancellato",
		});
		await createTestStoreSubscription(db, canceled.id, { status: "canceled" });
		await expect(getStoreProducts(suspended.id, {})).rejects.toThrow(
			"Negozio non trovato",
		);
		await expect(getStoreProducts(canceled.id, {})).rejects.toThrow(
			"Negozio non trovato",
		);
	});

	it("404 for a soft-deleted store", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id, "Eliminato");
		await db
			.update(store)
			.set({ deletedAt: new Date() })
			.where(eq(store.id, s.id));
		await expect(getStoreProducts(s.id, {})).rejects.toThrow(
			"Negozio non trovato",
		);
	});
});
