# Seller — Promozioni e sconti: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementare la sezione "Promozioni" del seller (lista, creazione, modifica, pausa, archivio, picker prodotti) end-to-end: schema DB, modulo API, UI seller, payload customer arricchito, componente `DiscountedPrice` condiviso.

**Architecture:** Due nuove tabelle (`discounts`, `discount_products`), nuovo modulo Elysia `discounts` montato in `sellerModule`, estensione del `listProducts` service con nuovi filtri, helper SQL `withActiveDiscount` (LATERAL JOIN sulla miglior promo attiva), nuove route TanStack Start in `apps/seller/src/routes/_authenticated/promotions/`, nuovo componente `<DiscountedPrice>` in `packages/ui`.

**Tech Stack:** Drizzle ORM (Postgres + CHECK), Elysia + TypeBox, Bun test + testcontainers, TanStack Start + Router + Query, React Hook Form + Zod, shadcn/ui (`@bibs/ui`), Paraglide i18n.

**Spec di riferimento:** [`docs/superpowers/specs/2026-05-14-seller-discounts-design.md`](../specs/2026-05-14-seller-discounts-design.md)

**Scope adjustment vs spec:** il customer app oggi ha solo `/` e `/profile`, nessuna product card o pagina dettaglio. Quindi la sezione "UI customer (display read-only)" dello spec si limita a:
- Estensione dello `SearchResultSchema` con i 4 campi `discount*` (data plumbing pronto)
- Componente `<DiscountedPrice>` in `@bibs/ui` (primitive condivisa, riusabile quando il customer monta le sue card)

L'integrazione visiva sul customer (card + dettaglio) sarà fatta nel future spec quando la UI customer sarà costruita.

**Branch corrente:** `feat/seller-discounts` (spec già committato qui).

---

## File Structure

### Nuovi file

**apps/api**
- `src/db/schemas/discount.ts` — tabelle `discounts`, `discount_products`, relations, enum status
- `src/lib/schemas/discount.ts` — TypeBox `DiscountSchema`, `DiscountListItemSchema`, body Create/Update/ProductsAdd/Remove, query ListQuery
- `src/modules/seller/services/discounts.ts` — service: create/update/pause/archive/list/get/addProducts/removeProducts
- `src/modules/seller/services/discount-pricing.ts` — helper `withActiveDiscount` (annota query Drizzle con LATERAL JOIN)
- `src/modules/seller/routes/discounts.ts` — 10 endpoint del modulo
- `tests/integration/seller-discounts.test.ts` — test integration

**packages/ui**
- `src/components/discounted-price.tsx` — componente riusabile

**apps/seller**
- `src/routes/_authenticated/promotions.tsx` — layout breadcrumb
- `src/routes/_authenticated/promotions/index.tsx` — lista
- `src/routes/_authenticated/promotions/new.tsx` — form crea
- `src/routes/_authenticated/promotions/$discountId.tsx` — dettaglio/modifica
- `src/features/promotions/components/promotion-state-tabs.tsx`
- `src/features/promotions/components/promotion-list-table.tsx`
- `src/features/promotions/components/discount-form.tsx`
- `src/features/promotions/components/product-picker-sheet.tsx`
- `src/features/promotions/components/included-products-table.tsx`
- `src/features/promotions/hooks/use-discounts.ts` — query hooks centralizzati

### File modificati

**apps/api**
- `src/db/schemas/index.ts` — re-export discount schema
- `src/lib/schemas/index.ts` — re-export discount schemas TypeBox
- `src/lib/schemas/entities.ts` — `SearchResultSchema` + campi `discount*`
- `src/modules/seller/index.ts` — montaggio `discountsRoutes`
- `src/modules/seller/services/products.ts` — `listProducts` con nuovi filtri (storeId optional, brandId, productCategoryId, productMacroCategoryId, minPrice, maxPrice, inStock, excludeDiscountId)
- `src/modules/seller/routes/products.ts` — query params extra in `GET /products`
- `src/modules/customer/services/search.ts` — usa `withActiveDiscount`
- `tests/helpers/fixtures.ts` — `createTestDiscount`, `createTestDiscountProduct`

**apps/seller**
- `src/components/app-sidebar.tsx` — voce "Promozioni"
- `messages/it.json` + `messages/en.json` — chiavi `promotions_*`

---

## Task 1: Drizzle schema for `discounts` and `discount_products`

**Files:**
- Create: `apps/api/src/db/schemas/discount.ts`
- Modify: `apps/api/src/db/schemas/index.ts`

- [ ] **Step 1: Create the schema file**

```ts
// apps/api/src/db/schemas/discount.ts
import { relations, sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { product } from "./product";
import { sellerProfile } from "./seller";

export const discountStatuses = ["active", "paused", "archived"] as const;
export type DiscountStatus = (typeof discountStatuses)[number];

export const discount = pgTable(
	"discounts",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		sellerProfileId: text("seller_profile_id")
			.notNull()
			.references(() => sellerProfile.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		percent: integer("percent").notNull(),
		startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
		endsAt: timestamp("ends_at", { withTimezone: true }),
		status: text("status", { enum: discountStatuses })
			.default("active")
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
		index("discount_seller_profile_id_idx").on(table.sellerProfileId),
		index("discount_status_idx").on(table.status),
		index("discount_period_idx").on(table.startsAt, table.endsAt),
		check("discount_percent_range", sql`${table.percent} BETWEEN 1 AND 99`),
		check(
			"discount_period_valid",
			sql`${table.endsAt} IS NULL OR ${table.endsAt} > ${table.startsAt}`,
		),
		check(
			"discount_status_valid",
			sql`${table.status} IN ('active','paused','archived')`,
		),
		check(
			"discount_title_non_empty",
			sql`length(trim(${table.title})) > 0`,
		),
	],
);

export const discountRelations = relations(discount, ({ one, many }) => ({
	sellerProfile: one(sellerProfile, {
		fields: [discount.sellerProfileId],
		references: [sellerProfile.id],
	}),
	discountProducts: many(discountProduct),
}));

export const discountProduct = pgTable(
	"discount_products",
	{
		discountId: text("discount_id")
			.notNull()
			.references(() => discount.id, { onDelete: "cascade" }),
		productId: text("product_id")
			.notNull()
			.references(() => product.id, { onDelete: "cascade" }),
		addedAt: timestamp("added_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.discountId, table.productId] }),
		index("discount_products_product_id_idx").on(table.productId),
	],
);

export const discountProductRelations = relations(
	discountProduct,
	({ one }) => ({
		discount: one(discount, {
			fields: [discountProduct.discountId],
			references: [discount.id],
		}),
		product: one(product, {
			fields: [discountProduct.productId],
			references: [product.id],
		}),
	}),
);
```

- [ ] **Step 2: Re-export from db schemas index**

Edit `apps/api/src/db/schemas/index.ts` — add (keep alphabetical order):

```ts
export * from "./discount";
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS (no usage yet, but Drizzle types must resolve).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/schemas/discount.ts apps/api/src/db/schemas/index.ts
git commit -m "feat(api): add discount and discount_products drizzle schemas"
```

---

## Task 2: Generate and apply migration

**Files:**
- Create: `apps/api/src/db/migrations/<auto-numbered>_<auto-name>.sql`

- [ ] **Step 1: Generate migration**

Run from repo root: `bun run db:generate`
Expected: new SQL file in `apps/api/src/db/migrations/` containing `CREATE TABLE discounts`, `CREATE TABLE discount_products`, the indexes, the CHECK constraints, and the FK with `ON DELETE CASCADE`.

- [ ] **Step 2: Open the generated SQL and review**

Read the file. Verify:
- `discounts`: 4 CHECK constraints with the exact names `discount_percent_range`, `discount_period_valid`, `discount_status_valid`, `discount_title_non_empty`
- Indexes `discount_seller_profile_id_idx`, `discount_status_idx`, `discount_period_idx`
- `discount_products`: composite PK on `(discount_id, product_id)`, index `discount_products_product_id_idx`
- Both FKs use `ON DELETE CASCADE`

If any constraint or index is missing or named differently, do NOT edit the SQL manually — go back to Task 1 and fix the schema, then regenerate.

- [ ] **Step 3: Bring up infra and migrate**

```bash
bun run infra:up
bun run db:migrate
```
Expected: migration applied without errors.

- [ ] **Step 4: Verify in DB**

Run via `bun run db:studio` (or `psql`):
- Tables `discounts` and `discount_products` exist
- Constraints visible (`SELECT conname FROM pg_constraint WHERE conrelid = 'discounts'::regclass`)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/migrations/
git commit -m "feat(api): generate migration for discounts tables"
```

---

## Task 3: Test fixtures `createTestDiscount`, `createTestDiscountProduct`

**Files:**
- Modify: `apps/api/tests/helpers/fixtures.ts`

- [ ] **Step 1: Add fixture helpers**

Append to `apps/api/tests/helpers/fixtures.ts` (after the existing helpers):

```ts
import { discount, discountProduct } from "@/db/schemas/discount";
import type { DiscountStatus } from "@/db/schemas/discount";

export async function createTestDiscount(
	db: DrizzleTestDb,
	sellerProfileId: string,
	params: {
		title?: string;
		percent?: number;
		startsAt?: Date;
		endsAt?: Date | null;
		status?: DiscountStatus;
	} = {},
) {
	const [row] = await db
		.insert(discount)
		.values({
			sellerProfileId,
			title: params.title ?? "Saldi di prova",
			percent: params.percent ?? 20,
			startsAt: params.startsAt ?? new Date(Date.now() - 60_000),
			endsAt: params.endsAt === undefined ? new Date(Date.now() + 86_400_000) : params.endsAt,
			status: params.status ?? "active",
		})
		.returning();
	return row;
}

export async function createTestDiscountProduct(
	db: DrizzleTestDb,
	discountId: string,
	productId: string,
) {
	const [row] = await db
		.insert(discountProduct)
		.values({ discountId, productId })
		.returning();
	return row;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/tests/helpers/fixtures.ts
git commit -m "test(api): add discount and discount_product fixtures"
```

---

## Task 4: Service `createDiscount` + test

**Files:**
- Create: `apps/api/src/modules/seller/services/discounts.ts`
- Create: `apps/api/tests/integration/seller-discounts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/integration/seller-discounts.test.ts`:

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

import { ServiceError } from "@/lib/errors";
import { createDiscount } from "@/modules/seller/services/discounts";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller } from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

describe("createDiscount", () => {
	it("creates a discount with valid params and default status active", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const startsAt = new Date(Date.now() + 86_400_000);
		const endsAt = new Date(Date.now() + 2 * 86_400_000);

		const d = await createDiscount({
			sellerProfileId: seller.profile.id,
			title: "Saldi estivi",
			percent: 25,
			startsAt,
			endsAt,
		});

		expect(d.title).toBe("Saldi estivi");
		expect(d.percent).toBe(25);
		expect(d.status).toBe("active");
		expect(d.endsAt?.toISOString()).toBe(endsAt.toISOString());
	});

	it("creates a discount with endsAt null", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		const d = await createDiscount({
			sellerProfileId: seller.profile.id,
			title: "Senza scadenza",
			percent: 10,
			startsAt: new Date(),
			endsAt: null,
		});

		expect(d.endsAt).toBeNull();
	});

	it("rejects percent out of range", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		await expect(
			createDiscount({
				sellerProfileId: seller.profile.id,
				title: "Bad",
				percent: 0,
				startsAt: new Date(),
				endsAt: null,
			}),
		).rejects.toThrow();

		await expect(
			createDiscount({
				sellerProfileId: seller.profile.id,
				title: "Bad",
				percent: 100,
				startsAt: new Date(),
				endsAt: null,
			}),
		).rejects.toThrow();
	});

	it("rejects endsAt <= startsAt", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const startsAt = new Date();

		await expect(
			createDiscount({
				sellerProfileId: seller.profile.id,
				title: "Bad",
				percent: 10,
				startsAt,
				endsAt: startsAt,
			}),
		).rejects.toThrow();
	});

	it("rejects empty title", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await expect(
			createDiscount({
				sellerProfileId: seller.profile.id,
				title: "   ",
				percent: 10,
				startsAt: new Date(),
				endsAt: null,
			}),
		).rejects.toThrow();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/integration/seller-discounts.test.ts -t "createDiscount"`
Expected: FAIL with "Cannot find module '@/modules/seller/services/discounts'".

- [ ] **Step 3: Implement `createDiscount`**

Create `apps/api/src/modules/seller/services/discounts.ts`:

```ts
import { db } from "@/db";
import { discount } from "@/db/schemas/discount";

interface CreateDiscountParams {
	sellerProfileId: string;
	title: string;
	percent: number;
	startsAt: Date;
	endsAt: Date | null;
}

export async function createDiscount(params: CreateDiscountParams) {
	const [row] = await db
		.insert(discount)
		.values({
			sellerProfileId: params.sellerProfileId,
			title: params.title.trim(),
			percent: params.percent,
			startsAt: params.startsAt,
			endsAt: params.endsAt,
		})
		.returning();
	return row;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/integration/seller-discounts.test.ts -t "createDiscount"`
Expected: PASS (5 cases). The CHECK constraints catch invalid percent / period / title.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/seller/services/discounts.ts apps/api/tests/integration/seller-discounts.test.ts
git commit -m "feat(api): add createDiscount service with constraint tests"
```

---

## Task 5: Service `updateDiscount` with editing-post-start rule + test

**Files:**
- Modify: `apps/api/src/modules/seller/services/discounts.ts`
- Modify: `apps/api/tests/integration/seller-discounts.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `seller-discounts.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { discount } from "@/db/schemas/discount";
import {
	createDiscount,
	updateDiscount,
} from "@/modules/seller/services/discounts";
import { createTestDiscount } from "../helpers/fixtures";

describe("updateDiscount", () => {
	it("updates title and endsAt at any time", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		// running promo (startsAt in the past)
		const d = await createTestDiscount(db, seller.profile.id, {
			startsAt: new Date(Date.now() - 3600_000),
			endsAt: new Date(Date.now() + 86_400_000),
		});
		const newEnd = new Date(Date.now() + 2 * 86_400_000);

		const updated = await updateDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			patch: { title: "Saldi prolungati", endsAt: newEnd },
		});

		expect(updated.title).toBe("Saldi prolungati");
		expect(updated.endsAt?.toISOString()).toBe(newEnd.toISOString());
	});

	it("allows changing percent before start", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const d = await createTestDiscount(db, seller.profile.id, {
			startsAt: new Date(Date.now() + 86_400_000), // future
			endsAt: new Date(Date.now() + 2 * 86_400_000),
			percent: 10,
		});

		const updated = await updateDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			patch: { percent: 30 },
		});
		expect(updated.percent).toBe(30);
	});

	it("rejects percent change once started (409)", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const d = await createTestDiscount(db, seller.profile.id, {
			startsAt: new Date(Date.now() - 3600_000), // started
			endsAt: new Date(Date.now() + 86_400_000),
			percent: 10,
		});

		await expect(
			updateDiscount({
				discountId: d.id,
				sellerProfileId: seller.profile.id,
				patch: { percent: 30 },
			}),
		).rejects.toMatchObject({ status: 409 });
	});

	it("rejects startsAt change once started (409)", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const d = await createTestDiscount(db, seller.profile.id, {
			startsAt: new Date(Date.now() - 3600_000),
		});

		await expect(
			updateDiscount({
				discountId: d.id,
				sellerProfileId: seller.profile.id,
				patch: { startsAt: new Date(Date.now() + 86_400_000) },
			}),
		).rejects.toMatchObject({ status: 409 });
	});

	it("rejects endsAt in the past", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const d = await createTestDiscount(db, seller.profile.id);

		await expect(
			updateDiscount({
				discountId: d.id,
				sellerProfileId: seller.profile.id,
				patch: { endsAt: new Date(Date.now() - 86_400_000) },
			}),
		).rejects.toMatchObject({ status: 409 });
	});

	it("returns 404 if discount does not exist or belongs to another seller", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		const d = await createTestDiscount(db, sellerA.profile.id);

		await expect(
			updateDiscount({
				discountId: d.id,
				sellerProfileId: sellerB.profile.id,
				patch: { title: "Hack" },
			}),
		).rejects.toMatchObject({ status: 404 });
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/integration/seller-discounts.test.ts -t "updateDiscount"`
Expected: FAIL with "updateDiscount is not exported".

- [ ] **Step 3: Implement `updateDiscount`**

Append to `apps/api/src/modules/seller/services/discounts.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { ServiceError } from "@/lib/errors";

export interface UpdateDiscountPatch {
	title?: string;
	percent?: number;
	startsAt?: Date;
	endsAt?: Date | null;
}

interface UpdateDiscountParams {
	discountId: string;
	sellerProfileId: string;
	patch: UpdateDiscountPatch;
}

export async function updateDiscount(params: UpdateDiscountParams) {
	const existing = await db.query.discount.findFirst({
		where: and(
			eq(discount.id, params.discountId),
			eq(discount.sellerProfileId, params.sellerProfileId),
		),
	});
	if (!existing) throw new ServiceError(404, "Promozione non trovata");

	const isStarted = new Date() >= existing.startsAt;
	const patch = params.patch;

	if (isStarted) {
		if (patch.percent !== undefined && patch.percent !== existing.percent) {
			throw new ServiceError(
				409,
				"Promo già iniziata: percentuale non modificabile",
			);
		}
		if (
			patch.startsAt !== undefined &&
			patch.startsAt.getTime() !== existing.startsAt.getTime()
		) {
			throw new ServiceError(
				409,
				"Promo già iniziata: data di inizio non modificabile",
			);
		}
	}

	if (patch.endsAt !== undefined && patch.endsAt !== null) {
		if (patch.endsAt.getTime() <= Date.now()) {
			throw new ServiceError(409, "La data di fine deve essere futura");
		}
	}

	const updateValues: Partial<typeof discount.$inferInsert> = {};
	if (patch.title !== undefined) updateValues.title = patch.title.trim();
	if (patch.percent !== undefined) updateValues.percent = patch.percent;
	if (patch.startsAt !== undefined) updateValues.startsAt = patch.startsAt;
	if (patch.endsAt !== undefined) updateValues.endsAt = patch.endsAt;

	if (Object.keys(updateValues).length === 0) return existing;

	const [updated] = await db
		.update(discount)
		.set(updateValues)
		.where(eq(discount.id, params.discountId))
		.returning();

	return updated;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/integration/seller-discounts.test.ts -t "updateDiscount"`
Expected: PASS (6 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/seller/services/discounts.ts apps/api/tests/integration/seller-discounts.test.ts
git commit -m "feat(api): add updateDiscount with editing-post-start rule"
```

---

## Task 6: Services `pauseDiscount` / `archiveDiscount` + tests

**Files:**
- Modify: `apps/api/src/modules/seller/services/discounts.ts`
- Modify: `apps/api/tests/integration/seller-discounts.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
import {
	archiveDiscount,
	pauseDiscount,
} from "@/modules/seller/services/discounts";

describe("pauseDiscount", () => {
	it("toggles active → paused", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const d = await createTestDiscount(db, seller.profile.id, { status: "active" });
		const out = await pauseDiscount({ discountId: d.id, sellerProfileId: seller.profile.id });
		expect(out.status).toBe("paused");
	});

	it("toggles paused → active", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const d = await createTestDiscount(db, seller.profile.id, { status: "paused" });
		const out = await pauseDiscount({ discountId: d.id, sellerProfileId: seller.profile.id });
		expect(out.status).toBe("active");
	});

	it("returns 409 on archived", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const d = await createTestDiscount(db, seller.profile.id, { status: "archived" });
		await expect(
			pauseDiscount({ discountId: d.id, sellerProfileId: seller.profile.id }),
		).rejects.toMatchObject({ status: 409 });
	});

	it("returns 404 for wrong seller", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		const d = await createTestDiscount(db, sellerA.profile.id);
		await expect(
			pauseDiscount({ discountId: d.id, sellerProfileId: sellerB.profile.id }),
		).rejects.toMatchObject({ status: 404 });
	});
});

describe("archiveDiscount", () => {
	it("moves to archived", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const d = await createTestDiscount(db, seller.profile.id);
		const out = await archiveDiscount({ discountId: d.id, sellerProfileId: seller.profile.id });
		expect(out.status).toBe("archived");
	});

	it("rejects re-archive (409)", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const d = await createTestDiscount(db, seller.profile.id, { status: "archived" });
		await expect(
			archiveDiscount({ discountId: d.id, sellerProfileId: seller.profile.id }),
		).rejects.toMatchObject({ status: 409 });
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/integration/seller-discounts.test.ts -t "pauseDiscount|archiveDiscount"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `discounts.ts`:

```ts
interface SimpleByIdParams {
	discountId: string;
	sellerProfileId: string;
}

export async function pauseDiscount(params: SimpleByIdParams) {
	const existing = await db.query.discount.findFirst({
		where: and(
			eq(discount.id, params.discountId),
			eq(discount.sellerProfileId, params.sellerProfileId),
		),
	});
	if (!existing) throw new ServiceError(404, "Promozione non trovata");
	if (existing.status === "archived") {
		throw new ServiceError(409, "Promozione archiviata: non può essere ripresa");
	}
	const nextStatus = existing.status === "active" ? "paused" : "active";
	const [out] = await db
		.update(discount)
		.set({ status: nextStatus })
		.where(eq(discount.id, params.discountId))
		.returning();
	return out;
}

export async function archiveDiscount(params: SimpleByIdParams) {
	const existing = await db.query.discount.findFirst({
		where: and(
			eq(discount.id, params.discountId),
			eq(discount.sellerProfileId, params.sellerProfileId),
		),
	});
	if (!existing) throw new ServiceError(404, "Promozione non trovata");
	if (existing.status === "archived") {
		throw new ServiceError(409, "Promozione già archiviata");
	}
	const [out] = await db
		.update(discount)
		.set({ status: "archived" })
		.where(eq(discount.id, params.discountId))
		.returning();
	return out;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/integration/seller-discounts.test.ts -t "pauseDiscount|archiveDiscount"`
Expected: PASS (6 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/seller/services/discounts.ts apps/api/tests/integration/seller-discounts.test.ts
git commit -m "feat(api): add pauseDiscount and archiveDiscount services"
```

---

## Task 7: Services `addProductsToDiscount` / `removeProductsFromDiscount` + tests

**Files:**
- Modify: `apps/api/src/modules/seller/services/discounts.ts`
- Modify: `apps/api/tests/integration/seller-discounts.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
import {
	addProductsToDiscount,
	removeProductsFromDiscount,
} from "@/modules/seller/services/discounts";
import { createTestProduct } from "../helpers/fixtures";

describe("addProductsToDiscount", () => {
	it("inserts all valid products, idempotent on re-add", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p1 = await createTestProduct(db, seller.profile.id, { name: "P1" });
		const p2 = await createTestProduct(db, seller.profile.id, { name: "P2" });
		const d = await createTestDiscount(db, seller.profile.id);

		const r1 = await addProductsToDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			productIds: [p1.id, p2.id],
		});
		expect(r1.added).toBe(2);
		expect(r1.alreadyPresent).toBe(0);
		expect(r1.rejected).toEqual([]);

		const r2 = await addProductsToDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			productIds: [p1.id, p2.id],
		});
		expect(r2.added).toBe(0);
		expect(r2.alreadyPresent).toBe(2);
	});

	it("rejects products of another seller", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		const pA = await createTestProduct(db, sellerA.profile.id);
		const pB = await createTestProduct(db, sellerB.profile.id);
		const d = await createTestDiscount(db, sellerA.profile.id);

		const r = await addProductsToDiscount({
			discountId: d.id,
			sellerProfileId: sellerA.profile.id,
			productIds: [pA.id, pB.id],
		});
		expect(r.added).toBe(1);
		expect(r.rejected).toEqual([pB.id]);
	});

	it("404 if discount does not belong to seller", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		const d = await createTestDiscount(db, sellerA.profile.id);
		await expect(
			addProductsToDiscount({
				discountId: d.id,
				sellerProfileId: sellerB.profile.id,
				productIds: [],
			}),
		).rejects.toMatchObject({ status: 404 });
	});
});

describe("removeProductsFromDiscount", () => {
	it("removes only specified products", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p1 = await createTestProduct(db, seller.profile.id, { name: "P1" });
		const p2 = await createTestProduct(db, seller.profile.id, { name: "P2" });
		const d = await createTestDiscount(db, seller.profile.id);
		await addProductsToDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			productIds: [p1.id, p2.id],
		});

		const r = await removeProductsFromDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			productIds: [p1.id],
		});
		expect(r.removed).toBe(1);
	});
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `bun test tests/integration/seller-discounts.test.ts -t "addProductsToDiscount|removeProductsFromDiscount"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `discounts.ts`:

```ts
import { inArray, sql } from "drizzle-orm";
import { discountProduct } from "@/db/schemas/discount";
import { product } from "@/db/schemas/product";

interface AddProductsParams {
	discountId: string;
	sellerProfileId: string;
	productIds: string[];
}

interface AddProductsResult {
	added: number;
	alreadyPresent: number;
	rejected: string[];
}

export async function addProductsToDiscount(
	params: AddProductsParams,
): Promise<AddProductsResult> {
	// Discount ownership check
	const d = await db.query.discount.findFirst({
		where: and(
			eq(discount.id, params.discountId),
			eq(discount.sellerProfileId, params.sellerProfileId),
		),
	});
	if (!d) throw new ServiceError(404, "Promozione non trovata");

	if (params.productIds.length === 0) {
		return { added: 0, alreadyPresent: 0, rejected: [] };
	}

	// Filter products owned by the same seller
	const owned = await db
		.select({ id: product.id })
		.from(product)
		.where(
			and(
				inArray(product.id, params.productIds),
				eq(product.sellerProfileId, params.sellerProfileId),
			),
		);
	const ownedIds = new Set(owned.map((p) => p.id));
	const rejected = params.productIds.filter((id) => !ownedIds.has(id));
	const toInsert = params.productIds.filter((id) => ownedIds.has(id));

	if (toInsert.length === 0) {
		return { added: 0, alreadyPresent: 0, rejected };
	}

	// Detect already-present for accurate counts
	const existing = await db
		.select({ productId: discountProduct.productId })
		.from(discountProduct)
		.where(
			and(
				eq(discountProduct.discountId, params.discountId),
				inArray(discountProduct.productId, toInsert),
			),
		);
	const existingIds = new Set(existing.map((e) => e.productId));
	const newIds = toInsert.filter((id) => !existingIds.has(id));

	if (newIds.length > 0) {
		await db
			.insert(discountProduct)
			.values(newIds.map((productId) => ({ discountId: params.discountId, productId })))
			.onConflictDoNothing();
	}

	return {
		added: newIds.length,
		alreadyPresent: existingIds.size,
		rejected,
	};
}

interface RemoveProductsParams {
	discountId: string;
	sellerProfileId: string;
	productIds: string[];
}

export async function removeProductsFromDiscount(params: RemoveProductsParams) {
	const d = await db.query.discount.findFirst({
		where: and(
			eq(discount.id, params.discountId),
			eq(discount.sellerProfileId, params.sellerProfileId),
		),
	});
	if (!d) throw new ServiceError(404, "Promozione non trovata");

	if (params.productIds.length === 0) return { removed: 0 };

	const deleted = await db
		.delete(discountProduct)
		.where(
			and(
				eq(discountProduct.discountId, params.discountId),
				inArray(discountProduct.productId, params.productIds),
			),
		)
		.returning({ productId: discountProduct.productId });

	return { removed: deleted.length };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test tests/integration/seller-discounts.test.ts -t "addProductsToDiscount|removeProductsFromDiscount"`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/seller/services/discounts.ts apps/api/tests/integration/seller-discounts.test.ts
git commit -m "feat(api): add discount-product M:N services with ownership + idempotency"
```

---

## Task 8: Service `listDiscounts` + `getDiscountById` + `getDiscountProducts` + tests

**Files:**
- Modify: `apps/api/src/modules/seller/services/discounts.ts`
- Modify: `apps/api/tests/integration/seller-discounts.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
import {
	getDiscountById,
	getDiscountProducts,
	listDiscounts,
} from "@/modules/seller/services/discounts";

describe("listDiscounts", () => {
	it("filters by operational state 'running'", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await createTestDiscount(db, seller.profile.id, {
			title: "Running",
			startsAt: new Date(Date.now() - 3600_000),
			endsAt: new Date(Date.now() + 86_400_000),
		});
		await createTestDiscount(db, seller.profile.id, {
			title: "Scheduled",
			startsAt: new Date(Date.now() + 86_400_000),
			endsAt: new Date(Date.now() + 2 * 86_400_000),
		});
		await createTestDiscount(db, seller.profile.id, {
			title: "Expired",
			startsAt: new Date(Date.now() - 2 * 86_400_000),
			endsAt: new Date(Date.now() - 86_400_000),
		});

		const result = await listDiscounts({
			sellerProfileId: seller.profile.id,
			state: "running",
		});
		expect(result.data).toHaveLength(1);
		expect(result.data[0].title).toBe("Running");
	});

	it("filters 'archived' separately, hidden from 'all'", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await createTestDiscount(db, seller.profile.id, {
			title: "Active",
			status: "active",
		});
		await createTestDiscount(db, seller.profile.id, {
			title: "Arch",
			status: "archived",
		});

		const all = await listDiscounts({ sellerProfileId: seller.profile.id, state: "all" });
		expect(all.data.find((d) => d.title === "Arch")).toBeUndefined();

		const arch = await listDiscounts({ sellerProfileId: seller.profile.id, state: "archived" });
		expect(arch.data).toHaveLength(1);
	});

	it("includes productCount", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const d = await createTestDiscount(db, seller.profile.id);
		const p1 = await createTestProduct(db, seller.profile.id);
		const p2 = await createTestProduct(db, seller.profile.id);
		await addProductsToDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			productIds: [p1.id, p2.id],
		});

		const list = await listDiscounts({ sellerProfileId: seller.profile.id });
		expect(list.data[0].productCount).toBe(2);
	});

	it("does not leak other sellers' discounts", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		await createTestDiscount(db, sellerA.profile.id, { title: "A" });
		await createTestDiscount(db, sellerB.profile.id, { title: "B" });

		const out = await listDiscounts({ sellerProfileId: sellerA.profile.id });
		expect(out.data.map((d) => d.title)).toEqual(["A"]);
	});
});

describe("getDiscountById", () => {
	it("returns the discount + productCount, 404 if not owned", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		const d = await createTestDiscount(db, sellerA.profile.id);

		const found = await getDiscountById({
			discountId: d.id,
			sellerProfileId: sellerA.profile.id,
		});
		expect(found.id).toBe(d.id);
		expect(found.productCount).toBe(0);

		await expect(
			getDiscountById({
				discountId: d.id,
				sellerProfileId: sellerB.profile.id,
			}),
		).rejects.toMatchObject({ status: 404 });
	});
});

describe("getDiscountProducts", () => {
	it("returns paginated products with original and discounted prices", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p1 = await createTestProduct(db, seller.profile.id, {
			name: "P1",
			price: "100.00",
		});
		const d = await createTestDiscount(db, seller.profile.id, { percent: 25 });
		await addProductsToDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			productIds: [p1.id],
		});

		const res = await getDiscountProducts({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
		});
		expect(res.data).toHaveLength(1);
		expect(res.data[0].id).toBe(p1.id);
		expect(res.data[0].originalPrice).toBe("100.00");
		expect(res.data[0].discountedPrice).toBe("75.00");
	});
});
```

- [ ] **Step 2: Run, verify failure**

Run: `bun test tests/integration/seller-discounts.test.ts -t "listDiscounts|getDiscountById|getDiscountProducts"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `discounts.ts`:

```ts
import { count, desc, gt, gte, isNull, lt, or } from "drizzle-orm";
import { parsePagination } from "@/lib/pagination";

export type DiscountOperationalState =
	| "all"
	| "scheduled"
	| "running"
	| "paused"
	| "expired"
	| "archived";

interface ListDiscountsParams {
	sellerProfileId: string;
	page?: number;
	limit?: number;
	state?: DiscountOperationalState;
	search?: string;
}

export async function listDiscounts(params: ListDiscountsParams) {
	const { page, limit, offset } = parsePagination(params);
	const state = params.state ?? "all";
	const now = new Date();

	const whereParts = [eq(discount.sellerProfileId, params.sellerProfileId)];

	switch (state) {
		case "archived":
			whereParts.push(eq(discount.status, "archived"));
			break;
		case "paused":
			whereParts.push(eq(discount.status, "paused"));
			break;
		case "scheduled":
			whereParts.push(eq(discount.status, "active"));
			whereParts.push(gt(discount.startsAt, now));
			break;
		case "running":
			whereParts.push(eq(discount.status, "active"));
			whereParts.push(lte(discount.startsAt, now));
			whereParts.push(
				or(isNull(discount.endsAt), gte(discount.endsAt, now))!,
			);
			break;
		case "expired":
			whereParts.push(eq(discount.status, "active"));
			// endsAt NOT NULL AND endsAt < now
			whereParts.push(lt(discount.endsAt, now));
			break;
		case "all":
		default:
			// Exclude archived from "all"
			whereParts.push(sql`${discount.status} <> 'archived'`);
			break;
	}

	if (params.search) {
		whereParts.push(sql`${discount.title} ILIKE ${"%" + params.search + "%"}`);
	}

	const where = and(...whereParts);

	const rows = await db
		.select({
			d: discount,
			productCount: sql<number>`(SELECT count(*)::int FROM ${discountProduct} WHERE ${discountProduct.discountId} = ${discount.id})`,
		})
		.from(discount)
		.where(where)
		.orderBy(desc(discount.startsAt))
		.limit(limit)
		.offset(offset);

	const [{ total }] = await db
		.select({ total: count() })
		.from(discount)
		.where(where);

	return {
		data: rows.map((r) => ({ ...r.d, productCount: r.productCount })),
		pagination: { page, limit, total },
	};
}

interface ByIdParams {
	discountId: string;
	sellerProfileId: string;
}

export async function getDiscountById(params: ByIdParams) {
	const d = await db.query.discount.findFirst({
		where: and(
			eq(discount.id, params.discountId),
			eq(discount.sellerProfileId, params.sellerProfileId),
		),
	});
	if (!d) throw new ServiceError(404, "Promozione non trovata");

	const [{ c }] = await db
		.select({ c: count() })
		.from(discountProduct)
		.where(eq(discountProduct.discountId, params.discountId));

	return { ...d, productCount: c };
}

interface GetDiscountProductsParams extends ByIdParams {
	page?: number;
	limit?: number;
}

export async function getDiscountProducts(params: GetDiscountProductsParams) {
	const d = await db.query.discount.findFirst({
		where: and(
			eq(discount.id, params.discountId),
			eq(discount.sellerProfileId, params.sellerProfileId),
		),
		columns: { id: true, percent: true },
	});
	if (!d) throw new ServiceError(404, "Promozione non trovata");

	const { page, limit, offset } = parsePagination(params);

	const rows = await db
		.select({
			id: product.id,
			name: product.name,
			originalPrice: product.price,
			brandId: product.brandId,
			discountedPrice: sql<string>`ROUND(${product.price} * (1 - ${d.percent}::numeric / 100), 2)::text`,
		})
		.from(product)
		.innerJoin(discountProduct, eq(discountProduct.productId, product.id))
		.where(eq(discountProduct.discountId, d.id))
		.orderBy(discountProduct.addedAt)
		.limit(limit)
		.offset(offset);

	const [{ total }] = await db
		.select({ total: count() })
		.from(discountProduct)
		.where(eq(discountProduct.discountId, d.id));

	return {
		data: rows,
		pagination: { page, limit, total },
	};
}

function lte(col: any, val: any) {
	return sql`${col} <= ${val}`;
}
```

Note: `lt` and `gt`/`gte` are imported from drizzle-orm. `lte` is defined locally since older drizzle versions miss it; if `lte` is available from `drizzle-orm`, import it instead and remove the local helper.

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test tests/integration/seller-discounts.test.ts`
Expected: all tests pass (createDiscount, updateDiscount, pause, archive, addProducts, removeProducts, listDiscounts, getDiscountById, getDiscountProducts).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/seller/services/discounts.ts apps/api/tests/integration/seller-discounts.test.ts
git commit -m "feat(api): list, get, getProducts for discounts with operational state filter"
```

---

## Task 9: Helper `withActiveDiscount` (best discount per product) + test

**Files:**
- Create: `apps/api/src/modules/seller/services/discount-pricing.ts`
- Modify: `apps/api/tests/integration/seller-discounts.test.ts`

- [ ] **Step 1: Append failing test**

```ts
import { getBestActiveDiscount } from "@/modules/seller/services/discount-pricing";

describe("getBestActiveDiscount", () => {
	it("returns null when no active discount", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id);
		expect(await getBestActiveDiscount(p.id)).toBeNull();
	});

	it("returns the discount with highest percent among active running", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id, { price: "100.00" });
		const d10 = await createTestDiscount(db, seller.profile.id, { percent: 10, title: "ten" });
		const d30 = await createTestDiscount(db, seller.profile.id, { percent: 30, title: "thirty" });
		await addProductsToDiscount({
			discountId: d10.id,
			sellerProfileId: seller.profile.id,
			productIds: [p.id],
		});
		await addProductsToDiscount({
			discountId: d30.id,
			sellerProfileId: seller.profile.id,
			productIds: [p.id],
		});

		const out = await getBestActiveDiscount(p.id);
		expect(out?.percent).toBe(30);
		expect(out?.discountedPrice).toBe("70.00");
	});

	it("ignores paused discounts", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id);
		const d = await createTestDiscount(db, seller.profile.id, {
			percent: 30,
			status: "paused",
		});
		await addProductsToDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			productIds: [p.id],
		});
		expect(await getBestActiveDiscount(p.id)).toBeNull();
	});

	it("ignores expired and scheduled discounts", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id);
		const dExpired = await createTestDiscount(db, seller.profile.id, {
			percent: 30,
			startsAt: new Date(Date.now() - 2 * 86_400_000),
			endsAt: new Date(Date.now() - 86_400_000),
		});
		const dScheduled = await createTestDiscount(db, seller.profile.id, {
			percent: 30,
			startsAt: new Date(Date.now() + 86_400_000),
			endsAt: new Date(Date.now() + 2 * 86_400_000),
		});
		await addProductsToDiscount({
			discountId: dExpired.id,
			sellerProfileId: seller.profile.id,
			productIds: [p.id],
		});
		await addProductsToDiscount({
			discountId: dScheduled.id,
			sellerProfileId: seller.profile.id,
			productIds: [p.id],
		});
		expect(await getBestActiveDiscount(p.id)).toBeNull();
	});

	it("respects endsAt NULL (no expiration)", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id, { price: "50.00" });
		const d = await createTestDiscount(db, seller.profile.id, {
			percent: 20,
			endsAt: null,
		});
		await addProductsToDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			productIds: [p.id],
		});
		const out = await getBestActiveDiscount(p.id);
		expect(out?.percent).toBe(20);
		expect(out?.discountedPrice).toBe("40.00");
	});
});
```

- [ ] **Step 2: Run, verify failure**

Run: `bun test tests/integration/seller-discounts.test.ts -t "getBestActiveDiscount"`
Expected: FAIL.

- [ ] **Step 3: Implement helper**

Create `apps/api/src/modules/seller/services/discount-pricing.ts`:

```ts
import { sql } from "drizzle-orm";
import { db } from "@/db";

export interface ActiveDiscountInfo {
	discountId: string;
	title: string;
	percent: number;
	endsAt: Date | null;
	originalPrice: string;
	discountedPrice: string;
}

/**
 * Returns the best (highest percent) active discount applied to a product,
 * or null if none exists.
 *
 * An "active" discount: status='active', startsAt<=now, endsAt IS NULL OR endsAt>=now,
 * and belongs to the same seller as the product.
 */
export async function getBestActiveDiscount(
	productId: string,
): Promise<ActiveDiscountInfo | null> {
	const result = await db.execute<{
		discount_id: string;
		title: string;
		percent: number;
		ends_at: Date | null;
		original_price: string;
		discounted_price: string;
	}>(sql`
		SELECT d.id AS discount_id,
		       d.title,
		       d.percent,
		       d.ends_at,
		       p.price AS original_price,
		       ROUND(p.price * (1 - d.percent::numeric / 100), 2)::text AS discounted_price
		FROM products p
		JOIN discount_products dp ON dp.product_id = p.id
		JOIN discounts d ON d.id = dp.discount_id
		WHERE p.id = ${productId}
		  AND d.seller_profile_id = p.seller_profile_id
		  AND d.status = 'active'
		  AND d.starts_at <= now()
		  AND (d.ends_at IS NULL OR d.ends_at >= now())
		ORDER BY d.percent DESC, d.starts_at DESC
		LIMIT 1
	`);

	const row = (result as unknown as { rows: any[] }).rows[0];
	if (!row) return null;

	return {
		discountId: row.discount_id,
		title: row.title,
		percent: row.percent,
		endsAt: row.ends_at,
		originalPrice: row.original_price,
		discountedPrice: row.discounted_price,
	};
}

/**
 * Batch version: returns a Map<productId, ActiveDiscountInfo> for the given product IDs.
 * Used by list/search endpoints to annotate many products in one query.
 */
export async function getBestActiveDiscounts(
	productIds: string[],
): Promise<Map<string, ActiveDiscountInfo>> {
	if (productIds.length === 0) return new Map();

	const result = await db.execute<{
		product_id: string;
		discount_id: string;
		title: string;
		percent: number;
		ends_at: Date | null;
		original_price: string;
		discounted_price: string;
	}>(sql`
		SELECT DISTINCT ON (p.id)
		       p.id AS product_id,
		       d.id AS discount_id,
		       d.title,
		       d.percent,
		       d.ends_at,
		       p.price AS original_price,
		       ROUND(p.price * (1 - d.percent::numeric / 100), 2)::text AS discounted_price
		FROM products p
		JOIN discount_products dp ON dp.product_id = p.id
		JOIN discounts d ON d.id = dp.discount_id
		WHERE p.id = ANY(${productIds})
		  AND d.seller_profile_id = p.seller_profile_id
		  AND d.status = 'active'
		  AND d.starts_at <= now()
		  AND (d.ends_at IS NULL OR d.ends_at >= now())
		ORDER BY p.id, d.percent DESC, d.starts_at DESC
	`);

	const rows = (result as unknown as { rows: any[] }).rows;
	const map = new Map<string, ActiveDiscountInfo>();
	for (const row of rows) {
		map.set(row.product_id, {
			discountId: row.discount_id,
			title: row.title,
			percent: row.percent,
			endsAt: row.ends_at,
			originalPrice: row.original_price,
			discountedPrice: row.discounted_price,
		});
	}
	return map;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test tests/integration/seller-discounts.test.ts -t "getBestActiveDiscount"`
Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/seller/services/discount-pricing.ts apps/api/tests/integration/seller-discounts.test.ts
git commit -m "feat(api): add getBestActiveDiscount(s) helper with LATERAL semantics"
```

---

## Task 10: Extend `listProducts` service with new filters

**Files:**
- Modify: `apps/api/src/modules/seller/services/products.ts`
- Create: `apps/api/tests/integration/seller-products-filters.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/tests/integration/seller-products-filters.test.ts`:

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
mock.module("@/lib/s3", () => ({ s3: { delete: mock(async () => {}) } }));

import { addProductsToDiscount } from "@/modules/seller/services/discounts";
import { listProducts } from "@/modules/seller/services/products";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestBrand,
	createTestCategory,
	createTestDiscount,
	createTestMacroCategory,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
} from "../helpers/fixtures";

beforeAll(async () => { await setupTestContainer(); }, 120_000);
afterAll(async () => { await teardownTestContainer(); });
beforeEach(async () => { await truncateAll(getTestDb()); });

describe("listProducts with new filters", () => {
	it("storeId optional: omits store filter and returns all seller products", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p1 = await createTestProduct(db, seller.profile.id, { name: "A" });
		const p2 = await createTestProduct(db, seller.profile.id, { name: "B" });

		const out = await listProducts({ sellerProfileId: seller.profile.id });
		expect(out.data.map((p) => p.id).sort()).toEqual([p1.id, p2.id].sort());
	});

	it("filters by brandId", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const brandA = await createTestBrand(db, seller.profile.id, { name: "BrandA" });
		const brandB = await createTestBrand(db, seller.profile.id, { name: "BrandB" });
		await createTestProduct(db, seller.profile.id, { name: "P1", brandId: brandA.id });
		await createTestProduct(db, seller.profile.id, { name: "P2", brandId: brandB.id });

		const out = await listProducts({
			sellerProfileId: seller.profile.id,
			brandId: brandA.id,
		});
		expect(out.data.map((p) => p.name)).toEqual(["P1"]);
	});

	it("filters by price range minPrice/maxPrice", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await createTestProduct(db, seller.profile.id, { name: "P5", price: "5.00" });
		await createTestProduct(db, seller.profile.id, { name: "P50", price: "50.00" });
		await createTestProduct(db, seller.profile.id, { name: "P500", price: "500.00" });

		const out = await listProducts({
			sellerProfileId: seller.profile.id,
			minPrice: "10.00",
			maxPrice: "100.00",
		});
		expect(out.data.map((p) => p.name)).toEqual(["P50"]);
	});

	it("inStock=true requires at least one store with stock>0", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		const pInStock = await createTestProduct(db, seller.profile.id, { name: "S" });
		const pZero = await createTestProduct(db, seller.profile.id, { name: "Z" });
		const pNoStore = await createTestProduct(db, seller.profile.id, { name: "N" });
		await createTestStoreProduct(db, store.id, pInStock.id, { stock: 3 });
		await createTestStoreProduct(db, store.id, pZero.id, { stock: 0 });

		const out = await listProducts({
			sellerProfileId: seller.profile.id,
			inStock: true,
		});
		expect(out.data.map((p) => p.name)).toEqual(["S"]);
	});

	it("excludeDiscountId hides products already in that discount", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p1 = await createTestProduct(db, seller.profile.id, { name: "P1" });
		const p2 = await createTestProduct(db, seller.profile.id, { name: "P2" });
		const d = await createTestDiscount(db, seller.profile.id);
		await addProductsToDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			productIds: [p1.id],
		});

		const out = await listProducts({
			sellerProfileId: seller.profile.id,
			excludeDiscountId: d.id,
		});
		expect(out.data.map((p) => p.name)).toEqual(["P2"]);
	});

	it("filters by productMacroCategoryId via the category join", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const macroA = await createTestMacroCategory(db, { name: "MA" });
		const macroB = await createTestMacroCategory(db, { name: "MB" });
		const catA = await createTestCategory(db, { macroCategoryId: macroA.id, name: "CA" });
		const catB = await createTestCategory(db, { macroCategoryId: macroB.id, name: "CB" });
		await createTestProduct(db, seller.profile.id, { name: "A", categoryIds: [catA.id] });
		await createTestProduct(db, seller.profile.id, { name: "B", categoryIds: [catB.id] });

		const out = await listProducts({
			sellerProfileId: seller.profile.id,
			productMacroCategoryId: macroA.id,
		});
		expect(out.data.map((p) => p.name)).toEqual(["A"]);
	});
});
```

- [ ] **Step 2: Run, verify failure**

Run: `bun test tests/integration/seller-products-filters.test.ts`
Expected: FAIL (new params not supported yet).

- [ ] **Step 3: Modify `listProducts` to accept new params**

Edit `apps/api/src/modules/seller/services/products.ts` around the existing `listProducts` function. Change its signature and body:

```ts
interface ListProductsParams {
	sellerProfileId: string;
	storeId?: string;
	page?: number;
	limit?: number;
	statusFilter?: ProductStatus;
	brandId?: string;
	productCategoryId?: string;
	productMacroCategoryId?: string;
	minPrice?: string;
	maxPrice?: string;
	inStock?: boolean;
	excludeDiscountId?: string;
}
```

In the body, replace the `storeCondition` block with:

```ts
const {
	sellerProfileId,
	storeId,
	statusFilter = "active",
	brandId,
	productCategoryId,
	productMacroCategoryId,
	minPrice,
	maxPrice,
	inStock,
	excludeDiscountId,
} = params;
const { page, limit, offset } = parsePagination(params);

const conditions = [
	eq(product.sellerProfileId, sellerProfileId),
	eq(product.status, statusFilter),
];

if (brandId) conditions.push(eq(product.brandId, brandId));
if (minPrice)
	conditions.push(sql`${product.price} >= ${minPrice}::numeric`);
if (maxPrice)
	conditions.push(sql`${product.price} <= ${maxPrice}::numeric`);

if (storeId) {
	conditions.push(eq(storeProduct.storeId, storeId));
}

if (inStock) {
	conditions.push(
		sql`EXISTS (SELECT 1 FROM store_products sp WHERE sp.product_id = ${product.id} AND sp.stock > 0)`,
	);
}

if (productCategoryId) {
	conditions.push(
		sql`EXISTS (SELECT 1 FROM product_category_assignments pca WHERE pca.product_id = ${product.id} AND pca.product_category_id = ${productCategoryId})`,
	);
}

if (productMacroCategoryId) {
	conditions.push(
		sql`EXISTS (SELECT 1 FROM product_category_assignments pca JOIN product_categories pc ON pc.id = pca.product_category_id WHERE pca.product_id = ${product.id} AND pc.macro_category_id = ${productMacroCategoryId})`,
	);
}

if (excludeDiscountId) {
	conditions.push(
		sql`NOT EXISTS (SELECT 1 FROM discount_products dp WHERE dp.product_id = ${product.id} AND dp.discount_id = ${excludeDiscountId})`,
	);
}

const where = and(...conditions);

// If storeId is provided, JOIN store_products; otherwise plain query
const baseQuery = storeId
	? db
		.select({ id: product.id })
		.from(product)
		.innerJoin(storeProduct, eq(storeProduct.productId, product.id))
		.where(where)
	: db
		.select({ id: product.id })
		.from(product)
		.where(where);

const productIdsRows = await baseQuery.limit(limit).offset(offset);
const productIds = productIdsRows.map((r) => r.id);

const countQuery = storeId
	? db
		.select({ total: count() })
		.from(product)
		.innerJoin(storeProduct, eq(storeProduct.productId, product.id))
		.where(where)
	: db.select({ total: count() }).from(product).where(where);

const [{ total }] = await countQuery;
```

The rest of the function (fetching with relations) stays the same.

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test tests/integration/seller-products-filters.test.ts`
Expected: PASS (6 cases).

Re-run the existing products test too:
Run: `bun test tests/integration/seller-products.test.ts`
Expected: still PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/seller/services/products.ts apps/api/tests/integration/seller-products-filters.test.ts
git commit -m "feat(api): extend listProducts with brand/category/price/inStock/excludeDiscount filters"
```

---

## Task 11: TypeBox schemas for discount routes

**Files:**
- Create: `apps/api/src/lib/schemas/discount.ts`
- Modify: `apps/api/src/lib/schemas/index.ts`

- [ ] **Step 1: Create the schema file**

Create `apps/api/src/lib/schemas/discount.ts`:

```ts
import { t } from "elysia";

export const DiscountStatusSchema = t.Union(
	[t.Literal("active"), t.Literal("paused"), t.Literal("archived")],
	{ description: "Stato persistito della promozione" },
);

export const DiscountOperationalStateSchema = t.Union(
	[
		t.Literal("all"),
		t.Literal("scheduled"),
		t.Literal("running"),
		t.Literal("paused"),
		t.Literal("expired"),
		t.Literal("archived"),
	],
	{ description: "Stato operativo derivato (filtro lista)" },
);

export const DiscountSchema = t.Object({
	id: t.String(),
	sellerProfileId: t.String(),
	title: t.String({ description: "Titolo della promozione" }),
	percent: t.Integer({ minimum: 1, maximum: 99, description: "Percentuale di sconto (1-99)" }),
	startsAt: t.Date({ description: "Data di inizio" }),
	endsAt: t.Nullable(t.Date({ description: "Data di fine (null = senza scadenza)" })),
	status: DiscountStatusSchema,
	createdAt: t.Date(),
	updatedAt: t.Date(),
});

export const DiscountListItemSchema = t.Object({
	...DiscountSchema.properties,
	productCount: t.Integer({ minimum: 0, description: "Numero di prodotti associati" }),
});

export const DiscountCreateBody = t.Object({
	title: t.String({ minLength: 1, maxLength: 80, description: "Titolo della promozione" }),
	percent: t.Integer({ minimum: 1, maximum: 99 }),
	startsAt: t.Date(),
	endsAt: t.Optional(t.Nullable(t.Date())),
	initialProductIds: t.Optional(
		t.Array(t.String(), { maxItems: 100, description: "Prodotti da includere subito" }),
	),
});

export const DiscountUpdateBody = t.Object({
	title: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
	percent: t.Optional(t.Integer({ minimum: 1, maximum: 99 })),
	startsAt: t.Optional(t.Date()),
	endsAt: t.Optional(t.Nullable(t.Date())),
});

export const DiscountProductsBody = t.Object({
	productIds: t.Array(t.String(), { minItems: 1, maxItems: 100 }),
});

export const DiscountListQuery = t.Object({
	page: t.Optional(t.Number({ minimum: 1, default: 1 })),
	limit: t.Optional(t.Number({ minimum: 1, maximum: 100, default: 20 })),
	state: t.Optional(DiscountOperationalStateSchema),
	search: t.Optional(t.String({ maxLength: 80 })),
});

export const DiscountProductRowSchema = t.Object({
	id: t.String(),
	name: t.String(),
	originalPrice: t.String({ description: "Prezzo di listino" }),
	discountedPrice: t.String({ description: "Prezzo scontato (numeric.2)" }),
	brandId: t.Nullable(t.String()),
});

export const DiscountAddResultSchema = t.Object({
	added: t.Integer({ minimum: 0 }),
	alreadyPresent: t.Integer({ minimum: 0 }),
	rejected: t.Array(t.String(), { description: "IDs prodotto non associabili (cross-seller)" }),
});

export const DiscountRemoveResultSchema = t.Object({
	removed: t.Integer({ minimum: 0 }),
});
```

- [ ] **Step 2: Re-export**

Edit `apps/api/src/lib/schemas/index.ts` — add (keep alphabetical):

```ts
export * from "./discount";
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/schemas/discount.ts apps/api/src/lib/schemas/index.ts
git commit -m "feat(api): add typebox schemas for discount API"
```

---

## Task 12: Discount routes module + mount in seller index

**Files:**
- Create: `apps/api/src/modules/seller/routes/discounts.ts`
- Modify: `apps/api/src/modules/seller/index.ts`

- [ ] **Step 1: Create routes file**

Create `apps/api/src/modules/seller/routes/discounts.ts`:

```ts
import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok, okMessage, okPage } from "@/lib/responses";
import {
	DiscountAddResultSchema,
	DiscountCreateBody,
	DiscountListItemSchema,
	DiscountListQuery,
	DiscountProductRowSchema,
	DiscountProductsBody,
	DiscountRemoveResultSchema,
	DiscountSchema,
	DiscountUpdateBody,
	OkMessage,
	okPageRes,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { PaginationQuery } from "@/lib/pagination";
import { withSeller } from "../context";
import {
	addProductsToDiscount,
	archiveDiscount,
	createDiscount,
	getDiscountById,
	getDiscountProducts,
	listDiscounts,
	pauseDiscount,
	removeProductsFromDiscount,
	updateDiscount,
} from "../services/discounts";

export const discountsRoutes = new Elysia()
	.get(
		"/discounts",
		async (ctx) => {
			const { sellerProfile: sp, query } = withSeller(ctx);
			const result = await listDiscounts({
				sellerProfileId: sp.id,
				page: query.page,
				limit: query.limit,
				state: query.state,
				search: query.search,
			});
			return okPage(result.data, result.pagination);
		},
		{
			query: DiscountListQuery,
			response: withErrors({ 200: okPageRes(DiscountListItemSchema) }),
			detail: {
				summary: "Lista promozioni",
				description: "Elenca le promozioni del venditore filtrate per stato operativo. Lo stato 'archived' è incluso solo quando esplicitamente richiesto.",
				tags: ["Seller - Discounts"],
			},
		},
	)
	.get(
		"/discounts/:discountId",
		async (ctx) => {
			const { sellerProfile: sp, params } = withSeller(ctx);
			const d = await getDiscountById({
				discountId: params.discountId,
				sellerProfileId: sp.id,
			});
			return ok(d);
		},
		{
			params: t.Object({ discountId: t.String() }),
			response: withErrors({
				200: okRes(t.Object({ ...DiscountSchema.properties, productCount: t.Integer() })),
			}),
			detail: {
				summary: "Dettaglio promozione",
				description: "Restituisce una promozione con il conteggio dei prodotti associati.",
				tags: ["Seller - Discounts"],
			},
		},
	)
	.get(
		"/discounts/:discountId/products",
		async (ctx) => {
			const { sellerProfile: sp, params, query } = withSeller(ctx);
			const out = await getDiscountProducts({
				discountId: params.discountId,
				sellerProfileId: sp.id,
				page: query.page,
				limit: query.limit,
			});
			return okPage(out.data, out.pagination);
		},
		{
			params: t.Object({ discountId: t.String() }),
			query: PaginationQuery,
			response: withErrors({ 200: okPageRes(DiscountProductRowSchema) }),
			detail: {
				summary: "Prodotti inclusi nella promozione",
				description: "Lista paginata dei prodotti inclusi, con prezzo originale e scontato.",
				tags: ["Seller - Discounts"],
			},
		},
	)
	.post(
		"/discounts",
		async (ctx) => {
			const { sellerProfile: sp, body, user, store } = withSeller(ctx);
			const pino = getLogger(store);
			const d = await createDiscount({
				sellerProfileId: sp.id,
				title: body.title,
				percent: body.percent,
				startsAt: body.startsAt,
				endsAt: body.endsAt ?? null,
			});
			if (body.initialProductIds?.length) {
				await addProductsToDiscount({
					discountId: d.id,
					sellerProfileId: sp.id,
					productIds: body.initialProductIds,
				});
			}
			pino.info(
				{
					userId: user.id,
					sellerProfileId: sp.id,
					discountId: d.id,
					percent: d.percent,
					initialProductCount: body.initialProductIds?.length ?? 0,
					action: "discount_created",
				},
				"Promozione creata",
			);
			return ok(d);
		},
		{
			body: DiscountCreateBody,
			response: withErrors({ 200: okRes(DiscountSchema) }),
			detail: {
				summary: "Crea promozione",
				description: "Crea una nuova promozione del venditore, opzionalmente con prodotti iniziali.",
				tags: ["Seller - Discounts"],
			},
		},
	)
	.patch(
		"/discounts/:discountId",
		async (ctx) => {
			const { sellerProfile: sp, params, body } = withSeller(ctx);
			const out = await updateDiscount({
				discountId: params.discountId,
				sellerProfileId: sp.id,
				patch: body,
			});
			return ok(out);
		},
		{
			params: t.Object({ discountId: t.String() }),
			body: DiscountUpdateBody,
			response: withConflictErrors({ 200: okRes(DiscountSchema) }),
			detail: {
				summary: "Modifica promozione",
				description: "Modifica i campi di una promozione. Percentuale e data di inizio non sono modificabili una volta partita.",
				tags: ["Seller - Discounts"],
			},
		},
	)
	.post(
		"/discounts/:discountId/pause",
		async (ctx) => {
			const { sellerProfile: sp, params } = withSeller(ctx);
			const out = await pauseDiscount({
				discountId: params.discountId,
				sellerProfileId: sp.id,
			});
			return ok(out);
		},
		{
			params: t.Object({ discountId: t.String() }),
			response: withConflictErrors({ 200: okRes(DiscountSchema) }),
			detail: {
				summary: "Pausa/riprendi promozione",
				description: "Toggle tra status 'active' e 'paused'. Errore 409 se archiviata.",
				tags: ["Seller - Discounts"],
			},
		},
	)
	.post(
		"/discounts/:discountId/archive",
		async (ctx) => {
			const { sellerProfile: sp, params } = withSeller(ctx);
			const out = await archiveDiscount({
				discountId: params.discountId,
				sellerProfileId: sp.id,
			});
			return ok(out);
		},
		{
			params: t.Object({ discountId: t.String() }),
			response: withConflictErrors({ 200: okRes(DiscountSchema) }),
			detail: {
				summary: "Archivia promozione",
				description: "Imposta status='archived'. Errore 409 se già archiviata.",
				tags: ["Seller - Discounts"],
			},
		},
	)
	.post(
		"/discounts/:discountId/products",
		async (ctx) => {
			const { sellerProfile: sp, params, body } = withSeller(ctx);
			const out = await addProductsToDiscount({
				discountId: params.discountId,
				sellerProfileId: sp.id,
				productIds: body.productIds,
			});
			return ok(out);
		},
		{
			params: t.Object({ discountId: t.String() }),
			body: DiscountProductsBody,
			response: withErrors({ 200: okRes(DiscountAddResultSchema) }),
			detail: {
				summary: "Aggiungi prodotti alla promozione",
				description: "Aggiunge prodotti (idempotente). I prodotti di altri venditori finiscono in 'rejected'. Limite 100 IDs.",
				tags: ["Seller - Discounts"],
			},
		},
	)
	.delete(
		"/discounts/:discountId/products",
		async (ctx) => {
			const { sellerProfile: sp, params, body } = withSeller(ctx);
			const out = await removeProductsFromDiscount({
				discountId: params.discountId,
				sellerProfileId: sp.id,
				productIds: body.productIds,
			});
			return ok(out);
		},
		{
			params: t.Object({ discountId: t.String() }),
			body: DiscountProductsBody,
			response: withErrors({ 200: okRes(DiscountRemoveResultSchema) }),
			detail: {
				summary: "Rimuovi prodotti dalla promozione",
				description: "Rimuove i prodotti specificati. Limite 100 IDs.",
				tags: ["Seller - Discounts"],
			},
		},
	)
	.delete(
		"/discounts/:discountId/products/:productId",
		async (ctx) => {
			const { sellerProfile: sp, params } = withSeller(ctx);
			await removeProductsFromDiscount({
				discountId: params.discountId,
				sellerProfileId: sp.id,
				productIds: [params.productId],
			});
			return okMessage("Prodotto rimosso dalla promozione");
		},
		{
			params: t.Object({
				discountId: t.String(),
				productId: t.String(),
			}),
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Rimuovi singolo prodotto",
				description: "Rimuove un solo prodotto dalla promozione.",
				tags: ["Seller - Discounts"],
			},
		},
	);
```

- [ ] **Step 2: Mount in seller module**

Edit `apps/api/src/modules/seller/index.ts`:
- Add import: `import { discountsRoutes } from "./routes/discounts";`
- After `.use(settingsRoutes)` add `.use(discountsRoutes)` inside the VAT-verified guard.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Verify Eden Treaty types reach the frontend**

Run from root: `bun run typecheck`
Expected: PASS in all workspaces. If `apps/seller` fails because Eden Treaty cannot resolve types, ensure `apps/api/src/index.ts` exports `type App` reflecting the new module.

- [ ] **Step 5: Manual smoke**

Start the API: `bun run dev:api`. Hit `GET http://localhost:3000/openapi` and verify the new endpoints appear under the `Seller - Discounts` tag.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/seller/routes/discounts.ts apps/api/src/modules/seller/index.ts
git commit -m "feat(api): mount seller discounts routes module"
```

---

## Task 13: Extend `GET /seller/products` route with new query params

**Files:**
- Modify: `apps/api/src/modules/seller/routes/products.ts`

- [ ] **Step 1: Update the query schema and call**

In `apps/api/src/modules/seller/routes/products.ts`, replace the `query` schema of `GET /products` (the first endpoint, lines ~59-77) with:

```ts
query: t.Composite([
	PaginationQuery,
	t.Object({
		storeId: t.Optional(
			t.String({ description: "ID del negozio attivo (se assente: seller-wide)" }),
		),
		statusFilter: t.Optional(
			t.Union(
				[t.Literal("active"), t.Literal("disabled"), t.Literal("trashed")],
				{ description: "Filtra per stato. Default 'active'.", default: "active" },
			),
		),
		brandId: t.Optional(t.String({ description: "Filtra per marca" })),
		productCategoryId: t.Optional(t.String({ description: "Filtra per categoria" })),
		productMacroCategoryId: t.Optional(t.String({ description: "Filtra per macro-categoria" })),
		minPrice: t.Optional(t.String({ pattern: "^\\d+(\\.\\d{1,2})?$", description: "Prezzo minimo" })),
		maxPrice: t.Optional(t.String({ pattern: "^\\d+(\\.\\d{1,2})?$", description: "Prezzo massimo" })),
		inStock: t.Optional(t.Boolean({ description: "Solo prodotti con stock>0" })),
		excludeDiscountId: t.Optional(t.String({ description: "Escludi prodotti già in questa promo" })),
	}),
]),
```

Also remove the `ensureStoreAccess` block when `query.storeId` is absent. Replace the handler body around lines 42-56 with:

```ts
async (ctx) => {
	const { sellerProfile: sp, query, isOwner, user } = withSeller(ctx);
	if (query.storeId) {
		await ensureStoreAccess(query.storeId, {
			userId: user.id,
			sellerProfileId: sp.id,
			isOwner,
		});
	}
	const result = await listProducts({
		sellerProfileId: sp.id,
		storeId: query.storeId,
		page: query.page,
		limit: query.limit,
		statusFilter: query.statusFilter,
		brandId: query.brandId,
		productCategoryId: query.productCategoryId,
		productMacroCategoryId: query.productMacroCategoryId,
		minPrice: query.minPrice,
		maxPrice: query.maxPrice,
		inStock: query.inStock,
		excludeDiscountId: query.excludeDiscountId,
	});
	return okPage(result.data, result.pagination);
},
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Existing seller-products tests still pass**

Run: `bun test tests/integration/seller-products.test.ts`
Expected: PASS (no breaks).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/seller/routes/products.ts
git commit -m "feat(api): expose new product filters on GET /seller/products"
```

---

## Task 14: Customer search — extend `SearchResultSchema` with discount fields and use `getBestActiveDiscounts`

**Files:**
- Modify: `apps/api/src/lib/schemas/entities.ts`
- Modify: `apps/api/src/modules/customer/services/search.ts`
- Modify: `apps/api/tests/integration/customer-search.test.ts`

- [ ] **Step 1: Append discount fields to `SearchResultSchema`**

Edit `apps/api/src/lib/schemas/entities.ts` (around line 599). Add to the `SearchResultSchema` object:

```ts
export const SearchResultSchema = t.Object({
	id: t.String(),
	name: t.String({ description: "Nome del prodotto" }),
	description: t.Nullable(t.String({ description: "Descrizione del prodotto" })),
	price: t.String({ description: "Prezzo di listino" }),
	distance: t.Number({ minimum: 0, description: "Distanza in metri dal punto di ricerca" }),
	rank: t.Number({ minimum: 0, description: "Punteggio di rilevanza full-text (0 se nessuna query testuale)" }),
	images: t.Array(
		t.Object({
			id: t.String(),
			url: t.String({ description: "URL dell'immagine" }),
			position: t.Number({ minimum: 0 }),
		}),
		{ description: "Immagini del prodotto ordinate per posizione" },
	),
	discountedPrice: t.Nullable(t.String({ description: "Prezzo scontato, se promo attiva" })),
	discountPercent: t.Nullable(t.Integer({ minimum: 1, maximum: 99 })),
	discountTitle: t.Nullable(t.String()),
	discountEndsAt: t.Nullable(t.Date()),
});
```

- [ ] **Step 2: Write a failing test**

Append to `apps/api/tests/integration/customer-search.test.ts` (the test setup is already there):

```ts
import { addProductsToDiscount } from "@/modules/seller/services/discounts";
import { createTestDiscount } from "../helpers/fixtures";

describe("search: discount annotation", () => {
	it("returns discount fields for products with an active discount", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		const p = await createTestProduct(db, seller.profile.id, {
			name: "Maglione",
			price: "100.00",
		});
		await createTestStoreProduct(db, store.id, p.id, { stock: 5 });
		const d = await createTestDiscount(db, seller.profile.id, {
			percent: 25,
			title: "Saldi",
		});
		await addProductsToDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			productIds: [p.id],
		});

		const out = await searchProducts({ q: "maglione" });
		const item = out.data[0];
		expect(item.discountedPrice).toBe("75.00");
		expect(item.discountPercent).toBe(25);
		expect(item.discountTitle).toBe("Saldi");
	});

	it("returns null discount fields for products without active discount", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		const p = await createTestProduct(db, seller.profile.id, { name: "Sciarpa" });
		await createTestStoreProduct(db, store.id, p.id, { stock: 3 });

		const out = await searchProducts({ q: "sciarpa" });
		const item = out.data[0];
		expect(item.discountedPrice).toBeNull();
		expect(item.discountPercent).toBeNull();
	});
});
```

- [ ] **Step 3: Run, verify failure**

Run: `bun test tests/integration/customer-search.test.ts -t "discount annotation"`
Expected: FAIL.

- [ ] **Step 4: Modify `searchProducts`**

Edit `apps/api/src/modules/customer/services/search.ts`. After the existing list of results is built, annotate them:

```ts
import { getBestActiveDiscounts } from "@/modules/seller/services/discount-pricing";

// inside searchProducts, before returning:
const productIds = data.map((r) => r.id);
const discountMap = await getBestActiveDiscounts(productIds);
const annotated = data.map((r) => {
	const info = discountMap.get(r.id);
	return {
		...r,
		discountedPrice: info?.discountedPrice ?? null,
		discountPercent: info?.percent ?? null,
		discountTitle: info?.title ?? null,
		discountEndsAt: info?.endsAt ?? null,
	};
});
return { data: annotated, pagination };
```

(Adapt variable names to whatever the existing implementation uses — open `search.ts` and locate the final mapping; integrate the annotation before the return.)

- [ ] **Step 5: Run, verify pass**

Run: `bun test tests/integration/customer-search.test.ts`
Expected: PASS, including original cases.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/schemas/entities.ts apps/api/src/modules/customer/services/search.ts apps/api/tests/integration/customer-search.test.ts
git commit -m "feat(api): annotate customer search with active discount info"
```

---

## Task 15: `DiscountedPrice` component in `@bibs/ui`

**Files:**
- Create: `packages/ui/src/components/discounted-price.tsx`

- [ ] **Step 1: Create the component**

```tsx
// packages/ui/src/components/discounted-price.tsx
import { cn } from "../lib/utils";
import { Badge } from "./badge";

export interface DiscountedPriceProps {
	originalPrice: string | number;
	discountedPrice?: string | number | null;
	percent?: number | null;
	currency?: string;
	className?: string;
	size?: "sm" | "md" | "lg";
}

function formatPrice(value: string | number, currency = "EUR") {
	const num = typeof value === "string" ? Number.parseFloat(value) : value;
	return new Intl.NumberFormat("it-IT", {
		style: "currency",
		currency,
	}).format(num);
}

export function DiscountedPrice({
	originalPrice,
	discountedPrice,
	percent,
	currency = "EUR",
	className,
	size = "md",
}: DiscountedPriceProps) {
	const hasDiscount =
		discountedPrice !== null &&
		discountedPrice !== undefined &&
		percent !== null &&
		percent !== undefined;

	const mainSize =
		size === "lg"
			? "text-2xl font-semibold"
			: size === "sm"
				? "text-sm font-medium"
				: "text-base font-medium";
	const strikeSize = size === "lg" ? "text-base" : "text-xs";

	if (!hasDiscount) {
		return (
			<span className={cn("inline-flex items-baseline", mainSize, className)}>
				{formatPrice(originalPrice, currency)}
			</span>
		);
	}

	return (
		<span
			className={cn(
				"inline-flex items-baseline gap-2",
				className,
			)}
		>
			<span className={cn("text-foreground", mainSize)}>
				{formatPrice(discountedPrice, currency)}
			</span>
			<span className={cn("text-muted-foreground line-through", strikeSize)}>
				{formatPrice(originalPrice, currency)}
			</span>
			<Badge variant="secondary" className="text-xs">
				-{percent}%
			</Badge>
		</span>
	);
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/discounted-price.tsx
git commit -m "feat(ui): add DiscountedPrice shared component"
```

---

## Task 16: i18n keys for Promotions in seller messages

**Files:**
- Modify: `apps/seller/messages/it.json`
- Modify: `apps/seller/messages/en.json`

- [ ] **Step 1: Add keys to it.json**

Append (keep JSON formatted; the project uses Paraglide; pick a logical insertion point alphabetically near existing keys):

```json
"nav_promotions": "Promozioni",

"promotions_page_title": "Promozioni",
"promotions_page_subtitle": "Gestisci sconti a percentuale sui tuoi prodotti",
"promotions_new_cta": "Nuova promozione",
"promotions_empty_all": "Non hai ancora promozioni",
"promotions_empty_running": "Nessuna promozione in corso",
"promotions_empty_scheduled": "Nessuna promozione pianificata",
"promotions_empty_paused": "Nessuna promozione in pausa",
"promotions_empty_expired": "Nessuna promozione scaduta",
"promotions_empty_archived": "Nessuna promozione archiviata",

"promotions_state_all": "Tutte",
"promotions_state_running": "In corso",
"promotions_state_scheduled": "Pianificate",
"promotions_state_paused": "In pausa",
"promotions_state_expired": "Scadute",
"promotions_state_archived": "Archiviate",

"promotions_col_title": "Titolo",
"promotions_col_discount": "Sconto",
"promotions_col_period": "Periodo",
"promotions_col_products": "Prodotti",
"promotions_col_state": "Stato",

"promotions_action_edit": "Modifica",
"promotions_action_pause": "Metti in pausa",
"promotions_action_resume": "Riprendi",
"promotions_action_archive": "Archivia",

"promotions_form_title_label": "Titolo",
"promotions_form_title_placeholder": "Es. Saldi estivi",
"promotions_form_percent_label": "Percentuale di sconto",
"promotions_form_starts_at_label": "Inizio",
"promotions_form_ends_at_label": "Fine",
"promotions_form_no_end_date": "Senza data di fine",
"promotions_form_products_section": "Prodotti inclusi",
"promotions_form_products_count": "{count} prodotti selezionati",
"promotions_form_add_products": "Aggiungi prodotti",
"promotions_form_submit_new": "Crea promozione",
"promotions_form_submit_edit": "Salva modifiche",
"promotions_form_started_disabled_hint": "Promo già iniziata: alcuni campi non sono modificabili",

"promotions_picker_title": "Aggiungi prodotti alla promozione",
"promotions_picker_search_placeholder": "Cerca per nome o EAN",
"promotions_picker_filter_brand": "Marca",
"promotions_picker_filter_macro": "Macro-categoria",
"promotions_picker_filter_category": "Categoria",
"promotions_picker_filter_price_min": "Prezzo min",
"promotions_picker_filter_price_max": "Prezzo max",
"promotions_picker_filter_in_stock": "Solo in stock",
"promotions_picker_filter_include_disabled": "Includi disabilitati",
"promotions_picker_reset_filters": "Reset filtri",
"promotions_picker_select_all": "Seleziona tutti i risultati",
"promotions_picker_deselect_all": "Deseleziona tutti",
"promotions_picker_selected_count": "{count} selezionati",
"promotions_picker_add_cta": "Aggiungi",

"promotions_included_remove": "Rimuovi",
"promotions_included_remove_bulk": "Rimuovi selezionati",

"promotions_toast_created": "Promozione creata",
"promotions_toast_updated": "Promozione aggiornata",
"promotions_toast_paused": "Promozione in pausa",
"promotions_toast_resumed": "Promozione ripresa",
"promotions_toast_archived": "Promozione archiviata",
"promotions_toast_products_added": "{added} aggiunti, {alreadyPresent} già presenti, {rejected} rifiutati",
"promotions_toast_products_removed": "{count} rimossi"
```

- [ ] **Step 2: Mirror to en.json**

Same structure in `apps/seller/messages/en.json` with English values. Examples:
- `"nav_promotions": "Promotions"`
- `"promotions_state_running": "Running"`
- `"promotions_form_no_end_date": "No end date"`
- `"promotions_toast_products_added": "{added} added, {alreadyPresent} already in, {rejected} rejected"`

- [ ] **Step 3: Compile Paraglide**

Paraglide compiles on `dev` / `typecheck`. Run:
```bash
cd apps/seller && bun run pretypecheck
cd ../.. && bun run typecheck
```
Expected: PASS, generated `src/paraglide/messages.js` includes the new keys.

- [ ] **Step 4: Commit**

```bash
git add apps/seller/messages/it.json apps/seller/messages/en.json
git commit -m "feat(seller): add i18n keys for promotions section"
```

---

## Task 17: Add "Promozioni" nav entry in seller sidebar

**Files:**
- Modify: `apps/seller/src/components/app-sidebar.tsx`

- [ ] **Step 1: Add the nav item**

Edit `apps/seller/src/components/app-sidebar.tsx`. Update the imports:

```tsx
import { HomeIcon, PackageIcon, SettingsIcon, TagIcon } from "lucide-react";
```

Add an entry to `navItems` between "Prodotti" and "Impostazioni negozio":

```tsx
{
	title: "Promozioni",
	to: "/promotions" as const,
	icon: TagIcon,
	match: (p: string) => p.startsWith("/promotions"),
},
```

(Translate `title` via Paraglide if the rest of the sidebar uses it; if it's currently hard-coded "Prodotti", keep "Promozioni" hard-coded for consistency.)

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/seller/src/components/app-sidebar.tsx
git commit -m "feat(seller): add Promozioni nav entry"
```

---

## Task 18: Promotion routes scaffolding (layout + index + new + $discountId)

**Files:**
- Create: `apps/seller/src/routes/_authenticated/promotions.tsx`
- Create: `apps/seller/src/routes/_authenticated/promotions/index.tsx`
- Create: `apps/seller/src/routes/_authenticated/promotions/new.tsx`
- Create: `apps/seller/src/routes/_authenticated/promotions/$discountId.tsx`

- [ ] **Step 1: Create the layout**

```tsx
// apps/seller/src/routes/_authenticated/promotions.tsx
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/promotions")({
	component: PromotionsLayout,
});

function PromotionsLayout() {
	return <Outlet />;
}
```

- [ ] **Step 2: Create the list page (skeleton, real impl in next tasks)**

```tsx
// apps/seller/src/routes/_authenticated/promotions/index.tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/promotions/")({
	component: PromotionsListPage,
	validateSearch: (search: Record<string, unknown>) => {
		const validStates = ["all", "running", "scheduled", "paused", "expired", "archived"] as const;
		type State = (typeof validStates)[number];
		const s = search.state;
		const state: State = validStates.includes(s as State) ? (s as State) : "all";
		return {
			page: Number(search.page ?? 1),
			limit: Number(search.limit ?? 20),
			state,
		};
	},
});

function PromotionsListPage() {
	return <div>Lista promozioni (placeholder)</div>;
}
```

- [ ] **Step 3: Create the new page (skeleton)**

```tsx
// apps/seller/src/routes/_authenticated/promotions/new.tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/promotions/new")({
	component: NewPromotionPage,
});

function NewPromotionPage() {
	return <div>Nuova promozione (placeholder)</div>;
}
```

- [ ] **Step 4: Create the detail page (skeleton)**

```tsx
// apps/seller/src/routes/_authenticated/promotions/$discountId.tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/promotions/$discountId")({
	component: PromotionDetailPage,
});

function PromotionDetailPage() {
	const { discountId } = Route.useParams();
	return <div>Dettaglio promozione {discountId} (placeholder)</div>;
}
```

- [ ] **Step 5: Generate route tree**

```bash
cd apps/seller && bun run pretypecheck
```
Verify `src/routeTree.gen.ts` now includes the new routes.

- [ ] **Step 6: Typecheck**

Run from root: `bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Manual check**

`bun run dev:seller`, navigate to `/promotions`, `/promotions/new`, `/promotions/abc` — all render placeholder text. Sidebar shows "Promozioni" entry active when on `/promotions/*`.

- [ ] **Step 8: Commit**

```bash
git add apps/seller/src/routes/_authenticated/promotions.tsx apps/seller/src/routes/_authenticated/promotions/
git commit -m "feat(seller): scaffold promotions routes"
```

---

## Task 19: `PromotionStateTabs` component

**Files:**
- Create: `apps/seller/src/features/promotions/components/promotion-state-tabs.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/seller/src/features/promotions/components/promotion-state-tabs.tsx
import { Tabs, TabsList, TabsTrigger } from "@bibs/ui/components/tabs";
import { m } from "@/paraglide/messages";

export type PromotionState =
	| "all"
	| "running"
	| "scheduled"
	| "paused"
	| "expired"
	| "archived";

interface Props {
	value: PromotionState;
	onChange: (v: PromotionState) => void;
}

const ORDER: { value: PromotionState; label: () => string }[] = [
	{ value: "all", label: () => m.promotions_state_all() },
	{ value: "running", label: () => m.promotions_state_running() },
	{ value: "scheduled", label: () => m.promotions_state_scheduled() },
	{ value: "paused", label: () => m.promotions_state_paused() },
	{ value: "expired", label: () => m.promotions_state_expired() },
	{ value: "archived", label: () => m.promotions_state_archived() },
];

export function PromotionStateTabs({ value, onChange }: Props) {
	return (
		<Tabs value={value} onValueChange={(v) => onChange(v as PromotionState)}>
			<TabsList>
				{ORDER.map((s) => (
					<TabsTrigger key={s.value} value={s.value}>
						{s.label()}
					</TabsTrigger>
				))}
			</TabsList>
		</Tabs>
	);
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
bun run typecheck
git add apps/seller/src/features/promotions/components/promotion-state-tabs.tsx
git commit -m "feat(seller): add PromotionStateTabs component"
```

---

## Task 20: Promotion list table with TanStack Query + actions

**Files:**
- Create: `apps/seller/src/features/promotions/hooks/use-discounts.ts`
- Create: `apps/seller/src/features/promotions/components/promotion-list-table.tsx`
- Modify: `apps/seller/src/routes/_authenticated/promotions/index.tsx`

- [ ] **Step 1: Create query/mutation hooks**

```tsx
// apps/seller/src/features/promotions/hooks/use-discounts.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@bibs/ui/components/sonner";
import { api } from "@/lib/api";
import type { PromotionState } from "@/features/promotions/components/promotion-state-tabs";

const DISCOUNTS_KEY = ["discounts"] as const;

interface ListParams {
	page: number;
	limit: number;
	state: PromotionState;
	search?: string;
}

export function useDiscountsList(params: ListParams) {
	return useQuery({
		queryKey: [...DISCOUNTS_KEY, "list", params],
		queryFn: async () => {
			const res = await api().seller.discounts.get({ query: params });
			if (res.error) throw new Error(res.error.value?.message || "Errore caricamento");
			return res.data;
		},
	});
}

export function useDiscount(discountId: string | undefined) {
	return useQuery({
		queryKey: [...DISCOUNTS_KEY, "detail", discountId],
		queryFn: async () => {
			if (!discountId) throw new Error("missing id");
			const res = await api().seller.discounts({ discountId }).get();
			if (res.error) throw new Error(res.error.value?.message || "Errore caricamento");
			return res.data;
		},
		enabled: !!discountId,
	});
}

export function usePauseDiscount() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (discountId: string) => {
			const res = await api().seller.discounts({ discountId }).pause.post();
			if (res.error) throw new Error(res.error.value?.message || "Errore");
			return res.data;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: DISCOUNTS_KEY });
		},
	});
}

export function useArchiveDiscount() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (discountId: string) => {
			const res = await api().seller.discounts({ discountId }).archive.post();
			if (res.error) throw new Error(res.error.value?.message || "Errore");
			return res.data;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: DISCOUNTS_KEY });
		},
	});
}
```

(If the Eden Treaty method chain syntax doesn't match exactly — verify by typing `api().seller.discounts` in editor and accept whatever autocomplete suggests. Adjust accordingly.)

- [ ] **Step 2: Create the table component**

```tsx
// apps/seller/src/features/promotions/components/promotion-list-table.tsx
import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@bibs/ui/components/dropdown-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@bibs/ui/components/table";
import { Link } from "@tanstack/react-router";
import { MoreVerticalIcon } from "lucide-react";
import { m } from "@/paraglide/messages";

interface DiscountRow {
	id: string;
	title: string;
	percent: number;
	startsAt: string;
	endsAt: string | null;
	status: "active" | "paused" | "archived";
	productCount: number;
}

interface Props {
	rows: DiscountRow[];
	onPauseToggle: (id: string) => void;
	onArchive: (id: string) => void;
}

function operationalState(r: DiscountRow): "running" | "scheduled" | "paused" | "expired" | "archived" {
	if (r.status === "archived") return "archived";
	if (r.status === "paused") return "paused";
	const now = Date.now();
	const startsAt = new Date(r.startsAt).getTime();
	if (now < startsAt) return "scheduled";
	const endsAt = r.endsAt ? new Date(r.endsAt).getTime() : null;
	if (endsAt !== null && now > endsAt) return "expired";
	return "running";
}

function formatDate(iso: string) {
	return new Date(iso).toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

const STATE_LABELS = {
	running: m.promotions_state_running,
	scheduled: m.promotions_state_scheduled,
	paused: m.promotions_state_paused,
	expired: m.promotions_state_expired,
	archived: m.promotions_state_archived,
} as const;

export function PromotionListTable({ rows, onPauseToggle, onArchive }: Props) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>{m.promotions_col_title()}</TableHead>
					<TableHead>{m.promotions_col_discount()}</TableHead>
					<TableHead>{m.promotions_col_period()}</TableHead>
					<TableHead>{m.promotions_col_products()}</TableHead>
					<TableHead>{m.promotions_col_state()}</TableHead>
					<TableHead />
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((r) => {
					const state = operationalState(r);
					return (
						<TableRow key={r.id}>
							<TableCell>
								<Link to="/promotions/$discountId" params={{ discountId: r.id }} className="font-medium hover:underline">
									{r.title}
								</Link>
							</TableCell>
							<TableCell>
								<Badge variant="secondary">-{r.percent}%</Badge>
							</TableCell>
							<TableCell className="text-sm">
								{formatDate(r.startsAt)} → {r.endsAt ? formatDate(r.endsAt) : "∞"}
							</TableCell>
							<TableCell>{r.productCount}</TableCell>
							<TableCell>
								<Badge variant="outline">{STATE_LABELS[state]()}</Badge>
							</TableCell>
							<TableCell className="text-right">
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="ghost" size="icon">
											<MoreVerticalIcon className="size-4" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem asChild>
											<Link to="/promotions/$discountId" params={{ discountId: r.id }}>
												{m.promotions_action_edit()}
											</Link>
										</DropdownMenuItem>
										{r.status !== "archived" && (
											<DropdownMenuItem onSelect={() => onPauseToggle(r.id)}>
												{r.status === "paused" ? m.promotions_action_resume() : m.promotions_action_pause()}
											</DropdownMenuItem>
										)}
										{r.status !== "archived" && (
											<DropdownMenuItem onSelect={() => onArchive(r.id)}>
												{m.promotions_action_archive()}
											</DropdownMenuItem>
										)}
									</DropdownMenuContent>
								</DropdownMenu>
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}
```

- [ ] **Step 3: Wire up the list page**

Replace `apps/seller/src/routes/_authenticated/promotions/index.tsx` body with a real implementation that uses `PromotionStateTabs`, `useDiscountsList`, `PromotionListTable`, `DataPagination`, `PageSizeSelector`. Pattern mirrors `apps/seller/src/routes/_authenticated/products/index.tsx`. Include header with "Nuova promozione" button → `Link to="/promotions/new"`.

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```
Expected: PASS.

- [ ] **Step 5: Manual check**

`bun run dev:seller`. Visit `/promotions`. With empty DB, see empty state per tab. Create a promo via the API directly (curl or Studio) and verify it appears in the table.

- [ ] **Step 6: Commit**

```bash
git add apps/seller/src/features/promotions/ apps/seller/src/routes/_authenticated/promotions/index.tsx
git commit -m "feat(seller): wire promotions list page with tabs and actions"
```

---

## Task 21: `DiscountForm` shared component (used by /new and /$discountId)

**Files:**
- Create: `apps/seller/src/features/promotions/components/discount-form.tsx`

- [ ] **Step 1: Define the form schema and component**

```tsx
// apps/seller/src/features/promotions/components/discount-form.tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@bibs/ui/components/button";
import { Input } from "@bibs/ui/components/input";
import { Switch } from "@bibs/ui/components/switch";
import { Label } from "@bibs/ui/components/label";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { m } from "@/paraglide/messages";

export const discountFormSchema = z
	.object({
		title: z.string().min(1).max(80),
		percent: z.coerce.number().int().min(1).max(99),
		startsAt: z.string().min(1), // ISO string from <input type="datetime-local">
		endsAt: z.string().optional(),
		noEndDate: z.boolean(),
	})
	.refine(
		(v) => v.noEndDate || (v.endsAt && new Date(v.endsAt) > new Date(v.startsAt)),
		{ message: "La data di fine deve essere successiva all'inizio", path: ["endsAt"] },
	);

export type DiscountFormValues = z.infer<typeof discountFormSchema>;

export interface DiscountFormProps {
	defaultValues?: Partial<DiscountFormValues>;
	disablePercent?: boolean;
	disableStartsAt?: boolean;
	submitLabel: string;
	onSubmit: (values: DiscountFormValues) => Promise<void> | void;
	submitting?: boolean;
}

export function DiscountForm({
	defaultValues,
	disablePercent,
	disableStartsAt,
	submitLabel,
	onSubmit,
	submitting,
}: DiscountFormProps) {
	const form = useForm<DiscountFormValues>({
		resolver: zodResolver(discountFormSchema),
		defaultValues: {
			title: "",
			percent: 10,
			startsAt: new Date().toISOString().slice(0, 16),
			endsAt: "",
			noEndDate: false,
			...defaultValues,
		},
	});

	const noEndDate = form.watch("noEndDate");
	useEffect(() => {
		if (noEndDate) form.setValue("endsAt", "");
	}, [noEndDate, form]);

	return (
		<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 max-w-2xl">
			<div className="space-y-2">
				<Label htmlFor="title">{m.promotions_form_title_label()}</Label>
				<Input
					id="title"
					placeholder={m.promotions_form_title_placeholder()}
					{...form.register("title")}
				/>
				{form.formState.errors.title && (
					<p className="text-destructive text-sm">{form.formState.errors.title.message}</p>
				)}
			</div>

			<div className="space-y-2">
				<Label htmlFor="percent">{m.promotions_form_percent_label()}</Label>
				<div className="relative max-w-[8rem]">
					<Input
						id="percent"
						type="number"
						min={1}
						max={99}
						step={1}
						disabled={disablePercent}
						{...form.register("percent")}
					/>
					<span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
						%
					</span>
				</div>
				{form.formState.errors.percent && (
					<p className="text-destructive text-sm">{form.formState.errors.percent.message}</p>
				)}
			</div>

			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-2">
					<Label htmlFor="startsAt">{m.promotions_form_starts_at_label()}</Label>
					<Input
						id="startsAt"
						type="datetime-local"
						disabled={disableStartsAt}
						{...form.register("startsAt")}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="endsAt">{m.promotions_form_ends_at_label()}</Label>
					<Input id="endsAt" type="datetime-local" disabled={noEndDate} {...form.register("endsAt")} />
					{form.formState.errors.endsAt && (
						<p className="text-destructive text-sm">{form.formState.errors.endsAt.message}</p>
					)}
				</div>
			</div>

			<div className="flex items-center gap-2">
				<Switch
					id="noEndDate"
					checked={noEndDate}
					onCheckedChange={(v) => form.setValue("noEndDate", v)}
				/>
				<Label htmlFor="noEndDate">{m.promotions_form_no_end_date()}</Label>
			</div>

			{(disablePercent || disableStartsAt) && (
				<p className="text-muted-foreground text-xs">
					{m.promotions_form_started_disabled_hint()}
				</p>
			)}

			<Button type="submit" disabled={submitting}>
				{submitLabel}
			</Button>
		</form>
	);
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
bun run typecheck
git add apps/seller/src/features/promotions/components/discount-form.tsx
git commit -m "feat(seller): add DiscountForm shared component"
```

---

## Task 22: `ProductPickerSheet` component

**Files:**
- Create: `apps/seller/src/features/promotions/components/product-picker-sheet.tsx`

- [ ] **Step 1: Implement the picker**

```tsx
// apps/seller/src/features/promotions/components/product-picker-sheet.tsx
import { Button } from "@bibs/ui/components/button";
import { Checkbox } from "@bibs/ui/components/checkbox";
import { Combobox } from "@bibs/ui/components/combobox";
import { Input } from "@bibs/ui/components/input";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@bibs/ui/components/sheet";
import { Switch } from "@bibs/ui/components/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@bibs/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

interface Props {
	open: boolean;
	onOpenChange: (v: boolean) => void;
	excludeDiscountId?: string;
	alreadySelectedIds?: Set<string>;
	onConfirm: (productIds: string[]) => void;
}

export function ProductPickerSheet({
	open,
	onOpenChange,
	excludeDiscountId,
	alreadySelectedIds,
	onConfirm,
}: Props) {
	const [search, setSearch] = useState("");
	const debouncedSearch = useDebouncedValue(search, 300);
	const [brandId, setBrandId] = useState<string | undefined>(undefined);
	const [macroId, setMacroId] = useState<string | undefined>(undefined);
	const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
	const [minPrice, setMinPrice] = useState("");
	const [maxPrice, setMaxPrice] = useState("");
	const [inStock, setInStock] = useState(true);
	const [includeDisabled, setIncludeDisabled] = useState(false);
	const [selected, setSelected] = useState<Set<string>>(new Set());

	const { data } = useQuery({
		queryKey: [
			"product-picker",
			debouncedSearch,
			brandId,
			macroId,
			categoryId,
			minPrice,
			maxPrice,
			inStock,
			includeDisabled,
			excludeDiscountId,
		],
		queryFn: async () => {
			const res = await api().seller.products.get({
				query: {
					page: 1,
					limit: 100,
					statusFilter: includeDisabled ? "disabled" : "active",
					brandId,
					productCategoryId: categoryId,
					productMacroCategoryId: macroId,
					minPrice: minPrice || undefined,
					maxPrice: maxPrice || undefined,
					inStock: inStock || undefined,
					excludeDiscountId,
					// search via name? add a `search` query param to API if not present — for now skip
				},
			});
			if (res.error) throw new Error(res.error.value?.message || "Errore");
			return res.data;
		},
		enabled: open,
	});

	const rows = data?.data ?? [];
	const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
	const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

	function toggleOne(id: string) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function toggleAllVisible() {
		setSelected((prev) => {
			const next = new Set(prev);
			if (allVisibleSelected) for (const id of visibleIds) next.delete(id);
			else for (const id of visibleIds) next.add(id);
			return next;
		});
	}

	function resetFilters() {
		setSearch("");
		setBrandId(undefined);
		setMacroId(undefined);
		setCategoryId(undefined);
		setMinPrice("");
		setMaxPrice("");
		setInStock(true);
		setIncludeDisabled(false);
	}

	function confirm() {
		onConfirm(Array.from(selected));
		setSelected(new Set());
		onOpenChange(false);
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="sm:max-w-2xl w-full flex flex-col p-0">
				<SheetHeader className="p-6 pb-2">
					<SheetTitle>{m.promotions_picker_title()}</SheetTitle>
					<SheetDescription />
				</SheetHeader>

				<div className="px-6 pb-4 space-y-3 border-b">
					<Input
						placeholder={m.promotions_picker_search_placeholder()}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
					{/* Combobox for brand / macro / category — wire to existing hooks; placeholder here */}
					<div className="grid grid-cols-2 gap-2">
						<Input
							type="number"
							placeholder={m.promotions_picker_filter_price_min()}
							value={minPrice}
							onChange={(e) => setMinPrice(e.target.value)}
						/>
						<Input
							type="number"
							placeholder={m.promotions_picker_filter_price_max()}
							value={maxPrice}
							onChange={(e) => setMaxPrice(e.target.value)}
						/>
					</div>
					<div className="flex items-center justify-between text-sm">
						<label className="inline-flex items-center gap-2">
							<Switch checked={inStock} onCheckedChange={setInStock} />
							{m.promotions_picker_filter_in_stock()}
						</label>
						<label className="inline-flex items-center gap-2">
							<Switch checked={includeDisabled} onCheckedChange={setIncludeDisabled} />
							{m.promotions_picker_filter_include_disabled()}
						</label>
						<Button variant="ghost" size="sm" onClick={resetFilters}>
							{m.promotions_picker_reset_filters()}
						</Button>
					</div>
				</div>

				<div className="flex-1 overflow-y-auto px-6 py-4">
					<div className="mb-2 flex items-center justify-between text-sm">
						<Button variant="link" size="sm" onClick={toggleAllVisible}>
							{allVisibleSelected
								? m.promotions_picker_deselect_all()
								: m.promotions_picker_select_all()}
						</Button>
					</div>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-10" />
								<TableHead>Nome</TableHead>
								<TableHead>Prezzo</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((r) => (
								<TableRow key={r.id}>
									<TableCell>
										<Checkbox
											checked={selected.has(r.id) || alreadySelectedIds?.has(r.id)}
											disabled={alreadySelectedIds?.has(r.id)}
											onCheckedChange={() => toggleOne(r.id)}
										/>
									</TableCell>
									<TableCell>{r.name}</TableCell>
									<TableCell>€{r.price}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>

				<SheetFooter className="border-t px-6 py-4">
					<div className="flex items-center justify-between w-full">
						<span className="text-sm text-muted-foreground">
							{m.promotions_picker_selected_count({ count: selected.size })}
						</span>
						<Button onClick={confirm} disabled={selected.size === 0}>
							{m.promotions_picker_add_cta()}
						</Button>
					</div>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
```

Note: the Combobox bits for brand/macro/category are simplified — wire them to the existing `useBrands`/`useCategories`/`useMacroCategories` hooks if present, or create thin query wrappers in `hooks/`. Also create `apps/seller/src/hooks/use-debounced-value.ts` if it doesn't exist:

```ts
import { useEffect, useState } from "react";
export function useDebouncedValue<T>(value: T, ms: number): T {
	const [out, setOut] = useState(value);
	useEffect(() => {
		const t = setTimeout(() => setOut(value), ms);
		return () => clearTimeout(t);
	}, [value, ms]);
	return out;
}
```

- [ ] **Step 2: Typecheck**

`bun run typecheck`
Expected: PASS. If brand/category hooks don't exist yet, either create thin wrappers or substitute with inline `useQuery` calls against existing API endpoints (e.g. `api().seller.brands.get()`).

- [ ] **Step 3: Commit**

```bash
git add apps/seller/src/features/promotions/components/product-picker-sheet.tsx apps/seller/src/hooks/use-debounced-value.ts
git commit -m "feat(seller): add ProductPickerSheet for promotion product selection"
```

---

## Task 23: Wire `/promotions/new` to API

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/promotions/new.tsx`

- [ ] **Step 1: Implement the page**

```tsx
// apps/seller/src/routes/_authenticated/promotions/new.tsx
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
	DiscountForm,
	type DiscountFormValues,
} from "@/features/promotions/components/discount-form";
import { ProductPickerSheet } from "@/features/promotions/components/product-picker-sheet";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/promotions/new")({
	component: NewPromotionPage,
});

function NewPromotionPage() {
	const navigate = useNavigate();
	const qc = useQueryClient();
	const [productIds, setProductIds] = useState<string[]>([]);
	const [pickerOpen, setPickerOpen] = useState(false);

	const createMutation = useMutation({
		mutationFn: async (values: DiscountFormValues) => {
			const res = await api().seller.discounts.post({
				title: values.title,
				percent: values.percent,
				startsAt: new Date(values.startsAt),
				endsAt: values.noEndDate ? null : new Date(values.endsAt!),
				initialProductIds: productIds.length > 0 ? productIds : undefined,
			});
			if (res.error) throw new Error(res.error.value?.message || "Errore");
			return res.data.data;
		},
		onSuccess: (d) => {
			toast.success(m.promotions_toast_created());
			void qc.invalidateQueries({ queryKey: ["discounts"] });
			void navigate({ to: "/promotions/$discountId", params: { discountId: d.id } });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">{m.promotions_form_submit_new()}</h1>
			<DiscountForm
				submitLabel={m.promotions_form_submit_new()}
				submitting={createMutation.isPending}
				onSubmit={(v) => createMutation.mutateAsync(v)}
			/>
			<div className="space-y-2">
				<h2 className="font-medium">{m.promotions_form_products_section()}</h2>
				<p className="text-sm text-muted-foreground">
					{m.promotions_form_products_count({ count: productIds.length })}
				</p>
				<button
					type="button"
					className="text-sm text-primary hover:underline"
					onClick={() => setPickerOpen(true)}
				>
					{m.promotions_form_add_products()}
				</button>
			</div>

			<ProductPickerSheet
				open={pickerOpen}
				onOpenChange={setPickerOpen}
				alreadySelectedIds={new Set(productIds)}
				onConfirm={(ids) => setProductIds((prev) => [...new Set([...prev, ...ids])])}
			/>
		</div>
	);
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
bun run typecheck
git add apps/seller/src/routes/_authenticated/promotions/new.tsx
git commit -m "feat(seller): implement new promotion page"
```

---

## Task 24: Wire `/promotions/$discountId` (edit + products subset + actions)

**Files:**
- Create: `apps/seller/src/features/promotions/components/included-products-table.tsx`
- Modify: `apps/seller/src/routes/_authenticated/promotions/$discountId.tsx`
- Modify: `apps/seller/src/features/promotions/hooks/use-discounts.ts` (add update / addProducts / removeProducts mutations)

- [ ] **Step 1: Add hooks for update and product mutations**

Append to `use-discounts.ts`:

```ts
export function useUpdateDiscount(discountId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (patch: { title?: string; percent?: number; startsAt?: Date; endsAt?: Date | null }) => {
			const res = await api().seller.discounts({ discountId }).patch(patch);
			if (res.error) throw new Error(res.error.value?.message || "Errore");
			return res.data;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: DISCOUNTS_KEY });
		},
	});
}

export function useAddDiscountProducts(discountId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (productIds: string[]) => {
			const res = await api().seller.discounts({ discountId }).products.post({ productIds });
			if (res.error) throw new Error(res.error.value?.message || "Errore");
			return res.data;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: [...DISCOUNTS_KEY, "products", discountId] });
			void qc.invalidateQueries({ queryKey: [...DISCOUNTS_KEY, "detail", discountId] });
		},
	});
}

export function useRemoveDiscountProducts(discountId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (productIds: string[]) => {
			const res = await api().seller.discounts({ discountId }).products.delete({ productIds });
			if (res.error) throw new Error(res.error.value?.message || "Errore");
			return res.data;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: [...DISCOUNTS_KEY, "products", discountId] });
			void qc.invalidateQueries({ queryKey: [...DISCOUNTS_KEY, "detail", discountId] });
		},
	});
}

export function useDiscountProducts(discountId: string, page = 1, limit = 20) {
	return useQuery({
		queryKey: [...DISCOUNTS_KEY, "products", discountId, page, limit],
		queryFn: async () => {
			const res = await api().seller.discounts({ discountId }).products.get({ query: { page, limit } });
			if (res.error) throw new Error(res.error.value?.message || "Errore");
			return res.data;
		},
		enabled: !!discountId,
	});
}
```

- [ ] **Step 2: Create the included products table**

```tsx
// apps/seller/src/features/promotions/components/included-products-table.tsx
import { Button } from "@bibs/ui/components/button";
import { Checkbox } from "@bibs/ui/components/checkbox";
import { DiscountedPrice } from "@bibs/ui/components/discounted-price";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@bibs/ui/components/table";
import { useState } from "react";
import { m } from "@/paraglide/messages";

interface Row {
	id: string;
	name: string;
	originalPrice: string;
	discountedPrice: string;
}

interface Props {
	rows: Row[];
	percent: number;
	onRemove: (productIds: string[]) => void;
}

export function IncludedProductsTable({ rows, percent, onRemove }: Props) {
	const [selected, setSelected] = useState<Set<string>>(new Set());
	function toggleOne(id: string) {
		setSelected((prev) => {
			const n = new Set(prev);
			if (n.has(id)) n.delete(id);
			else n.add(id);
			return n;
		});
	}
	return (
		<div className="space-y-2">
			{selected.size > 0 && (
				<Button
					variant="destructive"
					size="sm"
					onClick={() => {
						onRemove(Array.from(selected));
						setSelected(new Set());
					}}
				>
					{m.promotions_included_remove_bulk()}
				</Button>
			)}
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-10" />
						<TableHead>Nome</TableHead>
						<TableHead>Prezzo</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((r) => (
						<TableRow key={r.id}>
							<TableCell>
								<Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleOne(r.id)} />
							</TableCell>
							<TableCell>{r.name}</TableCell>
							<TableCell>
								<DiscountedPrice
									originalPrice={r.originalPrice}
									discountedPrice={r.discountedPrice}
									percent={percent}
									size="sm"
								/>
							</TableCell>
							<TableCell className="text-right">
								<Button variant="ghost" size="sm" onClick={() => onRemove([r.id])}>
									{m.promotions_included_remove()}
								</Button>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
```

- [ ] **Step 3: Implement the detail page**

```tsx
// apps/seller/src/routes/_authenticated/promotions/$discountId.tsx
import { Button } from "@bibs/ui/components/button";
import { Spinner } from "@bibs/ui/components/spinner";
import { toast } from "@bibs/ui/components/sonner";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { DiscountForm } from "@/features/promotions/components/discount-form";
import { IncludedProductsTable } from "@/features/promotions/components/included-products-table";
import { ProductPickerSheet } from "@/features/promotions/components/product-picker-sheet";
import {
	useAddDiscountProducts,
	useArchiveDiscount,
	useDiscount,
	useDiscountProducts,
	usePauseDiscount,
	useRemoveDiscountProducts,
	useUpdateDiscount,
} from "@/features/promotions/hooks/use-discounts";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/promotions/$discountId")({
	component: PromotionDetailPage,
});

function PromotionDetailPage() {
	const { discountId } = Route.useParams();
	const detail = useDiscount(discountId);
	const update = useUpdateDiscount(discountId);
	const pause = usePauseDiscount();
	const archive = useArchiveDiscount();
	const addProducts = useAddDiscountProducts(discountId);
	const removeProducts = useRemoveDiscountProducts(discountId);
	const products = useDiscountProducts(discountId);
	const [pickerOpen, setPickerOpen] = useState(false);

	if (detail.isLoading) return <Spinner />;
	if (!detail.data) return <div>Promozione non trovata</div>;

	const d = detail.data.data;
	const isStarted = new Date(d.startsAt).getTime() <= Date.now();

	return (
		<div className="space-y-8">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold">{d.title}</h1>
				<div className="flex gap-2">
					{d.status !== "archived" && (
						<Button
							variant="outline"
							onClick={() =>
								pause.mutate(discountId, {
									onSuccess: () => toast.success(d.status === "paused" ? m.promotions_toast_resumed() : m.promotions_toast_paused()),
								})
							}
						>
							{d.status === "paused" ? m.promotions_action_resume() : m.promotions_action_pause()}
						</Button>
					)}
					{d.status !== "archived" && (
						<Button
							variant="destructive"
							onClick={() => archive.mutate(discountId, { onSuccess: () => toast.success(m.promotions_toast_archived()) })}
						>
							{m.promotions_action_archive()}
						</Button>
					)}
				</div>
			</div>

			<DiscountForm
				defaultValues={{
					title: d.title,
					percent: d.percent,
					startsAt: new Date(d.startsAt).toISOString().slice(0, 16),
					endsAt: d.endsAt ? new Date(d.endsAt).toISOString().slice(0, 16) : "",
					noEndDate: !d.endsAt,
				}}
				disablePercent={isStarted}
				disableStartsAt={isStarted}
				submitLabel={m.promotions_form_submit_edit()}
				submitting={update.isPending}
				onSubmit={async (v) => {
					await update.mutateAsync({
						title: v.title,
						percent: isStarted ? undefined : v.percent,
						startsAt: isStarted ? undefined : new Date(v.startsAt),
						endsAt: v.noEndDate ? null : new Date(v.endsAt!),
					});
					toast.success(m.promotions_toast_updated());
				}}
			/>

			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<h2 className="font-medium">{m.promotions_form_products_section()}</h2>
					<Button onClick={() => setPickerOpen(true)}>{m.promotions_form_add_products()}</Button>
				</div>
				{products.data && (
					<IncludedProductsTable
						rows={products.data.data}
						percent={d.percent}
						onRemove={(ids) =>
							removeProducts.mutate(ids, {
								onSuccess: (r) => toast.success(m.promotions_toast_products_removed({ count: r.data.removed })),
							})
						}
					/>
				)}
			</div>

			<ProductPickerSheet
				open={pickerOpen}
				onOpenChange={setPickerOpen}
				excludeDiscountId={discountId}
				onConfirm={(ids) =>
					addProducts.mutate(ids, {
						onSuccess: (r) =>
							toast.success(
								m.promotions_toast_products_added({
									added: r.data.added,
									alreadyPresent: r.data.alreadyPresent,
									rejected: r.data.rejected.length,
								}),
							),
					})
				}
			/>
		</div>
	);
}
```

- [ ] **Step 4: Typecheck and commit**

```bash
bun run typecheck
git add apps/seller/src/features/promotions/components/included-products-table.tsx apps/seller/src/features/promotions/hooks/use-discounts.ts apps/seller/src/routes/_authenticated/promotions/\$discountId.tsx
git commit -m "feat(seller): implement promotion detail page (edit + products + actions)"
```

---

## Task 25: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck**

```bash
bun run typecheck
```
Expected: PASS in all workspaces.

- [ ] **Step 2: Lint**

```bash
bun run lint
```
Expected: PASS.

- [ ] **Step 3: All tests**

```bash
bun run test
```
Expected: all integration tests pass (seller-discounts, seller-products-filters, customer-search, plus pre-existing). Verify NO existing test regressed.

- [ ] **Step 4: Dev manual — seller**

```bash
bun run dev:seller   # in one terminal
bun run dev:api      # in another
```

Open `http://localhost:3002`:
- Sidebar shows "Promozioni"
- Click "Promozioni" → tabs visible, empty state per tab
- Click "Nuova promozione" → form, fill with title/percent/startsAt/endsAt, submit → redirect to detail
- Click "Aggiungi prodotti" → Sheet opens, filter, select two, "Aggiungi" → toast + table populates
- Promo running: change title, save → toast updated. Try changing percent → field disabled.
- Pause → state changes. Resume → state back. Archive → confirm, promo disappears from "all" tab, appears in "archiviate".
- Create another promo with `noEndDate` → period shows "∞".

- [ ] **Step 5: Dev manual — customer (data plumbing)**

```bash
bun run dev:customer
```

The customer app has no product card UI yet. Verify the discount data flows by hitting the API directly:

```bash
curl 'http://localhost:3000/customer/search?q=<product-name>'
```

The response items should include `discountedPrice`, `discountPercent`, `discountTitle`, `discountEndsAt` (nullable). When a product has an active promo, those fields are populated.

- [ ] **Step 6: OpenAPI**

Visit `http://localhost:3000/openapi`. Verify the new `Seller - Discounts` tag groups all the new endpoints with Italian descriptions.

- [ ] **Step 7: Commit any verification fix-ups**

If any small adjustment is needed during manual testing:

```bash
git add -p
git commit -m "fix(seller): polish promotion detail edge cases"
```

- [ ] **Step 8: Push and open PR**

```bash
git push -u origin feat/seller-discounts
gh pr create --title "feat(seller): promotions and discounts module" --body "$(cat <<'EOF'
## Summary
- Nuova sezione "Promozioni" lato seller (lista + tabs + creazione + modifica + pausa + archivio).
- Schema DB (`discounts`, `discount_products`) con CHECK e cascade.
- Modulo API `seller/discounts` con 10 endpoint, helper `withActiveDiscount`.
- Estensione `GET /seller/products` con filtri marca/categoria/macro/range prezzo/inStock/excludeDiscountId, `storeId` ora opzionale.
- Customer search annotata con `discount*` (display rimandato quando esisterà la product card).
- Nuovo componente `DiscountedPrice` in `@bibs/ui`.

Spec: `docs/superpowers/specs/2026-05-14-seller-discounts-design.md`
Plan: `docs/superpowers/plans/2026-05-14-seller-discounts.md`

## Test plan
- [x] `bun run typecheck`
- [x] `bun run lint`
- [x] `bun run test`
- [x] Seller dev: lista, crea, picker prodotti, pausa, archivio, modifica con campi disabled
- [x] Customer API: `/customer/search` ritorna campi `discount*`
- [x] OpenAPI: tag "Seller - Discounts" presente

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review checklist (eseguito dall'autore del plan dopo la stesura)

- ✅ Spec coverage: ogni decisione della tabella spec ha un task corrispondente (sconto %, granularità intero, no IVA, overlap miglior %, scope seller-wide, lifecycle/`status`, `endsAt` nullable, assegnazione lista esplicita, filtri picker, editing post-start, scope spec con annotazione customer fields).
- ✅ Placeholder scan: nessun "TBD"/"TODO" lasciato in steps di codice. La `Combobox` per brand/macro/categoria nel picker è marcata come "wire to existing hooks if present, otherwise create thin wrappers" — è un punto esplicito, non un placeholder.
- ✅ Type consistency: `DiscountStatus`/`status`/`DiscountOperationalState`/`state` mantengono i nomi coerenti tra schema DB, service, schema TypeBox, hook frontend.
- ✅ Eden Treaty: gli esempi di chain (`api().seller.discounts(...)`) potrebbero richiedere micro-aggiustamenti in editor a seconda della versione del treaty — il plan dichiara di "verificare via autocomplete" nel passo rilevante.
- ✅ TDD: ogni service ha test prima dell'implementazione; UI si verifica via typecheck + manuale (nessun E2E in MVP).
- ✅ Commit frequenti: ogni task termina con un commit isolato e tematico.

## Follow-up out of scope

Vedi sezione "Follow-up noti" dello spec: snapshot prezzo su `order_item`, codici sconto, importi fissi, IVA per prodotto, anti-abuso, customer product card UI.
