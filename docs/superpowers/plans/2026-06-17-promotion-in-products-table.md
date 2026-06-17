# Show Applied Promotion in the Seller Products Table — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the active promotion's effect on price directly in the seller products table (discounted price + struck original + `−X%` badge with the promo title in a tooltip), and offer "Applica promozione" only on active products.

**Architecture:** Mirror the proven customer-search pattern — annotate the paginated seller products list with the best *running* discount via the existing `getBestActiveDiscounts` batch helper, expose it on a dedicated list-item schema, and render it in the Price cell. No DB migration. VAT ("netto") is recomputed on the discounted price to match checkout, which already discounts before scorporo.

**Tech Stack:** Elysia + Drizzle + Eden treaty (api), TanStack Table + React + shadcn/@bibs/ui (seller). Tests: `bun test` with testcontainer Postgres.

**Spec:** `docs/superpowers/specs/2026-06-17-promotion-in-products-table-design.md`

**Branch:** `feat/promotion-in-products-table` (already created, spec already committed on it).

---

## File Structure

- Modify: `apps/api/src/lib/schemas/composed.ts` — add `AppliedDiscountSchema` + `SellerProductListItemSchema`
- Modify: `apps/api/src/modules/seller/services/products.ts` — annotate `listProducts` result with `appliedDiscount`
- Modify: `apps/api/src/modules/seller/routes/products.ts:165` — list response → `SellerProductListItemSchema`
- Modify: `apps/api/tests/integration/seller-products.test.ts` — annotation tests
- Create: `apps/seller/src/features/products/components/product-price-cell.tsx` — the Price cell
- Modify: `apps/seller/src/routes/_authenticated/products/index.tsx` — use `ProductPriceCell` in the Price column; drop the now-unused `Price` import
- Modify: `apps/seller/src/features/products/components/product-row-actions.tsx` — gate apply to `status === "active"`
- Modify: `apps/seller/src/features/products/components/product-bulk-toolbar.tsx` — remove apply button from the `disabled` group

**Conventions:** `--no-verify` forbidden (lefthook runs biome + conventional-commits). Commit trailer on every commit:
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

## Task 1: API — annotate seller products list with the active discount (TDD)

**Files:**
- Test: `apps/api/tests/integration/seller-products.test.ts`
- Modify: `apps/api/src/lib/schemas/composed.ts`
- Modify: `apps/api/src/modules/seller/services/products.ts`
- Modify: `apps/api/src/modules/seller/routes/products.ts:165`

- [ ] **Step 1: Write the failing tests**

In `apps/api/tests/integration/seller-products.test.ts`, add `createTestDiscount` and `createTestDiscountProduct` to the existing import from `../helpers/fixtures` (the file already imports `createTestProduct`, `createTestSeller`, etc.). Then add this `describe` block (place it after an existing top-level `describe` in the file):

```ts
describe("listProducts appliedDiscount annotation", () => {
	it("annotates a product in a running discount", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id, {
			name: "Scontato",
			price: "100.00",
		});
		const d = await createTestDiscount(db, seller.profile.id, {
			title: "Saldi estivi",
			percent: 25,
		}); // fixture default: starts 60s ago, ends +1d, status active → running
		await createTestDiscountProduct(db, d.id, p.id);

		const result = await listProducts({ sellerProfileId: seller.profile.id });
		const row = result.data.find((r) => r.id === p.id);
		expect(row?.appliedDiscount).toEqual({
			percent: 25,
			discountedPrice: "75.00",
			title: "Saldi estivi",
		});
	});

	it("is null for a product with no discount", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id);

		const result = await listProducts({ sellerProfileId: seller.profile.id });
		expect(result.data.find((r) => r.id === p.id)?.appliedDiscount).toBeNull();
	});

	it("is null when the only discount is paused (not active)", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id, { price: "50.00" });
		const d = await createTestDiscount(db, seller.profile.id, {
			percent: 30,
			status: "paused",
		});
		await createTestDiscountProduct(db, d.id, p.id);

		const result = await listProducts({ sellerProfileId: seller.profile.id });
		expect(result.data.find((r) => r.id === p.id)?.appliedDiscount).toBeNull();
	});
});
```

- [ ] **Step 2: Run the tests to verify they FAIL**

Run: `cd apps/api && bun test tests/integration/seller-products.test.ts -t "appliedDiscount"`
Expected: FAIL — `appliedDiscount` is `undefined` (toBeNull/toEqual fail). (TS may also flag `row.appliedDiscount` as unknown; `bun test` runs regardless.)

- [ ] **Step 3: Add the schemas**

In `apps/api/src/lib/schemas/composed.ts`, immediately after the `ProductWithRelationsSchema` definition (around line 110), add:

```ts
export const AppliedDiscountSchema = t.Object({
	percent: t.Integer({ minimum: 1, maximum: 99 }),
	discountedPrice: t.String({ description: "Prezzo scontato (numeric.2)" }),
	title: t.String(),
});

// Seller product list item = product with relations + the best running discount
// (null when none). Separate from ProductWithRelationsSchema so the single-product
// GET that also uses it stays unchanged.
export const SellerProductListItemSchema = t.Object({
	...ProductWithRelationsSchema.properties,
	appliedDiscount: t.Nullable(AppliedDiscountSchema),
});
```

(`t` is already imported in this file.)

- [ ] **Step 4: Annotate the service result**

In `apps/api/src/modules/seller/services/products.ts`:

Add the import near the top (with the other `@/modules/...` / service imports):
```ts
import { getBestActiveDiscounts } from "@/modules/seller/services/discount-pricing";
```

In `listProducts`, replace the final `return { data, pagination: { page, limit, total } };` (the one right after the `data.sort(...)` that preserves `productIds` order) with:

```ts
	const discountMap = await getBestActiveDiscounts(data.map((p) => p.id));
	const annotated = data.map((p) => {
		const d = discountMap.get(p.id);
		return {
			...p,
			appliedDiscount: d
				? {
						percent: d.percent,
						discountedPrice: d.discountedPrice,
						title: d.title,
					}
				: null,
		};
	});

	return { data: annotated, pagination: { page, limit, total } };
```

(`getBestActiveDiscounts([])` already returns an empty Map, so the empty-page case is a safe no-op.)

- [ ] **Step 5: Point the list route response at the new schema**

In `apps/api/src/modules/seller/routes/products.ts`:
- Add `SellerProductListItemSchema` to the import from `@/lib/schemas` (the same import that currently brings in `ProductWithRelationsSchema`).
- Change line 165 from `response: withErrors({ 200: okPageRes(ProductWithRelationsSchema) }),` to `response: withErrors({ 200: okPageRes(SellerProductListItemSchema) }),`.
- Leave the single-product GET at line ~301 on `ProductWithRelationsSchema` unchanged.

- [ ] **Step 6: Run the tests to verify they PASS**

Run: `cd apps/api && bun test tests/integration/seller-products.test.ts`
Expected: all pass (the 3 new tests + the existing ones).

- [ ] **Step 7: Typecheck api**

Run: `bun run --filter @bibs/api typecheck` (check `echo $?` → 0)

- [ ] **Step 8: Commit**

```bash
cd /Users/marcogelli/repos/jelaz/bibs
git add apps/api/src/lib/schemas/composed.ts apps/api/src/modules/seller/services/products.ts apps/api/src/modules/seller/routes/products.ts apps/api/tests/integration/seller-products.test.ts
git commit -m "feat(api): annotate seller products list with best active discount

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Frontend — Price cell shows the discount

**Files:**
- Create: `apps/seller/src/features/products/components/product-price-cell.tsx`
- Modify: `apps/seller/src/routes/_authenticated/products/index.tsx`

- [ ] **Step 1: Create `ProductPriceCell`**

Create `apps/seller/src/features/products/components/product-price-cell.tsx`:

```tsx
import { Badge } from "@bibs/ui/components/badge";
import {
	formatPriceEur,
	Price,
	scorporoDisplay,
} from "@bibs/ui/components/price";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@bibs/ui/components/tooltip";

interface AppliedDiscount {
	percent: number;
	discountedPrice: string;
	title: string;
}

interface Props {
	price: string;
	vatRate: string;
	appliedDiscount: AppliedDiscount | null;
}

export function ProductPriceCell({ price, vatRate, appliedDiscount }: Props) {
	// VAT base is the actually-charged price: the discounted one when a promo is
	// active (matches checkout, which discounts before scorporo).
	const effectivePrice = appliedDiscount?.discountedPrice ?? price;
	const { net } = scorporoDisplay(effectivePrice, Number(vatRate));

	return (
		<div className="flex flex-col leading-tight">
			{appliedDiscount ? (
				<span className="flex items-center gap-1.5">
					<Price
						value={appliedDiscount.discountedPrice}
						className="font-semibold"
					/>
					<span className="text-muted-foreground text-xs tabular-nums line-through">
						{formatPriceEur(price)}
					</span>
					<Tooltip>
						<TooltipTrigger asChild>
							<span tabIndex={0} className="inline-flex">
								<Badge variant="secondary">−{appliedDiscount.percent}%</Badge>
							</span>
						</TooltipTrigger>
						<TooltipContent>{appliedDiscount.title}</TooltipContent>
					</Tooltip>
				</span>
			) : (
				<Price value={price} />
			)}
			<span className="text-muted-foreground text-xs tabular-nums">
				netto {formatPriceEur(net)}
			</span>
		</div>
	);
}
```

(Seller root already wraps `<TooltipProvider>`, so `Tooltip` works. `Price` accepts `className`. `−` is U+2212 minus, matching the apply dialog's badges.)

- [ ] **Step 2: Use it in the Price column + drop the unused `Price` import**

In `apps/seller/src/routes/_authenticated/products/index.tsx`:

(a) Add the import (with the other `@/features/products/components/...` imports):
```ts
import { ProductPriceCell } from "@/features/products/components/product-price-cell";
```

(b) Replace the `price` column's `cell` (currently around lines 395-409, the body using `scorporoDisplay(row.original.price, …)` + `<Price>` + "netto") with:
```tsx
				cell: ({ row }) => (
					<ProductPriceCell
						price={row.original.price}
						vatRate={row.original.vatRate}
						appliedDiscount={row.original.appliedDiscount}
					/>
				),
```

(c) The `Price` symbol is no longer used in this file (it moved into `ProductPriceCell`). Remove it from the import block (lines 15-19) so it reads:
```ts
import { formatPriceEur, scorporoDisplay } from "@bibs/ui/components/price";
```
(`formatPriceEur` and `scorporoDisplay` are still used by the VAT column — keep them.)

- [ ] **Step 3: Typecheck seller**

Run: `bun run --filter @bibs/seller typecheck` (check `echo $?` → 0)
Expected: 0. `row.original.appliedDiscount` is now typed from the Eden response (Task 1's schema). If TS reports `appliedDiscount` missing on the row type, the api schema change from Task 1 isn't picked up — confirm Task 1 landed and the Eden types regenerated (restart the typecheck).

- [ ] **Step 4: Commit**

```bash
git add apps/seller/src/features/products/components/product-price-cell.tsx apps/seller/src/routes/_authenticated/products/index.tsx
git commit -m "feat(seller): show active promotion + discounted price in products table

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Frontend — offer "Applica promozione" only on active products

**Files:**
- Modify: `apps/seller/src/features/products/components/product-row-actions.tsx`
- Modify: `apps/seller/src/features/products/components/product-bulk-toolbar.tsx`

- [ ] **Step 1: Row action — gate to active**

In `product-row-actions.tsx`, the "Applica promozione" `DropdownMenuItem` is currently wrapped in `{status !== "trashed" && ( … )}`. Change that wrapper condition to `{status === "active" && ( … )}` (only that item — leave the "Aggiungi a negozio" item, which keeps `status !== "trashed"`, untouched).

- [ ] **Step 2: Bulk toolbar — remove from the disabled group**

In `product-bulk-toolbar.tsx`, the "Applica promozione" `<Button>` appears as the first child in BOTH the `statusFilter === "active"` group and the `statusFilter === "disabled"` group. Remove it from the **`disabled`** group only (so the disabled group starts again with its "Abilita" button). Keep it in the `active` group. The `<ApplyPromotionDialog .../>` render at the end stays (still reachable from the active group).

- [ ] **Step 3: Typecheck seller**

Run: `bun run --filter @bibs/seller typecheck` (check `echo $?` → 0)

- [ ] **Step 4: Commit**

```bash
git add apps/seller/src/features/products/components/product-row-actions.tsx apps/seller/src/features/products/components/product-bulk-toolbar.tsx
git commit -m "feat(seller): offer apply-promotion only on active products

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] **API tests green**

Run: `cd apps/api && bun test tests/integration/seller-products.test.ts`
Expected: all pass.

- [ ] **Repo typecheck green**

Run: `bun run typecheck` (`echo $?` → 0)

- [ ] **Browser smoke** (seller dev :3002, `seller@dev.bibs` / `password123`):
  1. Apply a *running* promotion to a product → its Price cell shows the discounted price, the original struck-through, and a `−X%` badge; hovering the badge shows the promotion title; the "netto" line is the scorporo of the **discounted** price.
  2. A product with no active promotion is unchanged (price + netto).
  3. On the **Disabilitati** tab: a product's ⋯ menu has **no** "Applica promozione", and the bulk toolbar has **no** "Applica promozione" button. On **Cestino** too (none). On **Attivi**: both present.

- [ ] **Finish the branch** via `superpowers:finishing-a-development-branch` (push + PR + squash auto-merge).
