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
import {
	OkMessage,
	okPageRes,
	withConflictErrors,
	withErrors,
} from "@/lib/zod/responses";
import { zDate, zInteger } from "@/lib/zod/t";
import { meApp } from "@/modules/me";
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

	const DiscountSchema = z.object({
		id: z.string(),
		sellerProfileId: z.string(),
		title: z.string().meta({ description: "Titolo della promozione" }),
		percent: zInteger({
			minimum: 1,
			maximum: 99,
			description: "Percentuale di sconto (1-99)",
		}),
		startsAt: zDate({ description: "Data di inizio" }),
		endsAt: zDate({
			description: "Data di fine (null = senza scadenza)",
		}).nullable(),
		status: z
			.enum(["active", "paused", "archived"])
			.meta({ description: "Stato persistito della promozione" }),
		createdAt: zDate(),
		updatedAt: zDate(),
	});

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
	];
	for (const [name, tb, zod] of responses) {
		it(`response: ${name}`, async () => {
			const e = await elysiaOperation("get", { response: tb });
			const h = honoOperation("get", [doc({ detail, response: zod })]);
			expect(h).toEqual(e);
		});
	}
});

describe("OpenAPI — modulo me/ contro la baseline", () => {
	it("POST e DELETE /me/avatar identici a baseline/openapi.json", async () => {
		const baseline = await Bun.file(
			join(
				import.meta.dir,
				"../../../../docs/superpowers/plans/2026-10-25-hono-migration/baseline/openapi.json",
			),
		).json();
		const paths = honoPaths(meApp, "/me");
		expect(Object.keys(paths)).toEqual(["/me/avatar"]);
		expect(paths["/me/avatar"]).toEqual(baseline.paths["/me/avatar"]);
	});
});
