import { describe, expect, it } from "bun:test";
import { sellerApp } from "@/modules/seller";
import { employeesRoutes } from "@/modules/seller/routes/employees";
import { withVars } from "../../../helpers/hono-app";

// Mounted with a resolved non-owner (withVars skips the seller guard),
// so requireOwner must produce a 403 before the handler runs. Bodies are
// valid on purpose: a 422 from validation would pass for the wrong reason.
const app = withVars(employeesRoutes, {
	user: { id: "u" },
	seller: { isOwner: false },
});

async function call(method: string, path: string, body?: unknown) {
	return app.request(
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

// L'email la controlla il formato dell'app composta di prima (`FORMATS`,
// `lib/schemas/formats.ts`): «a@b.c» è un 422, prima del 401 e del 403.
describe("POST /employees/invite — email rifiutata dall'app composta", () => {
	const body = JSON.stringify({ email: "a@b.c", storeIds: ["some-store"] });
	const invalid = "Inserisci un indirizzo email valido";

	it("anonimo → 422 prima del 401", async () => {
		const res = await sellerApp.request("/employees/invite", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
		});
		expect(res.status).toBe(422);
		expect((await res.json()).message).toBe(invalid);
	});

	it("non titolare → 422 prima del 403", async () => {
		const res = await call("POST", "/employees/invite", JSON.parse(body));
		expect(res.status).toBe(422);
		expect((await res.json()).message).toBe(invalid);
	});
});
