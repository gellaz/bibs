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

mock.module("@/lib/email", () => ({
	sendEmail: async () => {},
}));

import { eq } from "drizzle-orm";
import { user as userTable } from "@/db/schemas/auth";
import { storeEmployee, storeEmployeeStores } from "@/db/schemas/employee";
import { employeeInvitationStores } from "@/db/schemas/employee-invitation";
import {
	inviteEmployee,
	listEmployees,
} from "@/modules/seller/services/employees";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller, createTestStore } from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

describe("listEmployees", () => {
	it("returns employees with denormalized storeIds", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const sA = await createTestStore(db, profile.id);
		const sB = await createTestStore(db, profile.id);
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
		await db.insert(storeEmployeeStores).values([
			{ storeEmployeeId: emp.id, storeId: sA.id },
			{ storeEmployeeId: emp.id, storeId: sB.id },
		]);

		const result = await listEmployees({ sellerProfileId: profile.id });
		expect(result.data).toHaveLength(1);
		expect(result.data[0].storeIds.sort()).toEqual([sA.id, sB.id].sort());
	});
});

describe("inviteEmployee with storeIds", () => {
	it("creates invitation rows in employee_invitation_stores", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const sA = await createTestStore(db, profile.id);
		const sB = await createTestStore(db, profile.id);

		const inv = await inviteEmployee(profile.id, "new@test.com", [
			sA.id,
			sB.id,
		]);
		expect(inv.storeIds.sort()).toEqual([sA.id, sB.id].sort());

		const rows = await db
			.select()
			.from(employeeInvitationStores)
			.where(eq(employeeInvitationStores.invitationId, inv.id));
		expect(rows.map((r) => r.storeId).sort()).toEqual([sA.id, sB.id].sort());
	});

	it("rejects storeIds not belonging to seller (404)", async () => {
		const db = getTestDb();
		const { profile: profileA } = await createTestSeller(db);
		const { profile: profileB } = await createTestSeller(db, {
			email: `x-${crypto.randomUUID().slice(0, 8)}@test.com`,
		});
		const sB = await createTestStore(db, profileB.id);

		await expect(
			inviteEmployee(profileA.id, "n@test.com", [sB.id]),
		).rejects.toMatchObject({ status: 404 });
	});
});
