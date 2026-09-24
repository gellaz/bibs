import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { employeesRoutes } from "@/modules/seller/routes/employees";
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
	.use(employeesRoutes);

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

describe("seller employee management is owner-only", () => {
	it("POST /employees/invite → 403 for a non-owner", async () => {
		const res = await call("POST", "/employees/invite", {
			email: "emp@test.com",
			storeIds: ["some-store"],
		});
		expect(res.status).toBe(403);
	});

	it("GET /employees/invitations → 403 for a non-owner", async () => {
		const res = await call("GET", "/employees/invitations");
		expect(res.status).toBe(403);
	});

	it("DELETE /employees/invitations/:id → 403 for a non-owner", async () => {
		const res = await call("DELETE", "/employees/invitations/some-id");
		expect(res.status).toBe(403);
	});

	it("PATCH /employees/:id/ban → 403 for a non-owner", async () => {
		const res = await call("PATCH", "/employees/some-id/ban");
		expect(res.status).toBe(403);
	});

	it("PATCH /employees/:id/unban → 403 for a non-owner", async () => {
		const res = await call("PATCH", "/employees/some-id/unban");
		expect(res.status).toBe(403);
	});

	it("DELETE /employees/:id → 403 for a non-owner", async () => {
		const res = await call("DELETE", "/employees/some-id");
		expect(res.status).toBe(403);
	});

	it("GET /employees/:id/stores → 403 for a non-owner", async () => {
		const res = await call("GET", "/employees/some-id/stores");
		expect(res.status).toBe(403);
	});

	it("PUT /employees/:id/stores → 403 for a non-owner", async () => {
		const res = await call("PUT", "/employees/some-id/stores", {
			storeIds: ["some-store"],
		});
		expect(res.status).toBe(403);
	});
});
