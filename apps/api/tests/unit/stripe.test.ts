import { describe, expect, it } from "bun:test";
import { stripe } from "@/lib/stripe";

describe("stripe wrapper", () => {
	it("exposes a Stripe SDK instance with the configured secret key", () => {
		expect(stripe).toBeDefined();
		expect(stripe.subscriptions).toBeDefined();
		expect(stripe.checkout.sessions).toBeDefined();
	});
});
