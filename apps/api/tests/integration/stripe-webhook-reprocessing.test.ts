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

// The signature-verification step returns whatever event we stage here.
let currentEvent: { id: string; type: string; data: { object: unknown } } = {
	id: "evt_RETRY",
	type: "checkout.session.completed",
	data: { object: {} },
};
const constructEvent = mock(async () => currentEvent);
mock.module("@/lib/stripe", () => ({
	stripe: {
		webhooks: { constructEventAsync: constructEvent },
	},
}));

mock.module("@/lib/env", () => ({
	env: {
		STRIPE_SECRET_KEY: "sk_test_FAKE",
		STRIPE_WEBHOOK_SECRET: "whsec_FAKE",
	},
}));

// A controllable handler stands in for the real checkout-completed handler so
// the test exercises the dispatcher's failure/retry contract, not handler internals.
const checkoutHandler = mock(async (_event: unknown) => {});
mock.module("@/modules/webhooks/services/handlers/checkout-completed", () => ({
	handleCheckoutCompleted: checkoutHandler,
}));

import { eq } from "drizzle-orm";
import { stripeEvent } from "@/db/schemas/stripe-event";
import { handleStripeWebhook } from "@/modules/webhooks/services/dispatcher";
import { truncateAll } from "../helpers/cleanup";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
	constructEvent.mockClear();
	checkoutHandler.mockClear();
	checkoutHandler.mockImplementation(async () => {});
	currentEvent = {
		id: "evt_RETRY",
		type: "checkout.session.completed",
		data: { object: {} },
	};
});

describe("handleStripeWebhook failure reprocessing", () => {
	it("retries a failed event on redelivery instead of permanently dropping it", async () => {
		// First delivery: the handler throws (transient/db/Stripe error mid-handler).
		checkoutHandler.mockImplementationOnce(async () => {
			throw new Error("transient handler failure");
		});

		await expect(
			handleStripeWebhook({ payload: "raw1", signature: "t=1,v1=a" }),
		).rejects.toThrow(/transient/);

		// A failed event must NOT be marked processed.
		const afterFail = await getTestDb()
			.select()
			.from(stripeEvent)
			.where(eq(stripeEvent.eventId, "evt_RETRY"));
		expect(afterFail).toHaveLength(1);
		expect(afterFail[0]?.processedAt).toBeNull();

		// Stripe redelivers the SAME event id: the handler must run again (retry),
		// not be silently skipped by the dedup ledger.
		await handleStripeWebhook({ payload: "raw2", signature: "t=2,v1=b" });

		expect(checkoutHandler).toHaveBeenCalledTimes(2);
		const afterRetry = await getTestDb()
			.select()
			.from(stripeEvent)
			.where(eq(stripeEvent.eventId, "evt_RETRY"));
		expect(afterRetry).toHaveLength(1);
		expect(afterRetry[0]?.processedAt).not.toBeNull();
	});

	it("skips an already-successfully-processed event (idempotency preserved)", async () => {
		await handleStripeWebhook({ payload: "raw1", signature: "t=1,v1=a" });
		await handleStripeWebhook({ payload: "raw2", signature: "t=2,v1=b" });

		expect(checkoutHandler).toHaveBeenCalledTimes(1);
		const events = await getTestDb().select().from(stripeEvent);
		expect(events).toHaveLength(1);
		expect(events[0]?.processedAt).not.toBeNull();
	});
});
