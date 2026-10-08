# AI tooling

The AI agent tooling checked into this repo, at a glance. How it is wired up
(setup, hooks, permissions, when to use which skill) lives in
[CLAUDE.md](../CLAUDE.md); project rules for every agent live in
[AGENTS.md](../AGENTS.md).

## Claude Code plugins

Enabled for everyone via [`.claude/settings.json`](../.claude/settings.json).

| Plugin | What it gives you | Docs |
|---|---|---|
| `superpowers` | Workflow skills: brainstorming, plans, TDD, debugging, verification | [obra/superpowers](https://github.com/obra/superpowers) |
| `commit-commands` | `/commit`, `/commit-push-pr`, `/clean_gone` | [plugin](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/commit-commands) |
| `frontend-design` | Visual design guidance for new UI | [plugin](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design) |
| `chrome-devtools-mcp` | Drive and inspect Chrome against the local apps | [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) |
| `claude-md-management` | `/revise-claude-md`, CLAUDE.md audits | [plugin](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-md-management) |
| `stripe` | Stripe docs, test cards, error explanations | [Stripe AI docs](https://docs.stripe.com/building-with-ai) |
| `ponytail` | "Lazy senior dev" mode: YAGNI, smallest change that works | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) |

Official plugins come from the
[`claude-plugins-official`](https://github.com/anthropics/claude-plugins-official)
marketplace; `ponytail` from its own marketplace, declared in
`extraKnownMarketplaces`. See [Claude Code plugins](https://docs.claude.com/en/docs/claude-code/plugins).

## Skills

Installed under [`.agents/skills/`](../.agents/skills) (symlinked into `.claude/skills/`),
pinned in [`skills-lock.json`](../skills-lock.json), refreshed with `bun run skills:update`.
Managed with [skills.sh](https://skills.sh) unless noted.

| Skills | Source |
|---|---|
| `tanstack-{start,router,query,integration}-best-practices` | [deckardger/tanstack-agent-skills](https://github.com/deckardger/tanstack-agent-skills) |
| `elysiajs` | [elysiajs/skills](https://github.com/elysiajs/skills) |
| `shadcn` | [shadcn/ui](https://ui.shadcn.com/docs/skills) |
| `better-auth-best-practices`, `better-auth-security-best-practices`, `email-and-password-best-practices`, `organization-best-practices`, `two-factor-authentication-best-practices`, `create-auth` | [better-auth/skills](https://github.com/better-auth/skills) |
| `impeccable` (own updater, `npx impeccable`) | [impeccable.style](https://impeccable.style) |

## MCP servers

Declared in [`.mcp.json`](../.mcp.json).

| Server | Purpose | Docs |
|---|---|---|
| `context7` | Up-to-date library docs | [context7.com](https://context7.com) |
| `shadcn` | Browse and install registry components | [shadcn MCP](https://ui.shadcn.com/docs/mcp) |
| `better-auth` | Better Auth docs search | [Better Auth MCP](https://www.better-auth.com/docs/introduction#mcp) |
