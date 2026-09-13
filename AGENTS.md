# AGENTS.md

This file provides guidance when working with the **bibs** monorepo.

## Monorepo Overview

**bibs** is a local-commerce marketplace. The monorepo uses **Bun workspaces** and contains:

- `apps/api/` — Backend API (Elysia + Bun + Drizzle + PostgreSQL/PostGIS), port **3000**. See `apps/api/AGENTS.md` for detailed backend guidance.
- `apps/customer/` — Customer-facing web app (TanStack Start + React 19), port **3001**
- `apps/seller/` — Seller back-office (TanStack Start + React 19), port **3002**
- `apps/admin/` — Admin back-office (TanStack Start + React 19), port **3003**
- `packages/ui/` — Shared UI component library (`@bibs/ui`) — shadcn/ui (radix-nova style) + Radix UI + Tailwind CSS v4
- `packages/emails/` — Transactional email templates (`@bibs/emails`, react-email); preview server on port **3004**

Cross-app architecture (type flow, API patterns, data model, frontend stack):
[docs/architecture.md](docs/architecture.md). Stripe billing dev runbook:
[docs/stripe-billing.md](docs/stripe-billing.md).

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
- `bun run test` — run API tests (unit + integration)
- `bun run typecheck` — typecheck all workspaces
- `bun run lint` — lint all workspaces (Biome)
- `bun run lint:fix` — lint and auto-fix (Biome)
- `bun run format` — format all files (Biome)
- `bun run infra:up` / `infra:down` / `infra:reset` — manage Docker services (PostGIS + MinIO + Mailpit)
- `bun run db:generate` / `db:migrate` / `db:push` / `db:studio` — Drizzle database commands
- `bun run db:seed` / `db:reset` — seed test data / full wipe + migrate + seed
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

GitHub Actions runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml) on every pull request and every push to `main`. Three jobs run in parallel:

- **Lint (Biome)** — `bun run lint`
- **Typecheck** — `bun run typecheck` across all workspaces (the `pretypecheck` hook in each frontend compiles Paraglide messages first, so a fresh clone typechecks without running `vite dev`)
- **API tests (unit + integration)** — `bun run test`; integration tests spin up Postgres/PostGIS via testcontainers, no GitHub Actions `services:` needed

Concurrent runs on the same PR cancel each other; runs on `main` all complete. After the first green run, enable GitHub branch protection on `main` and mark the three checks as required to gate merges.

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
- **Eden Treaty** (`@elysiajs/eden`) — type-safe API client from the Elysia backend
- **better-auth client** — `src/lib/auth-client.ts` uses `createAuthClient` pointing to the API's `/auth/api` endpoint
- **React Hook Form** + `@hookform/resolvers` — form state management with schema validation
- **Paraglide JS** — i18n with localized routing (messages in `messages/`, output in `src/paraglide/`)
- **Tailwind CSS v4** — via `@tailwindcss/vite` plugin
- **@bibs/ui** — shared UI components from `packages/ui`, aliased as `~/` in imports
- **T3Env** (`@t3-oss/env-core`) — type-safe env variables in `src/env.ts`
- **Vite** — build tool with `vite-tsconfig-paths`

Key files in each frontend app:

- `src/lib/api.ts` — Eden Treaty client using `createIsomorphicFn` from `@tanstack/react-start`
- `src/lib/auth-client.ts` — better-auth React client with admin plugin
- `src/env.ts` — typed environment variables (validated with Zod)
- `src/routes/__root.tsx` — root layout
- `src/routes/_authenticated.tsx` — auth-guarded layout
- `src/routes/login.tsx` — login page
- `vite.config.ts` — Vite config with Paraglide, TanStack Start, Tailwind plugins

### Path aliases

- `@/*` → `./src/*` (via `package.json` imports field)
- `~/*` → `../../packages/ui/src/*` (via `tsconfig.json` paths + Vite alias)

Eden Treaty integration (concepts, error handling, gotchas) is documented in
[docs/architecture.md](docs/architecture.md#frontend--api-integration-eden-treaty).

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
bun update                  # root catalog: refreshes the `latest` tags and bumps the `^` floors
bun update --filter '*'     # workspace-level deps — the previous step does NOT reach them
bun outdated --filter '*'   # confirm only the intentional majors are left
```

**Both update passes are required.** Argument-less `bun update` only touches the root `package.json`; a dependency declared in a workspace (`packages/ui`, `apps/*`) stays at its old version with nothing printed to say so — that is how `tailwind-merge` sat a minor behind until #170. On bun ≥ 1.4 the first pass also raises the catalog's `^` floors by itself, which is what keeps floors in sync with the lockfile; editing a floor by hand is only the fallback for an entry it leaves behind.

Rules that bite:

- **Never `bun update <package-name>`.** Bun reads the name as "add this to the root package" and injects a spurious root `dependencies` block instead of re-resolving the catalog entry (#128). To recover, delete that block and re-run `bun install`.
- **A `latest` tag is not a hold.** It can cross a major in silence — the lock sat on `@tanstack/react-table` 8.21.3 while `latest` had already moved to 9.2.4 (#149). Every sweep, compare the `Latest` column against the locked major for each `latest`-tagged row; to actually hold a major, replace the tag with a caret floor.
- **One major per PR.** Majors fall outside the caret ranges and stay put on their own; port them deliberately, never folded into a sweep.
- **`@types/node` stays on `^22`.** Transitives (testcontainers, `@types/pg`, bun-types) resolve their own nested copies higher; only the catalog entry is ours.

The three `ci.yml` jobs (`lint`, `typecheck`, `api-test`) gate the merge, but run the full set locally before opening the PR:

```bash
bun run lint
for w in packages/ui packages/emails apps/api apps/admin apps/customer apps/seller; do
  bun run --cwd "$w" typecheck || echo "FAILED: $w"
done                        # per workspace: `--filter '*'` can swallow a single-workspace failure
bun run test
bun run --cwd apps/api build
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
- **bibs-minio** — MinIO object storage (ports 9000/9001)
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
bun run typecheck   # always — catalog propagates types across 3 frontends via Eden Treaty
bun run lint        # Biome
bun run test        # when touching apps/api or packages/emails
```

UI changes: start the relevant dev server and exercise the feature in a browser —
type-check alone does not verify UI. API changes: check `/openapi` reflects the
change and the Eden clients still typecheck from root. Drizzle schema changes:
`bun run db:generate`, then **read the generated SQL** before `bun run db:migrate`.

## Writing New API Endpoints (Elysia)

When adding a route under `apps/api/src/`, follow the existing pattern:

1. Schema in `apps/api/src/lib/schemas/` (TypeBox, Italian `description`), re-exported from `index.ts`.
2. Response via `okRes()` / `okPageRes()` helpers (see `responses.ts`).
3. Errors via `withErrors()` / `withConflictErrors()`, with `ServiceError` for business errors. Let the global `errorHandler` do its job — don't try/catch for envelope shaping.
4. Auth: set `{ auth: true }` on the route config and use the `auth` macro instead of reading headers manually.
5. OpenAPI description on every route (Italian, consistent with the rest of the spec).
6. Handle pg unique violations implicitly via the global handler (`23505 → 409`).

## Writing New Frontend Routes (TanStack Start)

- File-based routing in `src/routes/`. Auth-guarded routes go under `_authenticated/`.
- i18n via Paraglide — add strings to `messages/*.json`, never hard-code user-facing copy.
- Data fetching via Eden Treaty + TanStack Query (`src/lib/api.ts`). Types come from the API — no manual DTOs.
- Forms: `react-hook-form` + `@hookform/resolvers` + Zod (or TypeBox through the shared schemas).
- UI primitives from `@bibs/ui` (`~/` alias), not raw Radix or hand-rolled shadcn copies.

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
chore(deps): bump elysia to 1.3
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
