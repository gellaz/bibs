# Documentation Overhaul — Design

**Date:** 2026-06-07
**Status:** Approved (Marco, 2026-06-07)

## Context

The project documentation has fallen behind the codebase and is scattered across ~10 files. An exploration pass (2026-06-07) found:

- `apps/api/README.md` misses entire domains shipped since it was written: Stripe billing/checkout, webhooks, discounts, store closures/holidays, seller settings, brands, store images, the `me/` module; ~14 DB tables are undocumented; the seed table is wrong (missing `seller@dev.bibs`, stale onboarding statuses); the reservation-expiry cron is documented as "every 10 min" but runs every minute.
- The three frontend READMEs document a route tree frozen at `login + index`; the seller app alone has 30+ routes today.
- The root README omits Mailpit from the infra stack and misses scripts (`db:reset`, `db:clean`, `dev:emails`, `skills:update`, `stripe:bootstrap`, `create-admin`); `bun run test` also runs `@bibs/emails` tests.
- Root `AGENTS.md` still says DESIGN.md prescribes "Bricolage Grotesque" (it prescribes Satoshi) and omits `packages/emails`.
- `apps/api/REACT_INTEGRATION.md` uses a `#/` import alias that no app uses (`@/` is real) and documents an outdated auth pattern.
- **Stripe is entirely undocumented** despite being a complete, production-ready flow (per-store subscription checkout, signed webhooks with idempotency, dunning, Customer Portal, `stripe:bootstrap` script, mocked in tests).
- Customer order payment via Stripe does **not** exist (state machine entries + dormant `payment_methods` table only) — and nothing says so anywhere.

Root cause of staleness: enumerative docs (route lists, file trees, table-by-table listings) decay on every PR, and cross-app knowledge (billing flow spanning API + seller app, shared frontend architecture) has no home, so it gets duplicated and diverges.

## Decisions (validated with Marco)

| Question | Decision |
|---|---|
| Coverage level | **Curated + anti-stale**: concepts and flows documented deeply; volatile lists documented at domain level with pointers to code and `/openapi` |
| Stripe guide depth | **Full runbook**: setup, happy path, failure scenarios, dunning, seed states, test mocks, troubleshooting, explicit "what doesn't exist" |
| Language | **All English** (OpenAPI descriptions and user-facing copy stay Italian, as per existing convention) |
| Audience | All three: new devs onboarding, coding agents, Marco-in-6-months |
| Structure | **A — `docs/` hub + slim READMEs** (rejected: update-in-place B, docs site C) |
| AGENTS.md ↔ CLAUDE.md | **Sharp boundary**: AGENTS.md owns all project rules for any agent (hard rules, verification, endpoint/route rubrics move there); CLAUDE.md keeps only Claude Code tooling + a pointer |
| REACT_INTEGRATION.md | **Deleted**; surviving content (~30 lines of concepts + gotchas) absorbed into `docs/architecture.md` §Frontend ↔ API (rejected: standalone `docs/frontend-api-integration.md`) |

## Principles

1. **One home per fact.** Every piece of information lives in exactly one file; other files link, never duplicate.
2. **Domain level, not item level.** Volatile enumerations (routes, endpoints, tables) are described per domain with a pointer to the code or `/openapi`; never exhaustively listed.
3. **Documented = executed.** Every command in the docs is run during implementation; every path/script/env var is checked against the repo.

## Target file map

```
README.md                          # ENTRY POINT — what bibs is, prerequisites, quick start
                                   # (infra incl. Mailpit, migrate, seed, dev), full scripts
                                   # table, ports, documentation map
docs/
  architecture.md          [NEW]   # Cross-app overview: monorepo & type flow, API patterns,
                                   # data model by domain, shared frontend architecture
                                   # (incl. Eden integration concepts + gotchas), testing,
                                   # email infrastructure
  stripe-billing.md        [NEW]   # Stripe dev/test runbook (see outline below)
  audit/ brand/ superpowers/       # unchanged, linked from README documentation map
apps/api/README.md                 # API reference (rewritten, see below)
apps/customer/README.md            # Slim app README (see template below)
apps/seller/README.md              # Slim app README
apps/admin/README.md               # Slim app README (drop unverified Vitest claim)
AGENTS.md                          # All project rules for any agent (absorbs from CLAUDE.md)
apps/api/AGENTS.md                 # Factual updates (me/, webhooks/, cron cadence)
CLAUDE.md                          # Claude Code tooling only + pointer to AGENTS.md
apps/api/REACT_INTEGRATION.md      # DELETED (links updated repo-wide)
DESIGN.md, PRODUCT.md              # UNTOUCHED — already correct, remain source of truth
```

No `docs/README.md` index: the documentation map lives in the root README (one less index to keep aligned). No standalone doc for `packages/emails` (covered by architecture.md §Email + apps/api/AGENTS.md).

## Content specs

### `README.md` (root, ~100 lines)

- What bibs is (1 paragraph; links PRODUCT.md, doesn't duplicate it)
- Repo structure incl. `packages/emails`; ports table: api 3000, customer 3001, seller 3002, admin 3003, email preview 3004, Mailpit UI 8025, MinIO 9000/9001, PostGIS 5432
- Quick start: `bun install` → `infra:up` (PostGIS + MinIO + Mailpit) → `db:migrate` → `db:seed` → `bun run dev`
- Complete scripts table: adds `db:reset`, `db:clean`, `dev:emails`, `skills:update`, `stripe:bootstrap` (`--cwd apps/api`), `create-admin`; notes `test` covers `@bibs/emails` + `@bibs/api`
- Documentation map: "to understand X → read Y" table pointing at docs/, AGENTS.md, DESIGN/PRODUCT, app READMEs

### `docs/architecture.md` (~250 lines)

- Monorepo diagram + type flow: Drizzle → TypeBox schemas → Eden Treaty → 3 apps
- **API patterns**: response envelope (`okRes`/`okPageRes`), error contract (`withErrors`/`withConflictErrors`, `ServiceError`, global handler, pg 23505 → 409), auth (better-auth, 4 roles, `{ auth: true }` macro), module list **by domain** with one line each (registration, admin, seller — incl. discounts, closures, settings, billing, checkout, brands, store-images —, customer, me, locations, webhooks) + pointer to `/openapi`
- **Data model by domain** (not table-by-table): identity & profiles; stores (hours, closures, holiday definitions/opt-outs, images, categories, subscription); catalog (products, brands, macro-categories, VAT, audit log); orders + state machine + points; Stripe billing (`pricing_config`, `pending_store_creation`, `store_subscription`, `stripe_event`). Updated ER diagram (domain-grouped, not exhaustive)
- **Shared frontend architecture**: TanStack Start/Router/Query, file-based routing, better-auth client, Paraglide, T3Env, aliases (`@/` → src, `~/` → packages/ui)
- **Frontend ↔ API** (absorbs REACT_INTEGRATION.md): Eden Treaty concepts (types from `App`, no codegen, isomorphic client, cookies + `credentials: include`), typed error handling per status, gotchas (Eden hydrates ISO date strings into `Date` → use `toYMD()`), auth via `authClient`
- **Testing**: unit + integration layout, testcontainers Postgres, what's mocked (Stripe, email), frontends currently have no tests
- **Email**: Mailpit in dev (`compose.yml`, UI :8025), `@bibs/emails` react-email workspace, logger fallback

### `apps/api/README.md` (rewritten, stays the API reference)

- Tech stack, setup, env vars aligned with the real `.env.example` (pool tuning vars, `MAILPIT_URL`, Stripe vars, `TRUST_PROXY`, `ALLOWED_ORIGINS`)
- Modules at domain level, linking architecture.md for patterns
- Orders section corrected: 4 order types, state machine, reservation expiry (cron **every minute**), points
- **Seed reality**: `seller@dev.bibs` / `password123` featured as the primary dev account (2 stores, active subscriptions, skips onboarding); current onboarding status ladder (`pending_email → pending_personal → pending_document → pending_company → pending_review → active|rejected`); seeded billing-state mix; bulk `@test.com` fixtures; `create-admin` script
- API quickstart with verified curl commands; troubleshooting extended (5432 port contention with Docker Desktop forwarding glitch)
- React integration section replaced by a link to architecture.md §Frontend ↔ API

### `apps/{customer,seller,admin}/README.md` (~60 lines each)

- Purpose + **implemented domains in prose** (seller: onboarding stepper, stores + hours + closures, products + brands + stock, promotions/discounts, team/invites, Stripe billing; admin: categories, seller verification, holidays, billing/pricing config, users; customer: registration/password flows, profile — storefront not yet built)
- **No per-route file tree** — pointer to `src/routes/`
- Stack in 3 lines + link to architecture.md; scripts; env vars verified against each `.env.example`; admin README drops the Vitest claim unless real tests exist

### `AGENTS.md` (root)

- Absorbs from CLAUDE.md: hard rules, verification-before-completion, Elysia endpoint rubric, TanStack route rubric
- Fixes: Satoshi (not Bricolage Grotesque), `packages/emails` in structure, missing scripts
- Adds pointers to `docs/architecture.md` and `docs/stripe-billing.md`

### `CLAUDE.md`

- Reduced to Claude Code-specific tooling: MCP servers, `.claude/settings.json` hooks/permissions/plugins, superpowers skill table, `/commit` preference
- One prominent line: all project rules live in AGENTS.md

### `apps/api/AGENTS.md`

- Add `me/` and `webhooks/` to the module list; correct cron cadence; verify the rest against code during implementation

## `docs/stripe-billing.md` outline (~300 lines)

1. **The model in 2 minutes** — one Stripe subscription per store (price from `pricing_config`, mode `subscription`); store form parked in `pending_store_creation`; the store is created **only** when the `checkout.session.completed` webhook lands. Sequence diagram: form → checkout session → Stripe hosted page → webhook → store + subscription → `/processing` polling → redirect. `store_subscription` status table (`active / past_due / canceling / suspended / canceled`) with what moves each (webhooks, 60-day auto-cancel cron, voluntary cancellation).
2. **One-time setup** — Stripe test account; `STRIPE_SECRET_KEY` in `apps/api/.env`; `bun run --cwd apps/api stripe:bootstrap` (creates Product + Price, outputs `STRIPE_DEV_PRICE_ID`); Stripe CLI `stripe login` + `stripe listen --forward-to localhost:3000/webhooks/stripe` → `whsec_…` into `STRIPE_WEBHOOK_SECRET`. Callout: without webhook forwarding, checkout "pays" but the store is never created — the classic endless-processing symptom.
3. **Happy path walkthrough** — `db:seed` → login `seller@dev.bibs` / `password123` → `/store/new` → submit → card `4242 4242 4242 4242` → return to `/processing` → polling → active store. What to verify at each step (`stripe listen` log line, `stripe_events` row, `store_subscriptions.status='active'`).
4. **Beyond the happy path** — mid-checkout cancel (resume via `?cancel={pendingId}`, open-session reuse); declined card / 3DS test cards (`4000 0000 0000 0002`, `4000 0025 0000 3155`); failed renewal → dunning (`stripe trigger invoice.payment_failed` with its limits — synthetic event not tied to your subscription — and the honest alternative: seeded states); seller banners + Customer Portal (`POST /seller/billing/portal`); suspension and auto-cancel (`suspended` after dunning exhausted, 60-day cron, soft delete); voluntary cancellation (`cancel_at_period_end` → `canceling` → reversible).
5. **Seed-provided states** — table of seeded stores per billing state (3× past_due, 2× canceling, 1× suspended, 1× canceled): billing UI work **requires no Stripe setup**.
6. **Automated tests** — Stripe fully mocked via `mock.module("@/lib/stripe")`, real DB via testcontainers; how to run the webhook/checkout integration tests; why mocks don't cover real signature verification.
7. **What does NOT exist (explicit)** — customer order payment (`pay_pickup`/`pay_deliver` exist only in the order state machine; `payment_methods` dormant), SDI e-invoicing, refunds/disputes, multi-currency, plan tiers — link to `docs/superpowers/specs/2026-05-26-seller-store-subscription-billing-design.md` for rationale.
8. **Troubleshooting** — webhook signature failures (raw body, `constructEventAsync` required on Bun), events not arriving, expired pending creation, missing `STRIPE_DEV_PRICE_ID`.

## Error-fix checklist (folded into the rewrites above)

| Where | Wrong today | Correct |
|---|---|---|
| apps/api/README | cron "every 10 min" | every minute (`Patterns.EVERY_MINUTE`) |
| apps/api/README | seed table (statuses, no dev account) | current ladder + `seller@dev.bibs` |
| AGENTS.md | "Bricolage Grotesque" | Satoshi |
| REACT_INTEGRATION.md | `#/lib/api` alias | `@/` (file deleted; fixed in absorbed content) |
| root README | infra = PostGIS + MinIO | + Mailpit |
| root README | `test` = "API tests" | emails + API tests |
| admin README | Vitest + Testing Library claim | verify; drop if no tests |

## Verification plan

- Every command quoted in any doc is executed during implementation; every path, script name, env var, port is checked against the repo.
- Internal links checked across all touched files (incl. links elsewhere in the repo pointing at deleted/moved files).
- Stripe runbook §2–3 executed end-to-end locally (requires Marco's Stripe test key — coordinate at plan time).
- `bun run lint` on touched files (Biome covers markdown formatting where configured).

## Out of scope

- Documenting features that don't exist (customer storefront, customer order payments) beyond explicit "not yet built" notes.
- `packages/ui/README.md` rewrite (registries section is current; only touched if links break).
- DESIGN.md / PRODUCT.md content changes.
- Docs site tooling (VitePress etc.).
- New tests or code changes — this is a docs-only branch, except link fixes inside code comments if any reference deleted files.
