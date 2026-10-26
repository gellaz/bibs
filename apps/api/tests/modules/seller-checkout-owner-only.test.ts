import { describe, expect, it } from "bun:test";
import { checkoutRoutes } from "@/modules/seller/routes/checkout";
import { testRequest, withVars } from "../helpers/hono-app";

// Mounted with a non-owner seller context (`withVars`, no session read) →
// requireOwner must produce a 403 before the handler runs.
const app = withVars(checkoutRoutes, {
	user: { id: "u1" },
	seller: { isOwner: false },
});

async function call(method: string, path: string, body?: unknown) {
	return testRequest(app, path, {
		method,
		...(body
			? {
					body: JSON.stringify(body),
					headers: { "content-type": "application/json" },
				}
			: {}),
	});
}

const VALID_BODY = {
	name: "Pasticceria Test",
	addressLine1: "Via Roma 1",
	municipalityId: "00000000-0000-0000-0000-000000000001",
	zipCode: "20100",
	location: { x: 11.3426, y: 44.4949 },
};

describe("seller checkout routes are owner-only", () => {
	it("POST /stores/checkout → 403 for a non-owner", async () => {
		const res = await call("POST", "/stores/checkout", VALID_BODY);
		expect(res.status).toBe(403);
	});

	it("GET /checkout-sessions/:id/status → 403 for a non-owner", async () => {
		const res = await call("GET", "/checkout-sessions/cs_test/status");
		expect(res.status).toBe(403);
	});

	it("GET /stores/checkout/:pendingId → 403 for a non-owner", async () => {
		const res = await call("GET", "/stores/checkout/some-id");
		expect(res.status).toBe(403);
	});

	it("POST /stores/:id/reactivation-checkout → 403 for a non-owner", async () => {
		const res = await call("POST", "/stores/some-id/reactivation-checkout");
		expect(res.status).toBe(403);
	});
});

// La validazione del body gira prima del guard: un negozio senza pin non
// arriva mai al checkout, qualunque sia il chiamante.
describe("POST /stores/checkout requires a store location", () => {
	it("→ 422 without location", async () => {
		const { location: _, ...withoutLocation } = VALID_BODY;
		const res = await call("POST", "/stores/checkout", withoutLocation);
		expect(res.status).toBe(422);
	});

	it("→ 422 with a latitude out of range", async () => {
		const res = await call("POST", "/stores/checkout", {
			...VALID_BODY,
			location: { x: 11.3426, y: 144.4949 },
		});
		expect(res.status).toBe(422);
	});
});
