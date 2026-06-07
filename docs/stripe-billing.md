# Stripe billing — developer runbook

How money works in bibs today, and how to exercise the whole flow on your machine.
Architecture context: [architecture.md](architecture.md). Design rationale:
[the billing spec](superpowers/specs/2026-05-26-seller-store-subscription-billing-design.md).

> **Scope.** Stripe is used for one thing: the **per-store monthly subscription paid by
> sellers**. Customers never touch Stripe — customer order payment does not exist yet
> (see [What does NOT exist](#what-does-not-exist-yet)).

## The model in 2 minutes

Every active store costs its seller a flat monthly fee (default €29, defined in the
`pricing_config` table together with the live Stripe price id). Creating a store **is**
a Stripe Checkout:

```text
seller fills the store form (/store/new in the seller app)
   │  POST /seller/stores/checkout
   ▼
API parks the form in pending_store_creation (status=open)
and creates a Stripe Checkout Session (mode: subscription)
   │  302 → Stripe-hosted payment page
   ▼
seller pays (test card) → Stripe redirects back to
/store/new/processing?session_id=… which polls
GET /seller/checkout-sessions/:sessionId/status every second
   │
   │  meanwhile, asynchronously:
   ▼
Stripe → POST /webhooks/stripe  (checkout.session.completed)
   ▼
webhook handler, in one transaction: INSERT store,
INSERT store_subscription (active), pending → consumed
   ▼
polling sees status=ready + storeId → redirect to the new store
```

The store **only exists after the webhook lands**. No webhook forwarding → payment
succeeds but the processing page spins forever (60-second timeout). That is the #1
local-dev gotcha; setup below fixes it.

### Subscription states

`store_subscriptions.status` is moved exclusively by webhooks plus one cron:

| Status | Meaning | Moved by |
|---|---|---|
| `active` | paid and current | `checkout.session.completed`, `invoice.payment_succeeded` |
| `past_due` | a renewal failed; Stripe is retrying (dunning) | `invoice.payment_failed` |
| `canceling` | seller asked to cancel at period end (reversible) | `customer.subscription.updated` |
| `suspended` | dunning exhausted; store inaccessible to the seller | `customer.subscription.updated` (status `unpaid`) |
| `canceled` | terminal; store soft-deleted/archived | `customer.subscription.deleted` |

Note: only a `canceled` store (soft-deleted via `deletedAt`) disappears from customer
search. A `suspended` store is not filtered out by the customer search service — it
only becomes invisible once it transitions to `canceled` and gets soft-deleted.

A daily job (03:00 server time) auto-cancels subscriptions that have been `suspended`
longer than `pricing_config.suspendedAutoCancelDays` (default 60). An hourly job
expires `pending_store_creation` rows that exceed
`pricing_config.pendingCreationExpiryHours` (default 24).

The webhook endpoint (`POST /webhooks/stripe`) verifies the `stripe-signature` header
with `constructEventAsync` (the async variant is required on Bun — the runtime only
exposes Web SubtleCrypto, which the Stripe SDK cannot use synchronously) and is
idempotent via the `stripe_events` table (`INSERT … ON CONFLICT DO NOTHING`; `processedAt`
stays NULL on handler failure so Stripe's retry reprocesses it).

## One-time setup

1. **Stripe account** in test mode (free): <https://dashboard.stripe.com>. Grab the
   secret key (`sk_test_…`) from Developers → API keys.
2. **API env** — in `apps/api/.env`:

   ```env
   STRIPE_SECRET_KEY=sk_test_…
   ```

3. **Create the dev Product+Price** (idempotent — it searches before creating):

   ```bash
   bun run --cwd apps/api stripe:bootstrap
   ```

   Copy the printed id into `apps/api/.env`:

   ```env
   STRIPE_DEV_PRICE_ID=price_…
   ```

   The seed wires this price into `pricing_config`; without it, the seed logs a
   warning, skips `pricing_config`, and checkout creation later fails. **Order
   matters:** if you already seeded the DB before setting this variable, run
   `bun run db:reset` (repo root) again afterwards.

4. **Webhook forwarding** — install the [Stripe CLI](https://stripe.com/docs/stripe-cli)
   (`brew install stripe/stripe-cli/stripe`), then in a dedicated terminal:

   ```bash
   stripe login          # once
   stripe listen --forward-to localhost:3000/webhooks/stripe
   ```

   It prints `whsec_…` — put it in `apps/api/.env` and restart the API:

   ```env
   STRIPE_WEBHOOK_SECRET=whsec_…
   ```

   Keep `stripe listen` running whenever you test checkout. Its log is also your best
   debugging tool: every event and the API's HTTP response code show up there.
   Note: the `whsec_…` secret is scoped to your `stripe login` session — if you
   re-authenticate, update `.env` with the newly printed secret and restart the API.

## Happy path walkthrough

Prereqs: setup above completed, then — from the repo root — DB seeded
(`bun run db:reset` for a clean slate; **it wipes the local dev volumes**),
`bun run dev`, `stripe listen` running.

1. Log in to the seller app (<http://localhost:3002>) as **`seller@dev.bibs` /
   `password123`** — the dev seller is fully onboarded with 2 active stores, so you
   skip the onboarding stepper. (To test the *first-store* variant, register a fresh
   seller and walk the stepper instead.)
2. Go to **`/store/new`**, fill the form, submit. The app calls
   `POST /seller/stores/checkout` and redirects you to the Stripe-hosted page.
3. Pay with the standard test card: **`4242 4242 4242 4242`**, any future expiry, any
   CVC, any name/postal code.
4. You land on `/store/new/processing?session_id=cs_test_…`. The page polls every
   second (60-second timeout). Within a second or two the `checkout.session.completed`
   event arrives and the page redirects to the new store.

What to verify when something looks off:

| Checkpoint | How |
|---|---|
| Session created | API response/log; a `pending_store_creation` row with `status='open'` |
| Webhook delivered | `stripe listen` log: `checkout.session.completed → 200` |
| Event recorded | `stripe_events` row with `processedAt` set (`bun run db:studio`) |
| Store + subscription | `stores` row exists; `store_subscriptions.status='active'` |
| Pending consumed | `pending_store_creation.status='consumed'` |

## Beyond the happy path

### Cancel mid-checkout (resume)

Click the back arrow on the Stripe page. You return to `/store/new?cancel=<pendingId>`;
the app fetches `GET /seller/stores/checkout/:pendingId` and repopulates the form.
Submitting again **reuses** the open session if still valid (one open pending per
seller is enforced by a partial unique index).

### Declined cards and 3DS

| Card | Behavior |
|---|---|
| `4000 0000 0000 0002` | declined (generic) |
| `4000 0025 0000 3155` | requires 3DS authentication |
| `4000 0000 0000 9995` | declined (insufficient funds) |

Full list: <https://stripe.com/docs/testing>.

### Failed renewal → dunning → suspension

Real renewals are monthly, so you simulate. Two honest options:

- **`stripe trigger invoice.payment_failed`** exercises your webhook plumbing
  end-to-end, **but** the synthetic event references a fixture subscription, not one of
  yours — the handler will no-op on the unknown subscription id. Good for testing
  signature/idempotency wiring, useless for state transitions.
- **Seeded states** (next section) are the practical way to get every billing state in
  the UI without Stripe at all.

To watch a real transition, use the [Customer Portal](#customer-portal): cancel or
update the payment method there and watch `customer.subscription.updated` arrive.

### Customer Portal

The seller billing page (`/billing` in the seller app) shows the monthly total, the
per-store subscription list (with `past_due` / `canceling` / `suspended` banners),
lazy-loaded invoices, and a manage-payments button (Italian UI: "Gestisci pagamenti
su Stripe" — label may drift) → `POST /seller/billing/portal` → Stripe-hosted portal
(update card, view invoice PDFs, cancel).

### Voluntary cancellation

Cancel from the store page (`/store` in the seller app — the danger-zone section at
the bottom; Italian UI: "Zona di pericolo").
The dialog calls `DELETE /seller/stores/:storeId`. For `active` or `past_due`
subscriptions this sets `cancel_at_period_end` → status `canceling` (reversible via
`POST /seller/stores/:storeId/reactivate` before period end). For `suspended`
subscriptions the cancel is immediate. At period end Stripe fires
`customer.subscription.deleted` → status `canceled`, store soft-deleted (archived,
read-only).

## Seed-provided states (no Stripe needed)

`bun run db:seed` creates subscriptions in a realistic mix — work on billing UI without
configuring Stripe at all:

| Seeded state | Count | Use it to see |
|---|---|---|
| `active` | most stores | the normal case |
| `past_due` | 3 | renewal-failed banner + dunning copy |
| `canceling` | 2 | "deactivates on <date>" + undo |
| `suspended` | 1 | blocking banner, recoverable via portal |
| `canceled` | 1 | archived store (soft-deleted) |

(Counts mirror `apps/api/src/db/seed/fixtures/billing-subscriptions.ts` — check there
if they drift. Seeded rows carry fake `sub_seed_…` Stripe ids; portal/invoice calls against them will
404 on Stripe — expected.)

## Automated tests

Integration tests cover checkout-session creation and every webhook handler with the
**Stripe SDK fully mocked** (`mock.module("@/lib/stripe", …)`) and a **real Postgres**
via testcontainers:

```bash
cd apps/api
bun test tests/integration/stripe-webhook-scaffold.test.ts        # signature + idempotency wiring
bun test tests/integration/seller-stores-checkout.test.ts
bun test tests/integration/stripe-webhook-checkout-completed.test.ts
bun test tests/integration/stripe-webhook-subscription-lifecycle.test.ts
bun test tests/integration/stripe-webhook-invoice.test.ts
```

The mock does not exercise real signature verification — that's what `stripe listen`
in dev is for.

## What does NOT exist (yet)

Be explicit about this in reviews and planning:

- **Customer order payment.** `pay_pickup` / `pay_deliver` exist in the order state
  machine, and a `payment_methods` table exists, but **no Stripe flow runs for customer
  orders** — no PaymentIntent, no Connect. Documenting or testing "customer checkout
  via Stripe" is not possible today.
- **SDI e-invoicing** (fattura elettronica) — MVP relies on Stripe-hosted receipts.
- **Refunds / disputes** — webhook events are ignored; manual via Stripe dashboard.
- **Multi-currency** — schema carries `currency` but everything is EUR.
- **Plan tiers / upgrades** — one flat fee; no plan changes.
- **Reactivation** — a `canceled` store stays archived; create a new store instead.

Rationale and full design: [billing spec](superpowers/specs/2026-05-26-seller-store-subscription-billing-design.md).

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| Processing page spins forever | Webhook never arrived. Is `stripe listen` running? Is `STRIPE_WEBHOOK_SECRET` the one it printed (it changes per `stripe login`)? Restart the API after editing `.env`. |
| `400` signature verification failed | Body was re-serialized or the secret is stale. The route reads the **raw** body and uses `constructEventAsync` (Bun's SubtleCrypto has no sync mode) — don't add body-parsing middleware in front of `/webhooks/stripe`. |
| Checkout creation fails about price | `STRIPE_DEV_PRICE_ID` missing/wrong, or seed ran without it → `pricing_config` has no usable price. Run `stripe:bootstrap`, set the env var, `bun run db:reset`. |
| Checkout session creation errors (500) | `STRIPE_SECRET_KEY` is wrong — verify it's a test-mode **secret** key (`sk_test_…`), not a publishable (`pk_…`) or live key. |
| Webhook 200 but nothing changed | Replay of an already-processed event (`stripe_events` dedup) or an event for an unknown subscription (e.g. `stripe trigger` fixtures, seeded `sub_seed_…` ids). Both are by design. |
| Pending expired | `pending_store_creation` expires after `pricing_config.pendingCreationExpiryHours` (default 24 h). Submit the form again — a fresh pending+session is created. |
