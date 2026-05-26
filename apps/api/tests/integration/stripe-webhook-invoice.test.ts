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

let currentEvent: any = null;

mock.module("@/lib/stripe", () => ({
	stripe: {
		webhooks: { constructEvent: () => currentEvent },
	},
}));

mock.module("@/lib/env", () => ({
	env: { STRIPE_WEBHOOK_SECRET: "whsec_FAKE" },
}));

import { eq } from "drizzle-orm";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { handleStripeWebhook } from "@/modules/webhooks/services/dispatcher";
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

async function seedSubscription(
	stripeSubId: string,
	status: "active" | "past_due" = "active",
) {
	const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });
	const storeRow = await createTestStore(getTestDb(), profile.id);
	const [sub] = await getTestDb()
		.insert(storeSubscription)
		.values({
			storeId: storeRow.id,
			stripeSubscriptionId: stripeSubId,
			stripeCustomerId: "cus_FAKE",
			stripePriceId: "price_FAKE",
			feeAmountCents: 2900,
			currency: "EUR",
			status,
			currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
		})
		.returning();
	return sub;
}

// In Stripe v22 the subscription ID is at invoice.parent.subscription_details.subscription
// (not at invoice.subscription which no longer exists on the root).
function makeInvoiceObject(
	stripeSubId: string,
	extra: Record<string, unknown> = {},
) {
	return {
		id: "in_FAKE",
		parent: {
			type: "subscription_details",
			quote_details: null,
			subscription_details: {
				subscription: stripeSubId,
			},
		},
		...extra,
	};
}

describe("invoice.payment_succeeded", () => {
	it("sets status to active and updates currentPeriodEnd", async () => {
		const sub = await seedSubscription("sub_INV_OK", "past_due");

		const newPeriodEnd = Math.floor((Date.now() + 60 * 86400000) / 1000);
		currentEvent = {
			id: "evt_INV_OK",
			type: "invoice.payment_succeeded",
			data: {
				object: makeInvoiceObject("sub_INV_OK", {
					lines: { data: [{ period: { end: newPeriodEnd } }] },
				}),
			},
		};

		await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

		const after = await getTestDb()
			.select()
			.from(storeSubscription)
			.where(eq(storeSubscription.id, sub.id))
			.then((r) => r[0]);
		expect(after.status).toBe("active");
		expect(after.currentPeriodEnd.getTime()).toBe(newPeriodEnd * 1000);
		expect(after.suspendedAt).toBeNull();
	});
});

describe("invoice.payment_failed", () => {
	it("sets status to past_due (from active)", async () => {
		const sub = await seedSubscription("sub_INV_FAIL", "active");

		currentEvent = {
			id: "evt_INV_FAIL",
			type: "invoice.payment_failed",
			data: { object: makeInvoiceObject("sub_INV_FAIL") },
		};

		await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

		const after = await getTestDb()
			.select()
			.from(storeSubscription)
			.where(eq(storeSubscription.id, sub.id))
			.then((r) => r[0]);
		expect(after.status).toBe("past_due");
	});
});
