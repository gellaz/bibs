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

const accountsCreate = mock(async (_p: unknown, _o: unknown) => ({
	id: "acct_NEW",
}));
let remoteAccount = {
	id: "acct_NEW",
	charges_enabled: false,
	payouts_enabled: false,
	details_submitted: false,
};
const accountsRetrieve = mock(async (_id: string) => remoteAccount);
const accountLinksCreate = mock(async (_p: unknown) => ({
	url: "https://connect.stripe.test/setup/abc",
}));

mock.module("@/lib/stripe", () => ({
	stripe: {
		accounts: { create: accountsCreate, retrieve: accountsRetrieve },
		accountLinks: { create: accountLinksCreate },
	},
}));

mock.module("@/lib/env", () => ({
	env: {
		STRIPE_SECRET_KEY: "sk_test_FAKE",
		SELLER_APP_URL: "http://localhost:3002",
	},
}));

import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { paymentMethod } from "@/db/schemas/payment-method";
import {
	createOnboardingLink,
	refreshConnectAccount,
	syncOnlinePayments,
} from "@/modules/billing/services/connect-account";
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
	accountsCreate.mockClear();
	accountsRetrieve.mockClear();
	accountLinksCreate.mockClear();
	remoteAccount = {
		id: "acct_NEW",
		charges_enabled: false,
		payouts_enabled: false,
		details_submitted: false,
	};
});

describe("createOnboardingLink", () => {
	it("crea il conto (IT, controller Express, card_payments+transfers) e salva la riga", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db, { email: "neg@test.it" });

		const res = await createOnboardingLink({
			sellerProfileId: seller.profile.id,
			email: "neg@test.it",
		});

		expect(res.url).toBe("https://connect.stripe.test/setup/abc");
		expect(accountsCreate).toHaveBeenCalledTimes(1);
		const [params, opts] = accountsCreate.mock.calls[0] as [any, any];
		expect(params).toMatchObject({
			country: "IT",
			email: "neg@test.it",
			controller: {
				stripe_dashboard: { type: "express" },
				fees: { payer: "application" },
				losses: { payments: "application" },
				requirement_collection: "stripe",
			},
			capabilities: {
				card_payments: { requested: true },
				transfers: { requested: true },
			},
			metadata: { sellerProfileId: seller.profile.id },
		});
		// Nessuna idempotency key fissa: un retry dopo un errore reale non deve
		// essere bloccato per 24h dallo stesso conto fallito (vedi il test sotto).
		expect(opts).toBeUndefined();
		expect(accountLinksCreate.mock.calls[0][0]).toEqual({
			account: "acct_NEW",
			type: "account_onboarding",
			return_url: "http://localhost:3002/payments/return",
			refresh_url: "http://localhost:3002/payments/refresh",
		});
		const rows = await db
			.select()
			.from(paymentMethod)
			.where(eq(paymentMethod.sellerProfileId, seller.profile.id));
		expect(rows).toHaveLength(1);
		expect(rows[0].stripeAccountId).toBe("acct_NEW");
		expect(rows[0].isDefault).toBe(true);
	});

	it("riusa il conto esistente: nessun secondo accounts.create", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await db.insert(paymentMethod).values({
			sellerProfileId: seller.profile.id,
			stripeAccountId: "acct_OLD",
		});

		await createOnboardingLink({
			sellerProfileId: seller.profile.id,
			email: "x@test.it",
		});

		expect(accountsCreate).not.toHaveBeenCalled();
		expect((accountLinksCreate.mock.calls[0][0] as any).account).toBe(
			"acct_OLD",
		);
	});

	it("riempie una riga default senza conto invece di crearne un'altra", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await db
			.insert(paymentMethod)
			.values({ sellerProfileId: seller.profile.id });

		await createOnboardingLink({
			sellerProfileId: seller.profile.id,
			email: "x@test.it",
		});

		const rows = await db
			.select()
			.from(paymentMethod)
			.where(eq(paymentMethod.sellerProfileId, seller.profile.id));
		expect(rows).toHaveLength(1);
		expect(rows[0].stripeAccountId).toBe("acct_NEW");
	});

	// L'harness di test serializza le transazioni (vedi feedback_testcontainer_serializes_tx):
	// questo Promise.all dimostra che il secondo `ensureConnectAccount` rilegge
	// payment_methods sotto il lock e trova il conto scritto dal primo, non la
	// race stessa (che richiederebbe interleaving reale in produzione).
	it("doppio click: due chiamate insieme → un solo conto e una sola riga", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = { sellerProfileId: seller.profile.id, email: "x@test.it" };

		await Promise.all([createOnboardingLink(p), createOnboardingLink(p)]);

		expect(accountsCreate).toHaveBeenCalledTimes(1);
		const rows = await db
			.select()
			.from(paymentMethod)
			.where(eq(paymentMethod.sellerProfileId, seller.profile.id));
		expect(rows).toHaveLength(1);
	});

	it("accounts.create rifiuta → nessuna riga, 502, e un secondo tentativo riesce", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db, { email: "boom@test.it" });

		accountsCreate.mockImplementationOnce(async () => {
			throw new Stripe.errors.StripeAPIError({
				message: "boom",
				type: "api_error",
			} as any);
		});

		await expect(
			createOnboardingLink({
				sellerProfileId: seller.profile.id,
				email: "boom@test.it",
			}),
		).rejects.toMatchObject({ status: 502 });

		const rowsAfterFailure = await db
			.select()
			.from(paymentMethod)
			.where(eq(paymentMethod.sellerProfileId, seller.profile.id));
		expect(rowsAfterFailure).toHaveLength(0);

		const res = await createOnboardingLink({
			sellerProfileId: seller.profile.id,
			email: "boom@test.it",
		});
		expect(res.url).toBe("https://connect.stripe.test/setup/abc");

		const rows = await db
			.select()
			.from(paymentMethod)
			.where(eq(paymentMethod.sellerProfileId, seller.profile.id));
		expect(rows).toHaveLength(1);
		expect(rows[0].stripeAccountId).toBe("acct_NEW");
	});

	it("accountLinks.create rifiuta: la riga col conto resta salvata (tx già committata), risposta 502, il retry riusa il conto senza un secondo accounts.create", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db, { email: "link-boom@test.it" });

		accountLinksCreate.mockImplementationOnce(async () => {
			throw new Stripe.errors.StripeAPIError({
				message: "link boom",
				type: "api_error",
			} as any);
		});

		await expect(
			createOnboardingLink({
				sellerProfileId: seller.profile.id,
				email: "link-boom@test.it",
			}),
		).rejects.toMatchObject({ status: 502 });

		const rows = await db
			.select()
			.from(paymentMethod)
			.where(eq(paymentMethod.sellerProfileId, seller.profile.id));
		expect(rows).toHaveLength(1);
		expect(rows[0].stripeAccountId).toBe("acct_NEW");

		const res = await createOnboardingLink({
			sellerProfileId: seller.profile.id,
			email: "link-boom@test.it",
		});
		expect(res.url).toBe("https://connect.stripe.test/setup/abc");
		expect(accountsCreate).toHaveBeenCalledTimes(1);
	});
});

describe("refreshConnectAccount", () => {
	it("copia charges/payouts/details da Stripe sulla riga", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await db.insert(paymentMethod).values({
			sellerProfileId: seller.profile.id,
			stripeAccountId: "acct_NEW",
		});
		remoteAccount = {
			id: "acct_NEW",
			charges_enabled: true,
			payouts_enabled: false,
			details_submitted: true,
		};

		const row = await refreshConnectAccount("acct_NEW");

		expect(accountsRetrieve).toHaveBeenCalledWith("acct_NEW");
		expect(row).toMatchObject({
			chargesEnabled: true,
			payoutsEnabled: false,
			detailsSubmitted: true,
		});
	});

	it("un conto che perde gli incassi torna a false", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await db.insert(paymentMethod).values({
			sellerProfileId: seller.profile.id,
			stripeAccountId: "acct_NEW",
			chargesEnabled: true,
			payoutsEnabled: true,
			detailsSubmitted: true,
		});

		const row = await refreshConnectAccount("acct_NEW");

		expect(row).toMatchObject({
			chargesEnabled: false,
			payoutsEnabled: false,
			detailsSubmitted: false,
		});
	});

	it("conto sconosciuto → null, nessuna chiamata a Stripe", async () => {
		expect(await refreshConnectAccount("acct_GHOST")).toBeNull();
		expect(accountsRetrieve).not.toHaveBeenCalled();
	});

	it("retrieve rifiuta con resource_missing → riga degradata a false, nessun errore", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await db.insert(paymentMethod).values({
			sellerProfileId: seller.profile.id,
			stripeAccountId: "acct_NEW",
			chargesEnabled: true,
			payoutsEnabled: true,
			detailsSubmitted: true,
		});
		accountsRetrieve.mockImplementationOnce(async () => {
			throw new Stripe.errors.StripeInvalidRequestError({
				message: "No such account",
				type: "invalid_request_error",
				code: "resource_missing",
			} as any);
		});

		const row = await refreshConnectAccount("acct_NEW");

		expect(row).toMatchObject({
			chargesEnabled: false,
			payoutsEnabled: false,
			detailsSubmitted: false,
		});
	});
});

describe("syncOnlinePayments", () => {
	it("senza conto → 404", async () => {
		const seller = await createTestSeller(getTestDb());
		await expect(syncOnlinePayments(seller.profile.id)).rejects.toMatchObject({
			status: 404,
		});
	});

	it("rilegge e restituisce lo stato", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await db.insert(paymentMethod).values({
			sellerProfileId: seller.profile.id,
			stripeAccountId: "acct_NEW",
		});
		remoteAccount = {
			id: "acct_NEW",
			charges_enabled: true,
			payouts_enabled: true,
			details_submitted: true,
		};

		expect(await syncOnlinePayments(seller.profile.id)).toEqual({
			status: "enabled",
			chargesEnabled: true,
			payoutsEnabled: true,
		});
	});
});
