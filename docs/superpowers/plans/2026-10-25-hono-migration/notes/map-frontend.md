# Frontend ↔ API coupling map (Eden → hc)

> Copiata dallo scratchpad della sessione di pianificazione il 2026-10-25, senza tagli. I percorsi `scratchpad/hono/...` citati qui ora stanno in questa cartella: vedi la sezione «Note e prototipi» di [`../../2026-10-25-hono-migration.md`](../../2026-10-25-hono-migration.md#note-e-prototipi).

Snapshot: main @ e4be2926 (= feat/hono-migration). Read-only survey. Paths are repo-relative.
Helper outputs: `scripts/calls.json` (178 call sites + 1 test-only, extractor `scripts/eden-calls.mjs`),
`scripts/grouped.txt`, `scripts/tsc-times.txt`, `scripts/rpc.md` (Hono RPC doc).

Decision-record update read mid-task: **validation = Zod** (Marco, 2026-10-25). TypeBox leaves the repo,
seller forms move to the zod resolver. Section 4 answers the "TypeBox 1.x" question as asked, then the Zod path.

---

## 1. The client

### Shared factory — `packages/ui/src/lib/api-client.ts`
- `:1` `import { treaty } from "@elysiajs/eden"`; `:3` `import type { Elysia } from "elysia"` (generic constraint
  `App extends Elysia<any,…>` at `:28-29`). `packages/ui/package.json:12` deps `@elysiajs/eden`, `:42` devDep `elysia`.
- `:28-45` `createApiClient<App>(apiUrl, { parseDate })` → `createIsomorphicFn().server(...).client(...)`; both branches
  are identical `treaty<App>(apiUrl, { fetch: { credentials: "include" }, parseDate })`. Callers use **`api()`** (a call).
  Server branch forwards **no cookies/headers**: SSR calls are anonymous.
- `:31` `parseDate` default `true` (Eden revives every date-like string, incl. `dd/mm/yyyy`, `dd-mm-yyyy`, `yyyy-mm-dd`).
- `:50-60` `edenMessage(error)`: reads `error.value` if string, else `error.value.message`.
- `:68-81` `unwrap(res, fallback)`: if `res.error` → throws `ApiError(message, status)` (status numeric) or `Error`;
  if `res.data == null` → throws `Error(fallback)`; else returns `res.data` (callers then drill `.data`).
- `packages/ui/src/lib/api-error.ts:6-14` `class ApiError extends Error { status }`.
- `packages/ui/src/lib/query-retry.ts:10-14` `shouldRetryQuery`: no retry on `ApiError` 4xx. (test:
  `apps/customer/src/lib/query-retry.test.ts:2,7-13` via `~/lib/api-error`).
- `packages/ui/src/lib/date.ts:16-24` `toYMD(string|Date)` (UTC parts), `:31-40` `formatDate(string|Date)`; both tolerate
  strings → keep working after Eden is gone.

### Per app
| app | file | client(s) | base URL |
|---|---|---|---|
| admin | `apps/admin/src/lib/api.ts:1-6` | `api` only | `import.meta.env.VITE_API_URL \|\| "http://localhost:3000"` |
| customer | `apps/customer/src/lib/api.ts:1-13` | `api`, `apiNoDates` (`:13`) | same |
| seller | `apps/seller/src/lib/api.ts:1-17` | `api`, `apiNoDates` (`:13`); re-exports `edenMessage, unwrap` (`:17`) | same |

- App type: `import type { App } from "@bibs/api"` → `apps/api/package.json` exports `"."` types `./src/types.ts`
  → `apps/api/src/types.ts:7` `export type { App } from "./index"` (whole Elysia app). `:8` also exports `auth` type.
- `@elysiajs/eden` is a dep of admin/customer/seller (`apps/*/package.json` ~l.24-28) though only `packages/ui` imports it.
- Env: `apps/*/src/env.ts:17` validates `VITE_API_URL` (zod url, default localhost:3000), but `lib/api.ts` reads
  `import.meta.env` directly.
- better-auth client (unchanged by the migration but mounted on the same server): `apps/*/src/lib/auth-client.ts:5-12`,
  `baseURL: ${API_URL}/auth/api`, `credentials: "include"`, `inferAdditionalFields<typeof auth>()` — keep `/auth/api` path.

### `apiNoDates` (parseDate:false) — where used
- customer `apps/customer/src/features/products/product-detail-api.ts:29` → `GET /customer/products/:id` (characteristics
  free text). Defense: `apps/customer/src/features/products/format-characteristic.ts:28` (`instanceof Date` → null).
- seller `apps/seller/src/routes/_authenticated/products/$productId.tsx:47` → `GET /seller/products/:id`.
  Defense: `apps/seller/src/features/products/lib/characteristic-form.ts:28`.
- With hc (no reviver) both become plain `api` usages; the defenses become dead code.

### Error body handling (what the FE expects)
API envelope: `apps/api/src/lib/responses.ts:16-18` `errorBody(code, message) = { success:false, error, message }`.
`apps/api/src/plugins/error-handler.ts`: ServiceError → its status (`:51-74`, +`resentAt` for PendingVerificationError
`:67-71`); pg 23505 → 409 CONFLICT (`:80-96`); 23503 → 409/400 (`:101-122`); 23514 → 400 (`:125-139`); VALIDATION →
422 `VALIDATION_ERROR` with Italian `validationMessage(error)` (`:141-177`; response-side → 500); INVALID_FILE_TYPE → 422
(`:180-195`); NOT_FOUND → 404 (`:197-208`); else 500.

FE consumption patterns (Eden `{data, error:{status, value}}`):
- `unwrap(...)`: **127 calls** (files: admin 9, customer 9, seller 43). Reads only `value.message` + `status`.
  admin wraps it once more in `apps/admin/src/features/crud/category-crud-panel.tsx:57-66` (`EdenRes<T>` type,
  config contract `:99-102` list/create/update/remove return Eden responses).
- direct `error.value?.message`: admin `use-category-characteristics.ts:22,49,66`, `store-categories.config.tsx:39,131`,
  `seller-moderation-dialog.tsx:90,122`, `stores.tsx:128`, `sellers/index.tsx:144`, `sellers/$sellerId.tsx:39`,
  `billing/pricing.tsx:78`; seller `invite.$token.tsx:58-59`.
- error **code** read: `apps/customer/src/routes/register.tsx:88-98` and `apps/seller/src/routes/register.tsx:49-59`:
  `value.error === "EMAIL_PENDING_VERIFICATION"` + `value.resentAt` (409 body). Only FE reader of `error` code.
- `error.status` branches: customer `product-detail-api.ts:33` (404→null), `use-store-detail.ts:35` (404→null),
  `use-orders.ts:44` (400/409 on cancel), seller `use-pickup.ts:15,28` (404), `checkout-progress.ts:28`
  (`ApiError` 404), `stock-editor-cell.tsx:59-62` (`ApiError` 409/403).
- 409-specific UX (status only via ApiError/refetch): admin `category-crud-panel.tsx:260,306`,
  `use-category-characteristics.ts:69`, `requests/$changeId.tsx:83`; seller `products/$productId.tsx:123`.
- 422: FE never parses a field path; it shows `message` (Italian, built server-side). `success` flag never read.

### Locale / cookies
- Auth is cookie-based (better-auth session), cross-origin (3001/3002/3003 → 3000) with `credentials:"include"`; CORS
  in `apps/api/src/index.ts:41-52` (credentials true, allowedHeaders Content-Type/Authorization, exposeHeaders
  Content-Length/X-Request-Id). FE never reads `X-Request-Id`.
- Paraglide cookie `PARAGLIDE_LOCALE` (`apps/seller/src/paraglide/runtime.js:25`, path=/) rides along, **but the API does
  not read any locale** (grep of apps/api/src: no locale/cookie handling outside better-auth). 422/ServiceError messages
  are always Italian; FE localizes better-auth codes (`apps/*/src/lib/auth-error.ts`) and seller form rules itself.

### Eden runtime behaviors hc does NOT replicate (from `@elysiajs/eden@1.4.9` dist/chunk-TTKI5TQ7.mjs)
1. JSON reviver on **every** string incl. error bodies (so `resentAt` arrives as Date today).
2. Status outside 200–299 (3xx too) → `{data:null, error: EdenFetchError(status, parsedBody)}`; network failure →
   `error.status 503` (no throw). hc returns a raw `Response` (`res.ok`, `await res.json()`), fetch rejects on network error.
3. Body containing a `File` → automatic multipart, nested objects JSON-stringified per field. hc needs explicit `form:`
   and does `form.append(k, v)` (objects → "[object Object]", arrays → one entry per item).
4. Query: skips null/undefined, `Date`→ISO, objects→JSON. hc `buildSearchParams` skips only `undefined`
   (null → "null", Date → `String(date)`), and types query/param values as `string` (Hono RPC doc: "must be passed as string").
5. Non-JSON text responses coerced (numbers/booleans/dates). FE does not depend on it.

---

## 2. Call sites by prefix and app

Total **178** `api()/apiNoDates()` call sites in **87 files** (+1 in a test): admin 50 (19 files), customer 32
(21 files), seller 96 (47 files). (Decision record's "164 in 72" used a different counting; same order of magnitude.)
Indirect handles (counted once each): `holidays-panel.tsx:221` (patch+delete), `use-category-characteristics.ts:13`
(get/put/delete via `endpoint()`), `requests/$changeId.tsx:62` (approve/reject patch).

Per-app subtree actually used (drives "each app types only its subtree"):
- admin: `/admin/*`, `/me`, public catalog (`/product-macro-categories`, `/store-categories`, `/store-macro-categories`)
- customer: `/customer/*`, `/me`, `/locations`, `/register`
- seller: `/seller/*`, `/me`, `/locations`, `/register`, public catalog (`/product-categories`, `/product-macro-categories`)
- `/billing` (module has services only, no routes) and `/webhooks` (Stripe → API): **0 FE calls**.

| prefix | calls | admin | customer | seller | files |
|---|---|---|---|---|---|
| `/me` | 6 | 2 | 2 | 2 | admin `routes/_authenticated/profile.tsx:78,85`; customer `features/profile/profile-identity.tsx:56,63`; seller `features/profile/components/personal-info-card.tsx:73,80` (all `avatar` POST multipart / DELETE) |
| `/locations` | 5 | – | 2 | 3 | customer `features/addresses/use-geocode.ts:8`, `use-municipalities.ts:29`; seller `features/stores/hooks/use-geocode.ts:7`, `hooks/use-countries.ts:13`, `hooks/use-municipalities.ts:10` (SSR loader via `ensureQueryData` in 6 seller routes) |
| public catalog | 7 | 5 | – | 2 | admin `product-categories.config.tsx:36`, `product-macro-categories.config.tsx:34`, `store-categories.config.tsx:34,97`, `store-macro-categories.config.tsx:22`; seller `product-category-picker.tsx:24,46` |
| `/register` | 3 | – | 1 | 2 | customer `routes/register.tsx:83`; seller `routes/register.tsx:44`, `routes/invite.$token.tsx:48` |
| `/customer/products` | 4 (+1 test) | | 4 | | `product-detail-api.ts:29` [noDates], `catalog/use-product-search.ts:66`, `catalog/use-product-facets.ts:56`, `discovery/use-nearby-products.ts:44` |
| `/customer/stores` | 5 | | 5 | | `stores/use-store-detail.ts:31`, `use-store-search.ts:60`, `use-store-facets.ts:47`, `use-store-products.ts:25`, `use-store-map.ts:67` |
| `/customer/checkout(s)` | 4 | | 4 | | `checkout/use-checkout.ts:47,67,88,121` |
| `/customer/orders` | 3 | | 3 | | `orders/use-orders.ts:18,31,41` |
| `/customer/cart` | 4 | | 4 | | `cart/use-cart.ts:14,52,64,75` |
| `/customer/addresses` | 4 | | 4 | | `addresses/use-addresses.ts:11`, `use-address-mutations.ts:22,34,48` |
| `/customer/points`, `/customer/profile` | 1+1 | | 2 | | `points/use-points.ts:15`, `profile/use-customer-profile.ts:6` |
| `/seller/stores` | 20 | | | 20 | `features/stores/components/{reservation-hours-field:54, sales-settings-panel:69,85, hours-closures-panel:87,112,121}`, `features/stores/hooks/use-store-order-types.ts:14`, `features/billing/components/cancel-store-dialog.tsx:40`, `components/store-billing-banner.tsx:30`, `hooks/{use-first-store-onboarding:25, use-stores:13}`, `routes/_authenticated/{billing:157, store/index:85,114,133,137, store/archived:70,82, store/new:75,93}` |
| `/seller/products` (+stock) | 19 | | | 19 | `features/products/components/{product-status-tabs:18, product-stock-manager:56,73, product-form:188, store-assignment-dialog:47}`, `features/products/hooks/{use-seller-categories-in-use:18, use-stock-adjust-mutation:69,80, use-bulk-stock-adjust-mutation:35, use-product-mutations:44,76,98}`, `routes/_authenticated/products/{index:178, $productId:47[noDates],62,82,101, new:35,51}` |
| `/seller/employees` | 10 | | | 10 | `hooks/use-employee-stores.ts:15,32`, `routes/_authenticated/team/index.tsx:86,98,109,124,145,167,180,195` |
| `/seller/discounts` | 9 | | | 9 | `features/promotions/hooks/use-discounts.ts:25,37,48,62,81,95,116,133`, `routes/_authenticated/promotions/new.tsx:24` |
| `/seller/orders` | 8 | | | 8 | `features/orders/hooks/use-orders.ts:20,35,48,69,77,85`, `use-pickup.ts:12,27` |
| `/seller/billing` | 6 | | | 6 | `components/store-billing-banner.tsx:18`, `hooks/use-active-store.tsx:71`, `routes/_authenticated/billing.tsx:119,128,137,146` |
| `/seller/settings` | 6 | | | 6 | `features/online-payments/hooks/use-online-payments.ts:9,20`, `features/profile/components/{business-info-card:83, pending-vat-change:32, vat-change-dialog:28}`, `hooks/use-seller-settings.ts:20` |
| `/seller/onboarding` | 5 | | | 5 | `hooks/use-onboarding.ts:19,63,75(multipart),95,106` |
| `/seller/{brands,dashboard,checkout-sessions,product-categories}` | 1 each | | | 4 | `brand-combobox.tsx:57`, `routes/_authenticated/index.tsx:56`, `store/new_.processing.tsx:47`, `hooks/use-category-characteristics.ts:6` |
| `/admin/product-categories` | 6 | 6 | | | `product-categories.config.tsx:106,119,124,128,139(import multipart)`, `category-characteristics/hooks/use-category-characteristics.ts:13` |
| `/admin/holiday-definitions` | 6 | 6 | | | `holidays/components/holidays-panel.tsx:128,136,151,169,185,221` |
| `/admin/sellers` | 6 | 6 | | | `components/seller-moderation-dialog.tsx:85,117`, `requests/$changeId.tsx:62`, `sellers/index.tsx:122,131`, `sellers/$sellerId.tsx:36` |
| `/admin/product-characteristics` | 5 | 5 | | | `product-characteristics.config.tsx:125,138,140,144,170(import multipart)` |
| `/admin/store-categories` | 4 | 4 | | | `store-categories.config.tsx:110,115,118,129(import multipart)` |
| `/admin/billing` | 4 | 4 | | | `billing/index.tsx:23`, `billing/pricing.tsx:49,74`, `billing/subscriptions.tsx:46` |
| `/admin/{product-macro,store-macro}-categories` | 3+3 | 6 | | | `product-macro-categories.config.tsx:44,49,53`, `store-macro-categories.config.tsx:32,34,38` |
| `/admin/requests` | 3 | 3 | | | `requests/use-request-counts.ts:10`, `requests/index.tsx:96`, `requests/$changeId.tsx:55` |
| `/admin/stores`, `/admin/configurations` | 2+1 | 3 | | | `stores.tsx:109,117`, `configurations/index.tsx:21` |

Top-level totals: seller 87, admin 43, customer 27, public catalog 7, me 6, locations 5, register 3.

Request-shape facts per module PR:
- **Multipart (10)**: `/me/avatar` POST ×3; seller product images POST `new.tsx:51`, `$productId.tsx:101`; store images
  `store/index.tsx:137` (`{ files }` arrays); `/seller/onboarding/document` PATCH `use-onboarding.ts:75` (fields + File);
  admin CSV imports ×3 (`{ file }`). hc: `form:` explicit.
- **GET with query: ~52 of 80 GETs**; numbers everywhere (`page`, `limit`, `lat`, `lng`, `radius`) → hc types want strings.
- **Dates in request bodies**: `promotions/new.tsx:24-28` (`startsAt: new Date(...)`), `use-discounts.ts:78-81` (PATCH typed
  `Date`), `seller-moderation-dialog.tsx:87,119` (`expectedUpdatedAt: updatedAt`, a Date revived from the response —
  API `modules/admin/routes/sellers.ts:23` `t.Date`). Wire is ISO either way (JSON.stringify), but types change and the
  Hono-side schema must accept an ISO string.

---

## 3. Date hydration dependency

API response schemas use `t.Date()` 77× (`lib/schemas/entities.ts` 47, `discount.ts` 8, `composed.ts` 6, `dashboard.ts` 2,
`holidays.ts` 2, `modules/admin/routes/billing.ts` 3, `sellers.ts` 1, `modules/seller/routes/billing.ts` 4, `stores.ts` 4).
Eden types those as `Date`; hc types them as `string` (`hono/dist/types/utils/types.d.ts:28-42` JSONParsed: Date →
`toJSON()` → string). So code that calls Date methods on a `Date`-typed field becomes a **type error** under hc (good);
code that hides it behind casts/`any` does not. No date-fns in apps (only `packages/ui` calendar), no date comparisons
or sorts on response fields.

HARD (calls Date methods on the response value, or relies on a Date type):
- `/seller/dashboard`: `apps/seller/src/features/dashboard/dashboard-actions.ts:38,43` (`oldestCreatedAt: Date|null`,
  `endsAt: Date`), `:123-124` `target.getTime()`, used at `:145,:207`; fed from `routes/_authenticated/index.tsx:75`.
  Typecheck will flag it under hc → wrap in `new Date(...)`.
- `/seller/orders`: `routes/_authenticated/orders/$orderId.tsx:84,118` `order.reservationExpiresAt as Date` (runtime is
  tolerant: `order-labels.ts:62-65` and `:118` wrap `new Date`; the casts must go — `string as Date` is a TS error).
- `/seller/billing`: `hooks/use-active-store.tsx:30,32,73` casts to `Subscription[]` with `currentPeriodEnd: Date`,
  `suspendedAt: Date|null`; route `apps/api/src/modules/seller/routes/billing.ts:85` returns `ok(data) as any` → **no type
  safety**; consumers are tolerant today (`store-billing-banner.tsx:65`, `cancel-store-dialog.tsx:25,60`,
  `billing.tsx:70,82` all `new Date`/`Date|string`). Silent if someone adds a `.getTime()` later.
- `/admin/sellers`: `components/seller-moderation-dialog.tsx:35` (`updatedAt: Date`), `sellers/index.tsx:68` round-trip as
  `expectedUpdatedAt` (types only; wire identical).

TOLERANT (already `Date | string` / `new Date(x)` / `toYMD` / `formatDate`; keep working, some become dead code):
- `/seller/stores`: `hours-closures-panel.tsx:44,48,49` toYMD (closure calendar dates, t.String revived by Eden);
  `dashboard-actions.ts:33,106` `opensAt.date` toYMD; `reservation-hours-field.tsx:107`; `store/archived.tsx:48`.
- `/seller/discounts`: `promotions/index.tsx:113-122` (typeof string branch), `:171-177`; `promotions/$discountId.tsx:50`;
  `promotion-state-badge.tsx:16-26,50-51`; `apply-promotion-dialog.tsx:32-37`.
- `/seller/products`: `routes/_authenticated/products/index.tsx:130-135` (`DateCell` string|Date); noDates + defense
  `characteristic-form.ts:28`.
- `/seller/orders`: `orders/index.tsx:138`, `orders/$orderId.tsx:98`; `order-labels.ts:62-65`.
- `/seller/employees`: `team/index.tsx:721` formatDate.
- `/customer/orders`: `orders/index.tsx:131`, `orders/$orderId.tsx:101`, `order-display.ts:37-50`, `pickup-countdown.tsx:16-17`.
- `/customer/checkout(s)`: `checkout/$checkoutId/pay.tsx:111`, `checkout/reservation-copy.ts:6,20,38-48` (toYMD opensAt.date),
  `orders/store-closed-note.tsx:11`.
- `/customer/stores`: `use-store-detail.ts:64`, `use-store-map.ts:102`, `use-store-search.ts:100` (toYMD opensAt.date).
- `/customer/points`: `points/point-display.ts:43-58` → `new Date(tx.createdAt)`; `points.tsx:146` uses the converted Date.
- `/customer/profile`: `profile/profile-identity.tsx:17-18,128` formatMonthYear(Date|string).
- `/customer/products`: noDates + defense `format-characteristic.ts:28`.
- `/register`: `customer/routes/register.tsx:92-98`, `seller/routes/register.tsx:56-59` `Date.parse(errVal.resentAt)` —
  Eden revives `resentAt` (API emits ISO string, `apps/api/src/lib/errors.ts:60`, `registration/services.ts:123`), so today
  `Date.parse(Date)` loses ms; with hc it parses the ISO string (better, not a break).
- `/admin/*`: all local row types `createdAt: Date | string` (5 category configs + `crud/category-crud-panel.tsx:72`,
  `holidays-panel.tsx:70-71`), toYMD `holidays-panel.tsx:95,446,449`, `requests/index.tsx:57,67-68`,
  `requests/$changeId.tsx:35-37`, `sellers/$sellerId.tsx:355`, `sellers/index.tsx:67`, `billing/subscriptions.tsx:27`.
- `/me`, `/locations`: no date fields used.

---

## 4. Shared schemas

`apps/api/package.json` exports:
- `@bibs/api/schemas` → `apps/api/src/lib/schemas/forms/index.ts` (side-effect `import "./formats"` registers
  `calendar-date` via `FormatRegistry.Set`, `forms/formats.ts:1,26`). Exports: `DOCUMENT_NUMBER_EXAMPLES,
  IDENTITY_DOCUMENT_TYPES, IdentityDocumentType, isDocumentExpired, isValidDocumentNumber, normalizeDocumentNumber,
  todayInRome` (identity-document), `AcceptInviteBody, CompanyBody, DocumentBody, PersonalInfoBody, TeamInviteBody`
  (onboarding), `OpeningHoursSchema`, `CharacteristicValueInputSchema, CharacteristicValuesField, CreateProductBody,
  VatRateSchema`, `RejectSellerBody, SELLER_REJECTION_REASONS, SellerRejectionFixStep`, `CompanySettingsBody,
  DocumentChangeBody, PersonalSettingsBody, VatChangeBody`, `CreateStoreBody`.
- `@bibs/api/validation-rule` → `apps/api/src/lib/validation-rule.ts` (`ValidationRule` union + `validationRule()`;
  `:1-3` imports `Kind, TSchema`, `ValueErrorType`, `Value` from `@sinclair/typebox`).
- All `forms/*.ts` import `Type` from **`@sinclair/typebox`** (0.34.52), **not elysia** (only relative imports otherwise).
  Custom Italian `error:` props on schemas (e.g. `forms/onboarding.ts:10-172`, `stores.ts:15-69`, `products.ts:45-87`).

FE consumers:
- seller forms with `typeboxResolver(TypeCompiler.Compile(schema))`:
  `features/stores/components/store-form.tsx:1,10-13,53-54,129` (CreateStoreBody),
  `features/products/components/product-form.tsx:14,20,48,113` + `features/products/lib/product-form-schema.ts:1-18`
  (`Type.Omit(CreateProductBody…)` + own price pattern),
  `routes/_authenticated/onboarding/{personal-info.tsx:1,13-14,26-30,57; company.tsx:1,15-16,28-32,52; document.tsx:1-10,29-30,42-46,94}`.
- seller types: `hooks/use-onboarding.ts:1-2,74` (`Static<typeof DocumentBody>`).
- seller error map: `lib/typebox-resolver.ts:1-9` (`@hookform/resolvers/typebox`, registers errors), `lib/typebox-errors.ts`
  (`SetErrorFunction`, `ValueErrorType` from `@sinclair/typebox/errors`; `SCHEMA_ERRORS` IT→Paraglide map `:22-51`;
  `error.schema.error` lookup `:62`), `lib/typebox-formats.ts:1-21` (`FormatRegistry` "uri"), `lib/rule-message.ts:1`
  (type-only `ValidationRule`). Test `lib/typebox-errors.test.ts` (all 5 form schemas, asserts every `error:` has a
  translation `:184`).
- admin: `components/seller-moderation-dialog.tsx:1-4` imports `SELLER_REJECTION_REASONS`, `SellerRejectionFixStep`
  (data/type only).
- Resolver: `@hookform/resolvers` **5.9.2** (catalog `^5.9.2`); its `typebox` subpath imports `@sinclair/typebox`,
  `@sinclair/typebox/compiler` (`TypeCheck`), `@sinclair/typebox/value` (peer `@sinclair/typebox ^0.25.24`). Latest
  `@hookform/resolvers@6.0.0` typebox resolver is **still on `@sinclair/typebox`**.

If moved to TypeBox 1.x (`typebox` 1.4.3, exports `./compile ./error ./format ./guard ./schema ./system ./type ./value`):
no `@sinclair/typebox/compiler` `TypeCompiler`/`TypeCheck` (now `Compile` from `typebox/compile`), no `FormatRegistry`
(now `Format.Set`), no `ValueErrorType` / `SetErrorFunction` (errors are AJV-style `{keyword, schemaPath, instancePath,
params}`, localized via `System.Locale`), `Kind` symbol → `'~kind'`, errors carry no `schema` ref (so `error.schema.error`
custom messages need schemaPath resolution), no Standard Schema surface found in the d.ts. Breaks: the hookform typebox
resolver (both 5.9.2 and 6.0.0), `typebox-errors.ts`, `typebox-formats.ts`, `forms/formats.ts`, `validation-rule.ts`,
`unionRule` (`anyOf`/`Kind` checks), the 6 `TypeCompiler.Compile` sites, and the Eden `Union(map)` → never trick.
**Moot after the Zod decision**, but the same list is the seller work for Zod.

Zod path (decided): FE already has zod plumbing in all three apps (`apps/*/src/lib/zod-resolver.ts`, `zod-errors.ts`;
`packages/ui/src/lib/zod-issue-rule.ts:9-28` mirrors `ValidationRule` kinds; zod 4.6.7; `zodResolver` used in admin 8,
customer 2, seller 5 files). Watch: zod 4 global `localeError` applies only where the schema has **no** message, so
Italian messages ported from `error:` would always win → seller needs the `SCHEMA_ERRORS` translation logic re-done for
zod (and its test). `ValidationRule` type (`@bibs/api/validation-rule`) is imported by `seller/src/lib/rule-message.ts:1`
— keep the export (or move it to `packages/ui`) when `validation-rule.ts` loses TypeBox. Seller alias trap: never add
`apps/seller/src/lib/<name>.ts` that shadows `apps/api/src/lib/<name>.ts` (memory note).

---

## 5. Tests and typecheck config

Runner: Vitest 4.1.12 (`vitest.base.ts:19-33`: `tsconfigPaths`, `~/` alias, React Compiler, `environment: node`;
`apps/{admin,customer,seller}/vitest.config.ts`, `packages/ui/vitest.config.ts`; `pretest` compiles Paraglide).

Tests coupled to Eden:
- `apps/customer/src/features/products/product-detail-api.test.ts` — real client, `globalThis.fetch` stub (`:13-23`);
  test 1 (`:63-72`) **asserts Eden revives `05/03/2027` into a Date** via `api()` → obsolete/red under hc; test 2 asserts
  strings via `fetchProductDetail` (keeps value); test 3 (`:87-`) 404 → null via `error.status`.
- seller `features/stores/components/sales-settings-panel.test.tsx:24-40`, `hours-closures-panel.test.tsx:20-31`,
  `components/order-types-sidebar-card.test.tsx:26-45`: `vi.mock("@/lib/api")` replacing `api()` with a hand-built
  Eden-shaped tree (`seller.stores(...).patch`, `["order-types"].get`, `.closures.{get,put}`, `settings.payments...`)
  returning `{ data, error: null }`. Must be rewritten to the hc shape (`[":storeId"].$patch`, `Response`).
- Indirect: `seller/src/lib/typebox-errors.test.ts` (schemas), `seller/.../checkout-progress.test.ts` (ApiError),
  `customer/src/lib/query-retry.test.ts` (ApiError). No packages/ui test for `unwrap`/`edenMessage`.

tsconfig (typecheck cost):
- `tsconfig.base.json`: `strict: true`, **`skipLibCheck: true`**, `noEmit`. `tsconfig.web.json`: bundler resolution,
  `verbatimModuleSyntax`, `noUnusedLocals/Parameters`, `types: ["vite/client"]`.
- `apps/{admin,customer,seller}/tsconfig.json`: `include src/**`, `exclude ["../../packages/**","../api/src/**"]` (doesn't
  stop import-following), **`paths: { "@/*": ["./src/*", "../api/src/*"], "~/*": ["../../packages/ui/src/*"] }`** — the
  fallback is what lets the API source (imported for `App`/`auth` types and `@bibs/api/schemas`) typecheck inside each FE.
  **No project references, no composite/incremental, no prebuilt .d.ts**: every FE typecheck re-checks the API source.
- Baseline (main checkout, `tsc --noEmit --extendedDiagnostics`, stale Paraglide so a few TS2339 noise errors):
  admin 4401 files / 2.23M instantiations / check 6.65s / total 9.1s / 1.35GB;
  customer 3867 / 2.10M / 6.24s / 8.5s / 1.25GB; seller 4977 / 2.37M / 7.85s / 11.7s / 1.50GB.
  Hono docs: RPC types get slow with many routes; recommended fix = compile `hcWithType` ahead (needs a build step /
  project references) or one `hc` per sub-app; `strict: true` required on both sides (already); FE and API must share one
  `hono` version (catalog it).

---

## 6. TanStack Query layer (invasiveness)

- Query keys are hand-written arrays/constants (e.g. `PRODUCTS_KEY`, `["seller","settings"]`, `categoryCharacteristicsKey`),
  **not derived from Eden paths** → untouched by the client swap.
- Hooks: admin 21 useQuery / 16 useMutation / 1 queryOptions; customer 17 / 8 / 3 useInfiniteQuery; seller 37 / 44 /
  1 queryOptions. Eden calls sit inside `queryFn`/`mutationFn`, mostly as `unwrap(await api()…, msg).data`.
- Natural seam: make `unwrap` (packages/ui) accept the hc `Response` (async: check `res.ok`, parse JSON, read
  `message`, throw `ApiError(status)`), so the 127 call sites change mechanically from `unwrap(await X, m)` to
  `await unwrap(X, m)` plus the path/verb rewrite. Hand-rolled spots: the 11 admin `error.value?.message` sites, register
  ×2 (error code + resentAt), 7 `error.status` branches, admin `CategoryCrudPanel` `EdenRes<T>` contract (5 configs).
- Types derived from Eden: explicit `typeof api` 3 (`customer product-detail-api.ts:4-9`, `seller team/index.tsx:513-528`),
  `Awaited<ReturnType<typeof fetchX>>` ~9 (customer use-customer-profile:11, use-geocode:17, use-addresses:16, use-cart:19,
  review.tsx:56; seller use-geocode:11, use-category-characteristics:12), `NonNullable<typeof data>["data"][number]` 3
  (admin stores.tsx:133, seller orders/index.tsx:103, products/index.tsx:213). hc equivalent: `InferResponseType`.
- Path syntax rewrite per call: `api().seller.stores({ storeId }).patch(body)` →
  `client.seller.stores[":storeId"].$patch({ param: { storeId }, json: body })`; `.get({ query })` →
  `.$get({ query: { page: String(page) } })`; multipart → `{ form }`.
- SSR: only seller `municipalitiesQueryOptions` (`/locations/municipalities/all`) runs in loaders (6 routes) — public, no
  cookie forwarding needed; keep the isomorphic factory or a plain module-level `hc` (both branches identical today).
