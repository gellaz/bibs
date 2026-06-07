# @bibs/seller

Seller back-office for **bibs** — run your stores on the platform.

**Implemented today:** the onboarding stepper (personal details → document upload →
company info → submitted for admin review); store management (details, opening hours,
closures, images) with store
creation via Stripe checkout; products with brands and stock; promotions /
discounts; team management with employee invitations; billing (per-store
subscriptions, invoices, Customer Portal). Testing the checkout flow locally:
[docs/stripe-billing.md](../../docs/stripe-billing.md).

## Stack

TanStack Start (SSR) + React 19 + TanStack Query + Eden Treaty + better-auth +
Paraglide (it/en) + Tailwind v4 + [@bibs/ui](../../packages/ui/). The shared frontend
architecture — routing conventions, data fetching, auth, aliases, gotchas — is
documented once in [docs/architecture.md](../../docs/architecture.md).

## Getting started

```bash
# from the monorepo root
bun install && bun run infra:up && bun run db:migrate && bun run db:seed
bun run dev:seller    # http://localhost:3002
```

Dev login: `seller@dev.bibs` / `password123` (seeded, fully onboarded).

## Scripts

`dev` (port 3002) · `build` · `preview` · `typecheck` · `lint` · `format` · `check`

## Environment

No env file is needed to boot: `VITE_API_URL` defaults to `http://localhost:3000`.
To override it (or the optional `VITE_APP_TITLE` / `SERVER_URL`), copy `.env.example`
to `.env.local`.

## Routes & i18n

File-based routes in `src/routes/` (auth-guarded ones under `_authenticated/`) — the
directory is the source of truth, intentionally not mirrored here. Translations in
`messages/{it,en}.json`; `src/paraglide/` is generated, never edited.
