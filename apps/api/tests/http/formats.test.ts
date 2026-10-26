import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { FORMATS, type FormatName } from "@/lib/schemas/formats";

// I formati del kit Zod contro quelli che l'app composta controllava prima di
// Hono (il FormatRegistry dopo l'import del plugin OpenAPI di allora, che
// sovrascriveva email, uuid e date): un gemello copiato dal framework nudo
// accettava «a@b.c», che l'API rifiuta. Gli esiti di prima, valore per valore,
// sono in `golden/formats.json` (catturati prima di U11).
const golden: Record<FormatName, [string, boolean][]> = await Bun.file(
	join(import.meta.dir, "golden/formats.json"),
).json();

describe("FORMATS = FormatRegistry dell'app composta", () => {
	for (const [format, expected] of Object.entries(golden))
		it(format, () => {
			const check = FORMATS[format as FormatName];
			expect(expected.map(([v]) => [v, check(v)])).toEqual(expected);
		});
});
