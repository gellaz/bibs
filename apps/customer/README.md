# @bibs/customer

Customer-facing web app for **bibs** — browse local stores, search products, order,
earn loyalty points.

**Implemented today:** registration and the full password lifecycle (verify-email,
forgot/reset password), the user profile, store discovery and detail, the store
catalog, and the shopping cart. **Checkout is not built yet** — the order API
exists (see [apps/api](../api/README.md)), the UI doesn't.

## Stack

TanStack Start (SSR) + React 19 + TanStack Query + Eden Treaty + better-auth +
Paraglide (it/en) + Tailwind v4 + [@bibs/ui](../../packages/ui/). The shared frontend
architecture — routing conventions, data fetching, auth, aliases, gotchas — is
documented once in [docs/architecture.md](../../docs/architecture.md).

## Getting started

```bash
# from the monorepo root
bun install && bun run infra:up && bun run db:migrate && bun run db:seed
bun run dev:customer    # http://localhost:3001
```

## Scripts

`dev` (port 3001) · `build` · `preview` · `typecheck` · `lint` · `format` · `check`

## Environment

No env file is needed to boot: `VITE_API_URL` defaults to `http://localhost:3000`.
To override it (or the optional `VITE_APP_TITLE` / `SERVER_URL`), copy `.env.example`
to `.env.local`.

## Routes & i18n

File-based routes in `src/routes/` (auth-guarded ones under `_authenticated/`) — the
directory is the source of truth, intentionally not mirrored here. Translations in
`messages/{it,en}.json`; `src/paraglide/` is generated, never edited.
