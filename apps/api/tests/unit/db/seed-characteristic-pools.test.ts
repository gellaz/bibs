import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allowedValues } from "@/db/seed/fixtures/characteristic-values";

const DATA = join(import.meta.dir, "../../../src/db/seed/data");
// I CSV non usano virgolette: split semplice.
const rows = (file: string) =>
	readFileSync(join(DATA, file), "utf8").trim().split("\n").slice(1);

const enumOptions = new Map<string, Set<string>>();
for (const line of rows("product_characteristics.csv")) {
	const [name, type, , options = ""] = line.split(",");
	if (type === "enum") enumOptions.set(name, new Set(options.split("|")));
}

describe("pool di valori del seed vs dizionario", () => {
	it("ogni opzione enum che il seed può scrivere esiste nel dizionario", () => {
		const missing: string[] = [];
		for (const line of rows("product_category_characteristics.csv")) {
			const [macro, sub, name] = line.split(",");
			const options = enumOptions.get(name);
			if (!options) continue;
			for (const v of allowedValues(name, macro, sub) ?? [])
				if (!options.has(v)) missing.push(`${sub} / ${name}: ${v}`);
		}
		expect(missing).toEqual([]);
	});
});
