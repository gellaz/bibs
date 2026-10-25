import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { normalize } from "@/plugins/normalize";

const app = new Elysia().use(normalize).post("/", ({ body }) => body);

async function post(body: unknown) {
	const res = await app.handle(
		new Request("http://localhost/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
	return res.json();
}

describe("normalize", () => {
	it("trims strings, nested ones included", async () => {
		expect(await post({ email: " a@b.it ", org: { name: " Bar " } })).toEqual({
			email: "a@b.it",
			org: { name: "Bar" },
		});
	});

	// Il login passa da better-auth, dove il plugin non agisce: una password
	// trimmata solo in registrazione non coinciderebbe più al login.
	it("leaves password fields untouched", async () => {
		expect(
			await post({ password: "Mare2026 ", confirmPassword: "Mare2026 " }),
		).toEqual({ password: "Mare2026 ", confirmPassword: "Mare2026 " });
	});
});
