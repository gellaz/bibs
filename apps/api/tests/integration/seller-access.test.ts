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
