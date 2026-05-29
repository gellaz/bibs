import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";

// ── Module mocks (hoisted by Bun before all imports) ──────────────────────────
import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { seedLocations } from "@/db/seed/base/locations";
import { listAllMunicipalities } from "@/modules/locations/services/locations";

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
	await setupTestContainer();
	// Seed the full Italian municipality dataset (~7 700 rows) into the container.
	// This is safe because the seed function is idempotent (skips if data exists).
	await seedLocations();
}, 180_000);

afterAll(async () => {
	await teardownTestContainer();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

// Requires a seeded dev DB: the beforeAll above runs seedLocations() against
// the testcontainer, so no external setup is needed. The suite is read-only
// and does not truncate between tests.
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
