# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

bibs-elysia is a backend API for a local-commerce marketplace built with **Elysia** (web framework) running on the **Bun
** runtime. It uses **Drizzle ORM** with **PostgreSQL + PostGIS** for data persistence and **better-auth** for
authentication (email/password, RBAC via admin plugin). An OpenAPI spec is auto-generated and served via
`@elysiajs/openapi`.

## Commands

- `bun install` — install dependencies
- `bun run dev` — start dev server with watch mode (port 3000)
- `bun run build` — bundle the project into `dist/` (target Bun)
- `bun run typecheck` — run TypeScript type checking (`tsc --noEmit`)
- `bun test` — run all tests (unit + integration)
- `bun run test:unit` — run unit tests only (`tests/unit/`)
- `bun run test:integration` — run integration tests only (`tests/integration/`, 180s timeout)
- `bun run infra:up` — start PostGIS (5432) and MinIO (9000/9001) containers
- `bun run infra:down` — stop and remove containers
- `bun run infra:reset` — stop containers and delete volumes (full reset)
- `bun run db:generate` — generate Drizzle migration files from schema changes
- `bun run db:migrate` — apply migrations to the database
- `bun run db:push` — push schema directly to the database (no migration files)
- `bun run db:studio` — open Drizzle Studio to browse the database
- `bun run db:clean` — delete all migration files (`src/db/migrations/`)

After making code changes, always run `bun run typecheck` to verify there are no type errors.

## Architecture

### Entrypoint — `src/index.ts`

Creates the Elysia app with plugins and modules:

1. **logixlysia** — structured request logging with Pino (method, path, status, duration, IP). Writes to stdout +
   `logs/app.log` with daily rotation.
2. **cors** — CORS configuration for React frontends. Auto-accepts localhost in dev, uses `ALLOWED_ORIGINS`
   in production.
3. **errorHandler** — global error handler that catches `ServiceError`, validation errors, pg unique constraint
   violations (`23505 → 409`), and unhandled exceptions. Logs errors via Pino with appropriate severity.
4. **requestId** — derives a `X-Request-Id` (`crypto.randomUUID()`) and sets it on `set.headers` in the `derive` hook so
   the header is present in both success and error responses.
5. **openapi** — serves the OpenAPI/Swagger spec at `/openapi`, merging better-auth's generated paths and components.
   Full documentation with ~60 endpoints, request/response schemas, and error responses.
6. **betterAuth** — mounts better-auth's handler at `/auth/api` and defines an `auth` macro that resolves the current
   user/session from request headers. Routes opt in to authentication by setting `{ auth: true }` in their config.
7. **registration** — `/register/*` — custom authentication endpoints:
    - `POST /register/customer` — register + create customer profile
    - `POST /register/seller` — register + create seller profile (starts onboarding)
    - `POST /register/sign-in` — login, returns user + both profiles (customer & seller if they exist)
8. **adminModule** — `/admin/*` — category CRUD, seller verification. All routes documented with OpenAPI schemas.
9. **categoriesModule** — `GET /categories` — public paginated category listing (read-only, no auth required).
10. **locationsModule** — `/locations/*` — Italian geographic data (regions, provinces, municipalities). Public, no auth.
11. **sellerModule** — `/seller/*` — onboarding, profile, stores, products, images, stock, orders, employees. Accessible
    by sellers (owner) and their employees. 33 endpoints with full schemas.
12. **customerModule** — `/customer/*` — product search (public, with full-text relevance ranking + geo-filter),
    profile, addresses, orders, loyalty points. 12 endpoints with response documentation.
13. **cronJobs** — scheduled tasks via `@elysiajs/cron`. Runs reservation expiry every minute (single source of truth).
14. **health** plugin — `GET /health` (liveness probe, always 200) + `GET /ready` (readiness probe, checks DB + S3
    connectivity, returns 503 if unhealthy).

**Startup sequence**: ensures the S3 bucket exists, then `app.listen(env.PORT)`. The cron plugin starts itself.

**Graceful shutdown**: on `SIGTERM`/`SIGINT`, stops the server and closes the database connection pool.

Test data can be seeded separately via `bun run db:seed` (see `src/db/seed/`).

### Schemas — `src/lib/schemas/`

TypeBox schemas split into submodules (all re-exported from `src/lib/schemas/index.ts`, import as `@/lib/schemas`):

- **`entities.ts`** — entity schemas (`UserSchema`, `CategorySchema`, `ProductSchema`, `OrderSchema`, etc.) with full
  type definitions, plus shared field groups (`LocationField`, `AddressFieldsRequired`, `AddressFieldsOptional`)
- **`composed.ts`** — schemas with nested relations (`ProductWithRelationsSchema`, `SellerOrderWithRelationsSchema`,
  `CustomerOrderWithRelationsSchema`, etc.)
- **`responses.ts`** — response envelope helpers (`okRes()`, `okPageRes()`, `OkMessage`, `ErrorResponse`), error schemas
  per status code, `withErrors()` / `withConflictErrors()` helpers
- All schemas include Italian descriptions and TypeScript-like type constraints

### Environment — `src/lib/env.ts`

Validates all environment variables at startup using TypeBox. If any required variable is missing, the server exits
immediately with a clear error listing the missing variables. Always import `env` from this module instead of using
`process.env` directly.

Required: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
`S3_BUCKET`.
Optional: `PORT` (default `3000`), `ALLOWED_ORIGINS`, `NODE_ENV` (default `development`).

### Email — `src/lib/email.ts`

Email sending via **Resend** in production, logging-only in development:

- In dev: logs the email content to Pino (no external service needed)
- In production: sends via Resend API using `RESEND_API_KEY`
- Used for email verification during seller onboarding

### Config & Errors — `src/lib/config.ts`, `src/lib/errors.ts`, `src/lib/responses.ts`

`config.ts` centralises business constants: `pointsPerEuro` (1), `pointsPerEuroDiscount` (100), `reservationHours` (48),
`maxImagesPerProduct` (10), `maxProductsPerImport` (500), `shippingCost` (€5.00), and pagination defaults (20/100). `errors.ts` exports
`ServiceError`, a typed error class with `ErrorStatus` (a strict union of valid HTTP status codes: 400, 401, 403, 404,
409, 422, 500, 503) and derived `ErrorCode` strings. `responses.ts` provides runtime response helpers (`ok()`,
`okPage()`, `okMessage()`, `errorBody()`) that match the schemas.

### Logging — `src/lib/logger.ts`

Structured logging via **logixlysia** (Elysia plugin) + **Pino**:

- **Request logging** — automatic HTTP request/response logging (method, path, status, duration, IP)
- **File output** — writes to `logs/app.log` with daily rotation, 100 MB max, 30-day retention, gzip compression
- **Standalone logger** — `logger` export for non-request contexts (cron jobs, startup, timers); writes to both stdout
  and log file
- **Redaction** — automatically redacts `password`, `token`, `apiKey`, `secret`, `authorization` fields
- **Log level** — `debug` in development, `info` in production (based on `NODE_ENV`)

In request handlers, access the Pino logger via `getLogger(store)` from the Elysia context store.

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

### Reservation Expiry — `src/lib/jobs/expire-reservations.ts`

`reserve_pickup` orders expire after 48 hours. The cron job in `src/plugins/cron.ts` runs `expireReservations()` every
minute (`Patterns.EVERY_MINUTE`) and is the single source of truth — no in-memory timers, no per-order scheduling.
Worst-case latency from the configured expiry to the status flip is ~60 s, negligible against a 48 h reservation
window.

On expiry, the order status is set to `expired`, stock and points are refunded via the shared `refundStockAndPoints()`
helper. `expireSingleReservation(orderId)` is also exported for one-off use; both paths transactionally re-check the
status, so concurrent runs are idempotent.

### Pagination — `src/lib/pagination.ts`

Reusable pagination utilities:

- `PaginationQuery` — TypeBox schema for `page` and `limit` query params (use in route definitions)
- `parsePagination(query)` — returns `{ page, limit, offset }` from parsed query params

### Auth & Permissions — `src/lib/auth.ts`, `src/lib/permissions.ts`

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

**Four roles**: **admin**, **seller**, **employee**, **customer**. Permissions defined in `src/lib/permissions.ts` using
better-auth's access-control system.

The `OpenAPI` export provides lazy-cached helpers (`getPaths`, `components`) that re-prefix better-auth's OpenAPI paths
under `/auth/api` and tag them as "Better Auth". These are merged into the main OpenAPI spec.

### Modules — `src/modules/`

Each module is a self-contained Elysia plugin mounted with a prefix. Every module (except `registration/` and
`categories.ts`) follows the same structure: `context.ts` (guard context + type helpers), `routes/` (route definitions),
`services/` (business logic).

- `registration/` — custom authentication endpoints:
  - `POST /register/customer` — sign-up + create customer profile
  - `POST /register/seller` — sign-up + create seller profile (starts onboarding at `pending_email`)
  - `POST /register/sign-in` — login returning user + both profiles
  - All responses include both `customerProfile` and `sellerProfile` when present
- `categories.ts` — single-file module, `GET /categories` — public paginated category listing (no auth). Uses the same
  service as admin category routes.
- `locations/` — 3 public endpoints for Italian geographic data. No auth required:
  - `GET /locations/regions` — all Italian regions
  - `GET /locations/provinces` — provinces (optional `regionId` filter)
  - `GET /locations/municipalities` — paginated municipalities (optional `provinceId` filter)
- `admin/` — 9 endpoints for category CRUD, seller verification, and change request review. Guarded by `.resolve()`
  that enforces `user.role === "admin"`. All have full OpenAPI schemas with error responses.
  - Change request review: `GET /admin/sellers/changes/pending` (paginated list),
    `PATCH /admin/sellers/changes/:changeId/approve`, `PATCH /admin/sellers/changes/:changeId/reject` (with optional
    reason).
- `seller/` — 39 endpoints across 9 route groups. Two guard levels:
  - **Auth-only guard** (`withSellerAuth`): profile (2 endpoints) + onboarding (6 endpoints) — accessible to any
    authenticated seller regardless of onboarding status.
  - **Full guard** (`withSeller`): stores (4), products (6, including CSV bulk import), images (2), stock (3),
    orders (5, with status/type filters and idempotency keys), employees (5), settings (6) — requires
    `onboardingStatus === "active"`.
  - **Settings** (`/seller/settings/*`): post-onboarding profile modification. Two levels:
    - *Level 1 — Free edit*: `PATCH /settings/personal` (personal info), `PATCH /settings/company` (company data
      excluding VAT). Applied immediately.
    - *Level 2 — Admin review*: `PATCH /settings/vat` (VAT change — blocks new orders during review),
      `PATCH /settings/document` (ID document update), `PATCH /settings/payment` (Stripe account change). Creates a
      `seller_profile_changes` record; current data stays active until admin approves.
    - `GET /settings` returns profile + organization + payment method + pending change requests.
  - Access resolved from seller (owner) or employee role. Ownership checks in `context.ts`
    (`ensureProductOwnership`, `requireOwner`). Store IDs are lazy-loaded via `getStoreIds()`.
- `customer/` — 12 endpoints: product search (full-text Italian with relevance ranking + PostGIS geo-filter), profile,
  addresses, orders (4 types: direct, reserve_pickup, pay_pickup, pay_deliver), loyalty points. Search is public,
  others require auth.

**Module context pattern**: Each module has a `context.ts` that defines the resolved context interface (e.g.
`SellerResolvedContext`) and a `withX(ctx)` helper for type-safe context access in route handlers.

#### Context Management Best Practices

1. **Define context interfaces** in `context.ts`:

   ```ts
   export interface MyModuleResolvedContext {
     user: { id: string; name: string; email: string; role: string | null; };
     // ... other resolved properties
   }
   ```

2. **Create type-safe helpers** for route handlers:

   ```ts
   export function withMyModule<T>(ctx: T) {
     return ctx as T & MyModuleResolvedContext;
   }
   ```

3. **Use helpers in route files** instead of type assertions:

   ```ts
   // Good
   import { withMyModule } from "../context";
   async (ctx) => {
     const { user, myProperty } = withMyModule(ctx);
   }
   
   // Bad - don't define context types inline
   async (ctx) => {
     const { user } = ctx as { user: { ... } };
   }
   ```

4. **Multiple guard levels**: Some modules may have multiple guards with different requirements:
   - Example: `seller/` module has `withSeller()` (requires verified VAT) and `withSellerAuth()` (only requires
     authentication)
   - Define separate interfaces and helpers for each guard level in the same `context.ts` file

5. **Lazy evaluation**: For expensive operations (like querying store IDs), use lazy cached getters:

   ```ts
   let cached: Promise<string[]> | null = null;
   const getStoreIds = () => (cached ??= fetchStoreIds());
   ```

Complex business logic (order creation/pickup/cancel, product creation with categories, employee creation, product
search) is extracted into `services/` sub-folders under each module. Services use `db.transaction()` for multi-step
operations and atomic SQL expressions (`SET stock = stock - $n WHERE stock >= $n`) to prevent race conditions.

All list endpoints accept `page` and `limit` query parameters for pagination (defaults in `src/lib/config.ts`). Use
`PaginationQuery` from `src/lib/pagination.ts` for the query schema and `parsePagination()` for offset calculation.

### Database — `src/db/`

- `src/db/index.ts` — exports a singleton Drizzle client backed by an explicit `pg.Pool`. Pool sizing is env-driven
  (`DATABASE_POOL_MAX`, `DATABASE_IDLE_TIMEOUT_MS`, `DATABASE_CONNECTION_TIMEOUT_MS`; defaults 20/30s/5s).
- `src/db/seed/` — split between idempotent reference data and dev/staging fixtures (run via `bun run db:seed`):
  - `index.ts` — top-level `seed()` composes `seedBase()` then `seedFixtures()`
  - `base/` — idempotent reference data, no auth dependency, safe in any environment:
    - `index.ts` — `seedBase()` runs locations + categories in order
    - `locations.ts` — `seedLocations()` for regions, provinces, municipalities (skip-if-present)
    - `categories.ts` — `seedStoreCategories()`, `seedProductCategories()` (skip-if-present)
    - `fetch-locations.ts` — standalone script to refresh the location JSON from GitHub
    - `regions.json`, `provinces.json`, `municipalities.json` — generated and committed
  - `fixtures/` — test users for dev/staging only, depend on `better-auth`'s `signUpEmail`:
    - `index.ts` — `seedFixtures()` runs admins + customers + sellers in order
    - `admins.ts` — `seedAdmins()` (3 admin users)
    - `customers.ts` — `seedCustomers()` (~300 customers)
    - `sellers.ts` — `seedSellers()` (~150 sellers across the onboarding state machine)
    - `utils.ts` — shared fixture data (Italian names, cities, streets) and `pick()` helper
- `src/db/schemas/` — Drizzle table definitions and relations:
  - `auth.ts` — user, session, account, verification (better-auth tables)
  - `customer.ts` — customer_profiles (points balance)
  - `seller.ts` — seller_profiles (multi-step onboarding status: `pending_email` → `pending_personal` →
    `pending_document` → `pending_company` → `pending_store` → `pending_payment` → `pending_review` → `active` /
    `rejected`)
  - `organization.ts` — organizations (business name, VAT number, legal form, address; VAT status:
    pending/verified/rejected)
  - `store.ts` — stores (address + PostGIS point location with GiST index, website URL, phone numbers)
  - `store-category.ts` — store_categories
  - `store-image.ts` — store_images (S3/MinIO keys, position ordering)
  - `category.ts` — product_categories
  - `product.ts` — products (with Italian full-text GIN index), product_classifications (many-to-many with
      categories), store_products (stock per store)
  - `address.ts` — customer_addresses (PostGIS point location)
  - `employee.ts` — store_employees (status: active/banned/removed)
  - `order.ts` — orders (type, status, points, reservation expiry, idempotency key), order_items
  - `points.ts` — point_transactions (earned/redeemed)
  - `product-image.ts` — product_images (S3/MinIO keys and public URLs)
  - `location.ts` — regions, provinces, municipalities (Italian geographic hierarchy with ISTAT codes)
  - `payment-method.ts` — payment_methods (Stripe Connect accounts per seller)
  - `seller-profile-change.ts` — seller_profile_changes (pending change requests for VAT, document, payment;
    status: pending/approved/rejected; JSONB change data; admin review tracking)
- `seller_profiles` has a `vatChangeBlocked` boolean flag set to `true` when a VAT change request is pending,
  preventing the seller from receiving new orders until the admin approves or rejects.
- Migrations output to `src/db/migrations/` (configured in `drizzle.config.ts`).

### S3/MinIO — `src/lib/s3.ts`

Bun's native S3Client configured for MinIO (local S3-compatible storage). Used for product image upload/delete via
`/seller/products/:productId/images` endpoints.

- `ensureBucket()` — creates bucket if it doesn't exist (called at startup)
- `s3.write(key, file)` — upload file
- `s3.delete(key)` — delete file
- `publicUrl(key)` — generate public URL for a key
- Max images per product: 10 (configured in `src/lib/config.ts`)

### Path Aliases

`@/*` maps to `./src/*` (configured in `tsconfig.json`). Always use `@/` imports when referencing source files.

## How to Add a New Endpoint

This is the step-by-step process. Use the admin categories module (`src/modules/admin/`) as reference.

### 1. Define TypeBox schema (if new entity)

Add the entity schema to `src/lib/schemas/entities.ts`:

```ts
export const MyEntitySchema = t.Object({
    id: t.String(),
    name: t.String({description: "Nome dell'entità"}),
    createdAt: t.Date(),
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
if (!found) throw new ServiceError(404, "Entity not found");
if (!allowed) throw new ServiceError(403, "Forbidden");
```

### 3. Define the route

Create `src/modules/<module>/routes/<resource>.ts`:

```ts
import {Elysia, t} from "elysia";
import {ok, okPage, okMessage} from "@/lib/responses";
import {getLogger} from "@/lib/logger";
import {PaginationQuery} from "@/lib/pagination";
import {okRes, okPageRes, OkMessage, withErrors, MyEntitySchema} from "@/lib/schemas";
import {withAdmin} from "../context";  // Import context helper
import {listMyEntities, createMyEntity} from "../services/my-entities";

export const myEntitiesRoutes = new Elysia()
    .get(
        "/my-entities",
        async ({query}) => {
            const result = await listMyEntities(query);
            return okPage(result.data, result.pagination);
        },
        {
            query: PaginationQuery,
            response: withErrors({200: okPageRes(MyEntitySchema)}),
            detail: {
                summary: "Lista entità",
                description: "Restituisce la lista paginata.",
                tags: ["Admin"],
            },
        },
    )
    .post(
        "/my-entities",
        async (ctx) => {
            // Use context helper for type-safe access to resolved context
            const {user, body, store} = withAdmin(ctx);
            const pino = getLogger(store);
            
            const data = await createMyEntity(body);
            
            pino.info({userId: user.id, entityId: data.id}, "Entity created");
            return ok(data);
        },
        {
            body: t.Object({name: t.String()}),
            response: withErrors({200: okRes(MyEntitySchema)}),
            detail: {
                summary: "Crea entità",
                description: "Crea una nuova entità.",
                tags: ["Admin"],
            },
        },
    );
```

Key patterns:

- **Always use context helpers**: Import `withAdmin(ctx)` / `withSeller(ctx)` / `withSellerAuth(ctx)` / `withCustomer(ctx)`
  from `../context` for type-safe access to resolved context. Never define context types inline in route files.
- Use `withErrors()` (or `withConflictErrors()` if 409 is possible) to wrap the response schema
- Use `okRes()` for single item, `okPageRes()` for paginated lists, `OkMessage` for delete/action confirmations
- Use `PaginationQuery` for list endpoints
- Access the logger via `getLogger(store)` and log important actions
- Always include `detail` with `summary`, `description`, and `tags` for OpenAPI docs

### 4. Register the route in the module index

In `src/modules/<module>/index.ts`, import and `.use()` the routes:

```ts
import {myEntitiesRoutes} from "./routes/my-entities";

export const myModule = new Elysia({prefix: "/my-module"})
    .use(betterAuth)
    .guard({auth: true}, (app) =>
        app
            .resolve(async ({user}) => { /* role check */
            })
            .use(myEntitiesRoutes)
    );
```

### 5. Register the module in the app entrypoint

In `src/index.ts`, import and `.use()` the module. If it introduces a new OpenAPI tag, add it to the `openapi()` config.

### Checklist

- Service function in `services/` with proper error handling (`ServiceError`)
- Route file in `routes/` with TypeBox schemas, `withErrors()`, and `detail` for OpenAPI
- Context helper imported and used (e.g. `withAdmin(ctx)`, `withSeller(ctx)`) instead of inline type assertions
- Route registered in module `index.ts`
- Module registered in `src/index.ts` (if new module)
- Run `bun run typecheck` to verify

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

Always throw `ServiceError` in service functions. Never throw raw `Error` or return error objects:

```ts
// correct
throw new ServiceError(404, "Product not found");
throw new ServiceError(400, "Insufficient stock");
throw new ServiceError(403, "Only store owners can perform this action");

// incorrect
throw new Error("not found");
return {error: "not found"};
```

The global error handler (`src/plugins/error-handler.ts`) catches `ServiceError` and converts it to the standard
response envelope.

### Response helpers

Always use the response helpers from `src/lib/responses.ts`:

- `ok(data)` — single item response
- `okPage(data, pagination)` — paginated list response
- `okMessage(message)` — action confirmation (e.g. delete)

Never construct response objects manually.

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

All list endpoints must support pagination using `PaginationQuery` for the query schema and `parsePagination()` for
offset calculation.

### Logging

Log important actions (create, update, delete, auth events) in route handlers:

```ts
const pino = getLogger(store);
pino.info({userId: user.id, action: 'entity_created'}, 'Description');
```

Use `logger` from `src/lib/logger.ts` for non-request contexts (cron jobs, startup).

## Infrastructure

`compose.yml` defines local dev services:

- **bibs-postgis** — PostgreSQL 18 + PostGIS 3.6 (custom Dockerfile in `docker/postgis/`)
- **bibs-minio** — MinIO object storage for product images

Environment variables in `.env` (see `.env.example`). Validated at startup by `src/lib/env.ts`.

Required:

- `DATABASE_URL` — PostgreSQL connection string
- `BETTER_AUTH_SECRET` — secret for JWT signing
- `BETTER_AUTH_URL` — base URL for auth (<http://localhost:3000>)
- `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` — MinIO configuration

Optional:

- `PORT` — server port (default `3000`)
- Seed test data separately with `bun run db:seed`
- `ALLOWED_ORIGINS` — comma-separated list of allowed CORS origins (production only; localhost auto-allowed in dev)
- `NODE_ENV` — `development` (default) or `production` (affects log level)
- `RESEND_API_KEY` — Resend API key for sending emails (production only; in dev emails are logged)
- `EMAIL_FROM` — sender address for emails (default `Bibs <noreply@bibs.it>`)
- `CUSTOMER_APP_URL` — customer frontend URL (default `http://localhost:3001`)
- `SELLER_APP_URL` — seller frontend URL (default `http://localhost:3002`)

## Testing

Tests use **Bun's built-in test runner** with two levels:

- **Unit tests** (`tests/unit/`) — test core lib modules (errors, money, order state machine, pagination)
- **Route-level tests** (`tests/modules/`, `tests/plugins/`) — test registration, error handler via Elysia's test
  client
- **Integration tests** (`tests/integration/`) — full end-to-end tests using **testcontainers** (spins up a real
  PostgreSQL container). Tests orders, product search, etc.

Test helpers in `tests/helpers/`: `test-db.ts` (testcontainers setup), `fixtures.ts` (test data), `cleanup.ts` (DB
cleanup between tests). A `tests/preload.ts` file configures the test environment.

Run tests:

```bash
bun test            # all tests
bun run test:unit   # unit only
bun run test:integration  # integration only (requires Docker)
```

## API Documentation

Full OpenAPI 3.0 spec available at `/openapi` with:

- ~60 documented endpoints across 7 modules
- Request/response schemas with TypeBox (runtime validation + types + restrictive input validation)
- Error responses (400, 401, 403, 404, 409, 422, 500) for all endpoints
- Better-auth endpoints merged under "Better Auth" tag
- Scalar UI for interactive documentation

## Frontend Integration

See `REACT_INTEGRATION.md` for complete React integration guide using **Eden Treaty** for end-to-end type safety.

**Eden Treaty** is Elysia's RPC-like client that provides:

- Full TypeScript inference from backend to frontend (no code generation)
- Auto-completion for all API endpoints with parameters and response types
- Type narrowing for errors: `if (error) { error.value.message }`
- Weight < 2KB gzipped

The backend exports `export type App = typeof app` for Eden to consume. Changes to backend types are instantly reflected
in the frontend with zero configuration.
