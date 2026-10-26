import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { app } from "@/app";
import { doc, generatePaths, honoPaths, operations } from "@/http/openapi";
import { v } from "@/http/validator";
import { DiscountSchema } from "@/lib/schemas/discount";
import {
	OkMessage,
	okPageRes,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas/responses";
import { zDate, zInteger } from "@/lib/schemas/t";
import { adminApp } from "@/modules/admin";
import { customerApp } from "@/modules/customer";
import { locationsApp } from "@/modules/locations";
import { meApp } from "@/modules/me";
import { registrationApp } from "@/modules/registration";
import { sellerApp, sellerGuards } from "@/modules/seller";
import { cases } from "./parity-cases";

// D11 del piano Hono: il generatore nel repo produce per le route Hono lo
// stesso OpenAPI che l'API dava prima. Prova sui moduli veri e sull'intero
// /openapi/json dell'app radice (contro `baseline/openapi.json`) e, schema per
// schema, sui casi di `parity-cases.ts` più alcune risposte: le operazioni
// attese stanno in `golden/openapi-twins.json`, scritte dal generatore di
// prima per lo schema di prima di ogni caso (catturate prima di U11).

const detail = { summary: "x", tags: ["T"] };

type Json = Record<string, any>;
const golden: { twins: Record<string, Json>; responses: Record<string, Json> } =
	await Bun.file(join(import.meta.dir, "golden/openapi-twins.json")).json();

/**
 * Delta 15 del registro: `elysiaMeta: "Files"`, chiave interna che lo schema
 * di prima di un array di file portava in /openapi, non esce più; il resto è
 * identico.
 */
function withoutFilesMeta(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(withoutFilesMeta);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => key !== "elysiaMeta")
			.map(([key, v]) => [key, withoutFilesMeta(v)]),
	);
}

function honoOperation(
	method: "get" | "post",
	middlewares: MiddlewareHandler[],
) {
	const app = new Hono();
	const handler: MiddlewareHandler = (c) => Promise.resolve(c.text(""));
	// Le firme di `app.on` non accettano un array di middleware sparso.
	const on = app.on as unknown as (
		this: Hono,
		method: string,
		path: string,
		...handlers: MiddlewareHandler[]
	) => Hono;
	on.call(app, method.toUpperCase(), "/x", ...middlewares, handler);
	return generatePaths(operations(app))["/x"][method];
}

describe("OpenAPI — gemelli Zod contro l'OpenAPI di prima", () => {
	for (const [key, expected] of Object.entries(golden.twins)) {
		it(key, () => {
			const c = cases.find((c) => `${c.target}: ${c.name}` === key);
			if (!c) throw new Error(`caso ${key} sparito da parity-cases.ts`);
			const method = c.target === "query" ? "get" : "post";
			const h = honoOperation(method, [doc({ detail }), v(c.target, c.zod)]);
			expect(h).toEqual(withoutFilesMeta(expected) as Json);
		});
	}

	const responses: [string, Record<number, z.ZodType>][] = [
		["withErrors(OkMessage)", withErrors({ 200: OkMessage })],
		[
			"withConflictErrors(okPageRes(Discount))",
			withConflictErrors({ 200: okPageRes(DiscountSchema) }),
		],
		[
			"date e nullable in risposta",
			{ 200: z.object({ at: zDate().nullable(), n: z.string().nullable() }) },
		],
		[
			// Zod scrive `type: [..]` per un'unione di tipi semplici (U5).
			"unione di tipi semplici in risposta",
			{
				200: z.object({
					v: z
						.union([z.string(), z.number(), z.boolean()])
						.meta({ description: "x" }),
					n: z.union([z.string(), z.null()]),
				}),
			},
		],
		[
			// U7: conteggi ordini per stato; Zod scrive propertyNames +
			// additionalProperties, prima patternProperties.
			"t.Record in risposta",
			{
				200: z
					.record(z.string(), zInteger({ minimum: 0 }))
					.meta({ description: "x" }),
			},
		],
		// U3: Zod compatta un'unione di tipi semplici in `type: [...]`
		// (`value` delle caratteristiche nella scheda prodotto).
		[
			"unione di tipi semplici",
			{
				200: z.object({
					v: z
						.union([z.string(), z.number(), z.boolean()])
						.meta({ description: "d" }),
					n: z.union([z.string(), z.number()]),
				}),
			},
		],
		// U3: `z.enum(["22", "10"])` esce in ordine crescente (chiavi numeriche
		// di un oggetto JS); l'ordine dello schema lo tiene un'unione di letterali.
		[
			"letterali numerici nell'ordine dello schema",
			{
				200: z.object({
					vat: z.union([z.literal("22"), z.literal("10"), z.literal("0")]),
				}),
			},
		],
	];
	for (const [name, zod] of responses) {
		it(`response: ${name}`, () => {
			const h = honoOperation("get", [doc({ detail, response: zod })]);
			expect(h).toEqual(golden.responses[name]);
		});
	}
});

describe("OpenAPI — moduli migrati contro la baseline", () => {
	const baseline = () =>
		Bun.file(
			join(
				import.meta.dir,
				"../../../../docs/superpowers/plans/2026-10-25-hono-migration/baseline/openapi.json",
			),
		).json();

	it("POST e DELETE /me/avatar identici a baseline/openapi.json", async () => {
		const { paths: expected } = await baseline();
		const paths = honoPaths(meApp, "/me", ["auth"]);
		expect(Object.keys(paths)).toEqual(["/me/avatar"]);
		expect(paths["/me/avatar"]).toEqual(expected["/me/avatar"]);
	});

	// Ogni path della sub-app è quello della baseline, compreso
	// `GET /seller/settings/` (`doc({ path })`, U6).
	it("/seller: ogni path della sub-app identico a baseline/openapi.json", async () => {
		const { paths: expected } = await baseline();
		const paths = honoPaths(sellerApp, "/seller", sellerGuards);
		expect(paths["/seller/settings/"]).toBeDefined();
		expect(paths["/seller/settings"]).toBeUndefined();
		for (const path of Object.keys(paths))
			expect(paths[path]).toEqual(withoutFilesMeta(expected[path]) as Json);
	});

	it("le 25 operazioni di /customer identiche a baseline/openapi.json", async () => {
		const { paths: baselinePaths } = await baseline();
		const paths = honoPaths(customerApp, "/customer", [
			"customer",
			"publicRoute",
		]);
		const expected = Object.keys(baselinePaths).filter((p) =>
			p.startsWith("/customer/"),
		);
		expect(Object.keys(paths).sort()).toEqual(expected.sort());
		expect(
			Object.values(paths).reduce((n, ops) => n + Object.keys(ops).length, 0),
		).toBe(25);
		for (const path of expected)
			expect(paths[path]).toEqual(baselinePaths[path]);
	});

	// /admin dalla U9 è tutto Hono, compreso `GET /admin/requests/`
	// (`doc({ path })`): ogni path della baseline sotto /admin.
	const modules = [
		["/locations", locationsApp, ["auth", "publicRoute"]],
		["/register", registrationApp, ["publicRoute"]],
		["/admin", adminApp, ["admin"]],
	] as const;
	for (const [prefix, app, guards] of modules) {
		it(`${prefix}: ogni path identico a baseline/openapi.json`, async () => {
			const { paths: expected } = await baseline();
			const paths = honoPaths(app, prefix, guards);
			expect(Object.keys(paths).sort()).toEqual(
				Object.keys(expected)
					.filter((p) => p.startsWith(`${prefix}/`))
					.sort(),
			);
			for (const path of Object.keys(paths))
				expect(paths[path]).toEqual(expected[path]);
		});
	}

	// U11: l'intero documento dell'app radice (better-auth, /health e /ready
	// compresi), come lo confronta `tools/openapi-snapshot.ts`.
	it("/openapi/json dell'app radice = baseline/openapi.json, salvo il delta 15", async () => {
		const res = await app.request("/openapi/json");
		expect(res.status).toBe(200);
		const sortKeys = (v: unknown): unknown =>
			Array.isArray(v)
				? v.map(sortKeys)
				: v && typeof v === "object"
					? Object.fromEntries(
							Object.keys(v)
								.sort()
								.map((k) => [k, sortKeys((v as Json)[k])]),
						)
					: v;
		expect(sortKeys(await res.json())).toEqual(
			withoutFilesMeta(await baseline()) as Json,
		);
	});
});
