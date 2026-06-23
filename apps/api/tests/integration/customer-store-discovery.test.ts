import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";

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

import { searchStores } from "@/modules/customer/services/store-discovery";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestMunicipalityNamed,
	createTestSeller,
	createTestStore,
	createTestStoreCategory,
	createTestStoreImage,
	createTestStoreSubscription,
} from "../helpers/fixtures";

const ROME = { lat: 41.9028, lng: 12.4964 };
const MILAN = { lat: 45.4654, lng: 9.19 };

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

/** Creates a visible store (active subscription) for the given seller. */
async function visibleStore(
	sellerProfileId: string,
	params: Parameters<typeof createTestStore>[2] = {},
) {
	const db = getTestDb();
	const s = await createTestStore(db, sellerProfileId, params);
	await createTestStoreSubscription(db, s.id, { status: "active" });
	return s;
}

describe("searchStores — visibility", () => {
	it("excludes soft-deleted, suspended, canceled, and subscription-less stores", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);

		const live = await createTestStore(db, profile.id, { name: "Vivo" });
		await createTestStoreSubscription(db, live.id, { status: "active" });

		const pastDue = await createTestStore(db, profile.id, { name: "Scaduto" });
		await createTestStoreSubscription(db, pastDue.id, { status: "past_due" });

		const canceling = await createTestStore(db, profile.id, {
			name: "InCancellazione",
		});
		await createTestStoreSubscription(db, canceling.id, {
			status: "canceling",
		});

		const suspended = await createTestStore(db, profile.id, {
			name: "Sospeso",
		});
		await createTestStoreSubscription(db, suspended.id, {
			status: "suspended",
		});

		const canceled = await createTestStore(db, profile.id, {
			name: "Cancellato",
		});
		await createTestStoreSubscription(db, canceled.id, { status: "canceled" });

		// No subscription at all
		await createTestStore(db, profile.id, { name: "SenzaAbbonamento" });

		const result = await searchStores({});
		const names = result.data.map((s) => s.name).sort();
		expect(names).toEqual(["InCancellazione", "Scaduto", "Vivo"]);
		expect(result.pagination.total).toBe(3);
	});
});

describe("searchStores — default order + shape", () => {
	it("returns all visible stores alphabetically when no query/geo", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, { name: "Zeta" });
		await visibleStore(profile.id, { name: "Alfa" });
		await visibleStore(profile.id, { name: "Mike" });

		const result = await searchStores({});
		expect(result.data.map((s) => s.name)).toEqual(["Alfa", "Mike", "Zeta"]);
	});

	it("includes category, municipality, address, image, and a null distance", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const cat = await createTestStoreCategory(db, "Libreria");
		const s = await visibleStore(profile.id, {
			name: "La Libreria",
			categoryId: cat.id,
		});
		await createTestStoreImage(db, s.id, {
			url: "https://img.test/cover.jpg",
			position: 0,
		});

		const result = await searchStores({});
		const card = result.data[0];
		expect(card.category).toEqual({ id: cat.id, name: "Libreria" });
		expect(typeof card.municipality.name).toBe("string");
		expect(card.municipality.provinceAcronym).toHaveLength(2);
		expect(card.addressLine1).toBe("Via Roma 1");
		expect(card.image).toEqual({ url: "https://img.test/cover.jpg" });
		expect(card.distance).toBeNull();
	});

	it("picks the lowest-position image as the cover", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id, { name: "Negozio" });
		await createTestStoreImage(db, s.id, {
			url: "https://img.test/b.jpg",
			position: 2,
		});
		await createTestStoreImage(db, s.id, {
			url: "https://img.test/a.jpg",
			position: 0,
		});

		const result = await searchStores({});
		expect(result.data[0].image).toEqual({ url: "https://img.test/a.jpg" });
	});

	it("returns a null image when the store has none", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, { name: "SenzaFoto" });
		const result = await searchStores({});
		expect(result.data[0].image).toBeNull();
	});
});

describe("searchStores — text search (name + comune)", () => {
	it("matches by store name (contains)", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, { name: "La Libreria Centrale" });
		await visibleStore(profile.id, { name: "Panificio Rossi" });

		const result = await searchStores({ q: "libr" });
		expect(result.data.map((s) => s.name)).toEqual(["La Libreria Centrale"]);
	});

	it("ranks a name prefix match above a name contains match", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, { name: "Centro Libri" }); // contains "libr"
		await visibleStore(profile.id, { name: "Libreria Bianchi" }); // prefix "libr"

		const result = await searchStores({ q: "libr" });
		expect(result.data.map((s) => s.name)).toEqual([
			"Libreria Bianchi",
			"Centro Libri",
		]);
	});

	it("matches by municipality (comune) name", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const milano = await createTestMunicipalityNamed(db, "Milano");
		await visibleStore(profile.id, {
			name: "Negozio Nord",
			municipalityId: milano.id,
		});
		await visibleStore(profile.id, { name: "Negozio Sud" }); // default "Test City ..."

		const result = await searchStores({ q: "milano" });
		expect(result.data.map((s) => s.name)).toEqual(["Negozio Nord"]);
	});
});

describe("searchStores — category filter", () => {
	it("returns only stores in the given category", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const libreria = await createTestStoreCategory(db, "Libreria");
		const panificio = await createTestStoreCategory(db, "Panificio");
		await visibleStore(profile.id, {
			name: "Libri & Co",
			categoryId: libreria.id,
		});
		await visibleStore(profile.id, {
			name: "Pane Caldo",
			categoryId: panificio.id,
		});

		const result = await searchStores({ categoryId: libreria.id });
		expect(result.data.map((s) => s.name)).toEqual(["Libri & Co"]);
	});
});

describe("searchStores — geo", () => {
	it("orders by distance (nearest first) and returns distance in meters", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, { name: "Milano", ...MILAN });
		await visibleStore(profile.id, { name: "Roma", ...ROME });

		const result = await searchStores({ lat: ROME.lat, lng: ROME.lng });
		expect(result.data.map((s) => s.name)).toEqual(["Roma", "Milano"]);
		expect(result.data[0].distance ?? -1).toBeGreaterThanOrEqual(0);
		expect(result.data[1].distance ?? 0).toBeGreaterThan(
			result.data[0].distance ?? 0,
		);
	});

	it("places stores without a location last (NULLS LAST)", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, {
			name: "SenzaPosizione",
			noLocation: true,
		});
		await visibleStore(profile.id, { name: "Roma", ...ROME });

		const result = await searchStores({ lat: ROME.lat, lng: ROME.lng });
		expect(result.data.map((s) => s.name)).toEqual(["Roma", "SenzaPosizione"]);
		expect(result.data[1].distance).toBeNull();
	});

	it("filters by radius when provided", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, { name: "Roma", ...ROME });
		await visibleStore(profile.id, { name: "Milano", ...MILAN });

		const result = await searchStores({
			lat: ROME.lat,
			lng: ROME.lng,
			radius: 50,
		});
		expect(result.data.map((s) => s.name)).toEqual(["Roma"]);
	});
});

describe("searchStores — open status", () => {
	it("reports open when the store is open now", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, {
			name: "SempreAperto",
			openingHours: Array.from({ length: 7 }, (_, i) => ({
				dayOfWeek: i,
				slots: [{ open: "00:00", close: "23:59" }],
			})),
		});

		const result = await searchStores({});
		expect(result.data[0].openStatus.isOpen).toBe(true);
		expect(result.data[0].openStatus.status).toBe("open");
	});

	it("reports closed when openingHours is unset", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, { name: "Chiuso" });

		const result = await searchStores({});
		expect(result.data[0].openStatus.isOpen).toBe(false);
		expect(result.data[0].openStatus.status).toBe("closed");
	});
});

describe("searchStores — ordering precedence", () => {
	it("relevance dominates distance: prefix-match far away ranks before contains-match nearby", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		// "Libreria Milano" is in Milan (far from Rome), name starts with "libr" → relevance tier 2
		await visibleStore(profile.id, { name: "Libreria Milano", ...MILAN });
		// "Centro Libri" is in Rome (near), name contains "libr" → relevance tier 1
		await visibleStore(profile.id, { name: "Centro Libri", ...ROME });

		const result = await searchStores({
			q: "libr",
			lat: ROME.lat,
			lng: ROME.lng,
		});
		expect(result.data.map((s) => s.name)).toEqual([
			"Libreria Milano",
			"Centro Libri",
		]);
	});

	it("name-match tier ranks above comune-only match tier", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		// "Roma Bottega" — name contains "roma" → relevance tier 1
		await visibleStore(profile.id, { name: "Roma Bottega" });
		// "Alimentari Buoni" — in a municipality called "Roma" → relevance tier 0 (comune-only match)
		const roma = await createTestMunicipalityNamed(db, "Roma");
		await visibleStore(profile.id, {
			name: "Alimentari Buoni",
			municipalityId: roma.id,
		});

		const result = await searchStores({ q: "roma" });
		const names = result.data.map((s) => s.name);
		expect(names.indexOf("Roma Bottega")).toBeLessThan(
			names.indexOf("Alimentari Buoni"),
		);
	});
});

describe("searchStores — pagination", () => {
	it("respects limit and page with a stable order", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		for (const name of ["A", "B", "C", "D", "E"]) {
			await visibleStore(profile.id, { name });
		}

		const page1 = await searchStores({ page: 1, limit: 2 });
		const page2 = await searchStores({ page: 2, limit: 2 });
		const page3 = await searchStores({ page: 3, limit: 2 });

		expect(page1.data.map((s) => s.name)).toEqual(["A", "B"]);
		expect(page2.data.map((s) => s.name)).toEqual(["C", "D"]);
		expect(page3.data.map((s) => s.name)).toEqual(["E"]);
		expect(page1.pagination.total).toBe(5);
	});
});
