# Ricerca prodotti nell'app customer — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare all'app customer una pagina `/products` che risponde a "chi ha
questa cosa vicino a me?", dove ogni risultato è un prodotto agganciato al
negozio più vicino che ce l'ha e comprabile da lì.

**Architecture:** Una `JOIN LATERAL ... LIMIT 1` sceglie, per ogni prodotto,
l'unico negozio da mostrare fra quelli che soddisfano i filtri, e con
`count(*) OVER ()` conta gli altri nella stessa passata. Il laterale si
costruisce col query builder di Drizzle, così le sue condizioni finiscono in un
`.where()` dove le `Column` vengono qualificate e i predicati condivisi
(`publiclyVisibleStore()`, `openNowCondition()`) si riusano senza modifiche. Il
frontend ricalca la shell di `/stores`, estraendo in tre pezzi condivisi la
logica che altrimenti esisterebbe in due copie.

**Tech Stack:** Bun, Elysia + TypeBox, Drizzle 0.45.3 su PostGIS, Eden Treaty,
TanStack Start/Router/Query, Tailwind v4 + shadcn/ui, paraglide, Biome,
`bun:test` su testcontainers.

**Spec:** `docs/superpowers/specs/2026-09-21-customer-product-search-design.md`

## Global Constraints

- **Branch:** `feat/customer-product-search`. Mai commit diretti su `main`.
- **Due PR:** i task 1–7 sono la PR 1 (API), i task 8–14 la PR 2 (frontend).
  Non aprire la PR 2 prima che la 1 sia mergiata.
- **Commit:** Conventional Commits con scope del repository (`feat(api)`,
  `feat(customer)`, `test(api)`, `refactor(customer)`, `docs`). Ogni commit
  finisce con `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Copy in italiano.** Badge di stato al singolare, tab e filtri al plurale.
- **Niente post-filtro in JS su una query paginata:** ogni filtro sta nel
  `WHERE`, o `total` e paginazione mentono.
- **`ServiceError` prende due argomenti** `(status, message)`. Mai un terzo.
- **Nei campi della `SELECT`** le `Column` interpolate di Drizzle si
  renderizzano **senza qualificazione**: lì i riferimenti alla tabella esterna
  si scrivono alla lettera (`products.id`, `stores.location`). Dentro un
  `.where()` Drizzle qualifica, e le `Column` si usano normalmente.
- **`limit` massimo dell'API: 100.**
- **Tile prodotto non cliccabile:** non esiste una pagina di dettaglio
  prodotto. L'unico link del tile è il nome del negozio.
- **Ogni nuova rotta TanStack** richiede di committare anche
  `apps/customer/src/routeTree.gen.ts`, rigenerato da `bun run dev`/`build`, non
  da `tsc`.
- **Chiavi paraglide in entrambi** `apps/customer/messages/it.json` e
  `apps/customer/messages/en.json`, altrimenti il build fallisce.
- **Typecheck per workspace**, non aggregato: `bun run --filter '*'` può
  nascondere un fallimento singolo.

---

## Struttura dei file

**API — creati**

| File | Responsabilità |
|---|---|
| `apps/api/src/modules/customer/services/product-search-conditions.ts` | Le condizioni `WHERE` condivise fra ricerca e facet: quelle sul prodotto (testo, categoria, prezzo, offerta) e quelle sul negozio agganciato (stock, visibilità, raggio, aperto). |
| `apps/api/src/modules/customer/services/product-search.ts` | `searchProducts()`: il laterale, la regola di aggancio, l'ordinamento, la paginazione. |
| `apps/api/src/modules/customer/services/product-facets.ts` | `getProductFacets()`: conteggi per macro e categoria su prodotti distinti. |
| `apps/api/src/modules/customer/routes/products.ts` | `GET /customer/products` e `GET /customer/products/facets`. |
| `apps/api/tests/integration/customer-products-search.test.ts` | Aggancio, visibilità, filtri, ordinamento, paginazione. |
| `apps/api/tests/integration/customer-products-facets.test.ts` | Conteggi dei facet. |
| `apps/api/tests/integration/discount-pricing-parity.test.ts` | Parità fra il frammento SQL dello sconto e il batch esistente. |

**API — eliminati**

`services/search.ts`, `routes/search.ts`, `tests/integration/customer-search.test.ts`,
`tests/integration/customer-search-soft-deleted.test.ts` (i loro casi rivivono nei nuovi file).

**API — modificati**

`lib/queries.ts` (`ProductSearchQuery` esteso), `lib/schemas/entities.ts`
(`ProductCardSchema` sostituisce `SearchResultSchema`), `lib/schemas/index.ts`,
`modules/customer/index.ts` (registrazione), `modules/seller/services/discount-pricing.ts`
(frammento SQL condiviso).

**Frontend — creati**

| File | Responsabilità |
|---|---|
| `apps/customer/src/features/search/search-field.tsx` | Il campo di ricerca, condiviso da `/products` e `/stores`. |
| `apps/customer/src/features/search/use-search-text-param.ts` | Debounce testo → URL e risincronizzazione inversa. |
| `apps/customer/src/features/search/search-tabs.tsx` | Il pivot Prodotti ⇄ Negozi. |
| `apps/customer/src/features/location/use-near-param.ts` | I due effetti con memoria che tengono allineati `near` e origine. |
| `apps/customer/src/features/catalog/use-product-search.ts` | Query infinita sui prodotti. |
| `apps/customer/src/features/catalog/use-product-facets.ts` | Conteggi del rail. |
| `apps/customer/src/features/catalog/product-filters.tsx` | Il rail: categoria, distanza, prezzo, offerta, aperti ora. |
| `apps/customer/src/routes/_authenticated/products/index.tsx` | La pagina. |

**Frontend — modificati**

`features/catalog/product-tile.tsx` (riga negozio, `otherStoreCount`),
`features/discovery/use-nearby-products.ts` (nuovo endpoint, `radius` esplicito),
`features/discovery/nearby-products.tsx` (riga negozio),
`routes/_authenticated/stores/index.tsx` (usa i tre pezzi estratti + il pivot),
`components/site-header.tsx` (voce di nav), `messages/{it,en}.json`,
`routeTree.gen.ts`.

---

# PR 1 — API

### Task 1: Il frammento SQL dello sconto attivo

Serve a `onSale`, `minPrice` e `maxPrice`, che devono filtrare nel `WHERE`. Il
rischio è avere due definizioni divergenti di "sconto attivo", quindi il
frammento nasce accanto a quella esistente e un test le confronta.

**Files:**
- Modify: `apps/api/src/modules/seller/services/discount-pricing.ts`
- Test: `apps/api/tests/integration/discount-pricing-parity.test.ts`

**Interfaces:**
- Consumes: niente.
- Produces:
  - `bestActiveDiscountPercent(productRef?: SQL): SQL` — subquery scalare che
    restituisce `integer` o `NULL`. `productRef` default `sql\`products.id\``.
  - `effectivePriceExpr(priceRef?: SQL, productRef?: SQL): SQL` — `numeric(10,2)`.

- [ ] **Step 1: Scrivi il test di parità**

```ts
// apps/api/tests/integration/discount-pricing-parity.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

import { getTestDb, setupTestContainer, teardownTestContainer } from "../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

import { sql } from "drizzle-orm";
import { product } from "@/db/schemas/product";
import {
	bestActiveDiscountPercent,
	getBestActiveDiscounts,
} from "@/modules/seller/services/discount-pricing";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestDiscount,
	createTestDiscountProduct,
	createTestProduct,
	createTestSeller,
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

describe("bestActiveDiscountPercent — parità con getBestActiveDiscounts", () => {
	it("concorda su sconti attivi, scaduti, futuri, sospesi e sovrapposti", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const sp = seller.profile.id;

		// Nessuno sconto.
		const plain = await createTestProduct(db, sp, { name: "Senza", price: "100.00" });

		// Uno sconto attivo al 20%.
		const single = await createTestProduct(db, sp, { name: "Singolo", price: "100.00" });
		const d20 = await createTestDiscount(db, sp, { percent: 20 });
		await createTestDiscountProduct(db, d20.id, single.id);

		// Due sconti attivi: vince il più alto.
		const doubled = await createTestProduct(db, sp, { name: "Doppio", price: "100.00" });
		const d35 = await createTestDiscount(db, sp, { percent: 35 });
		await createTestDiscountProduct(db, d20.id, doubled.id);
		await createTestDiscountProduct(db, d35.id, doubled.id);

		// Scaduto.
		const expired = await createTestProduct(db, sp, { name: "Scaduto", price: "100.00" });
		const dOld = await createTestDiscount(db, sp, {
			percent: 50,
			startsAt: new Date(Date.now() - 7 * 86_400_000),
			endsAt: new Date(Date.now() - 86_400_000),
		});
		await createTestDiscountProduct(db, dOld.id, expired.id);

		// Non ancora iniziato.
		const future = await createTestProduct(db, sp, { name: "Futuro", price: "100.00" });
		const dNew = await createTestDiscount(db, sp, {
			percent: 50,
			startsAt: new Date(Date.now() + 86_400_000),
			endsAt: null,
		});
		await createTestDiscountProduct(db, dNew.id, future.id);

		// Sconto non attivo. `discountStatuses` = active | paused | archived.
		const paused = await createTestProduct(db, sp, { name: "Sospeso", price: "100.00" });
		const dPaused = await createTestDiscount(db, sp, { percent: 50, status: "paused" });
		await createTestDiscountProduct(db, dPaused.id, paused.id);

		const ids = [plain.id, single.id, doubled.id, expired.id, future.id, paused.id];

		// Strada A: il frammento SQL, letto come colonna.
		const rows = await db
			.select({
				id: product.id,
				percent: sql<number | null>`${bestActiveDiscountPercent()}`.as("percent"),
			})
			.from(product);
		const fromSql = new Map(rows.map((r) => [r.id, r.percent]));

		// Strada B: il batch esistente.
		const fromBatch = await getBestActiveDiscounts(ids, db as any);

		for (const id of ids) {
			expect(fromSql.get(id) ?? null).toBe(fromBatch.get(id)?.percent ?? null);
		}
		expect(fromSql.get(doubled.id)).toBe(35);
		expect(fromSql.get(plain.id)).toBeNull();
	});
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

```bash
cd apps/api && bun test tests/integration/discount-pricing-parity.test.ts
```

Atteso: FAIL con `bestActiveDiscountPercent is not a function` (import non
risolto).

- [ ] **Step 3: Aggiungi il frammento**

In fondo a `apps/api/src/modules/seller/services/discount-pricing.ts`:

```ts
/**
 * Percentuale del miglior sconto attivo sul prodotto correlato, o NULL.
 *
 * Gemello SQL di `getBestActiveDiscounts()`, per i casi in cui lo sconto deve
 * entrare in un `WHERE` invece di annotare righe già estratte: filtrare dopo
 * la query darebbe un `total` e una paginazione che non corrispondono ai
 * risultati. `tests/integration/discount-pricing-parity.test.ts` tiene le due
 * strade allineate.
 *
 * `productRef` è il riferimento **letterale** alla colonna del prodotto nella
 * query esterna: in posizione di campo-SELECT Drizzle renderizza le Column
 * interpolate senza qualificarle, e `id` verrebbe risolto sulla tabella
 * sbagliata.
 */
export function bestActiveDiscountPercent(productRef = sql`products.id`) {
	return sql`(
		SELECT max(d.percent)
		FROM discount_products dp
		JOIN discounts d ON d.id = dp.discount_id
		JOIN products pp ON pp.id = dp.product_id
		WHERE dp.product_id = ${productRef}
			AND d.seller_profile_id = pp.seller_profile_id
			AND d.status = 'active'
			AND d.starts_at <= now()
			AND (d.ends_at IS NULL OR d.ends_at >= now())
	)`;
}

/** Prezzo effettivo: listino meno il miglior sconto attivo, arrotondato ai centesimi. */
export function effectivePriceExpr(
	priceRef = sql`products.price`,
	productRef = sql`products.id`,
) {
	return sql`ROUND(${priceRef} * (1 - coalesce(${bestActiveDiscountPercent(productRef)}, 0)::numeric / 100), 2)`;
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

```bash
cd apps/api && bun test tests/integration/discount-pricing-parity.test.ts
```

Atteso: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/seller/services/discount-pricing.ts \
        apps/api/tests/integration/discount-pricing-parity.test.ts
git commit -m "$(cat <<'MSG'
feat(api): frammento SQL del miglior sconto attivo

Gemello di getBestActiveDiscounts() utilizzabile dentro un WHERE, con test
di parita' fra le due strade.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: Verifica del laterale e condizioni condivise

Nessun'altra query del repository usa `innerJoinLateral`. Prima di costruirci
sopra, si guarda l'SQL che Drizzle genera e si conferma che dentro il laterale
le colonne vengano **qualificate** — è l'ipotesi su cui poggia il riuso di
`publiclyVisibleStore()` e `openNowCondition()` senza modificarli.

**Files:**
- Create: `apps/api/src/modules/customer/services/product-search-conditions.ts`
- Temp: `/tmp/claude-501/.../scratchpad/inspect-lateral.ts` (usa e getta, non si committa)

**Interfaces:**
- Consumes: niente. (Il frammento del Task 1 entra nel Task 4, insieme ai
  filtri che lo usano.)
- Produces:
  - `interface ProductFilterParams { q?, categoryId?, macroCategoryId?, lat?, lng?, radius?, openNow?, onSale?, minPrice?, maxPrice? }` — i campi
    `openNow`, `onSale`, `minPrice`, `maxPrice` sono dichiarati qui ma **non
    ancora applicati**: li implementa il Task 4.
  - `productConditions(p: ProductFilterParams): SQL[]` — condizioni sul `WHERE` esterno (prodotto).
  - `offerConditions(p: ProductFilterParams, openCondition: SQL | null): SQL[]` — condizioni dentro il laterale (negozio agganciato).
  - `distanceExpr(lat?: number, lng?: number): SQL` — `ST_Distance` o `NULL::double precision`.

- [ ] **Step 1: Scrivi lo script di ispezione**

```ts
// nello scratchpad di sessione, non nel repository
import { eq, sql } from "drizzle-orm";
import { db } from "../apps/api/src/db";
import { municipality, province } from "../apps/api/src/db/schemas/location";
import { storeProduct } from "../apps/api/src/db/schemas/product";
import { store } from "../apps/api/src/db/schemas/store";
import { publiclyVisibleStore } from "../apps/api/src/lib/store-visibility";
import { openNowCondition } from "../apps/api/src/lib/store-open-status";

const offer = db
	.select({
		storeProductId: storeProduct.id,
		storeId: store.id,
		acronym: province.acronym,
		distance: sql<number>`ST_Distance(stores.location::geography, ST_SetSRID(ST_MakePoint(12.4964, 41.9028), 4326)::geography)`.as("distance"),
		matchCount: sql<number>`count(*) OVER ()`.as("match_count"),
	})
	.from(storeProduct)
	.innerJoin(store, eq(store.id, storeProduct.storeId))
	.innerJoin(municipality, eq(municipality.id, store.municipalityId))
	.innerJoin(province, eq(province.id, municipality.provinceId))
	.where(
		sql.join(
			[
				sql`${storeProduct.productId} = products.id`,
				sql`${storeProduct.stock} > 0`,
				publiclyVisibleStore(),
				await openNowCondition(new Date()),
			],
			sql` AND `,
		),
	)
	.orderBy(sql`distance ASC NULLS LAST, ${store.name} ASC, ${store.id} ASC`)
	.limit(1)
	.as("offer");

const { product } = await import("../apps/api/src/db/schemas/product");
const q = db.select({ id: product.id, sp: offer.storeProductId }).from(product).innerJoinLateral(offer, sql`true`);
console.log(q.toSQL().sql);
```

- [ ] **Step 2: Esegui e leggi l'SQL**

```bash
cd apps/api && bun run <percorso-dello-script>
```

Verifica tre cose nell'output, **una per una**:

1. compare `join lateral (select ...) "offer" on true`;
2. dentro il laterale, `publiclyVisibleStore()` ha reso `"stores"."deleted_at"`
   e `"stores"."id"` **qualificati** — non `"deleted_at"` e `"id"` nudi;
3. `openNowCondition()` ha reso `"stores"."opening_hours"` e `"stores"."closures"`.

Se i punti 2 o 3 mostrano colonne nude, **fermati e segnalalo**: l'assunzione
della spec è caduta e le condizioni vanno scritte con i prefissi espliciti,
cosa che duplicherebbe `openNowCondition` e va decisa con l'umano, non aggirata.

- [ ] **Step 3: Scrivi le condizioni condivise**

```ts
// apps/api/src/modules/customer/services/product-search-conditions.ts
import { sql } from "drizzle-orm";
import { product, productCategoryAssignment, storeProduct } from "@/db/schemas/product";
import { productCategory } from "@/db/schemas/category";
import { store } from "@/db/schemas/store";
import { publiclyVisibleStore } from "@/lib/store-visibility";

export interface ProductFilterParams {
	q?: string;
	categoryId?: string;
	macroCategoryId?: string;
	lat?: number;
	lng?: number;
	/** Raggio in km. Applicato solo se ci sono anche lat/lng. */
	radius?: number;
	openNow?: boolean;
	onSale?: boolean;
	minPrice?: number;
	maxPrice?: number;
}

/** Il vettore full-text pesato: nome in A, descrizione in B. Deve restare identico all'indice GIN `product_search_idx`, o l'indice non viene usato. */
export function searchVector() {
	return sql`(
		setweight(to_tsvector('italian', ${product.name}), 'A') ||
		setweight(to_tsvector('italian', coalesce(${product.description}, '')), 'B')
	)`;
}

/** Distanza in metri dall'origine, o NULL quando non c'è un'origine. Riferimento letterale a `stores.location`: è un campo della SELECT. */
export function distanceExpr(lat?: number, lng?: number) {
	if (lat === undefined || lng === undefined) return sql`NULL::double precision`;
	return sql`ST_Distance(
		stores.location::geography,
		ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
	)`;
}

/**
 * Condizioni sul prodotto, per il `WHERE` esterno. Ricerca e facet rispondono
 * alla stessa domanda, quindi una copia sola.
 */
export function productConditions(p: ProductFilterParams): ReturnType<typeof sql>[] {
	const conditions = [sql`${product.status} = 'active'`];

	if (p.q) {
		conditions.push(sql`${searchVector()} @@ websearch_to_tsquery('italian', ${p.q})`);
	}

	// `categoryId` vince su `macroCategoryId`: la foglia sta già dentro la sua
	// macro, applicarli entrambi restringerebbe allo stesso insieme.
	if (p.categoryId) {
		conditions.push(sql`EXISTS (
			SELECT 1 FROM ${productCategoryAssignment} pca
			WHERE pca.product_id = products.id
				AND pca.product_category_id = ${p.categoryId}
		)`);
	} else if (p.macroCategoryId) {
		conditions.push(sql`EXISTS (
			SELECT 1 FROM ${productCategoryAssignment} pca
			JOIN ${productCategory} pc ON pc.id = pca.product_category_id
			WHERE pca.product_id = products.id
				AND pc.macro_category_id = ${p.macroCategoryId}
		)`);
	}

	// `onSale`, `minPrice` e `maxPrice`: Task 4.

	return conditions;
}

/**
 * Condizioni dentro il laterale: quali negozi possono essere agganciati a un
 * prodotto. Finiscono in un `.where()` vero, quindi le Column si qualificano e
 * i predicati condivisi si riusano tali e quali.
 *
 * `openCondition` arriva dal chiamante invece di essere costruito qui, perché
 * `openNowCondition()` è asincrona (legge le festività attive) e i facet hanno
 * bisogno di comporla in due modi diversi nella stessa richiesta.
 */
export function offerConditions(
	p: ProductFilterParams,
	openCondition: ReturnType<typeof sql> | null,
): ReturnType<typeof sql>[] {
	const conditions = [
		sql`${storeProduct.productId} = products.id`,
		sql`${storeProduct.stock} > 0`,
		publiclyVisibleStore(),
	];

	if (p.lat !== undefined && p.lng !== undefined && p.radius !== undefined) {
		conditions.push(sql`ST_DWithin(
			${store.location}::geography,
			ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography,
			${p.radius * 1000}
		)`);
	}
	if (openCondition) conditions.push(openCondition);

	return conditions;
}
```

- [ ] **Step 4: Verifica che compili**

```bash
cd apps/api && bun run typecheck
```

Atteso: nessun errore. (Il file non ha ancora consumatori: `noUnusedLocals` non
si applica agli export.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/customer/services/product-search-conditions.ts
git commit -m "$(cat <<'MSG'
feat(api): condizioni condivise della ricerca prodotti

Predicati sul prodotto e sul negozio agganciato in un posto solo, come per
i negozi: ricerca e facet rispondono alla stessa domanda.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: `searchProducts` — il laterale e la regola di aggancio

Il cuore. Un risultato = un prodotto più il negozio più vicino che ce l'ha.
`onSale`, `minPrice`, `maxPrice` e `openNow` arrivano nel Task 4: qui il
servizio li ignora.

**Files:**
- Create: `apps/api/src/modules/customer/services/product-search.ts`
- Test: `apps/api/tests/integration/customer-products-search.test.ts`

**Interfaces:**
- Consumes: `productConditions`, `offerConditions`, `distanceExpr`,
  `searchVector` (Task 2); `getBestActiveDiscounts` da
  `@/modules/seller/services/discount-pricing`.
- Produces:
  - `interface ProductSearchParams extends ProductFilterParams { page?: number; limit?: number }` — `openNow`, `onSale`, `minPrice` e `maxPrice` sono accettati ma ignorati fino al Task 4.
  - `interface ProductCard { id, name, description, price, storeProductId, stock, store: { id, name, municipality: { id, name, provinceAcronym } }, distance, otherStoreCount, rank, images, discountedPrice, discountPercent }`
  - `searchProducts(params: ProductSearchParams): Promise<{ data: ProductCard[]; pagination: { page: number; limit: number; total: number } }>`

- [ ] **Step 1: Scrivi i test dell'aggancio e della visibilità**

```ts
// apps/api/tests/integration/customer-products-search.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

import { getTestDb, setupTestContainer, teardownTestContainer } from "../helpers/test-db";

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
	params: { name: string; description?: string; price?: string; stock?: number } ,
) {
	const db = getTestDb();
	const p = await createTestProduct(db, sellerProfileId, {
		name: params.name,
		description: params.description,
		price: params.price ?? "10.00",
	});
	for (const storeId of storeIds) {
		await createTestStoreProduct(db, storeId, p.id, { stock: params.stock ?? 5 });
	}
	return p;
}

describe("searchProducts — regola di aggancio", () => {
	it("aggancia il negozio più vicino all'origine", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const near = await visibleStore(seller.profile.id, { name: "Vicino", ...ROME_NORTH });
		const far = await visibleStore(seller.profile.id, { name: "Lontano", ...MILAN });

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
		const zeta = await visibleStore(seller.profile.id, { name: "Zeta", ...MILAN });
		const alfa = await visibleStore(seller.profile.id, { name: "Alfa", ...ROME });

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
		const near = await visibleStore(seller.profile.id, { name: "Vicino", ...ROME_NORTH });
		const far = await visibleStore(seller.profile.id, { name: "Lontano", ...MILAN });

		const p = await createTestProduct(db, seller.profile.id, { name: "Pane" });
		const spNear = await createTestStoreProduct(db, near.id, p.id, { stock: 3 });
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
		const near = await visibleStore(seller.profile.id, { name: "Vicino", ...ROME_NORTH });
		const far = await visibleStore(seller.profile.id, { name: "Lontano", ...MILAN });

		await productIn(seller.profile.id, [near.id, far.id], { name: "Pane" });

		const result = await searchProducts({ lat: ROME.lat, lng: ROME.lng, radius: 10 });

		expect(result.data[0].otherStoreCount).toBe(0);
	});

	it("scarta i prodotti senza nessun negozio idoneo", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await visibleStore(seller.profile.id, { name: "Negozio", ...ROME });

		await productIn(seller.profile.id, [s.id], { name: "Esaurito", stock: 0 });
		await productIn(seller.profile.id, [s.id], { name: "Disponibile", stock: 4 });

		const result = await searchProducts({});

		expect(result.data.map((r) => r.name)).toEqual(["Disponibile"]);
		expect(result.pagination.total).toBe(1);
	});
});

describe("searchProducts — visibilità del negozio", () => {
	it("esclude i prodotti dei negozi sospesi, cancellati o senza abbonamento", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		const live = await createTestStore(db, seller.profile.id, { name: "Attivo", ...ROME });
		await createTestStoreSubscription(db, live.id, { status: "active" });

		const suspended = await createTestStore(db, seller.profile.id, { name: "Sospeso", ...ROME });
		await createTestStoreSubscription(db, suspended.id, { status: "suspended" });

		const canceled = await createTestStore(db, seller.profile.id, { name: "Cancellato", ...ROME });
		await createTestStoreSubscription(db, canceled.id, { status: "canceled" });

		const orphan = await createTestStore(db, seller.profile.id, { name: "Senza", ...ROME });

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

		const pastDue = await createTestStore(db, seller.profile.id, { name: "PastDue", ...ROME });
		await createTestStoreSubscription(db, pastDue.id, { status: "past_due" });
		const canceling = await createTestStore(db, seller.profile.id, { name: "Canceling", ...ROME });
		await createTestStoreSubscription(db, canceling.id, { status: "canceling" });

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
		const s = await visibleStore(seller.profile.id, { name: "Negozio", ...ROME });

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
		const s = await visibleStore(seller.profile.id, { name: "Negozio", ...ROME });

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
			await productIn(seller.profile.id, [a.id, b.id], { name: `Prodotto ${i}` });
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
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

```bash
cd apps/api && bun test tests/integration/customer-products-search.test.ts
```

Atteso: FAIL — il modulo `@/modules/customer/services/product-search` non esiste.

- [ ] **Step 3: Scrivi il servizio**

```ts
// apps/api/src/modules/customer/services/product-search.ts
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { municipality, province } from "@/db/schemas/location";
import { product, storeProduct } from "@/db/schemas/product";
import { productImage } from "@/db/schemas/product-image";
import { store } from "@/db/schemas/store";
import { parsePagination } from "@/lib/pagination";
import { getBestActiveDiscounts } from "@/modules/seller/services/discount-pricing";
import {
	distanceExpr,
	offerConditions,
	type ProductFilterParams,
	productConditions,
	searchVector,
} from "./product-search-conditions";

export interface ProductSearchParams extends ProductFilterParams {
	page?: number;
	limit?: number;
}

export interface ProductCard {
	id: string;
	name: string;
	description: string | null;
	price: string;
	/** Riga `store_products` del negozio agganciato: è ciò che il carrello vuole. */
	storeProductId: string;
	stock: number;
	store: {
		id: string;
		name: string;
		municipality: { id: string; name: string; provinceAcronym: string };
	};
	/** Metri dall'origine, `null` senza origine. */
	distance: number | null;
	/** Altri negozi che soddisfano i filtri, oltre a quello agganciato. */
	otherStoreCount: number;
	rank: number;
	images: { id: string; url: string; position: number }[];
	discountedPrice: string | null;
	discountPercent: number | null;
}

/**
 * Il laterale sceglie UN negozio per prodotto.
 *
 * Con un'origine vince il più vicino; senza, `distance` è `NULL` per tutte le
 * righe e `ORDER BY distance NULLS LAST, nome` degrada da solo sull'ordine per
 * nome — la regola "senza posizione il primo per nome" non è un ramo, è la
 * stessa clausola.
 *
 * `count(*) OVER ()` conta tutte le righe che passano il `WHERE`: le window si
 * valutano prima di `ORDER BY` e `LIMIT`, quindi il conteggio degli altri
 * negozi non costa una seconda query.
 *
 * Costruito col query builder di proposito: le condizioni finiscono in un
 * `.where()` vero, dove Drizzle qualifica le Column, e `publiclyVisibleStore()`
 * e `openNowCondition()` si riusano senza toccarli.
 */
function buildOffer(
	params: ProductSearchParams,
	openCondition: ReturnType<typeof sql> | null,
) {
	return db
		.select({
			storeProductId: storeProduct.id,
			stock: storeProduct.stock,
			storeId: store.id,
			storeName: store.name,
			municipalityId: municipality.id,
			municipalityName: municipality.name,
			provinceAcronym: province.acronym,
			distance: sql<number | null>`${distanceExpr(params.lat, params.lng)}`.as("distance"),
			matchCount: sql<number>`count(*) OVER ()`.as("match_count"),
		})
		.from(storeProduct)
		.innerJoin(store, eq(store.id, storeProduct.storeId))
		.innerJoin(municipality, eq(municipality.id, store.municipalityId))
		.innerJoin(province, eq(province.id, municipality.provinceId))
		.where(sql.join(offerConditions(params, openCondition), sql` AND `))
		.orderBy(sql`distance ASC NULLS LAST, ${store.name} ASC, ${store.id} ASC`)
		.limit(1)
		.as("offer");
}

export async function searchProducts(params: ProductSearchParams) {
	const { page, limit, offset } = parsePagination(params);

	// `openNow` restringe l'aggancio, non solo l'insieme: lo collega il Task 4.
	const openCondition = null;
	const whereClause = sql.join(productConditions(params), sql` AND `);

	const rankExpr = params.q
		? sql`ts_rank_cd(${searchVector()}, websearch_to_tsquery('italian', ${params.q}))`
		: sql`0`;

	// Rilevanza → distanza → tiebreaker stabile: senza l'ultimo la paginazione
	// non è deterministica quando molte righe pareggiano (es. nessuna query e
	// nessuna origine, dove rank e distance sono costanti).
	// `"offer"."distance"` alla lettera: in ORDER BY `distance` da solo
	// pescherebbe l'alias di output, che qui è la stessa cosa ma non ovunque.
	const orderExpr = params.q
		? sql`rank DESC, "offer"."distance" ASC NULLS LAST, ${product.createdAt} DESC, ${product.id} ASC`
		: sql`"offer"."distance" ASC NULLS LAST, ${product.createdAt} DESC, ${product.id} ASC`;

	const offer = buildOffer(params, openCondition);
	const offerForCount = buildOffer(params, openCondition);

	const [rows, [{ total }]] = await Promise.all([
		db
			.select({
				id: product.id,
				name: product.name,
				description: product.description,
				price: product.price,
				storeProductId: offer.storeProductId,
				stock: offer.stock,
				storeId: offer.storeId,
				storeName: offer.storeName,
				municipalityId: offer.municipalityId,
				municipalityName: offer.municipalityName,
				provinceAcronym: offer.provinceAcronym,
				distance: offer.distance,
				matchCount: offer.matchCount,
				rank: sql<number>`${rankExpr}`.as("rank"),
				// Alias esplicito `pi` per l'interna e riferimento letterale
				// `products.id` per l'esterna: in un campo della SELECT le Column
				// interpolate perdono la qualificazione, e `id` verrebbe risolto su
				// product_images spezzando la correlazione.
				images: sql<{ id: string; url: string; position: number }[]>`(
					SELECT coalesce(json_agg(json_build_object(
						'id', pi.id,
						'url', pi.url,
						'position', pi.position
					) ORDER BY pi.position), '[]'::json)
					FROM ${productImage} pi
					WHERE pi.product_id = products.id
				)`.as("images"),
			})
			.from(product)
			.innerJoinLateral(offer, sql`true`)
			.where(whereClause)
			.orderBy(orderExpr)
			.limit(limit)
			.offset(offset),
		db
			.select({ total: sql<number>`count(*)::int` })
			.from(product)
			.innerJoinLateral(offerForCount, sql`true`)
			.where(whereClause),
	]);

	const discountMap = await getBestActiveDiscounts(rows.map((r) => r.id));

	const data: ProductCard[] = rows.map((r) => {
		const info = discountMap.get(r.id);
		return {
			id: r.id,
			name: r.name,
			description: r.description,
			price: r.price,
			storeProductId: r.storeProductId,
			stock: r.stock,
			store: {
				id: r.storeId,
				name: r.storeName,
				municipality: {
					id: r.municipalityId,
					name: r.municipalityName,
					provinceAcronym: r.provinceAcronym,
				},
			},
			distance: r.distance,
			otherStoreCount: r.matchCount - 1,
			rank: r.rank,
			images: r.images,
			discountedPrice: info?.discountedPrice ?? null,
			discountPercent: info?.percent ?? null,
		};
	});

	return { data, pagination: { page, limit, total } };
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

```bash
cd apps/api && bun test tests/integration/customer-products-search.test.ts
```

Atteso: PASS su tutti i casi.

Se `innerJoinLateral` protesta sul tipo del secondo argomento, prova
`crossJoinLateral(offer)` — semanticamente identico qui, perché il laterale ha
già un `LIMIT 1` e un `CROSS JOIN LATERAL` con zero righe scarta comunque la
riga esterna.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/customer/services/product-search.ts \
        apps/api/tests/integration/customer-products-search.test.ts
git commit -m "$(cat <<'MSG'
feat(api): ricerca prodotti con negozio agganciato

JOIN LATERAL che sceglie, per ogni prodotto, il negozio piu' vicino fra
quelli idonei e conta gli altri nella stessa passata. Adotta
publiclyVisibleStore(): i prodotti dei negozi sospesi o senza abbonamento
non compaiono piu'.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: I filtri — offerta, prezzo, aperti ora

Tre filtri che non esistono sui negozi. Due lavorano sul prodotto (`onSale`,
`minPrice`/`maxPrice`, entrambi sul **prezzo che si paga**), uno sul negozio
agganciato (`openNow`, che restringe anche *quale* negozio viene scelto).

**Files:**
- Modify: `apps/api/src/modules/customer/services/product-search-conditions.ts`
- Modify: `apps/api/src/modules/customer/services/product-search.ts`
- Test: `apps/api/tests/integration/customer-products-search.test.ts` (aggiunge blocchi)

**Interfaces:**
- Consumes: `bestActiveDiscountPercent`, `effectivePriceExpr` (Task 1);
  `productConditions`, `offerConditions` (Task 2); `searchProducts` (Task 3).
- Produces: nessuna firma nuova — `searchProducts` comincia a onorare
  `onSale`, `minPrice`, `maxPrice`, `openNow`.

- [ ] **Step 1: Scrivi i test dei filtri**

Aggiungi in fondo a `apps/api/tests/integration/customer-products-search.test.ts`.
Aggiungi anche `createTestDiscount` e `createTestDiscountProduct` alla lista di
import da `../helpers/fixtures` in cima al file.

```ts
/** Sette giorni su sette, 00:00–23:59: aperto sempre, senza dipendere dall'orologio. */
const ALWAYS_OPEN = Array.from({ length: 7 }, (_, i) => ({
	dayOfWeek: i,
	slots: [{ open: "00:00", close: "23:59" }],
}));

describe("searchProducts — filtro offerta e prezzo", () => {
	it("onSale tiene solo i prodotti con uno sconto attivo adesso", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await visibleStore(seller.profile.id, { name: "Negozio", ...ROME });

		const discounted = await productIn(seller.profile.id, [s.id], {
			name: "Scontato",
			price: "100.00",
		});
		const expiredOne = await productIn(seller.profile.id, [s.id], {
			name: "ScontoScaduto",
			price: "100.00",
		});
		await productIn(seller.profile.id, [s.id], { name: "Pieno", price: "100.00" });

		const live = await createTestDiscount(db, seller.profile.id, { percent: 30 });
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
		const s = await visibleStore(seller.profile.id, { name: "Negozio", ...ROME });

		// 100 € scontato al 50% → 50 €: dentro `maxPrice: 60`.
		const cheapAfterDiscount = await productIn(seller.profile.id, [s.id], {
			name: "CentoScontato",
			price: "100.00",
		});
		const half = await createTestDiscount(db, seller.profile.id, { percent: 50 });
		await createTestDiscountProduct(db, half.id, cheapAfterDiscount.id);

		// 100 € pieni: fuori.
		await productIn(seller.profile.id, [s.id], { name: "CentoPieno", price: "100.00" });
		// 20 € pieni: dentro.
		await productIn(seller.profile.id, [s.id], { name: "Venti", price: "20.00" });

		const capped = await searchProducts({ maxPrice: 60 });
		expect(capped.data.map((r) => r.name).sort()).toEqual(["CentoScontato", "Venti"]);
		expect(capped.pagination.total).toBe(2);

		const floored = await searchProducts({ minPrice: 30 });
		expect(floored.data.map((r) => r.name).sort()).toEqual(["CentoPieno", "CentoScontato"]);

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
		const closed = await visibleStore(seller.profile.id, { name: "Chiuso", ...ROME });

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

		await productIn(seller.profile.id, [nearClosed.id, farOpen.id], { name: "Pane" });

		const plain = await searchProducts({ lat: ROME.lat, lng: ROME.lng });
		expect(plain.data[0].store.name).toBe("VicinoChiuso");

		const onlyOpen = await searchProducts({ lat: ROME.lat, lng: ROME.lng, openNow: true });
		expect(onlyOpen.data[0].store.name).toBe("LontanoAperto");
		// E il conteggio segue il filtro: il negozio chiuso non è "un altro negozio".
		expect(onlyOpen.data[0].otherStoreCount).toBe(0);
	});
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

```bash
cd apps/api && bun test tests/integration/customer-products-search.test.ts
```

Atteso: i blocchi nuovi FAIL (i filtri non sono applicati, quindi tornano
troppe righe); i blocchi dei Task 3 restano PASS.

- [ ] **Step 3: Applica i filtri sul prodotto**

In `product-search-conditions.ts`, rimetti l'import e sostituisci il commento
segnaposto:

```ts
import {
	bestActiveDiscountPercent,
	effectivePriceExpr,
} from "@/modules/seller/services/discount-pricing";
```

```ts
	// Nel WHERE e non come post-filtro: filtrare dopo la query darebbe un
	// `total` e una paginazione che non corrispondono ai risultati.
	if (p.onSale) {
		conditions.push(sql`${bestActiveDiscountPercent()} IS NOT NULL`);
	}
	// Sul prezzo che si paga, non sul listino.
	if (p.minPrice !== undefined) {
		conditions.push(sql`${effectivePriceExpr()} >= ${p.minPrice}`);
	}
	if (p.maxPrice !== undefined) {
		conditions.push(sql`${effectivePriceExpr()} <= ${p.maxPrice}`);
	}
```

- [ ] **Step 4: Collega `openNow` al laterale**

In `product-search.ts`, rimetti l'import e sostituisci la riga segnaposto:

```ts
import { openNowCondition } from "@/lib/store-open-status";
```

```ts
	// `openNow` restringe anche l'aggancio, non solo l'insieme: entra fra le
	// condizioni del laterale, quindi il negozio scelto è il più vicino APERTO.
	// La condizione si costruisce una volta sola: legge le festività attive.
	const openCondition = params.openNow ? await openNowCondition(new Date()) : null;
```

- [ ] **Step 5: Esegui tutti i test del file e verifica che passino**

```bash
cd apps/api && bun test tests/integration/customer-products-search.test.ts
```

Atteso: PASS su tutti i blocchi, vecchi e nuovi.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/customer/services/product-search-conditions.ts \
        apps/api/src/modules/customer/services/product-search.ts \
        apps/api/tests/integration/customer-products-search.test.ts
git commit -m "$(cat <<'MSG'
feat(api): filtri offerta, prezzo e aperti ora sulla ricerca prodotti

Il prezzo filtra sul valore scontato, non sul listino. "Aperti ora" entra
fra le condizioni del laterale, cosi' il negozio agganciato e' il piu'
vicino aperto e non il piu' vicino e basta.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: DTO, rotta `/customer/products`, e la home ripuntata

Il rinominio e il repoint della home stanno nello **stesso** task: appena
`/customer/search` sparisce, il typecheck dei frontend va rosso, e un task non
deve lasciare l'albero rotto.

**Files:**
- Modify: `apps/api/src/lib/schemas/entities.ts:852` (`SearchResultSchema` → `ProductCardSchema`)
- Modify: `apps/api/src/lib/queries.ts:66` (`ProductSearchQuery`)
- Create: `apps/api/src/modules/customer/routes/products.ts`
- Delete: `apps/api/src/modules/customer/routes/search.ts`, `apps/api/src/modules/customer/services/search.ts`
- Delete: `apps/api/tests/integration/customer-search.test.ts`, `apps/api/tests/integration/customer-search-soft-deleted.test.ts`
- Modify: `apps/api/src/modules/customer/index.ts:18`
- Modify: `apps/customer/src/features/discovery/use-nearby-products.ts`

**Interfaces:**
- Consumes: `searchProducts` (Task 3/4).
- Produces: `ProductCardSchema` (TypeBox), `GET /customer/products`, e sul
  client Eden `api().customer.products.get({ query })`.

- [ ] **Step 1: Sostituisci `SearchResultSchema` con `ProductCardSchema`**

In `apps/api/src/lib/schemas/entities.ts`, rimpiazza il blocco che inizia a
riga 851 (`// Search result`) con:

```ts
// Product search card (customer /products). Un risultato è un prodotto più il
// negozio agganciato: senza `storeProductId` il carrello non saprebbe cosa
// aggiungere. Nessun campo data nel DTO — Eden Treaty idraterebbe le
// stringhe-data in `Date` e il render fallirebbe — quindi niente
// discountTitle/discountEndsAt, che il tile non mostra.
export const ProductCardSchema = t.Object({
	id: t.String(),
	name: t.String({ description: "Nome del prodotto" }),
	description: t.Nullable(t.String({ description: "Descrizione del prodotto" })),
	price: t.String({ description: "Prezzo di listino in formato decimale" }),
	storeProductId: t.String({
		description: "ID della riga store_products del negozio agganciato",
	}),
	stock: t.Integer({
		minimum: 0,
		description: "Disponibilità nel negozio agganciato",
	}),
	store: t.Object(
		{
			id: t.String(),
			name: t.String({ description: "Nome del negozio" }),
			municipality: MunicipalityCompactSchema,
		},
		{ description: "Il negozio più vicino che ha il prodotto fra quelli filtrati" },
	),
	distance: t.Nullable(
		t.Number({
			minimum: 0,
			description: "Distanza in metri dall'origine (null senza origine)",
		}),
	),
	otherStoreCount: t.Integer({
		minimum: 0,
		description: "Altri negozi che soddisfano i filtri, oltre a quello agganciato",
	}),
	rank: t.Number({
		minimum: 0,
		description: "Punteggio di rilevanza full-text (0 senza query testuale)",
	}),
	images: t.Array(
		t.Object({
			id: t.String(),
			url: t.String({ description: "URL dell'immagine" }),
			position: t.Number({ minimum: 0, description: "Posizione di ordinamento" }),
		}),
		{ description: "Immagini del prodotto ordinate per posizione" },
	),
	discountedPrice: t.Nullable(t.String({ description: "Prezzo scontato, se promo attiva" })),
	discountPercent: t.Nullable(t.Integer({ minimum: 1, maximum: 99 })),
});
```

- [ ] **Step 2: Estendi `ProductSearchQuery`**

In `apps/api/src/lib/queries.ts`, sostituisci `ProductSearchQuery` con:

```ts
/**
 * Paginazione + testo, categoria, geografia, prezzo e disponibilità per la
 * ricerca prodotti. `radius` **non ha default**, come `StoreSearchQuery`: geo
 * senza raggio ordina per vicinanza senza tagliare nulla. Chi vuole un limite
 * lo dichiara (la home lo fa).
 */
export const ProductSearchQuery = t.Object({
	...PaginationQuery.properties,
	q: t.Optional(t.String({ description: "Testo di ricerca (full-text italiano)" })),
	categoryId: t.Optional(t.String({ description: "Filtra per ID categoria prodotto" })),
	macroCategoryId: t.Optional(
		t.String({
			description:
				"Filtra per ID macro categoria prodotto. Ignorato se `categoryId` è presente: la categoria è già dentro la sua macro.",
		}),
	),
	lat: t.Optional(
		t.Number({ minimum: -90, maximum: 90, description: "Latitudine del punto di ricerca" }),
	),
	lng: t.Optional(
		t.Number({ minimum: -180, maximum: 180, description: "Longitudine del punto di ricerca" }),
	),
	radius: t.Optional(
		t.Number({ description: "Raggio in km (opzionale, nessun limite di default)" }),
	),
	openNow: t.Optional(
		t.Boolean({
			description:
				"Solo i prodotti disponibili in un negozio aperto in questo momento (fuso Europe/Rome). Restringe anche quale negozio viene agganciato al risultato.",
		}),
	),
	onSale: t.Optional(
		t.Boolean({ description: "Solo i prodotti con uno sconto attivo in questo momento" }),
	),
	minPrice: t.Optional(
		t.Number({ minimum: 0, description: "Prezzo minimo in €, sul prezzo scontato" }),
	),
	maxPrice: t.Optional(
		t.Number({ minimum: 0, description: "Prezzo massimo in €, sul prezzo scontato" }),
	),
});
```

- [ ] **Step 3: Scrivi la rotta**

```ts
// apps/api/src/modules/customer/routes/products.ts
import { Elysia } from "elysia";
import { getLogger } from "@/lib/logger";
import { ProductSearchQuery } from "@/lib/queries";
import { okPage } from "@/lib/responses";
import { okPageRes, ProductCardSchema, withErrors } from "@/lib/schemas";
import { searchProducts } from "../services/product-search";

export const productsRoutes = new Elysia().get(
	"/products",
	async ({ query, store }) => {
		const pino = getLogger(store);
		const result = await searchProducts(query);

		pino.info(
			{
				searchQuery: query.q,
				categoryId: query.categoryId,
				macroCategoryId: query.macroCategoryId,
				hasGeoFilter: !!(query.lat && query.lng),
				radius: query.radius,
				openNow: query.openNow,
				onSale: query.onSale,
				resultCount: result.data.length,
				action: "product_search",
			},
			"Ricerca prodotti eseguita",
		);

		return okPage(result.data, result.pagination);
	},
	{
		query: ProductSearchQuery,
		response: withErrors({ 200: okPageRes(ProductCardSchema) }),
		detail: {
			summary: "Ricerca prodotti",
			description:
				"Ricerca pubblica di prodotti con full-text italiano e filtro geografico (PostGIS). Ogni risultato è un prodotto agganciato al negozio più vicino che lo ha disponibile fra quelli che soddisfano i filtri; `otherStoreCount` dice quanti altri ce l'hanno. Solo negozi pubblicamente visibili. Non richiede autenticazione.",
			tags: ["Customer - Search"],
		},
	},
);
```

- [ ] **Step 4: Registra la rotta e cancella la vecchia**

In `apps/api/src/modules/customer/index.ts`, sostituisci l'import
`import { searchRoutes } from "./routes/search";` con
`import { productsRoutes } from "./routes/products";`, e alla riga 18
`.use(searchRoutes)` con:

```ts
	// Product search is public (no auth required)
	.use(productsRoutes)
```

Poi:

```bash
git rm apps/api/src/modules/customer/routes/search.ts \
       apps/api/src/modules/customer/services/search.ts \
       apps/api/tests/integration/customer-search.test.ts \
       apps/api/tests/integration/customer-search-soft-deleted.test.ts
```

I casi dei due file di test rivivono nei blocchi del Task 3: full-text,
zero-stock, raggio e negozi soft-deleted sono tutti coperti.

- [ ] **Step 5: Ripunta la home al nuovo endpoint**

In `apps/customer/src/features/discovery/use-nearby-products.ts`, sostituisci
l'interfaccia e la `queryFn`:

```ts
/** Raggio della striscia in home, in km. L'endpoint non ne ha uno di default: senza, "Vicino a te" pescherebbe mezza Italia quando la zona è vuota. */
const NEARBY_RADIUS_KM = 50;

/** Forma normalizzata di un risultato della ricerca pubblica prodotti. */
export interface NearbyProduct {
	id: string;
	name: string;
	description: string | null;
	price: string;
	/** Distanza in metri dall'origine, `null` senza origine. */
	distance: number | null;
	images: { id: string; url: string; position: number }[];
	discountedPrice: string | null;
	discountPercent: number | null;
	store: { id: string; name: string; city: string; province: string };
}
```

```ts
			const { data, error } = await api().customer.products.get({
				query: coords
					? { limit, lat: coords.lat, lng: coords.lng, radius: NEARBY_RADIUS_KM }
					: { limit },
			});

			if (error) {
				throw new Error(`Ricerca non riuscita (${error.status})`);
			}

			return data.data.map((p) => ({
				id: p.id,
				name: p.name,
				description: p.description,
				price: p.price,
				distance: p.distance,
				images: p.images.map((img) => ({
					id: img.id,
					url: img.url,
					position: img.position,
				})),
				discountedPrice: p.discountedPrice,
				discountPercent: p.discountPercent,
				store: {
					id: p.store.id,
					name: p.store.name,
					city: p.store.municipality.name,
					province: p.store.municipality.provinceAcronym,
				},
			}));
```

`ProductTile` accetta ancora `distance?: number`, e ora può arrivare `null`.
Finché il Task 11 non allarga quel tipo, in `nearby-products.tsx` il tile va
chiamato così:

```tsx
							<ProductTile
								product={{ ...product, distance: product.distance ?? undefined }}
								showDistance={coords !== null}
							/>
```

- [ ] **Step 6: Verifica**

```bash
cd apps/api && bun run typecheck && bun test tests/integration/customer-products-search.test.ts
cd ../customer && bun run typecheck
```

Atteso: tutto verde. Se Eden non conosce ancora `customer.products`, fai un
`bun install` pulito dalla radice: una copia stantia di `@bibs/api` nello store
`.bun` fa collidere i tipi del treaty.

- [ ] **Step 7: Commit**

```bash
git add -A apps/api/src apps/api/tests apps/customer/src/features/discovery
git commit -m "$(cat <<'MSG'
feat(api)!: GET /customer/products al posto di /customer/search

Il risultato porta il negozio agganciato, lo storeProductId e il conteggio
degli altri negozi; query estesa con macroCategoryId, openNow, onSale e
fascia di prezzo. `radius` perde il default: la home ora lo dichiara.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: I facet

Il rail ha bisogno di sapere quanti prodotti restano dietro a ogni filtro. Qui
il laterale **non serve**: per contare basta sapere che *esiste* almeno un
negozio idoneo, non quale sia. Un `EXISTS` è più semplice e più veloce, e riusa
le stesse `offerConditions`.

**Files:**
- Create: `apps/api/src/modules/customer/services/product-facets.ts`
- Modify: `apps/api/src/modules/customer/routes/products.ts`
- Test: `apps/api/tests/integration/customer-products-facets.test.ts`

**Interfaces:**
- Consumes: `productConditions`, `offerConditions` (Task 2/4).
- Produces:
  - `interface ProductCategoryFacet { id: string; name: string; productCount: number }`
  - `interface ProductMacroFacet { id: string; name: string; productCount: number; categories: ProductCategoryFacet[] }`
  - `interface ProductFacets { total: number; openNowTotal: number; onSaleTotal: number; macros: ProductMacroFacet[] }`
  - `getProductFacets(params: Omit<ProductFilterParams, "categoryId" | "macroCategoryId">): Promise<ProductFacets>`
  - `ProductFacetsSchema` (TypeBox) e `GET /customer/products/facets`.

- [ ] **Step 1: Scrivi i test dei facet**

```ts
// apps/api/tests/integration/customer-products-facets.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

import { getTestDb, setupTestContainer, teardownTestContainer } from "../helpers/test-db";

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
		await productIn(seller.profile.id, s.id, { name: "Ciabatta", categoryIds: [pane.id] });

		const facets = await getProductFacets({});

		const cibo = facets.macros.find((m) => m.name === "Cibo");
		expect(cibo?.productCount).toBe(2);
		const byName = new Map(cibo?.categories.map((c) => [c.name, c.productCount]));
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

		await productIn(seller.profile.id, s.id, { name: "InA", categoryIds: [catA.id] });
		await productIn(seller.profile.id, s.id, { name: "InB", categoryIds: [catB.id] });

		const facets = await getProductFacets({ categoryId: catA.id, macroCategoryId: macroA.id } as any);

		expect(facets.macros.map((m) => m.name).sort()).toEqual(["Macro A", "Macro B"]);
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

		await productIn(seller.profile.id, s.id, { name: "Uno", categoryIds: [cat.id] });

		const facets = await getProductFacets({});

		expect(facets.macros.map((m) => m.name)).toEqual(["Usata"]);
	});

	it("conta solo i prodotti dei negozi visibili", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const visible = await visibleStore(seller.profile.id, { name: "Visibile" });
		const hidden = await createTestStore(db, seller.profile.id, { name: "Nascosto", ...ROME });
		await createTestStoreSubscription(db, hidden.id, { status: "suspended" });

		const macro = await createTestMacroCategory(db, "Macro");
		const cat = await createTestCategory(db, "Cat", macro.id);

		await productIn(seller.profile.id, visible.id, { name: "Buono", categoryIds: [cat.id] });
		await productIn(seller.profile.id, hidden.id, { name: "Nascosto", categoryIds: [cat.id] });

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

		const discounted = await productIn(seller.profile.id, open.id, { name: "Scontato" });
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
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

```bash
cd apps/api && bun test tests/integration/customer-products-facets.test.ts
```

Atteso: FAIL — il modulo `product-facets` non esiste.

- [ ] **Step 3: Scrivi il servizio**

```ts
// apps/api/src/modules/customer/services/product-facets.ts
import { eq, exists, sql } from "drizzle-orm";
import { db } from "@/db";
import { productCategory } from "@/db/schemas/category";
import { product, productCategoryAssignment, storeProduct } from "@/db/schemas/product";
import { productMacroCategory } from "@/db/schemas/product-macro-category";
import { store } from "@/db/schemas/store";
import { openNowCondition } from "@/lib/store-open-status";
import {
	offerConditions,
	type ProductFilterParams,
	productConditions,
} from "./product-search-conditions";

export type ProductFacetParams = Omit<
	ProductFilterParams,
	"categoryId" | "macroCategoryId"
>;

export interface ProductCategoryFacet {
	id: string;
	name: string;
	productCount: number;
}

export interface ProductMacroFacet {
	id: string;
	name: string;
	productCount: number;
	categories: ProductCategoryFacet[];
}

export interface ProductFacets {
	/** Prodotti che corrispondono, indipendentemente dalla categoria — la riga "Tutte". */
	total: number;
	/** Quanti se si accende "Aperti ora". */
	openNowTotal: number;
	/** Quanti se si accende "Solo in offerta". */
	onSaleTotal: number;
	macros: ProductMacroFacet[];
}

/**
 * Conteggi per il rail di `/products`.
 *
 * Due regole, entrambe ereditate da `getStoreFacets()`:
 *
 * 1. I facet non applicano mai la categoria già selezionata — la domanda è
 *    "quanti prodotti restano se aggiungo questo filtro", e le alternative
 *    devono restare visibili e contate. Per questo il tipo non ha nemmeno i
 *    campi `categoryId`/`macroCategoryId`.
 * 2. `openNowTotal` e `onSaleTotal` si misurano ciascuno **senza il proprio**
 *    filtro: a filtro acceso coincidono con `total`, e la query in più si salta.
 *
 * A differenza dei negozi, qui la somma dei figli **non** dà il totale della
 * macro: un prodotto può stare in due categorie della stessa macro. Per questo
 * ci sono due query raggruppate invece di una, e si conta sempre
 * `count(DISTINCT products.id)`.
 */
export async function getProductFacets(
	params: ProductFacetParams,
): Promise<ProductFacets> {
	// Mai la categoria scelta, qualunque cosa arrivi dal chiamante.
	const base: ProductFilterParams = {
		...params,
		categoryId: undefined,
		macroCategoryId: undefined,
	};

	const openCondition = await openNowCondition(new Date());

	/** Esiste almeno un negozio idoneo? Per contare non serve sapere quale. */
	const offerExists = (open: ReturnType<typeof sql> | null) =>
		exists(
			db
				.select({ one: sql`1` })
				.from(storeProduct)
				.innerJoin(store, eq(store.id, storeProduct.storeId))
				.where(sql.join(offerConditions(base, open), sql` AND `)),
		);

	const whereFor = (opts: { onSale: boolean; openNow: boolean }) =>
		sql.join(
			[
				...productConditions({ ...base, onSale: opts.onSale }),
				offerExists(opts.openNow ? openCondition : null),
			],
			sql` AND `,
		);

	const baseOnSale = base.onSale === true;
	const baseOpenNow = base.openNow === true;
	const whereClause = whereFor({ onSale: baseOnSale, openNow: baseOpenNow });

	const countProducts = (where: ReturnType<typeof sql>) =>
		db
			.select({ total: sql<number>`count(DISTINCT products.id)::int` })
			.from(product)
			.where(where);

	const [macroRows, categoryRows, [{ total }], openNowRows, onSaleRows] =
		await Promise.all([
			db
				.select({
					macroId: productMacroCategory.id,
					macroName: productMacroCategory.name,
					productCount: sql<number>`count(DISTINCT products.id)::int`,
				})
				.from(product)
				.innerJoin(
					productCategoryAssignment,
					sql`${productCategoryAssignment.productId} = ${product.id}`,
				)
				.innerJoin(
					productCategory,
					eq(productCategory.id, productCategoryAssignment.productCategoryId),
				)
				.innerJoin(
					productMacroCategory,
					eq(productMacroCategory.id, productCategory.macroCategoryId),
				)
				.where(whereClause)
				.groupBy(productMacroCategory.id, productMacroCategory.name)
				.orderBy(sql`${productMacroCategory.name} ASC`),
			db
				.select({
					macroId: productMacroCategory.id,
					categoryId: productCategory.id,
					categoryName: productCategory.name,
					productCount: sql<number>`count(DISTINCT products.id)::int`,
				})
				.from(product)
				.innerJoin(
					productCategoryAssignment,
					sql`${productCategoryAssignment.productId} = ${product.id}`,
				)
				.innerJoin(
					productCategory,
					eq(productCategory.id, productCategoryAssignment.productCategoryId),
				)
				.innerJoin(
					productMacroCategory,
					eq(productMacroCategory.id, productCategory.macroCategoryId),
				)
				.where(whereClause)
				.groupBy(productMacroCategory.id, productCategory.id, productCategory.name)
				.orderBy(sql`${productCategory.name} ASC`),
			countProducts(whereClause),
			baseOpenNow
				? Promise.resolve(null)
				: countProducts(whereFor({ onSale: baseOnSale, openNow: true })),
			baseOnSale
				? Promise.resolve(null)
				: countProducts(whereFor({ onSale: true, openNow: baseOpenNow })),
		]);

	const categoriesByMacro = new Map<string, ProductCategoryFacet[]>();
	for (const row of categoryRows) {
		const list = categoriesByMacro.get(row.macroId) ?? [];
		list.push({
			id: row.categoryId,
			name: row.categoryName,
			productCount: row.productCount,
		});
		categoriesByMacro.set(row.macroId, list);
	}

	return {
		total,
		openNowTotal: openNowRows?.[0].total ?? total,
		onSaleTotal: onSaleRows?.[0].total ?? total,
		// Le macro a zero non arrivano nemmeno: una macro senza prodotti non
		// produce righe nel GROUP BY.
		macros: macroRows.map((row) => ({
			id: row.macroId,
			name: row.macroName,
			productCount: row.productCount,
			categories: categoriesByMacro.get(row.macroId) ?? [],
		})),
	};
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

```bash
cd apps/api && bun test tests/integration/customer-products-facets.test.ts
```

Atteso: PASS.

- [ ] **Step 5: Aggiungi lo schema e la rotta**

In `apps/api/src/lib/schemas/entities.ts`, sotto `ProductCardSchema`:

```ts
const ProductCategoryFacetSchema = t.Object({
	id: t.String(),
	name: t.String({ description: "Nome della categoria" }),
	productCount: t.Integer({ minimum: 0, description: "Prodotti in questa categoria" }),
});

export const ProductFacetsSchema = t.Object({
	total: t.Integer({
		minimum: 0,
		description: "Prodotti che corrispondono a testo, geografia, prezzo e offerta",
	}),
	openNowTotal: t.Integer({
		minimum: 0,
		description: "Quanti di quei prodotti restano accendendo «Aperti ora»",
	}),
	onSaleTotal: t.Integer({
		minimum: 0,
		description: "Quanti di quei prodotti restano accendendo «Solo in offerta»",
	}),
	macros: t.Array(
		t.Object({
			id: t.String(),
			name: t.String({ description: "Nome della macro categoria" }),
			productCount: t.Integer({ minimum: 0 }),
			categories: t.Array(ProductCategoryFacetSchema),
		}),
		{ description: "Macro categorie con almeno un prodotto, in ordine alfabetico" },
	),
});
```

In `apps/api/src/modules/customer/routes/products.ts`, incatena dopo la `.get`
esistente. **`/products/facets` va dichiarata dopo `/products` ma prima di una
futura `/products/:id`**, come già fanno i negozi:

```ts
	.get(
		"/products/facets",
		async ({ query, store }) => {
			const pino = getLogger(store);
			const facets = await getProductFacets(query);
			pino.info(
				{
					searchQuery: query.q,
					hasGeoFilter: !!(query.lat && query.lng),
					radius: query.radius,
					openNow: query.openNow,
					onSale: query.onSale,
					macroCount: facets.macros.length,
					action: "product_facets",
				},
				"Facet di ricerca prodotti richiesti",
			);
			return ok(facets);
		},
		{
			query: t.Omit(ProductSearchQuery, ["page", "limit", "categoryId", "macroCategoryId"]),
			response: withErrors({ 200: okRes(ProductFacetsSchema) }),
			detail: {
				summary: "Facet di ricerca prodotti",
				description:
					"Conteggi per macro categoria e categoria sui prodotti che corrispondono a testo, geografia, prezzo e offerta. Non applica mai la categoria già selezionata: il rail deve mostrare le alternative. Le macro senza prodotti non vengono restituite. Non richiede autenticazione.",
				tags: ["Customer - Search"],
			},
		},
	);
```

Aggiorna gli import del file: aggiungi `t` da `elysia`, `ok` da
`@/lib/responses`, `okRes` e `ProductFacetsSchema` da `@/lib/schemas`, e
`getProductFacets` da `../services/product-facets`.

- [ ] **Step 6: Verifica**

```bash
cd apps/api && bun run typecheck && bun test tests/integration/customer-products-facets.test.ts
```

Atteso: verde. Apri anche `http://localhost:3000/swagger` con `bun run dev` e
controlla che entrambe le rotte compaiano sotto "Customer - Search".

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/customer/services/product-facets.ts \
        apps/api/src/modules/customer/routes/products.ts \
        apps/api/src/lib/schemas/entities.ts \
        apps/api/tests/integration/customer-products-facets.test.ts
git commit -m "$(cat <<'MSG'
feat(api): facet della ricerca prodotti

Conteggi per macro e categoria su prodotti distinti: un prodotto puo' stare
in due categorie della stessa macro, quindi la macro non e' la somma dei
figli. openNowTotal e onSaleTotal si misurano senza il proprio filtro.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: Verifica e apertura della PR 1

**Files:** nessuna modifica prevista; se la verifica ne richiede, vanno nel
task che le ha causate.

- [ ] **Step 1: Lint, typecheck e test per workspace**

```bash
cd /Users/marcogelli/repos/jelaz/bibs
bun run lint
(cd apps/api && bun run typecheck) && echo "api ok"
(cd apps/customer && bun run typecheck) && echo "customer ok"
(cd apps/seller && bun run typecheck) && echo "seller ok"
(cd apps/admin && bun run typecheck) && echo "admin ok"
(cd apps/api && bun run test) && echo "test ok"
```

Uno per uno, controllando l'esito di ciascuno: l'aggregato `--filter '*'` può
nascondere il fallimento di un singolo workspace.

- [ ] **Step 2: `EXPLAIN` del laterale sul seed**

```bash
bun run db:reset   # popola ~2.200 prodotti
```

Poi, in uno script usa-e-getta nello scratchpad, stampa il piano della query di
ricerca con un'origine e un raggio:

```ts
const q = /* la stessa select di searchProducts, con lat/lng/radius */;
const { sql: text, params } = q.toSQL();
const plan = await db.execute(sql.raw(`EXPLAIN ANALYZE ${text}`)); // sostituisci i $n a mano
console.log(plan);
```

Cerca due cose: che l'indice GIN `product_search_idx` venga usato quando c'è
`q`, e che il laterale non degeneri in un `Seq Scan` su `store_products` (ci
sono `store_product_store_id_idx` e l'unico su `(product_id, store_id)`). Se il
tempo totale supera qualche centinaio di millisecondi su 2.200 prodotti,
**fermati e segnalalo** prima di proseguire: è un problema di forma della
query, non da tamponare con un indice nuovo deciso al volo.

- [ ] **Step 3: Prova le due rotte a mano**

```bash
bun run dev   # api su :3000
curl -s 'http://localhost:3000/api/v1/customer/products?limit=3&lat=41.9028&lng=12.4964&radius=20' | head -c 2000
curl -s 'http://localhost:3000/api/v1/customer/products/facets?lat=41.9028&lng=12.4964&radius=20' | head -c 2000
```

Verifica nella risposta: `store.name` presente, `storeProductId` presente,
`distance` crescente, `otherStoreCount` plausibile, e nei facet delle macro
ordinate con conteggi non nulli. (Se il prefisso `/api/v1` non corrisponde,
leggilo da `apps/api/src/index.ts`.)

- [ ] **Step 4: Apri la PR 1**

```bash
git push -u origin feat/customer-product-search
gh pr create --title "feat(api): ricerca prodotti con negozio agganciato" --body "$(cat <<'BODY'
Prima delle due PR della ricerca prodotti customer. Spec:
`docs/superpowers/specs/2026-09-21-customer-product-search-design.md`.

- `GET /customer/products` sostituisce `GET /customer/search`: ogni risultato è
  un prodotto agganciato al negozio più vicino che ce l'ha, con
  `storeProductId` (serve al carrello), `store`, `distance` e
  `otherStoreCount`, calcolati in una sola `JOIN LATERAL`.
- `GET /customer/products/facets` per il rail della pagina che arriva nella
  PR 2.
- Filtri nuovi: `macroCategoryId`, `openNow` (restringe anche l'aggancio),
  `onSale`, `minPrice`/`maxPrice` — questi ultimi sul prezzo scontato, tutti
  nel `WHERE` perché `total` e paginazione restino veri.
- **Chiude un debito:** la ricerca prodotti adotta `publiclyVisibleStore()`. I
  prodotti dei negozi sospesi, cancellati o senza abbonamento non compaiono
  più — valeva anche per "Vicino a te" in home.
- `radius` perde il default nascosto di 50 km; la home ora lo dichiara.

Frontend: solo il repoint della home al nuovo endpoint. La pagina `/products`
arriva nella PR 2.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

# PR 2 — Frontend

**Nota sulla verifica in questa PR.** `apps/customer` gira su `bun test` senza
DOM né testing-library: le funzioni pure si testano, i componenti e gli hook
no. Per i task 8–13 il gate è quindi `typecheck` + `bun run build` (che prende
gli errori SSR) + lo smoke nel browser elencato nel Task 14. Non inventare un
runner nuovo per questa PR.

### Task 8: Le tre estrazioni condivise

Refactor puro, a comportamento invariato: `/stores` deve continuare a
funzionare identico. Si fa **prima** della pagina nuova, così `/products`
nasce già sopra i pezzi condivisi invece di clonarli.

**Files:**
- Create: `apps/customer/src/features/search/search-field.tsx`
- Create: `apps/customer/src/features/search/use-search-text-param.ts`
- Create: `apps/customer/src/features/location/use-near-param.ts`
- Modify: `apps/customer/src/routes/_authenticated/stores/index.tsx` (righe 112–175 e 447–470 circa)

**Interfaces:**
- Consumes: `useSearchOrigin`, `nearFromOrigin` (esistenti).
- Produces:
  - `SearchField(props: { value: string; onChange: (next: string) => void; placeholder: string; ariaLabel: string; clearLabel: string }): JSX.Element`
  - `useSearchTextParam(q: string | undefined, onChange: (next: string | undefined) => void, delayMs?: number): readonly [string, Dispatch<SetStateAction<string>>]` — il secondo elemento è il setter di `useState`, assegnabile alla prop `onChange` di `SearchField`
  - `useNearParam(near: string | undefined, setNear: (next: string | undefined) => void): void`

- [ ] **Step 1: Estrai il campo di ricerca**

```tsx
// apps/customer/src/features/search/search-field.tsx
import { Search, X } from "lucide-react";

interface SearchFieldProps {
	value: string;
	onChange: (next: string) => void;
	placeholder: string;
	ariaLabel: string;
	/** Etichetta accessibile del pulsante di pulizia: è un'icona. */
	clearLabel: string;
}

/**
 * Il campo di ricerca di `/products` e `/stores`. Le etichette arrivano dal
 * chiamante: le due pagine cercano cose diverse e devono dirlo.
 *
 * `[&::-webkit-search-cancel-button]:hidden` toglie la X nativa di WebKit, che
 * altrimenti raddoppierebbe la nostra.
 */
export function SearchField({
	value,
	onChange,
	placeholder,
	ariaLabel,
	clearLabel,
}: SearchFieldProps) {
	return (
		<div className="relative">
			<Search
				className="-translate-y-1/2 absolute top-1/2 left-4 size-4.5 text-muted-foreground"
				aria-hidden
			/>
			<input
				type="search"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				aria-label={ariaLabel}
				className="h-12 w-full rounded-lg border border-border bg-background pr-11 pl-11 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-saffron [&::-webkit-search-cancel-button]:hidden"
			/>
			{value && (
				<button
					type="button"
					onClick={() => onChange("")}
					aria-label={clearLabel}
					className="-translate-y-1/2 absolute top-1/2 right-2 rounded-md p-2 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-2 focus-visible:ring-saffron"
				>
					<X className="size-4" aria-hidden />
				</button>
			)}
		</div>
	);
}
```

- [ ] **Step 2: Estrai il debounce testo ⇄ URL**

```ts
// apps/customer/src/features/search/use-search-text-param.ts
import { useEffect, useRef, useState } from "react";

/**
 * Testo di ricerca controllato, allineato all'URL nei due sensi: si digita e
 * dopo una pausa il parametro si aggiorna; se `q` cambia da fuori (indietro,
 * avanti, link aperto) l'input si riallinea.
 *
 * `onChange` vive in un ref perché il chiamante lo ricrea a ogni render: nella
 * lista di dipendenze rifarebbe partire il timer di continuo, e il debounce
 * non scatterebbe mai.
 */
export function useSearchTextParam(
	q: string | undefined,
	onChange: (next: string | undefined) => void,
	delayMs = 300,
) {
	const [text, setText] = useState(q ?? "");

	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	useEffect(() => {
		const id = setTimeout(() => onChangeRef.current(text || undefined), delayMs);
		return () => clearTimeout(id);
	}, [text, delayMs]);

	// `prevQ` distingue "l'URL è cambiato da fuori" da "l'URL è cambiato perché
	// l'abbiamo appena scritto noi": solo il primo caso deve toccare l'input.
	const prevQ = useRef(q);
	useEffect(() => {
		if (q !== prevQ.current) {
			prevQ.current = q;
			setText(q ?? "");
		}
	}, [q]);

	return [text, setText] as const;
}
```

- [ ] **Step 3: Estrai i due effetti di `near`**

```ts
// apps/customer/src/features/location/use-near-param.ts
import { useEffect, useRef } from "react";
import { useSearchOrigin } from "./search-origin";
import { nearFromOrigin } from "./search-origin-state";

/**
 * Tiene allineati il parametro `near` dell'URL e l'origine attiva.
 *
 * All'arrivo **vince il link**: `adoptedNear` ricorda quale valore dell'URL è
 * già stato consumato, così non lo si riadotta a ogni render. Un `near` che
 * non risolve nulla (l'indirizzo di un altro cliente, o `gps` senza consenso)
 * viene tolto dall'URL invece di restare lì a promettere un'origine che non
 * c'è.
 *
 * Da lì in poi **vince il chip**: quando l'origine cambia, l'URL la rispecchia,
 * così quello che si condivide è la vista che si sta guardando.
 * `lastOriginKey` parte indefinito di proposito — al primo giro non si scrive
 * niente, altrimenti l'origine ancora in avvio cancellerebbe il `near` del
 * link appena aperto.
 */
export function useNearParam(
	near: string | undefined,
	setNear: (next: string | undefined) => void,
) {
	const { origin, isAddressesPending, adoptNear } = useSearchOrigin();

	const setNearRef = useRef(setNear);
	setNearRef.current = setNear;

	const adoptedNear = useRef<string | null>(null);
	useEffect(() => {
		// Un id di indirizzo non si può giudicare finché la rubrica non ha risposto.
		if (isAddressesPending) return;
		const key = near ?? null;
		if (adoptedNear.current === key) return;
		adoptedNear.current = key;
		if (key === null) return;
		if (!adoptNear(key)) setNearRef.current(undefined);
	}, [near, isAddressesPending, adoptNear]);

	const lastOriginKey = useRef<string | null | undefined>(undefined);
	useEffect(() => {
		const key = nearFromOrigin(origin) ?? null;
		const changed =
			lastOriginKey.current !== undefined && lastOriginKey.current !== key;
		lastOriginKey.current = key;
		if (!changed || (near ?? null) === key) return;
		adoptedNear.current = key;
		setNearRef.current(key ?? undefined);
	}, [origin, near]);
}
```

- [ ] **Step 4: Fai usare i tre pezzi a `/stores`**

In `apps/customer/src/routes/_authenticated/stores/index.tsx`:

1. Sostituisci `const [text, setText] = useState(q ?? "")` e i due `useEffect`
   del debounce e della risincronizzazione (righe 112–130 circa) con:

```tsx
	const [text, setText] = useSearchTextParam(q, (next) => {
		void navigate({ search: (prev) => ({ ...prev, q: next }), replace: true });
	});
```

2. Sostituisci i due `useEffect` di `near` con i loro ref (righe 139–175 circa) con:

```tsx
	useNearParam(near, (next) => {
		void navigate({ search: (prev) => ({ ...prev, near: next }), replace: true });
	});
```

3. Sostituisci il blocco `<div className="mt-6"><div className="relative">…</div></div>`
   (righe 447–470 circa) con:

```tsx
			<div className="mt-6">
				<SearchField
					value={text}
					onChange={setText}
					placeholder={m.store_search_placeholder()}
					ariaLabel={m.store_search_aria()}
					clearLabel={m.store_search_clear()}
				/>
			</div>
```

4. Ripulisci gli import: via `Search` e `X` da `lucide-react` se non servono
   altrove nel file, via `useRef` se resta inutilizzato, dentro
   `SearchField`, `useSearchTextParam`, `useNearParam`. `noUnusedLocals` è
   acceso: un import orfano fa fallire il typecheck.

- [ ] **Step 5: Verifica che `/stores` non sia cambiato**

```bash
cd apps/customer && bun run typecheck && bun run build
```

Poi con `bun run dev` su `http://localhost:3001/stores`, entrato come
`customer@dev.bibs` / `password123` (se le credenziali non funzionano, cercale
in `apps/api/src/db/seed/fixtures/`), controlla **uno per uno**:

- digitare nel campo aggiorna i risultati dopo la pausa e scrive `?q=` nell'URL;
- la X pulisce il campo e toglie `q` dall'URL;
- indietro/avanti del browser riallineano il campo;
- cambiare origine dal chip aggiorna `near=` nell'URL;
- aprire a mano `?near=gps` adotta il GPS, e un `?near=inesistente` sparisce
  dall'URL invece di restare.

- [ ] **Step 6: Commit**

```bash
git add apps/customer/src/features/search apps/customer/src/features/location/use-near-param.ts \
        apps/customer/src/routes/_authenticated/stores/index.tsx
git commit -m "$(cat <<'MSG'
refactor(customer): estrai campo di ricerca, debounce e sincronia di `near`

Tre pezzi che /products e /stores condividono. Quello di `near` e' il piu'
delicato dei due file: in due copie sarebbe divergito. Comportamento di
/stores invariato.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: Gli hook della ricerca prodotti

**Files:**
- Create: `apps/customer/src/features/catalog/use-product-search.ts`
- Create: `apps/customer/src/features/catalog/use-product-facets.ts`

**Interfaces:**
- Consumes: `api()` (Eden), `Coords`, `GET /customer/products` e `/facets` (PR 1).
- Produces:
  - `interface ProductCardView { id, name, price, discountedPrice, discountPercent, distance: number | null, images: { url: string }[], storeProductId, stock, store: { id, name, city, province }, otherStoreCount }`
  - `useProductSearch(args): { products: ProductCardView[]; total; hasNextPage; fetchNextPage; isFetchingNextPage; isPending; isError; refetch }`
  - `interface ProductCategoryFacetView { id: string; name: string; productCount: number }`
  - `interface ProductMacroFacetView extends ProductCategoryFacetView { categories: ProductCategoryFacetView[] }`
  - `useProductFacets(args): { macros; total; openNowTotal; onSaleTotal; isPending }`

- [ ] **Step 1: Scrivi l'hook di ricerca**

```ts
// apps/customer/src/features/catalog/use-product-search.ts
import { useInfiniteQuery } from "@tanstack/react-query";
import type { Coords } from "@/features/location/coords";
import { api } from "@/lib/api";

/** Forma stabile per la UI, disaccoppiata dal tipo inferito da Eden. */
export interface ProductCardView {
	id: string;
	name: string;
	price: string;
	discountedPrice: string | null;
	discountPercent: number | null;
	/** Metri dall'origine, `null` senza origine. */
	distance: number | null;
	images: { url: string }[];
	/** Riga `store_products` del negozio agganciato: è ciò che "Aggiungi" usa. */
	storeProductId: string;
	stock: number;
	store: { id: string; name: string; city: string; province: string };
	otherStoreCount: number;
}

interface UseProductSearchArgs {
	q?: string;
	categoryId?: string;
	macroCategoryId?: string;
	coords: Coords | null;
	/** Raggio in km. Ignorato finché non c'è una posizione. */
	radius?: number;
	openNow?: boolean;
	onSale?: boolean;
	minPrice?: number;
	maxPrice?: number;
	limit?: number;
}

export function useProductSearch({
	q,
	categoryId,
	macroCategoryId,
	coords,
	radius,
	openNow,
	onSale,
	minPrice,
	maxPrice,
	limit = 20,
}: UseProductSearchArgs) {
	const query = useInfiniteQuery({
		queryKey: [
			"product-search",
			q ?? "",
			categoryId ?? "",
			macroCategoryId ?? "",
			coords?.lat ?? null,
			coords?.lng ?? null,
			radius ?? null,
			openNow ?? false,
			onSale ?? false,
			minPrice ?? null,
			maxPrice ?? null,
			limit,
		],
		staleTime: 60_000,
		initialPageParam: 1,
		queryFn: async ({ pageParam }) => {
			const { data, error } = await api().customer.products.get({
				query: {
					page: pageParam,
					limit,
					...(q ? { q } : {}),
					...(categoryId ? { categoryId } : {}),
					...(macroCategoryId ? { macroCategoryId } : {}),
					...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
					...(coords && radius ? { radius } : {}),
					...(openNow ? { openNow } : {}),
					...(onSale ? { onSale } : {}),
					...(minPrice !== undefined ? { minPrice } : {}),
					...(maxPrice !== undefined ? { maxPrice } : {}),
				},
			});
			if (error) {
				throw new Error(`Ricerca prodotti non riuscita (${error.status})`);
			}
			return data;
		},
		getNextPageParam: (lastPage) => {
			const { page, limit: lim, total } = lastPage.pagination;
			return page * lim < total ? page + 1 : undefined;
		},
	});

	const products: ProductCardView[] =
		query.data?.pages.flatMap((p) =>
			p.data.map((r) => ({
				id: r.id,
				name: r.name,
				price: r.price,
				discountedPrice: r.discountedPrice,
				discountPercent: r.discountPercent,
				distance: r.distance,
				images: r.images.map((img) => ({ url: img.url })),
				storeProductId: r.storeProductId,
				stock: r.stock,
				store: {
					id: r.store.id,
					name: r.store.name,
					city: r.store.municipality.name,
					province: r.store.municipality.provinceAcronym,
				},
				otherStoreCount: r.otherStoreCount,
			})),
		) ?? [];

	return {
		products,
		total: query.data?.pages[0]?.pagination.total ?? 0,
		hasNextPage: query.hasNextPage,
		fetchNextPage: query.fetchNextPage,
		isFetchingNextPage: query.isFetchingNextPage,
		isPending: query.isPending,
		isError: query.isError,
		refetch: query.refetch,
	};
}
```

- [ ] **Step 2: Scrivi l'hook dei facet**

```ts
// apps/customer/src/features/catalog/use-product-facets.ts
import { useQuery } from "@tanstack/react-query";
import type { Coords } from "@/features/location/coords";
import { api } from "@/lib/api";

export interface ProductCategoryFacetView {
	id: string;
	name: string;
	productCount: number;
}

export interface ProductMacroFacetView extends ProductCategoryFacetView {
	categories: ProductCategoryFacetView[];
}

interface UseProductFacetsArgs {
	q?: string;
	coords: Coords | null;
	radius?: number;
	openNow?: boolean;
	onSale?: boolean;
	minPrice?: number;
	maxPrice?: number;
}

/**
 * Conteggi del rail. Seguono testo, raggio, prezzo e offerta ma NON la
 * categoria scelta: la domanda è "quanti prodotti restano se aggiungo questo
 * filtro", quindi le alternative devono restare visibili e contate.
 */
export function useProductFacets({
	q,
	coords,
	radius,
	openNow,
	onSale,
	minPrice,
	maxPrice,
}: UseProductFacetsArgs) {
	const query = useQuery({
		queryKey: [
			"product-facets",
			q ?? "",
			coords?.lat ?? null,
			coords?.lng ?? null,
			radius ?? null,
			openNow ?? false,
			onSale ?? false,
			minPrice ?? null,
			maxPrice ?? null,
		],
		staleTime: 60_000,
		queryFn: async () => {
			const { data, error } = await api().customer.products.facets.get({
				query: {
					...(q ? { q } : {}),
					...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
					...(coords && radius ? { radius } : {}),
					...(openNow ? { openNow } : {}),
					...(onSale ? { onSale } : {}),
					...(minPrice !== undefined ? { minPrice } : {}),
					...(maxPrice !== undefined ? { maxPrice } : {}),
				},
			});
			if (error) throw new Error(`Filtri non disponibili (${error.status})`);
			return data.data;
		},
	});

	return {
		macros: (query.data?.macros ?? []) as ProductMacroFacetView[],
		total: query.data?.total ?? 0,
		openNowTotal: query.data?.openNowTotal ?? 0,
		onSaleTotal: query.data?.onSaleTotal ?? 0,
		isPending: query.isPending,
	};
}
```

- [ ] **Step 3: Verifica**

```bash
cd apps/customer && bun run typecheck
```

Atteso: verde. Se Eden non conosce `customer.products.facets`, fai un
`bun install` pulito dalla radice.

- [ ] **Step 4: Commit**

```bash
git add apps/customer/src/features/catalog/use-product-search.ts \
        apps/customer/src/features/catalog/use-product-facets.ts
git commit -m "$(cat <<'MSG'
feat(customer): hook della ricerca prodotti e dei suoi facet

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: Il rail dei filtri

**Files:**
- Create: `apps/customer/src/features/catalog/product-filters.tsx`
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json`

**Interfaces:**
- Consumes: `ProductMacroFacetView` (Task 9).
- Produces:
  - `const PRODUCT_RADIUS_PRESETS = [1, 3, 5, 10] as const`
  - `interface ProductFilterValue { macroCategoryId?: string; categoryId?: string; radius?: number; openNow?: boolean; onSale?: boolean; minPrice?: number; maxPrice?: number }`
  - `ProductFilters(props: { macros; total; openNowTotal; onSaleTotal; isPending; value: ProductFilterValue; hasOrigin: boolean; originLabel: string; onChooseOrigin: () => void; onChange: (next: ProductFilterValue) => void })`

- [ ] **Step 1: Aggiungi le chiavi i18n**

In `apps/customer/messages/it.json`:

```json
	"product_filter_availability": "Disponibilità",
	"product_open_now": "In negozi aperti ora",
	"product_open_now_none": "Nessun negozio aperto in questo momento.",
	"product_on_sale": "Solo in offerta",
	"product_on_sale_none": "Nessun prodotto in offerta in questo momento.",
	"product_filter_category": "Categoria",
	"product_category_all": "Tutte",
	"product_filter_price": "Prezzo",
	"product_price_min": "Da",
	"product_price_max": "A",
	"product_price_min_aria": "Prezzo minimo in euro",
	"product_price_max_aria": "Prezzo massimo in euro",
	"product_price_hint": "Sul prezzo che paghi, sconti inclusi.",
	"product_filter_distance": "Distanza",
	"product_distance_needs_origin": "Scegli da dove cercare per filtrare per distanza.",
	"product_radius_any": "Tutte",
	"product_radius_km": "{km} km",
```

In `apps/customer/messages/en.json`, le stesse chiavi con:
`"Availability"`, `"In shops open now"`, `"No shop is open right now."`,
`"On sale only"`, `"Nothing on sale right now."`, `"Category"`, `"All"`,
`"Price"`, `"From"`, `"To"`, `"Minimum price in euros"`,
`"Maximum price in euros"`, `"On the price you pay, discounts included."`,
`"Distance"`, `"Choose where to search from to filter by distance."`,
`"All"`, `"{km} km"`.

`product_radius_any` e `product_radius_km` ripetono le stringhe di
`store_radius_*` di proposito: due pagine diverse che per caso dicono la stessa
cosa non sono una chiave sola.

- [ ] **Step 2: Scrivi il rail**

```tsx
// apps/customer/src/features/catalog/product-filters.tsx
import { Button } from "@bibs/ui/components/button";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { ChevronRight, Clock, LocateFixed, MapPin, Tag } from "lucide-react";
import { useEffect, useState } from "react";
import { m } from "@/paraglide/messages";
import type { ProductMacroFacetView } from "./use-product-facets";

/** Stesso focus del rail negozi: il saffron da solo non arriva al 3:1, l'Ink porta il contrasto. */
const FOCUS_RING =
	"outline-none focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-2 focus-visible:ring-saffron";

/** Raggi offerti dal rail, in km. `undefined` = nessun limite. */
export const PRODUCT_RADIUS_PRESETS = [1, 3, 5, 10] as const;

export interface ProductFilterValue {
	macroCategoryId?: string;
	categoryId?: string;
	radius?: number;
	openNow?: boolean;
	onSale?: boolean;
	minPrice?: number;
	maxPrice?: number;
}

interface ProductFiltersProps {
	macros: ProductMacroFacetView[];
	total: number;
	openNowTotal: number;
	onSaleTotal: number;
	isPending: boolean;
	value: ProductFilterValue;
	hasOrigin: boolean;
	originLabel: string;
	onChooseOrigin: () => void;
	onChange: (next: ProductFilterValue) => void;
}

function FilterSection({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="space-y-2">
			<h2 className="font-medium text-[0.8125rem] text-foreground tracking-[0.04em]">
				{title}
			</h2>
			{children}
		</section>
	);
}

function Count({ value }: { value: number }) {
	return (
		<span className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
			{value}
		</span>
	);
}

const ROW = `flex min-h-11 w-full items-center gap-2 rounded-md py-2 pr-2 text-left transition-colors lg:min-h-9 ${FOCUS_RING}`;

function CategoryRow({
	label,
	count,
	active,
	depth,
	expandable,
	expanded,
	onClick,
}: {
	label: string;
	count: number;
	active: boolean;
	depth: 0 | 1;
	expandable?: boolean;
	expanded?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-expanded={expandable ? expanded : undefined}
			aria-current={active ? "true" : undefined}
			className={`${ROW} ${depth === 1 ? "pl-8 text-[0.8125rem]" : "pl-2 text-sm"} ${
				active
					? "bg-primary/10 font-medium text-primary"
					: "text-muted-foreground hover:bg-muted hover:text-foreground"
			}`}
		>
			{expandable ? (
				<ChevronRight
					aria-hidden
					className={`-ml-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${
						expanded ? "rotate-90" : ""
					}`}
				/>
			) : (
				depth === 0 && <span aria-hidden className="-ml-0.5 size-3.5 shrink-0" />
			)}
			<span className="min-w-0 flex-1 truncate">{label}</span>
			<Count value={count} />
		</button>
	);
}

/** `aria-pressed`: qui si accende un filtro, non si sceglie fra alternative. */
function ToggleRow({
	icon: Icon,
	label,
	count,
	active,
	disabled,
	onClick,
}: {
	icon: typeof Clock;
	label: string;
	count: number;
	active: boolean;
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-pressed={active}
			className={`${ROW} pl-2 text-sm disabled:cursor-not-allowed ${
				active
					? "bg-primary/10 font-medium text-primary"
					: "text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-60"
			}`}
		>
			<Icon className="-ml-0.5 size-3.5 shrink-0" aria-hidden />
			<span className="min-w-0 flex-1 truncate">{label}</span>
			<Count value={count} />
		</button>
	);
}

function CategorySkeleton() {
	return (
		<div className="space-y-1.5 py-1" aria-hidden>
			{[72, 58, 80, 64, 70, 54].map((w) => (
				<Skeleton key={w} className="h-6" style={{ width: `${w}%` }} />
			))}
		</div>
	);
}

/**
 * Le due caselle del prezzo si applicano all'uscita dal campo (o con Invio),
 * non a ogni tasto: una cifra alla volta produrrebbe una ricerca per ogni
 * pressione, e "1", "12", "120" sono tre domande diverse di cui solo l'ultima
 * è quella vera.
 */
function PriceBox({
	label,
	ariaLabel,
	value,
	onCommit,
}: {
	label: string;
	ariaLabel: string;
	value: number | undefined;
	onCommit: (next: number | undefined) => void;
}) {
	const [draft, setDraft] = useState(value === undefined ? "" : String(value));

	// Riallinea quando il valore cambia da fuori (azzera filtri, link aperto).
	useEffect(() => {
		setDraft(value === undefined ? "" : String(value));
	}, [value]);

	const commit = () => {
		const trimmed = draft.trim();
		if (trimmed === "") return onCommit(undefined);
		const parsed = Number(trimmed);
		// Un valore non numerico o negativo non è un filtro: si torna com'era.
		if (!Number.isFinite(parsed) || parsed < 0) {
			setDraft(value === undefined ? "" : String(value));
			return;
		}
		onCommit(parsed);
	};

	return (
		<label className="flex min-w-0 flex-1 items-center gap-1.5">
			<span className="shrink-0 text-muted-foreground text-xs">{label}</span>
			<input
				type="number"
				inputMode="numeric"
				min={0}
				step={1}
				value={draft}
				aria-label={ariaLabel}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						commit();
					}
				}}
				className={`h-11 w-full min-w-0 rounded-md border border-border bg-background px-2 text-sm text-foreground tabular-nums lg:h-9 ${FOCUS_RING} focus-visible:border-primary`}
			/>
		</label>
	);
}

/**
 * Rail dei filtri prodotti: disponibilità, categoria, prezzo e distanza. Lo
 * stesso nodo serve il rail da `lg` e il pannello mobile, quindi non porta
 * larghezza né posizionamento propri.
 */
export function ProductFilters({
	macros,
	total,
	openNowTotal,
	onSaleTotal,
	isPending,
	value,
	hasOrigin,
	originLabel,
	onChooseOrigin,
	onChange,
}: ProductFiltersProps) {
	const { macroCategoryId, categoryId, radius, openNow, onSale, minPrice, maxPrice } =
		value;

	// La macro aperta è quella che contiene la selezione: nessuno stato
	// separato da tenere in sincrono, e l'URL descrive già tutta la vista.
	const expandedMacroId =
		macroCategoryId ??
		macros.find((mc) => mc.categories.some((c) => c.id === categoryId))?.id;

	return (
		<div className="space-y-7">
			<FilterSection title={m.product_filter_availability()}>
				{isPending ? (
					<Skeleton className="h-6 w-2/5" />
				) : (
					<div className="-mx-2">
						<ToggleRow
							icon={Clock}
							label={m.product_open_now()}
							count={openNowTotal}
							active={openNow === true}
							// A zero il filtro garantisce la lista vuota; resta cliccabile
							// solo se è già acceso, altrimenti non si potrebbe spegnere.
							disabled={openNowTotal === 0 && openNow !== true}
							onClick={() => onChange({ ...value, openNow: !openNow })}
						/>
						{openNowTotal === 0 && (
							<p className="px-2 pt-1 text-muted-foreground text-xs leading-relaxed">
								{m.product_open_now_none()}
							</p>
						)}
						<ToggleRow
							icon={Tag}
							label={m.product_on_sale()}
							count={onSaleTotal}
							active={onSale === true}
							disabled={onSaleTotal === 0 && onSale !== true}
							onClick={() => onChange({ ...value, onSale: !onSale })}
						/>
						{onSaleTotal === 0 && (
							<p className="px-2 pt-1 text-muted-foreground text-xs leading-relaxed">
								{m.product_on_sale_none()}
							</p>
						)}
					</div>
				)}
			</FilterSection>

			<FilterSection title={m.product_filter_category()}>
				{isPending ? (
					<CategorySkeleton />
				) : (
					<div className="-mx-2">
						<CategoryRow
							label={m.product_category_all()}
							count={total}
							active={!macroCategoryId && !categoryId}
							depth={0}
							onClick={() =>
								onChange({ ...value, macroCategoryId: undefined, categoryId: undefined })
							}
						/>
						{macros.map((macro) => {
							const isExpanded = expandedMacroId === macro.id;
							const isActive = macroCategoryId === macro.id && !categoryId;
							return (
								<div key={macro.id}>
									<CategoryRow
										label={macro.name}
										count={macro.productCount}
										active={isActive}
										depth={0}
										expandable
										expanded={isExpanded}
										onClick={() =>
											onChange({
												...value,
												// Ri-cliccare la macro già selezionata la chiude e torna
												// a "Tutte": un solo gesto per aprire e per annullare.
												macroCategoryId: isActive ? undefined : macro.id,
												categoryId: undefined,
											})
										}
									/>
									{isExpanded &&
										macro.categories.map((category) => (
											<CategoryRow
												key={category.id}
												label={category.name}
												count={category.productCount}
												active={categoryId === category.id}
												depth={1}
												onClick={() =>
													onChange({
														...value,
														macroCategoryId: macro.id,
														categoryId:
															categoryId === category.id ? undefined : category.id,
													})
												}
											/>
										))}
								</div>
							);
						})}
					</div>
				)}
			</FilterSection>

			<FilterSection title={m.product_filter_price()}>
				<div className="flex items-center gap-2">
					<PriceBox
						label={m.product_price_min()}
						ariaLabel={m.product_price_min_aria()}
						value={minPrice}
						onCommit={(next) => onChange({ ...value, minPrice: next })}
					/>
					<PriceBox
						label={m.product_price_max()}
						ariaLabel={m.product_price_max_aria()}
						value={maxPrice}
						onCommit={(next) => onChange({ ...value, maxPrice: next })}
					/>
				</div>
				<p className="text-muted-foreground text-xs leading-relaxed">
					{m.product_price_hint()}
				</p>
			</FilterSection>

			<FilterSection title={m.product_filter_distance()}>
				{hasOrigin ? (
					<p className="flex items-center gap-1.5 text-saffron-deep text-xs dark:text-saffron">
						<LocateFixed className="size-3.5 shrink-0" aria-hidden />
						{m.origin_distances_from({ label: originLabel })}
					</p>
				) : (
					<div className="space-y-2.5">
						<p className="text-muted-foreground text-xs leading-relaxed">
							{m.product_distance_needs_origin()}
						</p>
						<Button
							variant="secondary"
							size="sm"
							className="min-h-11 sm:min-h-9"
							onClick={onChooseOrigin}
						>
							<MapPin className="size-4" aria-hidden />
							{m.origin_choose()}
						</Button>
					</div>
				)}

				<div className="grid grid-cols-3 gap-2 pt-1 lg:flex lg:flex-wrap lg:gap-1.5">
					<RadiusPill
						label={m.product_radius_any()}
						active={hasOrigin && radius === undefined}
						disabled={!hasOrigin}
						onClick={() => onChange({ ...value, radius: undefined })}
					/>
					{PRODUCT_RADIUS_PRESETS.map((km) => (
						<RadiusPill
							key={km}
							label={m.product_radius_km({ km })}
							active={hasOrigin && radius === km}
							disabled={!hasOrigin}
							onClick={() => onChange({ ...value, radius: km })}
						/>
					))}
				</div>
			</FilterSection>
		</div>
	);
}

function RadiusPill({
	label,
	active,
	disabled,
	onClick,
}: {
	label: string;
	active: boolean;
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`inline-flex min-h-11 items-center justify-center rounded-full border px-3 font-medium text-xs transition-colors disabled:cursor-not-allowed lg:min-h-7 lg:px-2.5 ${FOCUS_RING} ${
				active
					? "border-primary bg-primary text-primary-foreground"
					: "border-border text-muted-foreground enabled:hover:border-primary/40 enabled:hover:text-foreground disabled:border-dashed"
			}`}
		>
			{label}
		</button>
	);
}
```

- [ ] **Step 3: Verifica**

```bash
cd apps/customer && bun run typecheck
```

Atteso: verde. (Il componente non ha ancora consumatori.) Se paraglide protesta
su una chiave mancante, controlla di averla messa in **entrambi** i file dei
messaggi.

- [ ] **Step 4: Commit**

```bash
git add apps/customer/src/features/catalog/product-filters.tsx apps/customer/messages
git commit -m "$(cat <<'MSG'
feat(customer): rail dei filtri prodotti

Disponibilita' (aperti ora, in offerta), categoria, prezzo e distanza. Il
prezzo si applica all'uscita dal campo: una cifra alla volta sarebbe una
ricerca per ogni tasto.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 11: Il tile con il negozio

**Files:**
- Modify: `apps/customer/src/features/catalog/product-tile.tsx`
- Modify: `apps/customer/src/features/discovery/nearby-products.tsx`
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json`

**Interfaces:**
- Consumes: niente di nuovo.
- Produces: `ProductCardData` guadagna
  `store?: { id: string; name: string; city: string; province: string }`,
  `otherStoreCount?: number`, e `distance?: number | null`.

- [ ] **Step 1: Aggiungi le chiavi i18n**

`it.json`:

```json
	"product_other_stores": "anche in altri {count} negozi",
	"product_other_stores_one": "anche in un altro negozio",
	"product_store_link_aria": "Vai alla scheda di {store}",
```

`en.json`: `"also in {count} other shops"`, `"also in one other shop"`,
`"Go to {store}'s page"`.

- [ ] **Step 2: Estendi il tile**

In `apps/customer/src/features/catalog/product-tile.tsx`, sostituisci
l'interfaccia, il commento del componente e il corpo del blocco di testo:

```tsx
import { DiscountedPrice } from "@bibs/ui/components/discounted-price";
import { Link } from "@tanstack/react-router";
import { MapPin, Store as StoreIcon } from "lucide-react";
import type { ReactNode } from "react";
import { formatDistance, TileImage } from "@/components/tile";
import { m } from "@/paraglide/messages";

/** Forma dati minima per un tile prodotto (ricerca, discovery o catalogo negozio). */
export interface ProductCardData {
	id: string;
	name: string;
	price: string;
	images: { url: string }[];
	discountedPrice: string | null;
	discountPercent: number | null;
	/** Distanza in metri dal punto di ricerca; assente o null quando non geo-rilevante. */
	distance?: number | null;
	/**
	 * Il negozio agganciato al risultato. Assente nel catalogo di una scheda
	 * negozio: lì il negozio è la pagina, ripeterlo su ogni tile è rumore.
	 */
	store?: { id: string; name: string; city: string; province: string };
	/** Altri negozi che hanno il prodotto fra quelli filtrati. */
	otherStoreCount?: number;
}

interface ProductTileProps {
	product: ProductCardData;
	/** Mostra la pill della distanza (solo quando c'è una posizione). */
	showDistance: boolean;
	/**
	 * Azione opzionale sotto il prezzo. Dove il negozio è agganciato al
	 * risultato, qui va `AddToCart` con il suo `storeProductId`.
	 */
	action?: ReactNode;
}

/**
 * Tile prodotto presentazionale. Il tile nel suo complesso non è un link: non
 * esiste ancora una pagina di dettaglio prodotto, e un controllo morto è
 * peggio di nessun controllo. L'unico link è il nome del negozio, che porta
 * alla sua scheda.
 */
export function ProductTile({ product, showDistance, action }: ProductTileProps) {
	const cover = product.images[0]?.url;
	const hasDistance = showDistance && (product.distance ?? 0) > 0;
	const others = product.otherStoreCount ?? 0;

	return (
		<article className="flex h-full flex-col gap-3">
			<div className="relative aspect-square overflow-hidden rounded-lg border border-border">
				<TileImage url={cover} name={product.name} />
				{hasDistance && (
					<span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-cream px-2 py-1 font-medium font-mono text-ink text-xs tabular-nums shadow-sm">
						<MapPin className="size-3 text-saffron-deep" aria-hidden />
						{formatDistance(product.distance ?? 0)}
					</span>
				)}
			</div>
			<div className="flex flex-1 flex-col gap-1">
				<h3 className="line-clamp-2 font-medium text-[0.9375rem] text-foreground leading-snug">
					{product.name}
				</h3>
				<DiscountedPrice
					size="sm"
					className="font-semibold text-foreground tabular-nums"
					originalPrice={product.price}
					discountedPrice={product.discountedPrice}
					percent={product.discountPercent}
				/>
				{product.store && (
					<p className="mt-0.5 flex min-w-0 items-start gap-1 text-muted-foreground text-xs leading-snug">
						<StoreIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
						<span className="min-w-0">
							<Link
								to="/stores/$storeId"
								params={{ storeId: product.store.id }}
								aria-label={m.product_store_link_aria({ store: product.store.name })}
								className="rounded-sm font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-2 focus-visible:ring-saffron"
							>
								{product.store.name}
							</Link>
							<span className="text-muted-foreground">
								{" — "}
								{product.store.city} ({product.store.province})
							</span>
							{others > 0 && (
								<span className="block">
									{others === 1
										? m.product_other_stores_one()
										: m.product_other_stores({ count: others })}
								</span>
							)}
						</span>
					</p>
				)}
				{action ? <div className="mt-auto pt-3">{action}</div> : null}
			</div>
		</article>
	);
}
```

- [ ] **Step 3: Mostra il negozio anche in home**

In `apps/customer/src/features/discovery/nearby-products.tsx`, nel `map` dei
prodotti il tile torna a ricevere il prodotto così com'è: dal Task 5
`NearbyProduct` ha già `store` nella forma che `ProductCardData` si aspetta, e
adesso il tile accetta anche `distance: number | null`.

```tsx
							<ProductTile product={product} showDistance={coords !== null} />
```

Sparisce quindi il `distance: product.distance ?? undefined` messo lì dal
Task 5. Niente `action`: la home resta scoperta, si agisce su `/products`.

- [ ] **Step 4: Verifica**

```bash
cd apps/customer && bun run typecheck && bun run build
```

Atteso: verde. Con `bun run dev`, la home su `http://localhost:3001/` mostra
il nome del negozio sotto ogni prodotto, e cliccarlo porta alla sua scheda.

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/features/catalog/product-tile.tsx \
        apps/customer/src/features/discovery/nearby-products.tsx \
        apps/customer/messages
git commit -m "$(cat <<'MSG'
feat(customer): identita' del negozio sul tile prodotto

Nome del negozio linkato alla sua scheda e "anche in altri N negozi".
Chiude un arretrato di #130: in home i tile non dicevano da chi.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 12: La pagina `/products`

**Files:**
- Create: `apps/customer/src/routes/_authenticated/products/index.tsx`
- Modify: `apps/customer/src/routeTree.gen.ts` (rigenerato)
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json`

**Interfaces:**
- Consumes: `SearchField`, `useSearchTextParam` (Task 8), `useNearParam` (Task 8),
  `useProductSearch`, `useProductFacets` (Task 9), `ProductFilters`,
  `ProductFilterValue` (Task 10), `ProductTile` (Task 11), `AddToCart`,
  `useSearchOrigin`, `originLabel`.
- Produces: la rotta `/products` (usata dal Task 13).

- [ ] **Step 1: Aggiungi le chiavi i18n**

`it.json`:

```json
	"product_list_title": "Prodotti",
	"product_list_subtitle": "Trova cosa comprare nei negozi vicino a te.",
	"product_search_placeholder": "Cerca un prodotto…",
	"product_search_aria": "Cerca prodotti",
	"product_search_clear": "Cancella la ricerca",
	"product_results_count": "{count} prodotti",
	"product_results_count_one": "1 prodotto",
	"product_filters": "Filtri",
	"product_clear_filters": "Azzera filtri",
	"product_within_km": "entro {km} km",
	"product_loading": "Caricamento…",
	"product_load_more": "Carica altri",
	"product_retry": "Riprova",
	"product_load_error_title": "Non siamo riusciti a caricare i prodotti",
	"product_load_error_description": "Qualcosa è andato storto. Riprova tra un momento.",
	"product_no_results_title": "Nessun risultato",
	"product_no_results_description": "Nessun prodotto corrisponde alla tua ricerca. Prova con un'altra parola o allarga i filtri.",
	"product_explore_title": "Esplora i prodotti",
	"product_explore_description": "Non ci sono ancora prodotti da mostrare. Torna a trovarci presto.",
```

`en.json`: `"Products"`, `"Find what to buy in shops near you."`,
`"Search for a product…"`, `"Search products"`, `"Clear the search"`,
`"{count} products"`, `"1 product"`, `"Filters"`, `"Clear filters"`,
`"within {km} km"`, `"Loading…"`, `"Load more"`, `"Retry"`,
`"We couldn't load the products"`, `"Something went wrong. Try again in a moment."`,
`"No results"`, `"No product matches your search. Try another word or widen the filters."`,
`"Explore products"`, `"There are no products to show yet. Come back soon."`.

- [ ] **Step 2: Scrivi la pagina**

```tsx
// apps/customer/src/routes/_authenticated/products/index.tsx
import { Button } from "@bibs/ui/components/button";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@bibs/ui/components/sheet";
import { createFileRoute } from "@tanstack/react-router";
import { Compass, RotateCw, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Notice } from "@/components/notice";
import { PAGE_CONTAINER } from "@/components/page";
import { TileSkeleton } from "@/components/tile";
import { AddToCart } from "@/features/cart/add-to-cart";
import type { ProductFilterValue } from "@/features/catalog/product-filters";
import { ProductFilters } from "@/features/catalog/product-filters";
import { ProductTile } from "@/features/catalog/product-tile";
import { useProductFacets } from "@/features/catalog/use-product-facets";
import { useProductSearch } from "@/features/catalog/use-product-search";
import { originLabel } from "@/features/location/origin-label";
import { useNearParam } from "@/features/location/use-near-param";
import { useSearchOrigin } from "@/features/location/search-origin";
import { SearchField } from "@/features/search/search-field";
import { useSearchTextParam } from "@/features/search/use-search-text-param";
import { m } from "@/paraglide/messages";

/**
 * Rail a sinistra e risultati a destra da `lg`; sotto, i filtri finiscono in
 * un pannello. `items-start` tiene il rail alla sua altezza invece di stirarlo
 * per tutta la colonna dei risultati. Stesse misure di `/stores`: sono la
 * stessa pagina vista da un'altra angolazione, e due larghezze diverse si
 * noterebbero passando dall'una all'altra.
 */
const LAYOUT_GRID =
	"grid items-start gap-x-8 gap-y-6 lg:grid-cols-[16rem_minmax(0,1fr)] xl:gap-x-10 xl:grid-cols-[17rem_minmax(0,1fr)]";

/** La griglia vive in una colonna più stretta della pagina: container query, non viewport. */
const RESULTS_GRID =
	"grid grid-cols-2 gap-x-4 gap-y-6 @xl:grid-cols-3 @4xl:grid-cols-4";

/** Tutti i parametri sono opzionali: `/products` nudo è una vista valida. */
interface ProductSearchParams {
	q?: string;
	categoryId?: string;
	macroCategoryId?: string;
	radius?: number;
	openNow?: boolean;
	onSale?: boolean;
	minPrice?: number;
	maxPrice?: number;
	/**
	 * Da dove si cerca: `gps` o l'id di un indirizzo. Mai coordinate — un link
	 * condiviso non deve dire dove abiti.
	 */
	near?: string;
}

export const Route = createFileRoute("/_authenticated/products/")({
	validateSearch: (search: Record<string, unknown>): ProductSearchParams => ({
		q: typeof search.q === "string" ? search.q : undefined,
		categoryId: typeof search.categoryId === "string" ? search.categoryId : undefined,
		macroCategoryId:
			typeof search.macroCategoryId === "string" ? search.macroCategoryId : undefined,
		radius: typeof search.radius === "number" ? search.radius : undefined,
		// `false` esce dall'URL: un filtro spento non è uno stato da descrivere.
		openNow: search.openNow === true ? true : undefined,
		onSale: search.onSale === true ? true : undefined,
		minPrice: typeof search.minPrice === "number" ? search.minPrice : undefined,
		maxPrice: typeof search.maxPrice === "number" ? search.maxPrice : undefined,
		near: typeof search.near === "string" ? search.near : undefined,
	}),
	component: ProductsPage,
});

function ProductsPage() {
	const navigate = Route.useNavigate();
	const {
		q,
		categoryId,
		macroCategoryId,
		radius,
		openNow,
		onSale,
		minPrice,
		maxPrice,
		near,
	} = Route.useSearch();
	const [filtersOpen, setFiltersOpen] = useState(false);
	const { origin, coords, geoStatus, setPickerOpen } = useSearchOrigin();

	const [text, setText] = useSearchTextParam(q, (next) => {
		void navigate({ search: (prev) => ({ ...prev, q: next }), replace: true });
	});

	useNearParam(near, (next) => {
		void navigate({ search: (prev) => ({ ...prev, near: next }), replace: true });
	});

	const facets = useProductFacets({
		q,
		coords,
		radius,
		openNow,
		onSale,
		minPrice,
		maxPrice,
	});

	const {
		products,
		total,
		hasNextPage,
		fetchNextPage,
		isFetchingNextPage,
		isPending,
		isError,
		refetch,
	} = useProductSearch({
		q,
		categoryId,
		macroCategoryId,
		coords,
		radius,
		openNow,
		onSale,
		minPrice,
		maxPrice,
	});

	const filterValue: ProductFilterValue = {
		macroCategoryId,
		categoryId,
		radius,
		openNow,
		onSale,
		minPrice,
		maxPrice,
	};

	// Senza posizione il raggio non viene inviato: contarlo fra i filtri attivi
	// annuncerebbe una restrizione che i risultati non hanno.
	const radiusApplies = radius !== undefined && coords !== null;
	const activeFilterCount =
		(categoryId || macroCategoryId ? 1 : 0) +
		(radiusApplies ? 1 : 0) +
		(openNow ? 1 : 0) +
		(onSale ? 1 : 0) +
		(minPrice !== undefined || maxPrice !== undefined ? 1 : 0);
	const hasQuery = Boolean(q) || activeFilterCount > 0;

	const applyFilters = (next: ProductFilterValue) => {
		void navigate({
			search: (prev) => ({
				...prev,
				macroCategoryId: next.macroCategoryId,
				categoryId: next.categoryId,
				radius: next.radius,
				openNow: next.openNow || undefined,
				onSale: next.onSale || undefined,
				minPrice: next.minPrice,
				maxPrice: next.maxPrice,
			}),
			replace: true,
		});
	};

	const clearFilters = () =>
		applyFilters({
			macroCategoryId: undefined,
			categoryId: undefined,
			radius: undefined,
			openNow: undefined,
			onSale: undefined,
			minPrice: undefined,
			maxPrice: undefined,
		});

	const filters = (
		<ProductFilters
			macros={facets.macros}
			total={facets.total}
			openNowTotal={facets.openNowTotal}
			onSaleTotal={facets.onSaleTotal}
			isPending={facets.isPending}
			value={filterValue}
			hasOrigin={coords !== null}
			originLabel={originLabel(origin, geoStatus)}
			onChooseOrigin={() => setPickerOpen(true)}
			onChange={applyFilters}
		/>
	);

	// Nome del filtro attivo per la riga dei risultati: sotto `lg` è l'unico
	// posto in cui si legge cosa è selezionato, il rail è chiuso.
	const activeMacro = facets.macros.find((mc) => mc.id === macroCategoryId);
	const activeCategoryName =
		activeMacro?.categories.find((c) => c.id === categoryId)?.name ??
		facets.macros.flatMap((mc) => mc.categories).find((c) => c.id === categoryId)?.name;
	const scopeLabel = activeCategoryName ?? activeMacro?.name;

	const results = isPending ? (
		<div className={RESULTS_GRID} aria-hidden>
			{Array.from({ length: 8 }, (_, i) => (
				<TileSkeleton key={`tile-skeleton-${i}`} />
			))}
		</div>
	) : isError ? (
		<Notice
			icon={RotateCw}
			title={m.product_load_error_title()}
			description={m.product_load_error_description()}
			action={
				<Button variant="secondary" size="sm" onClick={() => refetch()}>
					<RotateCw className="size-4" aria-hidden />
					{m.product_retry()}
				</Button>
			}
		/>
	) : products.length === 0 ? (
		<Notice
			icon={Compass}
			title={hasQuery ? m.product_no_results_title() : m.product_explore_title()}
			description={
				hasQuery ? m.product_no_results_description() : m.product_explore_description()
			}
			action={
				activeFilterCount > 0 ? (
					<Button variant="secondary" size="sm" onClick={clearFilters}>
						{m.product_clear_filters()}
					</Button>
				) : undefined
			}
		/>
	) : (
		<>
			<ul className={RESULTS_GRID}>
				{products.map((product) => (
					<li key={product.id}>
						<ProductTile
							product={product}
							showDistance={coords !== null}
							action={
								<AddToCart
									storeProductId={product.storeProductId}
									stock={product.stock}
									productName={product.name}
								/>
							}
						/>
					</li>
				))}
			</ul>
			{hasNextPage && (
				<div className="mt-8 flex justify-center">
					<Button
						variant="secondary"
						onClick={() => fetchNextPage()}
						disabled={isFetchingNextPage}
					>
						{isFetchingNextPage ? m.product_loading() : m.product_load_more()}
					</Button>
				</div>
			)}
		</>
	);

	return (
		<div className={`${PAGE_CONTAINER} py-8 sm:py-10`}>
			<section className="space-y-1">
				<h1 className="font-bold font-display text-2xl text-primary tracking-[-0.015em]">
					{m.product_list_title()}
				</h1>
				<p className="text-muted-foreground text-sm">{m.product_list_subtitle()}</p>
			</section>

			<div className="mt-6">
				<SearchField
					value={text}
					onChange={setText}
					placeholder={m.product_search_placeholder()}
					ariaLabel={m.product_search_aria()}
					clearLabel={m.product_search_clear()}
				/>
			</div>

			<div className={`mt-8 ${LAYOUT_GRID}`}>
				<aside className="max-lg:hidden">{filters}</aside>

				<div className="@container min-w-0">
					<div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
						<div className="flex min-w-0 items-center gap-3">
							<Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
								<SheetTrigger asChild>
									<Button variant="secondary" size="sm" className="lg:hidden">
										<SlidersHorizontal className="size-4" aria-hidden />
										{m.product_filters()}
										{activeFilterCount > 0 && (
											<span className="-mr-1 ml-0.5 inline-flex size-5 items-center justify-center rounded-full bg-primary font-mono text-[0.6875rem] text-primary-foreground tabular-nums">
												{activeFilterCount}
											</span>
										)}
									</Button>
								</SheetTrigger>
								<SheetContent side="left" className="w-[19rem] gap-0 overflow-y-auto">
									<SheetHeader>
										<SheetTitle>{m.product_filters()}</SheetTitle>
									</SheetHeader>
									<div className="px-4 pb-8">{filters}</div>
								</SheetContent>
							</Sheet>
							<p className="min-w-0 text-muted-foreground text-sm">
								{isPending ? (
									<span className="sr-only">{m.product_loading()}</span>
								) : (
									<>
										<span className="font-medium text-foreground">
											{total === 1
												? m.product_results_count_one()
												: m.product_results_count({ count: total })}
										</span>
										{openNow && ` · ${m.product_open_now()}`}
										{onSale && ` · ${m.product_on_sale()}`}
										{scopeLabel && ` · ${scopeLabel}`}
										{radiusApplies && ` · ${m.product_within_km({ km: radius })}`}
									</>
								)}
							</p>
						</div>
						{activeFilterCount > 0 && (
							<button
								type="button"
								onClick={clearFilters}
								className="rounded-md text-primary text-sm underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-2 focus-visible:ring-saffron"
							>
								{m.product_clear_filters()}
							</button>
						)}
					</div>

					<div className="mt-4">{results}</div>
				</div>
			</div>
		</div>
	);
}
```

- [ ] **Step 3: Rigenera e committa l'albero delle rotte**

```bash
cd apps/customer && bun run build
git status --short apps/customer/src/routeTree.gen.ts
```

`routeTree.gen.ts` è generato ma **tracciato**: `tsc` non lo rigenera, quindi
senza il build la CI di typecheck va rossa mentre in locale è verde.
Assicurati che compaia fra i file modificati prima di committare.

- [ ] **Step 4: Verifica**

```bash
cd apps/customer && bun run typecheck && bun run build
```

Con `bun run dev`, apri `http://localhost:3001/products` e controlla che la
pagina renda, che il rail mostri le macro con i conteggi, e che "Aggiungi"
metta davvero la riga nel carrello (la borsa in alto a destra si incrementa).

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/routes/_authenticated/products \
        apps/customer/src/routeTree.gen.ts apps/customer/messages
git commit -m "$(cat <<'MSG'
feat(customer): pagina /products

Ricerca prodotti con rail di facet, filtri nell'URL e "Aggiungi" sul
negozio agganciato al risultato.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 13: Il pivot fra le due ricerche

**Files:**
- Create: `apps/customer/src/features/search/search-tabs.tsx`
- Modify: `apps/customer/src/routes/_authenticated/products/index.tsx`
- Modify: `apps/customer/src/routes/_authenticated/stores/index.tsx`
- Modify: `apps/customer/src/components/site-header.tsx`
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json`

**Interfaces:**
- Consumes: le rotte `/products` (Task 12) e `/stores`.
- Produces: `SearchTabs(props: { q?: string; near?: string; radius?: number; openNow?: boolean })`.

- [ ] **Step 1: Aggiungi le chiavi i18n**

`it.json`: `"search_tabs_label": "Cosa stai cercando"`,
`"search_tab_products": "Prodotti"`, `"search_tab_stores": "Negozi"`,
`"nav_products": "Prodotti"`.
`en.json`: `"What are you looking for"`, `"Products"`, `"Shops"`, `"Products"`.

- [ ] **Step 2: Scrivi il pivot**

```tsx
// apps/customer/src/features/search/search-tabs.tsx
import { Link } from "@tanstack/react-router";
import { m } from "@/paraglide/messages";

interface SearchTabsProps {
	q?: string;
	near?: string;
	radius?: number;
	openNow?: boolean;
}

const TAB =
	"inline-flex min-h-11 items-center justify-center rounded-md px-4 font-medium text-muted-foreground text-sm transition-colors outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-2 focus-visible:ring-saffron data-[status=active]:bg-primary data-[status=active]:text-primary-foreground sm:min-h-9";

/**
 * Passaggio fra le due ricerche. Sono link, non pulsanti: `/products` e
 * `/stores` sono due pagine, e devono restare apribili in una scheda nuova e
 * raggiungibili con indietro.
 *
 * Porta con sé solo ciò che le due ricerche hanno in comune — testo, origine,
 * raggio e "aperti ora". Le categorie no: 14 macro prodotto e 16 macro
 * negozio sono alberi diversi, e un id trasferito non significherebbe niente
 * dall'altra parte.
 */
export function SearchTabs({ q, near, radius, openNow }: SearchTabsProps) {
	const shared = { q, near, radius, openNow };
	return (
		<nav
			aria-label={m.search_tabs_label()}
			className="inline-flex rounded-lg border border-border bg-background p-1"
		>
			<Link to="/products" search={shared} className={TAB}>
				{m.search_tab_products()}
			</Link>
			<Link to="/stores" search={shared} className={TAB}>
				{m.search_tab_stores()}
			</Link>
		</nav>
	);
}
```

- [ ] **Step 3: Montalo su entrambe le pagine**

In `products/index.tsx` e in `stores/index.tsx`, subito **sopra** il
`<SearchField>` (cioè dentro il `<div className="mt-6">`, prima del campo),
inserisci:

```tsx
				<div className="mb-4">
					<SearchTabs q={q} near={near} radius={radius} openNow={openNow} />
				</div>
```

- [ ] **Step 4: Aggiungi la voce di navigazione**

In `apps/customer/src/components/site-header.tsx`, dentro il `<nav>`, prima
del link ai negozi:

```tsx
					<Link
						to="/products"
						search={{ q: undefined, categoryId: undefined }}
						className="rounded-md px-3 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground data-[status=active]:text-foreground"
					>
						{m.nav_products()}
					</Link>
```

- [ ] **Step 5: Verifica**

```bash
cd apps/customer && bun run typecheck && bun run build
```

Con `bun run dev`: da `/products?q=pane` clicca "Negozi" e verifica che l'URL
diventi `/stores?q=pane` con la stessa origine; poi torna indietro col
browser. Prova anche con `Tab` + `Invio`: sono link, devono funzionare da
tastiera.

- [ ] **Step 6: Commit**

```bash
git add apps/customer/src/features/search/search-tabs.tsx \
        apps/customer/src/routes/_authenticated apps/customer/src/components/site-header.tsx \
        apps/customer/messages
git commit -m "$(cat <<'MSG'
feat(customer): pivot fra ricerca prodotti e ricerca negozi

Link, non pulsanti: due pagine devono restare apribili in scheda nuova.
Portano testo, origine, raggio e "aperti ora"; le categorie no, gli alberi
sono diversi.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 14: Verifica e apertura della PR 2

- [ ] **Step 1: Lint, typecheck, test, build**

```bash
cd /Users/marcogelli/repos/jelaz/bibs
bun run lint
(cd apps/customer && bun run typecheck) && echo "customer ok"
(cd apps/seller && bun run typecheck) && echo "seller ok"
(cd apps/admin && bun run typecheck) && echo "admin ok"
(cd apps/api && bun run typecheck && bun run test) && echo "api ok"
(cd apps/customer && bun run build) && echo "build ok"
```

Uno per uno, controllando l'esito di ciascuno.

- [ ] **Step 2: Verifica che `routeTree.gen.ts` sia committato**

```bash
git status --short && git log --oneline -1 -- apps/customer/src/routeTree.gen.ts
```

- [ ] **Step 3: Prepara lo smoke per Marco**

Su `http://localhost:3001`, autenticato come cliente. La lista di cose da
provare — **mouse e tastiera come percorsi distinti**:

1. `/products` nudo: risultati, conteggio, rail con le macro.
2. Digitare nel campo: i risultati cambiano, `?q=` compare, la X pulisce.
3. Ogni filtro, uno per volta: macro, categoria foglia, raggio (dopo aver
   scelto un'origine), "In negozi aperti ora", "Solo in offerta", prezzo
   min/max con Invio **e** uscendo dal campo.
4. "Azzera filtri" riporta l'URL a `/products`.
5. Il pivot verso "Negozi" conserva testo, origine, raggio e "aperti ora".
6. "Aggiungi" su un risultato: la borsa si incrementa, e nel carrello la riga
   sta sotto **il negozio mostrato nel tile**.
7. Il nome del negozio porta alla sua scheda.
8. Larghezza telefono: i filtri nel pannello, nessuno scorrimento
   orizzontale, tap target da 44px.
9. Dark mode (`localStorage.theme = 'dark'`, poi ricarica): niente testo
   invisibile sulle superfici del rail e dei tile.
10. Rete lenta: skeleton, e lo stato d'errore con "Riprova".

**Non dichiarare la PR pronta prima che Marco l'abbia provata:** su UI il gate
è "l'ha vista funzionare", non "i test sono verdi".

- [ ] **Step 4: Apri la PR 2**

```bash
git push
gh pr create --title "feat(customer): ricerca per prodotti" --body "$(cat <<'BODY'
Seconda delle due PR della ricerca prodotti customer. Spec:
`docs/superpowers/specs/2026-09-21-customer-product-search-design.md`.

- Nuova pagina `/products`: rail di facet (categoria, distanza, prezzo, «solo
  in offerta», «in negozi aperti ora»), filtri nell'URL, caricamento a pagine.
- Ogni risultato è un prodotto **agganciato a un negozio**, quindi "Aggiungi"
  funziona dalla lista e il nome del negozio porta alla sua scheda.
- Pivot Prodotti ⇄ Negozi in cima a entrambe le ricerche: porta testo,
  origine, raggio e «aperti ora». Non le categorie — alberi diversi.
- Tre pezzi estratti e condivisi con `/stores`: il campo di ricerca, il
  debounce testo ⇄ URL e la sincronia di `near` con l'origine. Quest'ultima è
  la logica più delicata delle due pagine, e in due copie sarebbe divergita.
- I tile di "Vicino a te" in home mostrano ora il negozio: arretrato di #130.

Smoke fatto nel browser, mouse e tastiera, incluse larghezza telefono e dark
mode.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```
