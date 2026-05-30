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
import { product } from "@/db/schemas/product";
import {
	bulkDeletePermanent,
	bulkUpdateProductStatus,
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

	it("isola un restore in conflitto di EAN senza abortire il resto del batch", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);

		// Un prodotto attivo possiede già l'EAN 12345678.
		const pActive = await createTestProduct(db, seller.profile.id, {
			name: "Active",
		});
		await db
			.update(product)
			.set({ ean: "12345678" })
			.where(eq(product.id, pActive.id));
		await createTestStoreProduct(db, store.id, pActive.id);

		// Un prodotto trashed condivide lo stesso EAN (consentito: i trashed sono
		// esclusi dall'indice unico parziale).
		const pCollide = await createTestProduct(db, seller.profile.id, {
			name: "Collide",
			status: "trashed",
		});
		await db
			.update(product)
			.set({ ean: "12345678" })
			.where(eq(product.id, pCollide.id));
		await createTestStoreProduct(db, store.id, pCollide.id);

		// Un prodotto trashed senza conflitti.
		const pOk = await createTestProduct(db, seller.profile.id, {
			name: "Ok",
			status: "trashed",
		});
		await createTestStoreProduct(db, store.id, pOk.id);

		const result = await bulkUpdateProductStatus({
			sellerProfileId: seller.profile.id,
			accessibleStoreIds: [store.id],
			actorUserId: seller.user.id,
			productIds: [pCollide.id, pOk.id],
			status: "active",
		});

		// Il restore in conflitto è isolato; quello pulito va comunque a buon fine.
		expect(result.succeeded).toEqual([pOk.id]);
		expect(result.failed).toEqual([
			{ productId: pCollide.id, reason: "ean_conflict" },
		]);

		// pOk effettivamente ripristinato, pCollide ancora trashed.
		const fresh = await db.query.product.findMany();
		const byId = new Map(fresh.map((p) => [p.id, p.status]));
		expect(byId.get(pOk.id)).toBe("active");
		expect(byId.get(pCollide.id)).toBe("trashed");
		expect(byId.get(pActive.id)).toBe("active");
	});
});

describe("bulkDeletePermanent", () => {
	it("deletes only products in trash and reports the rest as failed", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		const pTrash = await createTestProduct(db, seller.profile.id, {
			name: "P-trash",
			status: "trashed",
		});
		const pActive = await createTestProduct(db, seller.profile.id, {
			name: "P-active",
			status: "active",
		});
		await createTestStoreProduct(db, store.id, pTrash.id);
		await createTestStoreProduct(db, store.id, pActive.id);

		const result = await bulkDeletePermanent({
			sellerProfileId: seller.profile.id,
			accessibleStoreIds: [store.id],
			productIds: [pTrash.id, pActive.id, "non-existent"],
		});

		expect(result.succeeded).toEqual([pTrash.id]);
		const failedById = new Map(
			result.failed.map((f) => [f.productId, f.reason]),
		);
		expect(failedById.get(pActive.id)).toBe("not_in_trash");
		expect(failedById.get("non-existent")).toBe("not_found");

		// Verify deletion
		const remaining = await db.query.product.findMany();
		expect(remaining.map((p) => p.id)).toEqual(
			expect.arrayContaining([pActive.id]),
		);
		expect(remaining.find((p) => p.id === pTrash.id)).toBeUndefined();
	});
});
