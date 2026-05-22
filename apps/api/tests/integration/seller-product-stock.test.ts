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

mock.module("@/lib/s3", () => ({
	s3: { delete: mock(async () => {}) },
}));

import { and, eq } from "drizzle-orm";
import { storeProduct as storeProductTable } from "@/db/schemas/product";
import { adjustStock, bulkAdjustStock } from "@/modules/seller/services/stock";
import { truncateAll } from "../helpers/cleanup";
import {
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

describe("adjustStock", () => {
	it("aumenta lo stock con delta positivo", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		const product = await createTestProduct(db, seller.profile.id);
		await createTestStoreProduct(db, store.id, product.id, { stock: 5 });

		const result = await adjustStock({
			productId: product.id,
			storeId: store.id,
			sellerProfileId: seller.profile.id,
			delta: 3,
		});

		expect(result.stock).toBe(8);

		const fresh = await db.query.storeProduct.findFirst({
			where: and(
				eq(storeProductTable.productId, product.id),
				eq(storeProductTable.storeId, store.id),
			),
		});
		expect(fresh?.stock).toBe(8);
	});

	it("riduce lo stock con delta negativo", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		const product = await createTestProduct(db, seller.profile.id);
		await createTestStoreProduct(db, store.id, product.id, { stock: 10 });

		const result = await adjustStock({
			productId: product.id,
			storeId: store.id,
			sellerProfileId: seller.profile.id,
			delta: -3,
		});

		expect(result.stock).toBe(7);

		const fresh = await db.query.storeProduct.findFirst({
			where: and(
				eq(storeProductTable.productId, product.id),
				eq(storeProductTable.storeId, store.id),
			),
		});
		expect(fresh?.stock).toBe(7);
	});

	it("respinge con 409 quando il delta porterebbe lo stock sotto zero", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		const product = await createTestProduct(db, seller.profile.id);
		await createTestStoreProduct(db, store.id, product.id, { stock: 2 });

		await expect(
			adjustStock({
				productId: product.id,
				storeId: store.id,
				sellerProfileId: seller.profile.id,
				delta: -5,
			}),
		).rejects.toMatchObject({ status: 409 });

		const fresh = await db.query.storeProduct.findFirst({
			where: and(
				eq(storeProductTable.productId, product.id),
				eq(storeProductTable.storeId, store.id),
			),
		});
		expect(fresh?.stock).toBe(2); // invariato
	});

	it("respinge con 404 se il prodotto non esiste", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);

		await expect(
			adjustStock({
				productId: "00000000-0000-0000-0000-000000000000",
				storeId: store.id,
				sellerProfileId: seller.profile.id,
				delta: 1,
			}),
		).rejects.toMatchObject({ status: 404 });
	});

	it("respinge con 404 se il prodotto non è in quel negozio", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const storeA = await createTestStore(db, seller.profile.id);
		const storeB = await createTestStore(db, seller.profile.id, {
			name: "Store B",
		});
		const product = await createTestProduct(db, seller.profile.id);
		await createTestStoreProduct(db, storeA.id, product.id, { stock: 5 });
		// product NON è in storeB

		await expect(
			adjustStock({
				productId: product.id,
				storeId: storeB.id,
				sellerProfileId: seller.profile.id,
				delta: 1,
			}),
		).rejects.toMatchObject({ status: 404 });
	});

	it("somma correttamente 3 delta concorrenti", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		const product = await createTestProduct(db, seller.profile.id);
		await createTestStoreProduct(db, store.id, product.id, { stock: 10 });

		await Promise.all([
			adjustStock({
				productId: product.id,
				storeId: store.id,
				sellerProfileId: seller.profile.id,
				delta: 1,
			}),
			adjustStock({
				productId: product.id,
				storeId: store.id,
				sellerProfileId: seller.profile.id,
				delta: 1,
			}),
			adjustStock({
				productId: product.id,
				storeId: store.id,
				sellerProfileId: seller.profile.id,
				delta: 1,
			}),
		]);

		const fresh = await db.query.storeProduct.findFirst({
			where: and(
				eq(storeProductTable.productId, product.id),
				eq(storeProductTable.storeId, store.id),
			),
		});
		expect(fresh?.stock).toBe(13);
	});
});

describe("bulkAdjustStock", () => {
	it("applica un delta positivo a N prodotti", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		const p1 = await createTestProduct(db, seller.profile.id, { name: "P1" });
		const p2 = await createTestProduct(db, seller.profile.id, { name: "P2" });
		const p3 = await createTestProduct(db, seller.profile.id, { name: "P3" });
		await createTestStoreProduct(db, store.id, p1.id, { stock: 5 });
		await createTestStoreProduct(db, store.id, p2.id, { stock: 10 });
		await createTestStoreProduct(db, store.id, p3.id, { stock: 3 });

		const result = await bulkAdjustStock({
			sellerProfileId: seller.profile.id,
			storeId: store.id,
			productIds: [p1.id, p2.id, p3.id],
			mode: "delta",
			value: 2,
		});

		expect(result.succeeded).toHaveLength(3);
		expect(result.failed).toHaveLength(0);
		expect(result.succeeded.find((r) => r.productId === p1.id)?.stock).toBe(7);
		expect(result.succeeded.find((r) => r.productId === p2.id)?.stock).toBe(12);
		expect(result.succeeded.find((r) => r.productId === p3.id)?.stock).toBe(5);
	});

	it("imposta lo stock assoluto in mode=set", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		const p1 = await createTestProduct(db, seller.profile.id, { name: "P1" });
		const p2 = await createTestProduct(db, seller.profile.id, { name: "P2" });
		await createTestStoreProduct(db, store.id, p1.id, { stock: 5 });
		await createTestStoreProduct(db, store.id, p2.id, { stock: 99 });

		const result = await bulkAdjustStock({
			sellerProfileId: seller.profile.id,
			storeId: store.id,
			productIds: [p1.id, p2.id],
			mode: "set",
			value: 20,
		});

		expect(result.succeeded).toHaveLength(2);
		expect(result.succeeded.every((r) => r.stock === 20)).toBe(true);
	});

	it("ritorna would_go_negative quando il delta porterebbe stock < 0", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		const p1 = await createTestProduct(db, seller.profile.id, { name: "P1" });
		const p2 = await createTestProduct(db, seller.profile.id, { name: "P2" });
		await createTestStoreProduct(db, store.id, p1.id, { stock: 10 });
		await createTestStoreProduct(db, store.id, p2.id, { stock: 1 });

		const result = await bulkAdjustStock({
			sellerProfileId: seller.profile.id,
			storeId: store.id,
			productIds: [p1.id, p2.id],
			mode: "delta",
			value: -5,
		});

		expect(result.succeeded).toHaveLength(1);
		expect(result.succeeded[0].productId).toBe(p1.id);
		expect(result.succeeded[0].stock).toBe(5);
		expect(result.failed).toEqual([
			{ productId: p2.id, reason: "would_go_negative" },
		]);
	});

	it("ritorna not_found per productIds di altri seller", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db);
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		const storeA = await createTestStore(db, sellerA.profile.id);
		const productA = await createTestProduct(db, sellerA.profile.id);
		const productB = await createTestProduct(db, sellerB.profile.id);
		await createTestStoreProduct(db, storeA.id, productA.id, { stock: 5 });

		const result = await bulkAdjustStock({
			sellerProfileId: sellerA.profile.id,
			storeId: storeA.id,
			productIds: [productA.id, productB.id],
			mode: "delta",
			value: 1,
		});

		expect(result.succeeded).toHaveLength(1);
		expect(result.succeeded[0].productId).toBe(productA.id);
		expect(result.failed).toEqual([
			{ productId: productB.id, reason: "not_found" },
		]);
	});

	it("ritorna not_found se il prodotto del seller non è in quel negozio", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const storeA = await createTestStore(db, seller.profile.id);
		const storeB = await createTestStore(db, seller.profile.id, {
			name: "Store B",
		});
		const product = await createTestProduct(db, seller.profile.id);
		await createTestStoreProduct(db, storeA.id, product.id, { stock: 5 });
		// product NON è in storeB

		const result = await bulkAdjustStock({
			sellerProfileId: seller.profile.id,
			storeId: storeB.id,
			productIds: [product.id],
			mode: "delta",
			value: 1,
		});

		expect(result.succeeded).toHaveLength(0);
		expect(result.failed).toEqual([
			{ productId: product.id, reason: "not_found" },
		]);
	});
});
