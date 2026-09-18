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

import type {
	GeocodeHit,
	GeocodeSearchOptions,
} from "@/lib/geocoding/provider";

/** Provider finto: registra ogni chiamata e restituisce hit a comando. */
const calls: { q: string; opts: GeocodeSearchOptions }[] = [];
let nextHits: GeocodeHit[] = [];
/** Risposte in coda, una per chiamata: serve ai casi con due chiamate al provider. */
let queue: GeocodeHit[][] = [];
let failNext = false;

mock.module("@/lib/geocoding", () => ({
	getGeocodingProvider: () => ({
		name: "photon",
		async search(q: string, opts: GeocodeSearchOptions) {
			calls.push({ q, opts });
			if (failNext) throw new Error("provider down");
			return queue.length > 0 ? (queue.shift() as GeocodeHit[]) : nextHits;
		},
	}),
}));

// ── Imports (resolved after mocks) ────────────────────────────────────────────

import { LOOKUP_TTL_MS, writeLookup } from "@/lib/geocoding/cache";
import { resetMunicipalityIndex } from "@/lib/geocoding/municipality-index";
import { geocodeAddress } from "@/modules/locations/services/geocode";
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
	resetMunicipalityIndex();
	calls.length = 0;
	nextHits = [];
	queue = [];
	failNext = false;
});

function hit(overrides: Partial<GeocodeHit> = {}): GeocodeHit {
	return {
		addressLine1: "Via Roma 12",
		zipCode: "20096",
		location: { x: 9.3278473, y: 45.4998571 },
		rawCity: "Pioltello",
		rawCounty: "Milano",
		providerRef: "photon:N1",
		...overrides,
	};
}

const MILAN = { lat: 45.4642, lng: 9.19 };

describe("geocodeAddress", () => {
	it("returns suggestions with the municipality resolved and a readable label", async () => {
		const db = getTestDb();
		await createTestMunicipality(db, {
			municipalityName: "Pioltello",
			provinceName: "Milano",
			provinceAcronym: "MI",
		});
		nextHits = [hit()];

		const [suggestion] = await geocodeAddress({ q: "Via Roma 12", ...MILAN });

		expect(suggestion.label).toBe("Via Roma 12, Pioltello (MI)");
		expect(suggestion.municipality?.name).toBe("Pioltello");
		expect(suggestion.municipalityCandidates).toEqual([]);
		expect(suggestion.location).toEqual({ x: 9.3278473, y: 45.4998571 });
		expect(suggestion.zipCode).toBe("20096");
	});

	it("labels a suggestion whose municipality we cannot resolve", async () => {
		nextHits = [hit({ rawCity: "Comune Inesistente" })];

		const [suggestion] = await geocodeAddress({ q: "Via Roma 12", ...MILAN });

		expect(suggestion.municipality).toBeNull();
		expect(suggestion.label).toBe("Via Roma 12, Comune Inesistente");
	});

	it("serves the second identical query from the cache", async () => {
		nextHits = [hit()];

		await geocodeAddress({ q: "Via Roma 12", ...MILAN });
		await geocodeAddress({ q: "via  roma 12", ...MILAN });

		expect(calls).toHaveLength(1);
	});

	it("does not reuse a ranking across bias cells", async () => {
		nextHits = [hit()];

		await geocodeAddress({ q: "Via Roma 12", ...MILAN });
		await geocodeAddress({ q: "Via Roma 12", lat: 41.9028, lng: 12.4964 });

		expect(calls).toHaveLength(2);
	});

	// `via roma 12` non nomina Roma: una sola chiamata, col bias.
	it("makes a single biased call when no municipality is named", async () => {
		nextHits = [hit()];

		await geocodeAddress({ q: "Via Roma 12", ...MILAN });

		expect(calls).toHaveLength(1);
		expect(calls[0].opts.near).toEqual(MILAN);
	});

	// `via roma 12 palermo` nomina Palermo: il bias da solo restituirebbe
	// Via Palermo a Parma, quindi parte anche una chiamata senza bias e i
	// risultati di Palermo vanno in testa.
	it("adds an unbiased call and promotes the named municipality", async () => {
		const db = getTestDb();
		await createTestMunicipality(db, {
			municipalityName: "Palermo",
			provinceName: "Palermo",
			provinceAcronym: "PA",
		});
		await createTestMunicipality(db, {
			municipalityName: "Parma",
			provinceName: "Parma",
			provinceAcronym: "PR",
		});

		const biased = hit({
			addressLine1: "Via Palermo 12",
			rawCity: "Parma",
			rawCounty: "Parma",
			providerRef: "photon:N-parma",
		});
		const unbiased = hit({
			addressLine1: "Via Roma 12",
			rawCity: "Palermo",
			rawCounty: "Palermo",
			providerRef: "photon:N-palermo",
		});
		queue = [[biased], [unbiased]];

		const suggestions = await geocodeAddress({
			q: "Via Roma 12 Palermo",
			...MILAN,
		});

		expect(calls).toHaveLength(2);
		expect(calls[0].opts.near).toEqual(MILAN);
		expect(calls[1].opts.near).toBeUndefined();
		expect(suggestions[0].municipality?.name).toBe("Palermo");
		expect(suggestions[1].municipality?.name).toBe("Parma");
	});

	// Il provider risponde con un comune diverso da quello nominato, ma nella
	// stessa provincia (Scillato è in provincia di Palermo): chi scrive
	// "palermo" intende la zona, quindi va promosso comunque, non solo un match
	// esatto sul comune.
	it("promotes a result in a neighboring municipality of the named province", async () => {
		const db = getTestDb();
		await createTestMunicipality(db, {
			municipalityName: "Palermo",
			provinceName: "Palermo",
			provinceAcronym: "PA",
		});
		await createTestMunicipality(db, {
			municipalityName: "Scillato",
			provinceName: "Palermo",
			provinceAcronym: "PA",
		});
		await createTestMunicipality(db, {
			municipalityName: "Parma",
			provinceName: "Parma",
			provinceAcronym: "PR",
		});

		const biased = hit({
			addressLine1: "Via Palermo 12",
			rawCity: "Parma",
			rawCounty: "Parma",
			providerRef: "photon:N-parma",
		});
		const unbiased = hit({
			addressLine1: "Via Roma 12",
			rawCity: "Scillato",
			rawCounty: "Palermo",
			providerRef: "photon:N-scillato",
		});
		queue = [[biased], [unbiased]];

		const suggestions = await geocodeAddress({
			q: "Via Roma 12 Palermo",
			...MILAN,
		});

		expect(suggestions[0].municipality?.name).toBe("Scillato");
		expect(suggestions[1].municipality?.name).toBe("Parma");
	});

	it("serves a stale entry when the provider is down", async () => {
		await writeLookup({
			provider: "photon",
			query: "via roma 12",
			biasCell: "45.46,9.19",
			hits: [hit()],
		});
		// Invecchia la entry oltre il TTL agendo sull'orologio del test.
		const realNow = Date.now;
		Date.now = () => realNow() + LOOKUP_TTL_MS + 1_000;
		failNext = true;

		try {
			const suggestions = await geocodeAddress({ q: "Via Roma 12", ...MILAN });
			expect(suggestions).toHaveLength(1);
			expect(suggestions[0].addressLine1).toBe("Via Roma 12");
		} finally {
			Date.now = realNow;
		}
	});

	it("propagates the failure when there is nothing cached", async () => {
		failNext = true;

		await expect(
			geocodeAddress({ q: "Via Roma 12", ...MILAN }),
		).rejects.toThrow();
	});
});
