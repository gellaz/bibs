# @bibs/api

Backend API for **bibs**. Sellers manage stores, products and orders and pay a monthly
per-store subscription (Stripe); customers search by location, order (in-store pickup
or delivery) and earn loyalty points; admins curate taxonomies and verify sellers.

System overview and patterns: [docs/architecture.md](../../docs/architecture.md).
Stripe local-dev runbook: [docs/stripe-billing.md](../../docs/stripe-billing.md).

## Tech stack

- **Runtime** [Bun](https://bun.sh) · **Framework** [Elysia](https://elysiajs.com)
- **DB** PostgreSQL 18 + PostGIS 3.6 (Docker) · **ORM** [Drizzle](https://orm.drizzle.team)
- **Auth** [better-auth](https://www.better-auth.com) (email/password, RBAC admin plugin)
- **Storage** MinIO via Bun's native S3 client · **Payments** Stripe (subscriptions)
- **Email** Mailpit in dev via `src/lib/email.ts`, templates in `packages/emails`
- **Docs** OpenAPI auto-generated — Scalar UI at `/openapi`, JSON at `/openapi/json`

## Getting started

From the **monorepo root**:

```bash
bun install
cp apps/api/.env.example apps/api/.env   # defaults work; set a real BETTER_AUTH_SECRET
bun run infra:up        # PostGIS + MinIO + Mailpit
bun run db:migrate
bun run db:seed
bun run dev:api         # http://localhost:3000
```

Generate the auth secret with `bunx --bun @better-auth/cli secret`.

### Environment variables

`src/lib/env.ts` validates everything at boot and exits with a clear message if a
required variable is missing. See [.env.example](./.env.example) for the full annotated
list. Highlights:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | pool tuning via optional `DATABASE_POOL_MAX`, `DATABASE_IDLE_TIMEOUT_MS`, `DATABASE_CONNECTION_TIMEOUT_MS` |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | yes | |
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` | yes | MinIO in dev; bucket auto-created at startup |
| `STRIPE_SECRET_KEY` | yes | test-mode key is fine; see the [runbook](../../docs/stripe-billing.md) |
| `STRIPE_WEBHOOK_SECRET` | no | required only to receive webhooks (i.e. to complete a checkout) |
| `STRIPE_DEV_PRICE_ID` | no | created by `bun run stripe:bootstrap` |
| `MAILPIT_URL` | no | defaults to `http://localhost:8025` |
| `ALLOWED_ORIGINS`, `TRUST_PROXY` | no | production CORS / proxy hardening |

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Dev server with watch mode (port 3000) |
| `bun run test` | Unit + integration (integration uses testcontainers; Docker required) |
| `bun run test:unit` / `test:integration` | Split runs |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run db:generate` / `db:migrate` / `db:push` / `db:studio` / `db:seed` | Drizzle |
| `bun run db:clean` | Delete all migration files |
| `bun run stripe:bootstrap` | Create the dev Stripe Product+Price (idempotent) |
| `bun run create-admin` | Interactive admin-user creation |

Run these from `apps/api/`; from the monorepo root use
`bun run --cwd apps/api <script>`. `bun run db:reset` (root-level) does a full
wipe + migrate + seed in one shot.

## Modules

One Elysia plugin per domain under `src/modules/` (`context.ts` guard + `routes/` +
`services/`). The domain map and shared patterns (response envelope, error contract,
auth macro) are documented in [docs/architecture.md](../../docs/architecture.md); the
authoritative route list is the OpenAPI spec at `http://localhost:3000/openapi`.

In one line each: `registration` (sign-up/sign-in/password-reset/invites), `admin`
(taxonomies, seller verification, change review, holidays, pricing), `seller`
(onboarding, stores, catalog, stock, discounts, orders, team, settings,
billing/checkout), `customer` (geo search, addresses, orders, points), `me`
(cross-role endpoints — avatar today), `locations` (Italian geo data), public
taxonomy listings, `webhooks` (Stripe).

## Orders, points, reservations

Four order types: **direct** (in-store, completes immediately — no state-machine
transitions required), **reserve_pickup** (stock held 48 h), **pay_pickup** and
**pay_deliver** (fixed €5.00 shipping). Status transitions for the non-direct types are
enforced by `src/lib/order-state-machine.ts`; not every transition is valid for every
type.

Order creation (single transaction): stock check → totals in integer cents → optional
points discount (100 points = €1, capped at order total) → insert order + items (with
VAT snapshot) → atomic stock decrement (`SET stock = stock - N WHERE stock >= N`, 409
on race) → points deduction. Cancellation refunds stock and points; completion awards
points on the final total.

`reserve_pickup` orders expire after 48 h: a cron (`src/plugins/cron.ts`) runs
`expireReservations()` **every minute** — single source of truth, resilient to
restarts; worst-case latency between configured expiry and the status flip is ~60 s.

VAT is gross-inclusive (*scorporo*): products carry a `vatRate`, order items snapshot
it, orders store the VAT breakdown. Pure logic in `src/lib/vat.ts`.

## Authentication

Four roles via better-auth's admin plugin: **admin**, **seller**, **employee**,
**customer**. Sessions are HTTP-only cookies (bearer token also supported). Custom
unified endpoints under `/register/*` (sign-up creates the right profile; sign-in
returns user + both profiles); better-auth's own endpoints live under `/auth/api/*`.
Routes opt in with `{ auth: true }`.

Seller onboarding is a status ladder on `seller_profiles`:
`pending_email → pending_personal → pending_document → pending_company →
pending_review → active | rejected`. Admins review at `pending_review`. Store creation
(and its Stripe checkout) is a post-activation step — see the
[runbook](../../docs/stripe-billing.md).

## Seed data

`bun run db:seed` (or `bun run db:reset` from the monorepo root for wipe + migrate +
seed) creates:

| Account | Password | Use it for |
|---|---|---|
| **`seller@dev.bibs`** | `password123` | the primary dev account: fully onboarded, 2 stores — skips onboarding entirely. Subscriptions are seeded only when `STRIPE_DEV_PRICE_ID` is set (see the [runbook](../../docs/stripe-billing.md)) |
| `admin1–3@test.com` | `password123` | admin back-office |
| `customer1–300@test.com` | `password123` | bulk customers |
| `seller1–150@test.com` | `password123` | bulk sellers spread across all onboarding statuses — counts in `src/db/seed/fixtures/sellers.ts` (`statusDistribution`) |
| `employee1–45@test.com` | `password123` | employees distributed across seller stores |

Store subscriptions are seeded in a realistic state mix (active / past_due / canceling
/ suspended / canceled) so billing UI can be exercised without Stripe — details in the
[runbook](../../docs/stripe-billing.md#seed-provided-states-no-stripe-needed).

## API quickstart

```bash
curl http://localhost:3000/health

# Sign in (returns bearer token in response body; session cookie also set)
curl -X POST http://localhost:3000/register/sign-in \
  -H "Content-Type: application/json" \
  -d '{"email": "customer1@test.com", "password": "password123"}'

# Public product search, geo-filtered (10 km around Milan)
curl "http://localhost:3000/customer/search?q=pizza&lat=45.4642&lng=9.19&radius=10"
```

Interactive docs: `http://localhost:3000/openapi`.

## Response envelope

```jsonc
{ "success": true, "data": { … } }                                    // success
{ "success": true, "data": [ … ], "pagination": { "page": 1, "limit": 20, "total": 100 } }
{ "success": false, "error": "ERROR_CODE", "message": "…" }           // error
```

Pagination `limit` is capped at **100** (larger values → `422 VALIDATION_ERROR`).
Error semantics and the global handler are described in
[docs/architecture.md](../../docs/architecture.md).

## Logging, health, shutdown

Structured logging via logixlysia + Pino (request logs, JSON, sensitive-field
redaction). Logs are written to `logs/app.log` (single file, no rotation) and to
stdout. `GET /health` always returns `{ status: "ok" }` (200) if the process is
alive; `GET /ready` performs DB + S3 connectivity checks and returns 503 if either is
unreachable. On SIGTERM/SIGINT the server drains, closes the pool, exits.

## CORS

Development: any `localhost` port is accepted automatically. Production: set
`ALLOWED_ORIGINS` (comma-separated) **and** `NODE_ENV=production`. Credentials are
enabled for cookie auth.

## Troubleshooting

| Problem | Fix |
|---|---|
| Port 5432 already in use | Another Postgres owns it (`lsof -i :5432`). Note: after a failed bind, Docker Desktop's port forwarding can stay stuck — recreate the container or restart Docker Desktop. |
| DB connection refused | `bun run infra:up`; check `DATABASE_URL` matches `compose.yml`. |
| Schema out of sync | `bun run db:reset` from the monorepo root (wipes data). |
| `Missing or invalid env vars` at boot | Copy `.env.example` → `.env`; the error lists what's missing. |
| `type "geometry" does not exist` | You're not on the project's PostGIS image (`docker/postgis/`). |
| S3/MinIO errors | Bucket is auto-created at startup; verify the `S3_*` vars match `compose.yml`. |
| Stripe checkout never completes | See the [runbook troubleshooting](../../docs/stripe-billing.md#troubleshooting). |
| Typecheck fails after pulling | `bun install` first. |
