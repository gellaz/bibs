import { describe, expect, it } from "bun:test";
import { FormatRegistry } from "@sinclair/typebox";
import "elysia";
// Come `src/index.ts`: al load sovrascrive email, uuid e date nel registry.
import "@elysiajs/openapi";
import { FORMATS, type FormatName } from "@/lib/zod/formats";

// I formati del kit Zod contro quelli che l'app composta controlla davvero:
// un gemello copiato da Elysia nudo accettava «a@b.c», che l'API rifiuta.
const samples: Record<FormatName, string[]> = {
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
	"calendar-date": ["2024-02-29", "2026-02-29", "2026-1-01"],
};

describe("FORMATS = FormatRegistry dell'app composta", () => {
	for (const [format, values] of Object.entries(samples))
		it(format, () => {
			const registry = FormatRegistry.Get(format);
			if (!registry) throw new Error(`${format} non registrato`);
			const check = FORMATS[format as FormatName];
			expect(values.map((v) => [v, check(v)])).toEqual(
				values.map((v) => [v, registry(v)]),
			);
		});
});
