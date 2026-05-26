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
		subscriptions: { retrieve: subRetrieve },
		webhooks: { constructEvent },
	},
}));

mock.module("@/lib/env", () => ({
	env: { STRIPE_WEBHOOK_SECRET: "whsec_FAKE" },
}));

import { eq } from "drizzle-orm";
import { pendingStoreCreation } from "@/db/schemas/pending-store-creation";
import { store } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { handleStripeWebhook } from "@/modules/webhooks/services/dispatcher";
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
});

const FORM_DATA = {
	name: "Test Store",
	addressLine1: "Via Roma 1",
	city: "Milano",
	zipCode: "20100",
	country: "IT",
};

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
				formData: FORM_DATA,
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
				formData: FORM_DATA,
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
});
