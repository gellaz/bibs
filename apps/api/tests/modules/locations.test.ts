import { describe, expect, it, mock } from "bun:test";

// ── Override DATABASE_URL before @/db is imported ────────────────────────────
// The preload sets a fake URL; this test calls the real service against the
// dev DB, so we need the actual connection string.
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schemas";

const devDb = drizzle("postgresql://pgadmin:P4ssword!@localhost:5432/bibs-db", {
	schema,
});

mock.module("@/db", () => ({ db: devDb }));

// ── Import service (resolved after mock) ────────────────────────────────────
import { listAllMunicipalities } from "@/modules/locations/services/locations";

describe("listAllMunicipalities", () => {
	it("returns the full list of municipalities", async () => {
		const data = await listAllMunicipalities();
		expect(data.length).toBeGreaterThan(7000);
		expect(data.length).toBeLessThan(8500);
	});

	it("returns the compact shape { id, name, provinceAcronym }", async () => {
		const data = await listAllMunicipalities();
		const first = data[0];
		expect(first).toBeDefined();
		expect(Object.keys(first!).sort()).toEqual([
			"id",
			"name",
			"provinceAcronym",
		]);
		expect(first!.provinceAcronym).toHaveLength(2);
	});

	it("returns items sorted by name ASC", async () => {
		const data = await listAllMunicipalities();
		// Use ignorePunctuation to match PostgreSQL en_US.utf8 collation which
		// treats apostrophes as word-separators (e.g. "Aci Sant'Antonio" sorts
		// after "Acireale" in the DB but before it in strict locale order).
		const collator = new Intl.Collator("it", { ignorePunctuation: true });
		for (let i = 1; i < Math.min(data.length, 50); i++) {
			const prev = collator.compare(data[i - 1]!.name, data[i]!.name);
			expect(prev).toBeLessThanOrEqual(0);
		}
	});

	it("provinceAcronym is uppercase", async () => {
		const data = await listAllMunicipalities();
		const sample = data.slice(0, 20);
		for (const m of sample) {
			expect(m.provinceAcronym).toBe(m.provinceAcronym.toUpperCase());
		}
	});
});
