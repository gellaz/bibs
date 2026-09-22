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

import { holidayDefinition } from "@/db/schemas/holiday-definition";
import { storeHolidayOptout } from "@/db/schemas/store-holiday-optout";
import { addDaysYMD, dowFromYMD } from "@/lib/holidays";
import { searchStores } from "@/modules/customer/services/store-discovery";
import { getStoreFacets } from "@/modules/customer/services/store-facets";
import { getStoreMapPins } from "@/modules/customer/services/store-map";
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

describe("searchStores — macro category filter", () => {
	it("returns every store under the macro, across its categories", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const libreria = await createTestStoreCategory(db, "Libreria", "Cultura");
		const fumetteria = await createTestStoreCategory(
			db,
			"Fumetteria",
			"Cultura",
		);
		const panificio = await createTestStoreCategory(
			db,
			"Panificio",
			"Alimentari",
		);
		await visibleStore(profile.id, { name: "Libri", categoryId: libreria.id });
		await visibleStore(profile.id, {
			name: "Bolle",
			categoryId: fumetteria.id,
		});
		await visibleStore(profile.id, { name: "Pane", categoryId: panificio.id });

		const result = await searchStores({
			macroCategoryId: libreria.macroCategoryId,
		});
		expect(result.data.map((s) => s.name).sort()).toEqual(["Bolle", "Libri"]);
	});

	it("lets categoryId win over macroCategoryId", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const libreria = await createTestStoreCategory(db, "Libreria", "Cultura");
		const fumetteria = await createTestStoreCategory(
			db,
			"Fumetteria",
			"Cultura",
		);
		await visibleStore(profile.id, { name: "Libri", categoryId: libreria.id });
		await visibleStore(profile.id, {
			name: "Bolle",
			categoryId: fumetteria.id,
		});

		const result = await searchStores({
			categoryId: libreria.id,
			macroCategoryId: libreria.macroCategoryId,
		});
		expect(result.data.map((s) => s.name)).toEqual(["Libri"]);
	});
});

describe("getStoreFacets", () => {
	it("counts stores per macro and per category", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const libreria = await createTestStoreCategory(db, "Libreria", "Cultura");
		const fumetteria = await createTestStoreCategory(
			db,
			"Fumetteria",
			"Cultura",
		);
		await visibleStore(profile.id, { name: "Libri", categoryId: libreria.id });
		await visibleStore(profile.id, { name: "Altri", categoryId: libreria.id });
		await visibleStore(profile.id, {
			name: "Bolle",
			categoryId: fumetteria.id,
		});

		const facets = await getStoreFacets({});

		expect(facets.total).toBe(3);
		expect(facets.macros).toHaveLength(1);
		expect(facets.macros[0].name).toBe("Cultura");
		expect(facets.macros[0].storeCount).toBe(3);
		expect(
			facets.macros[0].categories.map((c) => [c.name, c.storeCount]),
		).toEqual([
			["Fumetteria", 1],
			["Libreria", 2],
		]);
	});

	it("omits macros with no matching stores", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const libreria = await createTestStoreCategory(db, "Libreria", "Cultura");
		// Una macro senza negozi non deve comparire: sarebbe un filtro che
		// garantisce "nessun risultato".
		await createTestStoreCategory(db, "Panificio", "Alimentari");
		await visibleStore(profile.id, { name: "Libri", categoryId: libreria.id });

		const facets = await getStoreFacets({});

		expect(facets.macros.map((mc) => mc.name)).toEqual(["Cultura"]);
	});

	it("narrows the counts with the text query", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const libreria = await createTestStoreCategory(db, "Libreria", "Cultura");
		await visibleStore(profile.id, {
			name: "Libri Rari",
			categoryId: libreria.id,
		});
		await visibleStore(profile.id, {
			name: "Altra Bottega",
			categoryId: libreria.id,
		});

		const facets = await getStoreFacets({ q: "Libri" });

		expect(facets.total).toBe(1);
		expect(facets.macros[0].storeCount).toBe(1);
	});

	it("narrows the counts with the radius", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const libreria = await createTestStoreCategory(db, "Libreria", "Cultura");
		await visibleStore(profile.id, {
			name: "Vicino",
			categoryId: libreria.id,
			...ROME,
		});
		await visibleStore(profile.id, {
			name: "Lontano",
			categoryId: libreria.id,
			...MILAN,
		});

		const facets = await getStoreFacets({
			lat: ROME.lat,
			lng: ROME.lng,
			radius: 50,
		});

		expect(facets.total).toBe(1);
		expect(facets.macros[0].categories[0].storeCount).toBe(1);
	});

	it("excludes stores that are not publicly visible", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const libreria = await createTestStoreCategory(db, "Libreria", "Cultura");
		await visibleStore(profile.id, {
			name: "Visibile",
			categoryId: libreria.id,
		});
		// Nessun abbonamento attivo: fuori dalla ricerca, quindi fuori dai conteggi.
		await createTestStore(db, profile.id, {
			name: "Invisibile",
			categoryId: libreria.id,
		});

		const facets = await getStoreFacets({});

		expect(facets.total).toBe(1);
		expect(facets.macros[0].storeCount).toBe(1);
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

	it("reports unknown when openingHours is unset", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, { name: "SenzaOrari" });

		const result = await searchStores({});
		expect(result.data[0].openStatus.isOpen).toBe(false);
		// Non "closed": non sappiamo se è chiuso, sappiamo che non ce l'ha detto.
		expect(result.data[0].openStatus.status).toBe("unknown");
	});

	it("keeps a store without hours out of the openNow filter", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, { name: "SenzaOrari" });

		const filtered = await searchStores({ openNow: true, limit: 100 });
		expect(filtered.data.map((s) => s.name)).not.toContain("SenzaOrari");
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

/** Orari che coprono ogni momento della settimana: aperto, comunque vada. */
const ALWAYS_OPEN = Array.from({ length: 7 }, (_, i) => ({
	dayOfWeek: i,
	slots: [{ open: "00:00", close: "23:59" }],
}));

/** Data di oggi a Roma + il giorno della settimana nella forma 0=Lun..6=Dom. */
function romeToday(): { date: string; dow: number } {
	const date = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Europe/Rome",
	}).format(new Date());
	return { date, dow: dowFromYMD(date) };
}

/** Festività attiva che cade oggi. */
async function holidayToday(name: string) {
	const db = getTestDb();
	const [def] = await db
		.insert(holidayDefinition)
		.values({ name, type: "one_off", oneOffDate: romeToday().date })
		.returning();
	return def;
}

describe("searchStores — openNow filter", () => {
	it("keeps only the stores whose weekly hours cover this moment", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { dow } = romeToday();
		await visibleStore(profile.id, {
			name: "Aperto",
			openingHours: ALWAYS_OPEN,
		});
		await visibleStore(profile.id, { name: "SenzaOrari" });
		await visibleStore(profile.id, {
			name: "AltroGiorno",
			openingHours: [
				{
					dayOfWeek: (dow + 1) % 7,
					slots: [{ open: "00:00", close: "23:59" }],
				},
			],
		});

		const result = await searchStores({ openNow: true });

		expect(result.data.map((s) => s.name)).toEqual(["Aperto"]);
		expect(result.pagination.total).toBe(1);
	});

	it("excludes a store whose custom closure covers today", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { date } = romeToday();
		await visibleStore(profile.id, {
			name: "Aperto",
			openingHours: ALWAYS_OPEN,
		});
		await visibleStore(profile.id, {
			name: "InFerie",
			openingHours: ALWAYS_OPEN,
			closures: [{ startDate: addDaysYMD(date, -2), endDate: date }],
		});
		// Chiusura di un giorno solo: `endDate` assente vale `startDate`.
		await visibleStore(profile.id, {
			name: "ChiusuraDiUnGiorno",
			openingHours: ALWAYS_OPEN,
			closures: [{ startDate: date }],
		});

		const result = await searchStores({ openNow: true });

		expect(result.data.map((s) => s.name)).toEqual(["Aperto"]);
	});

	it("excludes a store closed by an active holiday falling today", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await holidayToday("Festa di Prova");
		await visibleStore(profile.id, {
			name: "ChiusoPerFesta",
			openingHours: ALWAYS_OPEN,
		});

		const result = await searchStores({ openNow: true });

		expect(result.data).toHaveLength(0);
		expect(result.pagination.total).toBe(0);
	});

	it("keeps a store that opted out of the holiday falling today", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const def = await holidayToday("Festa di Prova");
		const open = await visibleStore(profile.id, {
			name: "ApertoPerScelta",
			openingHours: ALWAYS_OPEN,
		});
		await visibleStore(profile.id, {
			name: "ChiusoPerFesta",
			openingHours: ALWAYS_OPEN,
		});
		await db
			.insert(storeHolidayOptout)
			.values({ storeId: open.id, holidayDefinitionId: def.id });

		const result = await searchStores({ openNow: true });

		expect(result.data.map((s) => s.name)).toEqual(["ApertoPerScelta"]);
	});

	it("matches exactly the stores the unfiltered search reports as open", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { date, dow } = romeToday();
		const def = await holidayToday("Festa di Prova");

		await visibleStore(profile.id, {
			name: "SempreAperto",
			openingHours: ALWAYS_OPEN,
		});
		await visibleStore(profile.id, { name: "SenzaOrari" });
		await visibleStore(profile.id, {
			name: "SoloAltroGiorno",
			openingHours: [
				{
					dayOfWeek: (dow + 1) % 7,
					slots: [{ open: "00:00", close: "23:59" }],
				},
			],
		});
		await visibleStore(profile.id, {
			name: "InFerie",
			openingHours: ALWAYS_OPEN,
			closures: [{ startDate: date, endDate: addDaysYMD(date, 3) }],
		});
		const optedOut = await visibleStore(profile.id, {
			name: "ApertoPerScelta",
			openingHours: ALWAYS_OPEN,
		});
		await db
			.insert(storeHolidayOptout)
			.values({ storeId: optedOut.id, holidayDefinitionId: def.id });

		const all = await searchStores({ limit: 100 });
		const expected = all.data
			.filter((s) => s.openStatus.isOpen)
			.map((s) => s.id)
			.sort();
		const filtered = await searchStores({ openNow: true, limit: 100 });

		// La condizione SQL e `getOpenStatus` sono due implementazioni della
		// stessa regola: questo test è il solo posto che le tiene allineate.
		expect(filtered.data.map((s) => s.id).sort()).toEqual(expected);
		expect(filtered.pagination.total).toBe(expected.length);
	});
});

describe("getStoreFacets — openNow", () => {
	it("counts only the stores open now when the filter is on", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const libreria = await createTestStoreCategory(db, "Libreria", "Cultura");
		await visibleStore(profile.id, {
			name: "Aperto",
			categoryId: libreria.id,
			openingHours: ALWAYS_OPEN,
		});
		await visibleStore(profile.id, { name: "Chiuso", categoryId: libreria.id });

		const facets = await getStoreFacets({ openNow: true });

		expect(facets.total).toBe(1);
		expect(facets.macros[0].storeCount).toBe(1);
		expect(facets.macros[0].categories).toEqual([
			{ id: libreria.id, name: "Libreria", storeCount: 1 },
		]);
	});

	it("reports openNowTotal while the filter is off", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const libreria = await createTestStoreCategory(db, "Libreria", "Cultura");
		await visibleStore(profile.id, {
			name: "Aperto",
			categoryId: libreria.id,
			openingHours: ALWAYS_OPEN,
		});
		await visibleStore(profile.id, { name: "Chiuso", categoryId: libreria.id });

		const facets = await getStoreFacets({});

		expect(facets.total).toBe(2);
		expect(facets.openNowTotal).toBe(1);
	});

	it("keeps openNowTotal aligned with the text query", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const libreria = await createTestStoreCategory(db, "Libreria", "Cultura");
		await visibleStore(profile.id, {
			name: "Libri Aperti",
			categoryId: libreria.id,
			openingHours: ALWAYS_OPEN,
		});
		await visibleStore(profile.id, {
			name: "Altra Bottega",
			categoryId: libreria.id,
			openingHours: ALWAYS_OPEN,
		});

		const facets = await getStoreFacets({ q: "Libri" });

		expect(facets.openNowTotal).toBe(1);
	});
});

describe("getStoreMapPins", () => {
	it("restituisce gli stessi negozi della lista, con le coordinate", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const a = await visibleStore(seller.profile.id, {
			name: "Bottega A",
			lat: ROME.lat,
			lng: ROME.lng,
		});
		const b = await visibleStore(seller.profile.id, {
			name: "Bottega B",
			lat: MILAN.lat,
			lng: MILAN.lng,
		});

		const list = await searchStores({ limit: 100 });
		const map = await getStoreMapPins({});

		expect(new Set(map.pins.map((p) => p.id))).toEqual(
			new Set(list.data.map((s) => s.id)),
		);
		expect(map.total).toBe(list.pagination.total);
		expect(map.mappable).toBe(2);
		expect(map.truncated).toBe(false);

		const pinA = map.pins.find((p) => p.id === a.id);
		expect(pinA?.coordinates.lat).toBeCloseTo(ROME.lat, 5);
		expect(pinA?.coordinates.lng).toBeCloseTo(ROME.lng, 5);
		expect(map.pins.find((p) => p.id === b.id)?.coordinates.lat).toBeCloseTo(
			MILAN.lat,
			5,
		);
	});

	it("tiene i negozi senza posizione fuori dai pin ma dentro total", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await visibleStore(seller.profile.id, {
			name: "Con posizione",
			lat: ROME.lat,
			lng: ROME.lng,
		});
		const senzaPosizione = await visibleStore(seller.profile.id, {
			name: "Senza posizione",
			noLocation: true,
		});

		const map = await getStoreMapPins({});

		expect(map.total).toBe(2);
		expect(map.mappable).toBe(1);
		expect(map.pins).toHaveLength(1);
		expect(map.pins.map((p) => p.id)).not.toContain(senzaPosizione.id);
	});

	it("esclude i negozi non pubblicamente visibili", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const visibile = await visibleStore(seller.profile.id, {
			name: "Visibile",
		});
		// Nessun abbonamento: fuori dalla vetrina pubblica, quindi fuori dalla mappa.
		await createTestStore(db, seller.profile.id, { name: "Senza abbonamento" });

		const map = await getStoreMapPins({});

		expect(map.pins.map((p) => p.id)).toEqual([visibile.id]);
		expect(map.total).toBe(1);
	});

	it("applica categoria, raggio e testo come la lista", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const categoria = await createTestStoreCategory(db, "Panetterie");
		const altra = await createTestStoreCategory(db, "Ferramenta");
		const panetteria = await visibleStore(seller.profile.id, {
			name: "Pane e Co",
			categoryId: categoria.id,
			lat: ROME.lat,
			lng: ROME.lng,
		});
		await visibleStore(seller.profile.id, {
			name: "Chiodi e Co",
			categoryId: altra.id,
			lat: ROME.lat,
			lng: ROME.lng,
		});
		await visibleStore(seller.profile.id, {
			name: "Pane lontano",
			categoryId: categoria.id,
			lat: MILAN.lat,
			lng: MILAN.lng,
		});

		const perCategoria = await getStoreMapPins({ categoryId: categoria.id });
		expect(perCategoria.pins).toHaveLength(2);

		const vicino = await getStoreMapPins({
			categoryId: categoria.id,
			lat: ROME.lat,
			lng: ROME.lng,
			radius: 50,
		});
		expect(vicino.pins.map((p) => p.id)).toEqual([panetteria.id]);
		expect(vicino.total).toBe(1);

		const perTesto = await getStoreMapPins({ q: "Chiodi" });
		expect(perTesto.pins).toHaveLength(1);
		expect(perTesto.pins[0].name).toBe("Chiodi e Co");
	});

	it("ordina per distanza quando c'è la posizione e tronca al tetto", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		// Tre negozi a distanza crescente da Roma.
		const vicino = await visibleStore(seller.profile.id, {
			name: "Vicino",
			lat: ROME.lat,
			lng: ROME.lng,
		});
		const medio = await visibleStore(seller.profile.id, {
			name: "Medio",
			lat: ROME.lat + 0.1,
			lng: ROME.lng,
		});
		await visibleStore(seller.profile.id, {
			name: "Lontano",
			lat: MILAN.lat,
			lng: MILAN.lng,
		});

		const tutti = await getStoreMapPins({ lat: ROME.lat, lng: ROME.lng });
		expect(tutti.pins.map((p) => p.name)).toEqual([
			"Vicino",
			"Medio",
			"Lontano",
		]);
		expect(tutti.pins[0].distance).toBeLessThan(
			tutti.pins[2].distance as number,
		);

		// La distanza è lo stesso numero che la lista mostra sulla card: due
		// formule diverse per lo stesso metro sarebbero due viste in disaccordo.
		const list = await searchStores({
			lat: ROME.lat,
			lng: ROME.lng,
			limit: 100,
		});
		for (const pin of tutti.pins) {
			const card = list.data.find((s) => s.id === pin.id);
			expect(pin.distance).toBeCloseTo(card?.distance as number, 3);
		}

		// Il tetto è iniettabile per non dover inserire 501 negozi in un test.
		const troncati = await getStoreMapPins({ lat: ROME.lat, lng: ROME.lng }, 2);
		expect(troncati.pins.map((p) => p.id)).toEqual([vicino.id, medio.id]);
		expect(troncati.truncated).toBe(true);
		expect(troncati.total).toBe(3);
		expect(troncati.mappable).toBe(3);
	});

	it("ordina per nome quando non c'è la posizione", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await visibleStore(seller.profile.id, { name: "Zeta" });
		await visibleStore(seller.profile.id, { name: "Alfa" });

		const map = await getStoreMapPins({});

		expect(map.pins.map((p) => p.name)).toEqual(["Alfa", "Zeta"]);
		expect(map.pins.every((p) => p.distance === null)).toBe(true);
	});
});
