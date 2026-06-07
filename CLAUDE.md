# CLAUDE.md

Claude Code-specific tooling for this repository.

> **All project rules live in [AGENTS.md](AGENTS.md)** — architecture, conventions,
> hard rules, verification-before-completion, endpoint/route rubrics. Backend detail:
> [apps/api/AGENTS.md](apps/api/AGENTS.md). This file only configures Claude Code
> itself: MCP servers, hooks, plugins, and skills.

## Quick setup for new clones

1. **Install Claude Code**: <https://claude.com/claude-code>
2. **MCP servers**: `.mcp.json` at repo root auto-loads:
   - `context7` — live library docs for TanStack, Elysia, Drizzle, Tailwind (and a fallback for better-auth)
   - `shadcn` — browse/search/install components from the registries declared in [packages/ui/components.json](packages/ui/components.json) (shadcn/ui, `@kibo-ui`, `@shadcnblocks` — needs `SHADCNBLOCKS_API_KEY` in `packages/ui/.env.local`; see [packages/ui/README.md](packages/ui/README.md#registries))
   - `better-auth` — remote MCP server at `https://mcp.better-auth.com/mcp`. Preferred over context7 for Better Auth work
   Claude Code prompts on first run to approve them.
3. **Hooks, permissions & plugins**: `.claude/settings.json` is checked in and applied automatically:
   - Biome auto-fix hook on every `Edit`/`Write`
   - Deny-list for `.env*`, `bun.lock`, `db:push`, `db:seed`, `infra:reset`, `--no-verify`, `push --force`
   - Pre-approved safe commands (typecheck, test, lint, db:generate, git read-only)
   - **Auto-enabled plugins** from the `claude-plugins-official` marketplace:
     `superpowers` (workflow skills), `commit-commands` (`/commit`, `/commit-push-pr`),
     `frontend-design`, `chrome-devtools-mcp` (debug against `localhost:3001/3002/3003`),
     `claude-md-management` (`/revise-claude-md`), `stripe` (Stripe dev tools)
4. **Prerequisites** for the hooks: `jq` (`brew install jq` if missing).

## Agent workflow (superpowers)

Use these skills at the matching moment — they override default behavior only where they add discipline:

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

Checked-in skills live at repo root under `.agents/skills/` (symlinked into `.claude/skills/` for Claude Code, plus other agent directories). Managed via `bunx skills` — the root [skills-lock.json](skills-lock.json) is the single source of truth. Keeping everything at root ensures skills are available in every session regardless of which workspace you're editing.

| Skill | Purpose |
|---|---|
| `tanstack-start-best-practices`, `tanstack-router-best-practices`, `tanstack-query-best-practices`, `tanstack-integration-best-practices` | TanStack patterns — activates in `apps/{admin,customer,seller}` |
| `elysiajs` | Canonical Elysia patterns — activates in `apps/api` |
| `shadcn` | shadcn/ui CLI, theming, registries — activates on `packages/ui` work |
| `better-auth-best-practices`, `better-auth-security-best-practices`, `email-and-password-best-practices` | Better Auth — matches the current auth stack |
| `organization-best-practices`, `two-factor-authentication-best-practices` | Installed ahead of need — activate only when those Better Auth plugins are enabled |

To add more: `bunx skills add <source>` from repo root. To refresh everything: `bun run skills:update`.

## TODO (agent tooling, next iterations)

- `.claude/agents/api-endpoint-reviewer.md` — subagent checking the endpoint rubric in AGENTS.md.
- `.claude/agents/drizzle-migration-reviewer.md` — subagent checking reversibility, FK indexes, NOT NULL backfill, PostGIS compat.
- `.claude/skills/new-api-endpoint/` — custom skill with the endpoint template scaffolded.
- Postgres MCP (read-only, dev DB) in `.mcp.json` — currently skipped because each dev runs their own local DB.
