import { describe, expect, it } from "bun:test";
import { discountsRoutes } from "@/modules/seller/routes/discounts";
import { testRequest, withVars } from "../helpers/hono-app";

// Mounted with a non-owner seller context (`withVars`, no session read), i.e.
// a non-owner caller. requireOwner must turn that into a 403 before the
// handler does anything else.
const app = withVars(discountsRoutes, {
	user: { id: "u1" },
	seller: { isOwner: false },
});

async function call(method: string, path: string) {
	return testRequest(app, path, { method });
}

describe("discounts module is owner-only", () => {
	it("GET /discounts → 403 for a non-owner", async () => {
		const res = await call("GET", "/discounts");
		expect(res.status).toBe(403);
	});

	it("POST /discounts/:id/archive → 403 for a non-owner", async () => {
		const res = await call("POST", "/discounts/some-id/archive");
		expect(res.status).toBe(403);
	});

	it("POST /discounts/:id/pause → 403 for a non-owner", async () => {
		const res = await call("POST", "/discounts/some-id/pause");
		expect(res.status).toBe(403);
	});
});
