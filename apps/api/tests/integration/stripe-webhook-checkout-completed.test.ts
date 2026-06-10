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

const fakeSubscription = {
	id: "sub_FAKE",
	customer: "cus_FAKE",
	items: {
		data: [
			{
				price: { id: "price_FAKE" },
				current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
			},
		],
	},
	status: "active",
	cancel_at_period_end: false,
};

const subRetrieve = mock(async () => fakeSubscription);
const subCancel = mock(async () => ({ id: "sub_FAKE", status: "canceled" }));
const constructEvent = mock(() => ({
	id: "evt_CHECKOUT_OK",
	type: "checkout.session.completed",
	data: {
		object: {
			id: "cs_FAKE",
			payment_status: "paid",
			subscription: "sub_FAKE",
			customer: "cus_FAKE",
			metadata: { pendingStoreCreationId: "WILL_BE_REPLACED" },
		},
	},
}));

mock.module("@/lib/stripe", () => ({
	stripe: {
		subscriptions: { retrieve: subRetrieve, cancel: subCancel },
		webhooks: { constructEventAsync: constructEvent },
	},
}));

mock.module("@/lib/env", () => ({
	env: {
		STRIPE_SECRET_KEY: "sk_test_FAKE",
		STRIPE_WEBHOOK_SECRET: "whsec_FAKE",
	},
}));

import { eq } from "drizzle-orm";
import { pendingStoreCreation } from "@/db/schemas/pending-store-creation";
import { store } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { handleStripeWebhook } from "@/modules/webhooks/services/dispatcher";
import { truncateAll } from "../helpers/cleanup";
import { createTestMunicipality, createTestSeller } from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

let municipalityId: string;

beforeEach(async () => {
	await truncateAll(getTestDb());
	subCancel.mockClear();
	subRetrieve.mockClear();
	municipalityId = (await createTestMunicipality(getTestDb())).id;
});

function buildFormData() {
	return {
		name: "Test Store",
		addressLine1: "Via Roma 1",
		municipalityId,
		zipCode: "20100",
		country: "IT",
	};
}

function patchEventWithPendingId(pendingId: string) {
	constructEvent.mockImplementation(() => ({
		id: "evt_CHECKOUT_OK",
		type: "checkout.session.completed",
		data: {
			object: {
				id: "cs_FAKE",
				payment_status: "paid",
				subscription: "sub_FAKE",
				customer: "cus_FAKE",
				metadata: { pendingStoreCreationId: pendingId },
			},
		},
	}));
}

describe("handleCheckoutCompleted", () => {
	it("creates a store + subscription, marks pending as consumed", async () => {
		const { profile } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});

		const [pending] = await getTestDb()
			.insert(pendingStoreCreation)
			.values({
				sellerProfileId: profile.id,
				formData: buildFormData(),
				stripeCheckoutSessionId: "cs_FAKE",
				feeAmountCents: 2900,
				currency: "EUR",
				status: "open",
				expiresAt: new Date(Date.now() + 86400000),
			})
			.returning();

		patchEventWithPendingId(pending.id);

		await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

		const stores = await getTestDb().select().from(store);
		expect(stores).toHaveLength(1);
		expect(stores[0].name).toBe("Test Store");

		const subs = await getTestDb().select().from(storeSubscription);
		expect(subs).toHaveLength(1);
		expect(subs[0].stripeSubscriptionId).toBe("sub_FAKE");
		expect(subs[0].status).toBe("active");
		expect(subs[0].feeAmountCents).toBe(2900);

		const updatedPending = await getTestDb()
			.select()
			.from(pendingStoreCreation)
			.where(eq(pendingStoreCreation.id, pending.id))
			.then((r) => r[0]);
		expect(updatedPending.status).toBe("consumed");
		expect(updatedPending.consumedAt).toBeTruthy();
	});

	it("is idempotent: replaying the event does not create duplicate stores", async () => {
		const { profile } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});
		const [pending] = await getTestDb()
			.insert(pendingStoreCreation)
			.values({
				sellerProfileId: profile.id,
				formData: buildFormData(),
				stripeCheckoutSessionId: "cs_FAKE",
				feeAmountCents: 2900,
				currency: "EUR",
				status: "open",
				expiresAt: new Date(Date.now() + 86400000),
			})
			.returning();

		patchEventWithPendingId(pending.id);

		await handleStripeWebhook({ payload: "raw1", signature: "t=1,v1=a" });
		// Second call: same event id "evt_CHECKOUT_OK" is deduped by stripeEvent table
		await handleStripeWebhook({ payload: "raw2", signature: "t=2,v1=b" });

		const stores = await getTestDb().select().from(store);
		expect(stores).toHaveLength(1);
	});

	it("revives an expired pending: a paid checkout after pending expiry still creates the store + subscription", async () => {
		const { profile } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});

		const [pending] = await getTestDb()
			.insert(pendingStoreCreation)
			.values({
				sellerProfileId: profile.id,
				formData: buildFormData(),
				stripeCheckoutSessionId: "cs_FAKE",
				feeAmountCents: 2900,
				currency: "EUR",
				// The expire-pending cron already flipped this to 'expired'…
				status: "expired",
				expiresAt: new Date(Date.now() - 3600_000),
			})
			.returning();

		patchEventWithPendingId(pending.id);

		// …but the paid checkout.session.completed lands afterwards.
		await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

		const stores = await getTestDb().select().from(store);
		expect(stores).toHaveLength(1);
		expect(stores[0].name).toBe("Test Store");

		const subs = await getTestDb().select().from(storeSubscription);
		expect(subs).toHaveLength(1);
		expect(subs[0].stripeSubscriptionId).toBe("sub_FAKE");
		expect(subs[0].status).toBe("active");

		const updated = await getTestDb()
			.select()
			.from(pendingStoreCreation)
			.where(eq(pendingStoreCreation.id, pending.id))
			.then((r) => r[0]);
		expect(updated.status).toBe("consumed");
		// Payment honored — the live subscription is NOT canceled.
		expect(subCancel).not.toHaveBeenCalled();
	});

	it("cancels the orphaned subscription when the pending row no longer exists", async () => {
		patchEventWithPendingId("nonexistent-pending-id");

		await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

		const stores = await getTestDb().select().from(store);
		expect(stores).toHaveLength(0);
		const subs = await getTestDb().select().from(storeSubscription);
		expect(subs).toHaveLength(0);

		expect(subCancel).toHaveBeenCalledTimes(1);
		expect(subCancel).toHaveBeenCalledWith("sub_FAKE");
	});

	it("is idempotent on the existingSub guard: a sub already provisioned short-circuits even with a still-open pending", async () => {
		const { profile } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});

		const [existingStore] = await getTestDb()
			.insert(store)
			.values({
				sellerProfileId: profile.id,
				name: "Existing Store",
				addressLine1: "Via Roma 1",
				municipalityId,
				zipCode: "20100",
			})
			.returning();

		await getTestDb()
			.insert(storeSubscription)
			.values({
				storeId: existingStore.id,
				stripeSubscriptionId: "sub_FAKE",
				stripeCustomerId: "cus_FAKE",
				stripePriceId: "price_FAKE",
				feeAmountCents: 2900,
				currency: "EUR",
				status: "active",
				currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
			});

		// Pending is still 'open' (NOT consumed), so only the existingSub guard — not
		// the consumed-status guard — can produce the idempotent skip.
		const [pending] = await getTestDb()
			.insert(pendingStoreCreation)
			.values({
				sellerProfileId: profile.id,
				formData: buildFormData(),
				stripeCheckoutSessionId: "cs_FAKE",
				feeAmountCents: 2900,
				currency: "EUR",
				status: "open",
				expiresAt: new Date(Date.now() + 86400_000),
			})
			.returning();

		patchEventWithPendingId(pending.id);

		await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

		const stores = await getTestDb().select().from(store);
		expect(stores).toHaveLength(1);
		const subs = await getTestDb().select().from(storeSubscription);
		expect(subs).toHaveLength(1);
		expect(subCancel).not.toHaveBeenCalled();

		// The open pending must be left completely untouched by the early return.
		const after = await getTestDb()
			.select()
			.from(pendingStoreCreation)
			.where(eq(pendingStoreCreation.id, pending.id))
			.then((r) => r[0]);
		expect(after.status).toBe("open");
		expect(after.consumedAt).toBeNull();
	});

	it("revives a canceled pending too (not just expired)", async () => {
		const { profile } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});

		const [pending] = await getTestDb()
			.insert(pendingStoreCreation)
			.values({
				sellerProfileId: profile.id,
				formData: buildFormData(),
				stripeCheckoutSessionId: "cs_FAKE",
				feeAmountCents: 2900,
				currency: "EUR",
				status: "canceled",
				expiresAt: new Date(Date.now() - 3600_000),
			})
			.returning();

		patchEventWithPendingId(pending.id);
		await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

		const stores = await getTestDb().select().from(store);
		expect(stores).toHaveLength(1);
		const subs = await getTestDb().select().from(storeSubscription);
		expect(subs).toHaveLength(1);

		const updated = await getTestDb()
			.select()
			.from(pendingStoreCreation)
			.where(eq(pendingStoreCreation.id, pending.id))
			.then((r) => r[0]);
		expect(updated.status).toBe("consumed");
		expect(subCancel).not.toHaveBeenCalled();
	});

	it("does NOT cancel when the orphaned subscription is already terminal", async () => {
		subRetrieve.mockImplementationOnce(
			async () => ({ ...fakeSubscription, status: "canceled" }) as any,
		);
		patchEventWithPendingId("nonexistent-pending-id");

		await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

		expect(subCancel).not.toHaveBeenCalled();
		const stores = await getTestDb().select().from(store);
		expect(stores).toHaveLength(0);
	});

	it("re-throws (keeps the event reprocessable) if canceling the orphaned subscription fails", async () => {
		subCancel.mockImplementationOnce(async () => {
			throw new Error("stripe down");
		});
		patchEventWithPendingId("nonexistent-pending-id");

		await expect(
			handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" }),
		).rejects.toThrow();

		expect(subCancel).toHaveBeenCalledTimes(1);
	});

	it("throws before any write when the paid subscription has no usable line item", async () => {
		subRetrieve.mockImplementationOnce(
			async () => ({ ...fakeSubscription, items: { data: [] } }) as any,
		);

		const { profile } = await createTestSeller(getTestDb(), {
			email: "a@b.it",
		});
		const [pending] = await getTestDb()
			.insert(pendingStoreCreation)
			.values({
				sellerProfileId: profile.id,
				formData: buildFormData(),
				stripeCheckoutSessionId: "cs_FAKE",
				feeAmountCents: 2900,
				currency: "EUR",
				status: "open",
				expiresAt: new Date(Date.now() + 86400_000),
			})
			.returning();

		patchEventWithPendingId(pending.id);

		await expect(
			handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" }),
		).rejects.toThrow();

		// No partial writes: no store, no subscription, pending still 'open'.
		const stores = await getTestDb().select().from(store);
		expect(stores).toHaveLength(0);
		const subs = await getTestDb().select().from(storeSubscription);
		expect(subs).toHaveLength(0);
		expect(subCancel).not.toHaveBeenCalled();

		const after = await getTestDb()
			.select()
			.from(pendingStoreCreation)
			.where(eq(pendingStoreCreation.id, pending.id))
			.then((r) => r[0]);
		expect(after.status).toBe("open");
	});
});
