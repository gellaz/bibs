import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

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

// S3 is only used by deleteProduct cleanup (best-effort)
mock.module("@/lib/s3", () => ({
	s3: { delete: mock(async () => {}) },
}));

// ── Imports (resolved after mocks) ────────────────────────────────────────────

import { and, eq } from "drizzle-orm";
import { brand } from "@/db/schemas/brand";
import {
	product,
	productCategoryAssignment,
	storeProduct as storeProductTable,
} from "@/db/schemas/product";
import { ServiceError } from "@/lib/errors";
import { importProductsFromCsv } from "@/modules/seller/services/product-import";
import {
	createProduct,
	deleteProduct,
	getProduct,
	listProducts,
	lookupProductByEan,
	updateProduct,
} from "@/modules/seller/services/products";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestBrand,
	createTestCategory,
	createTestDiscount,
	createTestDiscountProduct,
	createTestMacroCategory,
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

// ── listProducts ──────────────────────────────────────────────────────────────

describe("listProducts", () => {
	it("returns empty list when seller has no products", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);

		const result = await listProducts({
			sellerProfileId: seller.profile.id,
			storeId: store.id,
		});

		expect(result.data).toHaveLength(0);
		expect(result.pagination.total).toBe(0);
	});

	it("returns only the requesting seller's products", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		const storeA = await createTestStore(db, sellerA.profile.id);
		const storeB = await createTestStore(db, sellerB.profile.id);
		const a1 = await createTestProduct(db, sellerA.profile.id, { name: "A1" });
		const a2 = await createTestProduct(db, sellerA.profile.id, { name: "A2" });
		const b1 = await createTestProduct(db, sellerB.profile.id, { name: "B1" });
		await createTestStoreProduct(db, storeA.id, a1.id);
		await createTestStoreProduct(db, storeA.id, a2.id);
		await createTestStoreProduct(db, storeB.id, b1.id);

		const result = await listProducts({
			sellerProfileId: sellerA.profile.id,
			storeId: storeA.id,
		});

		expect(result.data).toHaveLength(2);
		expect(result.pagination.total).toBe(2);
		expect(
			result.data.every((p) => p.sellerProfileId === sellerA.profile.id),
		).toBe(true);
	});

	it("respects page/limit pagination", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const sA = await createTestStore(db, seller.profile.id);
		for (let i = 0; i < 5; i++) {
			const p = await createTestProduct(db, seller.profile.id, {
				name: `P${i}`,
			});
			await createTestStoreProduct(db, sA.id, p.id);
		}

		const result = await listProducts({
			sellerProfileId: seller.profile.id,
			storeId: sA.id,
			page: 2,
			limit: 2,
		});

		expect(result.data).toHaveLength(2);
		expect(result.pagination.total).toBe(5);
	});

	it("returns only products available in the requested store", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const sA = await createTestStore(db, seller.profile.id, { name: "A" });
		const sB = await createTestStore(db, seller.profile.id, { name: "B" });
		const pInA = await createTestProduct(db, seller.profile.id, {
			name: "InA",
		});
		const pInB = await createTestProduct(db, seller.profile.id, {
			name: "InB",
		});
		await createTestStoreProduct(db, sA.id, pInA.id, { stock: 5 });
		await createTestStoreProduct(db, sB.id, pInB.id, { stock: 3 });

		const result = await listProducts({
			sellerProfileId: seller.profile.id,
			storeId: sA.id,
		});

		expect(result.data.map((p) => p.name)).toEqual(["InA"]);
		expect(result.pagination.total).toBe(1);
	});
});

describe("listProducts appliedDiscount annotation", () => {
	it("annotates a product in a running discount", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id, {
			name: "Scontato",
			price: "100.00",
		});
		const d = await createTestDiscount(db, seller.profile.id, {
			title: "Saldi estivi",
			percent: 25,
		});
		await createTestDiscountProduct(db, d.id, p.id);

		const result = await listProducts({ sellerProfileId: seller.profile.id });
		const row = result.data.find((r) => r.id === p.id);
		expect(row?.appliedDiscount).toEqual({
			percent: 25,
			discountedPrice: "75.00",
			title: "Saldi estivi",
		});
	});

	it("is null for a product with no discount", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id);

		const result = await listProducts({ sellerProfileId: seller.profile.id });
		expect(result.data.find((r) => r.id === p.id)?.appliedDiscount).toBeNull();
	});

	it("is null when the only discount is paused (not active)", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id, {
			price: "50.00",
		});
		const d = await createTestDiscount(db, seller.profile.id, {
			percent: 30,
			status: "paused",
		});
		await createTestDiscountProduct(db, d.id, p.id);

		const result = await listProducts({ sellerProfileId: seller.profile.id });
		expect(result.data.find((r) => r.id === p.id)?.appliedDiscount).toBeNull();
	});
});

// ── getProduct ────────────────────────────────────────────────────────────────

describe("getProduct", () => {
	it("returns the product with relations when owned by the seller", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		const p = await createTestProduct(db, seller.profile.id);
		await createTestStoreProduct(db, store.id, p.id);

		const result = await getProduct({
			productId: p.id,
			sellerProfileId: seller.profile.id,
			accessibleStoreIds: [store.id],
		});

		expect(result.id).toBe(p.id);
		expect(result.productCategoryAssignments).toEqual([]);
		expect(result.storeProducts).toHaveLength(1);
		expect(result.images).toEqual([]);
	});

	it("throws ServiceError 404 when product belongs to another seller", async () => {
		const db = getTestDb();
		const ownerSeller = await createTestSeller(db, { email: "owner@test.com" });
		const otherSeller = await createTestSeller(db, { email: "other@test.com" });
		const p = await createTestProduct(db, ownerSeller.profile.id);

		await expect(
			getProduct({
				productId: p.id,
				sellerProfileId: otherSeller.profile.id,
				accessibleStoreIds: [],
			}),
		).rejects.toMatchObject({ status: 404 });
	});

	it("returns 404 when product not in any accessible store", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const sA = await createTestStore(db, seller.profile.id, { name: "A" });
		const sB = await createTestStore(db, seller.profile.id, { name: "B" });
		const p = await createTestProduct(db, seller.profile.id);
		await createTestStoreProduct(db, sB.id, p.id); // p only in sB

		await expect(
			getProduct({
				productId: p.id,
				sellerProfileId: seller.profile.id,
				accessibleStoreIds: [sA.id], // employee assigned only to sA
			}),
		).rejects.toMatchObject({ status: 404 });
	});
});

// ── createProduct ─────────────────────────────────────────────────────────────

describe("createProduct", () => {
	it("creates a product and links the categories", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);
		const cat1 = await createTestCategory(db, "Cat A");
		const cat2 = await createTestCategory(db, "Cat B");

		const created = await createProduct({
			sellerProfileId: seller.profile.id,
			storeId: s.id,
			name: "Espresso",
			price: "1.20",
			categoryIds: [cat1.id, cat2.id],
		});

		expect(created.name).toBe("Espresso");
		expect(created.price).toBe("1.20");

		const classifications = await db
			.select()
			.from(productCategoryAssignment)
			.where(eq(productCategoryAssignment.productId, created.id));
		expect(classifications).toHaveLength(2);
	});
});

describe("createProduct with storeId", () => {
	it("creates the product and a store_products row with stock=0", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);

		const created = await createProduct({
			sellerProfileId: seller.profile.id,
			storeId: s.id,
			name: "P",
			price: "9.99",
		});

		const sp = await db.query.storeProduct.findFirst({
			where: and(
				eq(storeProductTable.productId, created.id),
				eq(storeProductTable.storeId, s.id),
			),
		});
		expect(sp).toBeDefined();
		expect(sp!.stock).toBe(0);
	});
});

// ── updateProduct ─────────────────────────────────────────────────────────────

describe("updateProduct", () => {
	it("updates name and price", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);
		const p = await createTestProduct(db, seller.profile.id, {
			name: "Old",
			price: "5.00",
		});
		await createTestStoreProduct(db, s.id, p.id);

		const updated = await updateProduct({
			productId: p.id,
			sellerProfileId: seller.profile.id,
			accessibleStoreIds: [s.id],
			name: "New",
			price: "7.50",
		});

		expect(updated?.name).toBe("New");
		expect(updated?.price).toBe("7.50");
	});

	it("replaces categories when categoryIds is provided", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);
		const cat1 = await createTestCategory(db, "Cat A");
		const cat2 = await createTestCategory(db, "Cat B");
		const cat3 = await createTestCategory(db, "Cat C");

		const p = await createProduct({
			sellerProfileId: seller.profile.id,
			storeId: s.id,
			name: "Prod",
			price: "1.00",
			categoryIds: [cat1.id, cat2.id],
		});
		// createProduct already creates a storeProduct row for s.id

		await updateProduct({
			productId: p.id,
			sellerProfileId: seller.profile.id,
			accessibleStoreIds: [s.id],
			categoryIds: [cat3.id],
		});

		const classifications = await db
			.select()
			.from(productCategoryAssignment)
			.where(eq(productCategoryAssignment.productId, p.id));
		expect(classifications).toHaveLength(1);
		expect(classifications[0].productCategoryId).toBe(cat3.id);
	});

	it("returns null when product does not belong to seller", async () => {
		const db = getTestDb();
		const owner = await createTestSeller(db, { email: "owner@test.com" });
		const other = await createTestSeller(db, { email: "other@test.com" });
		const p = await createTestProduct(db, owner.profile.id);

		const result = await updateProduct({
			productId: p.id,
			sellerProfileId: other.profile.id,
			accessibleStoreIds: [],
			name: "Hacked",
		});

		expect(result).toBeNull();
	});
});

// ── deleteProduct ─────────────────────────────────────────────────────────────

describe("deleteProduct", () => {
	it("deletes an owned product when status is trashed", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);
		const p = await createTestProduct(db, seller.profile.id, {
			status: "trashed",
		});
		await createTestStoreProduct(db, s.id, p.id);

		const deleted = await deleteProduct({
			productId: p.id,
			sellerProfileId: seller.profile.id,
			accessibleStoreIds: [s.id],
		});

		expect(deleted.id).toBe(p.id);

		const result = await listProducts({
			sellerProfileId: seller.profile.id,
			storeId: s.id,
		});
		expect(result.data).toHaveLength(0);
	});

	it("throws ServiceError 404 when product does not belong to seller", async () => {
		const db = getTestDb();
		const owner = await createTestSeller(db, { email: "owner@test.com" });
		const other = await createTestSeller(db, { email: "other@test.com" });
		const p = await createTestProduct(db, owner.profile.id);

		await expect(
			deleteProduct({
				productId: p.id,
				sellerProfileId: other.profile.id,
				accessibleStoreIds: [],
			}),
		).rejects.toBeInstanceOf(ServiceError);
	});
});

describe("createProduct - brand and EAN", () => {
	it("creates a product with a brandName, creating the brand on the fly", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);
		const cat = await createTestCategory(db);

		const created = await createProduct({
			sellerProfileId: seller.profile.id,
			storeId: s.id,
			name: "Sneakers",
			price: "59.90",
			categoryIds: [cat.id],
			brandName: "Nike",
		});

		expect(created.brandId).toBeTruthy();

		const brandRow = await db.query.brand.findFirst({
			where: eq(brand.id, created.brandId!),
		});
		expect(brandRow?.name).toBe("Nike");
		expect(brandRow?.sellerProfileId).toBe(seller.profile.id);
	});

	it("reuses an existing brand when name matches case-insensitively", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);
		const cat = await createTestCategory(db);
		const existing = await createTestBrand(db, seller.profile.id, "Nike");

		const created = await createProduct({
			sellerProfileId: seller.profile.id,
			storeId: s.id,
			name: "Sneakers 2",
			price: "59.90",
			categoryIds: [cat.id],
			brandName: "NIKE",
		});

		expect(created.brandId).toBe(existing.id);
	});

	it("uses brandId when provided, ignoring brandName", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);
		const cat = await createTestCategory(db);
		const existing = await createTestBrand(db, seller.profile.id, "Adidas");

		const created = await createProduct({
			sellerProfileId: seller.profile.id,
			storeId: s.id,
			name: "Tee",
			price: "19.90",
			categoryIds: [cat.id],
			brandId: existing.id,
			brandName: "ShouldBeIgnored",
		});

		expect(created.brandId).toBe(existing.id);

		const brands = await db.query.brand.findMany({
			where: eq(brand.sellerProfileId, seller.profile.id),
		});
		expect(brands.find((b) => b.name === "ShouldBeIgnored")).toBeUndefined();
	});

	it("rejects brandId belonging to another seller with 404", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		const sA = await createTestStore(db, sellerA.profile.id);
		const cat = await createTestCategory(db);
		const brandOfB = await createTestBrand(db, sellerB.profile.id, "Foreign");

		await expect(
			createProduct({
				sellerProfileId: sellerA.profile.id,
				storeId: sA.id,
				name: "X",
				price: "1.00",
				categoryIds: [cat.id],
				brandId: brandOfB.id,
			}),
		).rejects.toMatchObject({ status: 404 });
	});

	it("stores ean and accepts duplicate ean across different sellers", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		const sA = await createTestStore(db, sellerA.profile.id);
		const sB = await createTestStore(db, sellerB.profile.id);
		const cat = await createTestCategory(db);

		const a = await createProduct({
			sellerProfileId: sellerA.profile.id,
			storeId: sA.id,
			name: "Coca",
			price: "1.00",
			categoryIds: [cat.id],
			ean: "5449000000996",
		});
		const b = await createProduct({
			sellerProfileId: sellerB.profile.id,
			storeId: sB.id,
			name: "Coca",
			price: "1.20",
			categoryIds: [cat.id],
			ean: "5449000000996",
		});

		expect(a.ean).toBe("5449000000996");
		expect(b.ean).toBe("5449000000996");
	});

	it("rejects duplicate ean for the same seller (unique violation)", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);
		const cat = await createTestCategory(db);

		await createProduct({
			sellerProfileId: seller.profile.id,
			storeId: s.id,
			name: "First",
			price: "1.00",
			categoryIds: [cat.id],
			ean: "5449000000996",
		});

		await expect(
			createProduct({
				sellerProfileId: seller.profile.id,
				storeId: s.id,
				name: "Second",
				price: "2.00",
				categoryIds: [cat.id],
				ean: "5449000000996",
			}),
		).rejects.toThrow();
	});

	it("rejects categoryIds spanning multiple macro-categories", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);
		const macroA = await createTestMacroCategory(db, "Macro A");
		const macroB = await createTestMacroCategory(db, "Macro B");
		const catA = await createTestCategory(db, "Cat A", macroA.id);
		const catB = await createTestCategory(db, "Cat B", macroB.id);

		await expect(
			createProduct({
				sellerProfileId: seller.profile.id,
				storeId: s.id,
				name: "Mixed",
				price: "1.00",
				categoryIds: [catA.id, catB.id],
			}),
		).rejects.toMatchObject({ status: 400 });
	});
});

describe("lookupProductByEan", () => {
	it("returns null when no product matches", async () => {
		const result = await lookupProductByEan({ ean: "00000000" });
		expect(result).toBeNull();
	});

	it("returns the latest product across sellers, with brand and categories", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		const sA = await createTestStore(db, sellerA.profile.id);
		const sB = await createTestStore(db, sellerB.profile.id);
		const macro = await createTestMacroCategory(db, "Foo");
		const cat = await createTestCategory(db, "Bar", macro.id);
		const brandA = await createTestBrand(db, sellerA.profile.id, "BrandA");

		await createProduct({
			sellerProfileId: sellerA.profile.id,
			storeId: sA.id,
			name: "Old",
			price: "1.00",
			categoryIds: [cat.id],
			ean: "12345678",
			brandId: brandA.id,
		});
		await new Promise((r) => setTimeout(r, 10));

		const brandB = await createTestBrand(db, sellerB.profile.id, "BrandB");
		await createProduct({
			sellerProfileId: sellerB.profile.id,
			storeId: sB.id,
			name: "New",
			description: "Latest version",
			price: "2.00",
			categoryIds: [cat.id],
			ean: "12345678",
			brandId: brandB.id,
		});

		const result = await lookupProductByEan({ ean: "12345678" });

		expect(result).not.toBeNull();
		expect(result!.name).toBe("New");
		expect(result!.description).toBe("Latest version");
		expect(result!.ean).toBe("12345678");
		expect(result!.brandName).toBe("BrandB");
		expect(result!.macroCategoryId).toBe(macro.id);
		expect(result!.categoryIds).toEqual([cat.id]);
	});
});

// ── importProductsFromCsv - per-row EAN collision ─────────────────────────────

describe("importProductsFromCsv - per-row EAN collision", () => {
	it("skips a row that conflicts with an existing seller EAN and continues importing other rows", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);
		const macro = await createTestMacroCategory(db, "Macro Import");
		const cat = await createTestCategory(db, "Cat Import", macro.id);

		// Seed: an existing product with EAN
		await createProduct({
			sellerProfileId: seller.profile.id,
			storeId: s.id,
			name: "Existing",
			price: "1.00",
			categoryIds: [cat.id],
			ean: "1111111111116",
		});

		// CSV with three rows: row 2 conflicts on EAN, rows 1 and 3 are fine
		const csv = [
			"name,description,price,categories,ean,brand",
			"OK1,d1,2.00,Cat Import,2222222222229,",
			"Conflict,d2,3.00,Cat Import,1111111111116,",
			"OK2,d3,4.00,Cat Import,3333333333332,",
		].join("\n");

		const result = await importProductsFromCsv({
			sellerProfileId: seller.profile.id,
			storeId: s.id,
			csvText: csv,
		});

		expect(result.created).toBe(2);
		expect(result.skipped).toBe(1);
		expect(result.failed).toBe(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toMatchObject({
			row: 3,
			message: expect.stringContaining("EAN"),
		});

		// Verify the two non-conflicting rows actually landed in DB
		const products = await db.query.product.findMany({
			where: eq(product.sellerProfileId, seller.profile.id),
		});
		expect(products).toHaveLength(3); // existing + OK1 + OK2
		const eans = products
			.map((p) => p.ean)
			.filter(Boolean)
			.sort();
		expect(eans).toEqual(["1111111111116", "2222222222229", "3333333333332"]);
	});
});
