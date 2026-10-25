import { describe, expect, it } from "bun:test";
import { cases, elysiaApp, fail, honoApp, request } from "./parity-cases";

// Il validatore Hono contro Elysia sui casi di `parity-cases.ts`: stesso
// status e stesso corpo, al byte per gli errori.

describe("v() — stesso esito di Elysia", () => {
	for (const c of cases) {
		it(c.name, async () => {
			const e = await elysiaApp(c).handle(request(c.target, c.req));
			const h = await honoApp(c).request(request(c.target, c.req));
			const eText = await e.text();
			const hText = await h.text();
			const expected = typeof c.body === "string" ? fail(c.body) : c.body;
			expect({ status: h.status, body: JSON.parse(hText) }).toEqual({
				status: c.status,
				body: expected,
			});
			expect({ status: e.status, body: JSON.parse(eText) }).toEqual({
				status: c.status,
				body: expected,
			});
			if (c.status !== 200) expect(hText).toBe(eText);
		});
	}
});
