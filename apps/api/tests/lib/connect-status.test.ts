import { describe, expect, it } from "bun:test";
import type Stripe from "stripe";
import { accountStateFromV2, connectStatus } from "@/lib/connect-status";

const pm = (
	o: Partial<{
		stripeAccountId: string | null;
		detailsSubmitted: boolean;
		chargesEnabled: boolean;
	}>,
) => ({
	stripeAccountId: "acct_1",
	detailsSubmitted: false,
	chargesEnabled: false,
	...o,
});

describe("connectStatus", () => {
	it("none senza riga o senza conto", () => {
		expect(connectStatus(null)).toBe("none");
		expect(connectStatus(undefined)).toBe("none");
		expect(connectStatus(pm({ stripeAccountId: null }))).toBe("none");
	});
	it("incomplete finché l'onboarding non è inviato", () => {
		expect(connectStatus(pm({}))).toBe("incomplete");
	});
	it("in_review con dati inviati ma incassi non ancora abilitati", () => {
		expect(connectStatus(pm({ detailsSubmitted: true }))).toBe("in_review");
	});
	it("enabled quando Stripe abilita gli incassi, a prescindere da details_submitted", () => {
		expect(connectStatus(pm({ chargesEnabled: true }))).toBe("enabled");
		expect(
			connectStatus(pm({ detailsSubmitted: true, chargesEnabled: true })),
		).toBe("enabled");
	});
});

type Status = "active" | "pending" | "restricted" | "unsupported";

const entry = (awaiting_action_from: "stripe" | "user") =>
	({
		awaiting_action_from,
		description: "representative.dob",
		errors: [],
		impact: {},
		minimum_deadline: { status: "currently_due" },
		requested_reasons: [{ code: "routine_onboarding" }],
	}) as Stripe.V2.Core.Account.Requirements.Entry;

const v2Account = (o: {
	transfers?: Status;
	payouts?: Status;
	entries?: Stripe.V2.Core.Account.Requirements.Entry[];
}): Stripe.V2.Core.Account =>
	({
		id: "acct_1",
		object: "v2.core.account",
		applied_configurations: ["recipient"],
		created: "2026-09-25T00:00:00.000Z",
		livemode: false,
		configuration: {
			recipient: {
				applied: true,
				capabilities: {
					stripe_balance: {
						stripe_transfers: {
							status: o.transfers ?? "active",
							status_details: [],
						},
						payouts: { status: o.payouts ?? "active", status_details: [] },
					},
				},
			},
		},
		requirements: { entries: o.entries ?? [] },
	}) as Stripe.V2.Core.Account;

describe("accountStateFromV2", () => {
	it("tutto attivo e nessun requisito per il seller → tutto true", () => {
		expect(accountStateFromV2(v2Account({}))).toEqual({
			chargesEnabled: true,
			payoutsEnabled: true,
			detailsSubmitted: true,
		});
	});
	it("stripe_transfers pending → chargesEnabled false", () => {
		expect(
			accountStateFromV2(v2Account({ transfers: "pending" })).chargesEnabled,
		).toBe(false);
	});
	it("payouts restricted → payoutsEnabled false", () => {
		expect(
			accountStateFromV2(v2Account({ payouts: "restricted" })).payoutsEnabled,
		).toBe(false);
	});
	it("un requisito in attesa del seller → detailsSubmitted false", () => {
		expect(
			accountStateFromV2(
				v2Account({ entries: [entry("stripe"), entry("user")] }),
			).detailsSubmitted,
		).toBe(false);
	});
	it("requisiti in attesa solo di Stripe → detailsSubmitted true", () => {
		expect(
			accountStateFromV2(v2Account({ entries: [entry("stripe")] }))
				.detailsSubmitted,
		).toBe(true);
	});
	it("configuration e requirements assenti → tutto false", () => {
		const bare = {
			id: "acct_1",
			object: "v2.core.account",
			applied_configurations: [],
			created: "2026-09-25T00:00:00.000Z",
			livemode: false,
		} as Stripe.V2.Core.Account;
		expect(accountStateFromV2(bare)).toEqual({
			chargesEnabled: false,
			payoutsEnabled: false,
			detailsSubmitted: false,
		});
		expect(
			accountStateFromV2({
				...bare,
				configuration: null,
				requirements: null,
			} as unknown as Stripe.V2.Core.Account),
		).toEqual({
			chargesEnabled: false,
			payoutsEnabled: false,
			detailsSubmitted: false,
		});
	});
});
