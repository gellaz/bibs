# Seller — Nuovi campi prodotto (EAN, Brand, Macrocategoria) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere al form di creazione/modifica prodotto seller i campi EAN, Brand (entità per-seller) e Macrocategoria (filtro UI), con lookup cross-seller via EAN che pre-compila i dati su consenso esplicito.

**Architecture:** Estensione DB (`brands` table + `ean`/`brand_id` su `products`), rename della join `product_classifications` → `product_category_assignments`, nuovo modulo API `seller/brands` (list+match-or-create), nuovo endpoint `GET /seller/products/lookup`, refactor del frontend con `BrandCombobox` (shadcn Command+Popover) e `ProductCategoriesPicker` (Select macro + checkbox sotto-cat filtrate).

**Tech Stack:** Drizzle ORM (Postgres), Elysia (TypeBox + Eden Treaty), TanStack Start/Query/Router, react-hook-form + `@hookform/resolvers/typebox`, shadcn/ui (`@bibs/ui`), Bun runtime, `bun:test` per i test.

**Spec di riferimento:** `docs/superpowers/specs/2026-04-30-seller-product-fields-ean-brand-macro-design.md`

---

## Pre-flight

Prima di iniziare:

- [ ] **Step P.1: Verifica branch pulita**

Run: `git status`
Expected: working tree clean (oppure su un branch dedicato di feature).

- [ ] **Step P.2: Verifica typecheck/lint baseline passa**

Run: `bun run typecheck && bun run lint`
Expected: exit 0 sia per typecheck che per lint. Se baseline non pulita, fixare prima di procedere o chiedere all'utente.

- [ ] **Step P.3: Avvia stack locale**

Run: `bun run dev:api` in un terminale (porta 3000), `bun run dev:seller` in un altro (porta 3003). Lascia entrambi attivi durante lo sviluppo per smoke test rapidi.

---

## File Structure

### Backend (apps/api)

**Da creare:**
- `apps/api/src/db/schemas/brand.ts` — schema Drizzle per `brands`
- `apps/api/src/modules/seller/services/brands.ts` — `listBrands`, `findOrCreateBrandByName`
- `apps/api/src/modules/seller/routes/brands.ts` — `GET /seller/brands`, `POST /seller/brands`
- `apps/api/tests/integration/seller-brands.test.ts` — test del service brands

**Da modificare:**
- `apps/api/src/db/schemas/index.ts` — riesporta `brand`
- `apps/api/src/db/schemas/product.ts` — rename `productClassification` → `productCategoryAssignment`, aggiunge `ean`/`brandId`/index/check
- `apps/api/src/db/schemas/category.ts` — aggiorna import della relations
- `apps/api/src/lib/schemas/entities.ts` — aggiunge `BrandSchema`, `EanLookupResultSchema`, estende `ProductSchema`
- `apps/api/src/lib/schemas/composed.ts` — `ProductWithRelationsSchema` include `brand` + rinomina `productClassifications` → `productCategoryAssignments` nel composed
- `apps/api/src/lib/schemas/forms/products.ts` — `CreateProductBody` con `ean`/`brandId`/`brandName`
- `apps/api/src/modules/product-categories.ts` — già accetta `macroCategoryId` (verificato presente), nessuna modifica necessaria
- `apps/api/src/modules/seller/index.ts` — registra `brandsRoutes`
- `apps/api/src/modules/seller/services/products.ts` — rename + integrazione brand + EAN + lookup + validazione single-macro
- `apps/api/src/modules/seller/services/product-import.ts` — rename + colonne `ean`/`brand` nel parser
- `apps/api/src/modules/seller/routes/products.ts` — rotta `GET /products/lookup`, body PATCH esteso
- `apps/api/src/modules/customer/services/search.ts` — rename
- `apps/api/tests/helpers/fixtures.ts` — rename + helper `createTestBrand`
- `apps/api/tests/integration/seller-products.test.ts` — rename + nuovi test (brand, ean, lookup, single-macro)
- `apps/api/README.md` e `apps/api/AGENTS.md` — rename nei riferimenti (non priorità)

**Generato dal tool:**
- `apps/api/src/db/migrations/0002_<descrittore>.sql` — generato da `bun run db:generate`
- `apps/api/src/db/migrations/meta/0002_snapshot.json` — generato

### Frontend (apps/seller)

**Da creare:**
- `apps/seller/src/features/products/components/brand-combobox.tsx`
- `apps/seller/src/features/products/components/product-categories-picker.tsx`

**Da modificare:**
- `apps/seller/src/features/products/components/product-form.tsx` — campi EAN/brand, hook lookup, banner, picker plurale
- `apps/seller/src/routes/_authenticated/products/new.tsx` — passa nuovi campi nel mutationFn
- `apps/seller/src/routes/_authenticated/products/$productId.tsx` — defaultValues estesi + rename relations
- `apps/seller/src/routes/_authenticated/products/index.tsx` — rename relations key

**Da cancellare:**
- `apps/seller/src/features/products/components/product-category-picker.tsx` (sostituito dal plurale)

---

## Phase 1 — DB Schema, Rename, Migrazione

> Obiettivo: spostare `product_classifications` al nuovo nome, aggiungere `brands` e i campi `ean`/`brand_id`. Tutto in **una sola migrazione** progressive `0002_*`.

### Task 1.1: Crea schema Drizzle `brand`

**Files:**
- Create: `apps/api/src/db/schemas/brand.ts`

- [ ] **Step 1: Creare il file**

```ts
import { relations, sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { product } from "./product";
import { sellerProfile } from "./seller";

export const brand = pgTable(
	"brands",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		sellerProfileId: text("seller_profile_id")
			.notNull()
			.references(() => sellerProfile.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("brands_seller_name_unique").on(
			table.sellerProfileId,
			sql`lower(${table.name})`,
		),
		index("brands_seller_profile_id_idx").on(table.sellerProfileId),
	],
);

export const brandRelations = relations(brand, ({ many, one }) => ({
	sellerProfile: one(sellerProfile, {
		fields: [brand.sellerProfileId],
		references: [sellerProfile.id],
	}),
	products: many(product),
}));
```

- [ ] **Step 2: Riesportare in schemas/index**

Modifica `apps/api/src/db/schemas/index.ts` aggiungendo:

```ts
export * from "./brand";
```

(In ordine alfabetico tra `./auth` e `./category`.)

- [ ] **Step 3: Verifica typecheck**

Run: `bun run --filter=@bibs/api typecheck`
Expected: passa (può lamentarsi della FK ciclica con product, risolta nel Task 1.3).
Se fallisce per "Cannot find module ./product" è normale a questo punto — proseguire al Task 1.2 e ri-typeckeckare.

### Task 1.2: Rename `productClassification` → `productCategoryAssignment` nello schema Drizzle

**Files:**
- Modify: `apps/api/src/db/schemas/product.ts:63-91`
- Modify: `apps/api/src/db/schemas/category.ts:3,39`

- [ ] **Step 1: Aggiornare `product.ts` join table**

In `apps/api/src/db/schemas/product.ts`, sostituire:

```ts
export const productClassification = pgTable(
	"product_classifications",
	{
		productId: text("product_id")
			.notNull()
			.references(() => product.id, { onDelete: "cascade" }),
		productCategoryId: text("product_category_id")
			.notNull()
			.references(() => productCategory.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.productId, table.productCategoryId] }),
		index("product_classification_category_id_idx").on(table.productCategoryId),
	],
);

export const productClassificationRelations = relations(
	productClassification,
	({ one }) => ({
		product: one(product, {
			fields: [productClassification.productId],
			references: [product.id],
		}),
		category: one(productCategory, {
			fields: [productClassification.productCategoryId],
			references: [productCategory.id],
		}),
	}),
);
```

con:

```ts
export const productCategoryAssignment = pgTable(
	"product_category_assignments",
	{
		productId: text("product_id")
			.notNull()
			.references(() => product.id, { onDelete: "cascade" }),
		productCategoryId: text("product_category_id")
			.notNull()
			.references(() => productCategory.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.productId, table.productCategoryId] }),
		index("product_category_assignments_category_id_idx").on(table.productCategoryId),
	],
);

export const productCategoryAssignmentRelations = relations(
	productCategoryAssignment,
	({ one }) => ({
		product: one(product, {
			fields: [productCategoryAssignment.productId],
			references: [product.id],
		}),
		category: one(productCategory, {
			fields: [productCategoryAssignment.productCategoryId],
			references: [productCategory.id],
		}),
	}),
);
```

- [ ] **Step 2: Aggiornare `productRelations` in product.ts**

Nella stessa file, in `productRelations`, sostituire la riga:

```ts
productClassifications: many(productClassification),
```

con:

```ts
productCategoryAssignments: many(productCategoryAssignment),
```

- [ ] **Step 3: Aggiornare `category.ts` import e relations**

In `apps/api/src/db/schemas/category.ts`:

Sostituire:
```ts
import { productClassification } from "./product";
```
con:
```ts
import { productCategoryAssignment } from "./product";
```

E nella `productCategoryRelations`, sostituire:
```ts
productClassifications: many(productClassification),
```
con:
```ts
productCategoryAssignments: many(productCategoryAssignment),
```

- [ ] **Step 4: Run typecheck (api solo)**

Run: `bun run --filter=@bibs/api typecheck`
Expected: typecheck passa per `apps/api/src/db/schemas/**`. Errori in altri file (services, helpers test, frontend) sono attesi — verranno risolti nei task successivi.

### Task 1.3: Estende lo schema `product` con `ean` + `brandId` + relation a `brand`

**Files:**
- Modify: `apps/api/src/db/schemas/product.ts:1-61`

- [ ] **Step 1: Importa `brand` in cima al file**

In `apps/api/src/db/schemas/product.ts`, aggiungi tra gli import:

```ts
import { brand } from "./brand";
```

- [ ] **Step 2: Aggiungi `check` agli import drizzle-orm/pg-core**

L'import esistente già contiene `check`. Verifica che `uniqueIndex` sia presente — è già importato.

- [ ] **Step 3: Aggiungere colonne ean/brandId**

Nel `pgTable("products", {...})`, dopo `description`, aggiungere:

```ts
ean: text("ean"),
brandId: text("brand_id").references(() => brand.id, { onDelete: "set null" }),
```

- [ ] **Step 4: Aggiungere indici e check constraint**

Nella callback dopo `(table) => [`, aggiungere (dopo gli indici esistenti, prima della chiusura `]`):

```ts
uniqueIndex("product_seller_ean_unique")
	.on(table.sellerProfileId, table.ean)
	.where(sql`${table.ean} IS NOT NULL`),
index("product_ean_idx").on(table.ean),
index("product_brand_id_idx").on(table.brandId),
check(
	"product_ean_format",
	sql`${table.ean} IS NULL OR ${table.ean} ~ '^(\\d{8}|\\d{13})$'`,
),
```

- [ ] **Step 5: Aggiornare `productRelations` con brand**

In `productRelations`, dentro l'oggetto returned, aggiungere:

```ts
brand: one(brand, {
	fields: [product.brandId],
	references: [brand.id],
}),
```

- [ ] **Step 6: Run typecheck (api)**

Run: `bun run --filter=@bibs/api typecheck`
Expected: errori solo in service/test che usano `productClassification` (verranno risolti nei task 1.5, 3.x).

### Task 1.4: Genera la migrazione Drizzle

**Files:**
- Create (auto-gen): `apps/api/src/db/migrations/0002_<auto>.sql`
- Create (auto-gen): `apps/api/src/db/migrations/meta/0002_snapshot.json`

- [ ] **Step 1: Run db:generate**

Run: `bun run --filter=@bibs/api db:generate`
Expected: Drizzle Kit chiede se `product_classifications` è stato rinominato (interactive prompt). Rispondere **rename**, scegliendo `product_category_assignments` come target. Una nuova migrazione `0002_*.sql` viene creata.

- [ ] **Step 2: Aprire e leggere la migrazione generata**

Run: `ls apps/api/src/db/migrations/0002_*.sql` per individuare il file. Apri con `Read`.

Verifica che contenga:
- `ALTER TABLE "product_classifications" RENAME TO "product_category_assignments"`
- `ALTER INDEX ... product_classification_category_id_idx ... RENAME TO product_category_assignments_category_id_idx` (o simile)
- `CREATE TABLE "brands" (...)` con FK a seller_profiles e ON DELETE CASCADE
- `CREATE UNIQUE INDEX "brands_seller_name_unique" ... ON "brands" USING btree ("seller_profile_id", lower("name"))`
- `CREATE INDEX "brands_seller_profile_id_idx" ON "brands"`
- `ALTER TABLE "products" ADD COLUMN "ean" text`
- `ALTER TABLE "products" ADD COLUMN "brand_id" text`
- `ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE set null`
- `CREATE UNIQUE INDEX "product_seller_ean_unique" ON "products" USING btree ("seller_profile_id","ean") WHERE "ean" IS NOT NULL`
- `CREATE INDEX "product_ean_idx" ON "products"`
- `CREATE INDEX "product_brand_id_idx" ON "products"`
- `ALTER TABLE "products" ADD CONSTRAINT "product_ean_format" CHECK (...)`

Se manca il rename (cioè Drizzle ha generato DROP+CREATE invece di RENAME), **fermarsi e correggere a mano** prima di applicare: cambiare `DROP TABLE "product_classifications" CASCADE` + `CREATE TABLE "product_category_assignments"...` in un singolo `ALTER TABLE "product_classifications" RENAME TO "product_category_assignments"` + i relativi `ALTER INDEX ... RENAME`. Drop+create perde i dati.

- [ ] **Step 3: Applica la migrazione**

Run: `bun run --filter=@bibs/api db:migrate`
Expected: la migrazione viene applicata senza errori. Verifica con `psql` (o tramite il dev container) che le tabelle esistono:

```bash
psql $DATABASE_URL -c "\dt" | grep -E "brands|product_category_assignments"
psql $DATABASE_URL -c "\d products" | grep -E "ean|brand_id"
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/schemas/brand.ts \
        apps/api/src/db/schemas/index.ts \
        apps/api/src/db/schemas/product.ts \
        apps/api/src/db/schemas/category.ts \
        apps/api/src/db/migrations/0002_*.sql \
        apps/api/src/db/migrations/meta/0002_snapshot.json \
        apps/api/src/db/migrations/meta/_journal.json
git commit -m "feat(api,db): add brands table, EAN/brand_id columns, rename classifications join

Adds new brands entity (per-seller, case-insensitive unique name), EAN and
brand_id columns on products with partial unique index per seller, and
renames product_classifications to product_category_assignments for clarity."
```

### Task 1.5: Aggiorna i call sites del rename (services, fixtures, schemi composed)

**Files:**
- Modify: `apps/api/src/lib/schemas/composed.ts:49-67`
- Modify: `apps/api/src/modules/seller/services/products.ts`
- Modify: `apps/api/src/modules/seller/services/product-import.ts`
- Modify: `apps/api/src/modules/customer/services/search.ts`
- Modify: `apps/api/tests/helpers/fixtures.ts`
- Modify: `apps/api/tests/integration/seller-products.test.ts`

- [ ] **Step 1: Aggiornare `composed.ts`**

In `apps/api/src/lib/schemas/composed.ts`, sostituire:

```ts
const ProductClassificationWithCategory = t.Object({
	productId: t.String(),
	productCategoryId: t.String(),
	category: ProductCategorySchema,
});
```

con:

```ts
const ProductCategoryAssignmentWithCategory = t.Object({
	productId: t.String(),
	productCategoryId: t.String(),
	category: ProductCategorySchema,
});
```

E in `ProductWithRelationsSchema`, sostituire:

```ts
productClassifications: t.Array(ProductClassificationWithCategory),
```

con:

```ts
productCategoryAssignments: t.Array(ProductCategoryAssignmentWithCategory),
```

- [ ] **Step 2: Aggiornare `services/products.ts`**

In `apps/api/src/modules/seller/services/products.ts`:

a) L'import:
```ts
import { product, productClassification } from "@/db/schemas/product";
```
diventa:
```ts
import { product, productCategoryAssignment } from "@/db/schemas/product";
```

b) Tutti gli usi di `productClassification` come table → `productCategoryAssignment`. Tutte le proprietà `productClassifications:` (sia nei `with: {...}` di Drizzle queries sia nei result mapping) → `productCategoryAssignments:`. Usa global find/replace nel file:

- `productClassification` → `productCategoryAssignment` (replaces 4 occurrences inside `tx.delete`/`tx.insert`/`with`)
- `productClassifications` → `productCategoryAssignments` (replaces 2 occurrences in `with: { productClassifications: ... }`)

Verifica il diff a mano dopo: i nomi delle proprietà nei `with: {}` devono matchare quelli definiti in `productRelations` (che hai rinominato in Task 1.2 step 2).

- [ ] **Step 3: Aggiornare `services/product-import.ts`**

Stesso find/replace:
- `productClassification` → `productCategoryAssignment`

(Il file ha solo l'import e una `tx.insert(productClassification)`).

- [ ] **Step 4: Aggiornare `customer/services/search.ts`**

Stesso find/replace:
- `productClassification` → `productCategoryAssignment`
- `productClassifications` → `productCategoryAssignments` (se presente)

- [ ] **Step 5: Aggiornare `tests/helpers/fixtures.ts`**

In `fixtures.ts`:
- Import: `productClassification` → `productCategoryAssignment`
- Funzione `createTestProductClassification` → rinomina in `createTestProductCategoryAssignment` e usa `productCategoryAssignment` nell'insert.

Update tutti i call sites che usano `createTestProductClassification`:

```bash
grep -rn "createTestProductClassification" apps/api/tests
```

Sostituiscili con `createTestProductCategoryAssignment`.

- [ ] **Step 6: Aggiornare `tests/integration/seller-products.test.ts`**

Stesso find/replace:
- `productClassification` → `productCategoryAssignment`
- `productClassifications` → `productCategoryAssignments` (proprietà nei `with` o asserts)
- `createTestProductClassification` → `createTestProductCategoryAssignment`

- [ ] **Step 7: Run typecheck**

Run: `bun run typecheck`
Expected: passa. Se errori `productClassification not found` rimangono, cerca:
```bash
grep -rn "productClassification" apps/api/src apps/api/tests apps/seller/src
```
e correggi (i file `apps/seller/src/routes/_authenticated/products/{index,$productId}.tsx` sono coperti nella Phase 4 — possono essere lasciati indietro ora se causano solo errori frontend; il `bun run typecheck` root però fallirà perché controlla anche apps/seller. **Vai avanti**: vai al Task 1.6 sotto.)

- [ ] **Step 8: Aggiorna i due route file frontend (anticipato dalla Phase 4 per non lasciare il typecheck rotto)**

In `apps/seller/src/routes/_authenticated/products/index.tsx` e `apps/seller/src/routes/_authenticated/products/$productId.tsx`:
- `productClassifications` → `productCategoryAssignments` (trattasi della relation key in Eden Treaty results, type-safe — TypeScript piangerà finché non rinomini).

Run: `grep -n "productClassifications" apps/seller/src/routes/_authenticated/products/*.tsx` per individuarli, poi `Edit` per sostituirli.

- [ ] **Step 9: Run typecheck completo**

Run: `bun run typecheck`
Expected: exit 0.

### Task 1.6: Run test esistenti per verificare il rename non ha rotto nulla

- [ ] **Step 1: Esegui i test integration**

Run: `bun run --filter=@bibs/api test`
Expected: tutti i test passano (i nomi delle assert e delle relation keys sono stati aggiornati nei task precedenti).

Se fallisce: cerca riferimenti residui a `productClassification` nei test (`grep -rn "productClassification" apps/api/tests`) e correggi.

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/lib/schemas/composed.ts \
        apps/api/src/modules/seller/services/products.ts \
        apps/api/src/modules/seller/services/product-import.ts \
        apps/api/src/modules/customer/services/search.ts \
        apps/api/tests/helpers/fixtures.ts \
        apps/api/tests/integration/seller-products.test.ts \
        apps/seller/src/routes/_authenticated/products/index.tsx \
        apps/seller/src/routes/_authenticated/products/$productId.tsx
git commit -m "refactor: propagate product_category_assignments rename across services and tests

Updates all call sites of the renamed Drizzle export (services, schemas,
test fixtures, frontend route loaders) to the new productCategoryAssignment
naming. No behavior changes."
```

---

## Phase 2 — Brand module (service, route, test)

> Obiettivo: nuovo modulo `seller/brands` con list (paginata, filtro `q`) e match-or-create.

### Task 2.1: Test del service `findOrCreateBrandByName` (TDD)

**Files:**
- Create: `apps/api/tests/integration/seller-brands.test.ts`
- Modify: `apps/api/tests/helpers/fixtures.ts` (aggiunge `createTestBrand`)

- [ ] **Step 1: Aggiungere helper `createTestBrand` in fixtures**

In `apps/api/tests/helpers/fixtures.ts`, aggiungere (dopo `createTestProductCategoryAssignment`):

```ts
import { brand } from "@/db/schemas/brand";

export async function createTestBrand(
	db: DrizzleTestDb,
	sellerProfileId: string,
	name = "Test Brand",
) {
	const [b] = await db
		.insert(brand)
		.values({ sellerProfileId, name })
		.returning();
	return b;
}
```

(Posiziona l'import in cima accanto agli altri.)

- [ ] **Step 2: Creare il test file con i test failing**

Crea `apps/api/tests/integration/seller-brands.test.ts`:

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

import {
	findOrCreateBrandByName,
	listBrands,
} from "@/modules/seller/services/brands";
import { truncateAll } from "../helpers/cleanup";
import { createTestBrand, createTestSeller } from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

describe("findOrCreateBrandByName", () => {
	it("creates a new brand when none exists", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		const result = await findOrCreateBrandByName({
			sellerProfileId: seller.profile.id,
			name: "Nike",
		});

		expect(result.name).toBe("Nike");
		expect(result.sellerProfileId).toBe(seller.profile.id);
		expect(result.id).toBeTruthy();
	});

	it("returns the existing brand on case-insensitive match", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const existing = await createTestBrand(db, seller.profile.id, "Nike");

		const result = await findOrCreateBrandByName({
			sellerProfileId: seller.profile.id,
			name: "NIKE",
		});

		expect(result.id).toBe(existing.id);
		expect(result.name).toBe("Nike");
	});

	it("scopes per seller — same name across sellers creates separate brands", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });

		const a = await findOrCreateBrandByName({
			sellerProfileId: sellerA.profile.id,
			name: "Nike",
		});
		const b = await findOrCreateBrandByName({
			sellerProfileId: sellerB.profile.id,
			name: "Nike",
		});

		expect(a.id).not.toBe(b.id);
	});

	it("is race-safe — concurrent calls produce a single brand", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		const [r1, r2, r3] = await Promise.all([
			findOrCreateBrandByName({
				sellerProfileId: seller.profile.id,
				name: "Adidas",
			}),
			findOrCreateBrandByName({
				sellerProfileId: seller.profile.id,
				name: "adidas",
			}),
			findOrCreateBrandByName({
				sellerProfileId: seller.profile.id,
				name: "ADIDAS",
			}),
		]);

		expect(r1.id).toBe(r2.id);
		expect(r2.id).toBe(r3.id);
	});
});

describe("listBrands", () => {
	it("returns empty list when seller has no brands", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		const result = await listBrands({ sellerProfileId: seller.profile.id });

		expect(result.data).toHaveLength(0);
		expect(result.pagination.total).toBe(0);
	});

	it("returns only brands of the requesting seller", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		await createTestBrand(db, sellerA.profile.id, "Nike");
		await createTestBrand(db, sellerB.profile.id, "Adidas");

		const result = await listBrands({ sellerProfileId: sellerA.profile.id });

		expect(result.data).toHaveLength(1);
		expect(result.data[0].name).toBe("Nike");
	});

	it("filters by q case-insensitively", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await createTestBrand(db, seller.profile.id, "Nike");
		await createTestBrand(db, seller.profile.id, "Adidas");
		await createTestBrand(db, seller.profile.id, "Puma");

		const result = await listBrands({
			sellerProfileId: seller.profile.id,
			q: "ad",
		});

		expect(result.data).toHaveLength(1);
		expect(result.data[0].name).toBe("Adidas");
	});

	it("paginates correctly", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		for (let i = 0; i < 25; i++) {
			await createTestBrand(db, seller.profile.id, `Brand ${i}`);
		}

		const page1 = await listBrands({
			sellerProfileId: seller.profile.id,
			page: 1,
			limit: 10,
		});
		const page3 = await listBrands({
			sellerProfileId: seller.profile.id,
			page: 3,
			limit: 10,
		});

		expect(page1.data).toHaveLength(10);
		expect(page3.data).toHaveLength(5);
		expect(page1.pagination.total).toBe(25);
	});
});
```

- [ ] **Step 3: Run i test (devono fallire)**

Run: `bun test apps/api/tests/integration/seller-brands.test.ts`
Expected: fallisce con "Cannot find module '@/modules/seller/services/brands'" o simile.

### Task 2.2: Implementa il service `brands.ts`

**Files:**
- Create: `apps/api/src/modules/seller/services/brands.ts`

- [ ] **Step 1: Creare il service**

```ts
import { and, count, eq, ilike, sql } from "drizzle-orm";
import { db } from "@/db";
import { brand } from "@/db/schemas/brand";
import { parsePagination } from "@/lib/pagination";

interface ListBrandsParams {
	sellerProfileId: string;
	q?: string;
	page?: number;
	limit?: number;
}

export async function listBrands(params: ListBrandsParams) {
	const { sellerProfileId, q } = params;
	const { page, limit, offset } = parsePagination(params);

	const where = q
		? and(eq(brand.sellerProfileId, sellerProfileId), ilike(brand.name, `%${q}%`))
		: eq(brand.sellerProfileId, sellerProfileId);

	const [data, [{ total }]] = await Promise.all([
		db.query.brand.findMany({
			where,
			orderBy: (b, { asc }) => [asc(b.name)],
			limit,
			offset,
		}),
		db.select({ total: count() }).from(brand).where(where),
	]);

	return { data, pagination: { page, limit, total } };
}

interface FindOrCreateBrandParams {
	sellerProfileId: string;
	name: string;
}

export async function findOrCreateBrandByName(params: FindOrCreateBrandParams) {
	const { sellerProfileId, name } = params;
	const trimmed = name.trim();

	const [row] = await db
		.insert(brand)
		.values({ sellerProfileId, name: trimmed })
		.onConflictDoUpdate({
			target: [brand.sellerProfileId, sql`lower(${brand.name})`],
			set: { updatedAt: sql`now()` },
		})
		.returning();

	return row;
}
```

- [ ] **Step 2: Run i test**

Run: `bun test apps/api/tests/integration/seller-brands.test.ts`
Expected: tutti i test passano.

Se il test "race-safe" fallisce con duplicati: verificare che l'`uniqueIndex` su `(seller_profile_id, lower(name))` sia stato creato (vedi Task 1.4 step 3 — `\d brands`). Se manca, la migrazione va corretta.

### Task 2.3: Implementa la route `seller/brands`

**Files:**
- Create: `apps/api/src/modules/seller/routes/brands.ts`
- Modify: `apps/api/src/modules/seller/index.ts`
- Modify: `apps/api/src/lib/schemas/entities.ts` (aggiunge `BrandSchema`)

- [ ] **Step 1: Aggiungere `BrandSchema` in entities.ts**

In `apps/api/src/lib/schemas/entities.ts`, sotto a `ProductMacroCategorySchema` (intorno alla riga 99), aggiungere:

```ts
export const BrandSchema = t.Object({
	id: t.String(),
	sellerProfileId: t.String(),
	name: t.String({ description: "Nome del brand" }),
	createdAt: t.Date(),
	updatedAt: t.Date(),
});
```

- [ ] **Step 2: Creare la route brands.ts**

Crea `apps/api/src/modules/seller/routes/brands.ts`:

```ts
import { Elysia, t } from "elysia";
import { ok, okPage } from "@/lib/responses";
import { BrandSchema, okPageRes, okRes, withErrors } from "@/lib/schemas";
import { withSeller } from "../context";
import {
	findOrCreateBrandByName,
	listBrands,
} from "../services/brands";

const ListBrandsQuery = t.Object({
	page: t.Optional(t.Number({ minimum: 1, default: 1, description: "Numero di pagina" })),
	limit: t.Optional(
		t.Number({ minimum: 1, maximum: 100, default: 20, description: "Elementi per pagina" }),
	),
	q: t.Optional(t.String({ maxLength: 120, description: "Filtro testuale (case-insensitive)" })),
});

export const brandsRoutes = new Elysia()
	.get(
		"/brands",
		async (ctx) => {
			const { sellerProfile: sp, query } = withSeller(ctx);
			const result = await listBrands({ sellerProfileId: sp.id, ...query });
			return okPage(result.data, result.pagination);
		},
		{
			query: ListBrandsQuery,
			response: withErrors({ 200: okPageRes(BrandSchema) }),
			detail: {
				summary: "Lista brand del venditore",
				description:
					"Restituisce la lista paginata dei brand del venditore corrente, con filtro opzionale per nome (case-insensitive).",
				tags: ["Seller - Brands"],
			},
		},
	)
	.post(
		"/brands",
		async (ctx) => {
			const { sellerProfile: sp, body } = withSeller(ctx);
			const data = await findOrCreateBrandByName({
				sellerProfileId: sp.id,
				name: body.name,
			});
			return ok(data);
		},
		{
			body: t.Object({
				name: t.String({
					minLength: 1,
					maxLength: 120,
					description: "Nome del brand",
				}),
			}),
			response: withErrors({ 200: okRes(BrandSchema) }),
			detail: {
				summary: "Crea o restituisce un brand esistente",
				description:
					"Match-or-create: se esiste già un brand con lo stesso nome (case-insensitive) per il venditore, lo restituisce invece di crearne uno nuovo.",
				tags: ["Seller - Brands"],
			},
		},
	);
```

- [ ] **Step 3: Registrare la route nel modulo seller**

In `apps/api/src/modules/seller/index.ts`, aggiungere l'import in cima:

```ts
import { brandsRoutes } from "./routes/brands";
```

E aggiungere `.use(brandsRoutes)` nel guard della seconda sezione (`Other routes: require verified VAT`), accanto a `.use(productsRoutes)`:

```ts
.use(storesRoutes)
.use(productsRoutes)
.use(brandsRoutes)   // ← aggiungere qui
.use(imagesRoutes)
...
```

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: passa.

- [ ] **Step 5: Smoke test manuale endpoint brand**

Con `dev:api` e `dev:seller` attivi, dal browser autenticato come seller, oppure con curl loggato:

```bash
curl -i http://localhost:3000/seller/brands -H "Cookie: <session-cookie>"
```

Expected: `200 { "success": true, "data": [], "pagination": {...} }` (vuoto, è atteso).

```bash
curl -i -X POST http://localhost:3000/seller/brands \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{"name":"Nike"}'
```

Expected: `200 { "success": true, "data": { "id": "...", "name": "Nike", ... } }`.

Seconda chiamata identica → ritorna lo stesso `id` (match-or-create).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/seller/services/brands.ts \
        apps/api/src/modules/seller/routes/brands.ts \
        apps/api/src/modules/seller/index.ts \
        apps/api/src/lib/schemas/entities.ts \
        apps/api/tests/helpers/fixtures.ts \
        apps/api/tests/integration/seller-brands.test.ts
git commit -m "feat(api,seller): add brands module with list and match-or-create

New /seller/brands endpoints (GET list with q-filter and pagination,
POST match-or-create). findOrCreateBrandByName uses ON CONFLICT
(seller_profile_id, lower(name)) for atomic race-safe upsert."
```

---

## Phase 3 — Product extensions (EAN field, brand wiring, lookup)

> Obiettivo: estendere `CreateProductBody`/`UpdateProductBody` con `ean`/`brandId`/`brandName`, integrare brand nel `createProduct`/`updateProduct`, aggiungere validazione single-macro, esporre `GET /seller/products/lookup`.

### Task 3.1: Estendi `ProductSchema` e `ProductWithRelationsSchema`

**Files:**
- Modify: `apps/api/src/lib/schemas/entities.ts:248-257`
- Modify: `apps/api/src/lib/schemas/composed.ts:62-67`

- [ ] **Step 1: Estendi `ProductSchema`**

In `apps/api/src/lib/schemas/entities.ts`, sostituire:

```ts
export const ProductSchema = t.Object({
	id: t.String(),
	sellerProfileId: t.String(),
	name: t.String(),
	description: t.Nullable(t.String()),
	price: t.String({ description: "Prezzo in formato decimale (es. '9.99')" }),
	isActive: t.Boolean({ description: "Se il prodotto è attivo e visibile" }),
	createdAt: t.Date(),
	updatedAt: t.Date(),
});
```

con:

```ts
export const ProductSchema = t.Object({
	id: t.String(),
	sellerProfileId: t.String(),
	name: t.String(),
	description: t.Nullable(t.String()),
	price: t.String({ description: "Prezzo in formato decimale (es. '9.99')" }),
	isActive: t.Boolean({ description: "Se il prodotto è attivo e visibile" }),
	ean: t.Nullable(t.String({ description: "Codice EAN-8 o EAN-13" })),
	brandId: t.Nullable(t.String({ description: "ID del brand del venditore" })),
	createdAt: t.Date(),
	updatedAt: t.Date(),
});
```

Aggiungi anche `EanLookupResultSchema` (in coda al file, sopra le location schemas):

```ts
export const EanLookupResultSchema = t.Object({
	name: t.String(),
	description: t.Nullable(t.String()),
	ean: t.String(),
	brandName: t.Nullable(
		t.String({
			description:
				"Nome del brand del prodotto sorgente — il venditore corrente farà match-or-create",
		}),
	),
	macroCategoryId: t.Nullable(t.String()),
	categoryIds: t.Array(t.String()),
});
```

- [ ] **Step 2: Estendi `ProductWithRelationsSchema`**

In `apps/api/src/lib/schemas/composed.ts`, sostituire:

```ts
import {
	CustomerAddressSchema,
	CustomerProfileSchema,
	EmployeeSchema,
	OrderItemSchema,
	OrderSchema,
	OrganizationSchema,
	PaymentMethodSchema,
	ProductCategorySchema,
	ProductImageSchema,
	ProductSchema,
	SellerProfileChangeSchema,
	SellerProfileSchema,
	StoreCategorySchema,
	StoreImageSchema,
	StorePhoneNumberSchema,
	StoreProductSchema,
	StoreSchema,
	UserSchema,
} from "./entities";
```

aggiungendo `BrandSchema`:

```ts
import {
	BrandSchema,
	CustomerAddressSchema,
	CustomerProfileSchema,
	EmployeeSchema,
	OrderItemSchema,
	OrderSchema,
	OrganizationSchema,
	PaymentMethodSchema,
	ProductCategorySchema,
	ProductImageSchema,
	ProductSchema,
	SellerProfileChangeSchema,
	SellerProfileSchema,
	StoreCategorySchema,
	StoreImageSchema,
	StorePhoneNumberSchema,
	StoreProductSchema,
	StoreSchema,
	UserSchema,
} from "./entities";
```

E sostituire:

```ts
export const ProductWithRelationsSchema = t.Object({
	...ProductSchema.properties,
	productCategoryAssignments: t.Array(ProductCategoryAssignmentWithCategory),
	storeProducts: t.Array(StoreProductWithStore),
	images: t.Array(ProductImageSchema),
});
```

con:

```ts
export const ProductWithRelationsSchema = t.Object({
	...ProductSchema.properties,
	productCategoryAssignments: t.Array(ProductCategoryAssignmentWithCategory),
	storeProducts: t.Array(StoreProductWithStore),
	images: t.Array(ProductImageSchema),
	brand: t.Nullable(BrandSchema),
});
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: passa.

### Task 3.2: Estendi `CreateProductBody` con i nuovi campi

**Files:**
- Modify: `apps/api/src/lib/schemas/forms/products.ts`

- [ ] **Step 1: Aggiungi i campi opzionali**

Sostituire l'intero contenuto di `apps/api/src/lib/schemas/forms/products.ts`:

```ts
import { Type } from "@sinclair/typebox";

export const CreateProductBody = Type.Object({
	name: Type.String({
		minLength: 1,
		maxLength: 200,
		description: "Nome del prodotto",
		error: "Il nome è obbligatorio",
	}),
	description: Type.Optional(
		Type.String({
			maxLength: 2000,
			description: "Descrizione del prodotto",
		}),
	),
	price: Type.String({
		pattern: "^\\d+\\.\\d{2}$",
		description: "Prezzo (formato decimale, es. '9.99')",
		error: "Il prezzo deve essere nel formato 0.00",
	}),
	categoryIds: Type.Array(Type.String({ description: "ID categoria" }), {
		minItems: 1,
		description: "Almeno una categoria obbligatoria — tutte appartenenti alla stessa macro-categoria",
		error: "Seleziona almeno una categoria",
	}),
	ean: Type.Optional(
		Type.String({
			pattern: "^(\\d{8}|\\d{13})$",
			description: "Codice EAN-8 (8 cifre) o EAN-13 (13 cifre)",
			error: "EAN deve essere 8 o 13 cifre",
		}),
	),
	brandId: Type.Optional(
		Type.String({ description: "ID di un brand esistente del venditore" }),
	),
	brandName: Type.Optional(
		Type.String({
			minLength: 1,
			maxLength: 120,
			description: "Nome di un brand da creare (ignorato se brandId è valorizzato)",
		}),
	),
});
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: passa (frontend usa `CreateProductBody` come schema, ma i campi nuovi sono opzionali quindi non rompe).

### Task 3.3: Test del service `createProduct` esteso (TDD)

**Files:**
- Modify: `apps/api/tests/integration/seller-products.test.ts`

- [ ] **Step 1: Aggiungere test per createProduct con brand**

Aggiungi i seguenti test in coda al file (prima della chiusura del `describe` finale o dentro al `describe("createProduct")` se esiste):

```ts
describe("createProduct - brand and EAN", () => {
	it("creates a product with a brandName, creating the brand on the fly", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const cat = await createTestCategory(db);

		const created = await createProduct({
			sellerProfileId: seller.profile.id,
			name: "Sneakers",
			price: "59.90",
			categoryIds: [cat.id],
			brandName: "Nike",
		});

		expect(created.brandId).toBeTruthy();

		const brandRow = await db.query.brand.findFirst({
			where: eq(brand.id, created.brandId!),
		});
		expect(brandRow?.name).toBe("Nike");
		expect(brandRow?.sellerProfileId).toBe(seller.profile.id);
	});

	it("reuses an existing brand when name matches case-insensitively", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const cat = await createTestCategory(db);
		const existing = await createTestBrand(db, seller.profile.id, "Nike");

		const created = await createProduct({
			sellerProfileId: seller.profile.id,
			name: "Sneakers 2",
			price: "59.90",
			categoryIds: [cat.id],
			brandName: "NIKE",
		});

		expect(created.brandId).toBe(existing.id);
	});

	it("uses brandId when provided, ignoring brandName", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const cat = await createTestCategory(db);
		const existing = await createTestBrand(db, seller.profile.id, "Adidas");

		const created = await createProduct({
			sellerProfileId: seller.profile.id,
			name: "Tee",
			price: "19.90",
			categoryIds: [cat.id],
			brandId: existing.id,
			brandName: "ShouldBeIgnored",
		});

		expect(created.brandId).toBe(existing.id);

		// brandName "ShouldBeIgnored" must NOT have been created
		const brands = await db.query.brand.findMany({
			where: eq(brand.sellerProfileId, seller.profile.id),
		});
		expect(brands.find((b) => b.name === "ShouldBeIgnored")).toBeUndefined();
	});

	it("rejects brandId belonging to another seller with 404", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		const cat = await createTestCategory(db);
		const brandOfB = await createTestBrand(db, sellerB.profile.id, "Foreign");

		await expect(
			createProduct({
				sellerProfileId: sellerA.profile.id,
				name: "X",
				price: "1.00",
				categoryIds: [cat.id],
				brandId: brandOfB.id,
			}),
		).rejects.toMatchObject({ status: 404 });
	});

	it("stores ean and accepts duplicate ean across different sellers", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		const cat = await createTestCategory(db);

		const a = await createProduct({
			sellerProfileId: sellerA.profile.id,
			name: "Coca",
			price: "1.00",
			categoryIds: [cat.id],
			ean: "5449000000996",
		});
		const b = await createProduct({
			sellerProfileId: sellerB.profile.id,
			name: "Coca",
			price: "1.20",
			categoryIds: [cat.id],
			ean: "5449000000996",
		});

		expect(a.ean).toBe("5449000000996");
		expect(b.ean).toBe("5449000000996");
	});

	it("rejects duplicate ean for the same seller (unique violation)", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const cat = await createTestCategory(db);

		await createProduct({
			sellerProfileId: seller.profile.id,
			name: "First",
			price: "1.00",
			categoryIds: [cat.id],
			ean: "5449000000996",
		});

		await expect(
			createProduct({
				sellerProfileId: seller.profile.id,
				name: "Second",
				price: "2.00",
				categoryIds: [cat.id],
				ean: "5449000000996",
			}),
		).rejects.toThrow(); // pg unique violation, code 23505
	});

	it("rejects categoryIds spanning multiple macro-categories", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const macroA = await createTestMacroCategory(db, "Macro A");
		const macroB = await createTestMacroCategory(db, "Macro B");
		const catA = await createTestCategory(db, "Cat A", macroA.id);
		const catB = await createTestCategory(db, "Cat B", macroB.id);

		await expect(
			createProduct({
				sellerProfileId: seller.profile.id,
				name: "Mixed",
				price: "1.00",
				categoryIds: [catA.id, catB.id],
			}),
		).rejects.toMatchObject({ status: 400 });
	});
});

describe("lookupProductByEan", () => {
	it("returns null when no product matches", async () => {
		const result = await lookupProductByEan({ ean: "00000000" });
		expect(result).toBeNull();
	});

	it("returns the latest product across sellers, with brand and categories", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		const macro = await createTestMacroCategory(db, "Foo");
		const cat = await createTestCategory(db, "Bar", macro.id);
		const brandA = await createTestBrand(db, sellerA.profile.id, "BrandA");

		// Older product (sellerA)
		await createProduct({
			sellerProfileId: sellerA.profile.id,
			name: "Old",
			price: "1.00",
			categoryIds: [cat.id],
			ean: "12345678",
			brandId: brandA.id,
		});
		await new Promise((r) => setTimeout(r, 10)); // ensure created_at differs

		// Newer product (sellerB)
		const brandB = await createTestBrand(db, sellerB.profile.id, "BrandB");
		await createProduct({
			sellerProfileId: sellerB.profile.id,
			name: "New",
			description: "Latest version",
			price: "2.00",
			categoryIds: [cat.id],
			ean: "12345678",
			brandId: brandB.id,
		});

		const result = await lookupProductByEan({ ean: "12345678" });

		expect(result).not.toBeNull();
		expect(result!.name).toBe("New");
		expect(result!.description).toBe("Latest version");
		expect(result!.ean).toBe("12345678");
		expect(result!.brandName).toBe("BrandB");
		expect(result!.macroCategoryId).toBe(macro.id);
		expect(result!.categoryIds).toEqual([cat.id]);
	});
});
```

Aggiungi gli import necessari in cima al file (vicino agli altri):

```ts
import {
	createProduct,
	deleteProduct,
	getProduct,
	listProducts,
	lookupProductByEan,
	updateProduct,
} from "@/modules/seller/services/products";
import { brand } from "@/db/schemas/brand";
import {
	createTestBrand,
	createTestCategory,
	createTestMacroCategory,
	createTestProduct,
	createTestSeller,
} from "../helpers/fixtures";
```

- [ ] **Step 2: Run i test (devono fallire)**

Run: `bun test apps/api/tests/integration/seller-products.test.ts`
Expected: i nuovi test falliscono perché `createProduct` non gestisce brand/ean e `lookupProductByEan` non esiste.

### Task 3.4: Implementa `createProduct` esteso e `lookupProductByEan`

**Files:**
- Modify: `apps/api/src/modules/seller/services/products.ts`

- [ ] **Step 1: Aggiornare gli import**

In cima a `apps/api/src/modules/seller/services/products.ts`, sostituire:

```ts
import { and, count, eq } from "drizzle-orm";
```

con:

```ts
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
```

E aggiungere agli import:

```ts
import { brand } from "@/db/schemas/brand";
import { productCategory } from "@/db/schemas/category";
```

- [ ] **Step 2: Aggiornare l'interfaccia `CreateProductParams`**

Sostituire:

```ts
interface CreateProductParams {
	sellerProfileId: string;
	name: string;
	description?: string;
	price: string;
	categoryIds: string[];
}
```

con:

```ts
interface CreateProductParams {
	sellerProfileId: string;
	name: string;
	description?: string;
	price: string;
	categoryIds: string[];
	ean?: string;
	brandId?: string;
	brandName?: string;
}
```

- [ ] **Step 3: Riscrivere `createProduct` con brand + ean + single-macro check**

Sostituire l'intera funzione `createProduct` con:

```ts
export async function createProduct(params: CreateProductParams) {
	const {
		sellerProfileId,
		categoryIds,
		brandId,
		brandName,
		ean,
		...productData
	} = params;

	// Validate: all categoryIds belong to a single macro-category
	if (categoryIds.length > 1) {
		const macros = await db
			.selectDistinct({ macroId: productCategory.macroCategoryId })
			.from(productCategory)
			.where(inArray(productCategory.id, categoryIds));
		if (macros.length > 1) {
			throw new ServiceError(
				400,
				"Le categorie devono appartenere a una sola macro-categoria",
			);
		}
	}

	return db.transaction(async (tx) => {
		// Resolve brand: brandId wins over brandName
		let resolvedBrandId: string | null = null;
		if (brandId) {
			const owned = await tx.query.brand.findFirst({
				where: and(
					eq(brand.id, brandId),
					eq(brand.sellerProfileId, sellerProfileId),
				),
			});
			if (!owned) throw new ServiceError(404, "Brand not found");
			resolvedBrandId = owned.id;
		} else if (brandName) {
			const [b] = await tx
				.insert(brand)
				.values({ sellerProfileId, name: brandName.trim() })
				.onConflictDoUpdate({
					target: [brand.sellerProfileId, sql`lower(${brand.name})`],
					set: { updatedAt: sql`now()` },
				})
				.returning();
			resolvedBrandId = b.id;
		}

		const [created] = await tx
			.insert(product)
			.values({
				sellerProfileId,
				...productData,
				ean: ean ?? null,
				brandId: resolvedBrandId,
			})
			.returning();

		if (categoryIds.length > 0) {
			await tx.insert(productCategoryAssignment).values(
				categoryIds.map((categoryId) => ({
					productId: created.id,
					productCategoryId: categoryId,
				})),
			);
		}

		return created;
	});
}
```

- [ ] **Step 4: Aggiungere `lookupProductByEan`**

In coda al file (prima dell'eventuale `deleteProduct` o in coda):

```ts
interface LookupProductByEanParams {
	ean: string;
}

export interface EanLookupResult {
	name: string;
	description: string | null;
	ean: string;
	brandName: string | null;
	macroCategoryId: string | null;
	categoryIds: string[];
}

export async function lookupProductByEan(
	params: LookupProductByEanParams,
): Promise<EanLookupResult | null> {
	const { ean } = params;

	const row = await db.query.product.findFirst({
		where: eq(product.ean, ean),
		orderBy: [desc(product.createdAt)],
		with: {
			brand: true,
			productCategoryAssignments: {
				with: { category: true },
			},
		},
	});

	if (!row) return null;

	const categoryIds = row.productCategoryAssignments.map(
		(a) => a.productCategoryId,
	);
	const macroCategoryId =
		row.productCategoryAssignments[0]?.category.macroCategoryId ?? null;

	return {
		name: row.name,
		description: row.description ?? null,
		ean: row.ean!, // we matched on it, can't be null
		brandName: row.brand?.name ?? null,
		macroCategoryId,
		categoryIds,
	};
}
```

- [ ] **Step 5: Estendi anche `updateProduct` con i nuovi campi**

Modificare l'interfaccia `UpdateProductParams`:

```ts
interface UpdateProductParams {
	productId: string;
	sellerProfileId: string;
	categoryIds?: string[];
	imageOrder?: string[];
	name?: string;
	description?: string;
	price?: string;
	ean?: string | null;
	brandId?: string | null;
	brandName?: string;
}
```

E nella funzione `updateProduct`, prima del `db.transaction`, aggiungi la stessa validazione single-macro:

```ts
if (categoryIds && categoryIds.length > 1) {
	const macros = await db
		.selectDistinct({ macroId: productCategory.macroCategoryId })
		.from(productCategory)
		.where(inArray(productCategory.id, categoryIds));
	if (macros.length > 1) {
		throw new ServiceError(
			400,
			"Le categorie devono appartenere a una sola macro-categoria",
		);
	}
}
```

Dentro la transazione, prima dell'`update(product).set(...)`, gestisci il brand:

```ts
const productUpdates: Record<string, unknown> = { ...productData };

if (ean !== undefined) productUpdates.ean = ean; // permits null to clear

if (brandId !== undefined) {
	if (brandId === null) {
		productUpdates.brandId = null;
	} else {
		const owned = await tx.query.brand.findFirst({
			where: and(
				eq(brand.id, brandId),
				eq(brand.sellerProfileId, sellerProfileId),
			),
		});
		if (!owned) throw new ServiceError(404, "Brand not found");
		productUpdates.brandId = owned.id;
	}
} else if (brandName) {
	const [b] = await tx
		.insert(brand)
		.values({ sellerProfileId, name: brandName.trim() })
		.onConflictDoUpdate({
			target: [brand.sellerProfileId, sql`lower(${brand.name})`],
			set: { updatedAt: sql`now()` },
		})
		.returning();
	productUpdates.brandId = b.id;
}

const hasProductData = Object.keys(productUpdates).length > 0;
```

(Sostituisci `productData` con `productUpdates` in `tx.update(product).set(productUpdates)`. Verifica che il `hasProductData` riferisca al nuovo dict.)

Disestrarre `ean`/`brandId`/`brandName` dal `productData` iniziale modificando la destructure:

```ts
const {
	productId,
	sellerProfileId,
	categoryIds,
	imageOrder,
	ean,
	brandId,
	brandName,
	...productData
} = params;
```

(Per coerenza con `productUpdates` sopra, `productData` non contiene più `ean`/`brandId`.)

- [ ] **Step 6: Run i test**

Run: `bun test apps/api/tests/integration/seller-products.test.ts`
Expected: tutti i test (vecchi e nuovi) passano.

Se test "rejects duplicate ean for the same seller" fallisce con un timeout: il driver pg potrebbe non rilanciare 23505 come `ServiceError` — è atteso che venga catturato dal global handler nelle route, ma a livello service test il `unique violation` rilancia un `Error` generico. `rejects.toThrow()` accetta qualunque errore quindi dovrebbe passare. Se non passa, modifica il test in:

```ts
await expect(...).rejects.toMatchObject({ code: "23505" });
```

### Task 3.5: Esponi `GET /seller/products/lookup` e estendi POST/PATCH

**Files:**
- Modify: `apps/api/src/modules/seller/routes/products.ts`

- [ ] **Step 1: Aggiungere import per il lookup**

In cima a `apps/api/src/modules/seller/routes/products.ts`, aggiornare l'import dei service per includere `lookupProductByEan`:

```ts
import {
	createProduct,
	deleteProduct,
	getProduct,
	listProducts,
	lookupProductByEan,
	updateProduct,
} from "../services/products";
```

E aggiungere agli schemi:

```ts
import {
	CsvImportResultSchema,
	EanLookupResultSchema,
	OkMessage,
	okPageRes,
	okRes,
	ProductSchema,
	ProductWithRelationsSchema,
	withErrors,
} from "@/lib/schemas";
```

- [ ] **Step 2: Aggiungere la rotta lookup**

Aggiungi prima di `.delete("/products/:productId", ...)` (in fondo alla chain):

```ts
.get(
	"/products/lookup",
	async ({ query }) => {
		const data = await lookupProductByEan({ ean: query.ean });
		return ok(data);
	},
	{
		query: t.Object({
			ean: t.String({
				pattern: "^(\\d{8}|\\d{13})$",
				description: "Codice EAN-8 o EAN-13",
			}),
		}),
		auth: true,
		response: withErrors({
			200: okRes(t.Union([EanLookupResultSchema, t.Null()])),
		}),
		detail: {
			summary: "Lookup prodotto per EAN",
			description:
				"Restituisce i dati pre-compilabili dell'ultimo prodotto creato con questo EAN (cross-seller). Esclude prezzo e immagini. Ritorna null se nessun prodotto matcha.",
			tags: ["Seller - Products"],
		},
	},
)
```

(Nota: il path è `/products/lookup`, deve venire **prima** di `/products/:productId` se Elysia usa matching ordinato. Posizionalo PRIMA della rotta GET con `:productId` per evitare che `lookup` venga interpretato come productId. In pratica, mettilo subito dopo `.get("/products", ...)` e prima di `.get("/products/:productId", ...)`.)

- [ ] **Step 3: Estendere il body PATCH**

Nella rotta `.patch("/products/:productId", ...)`, sostituire il body schema:

```ts
body: t.Object({
	categoryIds: t.Optional(
		t.Array(t.String(), {
			minItems: 1,
			description: "Nuove categorie (sostituisce le precedenti)",
		}),
	),
	name: t.Optional(
		t.String({
			minLength: 1,
			maxLength: 200,
			description: "Nome del prodotto",
		}),
	),
	description: t.Optional(
		t.String({
			maxLength: 2000,
			description: "Descrizione del prodotto",
		}),
	),
	price: t.Optional(
		t.String({
			pattern: "^\\d+\\.\\d{2}$",
			description: "Prezzo (formato decimale, es. '9.99')",
		}),
	),
	imageOrder: t.Optional(
		t.Array(t.String(), {
			description:
				"IDs delle immagini esistenti nell'ordine desiderato. La prima diventa l'immagine di default.",
		}),
	),
	ean: t.Optional(
		t.Union([
			t.String({ pattern: "^(\\d{8}|\\d{13})$" }),
			t.Null(),
		], { description: "Codice EAN (null per cancellarlo)" }),
	),
	brandId: t.Optional(
		t.Union([t.String(), t.Null()], {
			description: "ID brand esistente (null per rimuovere)",
		}),
	),
	brandName: t.Optional(
		t.String({
			minLength: 1,
			maxLength: 120,
			description: "Nome brand da creare (ignorato se brandId valorizzato)",
		}),
	),
}),
```

- [ ] **Step 4: Estendere il logging del POST**

Nella rotta `.post("/products", ...)`, nel `pino.info(...)`, aggiungi i nuovi campi al log:

```ts
pino.info(
	{
		userId: user.id,
		sellerProfileId: sp.id,
		productId: data.id,
		productName: data.name,
		categoryIds: body.categoryIds,
		ean: data.ean,
		brandId: data.brandId,
		action: "product_created",
	},
	"Nuovo prodotto creato",
);
```

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: passa.

- [ ] **Step 6: Smoke test endpoint lookup**

Con `dev:api` attivo:

```bash
curl -i "http://localhost:3000/seller/products/lookup?ean=12345678" -H "Cookie: <session-cookie>"
```

Expected: `200 { "success": true, "data": null }` (vuoto: nessun prodotto matcha).

- [ ] **Step 7: Run test integration completi**

Run: `bun run --filter=@bibs/api test`
Expected: tutti passano.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/lib/schemas/entities.ts \
        apps/api/src/lib/schemas/composed.ts \
        apps/api/src/lib/schemas/forms/products.ts \
        apps/api/src/modules/seller/services/products.ts \
        apps/api/src/modules/seller/routes/products.ts \
        apps/api/tests/integration/seller-products.test.ts
git commit -m "feat(api,seller): add EAN, brand wiring and EAN lookup to products

- CreateProductBody/UpdateProductBody accept ean, brandId, brandName
- createProduct/updateProduct validate single-macro, resolve brand via
  match-or-create when brandName given, reject foreign brandId with 404
- New GET /seller/products/lookup?ean=... returns last product matching
  the EAN cross-seller (name/description/brand-name/categories), null
  if not found"
```

### Task 3.6: Estendere `product-import.ts` con colonne `ean`/`brand` (CSV)

**Files:**
- Modify: `apps/api/src/modules/seller/services/product-import.ts`

- [ ] **Step 1: Sostituire l'intero file**

Sostituisci `apps/api/src/modules/seller/services/product-import.ts` con (le aggiunte sono: import `brand` schema, `EAN_REGEX`, header opzionali `ean`/`brand`, parsing EAN con validazione, fetch+match brand-by-name in batch, gestione del 23505 per riga):

```ts
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { brand } from "@/db/schemas/brand";
import { product, productCategoryAssignment } from "@/db/schemas/product";
import { config } from "@/lib/config";
import { ServiceError } from "@/lib/errors";
import { parseCsv } from "@/lib/utils/csv";

const PRICE_REGEX = /^\d+\.\d{2}$/;
const EAN_REGEX = /^(\d{8}|\d{13})$/;

const EXPECTED_HEADERS = ["name", "description", "price", "categories"];

interface ImportError {
	row: number;
	message: string;
}

interface ImportResult {
	created: number;
	skipped: number;
	failed: number;
	errors: ImportError[];
}

interface ValidProduct {
	name: string;
	description: string | undefined;
	price: string;
	categoryIds: string[];
	ean: string | null;
	brandName: string | null;
}

interface ImportProductsParams {
	sellerProfileId: string;
	csvText: string;
}

export async function importProductsFromCsv(
	params: ImportProductsParams,
): Promise<ImportResult> {
	const { sellerProfileId, csvText } = params;

	const { headers, rows } = parseCsv(csvText);

	for (const expected of EXPECTED_HEADERS) {
		if (!headers.includes(expected)) {
			throw new ServiceError(
				400,
				`Missing CSV header: "${expected}". Expected headers: ${EXPECTED_HEADERS.join(", ")}`,
			);
		}
	}

	if (rows.length === 0) {
		throw new ServiceError(400, "CSV file contains no data rows");
	}

	if (rows.length > config.maxProductsPerImport) {
		throw new ServiceError(
			400,
			`Too many products: ${rows.length}. Maximum allowed: ${config.maxProductsPerImport}`,
		);
	}

	const nameIdx = headers.indexOf("name");
	const descIdx = headers.indexOf("description");
	const priceIdx = headers.indexOf("price");
	const catIdx = headers.indexOf("categories");
	const eanIdx = headers.indexOf("ean"); // -1 if absent
	const brandIdx = headers.indexOf("brand"); // -1 if absent

	const allCategories = await db.query.productCategory.findMany({
		columns: { id: true, name: true },
	});
	const categoryMap = new Map(
		allCategories.map((c) => [c.name.toLowerCase(), c.id]),
	);

	const errors: ImportError[] = [];
	const validProducts: ValidProduct[] = [];

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		const rowNum = i + 2;

		const name = row[nameIdx];
		if (!name) {
			errors.push({ row: rowNum, message: "Missing product name" });
			continue;
		}

		const price = row[priceIdx];
		if (!price || !PRICE_REGEX.test(price)) {
			errors.push({
				row: rowNum,
				message: `Invalid price: "${price ?? ""}". Expected format: "9.99"`,
			});
			continue;
		}

		const categoriesRaw = row[catIdx] ?? "";
		const categoryNames = categoriesRaw
			.split(";")
			.map((c) => c.trim())
			.filter(Boolean);

		if (categoryNames.length === 0) {
			errors.push({
				row: rowNum,
				message: "At least one category is required",
			});
			continue;
		}

		const categoryIds: string[] = [];
		const unknownCategories: string[] = [];
		for (const catName of categoryNames) {
			const catId = categoryMap.get(catName.toLowerCase());
			if (catId) {
				categoryIds.push(catId);
			} else {
				unknownCategories.push(catName);
			}
		}

		if (unknownCategories.length > 0) {
			errors.push({
				row: rowNum,
				message: `Categories not found: ${unknownCategories.join(", ")}`,
			});
			continue;
		}

		const eanRaw = eanIdx >= 0 ? (row[eanIdx]?.trim() ?? "") : "";
		const ean = eanRaw.length > 0 ? eanRaw : null;
		if (ean !== null && !EAN_REGEX.test(ean)) {
			errors.push({
				row: rowNum,
				message: `Invalid EAN: "${ean}". Expected 8 or 13 digits`,
			});
			continue;
		}

		const brandRaw = brandIdx >= 0 ? (row[brandIdx]?.trim() ?? "") : "";
		const brandName = brandRaw.length > 0 ? brandRaw : null;

		const description = row[descIdx] || undefined;
		validProducts.push({
			name,
			description,
			price,
			categoryIds,
			ean,
			brandName,
		});
	}

	let created = 0;
	let skipped = 0;

	if (validProducts.length > 0) {
		await db.transaction(async (tx) => {
			// Resolve all brand names to IDs in batch (match-or-create per seller)
			const uniqueBrandNames = Array.from(
				new Set(
					validProducts
						.map((p) => p.brandName)
						.filter((n): n is string => n !== null),
				),
			);
			const brandIdByLower = new Map<string, string>();
			for (const bname of uniqueBrandNames) {
				const [b] = await tx
					.insert(brand)
					.values({ sellerProfileId, name: bname })
					.onConflictDoUpdate({
						target: [brand.sellerProfileId, sql`lower(${brand.name})`],
						set: { updatedAt: sql`now()` },
					})
					.returning();
				brandIdByLower.set(bname.toLowerCase(), b.id);
			}

			// Insert products one-by-one to capture per-row 23505 (duplicate EAN)
			for (let i = 0; i < validProducts.length; i++) {
				const p = validProducts[i];
				const rowNum = i + 2;
				const brandId = p.brandName
					? (brandIdByLower.get(p.brandName.toLowerCase()) ?? null)
					: null;

				try {
					const [inserted] = await tx
						.insert(product)
						.values({
							sellerProfileId,
							name: p.name,
							description: p.description,
							price: p.price,
							ean: p.ean,
							brandId,
						})
						.returning({ id: product.id });

					if (p.categoryIds.length > 0) {
						await tx.insert(productCategoryAssignment).values(
							p.categoryIds.map((categoryId) => ({
								productId: inserted.id,
								productCategoryId: categoryId,
							})),
						);
					}
					created++;
				} catch (err: unknown) {
					const e = err as { code?: string; constraint_name?: string };
					if (
						e.code === "23505" &&
						(e.constraint_name === "product_seller_ean_unique" ||
							/ean/.test(e.constraint_name ?? ""))
					) {
						errors.push({
							row: rowNum,
							message: `EAN già usato per un altro prodotto del venditore: "${p.ean}"`,
						});
						skipped++;
						continue;
					}
					throw err;
				}
			}
		});
	}

	return { created, skipped, failed: errors.length, errors };
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run --filter=@bibs/api typecheck`
Expected: passa.

- [ ] **Step 3: Smoke test** (manuale)

Crea un file `/tmp/test.csv`:

```csv
name,description,price,categories,ean,brand
Cola 33cl,Bibita gassata,1.50,Bevande,5449000000996,Coca-Cola
Pasta 500g,Spaghetti,1.20,Alimentari,8076809513524,Barilla
```

Importa via curl loggato come seller:

```bash
curl -i -X POST http://localhost:3000/seller/products/import \
  -H "Cookie: <session-cookie>" \
  -F "file=@/tmp/test.csv"
```

Expected: `200 { "data": { "created": 2, "skipped": 0, "failed": 0, "errors": [] } }`. Verifica che i prodotti appaiano in `/seller/products` con EAN e brand popolati.

Importa lo stesso file di nuovo: `created: 0, skipped: 2, errors: [{ message: "EAN già usato..." }, ...]`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/seller/services/product-import.ts
git commit -m "feat(api,seller): support ean and brand columns in product CSV import

Optional CSV columns 'ean' (validated 8/13 digits) and 'brand'
(match-or-create per seller). Duplicate EAN per seller is reported
per-row in errors[] without aborting the whole import."
```

---

## Phase 4 — Frontend (combobox brand, picker plurale, form esteso)

> Obiettivo: nuovi componenti `BrandCombobox` e `ProductCategoriesPicker`, integrazione nel `ProductForm` con il flow EAN-lookup.

### Task 4.1: Crea `BrandCombobox`

**Files:**
- Create: `apps/seller/src/features/products/components/brand-combobox.tsx`

- [ ] **Step 1: Verificare i componenti shadcn presenti**

Run: `ls packages/ui/src/components/{command,popover}.tsx`
Expected: entrambi i file esistono. Se non esistono, installa via shadcn CLI:

```bash
cd packages/ui
bunx shadcn@latest add command popover
```

- [ ] **Step 2: Creare il componente**

Crea `apps/seller/src/features/products/components/brand-combobox.tsx`:

```tsx
import { Button } from "@bibs/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@bibs/ui/components/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@bibs/ui/components/popover";
import { useQuery } from "@tanstack/react-query";
import { ChevronsUpDownIcon, XIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { api } from "@/lib/api";

export interface BrandComboboxValue {
	brandId?: string;
	brandName?: string;
}

interface BrandComboboxProps {
	value: BrandComboboxValue | null;
	onChange: (next: BrandComboboxValue | null) => void;
	placeholder?: string;
}

export function BrandCombobox({
	value,
	onChange,
	placeholder = "Cerca o crea un brand",
}: BrandComboboxProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const deferredQuery = useDeferredValue(query);

	const { data: brands = [] } = useQuery({
		queryKey: ["seller-brands", deferredQuery],
		queryFn: async () => {
			const response = await api().seller.brands.get({
				query: { q: deferredQuery || undefined, limit: 20 },
			});
			if (response.error) throw new Error("Errore nel caricamento brand");
			return response.data.data;
		},
		enabled: open,
		staleTime: 30_000,
	});

	const trimmed = query.trim();
	const exactMatch = brands.some(
		(b) => b.name.toLowerCase() === trimmed.toLowerCase(),
	);
	const showCreateOption = trimmed.length > 0 && !exactMatch;

	const displayLabel = value?.brandName ?? placeholder;

	return (
		<div className="flex items-center gap-2">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						type="button"
						variant="outline"
						role="combobox"
						aria-expanded={open}
						className="w-full justify-between font-normal"
					>
						<span
							className={value ? "" : "text-muted-foreground"}
						>
							{displayLabel}
						</span>
						<ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
					<Command shouldFilter={false}>
						<CommandInput
							placeholder="Cerca brand..."
							value={query}
							onValueChange={setQuery}
						/>
						<CommandList>
							<CommandEmpty>Nessun brand trovato</CommandEmpty>
							{brands.length > 0 && (
								<CommandGroup heading="Brand esistenti">
									{brands.map((b) => (
										<CommandItem
											key={b.id}
											value={b.id}
											onSelect={() => {
												onChange({ brandId: b.id, brandName: b.name });
												setOpen(false);
												setQuery("");
											}}
										>
											{b.name}
										</CommandItem>
									))}
								</CommandGroup>
							)}
							{showCreateOption && (
								<CommandGroup heading="Nuovo">
									<CommandItem
										value={`__create__${trimmed}`}
										onSelect={() => {
											onChange({ brandName: trimmed });
											setOpen(false);
											setQuery("");
										}}
									>
										+ Crea brand «{trimmed}»
									</CommandItem>
								</CommandGroup>
							)}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
			{value && (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					onClick={() => onChange(null)}
					aria-label="Rimuovi brand"
				>
					<XIcon className="h-4 w-4" />
				</Button>
			)}
		</div>
	);
}
```

- [ ] **Step 3: Run typecheck**

Run: `bun run --filter=@bibs/seller typecheck`
Expected: passa. Errori previsti: `api().seller.brands` potrebbe non essere ancora tipizzato — riavvia il dev server per ricaricare i tipi Eden Treaty (`bun run dev:seller`).

### Task 4.2: Crea `ProductCategoriesPicker` (rinominato dal singolare)

**Files:**
- Create: `apps/seller/src/features/products/components/product-categories-picker.tsx`
- Delete: `apps/seller/src/features/products/components/product-category-picker.tsx`

- [ ] **Step 1: Verificare presenza shadcn `select`**

Run: `ls packages/ui/src/components/select.tsx`
Expected: esiste.

- [ ] **Step 2: Creare il nuovo componente**

Crea `apps/seller/src/features/products/components/product-categories-picker.tsx`:

```tsx
import { Checkbox } from "@bibs/ui/components/checkbox";
import { Label } from "@bibs/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@bibs/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface ProductCategoriesPickerProps {
	macroCategoryId: string | null;
	categoryIds: string[];
	onMacroChange: (macroId: string | null) => void;
	onToggleCategory: (categoryId: string) => void;
	required?: boolean;
}

export function ProductCategoriesPicker({
	macroCategoryId,
	categoryIds,
	onMacroChange,
	onToggleCategory,
	required = false,
}: ProductCategoriesPickerProps) {
	const { data: macros = [] } = useQuery({
		queryKey: ["product-macro-categories"],
		queryFn: async () => {
			const response = await api()["product-macro-categories"].get({
				query: { page: 1, limit: 100 },
			});
			if (response.error)
				throw new Error("Errore nel caricamento macro-categorie");
			return response.data.data;
		},
	});

	const { data: categories = [] } = useQuery({
		queryKey: ["product-categories", macroCategoryId],
		queryFn: async () => {
			const response = await api()["product-categories"].get({
				query: {
					page: 1,
					limit: 200,
					macroCategoryId: macroCategoryId ?? undefined,
				},
			});
			if (response.error) throw new Error("Errore nel caricamento categorie");
			return response.data.data;
		},
		enabled: !!macroCategoryId,
	});

	return (
		<div className="space-y-3">
			<div className="space-y-2">
				<Label>Macrocategoria{required && " *"}</Label>
				<Select
					value={macroCategoryId ?? ""}
					onValueChange={(v) => onMacroChange(v || null)}
				>
					<SelectTrigger>
						<SelectValue placeholder="Seleziona una macrocategoria" />
					</SelectTrigger>
					<SelectContent>
						{macros.map((m) => (
							<SelectItem key={m.id} value={m.id}>
								{m.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{macroCategoryId && (
				<div className="space-y-2">
					<Label>
						Categorie{required && " *"}
						{categoryIds.length > 0 && (
							<span className="ml-1 text-xs font-normal text-muted-foreground">
								({categoryIds.length} selezionat
								{categoryIds.length === 1 ? "a" : "e"})
							</span>
						)}
					</Label>
					{categories.length > 0 ? (
						<div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
							{categories.map((cat) => (
								<label
									key={cat.id}
									htmlFor={`cat-${cat.id}`}
									className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
								>
									<Checkbox
										id={`cat-${cat.id}`}
										checked={categoryIds.includes(cat.id)}
										onCheckedChange={() => onToggleCategory(cat.id)}
									/>
									{cat.name}
								</label>
							))}
						</div>
					) : (
						<p className="text-xs text-muted-foreground">
							Nessuna categoria disponibile per questa macro
						</p>
					)}
				</div>
			)}
		</div>
	);
}
```

- [ ] **Step 3: Cancellare il vecchio file**

Run: `rm apps/seller/src/features/products/components/product-category-picker.tsx`

- [ ] **Step 4: Aggiornare l'import nel form (anticipato)**

In `apps/seller/src/features/products/components/product-form.tsx`, sostituire:

```ts
import { ProductCategoryPicker } from "./product-category-picker";
```

con:

```ts
import { ProductCategoriesPicker } from "./product-categories-picker";
```

(Il form va modificato più completamente nel Task 4.3, ma serve già almeno l'import per il typecheck.)

- [ ] **Step 5: Run typecheck**

Run: `bun run --filter=@bibs/seller typecheck`
Expected: passa.

### Task 4.3: Estendi `ProductForm` con EAN/lookup, brand combobox, picker plurale

**Files:**
- Modify: `apps/seller/src/features/products/components/product-form.tsx`

- [ ] **Step 1: Backup del file (opzionale ma utile)**

Run: `cp apps/seller/src/features/products/components/product-form.tsx /tmp/product-form.tsx.bak`

- [ ] **Step 2: Riscrivere il form**

Sostituisci l'intero contenuto di `apps/seller/src/features/products/components/product-form.tsx` con:

```tsx
import { CreateProductBody } from "@bibs/api/schemas";
import { Button } from "@bibs/ui/components/button";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { Separator } from "@bibs/ui/components/separator";
import { toast } from "@bibs/ui/components/sonner";
import { Textarea } from "@bibs/ui/components/textarea";
import { typeboxResolver } from "@hookform/resolvers/typebox";
import type { Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { api } from "@/lib/api";
import { BrandCombobox, type BrandComboboxValue } from "./brand-combobox";
import {
	type ExistingImage,
	ProductImageDropzone,
} from "./product-image-dropzone";
import { ProductCategoriesPicker } from "./product-categories-picker";

type ProductFormData = Static<typeof CreateProductBody>;
const compiledSchema = TypeCompiler.Compile(CreateProductBody);

export type { ExistingImage };

export interface ProductFormValues extends ProductFormData {
	files: File[];
	imageOrder?: string[];
}

export interface ProductFormDefaultValues {
	name: string;
	description?: string | null;
	price: string;
	categoryIds: string[];
	ean?: string | null;
	brandId?: string | null;
	brandName?: string | null;
	macroCategoryId?: string | null;
}

interface ProductFormProps {
	defaultValues?: ProductFormDefaultValues;
	existingImages?: ExistingImage[];
	onDeleteExisting?: (imageId: string) => void;
	onSubmit: (values: ProductFormValues) => void;
	onCancel: () => void;
	isPending: boolean;
	submitLabel: string;
	pendingLabel: string;
	onNameChange?: (name: string) => void;
}

const EAN_REGEX = /^(\d{8}|\d{13})$/;

export function ProductForm({
	defaultValues,
	existingImages = [],
	onDeleteExisting,
	onSubmit,
	onCancel,
	isPending,
	submitLabel,
	pendingLabel,
	onNameChange,
}: ProductFormProps) {
	const isEdit = !!defaultValues;

	const {
		register,
		handleSubmit,
		setValue,
		watch,
		getValues,
		formState: { errors },
	} = useForm<ProductFormData>({
		resolver: typeboxResolver(compiledSchema),
		defaultValues: {
			name: defaultValues?.name ?? "",
			description: defaultValues?.description ?? "",
			price: defaultValues?.price ?? "",
			categoryIds: defaultValues?.categoryIds ?? [],
			ean: defaultValues?.ean ?? undefined,
			brandId: defaultValues?.brandId ?? undefined,
			brandName: defaultValues?.brandName ?? undefined,
		},
	});

	const selectedCategories = watch("categoryIds");
	const nameValue = watch("name");
	const eanValue = watch("ean") ?? "";
	const brandIdValue = watch("brandId");
	const brandNameValue = watch("brandName");

	useEffect(() => {
		onNameChange?.(nameValue);
	}, [nameValue, onNameChange]);

	// Macro state lives outside RHF (it's UI-only — derived for edit, transient for create).
	const [macroCategoryId, setMacroCategoryId] = useState<string | null>(
		defaultValues?.macroCategoryId ?? null,
	);

	// Files and imageOrder are outside RHF (non-serializable File objects)
	const [files, setFiles] = useState<File[]>([]);
	const [imageOrder, setImageOrder] = useState<string[] | undefined>();

	// EAN lookup — only in create mode
	const eanLookupEnabled = !isEdit && EAN_REGEX.test(eanValue);
	const eanLookup = useQuery({
		queryKey: ["ean-lookup", eanValue],
		queryFn: async () => {
			const response = await api()
				.seller.products.lookup.get({ query: { ean: eanValue } });
			if (response.error) throw new Error("Errore lookup EAN");
			return response.data.data;
		},
		enabled: eanLookupEnabled,
		staleTime: Infinity,
	});

	const [lookupDismissed, setLookupDismissed] = useState(false);
	useEffect(() => {
		setLookupDismissed(false); // reset on new EAN value
	}, [eanValue]);

	const lookupResult = eanLookup.data;
	const showLookupBanner =
		eanLookupEnabled && !!lookupResult && !lookupDismissed;

	const applyLookup = (overwrite: boolean) => {
		if (!lookupResult) return;
		const cur = getValues();
		if (overwrite || !cur.name) setValue("name", lookupResult.name);
		if (overwrite || !cur.description)
			setValue("description", lookupResult.description ?? "");
		if (lookupResult.brandName && (overwrite || !brandIdValue)) {
			setValue("brandId", undefined);
			setValue("brandName", lookupResult.brandName);
		}
		if (overwrite || !macroCategoryId) {
			setMacroCategoryId(lookupResult.macroCategoryId);
		}
		if (overwrite || cur.categoryIds.length === 0) {
			setValue("categoryIds", lookupResult.categoryIds, { shouldValidate: true });
		}
		setLookupDismissed(true);
	};

	const hasAnyDirty =
		!!getValues("name") ||
		!!getValues("description") ||
		!!brandIdValue ||
		!!brandNameValue ||
		!!macroCategoryId ||
		getValues("categoryIds").length > 0;

	const handleDrop = useCallback(
		(acceptedFiles: File[]) => {
			setFiles((prev) => {
				const remaining = 10 - existingImages.length - prev.length;
				return [...prev, ...acceptedFiles.slice(0, Math.max(0, remaining))];
			});
		},
		[existingImages.length],
	);

	const removeFile = (index: number) => {
		setFiles((prev) => prev.filter((_, i) => i !== index));
	};

	const reorderFiles = (reordered: File[]) => {
		setFiles(reordered);
	};

	const toggleCategory = (categoryId: string) => {
		const current = selectedCategories;
		const next = current.includes(categoryId)
			? current.filter((id) => id !== categoryId)
			: [...current, categoryId];
		setValue("categoryIds", next, { shouldValidate: true });
	};

	const onMacroChange = (next: string | null) => {
		const hadCategories = selectedCategories.length > 0;
		setMacroCategoryId(next);
		setValue("categoryIds", [], { shouldValidate: true });
		if (hadCategories && next !== macroCategoryId) {
			toast.info("Categorie resettate per via del cambio di macrocategoria");
		}
	};

	const onBrandChange = (next: BrandComboboxValue | null) => {
		setValue("brandId", next?.brandId, { shouldValidate: true });
		setValue("brandName", next?.brandName, { shouldValidate: true });
	};

	const onFormSubmit: SubmitHandler<ProductFormData> = (data) => {
		const price = data.price.includes(".")
			? data.price
					.replace(/^(\d+\.\d{0,2}).*$/, "$1")
					.padEnd(data.price.indexOf(".") + 3, "0")
			: `${data.price}.00`;
		onSubmit({
			...data,
			ean: data.ean || undefined,
			price,
			files,
			imageOrder,
		});
	};

	const brandValue: BrandComboboxValue | null =
		brandIdValue || brandNameValue
			? { brandId: brandIdValue, brandName: brandNameValue }
			: null;

	return (
		<form onSubmit={handleSubmit(onFormSubmit)} className="space-y-5">
			<div className="grid gap-4 sm:grid-cols-2">
				<Field data-invalid={!!errors.ean} className="sm:col-span-2">
					<FieldLabel htmlFor="product-ean">EAN</FieldLabel>
					<Input
						id="product-ean"
						placeholder="8 o 13 cifre"
						inputMode="numeric"
						{...register("ean")}
					/>
					<FieldError errors={[errors.ean]} />
					{showLookupBanner && (
						<div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-sm">
							<span className="flex-1 text-blue-900">
								Trovato un prodotto esistente per questo EAN.
							</span>
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={() => applyLookup(hasAnyDirty)}
							>
								{hasAnyDirty
									? "Compila campi (sovrascrive)"
									: "Compila campi"}
							</Button>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								onClick={() => setLookupDismissed(true)}
							>
								Ignora
							</Button>
						</div>
					)}
				</Field>

				<Field data-invalid={!!errors.name} className="sm:col-span-2">
					<FieldLabel htmlFor="product-name" required>
						Nome
					</FieldLabel>
					<Input
						id="product-name"
						placeholder={isEdit ? undefined : "Es. Pizza Margherita"}
						autoFocus={!isEdit}
						{...register("name")}
					/>
					<FieldError errors={[errors.name]} />
				</Field>

				<Field className="sm:col-span-2">
					<FieldLabel htmlFor="product-description">Descrizione</FieldLabel>
					<Textarea
						id="product-description"
						placeholder={isEdit ? undefined : "Descrizione del prodotto (opzionale)"}
						rows={2}
						{...register("description")}
					/>
				</Field>

				<Field data-invalid={!!errors.price}>
					<FieldLabel htmlFor="product-price" required>
						Prezzo (€)
					</FieldLabel>
					<Input
						id="product-price"
						type="number"
						step="0.01"
						min="0.01"
						placeholder={isEdit ? undefined : "9.99"}
						{...register("price")}
					/>
					<FieldError errors={[errors.price]} />
				</Field>

				<Field className="sm:col-span-2">
					<FieldLabel>Brand</FieldLabel>
					<BrandCombobox value={brandValue} onChange={onBrandChange} />
				</Field>
			</div>

			<Separator />

			<Field data-invalid={!!errors.categoryIds}>
				<ProductCategoriesPicker
					macroCategoryId={macroCategoryId}
					categoryIds={selectedCategories}
					onMacroChange={onMacroChange}
					onToggleCategory={toggleCategory}
					required
				/>
				<FieldError errors={[errors.categoryIds]} />
			</Field>

			<Separator />

			<ProductImageDropzone
				files={files}
				onDrop={handleDrop}
				onRemoveFile={removeFile}
				onReorderFiles={reorderFiles}
				existingImages={existingImages}
				onDeleteExisting={onDeleteExisting}
				onReorderExisting={setImageOrder}
			/>

			<div className="flex justify-end gap-3 pt-2">
				<Button type="button" variant="outline" onClick={onCancel}>
					Annulla
				</Button>
				<Button type="submit" disabled={isPending}>
					{isPending ? pendingLabel : submitLabel}
				</Button>
			</div>
		</form>
	);
}
```

- [ ] **Step 3: Run typecheck**

Run: `bun run --filter=@bibs/seller typecheck`
Expected: passa. Se l'API tipi Eden Treaty non sono ancora aggiornati con `seller.brands` e `seller.products.lookup`, riavvia `dev:api` e `dev:seller`.

### Task 4.4: Aggiornare `new.tsx` route

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/products/new.tsx`

- [ ] **Step 1: Riscrivere il file**

Sostituisci `apps/seller/src/routes/_authenticated/products/new.tsx` con:

```tsx
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useCallback, useState } from "react";
import {
	ProductForm,
	type ProductFormValues,
} from "@/features/products/components/product-form";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/products/new")({
	component: NewProductPage,
});

function NewProductPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const handleNameChange = useCallback((value: string) => setName(value), []);

	const goBack = () =>
		void navigate({ to: "/products", search: { page: 1, limit: 20 } });

	const createMutation = useMutation({
		mutationFn: async (formData: ProductFormValues) => {
			const response = await api().seller.products.post({
				name: formData.name,
				description: formData.description,
				price: formData.price,
				categoryIds: formData.categoryIds,
				ean: formData.ean,
				brandId: formData.brandId,
				brandName: formData.brandName,
			});

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nella creazione",
				);
			}

			const product = response.data;

			if (formData.files.length > 0 && product.data?.id) {
				const imgResponse = await api()
					.seller.products({ productId: product.data.id })
					.images.post({ files: formData.files });

				if (imgResponse.error) {
					toast.warning("Prodotto creato ma errore nel caricamento immagini");
				}
			}

			return product;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["products"] });
			void queryClient.invalidateQueries({ queryKey: ["seller-brands"] });
			toast.success("Prodotto creato con successo");
			goBack();
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante la creazione");
		},
	});

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">
						{name || (
							<span className="text-muted-foreground">Nuovo Prodotto</span>
						)}
					</h1>
					<p className="text-muted-foreground text-sm">
						Inserisci i dati del nuovo prodotto
					</p>
				</div>
				<div className="bg-primary flex size-10 items-center justify-center rounded-lg">
					<PlusIcon className="text-primary-foreground size-5" />
				</div>
			</div>

			<ProductForm
				onSubmit={(values) => createMutation.mutate(values)}
				onCancel={goBack}
				isPending={createMutation.isPending}
				submitLabel="Crea Prodotto"
				pendingLabel="Creazione..."
				onNameChange={handleNameChange}
			/>
		</div>
	);
}
```

(Note: rimosso il `useQuery` `product-categories` perché ora il picker carica le sue categorie internamente.)

- [ ] **Step 2: Run typecheck**

Run: `bun run --filter=@bibs/seller typecheck`
Expected: passa.

### Task 4.5: Aggiornare `$productId.tsx` route con i nuovi defaultValues

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/products/$productId.tsx`

- [ ] **Step 1: Sostituire l'intero file**

Sostituisci `apps/seller/src/routes/_authenticated/products/$productId.tsx` con (rimossa la `useQuery` `product-categories` perché ora il picker carica le sue categorie internamente; rinominato `productClassifications` → `productCategoryAssignments`; estesi defaultValues e payload PATCH):

```tsx
import { Separator } from "@bibs/ui/components/separator";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PencilIcon } from "lucide-react";
import { useCallback, useState } from "react";
import {
	type ExistingImage,
	ProductForm,
	type ProductFormValues,
} from "@/features/products/components/product-form";
import { ProductStockManager } from "@/features/products/components/product-stock-manager";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/products/$productId")({
	component: EditProductPage,
});

function EditProductPage() {
	const { productId } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [existingImages, setExistingImages] = useState<ExistingImage[]>([]);
	const [initialized, setInitialized] = useState(false);
	const [name, setName] = useState("");
	const handleNameChange = useCallback((value: string) => setName(value), []);

	const goBack = () =>
		void navigate({ to: "/products", search: { page: 1, limit: 20 } });

	const {
		data: product,
		isLoading,
		error,
	} = useQuery({
		queryKey: ["product", productId],
		queryFn: async () => {
			const response = await api().seller.products({ productId }).get();

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nel caricamento prodotto",
				);
			}

			return response.data.data;
		},
	});

	if (product && !initialized) {
		setExistingImages(
			product.images.map((img) => ({ id: img.id, url: img.url })),
		);
		setInitialized(true);
	}

	const deleteImageMutation = useMutation({
		mutationFn: async (imageId: string) => {
			const response = await api()
				.seller.products({ productId })
				.images({ imageId })
				.delete();

			if (response.error) {
				throw new Error("Errore nell'eliminazione immagine");
			}
		},
		onSuccess: (_data, imageId) => {
			setExistingImages((prev) => prev.filter((img) => img.id !== imageId));
			toast.success("Immagine eliminata");
		},
		onError: (error: Error) => {
			toast.error(error.message);
		},
	});

	const updateMutation = useMutation({
		mutationFn: async (formData: ProductFormValues) => {
			const response = await api().seller.products({ productId }).patch({
				name: formData.name,
				description: formData.description,
				price: formData.price,
				categoryIds: formData.categoryIds,
				imageOrder: formData.imageOrder,
				ean: formData.ean ?? null,
				brandId: formData.brandId ?? null,
				brandName: formData.brandName,
			});

			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nell'aggiornamento",
				);
			}

			if (formData.files.length > 0) {
				const imgResponse = await api()
					.seller.products({ productId })
					.images.post({ files: formData.files });

				if (imgResponse.error) {
					toast.warning(
						"Prodotto aggiornato ma errore nel caricamento immagini",
					);
				}
			}

			return response.data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["products"] });
			void queryClient.invalidateQueries({ queryKey: ["product", productId] });
			void queryClient.invalidateQueries({ queryKey: ["seller-brands"] });
			toast.success("Prodotto aggiornato con successo");
			goBack();
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante l'aggiornamento");
		},
	});

	if (isLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Spinner className="size-8" />
			</div>
		);
	}

	if (error || !product) {
		return (
			<div className="bg-destructive/10 text-destructive rounded-lg border border-destructive/20 p-4">
				<p className="text-sm">
					{(error as Error)?.message || "Prodotto non trovato"}
				</p>
			</div>
		);
	}

	const firstAssignment = product.productCategoryAssignments[0];
	const macroCategoryId =
		firstAssignment?.category.macroCategoryId ?? null;

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">
						{name || (
							<span className="text-muted-foreground">Modifica Prodotto</span>
						)}
					</h1>
					<p className="text-muted-foreground text-sm">Modifica prodotto</p>
				</div>
				<div className="bg-primary flex size-10 items-center justify-center rounded-lg">
					<PencilIcon className="text-primary-foreground size-5" />
				</div>
			</div>

			<ProductForm
				defaultValues={{
					name: product.name,
					description: product.description,
					price: product.price,
					categoryIds: product.productCategoryAssignments.map(
						(a) => a.productCategoryId,
					),
					ean: product.ean,
					brandId: product.brand?.id,
					brandName: product.brand?.name,
					macroCategoryId,
				}}
				existingImages={existingImages}
				onDeleteExisting={(imageId) => deleteImageMutation.mutate(imageId)}
				onSubmit={(values) => updateMutation.mutate(values)}
				onCancel={goBack}
				isPending={updateMutation.isPending}
				submitLabel="Salva Modifiche"
				pendingLabel="Salvataggio..."
				onNameChange={handleNameChange}
			/>

			<Separator />

			<ProductStockManager
				productId={productId}
				storeProducts={product.storeProducts}
			/>
		</div>
	);
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run --filter=@bibs/seller typecheck`
Expected: passa.

### Task 4.6: Aggiornare `index.tsx` (lista prodotti) — optional touch

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/products/index.tsx`

- [ ] **Step 1: Verificare che usa il rinominato `productCategoryAssignments`**

Run: `grep -n "productClassifications\|productCategoryAssignments" apps/seller/src/routes/_authenticated/products/index.tsx`
Expected: solo `productCategoryAssignments` (già aggiornato in Task 1.5 step 8).

Se non usato, niente da fare.

### Task 4.7: Smoke test browser end-to-end

- [ ] **Step 1: Verifica che dev server gira**

`dev:api` e `dev:seller` attivi (porta 3000 e 3003).

- [ ] **Step 2: Login come seller di test**

Browser: `http://localhost:3003`. Login con account seller (vedi seed).

- [ ] **Step 3: Verifica golden path create senza EAN**

Vai su `/products/new`. Compila Nome="Test 1", Prezzo=10, scegli macro+categoria, submit.
Expected: redirect a `/products`, toast "Prodotto creato con successo", il prodotto compare in lista.

- [ ] **Step 4: Verifica golden path create con brand nuovo**

Apri `/products/new`. Compila tutti i campi. Nel combobox brand digita "MyNewBrand", clicca "+ Crea brand «MyNewBrand»", submit.
Expected: prodotto creato. Aprilo in edit: il brand "MyNewBrand" è popolato.
Verifica che il brand appare nella lista combobox aprendo un altro form di prodotto: digitando "My" deve apparire.

- [ ] **Step 5: Verifica EAN lookup**

Crea un prodotto con EAN `1234567890123` (Nome "EAN Original", Brand "BrandLookup", una categoria).
Apri `/products/new` e digita EAN `1234567890123`.
Expected: appare il banner "Trovato un prodotto esistente per questo EAN." con bottoni "Compila campi" e "Ignora".
Clicca "Compila campi": Nome, brand, macro, categoria si pre-compilano. Prezzo resta vuoto.
Modifica il prezzo, submit.
Expected: 409 (`Conflict`) perché stesso seller ha già lo stesso EAN. Toast con messaggio.

(Bonus: per testare il caso cross-seller, logout e login come altro seller, ripeti il flow → la creazione va a buon fine perché EAN è unique solo per-seller.)

- [ ] **Step 6: Verifica reset categorie su cambio macro**

Apri `/products/new`. Scegli macro A, seleziona 2 sotto-cat. Cambia macro a B.
Expected: sotto-cat svuotate, toast "Categorie resettate per via del cambio di macrocategoria".

- [ ] **Step 7: Verifica edit con brand esistente**

Apri un prodotto creato in step precedenti. Verifica:
- EAN, brand, macro, sotto-cat tutti popolati correttamente.
- Cambia il brand cliccando "x" → il brand si rimuove.
- Submit.
Expected: prodotto salvato senza brand. Riapri: brand vuoto.

- [ ] **Step 8: Commit**

```bash
git add apps/seller/src/features/products/components/brand-combobox.tsx \
        apps/seller/src/features/products/components/product-categories-picker.tsx \
        apps/seller/src/features/products/components/product-form.tsx \
        apps/seller/src/routes/_authenticated/products/new.tsx \
        apps/seller/src/routes/_authenticated/products/\$productId.tsx
git rm apps/seller/src/features/products/components/product-category-picker.tsx
git commit -m "feat(seller,ui): add EAN lookup, brand combobox, macro picker

- New BrandCombobox (shadcn Command+Popover) with autocomplete and
  inline create-on-select
- New ProductCategoriesPicker: macro Select drives sub-category checkbox
  list, switching macro resets sub-cat selection with toast feedback
- ProductForm gains EAN field with cross-seller lookup banner that
  pre-fills name/description/brand/categories on explicit consent (no
  silent overwrite)
- Old product-category-picker.tsx removed (replaced by plural)"
```

---

## Phase 5 — Verification & cleanup

### Task 5.1: Type, lint, test full sweep

- [ ] **Step 1: Typecheck root**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 2: Lint**

Run: `bun run lint`
Expected: exit 0. Se errori Biome, sono auto-fixati dal hook on-edit, ma una pass manuale conferma.

- [ ] **Step 3: Test integration**

Run: `bun run --filter=@bibs/api test`
Expected: tutti i test passano. Verifica esplicitamente l'exit code (vedi memo: `bun run --filter='*'` può nascondere fallimenti):

```bash
bun run --filter=@bibs/api test
echo "exit: $?"
```

Expected: `exit: 0`.

### Task 5.2: Verifica OpenAPI

- [ ] **Step 1: Apri OpenAPI**

Browser: `http://localhost:3000/openapi`.

- [ ] **Step 2: Verifica endpoint visibili**

Cerca:
- `GET /seller/brands` con descrizione italiana.
- `POST /seller/brands` con descrizione italiana.
- `GET /seller/products/lookup` con descrizione italiana.
- `POST /seller/products` body include `ean`, `brandId`, `brandName`.
- `PATCH /seller/products/:productId` body include i nuovi campi.

Tutti devono avere `summary` in italiano.

### Task 5.3: Verifica visiva finale

- [ ] **Step 1: Verifica responsive del form**

Apri il form a vari breakpoint (mobile/tablet/desktop). Il campo EAN, il combobox brand e la select macro devono essere leggibili e cliccabili.

- [ ] **Step 2: Verifica stati di errore**

Inserisci EAN invalido (es. "abc") → submit deve mostrare l'errore "EAN deve essere 8 o 13 cifre".

Inserisci EAN duplicato per lo stesso seller → submit fallisce con toast 409.

### Task 5.4: Commit eventuali fix di lint/typecheck

Se Biome ha auto-fixato qualcosa durante lo sviluppo, verifica:

```bash
git status
git diff
```

Se ci sono modifiche pending dovute al lint, committa:

```bash
git add -p   # review hunk-by-hunk
git commit -m "chore: lint fixes from biome auto-fix"
```

### Task 5.5: Push branch e apri PR (opzionale, su istruzione utente)

- [ ] **Step 1: Push**

(Solo se l'utente lo chiede. Non fare push automatici.)

```bash
git push -u origin <branch-name>
```

- [ ] **Step 2: Apri PR**

Usa `/commit-commands:commit-push-pr` o manualmente con `gh pr create`. Includi nel body:
- Link allo spec.
- Lista delle decisioni chiave.
- Test plan (manuale + integration).
- Screenshots del nuovo form.

---

## Note di sicurezza e operative

- Il check constraint `product_ean_format` rifiuta EAN non conformi a livello DB — anche se la TypeBox validation viene bypassata in qualche modo, il DB protegge l'invariante.
- L'unique partial `(seller_profile_id, ean) WHERE ean IS NOT NULL` permette N prodotti con `ean = NULL` ma vincola unicità quando l'EAN c'è — comportamento corretto e atteso.
- Il global error handler in `apps/api/src/plugins/error-handler.ts` mappa `23505` → 409 — quindi i conflitti EAN diventano `409 Conflict` automaticamente, senza try/catch nelle route.
- `EanLookupResultSchema` non espone `id`, `sellerProfileId`, né il `brandId` del prodotto sorgente: zero leak di dati cross-seller. Solo il `brandName` (testuale) attraversa il confine, e diventa input per il match-or-create del seller corrente.
- Il rename della join è una migrazione `RENAME` (no DROP/CREATE): nessuna perdita di dati anche su DB già popolati di altri dev.
- `findOrCreateBrandByName` usa `ON CONFLICT ... DO UPDATE SET updated_at = now()` per essere atomic e race-safe sotto chiamate concorrenti — cambiamento di pattern rispetto a "SELECT poi INSERT" che soffrirebbe di race condition.

## Out of scope (esplicito)

Vedi sezione corrispondente in `docs/superpowers/specs/2026-04-30-seller-product-fields-ean-brand-macro-design.md`. Niente di nuovo aggiunto qui.
