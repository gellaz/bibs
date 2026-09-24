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
import { storeEmployee } from "@/db/schemas/employee";
import { type OnboardingStatus, sellerProfile } from "@/db/schemas/seller";
import { ServiceError } from "@/lib/errors";
import { resolveSellerAccess } from "@/modules/seller/context";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller } from "../helpers/fixtures";

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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function setOnboarding(profileId: string, status: OnboardingStatus) {
	await getTestDb()
		.update(sellerProfile)
		.set({ onboardingStatus: status })
		.where(eq(sellerProfile.id, profileId));
}

/** A seller at `status` with one *active* employee. */
async function sellerWithEmployee(status: OnboardingStatus) {
	const db = getTestDb();
	const { profile } = await createTestSeller(db);
	await setOnboarding(profile.id, status);

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
	return { profile, empUserId };
}

async function expectStatus(
	p: Promise<unknown>,
	status: ServiceError["status"],
) {
	const err = await p.then(
		() => null,
		(e) => e,
	);
	expect(err).toBeInstanceOf(ServiceError);
	expect((err as ServiceError).status).toBe(status);
}

// ── resolveSellerAccess ───────────────────────────────────────────────────────

describe("resolveSellerAccess — employee branch", () => {
	it("grants access when the employer seller is active", async () => {
		const { profile, empUserId } = await sellerWithEmployee("active");

		const ctx = await resolveSellerAccess({ id: empUserId, role: "employee" });

		expect(ctx.isOwner).toBe(false);
		expect(ctx.sellerProfile.id).toBe(profile.id);
	});

	for (const status of ["pending_review", "rejected"] as const) {
		it(`denies an active employee when the employer is ${status}`, async () => {
			const { empUserId } = await sellerWithEmployee(status);

			await expectStatus(
				resolveSellerAccess({ id: empUserId, role: "employee" }),
				403,
			);
		});
	}
});

describe("resolveSellerAccess — owner branch (parity)", () => {
	it("denies an owner whose onboarding is not active", async () => {
		const { user, profile } = await createTestSeller(getTestDb());
		await setOnboarding(profile.id, "rejected");

		await expectStatus(
			resolveSellerAccess({ id: user.id, role: "seller" }),
			403,
		);
	});
});
