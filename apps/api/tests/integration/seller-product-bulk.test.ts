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

import { bulkUpdateProductStatus } from "@/modules/seller/services/products";
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

describe("bulkUpdateProductStatus", () => {
	it("succeeds for all accessible products and writes audit batch", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		const p1 = await createTestProduct(db, seller.profile.id, { name: "P1" });
		const p2 = await createTestProduct(db, seller.profile.id, { name: "P2" });
		await createTestStoreProduct(db, store.id, p1.id);
		await createTestStoreProduct(db, store.id, p2.id);

		const result = await bulkUpdateProductStatus({
			sellerProfileId: seller.profile.id,
			accessibleStoreIds: [store.id],
			actorUserId: seller.user.id,
			productIds: [p1.id, p2.id],
			status: "disabled",
		});

		expect(result.succeeded).toEqual(expect.arrayContaining([p1.id, p2.id]));
		expect(result.failed).toEqual([]);

		const audit = await db.query.productAuditLog.findMany();
		expect(audit).toHaveLength(2);
		expect(audit.every((r) => r.action === "disabled")).toBe(true);
	});

	it("partitions failed by reason", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		const storeA = await createTestStore(db, sellerA.profile.id);
		const storeB = await createTestStore(db, sellerB.profile.id);
		const pAccessible = await createTestProduct(db, sellerA.profile.id);
		const pNotAccessible = await createTestProduct(db, sellerA.profile.id);
		const pOtherSeller = await createTestProduct(db, sellerB.profile.id);
		await createTestStoreProduct(db, storeA.id, pAccessible.id);
		await createTestStoreProduct(db, storeB.id, pNotAccessible.id);
		await createTestStoreProduct(db, storeB.id, pOtherSeller.id);

		const result = await bulkUpdateProductStatus({
			sellerProfileId: sellerA.profile.id,
			accessibleStoreIds: [storeA.id],
			actorUserId: sellerA.user.id,
			productIds: [
				pAccessible.id,
				pNotAccessible.id,
				pOtherSeller.id,
				"non-existent",
			],
			status: "trashed",
		});

		expect(result.succeeded).toEqual([pAccessible.id]);
		const failedById = new Map(
			result.failed.map((f) => [f.productId, f.reason]),
		);
		expect(failedById.get(pNotAccessible.id)).toBe("no_access");
		expect(failedById.get(pOtherSeller.id)).toBe("not_found");
		expect(failedById.get("non-existent")).toBe("not_found");
	});

	it("skips no-op transitions in audit log", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		const pActive = await createTestProduct(db, seller.profile.id, {
			status: "active",
		});
		const pDisabled = await createTestProduct(db, seller.profile.id, {
			status: "disabled",
		});
		await createTestStoreProduct(db, store.id, pActive.id);
		await createTestStoreProduct(db, store.id, pDisabled.id);

		await bulkUpdateProductStatus({
			sellerProfileId: seller.profile.id,
			accessibleStoreIds: [store.id],
			actorUserId: seller.user.id,
			productIds: [pActive.id, pDisabled.id],
			status: "disabled",
		});

		const audit = await db.query.productAuditLog.findMany();
		expect(audit).toHaveLength(1);
		expect(audit[0].productId).toBe(pActive.id);
	});
});
