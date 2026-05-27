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

const constructEvent = mock(() => ({
	id: "evt_FAKE",
	type: "checkout.session.completed",
	data: { object: {} },
}));

mock.module("@/lib/stripe", () => ({
	stripe: {
		webhooks: { constructEventAsync: constructEvent },
	},
}));

mock.module("@/lib/env", () => ({
	env: { STRIPE_WEBHOOK_SECRET: "whsec_FAKE" },
}));

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
});

describe("handleStripeWebhook", () => {
	it("records the event in stripe_events table", async () => {
		await handleStripeWebhook({
			payload: "raw-body",
			signature: "t=1,v1=fake",
		});

		const events = await getTestDb().select().from(stripeEvent);
		expect(events).toHaveLength(1);
		expect(events[0].eventId).toBe("evt_FAKE");
		expect(events[0].eventType).toBe("checkout.session.completed");
	});

	it("is idempotent: a duplicate event is skipped", async () => {
		await handleStripeWebhook({ payload: "raw1", signature: "t=1,v1=a" });
		await handleStripeWebhook({ payload: "raw2", signature: "t=2,v1=b" });

		const events = await getTestDb().select().from(stripeEvent);
		expect(events).toHaveLength(1);
	});

	it("rejects invalid signatures", async () => {
		constructEvent.mockImplementationOnce(() => {
			throw new Error("No signatures found matching the expected signature");
		});

		await expect(
			handleStripeWebhook({ payload: "bad", signature: "invalid" }),
		).rejects.toThrow(/signature/i);
	});
});
