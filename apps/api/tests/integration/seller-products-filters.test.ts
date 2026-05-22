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
mock.module("@/lib/s3", () => ({ s3: { delete: mock(async () => {}) } }));

import { addProductsToDiscount } from "@/modules/seller/services/discounts";
import { listProducts } from "@/modules/seller/services/products";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestBrand,
	createTestCategory,
	createTestDiscount,
	createTestMacroCategory,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
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

describe("listProducts with new filters", () => {
	it("storeId optional: omits store filter and returns all seller products", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p1 = await createTestProduct(db, seller.profile.id, { name: "A" });
		const p2 = await createTestProduct(db, seller.profile.id, { name: "B" });

		const out = await listProducts({ sellerProfileId: seller.profile.id });
		expect(out.data.map((p) => p.id).sort()).toEqual([p1.id, p2.id].sort());
	});

	it("filters by brandId", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const brandA = await createTestBrand(db, seller.profile.id, "BrandA");
		const brandB = await createTestBrand(db, seller.profile.id, "BrandB");
		await createTestProduct(db, seller.profile.id, {
			name: "P1",
			brandId: brandA.id,
		});
		await createTestProduct(db, seller.profile.id, {
			name: "P2",
			brandId: brandB.id,
		});

		const out = await listProducts({
			sellerProfileId: seller.profile.id,
			brandId: brandA.id,
		});
		expect(out.data.map((p) => p.name)).toEqual(["P1"]);
	});

	it("filters by price range minPrice/maxPrice", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await createTestProduct(db, seller.profile.id, {
			name: "P5",
			price: "5.00",
		});
		await createTestProduct(db, seller.profile.id, {
			name: "P50",
			price: "50.00",
		});
		await createTestProduct(db, seller.profile.id, {
			name: "P500",
			price: "500.00",
		});

		const out = await listProducts({
			sellerProfileId: seller.profile.id,
			minPrice: "10.00",
			maxPrice: "100.00",
		});
		expect(out.data.map((p) => p.name)).toEqual(["P50"]);
	});

	it("inStock=true requires at least one store with stock>0", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		const pInStock = await createTestProduct(db, seller.profile.id, {
			name: "S",
		});
		const pZero = await createTestProduct(db, seller.profile.id, {
			name: "Z",
		});
		await createTestProduct(db, seller.profile.id, { name: "N" });
		await createTestStoreProduct(db, store.id, pInStock.id, { stock: 3 });
		await createTestStoreProduct(db, store.id, pZero.id, { stock: 0 });

		const out = await listProducts({
			sellerProfileId: seller.profile.id,
			inStock: true,
		});
		expect(out.data.map((p) => p.name)).toEqual(["S"]);
	});

	it("excludeDiscountId hides products already in that discount", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p1 = await createTestProduct(db, seller.profile.id, { name: "P1" });
		await createTestProduct(db, seller.profile.id, { name: "P2" });
		const d = await createTestDiscount(db, seller.profile.id);
		await addProductsToDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			productIds: [p1.id],
		});

		const out = await listProducts({
			sellerProfileId: seller.profile.id,
			excludeDiscountId: d.id,
		});
		expect(out.data.map((p) => p.name)).toEqual(["P2"]);
	});

	it("filters by productMacroCategoryId via the category join", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const macroA = await createTestMacroCategory(db, "MA");
		const macroB = await createTestMacroCategory(db, "MB");
		const catA = await createTestCategory(db, "CA", macroA.id);
		const catB = await createTestCategory(db, "CB", macroB.id);
		await createTestProduct(db, seller.profile.id, {
			name: "A",
			categoryIds: [catA.id],
		});
		await createTestProduct(db, seller.profile.id, {
			name: "B",
			categoryIds: [catB.id],
		});

		const out = await listProducts({
			sellerProfileId: seller.profile.id,
			productMacroCategoryId: macroA.id,
		});
		expect(out.data.map((p) => p.name)).toEqual(["A"]);
	});
});

describe("sort by stock", () => {
	it("ordina per stock crescente", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		const p1 = await createTestProduct(db, seller.profile.id, { name: "P1" });
		const p2 = await createTestProduct(db, seller.profile.id, { name: "P2" });
		const p3 = await createTestProduct(db, seller.profile.id, { name: "P3" });
		await createTestStoreProduct(db, store.id, p1.id, { stock: 5 });
		await createTestStoreProduct(db, store.id, p2.id, { stock: 1 });
		await createTestStoreProduct(db, store.id, p3.id, { stock: 9 });

		const result = await listProducts({
			sellerProfileId: seller.profile.id,
			storeId: store.id,
			page: 1,
			limit: 20,
			sort: "stock",
			order: "asc",
		});

		expect(result.data.map((p) => p.name)).toEqual(["P2", "P1", "P3"]);
	});

	it("ordina per stock decrescente", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		const p1 = await createTestProduct(db, seller.profile.id, { name: "P1" });
		const p2 = await createTestProduct(db, seller.profile.id, { name: "P2" });
		await createTestStoreProduct(db, store.id, p1.id, { stock: 5 });
		await createTestStoreProduct(db, store.id, p2.id, { stock: 12 });

		const result = await listProducts({
			sellerProfileId: seller.profile.id,
			storeId: store.id,
			page: 1,
			limit: 20,
			sort: "stock",
			order: "desc",
		});

		expect(result.data.map((p) => p.name)).toEqual(["P2", "P1"]);
	});

	it("respinge sort=stock senza storeId con 400", async () => {
		const seller = await createTestSeller(getTestDb());

		await expect(
			listProducts({
				sellerProfileId: seller.profile.id,
				page: 1,
				limit: 20,
				sort: "stock",
				order: "asc",
			}),
		).rejects.toMatchObject({ status: 400 });
	});
});
