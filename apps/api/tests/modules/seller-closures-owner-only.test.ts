import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { closuresRoutes } from "@/modules/seller/routes/closures";
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
	.use(closuresRoutes);

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

describe("seller closures routes are owner-only", () => {
	it("GET /stores/:id/closures → 403 for a non-owner", async () => {
		const res = await call("GET", "/stores/some-id/closures");
		expect(res.status).toBe(403);
	});

	it("PUT /stores/:id/closures → 403 for a non-owner", async () => {
		const res = await call("PUT", "/stores/some-id/closures", {
			optOutIds: [],
			customClosures: [],
		});
		expect(res.status).toBe(403);
	});
});
