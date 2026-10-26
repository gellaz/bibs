import { describe, expect, it } from "bun:test";
import { moduleApp } from "@/http/app";
import { adminBillingRoutes } from "@/modules/admin/routes/billing";
import { testRequest } from "../helpers/hono-app";

// Mounted bare: validation runs before the handler, so a bad productId must be
// a 422 and never reach Stripe as an empty product.
const app = moduleApp().route("/", adminBillingRoutes);

const VALID = {
	storeMonthlyFeeCents: 2900,
	currency: "EUR",
	suspendedAutoCancelDays: 60,
	pendingCreationExpiryHours: 24,
	productId: "prod_ABC123",
};

function put(body: unknown) {
	return testRequest(app, "/billing/pricing", {
		method: "PUT",
		body: JSON.stringify(body),
		headers: { "content-type": "application/json" },
	});
}

describe("PUT /billing/pricing — productId", () => {
	for (const productId of ["", "abc", "prod_"]) {
		it(`rejects productId ${JSON.stringify(productId)} with 422`, async () => {
			const res = await put({ ...VALID, productId });
			expect(res.status).toBe(422);
		});
	}

	it("accepts a Stripe product id (passes validation)", async () => {
		const res = await put(VALID);
		expect(res.status).not.toBe(422);
	});
});
