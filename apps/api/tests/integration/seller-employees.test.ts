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

let sendEmailImpl: () => Promise<void> = async () => {};
mock.module("@/lib/email", () => ({
	sendEmail: () => sendEmailImpl(),
}));

import { eq } from "drizzle-orm";
import { user as userTable } from "@/db/schemas/auth";
import { storeEmployee, storeEmployeeStores } from "@/db/schemas/employee";
import {
	employeeInvitation,
	employeeInvitationStores,
} from "@/db/schemas/employee-invitation";
import { store as storeTable } from "@/db/schemas/store";
import {
	getEmployeeStores,
	inviteEmployee,
	listEmployeeInvitations,
	listEmployees,
	setEmployeeStores,
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

describe("listEmployeeInvitations", () => {
	it("returns only pending invitations, not accepted/expired history", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const store = await createTestStore(db, profile.id);

		// One pending (via the real service path)...
		await inviteEmployee(profile.id, "pending@test.com", [store.id]);
		// ...and two terminal-state rows that must be excluded.
		await db.insert(employeeInvitation).values([
			{
				sellerProfileId: profile.id,
				email: "accepted@test.com",
				status: "accepted",
				expiresAt: new Date(Date.now() + 86_400_000),
			},
			{
				sellerProfileId: profile.id,
				email: "expired@test.com",
				status: "expired",
				expiresAt: new Date(Date.now() - 86_400_000),
			},
		]);

		const result = await listEmployeeInvitations(profile.id);
		expect(result).toHaveLength(1);
		expect(result[0]?.email).toBe("pending@test.com");
		expect(result[0]?.status).toBe("pending");
	});

	it("omits soft-deleted stores from a pending invitation's storeIds", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const live = await createTestStore(db, profile.id);
		const dead = await createTestStore(db, profile.id);

		const inv = await inviteEmployee(profile.id, "pending@test.com", [
			live.id,
			dead.id,
		]);
		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, dead.id));

		const result = await listEmployeeInvitations(profile.id);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe(inv.id);
		expect(result[0]?.storeIds).toEqual([live.id]);
	});
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

	it("omits soft-deleted stores from storeIds", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const live = await createTestStore(db, profile.id);
		const dead = await createTestStore(db, profile.id);
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
			{ storeEmployeeId: emp.id, storeId: live.id },
			{ storeEmployeeId: emp.id, storeId: dead.id },
		]);
		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, dead.id));

		const result = await listEmployees({ sellerProfileId: profile.id });
		expect(result.data[0].storeIds).toEqual([live.id]);
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

	it("rejects a soft-deleted store (404)", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const dead = await createTestStore(db, profile.id);
		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, dead.id));

		await expect(
			inviteEmployee(profile.id, "n@test.com", [dead.id]),
		).rejects.toMatchObject({ status: 404 });
	});

	it("swallows email failures after the invitation is committed", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const sA = await createTestStore(db, profile.id);

		sendEmailImpl = async () => {
			throw new Error("smtp down");
		};
		try {
			const inv = await inviteEmployee(profile.id, "best-effort@test.com", [
				sA.id,
			]);
			// Email failure must not throw: the invitation still resolves and persists.
			expect(inv.storeIds).toEqual([sA.id]);

			const rows = await db
				.select()
				.from(employeeInvitationStores)
				.where(eq(employeeInvitationStores.invitationId, inv.id));
			expect(rows.map((r) => r.storeId)).toEqual([sA.id]);
		} finally {
			sendEmailImpl = async () => {};
		}
	});
});

describe("setEmployeeStores", () => {
	it("replaces the assignment set idempotently", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const sA = await createTestStore(db, profile.id);
		const sB = await createTestStore(db, profile.id);
		const sC = await createTestStore(db, profile.id);
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

		await setEmployeeStores({
			sellerProfileId: profile.id,
			employeeId: emp.id,
			storeIds: [sA.id, sB.id],
		});
		const after1 = await getEmployeeStores({
			sellerProfileId: profile.id,
			employeeId: emp.id,
		});
		expect(after1.map((s) => s.id).sort()).toEqual([sA.id, sB.id].sort());

		await setEmployeeStores({
			sellerProfileId: profile.id,
			employeeId: emp.id,
			storeIds: [sB.id, sC.id],
		});
		const after2 = await getEmployeeStores({
			sellerProfileId: profile.id,
			employeeId: emp.id,
		});
		expect(after2.map((s) => s.id).sort()).toEqual([sB.id, sC.id].sort());
	});

	it("rejects storeIds not belonging to the seller (404)", async () => {
		const db = getTestDb();
		const a = await createTestSeller(db);
		const b = await createTestSeller(db, { email: "other@test.com" });
		const sB = await createTestStore(db, b.profile.id);
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
				sellerProfileId: a.profile.id,
				userId: empUserId,
				status: "active",
			})
			.returning();

		await expect(
			setEmployeeStores({
				sellerProfileId: a.profile.id,
				employeeId: emp.id,
				storeIds: [sB.id],
			}),
		).rejects.toMatchObject({ status: 404 });
	});

	it("rejects a soft-deleted store (404)", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const dead = await createTestStore(db, profile.id);
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
		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, dead.id));

		await expect(
			setEmployeeStores({
				sellerProfileId: profile.id,
				employeeId: emp.id,
				storeIds: [dead.id],
			}),
		).rejects.toMatchObject({ status: 404 });
	});

	it("preserves the dormant assignment of a soft-deleted store", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const live = await createTestStore(db, profile.id);
		const other = await createTestStore(db, profile.id);
		const dead = await createTestStore(db, profile.id);
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
			{ storeEmployeeId: emp.id, storeId: live.id },
			{ storeEmployeeId: emp.id, storeId: dead.id },
		]);
		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, dead.id));

		// The owner re-assigns among live stores only (the dialog cannot even
		// show the archived one). The dormant row must survive, so a future
		// store restore brings the assignment back.
		await setEmployeeStores({
			sellerProfileId: profile.id,
			employeeId: emp.id,
			storeIds: [other.id],
		});

		const rows = await db
			.select()
			.from(storeEmployeeStores)
			.where(eq(storeEmployeeStores.storeEmployeeId, emp.id));
		expect(rows.map((r) => r.storeId).sort()).toEqual(
			[other.id, dead.id].sort(),
		);
	});

	it("getEmployeeStores: 404 if employee not found in seller", async () => {
		const db = getTestDb();
		const a = await createTestSeller(db);
		const b = await createTestSeller(db, { email: "another@test.com" });
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
				sellerProfileId: a.profile.id,
				userId: empUserId,
				status: "active",
			})
			.returning();

		// Querying as 'b' should 404 (employee belongs to a)
		await expect(
			getEmployeeStores({ sellerProfileId: b.profile.id, employeeId: emp.id }),
		).rejects.toMatchObject({ status: 404 });
	});

	it("getEmployeeStores: omits a soft-deleted assigned store", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const live = await createTestStore(db, profile.id);
		const dead = await createTestStore(db, profile.id);
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
			{ storeEmployeeId: emp.id, storeId: live.id },
			{ storeEmployeeId: emp.id, storeId: dead.id },
		]);
		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, dead.id));

		const rows = await getEmployeeStores({
			sellerProfileId: profile.id,
			employeeId: emp.id,
		});
		expect(rows.map((s) => s.id)).toEqual([live.id]);
	});
});
