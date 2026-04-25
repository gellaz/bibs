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

import { eq } from "drizzle-orm";
import { productClassification } from "@/db/schemas/product";
import { ServiceError } from "@/lib/errors";
import {
	createProduct,
	deleteProduct,
	getProduct,
	listProducts,
	updateProduct,
} from "@/modules/seller/services/products";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCategory,
	createTestProduct,
	createTestSeller,
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

		const result = await listProducts({ sellerProfileId: seller.profile.id });

		expect(result.data).toHaveLength(0);
		expect(result.pagination.total).toBe(0);
	});

	it("returns only the requesting seller's products", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		await createTestProduct(db, sellerA.profile.id, { name: "A1" });
		await createTestProduct(db, sellerA.profile.id, { name: "A2" });
		await createTestProduct(db, sellerB.profile.id, { name: "B1" });

		const result = await listProducts({ sellerProfileId: sellerA.profile.id });

		expect(result.data).toHaveLength(2);
		expect(result.pagination.total).toBe(2);
		expect(
			result.data.every((p) => p.sellerProfileId === sellerA.profile.id),
		).toBe(true);
	});

	it("respects page/limit pagination", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		for (let i = 0; i < 5; i++) {
			await createTestProduct(db, seller.profile.id, { name: `P${i}` });
		}

		const result = await listProducts({
			sellerProfileId: seller.profile.id,
			page: 2,
			limit: 2,
		});

		expect(result.data).toHaveLength(2);
		expect(result.pagination.total).toBe(5);
	});
});

// ── getProduct ────────────────────────────────────────────────────────────────

describe("getProduct", () => {
	it("returns the product with relations when owned by the seller", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id);

		const result = await getProduct({
			productId: p.id,
			sellerProfileId: seller.profile.id,
		});

		expect(result.id).toBe(p.id);
		expect(result.productClassifications).toEqual([]);
		expect(result.storeProducts).toEqual([]);
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
			}),
		).rejects.toMatchObject({ status: 404 });
	});
});

// ── createProduct ─────────────────────────────────────────────────────────────

describe("createProduct", () => {
	it("creates a product and links the categories", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const cat1 = await createTestCategory(db, "Cat A");
		const cat2 = await createTestCategory(db, "Cat B");

		const created = await createProduct({
			sellerProfileId: seller.profile.id,
			name: "Espresso",
			price: "1.20",
			categoryIds: [cat1.id, cat2.id],
		});

		expect(created.name).toBe("Espresso");
		expect(created.price).toBe("1.20");

		const classifications = await db
			.select()
			.from(productClassification)
			.where(eq(productClassification.productId, created.id));
		expect(classifications).toHaveLength(2);
	});
});

// ── updateProduct ─────────────────────────────────────────────────────────────

describe("updateProduct", () => {
	it("updates name and price", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id, {
			name: "Old",
			price: "5.00",
		});

		const updated = await updateProduct({
			productId: p.id,
			sellerProfileId: seller.profile.id,
			name: "New",
			price: "7.50",
		});

		expect(updated?.name).toBe("New");
		expect(updated?.price).toBe("7.50");
	});

	it("replaces categories when categoryIds is provided", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const cat1 = await createTestCategory(db, "Cat A");
		const cat2 = await createTestCategory(db, "Cat B");
		const cat3 = await createTestCategory(db, "Cat C");

		const p = await createProduct({
			sellerProfileId: seller.profile.id,
			name: "Prod",
			price: "1.00",
			categoryIds: [cat1.id, cat2.id],
		});

		await updateProduct({
			productId: p.id,
			sellerProfileId: seller.profile.id,
			categoryIds: [cat3.id],
		});

		const classifications = await db
			.select()
			.from(productClassification)
			.where(eq(productClassification.productId, p.id));
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
			name: "Hacked",
		});

		expect(result).toBeNull();
	});
});

// ── deleteProduct ─────────────────────────────────────────────────────────────

describe("deleteProduct", () => {
	it("deletes an owned product", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id);

		const deleted = await deleteProduct({
			productId: p.id,
			sellerProfileId: seller.profile.id,
		});

		expect(deleted.id).toBe(p.id);

		const result = await listProducts({ sellerProfileId: seller.profile.id });
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
			}),
		).rejects.toBeInstanceOf(ServiceError);
	});
});
