import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

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

// ── Imports (resolved after mocks) ────────────────────────────────────────────

import {
	loadMunicipalityIndex,
	resetMunicipalityIndex,
} from "@/lib/geocoding/municipality-index";
import { resolveMunicipality } from "@/lib/geocoding/resolve-municipality";
import { truncateAll } from "../helpers/cleanup";
import { createTestMunicipality } from "../helpers/fixtures";

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
	// L'indice è memoizzato per processo: senza reset, il caso successivo
	// leggerebbe i comuni del caso precedente.
	resetMunicipalityIndex();
});

describe("loadMunicipalityIndex", () => {
	it("indexes the municipalities with their province, ready for resolution", async () => {
		const db = getTestDb();
		await createTestMunicipality(db, {
			municipalityName: "Pioltello",
			provinceName: "Milano",
			provinceAcronym: "MI",
		});

		const index = await loadMunicipalityIndex();
		const resolved = resolveMunicipality(index, {
			rawCity: "Pioltello",
			rawCounty: "Milano",
		});

		expect(resolved.municipality?.name).toBe("Pioltello");
		expect(resolved.municipality?.provinceAcronym).toBe("MI");
	});

	it("builds the index once per process", async () => {
		const db = getTestDb();
		await createTestMunicipality(db, { municipalityName: "Pioltello" });

		const first = await loadMunicipalityIndex();
		const second = await loadMunicipalityIndex();

		expect(second).toBe(first);
	});

	it("retries after a failed load instead of caching the failure", async () => {
		const db = getTestDb();
		await createTestMunicipality(db, { municipalityName: "Pioltello" });

		const original = db.query.municipality.findMany;
		db.query.municipality.findMany = (() =>
			Promise.reject(new Error("db down"))) as typeof original;

		await expect(loadMunicipalityIndex()).rejects.toThrow("db down");

		db.query.municipality.findMany = original;

		// Se il fallimento fosse rimasto in cache, anche questa rigetterebbe.
		const index = await loadMunicipalityIndex();
		expect(index.size).toBeGreaterThan(0);
	});
});
