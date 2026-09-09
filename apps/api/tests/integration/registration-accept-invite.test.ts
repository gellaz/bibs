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
import { employeeInvitation } from "@/db/schemas/employee-invitation";
import { store as storeTable } from "@/db/schemas/store";
import { inviteEmployee } from "@/modules/seller/services/employees";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller, createTestStore } from "../helpers/fixtures";

/**
 * `acceptInvite` is the one registration path that runs better-auth for real:
 * it calls `auth.api.signUpEmail` and then propagates the invitation's store
 * assignments inside a transaction. It cannot be covered from
 * `tests/modules/registration.test.ts`, which mocks the registration services
 * at the route level, so it lives here against a migrated database.
 *
 * `@/modules/registration/services` MUST be imported dynamically inside each
 * test: it imports `@/lib/auth`, and `betterAuth({ database: drizzleAdapter(db)
 * })` captures `db` eagerly at module evaluation. A static import is evaluated
 * before `mock.module("@/db")` takes effect, so the adapter would bind to the
 * real pool and fail with ECONNREFUSED. See auth-email-password.test.ts.
 */

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

describe("acceptInvite storeEmployeeStores propagation", () => {
	it("inserts store_employee_stores rows for assigned stores", async () => {
		const { acceptInvite } = await import("@/modules/registration/services");
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const sA = await createTestStore(db, profile.id);
		const sB = await createTestStore(db, profile.id);

		const inv = await inviteEmployee(profile.id, "employee@test.com", [
			sA.id,
			sB.id,
		]);

		await acceptInvite({
			token: inv.invitationToken,
			password: "password123",
		});

		const [employeeUser] = await db
			.select()
			.from(userTable)
			.where(eq(userTable.email, "employee@test.com"));
		expect(employeeUser.role).toBe("employee");
		// Accepting an invite is itself proof of email ownership, so the flow
		// verifies the address instead of sending a second confirmation.
		expect(employeeUser.emailVerified).toBe(true);

		const [employee] = await db
			.select()
			.from(storeEmployee)
			.where(eq(storeEmployee.userId, employeeUser.id));
		expect(employee.sellerProfileId).toBe(profile.id);

		const assigned = await db
			.select()
			.from(storeEmployeeStores)
			.where(eq(storeEmployeeStores.storeEmployeeId, employee.id));
		expect(assigned.map((r) => r.storeId).sort()).toEqual(
			[sA.id, sB.id].sort(),
		);

		const [used] = await db
			.select()
			.from(employeeInvitation)
			.where(eq(employeeInvitation.id, inv.id));
		expect(used.status).toBe("accepted");
	});

	// The guard here is the `employee_invitation_stores.store_id` FK
	// (ON DELETE CASCADE), not the service's INNER JOIN against `store`:
	// removing the join keeps this test green. Verified 2026-09-09 — and with it
	// that a SOFT-deleted store (`stores.deleted_at`, which is how the app
	// actually deletes stores) IS still propagated to the new employee. That case
	// is deliberately not asserted here: it is a product decision, not a
	// regression to lock in.
	it("does not assign a store hard-deleted between invite and accept", async () => {
		const { acceptInvite } = await import("@/modules/registration/services");
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const sA = await createTestStore(db, profile.id);
		const sB = await createTestStore(db, profile.id);

		const inv = await inviteEmployee(profile.id, "employee@test.com", [
			sA.id,
			sB.id,
		]);

		await db.delete(storeTable).where(eq(storeTable.id, sB.id));

		await acceptInvite({
			token: inv.invitationToken,
			password: "password123",
		});

		const [employeeUser] = await db
			.select()
			.from(userTable)
			.where(eq(userTable.email, "employee@test.com"));
		const [employee] = await db
			.select()
			.from(storeEmployee)
			.where(eq(storeEmployee.userId, employeeUser.id));

		const assigned = await db
			.select()
			.from(storeEmployeeStores)
			.where(eq(storeEmployeeStores.storeEmployeeId, employee.id));
		expect(assigned.map((r) => r.storeId)).toEqual([sA.id]);
	});
});
