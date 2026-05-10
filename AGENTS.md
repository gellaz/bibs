# AGENTS.md

This file provides guidance when working with the **bibs** monorepo.

## Monorepo Overview

**bibs** is a local-commerce marketplace. The monorepo uses **Bun workspaces** and contains:

- `apps/api/` — Backend API (Elysia + Bun + Drizzle + PostgreSQL/PostGIS), port **3000**. See `apps/api/AGENTS.md` for detailed backend guidance.
- `apps/customer/` — Customer-facing web app (TanStack Start + React 19), port **3001**
- `apps/seller/` — Seller back-office (TanStack Start + React 19), port **3002**
- `apps/admin/` — Admin back-office (TanStack Start + React 19), port **3003**
- `packages/ui/` — Shared UI component library (`@bibs/ui`) — shadcn/ui (radix-nova style) + Radix UI + Tailwind CSS v4

## Design Context

Strategic and visual context for any agent doing UI / brand work lives at the repo root and is loaded automatically by the `impeccable` skill:

- **[PRODUCT.md](PRODUCT.md)** — register, mission, vision, users (shoppers, merchants, civic partners, admins), brand personality, anti-references, the 5 design principles, accessibility baseline. Source of truth for *who* and *why*.
- **[DESIGN.md](DESIGN.md)** — visual system: Creative North Star ("The Open Hand"), color tokens (Ink + Cream + Saffron palette in OKLCH), typography (Geist + Bricolage Grotesque), elevation, components, do's and don'ts. Source of truth for *how it looks*. Frontmatter is normative.
- **[.impeccable/design.json](.impeccable/design.json)** — sidecar with full HTML/CSS for canonical components and signature patterns (Reward Pill, Civic Pill, Distance Pill, Shopkeeper's Window, Market Square). Used by the impeccable live panel and as a reference for new component code.

Note: the codebase as of writing carries the default shadcn radix-nova preset (cyan-sky `--primary`, neutral grayscale, Geist-only). DESIGN.md prescribes the brand-aligned target (navy Ink + warm Cream + Saffron, Bricolage Grotesque display). New work follows DESIGN.md; existing screens migrate opportunistically, not in a big-bang refactor.

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
- `bun run infra:up` / `infra:down` / `infra:reset` — manage Docker services (PostGIS + MinIO)
- `bun run db:generate` / `db:migrate` / `db:push` / `db:studio` — Drizzle database commands

## Git Hooks (Lefthook)

[Lefthook](https://github.com/evilmartians/lefthook) manages Git hooks. Hooks are installed automatically via the `postinstall` script when running `bun install`.

Hooks configured in `lefthook.yml`:

- **pre-commit** — runs `biome check --fix` on staged files only; fixed files are re-staged automatically
- **commit-msg** — validates that the commit message follows [Conventional Commits](https://www.conventionalcommits.org/) format

To reinstall hooks manually (e.g. after cloning without running `bun install`):

```bash
bunx lefthook install
```

To skip hooks in exceptional cases:

```bash
git commit --no-verify -m "..."
```

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

See `apps/api/REACT_INTEGRATION.md` for the complete Eden Treaty integration guide with examples.

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

#### 4. Update all dependencies to latest (use with caution)

```bash
# Update all to latest compatible (respects semver ranges)
bun update

# For major updates, edit package.json manually and test thoroughly
```

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

Dev server ports:

- **API**: 3000
- **Customer**: 3001
- **Seller**: 3002
- **Admin**: 3003

Environment variables are per-app (e.g. `apps/api/.env`, `apps/admin/.env.local`). See each app's `.env.example`.

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
