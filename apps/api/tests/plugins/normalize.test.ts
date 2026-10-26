import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { moduleApp } from "@/http/app";
import { v } from "@/http/validator";

// Il trim dei body (`lib/deep-trim.ts`): fino a U11 lo faceva il plugin
// `normalize` dell'app di prima, oggi lo fa `v()` prima della validazione.
const app = moduleApp().post(
	"/",
	v(
		"json",
		z.object({
			email: z.string().optional(),
			org: z.object({ name: z.string() }).optional(),
			password: z.string().optional(),
			confirmPassword: z.string().optional(),
		}),
	),
	(c) => c.json(c.req.valid("json")),
);

async function post(body: unknown) {
	const res = await app.request(
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

	// Il login passa da better-auth, dove il trim non agisce: una password
	// trimmata solo in registrazione non coinciderebbe più al login.
	it("leaves password fields untouched", async () => {
		expect(
			await post({ password: "Mare2026 ", confirmPassword: "Mare2026 " }),
		).toEqual({ password: "Mare2026 ", confirmPassword: "Mare2026 " });
	});
});
