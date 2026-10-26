// Eseguito il 2026-10-26 su 531d8d3f (feat/hono-migration, ultimo commit con
// Elysia) da apps/api/tests/http/golden/: i .test.ts con `bun test <file>`,
// capture-app.ts con `bun --env-file=<env> run` (vedi sotto). Scrive i file
// di apps/api/tests/http/golden/. Non gira più dopo U11 (importa elysia).
// Cattura una tantum (U11, prima di togliere Elysia): l'OpenAPI che
// `@elysiajs/openapi` 1.4.16 scrive per gli schemi TypeBox di `parity-cases.ts`
// e per le risposte di `openapi.test.ts`. Gira da sola, prima di qualunque
// richiesta alle route (spec «a freddo»).
import { it } from "bun:test";
import { join } from "node:path";
import { openapi } from "@elysiajs/openapi";
import { Elysia, type TSchema, t } from "elysia";
import {
	DiscountSchema as TbDiscountSchema,
	OkMessage as TbOkMessage,
	okPageRes as tbOkPageRes,
	withConflictErrors as tbWithConflictErrors,
	withErrors as tbWithErrors,
} from "@/lib/schemas";
import { type Case, cases } from "../parity-cases";

const detail = { summary: "x", tags: ["T"] };

async function elysiaOperation(
	method: "get" | "post",
	hook: Record<string, unknown>,
) {
	const app = new Elysia().use(openapi())[method]("/x", () => "", {
		...hook,
		detail,
	});
	const spec = await (
		await app.handle(new Request("http://localhost/openapi/json"))
	).json();
	return spec.paths["/x"][method];
}

it("cattura openapi-twins.json", async () => {
	const twins: Record<string, unknown> = {};
	const unique = new Map<TSchema, Case>();
	for (const c of cases) if (!unique.has(c.tb)) unique.set(c.tb, c);
	for (const c of unique.values()) {
		const method = c.target === "query" ? "get" : "post";
		const slot = c.target === "query" ? "query" : "body";
		twins[`${c.target}: ${c.name}`] = await elysiaOperation(method, {
			[slot]: c.tb,
		});
	}
	const responses: [string, Record<number, TSchema>][] = [
		["withErrors(OkMessage)", tbWithErrors({ 200: TbOkMessage })],
		[
			"withConflictErrors(okPageRes(Discount))",
			tbWithConflictErrors({ 200: tbOkPageRes(TbDiscountSchema) }),
		],
		[
			"date e nullable in risposta",
			{
				200: t.Object({ at: t.Nullable(t.Date()), n: t.Nullable(t.String()) }),
			},
		],
		[
			"unione di tipi semplici in risposta",
			{
				200: t.Object({
					v: t.Union([t.String(), t.Number(), t.Boolean()], {
						description: "x",
					}),
					n: t.Union([t.String(), t.Null()]),
				}),
			},
		],
		[
			"t.Record in risposta",
			{
				200: t.Record(t.String(), t.Integer({ minimum: 0 }), {
					description: "x",
				}),
			},
		],
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
		],
		[
			"letterali numerici nell'ordine dello schema",
			{
				200: t.Object({
					vat: t.Union([t.Literal("22"), t.Literal("10"), t.Literal("0")]),
				}),
			},
		],
	];
	const res: Record<string, unknown> = {};
	for (const [name, tb] of responses)
		res[name] = await elysiaOperation("get", { response: tb });
	await Bun.write(
		join(import.meta.dir, "openapi-twins.json"),
		JSON.stringify({ twins, responses: res }, null, "\t"),
	);
});
