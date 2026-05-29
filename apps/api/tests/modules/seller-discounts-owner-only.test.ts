import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { discountsRoutes } from "@/modules/seller/routes/discounts";
import { errorHandler } from "@/plugins/error-handler";

const noopPino = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	trace: () => {},
} as any;

// Mounted bare (no seller guard) → withSeller(ctx).isOwner is undefined, i.e. a
// non-owner caller. requireOwner must turn that into a 403 before the handler
// does anything else.
const app = new Elysia()
	.state("pino", noopPino)
	.use(errorHandler)
	.use(discountsRoutes);

async function call(method: string, path: string) {
	return app.handle(new Request(`http://localhost${path}`, { method }));
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
