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

import { getProductFacets } from "@/modules/customer/services/product-facets";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCategory,
	createTestDiscount,
	createTestDiscountProduct,
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
const ALWAYS_OPEN = Array.from({ length: 7 }, (_, i) => ({
	dayOfWeek: i,
	slots: [{ open: "00:00", close: "23:59" }],
}));

async function visibleStore(
	sellerProfileId: string,
	params: Parameters<typeof createTestStore>[2] = {},
) {
	const db = getTestDb();
	const s = await createTestStore(db, sellerProfileId, { ...ROME, ...params });
	await createTestStoreSubscription(db, s.id, { status: "active" });
	return s;
}

async function productIn(
	sellerProfileId: string,
	storeId: string,
	params: { name: string; price?: string; categoryIds?: string[] },
) {
	const db = getTestDb();
	const p = await createTestProduct(db, sellerProfileId, {
		name: params.name,
		price: params.price ?? "10.00",
	});
	await createTestStoreProduct(db, storeId, p.id, { stock: 5 });
	for (const c of params.categoryIds ?? []) {
		await createTestProductCategoryAssignment(db, p.id, c);
	}
	return p;
}

describe("getProductFacets", () => {
	it("conta prodotti distinti per macro e per categoria, anche quando un prodotto sta in due categorie della stessa macro", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await visibleStore(seller.profile.id, { name: "Negozio" });

		const macro = await createTestMacroCategory(db, "Cibo");
		const pane = await createTestCategory(db, "Pane", macro.id);
		const dolci = await createTestCategory(db, "Dolci", macro.id);

		// Un prodotto in DUE categorie della stessa macro: la macro deve contarlo
		// una volta sola, non sommare i figli.
		await productIn(seller.profile.id, s.id, {
			name: "Panettone",
			categoryIds: [pane.id, dolci.id],
		});
		await productIn(seller.profile.id, s.id, {
			name: "Ciabatta",
			categoryIds: [pane.id],
		});

		const facets = await getProductFacets({});

		const cibo = facets.macros.find((m) => m.name === "Cibo");
		expect(cibo?.productCount).toBe(2);
		const byName = new Map(
			cibo?.categories.map((c) => [c.name, c.productCount]),
		);
		expect(byName.get("Pane")).toBe(2);
		expect(byName.get("Dolci")).toBe(1);
	});

	it("non applica la categoria già selezionata: il rail deve mostrare le alternative", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await visibleStore(seller.profile.id, { name: "Negozio" });

		const macroA = await createTestMacroCategory(db, "Macro A");
		const macroB = await createTestMacroCategory(db, "Macro B");
		const catA = await createTestCategory(db, "Cat A", macroA.id);
		const catB = await createTestCategory(db, "Cat B", macroB.id);

		await productIn(seller.profile.id, s.id, {
			name: "InA",
			categoryIds: [catA.id],
		});
		await productIn(seller.profile.id, s.id, {
			name: "InB",
			categoryIds: [catB.id],
		});

		const facets = await getProductFacets({
			categoryId: catA.id,
			macroCategoryId: macroA.id,
		} as any);

		expect(facets.macros.map((m) => m.name).sort()).toEqual([
			"Macro A",
			"Macro B",
		]);
		expect(facets.total).toBe(2);
	});

	it("omette le macro a zero", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await visibleStore(seller.profile.id, { name: "Negozio" });

		const used = await createTestMacroCategory(db, "Usata");
		const unused = await createTestMacroCategory(db, "Vuota");
		const cat = await createTestCategory(db, "Cat", used.id);
		await createTestCategory(db, "CatVuota", unused.id);

		await productIn(seller.profile.id, s.id, {
			name: "Uno",
			categoryIds: [cat.id],
		});

		const facets = await getProductFacets({});

		expect(facets.macros.map((m) => m.name)).toEqual(["Usata"]);
	});

	it("conta solo i prodotti dei negozi visibili", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const visible = await visibleStore(seller.profile.id, { name: "Visibile" });
		const hidden = await createTestStore(db, seller.profile.id, {
			name: "Nascosto",
			...ROME,
		});
		await createTestStoreSubscription(db, hidden.id, { status: "suspended" });

		const macro = await createTestMacroCategory(db, "Macro");
		const cat = await createTestCategory(db, "Cat", macro.id);

		await productIn(seller.profile.id, visible.id, {
			name: "Buono",
			categoryIds: [cat.id],
		});
		await productIn(seller.profile.id, hidden.id, {
			name: "Nascosto",
			categoryIds: [cat.id],
		});

		const facets = await getProductFacets({});

		expect(facets.total).toBe(1);
		expect(facets.macros[0].productCount).toBe(1);
	});

	it("onSaleTotal e openNowTotal dicono quanti prodotti restano se accendo quel filtro", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const open = await visibleStore(seller.profile.id, {
			name: "Aperto",
			openingHours: ALWAYS_OPEN,
		});
		const closed = await visibleStore(seller.profile.id, { name: "Chiuso" });

		const discounted = await productIn(seller.profile.id, open.id, {
			name: "Scontato",
		});
		const d = await createTestDiscount(db, seller.profile.id, { percent: 25 });
		await createTestDiscountProduct(db, d.id, discounted.id);

		await productIn(seller.profile.id, open.id, { name: "PienoAperto" });
		await productIn(seller.profile.id, closed.id, { name: "PienoChiuso" });

		const off = await getProductFacets({});
		expect(off.total).toBe(3);
		expect(off.onSaleTotal).toBe(1);
		expect(off.openNowTotal).toBe(2);

		// A filtro già acceso il proprio totale coincide con `total`.
		const on = await getProductFacets({ onSale: true });
		expect(on.total).toBe(1);
		expect(on.onSaleTotal).toBe(1);
	});
});
