# AGENTS.md

This file provides backend-specific guidance to coding agents working in `apps/api`.

## Project Overview

The bibs API is the backend of a local-commerce marketplace, built with **Hono** (web framework) on the **Bun**
runtime. It uses **Drizzle ORM** with **PostgreSQL + PostGIS** for data persistence, **Zod** for validation and
**better-auth** for authentication (email/password, RBAC via admin plugin). The OpenAPI spec is generated from the
routes' Zod schemas and `doc()` metadata and served at `/openapi` (Scalar UI) and `/openapi/json`.

For Hono APIs read the official docs as Markdown — index at `https://hono.dev/llms.txt`, any page with
`curl -H 'Accept: text/markdown' https://hono.dev/docs/<path>` — or the `hono` skill in `.agents/skills/hono`. The
API ran on Elysia until October 2026; the move to Hono (decisions, accepted deltas, golden files) is recorded in
[`docs/superpowers/plans/2026-10-25-hono-migration.md`](../../docs/superpowers/plans/2026-10-25-hono-migration.md).

### Hono CLI

Check routes with **Hono CLI** (devDependency `@hono/cli` 1.0 rc) instead of curl or a dev server: it loads the real
app, `src/app.ts` (no side effects at import), and calls it in process. Run the CLI file with Bun from `apps/api`,
with two externals: `-e bun` (`src/infra/s3.ts` imports from `bun`) and `-e @bibs/emails` (the CLI would compile the
react-email templates with Hono's JSX):

```bash
cd apps/api
# every route, @ERROR/@NOT_FOUND included
bun node_modules/@hono/cli/dist/cli.js routes src/app.ts -e bun -e @bibs/emails
# one request: status, headers, body
bun node_modules/@hono/cli/dist/cli.js request /health src/app.ts -e bun -e @bibs/emails
# a flow, one JSON step per line ("-" instead of the file reads stdin)
bun node_modules/@hono/cli/dist/cli.js batch steps.jsonl src/app.ts -e bun -e @bibs/emails --compact
# what the app answers today, as batch lines
bun node_modules/@hono/cli/dist/cli.js snapshot --status-only src/app.ts -e bun -e @bibs/emails
```

Bun loads the env of `apps/api` (`.env`) as for the dev server; where there is none (a worktree), pass a file with
`bun --env-file=<file> node_modules/@hono/cli/dist/cli.js …`. The infra must be up (`bun run infra:up`) and requests
hit the real dev database: write only to test entities. In a batch file a step like
`{"method":"POST","path":"/auth/api/sign-in/email","body":{"email":"seller@dev.bibs","password":"password123"}}`
logs in and its cookie carries to the next steps; a step without `expect` fails on a 4xx/5xx, and the last JSON line
holds the summary (`.data.summary.failed`). Two things that do not work here: `bunx hono` (it runs the CLI on Node,
where `bun` does not resolve) and `hono diff` (it bundles `src/index.ts`, the server entry, and ends in
`SNAPSHOT_FAILED`).

## Commands

- `bun install` — install dependencies
- `bun run dev` — start dev server with watch mode (port 3000)
- `bun run build` — bundle the project into `dist/` (target Bun)
- `bun run typecheck` — run TypeScript type checking (`tsc --noEmit`)
- `bun run test` — run all tests (unit + integration). Never bare `bun test` for the whole suite: it skips `--isolate`
- `bun run test:unit` — run unit tests only (`tests/unit/`)
- `bun run test:integration` — run integration tests only (`tests/integration/`, 180s timeout; builds the test image first)
- `bun run test:image` — build the `bibs-postgis-test:latest` image the integration tests start (needed once before running a single integration file with `bun test`)
- `bun run infra:up` — start PostGIS (5432), SeaweedFS (S3 9000, admin UI 9001) and Mailpit (8025/1025) containers
- `bun run infra:down` — stop and remove containers
- `bun run infra:reset` — stop containers and delete volumes (full reset)
- `bun run db:generate` — generate Drizzle migration files from schema changes
- `bun run db:migrate` — apply migrations to the database
- `bun run db:push` — push schema directly to the database (no migration files)
- `bun run db:studio` — open Drizzle Studio to browse the database
- `bun run db:clean` — delete all migration files (`src/db/migrations/`)

After making code changes, always run `bun run typecheck` to verify there are no type errors.

## Architecture

### App — `src/app.ts`

The root Hono app, with no side effects at import (tests, tools and the Hono CLI import it):

- `rootApp()` — `new Hono({ getPath: rawPath })` with `onError` and `notFound` answering with the JSON error
  envelope, then the global middleware in this order: `requestLog`, `cors`, `requestId`, `socketIpAsForwardedFor`
  (below). Tests build their probe apps on it.
- `app` — `rootApp()` plus `/openapi` and `/openapi/json`, `/health` and `/ready`, then `absoluteUrlOnly` (a request
  whose URL is not absolute — empty or invalid `Host`, HTTP/1.0 without `Host` — is a 400 from here on), better-auth
  on `ALL /auth/*`, and every module sub-app attached with `app.route(prefix, subApp)` from the `MODULES` table
  (prefix, sub-app, guards). Exported as `app` and as the default export (for the Hono CLI).
- At import, `honoPaths()` builds the OpenAPI paths of every module and runs `assertRoutes` with the module's
  guards: a route without its guard, or with its validators after the guard or out of order, stops the API at
  boot.

`rawPath` (`src/http/app.ts`) routes on the raw path (`/me/%61vatar` is a 404) and tolerates a trailing slash.

### Server — `src/index.ts`

The only module with side effects: `startCronJobs()`, then `ensureBucket()` (creates the S3 bucket if missing), then
`Bun.serve({ port: env.PORT, fetch: app.fetch, … })`. Bun passes the server to `fetch` as `c.env`, which is how
`socketIpAsForwardedFor` and `rateLimit` read the socket IP. On `SIGTERM`/`SIGINT` it stops the server and closes the
database pool.

### Middleware — `src/http/middleware/`

Plain Hono middleware (1–4, 7) and the two route groups in `src/http/` (5–6):

1. **`request-log.ts`** — `requestLog`: one line per request on stdout (time, level, duration, method, path, status;
   `INFO`/`WARNING`/`ERROR` by status, colours only on a terminal) and a JSON line in `logs/app.log` (single file,
   no rotation).
2. **`cors.ts`** — `cors`: `hono/cors` for the React frontends, with credentials. Localhost is accepted automatically
   in development and test, `ALLOWED_ORIGINS` in production (`isOriginAllowed`, same file). Every `OPTIONS` is answered as a 204
   preflight before any route.
3. **`X-Request-Id`** — `hono/request-id`, registered in `src/app.ts`: on every response except the preflight (the
   client's id when it is letters, digits, `_`, `-` or `=` and at most 255 characters, otherwise a fresh UUID), also
   in `c.var.requestId`.
4. **`better-auth.ts`** — `socketIpAsForwardedFor` overwrites `x-forwarded-for` with the socket IP and drops
   `x-real-ip`, so a client cannot dodge better-auth's rate limit (no-op without a socket, e.g. `app.request()` in
   tests); `authHandler` mounts better-auth's handler on `/auth/*` (`hono/mount`), so its endpoints live at
   `/auth/api/*`.
5. **`openapi-routes.ts`** — `/openapi` (Scalar UI) and `/openapi/json`: better-auth's paths and components plus the paths
   of `/health`, `/ready` and every module, built on the first request and cached. OpenAPI tags are declared here.
6. **`health.ts`** — `GET /health` (liveness probe, always 200) and `GET /ready` (readiness probe: DB + S3, 503 if
   either fails).
7. **`rate-limit.ts`** — `rateLimit({ name, limits })`, a per-route middleware with in-memory buckets keyed by IP or
   by the body's `email` (registration, sign-in, geocoding); it goes after the route's `v()` and guard.

### Jobs — `src/jobs/`

`scheduler.ts` — `startCronJobs()` with `croner`, called only by `src/index.ts` (tests, tools and the CLI never
schedule a tick). The five jobs live next to it, one file each: `expireReservations` and `expireUnpaidOrders` every
minute, `retryStoreTransfers` hourly at :30, `expirePendingStoreCreations` hourly, `autoCancelSuspendedStores` daily
at 03:00 (server local time).

The HTTP kit the routes use lives in `src/http/`: `moduleApp()` (`app.ts`), `v()` (`validator.ts`), `send()`
(`send.ts`), `doc()` and the OpenAPI generator (`openapi.ts`), the guards (`auth.ts`), `guard()`, `publicRoute` and
`assertRoutes` (`routes.ts`), the error mapping (`errors.ts`) and the 422 messages (`validation-message.ts`).

Test data can be seeded separately via `bun run db:seed` (see `src/db/seed/`).

### Schemas — `src/lib/schemas/`

Zod schemas, imported from their own file (no barrel): `@/lib/schemas/entities`, `@/lib/schemas/responses`, …

- **`t.ts`** — constructors for the API's own rules: `zString` (lengths in UTF-16 units, pattern, format), `zInteger`
  (an integer or a string holding one) and `zInt()` (a number only, used by the shared forms), both checked with
  `Number.isInteger` (no safe-int limits); `zNumeric` and `zBooleanString` (numbers and booleans in query and
  params), `zDate` (ISO strings and timestamps in, `Date` out as an ISO string), `zFormat`, `zFile`, `zFiles`. Use them
  instead of `z.string().min()/.max()`, `z.int()` / `z.number().int()` and Zod's string formats.
- **`formats.ts`** — `FORMATS`, the API's string formats (`email`, `uuid`, `uri`, `date`, `date-time`,
  `calendar-date`).
- **`entities.ts`**, **`composed.ts`** (nested relations), **`queries.ts`**, **`pagination.ts`** (`PaginationQuery`),
  **`discount.ts`**, **`stock.ts`**, **`holidays.ts`**, **`dashboard.ts`**, **`locations.ts`**, **`registration.ts`** —
  entity, response, query and body schemas.
- **`responses.ts`** — `okRes()`, `okPageRes()`, `OkMessage`, error schemas per status code, `withErrors()` /
  `withConflictErrors()`.
- **`forms/`** — the form schemas shared with the seller app, exported as `@bibs/api/schemas`.
- **`mirror.ts`**, **`issues.ts`** — validator internals (the cleaning the API has always applied and the first
  error it reports), used by `src/http/`.
- Every schema carries an Italian description (`.meta({ description })` or the constructor option); a `title` or
  `error` in the meta changes the 422 message.

### Environment — `src/infra/env.ts`

Validates all environment variables at startup with Zod. If any required variable is missing, the server exits
immediately with a clear error listing the missing variables. Always import `env` from this module instead of using
`process.env` directly.

Required: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
`S3_BUCKET`, `STRIPE_SECRET_KEY`.
Optional (defaults in `env.ts`): `PORT` (default `3000`), `ALLOWED_ORIGINS`, `NODE_ENV` (default `development`), and the
rest of the schema (Stripe webhook secrets, email, app URLs, geocoding).

### Email — `src/infra/email.ts`

Email sending via **Resend** in production, Mailpit in development:

- In dev: delivers to the local Mailpit catcher (web UI on :8025); falls back to logging if Mailpit is down
- In production: sends via Resend API using `RESEND_API_KEY`
- Used for email verification during seller onboarding and employee invites
- Templates live in `packages/emails` (`@bibs/emails`); see `packages/emails/src/index.tsx`. Preview them with `bun run dev:emails` (port 3004); `@react-email/ui` is a devDependency of `packages/emails`, so the preview server boots non-interactively on fresh clones.

### Config & Errors — `src/lib/config.ts`, `src/lib/errors.ts`, `src/http/responses.ts`

`config.ts` centralises business constants: `pointsPerEuro` (1), `pointsPerEuroDiscount` (100), `reservationHours`
(`{ min: 1, max: 72, default: 24 }`, limits of the per-store `stores.reservation_hours`), `reservationGraceMinutes` (15),
`maxImagesPerProduct` (10), `maxProductsPerImport` (500), `shippingCost` (€5.00), and pagination defaults (20/100). `errors.ts` exports
`ServiceError`, a typed error class with `ErrorStatus` (a strict union of valid HTTP status codes: 400, 401, 403, 404,
409, 422, 500, 503) and derived `ErrorCode` strings. `responses.ts` provides runtime response helpers (`ok()`,
`okPage()`, `okMessage()`, `errorBody()`) that match the schemas.

### Logging — `src/infra/logger.ts`

**Pino**, plus the per-request line of `src/http/middleware/request-log.ts`:

- **Request logging** — one line per request on stdout and a JSON line (`type: "request"`, method, path, status,
  `durationMs`) in `logs/app.log` (single file, no rotation)
- **`logger`** — the Pino logger for every context (route handlers, services, cron jobs, startup, timers); writes to
  both stdout and the log file
- **Redaction** — automatically redacts `password`, `token`, `apiKey`, `secret`, `authorization` fields
- **Log level** — `debug` in development, `info` in production (based on `NODE_ENV`)

Errors are logged once, by the error mapping (`toErrorResponse`, `src/http/errors.ts`), with status, path and
method — never the submitted values.

### Money — `src/lib/money.ts`

Utilities for safe monetary arithmetic:

- `toCents(price: string): number` — converts decimal string ("9.99") to integer cents (999)
- `fromCents(cents: number): string` — converts integer cents back to decimal string with 2 decimals

All monetary calculations use cents internally to avoid floating-point errors.

### Order State Machine — `src/lib/order-state-machine.ts`

Defines valid status transitions per order type using typed keys (
`Partial<Record<OrderStatus, Partial<Record<OrderStatus, readonly OrderType[]>>>>`):

- `pending` → `confirmed` / `cancelled`
- `confirmed` → `ready_for_pickup` / `completed` / `cancelled`
- `ready_for_pickup` → `shipped` (delivery only) / `completed`
- `shipped` → `delivered` / `completed`

`assertTransition(from, to, orderType)` throws `ServiceError(400)` if the transition is invalid.

### Order Helpers — `src/lib/order-helpers.ts`

Shared helper `refundStockAndPoints(tx, order)` for restocking items and refunding loyalty points within an existing DB
transaction. Used by cancellation, expiry, and pickup-expired flows to avoid code duplication.

### Reservation Expiry — `src/jobs/expire-reservations.ts`

Each store picks how long a `reserve_pickup` reservation lasts: `stores.reservation_hours` (1–72, default 24) **opening
hours**. `insertOrder` computes the deadline once, at confirmation, with the pure `reservationDeadline()`
(`src/lib/holidays/reservation-deadline.ts`) fed by `resolveReservationDeadlines()` (`src/lib/store-open-status.ts`):
it walks the store's slots in Europe/Rome time, skipping closures and holidays (opt-outs respected). A store without
declared hours, or with no opening within 60 days, falls back to calendar hours. The deadline is stored in
`orders.reservation_expires_at` and never recomputed.

The cron job in `src/jobs/scheduler.ts` runs `expireReservations()` every minute (`*/1 * * * *`) and is the
single source of truth — no in-memory timers, no per-order scheduling. Both the cron and the seller completion guard
allow `config.reservationGraceMinutes` (15) past the deadline (`reservationGraceCutoff()`): many deadlines fall exactly
at closing time, and a customer served at 19:01 must not lose a 19:00 reservation. Customers always see the real deadline.

On expiry, the order status is set to `expired`, stock and points are refunded via the shared `refundStockAndPoints()`
helper. `expireSingleReservation(orderId)` is also exported for one-off use; both paths transactionally re-check the
status, so concurrent runs are idempotent.

### Pagination — `src/lib/pagination.ts`

Reusable pagination utilities:

- `PaginationQuery` (`src/lib/schemas/pagination.ts`) — Zod schema for the `page` and `limit` query params
  (`v("query", PaginationQuery)`, or spread its fields into the route's query schema)
- `parsePagination(query)` (`src/lib/pagination.ts`) — returns `{ page, limit, offset }` from parsed query params

### Auth & Permissions — `src/infra/auth.ts`, `src/infra/permissions.ts`

Configures better-auth with:

- Drizzle adapter (`pg` provider)
- `openAPI` plugin for auto-generated OpenAPI docs
- `admin` plugin for RBAC
- Email/password sign-up
- `basePath` is `/api`, so auth endpoints are at `/auth/api/*`

**Authentication approach**:

- **Cookie-based sessions** — HTTP-only cookies for security
- **Bearer tokens** — Also returned in responses for `Authorization: Bearer <token>`
- Custom endpoints in `registration/` return both `customerProfile` and `sellerProfile`, allowing users to have dual
  roles

**Four roles**: **admin**, **seller**, **employee**, **customer**. Permissions defined in `src/infra/permissions.ts` using
better-auth's access-control system.

The `OpenAPI` export provides lazy-cached helpers (`getPaths`, `components`) that re-prefix better-auth's OpenAPI paths
under `/auth/api` and tag them as "Better Auth". These are merged into the main OpenAPI spec.

### Modules — `src/modules/`

Each module is a Hono sub-app: `index.ts` attaches its route files to a `moduleApp()`
and exports the app type for the frontends; `routes/` holds one chained `new Hono()`
per concern, with paths relative to the module prefix; `services/` holds the logic;
`context.ts` the module's shared helpers. Endpoint counts are intentionally not
tracked here — the OpenAPI spec at `/openapi` is the authoritative route list. The
domain map:

- `registration/` (`/register`) — customer/seller sign-up, unified sign-in (returns
  user + both profiles when present), employee-invite acceptance. Seller sign-up
  starts the onboarding ladder at `pending_email`. (Password reset is better-auth's
  native flow, configured in `src/infra/auth.ts` — not a custom route here.)
- `admin/` (`/admin`) — guarded by `user.role === "admin"`: category CRUD + CSV bulk
  imports, seller verification, profile-change review (`GET
  /admin/sellers/changes/pending`, `PATCH /admin/sellers/changes/:changeId/approve`,
  `PATCH /admin/sellers/changes/:changeId/reject` with optional reason), the
  "Richieste" inbox (`GET /admin/requests`, `GET /admin/requests/counts`,
  `GET /admin/requests/changes/:changeId`), holiday
  definitions, pricing configuration.
- `seller/` (`/seller`) — two guard levels: **seller role only** (`requireSellerRole`)
  for profile + onboarding routes, accessible to any authenticated seller regardless of
  onboarding status; **full** (`requireSeller`, requires `active` status + ownership
  checks) for everything else (`sellerGuards` in `index.ts`). Route files map 1:1 to concerns under `routes/`:
  stores, store-images, images (product), opening hours live in stores, closures,
  products (incl. CSV import), brands, stock, discounts, orders, employees (+
  invitations), settings change-requests, billing, checkout (Stripe).
  - **Settings** (`/seller/settings/*`): post-onboarding profile modification. Two levels:
    - *Level 1 — Free edit*: `PATCH /settings/personal` (personal info), `PATCH /settings/company` (company data
      excluding VAT). Applied immediately.
    - *Level 2 — Admin review*: `PATCH /settings/vat` (VAT change — blocks new orders during review),
      `PATCH /settings/document` (ID document update). Creates a `seller_profile_changes` record; current data stays
      active until admin approves. The owner can withdraw a pending request with
      `PATCH /settings/changes/:changeId/cancel`.
    - *Online payments*: `POST /settings/payments/onboarding` creates the seller's Stripe Connect account (if missing;
      Accounts v2 with the `recipient` configuration — `stripe_balance.stripe_transfers`, Express dashboard,
      fees/losses on the platform) and returns the Stripe-hosted v2 Account Link; `POST /settings/payments/sync`
      re-reads the account from Stripe (v2 retrieve) and refreshes the saved state (called by the FE on return from onboarding). State lives in `payment_methods`,
      also kept in sync by `POST /webhooks/stripe/connect` (`account.updated`). Owner-only; not exposed to employees.
    - `GET /settings` returns profile + organization + `onlinePayments` status (owner-only, `null` for employees) +
      pending change requests.
  - Access resolved from seller (owner) or employee role by `resolveSellerAccess` (`context.ts`)
    into `c.var.seller`. Ownership checks in `context.ts` (`ensureProductOwnership`,
    `requireOwner`). Store IDs are lazy-loaded via `c.var.seller.getStoreIds()`.
- `customer/` (`/customer`) — geo search (PostGIS), profile, addresses, orders (4 types: direct,
  reserve_pickup, pay_pickup, pay_deliver), loyalty points. Search is public, others require auth.
- `me/` (`/me`) — cross-role endpoints for any authenticated user (avatar today).
  Role-independent endpoints belong here, never duplicated in per-role modules.
- `locations/` (`/locations`) — public Italian regions/provinces/municipalities. No auth required:
  - `GET /locations/regions` — all Italian regions
  - `GET /locations/provinces` — provinces (optional `regionId` filter)
  - `GET /locations/municipalities` — paginated municipalities (optional `provinceId` filter)
- `catalog/` — public taxonomy listings (no auth): `GET /product-macro-categories`,
  `/product-categories`, `/store-macro-categories`, `/store-categories`. The writes
  live in `admin/`; the shared paged-by-name query is `src/lib/list-by-name-paged.ts`.
- `webhooks/` — Stripe webhook receiver at `POST /webhooks/stripe` (platform events)
  and `POST /webhooks/stripe/connect` (connected-account events, e.g.
  `account.updated`, secret `STRIPE_CONNECT_WEBHOOK_SECRET` falling back to
  `STRIPE_WEBHOOK_SECRET`): signature verification via `constructEventAsync` (async
  required on Bun), same `stripe_events` idempotency table and dispatcher for both
  routes, per-event handlers in `services/handlers/`. Dev setup and event flow:
  [docs/stripe-billing.md](../../docs/stripe-billing.md).
- `billing/` — internal services only (Stripe customer management + Connect account
  onboarding/refresh in `services/connect-account.ts`, Accounts v2 `recipient`); no routes of its own (mounted
  under `seller/settings`).

**Guards and route context.** Authentication is per route, never per module: each route lists its guard after its
validators, and the guard puts what it resolved in `c.var`, typed by its Env (`src/http/auth.ts`):

| Guard | Tag | Rejects | Adds to `c.var` |
|---|---|---|---|
| `requireAuth` | `auth` | 401 without a session | `user`, `session` |
| `requireCustomer` | `customer` | 401; 403 without a customer profile | `user`, `session`, `customerProfile` |
| `requireSellerRole` | `sellerRole` | 401; 403 if the role is not seller | `user`, `session` |
| `requireSeller` | `seller` | 401; the 403s of `resolveSellerAccess` (owner not active, employee without an active assignment, …) | `user`, `session`, `seller` (`sellerProfile`, `isOwner`, `accessCtx`, `getStoreIds()`, `getAccessibleStoreIds()`) |
| `requireAdmin` | `admin` | 401; 403 if the role is not admin | `user`, `session` |
| `publicRoute` | — | nothing (a deliberately public route) | — |

Every guard reads the session itself, so one guard per route is enough. The `MODULES` table in `src/app.ts` says
which guards each module accepts (`["admin"]`, `["customer", "publicRoute"]`, `sellerGuards` by path) and
`assertRoutes` enforces it at boot. A new guard is created with `guard(middleware, tag)` (`src/http/routes.ts`), or the
check does not see it. A guard does not re-read what an upstream middleware already set: the tests use that
(`withVars()`) to inject a user or a seller context without a session. Keep expensive lookups lazy and cached
(`getStoreIds()`), so routes that do not need them do not pay for them.

Complex business logic (order creation/pickup/cancel, product creation with categories, employee creation, product
search) is extracted into `services/` sub-folders under each module. Services use `db.transaction()` for multi-step
operations and atomic SQL expressions (`SET stock = stock - $n WHERE stock >= $n`) to prevent race conditions.

All list endpoints accept `page` and `limit` query parameters for pagination (defaults in `src/lib/config.ts`). Use
`PaginationQuery` from `src/lib/schemas/pagination.ts` for the query schema and `parsePagination()` for offset
calculation.

### Database — `src/db/`

- `src/db/index.ts` — exports a singleton Drizzle client backed by an explicit `pg.Pool`. Pool sizing is env-driven
  (`DATABASE_POOL_MAX`, `DATABASE_IDLE_TIMEOUT_MS`, `DATABASE_CONNECTION_TIMEOUT_MS`; defaults 20/30s/5s).
- `src/db/seed/` — split between idempotent reference data and dev/staging fixtures (run via `bun run db:seed`):
  - `index.ts` — top-level `seed(only?)` composes `seedBase()` then `seedFixtures(seedGroups(only))`
  - `groups.ts` — `bun run db:seed -- --only=<admin|customer|seller>` seeds one group; without the flag, everything.
    Base data, `pricing_config` and the admins always run. `customer` and `seller` are independent, and **orders
    exist only in the full seed** (they need both customers and sellers)
  - `base/` — idempotent reference data, no auth dependency, safe in any environment:
    - `index.ts` — `seedBase()` runs locations + categories in order
    - `locations.ts` — `seedLocations()` for regions, provinces, municipalities (skip-if-present)
    - `categories.ts` — `seedStoreCategories()`, `seedProductCategories()` (skip-if-present)
    - `fetch-locations.ts` — standalone script to refresh the location JSON from GitHub
    - `regions.json`, `provinces.json`, `municipalities.json` — generated and committed
  - `fixtures/` — test users for dev/staging only, depend on `better-auth`'s `signUpEmail`. Order matters: pricing
    config → admins → customers → [dev-seller → sellers → extra-stores → billing → store-images → store-profiles →
    team → brands → products → dev-seller catalog → characteristic values → discounts] → orders (the bracketed steps
    only with the `seller` group, orders only in the full seed). Each step is idempotent via canary check:
    - `index.ts` — `seedFixtures()` orchestrator
    - `admins.ts` — `seedAdmins()` (3 admin users)
    - `customers.ts` — `seedCustomers()` (~300 customers, `customer1..300@test.com`) plus the address book:
      customers 1–5 have two Bologna addresses («Casa» default, «Lavoro») in different districts, every other
      customer whose index is a multiple of 10 has one default «Casa» in a showcase municipality
    - `sellers.ts` — `seedSellers()` (~190 sellers; the first 95 are `active` → `seller1..seller95@test.com`).
      Sign-up dates follow the index: `sellerSignupDaysAgo(idx) = 400 − 2·idx`, so stores and subscriptions are
      created oldest-first in index order. The organization row is created only from `pending_review` onwards
      (registration doesn't create one); sellers before `pending_document` (`pending_email`, `pending_personal`) are still named after the
      email local part, and only `pending_email` is unverified; from `pending_company` on there is a document type
      (varied by `documentFor(idx)`) and a placeholder document photo (`pending_document` sellers have neither). Three active sellers exist for the missing-data states (`utils.ts`):
      seller11 has a store **without location**, seller14 a store **without photos**, seller18 a store
      **without subscription**.
      Two blocks, deliberately kept apart so one can grow without moving the other: idx 0–49 are the *national*
      sellers (a store in one of the ten showcase municipalities — in practice Bologna or Genova, since
      `pickHandle(idx, 5, 3)` alternates between those two), idx 50–54 are active **without** a store (the
      back-office empty state), and idx 55–94 are the **Bologna block** (`BOLOGNA_BLOCK_START`), all with a
      store, three fifths inside the comune and two fifths in the belt. Store coordinates come from
      `nationalPlacement()` / `bolognaAreaPlacement()` in `utils.ts`, which scatter stores around per-district
      anchors: the old `lat + (idx % 10) * 0.001` grid put every Bologna store inside 1 km of Piazza Maggiore,
      with exact collisions every ten sellers — one pin on the map and a distance filter that discriminated
      nothing
    - `extra-stores.ts` — `seedExtraStores()` adds branches to designated sellers, all idempotent per
      `(sellerProfileId, name)`:
      - national: 1–2 extra stores for idx `[0,7,14,21,28,35,42,49]`, named `<prefix> <lastName> <suffix>` with
        suffix ∈ {Centro, Stazione, …}
      - Bologna chains: 1–2 branches for idx `[56,59,62,65,68,71,74,77]`, named `<insegna> <lastName> <zona>`
      - Bologna incumbents opening in the belt: idx `[4,16,30]`, one branch each
      Together with the 25 national Bologna stores and the 40 of the Bologna block this puts **~80 stores in the
      Bologna area**, spread over the comune and 11 belt municipalities (all within ~15 km, all on the 051
      dialling prefix)
    - `store-profiles.ts` — `seedStoreProfiles()` fills the public store profile, after `seedStoreImages()` has
      placed the cover at position 0: `categoryId`, `openingHours`, phone numbers, `websiteUrl`, a description
      matched to the business type and extra gallery photos. Three completeness tiers, derived deterministically
      from `(sellerIdx, rankInSeller)` so the split survives a reseed — `full` (~40%: hours, 2 phones, website,
      long description, 5 photos), `basic` (~30%: hours, 1 phone, short description, 3 photos), `bare` (~30%:
      left as `seedSellers` made it, so the "nothing filled in yet" states stay reproducible in dev). Opening
      hours come from 8 archetypes keyed on `businessPrefix` (bottega with the midweek half-day, forno open
      Sunday morning and closed Monday, ristorazione closed Monday, negozio with Monday morning shut, …) with a
      ±30′ shift on the evening close per store, and every generated week is run through the same
      `validateOpeningHours()` the seller route uses: an incoherent archetype fails the seed instead of reaching
      a page. Closed days are **omitted** from the array — `DayScheduleSchema` requires `minItems: 1` on `slots`,
      so `slots: []` is a shape the seller could never save. Categories are set at every tier (without them the
      category filters on `/stores` match nothing); `Ottica` has no `store_categories` counterpart and stays
      `null` on purpose, keeping the no-category state alive. Phone numbers use the city's real dialling prefix
      with the `555` block, websites a `*.example.com` host (RFC 2606 — never resolves, so no seed link can land
      on someone's real site)
    - `team.ts` — `seedTeam()` creates **45 employee users** `employee1..employee45@test.com` (role `"employee"`,
      not `"seller"`), `storeEmployee` rows and store-assignments, plus **8 pending invitations**
      `pending-invite-1..8@test.com` (token `inv-test-<n>`, `expiresAt` 2099-12-31). Distribution:
      - 7 single-store sellers × 2 emp + 7 × 1 emp (idx `[2,5,9,12,16,19,23,26,30,33,37,40,44,47]`)
      - 4 multi-store × 4 emp (idx `[0,14,28,42]`) + 4 × 2 emp (idx `[7,21,35,49]`)
    - `catalog.ts` — the product catalogue, one list per shop type: `catalogByPrefix` has 41 `businessPrefix`
      entries of 20–28 products each (name, macro, sub-category, optional `price` range overriding the macro
      default, optional `skip` = characteristics that don't apply or that the name already states). Also
      `brandPoolByMacro` (invented brands, unique across macros), `HOUSE_MADE_PREFIXES` (Pizzeria, Ristorante,
      Trattoria, Osteria, Gelateria, Pasticceria, Panificio, Sartoria: no brands), `descriptionsFor()` (descriptions by sub-category group) and `ALCOHOLIC_SUBS`
    - `brands.ts` — `seedBrands()` picks 4–8 brands per active seller (rotating over the macros it sells, from
      `brandPoolByMacro`; none for house-made shop types). Rows are scoped per seller — schema has unique
      `(sellerProfileId, lower(name))`. Returns `Map<sellerProfileId, brand[]>` consumed by `seedProducts`
    - `products.ts` — `seedProducts()` creates one product per catalog entry of the seller's shop type
      (~2170 total, deterministic): EAN-13 sequential from `8000000000000`, price from the entry's `price` or the
      macro range, a brand of the **same macro** 90% of the time, status 90/5/5 active/disabled/trashed, VAT from
      `product_macro_categories.suggested_vat_rate` except alcohol (22%). Sets `productCategoryId` (one
      sub-category per product), `storeProduct` inventory (70% of products in all of the seller's stores, 30% in
      one; one product in twenty at stock 0 and one at 2, so the low-stock alerts have data) and `productImage`
      placeholders pointing at picsum.photos
    - `characteristic-values.ts` — `seedCharacteristicValues()` fills `product_characteristic_values`, after
      products. Values only where the seed has a pool that fits the sub-category (sub-categories with only
      generic characteristics may get none); `skippedCharacteristics(macro, sub, name)` leaves out what the entry's
      `skip`, the food rule (no model/colour/…) or a quantity already in the name rules out
    - `dev-seller-catalog.ts` — hand-written catalogue, promotions and orders of `seller@dev.bibs` (`seedDevSeller`
      creates the seller with 2 stores); its orders run in the full seed only
    - `orders.ts` — `seedOrders()` creates 12 `reserve_pickup` orders on the first public store of
      `seller1@test.com` through the real services, for customers `customer1..12` picked by explicit email (the dev
      seller's orders use `customer1..6`), ending in confirmed / ready / completed / cancelled / expired. No
      pay-and-pickup: it needs a real PaymentIntent. Open reservations expire 30 days after seeding
      (`SEED_RESERVATION_DAYS`)
    - `billing-subscriptions.ts` — one subscription per live store (except the store of `seller18@test.com`, left without one on purpose); the mixed states (past_due, canceling,
      suspended, canceled) go to the **newest** stores, so seller1's first store stays public for the orders
    - `discounts.ts` — `seedDiscounts()` fills `discounts` + `discount_products`: 0–3 promotions per active
      seller (two thirds of national sellers have at least one, four fifths of the Bologna block), 3–12 products
      each. `KIND_CYCLE` mixes the states on purpose — ~65% active and running, plus scheduled (`startsAt` in the
      future), expired (`endsAt` in the past), `paused` and `archived`. The customer must only see the running
      ones, so the seed has to contain the ones it must *not* see. Slices of the same seller overlap by
      construction, which is what exercises the `ORDER BY percent DESC` in `getBestActiveDiscount()` ("the
      highest discount wins"). Without this fixture the customer's **In offerta** filter shows 0 and disables
      itself, and the seller's promo column stays empty — two shipped features that were never seen working
    - `utils.ts` — shared fixture data (Italian names, cities, streets, `genEan13`), `pick()`, `daysAgo()` and
      the date/e-mail helpers above. Also the geography and business-type pools:
      `SEED_MUNICIPALITIES` (10 showcase comuni) and `BOLOGNA_BELT` (11 comuni of the first belt, with real
      ISTAT codes, coordinates and CAPs), `BOLOGNA_DISTRICTS` (14 anchors inside Bologna),
      `PHONE_PREFIX_BY_ISTAT`, and `businessPrefixes` (25, national) / `bolognaPrefixes` (16, Bologna block)
      resolved through `prefixForSeller(idx)`.

      **Two pools, not one longer pool.** `prefixForSeller()` and `pickHandle()` index by position, so appending
      to `businessPrefixes` or `SEED_MUNICIPALITIES` changes the modulo and reshuffles the category, opening
      hours and whole catalogue of every seller already seeded. Same reason the strides in the placement helpers
      are coprime with the pool length: `(idx * 7) % 14` only ever yields 0 or 7, so a stride sharing a factor
      with the array silently collapses onto two anchors.

    All test users have password `password123`. For coherent data, run on a freshly reset DB
    (`bun run infra:reset && bun run db:migrate && bun run db:seed`); otherwise canary skips heal partial state
    incrementally but won't reshuffle assignments made under previous DB shape.
- `src/db/schemas/` — Drizzle table definitions and relations:
  - `auth.ts` — user, session, account, verification (better-auth tables)
  - `customer.ts` — customer_profiles (points balance)
  - `seller.ts` — seller_profiles (multi-step onboarding status: `pending_email` → `pending_personal` →
    `pending_document` → `pending_company` → `pending_review` → `active` / `rejected`)
  - `organization.ts` — organizations (business name, VAT number, legal form, address; VAT status:
    pending/verified/rejected)
  - `store.ts` — stores (address + PostGIS point location with GiST index, website URL, phone numbers)
  - `store-category.ts` — store_categories
  - `store-image.ts` — store_images (S3 keys, position ordering)
  - `category.ts` — product_categories
  - `product.ts` — products (with Italian full-text GIN index; nullable `product_category_id` FK to
      product_categories, `ON DELETE RESTRICT`), store_products (stock per store)
  - `address.ts` — customer_addresses (PostGIS point location)
  - `employee.ts` — store_employees (status: active/banned/removed)
  - `order.ts` — orders (type, status, points, reservation expiry, idempotency key), order_items
  - `points.ts` — point_transactions (earned/redeemed)
  - `product-image.ts` — product_images (S3 keys and public URLs)
  - `location.ts` — regions, provinces, municipalities (Italian geographic hierarchy with ISTAT codes)
  - `payment-method.ts` — payment_methods (Stripe Connect account per seller: `stripe_account_id` unique,
    `charges_enabled` (= v2 `stripe_transfers` active)/`payouts_enabled`/`details_submitted`, kept in sync by
    `account.updated` and the settings sync endpoint; still no customer-order payment flow — no PaymentIntent yet)
  - `seller-profile-change.ts` — seller_profile_changes (pending change requests for VAT, document;
    status: pending/approved/rejected; JSONB change data; admin review tracking)
- `seller_profiles` has a `vatChangeBlocked` boolean flag set to `true` when a VAT change request is pending,
  preventing the seller from receiving new orders until the admin approves or rejects.
- Migrations output to `src/db/migrations/` (configured in `drizzle.config.ts`).

### S3 storage — `src/infra/s3.ts`

Bun's native S3Client configured for SeaweedFS (local S3-compatible storage). Used for product image upload/delete via
`/seller/products/:productId/images` endpoints.

- `ensureBucket()` — creates bucket if it doesn't exist (called at startup)
- `s3.write(key, file)` — upload file
- `s3.delete(key)` — delete file
- `publicUrl(key)` — generate public URL for a key
- Max images per product: 10 (configured in `src/lib/config.ts`)

### Path Aliases

`@/*` maps to `./src/*` (configured in `tsconfig.json`). Always use `@/` imports when referencing source files.

## How to Add a New Endpoint

This is the step-by-step process. `src/modules/seller/routes/brands.ts` is a compact reference.

### 1. Define the Zod schemas

Shared entity schemas go in `src/lib/schemas/entities.ts`; route-only inputs at the top of the route file (or in
`src/lib/schemas/<module>.ts` when tests reuse them). Use the constructors of `src/lib/schemas/t.ts` for strings with
lengths, integers, dates, formats and files:

```ts
export const MyEntitySchema = z.object({
    id: z.string(),
    name: z.string().meta({description: "Nome dell'entità"}),
    createdAt: zDate(),
});
```

### 2. Write the service function

Create `src/modules/<module>/services/<resource>.ts`. Keep business logic here, not in routes:

```ts
import {db} from "@/db";
import {myTable} from "@/db/schemas/<table>";
import {ServiceError} from "@/lib/errors";
import {parsePagination} from "@/lib/pagination";

export async function listMyEntities(params: { page?: number; limit?: number }) {
    const {page, limit, offset} = parsePagination(params);
    const [data, [{total}]] = await Promise.all([
        db.query.myTable.findMany({limit, offset}),
        db.select({total: count()}).from(myTable),
    ]);
    return {data, pagination: {page, limit, total}};
}
```

For errors, always throw `ServiceError` with the appropriate HTTP status code:

```ts
if (!found) throw new ServiceError(404, "Elemento non trovato");
if (!allowed) throw new ServiceError(403, "Accesso negato");
```

### 3. Define the routes

Create `src/modules/<module>/routes/<resource>.ts`, with paths relative to the module prefix:

```ts
import {Hono} from "hono";
import {z} from "zod";
import {requireAdmin} from "@/http/auth";
import {doc} from "@/http/openapi";
import {send} from "@/http/send";
import {v} from "@/http/validator";
import {logger} from "@/infra/logger";
import {ok, okPage} from "@/http/responses";
import {MyEntitySchema} from "@/lib/schemas/entities";
import {PaginationQuery} from "@/lib/schemas/pagination";
import {okPageRes, okRes, withErrors} from "@/lib/schemas/responses";
import {zString} from "@/lib/schemas/t";
import {adminDetail} from "../context";
import {createMyEntity, listMyEntities} from "../services/my-entities";

const MyEntityPage = okPageRes(MyEntitySchema);
const MyEntityRes = okRes(MyEntitySchema);
const CreateMyEntityBody = z.object({
    name: zString({minLength: 1, maxLength: 120, description: "Nome dell'entità"}),
});

export const myEntitiesRoutes = new Hono()
    .get(
        "/my-entities",
        doc({
            response: withErrors({200: MyEntityPage}),
            detail: adminDetail("Lista entità", "Restituisce la lista paginata."),
        }),
        v("query", PaginationQuery),
        requireAdmin,
        async (c) => {
            const result = await listMyEntities(c.req.valid("query"));
            return send(c, MyEntityPage, okPage(result.data, result.pagination));
        },
    )
    .post(
        "/my-entities",
        doc({
            response: withErrors({200: MyEntityRes}),
            detail: adminDetail("Crea entità", "Crea una nuova entità."),
        }),
        v("json", CreateMyEntityBody),
        requireAdmin,
        async (c) => {
            const data = await createMyEntity(c.req.valid("json"));
            logger.info({userId: c.var.user.id, entityId: data.id}, "Entità creata");
            return send(c, MyEntityRes, ok(data));
        },
    );
```

Key patterns:

- **Chain the routes** on one `new Hono()`: a route added in a separate statement drops out of the type the `hc`
  clients see.
- **Order**: `doc()` → `v("param")` → `v("query")` → `v("json" | "form")` → guard or `publicRoute` → (`rateLimit()`)
  → handler. Validators before the guard keep the 422 ahead of the 401; `assertRoutes` refuses anything else at
  boot. Never `app.use(requireX)` on a module.
- **One schema for `doc()` and `send()`**: `send(c, Schema, body)` validates the payload, drops fields outside the
  schema (internal columns never leak), writes dates as ISO strings, answers 500 if the payload breaks the schema,
  and types the `hc` response. Never `c.json()` for a success body.
- Use `withErrors()` (or `withConflictErrors()` if 409 is possible) to list the error responses in OpenAPI; `okRes()`
  for a single item, `okPageRes()` for paginated lists, `OkMessage` for delete/action confirmations, with the bodies
  built by `ok()`, `okPage()`, `okMessage()`.
- Always include `detail` with `summary`, `description` and `tags`, plus `security: [{ bearerAuth: [] }]` on
  authenticated routes (`adminDetail()` in `admin/context.ts` does both for the admin module).
- **Static paths before parametric ones**: Hono answers with the first registered route that matches
  (`/products/lookup` before `/products/:productId`).
- **Multipart**: `v("form", Schema)` with `zFile()` / `zFiles()`; an object or array inside a multipart body travels
  as a JSON string.
- Log important actions with `logger` (`src/infra/logger.ts`).

### 4. Register the routes in the module index

In `src/modules/<module>/index.ts`, attach the routes to the module's sub-app and export its type:

```ts
import {moduleApp} from "@/http/app";
import {myEntitiesRoutes} from "./routes/my-entities";

export const myModuleApp = moduleApp().route("/", myEntitiesRoutes);

/** Type for the frontends' `hc` client. */
export type MyModuleApp = typeof myModuleApp;
```

Always `moduleApp()`, never `new Hono()`, for a module's sub-app: it answers errors and 404s with the JSON envelope
and routes on the raw path.

### 5. Register a new module in `src/app.ts`

Add a row to `MODULES` with the prefix and the guards every route must carry (`["admin"]`, `["publicRoute"]` for a
public module, `["customer", "publicRoute"]` for a mixed one, a function of the path when they change by route), and
export the module's type from `src/types.ts` for the frontends. A new OpenAPI tag goes in `src/http/openapi-routes.ts`.

### 6. Test it

- Route tests through `app.request()` or the helpers of `tests/helpers/hono-app.ts`: `testRequest(app, path, init)`,
  `withVars(app, { user, … })` (context already resolved, no DB), `withResolve(app, (request) => vars)`,
  `signIn(email, role)` (a real better-auth user and session on the test DB).
- The module's **strip test**: an unknown field, nested too, in the body or query never reaches the service, and an
  extra field returned by the service never leaves the response (e.g.
  `tests/modules/locations-registration-strip.test.ts`).

### Checklist

- Service function in `services/` with proper error handling (`ServiceError`)
- Route chained in `routes/`, with `doc()`, the `v()` in order, a guard or `publicRoute`, and `send()` with the
  schema listed in `doc()`
- Routes registered in the module `index.ts`; a new module in `MODULES` (`src/app.ts`) and its type in `src/types.ts`
- Strip test for a new module, route tests for the new behaviour
- Run `bun run typecheck` from the root (the frontends' `hc` clients see the change) and check `/openapi`

## Code Conventions

### File naming

Use **kebab-case** for all new files and directories: `my-entities.ts`, `reserve-timer.ts`, `order-items.ts`.

### Imports

Always use the `@/` path alias for source files:

```ts
// correct
import {db} from "@/db";
import {ServiceError} from "@/lib/errors";

// incorrect
import {db} from "../../db";
```

### Error handling

Always throw `ServiceError` in service functions. Never throw raw `Error` or return error objects.
Messages reach the frontends unchanged (toasts), so write them in Italian; operator-only messages
(missing config, invariants) may stay in English:

```ts
// correct
throw new ServiceError(404, "Prodotto non trovato");
throw new ServiceError(400, "Stock insufficiente");
throw new ServiceError(403, "Solo il titolare può eseguire questa operazione");

// incorrect
throw new Error("not found");
return {error: "not found"};
```

The `onError` of the root app and of every `moduleApp()` (`errorResponse`, `src/http/app.ts`) hands the error to
`toErrorResponse` (`src/http/errors.ts`), which converts `ServiceError` to the standard response envelope, maps the
Postgres constraint violations (`23505` → 409, `23503` → 409 or 400, `23514` → 400) and logs.

Validation errors (422) are translated centrally by `src/http/validation-message.ts`, with the rules and labels of
`src/http/validation-message.ts`, from the first Zod issue — the one the API has always reported first
(`src/lib/schemas/issues.ts`): `«Etichetta: regola»` (e.g. «Quantità (riga 2): deve essere un numero intero»). Don't
add an `error` meta to schemas just to translate them; use it only for a message more specific than the generic
rule. A new input field
gets its Italian label in `FIELD_LABELS` (fields not listed fall back to the technical path); a `title` on the schema wins, for names whose meaning changes between routes (e.g. geocode `limit`). The log carries
`on`/`field`/`valueErrorType`, never the submitted values; a response that fails its schema is a 500.

### Response helpers

Always use the response helpers from `src/http/responses.ts`:

- `ok(data)` — single item response
- `okPage(data, pagination)` — paginated list response
- `okMessage(message)` — action confirmation (e.g. delete)

Never construct response objects manually, and return them through `send(c, Schema, body)` (`src/http/send.ts`).

### Database transactions

Use `db.transaction()` for any operation that touches multiple tables:

```ts
return db.transaction(async (tx) => {
    // use tx instead of db inside the transaction
    const [row] = await tx.insert(myTable).values({...}).returning();
    await tx.update(otherTable).set({...}).where(eq(otherTable.id, row.id));
    return row;
});
```

### Monetary values

All money calculations must use integer cents. Use `toCents()` / `fromCents()` from `src/lib/money.ts`. Store prices as
`numeric(10,2)` in the database but calculate in cents:

```ts
const totalCents = toCents(product.price) * quantity;
const total = fromCents(totalCents); // "19.98"
```

### Pagination

All list endpoints must support pagination using `PaginationQuery` (`src/lib/schemas/pagination.ts`) for the query
schema and `parsePagination()` for offset calculation.

### Logging

Log important actions (create, update, delete, auth events) in route handlers:

```ts
logger.info({userId: c.var.user.id, action: 'entity_created'}, 'Description');
```

Use `logger` from `src/infra/logger.ts` everywhere: route handlers, services, cron jobs, startup.

## Infrastructure

`compose.yml` defines local dev services:

- **bibs-postgis** — PostgreSQL 18 + PostGIS 3.6 (custom Dockerfile in `docker/postgis/`)
- **bibs-seaweedfs** — SeaweedFS S3-compatible storage for product images
- **bibs-mailpit** — Mailpit dev email catcher (SMTP 1025, web UI + API 8025)

Environment variables in `.env` (see `.env.example`). Validated at startup by `src/infra/env.ts`.

Required:

- `DATABASE_URL` — PostgreSQL connection string
- `BETTER_AUTH_SECRET` — secret for JWT signing
- `BETTER_AUTH_URL` — base URL for auth (<http://localhost:3000>)
- `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` — S3 storage configuration (SeaweedFS in dev)

Optional:

- `PORT` — server port (default `3000`)
- Seed test data separately with `bun run db:seed`
- `ALLOWED_ORIGINS` — comma-separated list of allowed CORS origins (production only; localhost auto-allowed in dev)
- `NODE_ENV` — `development` (default) or `production` (affects log level)
- `RESEND_API_KEY` — Resend API key for sending emails (production only; in dev emails are delivered to Mailpit, falling back to the log)
- `MAILPIT_URL` — Mailpit base URL for dev email delivery (default `http://localhost:8025`)
- `EMAIL_FROM` — sender address for emails (default `Bibs <noreply@bibs.it>`)
- `SUPPORT_EMAIL` — support address shown to sellers in emails and in the seller app (default `supporto@bibs.it`)
- `CUSTOMER_APP_URL` — customer frontend URL (default `http://localhost:3001`)
- `SELLER_APP_URL` — seller frontend URL (default `http://localhost:3002`)
- `ADMIN_APP_URL` — admin frontend URL, used in the emails to admins (default `http://localhost:3003`)
- `GEOCODING_PROVIDER` — geocoding provider (default `photon`; `google` is not implemented yet)
- `PHOTON_URL` — Photon endpoint (default `https://photon.komoot.io/api`)
- `GEOCODING_USER_AGENT` — User-Agent sent to the geocoding provider (Photon requires identification)

## Testing

Tests use **Bun's built-in test runner**:

- **Unit tests** (`tests/unit/`, `tests/lib/`) — test core lib modules (errors, money, order state machine, pagination)
- **Route-level tests** (`tests/modules/`, `tests/plugins/`) — sub-apps and middleware through `app.request()` or the
  helpers of `tests/helpers/hono-app.ts` (`testRequest`, `withVars`, `withResolve`, `signIn`), including each
  module's strip test
- **HTTP kit tests** (`tests/http/`) — the validator, `send()`, the OpenAPI generator, the formats and the root app
  (CORS, `X-Request-Id`, 404s, log line), compared with the golden files in `tests/http/golden/`: the answers of the
  previous framework, captured before it was removed (Hono migration, U11). They are never regenerated and their
  values never change; an accepted difference goes in the test's expectation, with its number in the plan's delta
  register
- **Integration tests** (`tests/integration/`) — full end-to-end tests using **testcontainers** (spins up a real
  PostgreSQL container). Tests orders, product search, etc.

Test helpers in `tests/helpers/`: `test-db.ts` (testcontainers setup), `fixtures.ts` (test data), `cleanup.ts` (DB
cleanup between tests), `hono-app.ts` (requests to a sub-app). A `tests/preload.ts` file configures the test
environment.

Run tests:

```bash
bun run test        # all tests
bun run test:unit   # unit only
bun run test:integration  # integration only (requires Docker)
bun run test:image && bun test tests/integration/<file>.test.ts  # a single integration file
```

### Why the test image is built once, outside the test files

`test:integration` runs `test:image` (`docker build` of `docker/postgis`, cached) and
`setupTestContainer()` only *starts* that image — it throws if the image is missing
instead of building it. Each file used to build it itself via testcontainers, which under
`--parallel=4` meant concurrent BuildKit builds of the same tag: now and then one hung
forever on `[internal] load remote build context` (testcontainers puts no timeout on a
build), and the file failed on its 120 s `beforeAll` as "a beforeEach/afterEach hook
timed out" with an `(unnamed)` test. Reproduced on Docker Desktop with 6 fresh processes
building at once (2 of 6 stuck in the second round). Don't move the build back into the
helper.

### Why integration tests run with `--isolate`

`test:integration` is `bun test tests/integration --parallel=4 --isolate`. **Keep both flags.**

Bun keeps one module registry per `bun test` process, so a `mock.module(...)` from one
file leaks into files loaded after it: the mocked module *and* every module already
cached holding a binding to it are reused instead of re-evaluated. 53 of the 54
integration files call `mock.module`, and the sharpest case is
`stripe-webhook-reprocessing.test.ts`, which replaces `handleCheckoutCompleted` with a
no-op — if it loads before `stripe-webhook-checkout-completed.test.ts`, that file
silently asserts against a handler that does nothing.

File execution order is decided by the runner environment, so this was green locally and
on some CI images and red on others (#146). The original fix was a shell script running
each file in its own process; bun 1.4's `--isolate` gives every file a fresh global and
module registry in-process, which fixes the same class of leak without paying a process
start per file. It also still runs every file after a failure and exits non-zero, so CI
reports all failing files at once.

`tests/integration/isolation-guard-{1,2}.test.ts` assert the flag is actually in effect.
Their bodies are identical: each bumps a counter on the global object and asserts it sees
1, i.e. that it got a global nobody else has touched. Under `--isolate` both see 1; share
one global and whichever file runs second sees 2 and fails, **in any order** — which is
what makes the check trustworthy, since the order is chosen by the runner. Don't "fix" a
failing guard by editing it: it means `--isolate` is missing from the script.

This matters because a suite can be green and silently un-isolated. A control run without
`--isolate` on the pinned runner passed 411/411 — the leak mechanism was live (the guard
proves the global is shared there) but no existing test happened to sit in an order that
exposed it. The guard turns that invisible property into a ~0.2 ms assertion.

### Why `--parallel=4`, with the count pinned

Files run across 4 worker processes. Measured on CI over 5 runs: **171, 180, 204, 219,
351s** (median 204s) against a serial median of ~336s and ~381s for the old per-process
script — so **~1.6x**, not the 2x a single best-case run suggests. Note the worst
parallel run (351s) is about a typical serial run: the downside case is "no faster",
not "slower".

**The worker count is pinned on purpose.** Bare `--parallel` defaults to the CPU count,
and each worker starts its own PostGIS testcontainer — so the number of concurrent
databases would silently follow whatever machine you are on (4 on the CI runner, 8+ on a
dev laptop, more on a bigger runner). That is a resource profile, not a tuning knob, and
this repo already pins the runner image and bun version for the same reason: a config
that changes under you is one you cannot reason about. 4 matches the CI runner's vCPU
count and is the configuration that was actually measured.

Raising it is not free: every extra worker is another Postgres server plus another
`migrate` run competing for the same cores and disk. If you change it, re-measure —
and note that unlike the file-order flake, contention *does* vary run to run, so
repeated CI runs are genuinely informative here. Runner speed varies enough (see the
351s run) that any comparison needs several samples in the same time window; a single
pair of numbers will mislead you.

`--isolate` is passed explicitly even though `--parallel` implies it. It documents the
invariant the guards protect, and it means `--no-isolate` (which exists, and which
`--parallel` would otherwise happily accept as a speed-up) cannot creep in unnoticed.

### Dev emails (Mailpit)

In development every `sendEmail()` call is delivered to the local Mailpit container — web UI at <http://localhost:8025> (history, HTML rendering, clickable links).

For browser/E2E flows (e.g. Playwright) retrieve emails via Mailpit's REST API — plain fetch, no client library:

- Latest email: `GET http://localhost:8025/api/v1/message/latest`
- By recipient: `GET http://localhost:8025/api/v1/search?query=to:"user@example.com"`
- Clear inbox (test isolation): `DELETE http://localhost:8025/api/v1/messages`

The verification link can be extracted from the `HTML` field of the message response.

## API Documentation

Full OpenAPI spec at `/openapi` (Scalar UI) and `/openapi/json`, generated from the routes (`src/http/openapi.ts`,
assembled by `src/http/openapi-routes.ts`), with:

- Every module's endpoints, fully documented (the spec is the authoritative route inventory)
- Request/response schemas from the routes' Zod schemas (`v()` for the input, `doc({ response })` for the output)
- Error responses (400, 401, 403, 404, 409, 422, 500) for all endpoints
- Better-auth endpoints merged under "Better Auth" tag
- Scalar UI for interactive documentation

## Frontend Integration

The frontends call the API with Hono's RPC client, `hc`, one client per sub-app: `src/types.ts` exports the type of
each (`MeApp`, `CustomerApp`, `SellerApp`, `AdminApp`, `RegistrationApp`, `LocationsApp`, `CatalogApp`) and each app
builds its clients in `src/lib/api.ts` (``hc<WithErrors<SellerApp>>(`${API_URL}/seller`, { init })``). Types flow from
the route chain — `v()` for the input, `send()` for the output — with no code generation, so a change to a route is
seen by every frontend at the next `bun run typecheck`. Client setup, errors, dates and gotchas:
[docs/architecture.md](../../docs/architecture.md#frontend--api-integration-hc).
