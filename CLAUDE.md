# CLAUDE.md

Guidance for [Claude Code](https://claude.com/claude-code) and other coding agents working in this repository.

> **Source of truth for architecture & conventions**: see [AGENTS.md](AGENTS.md) (root) and [apps/api/AGENTS.md](apps/api/AGENTS.md) for backend detail. This file only adds **agent-specific workflow, safety rules and tooling**.

---

## Quick setup for new clones

On first clone, to get the same agent experience as the rest of the team:

1. **Install Claude Code**: <https://claude.com/claude-code>
2. **MCP servers**: `.mcp.json` at repo root auto-loads:
   - `context7` — live library docs for TanStack, Elysia, Drizzle, Tailwind (and a fallback for better-auth)
   - `shadcn` — browse/search/install components from shadcn registries declared in [packages/ui/components.json](packages/ui/components.json) (`@kibo-ui`, `@shadcnblocks`, and the default shadcn/ui registry)
   - `better-auth` — remote MCP server at `https://mcp.better-auth.com/mcp`, maintained by the Better Auth team. Preferred over context7 for Better Auth work (auth/sessions across the API and the 3 frontends)
   Claude Code prompts on first run to approve them.
3. **Hooks, permissions & plugins**: `.claude/settings.json` is checked in and applied automatically:
   - Biome auto-fix hook on every `Edit`/`Write`
   - Deny-list for `.env*`, `bun.lock`, `db:push`, `db:seed`, `infra:reset`, `--no-verify`, `push --force`
   - Pre-approved safe commands (typecheck, test, lint, db:generate, git read-only)
   - **Auto-enabled plugins** from the `claude-plugins-official` marketplace — Claude Code will prompt to install on first open:
     - `superpowers` — workflow skills (brainstorming, planning, TDD, debugging, worktrees, parallel agents, code review, verification-before-completion)
     - `commit-commands` — Conventional-Commits-aware `/commit` and `/commit-push-pr`
     - `frontend-design` — design critique for the 3 React apps
     - `chrome-devtools-mcp` — perf/a11y debug against `localhost:3001/3002/3003`
     - `claude-md-management` — keep this file healthy with `/revise-claude-md`
4. **Prerequisites** for the hooks in `.claude/settings.json`: `jq` (usually preinstalled on macOS/Linux dev boxes; `brew install jq` if missing).

---

## Agent workflow

Use these superpowers skills at the matching moment — they override default behavior only where they add discipline:

| Moment | Skill |
|---|---|
| Start of any non-trivial feature | `superpowers:brainstorming` |
| Multi-step task (e.g. new endpoint → schema → route → OpenAPI → 3 Eden clients) | `superpowers:writing-plans` then `superpowers:executing-plans` |
| New domain logic (reservations, loyalty points, geo-search, pricing) | `superpowers:test-driven-development` |
| Non-obvious bug | `superpowers:systematic-debugging` |
| API change that touches frontend clients | `superpowers:dispatching-parallel-agents` to verify admin/customer/seller in parallel |
| Large implementation you want off the main context | `superpowers:subagent-driven-development` |
| Before saying "done" | `superpowers:verification-before-completion` |
| Closing a branch / opening a PR | `superpowers:finishing-a-development-branch`, then `superpowers:requesting-code-review` |

For one-shot commits, prefer `/commit-commands:commit` (respects this repo's Conventional Commits + scope whitelist).

## Universal skills (skills.sh)

Checked-in skills live at repo root under `.agents/skills/` (symlinked into `.claude/skills/` for Claude Code, plus other agent directories). Managed via `bunx skills` — the root [skills-lock.json](skills-lock.json) is the single source of truth. Agent harnesses discover skills from the directory the session is started in; keeping everything at root ensures they're available in every session regardless of which workspace you're editing.

| Skill | Purpose |
|---|---|
| `tanstack-start-best-practices`, `tanstack-router-best-practices`, `tanstack-query-best-practices`, `tanstack-integration-best-practices` | TanStack Start/Router/Query patterns — SSR, type-safe routes, data loading, cache coordination. Activates in `apps/{admin,customer,seller}` |
| `elysiajs` | Canonical Elysia patterns, schemas, integrations. Activates in `apps/api` |
| `shadcn` | shadcn/ui CLI reference, theming, registries, composition rules. Activates when touching `packages/ui/components.json` or component files |
| `better-auth-best-practices`, `better-auth-security-best-practices`, `email-and-password-best-practices` | Better Auth core config, security hardening, email/password flows — matches the current auth stack |
| `organization-best-practices`, `two-factor-authentication-best-practices` | Installed ahead of need — self-gate on mentions of the Better Auth `organization`/`twoFactor` plugins. Activate only when those plugins are enabled |

To add more: `bunx skills add <source>` from repo root. To restore after clone: `bunx skills experimental_install` at the root.

---

## Hard rules

Agents **must not** do any of the following without explicit user confirmation:

- `git commit --no-verify` / any bypass of Lefthook (Biome pre-commit + commit-msg validation are load-bearing).
- `bun run db:push` on any branch that will be shared — always go through `db:generate` + review diff + `db:migrate`.
- `bun run db:seed` on a DB you haven't just `infra:reset`'d — it assumes a clean schema.
- `bun run infra:reset` — deletes the local dev volumes.
- Edit `.env` / `.env.local` files (only `.env.example` is fair game). Deny-listed in `.claude/settings.json`.
- Edit `bun.lock` by hand — let `bun install` / `bun add` manage it. Deny-listed.
- `git push --force` to `main` or to any branch with an open PR.
- Introduce dependencies outside the root `catalog:` when they are shared across workspaces.

---

## Verification before completion

Before claiming a task is done, run (in the affected scope):

```bash
bun run typecheck   # always — catalog propagates types across 3 frontends via Eden Treaty
bun run lint        # Biome
bun run test        # when touching apps/api
```

UI changes: start the relevant dev server (`bun run dev:admin|dev:customer|dev:seller`) and exercise the feature in a browser. Type-check alone does not verify UI.

API changes: check that the OpenAPI spec at `/openapi` reflects the change, and that Eden Treaty types in `apps/{admin,customer,seller}/src/lib/api.ts` still resolve (`bun run typecheck` from root catches this).

Drizzle schema changes: `bun run db:generate`, then open the generated SQL and read it before running `bun run db:migrate`.

---

## Writing new API endpoints (Elysia)

When adding a route under `apps/api/src/`, follow the existing pattern:

1. Schema in `apps/api/src/lib/schemas/` (TypeBox, Italian `description`), re-exported from `index.ts`.
2. Response via `okRes()` / `okPageRes()` helpers (see `responses.ts`).
3. Errors via `withErrors()` / `withConflictErrors()`, with `ServiceError` for business errors. Let the global `errorHandler` do its job — don't try/catch for envelope shaping.
4. Auth: set `{ auth: true }` on the route config and use the `auth` macro instead of reading headers manually.
5. OpenAPI description on every route (Italian, consistent with the rest of the spec).
6. Handle pg unique violations implicitly via the global handler (`23505 → 409`).

---

## Writing new frontend routes (TanStack Start)

- File-based routing in `src/routes/`. Auth-guarded routes go under `_authenticated/`.
- i18n via Paraglide — add strings to `messages/*.json`, never hard-code user-facing copy.
- Data fetching via Eden Treaty + TanStack Query (`src/lib/api.ts`). Types come from the API — no manual DTOs.
- Forms: `react-hook-form` + `@hookform/resolvers` + Zod (or TypeBox through the shared schemas).
- UI primitives from `@bibs/ui` (`~/` alias), not raw Radix or hand-rolled shadcn copies.

---

## TODO (agent tooling, next iterations)

Not yet in the repo but on the shortlist — feel free to propose these as PRs:

- `.claude/agents/api-endpoint-reviewer.md` — subagent checking the endpoint rubric above.
- `.claude/agents/drizzle-migration-reviewer.md` — subagent checking reversibility, FK indexes, NOT NULL backfill, PostGIS compat.
- `.claude/skills/new-api-endpoint/` — custom skill with the endpoint template scaffolded.
- Postgres MCP (read-only, dev DB) in `.mcp.json` for schema introspection — currently skipped because each dev runs their own local DB.
