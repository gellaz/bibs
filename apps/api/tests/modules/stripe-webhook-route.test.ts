import { afterEach, describe, expect, it, mock } from "bun:test";

// The route is a thin adapter over the dispatcher; mock the dispatcher so we can
// drive each branch (success / signature error / handler failure) deterministically
// without a database or real Stripe verification.
const handleStripeWebhook = mock(async () => {});
mock.module("@/modules/webhooks/services/dispatcher", () => ({
	handleStripeWebhook,
}));

import { stripeWebhookRoutes } from "@/modules/webhooks/routes/stripe";

function post(
	body: string,
	headers: Record<string, string> = { "stripe-signature": "sig" },
): Promise<Response> {
	return stripeWebhookRoutes.handle(
		new Request("http://localhost/webhooks/stripe", {
			method: "POST",
			headers,
			body,
		}),
	);
}

afterEach(() => {
	handleStripeWebhook.mockClear();
});

describe("POST /webhooks/stripe status codes", () => {
	it("returns 400 when the stripe-signature header is missing", async () => {
		const res = await post("raw", {});
		expect(res.status).toBe(400);
	});

	it("returns 400 on signature verification failure", async () => {
		handleStripeWebhook.mockImplementationOnce(async () => {
			throw new Error("Invalid Stripe signature");
		});
		const res = await post("raw");
		expect(res.status).toBe(400);
	});

	it("returns 500 on handler failure so Stripe retries (does not swallow as 200)", async () => {
		handleStripeWebhook.mockImplementationOnce(async () => {
			throw new Error("db connection lost mid-handler");
		});
		const res = await post("raw");
		expect(res.status).toBe(500);
	});

	it("returns 200 on successful processing", async () => {
		const res = await post("raw");
		expect(res.status).toBe(200);
	});
});
