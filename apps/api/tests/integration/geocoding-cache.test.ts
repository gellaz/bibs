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

import { count } from "drizzle-orm";
import { geocodingLookup } from "@/db/schemas/geocoding";
import { LOOKUP_TTL_MS, readLookup, writeLookup } from "@/lib/geocoding/cache";
import type { GeocodeHit } from "@/lib/geocoding/provider";
import { truncateAll } from "../helpers/cleanup";

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

const HIT: GeocodeHit = {
	addressLine1: "Via Roma 12",
	zipCode: "20096",
	location: { x: 9.3278473, y: 45.4998571 },
	rawCity: "Pioltello",
	rawCounty: "Milano",
	providerRef: "photon:N1",
};

// `as const` perché `LookupKey.provider` è l'unione dei provider, non `string`.
const KEY = {
	provider: "photon",
	query: "via roma 12",
	biasCell: "45.46,9.19",
} as const;

describe("geocoding cache", () => {
	it("returns null for a query never seen", async () => {
		expect(await readLookup(KEY)).toBeNull();
	});

	it("round-trips the hits and reports them fresh", async () => {
		await writeLookup({ ...KEY, hits: [HIT] });

		const cached = await readLookup(KEY);

		expect(cached?.hits).toEqual([HIT]);
		expect(cached?.isStale).toBe(false);
	});

	it("reports an entry older than the TTL as stale", async () => {
		await writeLookup({ ...KEY, hits: [HIT] });

		const cached = await readLookup(KEY, Date.now() + LOOKUP_TTL_MS + 1_000);

		expect(cached?.isStale).toBe(true);
		expect(cached?.hits).toEqual([HIT]);
	});

	// La cella di bias è parte della chiave: il ranking di Milano non deve
	// finire servito a chi cerca da Roma.
	it("keeps different bias cells apart", async () => {
		await writeLookup({ ...KEY, hits: [HIT] });

		expect(await readLookup({ ...KEY, biasCell: "41.90,12.50" })).toBeNull();
		expect(await readLookup({ ...KEY, biasCell: "-" })).toBeNull();
	});

	it("upserts instead of piling up rows for the same key", async () => {
		const db = getTestDb();
		await writeLookup({ ...KEY, hits: [HIT] });
		await writeLookup({
			...KEY,
			hits: [{ ...HIT, addressLine1: "Via Roma 14", providerRef: "photon:N2" }],
		});

		const [{ total }] = await db
			.select({ total: count() })
			.from(geocodingLookup);
		const cached = await readLookup(KEY);

		expect(total).toBe(1);
		expect(cached?.hits[0].addressLine1).toBe("Via Roma 14");
	});
});
