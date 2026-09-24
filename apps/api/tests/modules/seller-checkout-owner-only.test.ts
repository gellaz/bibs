import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { checkoutRoutes } from "@/modules/seller/routes/checkout";
import { errorHandler } from "@/plugins/error-handler";

const noopPino = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	trace: () => {},
} as any;

// Mounted bare (no seller guard) → withSeller(ctx).isOwner is undefined,
// so requireOwner must produce a 403 before the handler runs.
const app = new Elysia()
	.state("pino", noopPino)
	.use(errorHandler)
	.use(checkoutRoutes);

async function call(method: string, path: string, body?: unknown) {
	return app.handle(
		new Request(`http://localhost${path}`, {
			method,
			...(body
				? {
						body: JSON.stringify(body),
						headers: { "content-type": "application/json" },
					}
				: {}),
		}),
	);
}

const VALID_BODY = {
	name: "Pasticceria Test",
	addressLine1: "Via Roma 1",
	municipalityId: "00000000-0000-0000-0000-000000000001",
	zipCode: "20100",
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
});
