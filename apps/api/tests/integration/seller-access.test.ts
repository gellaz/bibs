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
import {
	ensureStoreAccess,
	getAccessibleStoreIdsFor,
} from "@/modules/seller/context";
import { getEmployeeAssignedStoreIds } from "@/modules/seller/services/access";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller, createTestStore } from "../helpers/fixtures";

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

// ── getEmployeeAssignedStoreIds ────────────────────────────────────────────────

describe("getEmployeeAssignedStoreIds", () => {
	it("returns the store ids the employee is assigned to", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const storeA = await createTestStore(db, profile.id, { name: "A" });
		const storeB = await createTestStore(db, profile.id, { name: "B" });

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
			.values({
				sellerProfileId: profile.id,
				userId: empUserId,
				status: "active",
			})
			.returning();
		await db.insert(storeEmployeeStores).values([
			{ storeEmployeeId: emp.id, storeId: storeA.id },
			{ storeEmployeeId: emp.id, storeId: storeB.id },
		]);

		const ids = await getEmployeeAssignedStoreIds(empUserId, profile.id);
		expect(ids.sort()).toEqual([storeA.id, storeB.id].sort());
	});

	it("returns empty array if employee has no assignments", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);

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
		await db.insert(storeEmployee).values({
			sellerProfileId: profile.id,
			userId: empUserId,
			status: "active",
		});

		const ids = await getEmployeeAssignedStoreIds(empUserId, profile.id);
		expect(ids).toEqual([]);
	});

	it("excludes assignments where employee status is not active", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const storeA = await createTestStore(db, profile.id);

		const empUserId = crypto.randomUUID();
		await db.insert(userTable).values({
			id: empUserId,
			name: "Emp",
			email: `e-${empUserId.slice(0, 8)}@test.com`,
			emailVerified: true,
			role: "employee",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const [emp] = await db
			.insert(storeEmployee)
			.values({
				sellerProfileId: profile.id,
				userId: empUserId,
				status: "banned",
			})
			.returning();
		await db.insert(storeEmployeeStores).values({
			storeEmployeeId: emp.id,
			storeId: storeA.id,
		});

		const ids = await getEmployeeAssignedStoreIds(empUserId, profile.id);
		expect(ids).toEqual([]);
	});
});

// ── getAccessibleStoreIdsFor ──────────────────────────────────────────────────

describe("getAccessibleStoreIdsFor", () => {
	it("owner: returns all non-deleted seller stores", async () => {
		const db = getTestDb();
		const { user, profile } = await createTestSeller(db);
		const s1 = await createTestStore(db, profile.id, { name: "Roma" });
		const s2 = await createTestStore(db, profile.id, { name: "Milano" });

		const ids = await getAccessibleStoreIdsFor({
			userId: user.id,
			sellerProfileId: profile.id,
			isOwner: true,
		});
		expect(ids.sort()).toEqual([s1.id, s2.id].sort());
	});

	it("employee: returns only assigned stores", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const sA = await createTestStore(db, profile.id, { name: "A" });
		await createTestStore(db, profile.id, { name: "B-not-assigned" });

		const empUserId = crypto.randomUUID();
		await db.insert(userTable).values({
			id: empUserId,
			name: "Emp",
			email: `e-${empUserId.slice(0, 8)}@test.com`,
			emailVerified: true,
			role: "employee",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const [emp] = await db
			.insert(storeEmployee)
			.values({
				sellerProfileId: profile.id,
				userId: empUserId,
				status: "active",
			})
			.returning();
		await db.insert(storeEmployeeStores).values({
			storeEmployeeId: emp.id,
			storeId: sA.id,
		});

		const ids = await getAccessibleStoreIdsFor({
			userId: empUserId,
			sellerProfileId: profile.id,
			isOwner: false,
		});
		expect(ids).toEqual([sA.id]);
	});
});

// ── ensureStoreAccess ─────────────────────────────────────────────────────────

describe("ensureStoreAccess", () => {
	it("owner: no-throw when store belongs to seller", async () => {
		const db = getTestDb();
		const { user, profile } = await createTestSeller(db);
		const s = await createTestStore(db, profile.id);
		await expect(
			ensureStoreAccess(s.id, {
				userId: user.id,
				sellerProfileId: profile.id,
				isOwner: true,
			}),
		).resolves.toBeUndefined();
	});

	it("owner: throws 404 when store belongs to a different seller", async () => {
		const db = getTestDb();
		const a = await createTestSeller(db);
		const b = await createTestSeller(db, { email: "other@test.com" });
		const sB = await createTestStore(db, b.profile.id);
		await expect(
			ensureStoreAccess(sB.id, {
				userId: a.user.id,
				sellerProfileId: a.profile.id,
				isOwner: true,
			}),
		).rejects.toMatchObject({ status: 404 });
	});

	it("employee: throws 403 when store not assigned", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const sNotAssigned = await createTestStore(db, profile.id);
		const empUserId = crypto.randomUUID();
		await db.insert(userTable).values({
			id: empUserId,
			name: "Emp",
			email: `e-${empUserId.slice(0, 8)}@test.com`,
			emailVerified: true,
			role: "employee",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await db.insert(storeEmployee).values({
			sellerProfileId: profile.id,
			userId: empUserId,
			status: "active",
		});
		await expect(
			ensureStoreAccess(sNotAssigned.id, {
				userId: empUserId,
				sellerProfileId: profile.id,
				isOwner: false,
			}),
		).rejects.toMatchObject({ status: 403 });
	});
});
