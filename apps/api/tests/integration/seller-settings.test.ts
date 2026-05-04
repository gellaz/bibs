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
import { getSellerSettings } from "@/modules/seller/services/settings";
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

// ── getSellerSettings ─────────────────────────────────────────────────────────

describe("getSellerSettings", () => {
	it("owner: returns assignedStoreIds = null", async () => {
		const db = getTestDb();
		const { user, profile } = await createTestSeller(db);
		const result = await getSellerSettings({
			sellerProfileId: profile.id,
			userId: user.id,
			isOwner: true,
		});
		expect(result.assignedStoreIds).toBeNull();
	});

	it("employee: returns the list of assigned store ids", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const sA = await createTestStore(db, profile.id);
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

		const result = await getSellerSettings({
			sellerProfileId: profile.id,
			userId: empUserId,
			isOwner: false,
		});
		expect(result.assignedStoreIds).toEqual([sA.id]);
	});

	it("employee with no assignments: returns empty array", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
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

		const result = await getSellerSettings({
			sellerProfileId: profile.id,
			userId: empUserId,
			isOwner: false,
		});
		expect(result.assignedStoreIds).toEqual([]);
	});
});
