# bibs

[![CI](https://github.com/gellaz/bibs/actions/workflows/ci.yml/badge.svg)](https://github.com/gellaz/bibs/actions/workflows/ci.yml)

Monorepo for **bibs** — a local-commerce marketplace for Italian neighborhoods.
Customers find and buy from nearby shops; sellers run their digital storefront; the
platform charges sellers a per-store subscription. The why and the brand live in
[PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md).

## Structure

```text
apps/
  api/         → Backend API (Elysia + Bun + Drizzle + PostGIS)        :3000
  customer/    → Customer-facing web app (TanStack Start + React 19)   :3001
  seller/      → Seller back-office (TanStack Start + React 19)        :3002
  admin/       → Admin back-office (TanStack Start + React 19)         :3003
packages/
  ui/          → Shared UI components (shadcn/ui + Tailwind CSS v4)
  emails/      → Transactional email templates (react-email)           :3004 (preview)
```

Dev infrastructure (Docker): **PostGIS** :5432 · **MinIO** :9000 (console :9001) ·
**Mailpit** (email catcher) UI :8025.

## Prerequisites

- [Bun](https://bun.sh/) ≥ 1.3
- [Docker](https://www.docker.com/) (PostGIS, MinIO, Mailpit)

## Getting started

```bash
bun install                              # dependencies + git hooks (Lefthook)
cp apps/api/.env.example apps/api/.env   # defaults work; set a real BETTER_AUTH_SECRET
bun run infra:up                         # PostGIS + MinIO + Mailpit
bun run db:migrate                       # apply migrations (wait a moment for PostGIS on first run)
bun run db:seed                          # test data (incl. dev accounts — see apps/api/README.md)
bun run dev                              # API + all three apps
```

Generate the auth secret with `bunx --bun @better-auth/cli secret`.

To exercise Stripe checkout locally you need a few extra one-time steps — follow
[docs/stripe-billing.md](docs/stripe-billing.md).

## Documentation map

| You want to… | Read |
|---|---|
| Understand the system end to end | [docs/architecture.md](docs/architecture.md) |
| Test the Stripe checkout / billing flow | [docs/stripe-billing.md](docs/stripe-billing.md) |
| Work on the API | [apps/api/README.md](apps/api/README.md) |
| Work on an app | [customer](apps/customer/README.md) · [seller](apps/seller/README.md) · [admin](apps/admin/README.md) · [ui](packages/ui/README.md) |
| Know the project rules & conventions (humans and agents) | [AGENTS.md](AGENTS.md) |
| Understand product & brand decisions | [PRODUCT.md](PRODUCT.md) · [DESIGN.md](DESIGN.md) |
| Claude Code-specific tooling | [CLAUDE.md](CLAUDE.md) |

## Scripts

| Script | Description |
|---|---|
| `bun run dev` | Start **all** apps concurrently |
| `bun run dev:api` / `dev:customer` / `dev:seller` / `dev:admin` | Start one app (ports 3000/3001/3002/3003) |
| `bun run dev:emails` | react-email preview server (port 3004) |
| `bun run typecheck` | TypeScript check across all workspaces |
| `bun run test` | Email-template tests + API tests (unit + integration) |
| `bun run lint` / `lint:fix` / `format` | Biome |
| `bun run infra:up` / `infra:down` | Start / stop Docker services |
| `bun run infra:reset` | Stop and **wipe volumes** |
| `bun run db:generate` / `db:migrate` | Generate / apply Drizzle migrations |
| `bun run db:push` | Push schema without migrations (local experiments only) |
| `bun run db:studio` | Drizzle Studio |
| `bun run db:seed` | Seed test data into a fresh DB |
| `bun run db:reset` | Wipe volumes → migrate → seed (one shot) |
| `bun run --cwd apps/api stripe:bootstrap` | Create the dev Stripe Product+Price (see runbook) |
| `bun run --cwd apps/api create-admin` | Create an admin user |
| `bun run skills:update` | Refresh checked-in agent skills |
