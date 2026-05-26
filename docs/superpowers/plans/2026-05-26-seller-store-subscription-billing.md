# Seller store subscription billing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementare il sistema di sottoscrizione mensile per-negozio (pay-to-create) descritto in [`docs/superpowers/specs/2026-05-26-seller-store-subscription-billing-design.md`](../specs/2026-05-26-seller-store-subscription-billing-design.md).

**Architecture:** Una subscription Stripe per ogni negozio, Stripe Checkout hosted per il primo addebito, Customer Portal Stripe per il self-service, webhook handler idempotente con dedupe via `stripe_events`. Onboarding del seller ridotto a `pending_email → pending_personal → pending_document → pending_company → pending_review → active`; aggiunta del primo negozio è task post-attivazione, identica alle aggiunte successive. Stati del negozio derivati da `store_subscriptions.status` (active/past_due/canceling/suspended/canceled), con `store.deletedAt` impostato solo all'archivio finale.

**Tech Stack:** Bun + Elysia + Drizzle ORM + PostgreSQL + Stripe Node SDK (test mode in dev). Frontend: TanStack Start + Eden Treaty + TanStack Query + shadcn UI. Test: `bun test` + `testcontainers` per integration. Cron: `@elysiajs/cron` (già installato).

**Open question chiusa:** Job runner = `@elysiajs/cron` plugin (già in `apps/api/package.json`). Vivere col vincolo: cron muore al restart del processo, accettabile in dev e per un singolo container API in prod.

---

## File structure overview

### Nuovi file backend (`apps/api/src/`)

| File | Responsabilità |
|---|---|
| `lib/stripe.ts` | Wrapper SDK Stripe (singleton client, helper di firma webhook, `getOrCreateStripeCustomer`) |
| `db/schemas/store-subscription.ts` | Schema Drizzle + relations |
| `db/schemas/pending-store-creation.ts` | Schema Drizzle + relations |
| `db/schemas/stripe-event.ts` | Schema Drizzle (idempotenza webhook) |
| `db/schemas/pricing-config.ts` | Schema Drizzle (history table) |
| `lib/schemas/entities/store-subscription.ts` | TypeBox schema per Eden Treaty |
| `lib/schemas/entities/pricing-config.ts` | TypeBox schema per Eden Treaty |
| `modules/webhooks/index.ts` + `routes/stripe.ts` + `services/handlers.ts` | Webhook handlers Stripe |
| `modules/billing/services/pricing.ts` | Lettura config + utility prezzo corrente |
| `modules/billing/services/customer.ts` | `getOrCreateStripeCustomer(sellerProfileId)` |
| `modules/billing/services/portal.ts` | Crea Customer Portal session |
| `modules/seller/routes/billing.ts` + `services/billing.ts` | Endpoint `/seller/billing/*` |
| `modules/seller/routes/checkout.ts` + `services/checkout.ts` | Endpoint `/seller/stores/checkout` + status |
| `modules/admin/routes/billing.ts` + `services/billing.ts` | Endpoint `/admin/billing/*` |
| `jobs/auto-cancel-suspended-stores.ts` | Cron quotidiano |
| `jobs/expire-pending-store-creations.ts` | Cron orario |
| `scripts/stripe-bootstrap.ts` | One-time bootstrap: crea Stripe Product + Price |

### File backend modificati

| File | Modifica |
|---|---|
| `apps/api/package.json` | Aggiungi `stripe` |
| `apps/api/src/lib/env.ts` | Aggiungi `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_DEV_PRICE_ID` (in dev), `SELLER_APP_URL` |
| `apps/api/src/db/schemas/seller.ts` | Riduci enum onboarding + aggiungi `stripeCustomerId` |
| `apps/api/src/db/schemas/index.ts` | Re-export nuovi schemi |
| `apps/api/src/modules/seller/services/onboarding.ts` | Rimuovi step morti, mappa transizioni ridotta |
| `apps/api/src/modules/seller/routes/onboarding.ts` | Rimuovi endpoint morti |
| `apps/api/src/modules/seller/routes/stores.ts` + `services/stores.ts` | Branched cancel; reactivate; `POST /stores` admin-only |
| `apps/api/src/index.ts` | Monta nuovi route + cron plugin |
| `apps/api/src/db/seed/fixtures/sellers.ts` | Rimuovi stati morti, no more stripeAccountId in payment_method seeding |

### Nuovi file frontend seller (`apps/seller/src/`)

| File | Responsabilità |
|---|---|
| `routes/_authenticated/billing.tsx` | Vista billing seller |
| `routes/_authenticated/store/new.processing.tsx` | Polling post-checkout |
| `routes/_authenticated/store/archived.tsx` | Lista negozi archiviati |
| `components/store-billing-banner.tsx` | Banner past_due/canceling/suspended |
| `features/billing/components/cancel-store-dialog.tsx` | Confirm dialog branched |
| `features/billing/components/reactivate-button.tsx` | CTA Customer Portal per suspended |

### File frontend modificati

| File | Modifica |
|---|---|
| `apps/seller/src/routes/_authenticated/store/new.tsx` | Submit chiama `/stores/checkout` + redirect |
| `apps/seller/src/routes/_authenticated.tsx` | Monta `<StoreBillingBanner />` |
| `apps/seller/src/routes/_authenticated/store.tsx` | "Zona di pericolo" con cancel + reactivate |
| `apps/seller/src/components/app-sidebar.tsx` | Link "Billing" + badge stato |
| `apps/seller/src/hooks/use-onboarding.ts` | Rimuovi mutation morte |
| File eliminati: `routes/_authenticated/onboarding/{store,team,payment}.tsx` | — |

### Frontend admin (`apps/admin/src/`)

| File | Responsabilità |
|---|---|
| `routes/_authenticated/billing.tsx` (rinomina `payments.tsx`) | Container con tab |
| `routes/_authenticated/billing/overview.tsx` | MRR + counts |
| `routes/_authenticated/billing/pricing.tsx` | Config CRUD |
| `routes/_authenticated/billing/subscriptions.tsx` | Lista globale |

### Stringhe Paraglide

- `apps/seller/messages/{it,en}.json` — banner, dialog, errori, processing
- `apps/admin/messages/{it,en}.json` — billing dashboard

---

## Pre-flight: configurazione Stripe (operativo, eseguito una volta)

Prima di iniziare il Task 1, l'operatore deve:

1. **Creare account Stripe test mode** su <https://stripe.com>. Solo email + password, niente verifica business.
2. **Copiare le chiavi test** da Stripe Dashboard → Developers → API keys:
   - `STRIPE_SECRET_KEY` (formato `sk_test_...`)
3. **Installare Stripe CLI**: `brew install stripe/stripe-cli/stripe` poi `stripe login`.
4. **Configurare locale email italiano**: Stripe Dashboard → Settings → Customer emails → Locale: `Italian`.
5. **Configurare Smart Retries**: Stripe Dashboard → Settings → Subscriptions and emails → Smart Retries: 4 tentativi, distribuzione 1°/3°/5°/7° giorno, azione finale `Mark as unpaid`.
6. **Configurare Customer Portal**: Stripe Dashboard → Settings → Billing → Customer portal:
   - ✅ Update payment method
   - ✅ View invoice history + download PDF
   - ❌ Cancel subscription
   - ❌ Update billing details
   - ❌ Change quantity/plan
   - Default return URL: `http://localhost:3002/billing` (dev) / `https://<seller-host>/billing` (prod)

`STRIPE_WEBHOOK_SECRET` e `STRIPE_DEV_PRICE_ID` arrivano dai Task 1 e Task 3.

---

## Task 1: Stripe SDK + lib/stripe.ts + env

**Files:**
- Modify: `apps/api/package.json`
- Modify: `package.json` (root catalog)
- Modify: `apps/api/src/lib/env.ts`
- Create: `apps/api/src/lib/stripe.ts`
- Test: `apps/api/tests/unit/stripe.test.ts`

- [ ] **Step 1: Aggiungi `stripe` al catalog root**

In `package.json` root, dentro `"catalog"`, aggiungi una entry:

```json
"stripe": "^19.4.0",
```

(versione recente al 2026-05; `bun add` userà la versione catalog).

- [ ] **Step 2: Aggiungi dipendenza in apps/api**

In `apps/api/package.json`, dentro `"dependencies"`:

```json
"stripe": "catalog:",
```

Poi installa:

```bash
bun install
```

Verifica che `bun.lock` sia aggiornato (NON editarlo a mano — memoria deny-list).

- [ ] **Step 3: Aggiungi variabili env in `apps/api/src/lib/env.ts`**

Trova lo schema `t3-oss/env-core` esistente e aggiungi:

```ts
STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
STRIPE_DEV_PRICE_ID: z.string().startsWith("price_").optional(),
SELLER_APP_URL: z.string().url(),
```

`STRIPE_WEBHOOK_SECRET` e `STRIPE_DEV_PRICE_ID` sono optional perché in CI/test mockiamo Stripe.

Aggiungi le stesse chiavi (con placeholder) in `apps/api/.env.example`.

- [ ] **Step 4: Scrivi il test fallente per il wrapper Stripe**

Crea `apps/api/tests/unit/stripe.test.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";

mock.module("@/lib/env", () => ({
  env: {
    STRIPE_SECRET_KEY: "sk_test_FAKE",
    STRIPE_WEBHOOK_SECRET: "whsec_FAKE",
    STRIPE_DEV_PRICE_ID: "price_FAKE",
    SELLER_APP_URL: "http://localhost:3002",
  },
}));

import { stripe } from "@/lib/stripe";

describe("stripe wrapper", () => {
  it("exposes a Stripe SDK instance with the configured secret key", () => {
    expect(stripe).toBeDefined();
    expect(stripe.subscriptions).toBeDefined();
    expect(stripe.checkout.sessions).toBeDefined();
  });
});
```

- [ ] **Step 5: Run test (deve fallire)**

```bash
cd apps/api && bun test tests/unit/stripe.test.ts
```

Expected: FAIL con `Cannot find module '@/lib/stripe'`.

- [ ] **Step 6: Crea `apps/api/src/lib/stripe.ts`**

```ts
import Stripe from "stripe";
import { env } from "@/lib/env";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-12-18.acacia",
  typescript: true,
  appInfo: {
    name: "bibs",
    url: "https://bibs.app",
  },
});
```

Se la `apiVersion` segnala un warning TS, aggiorna alla più recente che il SDK 19.x supporta nella tua versione installata (vedi `node_modules/stripe/types/Stripe.d.ts`).

- [ ] **Step 7: Run test (deve passare)**

```bash
cd apps/api && bun test tests/unit/stripe.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json package.json bun.lock apps/api/src/lib/env.ts apps/api/.env.example apps/api/src/lib/stripe.ts apps/api/tests/unit/stripe.test.ts
git commit -m "feat(billing): add stripe sdk + lib wrapper + env vars"
```

---

## Task 2: pricing_config schema + migration

**Files:**
- Create: `apps/api/src/db/schemas/pricing-config.ts`
- Modify: `apps/api/src/db/schemas/index.ts`
- Test: `apps/api/tests/unit/pricing-config-schema.test.ts`
- Migration: generated

- [ ] **Step 1: Scrivi il test fallente per lo schema**

Crea `apps/api/tests/unit/pricing-config-schema.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { pricingConfig } from "@/db/schemas/pricing-config";

describe("pricingConfig schema", () => {
  it("has expected columns", () => {
    const cols = Object.keys(pricingConfig);
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "storeMonthlyFeeCents",
        "currency",
        "stripePriceId",
        "suspendedAutoCancelDays",
        "pendingCreationExpiryHours",
        "isActive",
        "createdAt",
        "createdByUserId",
      ]),
    );
  });
});
```

- [ ] **Step 2: Run test (deve fallire)**

```bash
cd apps/api && bun test tests/unit/pricing-config-schema.test.ts
```

Expected: FAIL `Cannot find module '@/db/schemas/pricing-config'`.

- [ ] **Step 3: Crea lo schema**

`apps/api/src/db/schemas/pricing-config.ts`:

```ts
import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const pricingConfig = pgTable(
  "pricing_config",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    storeMonthlyFeeCents: integer("store_monthly_fee_cents").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
    stripePriceId: text("stripe_price_id").notNull(),
    suspendedAutoCancelDays: integer("suspended_auto_cancel_days")
      .notNull()
      .default(60),
    pendingCreationExpiryHours: integer("pending_creation_expiry_hours")
      .notNull()
      .default(24),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("pricing_config_single_active_idx")
      .on(t.isActive)
      .where(sql`${t.isActive} = true`),
  ],
);
```

- [ ] **Step 4: Re-export in `apps/api/src/db/schemas/index.ts`**

Aggiungi:

```ts
export * from "./pricing-config";
```

- [ ] **Step 5: Run test (deve passare)**

```bash
cd apps/api && bun test tests/unit/pricing-config-schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Genera migration**

```bash
bun run db:generate
```

Apri la migration generata in `apps/api/src/db/migrations/` e verifica che:
- Crea tabella `pricing_config` con tutte le colonne
- Crea l'indice parziale `pricing_config_single_active_idx WHERE is_active = true`

- [ ] **Step 7: Applica migration**

```bash
bun run db:migrate
```

Expected: nessun errore. Verifica con `bun run db:studio` o `psql` che la tabella esista.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/db/schemas/pricing-config.ts apps/api/src/db/schemas/index.ts apps/api/src/db/migrations/ apps/api/tests/unit/pricing-config-schema.test.ts
git commit -m "feat(billing): pricing_config schema + migration"
```

---

## Task 3: stripe-bootstrap script + seed pricing_config

**Files:**
- Create: `apps/api/src/scripts/stripe-bootstrap.ts`
- Modify: `apps/api/package.json` (script entry)
- Modify: `apps/api/src/db/seed/index.ts` (or wherever seed orchestration lives — verify path)

- [ ] **Step 1: Crea lo script bootstrap**

`apps/api/src/scripts/stripe-bootstrap.ts`:

```ts
#!/usr/bin/env bun
/**
 * One-time Stripe bootstrap: creates a recurring Product+Price in test mode
 * and prints the IDs to copy into .env.local (STRIPE_DEV_PRICE_ID).
 *
 * Idempotent: searches by metadata.bibs_role='store_monthly_fee' before creating.
 */
import Stripe from "stripe";

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) {
  console.error("ERROR: STRIPE_SECRET_KEY not set in env");
  process.exit(1);
}

const stripe = new Stripe(secret, { apiVersion: "2024-12-18.acacia" });

const PRODUCT_METADATA_KEY = "bibs_role";
const PRODUCT_METADATA_VALUE = "store_monthly_fee";
const DEFAULT_FEE_CENTS = 2900; // €29
const CURRENCY = "eur";

async function findExistingProduct() {
  const products = await stripe.products.search({
    query: `metadata['${PRODUCT_METADATA_KEY}']:'${PRODUCT_METADATA_VALUE}'`,
  });
  return products.data[0] ?? null;
}

async function findActivePrice(productId: string) {
  const prices = await stripe.prices.list({
    product: productId,
    active: true,
    limit: 1,
  });
  return prices.data[0] ?? null;
}

async function main() {
  let product = await findExistingProduct();
  if (!product) {
    product = await stripe.products.create({
      name: "bibs - Quota mensile per negozio",
      description: "Abbonamento mensile per ogni punto vendita gestito su bibs",
      metadata: { [PRODUCT_METADATA_KEY]: PRODUCT_METADATA_VALUE },
    });
    console.log(`Created Product: ${product.id}`);
  } else {
    console.log(`Found existing Product: ${product.id}`);
  }

  let price = await findActivePrice(product.id);
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: DEFAULT_FEE_CENTS,
      currency: CURRENCY,
      recurring: { interval: "month" },
    });
    console.log(`Created Price: ${price.id} (${DEFAULT_FEE_CENTS / 100} EUR/mo)`);
  } else {
    console.log(`Found existing active Price: ${price.id}`);
  }

  console.log("");
  console.log("Add to apps/api/.env.local:");
  console.log(`STRIPE_DEV_PRICE_ID=${price.id}`);
  console.log("");
  console.log(`Default fee (cents): ${DEFAULT_FEE_CENTS}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Aggiungi script in `apps/api/package.json`**

In `scripts`:

```json
"stripe:bootstrap": "bun run src/scripts/stripe-bootstrap.ts"
```

- [ ] **Step 3: Run lo script una volta**

Assicurati che `apps/api/.env.local` abbia `STRIPE_SECRET_KEY=sk_test_...` (dal Pre-flight).

```bash
cd apps/api && bun run stripe:bootstrap
```

Expected output: due ID (Product + Price) e l'istruzione di salvare `STRIPE_DEV_PRICE_ID=price_xxx` in `.env.local`.

Aggiungi quella riga al `.env.local` (mai committarla — è già nella deny-list).

- [ ] **Step 4: Seed iniziale `pricing_config`**

Identifica dove vive l'orchestrazione seed (probabilmente `apps/api/src/db/seed/index.ts` o `apps/api/src/scripts/seed.ts`). Aggiungi un fixture che, se la tabella è vuota e `STRIPE_DEV_PRICE_ID` è presente in env, inserisce la prima riga:

`apps/api/src/db/seed/fixtures/pricing-config.ts` (nuovo):

```ts
import { db } from "@/db";
import { pricingConfig } from "@/db/schemas/pricing-config";
import { env } from "@/lib/env";

export async function seedPricingConfig() {
  const existing = await db.query.pricingConfig.findFirst();
  if (existing) {
    console.log("[seed] pricing_config already exists, skipping");
    return;
  }

  if (!env.STRIPE_DEV_PRICE_ID) {
    console.warn(
      "[seed] STRIPE_DEV_PRICE_ID not set, skipping pricing_config seed. Run `bun run stripe:bootstrap` first.",
    );
    return;
  }

  await db.insert(pricingConfig).values({
    storeMonthlyFeeCents: 2900,
    currency: "EUR",
    stripePriceId: env.STRIPE_DEV_PRICE_ID,
    suspendedAutoCancelDays: 60,
    pendingCreationExpiryHours: 24,
    isActive: true,
  });
  console.log("[seed] pricing_config seeded");
}
```

Invoca `seedPricingConfig()` dal seed entry point (es. `apps/api/src/scripts/seed.ts`) come primo step.

- [ ] **Step 5: Verifica seed**

```bash
bun run db:seed
```

Expected: log `[seed] pricing_config seeded`.

Verifica con `bun run db:studio` o:

```bash
psql -h localhost -U postgres bibs -c "SELECT store_monthly_fee_cents, stripe_price_id, is_active FROM pricing_config;"
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/scripts/stripe-bootstrap.ts apps/api/package.json apps/api/src/db/seed/fixtures/pricing-config.ts apps/api/src/scripts/seed.ts
git commit -m "feat(billing): stripe bootstrap script + pricing_config seed"
```

---

## Task 4: store_subscriptions schema + migration

**Files:**
- Create: `apps/api/src/db/schemas/store-subscription.ts`
- Modify: `apps/api/src/db/schemas/index.ts`
- Modify: `apps/api/src/db/schemas/store.ts` (relations)
- Test: `apps/api/tests/unit/store-subscription-schema.test.ts`

- [ ] **Step 1: Scrivi il test fallente**

`apps/api/tests/unit/store-subscription-schema.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  storeSubscription,
  storeSubscriptionStatuses,
} from "@/db/schemas/store-subscription";

describe("storeSubscription schema", () => {
  it("declares the 5 lifecycle statuses", () => {
    expect(storeSubscriptionStatuses).toEqual([
      "active",
      "past_due",
      "canceling",
      "suspended",
      "canceled",
    ]);
  });

  it("has expected columns", () => {
    const cols = Object.keys(storeSubscription);
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "storeId",
        "stripeSubscriptionId",
        "stripeCustomerId",
        "stripePriceId",
        "feeAmountCents",
        "currency",
        "status",
        "currentPeriodEnd",
        "cancelAtPeriodEnd",
        "cancelReason",
        "suspendedAt",
        "canceledAt",
      ]),
    );
  });
});
```

- [ ] **Step 2: Run test (deve fallire)**

```bash
cd apps/api && bun test tests/unit/store-subscription-schema.test.ts
```

Expected: FAIL `Cannot find module '@/db/schemas/store-subscription'`.

- [ ] **Step 3: Crea lo schema**

`apps/api/src/db/schemas/store-subscription.ts`:

```ts
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { store } from "./store";

export const storeSubscriptionStatuses = [
  "active",
  "past_due",
  "canceling",
  "suspended",
  "canceled",
] as const;
export type StoreSubscriptionStatus = (typeof storeSubscriptionStatuses)[number];

export const storeSubscription = pgTable(
  "store_subscriptions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    storeId: text("store_id")
      .notNull()
      .unique()
      .references(() => store.id, { onDelete: "restrict" }),
    stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripePriceId: text("stripe_price_id").notNull(),
    feeAmountCents: integer("fee_amount_cents").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
    status: varchar("status", { enum: storeSubscriptionStatuses }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", {
      withTimezone: true,
    }).notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end")
      .notNull()
      .default(false),
    cancelReason: text("cancel_reason"),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("store_subscription_status_idx").on(t.status),
    index("store_subscription_period_end_idx").on(t.currentPeriodEnd),
    index("store_subscription_suspended_idx")
      .on(t.suspendedAt)
      .where(sql`${t.status} = 'suspended'`),
  ],
);

export const storeSubscriptionRelations = relations(
  storeSubscription,
  ({ one }) => ({
    store: one(store, {
      fields: [storeSubscription.storeId],
      references: [store.id],
    }),
  }),
);
```

- [ ] **Step 4: Aggiungi relation inversa su `store`**

Modifica `apps/api/src/db/schemas/store.ts`. Trova `storeRelations` e aggiungi `subscription`:

```ts
import { storeSubscription } from "./store-subscription";

export const storeRelations = relations(store, ({ one, many }) => ({
  // ... existing relations
  subscription: one(storeSubscription, {
    fields: [store.id],
    references: [storeSubscription.storeId],
  }),
}));
```

- [ ] **Step 5: Re-export in `apps/api/src/db/schemas/index.ts`**

```ts
export * from "./store-subscription";
```

- [ ] **Step 6: Run test (deve passare)**

```bash
cd apps/api && bun test tests/unit/store-subscription-schema.test.ts
```

Expected: PASS.

- [ ] **Step 7: Genera + applica migration**

```bash
bun run db:generate
```

Apri la migration generata e verifica: `CREATE TABLE store_subscriptions`, 3 indici, FK `store_id` con `ON DELETE RESTRICT`, CHECK constraint sul `status` enum.

```bash
bun run db:migrate
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/db/schemas/store-subscription.ts apps/api/src/db/schemas/store.ts apps/api/src/db/schemas/index.ts apps/api/src/db/migrations/ apps/api/tests/unit/store-subscription-schema.test.ts
git commit -m "feat(billing): store_subscriptions schema + migration"
```

---

## Task 5: pending_store_creations schema + migration

**Files:**
- Create: `apps/api/src/db/schemas/pending-store-creation.ts`
- Modify: `apps/api/src/db/schemas/index.ts`
- Test: `apps/api/tests/unit/pending-store-creation-schema.test.ts`

- [ ] **Step 1: Scrivi il test fallente**

`apps/api/tests/unit/pending-store-creation-schema.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  pendingStoreCreation,
  pendingStoreCreationStatuses,
} from "@/db/schemas/pending-store-creation";

describe("pendingStoreCreation schema", () => {
  it("declares the 4 lifecycle statuses", () => {
    expect(pendingStoreCreationStatuses).toEqual([
      "open",
      "consumed",
      "expired",
      "canceled",
    ]);
  });

  it("has expected columns", () => {
    const cols = Object.keys(pendingStoreCreation);
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "sellerProfileId",
        "formData",
        "stripeCheckoutSessionId",
        "stripeSubscriptionId",
        "feeAmountCents",
        "currency",
        "status",
        "expiresAt",
        "consumedAt",
        "createdAt",
      ]),
    );
  });
});
```

- [ ] **Step 2: Run test (deve fallire)**

```bash
cd apps/api && bun test tests/unit/pending-store-creation-schema.test.ts
```

Expected: FAIL `Cannot find module`.

- [ ] **Step 3: Crea lo schema**

`apps/api/src/db/schemas/pending-store-creation.ts`:

```ts
import { relations, sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { sellerProfile } from "./seller";

export const pendingStoreCreationStatuses = [
  "open",
  "consumed",
  "expired",
  "canceled",
] as const;
export type PendingStoreCreationStatus =
  (typeof pendingStoreCreationStatuses)[number];

export const pendingStoreCreation = pgTable(
  "pending_store_creations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sellerProfileId: text("seller_profile_id")
      .notNull()
      .references(() => sellerProfile.id, { onDelete: "cascade" }),
    formData: jsonb("form_data").notNull(),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
    stripeSubscriptionId: text("stripe_subscription_id"),
    feeAmountCents: integer("fee_amount_cents").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
    status: varchar("status", { enum: pendingStoreCreationStatuses })
      .notNull()
      .default("open"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("pending_store_creation_one_open_idx")
      .on(t.sellerProfileId)
      .where(sql`${t.status} = 'open'`),
  ],
);

export const pendingStoreCreationRelations = relations(
  pendingStoreCreation,
  ({ one }) => ({
    sellerProfile: one(sellerProfile, {
      fields: [pendingStoreCreation.sellerProfileId],
      references: [sellerProfile.id],
    }),
  }),
);
```

- [ ] **Step 4: Re-export in `apps/api/src/db/schemas/index.ts`**

```ts
export * from "./pending-store-creation";
```

- [ ] **Step 5: Run test (deve passare)**

```bash
cd apps/api && bun test tests/unit/pending-store-creation-schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Genera + applica migration**

```bash
bun run db:generate
bun run db:migrate
```

Verifica: tabella + indice parziale unique `WHERE status='open'`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/schemas/pending-store-creation.ts apps/api/src/db/schemas/index.ts apps/api/src/db/migrations/ apps/api/tests/unit/pending-store-creation-schema.test.ts
git commit -m "feat(billing): pending_store_creations schema + migration"
```

---

## Task 6: stripe_events schema + migration

**Files:**
- Create: `apps/api/src/db/schemas/stripe-event.ts`
- Modify: `apps/api/src/db/schemas/index.ts`
- Test: `apps/api/tests/unit/stripe-event-schema.test.ts`

- [ ] **Step 1: Test fallente**

`apps/api/tests/unit/stripe-event-schema.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { stripeEvent } from "@/db/schemas/stripe-event";

describe("stripeEvent schema", () => {
  it("has expected columns", () => {
    const cols = Object.keys(stripeEvent);
    expect(cols).toEqual(
      expect.arrayContaining([
        "eventId",
        "eventType",
        "receivedAt",
        "processedAt",
      ]),
    );
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
cd apps/api && bun test tests/unit/stripe-event-schema.test.ts
```

- [ ] **Step 3: Crea lo schema**

`apps/api/src/db/schemas/stripe-event.ts`:

```ts
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const stripeEvent = pgTable("stripe_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});
```

- [ ] **Step 4: Re-export**

`apps/api/src/db/schemas/index.ts`:

```ts
export * from "./stripe-event";
```

- [ ] **Step 5: Run test (PASS)**

- [ ] **Step 6: Genera + applica migration**

```bash
bun run db:generate
bun run db:migrate
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/schemas/stripe-event.ts apps/api/src/db/schemas/index.ts apps/api/src/db/migrations/ apps/api/tests/unit/stripe-event-schema.test.ts
git commit -m "feat(billing): stripe_events idempotency table + migration"
```

---

## Task 7: seller_profiles.stripeCustomerId + onboarding enum reduction + migration

**Files:**
- Modify: `apps/api/src/db/schemas/seller.ts`
- Modify: `apps/api/src/db/seed/fixtures/sellers.ts` (rimuove stati morti)
- Test: `apps/api/tests/unit/seller-schema-updated.test.ts`

- [ ] **Step 1: Test fallente per gli stati ridotti**

`apps/api/tests/unit/seller-schema-updated.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { onboardingStatuses, sellerProfile } from "@/db/schemas/seller";

describe("sellerProfile schema (post-billing rework)", () => {
  it("onboardingStatuses array contains 7 statuses (no pending_store/team/payment)", () => {
    expect(onboardingStatuses).toEqual([
      "pending_email",
      "pending_personal",
      "pending_document",
      "pending_company",
      "pending_review",
      "active",
      "rejected",
    ]);
  });

  it("declares stripeCustomerId column", () => {
    expect(Object.keys(sellerProfile)).toContain("stripeCustomerId");
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
cd apps/api && bun test tests/unit/seller-schema-updated.test.ts
```

Expected: FAIL — l'array attuale contiene 10 stati.

- [ ] **Step 3: Modifica `apps/api/src/db/schemas/seller.ts`**

Sostituisci l'array `onboardingStatuses` con la versione ridotta:

```ts
export const onboardingStatuses = [
  "pending_email",
  "pending_personal",
  "pending_document",
  "pending_company",
  "pending_review",
  "active",
  "rejected",
] as const;
```

Aggiungi la colonna `stripeCustomerId` nella table definition (subito dopo `vatChangeBlocked`):

```ts
stripeCustomerId: text("stripe_customer_id").unique(),
```

- [ ] **Step 4: Run test (PASS)**

- [ ] **Step 5: Verifica i call site degli stati rimossi**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && grep -rn "pending_store\|pending_team\|pending_payment" apps/api/src --include="*.ts" 2>/dev/null | grep -v "payment-method\|payment-methods\|payment_methods"
```

Per ogni risultato dovrai gestirlo nei task successivi (Task 8 ripulisce service/route, Task 9 ripulisce frontend). Per ora, lascia i call site come sono — il typecheck fallirà nei task successivi e li sistemiamo allora.

- [ ] **Step 6: Pulisci seed fixtures**

Modifica `apps/api/src/db/seed/fixtures/sellers.ts`. Rimuovi tutte le occorrenze di `"pending_store"`, `"pending_team"`, `"pending_payment"` (sono almeno in `onboardingStatuses` filter, in `vatStatus` mapping, e in count distribution attorno alla riga 158). Se non sai cosa metterci in sostituzione, segui questa regola: i count che erano destinati a quegli stati morti vanno tutti aggiunti a `pending_review` (così manteniamo invariato il totale di sellers seeded).

Verifica con un dry-run del typecheck:

```bash
bun run --filter @bibs/api typecheck
```

Se il typecheck si lamenta solo nei file che ripuliremo nei Task 8-9 (es. `services/onboarding.ts`, `routes/onboarding.ts`), va bene: continuiamo.

- [ ] **Step 7: Genera migration**

```bash
bun run db:generate
```

Apri la migration generata. Verifica:
- ALTER TABLE `seller_profiles` ADD COLUMN `stripe_customer_id` text UNIQUE.
- Drop + recreate del CHECK constraint sul `onboarding_status` con il nuovo enum ristretto.

⚠️ **Importante**: prima di applicare, aggiungi MANUALMENTE in cima alla migration generata uno statement UPDATE che riporti i seller in stati morti a `pending_review` (safety net, dovrebbe essere idempotente in dev):

```sql
UPDATE seller_profiles
SET onboarding_status = 'pending_review'
WHERE onboarding_status IN ('pending_store', 'pending_team', 'pending_payment');
```

- [ ] **Step 8: Applica migration**

```bash
bun run db:migrate
```

Expected: applicazione pulita.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/db/schemas/seller.ts apps/api/src/db/seed/fixtures/sellers.ts apps/api/src/db/migrations/ apps/api/tests/unit/seller-schema-updated.test.ts
git commit -m "feat(billing): reduce onboarding states + add seller stripeCustomerId"
```

---

## Task 8: Onboarding rework — API (services + routes)

**Files:**
- Modify: `apps/api/src/modules/seller/services/onboarding.ts`
- Modify: `apps/api/src/modules/seller/routes/onboarding.ts`
- Modify: `apps/api/src/lib/schemas/forms/onboarding.ts` (rimuovi `OnboardingStoreBody`, `TeamInviteBody`, `PaymentBody`)
- Modify: `apps/api/tests/integration/admin-sellers.test.ts` (e ogni altro test che usi stati morti)
- Test: aggiornati esistenti

- [ ] **Step 1: Trova tutti i test che useranno stati morti**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && grep -rn "pending_store\|pending_team\|pending_payment" apps/api/tests --include="*.ts"
```

Per ogni occorrenza, rimpiazza con `pending_review` (il test esprimeva l'idea di "seller in mezzo all'onboarding" → ora `pending_review` è l'ultimo stato pre-active).

- [ ] **Step 2: Aggiorna `services/onboarding.ts`**

Modifica `apps/api/src/modules/seller/services/onboarding.ts`:

a. **Riduci `PREVIOUS_STATUS`** (riga ~40):

```ts
const PREVIOUS_STATUS: Partial<Record<OnboardingStatus, OnboardingStatus>> = {
  pending_document: "pending_personal",
  pending_company: "pending_document",
  pending_review: "pending_company",
};
```

b. **Trova la mappa di transizione avanti** (probabilmente un object con `pending_company: "pending_store"`, ecc.). Sostituisci tutte le transizioni in modo che `pending_company → pending_review` e rimuovi tutte quelle intermedie.

c. **Cancella le funzioni** `createOnboardingStore`, `skipOnboardingStore`, `inviteTeamMember`, `listOnboardingInvitations`, `completeTeam`, `updatePayment`. Cancella anche tutti gli `import` non più referenziati (`employeeInvitation`, `employeeInvitationStores`, `paymentMethod`, `store`, `storeImage`, eventualmente `s3`, `publicUrl`, `OpeningHoursSchema`).

d. **In `updateCompany`**, modifica la transizione finale: dopo l'update dei dati company, set `onboardingStatus = 'pending_review'` direttamente (anziché `pending_store`).

- [ ] **Step 3: Aggiorna `routes/onboarding.ts`**

Rimuovi le seguenti route handler (delete completi):
- `POST /onboarding/store`
- `POST /onboarding/store/skip` (se esiste)
- `POST /onboarding/team/invite` (e correlati)
- `POST /onboarding/team/complete`
- `POST /onboarding/payment`

Rimuovi gli `import` di `createOnboardingStore`, `skipOnboardingStore`, `inviteTeamMember`, `listOnboardingInvitations`, `completeTeam`, `updatePayment`. Rimuovi anche `OnboardingStoreBody`, `TeamInviteBody`, `PaymentBody` se non più usati altrove.

- [ ] **Step 4: Pulisci `lib/schemas/forms/onboarding.ts`**

Apri il file e rimuovi le definizioni `OnboardingStoreBody`, `TeamInviteBody`, `PaymentBody`. Verifica che non siano esportate da `forms/index.ts`; se sì, rimuovi anche il re-export.

- [ ] **Step 5: Run typecheck**

```bash
bun run --filter @bibs/api typecheck
```

Expected: il typecheck deve passare per `apps/api`. Se si lamenta nei frontend (`apps/seller`), va bene: lo sistemiamo nel Task 9. Per gestire questo, esegui solo il filter API:

```bash
bun run --filter @bibs/api typecheck
```

Memoria [[feedback_bun_filter_exit_codes]]: controlla esplicitamente `$?` o l'output testuale per essere sicuro che zero errori.

- [ ] **Step 6: Run test API**

```bash
cd apps/api && bun test
```

Expected: tutti i test passano. Se qualche test integration si lamenta di stati morti, è perché il fixture o l'asserzione li usava — aggiorna a `pending_review`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/seller/services/onboarding.ts apps/api/src/modules/seller/routes/onboarding.ts apps/api/src/lib/schemas/forms/onboarding.ts apps/api/src/lib/schemas/forms/index.ts apps/api/tests/
git commit -m "refactor(seller): collapse onboarding to pending_review after company step"
```

---

## Task 9: Onboarding rework — seller frontend cleanup

**Files:**
- Delete: `apps/seller/src/routes/_authenticated/onboarding/store.tsx`
- Delete: `apps/seller/src/routes/_authenticated/onboarding/team.tsx`
- Delete: `apps/seller/src/routes/_authenticated/onboarding/payment.tsx`
- Modify: `apps/seller/src/hooks/use-onboarding.ts`
- Modify: `apps/seller/src/routes/_authenticated/onboarding/company.tsx` (next step diventa `/onboarding/pending`)
- Modify: `apps/seller/src/features/onboarding/components/onboarding-layout.tsx` (se usa stati morti)
- Modify: `apps/seller/src/routes/_authenticated.tsx` (se redirige a stati morti)

- [ ] **Step 1: Inventario chiamate ai mutation morti**

```bash
cd /Users/marcogelli/repos/jelaz/bibs/apps/seller && grep -rn "useUpdateStore\|useUpdateTeam\|useUpdatePayment\|useCreateOnboardingStore\|onboarding/store\|onboarding/team\|onboarding/payment" src --include="*.tsx" --include="*.ts"
```

Mappa esattamente quali file usano questi simboli.

- [ ] **Step 2: Elimina le tre route file**

```bash
rm apps/seller/src/routes/_authenticated/onboarding/store.tsx
rm apps/seller/src/routes/_authenticated/onboarding/team.tsx
rm apps/seller/src/routes/_authenticated/onboarding/payment.tsx
```

TanStack Router rigenererà `routeTree.gen.ts` al prossimo run del dev server. Se vuoi forzarlo subito:

```bash
cd apps/seller && bun run dev &
sleep 4
kill %1
```

(o lascia che si rigeneri al test finale del task.)

- [ ] **Step 3: Pulisci `use-onboarding.ts`**

Apri `apps/seller/src/hooks/use-onboarding.ts`. Rimuovi:
- `useUpdateStore`
- `useUpdateTeam`
- `useUpdatePayment`
- `useCreateOnboardingInvite` / `useListInvites` (se esistono)

Conserva: `useOnboardingStatus`, `useUpdatePersonalInfo`, `useUpdateDocument`, `useUpdateCompany`, `useGoBack`.

- [ ] **Step 4: Aggiorna `company.tsx` next-step**

Apri `apps/seller/src/routes/_authenticated/onboarding/company.tsx`. Dopo il submit della mutation, oggi naviga a `/onboarding/store`. Cambia in:

```ts
void navigate({ to: "/onboarding/pending" });
```

- [ ] **Step 5: Aggiorna `onboarding-layout.tsx`**

Apri `apps/seller/src/features/onboarding/components/onboarding-layout.tsx` (o equivalente). Cerca la lista degli step renderizzati (probabilmente un array di `{status, label, route}`). Rimuovi le entry per `pending_store`, `pending_team`, `pending_payment`. Lascia: personal → document → company → review (= "In revisione").

- [ ] **Step 6: Aggiorna route guard `_authenticated.tsx`**

Apri `apps/seller/src/routes/_authenticated.tsx`. Trova il `beforeLoad` (o equivalente) che redirige sulla base dell'onboarding status. Rimuovi le clausole per stati morti. La mappa diventa:

```ts
const ONBOARDING_ROUTE_BY_STATUS: Partial<Record<OnboardingStatus, string>> = {
  pending_email: "/verify-email", // o equivalente esistente
  pending_personal: "/onboarding/personal-info",
  pending_document: "/onboarding/document",
  pending_company: "/onboarding/company",
  pending_review: "/onboarding/pending",
  rejected: "/onboarding/rejected", // se esistente
};
```

- [ ] **Step 7: Run typecheck seller**

```bash
bun run --filter @bibs/seller typecheck
```

Expected: PASS. Se rimangono errori, sono per riferimenti a `useUpdateStore` / `useUpdateTeam` / `useUpdatePayment` non ancora rimossi — sistemali.

- [ ] **Step 8: Smoke test manuale**

```bash
bun run dev:seller
```

Naviga su `http://localhost:3002`. Loggati come un seller dev. Verifica:
- Lo step indicator non mostra più "Negozio", "Team", "Pagamento".
- Compilando il company step, vieni rediretto a `/onboarding/pending` (non `/onboarding/store`).

- [ ] **Step 9: Commit**

```bash
git add apps/seller/src/routes apps/seller/src/hooks/use-onboarding.ts apps/seller/src/features/onboarding apps/seller/src/routeTree.gen.ts
git commit -m "refactor(seller): drop onboarding store/team/payment steps from UI"
```

---

## Task 10: `getOrCreateStripeCustomer` helper

**Files:**
- Create: `apps/api/src/modules/billing/services/customer.ts`
- Create: `apps/api/src/modules/billing/index.ts` (placeholder export, riusato nei task dopo)
- Test: `apps/api/tests/integration/billing-customer.test.ts`

- [ ] **Step 1: Test fallente (integration)**

`apps/api/tests/integration/billing-customer.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

import {
  getTestDb,
  setupTestContainer,
  teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (getTestDb() as any)[prop];
    },
  }),
}));

// Mock Stripe customers.create + customers.retrieve
const fakeStripeCustomer = { id: "cus_FAKE123" };
const customersCreate = mock(async () => fakeStripeCustomer);
const customersRetrieve = mock(async () => fakeStripeCustomer);

mock.module("@/lib/stripe", () => ({
  stripe: {
    customers: {
      create: customersCreate,
      retrieve: customersRetrieve,
    },
  },
}));

import { eq } from "drizzle-orm";
import { sellerProfile } from "@/db/schemas/seller";
import { getOrCreateStripeCustomer } from "@/modules/billing/services/customer";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller } from "../helpers/fixtures";

beforeAll(async () => {
  await setupTestContainer();
}, 120_000);

afterAll(async () => {
  await teardownTestContainer();
});

beforeEach(async () => {
  await truncateAll(getTestDb());
  customersCreate.mockClear();
  customersRetrieve.mockClear();
});

describe("getOrCreateStripeCustomer", () => {
  it("creates a Stripe customer on first call and persists it on sellerProfile", async () => {
    const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });

    const customerId = await getOrCreateStripeCustomer(profile.id);

    expect(customerId).toBe("cus_FAKE123");
    expect(customersCreate).toHaveBeenCalledTimes(1);

    const updated = await getTestDb()
      .select()
      .from(sellerProfile)
      .where(eq(sellerProfile.id, profile.id))
      .then((r) => r[0]);
    expect(updated.stripeCustomerId).toBe("cus_FAKE123");
  });

  it("returns the cached customer id on subsequent calls (no new create)", async () => {
    const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });
    await getTestDb()
      .update(sellerProfile)
      .set({ stripeCustomerId: "cus_EXISTING" })
      .where(eq(sellerProfile.id, profile.id));

    const customerId = await getOrCreateStripeCustomer(profile.id);

    expect(customerId).toBe("cus_EXISTING");
    expect(customersCreate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
cd apps/api && bun test tests/integration/billing-customer.test.ts
```

Expected: FAIL `Cannot find module '@/modules/billing/services/customer'`.

- [ ] **Step 3: Implementa il helper**

`apps/api/src/modules/billing/services/customer.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { sellerProfile } from "@/db/schemas/seller";
import { ServiceError } from "@/lib/errors";
import { stripe } from "@/lib/stripe";

export async function getOrCreateStripeCustomer(
  sellerProfileId: string,
): Promise<string> {
  const profile = await db.query.sellerProfile.findFirst({
    where: eq(sellerProfile.id, sellerProfileId),
    with: { user: true },
  });

  if (!profile) {
    throw new ServiceError(404, "Seller profile not found");
  }

  if (profile.stripeCustomerId) {
    return profile.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email: profile.user.email,
    name: [profile.firstName, profile.lastName].filter(Boolean).join(" ") || undefined,
    metadata: {
      bibs_seller_profile_id: profile.id,
      bibs_user_id: profile.userId,
    },
  });

  await db
    .update(sellerProfile)
    .set({ stripeCustomerId: customer.id })
    .where(eq(sellerProfile.id, sellerProfileId));

  return customer.id;
}
```

Crea anche un index module placeholder `apps/api/src/modules/billing/index.ts`:

```ts
export { getOrCreateStripeCustomer } from "./services/customer";
```

- [ ] **Step 4: Run test (PASS)**

```bash
cd apps/api && bun test tests/integration/billing-customer.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/billing/services/customer.ts apps/api/src/modules/billing/index.ts apps/api/tests/integration/billing-customer.test.ts
git commit -m "feat(billing): getOrCreateStripeCustomer helper"
```

---

## Task 11: `POST /seller/stores/checkout` endpoint + GET status + GET pending

**Files:**
- Create: `apps/api/src/modules/seller/services/checkout.ts`
- Create: `apps/api/src/modules/seller/routes/checkout.ts`
- Modify: `apps/api/src/modules/seller/index.ts` (mount route)
- Modify: `apps/api/src/lib/schemas/index.ts` (esporta nuovi response schema)
- Modify: `apps/api/src/lib/env.ts` (assicurati che `SELLER_APP_URL` sia letto)
- Test: `apps/api/tests/integration/seller-stores-checkout.test.ts`

- [ ] **Step 1: Esamina il pattern routes esistenti**

```bash
cat apps/api/src/modules/seller/index.ts
cat apps/api/src/modules/seller/routes/stores.ts | head -100
```

Per matchare il pattern `withSellerAuth`, `okRes`, `withErrors`.

- [ ] **Step 2: Test fallente (integration)**

`apps/api/tests/integration/seller-stores-checkout.test.ts`:

```ts
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";

import {
  getTestDb,
  setupTestContainer,
  teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (getTestDb() as any)[prop];
    },
  }),
}));

const sessionCreate = mock(async () => ({
  id: "cs_FAKE",
  url: "https://stripe.test/checkout/cs_FAKE",
}));

mock.module("@/lib/stripe", () => ({
  stripe: {
    customers: { create: async () => ({ id: "cus_FAKE" }) },
    checkout: { sessions: { create: sessionCreate } },
  },
}));

mock.module("@/lib/env", () => ({
  env: {
    STRIPE_SECRET_KEY: "sk_test_FAKE",
    SELLER_APP_URL: "http://localhost:3002",
  },
}));

import { eq } from "drizzle-orm";
import { pendingStoreCreation } from "@/db/schemas/pending-store-creation";
import { pricingConfig } from "@/db/schemas/pricing-config";
import { sellerProfile } from "@/db/schemas/seller";
import { createCheckoutSession } from "@/modules/seller/services/checkout";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller } from "../helpers/fixtures";

beforeAll(async () => {
  await setupTestContainer();
}, 120_000);

afterAll(async () => {
  await teardownTestContainer();
});

beforeEach(async () => {
  await truncateAll(getTestDb());
  sessionCreate.mockClear();

  // Seed pricing_config
  await getTestDb().insert(pricingConfig).values({
    storeMonthlyFeeCents: 2900,
    currency: "EUR",
    stripePriceId: "price_FAKE",
    suspendedAutoCancelDays: 60,
    pendingCreationExpiryHours: 24,
    isActive: true,
  });
});

const VALID_BODY = {
  name: "Pasticceria Test",
  addressLine1: "Via Roma 1",
  city: "Milano",
  zipCode: "20100",
  country: "IT",
  description: null,
  addressLine2: null,
  province: "MI",
  websiteUrl: null,
  categoryId: null,
  openingHours: null,
  phoneNumbers: [],
};

describe("createCheckoutSession", () => {
  it("creates a pending row and a Stripe Checkout Session", async () => {
    const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });

    const result = await createCheckoutSession({
      sellerProfileId: profile.id,
      body: VALID_BODY,
    });

    expect(result.checkoutUrl).toBe("https://stripe.test/checkout/cs_FAKE");
    expect(result.pendingStoreCreationId).toBeTruthy();

    const pending = await getTestDb()
      .select()
      .from(pendingStoreCreation)
      .where(eq(pendingStoreCreation.id, result.pendingStoreCreationId))
      .then((r) => r[0]);

    expect(pending.status).toBe("open");
    expect(pending.feeAmountCents).toBe(2900);
    expect(pending.stripeCheckoutSessionId).toBe("cs_FAKE");
  });

  it("returns the existing pending if seller already has one open (idempotent double-click)", async () => {
    const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });

    const r1 = await createCheckoutSession({ sellerProfileId: profile.id, body: VALID_BODY });
    const r2 = await createCheckoutSession({ sellerProfileId: profile.id, body: VALID_BODY });

    expect(r1.pendingStoreCreationId).toBe(r2.pendingStoreCreationId);
    expect(sessionCreate).toHaveBeenCalledTimes(1);
  });

  it("caches the stripeCustomerId on the seller profile", async () => {
    const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });

    await createCheckoutSession({ sellerProfileId: profile.id, body: VALID_BODY });

    const updated = await getTestDb()
      .select()
      .from(sellerProfile)
      .where(eq(sellerProfile.id, profile.id))
      .then((r) => r[0]);

    expect(updated.stripeCustomerId).toBe("cus_FAKE");
  });
});
```

- [ ] **Step 3: Run test (FAIL)**

```bash
cd apps/api && bun test tests/integration/seller-stores-checkout.test.ts
```

Expected: FAIL `Cannot find module '@/modules/seller/services/checkout'`.

- [ ] **Step 4: Implementa il service**

`apps/api/src/modules/seller/services/checkout.ts`:

```ts
import { addHours } from "date-fns";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { pendingStoreCreation } from "@/db/schemas/pending-store-creation";
import { pricingConfig } from "@/db/schemas/pricing-config";
import { env } from "@/lib/env";
import { ServiceError } from "@/lib/errors";
import { stripe } from "@/lib/stripe";
import { getOrCreateStripeCustomer } from "@/modules/billing/services/customer";
import type { Static } from "@sinclair/typebox";
import type { CreateStoreBody } from "@/lib/schemas/forms";

type CreateStoreInput = Static<typeof CreateStoreBody>;

interface CreateCheckoutParams {
  sellerProfileId: string;
  body: CreateStoreInput;
}

interface CreateCheckoutResult {
  checkoutUrl: string;
  pendingStoreCreationId: string;
}

async function getActivePricing() {
  const cfg = await db.query.pricingConfig.findFirst({
    where: eq(pricingConfig.isActive, true),
  });
  if (!cfg) {
    throw new ServiceError(
      500,
      "Pricing config not initialized. Run stripe:bootstrap + db:seed.",
    );
  }
  return cfg;
}

export async function createCheckoutSession(
  params: CreateCheckoutParams,
): Promise<CreateCheckoutResult> {
  const { sellerProfileId, body } = params;

  // 1) Idempotent: if there's already an "open" pending for this seller, return it
  const existing = await db.query.pendingStoreCreation.findFirst({
    where: and(
      eq(pendingStoreCreation.sellerProfileId, sellerProfileId),
      eq(pendingStoreCreation.status, "open"),
    ),
  });
  if (existing?.stripeCheckoutSessionId) {
    const session = await stripe.checkout.sessions.retrieve(
      existing.stripeCheckoutSessionId,
    );
    return {
      checkoutUrl: session.url ?? "",
      pendingStoreCreationId: existing.id,
    };
  }

  const pricing = await getActivePricing();
  const customerId = await getOrCreateStripeCustomer(sellerProfileId);

  // 2) Insert pending row first (we need the id to put in session metadata)
  const expiresAt = addHours(new Date(), pricing.pendingCreationExpiryHours);
  const [pending] = await db
    .insert(pendingStoreCreation)
    .values({
      sellerProfileId,
      formData: body,
      feeAmountCents: pricing.storeMonthlyFeeCents,
      currency: pricing.currency,
      status: "open",
      expiresAt,
    })
    .returning();

  // 3) Create Stripe Checkout Session
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: pricing.stripePriceId, quantity: 1 }],
    payment_method_collection: "if_required",
    metadata: { pendingStoreCreationId: pending.id },
    subscription_data: {
      metadata: { pendingStoreCreationId: pending.id },
    },
    success_url: `${env.SELLER_APP_URL}/store/new/processing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.SELLER_APP_URL}/store/new?cancel=${pending.id}`,
  });

  // 4) Persist session id
  await db
    .update(pendingStoreCreation)
    .set({ stripeCheckoutSessionId: session.id })
    .where(eq(pendingStoreCreation.id, pending.id));

  return {
    checkoutUrl: session.url ?? "",
    pendingStoreCreationId: pending.id,
  };
}

export async function getCheckoutStatus(params: {
  sellerProfileId: string;
  stripeCheckoutSessionId: string;
}): Promise<{
  status: "open" | "ready" | "expired" | "canceled";
  storeId?: string;
}> {
  const pending = await db.query.pendingStoreCreation.findFirst({
    where: and(
      eq(pendingStoreCreation.sellerProfileId, params.sellerProfileId),
      eq(
        pendingStoreCreation.stripeCheckoutSessionId,
        params.stripeCheckoutSessionId,
      ),
    ),
  });
  if (!pending) {
    throw new ServiceError(404, "Checkout session not found for this seller");
  }
  if (pending.status === "consumed") {
    // Find the store that was created (storeId is set on the subscription, but we can
    // also reverse-lookup via subscription_id). For simplicity, query store_subscriptions
    // by stripe_subscription_id.
    const { storeSubscription } = await import("@/db/schemas/store-subscription");
    const sub = pending.stripeSubscriptionId
      ? await db.query.storeSubscription.findFirst({
          where: eq(storeSubscription.stripeSubscriptionId, pending.stripeSubscriptionId),
        })
      : null;
    return { status: "ready", storeId: sub?.storeId };
  }
  if (pending.status === "open") return { status: "open" };
  if (pending.status === "expired") return { status: "expired" };
  return { status: "canceled" };
}

export async function getPendingForResume(params: {
  sellerProfileId: string;
  pendingId: string;
}) {
  const pending = await db.query.pendingStoreCreation.findFirst({
    where: and(
      eq(pendingStoreCreation.id, params.pendingId),
      eq(pendingStoreCreation.sellerProfileId, params.sellerProfileId),
    ),
  });
  if (!pending || pending.status !== "open") {
    throw new ServiceError(404, "Pending checkout not found or already consumed");
  }
  return { formData: pending.formData };
}
```

- [ ] **Step 5: Crea le route**

`apps/api/src/modules/seller/routes/checkout.ts`:

```ts
import { Elysia, t } from "elysia";
import { okRes, withErrors } from "@/lib/schemas";
import { CreateStoreBody } from "@/lib/schemas/forms";
import { ok } from "@/lib/responses";
import { withSellerAuth } from "../context";
import {
  createCheckoutSession,
  getCheckoutStatus,
  getPendingForResume,
} from "../services/checkout";

const CheckoutResponseSchema = t.Object({
  checkoutUrl: t.String(),
  pendingStoreCreationId: t.String(),
});

const CheckoutStatusSchema = t.Object({
  status: t.Union([
    t.Literal("open"),
    t.Literal("ready"),
    t.Literal("expired"),
    t.Literal("canceled"),
  ]),
  storeId: t.Optional(t.String()),
});

const PendingFormSchema = t.Object({
  formData: t.Unknown(),
});

export const checkoutRoutes = new Elysia()
  .post(
    "/stores/checkout",
    async (ctx) => {
      const { sellerProfile: sp, body } = withSellerAuth(ctx);
      if (sp.onboardingStatus !== "active") {
        throw new Error("Seller must be active to add stores");
      }
      const data = await createCheckoutSession({
        sellerProfileId: sp.id,
        body,
      });
      return ok(data);
    },
    {
      body: CreateStoreBody,
      response: withErrors({ 200: okRes(CheckoutResponseSchema) }),
      detail: {
        summary: "Crea checkout session per nuovo negozio",
        description:
          "Crea un Stripe Checkout in mode subscription. Il negozio viene creato dal webhook a pagamento avvenuto.",
        tags: ["Seller - Stores"],
      },
    },
  )
  .get(
    "/checkout-sessions/:sessionId/status",
    async (ctx) => {
      const { sellerProfile: sp, params } = withSellerAuth(ctx);
      const data = await getCheckoutStatus({
        sellerProfileId: sp.id,
        stripeCheckoutSessionId: params.sessionId,
      });
      return ok(data);
    },
    {
      params: t.Object({ sessionId: t.String() }),
      response: withErrors({ 200: okRes(CheckoutStatusSchema) }),
      detail: {
        summary: "Stato della checkout session",
        tags: ["Seller - Stores"],
      },
    },
  )
  .get(
    "/stores/checkout/:pendingId",
    async (ctx) => {
      const { sellerProfile: sp, params } = withSellerAuth(ctx);
      const data = await getPendingForResume({
        sellerProfileId: sp.id,
        pendingId: params.pendingId,
      });
      return ok(data);
    },
    {
      params: t.Object({ pendingId: t.String() }),
      response: withErrors({ 200: okRes(PendingFormSchema) }),
      detail: {
        summary: "Recupera form data per cancel flow",
        tags: ["Seller - Stores"],
      },
    },
  );
```

- [ ] **Step 6: Mount route**

Apri `apps/api/src/modules/seller/index.ts` e aggiungi:

```ts
import { checkoutRoutes } from "./routes/checkout";

// dentro la chain Elysia, aggiungi:
.use(checkoutRoutes)
```

- [ ] **Step 7: Run test (PASS)**

```bash
cd apps/api && bun test tests/integration/seller-stores-checkout.test.ts
```

Expected: 3 test PASS.

- [ ] **Step 8: Typecheck (Eden Treaty propagation)**

```bash
bun run --filter '*' typecheck
```

Expected: PASS. I tre frontend dovrebbero risolvere automaticamente i tipi del nuovo endpoint via Eden Treaty.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/seller/services/checkout.ts apps/api/src/modules/seller/routes/checkout.ts apps/api/src/modules/seller/index.ts apps/api/tests/integration/seller-stores-checkout.test.ts
git commit -m "feat(billing): POST /seller/stores/checkout + status + resume endpoints"
```

---

## Task 12: Frontend store/new redirect to Checkout + processing route

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/store/new.tsx`
- Create: `apps/seller/src/routes/_authenticated/store/new.processing.tsx`
- Modify: `apps/seller/messages/{it,en}.json` (stringhe checkout)

- [ ] **Step 1: Aggiorna `store/new.tsx`**

Apri `apps/seller/src/routes/_authenticated/store/new.tsx`. Cambia la `createMutation` da `api().seller.stores.post(...)` a `api().seller.stores.checkout.post(...)`. Il response handler ora redirige a `data.data.checkoutUrl`:

```tsx
const createMutation = useMutation({
  mutationFn: async (formData: StoreFormData) => {
    const response = await api().seller.stores.checkout.post(formData);
    if (response.error) {
      throw new Error(
        response.error.value?.message || m["store.new.checkout_error"](),
      );
    }
    return response.data;
  },
  onSuccess: (data) => {
    if (data?.data?.checkoutUrl) {
      window.location.href = data.data.checkoutUrl;
    }
  },
  onError: (error: Error) =>
    toast.error(error.message || m["store.new.generic_error"]()),
});
```

Aggiorna il bottone "Crea negozio" → "Continua al pagamento". Aggiungi la quota visibile (puoi hardcodare €29 per ora se non hai un endpoint pricing pubblico — il design dice "configurabile da admin" ma esponiamo l'importo via il summary in Task 18; per ora una stringa statica va bene per il bottone).

Gestisci il `cancel` query param: se `?cancel=<pendingId>` è presente al mount, chiama `api().seller.stores.checkout({ pendingId }).get()` per ripescare formData e precompilare il form:

```tsx
const { cancel: pendingId } = Route.useSearch();

useEffect(() => {
  if (!pendingId) return;
  void api().seller.stores.checkout({ pendingId: pendingId as string }).get().then((res) => {
    if (res.data?.data?.formData) {
      // setto i defaultValues del form
      formRef.current?.reset(res.data.data.formData);
    }
  });
}, [pendingId]);
```

Aggiungi `validateSearch` alla rotta per accettare `cancel`:

```tsx
export const Route = createFileRoute("/_authenticated/store/new")({
  validateSearch: (search) =>
    ({
      cancel: typeof search.cancel === "string" ? search.cancel : undefined,
    }) as { cancel?: string },
  beforeLoad: async () => { /* ... esistente ... */ },
  component: NewStorePage,
});
```

- [ ] **Step 2: Crea la route `processing`**

`apps/seller/src/routes/_authenticated/store/new.processing.tsx`:

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Spinner } from "@bibs/ui/components/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@bibs/ui/components/card";
import { toast } from "@bibs/ui/components/sonner";
import { api } from "@/lib/api";
import { useActiveStore } from "@/hooks/use-active-store";

export const Route = createFileRoute("/_authenticated/store/new/processing")({
  validateSearch: (search) =>
    ({
      session_id:
        typeof search.session_id === "string" ? search.session_id : "",
    }) as { session_id: string },
  component: ProcessingPage,
});

const POLL_INTERVAL_MS = 1000;
const TIMEOUT_MS = 60_000;

function ProcessingPage() {
  const { session_id: sessionId } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { setActiveStoreId } = useActiveStore();
  const [timedOut, setTimedOut] = useState(false);

  const { data } = useQuery({
    queryKey: ["checkout-status", sessionId],
    queryFn: async () => {
      const res = await api().seller["checkout-sessions"]({ sessionId }).status.get();
      if (res.error) throw new Error(res.error.value?.message);
      return res.data?.data;
    },
    refetchInterval: (q) => (q.state.data?.status === "ready" || timedOut ? false : POLL_INTERVAL_MS),
    enabled: !!sessionId && !timedOut,
  });

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (data?.status === "ready" && data.storeId) {
      setActiveStoreId(data.storeId);
      void qc.invalidateQueries({ queryKey: ["stores"] });
      toast.success("Negozio creato e attivo");
      void navigate({ to: "/" });
    }
  }, [data, navigate, qc, setActiveStoreId]);

  return (
    <div className="mx-auto max-w-md py-16">
      <Card>
        <CardHeader>
          <CardTitle>Sto creando il tuo negozio…</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 py-8">
          {!timedOut ? (
            <>
              <Spinner />
              <p className="text-sm text-muted-foreground text-center">
                Il pagamento è stato ricevuto. Attendi qualche secondo mentre attiviamo il negozio.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground text-center">
                Il processo sta richiedendo più del previsto. Riceverai una mail
                quando il negozio sarà pronto. Puoi ricaricare la pagina o tornare
                in seguito.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

⚠️ Verifica il nome esatto della rotta nel `routeTree.gen.ts` dopo il rigenerare. TanStack Router file-based: `store/new.processing.tsx` diventa `/store/new/processing`. Se è diverso, aggiorna `createFileRoute(...)` di conseguenza.

- [ ] **Step 3: Stringhe Paraglide**

In `apps/seller/messages/it.json` aggiungi:

```json
"store.new.continue_to_payment": "Continua al pagamento ({fee})",
"store.new.checkout_error": "Errore avvio pagamento",
"store.new.generic_error": "Errore durante la creazione",
"store.processing.title": "Sto creando il tuo negozio…",
"store.processing.body": "Il pagamento è stato ricevuto. Attendi qualche secondo mentre attiviamo il negozio.",
"store.processing.timeout": "Il processo sta richiedendo più del previsto. Riceverai una mail quando il negozio sarà pronto."
```

Stesso pattern in `en.json` (traduzione inglese).

- [ ] **Step 4: Typecheck**

```bash
bun run --filter @bibs/seller typecheck
```

Expected: PASS.

- [ ] **Step 5: Smoke test manuale**

Avvia API + seller:

```bash
bun run dev
```

In un altro terminale, avvia il webhook forwarder Stripe:

```bash
stripe listen --forward-to http://localhost:3000/webhooks/stripe
```

(Anche se il webhook handler non è ancora implementato, ti darà il `whsec_...` da copiare in `.env.local`. Aggiornalo prima del prossimo task.)

Naviga su `http://localhost:3002`, loggati come seller `active`, clicca "Aggiungi il primo negozio", compila il form, click "Continua al pagamento". Dovresti essere rediretto su una pagina hosted di Stripe Checkout. Usa carta test `4242 4242 4242 4242`, qualsiasi data futura, qualsiasi CVC. Dopo "Pay", Stripe ti rimanda su `/store/new/processing` — vedrai lo spinner girare in eterno (manca ancora il webhook handler, che è il Task successivo). OK, è il comportamento atteso a questo punto del plan.

- [ ] **Step 6: Commit**

```bash
git add apps/seller/src/routes/_authenticated/store/new.tsx apps/seller/src/routes/_authenticated/store/new.processing.tsx apps/seller/src/routeTree.gen.ts apps/seller/messages/
git commit -m "feat(seller): redirect to Stripe Checkout for new store + processing page"
```

---

## Task 13: Webhook endpoint scaffold (signature + dedupe + dispatch)

**Files:**
- Create: `apps/api/src/modules/webhooks/index.ts`
- Create: `apps/api/src/modules/webhooks/routes/stripe.ts`
- Create: `apps/api/src/modules/webhooks/services/dispatcher.ts`
- Modify: `apps/api/src/index.ts` (mount route)
- Test: `apps/api/tests/integration/stripe-webhook-scaffold.test.ts`

- [ ] **Step 1: Test fallente — signature verification + dedupe**

`apps/api/tests/integration/stripe-webhook-scaffold.test.ts`:

```ts
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";

import {
  getTestDb,
  setupTestContainer,
  teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (getTestDb() as any)[prop];
    },
  }),
}));

const constructEvent = mock(() => ({
  id: "evt_FAKE",
  type: "checkout.session.completed",
  data: { object: {} },
}));

mock.module("@/lib/stripe", () => ({
  stripe: {
    webhooks: { constructEvent },
  },
}));

mock.module("@/lib/env", () => ({
  env: { STRIPE_WEBHOOK_SECRET: "whsec_FAKE" },
}));

import { count, eq } from "drizzle-orm";
import { stripeEvent } from "@/db/schemas/stripe-event";
import { handleStripeWebhook } from "@/modules/webhooks/services/dispatcher";
import { truncateAll } from "../helpers/cleanup";

beforeAll(async () => {
  await setupTestContainer();
}, 120_000);

afterAll(async () => {
  await teardownTestContainer();
});

beforeEach(async () => {
  await truncateAll(getTestDb());
  constructEvent.mockClear();
});

describe("handleStripeWebhook", () => {
  it("records the event in stripe_events table", async () => {
    await handleStripeWebhook({
      payload: "raw-body",
      signature: "t=1,v1=fake",
    });

    const events = await getTestDb().select().from(stripeEvent);
    expect(events).toHaveLength(1);
    expect(events[0].eventId).toBe("evt_FAKE");
    expect(events[0].eventType).toBe("checkout.session.completed");
  });

  it("is idempotent: a duplicate event is skipped", async () => {
    await handleStripeWebhook({ payload: "raw1", signature: "t=1,v1=a" });
    await handleStripeWebhook({ payload: "raw2", signature: "t=2,v1=b" });

    const events = await getTestDb().select().from(stripeEvent);
    expect(events).toHaveLength(1);
  });

  it("rejects invalid signatures", async () => {
    constructEvent.mockImplementationOnce(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    await expect(
      handleStripeWebhook({ payload: "bad", signature: "invalid" }),
    ).rejects.toThrow(/signature/i);
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
cd apps/api && bun test tests/integration/stripe-webhook-scaffold.test.ts
```

Expected: FAIL `Cannot find module '@/modules/webhooks/services/dispatcher'`.

- [ ] **Step 3: Crea il dispatcher**

`apps/api/src/modules/webhooks/services/dispatcher.ts`:

```ts
import type Stripe from "stripe";
import { db } from "@/db";
import { stripeEvent } from "@/db/schemas/stripe-event";
import { env } from "@/lib/env";
import { ServiceError } from "@/lib/errors";
import { getLogger } from "@/lib/logger";
import { stripe } from "@/lib/stripe";

const log = getLogger("stripe-webhook");

interface HandleWebhookParams {
  payload: string;
  signature: string;
}

/**
 * Verifies the Stripe signature, dedupes the event via stripe_events,
 * and dispatches to the correct handler. Returns once the event is
 * fully processed (or skipped).
 */
export async function handleStripeWebhook(
  params: HandleWebhookParams,
): Promise<void> {
  const { payload, signature } = params;

  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new ServiceError(500, "STRIPE_WEBHOOK_SECRET not configured");
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    log.warn({ err }, "Stripe webhook signature verification failed");
    throw new ServiceError(400, "Invalid Stripe signature");
  }

  // Dedupe: INSERT ON CONFLICT DO NOTHING via Drizzle
  const insertedRows = await db
    .insert(stripeEvent)
    .values({ eventId: event.id, eventType: event.type })
    .onConflictDoNothing({ target: stripeEvent.eventId })
    .returning({ eventId: stripeEvent.eventId });

  if (insertedRows.length === 0) {
    log.info({ eventId: event.id, type: event.type }, "Event already processed, skipping");
    return;
  }

  try {
    await dispatch(event);
    await db
      .update(stripeEvent)
      .set({ processedAt: new Date() })
      .where(eq(stripeEvent.eventId, event.id));
  } catch (err) {
    log.error({ err, eventId: event.id, type: event.type }, "Webhook handler failed");
    // Do NOT delete the stripe_event row — leaving processedAt=null indicates
    // a stuck event. Future task (admin reconciliation tool) can replay.
    throw err;
  }
}

async function dispatch(event: Stripe.Event): Promise<void> {
  // Handlers vengono aggiunti nei task successivi (14, 15, 16).
  // Per ora, log e basta.
  log.info({ eventId: event.id, type: event.type }, "Stripe event dispatched (no-op placeholder)");
}
```

Aggiungi `import { eq } from "drizzle-orm";` in cima al file (è già usato).

- [ ] **Step 4: Crea la route Elysia**

`apps/api/src/modules/webhooks/routes/stripe.ts`:

```ts
import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { handleStripeWebhook } from "../services/dispatcher";

const log = getLogger("stripe-webhook-route");

export const stripeWebhookRoutes = new Elysia()
  .post(
    "/webhooks/stripe",
    async (ctx) => {
      const signature = ctx.headers["stripe-signature"];
      if (!signature) {
        ctx.set.status = 400;
        return { error: "missing signature" };
      }

      // Elysia raw body access: we need the raw text, not the parsed JSON.
      const payload =
        typeof ctx.body === "string" ? ctx.body : JSON.stringify(ctx.body);

      try {
        await handleStripeWebhook({ payload, signature });
        return { received: true };
      } catch (err) {
        log.error({ err }, "Stripe webhook processing failed");
        // ALWAYS return 200 to Stripe to avoid infinite retries on bugs
        // (signature errors are the exception — Stripe expects 400 there).
        const message =
          err instanceof Error ? err.message.toLowerCase() : "";
        if (message.includes("signature")) {
          ctx.set.status = 400;
          return { error: "invalid signature" };
        }
        ctx.set.status = 200;
        return { received: true, internalError: true };
      }
    },
    {
      parse: "text",  // accetta raw text body per la firma
      detail: {
        summary: "Webhook Stripe",
        description: "Endpoint pubblico per eventi Stripe. Firma obbligatoria.",
        tags: ["Webhooks"],
      },
    },
  );
```

Crea `apps/api/src/modules/webhooks/index.ts`:

```ts
export { stripeWebhookRoutes } from "./routes/stripe";
```

- [ ] **Step 5: Mount route in `apps/api/src/index.ts`**

Cerca dove sono montate le altre route principali (probabilmente `.use(sellerRoutes).use(customerRoutes).use(adminRoutes)`). Aggiungi `.use(stripeWebhookRoutes)` allo stesso livello.

⚠️ Verifica che NON sia protetta dal middleware auth: deve essere pubblica perché Stripe non passa nessun token nostro, solo la firma. Se `auth` è applicato globalmente, configura l'esclusione per `/webhooks/*`.

- [ ] **Step 6: Run test (PASS)**

```bash
cd apps/api && bun test tests/integration/stripe-webhook-scaffold.test.ts
```

Expected: 3 test PASS.

- [ ] **Step 7: Smoke test con stripe-cli**

Avvia l'API (`bun run dev:api`) e il forwarder:

```bash
stripe listen --forward-to http://localhost:3000/webhooks/stripe
```

In un secondo terminale, scatena un evento di test:

```bash
stripe trigger checkout.session.completed
```

Verifica nei log dell'API:
- `Stripe event dispatched (no-op placeholder)` con `type: 'checkout.session.completed'`
- Risposta 200 a Stripe CLI.

Verifica nel DB:

```bash
psql -h localhost -U postgres bibs -c "SELECT event_id, event_type, processed_at IS NOT NULL AS done FROM stripe_events;"
```

Dovresti vedere una riga.

Salva il `whsec_...` mostrato da `stripe listen` in `apps/api/.env.local` come `STRIPE_WEBHOOK_SECRET=whsec_...`. Riavvia l'API per recepirlo.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/webhooks/ apps/api/src/index.ts apps/api/tests/integration/stripe-webhook-scaffold.test.ts
git commit -m "feat(billing): stripe webhook endpoint (signature + dedupe + dispatch scaffold)"
```

---

## Task 14: Webhook handler — `checkout.session.completed`

**Files:**
- Modify: `apps/api/src/modules/webhooks/services/dispatcher.ts`
- Create: `apps/api/src/modules/webhooks/services/handlers/checkout-completed.ts`
- Test: `apps/api/tests/integration/stripe-webhook-checkout-completed.test.ts`

- [ ] **Step 1: Test fallente**

`apps/api/tests/integration/stripe-webhook-checkout-completed.test.ts`:

```ts
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";

import {
  getTestDb,
  setupTestContainer,
  teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (getTestDb() as any)[prop];
    },
  }),
}));

const fakeSubscription = {
  id: "sub_FAKE",
  customer: "cus_FAKE",
  current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
  items: { data: [{ price: { id: "price_FAKE" } }] },
  status: "active",
  cancel_at_period_end: false,
};

const subRetrieve = mock(async () => fakeSubscription);

mock.module("@/lib/stripe", () => ({
  stripe: {
    subscriptions: { retrieve: subRetrieve },
    webhooks: {
      constructEvent: () => ({
        id: "evt_CHECKOUT_OK",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_FAKE",
            payment_status: "paid",
            subscription: "sub_FAKE",
            customer: "cus_FAKE",
            metadata: { pendingStoreCreationId: "WILL_BE_REPLACED" },
          },
        },
      }),
    },
  },
}));

mock.module("@/lib/env", () => ({
  env: { STRIPE_WEBHOOK_SECRET: "whsec_FAKE" },
}));

import { eq } from "drizzle-orm";
import { pendingStoreCreation } from "@/db/schemas/pending-store-creation";
import { store } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { handleStripeWebhook } from "@/modules/webhooks/services/dispatcher";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller } from "../helpers/fixtures";

beforeAll(async () => {
  await setupTestContainer();
}, 120_000);

afterAll(async () => {
  await teardownTestContainer();
});

beforeEach(async () => {
  await truncateAll(getTestDb());
});

const FORM_DATA = {
  name: "Test Store",
  addressLine1: "Via Roma 1",
  city: "Milano",
  zipCode: "20100",
  country: "IT",
};

describe("handleCheckoutCompleted", () => {
  it("creates a store + subscription, marks pending as consumed", async () => {
    const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });

    const [pending] = await getTestDb()
      .insert(pendingStoreCreation)
      .values({
        sellerProfileId: profile.id,
        formData: FORM_DATA,
        stripeCheckoutSessionId: "cs_FAKE",
        feeAmountCents: 2900,
        currency: "EUR",
        status: "open",
        expiresAt: new Date(Date.now() + 86400000),
      })
      .returning();

    // Patch the constructEvent mock to use the real pending id
    const stripe = await import("@/lib/stripe");
    (stripe as any).stripe.webhooks.constructEvent = () => ({
      id: "evt_CHECKOUT_OK",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_FAKE",
          payment_status: "paid",
          subscription: "sub_FAKE",
          customer: "cus_FAKE",
          metadata: { pendingStoreCreationId: pending.id },
        },
      },
    });

    await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

    const stores = await getTestDb().select().from(store);
    expect(stores).toHaveLength(1);
    expect(stores[0].name).toBe("Test Store");

    const subs = await getTestDb().select().from(storeSubscription);
    expect(subs).toHaveLength(1);
    expect(subs[0].stripeSubscriptionId).toBe("sub_FAKE");
    expect(subs[0].status).toBe("active");
    expect(subs[0].feeAmountCents).toBe(2900);

    const updatedPending = await getTestDb()
      .select()
      .from(pendingStoreCreation)
      .where(eq(pendingStoreCreation.id, pending.id))
      .then((r) => r[0]);
    expect(updatedPending.status).toBe("consumed");
    expect(updatedPending.consumedAt).toBeTruthy();
  });

  it("is idempotent: replaying the event does not create duplicate stores", async () => {
    const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });
    const [pending] = await getTestDb()
      .insert(pendingStoreCreation)
      .values({
        sellerProfileId: profile.id,
        formData: FORM_DATA,
        stripeCheckoutSessionId: "cs_FAKE",
        feeAmountCents: 2900,
        currency: "EUR",
        status: "open",
        expiresAt: new Date(Date.now() + 86400000),
      })
      .returning();

    const stripe = await import("@/lib/stripe");
    (stripe as any).stripe.webhooks.constructEvent = () => ({
      id: "evt_CHECKOUT_OK",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_FAKE",
          payment_status: "paid",
          subscription: "sub_FAKE",
          customer: "cus_FAKE",
          metadata: { pendingStoreCreationId: pending.id },
        },
      },
    });

    await handleStripeWebhook({ payload: "raw1", signature: "t=1,v1=a" });
    await handleStripeWebhook({ payload: "raw2", signature: "t=2,v1=b" });

    const stores = await getTestDb().select().from(store);
    expect(stores).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
cd apps/api && bun test tests/integration/stripe-webhook-checkout-completed.test.ts
```

Expected: FAIL. Lo store NON viene creato perché il dispatcher è ancora no-op.

- [ ] **Step 3: Implementa il handler**

`apps/api/src/modules/webhooks/services/handlers/checkout-completed.ts`:

```ts
import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { pendingStoreCreation } from "@/db/schemas/pending-store-creation";
import { store } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { getLogger } from "@/lib/logger";
import { stripe } from "@/lib/stripe";

const log = getLogger("stripe-handler-checkout-completed");

export async function handleCheckoutCompleted(
  event: Stripe.Event,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;

  if (session.payment_status !== "paid") {
    log.info(
      { sessionId: session.id, payment_status: session.payment_status },
      "Checkout session not paid, skipping",
    );
    return;
  }

  const pendingId = session.metadata?.pendingStoreCreationId;
  if (!pendingId) {
    log.warn(
      { sessionId: session.id },
      "checkout.session.completed without pendingStoreCreationId metadata",
    );
    return;
  }

  if (!session.subscription || typeof session.subscription !== "string") {
    log.warn({ sessionId: session.id }, "Session has no subscription id");
    return;
  }

  // Retrieve full subscription to read period_end + price
  const sub = await stripe.subscriptions.retrieve(session.subscription);

  await db.transaction(async (tx) => {
    const pending = await tx.query.pendingStoreCreation.findFirst({
      where: and(
        eq(pendingStoreCreation.id, pendingId),
        eq(pendingStoreCreation.status, "open"),
      ),
    });

    if (!pending) {
      log.info(
        { pendingId, sessionId: session.id },
        "Pending already consumed or missing, skipping (idempotent)",
      );
      return;
    }

    const formData = pending.formData as Record<string, unknown>;

    const [createdStore] = await tx
      .insert(store)
      .values({
        sellerProfileId: pending.sellerProfileId,
        // Spread formData fields directly; CreateStoreBody validation has already run.
        name: formData.name as string,
        description: (formData.description as string | null) ?? null,
        addressLine1: formData.addressLine1 as string,
        addressLine2: (formData.addressLine2 as string | null) ?? null,
        city: formData.city as string,
        zipCode: formData.zipCode as string,
        province: (formData.province as string | null) ?? null,
        country: (formData.country as string) ?? "IT",
        categoryId: (formData.categoryId as string | null) ?? null,
        openingHours: (formData.openingHours as any) ?? null,
        websiteUrl: (formData.websiteUrl as string | null) ?? null,
      })
      .returning();

    await tx.insert(storeSubscription).values({
      storeId: createdStore.id,
      stripeSubscriptionId: sub.id,
      stripeCustomerId: sub.customer as string,
      stripePriceId: sub.items.data[0].price.id,
      feeAmountCents: pending.feeAmountCents,
      currency: pending.currency,
      status: "active",
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    });

    await tx
      .update(pendingStoreCreation)
      .set({
        status: "consumed",
        stripeSubscriptionId: sub.id,
        consumedAt: new Date(),
      })
      .where(eq(pendingStoreCreation.id, pending.id));
  });
}
```

⚠️ Se ci sono campi obbligatori sul `store` non coperti da `CreateStoreBody`, aggiornali qui (verifica il body schema attuale).

⚠️ Per gestire le `phone_numbers` (che vengono dal form e devono finire in `store_phone_numbers`), aggiungi un secondo INSERT dentro la stessa transazione:

```ts
const phones = (formData.phoneNumbers as Array<{ label?: string; number: string; position?: number }>) || [];
if (phones.length > 0) {
  const { storePhoneNumber } = await import("@/db/schemas/store");
  await tx.insert(storePhoneNumber).values(
    phones.map((p, idx) => ({
      storeId: createdStore.id,
      label: p.label ?? null,
      number: p.number,
      position: p.position ?? idx,
    })),
  );
}
```

- [ ] **Step 4: Wire nel dispatcher**

Modifica `apps/api/src/modules/webhooks/services/dispatcher.ts`. Cambia la funzione `dispatch`:

```ts
import { handleCheckoutCompleted } from "./handlers/checkout-completed";

async function dispatch(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(event);
    default:
      log.info({ eventId: event.id, type: event.type }, "Event not handled");
  }
}
```

- [ ] **Step 5: Run test (PASS)**

```bash
cd apps/api && bun test tests/integration/stripe-webhook-checkout-completed.test.ts
```

Expected: 2 test PASS.

- [ ] **Step 6: Smoke test end-to-end**

```bash
bun run dev    # API + tutti i frontend
stripe listen --forward-to http://localhost:3000/webhooks/stripe   # in altro terminale
```

Loggati come seller, "Aggiungi negozio", compila form, "Continua al pagamento", carta `4242 4242 4242 4242`. Dopo "Pay":
1. Stripe ti rimanda su `/store/new/processing`.
2. Lo spinner gira ~1-2s.
3. Dovresti essere rediretto su `/` con toast "Negozio creato e attivo".
4. Vedi il nuovo negozio nello store switcher.

Verifica DB:

```bash
psql -h localhost -U postgres bibs -c "SELECT s.name, ss.status, ss.fee_amount_cents FROM stores s JOIN store_subscriptions ss ON ss.store_id = s.id;"
```

Verifica Stripe Dashboard (test mode) → Subscriptions: dovresti vedere la sub creata.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/webhooks/services/handlers/checkout-completed.ts apps/api/src/modules/webhooks/services/dispatcher.ts apps/api/tests/integration/stripe-webhook-checkout-completed.test.ts
git commit -m "feat(billing): webhook handler — checkout.session.completed creates store + sub"
```

---

## Task 15: Webhook handlers — `customer.subscription.updated` + `customer.subscription.deleted`

**Files:**
- Create: `apps/api/src/modules/webhooks/services/handlers/subscription-updated.ts`
- Create: `apps/api/src/modules/webhooks/services/handlers/subscription-deleted.ts`
- Modify: `apps/api/src/modules/webhooks/services/dispatcher.ts`
- Test: `apps/api/tests/integration/stripe-webhook-subscription-lifecycle.test.ts`

- [ ] **Step 1: Test fallente per lifecycle transitions**

`apps/api/tests/integration/stripe-webhook-subscription-lifecycle.test.ts`:

```ts
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";

import {
  getTestDb,
  setupTestContainer,
  teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (getTestDb() as any)[prop];
    },
  }),
}));

let currentEvent: any = null;

mock.module("@/lib/stripe", () => ({
  stripe: {
    webhooks: { constructEvent: () => currentEvent },
  },
}));

mock.module("@/lib/env", () => ({
  env: { STRIPE_WEBHOOK_SECRET: "whsec_FAKE" },
}));

import { eq } from "drizzle-orm";
import { isNotNull } from "drizzle-orm";
import { store } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { handleStripeWebhook } from "@/modules/webhooks/services/dispatcher";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller, createTestStore } from "../helpers/fixtures";

beforeAll(async () => {
  await setupTestContainer();
}, 120_000);

afterAll(async () => {
  await teardownTestContainer();
});

beforeEach(async () => {
  await truncateAll(getTestDb());
});

async function seedActiveSubscription(stripeSubId: string) {
  const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });
  const storeRow = await createTestStore(getTestDb(), profile.id);
  const [sub] = await getTestDb()
    .insert(storeSubscription)
    .values({
      storeId: storeRow.id,
      stripeSubscriptionId: stripeSubId,
      stripeCustomerId: "cus_FAKE",
      stripePriceId: "price_FAKE",
      feeAmountCents: 2900,
      currency: "EUR",
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
    })
    .returning();
  return { sub, storeRow };
}

describe("customer.subscription.updated", () => {
  it("transitions to past_due on sub.status='past_due'", async () => {
    const { sub } = await seedActiveSubscription("sub_PD");
    currentEvent = {
      id: "evt_SUB_PD",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_PD",
          status: "past_due",
          cancel_at_period_end: false,
          current_period_end: Math.floor((sub.currentPeriodEnd.getTime()) / 1000),
        },
      },
    };

    await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

    const after = await getTestDb()
      .select()
      .from(storeSubscription)
      .where(eq(storeSubscription.id, sub.id))
      .then((r) => r[0]);
    expect(after.status).toBe("past_due");
  });

  it("transitions to suspended (and sets suspendedAt) on sub.status='unpaid'", async () => {
    const { sub } = await seedActiveSubscription("sub_UNPAID");
    currentEvent = {
      id: "evt_SUB_UNPAID",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_UNPAID",
          status: "unpaid",
          cancel_at_period_end: false,
          current_period_end: Math.floor(Date.now() / 1000),
        },
      },
    };

    await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

    const after = await getTestDb()
      .select()
      .from(storeSubscription)
      .where(eq(storeSubscription.id, sub.id))
      .then((r) => r[0]);
    expect(after.status).toBe("suspended");
    expect(after.suspendedAt).toBeTruthy();
  });

  it("transitions to canceling on cancel_at_period_end=true", async () => {
    const { sub } = await seedActiveSubscription("sub_CXL");
    currentEvent = {
      id: "evt_SUB_CXL",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_CXL",
          status: "active",
          cancel_at_period_end: true,
          current_period_end: Math.floor((sub.currentPeriodEnd.getTime()) / 1000),
        },
      },
    };

    await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

    const after = await getTestDb()
      .select()
      .from(storeSubscription)
      .where(eq(storeSubscription.id, sub.id))
      .then((r) => r[0]);
    expect(after.status).toBe("canceling");
    expect(after.cancelAtPeriodEnd).toBe(true);
  });

  it("clears suspendedAt when transitioning back to active", async () => {
    const { sub } = await seedActiveSubscription("sub_REVIVE");
    await getTestDb()
      .update(storeSubscription)
      .set({ status: "suspended", suspendedAt: new Date() })
      .where(eq(storeSubscription.id, sub.id));

    currentEvent = {
      id: "evt_SUB_REVIVE",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_REVIVE",
          status: "active",
          cancel_at_period_end: false,
          current_period_end: Math.floor((Date.now() + 30 * 86400000) / 1000),
        },
      },
    };

    await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

    const after = await getTestDb()
      .select()
      .from(storeSubscription)
      .where(eq(storeSubscription.id, sub.id))
      .then((r) => r[0]);
    expect(after.status).toBe("active");
    expect(after.suspendedAt).toBeNull();
  });
});

describe("customer.subscription.deleted", () => {
  it("sets status=canceled, canceledAt, and soft-deletes the store", async () => {
    const { sub, storeRow } = await seedActiveSubscription("sub_DELETE");

    currentEvent = {
      id: "evt_SUB_DELETED",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_DELETE" } },
    };

    await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

    const afterSub = await getTestDb()
      .select()
      .from(storeSubscription)
      .where(eq(storeSubscription.id, sub.id))
      .then((r) => r[0]);
    expect(afterSub.status).toBe("canceled");
    expect(afterSub.canceledAt).toBeTruthy();

    const afterStore = await getTestDb()
      .select()
      .from(store)
      .where(eq(store.id, storeRow.id))
      .then((r) => r[0]);
    expect(afterStore.deletedAt).toBeTruthy();
  });
});
```

⚠️ Se `createTestStore` non esiste in `helpers/fixtures.ts`, aggiungilo. Implementazione minima:

```ts
export async function createTestStore(db: any, sellerProfileId: string) {
  const [row] = await db
    .insert(store)
    .values({
      sellerProfileId,
      name: "Test Store",
      addressLine1: "Via Test 1",
      city: "Milano",
      zipCode: "20100",
      country: "IT",
    })
    .returning();
  return row;
}
```

- [ ] **Step 2: Run test (FAIL)**

```bash
cd apps/api && bun test tests/integration/stripe-webhook-subscription-lifecycle.test.ts
```

Expected: tutti i test falliscono perché il dispatcher non gestisce ancora `customer.subscription.*`.

- [ ] **Step 3: Implementa `subscription-updated.ts`**

`apps/api/src/modules/webhooks/services/handlers/subscription-updated.ts`:

```ts
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import {
  storeSubscription,
  type StoreSubscriptionStatus,
} from "@/db/schemas/store-subscription";
import { getLogger } from "@/lib/logger";

const log = getLogger("stripe-handler-subscription-updated");

export function mapStripeStatus(
  sub: Stripe.Subscription,
): StoreSubscriptionStatus {
  if (sub.status === "canceled") return "canceled";
  if (sub.status === "unpaid") return "suspended";
  if (sub.status === "past_due") return "past_due";
  if (sub.cancel_at_period_end) return "canceling";
  if (sub.status === "active" || sub.status === "trialing") return "active";
  log.warn(
    { subId: sub.id, status: sub.status },
    "Unexpected Stripe subscription status, treating as past_due",
  );
  return "past_due";
}

export async function handleSubscriptionUpdated(
  event: Stripe.Event,
): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;

  const existing = await db.query.storeSubscription.findFirst({
    where: eq(storeSubscription.stripeSubscriptionId, sub.id),
  });
  if (!existing) {
    log.warn(
      { stripeSubscriptionId: sub.id },
      "subscription.updated for unknown sub, skipping",
    );
    return;
  }

  const newStatus = mapStripeStatus(sub);

  const update: Partial<typeof storeSubscription.$inferInsert> = {
    status: newStatus,
    currentPeriodEnd: new Date(sub.current_period_end * 1000),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };

  if (newStatus === "suspended" && !existing.suspendedAt) {
    update.suspendedAt = new Date();
  }
  if (newStatus === "active") {
    update.suspendedAt = null;
  }

  await db
    .update(storeSubscription)
    .set(update)
    .where(eq(storeSubscription.id, existing.id));
}
```

- [ ] **Step 4: Implementa `subscription-deleted.ts`**

`apps/api/src/modules/webhooks/services/handlers/subscription-deleted.ts`:

```ts
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { store } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { getLogger } from "@/lib/logger";

const log = getLogger("stripe-handler-subscription-deleted");

export async function handleSubscriptionDeleted(
  event: Stripe.Event,
): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;

  const existing = await db.query.storeSubscription.findFirst({
    where: eq(storeSubscription.stripeSubscriptionId, sub.id),
  });
  if (!existing) {
    log.warn(
      { stripeSubscriptionId: sub.id },
      "subscription.deleted for unknown sub, skipping",
    );
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(storeSubscription)
      .set({
        status: "canceled",
        canceledAt: new Date(),
        // Conserva cancelReason se già impostato; fallback a payment_failed_auto
        cancelReason: existing.cancelReason ?? "payment_failed_auto",
      })
      .where(eq(storeSubscription.id, existing.id));

    await tx
      .update(store)
      .set({ deletedAt: new Date() })
      .where(eq(store.id, existing.storeId));
  });
}
```

- [ ] **Step 5: Wire nel dispatcher**

Modifica `apps/api/src/modules/webhooks/services/dispatcher.ts`. Aggiungi gli import + case:

```ts
import { handleCheckoutCompleted } from "./handlers/checkout-completed";
import { handleSubscriptionUpdated } from "./handlers/subscription-updated";
import { handleSubscriptionDeleted } from "./handlers/subscription-deleted";

async function dispatch(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(event);
    case "customer.subscription.updated":
      return handleSubscriptionUpdated(event);
    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(event);
    default:
      log.info({ eventId: event.id, type: event.type }, "Event not handled");
  }
}
```

- [ ] **Step 6: Run test (PASS)**

```bash
cd apps/api && bun test tests/integration/stripe-webhook-subscription-lifecycle.test.ts
```

Expected: 5 test PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/webhooks/services/handlers/subscription-updated.ts apps/api/src/modules/webhooks/services/handlers/subscription-deleted.ts apps/api/src/modules/webhooks/services/dispatcher.ts apps/api/tests/integration/stripe-webhook-subscription-lifecycle.test.ts apps/api/tests/helpers/fixtures.ts
git commit -m "feat(billing): webhook handlers — subscription.updated + subscription.deleted"
```

---

## Task 16: Webhook handlers — `invoice.payment_succeeded` + `invoice.payment_failed`

**Files:**
- Create: `apps/api/src/modules/webhooks/services/handlers/invoice-paid.ts`
- Create: `apps/api/src/modules/webhooks/services/handlers/invoice-failed.ts`
- Modify: `apps/api/src/modules/webhooks/services/dispatcher.ts`
- Test: `apps/api/tests/integration/stripe-webhook-invoice.test.ts`

- [ ] **Step 1: Test fallente**

`apps/api/tests/integration/stripe-webhook-invoice.test.ts`:

```ts
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";

import {
  getTestDb,
  setupTestContainer,
  teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (getTestDb() as any)[prop];
    },
  }),
}));

let currentEvent: any = null;

mock.module("@/lib/stripe", () => ({
  stripe: {
    webhooks: { constructEvent: () => currentEvent },
  },
}));

mock.module("@/lib/env", () => ({
  env: { STRIPE_WEBHOOK_SECRET: "whsec_FAKE" },
}));

import { eq } from "drizzle-orm";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { handleStripeWebhook } from "@/modules/webhooks/services/dispatcher";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller, createTestStore } from "../helpers/fixtures";

beforeAll(async () => {
  await setupTestContainer();
}, 120_000);

afterAll(async () => {
  await teardownTestContainer();
});

beforeEach(async () => {
  await truncateAll(getTestDb());
});

async function seedSubscription(
  stripeSubId: string,
  status: "active" | "past_due" = "active",
) {
  const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });
  const storeRow = await createTestStore(getTestDb(), profile.id);
  const [sub] = await getTestDb()
    .insert(storeSubscription)
    .values({
      storeId: storeRow.id,
      stripeSubscriptionId: stripeSubId,
      stripeCustomerId: "cus_FAKE",
      stripePriceId: "price_FAKE",
      feeAmountCents: 2900,
      currency: "EUR",
      status,
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
    })
    .returning();
  return sub;
}

describe("invoice.payment_succeeded", () => {
  it("sets status to active and updates currentPeriodEnd", async () => {
    const sub = await seedSubscription("sub_INV_OK", "past_due");

    const newPeriodEnd = Math.floor((Date.now() + 60 * 86400000) / 1000);
    currentEvent = {
      id: "evt_INV_OK",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          subscription: "sub_INV_OK",
          lines: { data: [{ period: { end: newPeriodEnd } }] },
        },
      },
    };

    await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

    const after = await getTestDb()
      .select()
      .from(storeSubscription)
      .where(eq(storeSubscription.id, sub.id))
      .then((r) => r[0]);
    expect(after.status).toBe("active");
    expect(after.currentPeriodEnd.getTime()).toBe(newPeriodEnd * 1000);
    expect(after.suspendedAt).toBeNull();
  });
});

describe("invoice.payment_failed", () => {
  it("sets status to past_due (idempotent)", async () => {
    const sub = await seedSubscription("sub_INV_FAIL", "active");

    currentEvent = {
      id: "evt_INV_FAIL",
      type: "invoice.payment_failed",
      data: { object: { subscription: "sub_INV_FAIL" } },
    };

    await handleStripeWebhook({ payload: "raw", signature: "t=1,v1=ok" });

    const after = await getTestDb()
      .select()
      .from(storeSubscription)
      .where(eq(storeSubscription.id, sub.id))
      .then((r) => r[0]);
    expect(after.status).toBe("past_due");
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
cd apps/api && bun test tests/integration/stripe-webhook-invoice.test.ts
```

- [ ] **Step 3: Implementa `invoice-paid.ts`**

`apps/api/src/modules/webhooks/services/handlers/invoice-paid.ts`:

```ts
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { getLogger } from "@/lib/logger";

const log = getLogger("stripe-handler-invoice-paid");

export async function handleInvoicePaid(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;

  if (!invoice.subscription || typeof invoice.subscription !== "string") {
    log.info(
      { invoiceId: invoice.id },
      "Invoice without subscription, skipping",
    );
    return;
  }

  const existing = await db.query.storeSubscription.findFirst({
    where: eq(storeSubscription.stripeSubscriptionId, invoice.subscription),
  });
  if (!existing) {
    log.warn(
      { stripeSubscriptionId: invoice.subscription },
      "invoice.paid for unknown sub, skipping",
    );
    return;
  }

  // current_period_end may also come from the line item period
  const periodEnd = invoice.lines.data[0]?.period?.end;
  const update: Partial<typeof storeSubscription.$inferInsert> = {
    status: "active",
    suspendedAt: null,
  };
  if (periodEnd) {
    update.currentPeriodEnd = new Date(periodEnd * 1000);
  }

  await db
    .update(storeSubscription)
    .set(update)
    .where(eq(storeSubscription.id, existing.id));
}
```

- [ ] **Step 4: Implementa `invoice-failed.ts`**

`apps/api/src/modules/webhooks/services/handlers/invoice-failed.ts`:

```ts
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { getLogger } from "@/lib/logger";

const log = getLogger("stripe-handler-invoice-failed");

export async function handleInvoiceFailed(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;

  if (!invoice.subscription || typeof invoice.subscription !== "string") return;

  const existing = await db.query.storeSubscription.findFirst({
    where: eq(storeSubscription.stripeSubscriptionId, invoice.subscription),
  });
  if (!existing) {
    log.warn(
      { stripeSubscriptionId: invoice.subscription },
      "invoice.payment_failed for unknown sub, skipping",
    );
    return;
  }

  if (existing.status === "active" || existing.status === "canceling") {
    await db
      .update(storeSubscription)
      .set({ status: "past_due" })
      .where(eq(storeSubscription.id, existing.id));
  }
  // Se è già past_due/suspended, niente da fare: la sub.updated farà il lavoro.
}
```

- [ ] **Step 5: Wire nel dispatcher**

Modifica `dispatcher.ts`:

```ts
import { handleInvoicePaid } from "./handlers/invoice-paid";
import { handleInvoiceFailed } from "./handlers/invoice-failed";

async function dispatch(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(event);
    case "customer.subscription.updated":
      return handleSubscriptionUpdated(event);
    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(event);
    case "invoice.payment_succeeded":
      return handleInvoicePaid(event);
    case "invoice.payment_failed":
      return handleInvoiceFailed(event);
    default:
      log.info({ eventId: event.id, type: event.type }, "Event not handled");
  }
}
```

- [ ] **Step 6: Run test (PASS)**

```bash
cd apps/api && bun test tests/integration/stripe-webhook-invoice.test.ts
```

Expected: 2 test PASS.

- [ ] **Step 7: Run tutta la test suite**

```bash
cd apps/api && bun test
```

Expected: tutti i test esistenti + nuovi PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/webhooks/services/handlers/invoice-paid.ts apps/api/src/modules/webhooks/services/handlers/invoice-failed.ts apps/api/src/modules/webhooks/services/dispatcher.ts apps/api/tests/integration/stripe-webhook-invoice.test.ts
git commit -m "feat(billing): webhook handlers — invoice paid/failed"
```

---

## Task 17: Cancel store + reactivate endpoints

**Files:**
- Modify: `apps/api/src/modules/seller/services/stores.ts` (cancel/reactivate logic)
- Modify: `apps/api/src/modules/seller/routes/stores.ts` (DELETE branched + POST reactivate)
- Test: `apps/api/tests/integration/seller-stores-cancel.test.ts`

- [ ] **Step 1: Test fallente**

`apps/api/tests/integration/seller-stores-cancel.test.ts`:

```ts
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";

import {
  getTestDb,
  setupTestContainer,
  teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (getTestDb() as any)[prop];
    },
  }),
}));

const subUpdate = mock(async () => ({}));
const subCancel = mock(async () => ({}));

mock.module("@/lib/stripe", () => ({
  stripe: {
    subscriptions: { update: subUpdate, cancel: subCancel },
  },
}));

import { eq } from "drizzle-orm";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { cancelStoreSubscription, reactivateStoreSubscription } from "@/modules/seller/services/stores";
import { ServiceError } from "@/lib/errors";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller, createTestStore } from "../helpers/fixtures";

beforeAll(async () => {
  await setupTestContainer();
}, 120_000);

afterAll(async () => {
  await teardownTestContainer();
});

beforeEach(async () => {
  await truncateAll(getTestDb());
  subUpdate.mockClear();
  subCancel.mockClear();
});

async function seedSub(status: "active" | "past_due" | "suspended" | "canceling" | "canceled") {
  const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });
  const storeRow = await createTestStore(getTestDb(), profile.id);
  const [sub] = await getTestDb()
    .insert(storeSubscription)
    .values({
      storeId: storeRow.id,
      stripeSubscriptionId: `sub_${status}`,
      stripeCustomerId: "cus_FAKE",
      stripePriceId: "price_FAKE",
      feeAmountCents: 2900,
      currency: "EUR",
      status,
      currentPeriodEnd: new Date(Date.now() + 15 * 86400000),
    })
    .returning();
  return { sellerProfileId: profile.id, storeId: storeRow.id, sub };
}

describe("cancelStoreSubscription", () => {
  it("active → calls subscriptions.update(cancel_at_period_end=true), sets cancelReason", async () => {
    const { sellerProfileId, storeId, sub } = await seedSub("active");

    const result = await cancelStoreSubscription({ sellerProfileId, storeId });

    expect(result.status).toBe("canceling");
    expect(subUpdate).toHaveBeenCalledWith("sub_active", {
      cancel_at_period_end: true,
    });

    const updated = await getTestDb()
      .select()
      .from(storeSubscription)
      .where(eq(storeSubscription.id, sub.id))
      .then((r) => r[0]);
    expect(updated.cancelReason).toBe("seller_canceled");
  });

  it("past_due → cancel_at_period_end=true (same as active)", async () => {
    const { sellerProfileId, storeId } = await seedSub("past_due");
    const result = await cancelStoreSubscription({ sellerProfileId, storeId });
    expect(result.status).toBe("canceling");
    expect(subUpdate).toHaveBeenCalled();
  });

  it("suspended → calls subscriptions.cancel (immediate)", async () => {
    const { sellerProfileId, storeId } = await seedSub("suspended");
    const result = await cancelStoreSubscription({ sellerProfileId, storeId });
    expect(result.status).toBe("canceled");
    expect(subCancel).toHaveBeenCalledWith("sub_suspended");
  });

  it("canceling → idempotent, no Stripe call", async () => {
    const { sellerProfileId, storeId } = await seedSub("canceling");
    const result = await cancelStoreSubscription({ sellerProfileId, storeId });
    expect(result.status).toBe("canceling");
    expect(subUpdate).not.toHaveBeenCalled();
    expect(subCancel).not.toHaveBeenCalled();
  });

  it("canceled → throws 404", async () => {
    const { sellerProfileId, storeId } = await seedSub("canceled");
    await expect(
      cancelStoreSubscription({ sellerProfileId, storeId }),
    ).rejects.toBeInstanceOf(ServiceError);
  });
});

describe("reactivateStoreSubscription", () => {
  it("canceling → calls subscriptions.update(cancel_at_period_end=false)", async () => {
    const { sellerProfileId, storeId } = await seedSub("canceling");
    const result = await reactivateStoreSubscription({ sellerProfileId, storeId });
    expect(result.status).toBe("active");
    expect(subUpdate).toHaveBeenCalledWith("sub_canceling", {
      cancel_at_period_end: false,
    });
  });

  it("active → throws 409", async () => {
    const { sellerProfileId, storeId } = await seedSub("active");
    await expect(
      reactivateStoreSubscription({ sellerProfileId, storeId }),
    ).rejects.toBeInstanceOf(ServiceError);
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
cd apps/api && bun test tests/integration/seller-stores-cancel.test.ts
```

- [ ] **Step 3: Implementa cancel + reactivate in `services/stores.ts`**

Modifica `apps/api/src/modules/seller/services/stores.ts`. Aggiungi in fondo:

```ts
import { stripe } from "@/lib/stripe";
import { storeSubscription } from "@/db/schemas/store-subscription";

interface CancelParams {
  sellerProfileId: string;
  storeId: string;
}

interface CancelResult {
  status: "canceling" | "canceled";
  effectiveAt: Date;
}

export async function cancelStoreSubscription(
  params: CancelParams,
): Promise<CancelResult> {
  const sub = await loadOwnedSubscription(params);

  switch (sub.status) {
    case "active":
    case "past_due": {
      // Pre-set cancelReason BEFORE calling Stripe (so the resulting webhook finds it)
      await db
        .update(storeSubscription)
        .set({ cancelReason: "seller_canceled" })
        .where(eq(storeSubscription.id, sub.id));
      await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
      return { status: "canceling", effectiveAt: sub.currentPeriodEnd };
    }
    case "suspended": {
      await db
        .update(storeSubscription)
        .set({ cancelReason: "seller_canceled" })
        .where(eq(storeSubscription.id, sub.id));
      await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
      return { status: "canceled", effectiveAt: new Date() };
    }
    case "canceling": {
      // Idempotent
      return { status: "canceling", effectiveAt: sub.currentPeriodEnd };
    }
    case "canceled": {
      throw new ServiceError(404, "Negozio già cancellato");
    }
  }
}

interface ReactivateResult {
  status: "active";
}

export async function reactivateStoreSubscription(
  params: CancelParams,
): Promise<ReactivateResult> {
  const sub = await loadOwnedSubscription(params);

  if (sub.status !== "canceling") {
    throw new ServiceError(409, "Negozio non in cancellazione");
  }

  await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    cancel_at_period_end: false,
  });

  return { status: "active" };
}

async function loadOwnedSubscription(params: CancelParams) {
  const sub = await db.query.storeSubscription.findFirst({
    where: eq(storeSubscription.storeId, params.storeId),
    with: { store: { columns: { sellerProfileId: true } } },
  });
  if (!sub) {
    throw new ServiceError(404, "Subscription non trovata");
  }
  if (sub.store.sellerProfileId !== params.sellerProfileId) {
    throw new ServiceError(403, "Non sei owner di questo negozio");
  }
  return sub;
}
```

⚠️ Aggiungi gli `import` mancanti (`ServiceError`, `db`, `eq`) se non già presenti.

- [ ] **Step 4: Wire route in `routes/stores.ts`**

Trova il `DELETE /stores/:storeId` esistente e sostituiscilo:

```ts
.delete(
  "/stores/:storeId",
  async (ctx) => {
    const { sellerProfile: sp, params, store: ctxStore } = withSeller(ctx);
    const pino = getLogger(ctxStore);
    const data = await cancelStoreSubscription({
      sellerProfileId: sp.id,
      storeId: params.storeId,
    });
    pino.info(
      { storeId: params.storeId, action: "store_subscription_canceled", result: data },
      "Store subscription canceled",
    );
    return ok(data);
  },
  {
    params: t.Object({ storeId: t.String() }),
    response: withErrors({
      200: okRes(
        t.Object({
          status: t.Union([t.Literal("canceling"), t.Literal("canceled")]),
          effectiveAt: t.Date(),
        }),
      ),
    }),
    detail: {
      summary: "Cancella subscription negozio",
      description:
        "Cancel at period end per negozi active/past_due/canceling (idempotente). Cancel immediato per suspended.",
      tags: ["Seller - Stores"],
    },
  },
)
```

E aggiungi reactivate come nuovo POST:

```ts
.post(
  "/stores/:storeId/reactivate",
  async (ctx) => {
    const { sellerProfile: sp, params, store: ctxStore } = withSeller(ctx);
    const pino = getLogger(ctxStore);
    const data = await reactivateStoreSubscription({
      sellerProfileId: sp.id,
      storeId: params.storeId,
    });
    pino.info(
      { storeId: params.storeId, action: "store_subscription_reactivated" },
      "Store subscription reactivated",
    );
    return ok(data);
  },
  {
    params: t.Object({ storeId: t.String() }),
    response: withErrors({
      200: okRes(t.Object({ status: t.Literal("active") })),
    }),
    detail: {
      summary: "Annulla la cancellazione in corso",
      description: "Solo per status='canceling' prima del period end.",
      tags: ["Seller - Stores"],
    },
  },
)
```

Import necessari in `routes/stores.ts`:

```ts
import {
  cancelStoreSubscription,
  reactivateStoreSubscription,
} from "../services/stores";
```

⚠️ **Rimuovi** la vecchia logica di "delete store hard-delete" se esisteva: oggi la sopravvivenza dello store passa per il ciclo subscription.

- [ ] **Step 5: Vecchio `deleteStore` admin-only**

Se esiste ancora un service `deleteStore` che hard-deletes la riga, lascialo ma esponilo solo via route admin (Task 22 ce ne occuperemo). Per ora, basta che NON sia esposto sul seller.

- [ ] **Step 6: Run test (PASS)**

```bash
cd apps/api && bun test tests/integration/seller-stores-cancel.test.ts
```

Expected: 7 test PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/seller/services/stores.ts apps/api/src/modules/seller/routes/stores.ts apps/api/tests/integration/seller-stores-cancel.test.ts
git commit -m "feat(billing): branched cancel + reactivate endpoints for store subscriptions"
```

---

## Task 18: Billing UI seller — summary + subscriptions table + Customer Portal

**Files:**
- Create: `apps/api/src/modules/seller/services/billing.ts`
- Create: `apps/api/src/modules/seller/routes/billing.ts`
- Modify: `apps/api/src/modules/seller/index.ts` (mount)
- Create: `apps/seller/src/routes/_authenticated/billing.tsx`
- Modify: `apps/seller/src/components/app-sidebar.tsx` (link "Billing")
- Test: `apps/api/tests/integration/seller-billing-summary.test.ts`

- [ ] **Step 1: Test fallente — summary**

`apps/api/tests/integration/seller-billing-summary.test.ts`:

```ts
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";

import {
  getTestDb,
  setupTestContainer,
  teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (getTestDb() as any)[prop];
    },
  }),
}));

import { storeSubscription } from "@/db/schemas/store-subscription";
import { getBillingSummary, listBillingSubscriptions } from "@/modules/seller/services/billing";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller, createTestStore } from "../helpers/fixtures";

beforeAll(async () => {
  await setupTestContainer();
}, 120_000);

afterAll(async () => {
  await teardownTestContainer();
});

beforeEach(async () => {
  await truncateAll(getTestDb());
});

async function seedSubs(
  sellerProfileId: string,
  specs: Array<{ status: "active" | "past_due" | "canceling" | "suspended" | "canceled"; fee: number; periodEnd: Date }>,
) {
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const storeRow = await createTestStore(getTestDb(), sellerProfileId);
    await getTestDb().insert(storeSubscription).values({
      storeId: storeRow.id,
      stripeSubscriptionId: `sub_${i}`,
      stripeCustomerId: "cus_FAKE",
      stripePriceId: "price_FAKE",
      feeAmountCents: s.fee,
      currency: "EUR",
      status: s.status,
      currentPeriodEnd: s.periodEnd,
    });
  }
}

describe("getBillingSummary", () => {
  it("aggregates active+past_due+canceling subscriptions, picks the soonest renewal", async () => {
    const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });
    await seedSubs(profile.id, [
      { status: "active", fee: 2900, periodEnd: new Date("2027-01-24") },
      { status: "past_due", fee: 2900, periodEnd: new Date("2027-01-10") },
      { status: "canceling", fee: 2900, periodEnd: new Date("2027-01-05") },
      { status: "suspended", fee: 2900, periodEnd: new Date("2027-01-01") },
      { status: "canceled", fee: 2900, periodEnd: new Date("2027-01-01") },
    ]);

    const summary = await getBillingSummary({ sellerProfileId: profile.id });

    expect(summary.activeStoresCount).toBe(3);
    expect(summary.totalMonthlyCents).toBe(2900 * 3);
    expect(summary.nextRenewal?.date.toISOString()).toBe(
      new Date("2027-01-05").toISOString(),
    );
  });

  it("returns zeroes for sellers with no active subscriptions", async () => {
    const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });
    const summary = await getBillingSummary({ sellerProfileId: profile.id });
    expect(summary.activeStoresCount).toBe(0);
    expect(summary.totalMonthlyCents).toBe(0);
    expect(summary.nextRenewal).toBeNull();
  });
});

describe("listBillingSubscriptions", () => {
  it("returns all non-canceled subs with store details", async () => {
    const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });
    await seedSubs(profile.id, [
      { status: "active", fee: 2900, periodEnd: new Date("2027-01-24") },
      { status: "suspended", fee: 2900, periodEnd: new Date("2027-01-01") },
      { status: "canceled", fee: 2900, periodEnd: new Date("2027-01-01") },
    ]);

    const rows = await listBillingSubscriptions({ sellerProfileId: profile.id });

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.status).sort()).toEqual(["active", "suspended"]);
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
cd apps/api && bun test tests/integration/seller-billing-summary.test.ts
```

- [ ] **Step 3: Implementa il service**

`apps/api/src/modules/seller/services/billing.ts`:

```ts
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { store } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { env } from "@/lib/env";
import { ServiceError } from "@/lib/errors";
import { stripe } from "@/lib/stripe";

const BILLABLE_STATUSES = ["active", "past_due", "canceling"] as const;
const BACKOFFICE_STATUSES = [
  "active",
  "past_due",
  "canceling",
  "suspended",
] as const;

interface SellerScope {
  sellerProfileId: string;
}

export async function getBillingSummary(params: SellerScope) {
  const rows = await db
    .select({
      storeId: storeSubscription.storeId,
      storeName: store.name,
      status: storeSubscription.status,
      feeAmountCents: storeSubscription.feeAmountCents,
      currentPeriodEnd: storeSubscription.currentPeriodEnd,
    })
    .from(storeSubscription)
    .innerJoin(store, eq(storeSubscription.storeId, store.id))
    .where(
      and(
        eq(store.sellerProfileId, params.sellerProfileId),
        isNull(store.deletedAt),
        inArray(storeSubscription.status, BILLABLE_STATUSES as unknown as string[]),
      ),
    )
    .orderBy(asc(storeSubscription.currentPeriodEnd));

  const totalMonthlyCents = rows.reduce((sum, r) => sum + r.feeAmountCents, 0);
  const activeStoresCount = rows.length;
  const nextRenewal =
    rows.length > 0
      ? {
          storeId: rows[0].storeId,
          storeName: rows[0].storeName,
          date: rows[0].currentPeriodEnd,
          amountCents: rows[0].feeAmountCents,
        }
      : null;

  return { totalMonthlyCents, activeStoresCount, nextRenewal };
}

export async function listBillingSubscriptions(params: SellerScope) {
  return db
    .select({
      storeId: storeSubscription.storeId,
      storeName: store.name,
      status: storeSubscription.status,
      feeAmountCents: storeSubscription.feeAmountCents,
      currency: storeSubscription.currency,
      currentPeriodEnd: storeSubscription.currentPeriodEnd,
      cancelAtPeriodEnd: storeSubscription.cancelAtPeriodEnd,
      suspendedAt: storeSubscription.suspendedAt,
    })
    .from(storeSubscription)
    .innerJoin(store, eq(storeSubscription.storeId, store.id))
    .where(
      and(
        eq(store.sellerProfileId, params.sellerProfileId),
        isNull(store.deletedAt),
        inArray(storeSubscription.status, BACKOFFICE_STATUSES as unknown as string[]),
      ),
    )
    .orderBy(asc(store.name));
}

export async function createPortalSession(params: {
  sellerProfileId: string;
  stripeCustomerId: string | null;
}): Promise<{ url: string }> {
  if (!params.stripeCustomerId) {
    throw new ServiceError(
      404,
      "Nessun Customer Stripe associato a questo seller",
    );
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: params.stripeCustomerId,
    return_url: `${env.SELLER_APP_URL}/billing`,
  });
  return { url: session.url };
}
```

- [ ] **Step 4: Crea route billing**

`apps/api/src/modules/seller/routes/billing.ts`:

```ts
import { Elysia, t } from "elysia";
import { ok } from "@/lib/responses";
import { okRes, withErrors } from "@/lib/schemas";
import { storeSubscriptionStatuses } from "@/db/schemas/store-subscription";
import { withSellerAuth } from "../context";
import {
  createPortalSession,
  getBillingSummary,
  listBillingSubscriptions,
} from "../services/billing";

const SummarySchema = t.Object({
  totalMonthlyCents: t.Integer(),
  activeStoresCount: t.Integer(),
  nextRenewal: t.Nullable(
    t.Object({
      storeId: t.String(),
      storeName: t.String(),
      date: t.Date(),
      amountCents: t.Integer(),
    }),
  ),
});

const SubscriptionRowSchema = t.Object({
  storeId: t.String(),
  storeName: t.String(),
  status: t.Union(
    storeSubscriptionStatuses.map((s) => t.Literal(s)) as unknown as any[],
  ),
  feeAmountCents: t.Integer(),
  currency: t.String(),
  currentPeriodEnd: t.Date(),
  cancelAtPeriodEnd: t.Boolean(),
  suspendedAt: t.Nullable(t.Date()),
});

const PortalSchema = t.Object({ url: t.String() });

export const billingRoutes = new Elysia({ prefix: "/billing" })
  .get(
    "/summary",
    async (ctx) => {
      const { sellerProfile: sp } = withSellerAuth(ctx);
      const data = await getBillingSummary({ sellerProfileId: sp.id });
      return ok(data);
    },
    {
      response: withErrors({ 200: okRes(SummarySchema) }),
      detail: { summary: "Riepilogo billing", tags: ["Seller - Billing"] },
    },
  )
  .get(
    "/subscriptions",
    async (ctx) => {
      const { sellerProfile: sp } = withSellerAuth(ctx);
      const data = await listBillingSubscriptions({ sellerProfileId: sp.id });
      return ok(data);
    },
    {
      response: withErrors({ 200: okRes(t.Array(SubscriptionRowSchema)) }),
      detail: { summary: "Lista subscription seller", tags: ["Seller - Billing"] },
    },
  )
  .post(
    "/portal",
    async (ctx) => {
      const { sellerProfile: sp } = withSellerAuth(ctx);
      const data = await createPortalSession({
        sellerProfileId: sp.id,
        stripeCustomerId: sp.stripeCustomerId,
      });
      return ok(data);
    },
    {
      response: withErrors({ 200: okRes(PortalSchema) }),
      detail: { summary: "Customer Portal session", tags: ["Seller - Billing"] },
    },
  );
```

- [ ] **Step 5: Mount in `modules/seller/index.ts`**

```ts
import { billingRoutes } from "./routes/billing";
// dentro la chain:
.use(billingRoutes)
```

- [ ] **Step 6: Run test (PASS)**

```bash
cd apps/api && bun test tests/integration/seller-billing-summary.test.ts
```

- [ ] **Step 7: Crea la pagina `apps/seller/src/routes/_authenticated/billing.tsx`**

```tsx
import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@bibs/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bibs/ui/components/table";
import { Spinner } from "@bibs/ui/components/spinner";
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/billing")({
  component: BillingPage,
});

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Attivo", variant: "default" },
  past_due: { label: "Rinnovo fallito", variant: "destructive" },
  canceling: { label: "In cancellazione", variant: "outline" },
  suspended: { label: "Sospeso", variant: "destructive" },
};

function formatEuro(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

function BillingPage() {
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["seller", "billing", "summary"],
    queryFn: async () => {
      const r = await api().seller.billing.summary.get();
      if (r.error) throw new Error(r.error.value?.message);
      return r.data?.data;
    },
  });

  const { data: subs, isLoading: subsLoading } = useQuery({
    queryKey: ["seller", "billing", "subscriptions"],
    queryFn: async () => {
      const r = await api().seller.billing.subscriptions.get();
      if (r.error) throw new Error(r.error.value?.message);
      return r.data?.data ?? [];
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const r = await api().seller.billing.portal.post();
      if (r.error) throw new Error(r.error.value?.message);
      return r.data?.data;
    },
    onSuccess: (data) => {
      if (data?.url) window.location.href = data.url;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" description="Riepilogo dei pagamenti e dei rinnovi" />

      <Card>
        <CardHeader>
          <CardTitle>Riepilogo</CardTitle>
          <CardDescription>I tuoi negozi attivi e i prossimi rinnovi.</CardDescription>
        </CardHeader>
        <CardContent>
          {summaryLoading || !summary ? (
            <Spinner />
          ) : summary.activeStoresCount === 0 ? (
            <p className="text-sm text-muted-foreground">Non hai ancora negozi attivi.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-base">
                Stai pagando <strong>{formatEuro(summary.totalMonthlyCents)}/mese</strong> per{" "}
                <strong>{summary.activeStoresCount}</strong>{" "}
                {summary.activeStoresCount === 1 ? "negozio attivo" : "negozi attivi"}.
              </p>
              {summary.nextRenewal && (
                <p className="text-sm text-muted-foreground">
                  Prossimo rinnovo:{" "}
                  <strong>
                    {format(new Date(summary.nextRenewal.date), "d MMMM yyyy", { locale: it })}
                  </strong>{" "}
                  per <strong>{summary.nextRenewal.storeName}</strong> (
                  {formatEuro(summary.nextRenewal.amountCents)}).
                </p>
              )}
              <div>
                <Button
                  variant="outline"
                  onClick={() => portalMutation.mutate()}
                  disabled={portalMutation.isPending}
                >
                  {portalMutation.isPending ? <Spinner /> : "Gestisci pagamenti su Stripe"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Abbonamenti per negozio</CardTitle>
        </CardHeader>
        <CardContent>
          {subsLoading ? (
            <Spinner />
          ) : !subs || subs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessun abbonamento attivo.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Negozio</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Quota</TableHead>
                  <TableHead>Prossimo rinnovo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subs.map((s) => {
                  const badge = STATUS_BADGE[s.status] ?? { label: s.status, variant: "outline" as const };
                  return (
                    <TableRow key={s.storeId}>
                      <TableCell>{s.storeName}</TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell>{formatEuro(s.feeAmountCents)}/mese</TableCell>
                      <TableCell>
                        {s.status === "suspended"
                          ? `Scaduto il ${format(new Date(s.currentPeriodEnd), "d MMM yyyy", { locale: it })}`
                          : s.status === "canceling"
                          ? `Disattivazione ${format(new Date(s.currentPeriodEnd), "d MMM yyyy", { locale: it })}`
                          : format(new Date(s.currentPeriodEnd), "d MMM yyyy", { locale: it })}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 8: Aggiungi link "Billing" nella sidebar**

Modifica `apps/seller/src/components/app-sidebar.tsx` (o equivalente). Aggiungi una voce nav con `to: "/billing"` e icona Wallet/CreditCard (`lucide-react`).

- [ ] **Step 9: Typecheck**

```bash
bun run --filter '*' typecheck
```

- [ ] **Step 10: Smoke test**

```bash
bun run dev
```

Naviga `http://localhost:3002/billing` come seller con 1+ negozi. Verifica: riepilogo mostra il numero corretto, tabella popolata, click su "Gestisci pagamenti su Stripe" redirige al Customer Portal hosted da Stripe.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/modules/seller/services/billing.ts apps/api/src/modules/seller/routes/billing.ts apps/api/src/modules/seller/index.ts apps/api/tests/integration/seller-billing-summary.test.ts apps/seller/src/routes/_authenticated/billing.tsx apps/seller/src/components/app-sidebar.tsx apps/seller/src/routeTree.gen.ts
git commit -m "feat(billing): seller /billing page with summary, subs table, customer portal"
```

---

## Task 19: StoreBillingBanner — past_due / canceling / suspended

**Files:**
- Create: `apps/seller/src/components/store-billing-banner.tsx`
- Modify: `apps/seller/src/routes/_authenticated.tsx` (montaggio banner)
- Modify: `apps/seller/src/hooks/use-active-store.ts` (esponi subscription status sull'active store, se non già)
- Modify: `apps/seller/messages/{it,en}.json`

- [ ] **Step 1: Verifica `useActiveStore` shape**

```bash
cat apps/seller/src/hooks/use-active-store.ts
```

Se il hook ritorna solo `{ activeStore: Store }`, va esteso per esporre anche la subscription status. Pattern:

```ts
const { data: subscriptions } = useQuery({
  queryKey: ["seller", "billing", "subscriptions"],
  queryFn: async () => {
    const r = await api().seller.billing.subscriptions.get();
    return r.data?.data ?? [];
  },
});

const activeSubscription = activeStore
  ? subscriptions?.find((s) => s.storeId === activeStore.id)
  : null;

return { activeStore, activeSubscription, setActiveStoreId };
```

Adegua il return type del hook + tutti i call site (typecheck propaga).

- [ ] **Step 2: Crea il componente banner**

`apps/seller/src/components/store-billing-banner.tsx`:

```tsx
import { Alert, AlertDescription, AlertTitle } from "@bibs/ui/components/alert";
import { Button } from "@bibs/ui/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { AlertTriangleIcon, LockIcon, CalendarIcon } from "lucide-react";
import { toast } from "@bibs/ui/components/sonner";
import { useActiveStore } from "@/hooks/use-active-store";
import { api } from "@/lib/api";

export function StoreBillingBanner() {
  const { activeStore, activeSubscription } = useActiveStore();
  const qc = useQueryClient();

  const portalMutation = useMutation({
    mutationFn: async () => {
      const r = await api().seller.billing.portal.post();
      if (r.error) throw new Error(r.error.value?.message);
      return r.data?.data;
    },
    onSuccess: (data) => {
      if (data?.url) window.location.href = data.url;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reactivateMutation = useMutation({
    mutationFn: async () => {
      if (!activeStore) throw new Error("No active store");
      const r = await api()
        .seller.stores({ storeId: activeStore.id })
        .reactivate.post();
      if (r.error) throw new Error(r.error.value?.message);
      return r.data?.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["seller", "billing"] });
      toast.success("Cancellazione annullata");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!activeStore || !activeSubscription) return null;

  if (activeSubscription.status === "past_due") {
    return (
      <Alert variant="destructive" className="border-orange-500 bg-orange-50">
        <AlertTriangleIcon className="h-4 w-4" />
        <AlertTitle>Rinnovo non riuscito per {activeStore.name}</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>
            Aggiorna il metodo di pagamento entro il{" "}
            <strong>
              {format(new Date(activeSubscription.currentPeriodEnd), "d MMMM yyyy", { locale: it })}
            </strong>{" "}
            o il negozio sarà sospeso.
          </span>
          <Button
            size="sm"
            onClick={() => portalMutation.mutate()}
            disabled={portalMutation.isPending}
          >
            Aggiorna pagamento
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (activeSubscription.status === "canceling") {
    return (
      <Alert className="border-blue-500 bg-blue-50">
        <CalendarIcon className="h-4 w-4" />
        <AlertTitle>{activeStore.name}: cancellazione programmata</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>
            Il negozio sarà disattivato il{" "}
            <strong>
              {format(new Date(activeSubscription.currentPeriodEnd), "d MMMM yyyy", { locale: it })}
            </strong>
            . Fino ad allora rimane attivo e visibile ai clienti.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => reactivateMutation.mutate()}
            disabled={reactivateMutation.isPending}
          >
            Annulla cancellazione
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (activeSubscription.status === "suspended") {
    return (
      <Alert variant="destructive">
        <LockIcon className="h-4 w-4" />
        <AlertTitle>{activeStore.name} è sospeso</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>Non è visibile ai clienti. Paga il rinnovo per riattivarlo.</span>
          <Button
            size="sm"
            onClick={() => portalMutation.mutate()}
            disabled={portalMutation.isPending}
          >
            Riattiva ora
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
```

⚠️ Se `Alert` non è nel package @bibs/ui, aggiungilo via shadcn:

```bash
cd packages/ui && bunx shadcn@latest add alert
```

- [ ] **Step 3: Monta nel layout `_authenticated.tsx`**

Apri `apps/seller/src/routes/_authenticated.tsx`. Trova dove viene renderizzato il `<Outlet />` (il contenuto delle route figlie). Aggiungi il banner sopra:

```tsx
import { StoreBillingBanner } from "@/components/store-billing-banner";

// dentro il render:
<>
  <StoreBillingBanner />
  <Outlet />
</>
```

Posizionalo in modo che resti sticky-top se serve (puoi wrappare in `<div className="sticky top-0 z-40">`).

- [ ] **Step 4: Read-only mode per `suspended`**

Per disabilitare le interazioni quando il negozio è sospeso, crea un context provider che esponga `isReadOnly = activeSubscription?.status === 'suspended'` e wrappalo attorno all'`<Outlet />`. Le pagine di settings/prodotti possono leggerlo via hook `useIsReadOnly()` e disabilitare i form (`<fieldset disabled={readOnly}>`).

Implementazione minima — aggiungi a `use-active-store.ts`:

```ts
export function useIsStoreReadOnly() {
  const { activeSubscription } = useActiveStore();
  return activeSubscription?.status === "suspended";
}
```

Applica `useIsStoreReadOnly()` ai form chiave (almeno `apps/seller/src/routes/_authenticated/store/index.tsx` e `products`). Wrap dei form principali in `<fieldset disabled={readOnly}>`. Lasciare gli altri form intatti è accettabile in MVP — il banner è già un signal forte.

- [ ] **Step 5: Stringhe Paraglide**

In `apps/seller/messages/it.json` aggiungi se non già presenti:

```json
"billing.banner.past_due.title": "Rinnovo non riuscito per {storeName}",
"billing.banner.past_due.body": "Aggiorna il metodo di pagamento entro il {date} o il negozio sarà sospeso.",
"billing.banner.past_due.cta": "Aggiorna pagamento",
"billing.banner.canceling.title": "{storeName}: cancellazione programmata",
"billing.banner.canceling.body": "Il negozio sarà disattivato il {date}.",
"billing.banner.canceling.cta": "Annulla cancellazione",
"billing.banner.suspended.title": "{storeName} è sospeso",
"billing.banner.suspended.body": "Non è visibile ai clienti. Paga il rinnovo per riattivarlo.",
"billing.banner.suspended.cta": "Riattiva ora"
```

Aggiorna `store-billing-banner.tsx` per usare le stringhe i18n via Paraglide invece dei testi hardcoded.

- [ ] **Step 6: Typecheck + smoke**

```bash
bun run --filter @bibs/seller typecheck
bun run dev:seller
```

Smoke manuale: con dev tools di Stripe Dashboard, simula un evento `invoice.payment_failed` su una sub di test (`stripe trigger invoice.payment_failed`). Verifica che dopo il webhook (controllabile in `psql` che lo status sia `past_due`), il banner appaia in alto nella seller app sul negozio.

- [ ] **Step 7: Commit**

```bash
git add apps/seller/src/components/store-billing-banner.tsx apps/seller/src/routes/_authenticated.tsx apps/seller/src/hooks/use-active-store.ts apps/seller/messages/ apps/seller/src/routes
git commit -m "feat(billing): StoreBillingBanner for past_due/canceling/suspended states"
```

---

## Task 20: Cancel store dialog + reactivate UI

**Files:**
- Create: `apps/seller/src/features/billing/components/cancel-store-dialog.tsx`
- Modify: `apps/seller/src/routes/_authenticated/store.tsx` (o `store/index.tsx`) — "Zona di pericolo"
- Modify: `apps/seller/src/routes/_authenticated/billing.tsx` — kebab action per riga

- [ ] **Step 1: Crea il dialog**

`apps/seller/src/features/billing/components/cancel-store-dialog.tsx`:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@bibs/ui/components/alert-dialog";
import { Button } from "@bibs/ui/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@bibs/ui/components/sonner";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { api } from "@/lib/api";

interface Props {
  storeId: string;
  storeName: string;
  status: "active" | "past_due" | "canceling" | "suspended";
  currentPeriodEnd: Date | string;
  trigger: React.ReactNode;
}

export function CancelStoreDialog({
  storeId,
  storeName,
  status,
  currentPeriodEnd,
  trigger,
}: Props) {
  const qc = useQueryClient();

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const r = await api().seller.stores({ storeId }).delete();
      if (r.error) throw new Error(r.error.value?.message);
      return r.data?.data;
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["seller", "billing"] });
      void qc.invalidateQueries({ queryKey: ["stores"] });
      if (data?.status === "canceled") {
        toast.success(`${storeName} archiviato`);
      } else {
        toast.success(`Cancellazione programmata per ${storeName}`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isSuspended = status === "suspended";
  const periodEndDate = format(new Date(currentPeriodEnd), "d MMMM yyyy", { locale: it });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isSuspended
              ? `Cancellare definitivamente "${storeName}"?`
              : `Cancellare il negozio "${storeName}"?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isSuspended ? (
              <>
                Il negozio è già sospeso per mancato pagamento. Cancellandolo, sarà{" "}
                <strong>archiviato immediatamente</strong>. I dati storici (ordini, prodotti,
                recensioni) saranno conservati ma in sola lettura.
              </>
            ) : (
              <>
                Continuerai a pagare e usarlo normalmente fino al{" "}
                <strong>{periodEndDate}</strong> (fine del ciclo già pagato). Dopo quella data
                il negozio sarà archiviato: non sarà più visibile ai clienti e tu non potrai
                più modificarlo. I dati storici saranno conservati ma in sola lettura.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annulla</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
          >
            {isSuspended ? "Cancella definitivamente" : "Conferma cancellazione"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 2: "Zona di pericolo" nella pagina settings store**

Apri `apps/seller/src/routes/_authenticated/store/index.tsx` (o equivalente per impostazioni negozio). Aggiungi in fondo una sezione:

```tsx
import { CancelStoreDialog } from "@/features/billing/components/cancel-store-dialog";

// ... dopo le altre sezioni:
{activeSubscription && activeSubscription.status !== "canceled" && activeSubscription.status !== "canceling" && (
  <div className="rounded-lg border border-destructive/30 p-4">
    <h3 className="text-sm font-semibold text-destructive">Zona di pericolo</h3>
    <p className="mt-1 text-sm text-muted-foreground">
      Cancellare il negozio interrompe la subscription mensile e archivia i dati al termine del ciclo già pagato.
    </p>
    <CancelStoreDialog
      storeId={activeStore.id}
      storeName={activeStore.name}
      status={activeSubscription.status}
      currentPeriodEnd={activeSubscription.currentPeriodEnd}
      trigger={
        <Button variant="destructive" className="mt-3">
          Cancella questo negozio
        </Button>
      }
    />
  </div>
)}
```

Verifica i nomi (`activeSubscription`, `activeStore`) e gli import in base alla struttura del file. Il pattern `useActiveStore()` è già usato in altre pagine.

- [ ] **Step 3: Kebab action nella tabella `/billing`**

Modifica `apps/seller/src/routes/_authenticated/billing.tsx`. Sostituisci la colonna "Prossimo rinnovo" o aggiungi una colonna "Azioni" con un `<DropdownMenu>`:

```tsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bibs/ui/components/dropdown-menu";
import { MoreVerticalIcon } from "lucide-react";
import { CancelStoreDialog } from "@/features/billing/components/cancel-store-dialog";

// nella TableRow:
<TableCell>
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon" aria-label="Azioni">
        <MoreVerticalIcon className="h-4 w-4" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => portalMutation.mutate()}>
        Gestisci pagamento
      </DropdownMenuItem>
      {(s.status === "active" || s.status === "past_due" || s.status === "suspended") && (
        <CancelStoreDialog
          storeId={s.storeId}
          storeName={s.storeName}
          status={s.status}
          currentPeriodEnd={s.currentPeriodEnd}
          trigger={
            <DropdownMenuItem
              className="text-destructive"
              onSelect={(e) => e.preventDefault()}
            >
              Cancella
            </DropdownMenuItem>
          }
        />
      )}
      {s.status === "canceling" && (
        <DropdownMenuItem onSelect={() => reactivateMutation.mutate(s.storeId)}>
          Annulla cancellazione
        </DropdownMenuItem>
      )}
      {s.status === "suspended" && (
        <DropdownMenuItem onSelect={() => portalMutation.mutate()}>
          Riattiva ora
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  </DropdownMenu>
</TableCell>
```

Aggiungi `reactivateMutation` a fianco della `portalMutation` esistente:

```tsx
const reactivateMutation = useMutation({
  mutationFn: async (storeId: string) => {
    const r = await api().seller.stores({ storeId }).reactivate.post();
    if (r.error) throw new Error(r.error.value?.message);
    return r.data?.data;
  },
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["seller", "billing"] });
    toast.success("Cancellazione annullata");
  },
  onError: (e: Error) => toast.error(e.message),
});
```

- [ ] **Step 4: Typecheck**

```bash
bun run --filter @bibs/seller typecheck
```

- [ ] **Step 5: Smoke test**

Naviga `/billing` con un seller multi-negozio. Click kebab su un negozio active, click "Cancella", conferma. Banner di canceling appare in `_authenticated`. Click "Annulla cancellazione" sulla riga → banner sparisce.

- [ ] **Step 6: Commit**

```bash
git add apps/seller/src/features/billing/components/cancel-store-dialog.tsx apps/seller/src/routes/_authenticated/store apps/seller/src/routes/_authenticated/billing.tsx
git commit -m "feat(billing): cancel store dialog + reactivate UI"
```

---

## Task 21: Storico fatture in `/billing` (Stripe API lazy)

**Files:**
- Modify: `apps/api/src/modules/seller/services/billing.ts` (aggiungi `listInvoices`)
- Modify: `apps/api/src/modules/seller/routes/billing.ts`
- Modify: `apps/seller/src/routes/_authenticated/billing.tsx` (aggiungi sezione storico)
- Test: `apps/api/tests/integration/seller-billing-invoices.test.ts`

- [ ] **Step 1: Test fallente**

`apps/api/tests/integration/seller-billing-invoices.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

import {
  getTestDb,
  setupTestContainer,
  teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (getTestDb() as any)[prop];
    },
  }),
}));

const invoicesList = mock(async () => ({
  data: [
    {
      id: "in_1",
      created: 1700000000,
      amount_paid: 2900,
      currency: "eur",
      status: "paid",
      invoice_pdf: "https://stripe.test/in_1.pdf",
      subscription: "sub_FAKE",
      lines: { data: [{ description: "Test Store" }] },
    },
  ],
  has_more: false,
}));

mock.module("@/lib/stripe", () => ({
  stripe: {
    invoices: { list: invoicesList },
  },
}));

import { listInvoices } from "@/modules/seller/services/billing";
import { ServiceError } from "@/lib/errors";
import { sellerProfile } from "@/db/schemas/seller";
import { eq } from "drizzle-orm";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller } from "../helpers/fixtures";

beforeAll(async () => {
  await setupTestContainer();
}, 120_000);

afterAll(async () => {
  await teardownTestContainer();
});

beforeEach(async () => {
  await truncateAll(getTestDb());
});

describe("listInvoices", () => {
  it("calls stripe.invoices.list with the seller's customer id", async () => {
    const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });
    await getTestDb()
      .update(sellerProfile)
      .set({ stripeCustomerId: "cus_FAKE" })
      .where(eq(sellerProfile.id, profile.id));

    const result = await listInvoices({
      sellerProfileId: profile.id,
      limit: 10,
      startingAfter: undefined,
    });

    expect(invoicesList).toHaveBeenCalledWith({
      customer: "cus_FAKE",
      limit: 10,
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].amountPaidCents).toBe(2900);
    expect(result.hasMore).toBe(false);
  });

  it("throws when seller has no stripeCustomerId yet", async () => {
    const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });
    await expect(
      listInvoices({ sellerProfileId: profile.id, limit: 10, startingAfter: undefined }),
    ).rejects.toBeInstanceOf(ServiceError);
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
cd apps/api && bun test tests/integration/seller-billing-invoices.test.ts
```

- [ ] **Step 3: Implementa `listInvoices`**

Aggiungi a `apps/api/src/modules/seller/services/billing.ts`:

```ts
import { sellerProfile } from "@/db/schemas/seller";

interface ListInvoicesParams {
  sellerProfileId: string;
  limit: number;
  startingAfter: string | undefined;
}

export async function listInvoices(params: ListInvoicesParams) {
  const profile = await db.query.sellerProfile.findFirst({
    where: eq(sellerProfile.id, params.sellerProfileId),
  });
  if (!profile?.stripeCustomerId) {
    throw new ServiceError(404, "Nessun Customer Stripe per questo seller");
  }

  const list = await stripe.invoices.list({
    customer: profile.stripeCustomerId,
    limit: Math.min(params.limit, 100),
    ...(params.startingAfter ? { starting_after: params.startingAfter } : {}),
  });

  return {
    data: list.data.map((inv) => ({
      id: inv.id,
      createdAt: new Date(inv.created * 1000),
      amountPaidCents: inv.amount_paid,
      currency: inv.currency.toUpperCase(),
      status: inv.status,
      invoicePdfUrl: inv.invoice_pdf,
      stripeSubscriptionId:
        typeof inv.subscription === "string" ? inv.subscription : null,
      description: inv.lines.data[0]?.description ?? null,
    })),
    hasMore: list.has_more,
  };
}
```

- [ ] **Step 4: Aggiungi route**

In `apps/api/src/modules/seller/routes/billing.ts`:

```ts
const InvoiceSchema = t.Object({
  id: t.String(),
  createdAt: t.Date(),
  amountPaidCents: t.Integer(),
  currency: t.String(),
  status: t.Nullable(t.String()),
  invoicePdfUrl: t.Nullable(t.String()),
  stripeSubscriptionId: t.Nullable(t.String()),
  description: t.Nullable(t.String()),
});

const InvoicesPageSchema = t.Object({
  data: t.Array(InvoiceSchema),
  hasMore: t.Boolean(),
});

// dentro la chain Elysia:
.get(
  "/invoices",
  async (ctx) => {
    const { sellerProfile: sp, query } = withSellerAuth(ctx);
    const data = await listInvoices({
      sellerProfileId: sp.id,
      limit: query.limit ?? 25,
      startingAfter: query.startingAfter,
    });
    return ok(data);
  },
  {
    query: t.Object({
      limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
      startingAfter: t.Optional(t.String()),
    }),
    response: withErrors({ 200: okRes(InvoicesPageSchema) }),
    detail: { summary: "Storico fatture (Stripe lazy)", tags: ["Seller - Billing"] },
  },
)
```

- [ ] **Step 5: Run test (PASS)**

```bash
cd apps/api && bun test tests/integration/seller-billing-invoices.test.ts
```

- [ ] **Step 6: Aggiungi sezione nel `/billing`**

In `apps/seller/src/routes/_authenticated/billing.tsx`, aggiungi una nuova Card sotto la tabella subscription:

```tsx
import { Download } from "lucide-react";

const { data: invoicesPage, isLoading: invoicesLoading } = useQuery({
  queryKey: ["seller", "billing", "invoices"],
  queryFn: async () => {
    const r = await api().seller.billing.invoices.get({ query: { limit: 25 } });
    if (r.error) throw new Error(r.error.value?.message);
    return r.data?.data;
  },
});

// ... dentro il JSX:
<Card>
  <CardHeader>
    <CardTitle>Storico fatture</CardTitle>
  </CardHeader>
  <CardContent>
    {invoicesLoading ? (
      <Spinner />
    ) : !invoicesPage || invoicesPage.data.length === 0 ? (
      <p className="text-sm text-muted-foreground">Nessuna fattura ancora.</p>
    ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Descrizione</TableHead>
            <TableHead>Importo</TableHead>
            <TableHead>Stato</TableHead>
            <TableHead>PDF</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoicesPage.data.map((inv) => (
            <TableRow key={inv.id}>
              <TableCell>
                {format(new Date(inv.createdAt), "d MMM yyyy", { locale: it })}
              </TableCell>
              <TableCell>{inv.description ?? "-"}</TableCell>
              <TableCell>{formatEuro(inv.amountPaidCents)}</TableCell>
              <TableCell>
                <Badge variant={inv.status === "paid" ? "default" : "destructive"}>
                  {inv.status ?? "—"}
                </Badge>
              </TableCell>
              <TableCell>
                {inv.invoicePdfUrl && (
                  <a
                    href={inv.invoicePdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Scarica fattura"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )}
  </CardContent>
</Card>
```

- [ ] **Step 7: Smoke test**

Naviga `/billing`. Se sei un seller con 1+ rinnovo già processato, vedi la fattura. Se sei nuovissimo, vedrai "Nessuna fattura ancora".

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/seller/services/billing.ts apps/api/src/modules/seller/routes/billing.ts apps/api/tests/integration/seller-billing-invoices.test.ts apps/seller/src/routes/_authenticated/billing.tsx
git commit -m "feat(billing): invoices history section (Stripe API lazy)"
```

---

## Task 22: Admin billing — overview (MRR + counts)

**Files:**
- Create: `apps/api/src/modules/admin/services/billing.ts`
- Create: `apps/api/src/modules/admin/routes/billing.ts`
- Modify: `apps/api/src/modules/admin/index.ts`
- Rinomina: `apps/admin/src/routes/_authenticated/payments.tsx` → `apps/admin/src/routes/_authenticated/billing.tsx`
- Create: `apps/admin/src/routes/_authenticated/billing/overview.tsx`
- Test: `apps/api/tests/integration/admin-billing-overview.test.ts`

- [ ] **Step 1: Test fallente**

`apps/api/tests/integration/admin-billing-overview.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

import {
  getTestDb,
  setupTestContainer,
  teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (getTestDb() as any)[prop];
    },
  }),
}));

import { storeSubscription } from "@/db/schemas/store-subscription";
import { getBillingOverview } from "@/modules/admin/services/billing";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller, createTestStore } from "../helpers/fixtures";

beforeAll(async () => {
  await setupTestContainer();
}, 120_000);

afterAll(async () => {
  await teardownTestContainer();
});

beforeEach(async () => {
  await truncateAll(getTestDb());
});

async function seedSubs(
  sellerProfileId: string,
  specs: Array<{ status: "active" | "past_due" | "canceling" | "suspended" | "canceled"; fee: number }>,
) {
  for (let i = 0; i < specs.length; i++) {
    const storeRow = await createTestStore(getTestDb(), sellerProfileId);
    await getTestDb().insert(storeSubscription).values({
      storeId: storeRow.id,
      stripeSubscriptionId: `sub_${sellerProfileId}_${i}`,
      stripeCustomerId: "cus_FAKE",
      stripePriceId: "price_FAKE",
      feeAmountCents: specs[i].fee,
      currency: "EUR",
      status: specs[i].status,
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
    });
  }
}

describe("getBillingOverview", () => {
  it("aggregates MRR over billable subs and counts by state", async () => {
    const { profile: a } = await createTestSeller(getTestDb(), { email: "a@b.it" });
    const { profile: b } = await createTestSeller(getTestDb(), { email: "b@c.it" });
    await seedSubs(a.id, [
      { status: "active", fee: 2900 },
      { status: "past_due", fee: 2900 },
      { status: "suspended", fee: 2900 },
      { status: "canceled", fee: 2900 },
    ]);
    await seedSubs(b.id, [
      { status: "active", fee: 1900 },
      { status: "canceling", fee: 1900 },
    ]);

    const o = await getBillingOverview();

    expect(o.mrrCents).toBe(2900 + 2900 + 1900 + 1900);
    expect(o.activeStoresCount).toBe(2);
    expect(o.pastDueCount).toBe(1);
    expect(o.suspendedCount).toBe(1);
    expect(o.cancelingCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
cd apps/api && bun test tests/integration/admin-billing-overview.test.ts
```

- [ ] **Step 3: Implementa il service**

`apps/api/src/modules/admin/services/billing.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { storeSubscription } from "@/db/schemas/store-subscription";

export async function getBillingOverview() {
  const rows = await db
    .select({
      status: storeSubscription.status,
      count: sql<number>`count(*)::int`,
      sumCents: sql<number>`coalesce(sum(${storeSubscription.feeAmountCents}), 0)::int`,
    })
    .from(storeSubscription)
    .groupBy(storeSubscription.status);

  let mrrCents = 0;
  let activeStoresCount = 0;
  let pastDueCount = 0;
  let cancelingCount = 0;
  let suspendedCount = 0;

  for (const r of rows) {
    if (r.status === "active") {
      activeStoresCount = r.count;
      mrrCents += r.sumCents;
    } else if (r.status === "past_due") {
      pastDueCount = r.count;
      mrrCents += r.sumCents;
    } else if (r.status === "canceling") {
      cancelingCount = r.count;
      mrrCents += r.sumCents;
    } else if (r.status === "suspended") {
      suspendedCount = r.count;
    }
  }

  return { mrrCents, activeStoresCount, pastDueCount, cancelingCount, suspendedCount };
}
```

- [ ] **Step 4: Crea route admin**

`apps/api/src/modules/admin/routes/billing.ts`:

```ts
import { Elysia, t } from "elysia";
import { ok } from "@/lib/responses";
import { okRes, withErrors } from "@/lib/schemas";
import { withAdminAuth } from "../context";
import { getBillingOverview } from "../services/billing";

const OverviewSchema = t.Object({
  mrrCents: t.Integer(),
  activeStoresCount: t.Integer(),
  pastDueCount: t.Integer(),
  cancelingCount: t.Integer(),
  suspendedCount: t.Integer(),
});

export const adminBillingRoutes = new Elysia({ prefix: "/billing" })
  .get(
    "/overview",
    async (ctx) => {
      withAdminAuth(ctx);
      const data = await getBillingOverview();
      return ok(data);
    },
    {
      response: withErrors({ 200: okRes(OverviewSchema) }),
      detail: { summary: "Overview billing (MRR + counts)", tags: ["Admin - Billing"] },
    },
  );
```

⚠️ Verifica il nome esatto del helper auth admin (`withAdminAuth` o equivalente). Cerca in `apps/api/src/modules/admin/context.ts`.

- [ ] **Step 5: Mount route in admin module**

`apps/api/src/modules/admin/index.ts`:

```ts
import { adminBillingRoutes } from "./routes/billing";
// dentro chain:
.use(adminBillingRoutes)
```

- [ ] **Step 6: Run test (PASS)**

- [ ] **Step 7: Frontend admin — rinomina + crea overview**

```bash
git mv apps/admin/src/routes/_authenticated/payments.tsx apps/admin/src/routes/_authenticated/billing.tsx
```

Modifica `apps/admin/src/routes/_authenticated/billing.tsx` come container con tab navigation:

```tsx
import { Tabs, TabsList, TabsTrigger } from "@bibs/ui/components/tabs";
import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_authenticated/billing")({
  component: BillingLayout,
});

function BillingLayout() {
  const location = useLocation();
  const value = location.pathname.endsWith("/pricing")
    ? "pricing"
    : location.pathname.endsWith("/subscriptions")
    ? "subscriptions"
    : "overview";

  return (
    <div className="space-y-4">
      <PageHeader title="Billing" description="Gestisci pricing e abbonamenti seller" />
      <Tabs value={value}>
        <TabsList>
          <TabsTrigger value="overview" asChild>
            <Link to="/billing">Overview</Link>
          </TabsTrigger>
          <TabsTrigger value="pricing" asChild>
            <Link to="/billing/pricing">Pricing</Link>
          </TabsTrigger>
          <TabsTrigger value="subscriptions" asChild>
            <Link to="/billing/subscriptions">Abbonamenti</Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <Outlet />
    </div>
  );
}
```

⚠️ Se `/billing` deve renderizzare l'overview di default, il file route va aggiustato per essere "layout" route con figli. Pattern TanStack Start: trasforma in `billing/route.tsx` (layout) + `billing/index.tsx` (overview) + `billing/pricing.tsx` + `billing/subscriptions.tsx`.

Crea quindi:
- `apps/admin/src/routes/_authenticated/billing/route.tsx` (layout sopra)
- `apps/admin/src/routes/_authenticated/billing/index.tsx` (overview)

`billing/index.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@bibs/ui/components/card";
import { Spinner } from "@bibs/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/billing/")({
  component: OverviewPage,
});

function formatEuro(cents: number) {
  return `€${(cents / 100).toFixed(2)}`;
}

function OverviewPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "billing", "overview"],
    queryFn: async () => {
      const r = await api().admin.billing.overview.get();
      if (r.error) throw new Error(r.error.value?.message);
      return r.data?.data;
    },
  });

  if (isLoading || !data) return <Spinner />;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader>
          <CardTitle>MRR</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-semibold">{formatEuro(data.mrrCents)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Negozi attivi</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-semibold">{data.activeStoresCount}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>In dunning</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-semibold">{data.pastDueCount}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Sospesi</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-semibold">{data.suspendedCount}</p>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 8: Aggiorna sidebar admin**

In `apps/admin/src/components/app-sidebar.tsx`, cambia il link `Pagamenti` → `Billing` con destinazione `/billing`.

- [ ] **Step 9: Typecheck + smoke**

```bash
bun run --filter @bibs/admin typecheck
```

Avvia admin (`bun run dev:admin`), naviga `/billing` come admin user. Vedi le 4 card con i conteggi.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/admin/services/billing.ts apps/api/src/modules/admin/routes/billing.ts apps/api/src/modules/admin/index.ts apps/api/tests/integration/admin-billing-overview.test.ts apps/admin/src/routes/_authenticated/billing apps/admin/src/components/app-sidebar.tsx apps/admin/src/routeTree.gen.ts
git commit -m "feat(admin): /billing overview with MRR + lifecycle counts"
```

---

## Task 23: Admin billing — pricing CRUD

**Files:**
- Modify: `apps/api/src/modules/admin/services/billing.ts` (aggiungi pricing helpers)
- Modify: `apps/api/src/modules/admin/routes/billing.ts`
- Create: `apps/admin/src/routes/_authenticated/billing/pricing.tsx`
- Test: `apps/api/tests/integration/admin-billing-pricing.test.ts`

- [ ] **Step 1: Test fallente**

`apps/api/tests/integration/admin-billing-pricing.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

import {
  getTestDb,
  setupTestContainer,
  teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (getTestDb() as any)[prop];
    },
  }),
}));

const priceCreate = mock(async () => ({ id: "price_NEW" }));
mock.module("@/lib/stripe", () => ({
  stripe: {
    prices: { create: priceCreate },
  },
}));

import { eq } from "drizzle-orm";
import { pricingConfig } from "@/db/schemas/pricing-config";
import { getCurrentPricing, updatePricing } from "@/modules/admin/services/billing";
import { truncateAll } from "../helpers/cleanup";

beforeAll(async () => {
  await setupTestContainer();
}, 120_000);

afterAll(async () => {
  await teardownTestContainer();
});

beforeEach(async () => {
  await truncateAll(getTestDb());
  await getTestDb().insert(pricingConfig).values({
    storeMonthlyFeeCents: 2900,
    currency: "EUR",
    stripePriceId: "price_OLD",
    suspendedAutoCancelDays: 60,
    pendingCreationExpiryHours: 24,
    isActive: true,
  });
  priceCreate.mockClear();
});

describe("getCurrentPricing", () => {
  it("returns the active pricing_config row", async () => {
    const cfg = await getCurrentPricing();
    expect(cfg.storeMonthlyFeeCents).toBe(2900);
    expect(cfg.stripePriceId).toBe("price_OLD");
  });
});

describe("updatePricing", () => {
  it("creates a new Stripe Price and flips is_active", async () => {
    await updatePricing({
      storeMonthlyFeeCents: 3500,
      currency: "EUR",
      suspendedAutoCancelDays: 60,
      pendingCreationExpiryHours: 24,
      productId: "prod_TEST",
      adminUserId: null,
    });

    expect(priceCreate).toHaveBeenCalledWith({
      product: "prod_TEST",
      unit_amount: 3500,
      currency: "eur",
      recurring: { interval: "month" },
    });

    const rows = await getTestDb().select().from(pricingConfig);
    expect(rows).toHaveLength(2);
    const active = rows.find((r) => r.isActive);
    expect(active?.stripePriceId).toBe("price_NEW");
    expect(active?.storeMonthlyFeeCents).toBe(3500);
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
cd apps/api && bun test tests/integration/admin-billing-pricing.test.ts
```

- [ ] **Step 3: Implementa pricing service**

Aggiungi a `apps/api/src/modules/admin/services/billing.ts`:

```ts
import { eq } from "drizzle-orm";
import { pricingConfig } from "@/db/schemas/pricing-config";
import { stripe } from "@/lib/stripe";
import { ServiceError } from "@/lib/errors";

export async function getCurrentPricing() {
  const cfg = await db.query.pricingConfig.findFirst({
    where: eq(pricingConfig.isActive, true),
  });
  if (!cfg) throw new ServiceError(500, "Pricing config non inizializzato");
  return cfg;
}

export async function listPricingHistory() {
  return db.query.pricingConfig.findMany({
    orderBy: (p, { desc }) => [desc(p.createdAt)],
  });
}

interface UpdatePricingParams {
  storeMonthlyFeeCents: number;
  currency: string;
  suspendedAutoCancelDays: number;
  pendingCreationExpiryHours: number;
  productId: string;
  adminUserId: string | null;
}

export async function updatePricing(params: UpdatePricingParams) {
  if (params.currency !== "EUR") {
    throw new ServiceError(400, "Solo EUR supportato in MVP");
  }
  if (params.storeMonthlyFeeCents <= 0) {
    throw new ServiceError(400, "La quota deve essere maggiore di zero");
  }

  // 1) Crea nuovo Stripe Price (immutable)
  const newPrice = await stripe.prices.create({
    product: params.productId,
    unit_amount: params.storeMonthlyFeeCents,
    currency: params.currency.toLowerCase(),
    recurring: { interval: "month" },
  });

  // 2) Flip is_active in transazione
  await db.transaction(async (tx) => {
    await tx
      .update(pricingConfig)
      .set({ isActive: false })
      .where(eq(pricingConfig.isActive, true));
    await tx.insert(pricingConfig).values({
      storeMonthlyFeeCents: params.storeMonthlyFeeCents,
      currency: params.currency,
      stripePriceId: newPrice.id,
      suspendedAutoCancelDays: params.suspendedAutoCancelDays,
      pendingCreationExpiryHours: params.pendingCreationExpiryHours,
      isActive: true,
      createdByUserId: params.adminUserId,
    });
  });

  return { newPriceId: newPrice.id };
}
```

⚠️ Aggiungi `import { db } from "@/db";` se non presente nel file.

- [ ] **Step 4: Aggiungi route**

In `apps/api/src/modules/admin/routes/billing.ts`:

```ts
const PricingSchema = t.Object({
  id: t.String(),
  storeMonthlyFeeCents: t.Integer(),
  currency: t.String(),
  stripePriceId: t.String(),
  suspendedAutoCancelDays: t.Integer(),
  pendingCreationExpiryHours: t.Integer(),
  isActive: t.Boolean(),
  createdAt: t.Date(),
});

// dentro la chain:
.get(
  "/pricing/current",
  async (ctx) => {
    withAdminAuth(ctx);
    const data = await getCurrentPricing();
    return ok(data);
  },
  {
    response: withErrors({ 200: okRes(PricingSchema) }),
    detail: { summary: "Pricing config attivo", tags: ["Admin - Billing"] },
  },
)
.get(
  "/pricing/history",
  async (ctx) => {
    withAdminAuth(ctx);
    const data = await listPricingHistory();
    return ok(data);
  },
  {
    response: withErrors({ 200: okRes(t.Array(PricingSchema)) }),
    detail: { summary: "Storico configurazioni pricing", tags: ["Admin - Billing"] },
  },
)
.put(
  "/pricing",
  async (ctx) => {
    const { user, body } = withAdminAuth(ctx);
    const data = await updatePricing({
      ...body,
      adminUserId: user.id,
    });
    return ok(data);
  },
  {
    body: t.Object({
      storeMonthlyFeeCents: t.Integer({ minimum: 100 }),
      currency: t.String({ minLength: 3, maxLength: 3 }),
      suspendedAutoCancelDays: t.Integer({ minimum: 7, maximum: 365 }),
      pendingCreationExpiryHours: t.Integer({ minimum: 1, maximum: 168 }),
      productId: t.String(),
    }),
    response: withErrors({ 200: okRes(t.Object({ newPriceId: t.String() })) }),
    detail: { summary: "Aggiorna pricing", tags: ["Admin - Billing"] },
  },
);
```

⚠️ Il `productId` deve essere quello prodotto dal `stripe:bootstrap`. Lo si scopre interrogando Stripe: `stripe.products.list()` filtrando per `metadata.bibs_role='store_monthly_fee'`. Una soluzione più clean: aggiungi un campo `stripeProductId` alla `pricing_config` e lo popoli al seed. Per ora, lascia che l'admin lo passi nel body (lo legge una volta dal dashboard); migliorabile in un Task successivo.

- [ ] **Step 5: Run test (PASS)**

- [ ] **Step 6: Frontend admin — pricing page**

`apps/admin/src/routes/_authenticated/billing/pricing.tsx`:

```tsx
import { Button } from "@bibs/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@bibs/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@bibs/ui/components/dialog";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { Spinner } from "@bibs/ui/components/spinner";
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/billing/pricing")({
  component: PricingPage,
});

function PricingPage() {
  const qc = useQueryClient();
  const { data: current, isLoading } = useQuery({
    queryKey: ["admin", "billing", "pricing", "current"],
    queryFn: async () => {
      const r = await api().admin.billing.pricing.current.get();
      if (r.error) throw new Error(r.error.value?.message);
      return r.data?.data;
    },
  });

  const [open, setOpen] = useState(false);
  const [fee, setFee] = useState(0);
  const [days, setDays] = useState(60);
  const [hours, setHours] = useState(24);
  const [productId, setProductId] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await api().admin.billing.pricing.put({
        storeMonthlyFeeCents: Math.round(fee * 100),
        currency: "EUR",
        suspendedAutoCancelDays: days,
        pendingCreationExpiryHours: hours,
        productId,
      });
      if (r.error) throw new Error(r.error.value?.message);
      return r.data?.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "billing"] });
      toast.success("Pricing aggiornato");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !current) return <Spinner />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pricing corrente</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p>
          <strong>Quota mensile:</strong> €{(current.storeMonthlyFeeCents / 100).toFixed(2)} {current.currency}
        </p>
        <p>
          <strong>Auto-cancel sospensione:</strong> {current.suspendedAutoCancelDays} giorni
        </p>
        <p>
          <strong>Expiry checkout pendente:</strong> {current.pendingCreationExpiryHours} ore
        </p>
        <p className="text-xs text-muted-foreground">Stripe Price ID: {current.stripePriceId}</p>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              className="mt-4 self-start"
              onClick={() => {
                setFee(current.storeMonthlyFeeCents / 100);
                setDays(current.suspendedAutoCancelDays);
                setHours(current.pendingCreationExpiryHours);
              }}
            >
              Modifica
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Modifica pricing</DialogTitle>
              <DialogDescription>
                Crea un nuovo Stripe Price. Le subscription esistenti restano sul prezzo precedente.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <Label>Quota mensile (€)</Label>
              <Input type="number" step="0.01" value={fee} onChange={(e) => setFee(parseFloat(e.target.value))} />
              <Label>Auto-cancel dopo (giorni)</Label>
              <Input type="number" value={days} onChange={(e) => setDays(parseInt(e.target.value))} />
              <Label>Expiry pending checkout (ore)</Label>
              <Input type="number" value={hours} onChange={(e) => setHours(parseInt(e.target.value))} />
              <Label>Stripe Product ID</Label>
              <Input value={productId} onChange={(e) => setProductId(e.target.value)} placeholder="prod_..." />
            </div>
            <DialogFooter>
              <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                Conferma
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7: Typecheck + smoke test**

```bash
bun run --filter '*' typecheck
bun run dev:admin
```

Naviga `/billing/pricing`, click "Modifica", inserisci una nuova quota e il `productId` (lo trovi dal output del `stripe:bootstrap` o nel Dashboard Stripe sotto Products), submit. Verifica che `pricing_config` abbia una nuova riga `is_active=true`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/admin/services/billing.ts apps/api/src/modules/admin/routes/billing.ts apps/api/tests/integration/admin-billing-pricing.test.ts apps/admin/src/routes/_authenticated/billing/pricing.tsx apps/admin/src/routeTree.gen.ts
git commit -m "feat(admin): pricing CRUD with new Stripe Price on update"
```

---

## Task 24: Admin billing — subscriptions list

**Files:**
- Modify: `apps/api/src/modules/admin/services/billing.ts` (aggiungi `listAllSubscriptions`)
- Modify: `apps/api/src/modules/admin/routes/billing.ts`
- Create: `apps/admin/src/routes/_authenticated/billing/subscriptions.tsx`

- [ ] **Step 1: Implementa il service (no test in TDD per query banali; verifica via integration smoke)**

Aggiungi a `apps/api/src/modules/admin/services/billing.ts`:

```ts
import { and, asc, desc, eq, ilike } from "drizzle-orm";
import { sellerProfile } from "@/db/schemas/seller";
import { user } from "@/db/schemas/auth";
import { store } from "@/db/schemas/store";

interface ListAllSubsParams {
  page: number;
  limit: number;
  status?: string;
  sellerEmail?: string;
  storeName?: string;
}

export async function listAllSubscriptions(params: ListAllSubsParams) {
  const limit = Math.min(params.limit, 100);
  const offset = (params.page - 1) * limit;

  const conditions = [];
  if (params.status) conditions.push(eq(storeSubscription.status, params.status as any));
  if (params.sellerEmail) conditions.push(ilike(user.email, `%${params.sellerEmail}%`));
  if (params.storeName) conditions.push(ilike(store.name, `%${params.storeName}%`));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const baseQuery = db
    .select({
      id: storeSubscription.id,
      storeId: storeSubscription.storeId,
      storeName: store.name,
      sellerEmail: user.email,
      status: storeSubscription.status,
      feeAmountCents: storeSubscription.feeAmountCents,
      currentPeriodEnd: storeSubscription.currentPeriodEnd,
      createdAt: storeSubscription.createdAt,
      cancelReason: storeSubscription.cancelReason,
    })
    .from(storeSubscription)
    .innerJoin(store, eq(storeSubscription.storeId, store.id))
    .innerJoin(sellerProfile, eq(store.sellerProfileId, sellerProfile.id))
    .innerJoin(user, eq(sellerProfile.userId, user.id))
    .orderBy(desc(storeSubscription.createdAt));

  const data = where
    ? await baseQuery.where(where).limit(limit).offset(offset)
    : await baseQuery.limit(limit).offset(offset);

  const totalRow = where
    ? await db
        .select({ count: sql<number>`count(*)::int` })
        .from(storeSubscription)
        .innerJoin(store, eq(storeSubscription.storeId, store.id))
        .innerJoin(sellerProfile, eq(store.sellerProfileId, sellerProfile.id))
        .innerJoin(user, eq(sellerProfile.userId, user.id))
        .where(where)
    : await db.select({ count: sql<number>`count(*)::int` }).from(storeSubscription);

  return {
    data,
    pagination: {
      page: params.page,
      limit,
      total: totalRow[0]?.count ?? 0,
    },
  };
}
```

- [ ] **Step 2: Aggiungi route**

In `apps/api/src/modules/admin/routes/billing.ts`:

```ts
import { storeSubscriptionStatuses } from "@/db/schemas/store-subscription";

const SubRowSchema = t.Object({
  id: t.String(),
  storeId: t.String(),
  storeName: t.String(),
  sellerEmail: t.String(),
  status: t.String(),
  feeAmountCents: t.Integer(),
  currentPeriodEnd: t.Date(),
  createdAt: t.Date(),
  cancelReason: t.Nullable(t.String()),
});

const SubsPageSchema = t.Object({
  data: t.Array(SubRowSchema),
  pagination: t.Object({
    page: t.Integer(),
    limit: t.Integer(),
    total: t.Integer(),
  }),
});

// nella chain:
.get(
  "/subscriptions",
  async (ctx) => {
    withAdminAuth(ctx);
    const { query } = ctx as any;
    const data = await listAllSubscriptions({
      page: query.page ?? 1,
      limit: query.limit ?? 25,
      status: query.status,
      sellerEmail: query.sellerEmail,
      storeName: query.storeName,
    });
    return ok(data);
  },
  {
    query: t.Object({
      page: t.Optional(t.Integer({ minimum: 1 })),
      limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
      status: t.Optional(
        t.Union(storeSubscriptionStatuses.map((s) => t.Literal(s)) as unknown as any[]),
      ),
      sellerEmail: t.Optional(t.String()),
      storeName: t.Optional(t.String()),
    }),
    response: withErrors({ 200: okRes(SubsPageSchema) }),
    detail: { summary: "Lista subscription (admin)", tags: ["Admin - Billing"] },
  },
);
```

- [ ] **Step 3: Frontend — subscriptions list**

`apps/admin/src/routes/_authenticated/billing/subscriptions.tsx`:

```tsx
import { Badge } from "@bibs/ui/components/badge";
import { Input } from "@bibs/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bibs/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { useState } from "react";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/billing/subscriptions")({
  component: SubscriptionsPage,
});

function SubscriptionsPage() {
  const [sellerEmail, setSellerEmail] = useState("");
  const [storeName, setStoreName] = useState("");

  const { data } = useQuery({
    queryKey: ["admin", "billing", "subs", sellerEmail, storeName],
    queryFn: async () => {
      const r = await api().admin.billing.subscriptions.get({
        query: {
          page: 1,
          limit: 50,
          ...(sellerEmail ? { sellerEmail } : {}),
          ...(storeName ? { storeName } : {}),
        },
      });
      if (r.error) throw new Error(r.error.value?.message);
      return r.data?.data;
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="Email seller"
          value={sellerEmail}
          onChange={(e) => setSellerEmail(e.target.value)}
        />
        <Input
          placeholder="Nome negozio"
          value={storeName}
          onChange={(e) => setStoreName(e.target.value)}
        />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Seller</TableHead>
            <TableHead>Negozio</TableHead>
            <TableHead>Stato</TableHead>
            <TableHead>Quota</TableHead>
            <TableHead>Rinnovo</TableHead>
            <TableHead>Creata</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.data.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.sellerEmail}</TableCell>
              <TableCell>{r.storeName}</TableCell>
              <TableCell><Badge>{r.status}</Badge></TableCell>
              <TableCell>€{(r.feeAmountCents / 100).toFixed(2)}</TableCell>
              <TableCell>
                {format(new Date(r.currentPeriodEnd), "d MMM yyyy", { locale: it })}
              </TableCell>
              <TableCell>
                {format(new Date(r.createdAt), "d MMM yyyy", { locale: it })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {data && (
        <p className="text-xs text-muted-foreground">
          {data.data.length} di {data.pagination.total} risultati
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + smoke test**

```bash
bun run --filter '*' typecheck
```

Naviga `/billing/subscriptions` come admin. Filtra per `sellerEmail`. Vedi i risultati.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin/services/billing.ts apps/api/src/modules/admin/routes/billing.ts apps/admin/src/routes/_authenticated/billing/subscriptions.tsx apps/admin/src/routeTree.gen.ts
git commit -m "feat(admin): subscriptions list with filters"
```

---

## Task 25: Vista "/store/archived" lato seller

**Files:**
- Modify: `apps/api/src/modules/seller/services/stores.ts` (aggiungi `listArchivedStores`)
- Modify: `apps/api/src/modules/seller/routes/stores.ts` (aggiungi endpoint)
- Create: `apps/seller/src/routes/_authenticated/store/archived.tsx`
- Modify: `apps/seller/src/components/app-sidebar.tsx` (link "Archivio")
- Test: `apps/api/tests/integration/seller-stores-archived.test.ts`

- [ ] **Step 1: Test fallente**

`apps/api/tests/integration/seller-stores-archived.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

import {
  getTestDb,
  setupTestContainer,
  teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (getTestDb() as any)[prop];
    },
  }),
}));

import { eq } from "drizzle-orm";
import { store } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { listArchivedStores } from "@/modules/seller/services/stores";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller, createTestStore } from "../helpers/fixtures";

beforeAll(async () => {
  await setupTestContainer();
}, 120_000);

afterAll(async () => {
  await teardownTestContainer();
});

beforeEach(async () => {
  await truncateAll(getTestDb());
});

describe("listArchivedStores", () => {
  it("returns only stores with deletedAt set", async () => {
    const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });
    const archived = await createTestStore(getTestDb(), profile.id);
    const live = await createTestStore(getTestDb(), profile.id);

    await getTestDb()
      .update(store)
      .set({ deletedAt: new Date() })
      .where(eq(store.id, archived.id));

    await getTestDb().insert(storeSubscription).values({
      storeId: archived.id,
      stripeSubscriptionId: "sub_archived",
      stripeCustomerId: "cus_FAKE",
      stripePriceId: "price_FAKE",
      feeAmountCents: 2900,
      currency: "EUR",
      status: "canceled",
      currentPeriodEnd: new Date(),
      canceledAt: new Date(),
      cancelReason: "seller_canceled",
    });

    const result = await listArchivedStores({
      sellerProfileId: profile.id,
      page: 1,
      limit: 50,
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe(archived.id);
    expect(result.data[0].cancelReason).toBe("seller_canceled");
    expect(result.data[0].canceledAt).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
cd apps/api && bun test tests/integration/seller-stores-archived.test.ts
```

- [ ] **Step 3: Implementa il service**

Aggiungi a `apps/api/src/modules/seller/services/stores.ts`:

```ts
import { desc, isNotNull } from "drizzle-orm";

interface ListArchivedParams {
  sellerProfileId: string;
  page: number;
  limit: number;
}

export async function listArchivedStores(params: ListArchivedParams) {
  const limit = Math.min(params.limit, 100);
  const offset = (params.page - 1) * limit;

  const data = await db
    .select({
      id: store.id,
      name: store.name,
      addressLine1: store.addressLine1,
      city: store.city,
      createdAt: store.createdAt,
      deletedAt: store.deletedAt,
      canceledAt: storeSubscription.canceledAt,
      cancelReason: storeSubscription.cancelReason,
    })
    .from(store)
    .leftJoin(storeSubscription, eq(storeSubscription.storeId, store.id))
    .where(
      and(
        eq(store.sellerProfileId, params.sellerProfileId),
        isNotNull(store.deletedAt),
      ),
    )
    .orderBy(desc(store.deletedAt))
    .limit(limit)
    .offset(offset);

  return { data, pagination: { page: params.page, limit, total: data.length } };
}
```

⚠️ Il `total` qui è solo il conteggio della pagina corrente. Per un total accurato, fai una `count(*)` query come negli endpoint admin (Task 24).

- [ ] **Step 4: Aggiungi route**

In `apps/api/src/modules/seller/routes/stores.ts`:

```ts
const ArchivedStoreSchema = t.Object({
  id: t.String(),
  name: t.String(),
  addressLine1: t.String(),
  city: t.String(),
  createdAt: t.Date(),
  deletedAt: t.Nullable(t.Date()),
  canceledAt: t.Nullable(t.Date()),
  cancelReason: t.Nullable(t.String()),
});

.get(
  "/stores/archived",
  async (ctx) => {
    const { sellerProfile: sp, query } = withSeller(ctx);
    const data = await listArchivedStores({
      sellerProfileId: sp.id,
      page: query.page ?? 1,
      limit: query.limit ?? 25,
    });
    return ok(data);
  },
  {
    query: t.Object({
      page: t.Optional(t.Integer({ minimum: 1 })),
      limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
    }),
    response: withErrors({
      200: okRes(
        t.Object({
          data: t.Array(ArchivedStoreSchema),
          pagination: t.Object({
            page: t.Integer(),
            limit: t.Integer(),
            total: t.Integer(),
          }),
        }),
      ),
    }),
    detail: { summary: "Lista negozi archiviati del seller", tags: ["Seller - Stores"] },
  },
)
```

⚠️ Importa `listArchivedStores` da `../services/stores`.

- [ ] **Step 5: Run test (PASS)**

- [ ] **Step 6: Frontend — `/store/archived` page**

`apps/seller/src/routes/_authenticated/store/archived.tsx`:

```tsx
import { Badge } from "@bibs/ui/components/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@bibs/ui/components/card";
import { Spinner } from "@bibs/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bibs/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/store/archived")({
  component: ArchivedPage,
});

const REASON_LABEL: Record<string, string> = {
  seller_canceled: "Cancellato dal seller",
  payment_failed_auto: "Auto-cancellato (insolvenza)",
  admin_canceled: "Cancellato da admin",
};

function ArchivedPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["seller", "stores", "archived"],
    queryFn: async () => {
      const r = await api().seller.stores.archived.get({ query: { page: 1, limit: 50 } });
      if (r.error) throw new Error(r.error.value?.message);
      return r.data?.data;
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Negozi archiviati"
        description="Negozi cancellati. I dati storici sono conservati ma non modificabili."
      />
      <Card>
        <CardHeader>
          <CardTitle>Archivio</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Spinner />
          ) : !data || data.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nessun negozio archiviato.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Indirizzo</TableHead>
                  <TableHead>Creato</TableHead>
                  <TableHead>Archiviato</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell>
                      {r.addressLine1}, {r.city}
                    </TableCell>
                    <TableCell>
                      {format(new Date(r.createdAt), "d MMM yyyy", { locale: it })}
                    </TableCell>
                    <TableCell>
                      {r.deletedAt &&
                        format(new Date(r.deletedAt), "d MMM yyyy", { locale: it })}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {r.cancelReason ? REASON_LABEL[r.cancelReason] ?? r.cancelReason : "—"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 7: Link sidebar**

In `apps/seller/src/components/app-sidebar.tsx` aggiungi sotto la voce "Negozio" un link "Archivio" → `/store/archived` con icona `Archive` di `lucide-react`.

- [ ] **Step 8: Typecheck + smoke**

```bash
bun run --filter @bibs/seller typecheck
bun run dev:seller
```

Cancellare un negozio + farne scadere il period (per dev: usare Stripe CLI `stripe trigger customer.subscription.deleted` su una sub canceling). Navigare `/store/archived`. Vedere la riga.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/seller/services/stores.ts apps/api/src/modules/seller/routes/stores.ts apps/api/tests/integration/seller-stores-archived.test.ts apps/seller/src/routes/_authenticated/store/archived.tsx apps/seller/src/components/app-sidebar.tsx apps/seller/src/routeTree.gen.ts
git commit -m "feat(seller): archived stores list at /store/archived"
```

---

## Task 26: Cron `auto-cancel-suspended-stores`

**Files:**
- Create: `apps/api/src/jobs/auto-cancel-suspended-stores.ts`
- Modify: `apps/api/src/index.ts` (registra il cron plugin)
- Test: `apps/api/tests/integration/job-auto-cancel-suspended.test.ts`

- [ ] **Step 1: Test fallente**

`apps/api/tests/integration/job-auto-cancel-suspended.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

import {
  getTestDb,
  setupTestContainer,
  teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (getTestDb() as any)[prop];
    },
  }),
}));

const subCancel = mock(async () => ({}));
mock.module("@/lib/stripe", () => ({
  stripe: { subscriptions: { cancel: subCancel } },
}));

import { eq } from "drizzle-orm";
import { pricingConfig } from "@/db/schemas/pricing-config";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { runAutoCancelSuspended } from "@/jobs/auto-cancel-suspended-stores";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller, createTestStore } from "../helpers/fixtures";

beforeAll(async () => {
  await setupTestContainer();
}, 120_000);

afterAll(async () => {
  await teardownTestContainer();
});

beforeEach(async () => {
  await truncateAll(getTestDb());
  subCancel.mockClear();
  await getTestDb().insert(pricingConfig).values({
    storeMonthlyFeeCents: 2900,
    currency: "EUR",
    stripePriceId: "price_FAKE",
    suspendedAutoCancelDays: 60,
    pendingCreationExpiryHours: 24,
    isActive: true,
  });
});

describe("runAutoCancelSuspended", () => {
  it("cancels subs suspended longer than threshold and pre-sets reason", async () => {
    const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });
    const oldStore = await createTestStore(getTestDb(), profile.id);
    const newStore = await createTestStore(getTestDb(), profile.id);

    const longAgo = new Date(Date.now() - 61 * 86400000);
    const recent = new Date(Date.now() - 10 * 86400000);

    await getTestDb().insert(storeSubscription).values([
      {
        storeId: oldStore.id,
        stripeSubscriptionId: "sub_OLD",
        stripeCustomerId: "cus_FAKE",
        stripePriceId: "price_FAKE",
        feeAmountCents: 2900,
        currency: "EUR",
        status: "suspended",
        currentPeriodEnd: new Date(),
        suspendedAt: longAgo,
      },
      {
        storeId: newStore.id,
        stripeSubscriptionId: "sub_NEW",
        stripeCustomerId: "cus_FAKE",
        stripePriceId: "price_FAKE",
        feeAmountCents: 2900,
        currency: "EUR",
        status: "suspended",
        currentPeriodEnd: new Date(),
        suspendedAt: recent,
      },
    ]);

    const result = await runAutoCancelSuspended();

    expect(result.canceled).toBe(1);
    expect(subCancel).toHaveBeenCalledWith("sub_OLD");
    expect(subCancel).not.toHaveBeenCalledWith("sub_NEW");

    const oldSub = await getTestDb()
      .select()
      .from(storeSubscription)
      .where(eq(storeSubscription.stripeSubscriptionId, "sub_OLD"))
      .then((r) => r[0]);
    expect(oldSub.cancelReason).toBe("payment_failed_auto");
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
cd apps/api && bun test tests/integration/job-auto-cancel-suspended.test.ts
```

- [ ] **Step 3: Implementa il job**

`apps/api/src/jobs/auto-cancel-suspended-stores.ts`:

```ts
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { pricingConfig } from "@/db/schemas/pricing-config";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { getLogger } from "@/lib/logger";
import { stripe } from "@/lib/stripe";

const log = getLogger("job-auto-cancel-suspended");

export async function runAutoCancelSuspended(): Promise<{ canceled: number }> {
  const cfg = await db.query.pricingConfig.findFirst({
    where: eq(pricingConfig.isActive, true),
  });
  if (!cfg) {
    log.warn("No active pricing_config, skipping job");
    return { canceled: 0 };
  }

  const cutoff = new Date(Date.now() - cfg.suspendedAutoCancelDays * 86400000);

  const subs = await db
    .select()
    .from(storeSubscription)
    .where(
      and(
        eq(storeSubscription.status, "suspended"),
        isNotNull(storeSubscription.suspendedAt),
        lte(storeSubscription.suspendedAt, cutoff),
      ),
    );

  let canceled = 0;
  for (const sub of subs) {
    try {
      // Pre-set reason BEFORE Stripe call; the resulting subscription.deleted
      // webhook will preserve it.
      await db
        .update(storeSubscription)
        .set({ cancelReason: "payment_failed_auto" })
        .where(eq(storeSubscription.id, sub.id));

      await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
      canceled++;
      log.info(
        { stripeSubscriptionId: sub.stripeSubscriptionId },
        "Auto-cancelled suspended subscription",
      );
    } catch (err) {
      log.error(
        { err, stripeSubscriptionId: sub.stripeSubscriptionId },
        "Failed to auto-cancel suspended subscription",
      );
      // Continue with remaining subs; don't break the loop
    }
  }

  return { canceled };
}
```

- [ ] **Step 4: Registra cron plugin**

In `apps/api/src/index.ts`, importa `@elysiajs/cron`:

```ts
import { cron, Patterns } from "@elysiajs/cron";
import { runAutoCancelSuspended } from "./jobs/auto-cancel-suspended-stores";
```

Aggiungi alla chain Elysia:

```ts
.use(
  cron({
    name: "auto-cancel-suspended-stores",
    pattern: Patterns.daily("03:00"),  // every day at 03:00 server time
    run: async () => {
      const log = getLogger("cron-auto-cancel");
      const result = await runAutoCancelSuspended();
      log.info({ canceled: result.canceled }, "Cron auto-cancel-suspended done");
    },
  }),
)
```

⚠️ La sintassi `Patterns.daily("03:00")` dipende dalla versione di `@elysiajs/cron`. Verifica via `node_modules/@elysiajs/cron/dist/index.d.ts` o usa direttamente una cron expression: `pattern: "0 3 * * *"`.

- [ ] **Step 5: Run test (PASS)**

```bash
cd apps/api && bun test tests/integration/job-auto-cancel-suspended.test.ts
```

- [ ] **Step 6: Smoke (dev)**

Non aspettare 24h: invoca `runAutoCancelSuspended()` manualmente via script o tramite un endpoint admin temporaneo. Verifica i log API.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/jobs/auto-cancel-suspended-stores.ts apps/api/src/index.ts apps/api/tests/integration/job-auto-cancel-suspended.test.ts
git commit -m "feat(billing): cron job — auto-cancel subscriptions suspended > N days"
```

---

## Task 27: Cron `expire-pending-store-creations`

**Files:**
- Create: `apps/api/src/jobs/expire-pending-store-creations.ts`
- Modify: `apps/api/src/index.ts` (cron registration)
- Test: `apps/api/tests/integration/job-expire-pending.test.ts`

- [ ] **Step 1: Test fallente**

`apps/api/tests/integration/job-expire-pending.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

import {
  getTestDb,
  setupTestContainer,
  teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (getTestDb() as any)[prop];
    },
  }),
}));

import { eq } from "drizzle-orm";
import { pendingStoreCreation } from "@/db/schemas/pending-store-creation";
import { runExpirePending } from "@/jobs/expire-pending-store-creations";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller } from "../helpers/fixtures";

beforeAll(async () => {
  await setupTestContainer();
}, 120_000);

afterAll(async () => {
  await teardownTestContainer();
});

beforeEach(async () => {
  await truncateAll(getTestDb());
});

describe("runExpirePending", () => {
  it("marks open pending rows past expires_at as expired", async () => {
    const { profile } = await createTestSeller(getTestDb(), { email: "a@b.it" });

    const [stale] = await getTestDb()
      .insert(pendingStoreCreation)
      .values({
        sellerProfileId: profile.id,
        formData: {},
        feeAmountCents: 2900,
        currency: "EUR",
        status: "open",
        expiresAt: new Date(Date.now() - 86400000),
      })
      .returning();

    const [fresh] = await getTestDb()
      .insert(pendingStoreCreation)
      .values({
        sellerProfileId: profile.id,
        formData: {},
        feeAmountCents: 2900,
        currency: "EUR",
        status: "open",
        expiresAt: new Date(Date.now() + 86400000),
      })
      .returning();

    // Need a different seller to avoid unique index conflict for "open" per seller
    const { profile: profile2 } = await createTestSeller(getTestDb(), { email: "b@c.it" });
    await getTestDb().update(pendingStoreCreation).set({ sellerProfileId: profile2.id }).where(eq(pendingStoreCreation.id, fresh.id));

    const result = await runExpirePending();

    expect(result.expired).toBe(1);
    const updated = await getTestDb()
      .select()
      .from(pendingStoreCreation)
      .where(eq(pendingStoreCreation.id, stale.id))
      .then((r) => r[0]);
    expect(updated.status).toBe("expired");
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
cd apps/api && bun test tests/integration/job-expire-pending.test.ts
```

- [ ] **Step 3: Implementa il job**

`apps/api/src/jobs/expire-pending-store-creations.ts`:

```ts
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { pendingStoreCreation } from "@/db/schemas/pending-store-creation";
import { getLogger } from "@/lib/logger";

const log = getLogger("job-expire-pending");

export async function runExpirePending(): Promise<{ expired: number }> {
  const now = new Date();

  const result = await db
    .update(pendingStoreCreation)
    .set({ status: "expired" })
    .where(
      and(
        eq(pendingStoreCreation.status, "open"),
        lt(pendingStoreCreation.expiresAt, now),
      ),
    )
    .returning({ id: pendingStoreCreation.id });

  log.info({ count: result.length }, "Expired pending store creations");
  return { expired: result.length };
}
```

- [ ] **Step 4: Registra cron**

In `apps/api/src/index.ts`, accanto al cron precedente:

```ts
.use(
  cron({
    name: "expire-pending-store-creations",
    pattern: "0 * * * *",  // hourly
    run: async () => {
      const log = getLogger("cron-expire-pending");
      const result = await runExpirePending();
      log.info({ expired: result.expired }, "Cron expire-pending done");
    },
  }),
)
```

- [ ] **Step 5: Run test (PASS)**

```bash
cd apps/api && bun test tests/integration/job-expire-pending.test.ts
```

- [ ] **Step 6: Test full API suite**

```bash
cd apps/api && bun test
```

Expected: TUTTI i test passano.

- [ ] **Step 7: Typecheck cross-workspace**

```bash
bun run --filter '*' typecheck
```

Expected: PASS. Verifica esplicitamente `$?` per ogni workspace ([[feedback_bun_filter_exit_codes]]).

- [ ] **Step 8: Lint**

```bash
bun run lint
```

Se Biome ha riscritto qualcosa via hook su Edit/Write durante il plan, ok; se ci sono errori non risolti, `bun run lint:fix`.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/jobs/expire-pending-store-creations.ts apps/api/src/index.ts apps/api/tests/integration/job-expire-pending.test.ts
git commit -m "feat(billing): cron job — expire pending_store_creations past TTL"
```

---

## Final verification

- [ ] **Step 1: Run tutta la test suite API**

```bash
cd apps/api && bun test
```

Expected: PASS.

- [ ] **Step 2: Typecheck cross-workspace**

```bash
bun run --filter '*' typecheck
```

Expected: PASS in tutti i workspace ([[feedback_bun_filter_exit_codes]]: controlla `$?` esplicitamente).

- [ ] **Step 3: Lint**

```bash
bun run lint
```

Expected: PASS.

- [ ] **Step 4: Smoke end-to-end manuale**

Avvia tutto: `bun run dev`. In altri terminali:

```bash
stripe listen --forward-to http://localhost:3000/webhooks/stripe
```

Scenari da esercitare nell'ordine:

1. **Onboarding seller fino ad `active`** — registrati come nuovo seller, completa personal/document/company, attendi `pending_review`, da admin app vai su `/admin/sellers/<id>` e approva. Verifica che il seller passi a `active`.
2. **Primo negozio** — come seller `active`, atterra sulla home, vedi l'empty state, click "Aggiungi il primo negozio", compila form, click "Continua al pagamento (€29/mese)". Carta `4242 4242 4242 4242`. Vai su `/processing`, attendi spinner, redirect a `/`, toast "Negozio creato e attivo". Vedi il negozio nello store switcher.
3. **Secondo negozio (carta salvata)** — click "Aggiungi negozio" dalla sidebar/store-switcher, compila form, "Continua al pagamento". In Stripe Checkout dovresti vedere la carta `•••• 4242` già salvata. Conferma. Stesso flusso processing → `/`. Now you have 2 stores.
4. **Visualizza `/billing`** — vedi riepilogo `€58/mese per 2 negozi attivi`, tabella con 2 righe, storico fatture con 2 invoice paid, link "Gestisci pagamenti su Stripe" funzionante.
5. **Failure path** — su uno dei due negozi: `stripe trigger invoice.payment_failed --add invoice:subscription=<sub_id>`. Verifica banner arancione `past_due` in seller app. Dopo qualche secondo `stripe trigger invoice.payment_succeeded` → banner sparisce.
6. **Sospensione** — `stripe trigger customer.subscription.updated` con override `status=unpaid` (CLI: `--override customer.subscription.updated:status=unpaid`). Verifica banner rosso, store invisibile su customer app (`http://localhost:3001`).
7. **Cancellazione manuale** — su un negozio `active`, vai a `/store/`, "Zona di pericolo", "Cancella questo negozio". Confirm dialog mostra il period end. Confirm → banner blu canceling appare. Click "Annulla cancellazione" → banner sparisce.
8. **Customer Portal** — sul `/billing`, click "Gestisci pagamenti". Sei rediretto al portal Stripe hosted. Vedi le invoice. Aggiungi una nuova carta. Torni in `/billing`.
9. **Admin** — su admin app `/billing/overview` vedi MRR + counts. `/billing/pricing` cambia la quota a €35, conferma. Crea un nuovo negozio: dovrebbe ora costare €35. `/billing/subscriptions` filtra per email seller.

Se uno scenario fallisce, ferma la verifica e correggi prima di procedere.

- [ ] **Step 5: Push & open PR**

```bash
git push -u origin feat/seller-billing
gh pr create --title "feat(billing): seller per-store monthly subscription engine" \
  --body "$(cat <<'EOF'
## Summary
- Implementa il sistema di sottoscrizione mensile per-negozio (pay-to-create) come da [design](docs/superpowers/specs/2026-05-26-seller-store-subscription-billing-design.md).
- Onboarding seller ridotto a `pending_email → pending_personal → pending_document → pending_company → pending_review → active`.
- Aggiunta negozio = Stripe Checkout hosted + webhook idempotente che crea atomicamente `store` + `store_subscription`.
- Dunning Stripe Smart Retries (configurato in dashboard) + grace 7-10gg + soft suspension. Auto-cancel cron dopo 60gg in suspended.
- Cancellazione manuale: cancel-at-period-end + soft delete via `store.deletedAt`.
- UI billing seller (`/billing`) con summary + subscriptions + invoices + Customer Portal.
- UI admin (`/billing/overview`, `/pricing`, `/subscriptions`).

## Test plan
- [ ] `bun test` — 100% PASS (incluse nuove suite integration su webhook lifecycle, checkout, cancel, billing, jobs)
- [ ] `bun run --filter '*' typecheck` — PASS in tutti i workspace
- [ ] `bun run lint` — PASS
- [ ] Smoke E2E: vedi scenari 1-9 nel Task "Final verification" del [plan](docs/superpowers/plans/2026-05-26-seller-store-subscription-billing.md).

## Configuration prerequisites
Prima del merge, l'operatore Stripe deve:
- Configurare Smart Retries (4 tentativi, 1°/3°/5°/7° gg, action: `Mark as unpaid`).
- Configurare Customer Portal (update payment + invoice history + download PDF; disabilitare cancel/billing-details/plan-change).
- Settare `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_DEV_PRICE_ID`, `SELLER_APP_URL` in `.env.local`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Future work (post-merge)

Dal design, riportato qui per memoria del prossimo planner:

1. **Fattura elettronica SDI** (design separato): integrazione FattureInCloud.
2. **Stripe Tax** + Tax ID Italia (P.IVA come `tax_id` sul Customer).
3. **Reconciliation tools admin** per recuperare orphaned stores da Checkout sessions Stripe.
4. **Email transactional branded** (Resend/Postmark) per dunning, welcome, cancellation.
5. **Dispute / chargeback handler**.
6. **Multi-currency**.
7. **Stripe Connect** (payouts merchant): payment_methods table esistente già preparata.
8. **Revenue analytics**.
9. **Plan upgrade/downgrade**.
10. **Self-service reactivation** di negozi `canceled`.
11. **S3 cleanup** dei dati orphaned dai negozi cancellati.









