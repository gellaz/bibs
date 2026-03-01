# @bibs/seller

Seller back-office for **bibs** — manage stores, products, stock, orders, and employees.

## Tech Stack

- **Framework** — [TanStack Start](https://tanstack.com/start) (SSR + file-based routing)
- **UI** — React 19 + [Tailwind CSS v4](https://tailwindcss.com/) + [@bibs/ui](../../packages/ui/) (shadcn/ui
  radix-nova)
- **API client** — [Eden Treaty](https://elysiajs.com/eden/treaty) (type-safe, from `@bibs/api`)
- **Auth** — [better-auth](https://www.better-auth.com/) React client
- **Data fetching** — [TanStack Query](https://tanstack.com/query) + TanStack Router loaders
- **i18n** — [Paraglide JS](https://inlang.com/m/gerre34r/library-inlang-paraglideJs) (localized routing, `messages/`)
- **Env** — [T3Env](https://env.t3.gg/) (`src/env.ts`)
- **Linting** — [Biome](https://biomejs.dev/)

## Getting Started

```bash
# From the monorepo root
bun install
bun run infra:up
bun run db:migrate

# Start the seller app only
bun run dev:seller
```

The app is available at `http://localhost:3002`.

## Scripts

| Script              | Description                       |
|---------------------|-----------------------------------|
| `bun run dev`       | Start Vite dev server (port 3002) |
| `bun run build`     | Production build                  |
| `bun run preview`   | Preview production build          |
| `bun run typecheck` | TypeScript check (`tsc --noEmit`) |
| `bun run lint`      | Lint (Biome)                      |
| `bun run format`    | Format (Biome)                    |
| `bun run check`     | Lint + format check (Biome)       |

## Project Structure

```text
src/
├── env.ts                          # T3Env — typed environment variables
├── router.tsx                      # TanStack Router setup
├── routeTree.gen.ts                # Auto-generated route tree
├── styles.css                      # Global styles (Tailwind import)
├── integrations/
│   └── tanstack-query/
│       ├── devtools.tsx            # React Query devtools
│       └── root-provider.tsx       # QueryClient provider
├── lib/
│   ├── api.ts                      # Eden Treaty client (isomorphic)
│   └── auth-client.ts             # better-auth React client
├── paraglide/                      # Auto-generated i18n (do not edit)
└── routes/
    ├── __root.tsx                  # Root layout (head, providers, devtools)
    ├── _authenticated.tsx          # Auth guard layout
    ├── _authenticated/index.tsx    # Home page
    └── login.tsx                   # Login page
```

## Environment Variables

Copy `.env.example` to `.env.local`:

```bash
# Required
VITE_API_URL=http://localhost:3000

# Optional
# VITE_APP_TITLE=Bibs Seller
# SERVER_URL=http://localhost:3002
```

## Path Aliases

- `@/*` → `./src/*` (via `package.json` imports field)
- `~/*` → `../../packages/ui/src/*` (via `tsconfig.json` paths + Vite alias)

## i18n

Translations live in `messages/`. Paraglide auto-generates `src/paraglide/` on dev/build. Supported locales: `it` (
base), `en`.

## API Integration

Uses **Eden Treaty** for type-safe calls to the Elysia backend. See [REACT_INTEGRATION.md](../api/REACT_INTEGRATION.md)
for the complete guide.
