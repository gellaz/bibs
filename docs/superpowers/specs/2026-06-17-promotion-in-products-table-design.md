# Show applied promotion in the seller products table — design

**Date:** 2026-06-17
**Scope:** seller app (`apps/seller`) + seller products list annotation in `apps/api`
**Migration:** none
**Follows:** the apply-promotion feature (#118) — adds the missing *visibility* of an applied promotion in the products table, plus tightens where the apply action is offered.

## Problem

A seller can now apply a promotion to products, but the products table doesn't show
it: there's no indication a product is discounted and no discounted price. The seller
can't see the effect on price without leaving the table. Separately, the apply action
is currently offered on **disabled** products too, which makes no sense (a disabled
product isn't for sale).

## Goals

1. In the products table, show the **active** promotion's effect on price: discounted
   price + struck original + `−X%` badge, with the promotion title in a tooltip.
2. Offer "Applica promozione" **only on active products** (row + bulk).

## Key facts

- **`getBestActiveDiscounts(productIds)`** (`apps/api/src/modules/seller/services/discount-pricing.ts:70`)
  already returns, per product, the best **running** discount — `status='active'`,
  `starts_at <= now`, `(ends_at IS NULL OR ends_at >= now)`, same seller — as
  `{ discountId, title, percent, endsAt, originalPrice, discountedPrice }`. This is
  exactly "the promotion currently affecting the price", identical to the storefront.
  The customer search already annotates with it (`customer/services/search.ts:137`).
- **VAT is already computed on the discounted price** in checkout
  (`customer/services/orders.ts:271-277`: discount the unit, then `scorporo`). So the
  table's "netto" line must, when a promotion is active, be the scorporo of the
  **discounted** price to match the actual order/invoice. (VAT base = the consideration
  actually paid; the seller's purchase/cost price is irrelevant here.)
- The seller products list (`seller/services/products.ts` `listProducts`) returns
  `ProductWithRelationsSchema` and does **not** include discount info today.
- `ProductWithRelationsSchema` (`lib/schemas/composed.ts:102`) is shared by the list
  (`seller/routes/products.ts:165`) **and** a single-product GET (`:301`).
- Seller root already wraps `<TooltipProvider>` (`apps/seller/src/routes/__root.tsx:79`),
  so shadcn `Tooltip` works in cells with no extra setup.
- Price cell today (`products/index.tsx:395-409`): `scorporoDisplay(price, vatRate)` →
  `<Price value={price} />` + a muted "netto {net}" subline.

## Design

### Part A — Annotate the seller products list with the active discount

In `listProducts` (`seller/services/products.ts`), right before `return { data, pagination }`
(after the `productIds`-order sort), batch-fetch and annotate:

```ts
const discountMap = await getBestActiveDiscounts(data.map((p) => p.id));
const annotated = data.map((p) => {
  const d = discountMap.get(p.id);
  return {
    ...p,
    appliedDiscount: d
      ? { percent: d.percent, discountedPrice: d.discountedPrice, title: d.title }
      : null,
  };
});
return { data: annotated, pagination: { page, limit, total } };
```

- Empty page (`productIds.length === 0`) → `data` is `[]`, `getBestActiveDiscounts([])`
  returns an empty map; annotation is a no-op. (Confirm the helper handles `[]` without
  a malformed `IN ()` query; if it doesn't, guard with `ids.length ? … : new Map()`.)
- **Response schema:** add a dedicated list-item schema in `lib/schemas/composed.ts`,
  leaving `ProductWithRelationsSchema` (and the single-GET) untouched:

```ts
export const AppliedDiscountSchema = t.Object({
  percent: t.Integer({ minimum: 1, maximum: 99 }),
  discountedPrice: t.String({ description: "Prezzo scontato (numeric.2)" }),
  title: t.String(),
});

export const SellerProductListItemSchema = t.Object({
  ...ProductWithRelationsSchema.properties,
  appliedDiscount: t.Nullable(AppliedDiscountSchema),
});
```

Point the list route response at it: `seller/routes/products.ts:165` →
`okPageRes(SellerProductListItemSchema)`. The single-GET at `:301` keeps
`ProductWithRelationsSchema`.

Only the best **running** discount is shown (the helper's definition) — scheduled and
paused assignments do not appear, matching "applied to the price".

### Part B — Price cell shows the discount

New `ProductPriceCell` (`apps/seller/src/features/products/components/product-price-cell.tsx`)
rendered by the Price column (`products/index.tsx`):

- **No `appliedDiscount`** → unchanged: `<Price value={price} />` + "netto {scorporo(price)}".
- **With `appliedDiscount`** →
  - line 1: discounted price emphasized + original price struck-through +
    a `−{percent}%` `Badge`; the badge is wrapped in a shadcn `Tooltip` whose content is
    the promotion `title`.
  - line 2: "netto {scorporo(**discountedPrice**, vatRate)}" — net of the *discounted*
    price, so it matches the order/invoice.
- Uses `formatPriceEur` / `scorporoDisplay` (already imported in the route) for
  formatting consistency with the rest of the table. Sorting stays on list `price`
  (unchanged).
- The table's `Product` row type picks up `appliedDiscount` automatically from the Eden
  response once the schema changes.

### Part C — Offer "Applica promozione" only on active products

- `product-row-actions.tsx`: change the apply item's gate from `status !== "trashed"`
  to `status === "active"`.
- `product-bulk-toolbar.tsx`: remove the "Applica promozione" button from the
  `disabled` group; keep it only in the `active` group. (Dialog render stays; it's only
  reachable from the active group now.)

## Edge cases / decisions

- A **disabled/trashed** product that still has a running discount assigned: the cell
  will show the discount wherever `getBestActiveDiscounts` returns one (simplest, and
  informative — the discount data is real even if the product isn't currently sold). Not
  suppressed by product status.
- Tooltip uses the shadcn `Tooltip` (provider already present); no native-title fallback
  needed.

## Testing & verification

- **API (TDD)** in the seller products integration test: a product in a **running**
  discount → its list row has `appliedDiscount` with the right `percent`/`title` and a
  `discountedPrice` equal to `round(price * (1 - percent/100), 2)`; a product with no
  discount → `null`; a product whose only discount is **paused** or **scheduled** →
  `null` (not active).
- **Typecheck**: `bun run typecheck` (root) green.
- **Browser smoke** (seller): apply a running promo to a product → its Price cell shows
  discounted + struck original + `−X%`, hovering the badge shows the promo title, and the
  "netto" line reflects the discounted price; a product with no active promo is unchanged;
  the "Applica promozione" action is absent on disabled and trashed products (row + bulk).

## Out of scope (YAGNI)

- Showing scheduled/paused (assigned-but-not-live) promotions in the table.
- A dedicated "Promozione" column.
- Annotating the single-product GET or the product edit page with the discount.
- Any change to how VAT/discounts are computed at checkout (already correct).
