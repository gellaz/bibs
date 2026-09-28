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
		webhooks: { constructEventAsync: async () => currentEvent },
	},
}));

mock.module("@/lib/env", () => ({
	env: {
		NODE_ENV: "test",
		STRIPE_SECRET_KEY: "sk_test_FAKE",
		STRIPE_WEBHOOK_SECRET: "whsec_FAKE",
		SELLER_APP_URL: "http://seller.test",
		CUSTOMER_APP_URL: "http://customer.test",
	},
}));

const sendEmail = mock(
	async (_params: { to: string; subject: string; html: string }) => {},
);
mock.module("@/lib/email", () => ({ sendEmail }));

import { eq } from "drizzle-orm";
import { store } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { stripeEvent } from "@/db/schemas/stripe-event";
import { handleStripeWebhook } from "@/modules/webhooks/services/dispatcher";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller, createTestStore } from "../helpers/fixtures";

const OWNER_EMAIL = "titolare@forno.it";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
	sendEmail.mockReset();
	sendEmail.mockImplementation(async () => {});
});

type SubStatus = "active" | "past_due" | "canceling" | "suspended" | "canceled";

async function seed(
	status: SubStatus,
	extra: Partial<typeof storeSubscription.$inferInsert> = {},
) {
	const { profile } = await createTestSeller(getTestDb(), {
		name: "Mario Rossi",
		email: OWNER_EMAIL,
	});
	const storeRow = await createTestStore(getTestDb(), profile.id, {
		name: "Forno Bianchi",
	});
	const [sub] = await getTestDb()
		.insert(storeSubscription)
		.values({
			storeId: storeRow.id,
			stripeSubscriptionId: "sub_MAIL",
			stripeCustomerId: "cus_FAKE",
			stripePriceId: "price_FAKE",
			feeAmountCents: 2900,
			currency: "EUR",
			status,
			currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
			...extra,
		})
		.returning();
	return { sub, storeRow };
}

async function readSub(id: string) {
	return getTestDb()
		.select()
		.from(storeSubscription)
		.where(eq(storeSubscription.id, id))
		.then((r) => r[0]);
}

async function deliver(event: any) {
	currentEvent = event;
	await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });
}

function invoiceFailed(id: string) {
	return {
		id,
		type: "invoice.payment_failed",
		data: {
			object: {
				id: `in_${id}`,
				amount_due: 2900,
				currency: "eur",
				parent: { subscription_details: { subscription: "sub_MAIL" } },
			},
		},
	};
}

function subUpdated(id: string, status: string) {
	return {
		id,
		type: "customer.subscription.updated",
		data: {
			object: {
				id: "sub_MAIL",
				status,
				cancel_at_period_end: false,
				items: {
					data: [{ current_period_end: Math.floor(Date.now() / 1000) }],
				},
			},
		},
	};
}

function subDeleted(id: string) {
	return {
		id,
		type: "customer.subscription.deleted",
		data: { object: { id: "sub_MAIL" } },
	};
}

describe("invoice.payment_failed → «Pagamento non riuscito»", () => {
	it("sends one email to the store owner on active → past_due", async () => {
		const { sub } = await seed("active");
		await deliver(invoiceFailed("evt_FAIL_1"));

		expect((await readSub(sub.id)).status).toBe("past_due");
		expect(sendEmail).toHaveBeenCalledTimes(1);
		const [{ to, subject, html }] = sendEmail.mock.calls[0];
		expect(to).toBe(OWNER_EMAIL);
		expect(subject).toBe("Pagamento non riuscito per Forno Bianchi");
		const text = html.replaceAll("<!-- -->", "").replaceAll(" ", " ");
		expect(text).toContain("29,00 €");
		expect(text).toContain("http://seller.test/billing");
	});

	it("also fires from canceling", async () => {
		await seed("canceling");
		await deliver(invoiceFailed("evt_FAIL_CXL"));
		expect(sendEmail).toHaveBeenCalledTimes(1);
	});

	it("does not resend on a replay of the same event", async () => {
		await seed("active");
		await deliver(invoiceFailed("evt_FAIL_REPLAY"));
		await deliver(invoiceFailed("evt_FAIL_REPLAY"));
		expect(sendEmail).toHaveBeenCalledTimes(1);
	});

	it("does not send on Stripe's retries while already past_due", async () => {
		await seed("active");
		await deliver(invoiceFailed("evt_FAIL_A"));
		await deliver(invoiceFailed("evt_FAIL_B"));
		expect(sendEmail).toHaveBeenCalledTimes(1);
	});

	it("does not send from suspended", async () => {
		const { sub } = await seed("suspended", { suspendedAt: new Date() });
		await deliver(invoiceFailed("evt_FAIL_SUSP"));
		expect((await readSub(sub.id)).status).toBe("suspended");
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it("an email failure does not fail the webhook", async () => {
		const { sub } = await seed("active");
		sendEmail.mockImplementation(async () => {
			throw new Error("resend down");
		});

		await deliver(invoiceFailed("evt_FAIL_MAILDOWN"));

		expect((await readSub(sub.id)).status).toBe("past_due");
		const [ledger] = await getTestDb()
			.select()
			.from(stripeEvent)
			.where(eq(stripeEvent.eventId, "evt_FAIL_MAILDOWN"));
		expect(ledger.processedAt).toBeTruthy();
	});
});

describe("customer.subscription.updated → «Negozio sospeso»", () => {
	it("sends on the first move to suspended", async () => {
		const { sub } = await seed("past_due");
		await deliver(subUpdated("evt_UNPAID_1", "unpaid"));

		expect((await readSub(sub.id)).status).toBe("suspended");
		expect(sendEmail).toHaveBeenCalledTimes(1);
		const [{ to, subject, html }] = sendEmail.mock.calls[0];
		expect(to).toBe(OWNER_EMAIL);
		expect(subject).toBe("Forno Bianchi è sospeso su bibs");
		expect(html).toContain("http://seller.test/billing");
	});

	it("does not resend while already suspended", async () => {
		await seed("past_due");
		await deliver(subUpdated("evt_UNPAID_A", "unpaid"));
		await deliver(subUpdated("evt_UNPAID_B", "unpaid"));
		await deliver(subUpdated("evt_UNPAID_A", "unpaid"));
		expect(sendEmail).toHaveBeenCalledTimes(1);
	});

	it("does not send for past_due or active updates", async () => {
		await seed("active");
		await deliver(subUpdated("evt_PD", "past_due"));
		await deliver(subUpdated("evt_OK", "active"));
		expect(sendEmail).not.toHaveBeenCalled();
	});

	it("an email failure does not fail the webhook", async () => {
		const { sub } = await seed("past_due");
		sendEmail.mockImplementation(async () => {
			throw new Error("resend down");
		});
		await deliver(subUpdated("evt_UNPAID_MAILDOWN", "unpaid"));
		expect((await readSub(sub.id)).status).toBe("suspended");
	});
});

describe("customer.subscription.deleted → «Negozio cancellato»", () => {
	it("payment failure (no reason recorded): payment copy + archive link", async () => {
		await seed("suspended", { suspendedAt: new Date() });
		await deliver(subDeleted("evt_DEL_AUTO"));

		expect(sendEmail).toHaveBeenCalledTimes(1);
		const [{ to, subject, html }] = sendEmail.mock.calls[0];
		expect(to).toBe(OWNER_EMAIL);
		expect(subject).toBe("Forno Bianchi è stato archiviato");
		expect(html).toContain("mancato pagamento");
		expect(html).toContain("http://seller.test/store/archived");
	});

	it("seller_canceled: seller copy", async () => {
		await seed("canceling", { cancelReason: "seller_canceled" });
		await deliver(subDeleted("evt_DEL_SELLER"));

		expect(sendEmail).toHaveBeenCalledTimes(1);
		const [{ html }] = sendEmail.mock.calls[0];
		expect(html).toContain("come hai richiesto");
		expect(html).not.toContain("mancato pagamento");
	});

	it("auto-cancel job path: row already 'canceled' but store still live → sends", async () => {
		// runAutoCancelSuspended flips the row to canceled BEFORE calling Stripe;
		// the webhook that follows is the first time the store gets archived.
		const { storeRow } = await seed("canceled", {
			cancelReason: "payment_failed_auto",
			canceledAt: new Date(),
		});
		await deliver(subDeleted("evt_DEL_JOB"));

		expect(sendEmail).toHaveBeenCalledTimes(1);
		expect(sendEmail.mock.calls[0][0].html).toContain("mancato pagamento");
		const [after] = await getTestDb()
			.select()
			.from(store)
			.where(eq(store.id, storeRow.id));
		expect(after.deletedAt).toBeTruthy();
	});

	it("does not resend once the store is archived (replay or second event)", async () => {
		await seed("active");
		await deliver(subDeleted("evt_DEL_1"));
		await deliver(subDeleted("evt_DEL_1"));
		await deliver(subDeleted("evt_DEL_2"));
		expect(sendEmail).toHaveBeenCalledTimes(1);
	});

	it("an email failure does not fail the webhook", async () => {
		const { sub, storeRow } = await seed("active");
		sendEmail.mockImplementation(async () => {
			throw new Error("resend down");
		});
		await deliver(subDeleted("evt_DEL_MAILDOWN"));

		expect((await readSub(sub.id)).status).toBe("canceled");
		const [after] = await getTestDb()
			.select()
			.from(store)
			.where(eq(store.id, storeRow.id));
		expect(after.deletedAt).toBeTruthy();
	});
});
