import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { openapi } from "@elysiajs/openapi";
import { Elysia, type TSchema, t } from "elysia";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { doc, generatePaths, honoPaths, operations } from "@/http/openapi";
import { v } from "@/http/validator";
import {
	DiscountSchema as TbDiscountSchema,
	OkMessage as TbOkMessage,
	okPageRes as tbOkPageRes,
	withConflictErrors as tbWithConflictErrors,
	withErrors as tbWithErrors,
} from "@/lib/schemas";
import { DiscountSchema } from "@/lib/zod/discount";
import {
	OkMessage,
	okPageRes,
	withConflictErrors,
	withErrors,
} from "@/lib/zod/responses";
import { zDate, zInteger } from "@/lib/zod/t";
import { adminApp } from "@/modules/admin";
import { customerApp } from "@/modules/customer";
import { locationsApp } from "@/modules/locations";
import { meApp } from "@/modules/me";
import { registrationApp } from "@/modules/registration";
import { sellerApp, sellerGuards } from "@/modules/seller";
import { type Case, cases } from "./parity-cases";

// D11 del piano Hono: il generatore nel repo produce per le route Hono lo
// stesso OpenAPI che `@elysiajs/openapi` produce per le route Elysia. Prova sul
// modulo vero (`me/` contro `baseline/openapi.json`) e, schema per schema, su
// tutti i gemelli di `parity-cases.ts` più alcune risposte.

const detail = { summary: "x", tags: ["T"] };

async function elysiaOperation(
	method: "get" | "post",
	hook: Record<string, unknown>,
) {
	const app = new Elysia().use(openapi())[method]("/x", () => "", {
		...hook,
		detail,
	});
	// Spec «a freddo»: prima di qualunque richiesta alla route (vedi baseline).
	const spec = await (
		await app.handle(new Request("http://localhost/openapi/json"))
	).json();
	return spec.paths["/x"][method];
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

describe("OpenAPI — gemelli Zod contro TypeBox", () => {
	const unique = new Map<TSchema, Case>();
	for (const c of cases) if (!unique.has(c.tb)) unique.set(c.tb, c);
	for (const c of unique.values()) {
		it(`${c.target}: ${c.name}`, async () => {
			const method = c.target === "query" ? "get" : "post";
			const slot = c.target === "query" ? "query" : "body";
			const e = await elysiaOperation(method, { [slot]: c.tb });
			const h = honoOperation(method, [doc({ detail }), v(c.target, c.zod)]);
			expect(h).toEqual(e);
		});
	}

	// Gli schemi di risposta veri (`withErrors`, `DiscountSchema`) sono
	// condivisi col resto di test:unit: un file che li compila in Elysia
	// (`mount.test.ts` dalla U5, con `sellerModule`) li renderebbe non più «a
	// freddo». Per questo test:unit gira con `--isolate`.
	const responses: [
		string,
		Record<number, TSchema>,
		Record<number, z.ZodType>,
	][] = [
		[
			"withErrors(OkMessage)",
			tbWithErrors({ 200: TbOkMessage }),
			withErrors({ 200: OkMessage }),
		],
		[
			"withConflictErrors(okPageRes(Discount))",
			tbWithConflictErrors({ 200: tbOkPageRes(TbDiscountSchema) }),
			withConflictErrors({ 200: okPageRes(DiscountSchema) }),
		],
		[
			"date e nullable in risposta",
			{
				200: t.Object({ at: t.Nullable(t.Date()), n: t.Nullable(t.String()) }),
			},
			{ 200: z.object({ at: zDate().nullable(), n: z.string().nullable() }) },
		],
		[
			// Zod scrive `type: [..]` per un'unione di tipi semplici (U5).
			"unione di tipi semplici in risposta",
			{
				200: t.Object({
					v: t.Union([t.String(), t.Number(), t.Boolean()], {
						description: "x",
					}),
					n: t.Union([t.String(), t.Null()]),
				}),
			},
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
			// additionalProperties, TypeBox patternProperties.
			"t.Record in risposta",
			{
				200: t.Record(t.String(), t.Integer({ minimum: 0 }), {
					description: "x",
				}),
			},
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
				200: t.Object({
					v: t.Union([t.String(), t.Number(), t.Boolean()], {
						description: "d",
					}),
					n: t.Union([t.String(), t.Number()]),
				}),
			},
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
		// di un oggetto JS); l'ordine di TypeBox lo tiene un'unione di letterali.
		[
			"letterali numerici nell'ordine dello schema",
			{
				200: t.Object({
					vat: t.Union([t.Literal("22"), t.Literal("10"), t.Literal("0")]),
				}),
			},
			{
				200: z.object({
					vat: z.union([z.literal("22"), z.literal("10"), z.literal("0")]),
				}),
			},
		],
	];
	for (const [name, tb, zod] of responses) {
		it(`response: ${name}`, async () => {
			const e = await elysiaOperation("get", { response: tb });
			const h = honoOperation("get", [doc({ detail, response: zod })]);
			expect(h).toEqual(e);
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

	// /seller è ancora in parte Elysia (U7): ogni path della sub-app è quello
	// della baseline, compreso `GET /seller/settings/` (`doc({ path })`, U6).
	it("/seller: ogni path della sub-app identico a baseline/openapi.json", async () => {
		const { paths: expected } = await baseline();
		const paths = honoPaths(sellerApp, "/seller", sellerGuards);
		expect(paths["/seller/settings/"]).toBeDefined();
		expect(paths["/seller/settings"]).toBeUndefined();
		for (const path of Object.keys(paths))
			expect(paths[path]).toEqual(expected[path]);
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
});
