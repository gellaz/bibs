import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { billingRoutes } from "@/modules/seller/routes/billing";
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
// so requireOwner must produce a 403 before the handler runs. Bodies are
// valid on purpose: a 422 from validation would pass for the wrong reason.
const app = new Elysia()
	.state("pino", noopPino)
	.use(errorHandler)
	.use(billingRoutes);

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

describe("seller billing routes are owner-only", () => {
	it("GET /billing/summary → 403 for a non-owner", async () => {
		const res = await call("GET", "/billing/summary");
		expect(res.status).toBe(403);
	});

	it("GET /billing/subscriptions → 403 for a non-owner", async () => {
		const res = await call("GET", "/billing/subscriptions");
		expect(res.status).toBe(403);
	});

	it("POST /billing/portal → 403 for a non-owner", async () => {
		const res = await call("POST", "/billing/portal");
		expect(res.status).toBe(403);
	});

	it("GET /billing/invoices → 403 for a non-owner", async () => {
		const res = await call("GET", "/billing/invoices");
		expect(res.status).toBe(403);
	});
});
