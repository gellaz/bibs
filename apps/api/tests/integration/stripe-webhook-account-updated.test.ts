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
const constructEventAsync = mock(
	async (_p: string, _s: string, _secret: string) => currentEvent,
);
let remote = {
	id: "acct_1",
	charges_enabled: true,
	payouts_enabled: true,
	details_submitted: true,
};
const accountsRetrieve = mock(async (_id: string) => remote);

mock.module("@/lib/stripe", () => ({
	stripe: {
		webhooks: { constructEventAsync },
		accounts: { retrieve: accountsRetrieve },
	},
}));
mock.module("@/lib/env", () => ({
	env: {
		STRIPE_SECRET_KEY: "sk_test_FAKE",
		STRIPE_WEBHOOK_SECRET: "whsec_PLATFORM",
		STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_CONNECT",
	},
}));

import { eq } from "drizzle-orm";
import { paymentMethod } from "@/db/schemas/payment-method";
import { stripeEvent } from "@/db/schemas/stripe-event";
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
	constructEventAsync.mockClear();
	accountsRetrieve.mockClear();
	remote = {
		id: "acct_1",
		charges_enabled: true,
		payouts_enabled: true,
		details_submitted: true,
	};
});

function accountEvent(id: string, snapshot: Record<string, unknown> = {}) {
	return {
		id,
		type: "account.updated",
		account: "acct_1",
		data: {
			object: {
				id: "acct_1",
				charges_enabled: false,
				payouts_enabled: false,
				details_submitted: false,
				...snapshot,
			},
		},
	};
}

async function seedAccount() {
	const seller = await createTestSeller(getTestDb());
	await getTestDb()
		.insert(paymentMethod)
		.values({ sellerProfileId: seller.profile.id, stripeAccountId: "acct_1" });
	return seller;
}

async function row() {
	const [r] = await getTestDb()
		.select()
		.from(paymentMethod)
		.where(eq(paymentMethod.stripeAccountId, "acct_1"));
	return r;
}

describe("account.updated", () => {
	it("verifica la firma col segreto Connect sulla scope connect", async () => {
		await seedAccount();
		currentEvent = accountEvent("evt_A1");
		await handleStripeWebhook({
			payload: "raw",
			signature: "sig",
			scope: "connect",
		});
		expect(constructEventAsync.mock.calls[0][2]).toBe("whsec_CONNECT");
	});

	it("aggiorna la riga con lo stato riletto da Stripe, non con lo snapshot", async () => {
		await seedAccount();
		currentEvent = accountEvent("evt_A2"); // snapshot tutto false
		await handleStripeWebhook({
			payload: "raw",
			signature: "sig",
			scope: "connect",
		});
		expect(await row()).toMatchObject({
			chargesEnabled: true,
			payoutsEnabled: true,
			detailsSubmitted: true,
		});
	});

	it("evento duplicato: la seconda consegna non rilegge né riscrive", async () => {
		await seedAccount();
		currentEvent = accountEvent("evt_A3");
		await handleStripeWebhook({
			payload: "raw",
			signature: "sig",
			scope: "connect",
		});
		await handleStripeWebhook({
			payload: "raw",
			signature: "sig",
			scope: "connect",
		});
		expect(accountsRetrieve).toHaveBeenCalledTimes(1);
		const [ev] = await getTestDb()
			.select()
			.from(stripeEvent)
			.where(eq(stripeEvent.eventId, "evt_A3"));
		expect(ev.processedAt).toBeTruthy();
	});

	it("evento vecchio arrivato dopo: lo stato resta quello attuale di Stripe", async () => {
		await seedAccount();
		currentEvent = accountEvent("evt_NEW", { charges_enabled: true });
		await handleStripeWebhook({
			payload: "raw",
			signature: "sig",
			scope: "connect",
		});
		currentEvent = accountEvent("evt_OLD", { charges_enabled: false });
		await handleStripeWebhook({
			payload: "raw",
			signature: "sig",
			scope: "connect",
		});
		expect((await row()).chargesEnabled).toBe(true);
	});

	it("conto sconosciuto: evento marcato processato, nessun errore", async () => {
		currentEvent = accountEvent("evt_GHOST");
		await handleStripeWebhook({
			payload: "raw",
			signature: "sig",
			scope: "connect",
		});
		expect(accountsRetrieve).not.toHaveBeenCalled();
		const [ev] = await getTestDb()
			.select()
			.from(stripeEvent)
			.where(eq(stripeEvent.eventId, "evt_GHOST"));
		expect(ev.processedAt).toBeTruthy();
	});

	it("errore di Stripe nel retrieve: processed_at resta null e l'errore risale (→ 500, retry)", async () => {
		await seedAccount();
		accountsRetrieve.mockImplementationOnce(async () => {
			throw new Error("stripe down");
		});
		currentEvent = accountEvent("evt_FAIL");
		await expect(
			handleStripeWebhook({
				payload: "raw",
				signature: "sig",
				scope: "connect",
			}),
		).rejects.toThrow("stripe down");
		const [ev] = await getTestDb()
			.select()
			.from(stripeEvent)
			.where(eq(stripeEvent.eventId, "evt_FAIL"));
		expect(ev.processedAt).toBeNull();
	});

	it("scope connect ignora un invoice.payment_succeeded", async () => {
		await seedAccount();
		currentEvent = {
			id: "evt_INV",
			type: "invoice.payment_succeeded",
			data: { object: { id: "in_1" } },
		};
		await handleStripeWebhook({
			payload: "raw",
			signature: "sig",
			scope: "connect",
		});
		expect(accountsRetrieve).not.toHaveBeenCalled();
		const [ev] = await getTestDb()
			.select()
			.from(stripeEvent)
			.where(eq(stripeEvent.eventId, "evt_INV"));
		expect(ev.processedAt).toBeTruthy();
	});

	it("account.updated sulla route piattaforma è ignorato", async () => {
		await seedAccount();
		currentEvent = accountEvent("evt_PLAT");
		await handleStripeWebhook({
			payload: "raw",
			signature: "sig",
			scope: "platform",
		});
		expect(accountsRetrieve).not.toHaveBeenCalled();
		expect(await row()).toMatchObject({
			chargesEnabled: false,
			payoutsEnabled: false,
			detailsSubmitted: false,
		});
		const [ev] = await getTestDb()
			.select()
			.from(stripeEvent)
			.where(eq(stripeEvent.eventId, "evt_PLAT"));
		expect(ev.processedAt).toBeTruthy();
	});
});
