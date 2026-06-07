# @bibs/admin

Admin back-office for **bibs** — platform operations.

**Implemented today:** platform taxonomies (product macro-categories, product
categories, store categories) with CSV bulk import, and Italian holiday definitions
(all under `configurations`); seller verification; billing oversight (MRR overview,
subscription list, pricing configuration); user management. Routes for stores,
products, and collections exist as placeholders and are not yet functional.

## Stack

TanStack Start (SSR) + React 19 + TanStack Query + Eden Treaty + better-auth +
Paraglide (it/en) + Tailwind v4 + [@bibs/ui](../../packages/ui/). The shared frontend
architecture — routing conventions, data fetching, auth, aliases, gotchas — is
documented once in [docs/architecture.md](../../docs/architecture.md).

## Getting started

```bash
# from the monorepo root
bun install && bun run infra:up && bun run db:migrate && bun run db:seed
bun run dev:admin    # http://localhost:3003
```

## Scripts

`dev` (port 3003) · `build` · `preview` · `typecheck` · `lint` · `format` · `check`

## Environment

No env file is needed to boot: `VITE_API_URL` defaults to `http://localhost:3000`.
To override it (or the optional `VITE_APP_TITLE` / `SERVER_URL`), copy `.env.example`
to `.env.local`. The `BETTER_AUTH_*` lines in `.env.example` belong to the API's
`.env` — the admin app does not read them.

## Routes & i18n

File-based routes in `src/routes/` (auth-guarded ones under `_authenticated/`) — the
directory is the source of truth, intentionally not mirrored here. Translations in
`messages/{it,en}.json`; `src/paraglide/` is generated, never edited.
