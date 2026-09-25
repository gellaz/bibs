import { describe, expect, it } from "bun:test";
import { connectStatus } from "@/lib/connect-status";

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
