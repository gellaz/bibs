# Seller — Azioni rapide e bulk sulla tabella prodotti — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere alla pagina `/_authenticated/products` dell'app seller (1) azioni rapide per riga via DropdownMenu, (2) selezione multipla + bulk toolbar, (3) tre stati di prodotto (`active`/`disabled`/`trashed`) gestiti come tab con cestino reversibile, supportati da nuovi endpoint API + audit log + snapshot di prodotto sugli `order_items` per delete fisico sicuro.

**Architecture:** Refactor del campo `products.isActive` (boolean) in `products.status` (`text + CHECK`). Nuova tabella `product_audit_log`. Denormalizzazione di nome/EAN/brand/immagine sul `order_items`. API: PATCH/DELETE singoli con state machine, due endpoint bulk best-effort. Frontend seller: tabs + checkbox di selezione + dropdown azioni + bulk toolbar context-aware, con optimistic UI per single mutation e i18n via Paraglide.

**Tech Stack:** Drizzle ORM (Postgres), Elysia + TypeBox + Eden Treaty, TanStack Start/Query, shadcn/ui, Paraglide. Test: `bun:test`.

**Spec di riferimento:** `docs/superpowers/specs/2026-05-10-seller-products-row-actions-design.md` (commit `2de07a2`).

**Convenzioni del repo (CLAUDE.md):**
- Conventional commits con scope `(api)` o `(seller)`. Niente `--no-verify`.
- Lefthook gestisce Biome + commit-msg in pre-commit. Passa pulito.
- `bun run typecheck` propaga via Eden Treaty ai 3 frontend — sempre verde prima di committare uno step.
- `bun run --filter '@bibs/api' test` per i test backend (gli `--filter` mascherano gli exit code: verifica `$?` esplicito se in dubbio).
- `bun run db:generate` + apertura del file SQL generato + revisione + `bun run db:migrate`. Mai `db:push`.
- I percorsi sotto `apps/api/src` usano l'alias `@/`. I percorsi sotto `apps/seller/src` usano l'alias `~/`.
- Italiano per OpenAPI descriptions e messaggi user-facing; inglese per nomi di funzioni, file, variabili.

---

## File Structure

### Files to create (apps/api)

| File | Responsabilità |
|---|---|
| `apps/api/src/db/schemas/product-audit-log.ts` | Schema Drizzle della tabella `product_audit_log` + costante `PRODUCT_AUDIT_ACTION` |
| `apps/api/src/modules/seller/services/product-audit.ts` | Helper `recordProductAudit` e `recordProductAuditBatch` (single + batch insert nel transaction context) |
| `apps/api/tests/integration/seller-product-status.test.ts` | Test integrazione: `updateProductStatus`, `deleteProductPermanently`, list filtering, status counts |
| `apps/api/tests/integration/seller-product-bulk.test.ts` | Test integrazione: `bulkUpdateProductStatus`, `bulkDeletePermanent` |

### Files to modify (apps/api)

| File | Modifica |
|---|---|
| `apps/api/src/db/schemas/product.ts` | Sostituisci `isActive` con `status` (text + enum + CHECK), aggiungi index `product_status_idx`, aggiorna unique EAN |
| `apps/api/src/db/schemas/order.ts` | Aggiungi colonne snapshot, cambia FK a `set null`, rendi `storeProductId` nullable |
| `apps/api/src/db/schemas/index.ts` | Esporta `productAuditLog` |
| `apps/api/src/lib/schemas/entities.ts` | `ProductSchema`: `isActive` → `status` (TypeBox union literal) |
| `apps/api/src/lib/schemas/index.ts` | Esporta i nuovi schemi (status body, bulk, counts) |
| `apps/api/src/modules/seller/services/products.ts` | Aggiungi `updateProductStatus`, `bulkUpdateProductStatus`, `bulkDeletePermanent`, `getProductStatusCounts`. `deleteProduct` ora gated su `status='trashed'`. `listProducts` accetta `statusFilter` |
| `apps/api/src/modules/seller/routes/products.ts` | Wire dei nuovi endpoint + cambio semantica DELETE + statusFilter su GET |
| `apps/api/src/modules/customer/services/search.ts` | `product.isActive` → `product.status === 'active'` |
| `apps/api/src/modules/customer/services/orders.ts` | `createOrder`: popola snapshot fields su orderItem |
| `apps/api/tests/helpers/fixtures.ts` | `createTestProduct`: rimuovi `isActive`, aggiungi opt `status` (default `'active'`) |
| `apps/api/src/db/seed/*` | Sostituisci eventuali `isActive: true` con `status: 'active'` |

### Files to create (apps/seller)

| File | Responsabilità |
|---|---|
| `apps/seller/src/features/products/hooks/use-product-selection.ts` | Hook stato selezione (Set di id, toggle, header tristate) |
| `apps/seller/src/features/products/hooks/use-product-mutations.ts` | TanStack Query mutations: setStatus single (optimistic), bulkSetStatus, bulkDeletePermanent |
| `apps/seller/src/features/products/components/product-status-tabs.tsx` | Tabs Attivi/Disabilitati/Cestino con count |
| `apps/seller/src/features/products/components/product-row-actions.tsx` | DropdownMenu context-aware per riga |
| `apps/seller/src/features/products/components/product-bulk-toolbar.tsx` | Toolbar bulk sticky context-aware |
| `apps/seller/src/features/products/components/confirm-permanent-delete-dialog.tsx` | AlertDialog di conferma per delete fisico |

### Files to modify (apps/seller)

| File | Modifica |
|---|---|
| `apps/seller/src/routes/_authenticated/products/index.tsx` | Layout completo nuovo: tabs + checkbox + dropdown + bulk toolbar |
| `apps/seller/messages/it.json` | Aggiungi chiavi i18n per tabs/azioni/toast/conferme/empty-states |
| `apps/seller/messages/en.json` | Aggiungi le stesse chiavi in inglese |

---

## Task 1: Schema DB — `products.status`, `order_items` snapshot, `product_audit_log`

**Files:**
- Modify: `apps/api/src/db/schemas/product.ts`
- Modify: `apps/api/src/db/schemas/order.ts`
- Create: `apps/api/src/db/schemas/product-audit-log.ts`
- Modify: `apps/api/src/db/schemas/index.ts`

Lo schema è il fondamento: prima cambia il modello, poi tutto il resto si adatta. Questo task non commita ancora — la migrazione avviene in Task 2 dopo aver aggiornato anche fixtures e seed.

- [ ] **Step 1.1: Aggiorna `product.ts` — sostituisci `isActive` con `status`**

Apri `apps/api/src/db/schemas/product.ts` e sostituisci la sezione del campo `isActive` (riga 36 — `isActive: boolean("is_active").default(true).notNull()`) con la nuova colonna `status`. Aggiorna anche gli indici e aggiungi il CHECK constraint.

```ts
// In testa al file, sotto gli import esistenti:
export const PRODUCT_STATUS = ["active", "disabled", "trashed"] as const;
export type ProductStatus = (typeof PRODUCT_STATUS)[number];

// Dentro pgTable("products", { ... }):
// RIMUOVI: isActive: boolean("is_active").default(true).notNull(),
// AGGIUNGI:
status: text("status", { enum: PRODUCT_STATUS })
    .default("active")
    .notNull(),
```

Nel terzo argomento (`(table) => [ ... ]`) sostituisci l'unique EAN e aggiungi index + check:

```ts
// SOSTITUISCI il vecchio uniqueIndex EAN con:
uniqueIndex("product_seller_ean_unique")
    .on(table.sellerProfileId, table.ean)
    .where(sql`${table.ean} IS NOT NULL AND ${table.status} != 'trashed'`),

// AGGIUNGI dopo gli index esistenti:
index("product_status_idx").on(table.status),
check(
    "product_status_valid",
    sql`${table.status} IN ('active','disabled','trashed')`,
),
```

Verifica che `boolean` non sia più importato se non usato altrove nel file.

- [ ] **Step 1.2: Crea `product-audit-log.ts`**

Crea il file `apps/api/src/db/schemas/product-audit-log.ts` con il contenuto seguente:

```ts
import { sql } from "drizzle-orm";
import {
    check,
    index,
    jsonb,
    pgTable,
    text,
    timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { product } from "./product";

// Esclude 'deleted_permanently' perché l'audit row verrebbe cancellato a cascata
// col prodotto: il delete fisico è registrato solo nei log Pino.
export const PRODUCT_AUDIT_ACTION = [
    "created",
    "updated",
    "disabled",
    "enabled",
    "trashed",
    "restored",
] as const;
export type ProductAuditAction = (typeof PRODUCT_AUDIT_ACTION)[number];

export const productAuditLog = pgTable(
    "product_audit_log",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        productId: text("product_id")
            .notNull()
            .references(() => product.id, { onDelete: "cascade" }),
        actorUserId: text("actor_user_id").references(() => user.id, {
            onDelete: "set null",
        }),
        action: text("action", { enum: PRODUCT_AUDIT_ACTION }).notNull(),
        metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
        occurredAt: timestamp("occurred_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (table) => [
        index("product_audit_product_occurred_idx").on(
            table.productId,
            table.occurredAt.desc(),
        ),
        index("product_audit_actor_idx").on(table.actorUserId),
        check(
            "product_audit_action_valid",
            sql`${table.action} IN ('created','updated','disabled','enabled','trashed','restored')`,
        ),
    ],
);
```

Nota: l'import di `user` viene da `./auth` — verifica che il path sia corretto guardando come fanno gli altri schemas (`grep -l "./auth" apps/api/src/db/schemas/`).

- [ ] **Step 1.3: Aggiorna `order.ts` — snapshot fields su `orderItem`**

Apri `apps/api/src/db/schemas/order.ts`, individua la definizione di `orderItem` (riga ~111) e sostituisci la sezione del campo `storeProductId` con la nuova versione + aggiungi i campi snapshot:

```ts
export const orderItem = pgTable(
    "order_items",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        orderId: text("order_id")
            .notNull()
            .references(() => order.id, { onDelete: "cascade" }),

        // === snapshot al momento dell'ordine (NUOVO) ===
        productName: text("product_name").notNull(),
        productEan: text("product_ean"),
        brandName: text("brand_name"),
        productImageUrl: text("product_image_url"),

        // === soft FK (CAMBIATO da NOT NULL/restrict a nullable/set null) ===
        productId: text("product_id").references(() => product.id, {
            onDelete: "set null",
        }),
        storeProductId: text("store_product_id").references(
            () => storeProduct.id,
            { onDelete: "set null" },
        ),

        // === esistenti invariati ===
        quantity: integer("quantity").notNull(),
        unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
    },
    (table) => [
        index("order_item_order_id_idx").on(table.orderId),
        index("order_item_store_product_id_idx").on(table.storeProductId),
        index("order_item_product_id_idx").on(table.productId),
        check("order_item_quantity_positive", sql`${table.quantity} > 0`),
        check("order_item_unit_price_non_negative", sql`${table.unitPrice} >= 0`),
    ],
);
```

Nota: aggiungi l'import di `product` (`from "./product"`) se non già presente.

- [ ] **Step 1.4: Esporta `productAuditLog` da `db/schemas/index.ts`**

Apri `apps/api/src/db/schemas/index.ts` e aggiungi:

```ts
export * from "./product-audit-log";
```

Mantieni l'ordine alfabetico se il file lo segue.

- [ ] **Step 1.5: Verifica typecheck schema (non commit ancora)**

Run:
```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/api' typecheck
```
Expected: PASS — gli schemi sono solo type definitions, non importano i service che ancora leggono `isActive`.

Se fallisce, è probabilmente perché `apps/api/src` legge `product.isActive` da qualche parte. Annota i punti, li sistemiamo nei task successivi (le references da customer search e fixtures sono già pianificate).

---

## Task 2: Migrazione DB + fixtures + seed

**Files:**
- Modify: `apps/api/tests/helpers/fixtures.ts`
- Modify: `apps/api/src/db/seed/*` (file con `isActive`)
- Create: `apps/api/src/db/migrations/<timestamp>_<name>.sql` (generato)

- [ ] **Step 2.1: Aggiorna `createTestProduct` fixtures**

Apri `apps/api/tests/helpers/fixtures.ts`, individua `createTestProduct` (riga ~107) e sostituisci `isActive: true` con `status: params.status ?? "active"`. Aggiorna anche la signature:

```ts
export async function createTestProduct(
    db: DrizzleTestDb,
    sellerProfileId: string,
    params: {
        name?: string;
        price?: string;
        description?: string;
        status?: "active" | "disabled" | "trashed";
    } = {},
) {
    const [newProduct] = await db
        .insert(product)
        .values({
            sellerProfileId,
            name: params.name ?? "Test Product",
            description: params.description ?? "A test product",
            price: params.price ?? "10.00",
            status: params.status ?? "active",
        })
        .returning();

    return newProduct;
}
```

- [ ] **Step 2.2: Aggiorna seed**

Cerca occorrenze di `isActive` nel seed:
```bash
grep -rn "isActive" /Users/marcogelli/repos/jelaz/bibs/apps/api/src/db/seed
```

Per ogni occorrenza relativa al prodotto, sostituisci `isActive: true` con `status: "active"` e `isActive: false` con `status: "disabled"`.

- [ ] **Step 2.3: Genera la migrazione SQL**

Run:
```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/api' db:generate
```

Drizzle creerà un nuovo file in `apps/api/src/db/migrations/`. Aprilo e ispezionalo. Devi vedere (in qualunque ordine):
- `ALTER TABLE products` — drop `is_active`, add `status text NOT NULL DEFAULT 'active'`, add CHECK, add index `product_status_idx`, drop+recreate dell'unique EAN con il nuovo WHERE.
- `ALTER TABLE order_items` — add `product_name text NOT NULL` (con DEFAULT eventualmente), add `product_ean text`, `brand_name text`, `product_image_url text`, `product_id text REFERENCES products(id)`, drop NOT NULL su `store_product_id`, drop+recreate FK con `ON DELETE SET NULL`, add index `order_item_product_id_idx`.
- `CREATE TABLE product_audit_log` con i suoi indici e check.

⚠️ **Backfill manuale richiesto.** Drizzle non genera automaticamente il backfill di `order_items.product_name`. Edita il file di migrazione per inserire dopo le ADD COLUMN ma prima dei vincoli NOT NULL:

```sql
-- Backfill snapshot dei product_name dai prodotti correnti (best-effort, in dev)
UPDATE "order_items" oi
SET
    "product_name" = COALESCE(p.name, ''),
    "product_ean" = p.ean,
    "brand_name" = b.name,
    "product_image_url" = (
        SELECT pi.url FROM product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.position ASC
        LIMIT 1
    ),
    "product_id" = p.id
FROM "store_products" sp
LEFT JOIN "products" p ON p.id = sp.product_id
LEFT JOIN "brands" b ON b.id = p.brand_id
WHERE oi.store_product_id = sp.id;
```

Se Drizzle ha generato `product_name text DEFAULT ''` (per consentire l'ADD COLUMN su tabella non vuota), va bene così — il backfill sopra lo riempie con i dati reali subito dopo.

- [ ] **Step 2.4: Applica la migrazione**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/api' db:migrate
```

Expected output: nessun errore, la migrazione applicata.

- [ ] **Step 2.5: Re-seed e verifica psql**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/api' infra:reset && bun run --filter '@bibs/api' db:migrate && bun run --filter '@bibs/api' db:seed
```

(`infra:reset` resetta i volumi locali — siamo in dev, è ok.)

Verifica con psql:
```bash
psql $DATABASE_URL -c "\d products" | grep -E "status|is_active"
psql $DATABASE_URL -c "\d order_items" | grep -E "product_name|product_id|store_product"
psql $DATABASE_URL -c "\d product_audit_log"
```

Expected: `status` esiste, `is_active` non esiste; `order_items` ha snapshot fields e i FK sono `set null`; `product_audit_log` esiste.

- [ ] **Step 2.6: Commit schema + migrazione + fixtures**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && git add \
    apps/api/src/db/schemas/product.ts \
    apps/api/src/db/schemas/order.ts \
    apps/api/src/db/schemas/product-audit-log.ts \
    apps/api/src/db/schemas/index.ts \
    apps/api/src/db/migrations/ \
    apps/api/tests/helpers/fixtures.ts \
    apps/api/src/db/seed/

git commit -m "$(cat <<'EOF'
feat(api): products status enum, order items snapshot, audit log

Sostituisce products.is_active boolean con products.status (text +
CHECK) ammettendo 'active'/'disabled'/'trashed'. Aggiunge la tabella
product_audit_log per tracciare le transizioni di stato. Denormalizza
nome/EAN/brand/immagine sul order_items con FK soft a products e
store_products, rendendo il delete fisico di un prodotto sempre
sicuro per lo storico ordini.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Verifica `git status` post-commit: working tree pulito.

---

## Task 3: Allinea customer search al nuovo campo `status`

**Files:**
- Modify: `apps/api/src/modules/customer/services/search.ts:27`
- Test: `apps/api/tests/integration/customer-search.test.ts`

L'unica chiamata fuori dal modulo seller che leggeva `product.isActive` è la search del customer. Non aggiornarla rompe il typecheck del backend.

- [ ] **Step 3.1: Aggiorna la condizione search**

Apri `apps/api/src/modules/customer/services/search.ts`. Alla riga 27 sostituisci:

```ts
// PRIMA:
const conditions: ReturnType<typeof sql>[] = [
    sql`${product.isActive} = true`,
];

// DOPO:
const conditions: ReturnType<typeof sql>[] = [
    sql`${product.status} = 'active'`,
];
```

- [ ] **Step 3.2: Esegui customer-search test**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/api' test:integration -- customer-search
```

Expected: PASS. Se i test falliscono perché creano prodotti con `isActive: false`, aggiornali a usare `status: "disabled"` (passando il nuovo opt al fixture). Cerca con `grep -n "isActive" apps/api/tests/integration/customer-search.test.ts`.

- [ ] **Step 3.3: Typecheck globale**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run typecheck
```

Expected: PASS. Se compaiono errori in altre app (admin/customer/seller frontend), grep per `isActive` e `\.is_active` per trovare le ultime references.

- [ ] **Step 3.4: Commit**

```bash
git add apps/api/src/modules/customer/services/search.ts \
        apps/api/tests/integration/customer-search.test.ts
git commit -m "$(cat <<'EOF'
refactor(api): customer search filtra per status='active'

Allinea il modulo customer al nuovo campo products.status (sostituisce
il vecchio products.is_active).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: TypeBox `ProductSchema` — `isActive` → `status`

**Files:**
- Modify: `apps/api/src/lib/schemas/entities.ts:262`

`ProductSchema` viene esportato via OpenAPI e propagato ai 3 frontend via Eden Treaty. Cambiare il campo qui rompe i tre frontend → typecheck globale lo rileva.

- [ ] **Step 4.1: Aggiorna `ProductSchema`**

Apri `apps/api/src/lib/schemas/entities.ts`, riga ~262. Sostituisci:

```ts
// PRIMA:
isActive: t.Boolean({ description: "Se il prodotto è attivo e visibile" }),

// DOPO:
status: t.Union(
    [t.Literal("active"), t.Literal("disabled"), t.Literal("trashed")],
    {
        description:
            "Stato del prodotto: 'active' (visibile), 'disabled' (nascosto al customer), 'trashed' (in cestino, eliminabile fisicamente)",
        default: "active",
    },
),
```

In testa al file, se non già esposto, aggiungi import:
```ts
// (in cima al file se serve per riusabilità)
// Nessun import aggiuntivo richiesto: i Literal sono builtin TypeBox.
```

- [ ] **Step 4.2: Verifica typecheck globale**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run typecheck
```

Expected: PASS lato API. **Falliranno** i frontend (admin/customer/seller) che leggono `product.isActive` da qualche parte. Esegui:
```bash
grep -rn "\.isActive" /Users/marcogelli/repos/jelaz/bibs/apps/admin/src /Users/marcogelli/repos/jelaz/bibs/apps/customer/src /Users/marcogelli/repos/jelaz/bibs/apps/seller/src 2>/dev/null
```

Per ogni occorrenza che riferisce un prodotto, valuta il fix corretto (di solito `product.isActive` → `product.status === "active"`). Se l'occorrenza riguarda un'altra entità (store opening hours, sidebar UI), lasciala stare.

Annota i punti modificati per includerli nel commit. Se non ci sono, perfetto.

- [ ] **Step 4.3: Commit**

```bash
git add apps/api/src/lib/schemas/entities.ts
# + eventuali file frontend toccati
git commit -m "$(cat <<'EOF'
refactor(api): ProductSchema usa status invece di isActive

Aggiorna lo schema OpenAPI/TypeBox del prodotto per riflettere il
campo status (text + enum). Propagato ai 3 frontend via Eden Treaty.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Helper `recordProductAudit` (single + batch)

**Files:**
- Create: `apps/api/src/modules/seller/services/product-audit.ts`
- Test: `apps/api/tests/integration/seller-product-audit.test.ts` (nuovo file)

- [ ] **Step 5.1: Scrivi il test (failing)**

Crea `apps/api/tests/integration/seller-product-audit.test.ts`:

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
import { productAuditLog } from "@/db/schemas/product-audit-log";
import {
    recordProductAudit,
    recordProductAuditBatch,
} from "@/modules/seller/services/product-audit";
import { truncateAll } from "../helpers/cleanup";
import {
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

describe("recordProductAudit", () => {
    it("inserts an audit row with action and actor", async () => {
        const db = getTestDb();
        const seller = await createTestSeller(db);
        const product = await createTestProduct(db, seller.profile.id);

        await recordProductAudit({
            productId: product.id,
            actorUserId: seller.user.id,
            action: "disabled",
            metadata: { reason: "out of stock" },
        });

        const rows = await db.query.productAuditLog.findMany({
            where: eq(productAuditLog.productId, product.id),
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].action).toBe("disabled");
        expect(rows[0].actorUserId).toBe(seller.user.id);
        expect(rows[0].metadata).toEqual({ reason: "out of stock" });
    });

    it("supports null actorUserId for system actions", async () => {
        const db = getTestDb();
        const seller = await createTestSeller(db);
        const product = await createTestProduct(db, seller.profile.id);

        await recordProductAudit({
            productId: product.id,
            actorUserId: null,
            action: "created",
        });

        const rows = await db.query.productAuditLog.findMany({
            where: eq(productAuditLog.productId, product.id),
        });
        expect(rows[0].actorUserId).toBeNull();
    });
});

describe("recordProductAuditBatch", () => {
    it("inserts multiple rows in a single insert", async () => {
        const db = getTestDb();
        const seller = await createTestSeller(db);
        const p1 = await createTestProduct(db, seller.profile.id, { name: "P1" });
        const p2 = await createTestProduct(db, seller.profile.id, { name: "P2" });

        await recordProductAuditBatch([
            { productId: p1.id, actorUserId: seller.user.id, action: "trashed" },
            { productId: p2.id, actorUserId: seller.user.id, action: "trashed" },
        ]);

        const rows = await db.query.productAuditLog.findMany();
        expect(rows).toHaveLength(2);
        expect(rows.every((r) => r.action === "trashed")).toBe(true);
    });

    it("is a no-op on empty input", async () => {
        await expect(recordProductAuditBatch([])).resolves.toBeUndefined();
    });
});
```

- [ ] **Step 5.2: Esegui il test e verifica fallimento**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/api' test:integration -- seller-product-audit
```
Expected: FAIL con "Cannot find module" o simile (il file `product-audit.ts` ancora non esiste).

- [ ] **Step 5.3: Implementa l'helper**

Crea `apps/api/src/modules/seller/services/product-audit.ts`:

```ts
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
    type ProductAuditAction,
    productAuditLog,
} from "@/db/schemas/product-audit-log";

export interface RecordAuditParams {
    productId: string;
    actorUserId: string | null;
    action: ProductAuditAction;
    metadata?: Record<string, unknown>;
}

// Drizzle non esporta un tipo Transaction generico user-friendly: usiamo un tipo
// permissivo. La type-safety vera è data dal `db.insert(productAuditLog).values(...)`.
type Tx = PgTransaction<any, any, ExtractTablesWithRelations<any>> | typeof db;

export async function recordProductAudit(
    params: RecordAuditParams,
    tx: Tx = db,
): Promise<void> {
    await tx.insert(productAuditLog).values({
        productId: params.productId,
        actorUserId: params.actorUserId,
        action: params.action,
        metadata: params.metadata ?? null,
    });
}

export async function recordProductAuditBatch(
    entries: RecordAuditParams[],
    tx: Tx = db,
): Promise<void> {
    if (entries.length === 0) return;
    await tx.insert(productAuditLog).values(
        entries.map((e) => ({
            productId: e.productId,
            actorUserId: e.actorUserId,
            action: e.action,
            metadata: e.metadata ?? null,
        })),
    );
}
```

- [ ] **Step 5.4: Esegui il test e verifica passa**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/api' test:integration -- seller-product-audit
```
Expected: PASS, 4 test verdi.

- [ ] **Step 5.5: Commit**

```bash
git add apps/api/src/modules/seller/services/product-audit.ts \
        apps/api/tests/integration/seller-product-audit.test.ts
git commit -m "$(cat <<'EOF'
feat(api): helper recordProductAudit per il log delle azioni prodotto

Aggiunge recordProductAudit (single) e recordProductAuditBatch
(batch insert) per scrivere su product_audit_log dentro o fuori
transazione. Ammette actorUserId null per azioni di sistema.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Service `updateProductStatus` + endpoint

**Files:**
- Modify: `apps/api/src/modules/seller/services/products.ts`
- Modify: `apps/api/src/modules/seller/routes/products.ts`
- Modify: `apps/api/src/lib/schemas/index.ts` (esporta `ProductStatusBody`)
- Test: `apps/api/tests/integration/seller-product-status.test.ts` (nuovo)

- [ ] **Step 6.1: Scrivi il test (failing)**

Crea `apps/api/tests/integration/seller-product-status.test.ts`:

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

mock.module("@/lib/s3", () => ({
    s3: { delete: mock(async () => {}) },
}));

import { eq } from "drizzle-orm";
import { product as productTable } from "@/db/schemas/product";
import { productAuditLog } from "@/db/schemas/product-audit-log";
import { ServiceError } from "@/lib/errors";
import { updateProductStatus } from "@/modules/seller/services/products";
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

async function makeAccessibleProduct(opts: { status?: "active" | "disabled" | "trashed" } = {}) {
    const db = getTestDb();
    const seller = await createTestSeller(db);
    const store = await createTestStore(db, seller.profile.id);
    const p = await createTestProduct(db, seller.profile.id, {
        status: opts.status,
    });
    await createTestStoreProduct(db, store.id, p.id);
    return { db, seller, store, product: p };
}

describe("updateProductStatus", () => {
    it("transitions active → disabled and writes audit", async () => {
        const { db, seller, store, product } = await makeAccessibleProduct();

        const updated = await updateProductStatus({
            productId: product.id,
            sellerProfileId: seller.profile.id,
            accessibleStoreIds: [store.id],
            actorUserId: seller.user.id,
            status: "disabled",
        });

        expect(updated.status).toBe("disabled");

        const audit = await db.query.productAuditLog.findMany({
            where: eq(productAuditLog.productId, product.id),
        });
        expect(audit).toHaveLength(1);
        expect(audit[0].action).toBe("disabled");
    });

    it("transitions trashed → active emits 'restored'", async () => {
        const { db, seller, store, product } = await makeAccessibleProduct({
            status: "trashed",
        });

        await updateProductStatus({
            productId: product.id,
            sellerProfileId: seller.profile.id,
            accessibleStoreIds: [store.id],
            actorUserId: seller.user.id,
            status: "active",
        });

        const audit = await db.query.productAuditLog.findMany({
            where: eq(productAuditLog.productId, product.id),
        });
        expect(audit[0].action).toBe("restored");
        expect(audit[0].metadata).toMatchObject({ previousStatus: "trashed" });
    });

    it("is a no-op when status is already the requested one", async () => {
        const { db, seller, store, product } = await makeAccessibleProduct({
            status: "active",
        });

        await updateProductStatus({
            productId: product.id,
            sellerProfileId: seller.profile.id,
            accessibleStoreIds: [store.id],
            actorUserId: seller.user.id,
            status: "active",
        });

        const audit = await db.query.productAuditLog.findMany();
        expect(audit).toHaveLength(0);
    });

    it("throws 404 when product belongs to another seller", async () => {
        const db = getTestDb();
        const sellerA = await createTestSeller(db, { email: "a@test.com" });
        const sellerB = await createTestSeller(db, { email: "b@test.com" });
        const storeB = await createTestStore(db, sellerB.profile.id);
        const productA = await createTestProduct(db, sellerA.profile.id);

        await expect(
            updateProductStatus({
                productId: productA.id,
                sellerProfileId: sellerB.profile.id,
                accessibleStoreIds: [storeB.id],
                actorUserId: sellerB.user.id,
                status: "disabled",
            }),
        ).rejects.toBeInstanceOf(ServiceError);
    });

    it("throws 404 when product is not in accessible stores", async () => {
        const db = getTestDb();
        const seller = await createTestSeller(db);
        const storeA = await createTestStore(db, seller.profile.id, { name: "A" });
        const storeB = await createTestStore(db, seller.profile.id, { name: "B" });
        const product = await createTestProduct(db, seller.profile.id);
        await createTestStoreProduct(db, storeA.id, product.id);

        await expect(
            updateProductStatus({
                productId: product.id,
                sellerProfileId: seller.profile.id,
                accessibleStoreIds: [storeB.id], // ha accesso solo a B, prodotto è in A
                actorUserId: seller.user.id,
                status: "disabled",
            }),
        ).rejects.toBeInstanceOf(ServiceError);
    });
});
```

- [ ] **Step 6.2: Esegui i test e verifica fallimento**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/api' test:integration -- seller-product-status
```
Expected: FAIL — `updateProductStatus is not a function` o "module not found".

- [ ] **Step 6.3: Implementa il service**

Apri `apps/api/src/modules/seller/services/products.ts` e aggiungi in fondo (prima di eventuali export indirizzati):

```ts
import {
    PRODUCT_STATUS,
    type ProductStatus,
} from "@/db/schemas/product";
import {
    type ProductAuditAction,
} from "@/db/schemas/product-audit-log";
import {
    recordProductAudit,
} from "./product-audit";

// ── updateProductStatus ───────────────────────────────────────────────────────

interface UpdateProductStatusParams {
    productId: string;
    sellerProfileId: string;
    accessibleStoreIds: string[];
    actorUserId: string;
    status: ProductStatus;
}

function deriveAuditAction(
    previous: ProductStatus,
    next: ProductStatus,
): ProductAuditAction {
    if (next === "trashed") return "trashed";
    if (previous === "trashed") return "restored";
    if (next === "disabled") return "disabled";
    return "enabled";
}

export async function updateProductStatus(params: UpdateProductStatusParams) {
    const {
        productId,
        sellerProfileId,
        accessibleStoreIds,
        actorUserId,
        status,
    } = params;

    const found = await db.query.product.findFirst({
        where: and(
            eq(product.id, productId),
            eq(product.sellerProfileId, sellerProfileId),
        ),
        with: { storeProducts: { columns: { storeId: true } } },
    });
    if (!found) throw new ServiceError(404, "Product not found");

    const accessible = found.storeProducts.some((sp) =>
        accessibleStoreIds.includes(sp.storeId),
    );
    if (!accessible) throw new ServiceError(404, "Product not found");

    if (found.status === status) return found;

    return db.transaction(async (tx) => {
        const [updated] = await tx
            .update(product)
            .set({ status, updatedAt: new Date() })
            .where(eq(product.id, productId))
            .returning();

        const action = deriveAuditAction(found.status, status);
        await recordProductAudit(
            {
                productId,
                actorUserId,
                action,
                metadata:
                    action === "restored"
                        ? { previousStatus: found.status, newStatus: status }
                        : undefined,
            },
            tx,
        );

        return updated;
    });
}
```

Nota: assicurati che `import { product, ... }` sia già presente in cima al file (lo è dal codice esistente).

- [ ] **Step 6.4: Esegui i test e verifica passa**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/api' test:integration -- seller-product-status
```
Expected: PASS, 5 test verdi.

- [ ] **Step 6.5: Aggiungi `ProductStatusBody` schema TypeBox**

Apri `apps/api/src/lib/schemas/entities.ts` (o `composed.ts`, scegli per coerenza con dove sono i body schemas — guarda dove è `CreateProductBody`). Aggiungi:

```ts
import { PRODUCT_STATUS } from "@/db/schemas/product";

export const ProductStatusBody = t.Object({
    status: t.Union(
        PRODUCT_STATUS.map((s) => t.Literal(s)),
        { description: "Nuovo stato del prodotto" },
    ),
});
```

Verifica che sia esportato da `apps/api/src/lib/schemas/index.ts`.

- [ ] **Step 6.6: Wire endpoint PATCH /products/:productId/status**

Apri `apps/api/src/modules/seller/routes/products.ts`. Aggiungi prima del `.delete(...)` esistente:

```ts
.patch(
    "/products/:productId/status",
    async (ctx) => {
        const sellerCtx = withSeller(ctx);
        const { sellerProfile: sp, params, body, user, store } = sellerCtx;
        const pino = getLogger(store);
        const accessibleStoreIds = await sellerCtx.getAccessibleStoreIds();

        const updated = await updateProductStatus({
            productId: params.productId,
            sellerProfileId: sp.id,
            accessibleStoreIds,
            actorUserId: user.id,
            status: body.status,
        });

        pino.info(
            {
                userId: user.id,
                sellerProfileId: sp.id,
                productId: updated.id,
                status: updated.status,
                action: "product_status_updated",
            },
            "Stato prodotto aggiornato",
        );

        return ok(updated);
    },
    {
        params: t.Object({
            productId: t.String({ description: "ID del prodotto" }),
        }),
        body: ProductStatusBody,
        response: withErrors({ 200: okRes(ProductSchema) }),
        detail: {
            summary: "Aggiorna stato prodotto",
            description:
                "Cambia lo stato del prodotto (active/disabled/trashed). Scrive un'entry sull'audit log se lo stato cambia. No-op se lo stato è già quello richiesto.",
            tags: ["Seller - Products"],
        },
    },
)
```

Aggiungi `updateProductStatus` agli import dal services file (riga ~26) e `ProductStatusBody` agli import dal schemas (riga ~13).

- [ ] **Step 6.7: Run typecheck + integration test**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run typecheck && bun run --filter '@bibs/api' test:integration -- seller-product-status
```
Expected: PASS.

- [ ] **Step 6.8: Commit**

```bash
git add apps/api/src/modules/seller/services/products.ts \
        apps/api/src/modules/seller/routes/products.ts \
        apps/api/src/lib/schemas/entities.ts \
        apps/api/tests/integration/seller-product-status.test.ts
git commit -m "$(cat <<'EOF'
feat(api): PATCH /seller/products/:id/status

Aggiunge endpoint per la transizione di stato del prodotto
(active/disabled/trashed) con scrittura su product_audit_log
e log Pino. No-op se lo stato è già quello richiesto.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Refactor `deleteProduct` — gate su `trashed`

**Files:**
- Modify: `apps/api/src/modules/seller/services/products.ts`
- Modify: `apps/api/src/modules/seller/routes/products.ts` (solo description aggiornata)
- Test: `apps/api/tests/integration/seller-product-status.test.ts` (estendi)

`DELETE /products/:id` cambia semantica: oggi fa hard delete sempre, ora solo se `status === 'trashed'`. Niente tocco al log Pino già presente — è esattamente il comportamento desiderato dalla spec (delete fisico solo su Pino, non su audit log).

- [ ] **Step 7.1: Estendi i test**

Aggiungi a `apps/api/tests/integration/seller-product-status.test.ts`:

```ts
import { deleteProduct } from "@/modules/seller/services/products";

describe("deleteProduct (permanent)", () => {
    it("succeeds when product is in trash", async () => {
        const { db, seller, store, product } = await makeAccessibleProduct({
            status: "trashed",
        });

        const deleted = await deleteProduct({
            productId: product.id,
            sellerProfileId: seller.profile.id,
            accessibleStoreIds: [store.id],
        });
        expect(deleted.id).toBe(product.id);

        const remaining = await db.query.product.findFirst({
            where: eq(productTable.id, product.id),
        });
        expect(remaining).toBeUndefined();
    });

    it("returns 409 when product is not in trash", async () => {
        const { seller, store, product } = await makeAccessibleProduct({
            status: "active",
        });

        await expect(
            deleteProduct({
                productId: product.id,
                sellerProfileId: seller.profile.id,
                accessibleStoreIds: [store.id],
            }),
        ).rejects.toMatchObject({
            status: 409,
        });
    });
});
```

- [ ] **Step 7.2: Run failing test**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/api' test:integration -- seller-product-status
```
Expected: i 5 test originali passano, i 2 nuovi falliscono — il primo passa, il secondo fallisce perché non c'è ancora il gate 409.

- [ ] **Step 7.3: Aggiungi il gate 409 in `deleteProduct`**

Apri `apps/api/src/modules/seller/services/products.ts`, individua `deleteProduct` (riga ~380). Subito dopo il check di accessibilità (`if (!accessible)...`) e prima del `images` fetch, aggiungi:

```ts
if (check.status !== "trashed") {
    throw new ServiceError(
        409,
        "Sposta prima il prodotto nel cestino",
    );
}
```

Per ottenere `check.status`, aggiorna la query di check (riga ~384) per includere `status` nelle columns:

```ts
// La query .findFirst restituisce già tutti i campi di product per default
// con i `with` espliciti. Verifica che `check.status` sia accessibile.
// Se non lo è (es. se la query usa columns: { ... }), aggiungi status.
```

Guardando il codice esistente (`with: { storeProducts: { columns: { storeId: true } } }`), `findFirst` su `product` torna tutto di product di default. Quindi `check.status` è già disponibile.

- [ ] **Step 7.4: Run test e verifica passa**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/api' test:integration -- seller-product-status
```
Expected: PASS, 7 test verdi.

- [ ] **Step 7.5: Aggiorna OpenAPI description del DELETE**

Apri `apps/api/src/modules/seller/routes/products.ts`, sezione `.delete(...)` (riga ~282). Cambia il `summary` e `description`:

```ts
detail: {
    summary: "Elimina prodotto definitivamente",
    description:
        "Elimina fisicamente un prodotto e tutti i dati associati (immagini, stock, classificazioni). Richiede che il prodotto sia in cestino (status='trashed'); altrimenti restituisce 409. Per nascondere un prodotto senza eliminarlo, usa PATCH /:id/status con status='disabled' o 'trashed'.",
    tags: ["Seller - Products"],
},
```

- [ ] **Step 7.6: Commit**

```bash
git add apps/api/src/modules/seller/services/products.ts \
        apps/api/src/modules/seller/routes/products.ts \
        apps/api/tests/integration/seller-product-status.test.ts
git commit -m "$(cat <<'EOF'
refactor(api): DELETE /seller/products/:id richiede status='trashed'

Cambia la semantica: il delete fisico è ora gated dal cestino.
Ritorna 409 se il prodotto non è in stato 'trashed'. Usa
PATCH /:id/status con status='trashed' come passo intermedio.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Service `bulkUpdateProductStatus` + endpoint

**Files:**
- Modify: `apps/api/src/modules/seller/services/products.ts`
- Modify: `apps/api/src/modules/seller/routes/products.ts`
- Modify: `apps/api/src/lib/schemas/entities.ts` (BulkStatusBody, BulkResultSchema)
- Test: `apps/api/tests/integration/seller-product-bulk.test.ts` (nuovo)

- [ ] **Step 8.1: Scrivi il test (failing)**

Crea `apps/api/tests/integration/seller-product-bulk.test.ts` con setup analogo a `seller-product-status.test.ts` (mock @/db, mock @/lib/s3, helpers, lifecycle), poi:

```ts
import {
    bulkUpdateProductStatus,
} from "@/modules/seller/services/products";

describe("bulkUpdateProductStatus", () => {
    it("succeeds for all accessible products and writes audit batch", async () => {
        const db = getTestDb();
        const seller = await createTestSeller(db);
        const store = await createTestStore(db, seller.profile.id);
        const p1 = await createTestProduct(db, seller.profile.id, { name: "P1" });
        const p2 = await createTestProduct(db, seller.profile.id, { name: "P2" });
        await createTestStoreProduct(db, store.id, p1.id);
        await createTestStoreProduct(db, store.id, p2.id);

        const result = await bulkUpdateProductStatus({
            sellerProfileId: seller.profile.id,
            accessibleStoreIds: [store.id],
            actorUserId: seller.user.id,
            productIds: [p1.id, p2.id],
            status: "disabled",
        });

        expect(result.succeeded).toEqual(expect.arrayContaining([p1.id, p2.id]));
        expect(result.failed).toEqual([]);

        const audit = await db.query.productAuditLog.findMany();
        expect(audit).toHaveLength(2);
        expect(audit.every((r) => r.action === "disabled")).toBe(true);
    });

    it("partitions failed by reason", async () => {
        const db = getTestDb();
        const sellerA = await createTestSeller(db, { email: "a@test.com" });
        const sellerB = await createTestSeller(db, { email: "b@test.com" });
        const storeA = await createTestStore(db, sellerA.profile.id);
        const storeB = await createTestStore(db, sellerB.profile.id);
        const pAccessible = await createTestProduct(db, sellerA.profile.id);
        const pNotAccessible = await createTestProduct(db, sellerA.profile.id);
        const pOtherSeller = await createTestProduct(db, sellerB.profile.id);
        await createTestStoreProduct(db, storeA.id, pAccessible.id);
        await createTestStoreProduct(db, storeB.id, pNotAccessible.id); // accessible solo a sellerB
        await createTestStoreProduct(db, storeB.id, pOtherSeller.id);

        const result = await bulkUpdateProductStatus({
            sellerProfileId: sellerA.profile.id,
            accessibleStoreIds: [storeA.id],
            actorUserId: sellerA.user.id,
            productIds: [pAccessible.id, pNotAccessible.id, pOtherSeller.id, "non-existent"],
            status: "trashed",
        });

        expect(result.succeeded).toEqual([pAccessible.id]);
        const failedById = new Map(result.failed.map((f) => [f.productId, f.reason]));
        expect(failedById.get(pNotAccessible.id)).toBe("no_access");
        expect(failedById.get(pOtherSeller.id)).toBe("not_found");
        expect(failedById.get("non-existent")).toBe("not_found");
    });

    it("skips no-op transitions in audit log", async () => {
        const db = getTestDb();
        const seller = await createTestSeller(db);
        const store = await createTestStore(db, seller.profile.id);
        const pActive = await createTestProduct(db, seller.profile.id, { status: "active" });
        const pDisabled = await createTestProduct(db, seller.profile.id, { status: "disabled" });
        await createTestStoreProduct(db, store.id, pActive.id);
        await createTestStoreProduct(db, store.id, pDisabled.id);

        await bulkUpdateProductStatus({
            sellerProfileId: seller.profile.id,
            accessibleStoreIds: [store.id],
            actorUserId: seller.user.id,
            productIds: [pActive.id, pDisabled.id],
            status: "disabled",
        });

        const audit = await db.query.productAuditLog.findMany();
        expect(audit).toHaveLength(1); // pActive transitioned, pDisabled was no-op
        expect(audit[0].productId).toBe(pActive.id);
    });
});
```

- [ ] **Step 8.2: Run failing test**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/api' test:integration -- seller-product-bulk
```
Expected: FAIL — `bulkUpdateProductStatus` non esiste.

- [ ] **Step 8.3: Implementa `bulkUpdateProductStatus`**

In `apps/api/src/modules/seller/services/products.ts`, aggiungi sotto `updateProductStatus`:

```ts
import { recordProductAuditBatch } from "./product-audit";

interface BulkUpdateParams {
    sellerProfileId: string;
    accessibleStoreIds: string[];
    actorUserId: string;
    productIds: string[];
    status: ProductStatus;
}

interface BulkResult {
    succeeded: string[];
    failed: { productId: string; reason: "not_found" | "no_access" }[];
}

export async function bulkUpdateProductStatus(
    params: BulkUpdateParams,
): Promise<BulkResult> {
    const {
        sellerProfileId,
        accessibleStoreIds,
        actorUserId,
        productIds,
        status,
    } = params;

    if (productIds.length === 0) return { succeeded: [], failed: [] };

    return db.transaction(async (tx) => {
        // 1. Carica i prodotti del seller con relativi storeIds
        const ownedRows = await tx
            .select({
                id: product.id,
                status: product.status,
                storeId: storeProduct.storeId,
            })
            .from(product)
            .innerJoin(storeProduct, eq(storeProduct.productId, product.id))
            .where(
                and(
                    inArray(product.id, productIds),
                    eq(product.sellerProfileId, sellerProfileId),
                ),
            );

        // 2. Determina ownership / accessibility
        const ownedIds = new Set<string>();
        const accessibleIds = new Set<string>();
        const previousStatusByProduct = new Map<string, ProductStatus>();
        for (const r of ownedRows) {
            ownedIds.add(r.id);
            previousStatusByProduct.set(r.id, r.status as ProductStatus);
            if (accessibleStoreIds.includes(r.storeId)) accessibleIds.add(r.id);
        }

        const failed: BulkResult["failed"] = [];
        const accessibleArr: string[] = [];
        for (const id of productIds) {
            if (!ownedIds.has(id)) {
                failed.push({ productId: id, reason: "not_found" });
            } else if (!accessibleIds.has(id)) {
                failed.push({ productId: id, reason: "no_access" });
            } else {
                accessibleArr.push(id);
            }
        }

        // 3. Filter to those whose status actually changes
        const toUpdate = accessibleArr.filter(
            (id) => previousStatusByProduct.get(id) !== status,
        );

        if (toUpdate.length > 0) {
            await tx
                .update(product)
                .set({ status, updatedAt: new Date() })
                .where(inArray(product.id, toUpdate));

            // 4. Audit batch
            const entries = toUpdate.map((id) => {
                const prev = previousStatusByProduct.get(id) as ProductStatus;
                const action = deriveAuditAction(prev, status);
                return {
                    productId: id,
                    actorUserId,
                    action,
                    metadata:
                        action === "restored"
                            ? { previousStatus: prev, newStatus: status }
                            : undefined,
                };
            });
            await recordProductAuditBatch(entries, tx);
        }

        return { succeeded: accessibleArr, failed };
    });
}
```

Nota: `accessibleArr` è la lista di id che il chiamante può "agire", a prescindere dal fatto che lo stato cambi (no-op consiste nel succeded ma senza audit). Questo è coerente con la semantica REST.

- [ ] **Step 8.4: Run test e verifica passa**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/api' test:integration -- seller-product-bulk
```
Expected: PASS, 3 test verdi.

- [ ] **Step 8.5: Aggiungi schemi TypeBox bulk**

In `apps/api/src/lib/schemas/entities.ts` (o dove sono i body schema), aggiungi:

```ts
export const BulkStatusBody = t.Object({
    productIds: t.Array(t.String(), { minItems: 1, maxItems: 100 }),
    status: t.Union(
        PRODUCT_STATUS.map((s) => t.Literal(s)),
        { description: "Stato target da applicare a tutti gli ID" },
    ),
});

export const BulkStatusResult = t.Object({
    succeeded: t.Array(t.String(), {
        description: "ID dei prodotti cambiati (o già nello stato richiesto)",
    }),
    failed: t.Array(
        t.Object({
            productId: t.String(),
            reason: t.Union([
                t.Literal("not_found"),
                t.Literal("no_access"),
            ]),
        }),
    ),
});
```

- [ ] **Step 8.6: Wire endpoint POST /products/bulk/status**

In `apps/api/src/modules/seller/routes/products.ts`, aggiungi prima del `.delete(...)`:

```ts
.post(
    "/products/bulk/status",
    async (ctx) => {
        const sellerCtx = withSeller(ctx);
        const { sellerProfile: sp, body, user, store } = sellerCtx;
        const pino = getLogger(store);
        const accessibleStoreIds = await sellerCtx.getAccessibleStoreIds();

        const result = await bulkUpdateProductStatus({
            sellerProfileId: sp.id,
            accessibleStoreIds,
            actorUserId: user.id,
            productIds: body.productIds,
            status: body.status,
        });

        pino.info(
            {
                userId: user.id,
                sellerProfileId: sp.id,
                requested: body.productIds.length,
                succeeded: result.succeeded.length,
                failed: result.failed.length,
                status: body.status,
                action: "products_bulk_status_updated",
            },
            "Bulk update di stato prodotti",
        );

        return ok(result);
    },
    {
        body: BulkStatusBody,
        response: withErrors({ 200: okRes(BulkStatusResult) }),
        detail: {
            summary: "Cambia stato di più prodotti",
            description:
                "Imposta lo stato (active/disabled/trashed) di più prodotti in un'unica chiamata. Best-effort: gli ID inaccessibili o non trovati finiscono in 'failed' con la reason. Limite: 100 ID per chiamata.",
            tags: ["Seller - Products"],
        },
    },
)
```

Aggiungi `bulkUpdateProductStatus`, `BulkStatusBody`, `BulkStatusResult` agli import.

- [ ] **Step 8.7: Run typecheck + test**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run typecheck && bun run --filter '@bibs/api' test:integration -- seller-product-bulk
```
Expected: PASS.

- [ ] **Step 8.8: Commit**

```bash
git add apps/api/src/modules/seller/services/products.ts \
        apps/api/src/modules/seller/routes/products.ts \
        apps/api/src/lib/schemas/entities.ts \
        apps/api/tests/integration/seller-product-bulk.test.ts
git commit -m "$(cat <<'EOF'
feat(api): POST /seller/products/bulk/status

Cambia in massa lo stato (active/disabled/trashed) di fino a 100
prodotti per chiamata. Response best-effort con succeeded[] e
failed[{productId, reason}]. Scrive un audit log entry per ogni
prodotto effettivamente cambiato (no-op vengono saltati).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Service `bulkDeletePermanent` + endpoint

**Files:**
- Modify: `apps/api/src/modules/seller/services/products.ts`
- Modify: `apps/api/src/modules/seller/routes/products.ts`
- Modify: `apps/api/src/lib/schemas/entities.ts`
- Test: `apps/api/tests/integration/seller-product-bulk.test.ts` (estendi)

- [ ] **Step 9.1: Estendi test**

Aggiungi a `apps/api/tests/integration/seller-product-bulk.test.ts`:

```ts
import { bulkDeletePermanent } from "@/modules/seller/services/products";

describe("bulkDeletePermanent", () => {
    it("deletes only products in trash and reports the rest as failed", async () => {
        const db = getTestDb();
        const seller = await createTestSeller(db);
        const store = await createTestStore(db, seller.profile.id);
        const pTrash = await createTestProduct(db, seller.profile.id, {
            name: "P-trash",
            status: "trashed",
        });
        const pActive = await createTestProduct(db, seller.profile.id, {
            name: "P-active",
            status: "active",
        });
        await createTestStoreProduct(db, store.id, pTrash.id);
        await createTestStoreProduct(db, store.id, pActive.id);

        const result = await bulkDeletePermanent({
            sellerProfileId: seller.profile.id,
            accessibleStoreIds: [store.id],
            productIds: [pTrash.id, pActive.id, "non-existent"],
        });

        expect(result.succeeded).toEqual([pTrash.id]);
        const failedById = new Map(result.failed.map((f) => [f.productId, f.reason]));
        expect(failedById.get(pActive.id)).toBe("not_in_trash");
        expect(failedById.get("non-existent")).toBe("not_found");

        // Verify deletion
        const remaining = await db.query.product.findMany();
        expect(remaining.map((p) => p.id)).toEqual(
            expect.arrayContaining([pActive.id]),
        );
        expect(remaining.find((p) => p.id === pTrash.id)).toBeUndefined();
    });
});
```

- [ ] **Step 9.2: Run failing**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/api' test:integration -- seller-product-bulk
```
Expected: FAIL.

- [ ] **Step 9.3: Implementa `bulkDeletePermanent`**

In `apps/api/src/modules/seller/services/products.ts`, sotto `bulkUpdateProductStatus`:

```ts
interface BulkDeleteParams {
    sellerProfileId: string;
    accessibleStoreIds: string[];
    productIds: string[];
}

interface BulkDeleteResult {
    succeeded: string[];
    failed: {
        productId: string;
        reason: "not_found" | "no_access" | "not_in_trash";
    }[];
}

export async function bulkDeletePermanent(
    params: BulkDeleteParams,
): Promise<BulkDeleteResult> {
    const { sellerProfileId, accessibleStoreIds, productIds } = params;

    if (productIds.length === 0) return { succeeded: [], failed: [] };

    // Categorize ownership and trashed-ness BEFORE the transaction
    const ownedRows = await db
        .select({
            id: product.id,
            status: product.status,
            storeId: storeProduct.storeId,
        })
        .from(product)
        .innerJoin(storeProduct, eq(storeProduct.productId, product.id))
        .where(
            and(
                inArray(product.id, productIds),
                eq(product.sellerProfileId, sellerProfileId),
            ),
        );

    const ownedIds = new Set<string>();
    const accessibleIds = new Set<string>();
    const trashedIds = new Set<string>();
    for (const r of ownedRows) {
        ownedIds.add(r.id);
        if (accessibleStoreIds.includes(r.storeId)) accessibleIds.add(r.id);
        if (r.status === "trashed") trashedIds.add(r.id);
    }

    const failed: BulkDeleteResult["failed"] = [];
    const toDelete: string[] = [];
    for (const id of productIds) {
        if (!ownedIds.has(id)) {
            failed.push({ productId: id, reason: "not_found" });
        } else if (!accessibleIds.has(id)) {
            failed.push({ productId: id, reason: "no_access" });
        } else if (!trashedIds.has(id)) {
            failed.push({ productId: id, reason: "not_in_trash" });
        } else {
            toDelete.push(id);
        }
    }

    if (toDelete.length === 0) return { succeeded: [], failed };

    // Fetch S3 keys before delete
    const images = await db
        .select({ key: productImage.key })
        .from(productImage)
        .where(inArray(productImage.productId, toDelete));

    await db.transaction(async (tx) => {
        await tx.delete(product).where(inArray(product.id, toDelete));
    });

    // Best-effort S3 cleanup outside transaction
    await Promise.allSettled(images.map((img) => s3.delete(img.key)));

    return { succeeded: toDelete, failed };
}
```

- [ ] **Step 9.4: Run test passing**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/api' test:integration -- seller-product-bulk
```
Expected: PASS, 4 test totali nel file.

- [ ] **Step 9.5: Aggiungi schemi TypeBox**

In `apps/api/src/lib/schemas/entities.ts`:

```ts
export const BulkDeleteBody = t.Object({
    productIds: t.Array(t.String(), { minItems: 1, maxItems: 100 }),
});

export const BulkDeleteResult = t.Object({
    succeeded: t.Array(t.String()),
    failed: t.Array(
        t.Object({
            productId: t.String(),
            reason: t.Union([
                t.Literal("not_found"),
                t.Literal("no_access"),
                t.Literal("not_in_trash"),
            ]),
        }),
    ),
});
```

- [ ] **Step 9.6: Wire endpoint POST /products/bulk/delete-permanent**

In `apps/api/src/modules/seller/routes/products.ts`, aggiungi prima del `.delete(...)`:

```ts
.post(
    "/products/bulk/delete-permanent",
    async (ctx) => {
        const sellerCtx = withSeller(ctx);
        const { sellerProfile: sp, body, user, store } = sellerCtx;
        const pino = getLogger(store);
        const accessibleStoreIds = await sellerCtx.getAccessibleStoreIds();

        const result = await bulkDeletePermanent({
            sellerProfileId: sp.id,
            accessibleStoreIds,
            productIds: body.productIds,
        });

        pino.warn(
            {
                userId: user.id,
                sellerProfileId: sp.id,
                requested: body.productIds.length,
                succeeded: result.succeeded.length,
                failed: result.failed.length,
                action: "products_bulk_deleted_permanently",
            },
            "Bulk delete fisico prodotti",
        );

        return ok(result);
    },
    {
        body: BulkDeleteBody,
        response: withErrors({ 200: okRes(BulkDeleteResult) }),
        detail: {
            summary: "Elimina definitivamente più prodotti",
            description:
                "Elimina fisicamente più prodotti dal cestino in un'unica chiamata. Solo i prodotti con status='trashed' vengono eliminati; gli altri finiscono in 'failed'. Limite: 100 ID per chiamata.",
            tags: ["Seller - Products"],
        },
    },
)
```

Aggiungi gli import necessari (`bulkDeletePermanent`, `BulkDeleteBody`, `BulkDeleteResult`).

- [ ] **Step 9.7: Run typecheck + test**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run typecheck && bun run --filter '@bibs/api' test:integration -- seller-product-bulk
```
Expected: PASS.

- [ ] **Step 9.8: Commit**

```bash
git add apps/api/src/modules/seller/services/products.ts \
        apps/api/src/modules/seller/routes/products.ts \
        apps/api/src/lib/schemas/entities.ts \
        apps/api/tests/integration/seller-product-bulk.test.ts
git commit -m "$(cat <<'EOF'
feat(api): POST /seller/products/bulk/delete-permanent

Elimina fisicamente più prodotti dal cestino in un'unica chiamata.
Best-effort: gli ID non in stato 'trashed' o inaccessibili finiscono
in failed[]. Cleanup S3 best-effort fuori transazione.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `listProducts` con `statusFilter`

**Files:**
- Modify: `apps/api/src/modules/seller/services/products.ts:49`
- Modify: `apps/api/src/modules/seller/routes/products.ts:29`
- Test: `apps/api/tests/integration/seller-product-status.test.ts` (estendi)

- [ ] **Step 10.1: Estendi test**

Aggiungi:

```ts
import { listProducts } from "@/modules/seller/services/products";

describe("listProducts statusFilter", () => {
    it("returns only active products by default", async () => {
        const db = getTestDb();
        const seller = await createTestSeller(db);
        const store = await createTestStore(db, seller.profile.id);
        const pa = await createTestProduct(db, seller.profile.id, { name: "A", status: "active" });
        const pd = await createTestProduct(db, seller.profile.id, { name: "D", status: "disabled" });
        const pt = await createTestProduct(db, seller.profile.id, { name: "T", status: "trashed" });
        for (const p of [pa, pd, pt]) {
            await createTestStoreProduct(db, store.id, p.id);
        }

        const result = await listProducts({
            sellerProfileId: seller.profile.id,
            storeId: store.id,
        });
        expect(result.data.map((p) => p.id)).toEqual([pa.id]);
    });

    it("filters by trashed when requested", async () => {
        // Stesso setup di sopra
        const db = getTestDb();
        const seller = await createTestSeller(db);
        const store = await createTestStore(db, seller.profile.id);
        const pa = await createTestProduct(db, seller.profile.id, { name: "A", status: "active" });
        const pt = await createTestProduct(db, seller.profile.id, { name: "T", status: "trashed" });
        await createTestStoreProduct(db, store.id, pa.id);
        await createTestStoreProduct(db, store.id, pt.id);

        const result = await listProducts({
            sellerProfileId: seller.profile.id,
            storeId: store.id,
            statusFilter: "trashed",
        });
        expect(result.data.map((p) => p.id)).toEqual([pt.id]);
    });
});
```

- [ ] **Step 10.2: Run failing**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/api' test:integration -- seller-product-status
```
Expected: FAIL — il default deve filtrare per active ma oggi non lo fa.

- [ ] **Step 10.3: Aggiorna `listProducts`**

In `apps/api/src/modules/seller/services/products.ts`, modifica `listProducts`:

```ts
interface ListProductsParams {
    sellerProfileId: string;
    storeId: string;
    page?: number;
    limit?: number;
    statusFilter?: ProductStatus;
}

export async function listProducts(params: ListProductsParams) {
    const { sellerProfileId, storeId, statusFilter = "active" } = params;
    const { page, limit, offset } = parsePagination(params);

    const storeCondition = and(
        eq(product.sellerProfileId, sellerProfileId),
        eq(storeProduct.storeId, storeId),
        eq(product.status, statusFilter),
    );

    // ... resto invariato
```

- [ ] **Step 10.4: Aggiorna route GET /products**

In `apps/api/src/modules/seller/routes/products.ts:29`, estendi la query schema e passa `statusFilter` al service:

```ts
.get(
    "/products",
    async (ctx) => {
        const { sellerProfile: sp, query, isOwner, user } = withSeller(ctx);
        await ensureStoreAccess(query.storeId, {
            userId: user.id,
            sellerProfileId: sp.id,
            isOwner,
        });
        const result = await listProducts({
            sellerProfileId: sp.id,
            storeId: query.storeId,
            page: query.page,
            limit: query.limit,
            statusFilter: query.statusFilter,
        });
        return okPage(result.data, result.pagination);
    },
    {
        query: t.Composite([
            PaginationQuery,
            t.Object({
                storeId: t.String({ description: "ID del negozio attivo" }),
                statusFilter: t.Optional(
                    t.Union(
                        PRODUCT_STATUS.map((s) => t.Literal(s)),
                        {
                            description:
                                "Filtra per stato. Default 'active'.",
                            default: "active",
                        },
                    ),
                ),
            }),
        ]),
        response: withErrors({ 200: okPageRes(ProductWithRelationsSchema) }),
        detail: {
            summary: "Lista prodotti del negozio",
            description:
                "Restituisce i prodotti del negozio filtrati per stato. Senza statusFilter, ritorna solo i prodotti attivi.",
            tags: ["Seller - Products"],
        },
    },
)
```

Aggiungi import `PRODUCT_STATUS` (e `ProductStatus` se serve in funzione) dal modulo schemas in cima al file.

- [ ] **Step 10.5: Run typecheck + test**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run typecheck && bun run --filter '@bibs/api' test:integration -- seller-product-status
```
Expected: PASS.

- [ ] **Step 10.6: Commit**

```bash
git add apps/api/src/modules/seller/services/products.ts \
        apps/api/src/modules/seller/routes/products.ts \
        apps/api/tests/integration/seller-product-status.test.ts
git commit -m "$(cat <<'EOF'
feat(api): GET /seller/products supporta statusFilter

Aggiunge il query param statusFilter ('active' | 'disabled' | 'trashed')
con default 'active'. La lista non include più i prodotti disabilitati
e in cestino salvo richiesta esplicita.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Endpoint `GET /products/status-counts`

**Files:**
- Modify: `apps/api/src/modules/seller/services/products.ts`
- Modify: `apps/api/src/modules/seller/routes/products.ts`
- Modify: `apps/api/src/lib/schemas/entities.ts`
- Test: `apps/api/tests/integration/seller-product-status.test.ts` (estendi)

- [ ] **Step 11.1: Estendi test**

```ts
import { getProductStatusCounts } from "@/modules/seller/services/products";

describe("getProductStatusCounts", () => {
    it("returns counts grouped by status for the given store", async () => {
        const db = getTestDb();
        const seller = await createTestSeller(db);
        const store = await createTestStore(db, seller.profile.id);
        for (const status of ["active", "active", "disabled", "trashed", "trashed", "trashed"] as const) {
            const p = await createTestProduct(db, seller.profile.id, { status });
            await createTestStoreProduct(db, store.id, p.id);
        }

        const counts = await getProductStatusCounts({
            sellerProfileId: seller.profile.id,
            storeId: store.id,
        });
        expect(counts).toEqual({ active: 2, disabled: 1, trashed: 3 });
    });

    it("returns zeros when store is empty", async () => {
        const db = getTestDb();
        const seller = await createTestSeller(db);
        const store = await createTestStore(db, seller.profile.id);

        const counts = await getProductStatusCounts({
            sellerProfileId: seller.profile.id,
            storeId: store.id,
        });
        expect(counts).toEqual({ active: 0, disabled: 0, trashed: 0 });
    });
});
```

- [ ] **Step 11.2: Run failing**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/api' test:integration -- seller-product-status
```
Expected: FAIL.

- [ ] **Step 11.3: Implementa `getProductStatusCounts`**

```ts
interface GetCountsParams {
    sellerProfileId: string;
    storeId: string;
}

export async function getProductStatusCounts(
    params: GetCountsParams,
): Promise<Record<ProductStatus, number>> {
    const { sellerProfileId, storeId } = params;

    const rows = await db
        .select({
            status: product.status,
            count: count(),
        })
        .from(product)
        .innerJoin(storeProduct, eq(storeProduct.productId, product.id))
        .where(
            and(
                eq(product.sellerProfileId, sellerProfileId),
                eq(storeProduct.storeId, storeId),
            ),
        )
        .groupBy(product.status);

    const result: Record<ProductStatus, number> = {
        active: 0,
        disabled: 0,
        trashed: 0,
    };
    for (const r of rows) {
        result[r.status as ProductStatus] = Number(r.count);
    }
    return result;
}
```

- [ ] **Step 11.4: Aggiungi schema TypeBox**

In `apps/api/src/lib/schemas/entities.ts`:

```ts
export const ProductStatusCounts = t.Object({
    active: t.Integer({ minimum: 0 }),
    disabled: t.Integer({ minimum: 0 }),
    trashed: t.Integer({ minimum: 0 }),
});
```

- [ ] **Step 11.5: Wire endpoint**

In `apps/api/src/modules/seller/routes/products.ts`, prima del PATCH status:

```ts
.get(
    "/products/status-counts",
    async (ctx) => {
        const { sellerProfile: sp, query, isOwner, user } = withSeller(ctx);
        await ensureStoreAccess(query.storeId, {
            userId: user.id,
            sellerProfileId: sp.id,
            isOwner,
        });

        const counts = await getProductStatusCounts({
            sellerProfileId: sp.id,
            storeId: query.storeId,
        });
        return ok(counts);
    },
    {
        query: t.Object({
            storeId: t.String({ description: "ID del negozio attivo" }),
        }),
        response: withErrors({ 200: okRes(ProductStatusCounts) }),
        detail: {
            summary: "Conta prodotti per stato",
            description:
                "Ritorna il numero di prodotti per ciascun stato (active/disabled/trashed) nel negozio specificato.",
            tags: ["Seller - Products"],
        },
    },
)
```

Aggiungi import `getProductStatusCounts`, `ProductStatusCounts`.

- [ ] **Step 11.6: Run typecheck + test**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run typecheck && bun run --filter '@bibs/api' test:integration -- seller-product-status
```
Expected: PASS.

- [ ] **Step 11.7: Commit**

```bash
git add apps/api/src/modules/seller/services/products.ts \
        apps/api/src/modules/seller/routes/products.ts \
        apps/api/src/lib/schemas/entities.ts \
        apps/api/tests/integration/seller-product-status.test.ts
git commit -m "$(cat <<'EOF'
feat(api): GET /seller/products/status-counts

Endpoint leggero per i count dei prodotti per ciascun stato nel negozio
attivo. Usato dai tab Attivi/Disabilitati/Cestino del frontend seller.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Snapshot di prodotto sugli `order_items` al checkout

**Files:**
- Modify: `apps/api/src/modules/customer/services/orders.ts:119-150,194-201`
- Test: `apps/api/tests/integration/customer-orders.test.ts` (regression)

- [ ] **Step 12.1: Estendi resolvedItems con snapshot**

Apri `apps/api/src/modules/customer/services/orders.ts`. La query attuale (riga ~126) carica `storeProduct` con `with: { product: true }`. Per ottenere il `brand` e l'immagine prima, estendi:

```ts
const sp = await tx.query.storeProduct.findFirst({
    where: and(
        eq(storeProduct.id, item.storeProductId),
        eq(storeProduct.storeId, storeId),
    ),
    with: {
        product: {
            with: {
                brand: true,
                images: {
                    orderBy: (img, { asc }) => [asc(img.position)],
                    limit: 1,
                },
            },
        },
    },
});
```

Aggiorna `resolvedItems` (typed):

```ts
const resolvedItems: {
    storeProductId: string;
    productId: string;
    productName: string;
    productEan: string | null;
    brandName: string | null;
    productImageUrl: string | null;
    quantity: number;
    unitPrice: string;
}[] = [];

// Dentro il loop (dopo il check stock):
totalCents += toCents(sp.product.price) * item.quantity;
resolvedItems.push({
    storeProductId: sp.id,
    productId: sp.product.id,
    productName: sp.product.name,
    productEan: sp.product.ean ?? null,
    brandName: sp.product.brand?.name ?? null,
    productImageUrl: sp.product.images[0]?.url ?? null,
    quantity: item.quantity,
    unitPrice: sp.product.price,
});
```

- [ ] **Step 12.2: Aggiorna l'INSERT su orderItem**

Sempre in `orders.ts`, riga ~194:

```ts
await tx.insert(orderItem).values(
    resolvedItems.map((item) => ({
        orderId: newOrder.id,
        storeProductId: item.storeProductId,
        productId: item.productId,
        productName: item.productName,
        productEan: item.productEan,
        brandName: item.brandName,
        productImageUrl: item.productImageUrl,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
    })),
);
```

- [ ] **Step 12.3: Aggiungi test di regressione**

In `apps/api/tests/integration/customer-orders.test.ts`, aggiungi:

```ts
it("populates snapshot fields on order_items at checkout", async () => {
    const db = getTestDb();
    // Setup minimal seller, store, brand, product, image, customer
    const seller = await createTestSeller(db, { email: "snap@test.com" });
    const store = await createTestStore(db, seller.profile.id);
    const brand = await createTestBrand(db, seller.profile.id, "Acme");
    const product = await createTestProduct(db, seller.profile.id, {
        name: "Pizza Margherita",
    });
    // Imposta brand_id e ean direttamente per evitare di toccare l'interfaccia di createTestProduct
    await db
        .update(productTable)
        .set({ brandId: brand.id, ean: "12345678" })
        .where(eq(productTable.id, product.id));
    await db.insert(productImage).values({
        productId: product.id,
        url: "https://example.com/img.png",
        key: "img-key",
        position: 0,
    });
    const sp = await createTestStoreProduct(db, store.id, product.id, { stock: 5 });
    const customer = await createTestCustomer(db, { email: "c@test.com" });

    const order = await createOrder({
        customerProfileId: customer.profile.id,
        customerPoints: 0,
        type: "direct",
        storeId: store.id,
        items: [{ storeProductId: sp.id, quantity: 1 }],
    });

    const items = await db.query.orderItem.findMany({
        where: eq(orderItemTable.orderId, order.id),
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
        productName: "Pizza Margherita",
        productEan: "12345678",
        brandName: "Acme",
        productImageUrl: "https://example.com/img.png",
        productId: product.id,
        storeProductId: sp.id,
    });
});
```

Aggiungi import necessari (`productImage`, `orderItem as orderItemTable`, `createTestBrand`, `productTable`, `eq`).

- [ ] **Step 12.4: Run test**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/api' test:integration -- customer-orders
```
Expected: PASS — i test esistenti continuano a passare (gli order_items oggi avevano già il populate al netto degli snapshot, che ora vanno popolati).

Se i test esistenti falliscono perché si aspettano un certo schema di `orderItem`, aggiornali per riflettere i nuovi campi.

- [ ] **Step 12.5: Commit**

```bash
git add apps/api/src/modules/customer/services/orders.ts \
        apps/api/tests/integration/customer-orders.test.ts
git commit -m "$(cat <<'EOF'
feat(api): popola snapshot prodotto su order_items al checkout

Al checkout, ogni order_item viene creato con name/ean/brandName/
productImageUrl denormalizzati dal prodotto al momento dell'acquisto.
Lo storico ordini resta integro anche se il prodotto viene
successivamente modificato o eliminato.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Frontend i18n + verifica componenti shadcn

**Files:**
- Modify: `apps/seller/messages/it.json`
- Modify: `apps/seller/messages/en.json`
- (verifica: `packages/ui/src/components/{dropdown-menu,alert-dialog,tabs,checkbox,table}.tsx` esistono già)

- [ ] **Step 13.1: Verifica componenti shadcn**

```bash
ls /Users/marcogelli/repos/jelaz/bibs/packages/ui/src/components/{dropdown-menu,alert-dialog,tabs,checkbox,table,sonner}.tsx
```
Expected: tutti presenti. Se manca qualcosa, installalo via il MCP shadcn (`mcp__shadcn__get_add_command_for_items`).

- [ ] **Step 13.2: Aggiungi messaggi italiani**

In `apps/seller/messages/it.json`, aggiungi le chiavi (mantieni l'oggetto piatto come previsto da inlang):

```json
{
    "$schema": "https://inlang.com/schema/inlang-message-format",
    "welcome_message": "Benvenuto su BIBS Seller",
    "language_label": "Lingua",
    "current_locale": "Lingua corrente: {locale}",
    "products_tab_active": "Attivi",
    "products_tab_disabled": "Disabilitati",
    "products_tab_trashed": "Cestino",
    "products_tab_count": "({count})",
    "products_action_edit": "Modifica",
    "products_action_disable": "Disabilita",
    "products_action_enable": "Riattiva",
    "products_action_trash": "Sposta nel cestino",
    "products_action_restore": "Ripristina",
    "products_action_delete_permanent": "Elimina definitivamente",
    "products_bulk_selected": "{count} selezionati",
    "products_bulk_clear_selection": "Annulla selezione",
    "products_confirm_delete_title": "Eliminare definitivamente {count} prodotti?",
    "products_confirm_delete_description": "Questa azione è irreversibile. Le immagini associate verranno cancellate. I tuoi ordini storici sono protetti e continueranno a mostrare il nome e i dettagli al momento dell'acquisto.",
    "products_confirm_delete_action": "Elimina definitivamente",
    "products_confirm_delete_cancel": "Annulla",
    "products_toast_status_changed": "Stato aggiornato",
    "products_toast_undo": "Annulla",
    "products_toast_bulk_summary": "{succeeded} aggiornati, {failed} saltati",
    "products_toast_bulk_delete_summary": "{succeeded} eliminati, {failed} saltati",
    "products_empty_active": "Nessun prodotto attivo in questo negozio.",
    "products_empty_disabled": "Nessun prodotto disabilitato.",
    "products_empty_trashed": "Il cestino è vuoto."
}
```

- [ ] **Step 13.3: Aggiungi messaggi inglesi**

In `apps/seller/messages/en.json` (potrebbe non esistere — se così, crealo come copia di it.json con traduzioni). Per ogni chiave sopra, scrivi la versione in inglese.

- [ ] **Step 13.4: Verifica build i18n**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/seller' typecheck
```
Expected: PASS — Paraglide rigenera i messaggi via plugin Vite, le chiavi sono disponibili come funzioni in `~/paraglide/messages`.

- [ ] **Step 13.5: Commit**

```bash
git add apps/seller/messages/
git commit -m "$(cat <<'EOF'
feat(seller): chiavi i18n per tabs, azioni e bulk dei prodotti

Aggiunge le stringhe Paraglide italiane e inglesi per la nuova UX
della tabella prodotti (azioni rapide, bulk toolbar, conferme,
empty states, toast).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Frontend hook `useProductSelection`

**Files:**
- Create: `apps/seller/src/features/products/hooks/use-product-selection.ts`

- [ ] **Step 14.1: Implementa l'hook**

Crea il file:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";

export type CheckboxState = "checked" | "indeterminate" | "unchecked";

export interface UseProductSelectionResult {
    selected: Set<string>;
    isSelected: (id: string) => boolean;
    toggleOne: (id: string) => void;
    toggleAllOnPage: () => void;
    clear: () => void;
    headerCheckboxState: CheckboxState;
}

interface UseProductSelectionParams {
    currentPageIds: string[];
    /** Reset selection when this value changes (e.g. statusFilter). */
    resetKey: string;
}

export function useProductSelection({
    currentPageIds,
    resetKey,
}: UseProductSelectionParams): UseProductSelectionResult {
    const [selected, setSelected] = useState<Set<string>>(new Set());

    useEffect(() => {
        setSelected(new Set());
    }, [resetKey]);

    const isSelected = useCallback(
        (id: string) => selected.has(id),
        [selected],
    );

    const toggleOne = useCallback((id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const toggleAllOnPage = useCallback(() => {
        setSelected((prev) => {
            const allSelected =
                currentPageIds.length > 0 &&
                currentPageIds.every((id) => prev.has(id));
            if (allSelected) {
                const next = new Set(prev);
                for (const id of currentPageIds) next.delete(id);
                return next;
            }
            const next = new Set(prev);
            for (const id of currentPageIds) next.add(id);
            return next;
        });
    }, [currentPageIds]);

    const clear = useCallback(() => setSelected(new Set()), []);

    const headerCheckboxState = useMemo<CheckboxState>(() => {
        if (currentPageIds.length === 0) return "unchecked";
        const selectedOnPage = currentPageIds.filter((id) =>
            selected.has(id),
        ).length;
        if (selectedOnPage === 0) return "unchecked";
        if (selectedOnPage === currentPageIds.length) return "checked";
        return "indeterminate";
    }, [currentPageIds, selected]);

    return {
        selected,
        isSelected,
        toggleOne,
        toggleAllOnPage,
        clear,
        headerCheckboxState,
    };
}
```

- [ ] **Step 14.2: Typecheck**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/seller' typecheck
```
Expected: PASS.

- [ ] **Step 14.3: Commit**

```bash
git add apps/seller/src/features/products/hooks/use-product-selection.ts
git commit -m "$(cat <<'EOF'
feat(seller): hook useProductSelection per la selezione multipla

Gestisce stato di selezione tristate (unchecked/indeterminate/checked)
con select-all-on-page e reset automatico al cambio di filtro.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Frontend hook `useProductMutations`

**Files:**
- Create: `apps/seller/src/features/products/hooks/use-product-mutations.ts`

- [ ] **Step 15.1: Implementa l'hook**

Crea il file:

```tsx
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { m } from "~/paraglide/messages";
import { api } from "~/lib/api";

type ProductStatus = "active" | "disabled" | "trashed";

interface SetStatusVars {
    productId: string;
    status: ProductStatus;
    /** Status before the mutation, for the Undo toast action. */
    previousStatus: ProductStatus;
}

interface BulkSetStatusVars {
    productIds: string[];
    status: ProductStatus;
}

interface BulkDeletePermanentVars {
    productIds: string[];
}

export function useProductMutations(activeStoreId: string | undefined) {
    const queryClient = useQueryClient();

    function invalidateAll() {
        void queryClient.invalidateQueries({ queryKey: ["products"] });
        void queryClient.invalidateQueries({ queryKey: ["product-status-counts"] });
    }

    const setStatus = useMutation({
        mutationFn: async (vars: SetStatusVars) => {
            const res = await api()
                .seller.products({ productId: vars.productId })
                .status.patch({ status: vars.status });
            if (res.error) {
                throw new Error(
                    res.error.value?.message ?? "Errore aggiornamento stato",
                );
            }
            return res.data;
        },
        onSuccess: (_data, vars) => {
            invalidateAll();
            toast.success(m.products_toast_status_changed(), {
                action: {
                    label: m.products_toast_undo(),
                    onClick: () => {
                        setStatus.mutate({
                            productId: vars.productId,
                            status: vars.previousStatus,
                            previousStatus: vars.status,
                        });
                    },
                },
            });
        },
        onError: (err: Error) => {
            toast.error(err.message);
        },
    });

    const bulkSetStatus = useMutation({
        mutationFn: async (vars: BulkSetStatusVars) => {
            const res = await api().seller.products.bulk.status.post({
                productIds: vars.productIds,
                status: vars.status,
            });
            if (res.error) {
                throw new Error(
                    res.error.value?.message ?? "Errore bulk update",
                );
            }
            return res.data.data;
        },
        onSuccess: (data) => {
            invalidateAll();
            toast.success(
                m.products_toast_bulk_summary({
                    succeeded: data.succeeded.length,
                    failed: data.failed.length,
                }),
            );
        },
        onError: (err: Error) => {
            toast.error(err.message);
        },
    });

    const bulkDeletePermanent = useMutation({
        mutationFn: async (vars: BulkDeletePermanentVars) => {
            const res = await api()
                .seller.products.bulk["delete-permanent"]
                .post({ productIds: vars.productIds });
            if (res.error) {
                throw new Error(
                    res.error.value?.message ?? "Errore eliminazione",
                );
            }
            return res.data.data;
        },
        onSuccess: (data) => {
            invalidateAll();
            toast.success(
                m.products_toast_bulk_delete_summary({
                    succeeded: data.succeeded.length,
                    failed: data.failed.length,
                }),
            );
        },
        onError: (err: Error) => {
            toast.error(err.message);
        },
    });

    // activeStoreId è usato dal chiamante per le chiavi query, non qui.
    void activeStoreId;

    return { setStatus, bulkSetStatus, bulkDeletePermanent };
}
```

Nota: la sintassi `api().seller.products.bulk["delete-permanent"]` accede al path con il bracket perché contiene un trattino. Eden Treaty supporta entrambe le notazioni.

- [ ] **Step 15.2: Typecheck**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/seller' typecheck
```
Expected: PASS. Se Eden Treaty non risolve il path bulk, verifica che gli endpoint siano esposti correttamente in `apps/api/src/modules/seller/routes/products.ts` (e che i types siano stati ri-generati: in dev è automatico).

- [ ] **Step 15.3: Commit**

```bash
git add apps/seller/src/features/products/hooks/use-product-mutations.ts
git commit -m "$(cat <<'EOF'
feat(seller): hook useProductMutations per single e bulk

Wrappers TanStack Query: setStatus (con toast Annulla),
bulkSetStatus, bulkDeletePermanent. Invalida products e
product-status-counts su success.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Frontend `ProductStatusTabs`

**Files:**
- Create: `apps/seller/src/features/products/components/product-status-tabs.tsx`

- [ ] **Step 16.1: Implementa il componente**

```tsx
import {
    Tabs,
    TabsList,
    TabsTrigger,
} from "@bibs/ui/components/tabs";
import { useQuery } from "@tanstack/react-query";
import { m } from "~/paraglide/messages";
import { api } from "~/lib/api";

export type ProductStatusFilter = "active" | "disabled" | "trashed";

interface Props {
    storeId: string;
    value: ProductStatusFilter;
    onChange: (value: ProductStatusFilter) => void;
}

export function ProductStatusTabs({ storeId, value, onChange }: Props) {
    const { data } = useQuery({
        queryKey: ["product-status-counts", storeId],
        queryFn: async () => {
            const res = await api().seller.products["status-counts"].get({
                query: { storeId },
            });
            if (res.error) throw new Error("Errore caricamento conteggi");
            return res.data.data;
        },
        enabled: !!storeId,
    });

    const counts = data ?? { active: 0, disabled: 0, trashed: 0 };

    return (
        <Tabs
            value={value}
            onValueChange={(v) => onChange(v as ProductStatusFilter)}
        >
            <TabsList>
                <TabsTrigger value="active">
                    {m.products_tab_active()}{" "}
                    <span className="ml-1 text-muted-foreground">
                        {m.products_tab_count({ count: counts.active })}
                    </span>
                </TabsTrigger>
                <TabsTrigger value="disabled">
                    {m.products_tab_disabled()}{" "}
                    <span className="ml-1 text-muted-foreground">
                        {m.products_tab_count({ count: counts.disabled })}
                    </span>
                </TabsTrigger>
                <TabsTrigger value="trashed">
                    {m.products_tab_trashed()}{" "}
                    <span className="ml-1 text-muted-foreground">
                        {m.products_tab_count({ count: counts.trashed })}
                    </span>
                </TabsTrigger>
            </TabsList>
        </Tabs>
    );
}
```

- [ ] **Step 16.2: Typecheck**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/seller' typecheck
```
Expected: PASS.

- [ ] **Step 16.3: Commit**

```bash
git add apps/seller/src/features/products/components/product-status-tabs.tsx
git commit -m "$(cat <<'EOF'
feat(seller): tab Attivi/Disabilitati/Cestino con count live

Componente ProductStatusTabs che fa fetch dei count per stato
e li mostra accanto al label di ogni tab.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Frontend `ProductRowActions`

**Files:**
- Create: `apps/seller/src/features/products/components/product-row-actions.tsx`

- [ ] **Step 17.1: Implementa il componente**

```tsx
import { Button } from "@bibs/ui/components/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@bibs/ui/components/dropdown-menu";
import { Link } from "@tanstack/react-router";
import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { m } from "~/paraglide/messages";
import { useProductMutations } from "~/features/products/hooks/use-product-mutations";
import { ConfirmPermanentDeleteDialog } from "./confirm-permanent-delete-dialog";

type ProductStatus = "active" | "disabled" | "trashed";

interface Props {
    productId: string;
    status: ProductStatus;
    activeStoreId: string;
}

export function ProductRowActions({ productId, status, activeStoreId }: Props) {
    const { setStatus } = useProductMutations(activeStoreId);
    const [confirmOpen, setConfirmOpen] = useState(false);

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                        <MoreHorizontalIcon className="size-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    {status !== "trashed" && (
                        <DropdownMenuItem asChild>
                            <Link
                                to="/products/$productId"
                                params={{ productId }}
                            >
                                {m.products_action_edit()}
                            </Link>
                        </DropdownMenuItem>
                    )}

                    {status === "active" && (
                        <DropdownMenuItem
                            onSelect={() =>
                                setStatus.mutate({
                                    productId,
                                    status: "disabled",
                                    previousStatus: "active",
                                })
                            }
                        >
                            {m.products_action_disable()}
                        </DropdownMenuItem>
                    )}

                    {status === "disabled" && (
                        <DropdownMenuItem
                            onSelect={() =>
                                setStatus.mutate({
                                    productId,
                                    status: "active",
                                    previousStatus: "disabled",
                                })
                            }
                        >
                            {m.products_action_enable()}
                        </DropdownMenuItem>
                    )}

                    {status === "trashed" && (
                        <DropdownMenuItem
                            onSelect={() =>
                                setStatus.mutate({
                                    productId,
                                    status: "active",
                                    previousStatus: "trashed",
                                })
                            }
                        >
                            {m.products_action_restore()}
                        </DropdownMenuItem>
                    )}

                    <DropdownMenuSeparator />

                    {status !== "trashed" ? (
                        <DropdownMenuItem
                            variant="destructive"
                            onSelect={() =>
                                setStatus.mutate({
                                    productId,
                                    status: "trashed",
                                    previousStatus: status,
                                })
                            }
                        >
                            {m.products_action_trash()}
                        </DropdownMenuItem>
                    ) : (
                        <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setConfirmOpen(true)}
                        >
                            {m.products_action_delete_permanent()}
                        </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>

            <ConfirmPermanentDeleteDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                productIds={[productId]}
                activeStoreId={activeStoreId}
            />
        </>
    );
}
```

Nota: `DropdownMenuItem variant="destructive"` potrebbe non essere supportato — controlla in `packages/ui/src/components/dropdown-menu.tsx`. Se non c'è, sostituisci con `className="text-destructive focus:text-destructive"`.

- [ ] **Step 17.2: Commit (deferred — typecheck dopo Task 18 perché manca ConfirmPermanentDeleteDialog)**

Skip commit per ora — dopo Task 18 facciamo typecheck e commit insieme di Task 17 e 18 in due commit separati.

---

## Task 18: Frontend `ConfirmPermanentDeleteDialog`

**Files:**
- Create: `apps/seller/src/features/products/components/confirm-permanent-delete-dialog.tsx`

- [ ] **Step 18.1: Implementa il dialog**

```tsx
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@bibs/ui/components/alert-dialog";
import { m } from "~/paraglide/messages";
import { useProductMutations } from "~/features/products/hooks/use-product-mutations";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    productIds: string[];
    activeStoreId: string;
    onSuccess?: () => void;
}

export function ConfirmPermanentDeleteDialog({
    open,
    onOpenChange,
    productIds,
    activeStoreId,
    onSuccess,
}: Props) {
    const { bulkDeletePermanent } = useProductMutations(activeStoreId);

    const handleConfirm = () => {
        bulkDeletePermanent.mutate(
            { productIds },
            {
                onSuccess: () => {
                    onOpenChange(false);
                    onSuccess?.();
                },
            },
        );
    };

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {m.products_confirm_delete_title({
                            count: productIds.length,
                        })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        {m.products_confirm_delete_description()}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>
                        {m.products_confirm_delete_cancel()}
                    </AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleConfirm}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                        {m.products_confirm_delete_action()}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
```

- [ ] **Step 18.2: Typecheck dopo Task 17 + 18**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/seller' typecheck
```
Expected: PASS.

- [ ] **Step 18.3: Commit Task 17 e 18 insieme**

```bash
git add apps/seller/src/features/products/components/product-row-actions.tsx \
        apps/seller/src/features/products/components/confirm-permanent-delete-dialog.tsx
git commit -m "$(cat <<'EOF'
feat(seller): dropdown azioni per riga e dialog di conferma

ProductRowActions context-aware sul tab corrente con voci modifica/
disabilita/riattiva/cestino/ripristina/elimina.
ConfirmPermanentDeleteDialog conferma il delete fisico
(unico flusso con AlertDialog; le altre azioni usano toast Undo).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Frontend `ProductBulkToolbar`

**Files:**
- Create: `apps/seller/src/features/products/components/product-bulk-toolbar.tsx`

- [ ] **Step 19.1: Implementa il componente**

```tsx
import { Button } from "@bibs/ui/components/button";
import { XIcon } from "lucide-react";
import { useState } from "react";
import { m } from "~/paraglide/messages";
import type { ProductStatusFilter } from "./product-status-tabs";
import { ConfirmPermanentDeleteDialog } from "./confirm-permanent-delete-dialog";
import { useProductMutations } from "~/features/products/hooks/use-product-mutations";

interface Props {
    selectedIds: string[];
    activeStoreId: string;
    statusFilter: ProductStatusFilter;
    onClear: () => void;
}

export function ProductBulkToolbar({
    selectedIds,
    activeStoreId,
    statusFilter,
    onClear,
}: Props) {
    const { bulkSetStatus } = useProductMutations(activeStoreId);
    const [confirmOpen, setConfirmOpen] = useState(false);

    if (selectedIds.length === 0) return null;

    const apply = (status: "active" | "disabled" | "trashed") => () => {
        bulkSetStatus.mutate(
            { productIds: selectedIds, status },
            { onSuccess: () => onClear() },
        );
    };

    return (
        <>
            <div className="bg-card sticky top-0 z-10 flex items-center gap-3 border-b px-4 py-2">
                <span className="text-sm font-medium">
                    {m.products_bulk_selected({ count: selectedIds.length })}
                </span>
                <Button variant="ghost" size="sm" onClick={onClear}>
                    <XIcon className="size-4" />
                    {m.products_bulk_clear_selection()}
                </Button>
                <div className="ml-auto flex gap-2">
                    {statusFilter === "active" && (
                        <>
                            <Button size="sm" onClick={apply("disabled")}>
                                {m.products_action_disable()}
                            </Button>
                            <Button
                                size="sm"
                                variant="destructive"
                                onClick={apply("trashed")}
                            >
                                {m.products_action_trash()}
                            </Button>
                        </>
                    )}
                    {statusFilter === "disabled" && (
                        <>
                            <Button size="sm" onClick={apply("active")}>
                                {m.products_action_enable()}
                            </Button>
                            <Button
                                size="sm"
                                variant="destructive"
                                onClick={apply("trashed")}
                            >
                                {m.products_action_trash()}
                            </Button>
                        </>
                    )}
                    {statusFilter === "trashed" && (
                        <>
                            <Button size="sm" onClick={apply("active")}>
                                {m.products_action_restore()}
                            </Button>
                            <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => setConfirmOpen(true)}
                            >
                                {m.products_action_delete_permanent()}
                            </Button>
                        </>
                    )}
                </div>
            </div>

            <ConfirmPermanentDeleteDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                productIds={selectedIds}
                activeStoreId={activeStoreId}
                onSuccess={onClear}
            />
        </>
    );
}
```

- [ ] **Step 19.2: Typecheck**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run --filter '@bibs/seller' typecheck
```
Expected: PASS.

- [ ] **Step 19.3: Commit**

```bash
git add apps/seller/src/features/products/components/product-bulk-toolbar.tsx
git commit -m "$(cat <<'EOF'
feat(seller): bulk toolbar context-aware per i prodotti

ProductBulkToolbar appare quando ci sono prodotti selezionati e
mostra azioni adatte al tab corrente: disabilita/cestino su Attivi,
riattiva/cestino su Disabilitati, ripristina/elimina su Cestino.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: Integra il tutto nella route `/products`

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/products/index.tsx`

- [ ] **Step 20.1: Riscrivi la route**

Sostituisci interamente il contenuto di `apps/seller/src/routes/_authenticated/products/index.tsx`:

```tsx
import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import { Checkbox } from "@bibs/ui/components/checkbox";
import { Spinner } from "@bibs/ui/components/spinner";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@bibs/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PackageIcon, PlusIcon } from "lucide-react";
import { useMemo } from "react";
import { ProductBulkToolbar } from "~/features/products/components/product-bulk-toolbar";
import { ProductRowActions } from "~/features/products/components/product-row-actions";
import {
    ProductStatusTabs,
    type ProductStatusFilter,
} from "~/features/products/components/product-status-tabs";
import { useProductSelection } from "~/features/products/hooks/use-product-selection";
import { useActiveStore } from "~/hooks/use-active-store";
import { api } from "~/lib/api";
import { m } from "~/paraglide/messages";

export const Route = createFileRoute("/_authenticated/products/")({
    component: ProductsListPage,
    validateSearch: (search: Record<string, unknown>) => {
        const sf = search.statusFilter;
        const statusFilter: ProductStatusFilter =
            sf === "disabled" || sf === "trashed" ? sf : "active";
        return {
            page: Number(search.page ?? 1),
            limit: Number(search.limit ?? 20),
            statusFilter,
        };
    },
});

function ProductsListPage() {
    const { page, limit, statusFilter } = Route.useSearch();
    const navigate = useNavigate({ from: "/products/" });
    const { activeStore } = useActiveStore();

    const { data, isLoading, error } = useQuery({
        queryKey: ["products", activeStore?.id, page, limit, statusFilter],
        queryFn: async () => {
            const storeId = activeStore?.id;
            if (!storeId) throw new Error("No active store");
            const response = await api().seller.products.get({
                query: { storeId, page, limit, statusFilter },
            });
            if (response.error) {
                throw new Error(
                    response.error.value?.message || "Errore caricamento",
                );
            }
            return response.data;
        },
        enabled: !!activeStore?.id,
    });

    const currentPageIds = useMemo(
        () => data?.data?.map((p) => p.id) ?? [],
        [data],
    );
    const selection = useProductSelection({
        currentPageIds,
        resetKey: `${activeStore?.id ?? ""}|${statusFilter}`,
    });

    const goToTab = (next: ProductStatusFilter) =>
        void navigate({
            search: (prev) => ({ ...prev, statusFilter: next, page: 1 }),
        });

    const emptyMessage =
        statusFilter === "active"
            ? m.products_empty_active()
            : statusFilter === "disabled"
                ? m.products_empty_disabled()
                : m.products_empty_trashed();

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">
                        Prodotti{activeStore ? ` — ${activeStore.name}` : ""}
                    </h1>
                    <p className="text-muted-foreground text-sm">
                        {activeStore
                            ? `Catalogo del negozio ${activeStore.name}`
                            : "Seleziona un negozio per visualizzare il catalogo"}
                    </p>
                </div>
                <Button asChild>
                    <Link to="/products/new">
                        <PlusIcon />
                        <span>Nuovo Prodotto</span>
                    </Link>
                </Button>
            </div>

            {activeStore && (
                <ProductStatusTabs
                    storeId={activeStore.id}
                    value={statusFilter}
                    onChange={goToTab}
                />
            )}

            <ProductBulkToolbar
                selectedIds={Array.from(selection.selected)}
                activeStoreId={activeStore?.id ?? ""}
                statusFilter={statusFilter}
                onClear={selection.clear}
            />

            {error && (
                <div className="bg-destructive/10 text-destructive rounded-lg border border-destructive/20 p-4">
                    <p className="text-sm">
                        Errore nel caricamento: {(error as Error).message}
                    </p>
                </div>
            )}

            {isLoading ? (
                <div className="bg-card flex h-64 items-center justify-center rounded-lg border">
                    <Spinner className="size-8" />
                </div>
            ) : (
                <div className="bg-card overflow-hidden rounded-lg border shadow-sm">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/50 hover:bg-muted/50">
                                <TableHead className="w-10 pl-4">
                                    <Checkbox
                                        checked={
                                            selection.headerCheckboxState === "checked"
                                                ? true
                                                : selection.headerCheckboxState === "indeterminate"
                                                    ? "indeterminate"
                                                    : false
                                        }
                                        onCheckedChange={() => selection.toggleAllOnPage()}
                                        aria-label="Seleziona tutti"
                                    />
                                </TableHead>
                                <TableHead className="w-[35%]">Nome</TableHead>
                                <TableHead className="w-[20%]">Prezzo</TableHead>
                                <TableHead className="w-[20%]">Categoria</TableHead>
                                <TableHead className="w-[15%]">Data</TableHead>
                                <TableHead className="w-12 pr-4" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {data?.data && data.data.length > 0 ? (
                                data.data.map((product) => (
                                    <TableRow key={product.id} className="group">
                                        <TableCell className="pl-4">
                                            <Checkbox
                                                checked={selection.isSelected(product.id)}
                                                onCheckedChange={() => selection.toggleOne(product.id)}
                                                aria-label={`Seleziona ${product.name}`}
                                            />
                                        </TableCell>
                                        <TableCell className="font-semibold">
                                            {statusFilter === "trashed" ? (
                                                <span className="text-muted-foreground">
                                                    {product.name}
                                                </span>
                                            ) : (
                                                <Link
                                                    to="/products/$productId"
                                                    params={{ productId: product.id }}
                                                    className="hover:underline"
                                                >
                                                    {product.name}
                                                </Link>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            €{product.price}
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            <div className="flex flex-wrap gap-1">
                                                {product.productCategoryAssignments.length > 0 ? (
                                                    product.productCategoryAssignments.map((pc) => (
                                                        <Badge
                                                            key={pc.productCategoryId}
                                                            variant="secondary"
                                                        >
                                                            {pc.category.name}
                                                        </Badge>
                                                    ))
                                                ) : (
                                                    <span className="text-muted-foreground">—</span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-muted-foreground text-sm">
                                            {new Date(product.createdAt).toLocaleDateString(
                                                "it-IT",
                                                { year: "numeric", month: "short", day: "numeric" },
                                            )}
                                        </TableCell>
                                        <TableCell className="pr-4">
                                            <ProductRowActions
                                                productId={product.id}
                                                status={product.status}
                                                activeStoreId={activeStore?.id ?? ""}
                                            />
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow className="hover:bg-transparent">
                                    <TableCell colSpan={6} className="h-32 text-center">
                                        <div className="flex flex-col items-center gap-2">
                                            <PackageIcon className="text-muted-foreground/40 size-8" />
                                            <p className="text-muted-foreground font-medium">
                                                {emptyMessage}
                                            </p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            )}

            {data?.pagination && data.pagination.total > 0 && (
                <div className="text-muted-foreground flex items-center justify-between text-sm">
                    <div>
                        Pagina {page} di {Math.ceil(data.pagination.total / limit)}
                    </div>
                    <div>
                        Totale: {data.pagination.total} prodott
                        {data.pagination.total === 1 ? "o" : "i"}
                    </div>
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 20.2: Typecheck**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run typecheck
```
Expected: PASS.

- [ ] **Step 20.3: Avvia dev:seller e fai smoke test manuale**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run dev:seller
```

Apri il browser su `http://localhost:3003`, accedi come seller, vai su Prodotti. Esegui questi check:

1. I 3 tab sono visibili con count corretti.
2. Selezione checkbox singola e header tristate funzionano.
3. Cambio tab → selezione si resetta.
4. Per riga: dropdown con voci context-aware.
5. Click sul nome di un prodotto attivo → pagina edit. Click sul nome di un prodotto in cestino → testo grigio non cliccabile.
6. "Disabilita" da dropdown → il prodotto sparisce dal tab Attivi (optimistic), toast con Annulla. Click "Annulla" → torna in Attivi.
7. "Sposta nel cestino" → simile, ma compare nel tab Cestino.
8. Tab Cestino → "Ripristina" un prodotto → torna in Attivi. Toast con Annulla disponibile.
9. Tab Cestino → "Elimina definitivamente" su un singolo → AlertDialog → conferma → prodotto sparisce dal Cestino.
10. Bulk: seleziona 2-3 attivi, "Disabilita" → sparisce. Verifica count nel tab.
11. Bulk Cestino: "Elimina definitivamente" → AlertDialog → conferma → spariscono.
12. Edge case: cestino vuoto → empty state mostra il messaggio corretto.

Se trovi bug in fase di smoke test, sistema il codice e prosegui.

- [ ] **Step 20.4: Commit**

```bash
git add apps/seller/src/routes/_authenticated/products/index.tsx
git commit -m "$(cat <<'EOF'
feat(seller): tabs, selezione, dropdown e bulk sulla lista prodotti

Integra ProductStatusTabs, ProductBulkToolbar, ProductRowActions e
useProductSelection nella route /products. Aggiunge la colonna
checkbox di selezione (header tristate), la colonna actions
in coda e gli empty state per ciascun tab. Il click sul nome del
prodotto resta la primary action verso l'edit; nel tab Cestino il
nome è statico e l'edit è disabilitato.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 21: Verifica finale + apertura PR

**Files:**
- (nessuno; solo run di verifica)

- [ ] **Step 21.1: Run completo**

```bash
cd /Users/marcogelli/repos/jelaz/bibs
bun run typecheck
echo "TYPECHECK exit: $?"
bun run lint
echo "LINT exit: $?"
bun run --filter '@bibs/api' test
echo "TEST exit: $?"
```

Verifica esplicita di `$?` per ciascuno (gli `--filter '*'` di Bun possono mascherare exit code aggregati). Tutti devono essere `0`.

- [ ] **Step 21.2: Verifica `/openapi`**

Avvia `bun run dev:api` e apri `http://localhost:3000/openapi`. Verifica che siano presenti:
- `PATCH /seller/products/{productId}/status`
- `DELETE /seller/products/{productId}` (con descrizione aggiornata)
- `POST /seller/products/bulk/status`
- `POST /seller/products/bulk/delete-permanent`
- `GET /seller/products/status-counts`
- `GET /seller/products` con `statusFilter` come query param.

- [ ] **Step 21.3: Smoke test cross-app**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run dev
```

Apri customer (`localhost:3002`) e admin (`localhost:3001`):
- Customer: la search prodotti non mostra prodotti `disabled` o `trashed`.
- Admin: nessuna regressione visibile su pagine che listano prodotti (se ci sono).

- [ ] **Step 21.4: Apri PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat(seller): row actions, bulk e cestino sulla tabella prodotti" --body "$(cat <<'EOF'
## Summary
- Sostituisce `products.is_active` con `products.status` ('active' | 'disabled' | 'trashed') usando `text + CHECK` (decisione policy-level: default in bibs).
- Cestino reversibile + endpoint dedicato per delete fisico (`DELETE` ora gated su `status='trashed'`, con `409` altrimenti).
- Snapshot di nome/EAN/brand/immagine sugli `order_items` al checkout: lo storico ordini resta integro anche dopo il delete fisico.
- Nuova tabella `product_audit_log` con scrittura su transizioni di stato (UI di lettura fuori scope).
- Endpoint bulk best-effort (`/bulk/status`, `/bulk/delete-permanent`) con cap 100 ID.
- Frontend seller: tabs Attivi/Disabilitati/Cestino con count, checkbox di selezione, dropdown azioni context-aware per riga, sticky bulk toolbar, AlertDialog solo per delete fisico, toast con Annulla per le altre azioni, optimistic UI per single, i18n via Paraglide.

## Test plan
- [ ] `bun run typecheck` verde
- [ ] `bun run lint` verde
- [ ] `bun run --filter '@bibs/api' test` verde
- [ ] Smoke test seller (`localhost:3003/products`): tabs, count, selezione, dropdown, bulk, edit dei nomi, conferma delete fisico
- [ ] Customer search non mostra prodotti `disabled`/`trashed`
- [ ] OpenAPI riflette i nuovi endpoint

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist (post-plan)

**Spec coverage:**
- [x] product status enum + CHECK + index → Task 1
- [x] cestino reversibile → Task 1 (schema), Task 6/7 (endpoint), Task 17/18 (UI)
- [x] order_items snapshot → Task 1 (schema), Task 12 (checkout)
- [x] product_audit_log → Task 1 (schema), Task 5 (helper), Task 6/8 (uso)
- [x] PATCH /:id/status → Task 6
- [x] DELETE gated su trashed → Task 7
- [x] POST /bulk/status → Task 8
- [x] POST /bulk/delete-permanent → Task 9
- [x] GET /products statusFilter → Task 10
- [x] GET /products/status-counts → Task 11
- [x] customer search status='active' → Task 3
- [x] Frontend tabs + count → Task 16
- [x] Frontend selezione + bulk toolbar → Task 14, 19, 20
- [x] Frontend dropdown azioni + dialog conferma → Task 17, 18
- [x] Optimistic single, no-optimistic bulk + toast Undo → Task 15
- [x] i18n Paraglide → Task 13
- [x] Test API obbligatori → Task 5, 6, 7, 8, 9, 10, 11, 12

**Type consistency:** Le signature di servizio sono coerenti tra task. `ProductStatus`, `ProductAuditAction`, `BulkResult` hanno una sola definizione referenziata.

**Out of scope rispettato:** UI lettura audit log, cron purge, bulk >100 ID, varianti prodotto, audit esteso ad altri domini — niente task li tocca.

**Backfill order_items**: Task 2 Step 2.3 ha l'SQL inline.

---

**Plan complete.**
