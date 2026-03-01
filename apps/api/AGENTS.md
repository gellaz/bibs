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
- `bun run infra:up` — start PostGIS (5432) and MinIO (9000/9001) containers
- `bun run infra:down` — stop and remove containers
- `bun run infra:reset` — stop containers and delete volumes (full reset)
- `bun run db:generate` — generate Drizzle migration files from schema changes
- `bun run db:migrate` — apply migrations to the database
- `bun run db:push` — push schema directly to the database (no migration files)
- `bun run db:studio` — open Drizzle Studio to browse the database
- `bun run db:clean` — delete all migration files (`src/db/migrations/`)

There is no test runner configured yet (`bun test` is not set up).

After making code changes, always run `bun run typecheck` to verify there are no type errors.

## Architecture

### Entrypoint — `src/index.ts`

Creates the Elysia app with plugins and modules:

1. **logixlysia** — structured request logging with Pino (method, path, status, duration, IP). Writes to stdout +
   `logs/app.log` with daily rotation.
2. **cors** — CORS configuration for React/Vue/Angular frontends. Auto-accepts localhost in dev, uses `ALLOWED_ORIGINS`
   in production.
3. **errorHandler** — global error handler that catches `ServiceError`, validation errors, pg unique constraint
   violations (`23505 → 409`), and unhandled exceptions. Logs errors via Pino with appropriate severity.
4. **requestId** — derives a `X-Request-Id` (`crypto.randomUUID()`) and sets it on `set.headers` in the `derive` hook so
   the header is present in both success and error responses.
5. **openapi** — serves the OpenAPI/Swagger spec at `/openapi`, merging better-auth's generated paths and components.
   Full documentation with ~40 endpoints, request/response schemas, and error responses.
6. **betterAuth** — mounts better-auth's handler at `/auth/api` and defines an `auth` macro that resolves the current
   user/session from request headers. Routes opt in to authentication by setting `{ auth: true }` in their config.
7. **registration** — `/register/*` — custom authentication endpoints:
    - `POST /register/customer` — register + create customer profile
    - `POST /register/seller` — register + create seller profile (VAT pending)
    - `POST /register/sign-in` — login, returns user + both profiles (customer & seller if they exist)
8. **adminModule** — `/admin/*` — category CRUD, seller VAT verification. All routes documented with OpenAPI schemas.
9. **sellerModule** — `/seller/*` — stores, products, stock, orders, employees. Accessible by sellers (owner) and their
   employees. 17 endpoints with full schemas.
10. **customerModule** — `/customer/*` — product search (public, with full-text + geo), addresses, orders, loyalty
    points. 11 endpoints with response documentation.
11. **cronJobs** — scheduled tasks via `@elysiajs/cron`. Currently runs reservation expiry every 10 minutes.
12. **GET /health** — database connectivity check (liveness/readiness probe). Returns `200` or `503`.
13. **GET /user** — returns the authenticated user (requires `{ auth: true }`).

**Startup sequence**: ensures S3 bucket exists → restores in-memory reservation timers → optionally seeds test data.

**Graceful shutdown**: on `SIGTERM`/`SIGINT`, stops the server, clears all reservation timers, and closes the database
connection pool.

When `SEED_DB=true`, test users are seeded on startup (see `src/db/seed.ts`).

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
Optional: `PORT` (default `3000`), `SEED_DB` (default `false`), `ALLOWED_ORIGINS`, `NODE_ENV` (default `development`).

### Config & Errors — `src/lib/config.ts`, `src/lib/errors.ts`, `src/lib/responses.ts`

`config.ts` centralises business constants: `pointsPerEuro` (1), `pointsPerEuroDiscount` (100), `reservationHours` (48),
`maxImagesPerProduct` (10), `shippingCost` (€5.00), and pagination defaults (20/100). `errors.ts` exports
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

### Reservation Expiry — `src/lib/jobs/`

Dual mechanism to expire `reserve_pickup` orders after 48 hours:

1. **Per-order timer** (`reservation-timer.ts`) — `scheduleExpiry(orderId, expiresAt)` sets an in-memory `setTimeout`
   that fires at the exact expiry time. Timers are restored on startup via `restoreTimers()`.
2. **Cron safety net** (`expire-reservations.ts`) — `expireReservations()` runs every 10 minutes (via
   `src/plugins/cron.ts`) to catch orders missed by timers (e.g. after restart).

On expiry, the order status is set to `expired`, stock and points are refunded via the shared `refundStockAndPoints()`
helper.

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

Each module is a self-contained Elysia plugin mounted with a prefix. Every module (except `registration/`) follows the
same structure: `context.ts` (guard context + type helpers), `routes/` (route definitions), `services/` (business
logic).

- `registration/` — custom authentication endpoints:
    - `POST /register/customer` — sign-up + create customer profile
    - `POST /register/seller` — sign-up + create seller profile (VAT pending)
    - `POST /register/sign-in` — login returning user + both profiles
    - All responses include both `customerProfile` and `sellerProfile` when present
- `admin/` — 7 endpoints for category management and seller verification. Guarded by `.resolve()` that enforces
  `user.role === "admin"`. All have full OpenAPI schemas with error responses.
- `seller/` — 17 endpoints for stores, products, images, stock, orders, employees. Access resolved from seller (owner)
  or employee role. Ownership checks in `context.ts` (`ensureProductOwnership`, `requireOwner`). Store IDs are
  lazy-loaded via `getStoreIds()` (only queries DB when an endpoint actually needs them, e.g. order listing). All
  documented with TypeBox schemas.
- `customer/` — 11 endpoints for product search (full-text Italian + PostGIS geo-filter), addresses, orders (4 types:
  direct, reserve_pickup, pay_pickup, pay_deliver), loyalty points. Search is public, others require auth.

**Module context pattern**: Each module has a `context.ts` that defines the resolved context interface (e.g.
`SellerResolvedContext`) and a `withSeller(ctx)` / `withCustomer(ctx)` / `withAdmin(ctx)` helper for type-safe context
access in route handlers. In the seller module, `getStoreIds` is a lazy cached getter (returns `Promise<string[]>`) —
call `await getStoreIds()` only when you need the seller's store IDs.

Complex business logic (order creation/pickup/cancel, product creation with categories, employee creation, product
search) is extracted into `services/` sub-folders under each module. Services use `db.transaction()` for multi-step
operations and atomic SQL expressions (`SET stock = stock - $n WHERE stock >= $n`) to prevent race conditions.

All list endpoints accept `page` and `limit` query parameters for pagination (defaults in `src/lib/config.ts`). Use
`PaginationQuery` from `src/lib/pagination.ts` for the query schema and `parsePagination()` for offset calculation.

### Database — `src/db/`

- `src/db/index.ts` — exports a singleton Drizzle client using `DATABASE_URL`.
- `src/db/seed.ts` — seeds test users/profiles/store when `SEED_DB=true`.
- `src/db/schemas/` — Drizzle table definitions and relations:
    - `auth.ts` — user, session, account, verification (better-auth tables)
    - `customer.ts` — customer_profiles (points balance)
    - `seller.ts` — seller_profiles (VAT number, verification status: pending/verified/rejected)
    - `store.ts` — stores (address + PostGIS point location with GiST index)
    - `category.ts` — product_categories
    - `product.ts` — products (with Italian full-text GIN index), product_classifications (many-to-many with
      categories), store_products (stock per store)
    - `address.ts` — customer_addresses (PostGIS point location)
    - `employee.ts` — store_employees (status: active/banned/removed)
    - `order.ts` — orders (type, status, points, reservation expiry), order_items
    - `points.ts` — point_transactions (earned/redeemed)
    - `product-image.ts` — product_images (S3/MinIO keys and public URLs)
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
import {withAdmin} from "../context";
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
    );
```

Key patterns:

- Use `withErrors()` (or `withConflictErrors()` if 409 is possible) to wrap the response schema
- Use `okRes()` for single item, `okPageRes()` for paginated lists, `OkMessage` for delete/action confirmations
- Use `PaginationQuery` for list endpoints
- Access the logger via `getLogger(store)` and log important actions
- Use `withAdmin(ctx)` / `withSeller(ctx)` / `withCustomer(ctx)` for type-safe context access
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
- `SEED_DB` — if `"true"`, seeds test users on startup
- `ALLOWED_ORIGINS` — comma-separated list of allowed CORS origins (production only; localhost auto-allowed in dev)
- `NODE_ENV` — `development` (default) or `production` (affects log level)

## API Documentation

Full OpenAPI 3.0 spec available at `/openapi` with:

- ~40 documented endpoints across 5 modules
- Request/response schemas with TypeBox (runtime validation + types)
- Error responses (400, 401, 403, 404, 422, 500) for all endpoints
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
