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
import { productAuditLog } from "@/db/schemas/product-audit-log";
import { ServiceError } from "@/lib/errors";
import { updateProductStatus } from "@/modules/seller/services/products";
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
