# Product VAT / IVA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-product Italian VAT rate (IVA) with a macro-category-suggested default (22% fallback), show sellers the price with and without VAT (scorporo) in the product table and form, and snapshot the VAT rate + per-line VAT amount onto order line items plus a per-rate "castelletto IVA" on each order.

**Architecture:** `products.vatRate` is the fiscal source of truth (NOT NULL default `"22"`, always seller-overridable). `product_macro_categories.suggestedVatRate` is an admin-curated default that the seller **form** uses to prefill the rate client-side (the server only falls back to the DB default). Prices are gross/VAT-inclusive (Italian B2C law), so VAT is **scorporato** (extracted), never added; `order.total` is unchanged. A pure `lib/vat.ts` holds the math (`scorporo`, `buildCastelletto`); `createOrder` snapshots `vatRate` + `vatAmount` per line and stores the castelletto in `orders.vatBreakdown` (jsonb). Computation is on **gross line totals before any points discount** — the points-discount-across-rates apportionment is deferred to the future invoicing layer.

**Tech Stack:** Elysia + Drizzle ORM + Postgres + TypeBox (apps/api); TanStack Start + react-hook-form + shadcn/ui (apps/seller, apps/admin); Bun test + Testcontainers.

**Branch:** `feat/product-vat-iva` (already created; the design spec is committed there).

**VAT rates in scope:** `22, 10, 5, 4, 0` (stored as the strings `"22" "10" "5" "4" "0"`).

---

## Task 1: VAT domain library (`lib/vat.ts`)

Pure functions, no DB. Mirrors `apps/api/src/lib/money.ts` + `apps/api/tests/lib/money.test.ts`.

**Files:**
- Create: `apps/api/src/lib/vat.ts`
- Test: `apps/api/tests/lib/vat.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/lib/vat.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { buildCastelletto, scorporo, VAT_RATES } from "@/lib/vat";

describe("VAT_RATES", () => {
	it("lists the five Italian rates as strings, default-first", () => {
		expect(VAT_RATES).toEqual(["22", "10", "5", "4", "0"]);
	});
});

describe("scorporo", () => {
	it("splits a gross cents amount into net + vat (22%)", () => {
		// 12.20 € gross @ 22% → 10.00 net + 2.20 vat
		expect(scorporo(1220, 22)).toEqual({ netCents: 1000, vatCents: 220 });
	});

	it("splits 10% cleanly", () => {
		// 11.00 € gross @ 10% → 10.00 net + 1.00 vat
		expect(scorporo(1100, 10)).toEqual({ netCents: 1000, vatCents: 100 });
	});

	it("rounds half-up on the net, vat is the remainder so net+vat == gross", () => {
		// 10.00 € gross @ 22% → net 8.1967 → 820 cents; vat = 1000-820 = 180
		expect(scorporo(1000, 22)).toEqual({ netCents: 820, vatCents: 180 });
		// 0.99 € gross @ 22% → net round(81.147) = 81; vat = 18
		expect(scorporo(99, 22)).toEqual({ netCents: 81, vatCents: 18 });
	});

	it("treats 0% as all-net, zero vat", () => {
		expect(scorporo(1599, 0)).toEqual({ netCents: 1599, vatCents: 0 });
	});

	it("handles a zero amount", () => {
		expect(scorporo(0, 22)).toEqual({ netCents: 0, vatCents: 0 });
	});
});

describe("buildCastelletto", () => {
	it("groups gross by rate and scorpora per rate, sorted rate-desc", () => {
		const result = buildCastelletto([
			{ grossCents: 1220, rate: 22 },
			{ grossCents: 1100, rate: 10 },
			{ grossCents: 1220, rate: 22 }, // same rate as the first → aggregated
		]);
		expect(result).toEqual([
			{ rate: 22, taxableAmount: "20.00", taxAmount: "4.40" },
			{ rate: 10, taxableAmount: "10.00", taxAmount: "1.00" },
		]);
	});

	it("scorpora on the per-rate aggregate (not per line)", () => {
		// Two 10.00 lines @ 22% aggregate to 2000 → net round(1639.34)=1639, vat=361.
		// (Per-line would give 820+820=1640/180+180=360 — the aggregate is authoritative.)
		const result = buildCastelletto([
			{ grossCents: 1000, rate: 22 },
			{ grossCents: 1000, rate: 22 },
		]);
		expect(result).toEqual([
			{ rate: 22, taxableAmount: "16.39", taxAmount: "3.61" },
		]);
	});

	it("returns an empty array for no lines", () => {
		expect(buildCastelletto([])).toEqual([]);
	});
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd apps/api && bun test tests/lib/vat.test.ts`
Expected: FAIL — `Cannot find module '@/lib/vat'`.

- [ ] **Step 3: Implement `lib/vat.ts`**

Create `apps/api/src/lib/vat.ts`:

```ts
import { fromCents } from "@/lib/money";

/**
 * Aliquote IVA italiane gestite, come stringhe percentuali. Default-first ("22").
 * Fonte di verità per l'enum colonna `products.vat_rate` /
 * `product_macro_categories.suggested_vat_rate` e per le union TypeBox.
 */
export const VAT_RATES = ["22", "10", "5", "4", "0"] as const;
export type VatRate = (typeof VAT_RATES)[number];
export const DEFAULT_VAT_RATE: VatRate = "22";

/**
 * Scorpora l'IVA da un importo LORDO in centesimi a una data aliquota intera.
 * netCents arrotondato half-up (gli importi sono non negativi → Math.round),
 * vatCents = lordo − netto così che net + vat == gross esatto.
 */
export function scorporo(
	grossCents: number,
	rate: number,
): { netCents: number; vatCents: number } {
	const netCents = Math.round((grossCents * 100) / (100 + rate));
	return { netCents, vatCents: grossCents - netCents };
}

export interface CastellettoLine {
	rate: number;
	/** Imponibile (netto) in formato decimale, es. "20.00". */
	taxableAmount: string;
	/** Imposta (IVA) in formato decimale, es. "4.40". */
	taxAmount: string;
}

/**
 * Costruisce il castelletto IVA: aggrega il lordo per aliquota, poi scorpora UNA
 * volta per aliquota sull'aggregato (regola riepilogo fattura elettronica), così
 * non accumula errori di arrotondamento riga per riga. Ordina per aliquota desc.
 */
export function buildCastelletto(
	lines: { grossCents: number; rate: number }[],
): CastellettoLine[] {
	const grossByRate = new Map<number, number>();
	for (const l of lines) {
		grossByRate.set(l.rate, (grossByRate.get(l.rate) ?? 0) + l.grossCents);
	}
	return [...grossByRate.entries()]
		.sort((a, b) => b[0] - a[0])
		.map(([rate, grossCents]) => {
			const { netCents, vatCents } = scorporo(grossCents, rate);
			return {
				rate,
				taxableAmount: fromCents(netCents),
				taxAmount: fromCents(vatCents),
			};
		});
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd apps/api && bun test tests/lib/vat.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/vat.ts apps/api/tests/lib/vat.test.ts
git commit -m "feat(api): VAT scorporo + castelletto domain helpers"
```

---

## Task 2: Database columns + migration

Add `vatRate` to products, `suggestedVatRate` to macro categories, and `vatRate`/`vatAmount`/`vatBreakdown` to orders.

**Files:**
- Modify: `apps/api/src/db/schemas/product.ts:1-78`
- Modify: `apps/api/src/db/schemas/product-macro-category.ts:1-17`
- Modify: `apps/api/src/db/schemas/order.ts:1-146`

- [ ] **Step 1: Add `vatRate` to the products table**

In `apps/api/src/db/schemas/product.ts`, add the column right after `price` (line 37) inside the `product` table columns:

```ts
		price: numeric("price", { precision: 10, scale: 2 }).notNull(),
		vatRate: text("vat_rate", { enum: ["22", "10", "5", "4", "0"] })
			.default("22")
			.notNull(),
```

And add a CHECK in the table-extras array (after the existing `product_price_non_negative` check on line 58):

```ts
		check("product_price_non_negative", sql`${table.price} >= 0`),
		check(
			"product_vat_rate_valid",
			sql`${table.vatRate} IN ('22','10','5','4','0')`,
		),
```

(`text`, `check`, and `sql` are already imported in this file.)

- [ ] **Step 2: Add `suggestedVatRate` to the macro-category table**

Replace the whole `productMacroCategory` definition in `apps/api/src/db/schemas/product-macro-category.ts` (currently lines 5-17) with:

```ts
import { relations, sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { productCategory } from "./category";

export const productMacroCategory = pgTable(
	"product_macro_categories",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: text("name").notNull().unique(),
		suggestedVatRate: text("suggested_vat_rate", {
			enum: ["22", "10", "5", "4", "0"],
		})
			.default("22")
			.notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		check(
			"product_macro_suggested_vat_rate_valid",
			sql`${table.suggestedVatRate} IN ('22','10','5','4','0')`,
		),
	],
);
```

(This adds the `sql` + `check` imports and converts the table to the table-extras form.)

- [ ] **Step 3: Add VAT columns to orders + order_items**

In `apps/api/src/db/schemas/order.ts`:

Add `jsonb` to the pg-core import (line 2-12 block):

```ts
import {
	check,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from "drizzle-orm/pg-core";
```

Add `vatBreakdown` to the `order` table, right after `shippingCost` (line 57):

```ts
		shippingCost: numeric("shipping_cost", { precision: 10, scale: 2 }),
		vatBreakdown:
			jsonb("vat_breakdown").$type<
				Array<{ rate: number; taxableAmount: string; taxAmount: string }>
			>(),
```

Add `vatRate` + `vatAmount` to `orderItem`, right after `unitPrice` (line 137):

```ts
		quantity: integer("quantity").notNull(),
		unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),

		// === snapshot fiscale IVA (NUOVO) — nullable: ordini storici restano NULL ===
		vatRate: numeric("vat_rate", { precision: 5, scale: 2 }),
		vatAmount: numeric("vat_amount", { precision: 10, scale: 2 }),
```

Add the non-negative CHECK for `vatAmount` in the order_items table-extras (after the `order_item_unit_price_non_negative` check on line 144):

```ts
		check("order_item_unit_price_non_negative", sql`${table.unitPrice} >= 0`),
		check(
			"order_item_vat_amount_non_negative",
			sql`${table.vatAmount} IS NULL OR ${table.vatAmount} >= 0`,
		),
```

- [ ] **Step 4: Generate the migration**

Run: `bun run db:generate`
Expected: a new SQL file under `apps/api/drizzle/` (or the repo's migrations dir). 

- [ ] **Step 5: Read the generated SQL**

Open the newly generated `.sql` file and confirm it contains, with no destructive statements:
- `ALTER TABLE "products" ADD COLUMN "vat_rate" text DEFAULT '22' NOT NULL;`
- a CHECK `product_vat_rate_valid`
- `ALTER TABLE "product_macro_categories" ADD COLUMN "suggested_vat_rate" text DEFAULT '22' NOT NULL;` + its CHECK
- `ALTER TABLE "orders" ADD COLUMN "vat_breakdown" jsonb;`
- `ALTER TABLE "order_items" ADD COLUMN "vat_rate" numeric(5, 2);` and `"vat_amount" numeric(10, 2);` + the vat_amount CHECK

Existing rows: `products`/`product_macro_categories` backfill to `'22'` via the NOT NULL default (safe); order columns are nullable (historical orders stay NULL — intended).

- [ ] **Step 6: Apply the migration + typecheck**

Run: `bun run db:migrate`
Then: `bun run typecheck`
Expected: migration applies; typecheck passes (no schema type errors yet — the new columns are not consumed anywhere).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/schemas/product.ts apps/api/src/db/schemas/product-macro-category.ts apps/api/src/db/schemas/order.ts apps/api/drizzle
git commit -m "feat(api): add vat_rate/suggested_vat_rate/vat snapshot columns"
```

---

## Task 3: TypeBox schemas (response entities + request bodies)

Expose the new fields in the API contract (this propagates to all three Eden clients).

**Files:**
- Modify: `apps/api/src/lib/schemas/forms/products.ts:1-51`
- Modify: `apps/api/src/lib/schemas/entities.ts` (ProductMacroCategorySchema L96-101, ProductSchema L265-283, OrderSchema L411-452, OrderItemSchema L454-487)

- [ ] **Step 1: Add the shared `VatRateSchema` + product create body field**

In `apps/api/src/lib/schemas/forms/products.ts`, add the exported union at the top (after the import) and the `vatRate` field inside `CreateProductBody` (after `price`, line 20):

```ts
import { Type } from "@sinclair/typebox";

// Aliquote IVA accettate (vedi VAT_RATES in @/lib/vat). Stringhe percentuali.
export const VatRateSchema = Type.Union(
	[
		Type.Literal("22"),
		Type.Literal("10"),
		Type.Literal("5"),
		Type.Literal("4"),
		Type.Literal("0"),
	],
	{ description: "Aliquota IVA (%): 22, 10, 5, 4 o 0", default: "22" },
);

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
	vatRate: Type.Optional(VatRateSchema),
```

(Leave the rest of `CreateProductBody` — categoryIds, ean, brandId, brandName, storeId — unchanged.)

- [ ] **Step 2: Add `vatRate` to `ProductSchema` and `suggestedVatRate` to `ProductMacroCategorySchema`**

In `apps/api/src/lib/schemas/entities.ts`:

`ProductMacroCategorySchema` (lines 96-101) → add `suggestedVatRate`:

```ts
export const ProductMacroCategorySchema = t.Object({
	id: t.String(),
	name: t.String({ description: "Nome della macro categoria prodotto" }),
	suggestedVatRate: t.String({
		description: "Aliquota IVA suggerita (%) per i prodotti di questa macro",
	}),
	createdAt: t.Date(),
	updatedAt: t.Date(),
});
```

`ProductSchema` (lines 265-283) → add `vatRate` right after `price` (line 270):

```ts
	price: t.String({ description: "Prezzo in formato decimale (es. '9.99')" }),
	vatRate: t.String({
		description: "Aliquota IVA del prodotto (%): 22, 10, 5, 4 o 0",
	}),
```

- [ ] **Step 3: Add the VAT fields to `OrderItemSchema` and `OrderSchema`**

`OrderItemSchema` (lines 454-487) → add after `unitPrice` (line 484-486):

```ts
	unitPrice: t.String({
		description: "Prezzo unitario al momento dell'ordine",
	}),
	vatRate: t.Nullable(
		t.String({
			description: "Snapshot aliquota IVA applicata (%). NULL per ordini storici",
		}),
	),
	vatAmount: t.Nullable(
		t.String({
			description: "IVA della riga (display). NULL per ordini storici",
		}),
	),
```

`OrderSchema` (lines 411-452) → add `vatBreakdown` after `shippingCost` (lines 439-441):

```ts
	shippingCost: t.Nullable(
		t.String({ description: "Costo di spedizione in formato decimale" }),
	),
	vatBreakdown: t.Nullable(
		t.Array(
			t.Object({
				rate: t.Number({ description: "Aliquota IVA (%)" }),
				taxableAmount: t.String({ description: "Imponibile (netto)" }),
				taxAmount: t.String({ description: "Imposta (IVA)" }),
			}),
			{ description: "Castelletto IVA per aliquota. NULL per ordini storici" },
		),
	),
```

- [ ] **Step 4: Add `vatRate` to the product update body**

In `apps/api/src/modules/seller/routes/products.ts`, import `VatRateSchema` and add the field to the PATCH body. Update the import block (line 24):

```ts
import { CreateProductBody, VatRateSchema } from "@/lib/schemas/forms";
```

Then in the PATCH `/products/:productId` body (after `price`, lines 390-395):

```ts
				price: t.Optional(
					t.String({
						pattern: "^\\d+\\.\\d{2}$",
						description: "Prezzo (formato decimale, es. '9.99')",
					}),
				),
				vatRate: t.Optional(VatRateSchema),
```

> Note: `VatRateSchema` is a plain TypeBox schema, interoperable with Elysia's `t`. If the barrel `@/lib/schemas/forms` does not already re-export from `forms/products.ts`, add `export * from "./products";` to `apps/api/src/lib/schemas/forms/index.ts` (verify before editing).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS. Service layer will now have a type gap only if it reads these fields — it doesn't yet, so this should be green. If `createProduct`/`createOrder` typecheck-fail because the inserted object now requires `vatRate`, that is fixed in Tasks 4–5; if it fails here, proceed to Task 4 before re-running.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/schemas
git add apps/api/src/modules/seller/routes/products.ts
git commit -m "feat(api): expose vatRate/suggestedVatRate/vatBreakdown in API contract"
```

---

## Task 4: Product create/update services accept `vatRate`

The macro-suggested default is applied **client-side** (Task 8); the server just persists the rate and falls back to the DB default when omitted.

**Files:**
- Modify: `apps/api/src/modules/seller/services/products.ts` (CreateProductParams L511-521, UpdateProductParams L602-614)

- [ ] **Step 1: Add `vatRate` to `CreateProductParams`**

In `apps/api/src/modules/seller/services/products.ts`, import the type and extend the interface. Update the `@/db/schemas/product` import (lines 6-11) is unchanged; add a vat import near the top imports:

```ts
import type { VatRate } from "@/lib/vat";
```

Then `CreateProductParams` (lines 511-521):

```ts
interface CreateProductParams {
	sellerProfileId: string;
	storeId: string;
	name: string;
	description?: string;
	price: string;
	vatRate?: VatRate;
	categoryIds?: string[];
	ean?: string;
	brandId?: string;
	brandName?: string;
}
```

No body change is needed: `vatRate` stays inside `...productData` and is inserted via `tx.insert(product).values({ sellerProfileId, ...productData, ... })`; when omitted, the DB default `'22'` applies.

- [ ] **Step 2: Add `vatRate` to `UpdateProductParams`**

`UpdateProductParams` (lines 602-614):

```ts
interface UpdateProductParams {
	productId: string;
	sellerProfileId: string;
	accessibleStoreIds: string[];
	categoryIds?: string[];
	imageOrder?: string[];
	name?: string;
	description?: string;
	price?: string;
	vatRate?: VatRate;
	ean?: string | null;
	brandId?: string | null;
	brandName?: string;
}
```

`vatRate` is not destructured out, so it remains in `...productData` and is applied by the existing `tx.update(product).set(productUpdates)` path.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/seller/services/products.ts
git commit -m "feat(api): persist product vatRate on create/update"
```

---

## Task 5: Order VAT snapshot + castelletto (TDD)

Snapshot `vatRate` + per-line `vatAmount` onto order_items and store the per-rate castelletto on the order. Computed on **gross line totals before points discount**.

**Files:**
- Modify: `apps/api/src/modules/customer/services/orders.ts` (imports L11, createOrder L210-322)
- Create: `apps/api/tests/integration/customer-orders-vat.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/integration/customer-orders-vat.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
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
import { order, orderItem } from "@/db/schemas/order";
import { product as productTable } from "@/db/schemas/product";
import { createOrder } from "@/modules/customer/services/orders";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCustomer,
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

describe("createOrder — VAT snapshot + castelletto", () => {
	it("snapshots per-line vatRate/vatAmount and builds the order castelletto", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);

		// Product A: 12.20 € @ 22% → net 10.00, vat 2.20
		const prodA = await createTestProduct(db, seller.profile.id, {
			price: "12.20",
		});
		await db
			.update(productTable)
			.set({ vatRate: "22" })
			.where(eq(productTable.id, prodA.id));
		// Product B: 11.00 € @ 10% → net 10.00, vat 1.00
		const prodB = await createTestProduct(db, seller.profile.id, {
			price: "11.00",
		});
		await db
			.update(productTable)
			.set({ vatRate: "10" })
			.where(eq(productTable.id, prodB.id));

		const spA = await createTestStoreProduct(db, store.id, prodA.id, { stock: 5 });
		const spB = await createTestStoreProduct(db, store.id, prodB.id, { stock: 5 });
		const customer = await createTestCustomer(db);

		const newOrder = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: store.id,
			items: [
				{ storeProductId: spA.id, quantity: 1 },
				{ storeProductId: spB.id, quantity: 1 },
			],
		});

		// order.total unchanged: gross sum 12.20 + 11.00
		expect(newOrder.total).toBe("23.20");

		// castelletto: per-rate, sorted rate-desc
		expect(newOrder.vatBreakdown).toEqual([
			{ rate: 22, taxableAmount: "10.00", taxAmount: "2.20" },
			{ rate: 10, taxableAmount: "10.00", taxAmount: "1.00" },
		]);

		const items = await db.query.orderItem.findMany({
			where: eq(orderItem.orderId, newOrder.id),
		});
		const byProduct = new Map(items.map((i) => [i.productId, i]));
		expect(Number(byProduct.get(prodA.id)?.vatRate)).toBe(22);
		expect(byProduct.get(prodA.id)?.vatAmount).toBe("2.20");
		expect(Number(byProduct.get(prodB.id)?.vatRate)).toBe(10);
		expect(byProduct.get(prodB.id)?.vatAmount).toBe("1.00");
	});
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd apps/api && bun test tests/integration/customer-orders-vat.test.ts`
Expected: FAIL — `newOrder.vatBreakdown` is `null`/`undefined` and order_items have no `vatRate`/`vatAmount`.

- [ ] **Step 3: Wire the VAT math into `createOrder`**

In `apps/api/src/modules/customer/services/orders.ts`:

Extend the money import (line 11) to also import the VAT helpers:

```ts
import { fromCents, toCents } from "@/lib/money";
import { buildCastelletto, scorporo } from "@/lib/vat";
```

Add `vatRate` + `vatAmount` to the `resolvedItems` type (lines 215-224):

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
			vatRate: string;
			vatAmount: string;
		}[] = [];
```

In the resolve loop, replace the `totalCents += ...` + `resolvedItems.push(...)` block (lines 256-266) with:

```ts
			const lineGrossCents = toCents(sp.product.price) * item.quantity;
			totalCents += lineGrossCents;
			const { vatCents } = scorporo(lineGrossCents, Number(sp.product.vatRate));
			resolvedItems.push({
				storeProductId: sp.id,
				productId: sp.product.id,
				productName: sp.product.name,
				productEan: sp.product.ean ?? null,
				brandName: sp.product.brand?.name ?? null,
				productImageUrl: sp.product.images[0]?.url ?? null,
				quantity: item.quantity,
				unitPrice: sp.product.price,
				vatRate: sp.product.vatRate,
				vatAmount: fromCents(vatCents),
			});
```

Build the castelletto right after the loop closes (after line 267, before the points-discount block on line 269):

```ts
		// Castelletto IVA: scorporo per-aliquota sui lordi di riga (PRIMA dello
		// sconto punti — l'apportionment dello sconto punti tra aliquote è demandato
		// al futuro layer di fatturazione).
		const vatBreakdown = buildCastelletto(
			resolvedItems.map((it) => ({
				grossCents: toCents(it.unitPrice) * it.quantity,
				rate: Number(it.vatRate),
			})),
		);
```

Add `vatBreakdown` to the order insert values (after `idempotencyKey`, line 305):

```ts
				pointsSpent: actualPointsSpent,
				idempotencyKey: idempotencyKey ?? null,
				vatBreakdown,
```

Add `vatRate` + `vatAmount` to the order_items insert mapping (after `unitPrice`, line 320):

```ts
				quantity: item.quantity,
				unitPrice: item.unitPrice,
				vatRate: item.vatRate,
				vatAmount: item.vatAmount,
```

- [ ] **Step 4: Run the new test + the existing order tests, verify green**

Run: `cd apps/api && bun test tests/integration/customer-orders-vat.test.ts tests/integration/customer-orders.test.ts`
Expected: PASS (new VAT test green; existing order tests still green — `vatBreakdown` is additive and `total` is unchanged).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/customer/services/orders.ts apps/api/tests/integration/customer-orders-vat.test.ts
git commit -m "feat(api): snapshot VAT rate + amount and castelletto on orders"
```

---

## Task 6: Admin macro `suggestedVatRate` (service + routes + seed)

**Files:**
- Modify: `apps/api/src/modules/admin/services/product-macro-categories.ts` (create L43-50, update L52-70)
- Modify: `apps/api/src/modules/admin/routes/product-macro-categories.ts` (create body L38-44 + handler L23, patch body L82-88 + handler L59-62)
- Modify: `apps/api/src/db/seed/base/categories.ts` (seedProductCategories L33-49)

- [ ] **Step 1: Update the macro-category service to accept `suggestedVatRate`**

In `apps/api/src/modules/admin/services/product-macro-categories.ts`, add the vat type import and rework create/update:

```ts
import type { VatRate } from "@/lib/vat";
```

Replace `createProductMacroCategory` (lines 43-50):

```ts
export async function createProductMacroCategory(params: {
	name: string;
	suggestedVatRate?: VatRate;
}) {
	const [created] = await db
		.insert(productMacroCategory)
		.values({
			name: params.name,
			...(params.suggestedVatRate
				? { suggestedVatRate: params.suggestedVatRate }
				: {}),
		})
		.returning();

	return created;
}
```

Replace `UpdateProductMacroCategoryParams` + `updateProductMacroCategory` (lines 52-70):

```ts
interface UpdateProductMacroCategoryParams {
	macroCategoryId: string;
	name: string;
	suggestedVatRate?: VatRate;
}

export async function updateProductMacroCategory(
	params: UpdateProductMacroCategoryParams,
) {
	const { macroCategoryId, name, suggestedVatRate } = params;

	const [updated] = await db
		.update(productMacroCategory)
		.set({
			name,
			...(suggestedVatRate ? { suggestedVatRate } : {}),
		})
		.where(eq(productMacroCategory.id, macroCategoryId))
		.returning();

	if (!updated) throw new ServiceError(404, "Product macro category not found");
	return updated;
}
```

- [ ] **Step 2: Update the admin routes (bodies + handlers)**

In `apps/api/src/modules/admin/routes/product-macro-categories.ts`:

Import `VatRateSchema` (extend the `@/lib/schemas` import block lines 4-9 — `VatRateSchema` lives in `forms/products.ts`; import it from `@/lib/schemas/forms`):

```ts
import { VatRateSchema } from "@/lib/schemas/forms";
```

POST handler (line 23) — pass both fields:

```ts
			const data = await createProductMacroCategory({
				name: body.name,
				suggestedVatRate: body.suggestedVatRate,
			});
```

POST body (lines 38-44) — add the field:

```ts
			body: t.Object({
				name: t.String({
					minLength: 1,
					maxLength: 100,
					description: "Nome della macro categoria",
				}),
				suggestedVatRate: t.Optional(VatRateSchema),
			}),
```

PATCH handler (lines 59-62) — pass `suggestedVatRate`:

```ts
			const data = await updateProductMacroCategory({
				macroCategoryId: params.macroCategoryId,
				name: body.name,
				suggestedVatRate: body.suggestedVatRate,
			});
```

PATCH body (lines 82-88) — add the field:

```ts
			body: t.Object({
				name: t.String({
					minLength: 1,
					maxLength: 100,
					description: "Nuovo nome della macro categoria",
				}),
				suggestedVatRate: t.Optional(VatRateSchema),
			}),
```

- [ ] **Step 3: Seed sensible defaults for the two deviating macros**

In `apps/api/src/db/seed/base/categories.ts`, add `eq` to the drizzle-orm import (line 3) and set the special rates right after a fresh import inside `seedProductCategories` (after line 48, before the function ends):

```ts
import { count, eq } from "drizzle-orm";
```

```ts
	console.log("  🏷️ Seeding product categories from CSV...");
	const csv = readFileSync(PRODUCT_CATEGORIES_CSV, "utf8");
	const result = await importProductCategoriesFromCsv(csv);
	console.log(
		`     ✓ ${result.created} product categories (skipped: ${result.skipped}, failed: ${result.failed})`,
	);

	// Aliquote IVA suggerite: la maggior parte resta al default 22%; solo i macro
	// merceologici tipicamente ad aliquota ridotta vengono impostati qui.
	const VAT_BY_MACRO: Record<string, "10" | "4"> = {
		"Alimentari e bevande": "10",
		"Libri e media": "4",
	};
	for (const [name, rate] of Object.entries(VAT_BY_MACRO)) {
		await db
			.update(productMacroCategory)
			.set({ suggestedVatRate: rate })
			.where(eq(productMacroCategory.name, name));
	}
```

- [ ] **Step 4: Typecheck + run the admin macro test if present**

Run: `bun run typecheck`
Then (smoke the seed compiles, optional): `cd apps/api && bun test tests/integration/admin-category-import.test.ts`
Expected: typecheck PASS; category-import test still green (the seed change is additive).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin/services/product-macro-categories.ts apps/api/src/modules/admin/routes/product-macro-categories.ts apps/api/src/db/seed/base/categories.ts
git commit -m "feat(api): admin suggestedVatRate on macro categories + seed defaults"
```

---

## Task 7: Seller product table — price (lordo + netto) + IVA column

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/products/index.tsx` (imports L14, price column L359-372, add IVA column)

- [ ] **Step 1: Import the EUR formatter helper**

In `apps/seller/src/routes/_authenticated/products/index.tsx`, extend the price import (line 14):

```ts
import { formatPriceEur, Price } from "@bibs/ui/components/price";
```

- [ ] **Step 2: Show net under gross in the price cell**

Replace the `price` column cell (lines 360-372) with a two-line cell (gross prominent, net muted):

```ts
			{
				id: "price",
				accessorKey: "price",
				header: ({ column }) => (
					<SortableHeader column={column}>Prezzo</SortableHeader>
				),
				enableSorting: true,
				meta: {
					headerClassName: "w-[15%]",
					cellClassName: "text-sm",
					menuLabel: "Prezzo",
				},
				cell: ({ row }) => {
					const gross = Number.parseFloat(row.original.price);
					const rate = Number(row.original.vatRate);
					const net = Number.isFinite(gross) ? gross / (1 + rate / 100) : NaN;
					return (
						<div className="flex flex-col leading-tight">
							<Price value={row.original.price} />
							<span className="text-muted-foreground text-xs tabular-nums">
								netto {formatPriceEur(net)}
							</span>
						</div>
					);
				},
			},
```

- [ ] **Step 3: Add the IVA column (amount + rate badge)**

Insert a new column object immediately after the `price` column and before the `stock` column:

```ts
			{
				id: "vat",
				header: "IVA",
				meta: {
					headerClassName: "w-[12%]",
					cellClassName: "text-sm",
					menuLabel: "IVA",
				},
				cell: ({ row }) => {
					const gross = Number.parseFloat(row.original.price);
					const rate = Number(row.original.vatRate);
					const vat = Number.isFinite(gross)
						? gross - gross / (1 + rate / 100)
						: NaN;
					return (
						<div className="flex items-center gap-1.5 tabular-nums">
							<span>{formatPriceEur(vat)}</span>
							<Badge variant="secondary">{rate}%</Badge>
						</div>
					);
				},
			},
```

(`Badge` is already imported at line 1.)

- [ ] **Step 4: Default-hide the IVA column (optional, keeps the table calm)**

Extend `INITIAL_COLUMN_VISIBILITY` (lines 112-115) so sellers opt in via the columns menu:

```ts
const INITIAL_COLUMN_VISIBILITY = {
	brand: false,
	ean: false,
	vat: false,
};
```

- [ ] **Step 5: Verify in the browser**

Run: `bun run dev:seller` (port 3002). Open Prodotti, confirm the price cell shows `netto …` under the gross, and enable the **IVA** column from the columns toggle (top-right of the table) — it shows e.g. `2,20 € · 22%`.
Then: `bun run typecheck && bun run lint`
Expected: both PASS; UI renders as described.

- [ ] **Step 6: Commit**

```bash
git add apps/seller/src/routes/_authenticated/products/index.tsx
git commit -m "feat(seller): show net price + IVA column in product table"
```

---

## Task 8: Seller product form — VAT select + live scorporo + macro prefill

**Files:**
- Modify: `apps/seller/src/features/products/components/product-categories-picker.tsx` (onMacroChange signature L31, L83)
- Modify: `apps/seller/src/features/products/components/product-form.tsx` (imports, defaultValues, onMacroChange, VAT field + preview)
- Modify: `apps/seller/src/routes/_authenticated/products/new.tsx` (POST body L34-43)
- Modify: `apps/seller/src/routes/_authenticated/products/$productId.tsx` (PATCH body L83-94, defaultValues L159-170)

- [ ] **Step 1: Make the picker emit the macro's suggested rate on change**

In `apps/seller/src/features/products/components/product-categories-picker.tsx`, widen the callback type (line 31):

```ts
	onMacroChange: (macroId: string | null, suggestedVatRate?: string) => void;
```

And pass the selected macro's `suggestedVatRate` from the Select handler (lines 81-84):

```ts
				<Select
					value={macroCategoryId ?? ""}
					onValueChange={(v) =>
						onMacroChange(
							v || null,
							macros.find((m) => m.id === v)?.suggestedVatRate,
						)
					}
				>
```

(`macros` already carries `suggestedVatRate` once Task 3 ships — the query hits `/product-macro-categories`, typed by `ProductMacroCategorySchema`.)

- [ ] **Step 2: Add the VAT select + scorporo preview to the form**

In `apps/seller/src/features/products/components/product-form.tsx`:

Extend the imports — add `Controller`, the shadcn `Select` family, and `formatPriceEur`:

```ts
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@bibs/ui/components/select";
import { formatPriceEur } from "@bibs/ui/components/price";
```
```ts
import { type SubmitHandler, Controller, useForm } from "react-hook-form";
```

Add `vatRate` to `ProductFormDefaultValues` (lines 45-54):

```ts
export interface ProductFormDefaultValues {
	name: string;
	description?: string | null;
	price: string;
	vatRate?: string;
	categoryIds: string[];
	ean?: string | null;
	brandId?: string | null;
	brandName?: string | null;
	macroCategoryId?: string | null;
}
```

Add `control` to the `useForm` destructure (lines 83-101) and a `vatRate` default:

```ts
	const {
		register,
		handleSubmit,
		setValue,
		watch,
		getValues,
		control,
		formState: { errors, isDirty },
	} = useForm<ProductFormData>({
		resolver: typeboxResolver(compiledSchema),
		defaultValues: {
			name: defaultValues?.name ?? "",
			description: defaultValues?.description ?? "",
			price: defaultValues?.price ?? "",
			vatRate: (defaultValues?.vatRate as ProductFormData["vatRate"]) ?? "22",
			categoryIds: defaultValues?.categoryIds ?? [],
			ean: defaultValues?.ean ?? undefined,
			brandId: defaultValues?.brandId ?? undefined,
			brandName: defaultValues?.brandName ?? undefined,
		},
	});
```

Prefill the rate when the macro changes — update `onMacroChange` (lines 202-209):

```ts
	const onMacroChange = (next: string | null, suggestedVatRate?: string) => {
		const hadCategories = selectedCategories.length > 0;
		setMacroCategoryId(next);
		setValue("categoryIds", [], { shouldValidate: true, shouldDirty: true });
		if (suggestedVatRate) {
			setValue("vatRate", suggestedVatRate as ProductFormData["vatRate"], {
				shouldDirty: true,
			});
		}
		if (hadCategories && next !== macroCategoryId) {
			toast.info("Categorie resettate per via del cambio di macrocategoria");
		}
	};
```

Replace the price `Field` (lines 304-317) with price + a VAT select beside it + a live scorporo preview spanning both:

```ts
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

				<Field>
					<FieldLabel htmlFor="product-vat-rate">Aliquota IVA</FieldLabel>
					<Controller
						control={control}
						name="vatRate"
						render={({ field }) => (
							<Select value={field.value} onValueChange={field.onChange}>
								<SelectTrigger id="product-vat-rate" className="w-full">
									<SelectValue placeholder="22%" />
								</SelectTrigger>
								<SelectContent>
									{["22", "10", "5", "4", "0"].map((r) => (
										<SelectItem key={r} value={r}>
											{r}%
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
					/>
				</Field>

				{(() => {
					const gross = Number.parseFloat(watch("price"));
					const rate = Number(watch("vatRate"));
					if (!Number.isFinite(gross)) return null;
					const net = gross / (1 + rate / 100);
					const vat = gross - net;
					return (
						<p className="text-muted-foreground text-xs sm:col-span-2">
							Imponibile {formatPriceEur(net)} · IVA {formatPriceEur(vat)} (
							{rate}%) — il prezzo è IVA inclusa.
						</p>
					);
				})()}
```

> The preview rounding is indicative; the order/snapshot uses the server's authoritative `scorporo`.

- [ ] **Step 3: Send `vatRate` from the create route**

In `apps/seller/src/routes/_authenticated/products/new.tsx`, add `vatRate` to the POST body (lines 34-43):

```ts
				const response = await api().seller.products.post({
					name: formData.name,
					description: formData.description,
					price: formData.price,
					vatRate: formData.vatRate,
					categoryIds: formData.categoryIds,
					ean: formData.ean,
					brandId: formData.brandId,
					brandName: formData.brandName,
					storeId,
				});
```

- [ ] **Step 4: Send `vatRate` from the edit route + load it into defaults**

In `apps/seller/src/routes/_authenticated/products/$productId.tsx`:

PATCH body (lines 84-94) — add `vatRate`:

```ts
				.patch({
					name: formData.name,
					description: formData.description,
					price: formData.price,
					vatRate: formData.vatRate,
					categoryIds: formData.categoryIds,
					imageOrder: formData.imageOrder,
					ean: formData.ean ?? null,
					brandId: formData.brandId ?? null,
					brandName: formData.brandName,
				});
```

`defaultValues` (lines 159-170) — pass the product's current rate:

```ts
				defaultValues={{
					name: product.name,
					description: product.description,
					price: product.price,
					vatRate: product.vatRate,
					categoryIds: product.productCategoryAssignments.map(
						(a) => a.productCategoryId,
					),
					ean: product.ean,
					brandId: product.brand?.id,
					brandName: product.brand?.name,
					macroCategoryId,
				}}
```

- [ ] **Step 5: Verify in the browser**

Run: `bun run dev:seller`. Create a new product: the Aliquota IVA select defaults to 22%; selecting a macro-category like "Alimentari e bevande" flips it to 10%; the preview line updates live as you type the price. Save, reopen in edit — the rate persists. Switch a product to 4%, confirm the table's IVA column reflects it.
Then: `bun run typecheck && bun run lint`
Expected: PASS; behavior as described.

- [ ] **Step 6: Commit**

```bash
git add apps/seller/src/features/products/components/product-categories-picker.tsx apps/seller/src/features/products/components/product-form.tsx apps/seller/src/routes/_authenticated/products/new.tsx apps/seller/src/routes/_authenticated/products/\$productId.tsx
git commit -m "feat(seller): VAT rate select + live scorporo + macro-suggested default"
```

---

## Task 9: Admin macro form — suggested VAT rate field

**Files:**
- Modify: `apps/admin/src/features/product-macro-categories/schemas/product-macro-category.ts:1-9`
- Modify: `apps/admin/src/features/product-macro-categories/components/product-macro-category-form.tsx`
- Modify: `apps/admin/src/features/product-macro-categories/components/product-macro-categories-panel.tsx` (interface L34-39, mutations L136-181, dialogs L376-414, optional column)

- [ ] **Step 1: Add `suggestedVatRate` to the zod form schema**

Replace `apps/admin/src/features/product-macro-categories/schemas/product-macro-category.ts`:

```ts
import { z } from "zod";

export const productMacroCategoryFormSchema = z.object({
	name: z.string().min(1, "Il nome è obbligatorio"),
	suggestedVatRate: z.enum(["22", "10", "5", "4", "0"]),
});

export type ProductMacroCategoryFormData = z.infer<
	typeof productMacroCategoryFormSchema
>;
```

- [ ] **Step 2: Add the rate Select to the admin form**

Replace `apps/admin/src/features/product-macro-categories/components/product-macro-category-form.tsx`:

```tsx
import { Button } from "@bibs/ui/components/button";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@bibs/ui/components/select";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { Controller, type SubmitHandler, useForm } from "react-hook-form";
import {
	type ProductMacroCategoryFormData,
	productMacroCategoryFormSchema,
} from "@/features/product-macro-categories/schemas/product-macro-category";

interface ProductMacroCategoryFormProps {
	defaultValues?: ProductMacroCategoryFormData;
	onSubmit: (data: ProductMacroCategoryFormData) => void;
	onCancel: () => void;
	isPending: boolean;
	submitLabel: string;
	pendingLabel: string;
}

export function ProductMacroCategoryForm({
	defaultValues,
	onSubmit,
	onCancel,
	isPending,
	submitLabel,
	pendingLabel,
}: ProductMacroCategoryFormProps) {
	const {
		register,
		handleSubmit,
		control,
		reset,
		formState: { errors },
	} = useForm<ProductMacroCategoryFormData>({
		resolver: zodResolver(productMacroCategoryFormSchema),
		defaultValues: defaultValues ?? { name: "", suggestedVatRate: "22" },
	});

	useEffect(() => {
		if (defaultValues) {
			reset(defaultValues);
		}
	}, [defaultValues, reset]);

	const onFormSubmit: SubmitHandler<ProductMacroCategoryFormData> = (data) => {
		onSubmit(data);
	};

	return (
		<form onSubmit={handleSubmit(onFormSubmit)}>
			<div className="space-y-4 py-4">
				<Field data-invalid={!!errors.name}>
					<FieldLabel htmlFor="product-macro-category-name">Nome</FieldLabel>
					<Input
						id="product-macro-category-name"
						placeholder="Es. Elettronica"
						autoFocus
						{...register("name")}
					/>
					<FieldError errors={[errors.name]} />
				</Field>

				<Field>
					<FieldLabel htmlFor="product-macro-category-vat">
						Aliquota IVA suggerita
					</FieldLabel>
					<Controller
						control={control}
						name="suggestedVatRate"
						render={({ field }) => (
							<Select value={field.value} onValueChange={field.onChange}>
								<SelectTrigger id="product-macro-category-vat" className="w-full">
									<SelectValue placeholder="22%" />
								</SelectTrigger>
								<SelectContent>
									{["22", "10", "5", "4", "0"].map((r) => (
										<SelectItem key={r} value={r}>
											{r}%
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
					/>
					<p className="text-muted-foreground text-xs">
						Pre-compila l'aliquota dei nuovi prodotti di questa macro. Il
						venditore può sempre modificarla.
					</p>
				</Field>
			</div>

			<div className="flex justify-end gap-3">
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

- [ ] **Step 3: Wire the panel mutations + dialogs to pass the rate**

In `apps/admin/src/features/product-macro-categories/components/product-macro-categories-panel.tsx`:

Extend the local `ProductMacroCategory` interface (lines 34-39):

```ts
interface ProductMacroCategory {
	id: string;
	name: string;
	suggestedVatRate: string;
	createdAt: Date | string;
	updatedAt: Date | string;
}
```

Replace `createMutation` (lines 136-157) so it sends both fields:

```ts
	const createMutation = useMutation({
		mutationFn: async (input: { name: string; suggestedVatRate: string }) => {
			const response = await api().admin["product-macro-categories"].post({
				name: input.name,
				suggestedVatRate: input.suggestedVatRate as "22" | "10" | "5" | "4" | "0",
			});
			if (response.error) {
				throw new Error(
					response.error.value?.message ||
						"Failed to create product macro category",
				);
			}
			return response.data;
		},
		onSuccess: () => {
			invalidateAll();
			onCreateOpenChange(false);
			toast.success("Macro categoria prodotto creata con successo");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante la creazione");
		},
	});
```

Replace `updateMutation` (lines 159-181):

```ts
	const updateMutation = useMutation({
		mutationFn: async (input: {
			id: string;
			name: string;
			suggestedVatRate: string;
		}) => {
			const response = await api()
				.admin["product-macro-categories"]({ macroCategoryId: input.id })
				.patch({
					name: input.name,
					suggestedVatRate: input.suggestedVatRate as
						| "22"
						| "10"
						| "5"
						| "4"
						| "0",
				});
			if (response.error) {
				throw new Error(
					response.error.value?.message ||
						"Failed to update product macro category",
				);
			}
			return response.data;
		},
		onSuccess: () => {
			invalidateAll();
			setEditOpen(false);
			setSelectedMacro(null);
			toast.success("Macro categoria prodotto aggiornata con successo");
		},
		onError: (error: Error) => {
			toast.error(error.message || "Errore durante l'aggiornamento");
		},
	});
```

Update the **create** dialog's `onSubmit` (line 377):

```ts
						onSubmit={(data) => createMutation.mutate(data)}
```

Update the **edit** dialog's `defaultValues` + `onSubmit` (lines 394-405):

```ts
					<ProductMacroCategoryForm
						defaultValues={
							selectedMacro
								? {
										name: selectedMacro.name,
										suggestedVatRate: selectedMacro.suggestedVatRate as
											| "22"
											| "10"
											| "5"
											| "4"
											| "0",
									}
								: undefined
						}
						onSubmit={(data) => {
							if (selectedMacro) {
								updateMutation.mutate({
									id: selectedMacro.id,
									name: data.name,
									suggestedVatRate: data.suggestedVatRate,
								});
							}
						}}
```

(Leave the rest of the edit dialog props — onCancel, isPending, labels — unchanged.)

- [ ] **Step 4: Add an "IVA suggerita" column to the admin table (visibility)**

Insert a column object between the `name` and `createdAt` columns (after line 237):

```ts
			{
				id: "suggestedVatRate",
				meta: {
					menuLabel: "IVA suggerita",
					headerClassName: "w-[20%]",
					cellClassName: "text-sm tabular-nums",
				},
				header: () => "IVA suggerita",
				cell: ({ row }) => `${row.original.suggestedVatRate}%`,
			},
```

- [ ] **Step 5: Verify in the browser**

Run: `bun run dev:admin` (port 3003). Open Configurazioni → macro categorie: the table shows an "IVA suggerita" column; create/edit a macro and set the rate; reopen edit and confirm it persists. Then create a product in the seller app under that macro and confirm the rate prefills.
Then: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/features/product-macro-categories
git commit -m "feat(admin): suggested VAT rate field on macro categories"
```

---

## Task 10: Full verification + deferred note

- [ ] **Step 1: Full typecheck + lint across the monorepo**

Run from repo root: `bun run typecheck && bun run lint`
Expected: both PASS (Eden types resolve in all three frontends).

- [ ] **Step 2: Full API test suite**

Run: `cd apps/api && bun test`
Expected: PASS, including `tests/lib/vat.test.ts`, `tests/integration/customer-orders-vat.test.ts`, and all pre-existing order/product/category tests. Confirm exit code 0 explicitly.

- [ ] **Step 3: Browser smoke (the three surfaces touched)**

- Seller Prodotti table: gross + `netto …` + (toggleable) IVA column.
- Seller product form: VAT select + live scorporo preview + macro-suggested prefill; persists on edit.
- Admin macro categories: suggested VAT rate field + column; round-trips.

- [ ] **Step 4: Record the deferred item**

The seller **order-view castelletto display** is intentionally NOT built (the seller app has no orders page yet). The castelletto **data** is already exposed on `OrderSchema.vatBreakdown` (hence on `SellerOrderWithRelationsSchema`/`CustomerOrderWithRelationsSchema`) and snapshotted on every new order — ready to render once a seller orders page exists. No code change needed; this is a note for whoever builds that page.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feat/product-vat-iva
gh pr create --fill --base main
```

Include in the PR body: the gross-inclusive scorporo model, the points-discount-apportionment deferral, the historical-orders-stay-NULL backfill choice, and the deferred seller order-view display.

---

## Self-review notes (author)

- **Spec coverage:** every spec section maps to a task — domain math §4 → Task 1; data model §3 → Task 2; API §5 → Tasks 3-6; seller UI §6.1/6.2 → Tasks 7-8; admin UI §7 → Task 9; out-of-scope §8 honored (no customer UI, no SDI/XML, no Stripe Tax, no natura codes); seller order view §6.3 explicitly deferred in Task 10.
- **Naming consistency:** `vatRate` (product + order_item snapshot), `suggestedVatRate` (macro), `vatAmount` (order_item), `vatBreakdown` (order), `scorporo`/`buildCastelletto`/`VAT_RATES`/`VatRate` (lib/vat) used identically across every task.
- **Decisions locked:** half-up rounding via `Math.round` on non-negative cents; castelletto on per-rate aggregate (Task 1 test proves it differs from per-line); castelletto computed on gross pre-points (Task 5); macro suggestion is a client-side form prefill, server falls back to DB default (Tasks 4 + 8).
