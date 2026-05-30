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
import { user } from "@/db/schemas/auth";
import { organization } from "@/db/schemas/organization";
import { paymentMethod } from "@/db/schemas/payment-method";
import { type OnboardingStatus, sellerProfile } from "@/db/schemas/seller";
import {
	type ChangeStatus,
	type ChangeType,
	sellerProfileChange,
} from "@/db/schemas/seller-profile-change";
import { ServiceError } from "@/lib/errors";
import {
	approveChange,
	countSellersByStatus,
	getSellerDetail,
	listSellers,
	rejectChange,
	rejectSeller,
	verifySeller,
} from "@/modules/admin/services/sellers";
import { truncateAll } from "../helpers/cleanup";
import { createTestOrganization, createTestSeller } from "../helpers/fixtures";

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

// ── Helper: create a seller with given onboarding status ──────────────────────

async function createSellerAtStatus(
	email: string,
	status: OnboardingStatus,
	vatStatus: "pending" | "verified" | "rejected" = "pending",
) {
	const db = getTestDb();
	const seller = await createTestSeller(db, { email });
	// Override the default "active" status from fixture
	await db
		.update(sellerProfile)
		.set({ onboardingStatus: status })
		.where(eq(sellerProfile.id, seller.profile.id));
	await createTestOrganization(db, seller.profile.id, { vatStatus });
	return seller;
}

// ── Helpers for approveChange / rejectChange ──────────────────────────────────

/** Inserts an admin user row and returns its id (valid FK for reviewedBy). */
async function seedAdmin(email: string): Promise<string> {
	const id = crypto.randomUUID();
	await getTestDb().insert(user).values({
		id,
		name: "Admin",
		email,
		emailVerified: true,
		role: "admin",
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	return id;
}

async function seedChange(params: {
	sellerProfileId: string;
	changeType: ChangeType;
	changeData: Record<string, unknown>;
	status?: ChangeStatus;
	reviewedBy?: string | null;
}) {
	const [row] = await getTestDb()
		.insert(sellerProfileChange)
		.values({
			sellerProfileId: params.sellerProfileId,
			changeType: params.changeType,
			changeData: params.changeData,
			status: params.status ?? "pending",
			reviewedBy: params.reviewedBy ?? null,
		})
		.returning();
	return row;
}

// ── listSellers ───────────────────────────────────────────────────────────────

describe("listSellers", () => {
	it("returns only sellers at reviewable statuses by default", async () => {
		await createSellerAtStatus("pending_email@test.com", "pending_email");
		await createSellerAtStatus("pending_review@test.com", "pending_review");
		await createSellerAtStatus("active@test.com", "active", "verified");
		await createSellerAtStatus("rejected@test.com", "rejected", "rejected");

		const result = await listSellers({});

		// Should exclude pending_email (not reviewable), include the others
		expect(result.pagination.total).toBe(3);
		const emails = result.data.map((s) => s.user.email).sort();
		expect(emails).toEqual([
			"active@test.com",
			"pending_review@test.com",
			"rejected@test.com",
		]);
	});

	it("filters by explicit status", async () => {
		await createSellerAtStatus("a@test.com", "pending_review");
		await createSellerAtStatus("b@test.com", "pending_review");
		await createSellerAtStatus("c@test.com", "active", "verified");

		const result = await listSellers({ status: "pending_review" });

		expect(result.pagination.total).toBe(2);
		expect(
			result.data.every((s) => s.onboardingStatus === "pending_review"),
		).toBe(true);
	});

	it("searches by user email", async () => {
		await createSellerAtStatus("pizza.mario@test.com", "pending_review");
		await createSellerAtStatus("gelato.luigi@test.com", "pending_review");

		const result = await listSellers({ search: "pizza" });

		expect(result.pagination.total).toBe(1);
		expect(result.data[0].user.email).toBe("pizza.mario@test.com");
	});
});

// ── verifySeller ──────────────────────────────────────────────────────────────

describe("verifySeller", () => {
	it("sets seller onboarding to active and organization vatStatus to verified", async () => {
		const db = getTestDb();
		const seller = await createSellerAtStatus(
			"s@test.com",
			"pending_review",
			"pending",
		);

		await verifySeller(seller.profile.id);

		const [profile] = await db
			.select()
			.from(sellerProfile)
			.where(eq(sellerProfile.id, seller.profile.id));
		expect(profile.onboardingStatus).toBe("active");

		const [org] = await db
			.select()
			.from(organization)
			.where(eq(organization.sellerProfileId, seller.profile.id));
		expect(org.vatStatus).toBe("verified");
	});

	it("throws ServiceError 404 when seller does not exist", async () => {
		await expect(verifySeller(crypto.randomUUID())).rejects.toBeInstanceOf(
			ServiceError,
		);
	});
});

// ── rejectSeller ──────────────────────────────────────────────────────────────

describe("rejectSeller", () => {
	it("sets seller onboarding to rejected and organization vatStatus to rejected", async () => {
		const db = getTestDb();
		const seller = await createSellerAtStatus(
			"s@test.com",
			"pending_review",
			"pending",
		);

		await rejectSeller(seller.profile.id);

		const [profile] = await db
			.select()
			.from(sellerProfile)
			.where(eq(sellerProfile.id, seller.profile.id));
		expect(profile.onboardingStatus).toBe("rejected");

		const [org] = await db
			.select()
			.from(organization)
			.where(eq(organization.sellerProfileId, seller.profile.id));
		expect(org.vatStatus).toBe("rejected");
	});
});

// ── countSellersByStatus ──────────────────────────────────────────────────────

describe("countSellersByStatus", () => {
	it("returns zero counts on empty DB", async () => {
		const counts = await countSellersByStatus();
		expect(counts).toEqual({ pending_review: 0, active: 0, rejected: 0 });
	});

	it("groups sellers by reviewable status", async () => {
		await createSellerAtStatus("a@test.com", "pending_review");
		await createSellerAtStatus("b@test.com", "pending_review");
		await createSellerAtStatus("c@test.com", "active", "verified");
		await createSellerAtStatus("d@test.com", "rejected", "rejected");
		// Non-reviewable — should be ignored
		await createSellerAtStatus("e@test.com", "pending_email");

		const counts = await countSellersByStatus();

		expect(counts).toEqual({ pending_review: 2, active: 1, rejected: 1 });
	});
});

// ── getSellerDetail ───────────────────────────────────────────────────────────

describe("getSellerDetail", () => {
	it("returns the seller with user and organization", async () => {
		const seller = await createSellerAtStatus("s@test.com", "pending_review");

		const detail = await getSellerDetail(seller.profile.id);

		expect(detail.id).toBe(seller.profile.id);
		expect(detail.user.email).toBe("s@test.com");
		expect(detail.organization).not.toBeNull();
	});

	it("throws ServiceError 404 when seller does not exist", async () => {
		await expect(getSellerDetail(crypto.randomUUID())).rejects.toBeInstanceOf(
			ServiceError,
		);
	});
});

// ── approveChange ─────────────────────────────────────────────────────────────

describe("approveChange", () => {
	it("applies VAT side effects once and flips the change to approved", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db, { email: "vat-ok@test.com" });
		await db
			.update(sellerProfile)
			.set({ vatChangeBlocked: true })
			.where(eq(sellerProfile.id, seller.profile.id));
		await createTestOrganization(db, seller.profile.id, {
			vatStatus: "pending",
			vatNumber: "IT00000000000",
		});
		const adminId = await seedAdmin("vat-ok-admin@test.com");
		const change = await seedChange({
			sellerProfileId: seller.profile.id,
			changeType: "vat",
			changeData: { vatNumber: "IT99999999999" },
		});

		const updated = await approveChange(change.id, adminId);

		expect(updated.status).toBe("approved");
		expect(updated.reviewedBy).toBe(adminId);
		expect(updated.reviewedAt).toBeInstanceOf(Date);

		const [org] = await db
			.select()
			.from(organization)
			.where(eq(organization.sellerProfileId, seller.profile.id));
		expect(org.vatNumber).toBe("IT99999999999");
		expect(org.vatStatus).toBe("verified");

		const [profile] = await db
			.select()
			.from(sellerProfile)
			.where(eq(sellerProfile.id, seller.profile.id));
		expect(profile.vatChangeBlocked).toBe(false);
	});

	it("inserts a default payment method on a payment change", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db, { email: "pay-ok@test.com" });
		const adminId = await seedAdmin("pay-ok-admin@test.com");
		const change = await seedChange({
			sellerProfileId: seller.profile.id,
			changeType: "payment",
			changeData: { stripeAccountId: "acct_NEW" },
		});

		const updated = await approveChange(change.id, adminId);
		expect(updated.status).toBe("approved");

		const pms = await db
			.select()
			.from(paymentMethod)
			.where(eq(paymentMethod.sellerProfileId, seller.profile.id));
		expect(pms).toHaveLength(1);
		expect(pms[0].stripeAccountId).toBe("acct_NEW");
		expect(pms[0].isDefault).toBe(true);
	});

	it("throws 400 and does NOT re-apply side effects when already approved", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db, { email: "vat-dup@test.com" });
		await db
			.update(sellerProfile)
			.set({ vatChangeBlocked: true })
			.where(eq(sellerProfile.id, seller.profile.id));
		// Sentinel org values that must remain untouched.
		await createTestOrganization(db, seller.profile.id, {
			vatStatus: "rejected",
			vatNumber: "IT00000000000",
		});
		const firstAdmin = await seedAdmin("dup-first@test.com");
		const secondAdmin = await seedAdmin("dup-second@test.com");
		const change = await seedChange({
			sellerProfileId: seller.profile.id,
			changeType: "vat",
			changeData: { vatNumber: "IT11111111111" },
			status: "approved",
			reviewedBy: firstAdmin,
		});

		await expect(approveChange(change.id, secondAdmin)).rejects.toMatchObject({
			status: 400,
		});

		// Side effects NOT re-applied — sentinels unchanged.
		const [org] = await db
			.select()
			.from(organization)
			.where(eq(organization.sellerProfileId, seller.profile.id));
		expect(org.vatNumber).toBe("IT00000000000");
		expect(org.vatStatus).toBe("rejected");
		const [profile] = await db
			.select()
			.from(sellerProfile)
			.where(eq(sellerProfile.id, seller.profile.id));
		expect(profile.vatChangeBlocked).toBe(true);
		// The CAS missed, so reviewedBy was not overwritten by the second admin.
		const [row] = await db
			.select()
			.from(sellerProfileChange)
			.where(eq(sellerProfileChange.id, change.id));
		expect(row.reviewedBy).toBe(firstAdmin);
	});

	it("throws 404 when the change does not exist", async () => {
		const adminId = await seedAdmin("missing-admin@test.com");
		await expect(
			approveChange(crypto.randomUUID(), adminId),
		).rejects.toMatchObject({ status: 404 });
	});
});

// ── rejectChange ──────────────────────────────────────────────────────────────

describe("rejectChange", () => {
	it("flips to rejected, stores the reason, and unblocks VAT once", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db, { email: "rej-ok@test.com" });
		await db
			.update(sellerProfile)
			.set({ vatChangeBlocked: true })
			.where(eq(sellerProfile.id, seller.profile.id));
		const adminId = await seedAdmin("rej-ok-admin@test.com");
		const change = await seedChange({
			sellerProfileId: seller.profile.id,
			changeType: "vat",
			changeData: { vatNumber: "IT22222222222" },
		});

		const updated = await rejectChange({
			changeId: change.id,
			adminUserId: adminId,
			reason: "documenti illeggibili",
		});

		expect(updated.status).toBe("rejected");
		expect(updated.rejectionReason).toBe("documenti illeggibili");
		expect(updated.reviewedBy).toBe(adminId);

		const [profile] = await db
			.select()
			.from(sellerProfile)
			.where(eq(sellerProfile.id, seller.profile.id));
		expect(profile.vatChangeBlocked).toBe(false);
	});

	it("throws 400 when the change is already rejected", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db, { email: "rej-dup@test.com" });
		const firstAdmin = await seedAdmin("rej-first@test.com");
		const secondAdmin = await seedAdmin("rej-second@test.com");
		const change = await seedChange({
			sellerProfileId: seller.profile.id,
			changeType: "vat",
			changeData: { vatNumber: "IT33333333333" },
			status: "rejected",
			reviewedBy: firstAdmin,
		});

		await expect(
			rejectChange({ changeId: change.id, adminUserId: secondAdmin }),
		).rejects.toMatchObject({ status: 400 });

		const [row] = await db
			.select()
			.from(sellerProfileChange)
			.where(eq(sellerProfileChange.id, change.id));
		expect(row.reviewedBy).toBe(firstAdmin);
	});
});
