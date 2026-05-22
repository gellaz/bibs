# Seller Stock Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Esporre nell'app seller la gestione completa dello stock per-negozio: cella inline editabile su `/products` con stepper +/- atomici, dialog di assegnazione cross-store, refactor del dettaglio prodotto scoped sull'active store, bulk adjust dalla toolbar.

**Architecture:** L'API espone due nuovi endpoint (delta atomico singolo + bulk best-effort), tutti coperti dal guard `ensureStoreAccess` esistente. Il frontend aggiunge un componente `StockEditorCell` riusato in lista e dettaglio, con UI ottimistica + debounce 500ms per coalescere click rapidi in un singolo POST. Lo schema DB non cambia.

**Tech Stack:** Elysia + TypeBox + Drizzle (API), TanStack Router + TanStack Query + Eden Treaty + shadcn (seller), Paraglide (i18n), Bun test (integration).

**Spec:** `docs/superpowers/specs/2026-05-21-seller-stock-management-design.md`
**Branch:** `feat/seller-stock-management`

---

## File structure

### Backend (`apps/api`)

| File | Tipo | Responsabilità |
|---|---|---|
| `src/lib/schemas/stock.ts` | NUOVO | TypeBox schemas: `StockAdjustBody`, `StockBulkAdjustBody`, `StockBulkAdjustResult` |
| `src/lib/schemas/index.ts` | MODIFY | Re-export di `./stock` |
| `src/modules/seller/services/stock.ts` | MODIFY | Aggiungere `adjustStock`, `bulkAdjustStock` |
| `src/modules/seller/routes/stock.ts` | MODIFY | Aggiungere `POST .../stock-adjust` e `POST .../bulk/stock-adjust` |
| `src/modules/seller/services/products.ts` | MODIFY | Estendere `ProductSortField` con `"stock"` e supportarlo in `orderByClauses` |
| `src/modules/seller/routes/products.ts` | MODIFY | Aggiungere `"stock"` al `t.Union` del query param `sort` |
| `tests/integration/seller-product-stock.test.ts` | NUOVO | Test integrazione service stock |
| `tests/integration/seller-products-filters.test.ts` | MODIFY | Aggiungere casi `sort=stock` |

### Frontend (`apps/seller`)

| File | Tipo | Responsabilità |
|---|---|---|
| `src/features/products/hooks/use-stock-adjust-mutation.ts` | NUOVO | Hook `adjust` + `set` con cache patching |
| `src/features/products/hooks/use-bulk-stock-adjust-mutation.ts` | NUOVO | Hook bulk con toast aggregato |
| `src/features/products/components/stock-editor-cell.tsx` | NUOVO | Stepper +/- + input numerico inline |
| `src/features/products/components/store-assignment-dialog.tsx` | NUOVO | Multi-select store per "Aggiungi a un altro negozio" |
| `src/features/products/components/bulk-stock-adjust-dialog.tsx` | NUOVO | Tabs Aumenta/Diminuisci/Imposta a |
| `src/features/products/components/product-stock-manager.tsx` | REFACTOR | Scoped active store + riga info + button add |
| `src/features/products/components/product-row-actions.tsx` | MODIFY | Voce "Aggiungi a un altro negozio" + prop `assignedStoreIds` |
| `src/features/products/components/product-bulk-toolbar.tsx` | MODIFY | Button "Adegua stock" (solo statusFilter=active) |
| `src/routes/_authenticated/products/index.tsx` | MODIFY | Colonna `stock`, `SORT_FIELDS += "stock"`, prop `assignedStoreIds` |
| `messages/it.json` + `messages/en.json` | MODIFY | Stringhe i18n (~22 chiavi) |

---

## Task 1: Backend — Schemas stock

**Files:**
- Create: `apps/api/src/lib/schemas/stock.ts`
- Modify: `apps/api/src/lib/schemas/index.ts`

- [ ] **Step 1: Crea il file schemas/stock.ts**

```ts
// apps/api/src/lib/schemas/stock.ts
import { t } from "elysia";
import { StoreProductSchema } from "./entities";

export const StockAdjustBody = t.Object({
  delta: t.Integer({
    minimum: -1000,
    maximum: 1000,
    description:
      "Variazione di stock (intero, segno + per aumentare, - per diminuire). 0 è ammesso ma no-op.",
  }),
});

export const StockBulkAdjustBody = t.Union([
  t.Object({
    storeId: t.String({ description: "ID negozio attivo del chiamante" }),
    mode: t.Literal("delta", { description: "Somma algebrica di `value` allo stock corrente" }),
    value: t.Integer({
      minimum: -1000,
      maximum: 1000,
      description: "Variazione (segno + per aumentare, - per diminuire).",
    }),
    productIds: t.Array(t.String(), {
      minItems: 1,
      maxItems: 100,
      description: "ID dei prodotti su cui applicare l'operazione",
    }),
  }),
  t.Object({
    storeId: t.String({ description: "ID negozio attivo del chiamante" }),
    mode: t.Literal("set", { description: "Imposta lo stock a `value` per ogni prodotto" }),
    value: t.Integer({
      minimum: 0,
      maximum: 100000,
      description: "Valore assoluto da impostare.",
    }),
    productIds: t.Array(t.String(), {
      minItems: 1,
      maxItems: 100,
      description: "ID dei prodotti su cui applicare l'operazione",
    }),
  }),
]);

export const StockBulkAdjustResult = t.Object({
  succeeded: t.Array(StoreProductSchema),
  failed: t.Array(
    t.Object({
      productId: t.String(),
      reason: t.Union([t.Literal("not_found"), t.Literal("would_go_negative")]),
    }),
  ),
});
```

- [ ] **Step 2: Aggiungi il re-export in schemas/index.ts**

Apri `apps/api/src/lib/schemas/index.ts`, aggiungi la riga `export * from "./stock";` mantenendo l'ordine alfabetico:

```ts
export * from "./composed";
export * from "./discount";
export * from "./entities";
export * from "./responses";
export * from "./stock";
```

- [ ] **Step 3: Verifica typecheck**

```bash
bun run typecheck
```

Expected: nessun errore (i nuovi schemi non sono ancora consumati ma devono compilare).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/schemas/stock.ts apps/api/src/lib/schemas/index.ts
git commit -m "feat(api): add stock adjust TypeBox schemas"
```

---

## Task 2: Backend — `adjustStock` service + route (TDD: happy path)

**Files:**
- Modify: `apps/api/src/modules/seller/services/stock.ts:1-99`
- Modify: `apps/api/src/modules/seller/routes/stock.ts:1-127`
- Create: `apps/api/tests/integration/seller-product-stock.test.ts`

- [ ] **Step 1: Crea il test file con il primo test (delta positivo)**

```ts
// apps/api/tests/integration/seller-product-stock.test.ts
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

mock.module("@/lib/s3", () => ({
  s3: { delete: mock(async () => {}) },
}));

import { and, eq } from "drizzle-orm";
import { storeProduct as storeProductTable } from "@/db/schemas/product";
import { ServiceError } from "@/lib/errors";
import { adjustStock } from "@/modules/seller/services/stock";
import { truncateAll } from "../helpers/cleanup";
import {
  createTestProduct,
  createTestSeller,
  createTestStore,
  createTestStoreProduct,
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

describe("adjustStock", () => {
  it("aumenta lo stock con delta positivo", async () => {
    const db = getTestDb();
    const seller = await createTestSeller(db);
    const store = await createTestStore(db, seller.id);
    const product = await createTestProduct(db, seller.id);
    await createTestStoreProduct(db, store.id, product.id, { stock: 5 });

    const result = await adjustStock({
      productId: product.id,
      storeId: store.id,
      sellerProfileId: seller.id,
      delta: 3,
    });

    expect(result.stock).toBe(8);

    const fresh = await db.query.storeProduct.findFirst({
      where: and(
        eq(storeProductTable.productId, product.id),
        eq(storeProductTable.storeId, store.id),
      ),
    });
    expect(fresh?.stock).toBe(8);
  });
});
```

- [ ] **Step 2: Esegui il test, deve fallire (import inesistente)**

```bash
cd apps/api && bun test tests/integration/seller-product-stock.test.ts
```

Expected: FAIL — "Export named 'adjustStock' not found in module '@/modules/seller/services/stock'".

- [ ] **Step 3: Aggiungi `adjustStock` in services/stock.ts**

Apri `apps/api/src/modules/seller/services/stock.ts`. Aggiungi in fondo al file (dopo `removeProductFromStore`):

```ts
// ── adjustStock ───────────────────────────────────────────────────────────────

interface AdjustStockParams {
  productId: string;
  storeId: string;
  sellerProfileId: string;
  delta: number;
}

export async function adjustStock(params: AdjustStockParams) {
  const { productId, storeId, sellerProfileId, delta } = params;
  await ensureProductOwnership(productId, sellerProfileId);

  // UPDATE atomico con guard non-negative: una sola query, niente race.
  const [updated] = await db
    .update(storeProduct)
    .set({ stock: sql`${storeProduct.stock} + ${delta}` })
    .where(
      and(
        eq(storeProduct.productId, productId),
        eq(storeProduct.storeId, storeId),
        sql`${storeProduct.stock} + ${delta} >= 0`,
      ),
    )
    .returning();

  if (updated) return updated;

  // rowCount = 0 → distingui 404 (link assente) da 409 (vincolo violato).
  const existing = await db.query.storeProduct.findFirst({
    where: and(
      eq(storeProduct.productId, productId),
      eq(storeProduct.storeId, storeId),
    ),
  });
  if (!existing) throw new ServiceError(404, "Store-product link not found");
  throw new ServiceError(409, "Stock would go negative", {
    code: "stock_negative",
  });
}
```

- [ ] **Step 4: Esegui il test, deve passare**

```bash
cd apps/api && bun test tests/integration/seller-product-stock.test.ts
```

Expected: 1 pass.

- [ ] **Step 5: Aggiungi la route POST /products/:productId/stores/:storeId/stock-adjust**

Apri `apps/api/src/modules/seller/routes/stock.ts`. Aggiungi gli import necessari:

```ts
// in cima, espandi gli import esistenti
import {
  OkMessage,
  okRes,
  StockAdjustBody,
  StoreProductSchema,
  withConflictErrors,
  withErrors,
} from "@/lib/schemas";
import {
  adjustStock,
  assignProductToStores,
  removeProductFromStore,
  updateStock,
} from "../services/stock";
```

Poi aggiungi la nuova route dopo `.patch("/products/:productId/stores/:storeId", ...)`:

```ts
.post(
  "/products/:productId/stores/:storeId/stock-adjust",
  async (ctx) => {
    const sellerCtx = withSeller(ctx);
    const { sellerProfile: sp, params, body, isOwner, user } = sellerCtx;
    await ensureStoreAccess(params.storeId, {
      userId: user.id,
      sellerProfileId: sp.id,
      isOwner,
    });
    const data = await adjustStock({
      productId: params.productId,
      storeId: params.storeId,
      sellerProfileId: sp.id,
      delta: body.delta,
    });
    return ok(data);
  },
  {
    params: t.Object({
      productId: t.String({ description: "ID del prodotto" }),
      storeId: t.String({ description: "ID del negozio" }),
    }),
    body: StockAdjustBody,
    response: withConflictErrors({ 200: okRes(StoreProductSchema) }),
    detail: {
      summary: "Adegua stock (delta atomico)",
      description:
        "Applica un delta atomico allo stock corrente del prodotto in un negozio. Restituisce 409 se l'operazione porterebbe lo stock sotto zero. Pensato per gli step ±1 della UI seller.",
      tags: ["Seller - Stock"],
    },
  },
)
```

- [ ] **Step 6: Verifica typecheck + test (ancora verde)**

```bash
bun run typecheck
cd apps/api && bun test tests/integration/seller-product-stock.test.ts
```

Expected: typecheck clean, 1 test pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/seller/services/stock.ts \
        apps/api/src/modules/seller/routes/stock.ts \
        apps/api/tests/integration/seller-product-stock.test.ts
git commit -m "feat(api): adjustStock service + POST stock-adjust route"
```

---

## Task 3: Backend — `adjustStock` test cases (delta negativo, 404, 409, atomicity)

**Files:**
- Modify: `apps/api/tests/integration/seller-product-stock.test.ts`

- [ ] **Step 1: Aggiungi test per delta negativo**

Aggiungi dentro `describe("adjustStock", ...)`, dopo il primo test:

```ts
it("riduce lo stock con delta negativo", async () => {
  const db = getTestDb();
  const seller = await createTestSeller(db);
  const store = await createTestStore(db, seller.id);
  const product = await createTestProduct(db, seller.id);
  await createTestStoreProduct(db, store.id, product.id, { stock: 10 });

  const result = await adjustStock({
    productId: product.id,
    storeId: store.id,
    sellerProfileId: seller.id,
    delta: -3,
  });

  expect(result.stock).toBe(7);
});
```

- [ ] **Step 2: Aggiungi test 409 would_go_negative**

```ts
it("respinge con 409 quando il delta porterebbe lo stock sotto zero", async () => {
  const db = getTestDb();
  const seller = await createTestSeller(db);
  const store = await createTestStore(db, seller.id);
  const product = await createTestProduct(db, seller.id);
  await createTestStoreProduct(db, store.id, product.id, { stock: 2 });

  await expect(
    adjustStock({
      productId: product.id,
      storeId: store.id,
      sellerProfileId: seller.id,
      delta: -5,
    }),
  ).rejects.toMatchObject({ status: 409 });

  const fresh = await db.query.storeProduct.findFirst({
    where: and(
      eq(storeProductTable.productId, product.id),
      eq(storeProductTable.storeId, store.id),
    ),
  });
  expect(fresh?.stock).toBe(2); // invariato
});
```

- [ ] **Step 3: Aggiungi test 404 product missing**

```ts
it("respinge con 404 se il prodotto non esiste", async () => {
  const db = getTestDb();
  const seller = await createTestSeller(db);
  const store = await createTestStore(db, seller.id);

  await expect(
    adjustStock({
      productId: "00000000-0000-0000-0000-000000000000",
      storeId: store.id,
      sellerProfileId: seller.id,
      delta: 1,
    }),
  ).rejects.toMatchObject({ status: 404 });
});
```

- [ ] **Step 4: Aggiungi test 404 store-product link missing**

```ts
it("respinge con 404 se il prodotto non è in quel negozio", async () => {
  const db = getTestDb();
  const seller = await createTestSeller(db);
  const storeA = await createTestStore(db, seller.id);
  const storeB = await createTestStore(db, seller.id, { name: "Store B" });
  const product = await createTestProduct(db, seller.id);
  await createTestStoreProduct(db, storeA.id, product.id, { stock: 5 });
  // product NON è in storeB

  await expect(
    adjustStock({
      productId: product.id,
      storeId: storeB.id,
      sellerProfileId: seller.id,
      delta: 1,
    }),
  ).rejects.toMatchObject({ status: 404 });
});
```

- [ ] **Step 5: Aggiungi test atomicity (Promise.all)**

```ts
it("è atomico sotto concorrenza", async () => {
  const db = getTestDb();
  const seller = await createTestSeller(db);
  const store = await createTestStore(db, seller.id);
  const product = await createTestProduct(db, seller.id);
  await createTestStoreProduct(db, store.id, product.id, { stock: 10 });

  await Promise.all([
    adjustStock({ productId: product.id, storeId: store.id, sellerProfileId: seller.id, delta: 1 }),
    adjustStock({ productId: product.id, storeId: store.id, sellerProfileId: seller.id, delta: 1 }),
    adjustStock({ productId: product.id, storeId: store.id, sellerProfileId: seller.id, delta: 1 }),
  ]);

  const fresh = await db.query.storeProduct.findFirst({
    where: and(
      eq(storeProductTable.productId, product.id),
      eq(storeProductTable.storeId, store.id),
    ),
  });
  expect(fresh?.stock).toBe(13); // no lost update
});
```

- [ ] **Step 6: Esegui tutti i test**

```bash
cd apps/api && bun test tests/integration/seller-product-stock.test.ts
```

Expected: 5 pass, 0 fail.

- [ ] **Step 7: Commit**

```bash
git add apps/api/tests/integration/seller-product-stock.test.ts
git commit -m "test(api): adjustStock error cases + atomicity"
```

---

## Task 4: Backend — `bulkAdjustStock` service (delta mode happy path)

**Files:**
- Modify: `apps/api/src/modules/seller/services/stock.ts`
- Modify: `apps/api/tests/integration/seller-product-stock.test.ts`

- [ ] **Step 1: Aggiungi il test per il bulk delta su 3 prodotti**

Aggiungi nel test file un nuovo `describe`:

```ts
import { bulkAdjustStock } from "@/modules/seller/services/stock"; // aggiungi all'import esistente

describe("bulkAdjustStock", () => {
  it("applica un delta positivo a N prodotti", async () => {
    const db = getTestDb();
    const seller = await createTestSeller(db);
    const store = await createTestStore(db, seller.id);
    const p1 = await createTestProduct(db, seller.id, { name: "P1" });
    const p2 = await createTestProduct(db, seller.id, { name: "P2" });
    const p3 = await createTestProduct(db, seller.id, { name: "P3" });
    await createTestStoreProduct(db, store.id, p1.id, { stock: 5 });
    await createTestStoreProduct(db, store.id, p2.id, { stock: 10 });
    await createTestStoreProduct(db, store.id, p3.id, { stock: 3 });

    const result = await bulkAdjustStock({
      sellerProfileId: seller.id,
      storeId: store.id,
      productIds: [p1.id, p2.id, p3.id],
      mode: "delta",
      value: 2,
    });

    expect(result.succeeded).toHaveLength(3);
    expect(result.failed).toHaveLength(0);
    expect(result.succeeded.find((r) => r.productId === p1.id)?.stock).toBe(7);
    expect(result.succeeded.find((r) => r.productId === p2.id)?.stock).toBe(12);
    expect(result.succeeded.find((r) => r.productId === p3.id)?.stock).toBe(5);
  });
});
```

- [ ] **Step 2: Esegui il test, deve fallire**

```bash
cd apps/api && bun test tests/integration/seller-product-stock.test.ts -t "bulkAdjustStock"
```

Expected: FAIL — "Export named 'bulkAdjustStock' not found".

- [ ] **Step 3: Implementa `bulkAdjustStock` in services/stock.ts**

Aggiungi in fondo a `apps/api/src/modules/seller/services/stock.ts`:

```ts
// ── bulkAdjustStock ───────────────────────────────────────────────────────────

interface BulkAdjustStockParams {
  sellerProfileId: string;
  storeId: string;
  productIds: string[];
  mode: "delta" | "set";
  value: number;
}

interface BulkAdjustFailure {
  productId: string;
  reason: "not_found" | "would_go_negative";
}

export async function bulkAdjustStock(params: BulkAdjustStockParams) {
  const { sellerProfileId, storeId, productIds, mode, value } = params;

  // 1. Filtra i productIds per ownership: non leakare cross-seller.
  const ownedRows = await db
    .select({ id: product.id })
    .from(product)
    .where(
      and(
        inArray(product.id, productIds),
        eq(product.sellerProfileId, sellerProfileId),
      ),
    );
  const ownedIds = new Set(ownedRows.map((r) => r.id));

  const failed: BulkAdjustFailure[] = [];
  for (const pid of productIds) {
    if (!ownedIds.has(pid)) failed.push({ productId: pid, reason: "not_found" });
  }

  // 2. Per ogni id owned: UPDATE atomico. Per delta: con guard >= 0; per set: incondizionato.
  const succeeded: Awaited<ReturnType<typeof adjustStock>>[] = [];
  for (const productId of ownedIds) {
    if (mode === "delta") {
      const [updated] = await db
        .update(storeProduct)
        .set({ stock: sql`${storeProduct.stock} + ${value}` })
        .where(
          and(
            eq(storeProduct.productId, productId),
            eq(storeProduct.storeId, storeId),
            sql`${storeProduct.stock} + ${value} >= 0`,
          ),
        )
        .returning();
      if (updated) {
        succeeded.push(updated);
        continue;
      }
      // discrimina 404 vs would_go_negative
      const existing = await db.query.storeProduct.findFirst({
        where: and(
          eq(storeProduct.productId, productId),
          eq(storeProduct.storeId, storeId),
        ),
      });
      failed.push({
        productId,
        reason: existing ? "would_go_negative" : "not_found",
      });
    } else {
      // mode = "set"
      const [updated] = await db
        .update(storeProduct)
        .set({ stock: value })
        .where(
          and(
            eq(storeProduct.productId, productId),
            eq(storeProduct.storeId, storeId),
          ),
        )
        .returning();
      if (updated) {
        succeeded.push(updated);
        continue;
      }
      failed.push({ productId, reason: "not_found" });
    }
  }

  return { succeeded, failed };
}
```

Aggiorna l'import drizzle in cima se manca: `import { and, eq, inArray, sql } from "drizzle-orm";` e `import { product, storeProduct } from "@/db/schemas/product";`. Verifica che `product` sia importato (oggi non lo è, solo `storeProduct`).

- [ ] **Step 4: Esegui il test, deve passare**

```bash
cd apps/api && bun test tests/integration/seller-product-stock.test.ts -t "bulkAdjustStock"
```

Expected: 1 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/seller/services/stock.ts \
        apps/api/tests/integration/seller-product-stock.test.ts
git commit -m "feat(api): bulkAdjustStock service (delta + set, best-effort)"
```

---

## Task 5: Backend — `bulkAdjustStock` test cases (set, partial failure, cross-seller)

**Files:**
- Modify: `apps/api/tests/integration/seller-product-stock.test.ts`

- [ ] **Step 1: Aggiungi test mode=set**

```ts
it("imposta lo stock assoluto in mode=set", async () => {
  const db = getTestDb();
  const seller = await createTestSeller(db);
  const store = await createTestStore(db, seller.id);
  const p1 = await createTestProduct(db, seller.id, { name: "P1" });
  const p2 = await createTestProduct(db, seller.id, { name: "P2" });
  await createTestStoreProduct(db, store.id, p1.id, { stock: 5 });
  await createTestStoreProduct(db, store.id, p2.id, { stock: 99 });

  const result = await bulkAdjustStock({
    sellerProfileId: seller.id,
    storeId: store.id,
    productIds: [p1.id, p2.id],
    mode: "set",
    value: 20,
  });

  expect(result.succeeded).toHaveLength(2);
  expect(result.succeeded.every((r) => r.stock === 20)).toBe(true);
});
```

- [ ] **Step 2: Aggiungi test partial failure (would_go_negative)**

```ts
it("ritorna would_go_negative quando il delta porterebbe stock < 0", async () => {
  const db = getTestDb();
  const seller = await createTestSeller(db);
  const store = await createTestStore(db, seller.id);
  const p1 = await createTestProduct(db, seller.id, { name: "P1" });
  const p2 = await createTestProduct(db, seller.id, { name: "P2" });
  await createTestStoreProduct(db, store.id, p1.id, { stock: 10 });
  await createTestStoreProduct(db, store.id, p2.id, { stock: 1 });

  const result = await bulkAdjustStock({
    sellerProfileId: seller.id,
    storeId: store.id,
    productIds: [p1.id, p2.id],
    mode: "delta",
    value: -5,
  });

  expect(result.succeeded).toHaveLength(1);
  expect(result.succeeded[0].productId).toBe(p1.id);
  expect(result.succeeded[0].stock).toBe(5);
  expect(result.failed).toEqual([
    { productId: p2.id, reason: "would_go_negative" },
  ]);
});
```

- [ ] **Step 3: Aggiungi test cross-seller (not_found)**

```ts
it("ritorna not_found per productIds di altri seller", async () => {
  const db = getTestDb();
  const sellerA = await createTestSeller(db);
  const sellerB = await createTestSeller(db, { email: "b@test.com" });
  const storeA = await createTestStore(db, sellerA.id);
  const productA = await createTestProduct(db, sellerA.id);
  const productB = await createTestProduct(db, sellerB.id);
  await createTestStoreProduct(db, storeA.id, productA.id, { stock: 5 });

  const result = await bulkAdjustStock({
    sellerProfileId: sellerA.id,
    storeId: storeA.id,
    productIds: [productA.id, productB.id],
    mode: "delta",
    value: 1,
  });

  expect(result.succeeded).toHaveLength(1);
  expect(result.succeeded[0].productId).toBe(productA.id);
  expect(result.failed).toEqual([
    { productId: productB.id, reason: "not_found" },
  ]);
});
```

- [ ] **Step 4: Aggiungi test link assente (not_found)**

```ts
it("ritorna not_found se il prodotto del seller non è in quel negozio", async () => {
  const db = getTestDb();
  const seller = await createTestSeller(db);
  const storeA = await createTestStore(db, seller.id);
  const storeB = await createTestStore(db, seller.id, { name: "Store B" });
  const product = await createTestProduct(db, seller.id);
  await createTestStoreProduct(db, storeA.id, product.id, { stock: 5 });
  // product NON è in storeB

  const result = await bulkAdjustStock({
    sellerProfileId: seller.id,
    storeId: storeB.id,
    productIds: [product.id],
    mode: "delta",
    value: 1,
  });

  expect(result.succeeded).toHaveLength(0);
  expect(result.failed).toEqual([
    { productId: product.id, reason: "not_found" },
  ]);
});
```

- [ ] **Step 5: Esegui tutti i test del file**

```bash
cd apps/api && bun test tests/integration/seller-product-stock.test.ts
```

Expected: 9 pass (5 di adjustStock + 4 di bulkAdjustStock + 1 happy del task 4).

- [ ] **Step 6: Commit**

```bash
git add apps/api/tests/integration/seller-product-stock.test.ts
git commit -m "test(api): bulkAdjustStock set mode + partial failure + cross-seller"
```

---

## Task 6: Backend — Route `POST /products/bulk/stock-adjust`

**Files:**
- Modify: `apps/api/src/modules/seller/routes/stock.ts`

- [ ] **Step 1: Aggiungi la route bulk**

In `apps/api/src/modules/seller/routes/stock.ts`, espandi gli import:

```ts
import {
  OkMessage,
  okRes,
  StockAdjustBody,
  StockBulkAdjustBody,
  StockBulkAdjustResult,
  StoreProductSchema,
  withConflictErrors,
  withErrors,
} from "@/lib/schemas";
import {
  adjustStock,
  assignProductToStores,
  bulkAdjustStock,
  removeProductFromStore,
  updateStock,
} from "../services/stock";
```

Aggiungi la route alla fine della chain (dopo `.post("/products/:productId/stores/:storeId/stock-adjust", ...)`):

```ts
.post(
  "/products/bulk/stock-adjust",
  async (ctx) => {
    const sellerCtx = withSeller(ctx);
    const { sellerProfile: sp, body, isOwner, user } = sellerCtx;
    await ensureStoreAccess(body.storeId, {
      userId: user.id,
      sellerProfileId: sp.id,
      isOwner,
    });
    const result = await bulkAdjustStock({
      sellerProfileId: sp.id,
      storeId: body.storeId,
      productIds: body.productIds,
      mode: body.mode,
      value: body.value,
    });
    return ok(result);
  },
  {
    body: StockBulkAdjustBody,
    response: withErrors({ 200: okRes(StockBulkAdjustResult) }),
    detail: {
      summary: "Adegua stock in bulk",
      description:
        "Applica un delta (mode='delta') o imposta un valore assoluto (mode='set') allo stock di più prodotti in un singolo negozio. Best-effort: gli ID non accessibili o con stock insufficiente finiscono in 'failed' con reason. Limite: 100 ID per chiamata.",
      tags: ["Seller - Stock"],
    },
  },
)
```

- [ ] **Step 2: Verifica typecheck**

```bash
bun run typecheck
```

Expected: clean (l'inferenza di `body.mode` discrimina `value` automaticamente grazie all'union TypeBox).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/seller/routes/stock.ts
git commit -m "feat(api): POST /products/bulk/stock-adjust route"
```

---

## Task 7: Backend — Sort `stock` su `GET /seller/products`

**Files:**
- Modify: `apps/api/src/modules/seller/services/products.ts:78-228`
- Modify: `apps/api/src/modules/seller/routes/products.ts:126-145`
- Modify: `apps/api/tests/integration/seller-products-filters.test.ts`

- [ ] **Step 1: Aggiungi test sort=stock asc nel file filters**

Apri `apps/api/tests/integration/seller-products-filters.test.ts` e aggiungi (nel `describe` esistente di sort, o crea `describe("sort by stock")` se manca):

```ts
describe("sort by stock", () => {
  it("ordina per stock crescente", async () => {
    const db = getTestDb();
    const seller = await createTestSeller(db);
    const store = await createTestStore(db, seller.id);
    const p1 = await createTestProduct(db, seller.id, { name: "P1" });
    const p2 = await createTestProduct(db, seller.id, { name: "P2" });
    const p3 = await createTestProduct(db, seller.id, { name: "P3" });
    await createTestStoreProduct(db, store.id, p1.id, { stock: 5 });
    await createTestStoreProduct(db, store.id, p2.id, { stock: 1 });
    await createTestStoreProduct(db, store.id, p3.id, { stock: 9 });

    const result = await listProducts({
      sellerProfileId: seller.id,
      storeId: store.id,
      page: 1,
      limit: 20,
      sort: "stock",
      order: "asc",
    });

    expect(result.data.map((p) => p.name)).toEqual(["P2", "P1", "P3"]);
  });

  it("ordina per stock decrescente", async () => {
    const db = getTestDb();
    const seller = await createTestSeller(db);
    const store = await createTestStore(db, seller.id);
    const p1 = await createTestProduct(db, seller.id, { name: "P1" });
    const p2 = await createTestProduct(db, seller.id, { name: "P2" });
    await createTestStoreProduct(db, store.id, p1.id, { stock: 5 });
    await createTestStoreProduct(db, store.id, p2.id, { stock: 12 });

    const result = await listProducts({
      sellerProfileId: seller.id,
      storeId: store.id,
      page: 1,
      limit: 20,
      sort: "stock",
      order: "desc",
    });

    expect(result.data.map((p) => p.name)).toEqual(["P2", "P1"]);
  });

  it("respinge sort=stock senza storeId con 400", async () => {
    const seller = await createTestSeller(getTestDb());

    await expect(
      listProducts({
        sellerProfileId: seller.id,
        page: 1,
        limit: 20,
        sort: "stock",
        order: "asc",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
```

- [ ] **Step 2: Esegui i test, devono fallire (sort=stock non valido)**

```bash
cd apps/api && bun test tests/integration/seller-products-filters.test.ts -t "sort by stock"
```

Expected: FAIL — TypeScript error o "sort=stock" non riconosciuto a runtime.

- [ ] **Step 3: Estendi `ProductSortField` in services/products.ts**

In `apps/api/src/modules/seller/services/products.ts` (riga ~78), aggiorna il tipo:

```ts
type ProductSortField =
  | "name"
  | "price"
  | "ean"
  | "stock"
  | "createdAt"
  | "updatedAt";
```

E nel `switch (sort)` (riga ~210) aggiungi il case stock prima del default:

```ts
case "stock":
  if (!storeId) {
    throw new ServiceError(400, "sort=stock requires storeId");
  }
  return [dir(storeProduct.stock), desc(product.createdAt)];
```

- [ ] **Step 4: Estendi il route `GET /products` per accettare sort=stock**

In `apps/api/src/modules/seller/routes/products.ts` (riga ~126-145), espandi il `t.Union`:

```ts
sort: t.Optional(
  t.Union(
    [
      t.Literal("name"),
      t.Literal("price"),
      t.Literal("ean"),
      t.Literal("stock"),
      t.Literal("createdAt"),
      t.Literal("updatedAt"),
    ],
    {
      description:
        "Campo di ordinamento. `stock` richiede `storeId`. Ignorato quando `q` è attivo (vince la rilevanza). Default: createdAt.",
    },
  ),
),
```

- [ ] **Step 5: Esegui i test, devono passare**

```bash
cd apps/api && bun test tests/integration/seller-products-filters.test.ts
```

Expected: tutti pass.

- [ ] **Step 6: Verifica typecheck whole-repo (propagazione Eden Treaty)**

```bash
bun run typecheck
```

Expected: clean. (I 3 frontend acquisiscono `"stock"` come opzione di sort.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/seller/services/products.ts \
        apps/api/src/modules/seller/routes/products.ts \
        apps/api/tests/integration/seller-products-filters.test.ts
git commit -m "feat(api): support sort=stock on GET /seller/products"
```

---

## Task 8: Backend — Lint + intera suite stock

**Files:** —

- [ ] **Step 1: Lint**

```bash
bun run lint
```

Expected: clean (Biome). Se vengono segnalati problemi sui file toccati, fixali e ri-stage.

- [ ] **Step 2: Esegui l'intera suite API**

```bash
cd apps/api && bun test
```

Expected: nessun test rotto. Eventuali test pre-esistenti devono restare verdi.

- [ ] **Step 3: Se `bun run lint` ha modificato file (Biome auto-fix), committa il fix**

```bash
git status
# se ci sono cambi:
git add -u
git commit -m "style: biome auto-fix"
```

(Altrimenti skip.)

---

## Task 9: Frontend — i18n strings

**Files:**
- Modify: `apps/seller/messages/it.json`
- Modify: `apps/seller/messages/en.json`

- [ ] **Step 1: Aggiungi le chiavi italiane**

Apri `apps/seller/messages/it.json` e aggiungi (mantieni l'ordinamento alfabetico esistente, o aggiungi in fondo se quello è il pattern):

```json
{
  "products_stock_column_header": "Stock",
  "products_action_add_to_store": "Aggiungi a un altro negozio",
  "products_stock_error_negative": "Lo stock non può scendere sotto zero.",
  "products_stock_error_no_access": "Accesso al negozio negato.",
  "products_stock_manager_heading": "Disponibilità",
  "products_stock_manager_subtitle": "Quantità nel negozio attivo. Usa i bottoni +/- o clicca sul numero per impostare un valore.",
  "products_stock_manager_empty_active": "Questo prodotto non è disponibile in {storeName}.",
  "products_stock_manager_make_available_here": "Rendi disponibile in questo negozio",
  "products_stock_manager_also_in": "Disponibile anche in:",
  "products_stock_manager_add_to_another": "Rendi disponibile in un altro negozio",
  "products_store_assignment_dialog_title": "Aggiungi a un altro negozio",
  "products_store_assignment_dialog_initial_stock": "Stock iniziale",
  "products_store_assignment_dialog_all_covered": "Questo prodotto è già disponibile in tutti i tuoi negozi.",
  "products_store_assignment_dialog_success": "Prodotto aggiunto a {count} negozi",
  "products_bulk_adjust_stock_button": "Adegua stock",
  "products_bulk_adjust_dialog_title": "Adegua stock di {count} prodotti",
  "products_bulk_adjust_dialog_subtitle": "In {storeName}",
  "products_bulk_adjust_tab_add": "Aumenta",
  "products_bulk_adjust_tab_sub": "Diminuisci",
  "products_bulk_adjust_tab_set": "Imposta a",
  "products_bulk_adjust_field_quantity": "Quantità",
  "products_bulk_adjust_warning_zero": "Imposterai lo stock di {count} prodotti a 0.",
  "products_bulk_adjust_success": "Stock aggiornato per {count} prodotti",
  "products_bulk_adjust_partial_warning": "{ok} aggiornati. {failed} ignorati: {breakdown}.",
  "products_bulk_adjust_error": "Errore durante l'aggiornamento dello stock."
}
```

- [ ] **Step 2: Aggiungi le stesse chiavi in inglese in `messages/en.json`**

```json
{
  "products_stock_column_header": "Stock",
  "products_action_add_to_store": "Add to another store",
  "products_stock_error_negative": "Stock cannot go below zero.",
  "products_stock_error_no_access": "Access to this store denied.",
  "products_stock_manager_heading": "Availability",
  "products_stock_manager_subtitle": "Quantity in the active store. Use +/- or click the number to set a value.",
  "products_stock_manager_empty_active": "This product is not available in {storeName}.",
  "products_stock_manager_make_available_here": "Make available in this store",
  "products_stock_manager_also_in": "Also available in:",
  "products_stock_manager_add_to_another": "Make available in another store",
  "products_store_assignment_dialog_title": "Add to another store",
  "products_store_assignment_dialog_initial_stock": "Initial stock",
  "products_store_assignment_dialog_all_covered": "This product is already available in all your stores.",
  "products_store_assignment_dialog_success": "Product added to {count} stores",
  "products_bulk_adjust_stock_button": "Adjust stock",
  "products_bulk_adjust_dialog_title": "Adjust stock for {count} products",
  "products_bulk_adjust_dialog_subtitle": "In {storeName}",
  "products_bulk_adjust_tab_add": "Increase",
  "products_bulk_adjust_tab_sub": "Decrease",
  "products_bulk_adjust_tab_set": "Set to",
  "products_bulk_adjust_field_quantity": "Quantity",
  "products_bulk_adjust_warning_zero": "You will set stock to 0 for {count} products.",
  "products_bulk_adjust_success": "Stock updated for {count} products",
  "products_bulk_adjust_partial_warning": "{ok} updated. {failed} ignored: {breakdown}.",
  "products_bulk_adjust_error": "Error while updating stock."
}
```

- [ ] **Step 3: Avvia dev:seller per generare i tipi paraglide**

```bash
bun run dev:seller
```

Aspetta ~10s che vite faccia bootstrap. Il plugin paraglide rigenera `src/paraglide/messages/_index.js` automaticamente.

Termina con Ctrl+C dopo aver visto "ready in Xms".

- [ ] **Step 4: Verifica typecheck**

```bash
bun run typecheck
```

Expected: clean (le nuove `m.*` non sono ancora consumate ma compilano).

- [ ] **Step 5: Commit**

```bash
git add apps/seller/messages/it.json apps/seller/messages/en.json
git commit -m "i18n(seller): add stock management strings"
```

---

## Task 10: Frontend — Hook `useStockAdjustMutation`

**Files:**
- Create: `apps/seller/src/features/products/hooks/use-stock-adjust-mutation.ts`

- [ ] **Step 1: Crea l'hook**

```ts
// apps/seller/src/features/products/hooks/use-stock-adjust-mutation.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface AdjustParams {
  productId: string;
  storeId: string;
  delta: number;
}

interface SetParams {
  productId: string;
  storeId: string;
  stock: number;
}

type StoreProduct = { id: string; productId: string; storeId: string; stock: number };

export function useStockAdjustMutation() {
  const queryClient = useQueryClient();

  const patchCache = (updated: StoreProduct) => {
    // Patcha tutte le query ["product", productId] e ["products", ...]
    queryClient.setQueriesData(
      { queryKey: ["product", updated.productId] },
      (old: any) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: {
            ...old.data,
            storeProducts: old.data.storeProducts.map((sp: StoreProduct) =>
              sp.storeId === updated.storeId ? { ...sp, stock: updated.stock } : sp,
            ),
          },
        };
      },
    );
    queryClient.setQueriesData({ queryKey: ["products"] }, (old: any) => {
      if (!old?.data) return old;
      return {
        ...old,
        data: old.data.map((p: any) =>
          p.id !== updated.productId
            ? p
            : {
                ...p,
                storeProducts: p.storeProducts.map((sp: StoreProduct) =>
                  sp.storeId === updated.storeId ? { ...sp, stock: updated.stock } : sp,
                ),
              },
        ),
      };
    });
  };

  const adjust = useMutation({
    mutationFn: async ({ productId, storeId, delta }: AdjustParams) => {
      const response = await api()
        .seller.products({ productId })
        .stores({ storeId })
        ["stock-adjust"].post({ delta });
      if (response.error) {
        const err = new Error(response.error.value?.message || "Errore stock");
        (err as any).status = response.status;
        (err as any).code = (response.error.value as any)?.code;
        throw err;
      }
      return response.data.data as StoreProduct;
    },
    onSuccess: (data) => patchCache(data),
  });

  const set = useMutation({
    mutationFn: async ({ productId, storeId, stock }: SetParams) => {
      const response = await api()
        .seller.products({ productId })
        .stores({ storeId })
        .patch({ stock });
      if (response.error) {
        const err = new Error(response.error.value?.message || "Errore stock");
        (err as any).status = response.status;
        throw err;
      }
      return response.data.data as StoreProduct;
    },
    onSuccess: (data) => patchCache(data),
  });

  return { adjust, set };
}
```

- [ ] **Step 2: Verifica typecheck (l'API Eden Treaty deve avere `stock-adjust`)**

```bash
bun run typecheck
```

Expected: clean. Se l'accesso `["stock-adjust"]` non risolve via Eden, verifica che `bun run dev:api` o un build del backend abbia rigenerato i tipi (Eden Treaty deriva i tipi dal binding `app.use(sellerRoutes)`).

- [ ] **Step 3: Commit**

```bash
git add apps/seller/src/features/products/hooks/use-stock-adjust-mutation.ts
git commit -m "feat(seller): useStockAdjustMutation hook"
```

---

## Task 11: Frontend — Componente `StockEditorCell`

**Files:**
- Create: `apps/seller/src/features/products/components/stock-editor-cell.tsx`

- [ ] **Step 1: Crea il componente**

```tsx
// apps/seller/src/features/products/components/stock-editor-cell.tsx
"use no memo";

import { Button } from "@bibs/ui/components/button";
import { Input } from "@bibs/ui/components/input";
import { toast } from "@bibs/ui/components/sonner";
import { MinusIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStockAdjustMutation } from "@/features/products/hooks/use-stock-adjust-mutation";
import { m } from "@/paraglide/messages";

interface Props {
  productId: string;
  storeId: string;
  stock: number;
  readOnly?: boolean;
}

const DEBOUNCE_MS = 500;

export function StockEditorCell({ productId, storeId, stock, readOnly }: Props) {
  const { adjust, set } = useStockAdjustMutation();
  const [pendingDelta, setPendingDelta] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editValue, setEditValue] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Valore visibile: server stock + delta accumulato (a meno che non siamo in edit).
  const optimistic = stock + pendingDelta;

  const flush = (deltaSnapshot: number) => {
    if (deltaSnapshot === 0) {
      setPendingDelta(0);
      return;
    }
    setPendingDelta(0);
    adjust.mutate(
      { productId, storeId, delta: deltaSnapshot },
      {
        onError: (err: any) => {
          if (err?.code === "stock_negative") {
            toast.error(m.products_stock_error_negative());
          } else if (err?.status === 403) {
            toast.error(m.products_stock_error_no_access());
          } else {
            toast.error(err?.message || "Errore");
          }
          // rollback: il valore visibile torna a `stock` (canonical via query cache)
        },
      },
    );
  };

  const scheduleFlush = (nextDelta: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      flush(nextDelta);
    }, DEBOUNCE_MS);
  };

  useEffect(() => {
    return () => {
      // su unmount, esegui subito il flush in volo
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        if (pendingDelta !== 0) flush(pendingDelta);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (readOnly) {
    return <span className="tabular-nums">{stock}</span>;
  }

  const onIncrement = () => {
    const next = pendingDelta + 1;
    setPendingDelta(next);
    scheduleFlush(next);
  };

  const onDecrement = () => {
    if (optimistic === 0) return;
    const next = pendingDelta - 1;
    setPendingDelta(next);
    scheduleFlush(next);
  };

  const onNumberClick = () => {
    setEditValue(String(optimistic));
    setEditMode(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitSet = () => {
    const parsed = Number.parseInt(editValue, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      setEditMode(false);
      return;
    }
    if (parsed === optimistic) {
      setEditMode(false);
      return;
    }
    setEditMode(false);
    set.mutate(
      { productId, storeId, stock: parsed },
      {
        onError: (err: any) => {
          toast.error(err?.message || "Errore");
        },
      },
    );
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onDecrement}
        disabled={adjust.isPending || optimistic === 0}
        aria-label="Diminuisci"
      >
        <MinusIcon className="size-3.5" />
      </Button>
      {editMode ? (
        <Input
          ref={inputRef}
          type="number"
          inputMode="numeric"
          className="h-7 w-14 px-1 text-center tabular-nums"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitSet}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitSet();
            else if (e.key === "Escape") setEditMode(false);
          }}
          min={0}
        />
      ) : (
        <button
          type="button"
          onClick={onNumberClick}
          className="hover:bg-accent w-10 rounded px-1 text-center font-medium tabular-nums"
        >
          {optimistic}
        </button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onIncrement}
        disabled={adjust.isPending}
        aria-label="Aumenta"
      >
        <PlusIcon className="size-3.5" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Verifica che `Button size="icon-xs"` esista in `@bibs/ui`**

```bash
grep -n "icon-xs" packages/ui/src/components/button.tsx
```

Se non esiste, usa `size="icon"` con classi inline `h-7 w-7` o aggiungi la variant. (Verifica e adatta.)

- [ ] **Step 3: Verifica typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/seller/src/features/products/components/stock-editor-cell.tsx
git commit -m "feat(seller): StockEditorCell with debounced optimistic +/-"
```

---

## Task 12: Frontend — Aggiungi colonna stock e sort nella lista prodotti

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/products/index.tsx`

- [ ] **Step 1: Estendi `SORT_FIELDS` e `ProductSortField`**

Apri `apps/seller/src/routes/_authenticated/products/index.tsx`, riga 33-41. Sostituisci:

```ts
type ProductSortField = "name" | "price" | "ean" | "stock" | "createdAt" | "updatedAt";
type SortOrder = "asc" | "desc";
const SORT_FIELDS: ProductSortField[] = [
  "name",
  "price",
  "ean",
  "stock",
  "createdAt",
  "updatedAt",
];
```

- [ ] **Step 2: Importa StockEditorCell**

In cima al file, aggiungi:

```ts
import { StockEditorCell } from "@/features/products/components/stock-editor-cell";
```

- [ ] **Step 3: Aggiungi la colonna stock al `columns` array**

Tra la colonna `price` (riga ~301-315) e la colonna `category`, inserisci:

```tsx
{
  id: "stock",
  header: ({ column }) => (
    <SortableHeader column={column}>{m.products_stock_column_header()}</SortableHeader>
  ),
  enableSorting: true,
  meta: {
    headerClassName: "w-[14%]",
    cellClassName: "tabular-nums",
    menuLabel: m.products_stock_column_header(),
  },
  cell: ({ row }) => {
    const sp = row.original.storeProducts.find(
      (sp) => sp.storeId === activeStore?.id,
    );
    if (!sp || !activeStore) {
      return <span className="text-muted-foreground/60">—</span>;
    }
    return (
      <StockEditorCell
        productId={row.original.id}
        storeId={activeStore.id}
        stock={sp.stock}
      />
    );
  },
},
```

- [ ] **Step 4: Verifica typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 5: Manual smoke test in browser**

```bash
bun run dev:seller
```

Apri `http://localhost:3003/products`, verifica:
- La colonna "Stock" è visibile tra Prezzo e Categoria.
- Per un prodotto con assegnazione all'active store: stepper +/- visibili e numero cliccabile.
- Per un prodotto senza assegnazione all'active store (edge case): "—" non editabile.
- Click su header "Stock" → URL aggiorna con `sort=stock&order=asc` o `desc`, lista riordina.
- Click +1: numero aumenta subito, poi (~500ms) parte POST in Network tab.
- Click rapidi +5/-3 in 500ms: una sola POST con `delta: 2`.

Ctrl+C per terminare dev server.

- [ ] **Step 6: Commit**

```bash
git add apps/seller/src/routes/_authenticated/products/index.tsx
git commit -m "feat(seller): inline stock column with sort on /products"
```

---

## Task 13: Frontend — Componente `StoreAssignmentDialog`

**Files:**
- Create: `apps/seller/src/features/products/components/store-assignment-dialog.tsx`

- [ ] **Step 1: Crea il componente**

```tsx
// apps/seller/src/features/products/components/store-assignment-dialog.tsx
import { Button } from "@bibs/ui/components/button";
import { Checkbox } from "@bibs/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bibs/ui/components/dialog";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

interface Props {
  productId: string;
  assignedStoreIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function StoreAssignmentDialog({
  productId,
  assignedStoreIds,
  open,
  onOpenChange,
  onSuccess,
}: Props) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initialStock, setInitialStock] = useState("0");

  const { data: stores } = useQuery({
    queryKey: ["seller-stores"],
    queryFn: async () => {
      const response = await api().seller.stores.get();
      if (response.error) throw new Error("Errore caricamento negozi");
      return response.data.data;
    },
    enabled: open,
  });

  const available = (stores ?? []).filter((s) => !assignedStoreIds.includes(s.id));

  const assignMutation = useMutation({
    mutationFn: async () => {
      const stock = Number.parseInt(initialStock, 10);
      const response = await api()
        .seller.products({ productId })
        .stores.post({
          storeIds: Array.from(selected),
          stock: Number.isNaN(stock) ? 0 : stock,
        });
      if (response.error) throw new Error("Errore assegnazione");
      return response.data.data;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["product", productId] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success(
        m.products_store_assignment_dialog_success({ count: data.length }),
      );
      onSuccess?.();
      onOpenChange(false);
      setSelected(new Set());
      setInitialStock("0");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.products_store_assignment_dialog_title()}</DialogTitle>
        </DialogHeader>

        {available.length === 0 ? (
          <p className="text-muted-foreground py-4 text-sm">
            {m.products_store_assignment_dialog_all_covered()}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              {available.map((store) => (
                <label
                  key={store.id}
                  className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1.5"
                >
                  <Checkbox
                    checked={selected.has(store.id)}
                    onCheckedChange={() => toggle(store.id)}
                  />
                  <span className="text-sm">{store.name}</span>
                  <span className="text-muted-foreground text-xs">— {store.city}</span>
                </label>
              ))}
            </div>

            <div className="space-y-1">
              <Label htmlFor="initial-stock">
                {m.products_store_assignment_dialog_initial_stock()}
              </Label>
              <Input
                id="initial-stock"
                type="number"
                inputMode="numeric"
                min={0}
                value={initialStock}
                onChange={(e) => setInitialStock(e.target.value)}
                className="w-32"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button
            onClick={() => assignMutation.mutate()}
            disabled={selected.size === 0 || assignMutation.isPending}
          >
            Conferma
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verifica typecheck**

```bash
bun run typecheck
```

Expected: clean. Se `Dialog`/`DialogContent` non sono in `@bibs/ui/components/dialog`, verifica i path effettivi e adatta gli import.

- [ ] **Step 3: Commit**

```bash
git add apps/seller/src/features/products/components/store-assignment-dialog.tsx
git commit -m "feat(seller): StoreAssignmentDialog (multi-select stores)"
```

---

## Task 14: Frontend — Row action "Aggiungi a un altro negozio"

**Files:**
- Modify: `apps/seller/src/features/products/components/product-row-actions.tsx`
- Modify: `apps/seller/src/routes/_authenticated/products/index.tsx`

- [ ] **Step 1: Aggiungi la prop `assignedStoreIds` a `ProductRowActions`**

Modifica `apps/seller/src/features/products/components/product-row-actions.tsx`. Aggiorna l'interfaccia Props:

```tsx
interface Props {
  productId: string;
  status: ProductStatus;
  activeStoreId: string;
  assignedStoreIds: string[];   // NUOVA
}
```

E aggiorna la signature:

```tsx
export function ProductRowActions({
  productId,
  status,
  activeStoreId,
  assignedStoreIds,
}: Props) {
```

- [ ] **Step 2: Aggiungi l'import e lo state**

In cima al file, aggiungi gli import:

```tsx
import { CopyPlusIcon } from "lucide-react";
import { StoreAssignmentDialog } from "@/features/products/components/store-assignment-dialog";
```

Dentro il componente, accanto allo state esistente:

```tsx
const [addStoreOpen, setAddStoreOpen] = useState(false);
```

- [ ] **Step 3: Aggiungi la voce di menu**

Dopo l'item "Modifica" (riga ~47-54), prima di "Copia ID":

```tsx
{status !== "trashed" && (
  <DropdownMenuItem
    className="whitespace-nowrap"
    onSelect={() => setAddStoreOpen(true)}
  >
    <CopyPlusIcon />
    {m.products_action_add_to_store()}
  </DropdownMenuItem>
)}
```

E in fondo al JSX (accanto a `ConfirmPermanentDeleteDialog`):

```tsx
<StoreAssignmentDialog
  productId={productId}
  assignedStoreIds={assignedStoreIds}
  open={addStoreOpen}
  onOpenChange={setAddStoreOpen}
/>
```

- [ ] **Step 4: Aggiorna il caller in products/index.tsx**

Apri `apps/seller/src/routes/_authenticated/products/index.tsx` (riga ~429-435 nell'attuale colonna actions):

```tsx
cell: ({ row }) => (
  <ProductRowActions
    productId={row.original.id}
    status={row.original.status}
    activeStoreId={activeStore?.id ?? ""}
    assignedStoreIds={row.original.storeProducts.map((sp) => sp.storeId)}
  />
),
```

- [ ] **Step 5: Verifica typecheck + manual test**

```bash
bun run typecheck
```

Expected: clean.

```bash
bun run dev:seller
```

Verifica in browser:
- Click sui tre puntini di una riga prodotto → voce "Aggiungi a un altro negozio" visibile.
- Click → dialog si apre con i negozi NON ancora assegnati.
- Seleziona uno, conferma → toast "Prodotto aggiunto a 1 negozi", lista refresh.
- Riprova lo stesso menu → se hai 1 solo store libero appena assegnato, ora il dialog mostra "Questo prodotto è già disponibile in tutti i tuoi negozi".

Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add apps/seller/src/features/products/components/product-row-actions.tsx \
        apps/seller/src/routes/_authenticated/products/index.tsx
git commit -m "feat(seller): row action 'Aggiungi a un altro negozio'"
```

---

## Task 15: Frontend — Refactor `ProductStockManager`

**Files:**
- Modify: `apps/seller/src/features/products/components/product-stock-manager.tsx`

- [ ] **Step 1: Riscrivi il componente**

Sovrascrivi `apps/seller/src/features/products/components/product-stock-manager.tsx` con:

```tsx
"use no memo";

import { Button } from "@bibs/ui/components/button";
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyPlusIcon, StoreIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { useActiveStore } from "@/hooks/use-active-store";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";
import { StockEditorCell } from "./stock-editor-cell";
import { StoreAssignmentDialog } from "./store-assignment-dialog";

interface StoreProduct {
  id: string;
  storeId: string;
  stock: number;
  store: { id: string; name: string; city: string };
}

interface Props {
  productId: string;
  storeProducts: StoreProduct[];
}

export function ProductStockManager({ productId, storeProducts }: Props) {
  const queryClient = useQueryClient();
  const { activeStore } = useActiveStore();
  const [addOpen, setAddOpen] = useState(false);

  const { data: stores } = useQuery({
    queryKey: ["seller-stores"],
    queryFn: async () => {
      const response = await api().seller.stores.get();
      if (response.error) throw new Error("Errore caricamento negozi");
      return response.data.data;
    },
  });

  const accessibleSet = useMemo(
    () => new Set(stores?.map((s) => s.id) ?? []),
    [stores],
  );

  const activeRow = storeProducts.find((sp) => sp.storeId === activeStore?.id);
  const otherAccessible = storeProducts.filter(
    (sp) => sp.storeId !== activeStore?.id && accessibleSet.has(sp.storeId),
  );
  const assignedStoreIds = storeProducts.map((sp) => sp.storeId);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["product", productId] });
    void queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const removeMutation = useMutation({
    mutationFn: async (storeId: string) => {
      const response = await api()
        .seller.products({ productId })
        .stores({ storeId })
        .delete();
      if (response.error) throw new Error("Errore nella rimozione dal negozio");
    },
    onSuccess: () => {
      toast.success("Prodotto rimosso dal negozio");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const assignActiveMutation = useMutation({
    mutationFn: async () => {
      if (!activeStore) throw new Error("Nessun negozio attivo");
      const response = await api()
        .seller.products({ productId })
        .stores.post({ storeIds: [activeStore.id], stock: 0 });
      if (response.error) throw new Error("Errore assegnazione");
    },
    onSuccess: () => {
      toast.success("Prodotto reso disponibile");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{m.products_stock_manager_heading()}</p>
        <p className="text-muted-foreground text-xs">
          {m.products_stock_manager_subtitle()}
        </p>
      </div>

      {activeRow ? (
        <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
          <StoreIcon className="text-muted-foreground size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{activeRow.store.name}</p>
            <p className="text-muted-foreground truncate text-xs">
              {activeRow.store.city}
            </p>
          </div>
          <StockEditorCell
            productId={productId}
            storeId={activeRow.storeId}
            stock={activeRow.stock}
          />
          <button
            type="button"
            className="text-destructive hover:bg-destructive/10 flex h-8 w-8 items-center justify-center rounded-md disabled:opacity-50"
            disabled={removeMutation.isPending}
            onClick={() => removeMutation.mutate(activeRow.storeId)}
          >
            <Trash2Icon className="size-3.5" />
          </button>
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-dashed p-4 text-center">
          <p className="text-muted-foreground text-sm">
            {m.products_stock_manager_empty_active({
              storeName: activeStore?.name ?? "",
            })}
          </p>
          <Button
            size="sm"
            onClick={() => assignActiveMutation.mutate()}
            disabled={assignActiveMutation.isPending || !activeStore}
          >
            {m.products_stock_manager_make_available_here()}
          </Button>
        </div>
      )}

      {otherAccessible.length > 0 && (
        <p className="text-muted-foreground text-xs">
          {m.products_stock_manager_also_in()}{" "}
          {otherAccessible
            .map((sp) => `${sp.store.name} (${sp.stock})`)
            .join(", ")}
        </p>
      )}

      <Button
        variant="outline"
        className="w-full"
        onClick={() => setAddOpen(true)}
      >
        <CopyPlusIcon className="size-4" />
        {m.products_stock_manager_add_to_another()}
      </Button>

      <StoreAssignmentDialog
        productId={productId}
        assignedStoreIds={assignedStoreIds}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verifica typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 3: Manual test**

```bash
bun run dev:seller
```

Apri un prodotto su `/products/:id`. Verifica:
- Sezione "Disponibilità" mostra una sola riga = active store, con `[- N +]` editabile e cestino.
- Sotto: "Disponibile anche in: Negozio B (12)" se hai altri store accessibili dove il prodotto esiste.
- Button "Rendi disponibile in un altro negozio" apre lo stesso dialog usato dalla row action.
- Per un prodotto NON associato all'active store (cambia store via switcher): empty state + button "Rendi disponibile in questo negozio" funzionante.

Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add apps/seller/src/features/products/components/product-stock-manager.tsx
git commit -m "refactor(seller): ProductStockManager scoped on active store + add-to-store action"
```

---

## Task 16: Frontend — Hook `useBulkStockAdjustMutation`

**Files:**
- Create: `apps/seller/src/features/products/hooks/use-bulk-stock-adjust-mutation.ts`

- [ ] **Step 1: Crea l'hook**

```ts
// apps/seller/src/features/products/hooks/use-bulk-stock-adjust-mutation.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

type Mode = "delta" | "set";

interface MutateParams {
  storeId: string;
  productIds: string[];
  mode: Mode;
  value: number;
}

type StoreProduct = { id: string; productId: string; storeId: string; stock: number };

interface BulkResult {
  succeeded: StoreProduct[];
  failed: Array<{ productId: string; reason: "not_found" | "would_go_negative" }>;
}

export function useBulkStockAdjustMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: MutateParams): Promise<BulkResult> => {
      const response = await api().seller.products.bulk["stock-adjust"].post(params);
      if (response.error) throw new Error(response.error.value?.message || "Errore");
      return response.data.data as BulkResult;
    },
    onSuccess: (result) => {
      // Patcha la lista per ogni riga succeeded
      queryClient.setQueriesData({ queryKey: ["products"] }, (old: any) => {
        if (!old?.data) return old;
        const byProductStore = new Map(
          result.succeeded.map((sp) => [`${sp.productId}|${sp.storeId}`, sp.stock]),
        );
        return {
          ...old,
          data: old.data.map((p: any) => ({
            ...p,
            storeProducts: p.storeProducts.map((sp: StoreProduct) => {
              const next = byProductStore.get(`${p.id}|${sp.storeId}`);
              return next === undefined ? sp : { ...sp, stock: next };
            }),
          })),
        };
      });
    },
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/seller/src/features/products/hooks/use-bulk-stock-adjust-mutation.ts
git commit -m "feat(seller): useBulkStockAdjustMutation hook"
```

---

## Task 17: Frontend — `BulkStockAdjustDialog`

**Files:**
- Create: `apps/seller/src/features/products/components/bulk-stock-adjust-dialog.tsx`

- [ ] **Step 1: Crea il componente**

```tsx
// apps/seller/src/features/products/components/bulk-stock-adjust-dialog.tsx
import { Button } from "@bibs/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bibs/ui/components/dialog";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { toast } from "@bibs/ui/components/sonner";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@bibs/ui/components/tabs";
import { useState } from "react";
import { useBulkStockAdjustMutation } from "@/features/products/hooks/use-bulk-stock-adjust-mutation";
import { useActiveStore } from "@/hooks/use-active-store";
import { m } from "@/paraglide/messages";

type Mode = "delta-add" | "delta-sub" | "set";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productIds: string[];
  storeId: string;
  onSuccess: () => void;
}

export function BulkStockAdjustDialog({
  open,
  onOpenChange,
  productIds,
  storeId,
  onSuccess,
}: Props) {
  const { activeStore } = useActiveStore();
  const [mode, setMode] = useState<Mode>("delta-add");
  const [value, setValue] = useState("1");

  const mutation = useBulkStockAdjustMutation();

  const parsed = Number.parseInt(value, 10);
  const valueValid = !Number.isNaN(parsed) && (
    mode === "set" ? parsed >= 0 && parsed <= 100000 : parsed >= 1 && parsed <= 1000
  );

  const showZeroWarning = mode === "set" && parsed === 0;

  const onSubmit = () => {
    if (!valueValid) return;
    const body =
      mode === "delta-add"
        ? { mode: "delta" as const, value: parsed }
        : mode === "delta-sub"
          ? { mode: "delta" as const, value: -parsed }
          : { mode: "set" as const, value: parsed };

    mutation.mutate(
      { storeId, productIds, ...body },
      {
        onSuccess: (result) => {
          if (result.failed.length === 0) {
            toast.success(
              m.products_bulk_adjust_success({ count: result.succeeded.length }),
            );
          } else {
            const neg = result.failed.filter((f) => f.reason === "would_go_negative").length;
            const nf = result.failed.filter((f) => f.reason === "not_found").length;
            const parts: string[] = [];
            if (neg > 0) parts.push(`${neg} stock insufficiente`);
            if (nf > 0) parts.push(`${nf} non disponibili`);
            toast.warning(
              m.products_bulk_adjust_partial_warning({
                ok: result.succeeded.length,
                failed: result.failed.length,
                breakdown: parts.join(", "),
              }),
            );
          }
          onSuccess();
          onOpenChange(false);
          setValue("1");
          setMode("delta-add");
        },
        onError: () => toast.error(m.products_bulk_adjust_error()),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {m.products_bulk_adjust_dialog_title({ count: productIds.length })}
          </DialogTitle>
          {activeStore && (
            <DialogDescription>
              {m.products_bulk_adjust_dialog_subtitle({ storeName: activeStore.name })}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4">
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="delta-add">
                {m.products_bulk_adjust_tab_add()}
              </TabsTrigger>
              <TabsTrigger value="delta-sub">
                {m.products_bulk_adjust_tab_sub()}
              </TabsTrigger>
              <TabsTrigger value="set">
                {m.products_bulk_adjust_tab_set()}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-1">
            <Label htmlFor="bulk-value">
              {m.products_bulk_adjust_field_quantity()}
            </Label>
            <Input
              id="bulk-value"
              type="number"
              inputMode="numeric"
              min={mode === "set" ? 0 : 1}
              max={mode === "set" ? 100000 : 1000}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-32"
            />
          </div>

          {showZeroWarning && (
            <div className="bg-warning/10 text-warning rounded-md border border-warning/20 px-3 py-2 text-sm">
              {m.products_bulk_adjust_warning_zero({ count: productIds.length })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!valueValid || mutation.isPending}
          >
            Conferma
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Se `Tabs`/`TabsList`/`TabsTrigger` non sono in `@bibs/ui/components/tabs`, controlla i path effettivi:

```bash
ls packages/ui/src/components/ | grep -i tabs
```

Adatta gli import se necessario.

- [ ] **Step 3: Commit**

```bash
git add apps/seller/src/features/products/components/bulk-stock-adjust-dialog.tsx
git commit -m "feat(seller): BulkStockAdjustDialog with delta/set tabs"
```

---

## Task 18: Frontend — Bottone "Adegua stock" nella toolbar

**Files:**
- Modify: `apps/seller/src/features/products/components/product-bulk-toolbar.tsx`

- [ ] **Step 1: Aggiungi state, import, button**

In cima al file:

```tsx
import { PackageIcon } from "lucide-react"; // aggiungi se non già presente
import { BulkStockAdjustDialog } from "@/features/products/components/bulk-stock-adjust-dialog";
```

Dentro il componente, accanto allo state esistente:

```tsx
const [adjustOpen, setAdjustOpen] = useState(false);
```

Nel ramo `statusFilter === "active"`, **prima** del button "Disabilita":

```tsx
{statusFilter === "active" && (
  <>
    <Button
      size="sm"
      variant="outline"
      onClick={() => setAdjustOpen(true)}
    >
      <PackageIcon className="size-4" />
      {m.products_bulk_adjust_stock_button()}
    </Button>
    <Button size="sm" onClick={apply("disabled")}>
      <EyeOffIcon className="size-4" />
      {m.products_action_disable()}
    </Button>
    <Button size="sm" variant="destructive" onClick={apply("trashed")}>
      <Trash2Icon className="size-4" />
      {m.products_action_trash()}
    </Button>
  </>
)}
```

E in fondo al JSX (accanto al `ConfirmPermanentDeleteDialog`):

```tsx
<BulkStockAdjustDialog
  open={adjustOpen}
  onOpenChange={setAdjustOpen}
  productIds={selectedIds}
  storeId={activeStoreId}
  onSuccess={onClear}
/>
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 3: Manual test**

```bash
bun run dev:seller
```

Su `/products` (statusFilter=active):
- Seleziona 3 prodotti con stock > 0 → toolbar mostra "Adegua stock"
- Click → dialog si apre con N=3 e nome active store
- "Aumenta" 10 → conferma → toast success, stock +10 sui 3 prodotti, deselezione automatica
- Riprova con un prodotto a stock=0 incluso e applica "Diminuisci 1" → toast warning con breakdown "1 stock insufficiente"
- Riprova con "Imposta a 0" → warning inline visibile

Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add apps/seller/src/features/products/components/product-bulk-toolbar.tsx
git commit -m "feat(seller): 'Adegua stock' bulk action in toolbar"
```

---

## Task 19: Verification finale

**Files:** —

- [ ] **Step 1: Typecheck repo**

```bash
bun run typecheck
```

Expected: 0 errori.

- [ ] **Step 2: Lint repo**

```bash
bun run lint
```

Expected: 0 errori. Se Biome auto-fixa qualcosa, ri-stage e commit `style: biome auto-fix`.

- [ ] **Step 3: Test API completi**

```bash
cd apps/api && bun test
```

Expected: tutti pass (la suite stock e filters viene eseguita; nessun regression sul resto).

- [ ] **Step 4: Manual flow completo seller**

```bash
bun run dev:seller
```

Esercita in `localhost:3003` i 12 flow di verifica della spec (sez. 6.b):

1. Inline +5/-3 rapidi → una sola POST con delta=+2
2. Inline set: click numero, "50", Enter → PATCH stock=50
3. Inline 409: stock=2, click -3 → toast error + rollback
4. Inline Esc: click numero, edit, Esc → rollback senza request
5. Sort stock: header click → URL aggiornato, lista riordinata
6. Row action "Aggiungi a un altro negozio" funzionante
7. Dettaglio scoped active store + "anche in:" coerente
8. Dettaglio empty state + button "Rendi disponibile"
9. Bulk happy path su 3 prodotti
10. Bulk partial failure con uno a stock=0
11. Bulk set 0 → warning inline
12. Employee scope: login come employee con accesso a 1 store → vedi solo Store A in lista/dettaglio/info

Ctrl+C.

- [ ] **Step 5: Verifica OpenAPI**

Riavvia API standalone, controlla `http://localhost:3000/openapi`:

```bash
bun run dev:api
```

Cerca i nuovi endpoint sotto il tag "Seller - Stock":
- `POST /seller/products/{productId}/stores/{storeId}/stock-adjust`
- `POST /seller/products/bulk/stock-adjust`

Ognuno deve avere description italiana coerente con il resto.

Ctrl+C.

- [ ] **Step 6: Push del branch + PR (opzionale)**

A scelta dello user. Se desiderato:

```bash
git push -u origin feat/seller-stock-management
gh pr create --title "feat(seller): stock management per store" --body "$(cat <<'EOF'
## Summary
- Cella inline con stepper +/- e input numerico su /products (active store)
- Sort backend `sort=stock`
- Row action "Aggiungi a un altro negozio" → StoreAssignmentDialog
- Refactor ProductStockManager: scoped active store + riga info cross-store
- Bulk adjust dalla toolbar (delta/set + partial failure)
- 2 nuovi endpoint API (POST stock-adjust atomico + POST bulk/stock-adjust)

Spec: `docs/superpowers/specs/2026-05-21-seller-stock-management-design.md`

## Test plan
- [ ] Tutti i nuovi integration test passano (`apps/api/tests/integration/seller-product-stock.test.ts`)
- [ ] sort=stock asc/desc + 400 senza storeId
- [ ] Verifica manuale dei 12 flow seller (vedi spec sez. 6.b)
- [ ] OpenAPI mostra i nuovi endpoint sotto "Seller - Stock"

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review summary

| Spec requirement | Task |
|---|---|
| `StockAdjustBody`, `StockBulkAdjustBody`, `StockBulkAdjustResult` schemas | Task 1 |
| `adjustStock` service + atomic UPDATE | Task 2-3 |
| `POST .../stock-adjust` route | Task 2 |
| `bulkAdjustStock` service (delta + set best-effort) | Task 4-5 |
| `POST /products/bulk/stock-adjust` route | Task 6 |
| Sort `sort=stock` con `storeId` required | Task 7 |
| i18n it + en | Task 9 |
| `useStockAdjustMutation` hook | Task 10 |
| `StockEditorCell` con optimistic + debounce | Task 11 |
| Colonna stock nella lista + sort enabled | Task 12 |
| `StoreAssignmentDialog` | Task 13 |
| Row action "Aggiungi a un altro negozio" | Task 14 |
| `ProductStockManager` refactor (scoped active + info + add) | Task 15 |
| `useBulkStockAdjustMutation` hook | Task 16 |
| `BulkStockAdjustDialog` | Task 17 |
| Bulk toolbar button | Task 18 |
| Verification finale + OpenAPI | Task 19 |
