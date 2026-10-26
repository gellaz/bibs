// Eseguito il 2026-10-26 su 531d8d3f (feat/hono-migration, ultimo commit con
// Elysia) da apps/api/tests/http/golden/: i .test.ts con `bun test <file>`,
// capture-app.ts con `bun --env-file=<env> run` (vedi sotto). Scrive i file
// di apps/api/tests/http/golden/. Non gira più dopo U11 (importa elysia).
// Cattura una tantum (U11, prima di togliere Elysia): le risposte di Elysia
// 1.4.30 che i test della migrazione confrontavano dal vivo. Gli attesi
// restano quelli di Elysia; dopo U11 i test confrontano Hono con questi file.
import { it } from "bun:test";
import { join } from "node:path";
import { FormatRegistry } from "@sinclair/typebox";
import { Elysia, t } from "elysia";
// Come `src/index.ts`: al load sovrascrive email, uuid e date nel registry.
import "@elysiajs/openapi";
import { moduleApp } from "@/http/app";
import { errorHandler } from "@/plugins/error-handler";
import { cases, elysiaApp, noopPino, request } from "../parity-cases";

const write = (name: string, data: unknown) =>
	Bun.write(join(import.meta.dir, name), JSON.stringify(data, null, "\t"));

it("cattura validator.json", async () => {
	const out: Record<string, { status: number; body: string }> = {};
	for (const c of cases) {
		const e = await elysiaApp(c).handle(request(c.target, c.req));
		out[c.name] = { status: e.status, body: await e.text() };
	}
	await write("validator.json", out);
});

it("cattura formats.json", async () => {
	const samples: Record<string, string[]> = {
		email: [
			"a@b.it",
			"Mario.Rossi+promo@Test.IT",
			"o'neil@test.it",
			"a@b.c",
			"mario#rossi@test.it",
			"info@negozio.123",
			"x{y}@test.it",
			"a..b@test.it",
			".a@test.it",
			"a.@test.it",
			"a@-b.it",
			"nope",
		],
		uuid: [
			"3f1c2a4e-8b5d-4c6e-9f7a-1b2c3d4e5f60",
			"3F1C2A4E-8B5D-4C6E-9F7A-1B2C3D4E5F60",
			"00000000-0000-0000-0000-000000000000",
			"ffffffff-ffff-ffff-ffff-ffffffffffff",
			"FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
			"11111111-1111-1111-1111-111111111111",
			"3f1c2a4e-8b5d-0c6e-9f7a-1b2c3d4e5f60",
			"urn:uuid:3f1c2a4e-8b5d-4c6e-9f7a-1b2c3d4e5f60",
			"no",
		],
		uri: ["https://x.it", "mailto:a@b.it", "x.it", `https://x.it/${"😀"}`, ""],
		date: [
			"2026-01-01",
			"2024-02-29",
			"2026-02-29",
			"2026-13-01",
			"01/02/2026",
			"2026-01-01T00:00:00Z",
			"2026-01-01T12:00:00 01:00",
			'"2026-01-01"',
		],
		"date-time": [
			"2026-01-01T12:00:00Z",
			"2026-01-01T12:00:00+01:00",
			"2026-01-01T12:00:00 01:00",
			"2026-01-01",
			"01/02/2026",
			"2026-02-30",
			"Thu Jan 01 2026 00:00:00 GMT+0100 (Ora standard dell’Europa centrale)",
			"nope",
		],
	};
	await import("@/lib/schemas/forms/formats");
	samples["calendar-date"] = ["2024-02-29", "2026-02-29", "2026-1-01"];
	const out: Record<string, [string, boolean][]> = {};
	for (const [format, values] of Object.entries(samples)) {
		const registry = FormatRegistry.Get(format);
		if (!registry) throw new Error(`${format} non registrato`);
		out[format] = values.map((v) => [v, registry(v)]);
	}
	await write("formats.json", out);
});

it("cattura send.json", async () => {
	const tbs: [string, unknown, unknown][] = [
		["t.Integer dato come stringa", t.Object({ n: t.Integer() }), { n: "5" }],
		[
			"t.Integer oltre il massimo come stringa",
			t.Object({ n: t.Integer({ maximum: 3 }) }),
			{ n: "5" },
		],
		[
			"t.Integer oltre il massimo",
			t.Object({ n: t.Integer({ maximum: 3 }) }),
			{ n: 5 },
		],
		[
			"t.Date dato come numero",
			t.Object({ d: t.Date() }),
			{ d: 1761386400000 },
		],
		[
			"t.Date dato come stringa",
			t.Object({ d: t.Date() }),
			{ d: "2026-10-25" },
		],
	];
	const out: Record<string, { status: number; body: string }> = {};
	for (const [name, tb, data] of tbs) {
		const e = await new Elysia()
			.state("pino", noopPino)
			.use(errorHandler)
			.get("/", () => data as never, { response: { 200: tb as never } })
			.handle(new Request("http://localhost/"));
		out[name] = { status: e.status, body: await e.text() };
	}
	await write("send.json", out);
});

it("cattura raw-path.json", async () => {
	const elysia = new Elysia()
		.use(errorHandler)
		.state("pino", noopPino)
		.get("/p/:id", ({ params }) => ({ id: params.id }))
		.delete("/avatar", () => ({ ok: true }));
	const paths: Record<string, { status: number; body: unknown }> = {};
	for (const [method, path] of [
		["DELETE", "/%61vatar"],
		["DELETE", "/av%61tar"],
		["DELETE", "/avatar/"],
		["GET", "/p/caf%C3%A9"],
		["GET", "/p/a%2Fb"],
		["GET", "/p/a%20b?x=1"],
		["GET", "/%70/x"],
		["DELETE", "/avatar#x"],
		["GET", "/p/a#b"],
	]) {
		const e = await elysia.handle(
			new Request(`http://localhost${path}`, { method }),
		);
		paths[`${method} ${path}`] = { status: e.status, body: await e.json() };
	}
	const root = new Elysia()
		.use(errorHandler)
		.state("pino", noopPino)
		.get("/elysia", () => ({ ok: true }))
		.mount("/hono", moduleApp().get("/", (c) => c.json({ ok: true })).fetch);
	const suffixes: Record<string, number> = {};
	for (const suffix of ["", "/", "//"])
		suffixes[suffix] = (
			await root.handle(new Request(`http://localhost/elysia${suffix}`))
		).status;
	await write("raw-path.json", { paths, rootSuffixes: suffixes });
});
