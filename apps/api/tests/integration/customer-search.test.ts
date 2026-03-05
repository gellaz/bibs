import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";

// ── Module mocks (hoisted by Bun before all imports) ──────────────────────────
import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
	get db() {
		return getTestDb();
	},
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { searchProducts } from "@/modules/customer/services/search";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCategory,
	createTestProduct,
	createTestProductClassification,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
} from "../helpers/fixtures";

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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Coordinates for well-known Italian cities */
const ROME = { lat: 41.9028, lng: 12.4964 };
const MILAN = { lat: 45.4654, lng: 9.19 };

/**
 * Seeds a single product available in a given store.
 * Returns the product and the storeProduct.
 */
async function seedProductInStore(
	sellerProfileId: string,
	storeId: string,
	params: {
		name: string;
		description?: string;
		price?: string;
		stock?: number;
	},
) {
	const db = getTestDb();
	const prod = await createTestProduct(db, sellerProfileId, {
		name: params.name,
		description: params.description,
		price: params.price ?? "10.00",
	});
	const sp = await createTestStoreProduct(db, storeId, prod.id, {
		stock: params.stock ?? 5,
	});
	return { product: prod, storeProduct: sp };
}

// ── Full-text search ──────────────────────────────────────────────────────────

describe("searchProducts — full-text search", () => {
	it("returns products matching an Italian keyword", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const storeRome = await createTestStore(db, seller.profile.id, ROME);

		await seedProductInStore(seller.profile.id, storeRome.id, {
			name: "Pizza Napoletana",
			description: "Autentica pizza napoletana con pomodoro e mozzarella",
		});
		await seedProductInStore(seller.profile.id, storeRome.id, {
			name: "Pasta al Pomodoro",
			description: "Pasta fresca con salsa di pomodoro",
		});
		await seedProductInStore(seller.profile.id, storeRome.id, {
			name: "Gelato alla Fragola",
			description: "Gelato artigianale alla fragola",
		});

		const result = await searchProducts({ q: "pizza" });

		expect(result.data.length).toBeGreaterThanOrEqual(1);
		// "Pizza Napoletana" should be in the results
		const names = result.data.map((p) => p.name);
		expect(names).toContain("Pizza Napoletana");
		// "Gelato alla Fragola" should not match "pizza"
		expect(names).not.toContain("Gelato alla Fragola");
	});

	it("returns empty results for a query that matches nothing", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const testStore = await createTestStore(db, seller.profile.id, ROME);

		await seedProductInStore(seller.profile.id, testStore.id, {
			name: "Pane Artigianale",
		});

		const result = await searchProducts({ q: "sushi" });

		expect(result.data).toHaveLength(0);
		expect(result.pagination.total).toBe(0);
	});

	it("returns all active products when no query is provided", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const testStore = await createTestStore(db, seller.profile.id, ROME);

		await seedProductInStore(seller.profile.id, testStore.id, { name: "Pane" });
		await seedProductInStore(seller.profile.id, testStore.id, { name: "Vino" });

		const result = await searchProducts({});

		expect(result.pagination.total).toBe(2);
	});

	it("does not return products with zero stock", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const testStore = await createTestStore(db, seller.profile.id, ROME);

		await seedProductInStore(seller.profile.id, testStore.id, {
			name: "Prodotto Esaurito",
			stock: 0,
		});
		await seedProductInStore(seller.profile.id, testStore.id, {
			name: "Prodotto Disponibile",
			stock: 5,
		});

		const result = await searchProducts({});

		const names = result.data.map((p) => p.name);
		expect(names).not.toContain("Prodotto Esaurito");
		expect(names).toContain("Prodotto Disponibile");
	});
});

// ── Geo filter ────────────────────────────────────────────────────────────────

describe("searchProducts — geo filter", () => {
	it("returns only products from stores within the radius", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		// Store in Rome (should match)
		const storeRome = await createTestStore(db, seller.profile.id, {
			name: "Negozio Roma",
			...ROME,
		});
		// Store in Milan (~470 km from Rome, outside a 10 km radius)
		const storeMilan = await createTestStore(db, seller.profile.id, {
			name: "Negozio Milano",
			...MILAN,
		});

		await seedProductInStore(seller.profile.id, storeRome.id, {
			name: "Prodotto Roma",
		});
		await seedProductInStore(seller.profile.id, storeMilan.id, {
			name: "Prodotto Milano",
		});

		// Search from Rome with radius = 50 km → should only find Rome product
		const result = await searchProducts({
			lat: ROME.lat,
			lng: ROME.lng,
			radius: 50,
		});

		const names = result.data.map((p) => p.name);
		expect(names).toContain("Prodotto Roma");
		expect(names).not.toContain("Prodotto Milano");
	});

	it("returns products from both cities when radius is large enough", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		const storeRome = await createTestStore(db, seller.profile.id, {
			name: "Negozio Roma",
			...ROME,
		});
		const storeMilan = await createTestStore(db, seller.profile.id, {
			name: "Negozio Milano",
			...MILAN,
		});

		await seedProductInStore(seller.profile.id, storeRome.id, {
			name: "Prodotto Roma",
		});
		await seedProductInStore(seller.profile.id, storeMilan.id, {
			name: "Prodotto Milano",
		});

		// 600 km radius — covers all of Italy
		const result = await searchProducts({
			lat: ROME.lat,
			lng: ROME.lng,
			radius: 600,
		});

		const names = result.data.map((p) => p.name);
		expect(names).toContain("Prodotto Roma");
		expect(names).toContain("Prodotto Milano");
	});

	it("orders results by distance (nearest first) when no text query", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		// Two stores at different distances from Rome
		// Nearby: Rome
		const storeNear = await createTestStore(db, seller.profile.id, {
			name: "Vicino",
			...ROME,
		});
		// Far: slightly north of Rome (~100 km)
		const storeFar = await createTestStore(db, seller.profile.id, {
			name: "Lontano",
			lat: 42.9,
			lng: 12.5,
		});

		await seedProductInStore(seller.profile.id, storeFar.id, {
			name: "Prodotto Lontano",
		});
		await seedProductInStore(seller.profile.id, storeNear.id, {
			name: "Prodotto Vicino",
		});

		const result = await searchProducts({
			lat: ROME.lat,
			lng: ROME.lng,
			radius: 200,
		});

		expect(result.data.length).toBe(2);
		// Nearest store first
		expect(result.data[0].name).toBe("Prodotto Vicino");
		expect(result.data[1].name).toBe("Prodotto Lontano");
	});
});

// ── Category filter ───────────────────────────────────────────────────────────

describe("searchProducts — category filter", () => {
	it("returns only products belonging to the given category", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const testStore = await createTestStore(db, seller.profile.id, ROME);
		const category = await createTestCategory(db, "Dolci");

		const { product: sweet } = await seedProductInStore(
			seller.profile.id,
			testStore.id,
			{ name: "Cannolo Siciliano" },
		);
		await seedProductInStore(seller.profile.id, testStore.id, {
			name: "Focaccia Barese",
		});

		// Assign only the sweet product to the "Dolci" category
		await createTestProductClassification(db, sweet.id, category.id);

		const result = await searchProducts({ categoryId: category.id });

		const names = result.data.map((p) => p.name);
		expect(names).toContain("Cannolo Siciliano");
		expect(names).not.toContain("Focaccia Barese");
	});

	it("can combine category filter with full-text search", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const testStore = await createTestStore(db, seller.profile.id, ROME);
		const dolci = await createTestCategory(db, "Dolci");
		const salati = await createTestCategory(db, "Salati");

		const { product: tiramisu } = await seedProductInStore(
			seller.profile.id,
			testStore.id,
			{ name: "Tiramisù Classico" },
		);
		const { product: panna } = await seedProductInStore(
			seller.profile.id,
			testStore.id,
			{ name: "Panna Cotta" },
		);
		const { product: pizza } = await seedProductInStore(
			seller.profile.id,
			testStore.id,
			{ name: "Pizza Dolce" }, // contains "dolce" but is in salati
		);

		await createTestProductClassification(db, tiramisu.id, dolci.id);
		await createTestProductClassification(db, panna.id, dolci.id);
		await createTestProductClassification(db, pizza.id, salati.id);

		// Search for "classico" in the "Dolci" category only
		const result = await searchProducts({
			q: "classico",
			categoryId: dolci.id,
		});

		const names = result.data.map((p) => p.name);
		expect(names).toContain("Tiramisù Classico");
		expect(names).not.toContain("Panna Cotta");
		expect(names).not.toContain("Pizza Dolce");
	});
});

// ── Pagination ────────────────────────────────────────────────────────────────

describe("searchProducts — pagination", () => {
	it("respects limit and page parameters", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const testStore = await createTestStore(db, seller.profile.id, ROME);

		// Create 5 products
		for (let i = 1; i <= 5; i++) {
			await seedProductInStore(seller.profile.id, testStore.id, {
				name: `Prodotto ${i}`,
			});
		}

		const page1 = await searchProducts({ page: 1, limit: 2 });
		const page2 = await searchProducts({ page: 2, limit: 2 });
		const page3 = await searchProducts({ page: 3, limit: 2 });

		expect(page1.data).toHaveLength(2);
		expect(page2.data).toHaveLength(2);
		expect(page3.data).toHaveLength(1);
		expect(page1.pagination.total).toBe(5);

		// Pages should not overlap
		const page1Ids = page1.data.map((p) => p.id);
		const page2Ids = page2.data.map((p) => p.id);
		const overlap = page1Ids.filter((id) => page2Ids.includes(id));
		expect(overlap).toHaveLength(0);
	});
});
