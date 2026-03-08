# bibs-elysia

Backend API for **bibs** — a local-commerce marketplace that connects customers with nearby stores. Sellers manage
products, stores and employees; customers search products by location, place orders (in-store, pickup or delivery) and
earn loyalty points.

## Tech Stack

- **Runtime** — [Bun](https://bun.sh)
- **Web framework** — [Elysia](https://elysiajs.com)
- **Database** — PostgreSQL 18 + PostGIS 3.6 (via Docker)
- **ORM** — [Drizzle ORM](https://orm.drizzle.team) (node-postgres driver)
- **Auth** — [better-auth](https://www.better-auth.com) (email/password, RBAC with admin plugin)
- **Object storage** — MinIO (S3-compatible, via Bun's native S3 API)
- **API docs** — OpenAPI spec auto-generated via `@elysiajs/openapi`

## Prerequisites

- [Bun](https://bun.sh) >= 1.x
- [Docker](https://docs.docker.com/get-docker/) & Docker Compose

## Getting Started

1. **Clone & install**

   ```bash
   git clone <repo-url> && cd bibs-elysia
   bun install
   ```

2. **Start infrastructure**

   ```bash
   bun run infra:up
   ```

   This starts:
    - **bibs-postgis** — PostgreSQL + PostGIS on port `5432`
    - **bibs-minio** — MinIO on ports `9000` (API) / `9001` (console) — used for product image storage

3. **Configure environment**

   A `.env` file is expected at the project root:

   Copy `.env.example` to `.env` and adjust values as needed:

   ```env
   DATABASE_URL=postgresql://pgadmin:P4ssword!@localhost:5432/bibs-db
   BETTER_AUTH_SECRET=<random-secret>
   BETTER_AUTH_URL=http://localhost:3000
   PORT=3000              # optional — defaults to 3000
   S3_ENDPOINT=http://localhost:9000
   S3_ACCESS_KEY=minioadmin
   S3_SECRET_KEY=P4ssword!
   S3_BUCKET=bibs-images
   # ALLOWED_ORIGINS=https://yourdomain.com  # production only
   ```

   Environment variables are validated at startup via TypeBox (`src/lib/env.ts`). The server
   exits immediately with a clear error if any required variable is missing.

4. **Apply database migrations**

   ```bash
   bun run db:migrate
   ```

5. **Start the dev server**

   ```bash
   bun run dev
   ```

   The API is available at `http://localhost:3000`.

   **OpenAPI documentation**:
    - Scalar UI (default): `http://localhost:3000/openapi`
    - JSON spec: `http://localhost:3000/openapi/json`

## Scripts

| Command               | Description                                          |
|-----------------------|------------------------------------------------------|
| `bun run dev`         | Start dev server with watch mode (port 3000)         |
| `bun run build`       | Bundle the project into `dist/` (target Bun)         |
| `bun run typecheck`   | Run TypeScript type checking (`tsc --noEmit`)        |
| `bun run infra:up`    | Start Docker containers (PostGIS + MinIO)            |
| `bun run infra:down`  | Stop Docker containers                               |
| `bun run infra:reset` | Stop containers and delete volumes (full reset)      |
| `bun run db:generate` | Generate Drizzle migration files from schema changes |
| `bun run db:migrate`  | Apply pending migrations                             |
| `bun run db:push`     | Push schema directly to DB (skip migration files)    |
| `bun run db:studio`   | Open Drizzle Studio to browse the database           |
| `bun run db:seed`     | Seed the database with test data                     |
| `bun run db:clean`    | Delete all migration files (`src/db/migrations/`)    |

## Project Structure

```text
src/
├── index.ts                  # Entrypoint — mounts plugins & modules
├── plugins/
│   ├── better-auth.ts        # Elysia plugin: auth handler + `auth` macro
│   ├── error-handler.ts      # Global error handler (ServiceError, validation, pg unique)
│   ├── request-id.ts         # X-Request-Id header (set in derive, covers errors too)
│   └── cron.ts               # Cron jobs (reservation expiry every 10 min)
├── lib/
│   ├── auth.ts               # better-auth config (Drizzle adapter, admin plugin, RBAC)
│   ├── env.ts                # TypeBox-validated environment variables
│   ├── config.ts             # Business constants (points, reservation hours, pagination)
│   ├── errors.ts             # ServiceError class with typed HTTP status codes
│   ├── responses.ts          # Response helpers: ok(), okPage(), okMessage(), errorBody()
│   ├── schemas/              # TypeBox schemas (split into submodules)
│   │   ├── index.ts          # Barrel re-export
│   │   ├── entities.ts       # Entity schemas (User, Product, Order, etc.) + field groups
│   │   ├── composed.ts       # Composed schemas with nested relations
│   │   └── responses.ts      # Response envelopes, error schemas, withErrors()
│   ├── permissions.ts        # Access-control roles: admin, customer, seller, employee
│   ├── s3.ts                 # Bun S3Client for MinIO (upload, delete, publicUrl)
│   ├── logger.ts             # Pino logger config (logixlysia + standalone logger)
│   ├── money.ts              # Cents ↔ decimal conversion (toCents / fromCents)
│   ├── order-state-machine.ts # Order status transition rules per order type
│   ├── order-helpers.ts      # Shared helpers: refundStockAndPoints()
│   ├── pagination.ts         # Reusable pagination query schema & parser
│   └── jobs/
│       ├── reservation-timer.ts    # In-memory setTimeout timers for reservation expiry
│       └── expire-reservations.ts  # Single + bulk reservation expiry with stock refund
├── modules/
│   ├── registration/         # POST /register/customer, /seller, /sign-in
│   ├── admin/                # /admin/* — category CRUD, seller verification
│   │   ├── context.ts        # Admin guard context & type helpers
│   │   ├── routes/            # Route definitions
│   │   └── services/          # Business logic
│   ├── seller/               # /seller/* — stores, products, stock, orders, employees
│   │   ├── context.ts        # Seller guard context, ownership checks, lazy storeIds
│   │   ├── routes/            # Route definitions
│   │   └── services/          # Business logic
│   └── customer/             # /customer/* — search, addresses, orders, points
│       ├── context.ts        # Customer guard context & type helpers
│       ├── routes/            # Route definitions
│       └── services/          # Business logic
└── db/
    ├── index.ts              # Singleton Drizzle client
    ├── seed/                 # Modular test data seeder (bun run db:seed)
    │   ├── index.ts          # Orchestrator — calls seeders in order
    │   ├── admins.ts         # Admin test users
    │   ├── customers.ts      # Bulk customer generation (~300)
    │   ├── sellers.ts        # Bulk seller generation (~150)
    │   ├── categories.ts     # Store & product category seeding
    │   ├── locations.ts      # Italian locations seeding
    │   ├── utils.ts          # Shared data (names, cities, streets)
    │   └── fetch-locations.ts # Fetches location JSON from GitHub
    ├── schemas/              # Drizzle table definitions & relations
    │   ├── index.ts          # Barrel export
    │   ├── auth.ts           # user, session, account, verification
    │   ├── customer.ts       # customer_profiles (points balance)
    │   ├── seller.ts         # seller_profiles (VAT verification flow)
    │   ├── store.ts          # stores (PostGIS location with GiST index)
    │   ├── category.ts       # product_categories
    │   ├── product.ts        # products, product_classifications, store_products
    │   ├── product-image.ts  # product_images (S3/MinIO keys & URLs)
    │   ├── address.ts        # customer_addresses (PostGIS location)
    │   ├── employee.ts       # store_employees
    │   ├── order.ts          # orders, order_items
    │   └── points.ts         # point_transactions
    └── migrations/           # Auto-generated SQL migrations
```

## Database Schema

Entity relationships (simplified):

```mermaid
erDiagram
    user ||--o| customer_profile : has
    user ||--o| seller_profile : has
    user ||--o{ session : has
    user ||--o{ account : has

    seller_profile ||--o{ store : owns
    seller_profile ||--o{ product : creates
    seller_profile ||--o{ store_employee : employs
    store_employee }o--|| user : "is a"

    product ||--o{ product_classification : classified_by
    product_classification }o--|| product_category : references
    product ||--o{ store_product : "stocked in"
    product ||--o{ product_image : has
    store ||--o{ store_product : stocks

    customer_profile ||--o{ customer_address : has
    customer_profile ||--o{ order : places
    customer_profile ||--o{ point_transaction : tracks

    order ||--o{ order_item : contains
    order }o--|| store : "fulfilled by"
    order }o--o| customer_address : "shipped to"
    order_item }o--|| store_product : references
    point_transaction }o--o| order : "linked to"
```

Key relationships:

- A **user** can have both a `customer_profile` and a `seller_profile` (dual role)
- **Products** belong to a seller but are stocked per-store via `store_product` (each with its own `stock` count)
- **Products ↔ Categories** is many-to-many via `product_classification`
- **Orders** reference a `store`, a `customer_profile`, and optionally a `customer_address` (for delivery)
- **Order items** reference `store_product` (not `product` directly) to track which store fulfilled each item
- **Point transactions** are linked to orders and track earned/redeemed/refunded points

## Logging

Structured logging with **logixlysia** (Elysia plugin) + **Pino**:

- **Request logging** — automatic HTTP request/response logging with method, path, status, duration, IP
- **Structured JSON** — machine-readable log format with Pino
- **File rotation** — logs to `logs/app.log` with daily rotation, 100 MB max, 30-day retention, gzip compression
- **Standalone logger** — `src/lib/logger.ts` exports a `logger` instance for non-request contexts (cron jobs, startup,
  timers)
- **Sensitive data redaction** — automatically redacts `password`, `token`, `apiKey`, `secret`, `authorization` fields

## Health Check & Graceful Shutdown

- `GET /health` — verifies database connectivity; returns `200 { status: "ok" }` or `503 { status: "unhealthy" }`. Use
  as liveness/readiness probe.
- **Graceful shutdown** — on `SIGTERM`/`SIGINT`, the server stops accepting requests, clears all reservation timers,
  closes the database connection pool, then exits.

## Authentication & Authorization

### Roles

Four roles exist with role-based access control via better-auth's **admin** plugin:

- **admin** — full access; manages categories and verifies sellers
- **seller** — manages own stores, products, stock, orders and employees (requires verified VAT)
- **employee** — read/write access to the seller's products and orders (no store/employee management)
- **customer** — search products, manage addresses, place orders, earn/redeem loyalty points

### Custom Endpoints

Custom authentication endpoints provide unified registration/login:

- `POST /register/customer` — register + create customer profile
- `POST /register/seller` — register + create seller profile (VAT pending)
- `POST /register/sign-in` — login, returns user + both profiles (if exist)
- `GET /user` — get current authenticated user

Response includes both `customerProfile` and `sellerProfile` when present, allowing dual roles.

### Better-Auth Endpoints

Standard better-auth endpoints at `/auth/api/*`:

- `POST /auth/api/sign-out` — logout
- `GET /auth/api/get-session` — current session
- `GET /auth/api/list-sessions` — all user sessions
- Password reset, email verification, etc.

### How It Works

1. **Cookie-based sessions** — HTTP-only cookies (secure)
2. **Bearer token** — Also returned for `Authorization: Bearer <token>`
3. **Route protection** — Routes opt in with `{ auth: true }`
4. **User resolution** — Plugin resolves user/session from headers

## Order Types

- **direct** — immediate in-store purchase, completed instantly
- **reserve_pickup** — reserve items, pick up within 48 h (stock held until pickup/expiry)
- **pay_pickup** — pay online, pick up in store
- **pay_deliver** — pay online, delivered to a shipping address (fixed shipping cost: €5.00)

### Order State Machine

Status transitions are enforced by `src/lib/order-state-machine.ts`:

- `pending` → `confirmed` / `cancelled`
- `confirmed` → `ready_for_pickup` / `completed` / `cancelled`
- `ready_for_pickup` → `shipped` (delivery only) / `completed`
- `shipped` → `delivered` / `completed`

Not all transitions are valid for all order types — the state machine validates each transition.

### Reservation Expiry

`reserve_pickup` orders expire automatically after 48 hours via a dual mechanism:

1. **Per-order timer** — an in-memory `setTimeout` fires at the exact expiry time
2. **Cron safety net** — a cron job runs every 10 minutes to catch any missed expirations (e.g. after server restart)

On expiry, stock is refunded and any loyalty points spent are returned to the customer.

### Order Lifecycle Detail

What happens at the DB level when an order is created:

1. **Stock check** — verifies each `store_product` has sufficient stock
2. **Total calculation** — all arithmetic in integer cents (`toCents`/`fromCents`) to avoid float errors
3. **Points discount** — if `pointsToSpend > 0`, calculates discount (100 points = €1) capped at order total
4. **Order insert** — creates `order` row + `order_item` rows in a single transaction
5. **Stock decrement** — atomic `SET stock = stock - N WHERE stock >= N` (fails with 409 on race condition)
6. **Points deduction** — deducts spent points, inserts `point_transaction` (type: `redeemed`)
7. **Type-specific logic**:
    - `direct` → status starts as `completed`, points earned immediately
    - `reserve_pickup` → status `confirmed`, schedules expiry timer (48h), points earned on pickup
    - `pay_pickup` / `pay_deliver` → status `confirmed`, points earned on completion

On **cancellation**: stock is refunded, spent points are returned (`point_transaction` type: `refunded`).

On **pickup/completion**: loyalty points are calculated on the final total and awarded (`point_transaction` type:
`earned`).

## Seed Data

Run `bun run db:seed` to populate the database with test data. The following test users are created:

|| Email                       | Password    | Role     | Notes                          |
||--------------------------- |-------------|----------|--------------------------------|
|| admin1–3@test.com          | password123 | admin    |                                |
|| customer1–300@test.com     | password123 | customer |                                |
|| seller1–55@test.com        | password123 | seller   | active, VAT verified, has store |
|| seller56–80@test.com       | password123 | seller   | pending_review                 |
|| seller81–95@test.com       | password123 | seller   | pending_payment                |
|| seller96–107@test.com      | password123 | seller   | pending_store                  |
|| seller108–117@test.com     | password123 | seller   | pending_company                |
|| seller118–127@test.com     | password123 | seller   | pending_document               |
|| seller128–135@test.com     | password123 | seller   | pending_personal               |
|| seller136–143@test.com     | password123 | seller   | pending_email                  |
|| seller144–150@test.com     | password123 | seller   | rejected                       |

## API Quickstart

After completing the setup and running `bun run db:seed`, verify everything works:

```bash
# Health check
curl http://localhost:3000/health

# Sign in as a test customer (returns session token)
curl -X POST http://localhost:3000/register/sign-in \
  -H "Content-Type: application/json" \
  -d '{"email": "customer1@test.com", "password": "password123"}'

# Search products (public endpoint, no auth needed)
curl "http://localhost:3000/customer/search?q=pizza&page=1&limit=10"

# Search with geo-filter (products within 10 km of Milan center)
curl "http://localhost:3000/customer/search?q=pizza&lat=45.4642&lng=9.19&radius=10"

# Authenticated request (use the token from sign-in response)
curl http://localhost:3000/user \
  -H "Authorization: Bearer <token>"

# List categories as admin
curl http://localhost:3000/admin/categories \
  -H "Authorization: Bearer <admin-token>"
```

Full interactive documentation is available at `http://localhost:3000/openapi` (Scalar UI).

## API Documentation

The OpenAPI specification is auto-generated with:

- Full request/response schemas for all ~40 endpoints
- Better-auth endpoints (authentication, session management)
- Detailed error responses (400, 401, 403, 404, 422, 500)
- TypeScript-like type definitions with enums and constraints

### Response envelope format

```json
// Success
{
  "success": true,
  "data": {
    ...
  }
}

// Success with pagination
{
  "success": true,
  "data": [
    ...
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100
  }
}

// Error
{
  "success": false,
  "error": "ERROR_CODE",
  "message": "Human-readable error"
}
```

## CORS Configuration

CORS is pre-configured for React/Vue/Angular frontends:

- **Development**: Automatically accepts `localhost` on any port
- **Production**: Set `ALLOWED_ORIGINS` environment variable (comma-separated)
- **Credentials**: Enabled (`withCredentials: true`) for cookie-based auth

Example:

```env
ALLOWED_ORIGINS=https://app.yourdomain.com,https://admin.yourdomain.com
```

## React Integration

See **[REACT_INTEGRATION.md](./REACT_INTEGRATION.md)** for a complete frontend integration guide using **Eden Treaty**:

- End-to-end type safety (no code generation!)
- Auto-completion for all API endpoints
- Auth context with dual profile support
- Protected routes with role checking
- Practical examples (orders, search, pagination, file upload)

**Eden Treaty** provides RPC-like client with full TypeScript inference from the backend. Change a type on the server
and it's instantly reflected on the client with zero configuration.

## Troubleshooting

### Port already in use (5432 / 9000 / 3000)

Another process is using the port. Find it with `lsof -i :5432` and stop it, or change the port in `compose.yml` /
`.env`.

### Database connection refused

Ensure Docker containers are running (`bun run infra:up`). Check `DATABASE_URL` in `.env` matches the credentials in
`compose.yml` (default: `pgadmin` / `P4ssword!`).

### Migrations fail or schema out of sync

Full reset: `bun run infra:reset && bun run infra:up && bun run db:migrate`. This deletes all data.

### `Missing or invalid env vars` on startup

The server validates all required env vars at boot (`src/lib/env.ts`). Copy `.env.example` to `.env` and fill in all
required values. The error message lists which variables are missing.

### PostGIS extension not found

The custom Dockerfile in `docker/postgis/` installs PostGIS. If you see `type "geometry" does not exist`, make sure
you're using the project's Dockerfile, not a plain PostgreSQL image.

### MinIO bucket errors

The server auto-creates the bucket on startup (`ensureBucket()`). If you get S3 errors, verify `S3_ENDPOINT`,
`S3_ACCESS_KEY`, `S3_SECRET_KEY` in `.env` match the MinIO container config.

### `bun run typecheck` fails after pulling changes

Run `bun install` first — new dependencies may have been added.
