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

const sessionCreate = mock(async () => ({
	id: "cs_FAKE",
	url: "https://stripe.test/checkout/cs_FAKE",
}));
const sessionRetrieve = mock(async () => ({
	id: "cs_FAKE",
	url: "https://stripe.test/checkout/cs_FAKE",
	status: "open",
}));

mock.module("@/lib/stripe", () => ({
	stripe: {
		customers: { create: async () => ({ id: "cus_FAKE" }) },
		checkout: {
			sessions: { create: sessionCreate, retrieve: sessionRetrieve },
		},
	},
}));

mock.module("@/lib/env", () => ({
	env: {
		STRIPE_SECRET_KEY: "sk_test_FAKE",
		SELLER_APP_URL: "http://localhost:3002",
	},
}));

import { eq } from "drizzle-orm";
import { pendingStoreCreation } from "@/db/schemas/pending-store-creation";
import { pricingConfig } from "@/db/schemas/pricing-config";
import { sellerProfile } from "@/db/schemas/seller";
import { createCheckoutSession } from "@/modules/seller/services/checkout";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller } from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
	sessionCreate.mockClear();
	sessionRetrieve.mockClear();

	await getTestDb().insert(pricingConfig).values({
		storeMonthlyFeeCents: 2900,
		currency: "EUR",
		stripePriceId: "price_FAKE",
		suspendedAutoCancelDays: 60,
		pendingCreationExpiryHours: 24,
		isActive: true,
	});
});

const VALID_BODY = {
	name: "Pasticceria Test",
	addressLine1: "Via Roma 1",
	municipalityId: "00000000-0000-0000-0000-000000000001",
	zipCode: "20100",
};

describe("createCheckoutSession", () => {
	it("creates a pending row and a Stripe Checkout Session", async () => {
		const { profile } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});

		const result = await createCheckoutSession({
			sellerProfileId: profile.id,
			body: VALID_BODY,
		});

		expect(result.checkoutUrl).toBe("https://stripe.test/checkout/cs_FAKE");
		expect(result.pendingStoreCreationId).toBeTruthy();

		const pending = await getTestDb()
			.select()
			.from(pendingStoreCreation)
			.where(eq(pendingStoreCreation.id, result.pendingStoreCreationId))
			.then((r) => r[0]);

		expect(pending.status).toBe("open");
		expect(pending.feeAmountCents).toBe(2900);
		expect(pending.stripeCheckoutSessionId).toBe("cs_FAKE");
	});

	it("returns the existing pending if seller already has one open (idempotent)", async () => {
		const { profile } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});

		const r1 = await createCheckoutSession({
			sellerProfileId: profile.id,
			body: VALID_BODY,
		});

		sessionRetrieve.mockImplementationOnce(
			async () =>
				({
					id: "cs_FAKE",
					url: "https://stripe.test/checkout/cs_FAKE",
					status: "open",
				}) as any,
		);

		const r2 = await createCheckoutSession({
			sellerProfileId: profile.id,
			body: VALID_BODY,
		});

		expect(r1.pendingStoreCreationId).toBe(r2.pendingStoreCreationId);
		expect(sessionCreate).toHaveBeenCalledTimes(1);
	});

	it("creates a fresh session if the existing one is expired in Stripe", async () => {
		const { profile } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});

		// First call: create normally
		const first = await createCheckoutSession({
			sellerProfileId: profile.id,
			body: VALID_BODY,
		});
		expect(sessionCreate).toHaveBeenCalledTimes(1);

		// Now simulate the session being expired in Stripe
		sessionRetrieve.mockImplementationOnce(
			async () =>
				({
					id: "cs_FAKE",
					url: "https://stripe.test/checkout/cs_EXPIRED",
					status: "expired",
				}) as any,
		);
		// The new Stripe session must have a different ID to avoid the unique constraint
		sessionCreate.mockImplementationOnce(async () => ({
			id: "cs_FAKE_2",
			url: "https://stripe.test/checkout/cs_FAKE_2",
		}));

		// Second call: should mark existing pending as expired, create new session
		const second = await createCheckoutSession({
			sellerProfileId: profile.id,
			body: VALID_BODY,
		});

		expect(second.pendingStoreCreationId).not.toBe(
			first.pendingStoreCreationId,
		);
		expect(sessionCreate).toHaveBeenCalledTimes(2);

		// Verify the original pending is now expired
		const oldPending = await getTestDb()
			.select()
			.from(pendingStoreCreation)
			.where(eq(pendingStoreCreation.id, first.pendingStoreCreationId))
			.then((r) => r[0]);
		expect(oldPending.status).toBe("expired");
	});

	it("caches the stripeCustomerId on the seller profile", async () => {
		const { profile } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});

		await createCheckoutSession({
			sellerProfileId: profile.id,
			body: VALID_BODY,
		});

		const updated = await getTestDb()
			.select()
			.from(sellerProfile)
			.where(eq(sellerProfile.id, profile.id))
			.then((r) => r[0]);

		expect(updated.stripeCustomerId).toBe("cus_FAKE");
	});
});
