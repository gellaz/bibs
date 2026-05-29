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

// ── Imports (resolved after mocks) ────────────────────────────────────────────

import {
	listCategoriesInUse,
	listProducts,
} from "@/modules/seller/services/products";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCategory,
	createTestProduct,
	createTestProductCategoryAssignment,
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

/**
 * Seller with two stores. productA is stocked only in store A, productB only in
 * store B, productC is not assigned to any store. Each of A/B carries a distinct
 * category. Mirrors an employee assigned to store A only.
 */
async function seedTwoStoreCatalog() {
	const db = getTestDb();
	const { profile } = await createTestSeller(db);
	const storeA = await createTestStore(db, profile.id, { name: "A" });
	const storeB = await createTestStore(db, profile.id, { name: "B" });

	const catA = await createTestCategory(db, "Cat A");
	const catB = await createTestCategory(db, "Cat B");

	const productA = await createTestProduct(db, profile.id, { name: "Prod A" });
	await createTestStoreProduct(db, storeA.id, productA.id, { stock: 5 });
	await createTestProductCategoryAssignment(db, productA.id, catA.id);

	const productB = await createTestProduct(db, profile.id, { name: "Prod B" });
	await createTestStoreProduct(db, storeB.id, productB.id, { stock: 5 });
	await createTestProductCategoryAssignment(db, productB.id, catB.id);

	const productC = await createTestProduct(db, profile.id, {
		name: "Prod C (unassigned)",
	});

	return {
		sellerProfileId: profile.id,
		storeA,
		storeB,
		productA,
		productB,
		productC,
		catA,
		catB,
	};
}

describe("listProducts — employee store scoping (no storeId)", () => {
	it("owner (no restriction): sees all seller products, including unassigned ones", async () => {
		const { sellerProfileId, productA, productB, productC } =
			await seedTwoStoreCatalog();

		const result = await listProducts({ sellerProfileId });
		const ids = result.data.map((p) => p.id).sort();
		expect(ids).toEqual([productA.id, productB.id, productC.id].sort());
		expect(result.pagination.total).toBe(3);
	});

	it("employee restricted to store A: sees only products stocked in store A", async () => {
		const { sellerProfileId, storeA, productA } = await seedTwoStoreCatalog();

		const result = await listProducts({
			sellerProfileId,
			restrictToStoreIds: [storeA.id],
		});

		expect(result.data.map((p) => p.id)).toEqual([productA.id]);
		expect(result.pagination.total).toBe(1);
	});

	it("employee with no assigned stores: sees no products", async () => {
		const { sellerProfileId } = await seedTwoStoreCatalog();

		const result = await listProducts({
			sellerProfileId,
			restrictToStoreIds: [],
		});

		expect(result.data).toHaveLength(0);
		expect(result.pagination.total).toBe(0);
	});
});

describe("listCategoriesInUse — employee store scoping (no storeId)", () => {
	it("owner (no restriction): sees categories from all stores", async () => {
		const { sellerProfileId, catA, catB } = await seedTwoStoreCatalog();

		const rows = await listCategoriesInUse({ sellerProfileId });
		expect(rows.map((c) => c.id).sort()).toEqual([catA.id, catB.id].sort());
	});

	it("employee restricted to store A: sees only categories used in store A", async () => {
		const { sellerProfileId, storeA, catA } = await seedTwoStoreCatalog();

		const rows = await listCategoriesInUse({
			sellerProfileId,
			restrictToStoreIds: [storeA.id],
		});

		expect(rows.map((c) => c.id)).toEqual([catA.id]);
	});
});
