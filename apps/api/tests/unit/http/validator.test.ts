import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { cases, fail, honoApp, request } from "./parity-cases";

// Il validatore Hono sui casi di `parity-cases.ts`: stesso status e stesso
// corpo dell'API di prima, al byte per gli errori. Le risposte di prima sono
// in `golden/validator.json`, catturate dal framework di prima (1.4.30) prima
// di toglierlo (U11): fino ad allora il test glielo chiedeva dal vivo.

// Letto a runtime, non importato: tsc non deve tipizzare il JSON.
const before: Record<string, { status: number; body: string }> = await Bun.file(
	join(import.meta.dir, "golden/validator.json"),
).json();

describe("v() — stesso esito dell'API di prima", () => {
	for (const c of cases) {
		it(c.name, async () => {
			const e = before[c.name];
			const h = await honoApp(c).request(request(c.target, c.req));
			const hText = await h.text();
			const expected = typeof c.body === "string" ? fail(c.body) : c.body;
			expect({ status: h.status, body: JSON.parse(hText) }).toEqual({
				status: c.status,
				body: expected,
			});
			expect({ status: e.status, body: JSON.parse(e.body) }).toEqual({
				status: c.status,
				body: expected,
			});
			if (c.status !== 200) expect(hText).toBe(e.body);
		});
	}
});
