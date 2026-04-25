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
import { organization } from "@/db/schemas/organization";
import { type OnboardingStatus, sellerProfile } from "@/db/schemas/seller";
import { ServiceError } from "@/lib/errors";
import {
	countSellersByStatus,
	getSellerDetail,
	listSellers,
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
