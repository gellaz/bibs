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

let currentNotification: any = null;
const parseEventNotificationAsync = mock(
	async (_p: string, _s: string, _secret: string) => currentNotification,
);
const constructEventAsync = mock(async () => {
	throw new Error("thin events must not be parsed as snapshot events");
});
// Stato attuale del conto su Stripe: stripe_transfers attivo, nessun requisito
// a carico del seller. È quello che il refresh deve copiare.
const activeV2Account = () => ({
	id: "acct_1",
	object: "v2.core.account",
	configuration: {
		recipient: {
			applied: true,
			capabilities: {
				stripe_balance: {
					stripe_transfers: { status: "active", status_details: [] },
					payouts: { status: "active", status_details: [] },
				},
			},
		},
	},
	requirements: { entries: [] },
});
const accountsRetrieve = mock(async (_id: string, _p?: unknown) =>
	activeV2Account(),
);

mock.module("@/lib/stripe", () => ({
	stripe: {
		webhooks: { constructEventAsync },
		parseEventNotificationAsync,
		v2: { core: { accounts: { retrieve: accountsRetrieve } } },
	},
}));
mock.module("@/lib/env", () => ({
	env: {
		STRIPE_SECRET_KEY: "sk_test_FAKE",
		STRIPE_WEBHOOK_SECRET: "whsec_PLATFORM",
		STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_CONNECT",
		STRIPE_THIN_WEBHOOK_SECRET: "whsec_THIN",
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
	parseEventNotificationAsync.mockClear();
	constructEventAsync.mockClear();
	accountsRetrieve.mockClear();
});

const CAPABILITY =
	"v2.core.account[configuration.recipient].capability_status_updated";
const REQUIREMENTS = "v2.core.account[requirements].updated";

function notification(id: string, type: string, accountId = "acct_1") {
	return {
		id,
		object: "v2.core.event",
		type,
		created: "2026-10-07T08:35:04.921Z",
		livemode: false,
		related_object: {
			id: accountId,
			type: "v2.core.account",
			url: `/v2/core/accounts/${accountId}`,
		},
	};
}

// Il seller ha finito l'onboarding: gli eventi v1 sono arrivati quando
// stripe_transfers era ancora `restricted`, quindi la riga è ferma a false.
async function seedStaleAccount() {
	const seller = await createTestSeller(getTestDb());
	await getTestDb().insert(paymentMethod).values({
		sellerProfileId: seller.profile.id,
		stripeAccountId: "acct_1",
		chargesEnabled: false,
		payoutsEnabled: false,
		detailsSubmitted: false,
	});
	return seller;
}

async function row() {
	const [r] = await getTestDb()
		.select()
		.from(paymentMethod)
		.where(eq(paymentMethod.stripeAccountId, "acct_1"));
	return r;
}

async function processedAt(eventId: string) {
	const [ev] = await getTestDb()
		.select()
		.from(stripeEvent)
		.where(eq(stripeEvent.eventId, eventId));
	return ev?.processedAt ?? null;
}

const deliver = () =>
	handleStripeWebhook({ payload: "raw", signature: "sig", scope: "thin" });

describe("thin events v2 dei conti Connect", () => {
	it("verifica la firma come thin event col segreto dedicato", async () => {
		await seedStaleAccount();
		currentNotification = notification("evt_T1", CAPABILITY);
		await deliver();
		expect(parseEventNotificationAsync.mock.calls[0][2]).toBe("whsec_THIN");
		expect(constructEventAsync).not.toHaveBeenCalled();
	});

	it("capability_status_updated rilegge il conto e sblocca charges_enabled", async () => {
		await seedStaleAccount();
		currentNotification = notification("evt_T2", CAPABILITY);
		await deliver();
		expect(accountsRetrieve.mock.calls[0][0]).toBe("acct_1");
		expect(await row()).toMatchObject({
			chargesEnabled: true,
			payoutsEnabled: true,
			detailsSubmitted: true,
		});
		expect(await processedAt("evt_T2")).toBeTruthy();
	});

	it("requirements.updated rilegge il conto (details_submitted)", async () => {
		await seedStaleAccount();
		currentNotification = notification("evt_T3", REQUIREMENTS);
		await deliver();
		expect((await row()).detailsSubmitted).toBe(true);
	});

	it("evento duplicato: la seconda consegna non rilegge", async () => {
		await seedStaleAccount();
		currentNotification = notification("evt_T4", CAPABILITY);
		await deliver();
		await deliver();
		expect(accountsRetrieve).toHaveBeenCalledTimes(1);
	});

	it("conto sconosciuto: evento processato senza rileggere", async () => {
		currentNotification = notification("evt_T5", CAPABILITY, "acct_ghost");
		await deliver();
		expect(accountsRetrieve).not.toHaveBeenCalled();
		expect(await processedAt("evt_T5")).toBeTruthy();
	});

	it("tipo non gestito: solo log, evento processato", async () => {
		await seedStaleAccount();
		currentNotification = notification(
			"evt_T6",
			"v2.core.account[identity].updated",
		);
		await deliver();
		expect(accountsRetrieve).not.toHaveBeenCalled();
		expect(await processedAt("evt_T6")).toBeTruthy();
	});

	it("errore di Stripe nel retrieve: processed_at resta null (→ 500, retry)", async () => {
		await seedStaleAccount();
		accountsRetrieve.mockImplementationOnce(async () => {
			throw new Error("stripe down");
		});
		currentNotification = notification("evt_T7", CAPABILITY);
		await expect(deliver()).rejects.toThrow("stripe down");
		expect(await processedAt("evt_T7")).toBeNull();
	});

	it("firma non valida: 400, niente ledger", async () => {
		parseEventNotificationAsync.mockImplementationOnce(async () => {
			throw new Error("No signatures found matching the expected signature");
		});
		await expect(deliver()).rejects.toThrow("Invalid Stripe signature");
		expect(await getTestDb().select().from(stripeEvent)).toHaveLength(0);
	});
});
