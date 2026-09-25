import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { storesRoutes } from "@/modules/seller/routes/stores";
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
	.use(storesRoutes);

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

const VALID_STORE_BODY = {
	name: "Pasticceria Test",
	addressLine1: "Via Roma 1",
	municipalityId: "00000000-0000-0000-0000-000000000001",
	zipCode: "20100",
};

describe("seller stores routes are owner-only", () => {
	it("GET /stores/archived → 403 for a non-owner", async () => {
		const res = await call("GET", "/stores/archived");
		expect(res.status).toBe(403);
	});

	it("POST /stores → 403 for a non-owner", async () => {
		const res = await call("POST", "/stores", VALID_STORE_BODY);
		expect(res.status).toBe(403);
	});

	it("PATCH /stores/:id → 403 for a non-owner", async () => {
		const res = await call("PATCH", "/stores/some-id", { name: "Nuovo nome" });
		expect(res.status).toBe(403);
	});

	it("DELETE /stores/:id → 403 for a non-owner", async () => {
		const res = await call("DELETE", "/stores/some-id");
		expect(res.status).toBe(403);
	});

	it("POST /stores/:id/reactivate → 403 for a non-owner", async () => {
		const res = await call("POST", "/stores/some-id/reactivate");
		expect(res.status).toBe(403);
	});

	it("PATCH /stores/:id/order-types → 403 for a non-owner", async () => {
		const res = await call("PATCH", "/stores/some-id/order-types", {
			orderTypes: ["reserve_pickup"],
		});
		expect(res.status).toBe(403);
	});

	it("GET /stores/:id/order-types → 403 for a non-owner", async () => {
		const res = await call("GET", "/stores/some-id/order-types");
		expect(res.status).toBe(403);
	});
});
