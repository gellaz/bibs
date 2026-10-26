import { describe, expect, it } from "bun:test";
import { join, posix } from "node:path";

// Le regole sugli import tra le cartelle di src/ (AGENTS.md, «Struttura di src/»):
// A. un modulo non importa da un altro modulo;
// B. fuori da modules/ nessuno importa da modules/, tranne la composizione
//    (app.ts, types.ts) e gli strumenti (db/seed/, scripts/);
// C. lib/ importa solo da lib/ e db/.

const SRC = join(import.meta.dir, "../../src");
const SPECIFIER = /(?:from\s+|import\s*\(\s*)"([^"]+)"/g;
const B_EXEMPT = (file: string) =>
	file === "app.ts" ||
	file === "types.ts" ||
	file.startsWith("db/seed/") ||
	file.startsWith("scripts/");

const moduleOf = (path: string) =>
	path.startsWith("modules/") ? path.split("/")[1] : undefined;

/** Il percorso relativo a src/ di un import, o undefined per un pacchetto npm. */
function target(file: string, specifier: string): string | undefined {
	if (specifier.startsWith("@/")) return specifier.slice(2);
	if (!specifier.startsWith(".")) return undefined;
	const resolved = posix.normalize(posix.join(posix.dirname(file), specifier));
	return resolved.startsWith("..") ? undefined : resolved;
}

/** Una riga «file → import: regola X» per ogni import che viola A, B o C. */
function violations(files: Map<string, string>): string[] {
	const found: string[] = [];
	for (const [file, source] of files) {
		for (const [, specifier] of source.matchAll(SPECIFIER)) {
			const to = target(file, specifier as string);
			if (to === undefined) continue;
			const fromModule = moduleOf(file);
			const toModule = moduleOf(to);
			const rule =
				fromModule && toModule && fromModule !== toModule
					? "A"
					: !fromModule && toModule && !B_EXEMPT(file)
						? "B"
						: file.startsWith("lib/") &&
								!(to.startsWith("lib/") || to === "db" || to.startsWith("db/"))
							? "C"
							: undefined;
			if (rule) found.push(`${file} → ${to}: regola ${rule}`);
		}
	}
	return found;
}

async function readSrc(): Promise<Map<string, string>> {
	const paths: string[] = [];
	for await (const path of new Bun.Glob("**/*.ts").scan({ cwd: SRC })) {
		if (!path.startsWith("db/migrations/")) paths.push(path);
	}
	paths.sort();
	const files = new Map<string, string>();
	for (const path of paths)
		files.set(path, await Bun.file(join(SRC, path)).text());
	return files;
}

describe("violations (il checker)", () => {
	it("trova una violazione per regola", () => {
		const files = new Map([
			[
				"modules/customer/services/a.ts",
				'import { x } from "@/modules/seller/services/b";',
			],
			["jobs/j.ts", 'const m = await import("@/modules/billing/services/c");'],
			["lib/l.ts", 'export { y } from "@/infra/env";'],
			[
				"modules/seller/routes/r.ts",
				'import { z } from "../../customer/services/d";',
			],
			["modules/seller/routes/ok.ts", 'import { w } from "../services/e";'],
			["app.ts", 'import { sellerApp } from "@/modules/seller";'],
		]);
		expect(violations(files)).toEqual([
			"modules/customer/services/a.ts → modules/seller/services/b: regola A",
			"jobs/j.ts → modules/billing/services/c: regola B",
			"lib/l.ts → infra/env: regola C",
			"modules/seller/routes/r.ts → modules/customer/services/d: regola A",
		]);
	});
});

describe("struttura di src/", () => {
	it("rispetta le regole A–C", async () => {
		expect(violations(await readSrc())).toEqual([]);
	});
});
