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
type CapStatus = "active" | "pending" | "restricted" | "unsupported";
// Conto Accounts v2 come lo restituisce retrieve con
// include: ["configuration.recipient", "requirements"].
const v2Account = (o: {
	transfers: CapStatus;
	payouts: CapStatus;
	awaitingUser: boolean;
}) => ({
	id: "acct_NEW",
	object: "v2.core.account",
	configuration: {
		recipient: {
			applied: true,
			capabilities: {
				stripe_balance: {
					stripe_transfers: { status: o.transfers, status_details: [] },
					payouts: { status: o.payouts, status_details: [] },
				},
			},
		},
	},
	requirements: {
		entries: o.awaitingUser
			? [
					{
						awaiting_action_from: "user",
						description: "representative.dob",
						errors: [],
						impact: {},
						minimum_deadline: { status: "currently_due" },
						requested_reasons: [{ code: "routine_onboarding" }],
					},
				]
			: [],
	},
});
const NOT_ONBOARDED = {
	transfers: "pending",
	payouts: "pending",
	awaitingUser: true,
} as const;
let remoteAccount = v2Account(NOT_ONBOARDED);
const accountsRetrieve = mock(
	async (_id: string, _p?: unknown) => remoteAccount,
);
const accountLinksCreate = mock(async (_p: unknown) => ({
	url: "https://connect.stripe.test/setup/abc",
}));

mock.module("@/lib/stripe", () => ({
	stripe: {
		v2: {
			core: {
				accounts: { create: accountsCreate, retrieve: accountsRetrieve },
				accountLinks: { create: accountLinksCreate },
			},
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
	remoteAccount = v2Account(NOT_ONBOARDED);
});

describe("createOnboardingLink", () => {
	it("crea il conto v2 (IT, Express, recipient con stripe_transfers) e salva la riga", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db, { email: "neg@test.it" });

		const res = await createOnboardingLink({
			sellerProfileId: seller.profile.id,
			email: "neg@test.it",
		});

		expect(res.url).toBe("https://connect.stripe.test/setup/abc");
		expect(accountsCreate).toHaveBeenCalledTimes(1);
		const [params, opts] = accountsCreate.mock.calls[0] as [any, any];
		expect(params).toEqual({
			contact_email: "neg@test.it",
			dashboard: "express",
			identity: { country: "IT" },
			defaults: {
				responsibilities: {
					fees_collector: "application",
					losses_collector: "application",
				},
			},
			configuration: {
				recipient: {
					capabilities: {
						stripe_balance: { stripe_transfers: { requested: true } },
					},
				},
			},
			metadata: { sellerProfileId: seller.profile.id },
			include: ["configuration.recipient", "requirements"],
		});
		// Nessuna idempotency key fissa: un retry dopo un errore reale non deve
		// essere bloccato per 24h dallo stesso conto fallito (vedi il test sotto).
		expect(opts).toBeUndefined();
		expect(accountLinksCreate.mock.calls[0][0]).toEqual({
			account: "acct_NEW",
			use_case: {
				type: "account_onboarding",
				account_onboarding: {
					configurations: ["recipient"],
					refresh_url: "http://localhost:3002/payments/refresh",
					return_url: "http://localhost:3002/payments/return",
				},
			},
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
	it("copia lo stato del conto v2 sulla riga (transfers attivi, payouts in attesa, niente a carico del seller)", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await db.insert(paymentMethod).values({
			sellerProfileId: seller.profile.id,
			stripeAccountId: "acct_NEW",
		});
		remoteAccount = v2Account({
			transfers: "active",
			payouts: "pending",
			awaitingUser: false,
		});

		const row = await refreshConnectAccount("acct_NEW");

		expect(accountsRetrieve).toHaveBeenCalledWith("acct_NEW", {
			include: ["configuration.recipient", "requirements"],
		});
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

describe("refreshConnectAccount — errori v2", () => {
	it("retrieve v2 rifiuta con 404 → riga degradata a false, nessun errore", async () => {
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
				message: "Account not found",
				type: "invalid_request_error",
				code: "not_found",
				statusCode: 404,
			} as any);
		});

		const row = await refreshConnectAccount("acct_NEW");

		expect(row).toMatchObject({
			chargesEnabled: false,
			payoutsEnabled: false,
			detailsSubmitted: false,
		});
	});

	it("errore transitorio (500) risale invariato: il webhook deve far ritentare Stripe", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await db.insert(paymentMethod).values({
			sellerProfileId: seller.profile.id,
			stripeAccountId: "acct_NEW",
			chargesEnabled: true,
		});
		accountsRetrieve.mockImplementationOnce(async () => {
			throw new Stripe.errors.StripeAPIError({
				message: "boom",
				type: "api_error",
				statusCode: 500,
			} as any);
		});

		await expect(refreshConnectAccount("acct_NEW")).rejects.toBeInstanceOf(
			Stripe.errors.StripeAPIError,
		);
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
		remoteAccount = v2Account({
			transfers: "active",
			payouts: "active",
			awaitingUser: false,
		});

		expect(await syncOnlinePayments(seller.profile.id)).toEqual({
			status: "enabled",
			chargesEnabled: true,
			payoutsEnabled: true,
		});
	});
});
