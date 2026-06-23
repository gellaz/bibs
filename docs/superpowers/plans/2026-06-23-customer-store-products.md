# Customer Store Product Catalog (#2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Prodotti" catalog section to the customer store-detail page, backed by a new public `GET /customer/stores/:id/products` endpoint.

**Architecture:** A dedicated, store-nested endpoint returns the store's active, in-stock products (newest-first) with discount annotation — 404-mirroring the detail endpoint's visibility. The frontend renders a catalog-first section using an extracted, shared `ProductTile` and an infinite-query "Carica altri" hook. No new route file (the `/stores/$storeId` route already exists); no schema migration.

**Tech Stack:** ElysiaJS + Drizzle (PostGIS/PG) on the API; TanStack Router/Query + Eden Treaty + Tailwind on the customer app; `bun:test` + testcontainers harness.

## Global Constraints

- **Copy in Italian.** All user-facing strings are it-IT.
- **Pagination cap = 100.** Reuse `PaginationQuery` (`@/lib/pagination`), which enforces `maxLimit` 100; never raise the limit.
- **`ServiceError` takes exactly `(status, message)`** — no third arg; `ERROR_CODES[status]` determines the code.
- **Drizzle unqualified-column gotcha:** inside an `sql` template used as a SELECT field, interpolated `${table.col}` renders UNqualified. In the correlated images subquery, alias the inner table (`pi`) and reference the outer table **literally** (`products.id`). In `.where()`/`.orderBy()`, `${table.col}` qualification is fine.
- **No new dependencies.** Reuse existing helpers (`getBestActiveDiscounts`, `parsePagination`, `publiclyVisibleStore`, `DiscountedPrice`).
- **`@/*` alias → `apps/customer/src/*`** (NOT `~/*`, which is for `packages/ui`).
- **PR-first workflow.** Already on branch `feat/customer-store-products`; commit per task, never to `main`.
- **DTO has no Date fields** (no `discountEndsAt`) — so the FE hook needs no `toYMD()` coercion.

---

### Task 1: API service `getStoreProducts` (TDD)

Pure data logic: visibility guard (404) + active/in-stock filter + newest-first order + discount annotation. Tested at the service level (mirrors `customer-store-detail.test.ts`).

**Files:**
- Modify: `apps/api/tests/helpers/fixtures.ts` (add `createTestProductImage`)
- Create: `apps/api/tests/integration/customer-store-products.test.ts`
- Create: `apps/api/src/modules/customer/services/store-products.ts`

**Interfaces:**
- Consumes: `getBestActiveDiscounts(ids: string[])` from `@/modules/seller/services/discount-pricing`, `parsePagination`, `publiclyVisibleStore()`, `ServiceError`.
- Produces:
  ```ts
  interface StoreProductCard {
    id: string; name: string; description: string | null; price: string;
    images: { id: string; url: string; position: number }[];
    discountedPrice: string | null; discountPercent: number | null;
  }
  function getStoreProducts(
    storeId: string,
    params: { page?: number; limit?: number },
  ): Promise<{ data: StoreProductCard[]; pagination: { page: number; limit: number; total: number } }>
  ```

- [ ] **Step 1: Add the `createTestProductImage` fixture**

In `apps/api/tests/helpers/fixtures.ts`, add the `product-image` import next to the other db-schema imports near the top:

```ts
import { productImage } from "@/db/schemas/product-image";
```

Then append this helper (e.g. after `createTestStoreProduct`):

```ts
export async function createTestProductImage(
	db: DrizzleTestDb,
	productId: string,
	params: { url?: string; position?: number } = {},
) {
	const unique = crypto.randomUUID().slice(0, 8);
	const [img] = await db
		.insert(productImage)
		.values({
			productId,
			url: params.url ?? `https://img.test/${unique}.jpg`,
			key: `products/${unique}.jpg`,
			position: params.position ?? 0,
		})
		.returning();
	return img;
}
```

- [ ] **Step 2: Write the failing test file**

Create `apps/api/tests/integration/customer-store-products.test.ts`:

```ts
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
import { getStoreProducts } from "@/modules/customer/services/store-products";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestDiscount,
	createTestDiscountProduct,
	createTestProduct,
	createTestProductImage,
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

async function visibleStore(sellerProfileId: string, name = "Negozio") {
	const db = getTestDb();
	const s = await createTestStore(db, sellerProfileId, { name });
	await createTestStoreSubscription(db, s.id, { status: "active" });
	return s;
}

describe("getStoreProducts — visible store", () => {
	it("returns only active, in-stock products of this store, with images + discount", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id);
		const other = await visibleStore(profile.id, "Altro");

		// Included: active + stock>0 here
		const p1 = await createTestProduct(db, profile.id, {
			name: "Incluso",
			price: "10.00",
		});
		await createTestStoreProduct(db, s.id, p1.id, { stock: 5 });
		await createTestProductImage(db, p1.id, {
			url: "https://img.test/b.jpg",
			position: 2,
		});
		await createTestProductImage(db, p1.id, {
			url: "https://img.test/a.jpg",
			position: 0,
		});
		// 20% discount on p1 → 10.00 → 8.00
		const d = await createTestDiscount(db, profile.id, { percent: 20 });
		await createTestDiscountProduct(db, d.id, p1.id);

		// Excluded: stock 0 here
		const p2 = await createTestProduct(db, profile.id, { name: "Esaurito" });
		await createTestStoreProduct(db, s.id, p2.id, { stock: 0 });
		// Excluded: disabled status
		const p3 = await createTestProduct(db, profile.id, {
			name: "Disattivato",
			status: "disabled",
		});
		await createTestStoreProduct(db, s.id, p3.id, { stock: 5 });
		// Excluded: stocked only in another store
		const p4 = await createTestProduct(db, profile.id, { name: "Altrove" });
		await createTestStoreProduct(db, other.id, p4.id, { stock: 5 });

		const result = await getStoreProducts(s.id, {});

		expect(result.data.map((p) => p.name)).toEqual(["Incluso"]);
		expect(result.pagination.total).toBe(1);
		const row = result.data[0];
		// images ordered by position
		expect(row.images.map((i) => i.url)).toEqual([
			"https://img.test/a.jpg",
			"https://img.test/b.jpg",
		]);
		// discount annotated
		expect(row.discountedPrice).toBe("8.00");
		expect(row.discountPercent).toBe(20);
	});

	it("orders products newest-first (created_at desc)", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id);

		const pOld = await createTestProduct(db, profile.id, { name: "Vecchio" });
		const pNew = await createTestProduct(db, profile.id, { name: "Nuovo" });
		await createTestStoreProduct(db, s.id, pOld.id, { stock: 5 });
		await createTestStoreProduct(db, s.id, pNew.id, { stock: 5 });
		await db
			.update(product)
			.set({ createdAt: new Date("2026-01-01T00:00:00Z") })
			.where(eq(product.id, pOld.id));
		await db
			.update(product)
			.set({ createdAt: new Date("2026-06-01T00:00:00Z") })
			.where(eq(product.id, pNew.id));

		const result = await getStoreProducts(s.id, {});
		expect(result.data.map((p) => p.name)).toEqual(["Nuovo", "Vecchio"]);
	});

	it("returns an empty page (200, not 404) for a visible store with no products", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id);
		const result = await getStoreProducts(s.id, {});
		expect(result.data).toEqual([]);
		expect(result.pagination.total).toBe(0);
	});

	it("paginates: total counts all, pages slice", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id);
		for (let i = 0; i < 3; i++) {
			const p = await createTestProduct(db, profile.id, { name: `P${i}` });
			await createTestStoreProduct(db, s.id, p.id, { stock: 5 });
		}
		const page1 = await getStoreProducts(s.id, { page: 1, limit: 2 });
		const page2 = await getStoreProducts(s.id, { page: 2, limit: 2 });
		expect(page1.pagination.total).toBe(3);
		expect(page1.data).toHaveLength(2);
		expect(page2.data).toHaveLength(1);
		// no overlap
		const ids = new Set([...page1.data, ...page2.data].map((p) => p.id));
		expect(ids.size).toBe(3);
	});
});

describe("getStoreProducts — visibility (404)", () => {
	it("404 for a non-existent id", async () => {
		await expect(getStoreProducts("does-not-exist", {})).rejects.toThrow(
			"Negozio non trovato",
		);
	});

	it("404 for a store with no subscription", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await createTestStore(db, profile.id, { name: "SenzaAbbonamento" });
		await expect(getStoreProducts(s.id, {})).rejects.toThrow(
			"Negozio non trovato",
		);
	});

	it("404 for suspended and canceled subscriptions", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const suspended = await createTestStore(db, profile.id, { name: "Sospeso" });
		await createTestStoreSubscription(db, suspended.id, { status: "suspended" });
		const canceled = await createTestStore(db, profile.id, { name: "Cancellato" });
		await createTestStoreSubscription(db, canceled.id, { status: "canceled" });
		await expect(getStoreProducts(suspended.id, {})).rejects.toThrow(
			"Negozio non trovato",
		);
		await expect(getStoreProducts(canceled.id, {})).rejects.toThrow(
			"Negozio non trovato",
		);
	});

	it("404 for a soft-deleted store", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id, "Eliminato");
		await db.update(store).set({ deletedAt: new Date() }).where(eq(store.id, s.id));
		await expect(getStoreProducts(s.id, {})).rejects.toThrow(
			"Negozio non trovato",
		);
	});
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/api && bun test tests/integration/customer-store-products.test.ts --timeout 180000`
Expected: FAIL — cannot resolve `@/modules/customer/services/store-products` (module does not exist yet).

- [ ] **Step 4: Implement the service**

Create `apps/api/src/modules/customer/services/store-products.ts`:

```ts
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { product, storeProduct } from "@/db/schemas/product";
import { productImage } from "@/db/schemas/product-image";
import { store } from "@/db/schemas/store";
import { ServiceError } from "@/lib/errors";
import { parsePagination } from "@/lib/pagination";
import { publiclyVisibleStore } from "@/lib/store-visibility";
import { getBestActiveDiscounts } from "@/modules/seller/services/discount-pricing";

export interface StoreProductCard {
	id: string;
	name: string;
	description: string | null;
	price: string;
	images: { id: string; url: string; position: number }[];
	discountedPrice: string | null;
	discountPercent: number | null;
}

export async function getStoreProducts(
	storeId: string,
	params: { page?: number; limit?: number },
) {
	const { page, limit, offset } = parsePagination(params);

	// Visibility guard, distinct from "empty catalog": a hidden store is 404,
	// a visible store with no products is a 200 with an empty page. The two
	// cases cannot collapse into one query, hence this separate check.
	const [visible] = await db
		.select({ id: store.id })
		.from(store)
		.where(and(eq(store.id, storeId), publiclyVisibleStore()))
		.limit(1);
	if (!visible) throw new ServiceError(404, "Negozio non trovato");

	// active + stocked (>0) in THIS store. The EXISTS lives in WHERE, so the
	// interpolated columns are qualified correctly (unlike a SELECT-field sql).
	const whereClause = sql`
		${product.status} = 'active'
		AND EXISTS (
			SELECT 1 FROM ${storeProduct}
			WHERE ${storeProduct.productId} = ${product.id}
			AND ${storeProduct.storeId} = ${storeId}
			AND ${storeProduct.stock} > 0
		)
	`;

	const [data, [{ total }]] = await Promise.all([
		db
			.select({
				id: product.id,
				name: product.name,
				description: product.description,
				price: product.price,
				// Correlated subquery: alias the inner table (pi) and reference the
				// outer table literally (products.id) — interpolated Columns in a
				// SELECT-field sql render UNqualified and would break correlation.
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
			.where(whereClause)
			.orderBy(sql`${product.createdAt} DESC, ${product.id} ASC`)
			.limit(limit)
			.offset(offset),
		db
			.select({ total: sql<number>`count(*)::int` })
			.from(product)
			.where(whereClause),
	]);

	const productIds = data.map((r) => r.id);
	const discountMap = await getBestActiveDiscounts(productIds);
	const annotated: StoreProductCard[] = data.map((r) => {
		const info = discountMap.get(r.id);
		return {
			id: r.id,
			name: r.name,
			description: r.description,
			price: r.price,
			images: r.images,
			discountedPrice: info?.discountedPrice ?? null,
			discountPercent: info?.percent ?? null,
		};
	});

	return { data: annotated, pagination: { page, limit, total } };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/api && bun test tests/integration/customer-store-products.test.ts --timeout 180000`
Expected: PASS — all tests in both describe blocks green.

- [ ] **Step 6: Typecheck the API**

Run: `cd apps/api && bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/tests/helpers/fixtures.ts apps/api/tests/integration/customer-store-products.test.ts apps/api/src/modules/customer/services/store-products.ts
git commit -m "feat(api): getStoreProducts service for store catalog"
```

---

### Task 2: API route `GET /customer/stores/:id/products` + DTO schema

Expose the service over HTTP, alongside `/stores` and `/stores/:id`, with a clean DTO (no `distance`/`rank`).

**Files:**
- Modify: `apps/api/src/lib/schemas/entities.ts` (add `StoreProductCardSchema` near `SearchResultSchema`)
- Modify: `apps/api/src/modules/customer/routes/stores.ts` (add handler + imports)

**Interfaces:**
- Consumes: `getStoreProducts` (Task 1), `PaginationQuery` (`@/lib/pagination`), `okPage`, `okPageRes`, `withErrors`, `StoreProductCardSchema`.
- Produces: `StoreProductCardSchema` (TypeBox) — re-exported automatically via `apps/api/src/lib/schemas/index.ts` (`export * from "./entities"`). The route makes `api().customer.stores({ id }).products.get(...)` available to Eden clients.

- [ ] **Step 1: Add `StoreProductCardSchema`**

In `apps/api/src/lib/schemas/entities.ts`, append after `SearchResultSchema`:

```ts
// Store product card (customer store catalog — #2b). SearchResultSchema minus
// distance/rank: no geo on a store page. No discountTitle/discountEndsAt → no
// Date in the DTO, so the FE needs no toYMD coercion.
export const StoreProductCardSchema = t.Object({
	id: t.String(),
	name: t.String({ description: "Nome del prodotto" }),
	description: t.Nullable(
		t.String({ description: "Descrizione del prodotto" }),
	),
	price: t.String({ description: "Prezzo in formato decimale" }),
	images: t.Array(
		t.Object({
			id: t.String(),
			url: t.String({ description: "URL dell'immagine" }),
			position: t.Number({
				minimum: 0,
				description: "Posizione di ordinamento",
			}),
		}),
		{ description: "Immagini del prodotto ordinate per posizione" },
	),
	discountedPrice: t.Nullable(
		t.String({ description: "Prezzo scontato, se promo attiva" }),
	),
	discountPercent: t.Nullable(t.Integer({ minimum: 1, maximum: 99 })),
});
```

- [ ] **Step 2: Add the route handler**

In `apps/api/src/modules/customer/routes/stores.ts`:

Update the imports — add `PaginationQuery`, `getStoreProducts`, and `StoreProductCardSchema`:

```ts
import { PaginationQuery } from "@/lib/pagination";
import { getStoreProducts } from "../services/store-products";
```

and add `StoreProductCardSchema` to the existing `@/lib/schemas` import (which already pulls `StoreCardSchema`, `StoreDetailSchema`, `okPageRes`, `okRes`, `withErrors`).

Then chain a third `.get(...)` after the `/stores/:id` handler:

```ts
	.get(
		"/stores/:id/products",
		async ({ params, query, store }) => {
			const pino = getLogger(store);
			const result = await getStoreProducts(params.id, query);
			pino.info(
				{
					storeId: params.id,
					resultCount: result.data.length,
					action: "store_products",
				},
				"Catalogo negozio richiesto",
			);
			return okPage(result.data, result.pagination);
		},
		{
			params: t.Object({ id: t.String({ description: "ID del negozio" }) }),
			query: PaginationQuery,
			response: withErrors({ 200: okPageRes(StoreProductCardSchema) }),
			detail: {
				summary: "Catalogo prodotti del negozio",
				description:
					"Prodotti attivi e disponibili (stock > 0) di un negozio pubblicamente visibile, ordinati per novità. Restituisce 404 se il negozio non esiste o non è visibile (sospeso/cancellato/senza abbonamento). Non richiede autenticazione.",
				tags: ["Customer - Search"],
			},
		},
	);
```

(`okPage` and `t` are already imported in this file.)

- [ ] **Step 3: Typecheck the API**

Run: `cd apps/api && bun run typecheck`
Expected: no errors (route wiring + Eden treaty types resolve).

- [ ] **Step 4: Re-run the service test (regression guard)**

Run: `cd apps/api && bun test tests/integration/customer-store-products.test.ts --timeout 180000`
Expected: PASS (unchanged — the route delegates to the tested service).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/schemas/entities.ts apps/api/src/modules/customer/routes/stores.ts
git commit -m "feat(api): GET /customer/stores/:id/products endpoint"
```

---

### Task 3: Extract `ProductTile` to a shared `features/catalog` (refactor)

Pure relocation + generalization so both discovery and the store page consume one tile. No visual change to discovery.

**Files:**
- Create: `apps/customer/src/features/catalog/product-tile.tsx`
- Modify: `apps/customer/src/features/discovery/nearby-products.tsx:4` (import path)
- Delete: `apps/customer/src/features/discovery/product-tile.tsx`

**Interfaces:**
- Produces:
  ```ts
  interface ProductCardData {
    id: string; name: string; price: string;
    images: { url: string }[];
    discountedPrice: string | null; discountPercent: number | null;
    distance?: number; // meters; omit when not geo-relevant
  }
  function ProductTile(props: { product: ProductCardData; showDistance: boolean }): JSX.Element
  ```
  `NearbyProduct` (discovery) and the store hook's mapped shape both structurally satisfy `ProductCardData`.

- [ ] **Step 1: Create the shared tile**

Create `apps/customer/src/features/catalog/product-tile.tsx`:

```tsx
import { DiscountedPrice } from "@bibs/ui/components/discounted-price";
import { MapPin } from "lucide-react";
import { useState } from "react";

/** Forma dati minima per un tile prodotto (discovery o catalogo negozio). */
export interface ProductCardData {
	id: string;
	name: string;
	price: string;
	images: { url: string }[];
	discountedPrice: string | null;
	discountPercent: number | null;
	/** Distanza in metri dal punto di ricerca; assente quando non geo-rilevante. */
	distance?: number;
}

/** Metri → "240 m" / "1,2 km" (convenzione italiana, virgola decimale). */
function formatDistance(meters: number): string {
	if (meters < 1000) {
		return `${Math.round(meters)} m`;
	}
	const km = meters / 1000;
	return `${km.toFixed(1).replace(".", ",")} km`;
}

function TileImage({ url, name }: { url: string | undefined; name: string }) {
	const [failed, setFailed] = useState(false);

	if (!url || failed) {
		// Fallback identitario: l'iniziale del prodotto invece di un'icona
		// generica, così una griglia senza foto resta varia e leggibile.
		const initial = name.trim().charAt(0).toUpperCase() || "?";
		return (
			<div className="flex size-full items-center justify-center bg-muted">
				<span
					aria-hidden
					className="font-display font-semibold text-4xl text-muted-foreground/70"
				>
					{initial}
				</span>
			</div>
		);
	}

	return (
		<img
			src={url}
			alt={name}
			loading="lazy"
			decoding="async"
			onError={() => setFailed(true)}
			className="size-full object-cover"
		/>
	);
}

interface ProductTileProps {
	product: ProductCardData;
	/** Mostra la pill della distanza (solo quando c'è una posizione). */
	showDistance: boolean;
}

/**
 * Tile prodotto presentazionale. Non è un link: non esiste ancora una pagina di
 * dettaglio prodotto (niente controlli morti). Immagine con fallback caldo,
 * nome, prezzo (con sconto se attivo) e — quando rilevante — la distanza in mono.
 */
export function ProductTile({ product, showDistance }: ProductTileProps) {
	const cover = product.images[0]?.url;
	const hasDistance = showDistance && (product.distance ?? 0) > 0;

	return (
		<article className="flex flex-col gap-3">
			<div className="relative aspect-square overflow-hidden rounded-lg border border-border">
				<TileImage url={cover} name={product.name} />
				{hasDistance && (
					<span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-cream px-2 py-1 font-medium font-mono text-ink text-xs tabular-nums shadow-sm">
						<MapPin className="size-3 text-saffron-deep" aria-hidden />
						{formatDistance(product.distance ?? 0)}
					</span>
				)}
			</div>
			<div className="flex flex-col gap-1">
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
			</div>
		</article>
	);
}
```

- [ ] **Step 2: Repoint the discovery import**

In `apps/customer/src/features/discovery/nearby-products.tsx`, change line 4 from:

```tsx
import { ProductTile } from "./product-tile";
```

to:

```tsx
import { ProductTile } from "@/features/catalog/product-tile";
```

- [ ] **Step 3: Delete the old tile**

```bash
git rm apps/customer/src/features/discovery/product-tile.tsx
```

(Confirmed sole importer was `nearby-products.tsx`, repointed in Step 2.)

- [ ] **Step 4: Typecheck + build the customer app**

Run: `cd apps/customer && bun run typecheck && bun run build`
Expected: both succeed. (`NearbyProduct` still structurally satisfies `ProductCardData`; discovery renders unchanged.)

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/features/catalog/product-tile.tsx apps/customer/src/features/discovery/nearby-products.tsx
git commit -m "refactor(customer): extract shared ProductTile to features/catalog"
```

---

### Task 4: Frontend "Prodotti" section (hook + component + wiring)

Catalog-first section on the store page, with its own infinite query, skeleton/error/load-more states, and omit-when-empty behavior.

**Files:**
- Create: `apps/customer/src/features/stores/use-store-products.ts`
- Create: `apps/customer/src/features/stores/store-products.tsx`
- Modify: `apps/customer/src/routes/_authenticated/stores/$storeId.tsx`

**Interfaces:**
- Consumes: `api().customer.stores({ id }).products.get()` (Task 2), `ProductTile` + `ProductCardData` (Task 3).
- Produces: `useStoreProducts(storeId)` → `{ products: ProductCardData[]; hasNextPage; fetchNextPage; isFetchingNextPage; isPending; isError; refetch }`; `<StoreProducts storeId={string} />` section component.

- [ ] **Step 1: Create the infinite-query hook**

Create `apps/customer/src/features/stores/use-store-products.ts`:

```ts
import { useInfiniteQuery } from "@tanstack/react-query";
import type { ProductCardData } from "@/features/catalog/product-tile";
import { api } from "@/lib/api";

/**
 * Catalogo prodotti di un negozio, via endpoint pubblico
 * `/customer/stores/:id/products`. Paginazione "Carica altri" (infinite query).
 * Nessuna distanza (sei già sul negozio) e nessuna data nel DTO → mappatura
 * diretta sulla forma stabile del tile, senza coercion.
 */
export function useStoreProducts(storeId: string, limit = 12) {
	const query = useInfiniteQuery({
		queryKey: ["store-products", storeId, limit],
		staleTime: 60_000,
		initialPageParam: 1,
		queryFn: async ({ pageParam }) => {
			const { data, error } = await api()
				.customer.stores({ id: storeId })
				.products.get({ query: { page: pageParam, limit } });
			if (error) {
				throw new Error(`Caricamento prodotti non riuscito (${error.status})`);
			}
			return data;
		},
		getNextPageParam: (lastPage) => {
			const { page, limit: lim, total } = lastPage.pagination;
			return page * lim < total ? page + 1 : undefined;
		},
	});

	const products: ProductCardData[] =
		query.data?.pages.flatMap((p) =>
			p.data.map((prod) => ({
				id: prod.id,
				name: prod.name,
				price: prod.price,
				images: prod.images.map((img) => ({ url: img.url })),
				discountedPrice: prod.discountedPrice,
				discountPercent: prod.discountPercent,
			})),
		) ?? [];

	return {
		products,
		hasNextPage: query.hasNextPage,
		fetchNextPage: query.fetchNextPage,
		isFetchingNextPage: query.isFetchingNextPage,
		isPending: query.isPending,
		isError: query.isError,
		refetch: query.refetch,
	};
}
```

- [ ] **Step 2: Create the section component**

Create `apps/customer/src/features/stores/store-products.tsx`:

```tsx
import { Button } from "@bibs/ui/components/button";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { RotateCw } from "lucide-react";
import { ProductTile } from "@/features/catalog/product-tile";
import { useStoreProducts } from "./use-store-products";

const GRID = "grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4";

function TileSkeleton() {
	return (
		<div className="flex flex-col gap-3">
			<Skeleton className="aspect-square rounded-lg" />
			<div className="flex flex-col gap-1.5">
				<Skeleton className="h-4 w-4/5" />
				<Skeleton className="h-4 w-1/3" />
			</div>
		</div>
	);
}

export function StoreProducts({ storeId }: { storeId: string }) {
	const {
		products,
		hasNextPage,
		fetchNextPage,
		isFetchingNextPage,
		isPending,
		isError,
		refetch,
	} = useStoreProducts(storeId);

	// Catalogo vuoto: ometti del tutto la sezione (coerente con le altre sezioni
	// condizionali della scheda), niente box vuoto come prima cosa sotto la cover.
	if (!isPending && !isError && products.length === 0) return null;

	return (
		<section className="space-y-3">
			<h2 className="font-display font-semibold text-foreground text-lg">
				Prodotti
			</h2>

			{isPending ? (
				<div className={GRID} aria-hidden>
					{Array.from({ length: 6 }, (_, i) => (
						<TileSkeleton key={`product-skeleton-${i}`} />
					))}
				</div>
			) : isError ? (
				<div className="flex flex-col items-center gap-4 rounded-xl border border-border border-dashed px-6 py-12 text-center">
					<p className="text-muted-foreground text-sm">
						Non siamo riusciti a caricare i prodotti.
					</p>
					<Button variant="secondary" size="sm" onClick={() => refetch()}>
						<RotateCw className="size-4" aria-hidden />
						Riprova
					</Button>
				</div>
			) : (
				<>
					<ul className={GRID}>
						{products.map((product) => (
							<li key={product.id}>
								<ProductTile product={product} showDistance={false} />
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
								{isFetchingNextPage ? "Caricamento…" : "Carica altri"}
							</Button>
						</div>
					)}
				</>
			)}
		</section>
	);
}
```

- [ ] **Step 3: Wire the section into the store page (catalog-first)**

In `apps/customer/src/routes/_authenticated/stores/$storeId.tsx`:

Add the import near the other feature imports (top of file):

```tsx
import { StoreProducts } from "@/features/stores/store-products";
```

Then make `<StoreProducts>` the **first** child of the `max-w-3xl` container — insert it immediately after the opening `<div className="mx-auto max-w-3xl space-y-8 px-4 py-8">` and before the gallery block `{store.images.length > 1 && (`:

```tsx
				<div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
					<StoreProducts storeId={store.id} />

					{store.images.length > 1 && (
```

(Leave the rest of the container — gallery, description, orari, map, contatti — unchanged below it.)

- [ ] **Step 4: Typecheck + build the customer app**

Run: `cd apps/customer && bun run typecheck && bun run build`
Expected: both succeed.

- [ ] **Step 5: Browser smoke (manual, customer dev — authenticated)**

With the API and customer dev servers running (api:3000, customer:3001), log in as the customer dev user and open a visible store's detail page (`/stores/<id>`). Verify:
- The **Prodotti** grid appears **first under the cover**, above the gallery/description.
- A store with many products shows **"Carica altri"**, which appends the next page.
- Discounted products render the struck original + discounted price.
- A store with **no** in-stock products shows **no** Prodotti section (not an empty box).
- Dark mode (`localStorage.theme='dark'`) keeps the tiles legible.

- [ ] **Step 6: Commit**

```bash
git add apps/customer/src/features/stores/use-store-products.ts apps/customer/src/features/stores/store-products.tsx apps/customer/src/routes/_authenticated/stores/\$storeId.tsx
git commit -m "feat(customer): store product catalog section on store detail"
```

---

## Self-Review

**1. Spec coverage:**
- Dedicated `GET /customer/stores/:id/products`, 404-mirroring → Tasks 1–2. ✓
- In-stock (`stock>0`) + `status='active'`, this store only → Task 1 service + tests. ✓
- Newest-first ordering → Task 1 (order test + service). ✓
- `getBestActiveDiscounts` annotation, images subquery → Task 1. ✓
- Clean DTO (no distance/rank, no Date) → Task 2 `StoreProductCardSchema`. ✓
- 404 vs 200-empty distinction → Task 1 (separate guard + empty-page test). ✓
- Catalog-first placement → Task 4 Step 3. ✓
- Omit-when-empty → Task 4 Step 2 (`return null`). ✓
- "Carica altri" pagination → Task 4 (infinite query + button). ✓
- Shared `ProductTile` in `features/catalog` → Task 3. ✓
- Deferred `publiclyVisibleStore()`-in-search fix → NOT touched (correct). ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code; every command has expected output. ✓

**3. Type consistency:** `getStoreProducts(storeId, {page?,limit?})` and `StoreProductCard` are identical across Task 1 (def), Task 2 (route consumer), and the DTO `StoreProductCardSchema`. `ProductCardData` defined in Task 3 is consumed verbatim in Task 4's hook + component. `useStoreProducts` return shape matches `StoreProducts`'s destructuring. ✓
