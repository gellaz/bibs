# Apply an existing promotion to products — design

**Date:** 2026-06-16
**Scope:** seller app (`apps/seller`) + small filter changes in `apps/api`
**Migration:** none (the stored `discount.status` and the `discount_products` join table are untouched)

## Problem

A seller can create promotions and, today, assign products to them only from the
promotion page via a heavy catalog-search picker (`ProductSelector`, ~564 lines,
dual-mode). There is no way to put a product on an existing promotion while working
in the **products** table — which is where a seller naturally thinks "put these
items on sale".

This work adds that product-centric gesture (row action + bulk action), and takes
the opportunity to (a) simplify the promotion **state** taxonomy and (b) slim the
promotion create/edit page now that adding products lives elsewhere.

## Key facts that shape the design

- **The API already exists and is idempotent.** `POST /seller/discounts/:discountId/products`
  accepts 1–100 product IDs and returns `{ added, alreadyPresent, rejected }`
  (`apps/api/src/modules/seller/services/discounts.ts:168`). Adding a product that is
  already in the promotion is a no-op. No new write endpoint is needed.
- **No price conflict to resolve.** A product may belong to many promotions; the
  storefront already resolves the *best active* one — highest `percent`, `status='active'`,
  within the date window (`getBestActiveDiscount`, `discount-pricing.ts:23`). "Apply a
  promotion" is therefore purely additive.
- **Relationship:** `discount_products` is many-to-many (PK `(discountId, productId)`),
  cascade-deletes on both sides (`db/schemas/discount.ts:66`).

## Design overview

Three workstreams on one branch, each independently shippable:

| Part | What | Surface |
|------|------|---------|
| A | Simplify promotion badge (5 → 4) and tabs (6 → 2) | api filter + seller badges/tabs |
| B | Apply-promotion action (row + bulk) | seller products table |
| C | Slim the promotion create/edit page | seller promotions routes |

Final mental model — a clean, learnable split:
- **Products table → ADDS** a product (or a selection) to an existing promotion.
- **Promotion page → VIEWS + REMOVES** the products in a promotion.
- Removal stays only on the promotion page, so the products table never needs to
  show promotion membership.

---

## Part A — Simplify promotion states & tabs

Two separate concepts, simplified independently:

**Row badge — 5 → 4 states.** Today the UI derives **5** operational states from the 3
stored `status` values (`active`/`paused`/`archived`) combined with the date window
(`promotion-state-badge.tsx:18`): `running`, `scheduled`, `expired`, `paused`,
`archived`. The `expired` vs `archived` split is the confusing one — both just mean
"this promotion is over" — so they merge into a single **Conclusa**. `running` (live
now), `scheduled` (starts in future) and `paused` (manually off) stay distinct: each is
a different situation and drives a different action. So the badge shows **4** values:
`running | scheduled | paused | concluded`.

**Tabs / list filter — 6 → 2.** Today: `Tutte · In corso · Programmate · In pausa ·
Scadute · Archiviate`. The catch-all "Tutte" is misleading (it silently excludes
archived). Replace the whole bar with **two** honest tabs:

- **Attive** (default) = `running + scheduled + paused` — the working set. This is
  exactly the `assignable` set, so the Attive tab and the apply-promotion picker show
  the **same** promotions.
- **Concluse** = `expired + archived`.

The precise per-row state stays visible in the **badge**, so collapsing the granular
tabs loses no information for a modest catalog.

**The stored `status` enum does not change.** Only the *derived display states* and
the *list filter* change. No migration.

### API (`apps/api`)

`DiscountOperationalStateSchema` (`lib/schemas/discount.ts:8`) and the
`DiscountOperationalState` type + `listDiscounts` switch
(`modules/seller/services/discounts.ts:266`):

The filter enum collapses to the two values the UI actually uses:

- **`assignable`** → `status='paused' OR (status='active' AND (ends_at IS NULL OR ends_at >= now()))`
  — i.e. running + scheduled + paused. Backs the **Attive** tab *and* the apply picker.
- **`concluded`** → `status='archived' OR (status='active' AND ends_at IS NOT NULL AND ends_at < now())`
  — backs the **Concluse** tab.
- Final enum: `assignable | concluded` (was `all | scheduled | running | paused | expired | archived`).
  These two partition the space cleanly: `assignable ∩ concluded = ∅`, and together they
  cover every promotion (`assignable ∪ concluded = all`).
- Server default `state` becomes `assignable` (the default tab); `listDiscounts` rewrites
  its `switch` to these two cases.
- Update the route `detail.description` wording (`routes/discounts.ts:54`) which
  currently mentions the `archived` state explicitly.

### Seller frontend

- `features/promotions/components/promotion-state-badge.tsx`: `operationalState()`
  returns `running | scheduled | paused | concluded`; update the `OperationalState`
  type, `STATE_LABELS`, `STATE_CLASSES` (Conclusa reuses today's muted grey). **Badge
  keeps 4 states** — only the tab filter is 2.
- `features/promotions/components/promotion-state-tabs.tsx`: `PromotionState` type +
  `ORDER` become `assignable · concluded` (labels: **Attive · Concluse**, default
  `assignable`).
- `routes/_authenticated/promotions/index.tsx`: `validateSearch` valid-states array
  becomes `["assignable","concluded"]` with default `assignable`; the `EMPTY_MESSAGE`
  map covers the two tabs.
- `messages/{it,en}.json`: add `promotions_tab_active` ("Attive"),
  `promotions_state_concluded`/`promotions_tab_concluded` ("Conclusa"/"Concluse"), and
  `promotions_empty_active` + `promotions_empty_concluded`; remove the now-unused
  `*_state_all`, `*_state_expired`, `*_state_archived` and the `*_empty_*` keys for the
  dropped tabs.

---

## Part B — Apply-promotion action (row + bulk)

### New mutation hook

`features/promotions/hooks/use-discounts.ts` — add `useApplyPromotionToProducts()`:

```
mutate({ discountId, productIds })  →  POST /seller/discounts/:discountId/products
```

(The existing `useAddDiscountProducts` binds the `discountId` at hook-creation time,
which does not fit a picker where the discount is chosen at apply time.) On success,
invalidate `["discounts"]` (list product counts) and
`["discounts","products", discountId]`.

### New shared component — `ApplyPromotionDialog`

`features/products/components/apply-promotion-dialog.tsx`, used by **both** entry points.
Pattern mirrors `bulk-stock-adjust-dialog.tsx`.

- **Props:** `{ open, onOpenChange, productIds: string[], onSuccess?: () => void }`.
- **Data:** `useDiscountsList({ state: "assignable", page: 1, limit: 100 })`.
- **Body:** title shows the product count; a scrollable **single-select** list of
  promotions. Each row: title, `-X%` badge, period (`gg mmm → gg mmm` / `∞`),
  `PromotionStateBadge`, product count. Select via radio/row click.
- **Footer:** Annulla + **Applica** (disabled until one promotion is selected / while
  pending).
- **Empty state** (no assignable promotions): message + a link to `/promotions/new`
  (no inline creation — applying a *previously created* promotion is the whole premise).
- **Success:** toast built from `{ added, alreadyPresent, rejected }`, e.g.
  *"3 prodotti aggiunti a «Saldi estivi» · 1 già presente"*; if `rejected.length > 0`
  (cross-seller — should not happen from one's own table) show a warning. Then
  `onSuccess?.()` and close.
- Coerce promotion dates with the existing `toYMD()` helper / the index page's
  string|Date handling (Eden hydrates ISO dates to `Date`).

### Row action — `product-row-actions.tsx`

Add an "Applica promozione" item (tag icon) shown when `status !== "trashed"`, opening
the dialog with `productIds={[productId]}`. (Mirrors the existing "Aggiungi a negozio"
item which already manages a dialog via local `useState`.)

### Bulk action — `product-bulk-toolbar.tsx`

Add an "Applica promozione" button in the `active` **and** `disabled` groups (not
`trashed`), opening the dialog with `productIds={selectedIds}` and
`onSuccess={onClear}`. Trashed products are excluded (a promotion on a trashed product
is meaningless).

---

## Part C — Slim the promotion create/edit page (Option A)

Now that products are added from the products table, the catalog-search picker on the
promotion page is redundant. Remove it. Keep only the ability to **see and remove** a
promotion's products, which is inherently promotion-centric.

### New component — `IncludedProductsList`

`features/promotions/components/included-products-list.tsx` (replaces `ProductSelector`
in the edit page):

- **Props:** `{ discountId: string }`.
- **Data:** `useDiscountProducts(discountId, page, limit)` (existing hook + endpoint;
  rows already carry `originalPrice` and server-computed `discountedPrice`).
- **Render:** a compact list/table — name, original price (struck), discounted price,
  and a per-row remove `✕` calling `useRemoveDiscountProducts(discountId)`. Paginated
  with `DataPagination` (the endpoint is already paginated).
- **Empty state:** "Nessun prodotto in questa promozione" + a deeplink to `/products`
  ("Aggiungi prodotti dalla tabella Prodotti"). This closes the create→empty cold-start
  loop without reintroducing a picker.

### `routes/_authenticated/promotions/new.tsx` (create)

- Remove the `ProductSelector` section, the `productIds`/`percent` state that fed it,
  and `initialProductIds` from the create call (send `undefined`; the API field stays,
  just unused).
- Collapse the `2fr_3fr` two-column layout to a single centered column (just
  `DiscountForm`). Drop the now-unused `SectionHeader` import.

### `routes/_authenticated/promotions/$discountId.tsx` (edit)

- Replace `<ProductSelector mode={{ kind: "mutate", … }} />` with
  `<IncludedProductsList discountId={discountId} />`. Keep the two-column layout
  (form | included list) and the existing `SectionHeader` (reword its subtitle to
  reflect "view/remove; add from Prodotti").

### Cleanup

- Both routes' `onCancel` currently navigate with `search: { …, state: "all" }`; update
  to the new default `state: "assignable"` (the `"all"` value no longer exists).
- Delete `features/promotions/components/product-selector.tsx` (no remaining importers
  after the two route changes).
- The create-body `initialProductIds` field and the `addProductsToDiscount` "initial
  products in same transaction" path stay in the API (harmless, still covered by tests);
  the UI simply stops sending it.

---

## Testing & verification

- **API (TDD):** extend the discounts service/route tests for the new `concluded` and
  `assignable` filters (boundary cases: active-future = assignable+not concluded;
  active-past-end = concluded+not assignable; paused = assignable; archived = concluded;
  no-end-date running = assignable). Update any test that passed `state: "expired"` or
  `"archived"`.
- **Typecheck/lint:** `bun run typecheck` + Biome across `apps/seller` and `apps/api`.
- **Browser smoke** on the real authenticated seller (`seller@dev.bibs` / `password123`,
  `bibs dev` on seller :3002):
  1. Products table → row "Applica promozione" → pick a promo → toast + count rises on
     the promo page.
  2. Select several rows → bulk "Applica promozione" → applied to all; selection clears.
  3. Promotion edit page shows the included list; remove a product → count drops.
  4. Create a promotion → no products section; lands on edit with the empty-state +
     deeplink.
  5. Promotions list shows two tabs, **Attive · Concluse** (default Attive); a past-end
     and an archived promo both badge as **Conclusa** and appear under "Concluse"; a
     running, a scheduled and a paused promo all appear under "Attive" with their
     distinct row badges.

## Out of scope (YAGNI)

- Creating a promotion from the apply dialog.
- A catalog-search picker on the promotion page (removed; re-add later only if large
  curated campaigns become a real need).
- Any customer/storefront change ("best discount wins" is already server-side).
- Showing promotion membership in the products table.
