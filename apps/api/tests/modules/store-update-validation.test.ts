import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { storesRoutes } from "@/modules/seller/routes/stores";
import { errorHandler } from "@/plugins/error-handler";

// storesRoutes carries no auth itself (the guard is applied when mounted in
// sellerModule), so we can mount it bare and exercise request-body validation,
// which runs before the handler. A well-formed body passes validation and
// reaches the handler, which throws 403 via requireOwner (no resolved owner in
// this bare context) — i.e. anything that is NOT 422 means validation passed.
const noopPino = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	trace: () => {},
} as any;

const app = new Elysia()
	.state("pino", noopPino)
	.use(errorHandler)
	.use(storesRoutes);

function patchStore(body: unknown) {
	return app.handle(
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
