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

import { eq } from "drizzle-orm";
import { product } from "@/db/schemas/product";
import { store } from "@/db/schemas/store";
import { searchProducts } from "@/modules/customer/services/product-search";
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

	it("esclude interamente un prodotto il cui unico negozio idoneo è fuori dal raggio", async () => {
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

		await productIn(seller.profile.id, [near.id], { name: "Locale" });
		await productIn(seller.profile.id, [far.id], { name: "SoloLontano" });

		const result = await searchProducts({
			lat: ROME.lat,
			lng: ROME.lng,
			radius: 10,
		});

		expect(result.data.map((r) => r.name)).toEqual(["Locale"]);
		expect(result.pagination.total).toBe(1);
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

describe("searchProducts — ordinamento", () => {
	it("con prodotti diversi in negozi diversi, ordina per distanza dall'origine (più vicino prima)", async () => {
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

		// Ogni prodotto sta in UN solo negozio: qui si ordina fra prodotti
		// diversi, non fra negozi dello stesso prodotto (già coperto sopra).
		// Creato PRIMA il vicino e DOPO il lontano: se l'ordinamento cadesse
		// sul fallback per data di creazione invece che sulla distanza, il
		// lontano (più recente) finirebbe comunque per primo, e l'assert
		// sotto lo scoprirebbe.
		await productIn(seller.profile.id, [near.id], { name: "ProdottoVicino" });
		await productIn(seller.profile.id, [far.id], { name: "ProdottoLontano" });

		const result = await searchProducts({ lat: ROME.lat, lng: ROME.lng });

		expect(result.data.map((r) => r.name)).toEqual([
			"ProdottoVicino",
			"ProdottoLontano",
		]);
	});

	it("senza query né origine, ordina per data di creazione decrescente", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await visibleStore(seller.profile.id, {
			name: "Negozio",
			...ROME,
		});

		const p1 = await productIn(seller.profile.id, [s.id], { name: "Uno" });
		const p2 = await productIn(seller.profile.id, [s.id], { name: "Due" });
		const p3 = await productIn(seller.profile.id, [s.id], { name: "Tre" });

		// Senza query né origine, rank e distance sono costanti per tutte le
		// righe: l'ordine deve venire dal tiebreaker, non dall'inserimento.
		// createdAt esplicito, non quello di default all'inserimento.
		await db
			.update(product)
			.set({ createdAt: new Date("2025-01-01T00:00:00Z") })
			.where(eq(product.id, p1.id));
		await db
			.update(product)
			.set({ createdAt: new Date("2025-03-01T00:00:00Z") })
			.where(eq(product.id, p2.id));
		await db
			.update(product)
			.set({ createdAt: new Date("2025-02-01T00:00:00Z") })
			.where(eq(product.id, p3.id));

		const result = await searchProducts({});

		expect(result.data.map((r) => r.id)).toEqual([p2.id, p3.id, p1.id]);
	});

	it("a parità di data di creazione, il tiebreaker finale è l'id in ordine crescente", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await visibleStore(seller.profile.id, {
			name: "Negozio",
			...ROME,
		});

		const pA = await productIn(seller.profile.id, [s.id], { name: "A" });
		const pB = await productIn(seller.profile.id, [s.id], { name: "B" });
		const sameCreatedAt = new Date("2025-01-01T00:00:00Z");
		await db
			.update(product)
			.set({ createdAt: sameCreatedAt })
			.where(eq(product.id, pA.id));
		await db
			.update(product)
			.set({ createdAt: sameCreatedAt })
			.where(eq(product.id, pB.id));

		const result = await searchProducts({});

		// L'ordine atteso è quello degli id, non quello di creazione dei
		// fixture: se il tiebreaker sparisse, l'ordine diventerebbe instabile
		// fra run diverse invece di seguire sempre l'id.
		const expectedOrder = [pA.id, pB.id].sort();
		expect(result.data.map((r) => r.id)).toEqual(expectedOrder);
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

	it("esclude i prodotti di un negozio soft-deleted, anche con abbonamento attivo", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		// Abbonamento attivo su entrambi: isola l'effetto di `deletedAt`, non
		// quello (già coperto sopra) dell'abbonamento.
		const active = await visibleStore(seller.profile.id, {
			name: "Attivo",
			...ROME,
		});
		const deleted = await visibleStore(seller.profile.id, {
			name: "Cancellato",
			...ROME,
		});
		await db
			.update(store)
			.set({ deletedAt: new Date() })
			.where(eq(store.id, deleted.id));

		await productIn(seller.profile.id, [active.id], { name: "Visibile" });
		await productIn(seller.profile.id, [deleted.id], { name: "Nascosto" });

		const result = await searchProducts({});

		expect(result.data.map((r) => r.name)).toEqual(["Visibile"]);
		expect(result.pagination.total).toBe(1);
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

/** Sette giorni su sette, 00:00–23:59: aperto sempre, senza dipendere dall'orologio. */
const ALWAYS_OPEN = Array.from({ length: 7 }, (_, i) => ({
	dayOfWeek: i,
	slots: [{ open: "00:00", close: "23:59" }],
}));

describe("searchProducts — filtro offerta e prezzo", () => {
	it("onSale tiene solo i prodotti con uno sconto attivo adesso", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await visibleStore(seller.profile.id, {
			name: "Negozio",
			...ROME,
		});

		const discounted = await productIn(seller.profile.id, [s.id], {
			name: "Scontato",
			price: "100.00",
		});
		const expiredOne = await productIn(seller.profile.id, [s.id], {
			name: "ScontoScaduto",
			price: "100.00",
		});
		await productIn(seller.profile.id, [s.id], {
			name: "Pieno",
			price: "100.00",
		});

		const live = await createTestDiscount(db, seller.profile.id, {
			percent: 30,
		});
		await createTestDiscountProduct(db, live.id, discounted.id);
		const old = await createTestDiscount(db, seller.profile.id, {
			percent: 30,
			startsAt: new Date(Date.now() - 7 * 86_400_000),
			endsAt: new Date(Date.now() - 86_400_000),
		});
		await createTestDiscountProduct(db, old.id, expiredOne.id);

		const result = await searchProducts({ onSale: true });

		expect(result.data.map((r) => r.name)).toEqual(["Scontato"]);
		expect(result.pagination.total).toBe(1);
		expect(result.data[0].discountPercent).toBe(30);
		expect(result.data[0].discountedPrice).toBe("70.00");
	});

	it("il prezzo filtra su quello che si paga, non sul listino", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await visibleStore(seller.profile.id, {
			name: "Negozio",
			...ROME,
		});

		// 100 € scontato al 50% → 50 €: dentro `maxPrice: 60`.
		const cheapAfterDiscount = await productIn(seller.profile.id, [s.id], {
			name: "CentoScontato",
			price: "100.00",
		});
		const half = await createTestDiscount(db, seller.profile.id, {
			percent: 50,
		});
		await createTestDiscountProduct(db, half.id, cheapAfterDiscount.id);

		// 100 € pieni: fuori.
		await productIn(seller.profile.id, [s.id], {
			name: "CentoPieno",
			price: "100.00",
		});
		// 20 € pieni: dentro.
		await productIn(seller.profile.id, [s.id], {
			name: "Venti",
			price: "20.00",
		});

		const capped = await searchProducts({ maxPrice: 60 });
		expect(capped.data.map((r) => r.name).sort()).toEqual([
			"CentoScontato",
			"Venti",
		]);
		expect(capped.pagination.total).toBe(2);

		const floored = await searchProducts({ minPrice: 30 });
		expect(floored.data.map((r) => r.name).sort()).toEqual([
			"CentoPieno",
			"CentoScontato",
		]);

		const band = await searchProducts({ minPrice: 30, maxPrice: 60 });
		expect(band.data.map((r) => r.name)).toEqual(["CentoScontato"]);
	});
});

describe("searchProducts — filtro aperti ora", () => {
	it("esclude i prodotti il cui unico negozio è chiuso", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const open = await visibleStore(seller.profile.id, {
			name: "Aperto",
			...ROME,
			openingHours: ALWAYS_OPEN,
		});
		// Senza openingHours il negozio è sempre chiuso.
		const closed = await visibleStore(seller.profile.id, {
			name: "Chiuso",
			...ROME,
		});

		await productIn(seller.profile.id, [open.id], { name: "DaAperto" });
		await productIn(seller.profile.id, [closed.id], { name: "DaChiuso" });

		const result = await searchProducts({ openNow: true });

		expect(result.data.map((r) => r.name)).toEqual(["DaAperto"]);
		expect(result.pagination.total).toBe(1);
	});

	it("restringe l'aggancio: se il più vicino è chiuso, aggancia il più vicino APERTO", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		// Il più vicino all'origine, ma chiuso.
		const nearClosed = await visibleStore(seller.profile.id, {
			name: "VicinoChiuso",
			...ROME_NORTH,
		});
		// Più lontano, ma aperto.
		const farOpen = await visibleStore(seller.profile.id, {
			name: "LontanoAperto",
			...MILAN,
			openingHours: ALWAYS_OPEN,
		});

		await productIn(seller.profile.id, [nearClosed.id, farOpen.id], {
			name: "Pane",
		});

		const plain = await searchProducts({ lat: ROME.lat, lng: ROME.lng });
		expect(plain.data[0].store.name).toBe("VicinoChiuso");

		const onlyOpen = await searchProducts({
			lat: ROME.lat,
			lng: ROME.lng,
			openNow: true,
		});
		expect(onlyOpen.data[0].store.name).toBe("LontanoAperto");
		// E il conteggio segue il filtro: il negozio chiuso non è "un altro negozio".
		expect(onlyOpen.data[0].otherStoreCount).toBe(0);
	});
});
