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
});
