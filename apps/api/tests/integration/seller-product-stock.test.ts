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
import { adjustStock } from "@/modules/seller/services/stock";
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
