# AGENTS.md

This file provides guidance when working with the **bibs** monorepo.

## Monorepo Overview

**bibs** is a local-commerce marketplace. The monorepo uses **Bun workspaces** and contains:

- `apps/api/` — Backend API (Hono + Bun + Drizzle + PostgreSQL/PostGIS), port **3000**. See `apps/api/AGENTS.md` for detailed backend guidance.
- `apps/customer/` — Customer-facing web app (TanStack Start + React 19), port **3001**
- `apps/seller/` — Seller back-office (TanStack Start + React 19), port **3002**
- `apps/admin/` — Admin back-office (TanStack Start + React 19), port **3003**
- `packages/ui/` — Shared UI component library (`@bibs/ui`) — shadcn/ui (base-nova style) + Base UI + Tailwind CSS v4
- `packages/emails/` — Transactional email templates (`@bibs/emails`, react-email); preview server on port **3004**

Cross-app architecture (type flow, API patterns, data model, frontend stack):
[docs/architecture.md](docs/architecture.md). Stripe billing dev runbook:
[docs/stripe-billing.md](docs/stripe-billing.md); payment flows and fees with examples:
[docs/pagamenti.md](docs/pagamenti.md).

## Design Context

Strategic and visual context for any agent doing UI / brand work lives at the repo root and is loaded automatically by the `impeccable` skill:

- **[PRODUCT.md](PRODUCT.md)** — register, mission, vision, users (shoppers, merchants, civic partners, admins), brand personality, anti-references, the 5 design principles, accessibility baseline. Source of truth for *who* and *why*.
- **[DESIGN.md](DESIGN.md)** — visual system: Creative North Star ("The Open Hand"), color tokens (Ink + Cream + Saffron palette in OKLCH), typography (Geist + Satoshi), elevation, components, do's and don'ts. Source of truth for *how it looks*. Frontmatter is normative.
- **[.impeccable/design.json](.impeccable/design.json)** — sidecar with full HTML/CSS for canonical components and signature patterns (Reward Pill, Civic Pill, Distance Pill, Shopkeeper's Window, Market Square). Used by the impeccable live panel and as a reference for new component code.

The ui package tokens (`packages/ui/src/styles/globals.css`) are aligned to DESIGN.md — navy Ink + warm Cream OKLCH values, saffron/cobalt per-register accents, Satoshi as the display face. New work follows DESIGN.md directly; no migration debt remains from a legacy default preset.

To refresh strategic or visual context: `$impeccable teach` (PRODUCT) or `$impeccable document` (DESIGN). To start any new feature: `$impeccable craft <feature>`.

## Commands

- `bun install` — install all workspace dependencies
- `bun run dev` — start **all** apps concurrently (API + admin + customer + seller)
- `bun run dev:api` — start API dev server
- `bun run dev:customer` — start customer app
- `bun run dev:seller` — start seller app
- `bun run dev:admin` — start admin app
- `bun run test` — run every test suite: `apps/api` and `packages/emails` on `bun test` (Bun runtime, `mock.module`, testcontainers), the three frontends on Vitest (shared [`vitest.base.ts`](vitest.base.ts): Vite aliases + React Compiler, `node` by default, `// @vitest-environment jsdom` per file for component tests with Testing Library)
- `bun run typecheck` — typecheck all workspaces
- `bun run lint` — lint all workspaces (Biome)
- `bun run lint:fix` — lint and auto-fix (Biome)
- `bun run format` — format all files (Biome)
- `bun run infra:up` / `infra:down` / `infra:reset` — manage Docker services (PostGIS + SeaweedFS + Mailpit)
- `bun run db:generate` / `db:migrate` / `db:push` / `db:studio` — Drizzle database commands
- `bun run db:seed` / `db:reset` — seed test data / full wipe + migrate + seed (both accept `-- --only=admin|customer|seller`)
- `bun run dev:emails` — react-email preview server (port 3004)
- `bun run skills:update` — refresh checked-in agent skills

## Git Hooks (Lefthook)

[Lefthook](https://github.com/evilmartians/lefthook) manages Git hooks. Hooks are installed automatically via the `postinstall` script when running `bun install`.

Hooks configured in `lefthook.yml`:

- **pre-commit** — runs `biome check --fix` on staged files only; fixed files are re-staged automatically
- **commit-msg** — validates that the commit message follows [Conventional Commits](https://www.conventionalcommits.org/) format

To reinstall hooks manually (e.g. after cloning without running `bun install`):

```bash
bunx lefthook install
```

Skipping hooks (`git commit --no-verify`) is reserved for exceptional cases and —
per the [Hard Rules](#hard-rules) — requires explicit user confirmation first.

## Continuous Integration

GitHub Actions runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml) on every pull request and every push to `main`. The jobs run in parallel:

- **Lint (Biome)** — `bun run lint`
- **Typecheck** — `bun run typecheck` across all workspaces (the `pretypecheck` hook in each frontend compiles Paraglide messages first, so a fresh clone typechecks without running `vite dev`)
- **API tests (unit + integration)** — `bun run test` (also runs the emails and frontend suites); integration tests spin up Postgres/PostGIS via testcontainers, no GitHub Actions `services:` needed
- **Build (admin/customer/seller)** — `vite build` per frontend, then fails on an uncommitted `routeTree.gen.ts`
- **Docker image (api)** — builds `apps/api/Dockerfile`, runs `db:migrate` from the image and boots it against the compose Postgres/SeaweedFS until `/ready` is 200

Concurrent runs on the same PR cancel each other; runs on `main` all complete. After the first green run, enable GitHub branch protection on `main` and mark the checks as required to gate merges.

## Workspace Structure

Each app under `apps/` is a Bun workspace with its own `package.json`. Shared code goes in `packages/` (e.g. `@bibs/ui`).

To run a command in a specific workspace:

```bash
bun run --filter @bibs/api <script>
```

## Frontend Apps (shared architecture)

All three frontend apps (`admin`, `customer`, `seller`) share the same tech stack and structure:

- **TanStack Start** — SSR framework with file-based routing (`src/routes/`)
- **TanStack Router** — type-safe routing with route tree generation (`src/routeTree.gen.ts`)
- **TanStack Query** — data fetching with cache, pagination, refetch
- **Hono RPC client** (`hc` from `hono/client`) — type-safe API client, one per API sub-app, typed by the backend's exported app types
- **better-auth client** — `src/lib/auth-client.ts` uses `createAuthClient` pointing to the API's `/auth/api` endpoint
- **React Hook Form** + Zod (`zodResolver` from `src/lib/zod-resolver.ts`; the seller's forms on `@bibs/api/schemas` use `schemaResolver` from `src/lib/schema-errors.ts`) — form state management with schema validation
- **Paraglide JS** — i18n with localized routing (messages in `messages/`, output in `src/paraglide/`)
- **Tailwind CSS v4** — via `@tailwindcss/vite` plugin
- **@bibs/ui** — shared UI components from `packages/ui`, aliased as `~/` in imports
- **T3Env** (`@t3-oss/env-core`) — type-safe env variables in `src/env.ts`
- **Vite** — build tool with `vite-tsconfig-paths`

Key files in each frontend app:

- `src/lib/api.ts` — the `hc` clients, one per API sub-tree (`meApi`, `sellerApi`, `adminApi`, `customerApi`, `catalogApi`, …)
- `src/lib/auth-client.ts` — better-auth React client with admin plugin
- `src/env.ts` — typed environment variables (validated with Zod)
- `src/routes/__root.tsx` — root layout
- `src/routes/_authenticated.tsx` — auth-guarded layout
- `src/routes/login.tsx` — login page
- `vite.config.ts` — Vite config with Paraglide, TanStack Start, Tailwind plugins

### Path aliases

- `@/*` → `./src/*` (via `package.json` imports field)
- `~/*` → `../../packages/ui/src/*` (via `tsconfig.json` paths + Vite alias)

The `hc` integration (clients, errors, dates, gotchas) is documented in
[docs/architecture.md](docs/architecture.md#frontend--api-integration-hc).

## Dependency Management

This monorepo uses **Bun Workspace Catalog** to centralize shared dependency versions in the root `package.json`.

### Catalog Structure

Shared dependencies are defined in the `catalog` field of the root `package.json`. Workspaces reference them using `"catalog:"`:

```json
// Root package.json
{
  "catalog": {
    "better-auth": "1.5.0",
    "react": "^19.2.0",
    "@tanstack/react-start": "1.165.0"
  }
}

// Workspace package.json
{
  "dependencies": {
    "better-auth": "catalog:",
    "react": "catalog:"
  }
}
```

### Updating Dependencies

#### 1. Check for outdated dependencies

> **Note:** `bun outdated` at the root only checks the root `package.json` direct dependencies — it does **not** inspect catalog versions. To find outdated catalog/workspace dependencies, use `--filter`.

```bash
# Check all workspaces (including catalog dependencies)
bun outdated --filter '*'

# Check specific workspace
bun outdated --filter @bibs/api
```

#### 2. Update catalog dependencies

For dependencies in the catalog (most shared dependencies):

1. Update the version in the root `package.json` catalog
2. Run `bun install` to apply changes
3. Run `bun run typecheck` to verify compatibility

Example:

```bash
# Edit package.json catalog field
vim package.json  # Change "react": "^19.2.0" to "^19.3.0"

# Apply changes
bun install

# Verify
bun run typecheck
```

That is the targeted path for a single dependency. For a whole sweep use §4 instead — `bun update` re-resolves the catalog and raises the floors itself, so there is nothing to hand-edit.

#### 3. Update workspace-specific dependencies

For dependencies not in the catalog:

```bash
# Navigate to workspace
cd apps/api

# Update specific dependency
bun add package-name@latest

# Or update dev dependency
bun add -d package-name@latest
```

#### 4. Full dependency sweep

There is no update bot. Renovate was removed in #145: it cannot regenerate `bun.lock` for `catalog:` entries — neither through the regex `customManager` nor the still-unmerged native Bun catalog support ([renovate#42909](https://github.com/renovatebot/renovate/pull/42909), which explicitly leaves the lockfile to a manual `bun install`) — so every catalog PR failed `--frozen-lockfile`, while the TanStack `latest` entries were `ignoreDeps` anyway. Sweeps are on-demand and manual.

Run all four steps, in order:

```bash
bun outdated --filter '*'   # what is behind, across the catalog and every workspace
bun update                  # root catalog: bumps the `^` floors (exact pins stay put)
bun update --filter '*'     # workspace-level deps — the previous step does NOT reach them
bun outdated --filter '*'   # confirm only the intentional majors are left
```

**Both update passes are required.** Argument-less `bun update` only touches the root `package.json`; a dependency declared in a workspace (`packages/ui`, `apps/*`) stays at its old version with nothing printed to say so — that is how `tailwind-merge` sat a minor behind until #170. On bun ≥ 1.4 the first pass also raises the catalog's `^` floors by itself, which is what keeps floors in sync with the lockfile; editing a floor by hand is only the fallback for an entry it leaves behind.

Rules that bite:

- **Never `bun update <package-name>`.** Bun reads the name as "add this to the root package" and injects a spurious root `dependencies` block instead of re-resolving the catalog entry (#128). To recover, delete that block and re-run `bun install`.
- **No `latest` tags in the catalog.** A `latest` tag is not a hold: it crosses majors in silence (the lock sat on `@tanstack/react-table` 8.21.3 while `latest` had moved to 9.2.4, #149). The TanStack Start/Router/Query/Devtools entries are **exact pins** since P2.1, like `hono` (a prerelease) and `better-auth`: `bun update` leaves them alone. Bump them by hand, together (they release in lockstep): read the target versions from `bun outdated --filter '*'`, edit the pins, `bun install`, then the SSR smoke below.
- **One major per PR.** Majors fall outside the caret ranges and stay put on their own; port them deliberately, never folded into a sweep.
- **`@types/node` stays on `^22`.** Transitives (testcontainers, `@types/pg`, bun-types) resolve their own nested copies higher; only the catalog entry is ours.

The `ci.yml` jobs (`lint`, `typecheck`, `api-test`, `web-build` — a `vite build` per frontend that also fails on an uncommitted `routeTree.gen.ts` — and `docker-build`) gate the merge, but run the full set locally before opening the PR:

```bash
bun run lint
for w in packages/ui packages/emails apps/api apps/admin apps/customer apps/seller; do
  bun run --cwd "$w" typecheck || echo "FAILED: $w"
done                        # per workspace: `--filter '*'` can swallow a single-workspace failure
bun run test
bun run --cwd apps/api build
for a in admin customer seller; do bun run --cwd "apps/$a" build || echo "FAILED: $a"; done
bun run db:generate         # expect "No schema changes"
```

Any TanStack bump additionally needs the SSR smoke: a bad `@tanstack/react-start` release breaks server rendering while typecheck stays green (1.167.48 did exactly that). With `bun run dev` up:

```bash
for u in http://localhost:3001/ http://localhost:3002/login http://localhost:3003/login; do
  curl -s -m 20 -o /tmp/ssr.html -w "$u -> %{http_code} " "$u"
  grep -qi '<title>' /tmp/ssr.html && echo 'markup ok' || echo 'NO MARKUP'
done
```

All three must report 200 **and** `markup ok`: a 200 carrying an error shell is not a pass, which is why the status code alone never settles it.

#### 5. Security advisories

GitHub Dependabot **alerts** are enabled on the repo (detection only). With no update bot left they are the only automated signal, so triage one when it arrives instead of waiting for the next sweep.

Dependabot's automated security *fix* PRs are deliberately off: they would hit the wall Renovate did — a bumped manifest with a `bun.lock` nobody regenerated, failing `--frozen-lockfile`. Fix an advisory by hand, in a sweep-shaped PR.

### Adding New Dependencies

#### Shared dependency (used by 2+ workspaces)

1. Add to root `package.json` catalog
2. Reference it in workspace with `"catalog:"`
3. Run `bun install`

Example:

```bash
# Edit root package.json - add to catalog
"catalog": {
  "new-package": "^1.0.0"
}

# Edit workspace package.json
"dependencies": {
  "new-package": "catalog:"
}

# Install
bun install
```

#### Workspace-specific dependency

```bash
# Navigate to workspace
cd apps/api

# Add dependency
bun add package-name

# Or dev dependency
bun add -d package-name
```

### Best Practices

- **Always run `bun run typecheck`** after updating dependencies
- **Test the app** after major version updates
- **Update catalog dependencies together** to maintain consistency
- **Use exact versions** for critical dependencies (remove `^` or `~`)
- **Document breaking changes** in commit messages when updating major versions
- **Check changelogs** before updating, especially for major versions

## Infrastructure

`compose.yml` at the root defines shared dev services:

- **bibs-postgis** — PostgreSQL 18 + PostGIS 3.6 (port 5432)
- **bibs-seaweedfs** — SeaweedFS S3-compatible object storage (S3 API 9000, admin UI 9001)
- **bibs-mailpit** — Mailpit dev email catcher (SMTP 1025, web UI + API **8025**)

Dev server ports:

- **API**: 3000
- **Customer**: 3001
- **Seller**: 3002
- **Admin**: 3003
- **Email preview** (dev:emails): 3004
- **Mailpit UI**: 8025

Environment variables are per-app (e.g. `apps/api/.env`, `apps/admin/.env.local`). See each app's `.env.example`.

## Hard Rules

Do **not** do any of the following without explicit user confirmation:

- `git commit --no-verify` / any bypass of Lefthook (Biome pre-commit + commit-msg validation are load-bearing).
- `bun run db:push` on any branch that will be shared — always go through `db:generate` + review diff + `db:migrate`.
- `bun run db:seed` on a DB you haven't just reset — it assumes a clean schema.
- `bun run infra:reset` / `db:reset` — they delete the local dev volumes.
- Edit `.env` / `.env.local` files (only `.env.example` is fair game).
- Edit `bun.lock` by hand — let `bun install` / `bun add` manage it.
- `git push --force` to `main` or to any branch with an open PR.
- Introduce dependencies outside the root `catalog:` when they are shared across workspaces.

## Verification Before Completion

Before claiming a task is done, run (in the affected scope):

```bash
bun run typecheck   # always — the API's app types reach the 3 frontends through the `hc` clients
bun run lint        # Biome
bun run test        # when touching apps/api, packages/emails or a frontend
```

UI changes: start the relevant dev server and exercise the feature in a browser —
type-check alone does not verify UI. API changes: check `/openapi` reflects the
change and the `hc` clients still typecheck from root. Drizzle schema changes:
`bun run db:generate`, then **read the generated SQL** before `bun run db:migrate`.

## Writing New API Endpoints (Hono)

When adding a route under `apps/api/src/`, follow the existing pattern (a compact reference:
`src/modules/seller/routes/brands.ts`; step by step in [apps/api/AGENTS.md](apps/api/AGENTS.md#how-to-add-a-new-endpoint)):

1. **Zod schemas** in `apps/api/src/lib/schemas/` (shared) or at the top of the route file, with an Italian
   `description` (`.meta({ description })` or the constructor option). Use the constructors of
   `lib/schemas/t.ts` (`zString`, `zInteger`, `zInt`, `zDate`, `zFormat`, `zFile`, `zFiles`) instead of
   `z.string().min()/.max()`, `z.int()` or Zod's formats: they keep the API's rules (lengths in UTF-16 units,
   integers without safe-int limits, the API's formats) and its OpenAPI shape.
2. **One sub-app per module.** A route file exports a *chained* `new Hono().get(…).post(…)` (a route added in
   a separate statement drops out of the `hc` type); the module's `index.ts` adds it with `.route("/", xRoutes)` to
   its `moduleApp()` (`src/http/app.ts`: JSON error envelope, raw path, tolerated trailing slash) and exports
   `type XApp = typeof xApp`. A new module goes in the `MODULES` table of `src/app.ts` (prefix, sub-app,
   guards) and its type in `src/types.ts`. The first registered route wins: register static paths
   (`/products/lookup`) before `/products/:productId`.
3. **Handler order in every route:** `doc(…)` → `v("param", …)` → `v("query", …)` → `v("json" | "form", …)` →
   guard → handler. Guards come from `src/http/auth.ts` (`requireAuth`, `requireCustomer`, `requireSeller`,
   `requireSellerRole`, `requireAdmin`); a public route takes `publicRoute`; a rate limit (`rateLimit()`,
   `src/plugins/rate-limit.ts`) goes after the guard. Validation runs before auth (422 before 401): never
   `app.use(requireX)` on a module. `assertRoutes` stops the API at boot when a route lacks its module's
   guard, has a `v()` after the guard, or has the `v()` out of order.
4. **Input** from `c.req.valid(target)` (validated, query and params coerced, bodies trimmed except password
   fields, unknown fields stripped at any depth); what the guard resolved is in `c.var` (`user`, `session`,
   `customerProfile`, `seller`).
5. **Response** with `send(c, Schema, ok(data))` (or `okPage(data, pagination)`, `okMessage("…")` from
   `src/lib/responses.ts`), where `Schema` is `okRes(X)` / `okPageRes(X)` / `OkMessage`
   (`src/lib/schemas/responses.ts`), the same schema listed in `doc({ response: withErrors({ 200: Schema }) })`
   (`withConflictErrors` when a 409 is possible). `send()` drops fields outside the schema (internal columns
   never leak), writes `Date` as ISO strings and turns an off-schema payload into a 500; it is also what
   types the `hc` response. Never `c.json()` for a success body.
6. **Errors:** `throw new ServiceError(status, "messaggio in italiano")` (the code derives from the status;
   no custom codes). The app's `onError` (`toErrorResponse`, `src/http/errors.ts`) builds the envelope, maps
   pg unique violations (`23505`) to 409 and logs: don't try/catch for envelope shaping.
7. **OpenAPI:** `doc({ response, detail })` with an Italian `summary` and `description`, `tags` (a new tag is
   declared in `src/plugins/openapi.ts`) and `security: [{ bearerAuth: [] }]` on authenticated routes; check
   `/openapi`.
8. **Strip test:** every module has one proving that an unknown (nested) field in the body or query never
   reaches the service and that an extra field returned by the service never leaves the response (e.g.
   `tests/modules/locations-registration-strip.test.ts`). Requests in tests go through `app.request()` or
   `testRequest()` / `withVars()` / `signIn()` of `tests/helpers/hono-app.ts`.
9. **Clients:** the frontends call the route through the `hc` client of that sub-tree
   (`sellerApi.brands.$get({ query })`, `src/lib/api.ts`) and read it with `unwrapJson()`. JSON has no
   dates: they arrive as ISO strings, so convert with `new Date(iso)` where a `Date` is needed, and send
   query values without `null` (`hc` would send the string `"null"`).

## Writing New Frontend Routes (TanStack Start)

- File-based routing in `src/routes/`. Auth-guarded routes go under `_authenticated/`.
- i18n via Paraglide — add strings to `messages/*.json`, never hard-code user-facing copy.
- Data fetching via the `hc` clients (`src/lib/api.ts`) + TanStack Query, unwrapped with `unwrapJson(res, fallback)` from `@bibs/ui/lib/api-client`. Types come from the API — no manual DTOs. Dates arrive as ISO strings: build a `Date` where you need one.
- Forms: `react-hook-form` + Zod through `zodResolver` from `@/lib/zod-resolver` (it registers the translated Zod messages first). The seller's forms on the Zod schemas shared with the API (`@bibs/api/schemas`) use `schemaResolver` from `@/lib/schema-errors` instead: the schema's `error` meta (the 422 message) wins, translated through `SCHEMA_ERRORS`, and the submit gets the raw form values.
- UI primitives from `@bibs/ui` (`~/` alias), not raw Base UI or hand-rolled shadcn copies.

## Commit Conventions

This project follows [Conventional Commits](https://www.conventionalcommits.org/).

### Commit Message Format

```text
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types** (required):

- `feat` — new feature
- `fix` — bug fix
- `docs` — documentation only
- `style` — formatting, white-space, linting
- `refactor` — code change that neither fixes a bug nor adds a feature
- `perf` — performance improvement
- `test` — adding or updating tests
- `build` — build system or external dependencies
- `ci` — CI/CD configuration
- `chore` — maintenance tasks

**Scopes** (optional, use the workspace or module name):

- `api`, `customer`, `seller`, `admin`, `ui` — workspace scopes
- `db`, `auth`, `orders`, `products`, `categories`, `stores`, `images`, `employees`, `search`, `points`, `locations`, `onboarding` — module/feature scopes
- `infra` — Docker, CI/CD, deployment
- `deps` — dependency updates

### Examples

```text
feat(api): add bulk product import endpoint
fix(customer): correct loyalty points calculation on refund
refactor(seller): extract order validation into service layer
docs(api): update OpenAPI descriptions for store endpoints
chore(deps): bump better-auth to 1.8
```

### When Committing

- Each commit should be atomic — one logical change per commit
- Never mix unrelated changes in a single commit
- Write the description in lowercase, imperative mood ("add feature" not "Added feature")
- Keep the first line under 72 characters
- Reference issue numbers in the footer when applicable: `Closes #42`

## Code Conventions

- **File naming**: kebab-case for all files and directories
- **Package naming**: `@bibs/<name>` scope for all workspaces
- **Linting & formatting**: Biome (config in `biome.json` at root). Indent with tabs, double quotes for JS/TS.
- After code changes, run `bun run typecheck` to verify across all workspaces
