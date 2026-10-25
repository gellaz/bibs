import { describe, expect, it } from "bun:test";
import { Elysia, t } from "elysia";
import { z } from "zod";
import { moduleApp } from "@/http/app";
import { send } from "@/http/send";
import { okRes } from "@/lib/zod/responses";
import { zDate, zInteger } from "@/lib/zod/t";
import { errorHandler } from "@/plugins/error-handler";
import { noopPino } from "./parity-cases";

// `send()` fa quello che la `response` di Elysia fa oggi (D4 del piano Hono):
// toglie i campi fuori schema a ogni profondità, i Date escono ISO, un dato
// fuori schema è un 500.

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

// La `response` di Elysia controlla e codifica, senza decodificare: t.Integer
// lascia la stringa intera com'è, t.Date rifiuta un numero.
describe("send() — codifica come la response di Elysia", () => {
	const cases: [string, unknown, z.ZodType, unknown][] = [
		[
			"t.Integer dato come stringa",
			t.Object({ n: t.Integer() }),
			z.object({ n: zInteger() }),
			{ n: "5" },
		],
		[
			"t.Integer oltre il massimo come stringa",
			t.Object({ n: t.Integer({ maximum: 3 }) }),
			z.object({ n: zInteger({ maximum: 3 }) }),
			{ n: "5" },
		],
		[
			"t.Integer oltre il massimo",
			t.Object({ n: t.Integer({ maximum: 3 }) }),
			z.object({ n: zInteger({ maximum: 3 }) }),
			{ n: 5 },
		],
		[
			"t.Date dato come numero",
			t.Object({ d: t.Date() }),
			z.object({ d: zDate() }),
			{ d: 1761386400000 },
		],
		[
			"t.Date dato come stringa",
			t.Object({ d: t.Date() }),
			z.object({ d: zDate() }),
			{ d: "2026-10-25" },
		],
	];
	for (const [name, tb, zod, data] of cases)
		it(name, async () => {
			const e = await new Elysia()
				.state("pino", noopPino)
				.use(errorHandler)
				.get("/", () => data as never, { response: { 200: tb as never } })
				.handle(new Request("http://localhost/"));
			const h = await moduleApp()
				.get("/", (c) => send(c, zod, data as never))
				.request("/");
			expect({ status: h.status, body: await h.text() }).toEqual({
				status: e.status,
				body: await e.text(),
			});
		});
});
