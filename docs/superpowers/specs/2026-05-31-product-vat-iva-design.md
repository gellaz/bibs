# Product VAT / IVA — Design

**Date:** 2026-05-31
**Status:** Design approved, pending spec review
**Scope tier:** Fiscal foundation (data model + order snapshot + seller breakdown). **Not** SDI/XML invoicing.

---

## 1. Problem & intent

Italian B2C retail prices are **VAT-inclusive by law** (Codice del Consumo). Today a bibs product carries a single
`price` (`numeric(10,2)`, e.g. `"9.99"`) interpreted as the **gross** price the customer pays. There is no VAT concept
anywhere — not in the product schema, the order line items, or Stripe (which only handles seller subscriptions).

Sellers want to:

1. See, per product, the price **with and without VAT** (gross + net + VAT amount), defaulting new products to the most
   common rate **22%**.
2. Have the VAT recorded as **real fiscal data** so it can later feed accounting / electronic invoicing (we build the
   *data foundation* now, not the SDI transmission).

Because prices are gross, this feature **scorpora** (extracts) VAT from a gross price — it never *adds* tax on top:

```
gross (price)   = 9,99 €
rate            = 22%
net (imponibile)= 9,99 / 1,22 = 8,19 €
VAT (imposta)   = 9,99 − 8,19 = 1,80 €
```

Italian VAT rates in scope: **22, 10, 5, 4, 0**.

---

## 2. Design decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Source of truth for a product's rate | **`products.vatRate`** column | Seller is fiscally responsible and must always override. Orders snapshot from here. |
| Macro-category role | **Suggested default only** (`suggestedVatRate`), prefilled into the form | The product form selects exactly **one** macro (single-select), so the suggestion is unambiguous. Coarse → a hint, not a guarantee; the per-product override stays prominent. Changing a macro's suggestion never mutates existing products. |
| Price semantics | Gross (VAT-inclusive) — unchanged | Matches Italian B2C law and current customer-facing usage. |
| `order.total` | **Unchanged** (stays gross) | VAT is decomposed, not added. |
| Fiscal reference per order | **Castelletto IVA** (per-rate imponibile/imposta) | Standard fattura-elettronica `DatiRiepilogo` rule. |
| Rate storage (product/macro) | `text({ enum })` + CHECK | Repo convention (`text`+enum+CHECK over `pgEnum`). |
| Rate storage (order snapshot) | plain `numeric(5,2)`, **not** enum-bound | Historical fidelity if legal rates change later. |
| Historical orders backfill | **NULL** (`vatRate`/`vatAmount`/`vatBreakdown` nullable) | Do not fabricate fiscal data on past transactions. Populated only for orders created after ship. |
| Customer UI | **No change** | Out of chosen scope; data exists for when wanted. |

---

## 3. Data model

### 3.1 `products.vatRate` — source of truth
- `apps/api/src/db/schemas/product.ts`
- `text("vat_rate", { enum: ["22","10","5","4","0"] }).notNull().default("22")`
- CHECK constraint mirroring the enum (`product_vat_rate_valid`).
- Migration backfills existing rows to `"22"` (additive, safe).
- Math converts to number in the service layer.

### 3.2 `product_macro_categories.suggestedVatRate` — admin-curated default
- `apps/api/src/db/schemas/product-macro-category.ts`
- Same enum, **NOT NULL default `"22"`**.
- Admin-owned table (admin-only CRUD), safe to extend.
- **Seed** (`apps/api/src/db/seed/base/categories.ts` + `product_categories.csv` or a follow-up seed step): map known macros to typical rates
  (e.g. food/alimentari → `"10"`, books/editoria → `"4"`), leave `"22"` for the rest. Unmapped → `"22"`.

### 3.3 `order_items.vatRate` + `order_items.vatAmount` — per-line snapshot
- `apps/api/src/db/schemas/order.ts`
- `vatRate numeric(5,2)` **nullable**; `vatAmount numeric(10,2)` **nullable** (`>= 0` check when not null).
- Follows the existing snapshot pattern (`productName`, `productEan`, `brandName`, `productImageUrl`).
- `vatAmount` is **display-only** (per-line imposta); the authoritative figures live in the order castelletto (§4).

### 3.4 `orders.vatBreakdown` — castelletto IVA
- `apps/api/src/db/schemas/order.ts`
- `jsonb("vat_breakdown")` **nullable** — array `[{ rate: number, taxableAmount: string, taxAmount: string }]`.
- Same precedent as `stores.closures jsonb`.

---

## 4. Money math (pure domain unit)

New pure module **`apps/api/src/lib/vat.ts`** (mirrors `lib/money.ts`), tested in `apps/api/tests/lib/vat.test.ts`.
All arithmetic in integer cents via `toCents`/`fromCents`.

```
scorporo(grossCents, rate):
  netCents = roundHalfUp(grossCents / (1 + rate/100))  // commercial half-up rounding, on cents
  vatCents = grossCents - netCents                     // difference → net + vat == gross exactly
  return { netCents, vatCents }

buildCastelletto(lines):                            // lines: { grossCents, rate }[]
  group lines by rate
  for each rate r:
    grossR      = sum(grossCents of lines at r)
    { netCents, vatCents } = scorporo(grossR, r)    // scorporo on the AGGREGATE, not per line
    push { rate: r, taxableAmount: fromCents(netCents), taxAmount: fromCents(vatCents) }
```

- Castelletto is computed on the **per-rate aggregate gross** (fattura-elettronica rule), so it is the fiscal reference.
- Per-line `vatAmount` is computed independently for display and may differ from the rate-group total by ±1 cent — this is
  expected and correct (documented, not a bug).
- `order.total` is unchanged; `sum(taxableAmount + taxAmount)` over the castelletto equals `order.total`.
- Rate `0%`: net = gross, vat = 0.

---

## 5. API surface

- **Entities** (`apps/api/src/lib/schemas/entities.ts`): `ProductSchema += vatRate`; `OrderItemSchema += vatRate, vatAmount`;
  `OrderSchema += vatBreakdown`; `ProductCategory`/macro schema `+= suggestedVatRate`.
- **Product create/update body** (`apps/api/src/lib/schemas/forms/products.ts`, route `apps/api/src/modules/seller/routes/products.ts`):
  `vatRate` optional. On create, if omitted → take the selected macro's `suggestedVatRate`, else `"22"`. On update, optional patch.
  Italian OpenAPI `description` on the field.
- **Order creation** (`apps/api/src/modules/customer/services/orders.ts`, ~L226–322): when resolving each item, read
  `product.vatRate`, snapshot it onto the order line, compute per-line `vatAmount`; after the loop, build `vatBreakdown` via
  `buildCastelletto`. `order.total` logic unchanged.
- **Admin macro-category** (`apps/api/src/modules/admin/routes/product-macro-categories.ts`): accept `suggestedVatRate` in
  POST/PATCH bodies; expose in the entity response.
- **Discounts**: no change (discounts are display-only today and do not enter orders).

---

## 6. Seller UI

### 6.1 Product table — `apps/seller/src/routes/_authenticated/products/index.tsx`
- **Prezzo** cell: gross prominent (`<Price>`), with `netto X,XX €` muted on a sub-line.
- **IVA** column (new): VAT amount in € with the rate as a badge, e.g. `1,80 € · 22%`.
- Both extras are **toggleable** via the existing column-visibility menu (same mechanism as `brand`/`ean` hidden by default).
- (Open ritocco: split into separate `Aliquota` + `IVA €` columns if preferred — decide at review.)

### 6.2 Product form — `apps/seller/src/features/products/components/product-form.tsx`
- **Aliquota IVA** select (22 / 10 / 5 / 4 / 0), **prefilled from the chosen macro's `suggestedVatRate`** (fallback 22%).
- **Live scorporo preview** under the price input: `Imponibile 8,19 € · IVA 1,80 €`, recomputed as price/rate change.
- Reuse `formatPriceEur` from `packages/ui/src/components/price.tsx`.

### 6.3 Seller order view
- **Castelletto IVA** summary (imponibile/imposta per rate) under the order total, from `order.vatBreakdown`.

---

## 7. Admin UI

- **Aliquota IVA suggerita** field in the macro-category create/edit form + a column in the list.
- Seed populates initial suggestions (see §3.2).

---

## 8. Out of scope (explicit)

- Customer-facing VAT display (chosen scope B, not C; data is present for a future toggle).
- SDI / electronic-invoice XML generation, scontrino telematico.
- Stripe Tax integration.
- VAT *natura* codes (esente art.10 / non imponibile / fuori campo, distinct from `0%`) — future refinement.

---

## 9. Verification

- **TDD** on the pure domain (`lib/vat.ts`): scorporo inverse property, rounding edges (odd cents), `0%`, mixed-rate
  castelletto (sum == gross), `createOrder` with mixed-rate lines snapshots correct per-line rate + correct castelletto.
- No concurrency tests (the testcontainer serializes transactions; this is deterministic domain logic).
- `bun run typecheck` (propagates Eden types to 3 frontends), `bun run lint`, `bun run test` (apps/api).
- Drizzle: `bun run db:generate`, read the SQL, then `bun run db:migrate`.
- Browser smoke: seller product table + form (scorporo preview), seller order view (castelletto), admin macro-category form.

---

## 10. Affected files (map)

- `apps/api/src/db/schemas/product.ts` — `vatRate`
- `apps/api/src/db/schemas/product-macro-category.ts` — `suggestedVatRate`
- `apps/api/src/db/schemas/order.ts` — `order_items.vatRate/vatAmount`, `orders.vatBreakdown`
- `apps/api/src/lib/vat.ts` (new) + `apps/api/tests/lib/vat.test.ts` (new)
- `apps/api/src/lib/schemas/entities.ts`, `apps/api/src/lib/schemas/forms/products.ts`
- `apps/api/src/modules/seller/routes/products.ts`
- `apps/api/src/modules/customer/services/orders.ts`
- `apps/api/src/modules/admin/routes/product-macro-categories.ts`
- `apps/api/src/db/seed/base/categories.ts` (+ macro seed values)
- `apps/seller/src/routes/_authenticated/products/index.tsx`
- `apps/seller/src/features/products/components/product-form.tsx`
- seller order view component + `apps/admin` macro-category form
