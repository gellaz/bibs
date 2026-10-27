import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { z } from "zod";
import { moduleApp } from "@/http/app";
import { send } from "@/http/send";
import { okRes } from "@/schemas/responses";
import { zDate, zInteger } from "@/schemas/t";

// `send()` fa quello che la `response` delle route faceva prima di Hono (D4
// del piano Hono): toglie i campi fuori schema a ogni profondità, i Date
// escono ISO, un dato fuori schema è un 500.

const Row = okRes(
	z.object({
		id: z.string(),
		createdAt: zDate(),
		nested: z.object({ b: z.string() }),
		list: z.array(z.object({ c: z.number() })),
	}),
);

const app = moduleApp()
	.get("/ok", (c) =>
		send(c, Row, {
			success: true,
			data: {
				id: "1",
				createdAt: new Date("2026-01-02T03:04:05.000Z"),
				nested: { b: "x", internal: "secret" },
				list: [{ c: 1, internal: true }],
				passwordHash: "leak",
				documentImageKey: "users/1/doc.jpg",
			},
		} as unknown as z.input<typeof Row>),
	)
	.get("/bad", (c) =>
		send(c, Row, {
			success: true,
			data: { id: 1 },
		} as unknown as z.input<typeof Row>),
	);

describe("send()", () => {
	it("toglie i campi in più a ogni profondità e scrive i Date in ISO", async () => {
		const res = await app.request("/ok");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe(
			"application/json;charset=utf-8",
		);
		expect(await res.text()).toBe(
			JSON.stringify({
				success: true,
				data: {
					id: "1",
					createdAt: "2026-01-02T03:04:05.000Z",
					nested: { b: "x" },
					list: [{ c: 1 }],
				},
			}),
		);
	});

	it("un dato fuori schema è un 500, non un 422", async () => {
		const res = await app.request("/bad");
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({
			success: false,
			error: "INTERNAL_ERROR",
			message: "Errore interno del server",
		});
	});
});

// La `response` di prima controllava e codificava, senza decodificare:
// t.Integer lascia la stringa intera com'è, t.Date rifiuta un numero. Gli esiti
// di prima sono in `golden/send.json` (catturati prima di U11).
const golden: Record<string, { status: number; body: string }> = await Bun.file(
	join(import.meta.dir, "golden/send.json"),
).json();

describe("send() — codifica come la response di prima", () => {
	const cases: [string, z.ZodType, unknown][] = [
		["t.Integer dato come stringa", z.object({ n: zInteger() }), { n: "5" }],
		[
			"t.Integer oltre il massimo come stringa",
			z.object({ n: zInteger({ maximum: 3 }) }),
			{ n: "5" },
		],
		[
			"t.Integer oltre il massimo",
			z.object({ n: zInteger({ maximum: 3 }) }),
			{ n: 5 },
		],
		["t.Date dato come numero", z.object({ d: zDate() }), { d: 1761386400000 }],
		["t.Date dato come stringa", z.object({ d: zDate() }), { d: "2026-10-25" }],
	];
	for (const [name, zod, data] of cases)
		it(name, async () => {
			const h = await moduleApp()
				.get("/", (c) => send(c, zod, data as never))
				.request("/");
			expect({ status: h.status, body: await h.text() }).toEqual(golden[name]);
		});
});
