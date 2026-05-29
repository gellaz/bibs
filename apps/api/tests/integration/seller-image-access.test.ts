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

import { user as userTable } from "@/db/schemas/auth";
import { storeEmployee, storeEmployeeStores } from "@/db/schemas/employee";
import { ensureProductAccess } from "@/modules/seller/context";
import {
	deleteProductImage,
	uploadProductImages,
} from "@/modules/seller/services/images";
import {
	deleteStoreImage,
	uploadStoreImages,
} from "@/modules/seller/services/store-images";
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

async function makeEmployee(
	sellerProfileId: string,
	assignedStoreIds: string[],
) {
	const db = getTestDb();
	const empUserId = crypto.randomUUID();
	await db.insert(userTable).values({
		id: empUserId,
		name: "Emp",
		email: `emp-${empUserId.slice(0, 8)}@test.com`,
		emailVerified: true,
		role: "employee",
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	const [emp] = await db
		.insert(storeEmployee)
		.values({ sellerProfileId, userId: empUserId, status: "active" })
		.returning();
	if (assignedStoreIds.length) {
		await db.insert(storeEmployeeStores).values(
			assignedStoreIds.map((storeId) => ({
				storeEmployeeId: emp.id,
				storeId,
			})),
		);
	}
	return empUserId;
}

describe("ensureProductAccess", () => {
	it("owner: passes for any product of the seller", async () => {
		const db = getTestDb();
		const { user, profile } = await createTestSeller(db);
		const store = await createTestStore(db, profile.id);
		const product = await createTestProduct(db, profile.id);
		await createTestStoreProduct(db, store.id, product.id);

		await expect(
			ensureProductAccess(product.id, {
				userId: user.id,
				sellerProfileId: profile.id,
				isOwner: true,
			}),
		).resolves.toBeUndefined();
	});

	it("employee: passes when the product is stocked in an assigned store", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const store = await createTestStore(db, profile.id);
		const product = await createTestProduct(db, profile.id);
		await createTestStoreProduct(db, store.id, product.id);
		const empUserId = await makeEmployee(profile.id, [store.id]);

		await expect(
			ensureProductAccess(product.id, {
				userId: empUserId,
				sellerProfileId: profile.id,
				isOwner: false,
			}),
		).resolves.toBeUndefined();
	});

	it("employee: throws 403 when the product is not in an assigned store", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const storeA = await createTestStore(db, profile.id, { name: "A" });
		const storeB = await createTestStore(db, profile.id, { name: "B" });
		const product = await createTestProduct(db, profile.id);
		await createTestStoreProduct(db, storeB.id, product.id);
		const empUserId = await makeEmployee(profile.id, [storeA.id]);

		await expect(
			ensureProductAccess(product.id, {
				userId: empUserId,
				sellerProfileId: profile.id,
				isOwner: false,
			}),
		).rejects.toMatchObject({ status: 403 });
	});

	it("throws 404 when the product belongs to another seller", async () => {
		const db = getTestDb();
		const a = await createTestSeller(db);
		const b = await createTestSeller(db, { email: "b@test.com" });
		const product = await createTestProduct(db, b.profile.id);

		await expect(
			ensureProductAccess(product.id, {
				userId: a.user.id,
				sellerProfileId: a.profile.id,
				isOwner: true,
			}),
		).rejects.toMatchObject({ status: 404 });
	});
});

describe("product image services enforce employee store access", () => {
	it("uploadProductImages: employee not assigned to the product's store → 403", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const storeA = await createTestStore(db, profile.id, { name: "A" });
		const storeB = await createTestStore(db, profile.id, { name: "B" });
		const product = await createTestProduct(db, profile.id);
		await createTestStoreProduct(db, storeB.id, product.id);
		const empUserId = await makeEmployee(profile.id, [storeA.id]);

		await expect(
			uploadProductImages({
				productId: product.id,
				sellerProfileId: profile.id,
				userId: empUserId,
				isOwner: false,
				files: [],
			}),
		).rejects.toMatchObject({ status: 403 });
	});

	it("deleteProductImage: employee not assigned → 403", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const storeA = await createTestStore(db, profile.id, { name: "A" });
		const storeB = await createTestStore(db, profile.id, { name: "B" });
		const product = await createTestProduct(db, profile.id);
		await createTestStoreProduct(db, storeB.id, product.id);
		const empUserId = await makeEmployee(profile.id, [storeA.id]);

		await expect(
			deleteProductImage({
				productId: product.id,
				sellerProfileId: profile.id,
				userId: empUserId,
				isOwner: false,
				imageId: crypto.randomUUID(),
			}),
		).rejects.toMatchObject({ status: 403 });
	});
});

describe("store image services enforce employee store access", () => {
	it("uploadStoreImages: employee not assigned → 403", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const storeA = await createTestStore(db, profile.id, { name: "A" });
		const storeB = await createTestStore(db, profile.id, { name: "B" });
		const empUserId = await makeEmployee(profile.id, [storeA.id]);

		await expect(
			uploadStoreImages({
				storeId: storeB.id,
				sellerProfileId: profile.id,
				userId: empUserId,
				isOwner: false,
				files: [],
			}),
		).rejects.toMatchObject({ status: 403 });
	});

	it("deleteStoreImage: employee not assigned → 403", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const storeA = await createTestStore(db, profile.id, { name: "A" });
		const storeB = await createTestStore(db, profile.id, { name: "B" });
		const empUserId = await makeEmployee(profile.id, [storeA.id]);

		await expect(
			deleteStoreImage({
				storeId: storeB.id,
				sellerProfileId: profile.id,
				userId: empUserId,
				isOwner: false,
				imageId: crypto.randomUUID(),
			}),
		).rejects.toMatchObject({ status: 403 });
	});
});
