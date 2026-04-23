# bibs

[![CI](https://github.com/gellaz/bibs/actions/workflows/ci.yml/badge.svg)](https://github.com/gellaz/bibs/actions/workflows/ci.yml)

Monorepo for the **bibs** local-commerce marketplace.

## Structure

```text
apps/
  api/         → Backend API (Elysia + Bun + Drizzle + PostGIS)        :3000
  customer/    → Customer-facing web app (TanStack Start + React 19)   :3001
  seller/      → Seller back-office (TanStack Start + React 19)        :3002
  admin/       → Admin back-office (TanStack Start + React 19)         :3003
packages/
  ui/          → Shared UI components (shadcn/ui + Radix UI + Tailwind CSS v4)
```

## Prerequisites

- [Bun](https://bun.sh/) ≥ 1.3
- [Docker](https://www.docker.com/) (for PostGIS and MinIO)

## Getting Started

```bash
# Install all dependencies
bun install

# Start infrastructure (PostGIS + MinIO)
bun run infra:up

# Apply database migrations
bun run db:migrate

# Start all apps (API + admin + customer + seller)
bun run dev
```

## Scripts

| Script                 | Description                            |
|------------------------|----------------------------------------|
| `bun run dev`          | Start **all** apps concurrently        |
| `bun run dev:api`      | Start API dev server (port 3000)       |
| `bun run dev:customer` | Start customer app (port 3001)         |
| `bun run dev:seller`   | Start seller app (port 3002)           |
| `bun run dev:admin`    | Start admin app (port 3003)            |
| `bun run typecheck`    | TypeScript check across all workspaces |
| `bun run test`         | Run API tests (unit + integration)     |
| `bun run lint`         | Lint all files (Biome)                 |
| `bun run lint:fix`     | Lint and auto-fix (Biome)              |
| `bun run format`       | Format all files (Biome)               |
| `bun run infra:up`     | Start Docker services                  |
| `bun run infra:down`   | Stop Docker services                   |
| `bun run infra:reset`  | Stop and wipe volumes                  |
| `bun run db:generate`  | Generate Drizzle migrations            |
| `bun run db:migrate`   | Apply migrations                       |
| `bun run db:push`      | Push schema to DB (no migrations)      |
| `bun run db:studio`    | Open Drizzle Studio                    |
| `bun run db:seed`      | Seed test data into a fresh DB         |
| `bun run db:reset`     | Wipe volumes, re-migrate, re-seed      |

## Apps

- **[API](apps/api/README.md)** — Backend REST API with OpenAPI docs at `/openapi`
- **[Customer](apps/customer/README.md)** — Public marketplace frontend
- **[Seller](apps/seller/README.md)** — Seller dashboard
- **[Admin](apps/admin/README.md)** — Admin dashboard

## Packages

- **[UI](packages/ui/README.md)** (`@bibs/ui`) — Shared component library based on shadcn/ui (radix-nova style)
