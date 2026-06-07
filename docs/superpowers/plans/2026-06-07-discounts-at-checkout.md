# Discounts at Checkout (P0.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the best active seller percentage discount at order creation (today promos are display-only: the customer sees "-25%" but is charged full list price), snapshotting list price + applied percent on each order line.

**Architecture:** `createOrder` (apps/api/src/modules/customer/services/orders.ts) resolves each line's unit price from `sp.product.price`; the fix looks up the best active discount per product **inside the order transaction** (tx-aware variant of the existing `getBestActiveDiscount`), prices the line at the discounted unit price (same rounding as the SQL shown to customers: per-unit, half-away-from-zero), and lets `totalCents`, `vatAmount`, `vatBreakdown` (castelletto) and `awardPoints` follow automatically since they all derive from `unitPrice`. Two new nullable snapshot columns on `order_items` (`list_price`, `discount_percent`) preserve transparency. Seller % discount applies **before** the points discount (pre-points, like the castelletto — see the existing code comment).

**Tech Stack:** Elysia + Drizzle (PostgreSQL) + TypeBox, bun test + testcontainers (schema via `drizzle-kit push` in tests, real migration for prod).

**Non-goals:** customer checkout UI (does not exist yet), discount codes/fixed amounts, points-discount VAT apportionment (deferred to invoicing layer), order-level discount totals (derivable from items).

---

## Pre-flight

- [ ] **Step 0.1: Create the feature branch**

```bash
git checkout main && git pull && git checkout -b feat/discounts-at-checkout
```

- [ ] **Step 0.2: Confirm clean baseline**

Run: `cd apps/api && bun run test:unit`
Expected: PASS (baseline green before touching anything)

---

### Task 1: Snapshot columns on `order_items` (+ response schema)

**Files:**
- Modify: `apps/api/src/db/schemas/order.ts` (the `orderItem` pgTable)
- Modify: `apps/api/src/lib/schemas/entities.ts:486-530` (`OrderItemSchema`)
- Create: `apps/api/src/db/migrations/00XX_*.sql` (generated)

- [ ] **Step 1.1: Add the two columns to the Drizzle table**

In `apps/api/src/db/schemas/order.ts`, inside the `orderItem` pgTable, **after the `unitPrice` column** (`unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),`) add:

```ts
	// === snapshot sconto venditore (NULL su ordini storici / nessuno sconto) ===
	listPrice: numeric("list_price", { precision: 10, scale: 2 }),
	discountPercent: integer("discount_percent"),
```

Semantics: `listPrice` is **always** set on new rows (list price at order time, even without discount — NULL only on historical rows); `discountPercent` is set **only when a discount was applied**.

- [ ] **Step 1.2: Add the CHECK constraints**

In the same table's existing checks array (where `order_item_quantity_positive` / `order_item_unit_price_non_negative` live), append:

```ts
	check(
		"order_item_list_price_non_negative",
		sql`${table.listPrice} IS NULL OR ${table.listPrice} >= 0`,
	),
	check(
		"order_item_discount_percent_range",
		sql`${table.discountPercent} IS NULL OR ${table.discountPercent} BETWEEN 1 AND 99`,
	),
```

- [ ] **Step 1.3: Extend `OrderItemSchema`**

In `apps/api/src/lib/schemas/entities.ts`, after the `unitPrice` field of `OrderItemSchema` (line ~516, the one with description `"Prezzo unitario al momento dell'ordine"`), add — matching the existing `t.Nullable` + Italian-description convention:

```ts
	listPrice: t.Nullable(
		t.String({
			description:
				"Snapshot prezzo di listino al momento dell'ordine. NULL per ordini storici",
		}),
	),
	discountPercent: t.Nullable(
		t.Number({
			description:
				"Percentuale sconto venditore applicata alla riga. NULL se nessuno sconto era attivo",
		}),
	),
```

Also update the `unitPrice` description to disambiguate:

```ts
	unitPrice: t.String({
		description:
			"Prezzo unitario effettivamente addebitato al momento dell'ordine (già scontato se uno sconto era attivo)",
	}),
```

- [ ] **Step 1.4: Generate and review the migration**

```bash
cd apps/api && bun run db:generate
```

Open the generated SQL in `src/db/migrations/` and verify it contains EXACTLY (modulo migration name):

```sql
ALTER TABLE "order_items" ADD COLUMN "list_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "discount_percent" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_item_list_price_non_negative" CHECK ("order_items"."list_price" IS NULL OR "order_items"."list_price" >= 0);--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_item_discount_percent_range" CHECK ("order_items"."discount_percent" IS NULL OR "order_items"."discount_percent" BETWEEN 1 AND 99);
```

If the diff contains ANYTHING touching other tables (phantom diff — see memory note on migration 0012), STOP and investigate before proceeding.

- [ ] **Step 1.5: Apply migration to the local dev DB**

```bash
cd apps/api && bun run db:migrate
```

Expected: applies cleanly. (Tests do NOT need this — the testcontainer harness uses `drizzle-kit push --force`.)

- [ ] **Step 1.6: Typecheck from root**

Run: `bun run typecheck` (from repo root — Eden Treaty propagates the schema to the 3 frontends)
Expected: PASS

- [ ] **Step 1.7: Commit**

```bash
git add apps/api/src/db/schemas/order.ts apps/api/src/lib/schemas/entities.ts apps/api/src/db/migrations
git commit -m "feat(api): add list_price + discount_percent snapshot columns to order_items"
```

---

### Task 2: Failing integration tests (RED)

**Files:**
- Create: `apps/api/tests/integration/customer-orders-discounts.test.ts`

- [ ] **Step 2.1: Replicate the integration-test preamble**

Open `apps/api/tests/integration/customer-orders.test.ts` and copy its exact preamble into the new file: the hoisted `mock.module("@/db", ...)` Proxy block, the imports, and the `beforeAll(setupTestContainer, 120_000)` / `afterAll(teardownTestContainer)` / `beforeEach(() => truncateAll(getTestDb()))` hooks. Then add these imports (aligning paths with what the existing file uses):

```ts
import { eq } from "drizzle-orm";
import { orderItem } from "@/db/schemas/order";
import { product as productTable } from "@/db/schemas/product";
import { config } from "@/lib/config";
import { fromCents } from "@/lib/money";
import { createOrder } from "@/modules/customer/services/orders";
import {
	createTestCustomer,
	createTestDiscount,
	createTestDiscountProduct,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
} from "../helpers/fixtures";
```

(`createTestDiscount` defaults: percent 20, startsAt now-60s, endsAt now+1d, status "active" — already in `tests/helpers/fixtures.ts`.)

- [ ] **Step 2.2: Write the test suite**

```ts
async function seedDiscountedFixtures(opts: { price?: string; percent?: number } = {}) {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const testStore = await createTestStore(db, seller.profile.id);
	const prod = await createTestProduct(db, seller.profile.id, {
		price: opts.price ?? "100.00",
	});
	const sp = await createTestStoreProduct(db, testStore.id, prod.id, { stock: 10 });
	const customer = await createTestCustomer(db);
	return { db, seller, store: testStore, product: prod, storeProduct: sp, customer };
}

describe("createOrder — seller percentage discounts", () => {
	it("charges the best active discount price, snapshots list price and percent", async () => {
		const { db, seller, store, product, storeProduct: sp, customer } =
			await seedDiscountedFixtures();
		const disc = await createTestDiscount(db, seller.profile.id, { percent: 25 });
		await createTestDiscountProduct(db, disc.id, product.id);

		const result = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 2 }],
		});

		expect(result.total).toBe("150.00"); // 2 × 75.00, not 2 × 100.00
		expect(result.pointsEarned).toBe(150); // points on the charged amount

		const items = await db.select().from(orderItem).where(eq(orderItem.orderId, result.id));
		expect(items).toHaveLength(1);
		expect(items[0].unitPrice).toBe("75.00");
		expect(items[0].listPrice).toBe("100.00");
		expect(items[0].discountPercent).toBe(25);
	});

	it("ignores paused, expired and scheduled discounts", async () => {
		const { db, seller, store, product, storeProduct: sp, customer } =
			await seedDiscountedFixtures();
		const now = Date.now();
		const paused = await createTestDiscount(db, seller.profile.id, {
			percent: 30, status: "paused",
		});
		const expired = await createTestDiscount(db, seller.profile.id, {
			percent: 40,
			startsAt: new Date(now - 2 * 86_400_000),
			endsAt: new Date(now - 1 * 86_400_000),
		});
		const scheduled = await createTestDiscount(db, seller.profile.id, {
			percent: 50,
			startsAt: new Date(now + 1 * 86_400_000),
			endsAt: new Date(now + 2 * 86_400_000),
		});
		for (const d of [paused, expired, scheduled])
			await createTestDiscountProduct(db, d.id, product.id);

		const result = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});

		expect(result.total).toBe("100.00");
		const items = await db.select().from(orderItem).where(eq(orderItem.orderId, result.id));
		expect(items[0].unitPrice).toBe("100.00");
		expect(items[0].listPrice).toBe("100.00"); // list price snapshot is ALWAYS set on new rows
		expect(items[0].discountPercent).toBeNull();
	});

	it("applies the highest percent when multiple discounts are active", async () => {
		const { db, seller, store, product, storeProduct: sp, customer } =
			await seedDiscountedFixtures();
		const d10 = await createTestDiscount(db, seller.profile.id, { percent: 10 });
		const d30 = await createTestDiscount(db, seller.profile.id, { percent: 30 });
		await createTestDiscountProduct(db, d10.id, product.id);
		await createTestDiscountProduct(db, d30.id, product.id);

		const result = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});

		expect(result.total).toBe("70.00");
	});

	it("does not apply another seller's discount", async () => {
		const { db, seller, store, product, storeProduct: sp, customer } =
			await seedDiscountedFixtures();
		const otherSeller = await createTestSeller(db);
		const foreign = await createTestDiscount(db, otherSeller.profile.id, { percent: 90 });
		// link forced at fixture level (bypasses the service-level same-seller guard)
		await createTestDiscountProduct(db, foreign.id, product.id);

		const result = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});

		expect(result.total).toBe("100.00"); // pricing predicate requires d.seller_profile_id = p.seller_profile_id
	});

	it("applies the points redemption AFTER the seller discount", async () => {
		const { db, seller, store, product, storeProduct: sp } =
			await seedDiscountedFixtures();
		const customer = await createTestCustomer(db, { points: config.pointsPerEuroDiscount });
		const disc = await createTestDiscount(db, seller.profile.id, { percent: 25 });
		await createTestDiscountProduct(db, disc.id, product.id);

		const result = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: config.pointsPerEuroDiscount,
			type: "direct",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
			pointsToSpend: config.pointsPerEuroDiscount, // exactly €1 of points discount
		});

		expect(result.total).toBe("74.00"); // (100 → 75 seller discount) − 1.00 points
		expect(result.pointsSpent).toBe(config.pointsPerEuroDiscount);
	});

	it("reflects the discounted gross in vatBreakdown and per-line vatAmount", async () => {
		const { db, seller, store, product, storeProduct: sp, customer } =
			await seedDiscountedFixtures({ price: "12.20" });
		await db
			.update(productTable)
			.set({ vatRate: "22" })
			.where(eq(productTable.id, product.id));
		const disc = await createTestDiscount(db, seller.profile.id, { percent: 50 });
		await createTestDiscountProduct(db, disc.id, product.id);

		const result = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});

		// 12.20 → 6.10 charged; scorporo(610, 22): net 500, vat 110
		expect(result.total).toBe("6.10");
		expect(result.vatBreakdown).toEqual([
			{ rate: 22, taxableAmount: "5.00", taxAmount: "1.10" },
		]);
		const items = await db.select().from(orderItem).where(eq(orderItem.orderId, result.id));
		expect(items[0].vatAmount).toBe("1.10");
	});

	it("rounds the discounted UNIT price exactly like the displayed price (half away from zero)", async () => {
		const { db, seller, store, product, storeProduct: sp, customer } =
			await seedDiscountedFixtures({ price: "0.10" });
		const disc = await createTestDiscount(db, seller.profile.id, { percent: 25 });
		await createTestDiscountProduct(db, disc.id, product.id);

		const result = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 3 }],
		});

		// SQL display: ROUND(0.10 * 0.75, 2) = 0.08 per unit → line = 3 × 0.08 = 0.24
		// (NOT round(0.075 × 3) = 0.23 — unit-first, then × qty)
		const items = await db.select().from(orderItem).where(eq(orderItem.orderId, result.id));
		expect(items[0].unitPrice).toBe("0.08");
		expect(result.total).toBe("0.24");
	});
});
```

Note: if `createTestCustomer`'s options param differs from `{ points }`, align with its actual signature in `tests/helpers/fixtures.ts` (the recon confirmed `createTestCustomer({points})` exists).

- [ ] **Step 2.3: Run to verify RED**

Run: `cd apps/api && bun test tests/integration/customer-orders-discounts.test.ts --timeout 180000`
Expected: FAIL — totals come back at full list price ("100.00" instead of "150.00"/"70.00"/…), `listPrice` is `null`, `discountPercent` is `null`. The "ignores paused…" test may pass already except for the `listPrice` assert — that's fine, at least one assert per test must be red except none-red is a STOP signal: if EVERYTHING passes, the bug doesn't exist — re-read the code before continuing.

---

### Task 3: tx-aware discount lookup

**Files:**
- Modify: `apps/api/src/modules/seller/services/discount-pricing.ts`

- [ ] **Step 3.1: Add an executor parameter (default `db`)**

The two helpers currently call the module-level `db.execute(...)`. Inside `createOrder`'s transaction we need the SAME query to run on the `tx` for transactional consistency. Add:

```ts
import type { PgTransaction } from "drizzle-orm/pg-core";

type DbExecutor = typeof db | PgTransaction<any, any, any>;
```

and change both signatures (bodies unchanged except `db.execute` → `executor.execute`):

```ts
export async function getBestActiveDiscount(
	productId: string,
	executor: DbExecutor = db,
): Promise<ActiveDiscountInfo | null> {
	const result = await executor.execute<{
		// ...existing generic row type unchanged...
```

```ts
export async function getBestActiveDiscounts(
	productIds: string[],
	executor: DbExecutor = db,
): Promise<Map<string, ActiveDiscountInfo>> {
	// ...db.execute → executor.execute...
```

Existing call sites (`customer/services/search.ts`, tests) pass no second arg — unchanged.

- [ ] **Step 3.2: Typecheck**

Run: `cd apps/api && bun run typecheck`
Expected: PASS

---

### Task 4: Apply the discount in `createOrder` (GREEN)

**Files:**
- Modify: `apps/api/src/modules/customer/services/orders.ts`

- [ ] **Step 4.1: Import the helper**

Add to the imports (mirrors the existing import in `customer/services/search.ts:11`):

```ts
import { getBestActiveDiscount } from "@/modules/seller/services/discount-pricing";
```

- [ ] **Step 4.2: Extend the `resolvedItems` element type**

In the tx body, the inline type of `resolvedItems` gains two fields (after `unitPrice: string;`):

```ts
			unitPrice: string;
			listPrice: string;
			discountPercent: number | null;
```

- [ ] **Step 4.3: Price the line from the best active discount**

Replace the pricing block inside the per-item loop — currently:

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

with:

```ts
			// Sconto venditore: prezzo unitario scontato PRIMA dello sconto punti,
			// con lo stesso rounding del prezzo mostrato al cliente
			// (ROUND(price * (1 - percent/100), 2) per unità, half-away-from-zero).
			const discountInfo = await getBestActiveDiscount(sp.product.id, tx);
			const listUnitCents = toCents(sp.product.price);
			const unitCents = discountInfo
				? Math.round((listUnitCents * (100 - discountInfo.percent)) / 100)
				: listUnitCents;

			const lineGrossCents = unitCents * item.quantity;
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
				unitPrice: fromCents(unitCents),
				listPrice: sp.product.price,
				discountPercent: discountInfo?.percent ?? null,
				vatRate: sp.product.vatRate,
				vatAmount: fromCents(vatCents),
			});
```

Nothing else in the tx changes: `vatBreakdown` is built from `toCents(it.unitPrice) * it.quantity` (now discounted), the points discount applies to the already-discounted `totalCents`, and `awardPoints` receives `finalTotalCents` — all downstream math follows the new `unitPrice` automatically.

- [ ] **Step 4.4: Persist the snapshot fields**

In the `tx.insert(orderItem).values(...)` mapping, after `unitPrice: item.unitPrice,` add:

```ts
				listPrice: item.listPrice,
				discountPercent: item.discountPercent,
```

- [ ] **Step 4.5: Run the new suite to verify GREEN**

Run: `cd apps/api && bun test tests/integration/customer-orders-discounts.test.ts --timeout 180000`
Expected: PASS (all 7 tests)

- [ ] **Step 4.6: Run the order regression anchors**

Run: `cd apps/api && bun test tests/integration/customer-orders.test.ts tests/integration/customer-orders-vat.test.ts tests/integration/seller-orders.test.ts tests/integration/loyalty-points-race.test.ts --timeout 180000`
Expected: PASS — no-discount orders still total "20.00"/"23.20", pointsEarned 100, castelletto unchanged.

- [ ] **Step 4.7: Commit**

```bash
git add apps/api/src/modules/seller/services/discount-pricing.ts apps/api/src/modules/customer/services/orders.ts apps/api/tests/integration/customer-orders-discounts.test.ts
git commit -m "fix(api): charge best active seller discount at checkout, snapshot list price + percent"
```

---

### Task 5: Full verification

- [ ] **Step 5.1: Full API test suite**

Run: `cd apps/api && bun run test`
Expected: PASS (check `$?` explicitly — memory: aggregated output can hide failures)

- [ ] **Step 5.2: Root typecheck + lint**

```bash
bun run typecheck && bun run lint
```
Expected: both PASS (Eden Treaty types across the 3 frontends must still resolve)

- [ ] **Step 5.3: Verify OpenAPI surface**

Start the API (`bun run dev:api` or equivalent) and check `GET /openapi` includes `listPrice`/`discountPercent` in the order-item schema. Stop the server after.

- [ ] **Step 5.4: Push and open the PR**

Use the repo flow (PR-first, never direct to main):

```bash
git push -u origin feat/discounts-at-checkout
```

Then open the PR via `/commit-commands:commit-push-pr` or `gh pr create` with title:
`fix(api): apply seller discounts at checkout (display-only promos charged full price)`

PR body must cover: the bug (display vs charged price), rounding parity guarantee (unit-first ROUND half-away matches `discount-pricing.ts` SQL), pre-points ordering, snapshot column semantics (`listPrice` always set on new rows; `discountPercent` only when applied), and note that historical rows keep NULL.

---

## Notes & gotchas for the implementer

- `ServiceError(status, message)` — two args only; no custom code arg.
- The testcontainer harness **serializes transactions** — do not attempt concurrency/race tests here (memory: false-RED risk); the suite above is deterministic by design.
- `updateDiscount` blocks `percent`/`startsAt` changes once a discount is running (409), so the snapshotted percent can't drift mid-run.
- Tests pick up new columns automatically (`drizzle-kit push --force` in `setupTestContainer`); the migration file is for dev/prod DBs.
- Per-unit rounding FIRST, then × quantity — this is what guarantees the charged price equals the displayed `discountedPrice` (which SQL computes on the unit price). Do not round the line total.
- The N+1 lookup (one `getBestActiveDiscount` per line, inside the tx) is deliberate: cart sizes are small, the diff stays minimal, and the tx-consistency matters more than batching. If a future profile shows it hot, switch to `getBestActiveDiscounts` batch before the loop.
