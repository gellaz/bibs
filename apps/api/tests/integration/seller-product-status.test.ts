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

import { eq } from "drizzle-orm";
import { product as productTable } from "@/db/schemas/product";
import { productAuditLog } from "@/db/schemas/product-audit-log";
import { ServiceError } from "@/lib/errors";
import {
	deleteProduct,
	getProductStatusCounts,
	listProducts,
	updateProductStatus,
} from "@/modules/seller/services/products";
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

async function makeAccessibleProduct(
	opts: { status?: "active" | "disabled" | "trashed" } = {},
) {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const store = await createTestStore(db, seller.profile.id);
	const p = await createTestProduct(db, seller.profile.id, {
		status: opts.status,
	});
	await createTestStoreProduct(db, store.id, p.id);
	return { db, seller, store, product: p };
}

describe("updateProductStatus", () => {
	it("transitions active → disabled and writes audit", async () => {
		const { db, seller, store, product } = await makeAccessibleProduct();

		const updated = await updateProductStatus({
			productId: product.id,
			sellerProfileId: seller.profile.id,
			accessibleStoreIds: [store.id],
			actorUserId: seller.user.id,
			status: "disabled",
		});

		expect(updated.status).toBe("disabled");

		const audit = await db.query.productAuditLog.findMany({
			where: eq(productAuditLog.productId, product.id),
		});
		expect(audit).toHaveLength(1);
		expect(audit[0].action).toBe("disabled");
	});

	it("transitions trashed → active emits 'restored'", async () => {
		const { db, seller, store, product } = await makeAccessibleProduct({
			status: "trashed",
		});

		await updateProductStatus({
			productId: product.id,
			sellerProfileId: seller.profile.id,
			accessibleStoreIds: [store.id],
			actorUserId: seller.user.id,
			status: "active",
		});

		const audit = await db.query.productAuditLog.findMany({
			where: eq(productAuditLog.productId, product.id),
		});
		expect(audit[0].action).toBe("restored");
		expect(audit[0].metadata).toMatchObject({ previousStatus: "trashed" });
	});

	it("is a no-op when status is already the requested one", async () => {
		const { db, seller, store, product } = await makeAccessibleProduct({
			status: "active",
		});

		await updateProductStatus({
			productId: product.id,
			sellerProfileId: seller.profile.id,
			accessibleStoreIds: [store.id],
			actorUserId: seller.user.id,
			status: "active",
		});

		const audit = await db.query.productAuditLog.findMany();
		expect(audit).toHaveLength(0);
	});

	it("throws 404 when product belongs to another seller", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		const storeB = await createTestStore(db, sellerB.profile.id);
		const productA = await createTestProduct(db, sellerA.profile.id);

		await expect(
			updateProductStatus({
				productId: productA.id,
				sellerProfileId: sellerB.profile.id,
				accessibleStoreIds: [storeB.id],
				actorUserId: sellerB.user.id,
				status: "disabled",
			}),
		).rejects.toBeInstanceOf(ServiceError);
	});

	it("throws 404 when product is not in accessible stores", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const storeA = await createTestStore(db, seller.profile.id, { name: "A" });
		const storeB = await createTestStore(db, seller.profile.id, { name: "B" });
		const product = await createTestProduct(db, seller.profile.id);
		await createTestStoreProduct(db, storeA.id, product.id);

		await expect(
			updateProductStatus({
				productId: product.id,
				sellerProfileId: seller.profile.id,
				accessibleStoreIds: [storeB.id],
				actorUserId: seller.user.id,
				status: "disabled",
			}),
		).rejects.toBeInstanceOf(ServiceError);
	});
});

describe("deleteProduct (permanent)", () => {
	it("succeeds when product is in trash", async () => {
		const { db, seller, store, product } = await makeAccessibleProduct({
			status: "trashed",
		});

		const deleted = await deleteProduct({
			productId: product.id,
			sellerProfileId: seller.profile.id,
			accessibleStoreIds: [store.id],
		});
		expect(deleted.id).toBe(product.id);

		const remaining = await db.query.product.findFirst({
			where: eq(productTable.id, product.id),
		});
		expect(remaining).toBeUndefined();
	});

	it("returns 409 when product is not in trash", async () => {
		const { seller, store, product } = await makeAccessibleProduct({
			status: "active",
		});

		await expect(
			deleteProduct({
				productId: product.id,
				sellerProfileId: seller.profile.id,
				accessibleStoreIds: [store.id],
			}),
		).rejects.toMatchObject({
			status: 409,
		});
	});
});

describe("listProducts statusFilter", () => {
	it("returns only active products by default", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		const pa = await createTestProduct(db, seller.profile.id, {
			name: "A",
			status: "active",
		});
		const pd = await createTestProduct(db, seller.profile.id, {
			name: "D",
			status: "disabled",
		});
		const pt = await createTestProduct(db, seller.profile.id, {
			name: "T",
			status: "trashed",
		});
		for (const p of [pa, pd, pt]) {
			await createTestStoreProduct(db, store.id, p.id);
		}

		const result = await listProducts({
			sellerProfileId: seller.profile.id,
			storeId: store.id,
		});
		expect(result.data.map((p) => p.id)).toEqual([pa.id]);
	});

	it("filters by trashed when requested", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		const pa = await createTestProduct(db, seller.profile.id, {
			name: "A",
			status: "active",
		});
		const pt = await createTestProduct(db, seller.profile.id, {
			name: "T",
			status: "trashed",
		});
		await createTestStoreProduct(db, store.id, pa.id);
		await createTestStoreProduct(db, store.id, pt.id);

		const result = await listProducts({
			sellerProfileId: seller.profile.id,
			storeId: store.id,
			statusFilter: "trashed",
		});
		expect(result.data.map((p) => p.id)).toEqual([pt.id]);
	});
});

describe("getProductStatusCounts", () => {
	it("returns counts grouped by status for the given store", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		for (const status of [
			"active",
			"active",
			"disabled",
			"trashed",
			"trashed",
			"trashed",
		] as const) {
			const p = await createTestProduct(db, seller.profile.id, { status });
			await createTestStoreProduct(db, store.id, p.id);
		}

		const counts = await getProductStatusCounts({
			sellerProfileId: seller.profile.id,
			storeId: store.id,
		});
		expect(counts).toEqual({ active: 2, disabled: 1, trashed: 3 });
	});

	it("returns zeros when store is empty", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);

		const counts = await getProductStatusCounts({
			sellerProfileId: seller.profile.id,
			storeId: store.id,
		});
		expect(counts).toEqual({ active: 0, disabled: 0, trashed: 0 });
	});
});
