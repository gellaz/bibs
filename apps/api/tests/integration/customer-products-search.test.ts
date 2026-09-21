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

import { searchProducts } from "@/modules/customer/services/product-search";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCategory,
	createTestMacroCategory,
	createTestProduct,
	createTestProductCategoryAssignment,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
	createTestStoreSubscription,
} from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

const ROME = { lat: 41.9028, lng: 12.4964 };
const MILAN = { lat: 45.4654, lng: 9.19 };
/** ~2 km a nord del centro di Roma. */
const ROME_NORTH = { lat: 41.9208, lng: 12.4964 };

/**
 * Negozio *visibile*: un negozio senza abbonamento attivo non esiste per il
 * cliente, quindi tutti i fixture della ricerca passano di qui.
 */
async function visibleStore(
	sellerProfileId: string,
	params: Parameters<typeof createTestStore>[2] = {},
) {
	const db = getTestDb();
	const s = await createTestStore(db, sellerProfileId, params);
	await createTestStoreSubscription(db, s.id, { status: "active" });
	return s;
}

/** Crea un prodotto e lo mette in uno o più negozi con lo stock dato. */
async function productIn(
	sellerProfileId: string,
	storeIds: string[],
	params: {
		name: string;
		description?: string;
		price?: string;
		stock?: number;
	},
) {
	const db = getTestDb();
	const p = await createTestProduct(db, sellerProfileId, {
		name: params.name,
		description: params.description,
		price: params.price ?? "10.00",
	});
	for (const storeId of storeIds) {
		await createTestStoreProduct(db, storeId, p.id, {
			stock: params.stock ?? 5,
		});
	}
	return p;
}

describe("searchProducts — regola di aggancio", () => {
	it("aggancia il negozio più vicino all'origine", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const near = await visibleStore(seller.profile.id, {
			name: "Vicino",
			...ROME_NORTH,
		});
		const far = await visibleStore(seller.profile.id, {
			name: "Lontano",
			...MILAN,
		});

		await productIn(seller.profile.id, [far.id, near.id], { name: "Pane" });

		const result = await searchProducts({ lat: ROME.lat, lng: ROME.lng });

		expect(result.data).toHaveLength(1);
		expect(result.data[0].store.name).toBe("Vicino");
		expect(result.data[0].store.id).toBe(near.id);
		expect(result.data[0].distance).toBeGreaterThan(0);
		expect(result.data[0].distance).toBeLessThan(5_000);
	});

	it("senza origine aggancia il primo negozio per nome, in modo stabile", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const zeta = await visibleStore(seller.profile.id, {
			name: "Zeta",
			...MILAN,
		});
		const alfa = await visibleStore(seller.profile.id, {
			name: "Alfa",
			...ROME,
		});

		await productIn(seller.profile.id, [zeta.id, alfa.id], { name: "Pane" });

		const first = await searchProducts({});
		const second = await searchProducts({});

		expect(first.data[0].store.name).toBe("Alfa");
		expect(first.data[0].distance).toBeNull();
		expect(second.data[0].store.id).toBe(first.data[0].store.id);
	});

	it("restituisce storeProductId e stock del negozio agganciato, non di un altro", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const near = await visibleStore(seller.profile.id, {
			name: "Vicino",
			...ROME_NORTH,
		});
		const far = await visibleStore(seller.profile.id, {
			name: "Lontano",
			...MILAN,
		});

		const p = await createTestProduct(db, seller.profile.id, { name: "Pane" });
		const spNear = await createTestStoreProduct(db, near.id, p.id, {
			stock: 3,
		});
		await createTestStoreProduct(db, far.id, p.id, { stock: 99 });

		const result = await searchProducts({ lat: ROME.lat, lng: ROME.lng });

		expect(result.data[0].storeProductId).toBe(spNear.id);
		expect(result.data[0].stock).toBe(3);
	});

	it("conta gli altri negozi che soddisfano i filtri", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const a = await visibleStore(seller.profile.id, { name: "A", ...ROME });
		const b = await visibleStore(seller.profile.id, { name: "B", ...ROME });
		const c = await visibleStore(seller.profile.id, { name: "C", ...ROME });

		await productIn(seller.profile.id, [a.id, b.id, c.id], { name: "Pane" });
		await productIn(seller.profile.id, [a.id], { name: "Vino" });

		const result = await searchProducts({});
		const byName = new Map(result.data.map((r) => [r.name, r]));

		expect(byName.get("Pane")?.otherStoreCount).toBe(2);
		expect(byName.get("Vino")?.otherStoreCount).toBe(0);
	});

	it("non conta fra gli altri negozi quelli esclusi dal raggio", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const near = await visibleStore(seller.profile.id, {
			name: "Vicino",
			...ROME_NORTH,
		});
		const far = await visibleStore(seller.profile.id, {
			name: "Lontano",
			...MILAN,
		});

		await productIn(seller.profile.id, [near.id, far.id], { name: "Pane" });

		const result = await searchProducts({
			lat: ROME.lat,
			lng: ROME.lng,
			radius: 10,
		});

		expect(result.data[0].otherStoreCount).toBe(0);
	});

	it("scarta i prodotti senza nessun negozio idoneo", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await visibleStore(seller.profile.id, {
			name: "Negozio",
			...ROME,
		});

		await productIn(seller.profile.id, [s.id], { name: "Esaurito", stock: 0 });
		await productIn(seller.profile.id, [s.id], {
			name: "Disponibile",
			stock: 4,
		});

		const result = await searchProducts({});

		expect(result.data.map((r) => r.name)).toEqual(["Disponibile"]);
		expect(result.pagination.total).toBe(1);
	});
});

describe("searchProducts — visibilità del negozio", () => {
	it("esclude i prodotti dei negozi sospesi, cancellati o senza abbonamento", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		const live = await createTestStore(db, seller.profile.id, {
			name: "Attivo",
			...ROME,
		});
		await createTestStoreSubscription(db, live.id, { status: "active" });

		const suspended = await createTestStore(db, seller.profile.id, {
			name: "Sospeso",
			...ROME,
		});
		await createTestStoreSubscription(db, suspended.id, {
			status: "suspended",
		});

		const canceled = await createTestStore(db, seller.profile.id, {
			name: "Cancellato",
			...ROME,
		});
		await createTestStoreSubscription(db, canceled.id, { status: "canceled" });

		const orphan = await createTestStore(db, seller.profile.id, {
			name: "Senza",
			...ROME,
		});

		await productIn(seller.profile.id, [live.id], { name: "Visibile" });
		await productIn(seller.profile.id, [suspended.id], { name: "DaSospeso" });
		await productIn(seller.profile.id, [canceled.id], { name: "DaCancellato" });
		await productIn(seller.profile.id, [orphan.id], { name: "DaOrfano" });

		const result = await searchProducts({});

		expect(result.data.map((r) => r.name)).toEqual(["Visibile"]);
	});

	it("accetta past_due e canceling, che sono ancora abbonamenti vivi", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		const pastDue = await createTestStore(db, seller.profile.id, {
			name: "PastDue",
			...ROME,
		});
		await createTestStoreSubscription(db, pastDue.id, { status: "past_due" });
		const canceling = await createTestStore(db, seller.profile.id, {
			name: "Canceling",
			...ROME,
		});
		await createTestStoreSubscription(db, canceling.id, {
			status: "canceling",
		});

		await productIn(seller.profile.id, [pastDue.id], { name: "Uno" });
		await productIn(seller.profile.id, [canceling.id], { name: "Due" });

		const result = await searchProducts({});

		expect(result.pagination.total).toBe(2);
	});
});

describe("searchProducts — testo, categoria, paginazione", () => {
	it("trova per parola chiave italiana e scarta ciò che non corrisponde", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await visibleStore(seller.profile.id, {
			name: "Negozio",
			...ROME,
		});

		await productIn(seller.profile.id, [s.id], {
			name: "Pizza Napoletana",
			description: "Autentica pizza napoletana con pomodoro e mozzarella",
		});
		await productIn(seller.profile.id, [s.id], {
			name: "Gelato alla Fragola",
			description: "Gelato artigianale alla fragola",
		});

		const result = await searchProducts({ q: "pizza" });

		expect(result.data.map((r) => r.name)).toEqual(["Pizza Napoletana"]);
	});

	it("filtra per categoria foglia e per macro categoria", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await visibleStore(seller.profile.id, {
			name: "Negozio",
			...ROME,
		});

		const macroA = await createTestMacroCategory(db, "Macro A");
		const macroB = await createTestMacroCategory(db, "Macro B");
		const catA1 = await createTestCategory(db, "Cat A1", macroA.id);
		const catA2 = await createTestCategory(db, "Cat A2", macroA.id);
		const catB1 = await createTestCategory(db, "Cat B1", macroB.id);

		const inA1 = await productIn(seller.profile.id, [s.id], { name: "InA1" });
		const inA2 = await productIn(seller.profile.id, [s.id], { name: "InA2" });
		const inB1 = await productIn(seller.profile.id, [s.id], { name: "InB1" });
		await createTestProductCategoryAssignment(db, inA1.id, catA1.id);
		await createTestProductCategoryAssignment(db, inA2.id, catA2.id);
		await createTestProductCategoryAssignment(db, inB1.id, catB1.id);

		const byLeaf = await searchProducts({ categoryId: catA1.id });
		expect(byLeaf.data.map((r) => r.name)).toEqual(["InA1"]);

		const byMacro = await searchProducts({ macroCategoryId: macroA.id });
		expect(byMacro.data.map((r) => r.name).sort()).toEqual(["InA1", "InA2"]);
	});

	it("paginazione: total corrisponde alle righe di tutte le pagine, senza duplicati", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const a = await visibleStore(seller.profile.id, { name: "A", ...ROME });
		const b = await visibleStore(seller.profile.id, { name: "B", ...ROME });

		// Ogni prodotto sta in DUE negozi: se il laterale non limitasse a 1,
		// `total` sarebbe 10 invece di 5 e le pagine ripeterebbero le righe.
		for (let i = 0; i < 5; i++) {
			await productIn(seller.profile.id, [a.id, b.id], {
				name: `Prodotto ${i}`,
			});
		}

		const page1 = await searchProducts({ page: 1, limit: 2 });
		const page2 = await searchProducts({ page: 2, limit: 2 });
		const page3 = await searchProducts({ page: 3, limit: 2 });

		expect(page1.pagination.total).toBe(5);
		const ids = [...page1.data, ...page2.data, ...page3.data].map((r) => r.id);
		expect(ids).toHaveLength(5);
		expect(new Set(ids).size).toBe(5);
	});
});
