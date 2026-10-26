import { describe, expect, it } from "bun:test";
import { storesRoutes } from "@/modules/seller/routes/stores";
import { withVars } from "../helpers/hono-app";

// storesRoutes is mounted with the seller context already resolved
// (withVars skips the seller guard), so we exercise request-body validation,
// which runs before the handler. A well-formed body passes validation and
// reaches the handler, which throws 403 via requireOwner (the resolved caller
// is not the owner) — i.e. anything that is NOT 422 means validation passed.
const app = withVars(storesRoutes, {
	user: { id: "u" },
	seller: { isOwner: false },
});

function patchStore(body: unknown) {
	return app.request(
		new Request("http://localhost/stores/some-id", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

describe("PATCH /stores — openingHours validation", () => {
	it("rejects malformed time strings (422)", async () => {
		const res = await patchStore({
			openingHours: [
				{ dayOfWeek: 0, slots: [{ open: "99:99", close: "nope" }] },
			],
		});
		expect(res.status).toBe(422);
	});

	it("rejects an empty slots array (422)", async () => {
		const res = await patchStore({
			openingHours: [{ dayOfWeek: 0, slots: [] }],
		});
		expect(res.status).toBe(422);
	});

	it("rejects an out-of-range dayOfWeek (422)", async () => {
		const res = await patchStore({
			openingHours: [
				{ dayOfWeek: 9, slots: [{ open: "09:00", close: "18:00" }] },
			],
		});
		expect(res.status).toBe(422);
	});

	it("accepts well-formed opening hours (validation passes → not 422)", async () => {
		const res = await patchStore({
			openingHours: [
				{ dayOfWeek: 0, slots: [{ open: "09:00", close: "13:00" }] },
				{ dayOfWeek: 1, slots: [{ open: "15:00", close: "19:30" }] },
			],
		});
		expect(res.status).not.toBe(422);
	});

	it("accepts openingHours: null on PATCH (clear hours)", async () => {
		const res = await patchStore({ openingHours: null });
		expect(res.status).not.toBe(422);
	});
});

describe("PATCH /stores — websiteUrl maxLength in unità UTF-16", () => {
	it("501 unità (257 code point): 422 sulla lunghezza, non sul formato", async () => {
		const res = await patchStore({
			websiteUrl: `https://x.it/${"😀".repeat(244)}`,
		});
		expect(res.status).toBe(422);
		expect((await res.json()).message).toBe(
			"Sito web: al massimo 500 caratteri",
		);
	});
});
