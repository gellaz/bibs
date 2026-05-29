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

import { eq } from "drizzle-orm";
import { user as userTable } from "@/db/schemas/auth";
import { storeEmployee, storeEmployeeStores } from "@/db/schemas/employee";
import { paymentMethod } from "@/db/schemas/payment-method";
import { sellerProfile } from "@/db/schemas/seller";
import { sellerProfileChange } from "@/db/schemas/seller-profile-change";
import { getSellerSettings } from "@/modules/seller/services/settings";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestOrganization,
	createTestSeller,
	createTestStore,
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

/**
 * Builds an active seller with PII populated on the profile, an organization,
 * a default payment method, one pending change request, and one active employee
 * assigned to a store. Returns the ids needed to call getSellerSettings as
 * either the owner or the employee.
 */
async function seedSellerWithEmployee() {
	const db = getTestDb();
	const { user, profile } = await createTestSeller(db);

	await db
		.update(sellerProfile)
		.set({
			firstName: "Mario",
			lastName: "Rossi",
			citizenship: "IT",
			birthDate: "1980-01-01",
			residenceAddress: "Via Segreta 42",
			residenceZipCode: "00100",
			documentNumber: "CA12345AB",
			documentExpiry: "2030-01-01",
			documentImageUrl: "https://example.com/doc.jpg",
		})
		.where(eq(sellerProfile.id, profile.id));

	await createTestOrganization(db, profile.id, { businessName: "Acme Srl" });

	await db.insert(paymentMethod).values({
		sellerProfileId: profile.id,
		stripeAccountId: "acct_OWNER",
		isDefault: true,
	});

	await db.insert(sellerProfileChange).values({
		sellerProfileId: profile.id,
		changeType: "document",
		changeData: { documentNumber: "NEW123" },
		status: "pending",
	});

	const store = await createTestStore(db, profile.id);

	const empUserId = crypto.randomUUID();
	await db.insert(userTable).values({
		id: empUserId,
		name: "Employee",
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
	await db.insert(storeEmployeeStores).values({
		storeEmployeeId: emp.id,
		storeId: store.id,
	});

	return {
		ownerUserId: user.id,
		sellerProfileId: profile.id,
		empUserId,
		storeId: store.id,
	};
}

describe("getSellerSettings — owner vs employee PII exposure", () => {
	it("owner: receives full personal/identity PII, payment method and pending changes", async () => {
		const { ownerUserId, sellerProfileId } = await seedSellerWithEmployee();

		const result = await getSellerSettings({
			sellerProfileId,
			userId: ownerUserId,
			isOwner: true,
		});

		expect(result.profile.documentNumber).toBe("CA12345AB");
		expect(result.profile.documentImageUrl).toBe("https://example.com/doc.jpg");
		expect(result.profile.birthDate).toBe("1980-01-01");
		expect(result.profile.firstName).toBe("Mario");
		expect(result.profile.residenceAddress).toBe("Via Segreta 42");
		expect(result.paymentMethod).not.toBeNull();
		expect(result.pendingChanges).toHaveLength(1);
		expect(result.organization?.businessName).toBe("Acme Srl");
		expect(result.assignedStoreIds).toBeNull();
	});

	it("employee: owner identity-document PII, payment method and pending changes are redacted", async () => {
		const { sellerProfileId, empUserId, storeId } =
			await seedSellerWithEmployee();

		const result = await getSellerSettings({
			sellerProfileId,
			userId: empUserId,
			isOwner: false,
		});

		// Owner identity-document PII must not leak to employees.
		expect(result.profile.documentNumber).toBeNull();
		expect(result.profile.documentImageUrl).toBeNull();
		expect(result.profile.documentExpiry).toBeNull();
		expect(result.profile.birthDate).toBeNull();
		expect(result.profile.firstName).toBeNull();
		expect(result.profile.lastName).toBeNull();
		expect(result.profile.citizenship).toBeNull();
		expect(result.profile.residenceAddress).toBeNull();
		expect(result.profile.residenceZipCode).toBeNull();
		expect(result.profile.residenceMunicipality).toBeNull();

		// Owner-only financial / review surfaces.
		expect(result.paymentMethod).toBeNull();
		expect(result.pendingChanges).toHaveLength(0);

		// Business info stays visible (employees see it read-only) and the
		// employee's store assignment is still resolved.
		expect(result.organization?.businessName).toBe("Acme Srl");
		expect(result.assignedStoreIds).toEqual([storeId]);
	});
});
