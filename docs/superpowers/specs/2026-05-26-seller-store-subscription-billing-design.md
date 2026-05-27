# Billing seller: quota mensile per negozio (pay-to-create)

**Data**: 2026-05-26
**Scope**:
- Database — nuove tabelle: `store_subscriptions`, `pending_store_creations`, `stripe_events`, `pricing_config`. ALTER su `seller_profiles` (`stripe_customer_id`). Riduzione enum `onboarding_status`.
- `apps/api/src/db/schemas/store-subscription.ts`, `pending-store-creation.ts`, `stripe-event.ts`, `pricing-config.ts` (nuovi)
- `apps/api/src/db/schemas/seller.ts` (rimozione stati onboarding intermedi + nuovo campo `stripeCustomerId`)
- `apps/api/src/modules/seller/routes/stores.ts` + `services/stores.ts` (split `POST /stores` admin-only, introduzione `POST /stores/checkout`)
- `apps/api/src/modules/seller/routes/onboarding.ts` + `services/onboarding.ts` (rimozione step `pending_store`, `pending_team`, `pending_payment`; mappa transizioni ridotta a `pending_company → pending_review → active`)
- `apps/api/src/modules/seller/routes/billing.ts` + `services/billing.ts` (nuovo: summary, subscriptions, invoices, portal session, cancel, reactivate)
- `apps/api/src/modules/admin/routes/billing.ts` + `services/billing.ts` (nuovo: overview MRR, pricing config CRUD, subscription list)
- `apps/api/src/modules/webhooks/stripe.ts` (nuovo modulo): firma + dedupe + handler per `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_*`
- `apps/api/src/jobs/auto-cancel-suspended-stores.ts` + `expire-pending-store-creations.ts` (nuovi, scheduler da decidere — vedi Open question)
- `apps/api/src/lib/stripe.ts` (nuovo: wrapper SDK Stripe singleton)
- `apps/seller/src/routes/_authenticated/billing.tsx` (nuovo)
- `apps/seller/src/routes/_authenticated/store/new.tsx` (riscritta per passare da `/stores/checkout`)
- `apps/seller/src/routes/_authenticated/store/new/processing.tsx` (nuova, polling + redirect)
- `apps/seller/src/routes/_authenticated/store/archived.tsx` (nuova)
- `apps/seller/src/routes/_authenticated/onboarding/store.tsx`, `team.tsx`, `payment.tsx` (eliminate)
- `apps/seller/src/hooks/use-onboarding.ts` (rimosse mutation morte)
- `apps/seller/src/components/store-billing-banner.tsx` (nuovo)
- `apps/admin/src/routes/_authenticated/payments.tsx` → rinominata `/billing/*` (overview, pricing, subscriptions)
- Script `bun run stripe:bootstrap` per seed Product + Price in test mode (nuovo)
- Stringhe Paraglide in `apps/{seller,admin}/messages/*.json` (banner, dialog, errors)

**Out of scope** (esplicito):
- **Fattura elettronica SDI**: design separato, da pianificare a parte. In MVP la ricevuta Stripe (PDF hosted) basta per beta chiusa, *non è una fattura valida fiscalmente in Italia per B2B*. Va emessa fattura manualmente dall'admin nel software del commercialista finché SDI non è integrato.
- **Stripe Tax**: nessun calcolo IVA scorporato. Prezzo flat €29 = "IVA inclusa". L'integrazione Stripe Tax + P.IVA del seller sul Customer arriverà col design SDI.
- **Stripe Connect** (lato seller-as-merchant, ricevere pagamenti customer): la tabella `payment_methods` resta in DB dormiente. Si riattiva con il design "ordini customer".
- **Email transactional custom**: in MVP ci affidiamo alle email Stripe (Customer Portal: pagamento fallito, carta in scadenza, conferma rinnovo). Localizzazione configurata in dashboard. Sistema email branded = future work.
- **Refund / chargeback / dispute handling**: webhook ignorati (log only) in MVP. Intervento admin manuale via dashboard Stripe.
- **Multi-currency**: schema preparato (`currency` ovunque), logica solo EUR.
- **Plan upgrade/downgrade**: una sola quota flat. Niente piani basic/pro.
- **Self-service reactivation** di negozi `canceled`: serve crearne un nuovo.
- **Revenue analytics avanzate** (MRR trend, churn, LTV): in MVP solo MRR istantaneo + conteggi stato.

## Obiettivo

Permettere al seller di aggiungere uno o più punti vendita ("negozi") alla propria gestione, dietro pagamento di una quota mensile fissa per ciascun negozio. Il negozio non viene creato finché la prima quota non è incassata. I rinnovi mensili sono automatici; il fallimento di rinnovo passa per un grace period (dunning Stripe + soft suspension); la cancellazione volontaria mantiene accesso fino a fine ciclo già pagato; la cancellazione definitiva archivia il negozio conservando i dati storici.

L'obiettivo trasversale è coerente con PRODUCT.md: **trust through identity, community before transaction, never grow at the merchant's expense**. Il dunning è progettato per non punire problemi amministrativi banali (carta scaduta) trattandoli come saracinesche abbassate; al contempo, la sospensione finale protegge il customer dal "negozio zombie" non più operativo.

## Decisioni chiave (negoziate in brainstorming)

| Tema | Decisione |
|---|---|
| Significato di "pay-to-X" | **Aggiungere**, non raggiungere. Pay-first-then-create: il negozio non esiste in DB finché Stripe non conferma il primo pagamento. |
| Primo negozio | Paga come gli altri (nessun caso speciale, nessun freemium, nessun trial). |
| Struttura quota | **Flat unica, configurabile da admin** via tabella `pricing_config` (history table, 1 row active). Cambi di prezzo non toccano sub esistenti (Stripe Price cristallizzato). |
| Gestione rinnovo fallito | **Stripe Smart Retries** (4 tentativi su 7-10 gg) + banner privato in back-office durante grace + soft suspension a tentativi esauriti. Configurazione one-time in Stripe Dashboard. |
| Modello subscription | **Una subscription Stripe per negozio**. Isolamento atomico: sospensione/cancel di un negozio non tocca gli altri. Aggregazione consolidata in UI seller (`/billing`). |
| Fatturazione SDI | **Rimandata a design separato**. Future work tracciato esplicito; MVP usa ricevute Stripe (non fiscalmente valide B2B in Italia). |
| Flusso checkout | **Stripe Checkout hosted** in mode `subscription` per ogni aggiunta. `payment_method_collection: 'if_required'` → primo addebito raccoglie carta, successivi mostrano "Pay with •••• 1234" in 1 click. SCA gestito da Stripe. |
| Cancellazione manuale | **Cancel at period end + soft delete**. Stato `canceling` reversibile finché period non scade. Al period_end: `store.deletedAt` set, dati conservati, vista `/store/archived` read-only. |
| Cancellazione di negozio `suspended` | **Cancel immediato** (period scaduto, sub già in unpaid). Stessa endpoint, branch interno. |
| Onboarding sequencing | **Admin approva prima, paga dopo.** Onboarding rivisto: `pending_email → pending_personal → pending_document → pending_company → pending_review → active`. Rimossi `pending_store`, `pending_team`, `pending_payment`. Aggiunta primo negozio = task post-attivazione, flusso identico ai successivi. |
| Stato del negozio rispetto al billing | **5 stati derivati da `store_subscriptions.status`**: `active`, `past_due`, `canceling`, `suspended`, `canceled`. Customer query filtra `IN ('active','past_due','canceling')`. Seller query include anche `suspended`. `canceled` → solo in archivio. |
| Auto-cancel da `suspended` prolungato | Cron quotidiano cancella sub Stripe dopo N giorni (default **60**, configurabile in `pricing_config.suspendedAutoCancelDays`). |
| Customer Portal Stripe | **Sì**, abilitato per: update payment method, view/download invoice. **Disabilitato** per: cancel sub (lo facciamo noi per controllare `cancel_reason` e UX), update billing details, plan change. |
| Idempotenza webhook | Tabella `stripe_events(event_id PK)`. INSERT ON CONFLICT DO NOTHING. Handler derivano sempre stato dal payload Stripe, mai da delta. |
| Crystallizzazione prezzi | `store_subscriptions.feeAmountCents` + `stripePriceId` salvati alla creazione e mai modificati. Stesso pattern su `pending_store_creations.feeAmountCents`. |
| Stripe account | **Test mode** è gratis e istantaneo (no business verification). Tutto il dev e CI usa test mode con `stripe listen` per webhook forwarding. Live mode = task operativo di go-live, separato. |

---

## Architettura — modello stati del negozio

```
                    primo pagamento OK
       (nessuno) ──────────────────────────► active
                                              │  ▲   ▲   ▲
              invoice.payment_failed (1°)     │  │   │   │
                                              ▼  │   │   │
                                          past_due │   │
                                              │    │   │
                            grace scaduto     │    │   │
                            (sub → unpaid)    │    │   │
                                              ▼    │   │
                                          suspended│   │
                                              │    │   │
                  paga via Customer Portal    │    │   │
                  (invoice.paid)              └────┘   │
                                                       │
       active ─────────────────────────► canceling ────┘ (annulla cancellazione)
                seller cancella               │
                                              │ period end (sub.deleted)
                                              ▼
                                          canceled
                                              ▲
                                              │ N giorni in suspended (cron)
                                          suspended
```

Visibilità per stato:

| Stato | Visibile customer | Back-office seller | Note |
|---|---|---|---|
| `active` | ✅ | ✅ pieno accesso | Stato normale |
| `past_due` | ✅ | ✅ pieno accesso + banner arancione | Stripe ritenta (4 tentativi / 7-10gg) |
| `canceling` | ✅ | ✅ pieno accesso + banner blu + "Annulla cancellazione" | Reversibile fino a period end |
| `suspended` | ❌ | ⚠️ read-only + banner rosso bloccante + CTA Customer Portal | Dati intatti, ripristino 1 click |
| `canceled` | ❌ | 📦 solo in `/store/archived` (read-only) | `store.deletedAt` impostato |

Query backend:

```ts
// Customer (mappa, ricerca, dettaglio negozio pubblico)
.where(and(
  isNull(store.deletedAt),
  inArray(storeSubscription.status, ['active', 'past_due', 'canceling']),
))

// Seller (lista negozi gestiti)
.where(and(
  isNull(store.deletedAt),
  inArray(storeSubscription.status, ['active', 'past_due', 'canceling', 'suspended']),
))

// Archivio (seller + admin)
.where(isNotNull(store.deletedAt))
```

---

## Onboarding rework

### Stati attuali (`apps/api/src/db/schemas/seller.ts:18-29`)

```
pending_email → pending_personal → pending_document → pending_company
              → pending_store → pending_team → pending_payment
              → pending_review → active (oppure rejected)
```

`pending_payment` oggi configura Stripe Connect (placeholder, `onboarding/payment.tsx` con commento *"For now, skip Stripe Connect"*). Niente a che vedere con la quota della piattaforma.

### Stati nuovi

```
pending_email → pending_personal → pending_document → pending_company
              → pending_review → active (oppure rejected)
```

**Rimossi**: `pending_store`, `pending_team`, `pending_payment`. Primo negozio, team e pagamento quota non sono prerequisiti per "essere un seller verificato": sono task post-attivazione.

### Diff API

- `apps/api/src/modules/seller/services/onboarding.ts`: mappa transizioni ridotta. `pending_company → pending_review` diretto. Rimossi handler per gli stati eliminati.
- `apps/api/src/modules/seller/routes/onboarding.ts`: eliminati endpoint POST `/onboarding/store`, `/onboarding/team`, `/onboarding/payment`. La creazione store passa per il nuovo `POST /seller/stores/checkout`.
- `apps/api/src/db/schemas/seller.ts`: array `onboardingStatuses` ridotto. Tipo `OnboardingStatus` propaga via Eden Treaty ai 3 frontend (typecheck obbliga ad allineare).

### Diff seller app

- Eliminate: `apps/seller/src/routes/_authenticated/onboarding/store.tsx`, `team.tsx`, `payment.tsx`.
- `pending.tsx` resta (in attesa di admin review).
- `apps/seller/src/hooks/use-onboarding.ts`: rimosse `useUpdateStore`, `useUpdateTeam`, `useUpdatePayment`.

### Dormienti

- **Stripe Connect / `payment_methods`**: resta in DB intatta, nessuna mutation/UI in MVP. Tornerà col design "ordini customer".

### Empty state post-attivazione

Quando il seller atterra su `apps/seller/` come `active` senza negozi:

> **Benvenuto su bibs.**
> Il tuo profilo è stato approvato. Per iniziare, aggiungi il tuo primo punto vendita.
> [Aggiungi il primo negozio] →

Click → stesso flusso degli N-esimi negozi: form negozio → Stripe Checkout → webhook → store creato.

### Migration onboarding

App in dev, nessun utente in prod ([[project_dev_stage_no_prod]]):

```sql
-- safety net: aggiorna eventuali seller su stati morti
UPDATE seller_profiles
SET onboarding_status = 'pending_review'
WHERE onboarding_status IN ('pending_store', 'pending_team', 'pending_payment');

-- ricrea CHECK constraint sul text-enum (pattern [[feedback_text_enum_over_pgenum]])
ALTER TABLE seller_profiles DROP CONSTRAINT IF EXISTS seller_profiles_onboarding_status_check;
ALTER TABLE seller_profiles ADD CONSTRAINT seller_profiles_onboarding_status_check
  CHECK (onboarding_status IN ('pending_email','pending_personal','pending_document',
                                'pending_company','pending_review','active','rejected'));
```

Aggiorna anche `apps/api/src/db/seed/fixtures/sellers.ts` (rimuovi gli stati morti).

---

## Flusso "aggiungere un negozio"

### UX

```
1. Seller clicca "Aggiungi negozio"
   (empty state se primo, sidebar/lista negozi se successivo)

2. /store/new — form negozio (nome, indirizzo, città, categoria, orari, …)
   CTA: "Continua al pagamento (€29/mese)"

3. POST /seller/stores/checkout — backend valida i dati, prepara
   Checkout Session Stripe e ritorna { checkoutUrl, pendingStoreCreationId }

4. Redirect a Stripe Checkout (pagina hosted)
   • Primo negozio: form carta vuoto
   • N-esimo negozio (carta salvata): "Pay with •••• 1234" in 1 click
   • SCA/3DS: gestito da Stripe automaticamente

5. Pagamento ok → Stripe redirect a /store/new/processing?session_id=cs_xxx

6. Pagina "processing" (loading)
   • Polla GET /seller/checkout-sessions/{id}/status ogni 1s
   • Aspetta che il webhook abbia creato lo store
   • Timeout 60s con fallback "ricarica/ti notifichiamo via email"

7. Status: ready → setActiveStoreId(newStoreId) + redirect /
   Toast: "Negozio creato e attivo."
```

**Cancel flow**: seller annulla su Stripe → redirect a `/store/new?cancel=1` con form data ripescata dalla `pending_store_creations` ancora `open` (endpoint `GET /seller/stores/checkout/:pendingId`).

### Tabella `pending_store_creations`

Il form negozio ha 15+ campi (incluso `openingHours` JSON, addresses, ecc.). Stripe `metadata` è limitato (50 chiavi × 500 char), quindi snapshotti tutto nel DB con un nonce e passi solo `pendingStoreCreationId` come metadata.

```ts
export const pendingStoreCreationStatuses = [
  'open', 'consumed', 'expired', 'canceled',
] as const;

export const pendingStoreCreation = pgTable('pending_store_creations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sellerProfileId: text('seller_profile_id').notNull()
    .references(() => sellerProfile.id, { onDelete: 'cascade' }),
  formData: jsonb('form_data').notNull(),
  stripeCheckoutSessionId: text('stripe_checkout_session_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id'),
  feeAmountCents: integer('fee_amount_cents').notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
  status: text('status', { enum: pendingStoreCreationStatuses })
    .notNull().default('open'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('pending_store_creation_one_open_idx').on(t.sellerProfileId)
    .where(sql`${t.status} = 'open'`),  // 1 sola pending aperta per seller
]);
```

### Endpoint API seller

```
POST /seller/stores/checkout
  body: CreateStoreBody (lo stesso schema di POST /seller/stores)
  auth: seller con onboardingStatus = 'active'
  response:
    200: { checkoutUrl: string, pendingStoreCreationId: string }
  logica:
    1. Valida body (TypeBox CreateStoreBody)
    2. Recupera/crea Stripe Customer (cache in seller_profiles.stripeCustomerId)
    3. Legge currentPriceId + currentFeeCents da pricing_config (is_active=true)
    4. INSERT pending_store_creations (form_data, fee_amount_cents, expires_at = now+24h)
    5. stripe.checkout.sessions.create({
         mode: 'subscription',
         customer,
         line_items: [{ price: stripePriceId, quantity: 1 }],
         payment_method_collection: 'if_required',
         metadata: { pendingStoreCreationId },
         subscription_data: { metadata: { pendingStoreCreationId } },
         success_url, cancel_url,
       })
    6. UPDATE pending_store_creations SET stripe_checkout_session_id
    7. return { checkoutUrl: session.url, pendingStoreCreationId }

GET /seller/checkout-sessions/:sessionId/status
  auth: seller
  response: { status: 'open' | 'ready' | 'expired' | 'canceled', storeId?: string }
  logica:
    legge pending_store_creations by sessionId;
    'ready' + storeId solo dopo che il webhook ha consumato la pending

GET /seller/stores/checkout/:pendingId
  auth: seller
  response: { formData: CreateStoreBody }  // per ripescare form su cancel
```

### POST /seller/stores

L'endpoint esistente diventa **admin-only** (creazione manuale d'emergenza per recovery; resta protetto come scope `admin`). Il flusso pubblico passa solo da `/stores/checkout`.

### Webhook handler

```
POST /webhooks/stripe
  signed: stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET)
  logica:
    1. INSERT stripe_events (event_id, event_type, received_at) ON CONFLICT DO NOTHING
       Se conflict → 200 (già processato), idempotente
    2. switch (event.type) {
         case 'checkout.session.completed': handleCheckoutCompleted(event)
         case 'customer.subscription.updated': handleSubUpdated(event)
         case 'customer.subscription.deleted': handleSubDeleted(event)
         case 'invoice.payment_succeeded': handleInvoicePaid(event)
         case 'invoice.payment_failed': handleInvoiceFailed(event)
       }
    3. UPDATE stripe_events SET processed_at = now() WHERE event_id = …
    4. return 200 (anche su errori interni: log + alert, mai 500 a Stripe che ritenterebbe)
```

**`handleCheckoutCompleted`** (transazione DB):

```ts
const session = event.data.object as Stripe.Checkout.Session;
if (session.payment_status !== 'paid') return;

const pendingId = session.metadata?.pendingStoreCreationId;
if (!pendingId) {
  log.warn({ sessionId: session.id }, 'checkout.session.completed without pendingStoreCreationId');
  return;
}

await db.transaction(async (tx) => {
  const pending = await tx.query.pendingStoreCreation.findFirst({
    where: and(
      eq(pendingStoreCreation.id, pendingId),
      eq(pendingStoreCreation.status, 'open'),
    ),
  });
  if (!pending) return; // idempotent, già consumata

  const sub = await stripe.subscriptions.retrieve(session.subscription as string);

  const [createdStore] = await tx.insert(store).values({
    sellerProfileId: pending.sellerProfileId,
    ...pending.formData,
  }).returning();

  await tx.insert(storeSubscription).values({
    storeId: createdStore.id,
    stripeSubscriptionId: sub.id,
    stripeCustomerId: sub.customer as string,
    stripePriceId: sub.items.data[0].price.id,
    feeAmountCents: pending.feeAmountCents,
    currency: pending.currency,
    status: 'active',
    currentPeriodEnd: new Date(sub.current_period_end * 1000),
  });

  await tx.update(pendingStoreCreation).set({
    status: 'consumed',
    stripeSubscriptionId: sub.id,
    consumedAt: new Date(),
  }).where(eq(pendingStoreCreation.id, pendingId));
});
```

**Mappa stati Stripe → `store_subscriptions.status`** (`handleSubUpdated`):

```ts
function mapStripeStatus(sub: Stripe.Subscription): StoreSubscriptionStatus {
  if (sub.status === 'canceled') return 'canceled';
  if (sub.status === 'unpaid') return 'suspended';
  if (sub.status === 'past_due') return 'past_due';
  if (sub.cancel_at_period_end) return 'canceling';
  if (sub.status === 'active' || sub.status === 'trialing') return 'active';
  // incomplete / incomplete_expired: questi non dovrebbero capitare con
  // payment_behavior='error_if_incomplete' in Checkout; log e tratta come past_due
  log.error({ subId: sub.id, status: sub.status }, 'Unexpected Stripe sub status');
  return 'past_due';
}
```

Side effect su transizione → `canceled` (`handleSubDeleted`):

```ts
await db.transaction(async (tx) => {
  const subRow = await tx.query.storeSubscription.findFirst({
    where: eq(storeSubscription.stripeSubscriptionId, sub.id),
  });
  if (!subRow) return;

  await tx.update(storeSubscription).set({
    status: 'canceled',
    canceledAt: new Date(),
    cancelReason: subRow.cancelReason ?? 'payment_failed_auto',
  }).where(eq(storeSubscription.id, subRow.id));

  await tx.update(store).set({ deletedAt: new Date() })
    .where(eq(store.id, subRow.storeId));
});
```

`cancelReason` viene pre-popolato dall'endpoint o dal cron che ha innescato la cancellazione (vedi sezioni cancellazione/dunning); il webhook si limita a non sovrascriverlo.

### Idempotenza & race condition

| Scenario | Difesa |
|---|---|
| Webhook duplicato da Stripe | `stripe_events.event_id` PK → INSERT ON CONFLICT DO NOTHING |
| Doppio click "Continua al pagamento" | UNIQUE parziale `pending_store_creations(seller_profile_id) WHERE status='open'`. Il 2° click rilegge la pending esistente e ritorna lo stesso `checkoutUrl`. |
| Seller chiude la tab dopo aver pagato | Webhook crea lo store comunque. Al rientro in app, store già presente. |
| Webhook in ritardo / pagamento ok | Polling `processing` con timeout 60s + fallback "ti notifichiamo via email". |
| Checkout abbandonato / TTL 24h scaduto | Cron `expire-pending-store-creations` marca `status='expired'`. Mai una riga `stores` orphaned. |
| Pagamento ok ma webhook mai arrivato (Stripe outage) | `pending_store_creations` resta `open` → expira a 24h. Recovery via reconciliation manuale admin (future work) o intervento operativo. |

---

## Rinnovo, dunning, sospensione

### Stripe Smart Retries (configurazione one-time)

Dashboard Stripe → Settings → Subscriptions and emails → Smart Retries:

- **Numero di retry**: 4
- **Distribuzione**: 1°, 3°, 5°, 7° giorno (o equivalente che esaurisca i tentativi in 7-10 giorni dalla prima fail)
- **Subscription status finale**: `Mark as unpaid` (NON `cancel`) → la sub resta in vita e il seller può "resuscitarla" pagando via Customer Portal
- **Email automatiche abilitate**: Stripe manda "Pagamento fallito" + "Carta in scadenza" in italiano (locale configurato nel Customer)

### Happy path (rinnovo automatico)

Stripe rinnova ogni mese alla `current_period_end`, genera invoice, addebita carta default del Customer. Webhook `invoice.payment_succeeded` → `handleInvoicePaid`:

```sql
UPDATE store_subscriptions SET
  current_period_end = (period.end dal payload),
  status = 'active',  -- solo se era past_due/suspended
  suspended_at = NULL
WHERE stripe_subscription_id = :sub_id
```

### Failure path

```
Giorno 0 (current_period_end)
  Stripe charge → DECLINED
  → invoice.payment_failed
  → status = 'past_due'  (idempotente)
  → Negozio ancora visibile customer + banner privato seller

Giorni 1-7: Stripe ritenta automaticamente
  Successo → invoice.payment_succeeded → 'active'
  Fallimento finale (4° tentativo esaurito) → customer.subscription.updated (status=unpaid)
    → 'suspended', suspended_at = now()
    → Negozio scompare dai customer
```

### Recovery path

Seller clicca "Aggiorna pagamento" → endpoint genera Customer Portal session → portal Stripe → aggiorna carta → Stripe ritenta la invoice "open" → `invoice.payment_succeeded` + `subscription.updated` → `'active'` + `suspended_at=NULL`. Negozio torna visibile.

UI seller: se redirect dal portal trova `suspended → active`, redirect home + toast "Negozio riattivato".

### Banner UI seller

Componente `<StoreBillingBanner />` montato nel layout `_authenticated.tsx` (legge stato dal contesto `useActiveStore`).

**`past_due`**: sticky-top arancione.
> ⚠️ Rinnovo non riuscito per **{Nome negozio}**. Aggiorna il metodo di pagamento entro **il GG/MM/AAAA** o il negozio sarà sospeso.
> [Aggiorna pagamento]

**`suspended`**: sticky-top rosso + dettaglio store read-only (`<fieldset disabled>` su tutte le form, bottoni "Salva" disabilitati con tooltip).
> 🔒 **{Nome negozio}** è sospeso. Non è visibile ai clienti. Paga il rinnovo per riattivarlo.
> [Riattiva ora]

Lo store switcher marca i negozi non-`active` con badge colorato. La vista `/billing` aggrega lo stato di tutti.

### Auto-cancel da sospensione prolungata

Cron `auto-cancel-suspended-stores.ts`, 1×/giorno:

```ts
const cutoffDays = await getPricingConfig().then(c => c.suspendedAutoCancelDays);
const cutoff = subDays(new Date(), cutoffDays);

const subs = await db.select().from(storeSubscription).where(and(
  eq(storeSubscription.status, 'suspended'),
  lte(storeSubscription.suspendedAt, cutoff),
));

for (const sub of subs) {
  // Pre-set reason così handleSubDeleted lo trova
  await db.update(storeSubscription)
    .set({ cancelReason: 'payment_failed_auto' })
    .where(eq(storeSubscription.id, sub.id));

  await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
  // Webhook customer.subscription.deleted gestisce DB cleanup
}
```

### Webhook → DB (riepilogo idempotente)

| Event | Effetto `store_subscriptions` | Effetto `store` |
|---|---|---|
| `checkout.session.completed` (paid) | INSERT (status=active) | INSERT |
| `invoice.payment_succeeded` | UPDATE current_period_end, status=active, suspended_at=NULL | – |
| `invoice.payment_failed` | UPDATE status=past_due | – |
| `customer.subscription.updated` (active) | UPDATE status=active, cancel_at_period_end | – |
| `customer.subscription.updated` (past_due) | UPDATE status=past_due | – |
| `customer.subscription.updated` (unpaid) | UPDATE status=suspended, suspended_at=now() | – |
| `customer.subscription.updated` (cancel_at_period_end=true) | UPDATE status=canceling | – |
| `customer.subscription.deleted` | UPDATE status=canceled, canceled_at=now() | UPDATE deletedAt=now() |

---

## Cancellazione manuale

### Entry point UX

- **`/store/`** (impostazioni negozio): sezione "Zona di pericolo" con bottone secondario `Cancella questo negozio`.
- **`/billing`**: ogni riga subscription ha kebab action `Cancella` / `Annulla cancellazione` / `Riattiva` a seconda dello stato.

### Confirm dialog (testi)

**Per `active` / `past_due`**:
> **Cancellare il negozio "{Nome}"?**
> Continuerai a pagare e usarlo normalmente fino al **GG/MM/AAAA** (fine del ciclo già pagato). Dopo quella data il negozio sarà archiviato: non sarà più visibile ai clienti e tu non potrai più modificarlo. I dati storici (ordini, prodotti, recensioni) saranno conservati ma in sola lettura.
> [Conferma cancellazione] [Annulla]

**Per `suspended`**:
> **Cancellare definitivamente "{Nome}"?**
> Il negozio è già sospeso per mancato pagamento. Cancellandolo, sarà archiviato immediatamente. I dati storici saranno conservati ma in sola lettura.
> [Cancella definitivamente] [Annulla]

### Endpoint `DELETE /seller/stores/:storeId`

```ts
const sub = await getStoreSubscription(storeId);

switch (sub.status) {
  case 'active':
  case 'past_due':
    await db.update(storeSubscription)
      .set({ cancelReason: 'seller_canceled' })
      .where(eq(storeSubscription.id, sub.id));
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
    // Webhook: status='canceling', cancel_at_period_end=true
    return { status: 'canceling', effectiveAt: sub.currentPeriodEnd };

  case 'suspended':
    await db.update(storeSubscription)
      .set({ cancelReason: 'seller_canceled' })
      .where(eq(storeSubscription.id, sub.id));
    await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
    // Webhook: status='canceled', store.deletedAt=now
    return { status: 'canceled', effectiveAt: new Date() };

  case 'canceling':
    return { status: 'canceling', effectiveAt: sub.currentPeriodEnd }; // idempotente

  case 'canceled':
    throw new ServiceError(404, 'Negozio già cancellato');
}
```

### Endpoint `POST /seller/stores/:storeId/reactivate`

Annulla un `cancel_at_period_end` (reversibile finché period non scade):

```ts
if (sub.status !== 'canceling')
  throw new ServiceError(409, 'Negozio non in cancellazione');

await stripe.subscriptions.update(sub.stripeSubscriptionId, {
  cancel_at_period_end: false,
});
// Webhook: status='active'
```

### Vista `/store/archived`

Nuova rotta seller: tabella read-only dei negozi con `deletedAt IS NOT NULL`. Colonne: nome, indirizzo, data creazione, data archiviazione, motivo (`seller_canceled` / `payment_failed_auto` / `admin_canceled` derivato da `cancelReason`). Nessuna azione; per tornare con quel negozio, il seller crea un nuovo store.

Endpoint: `GET /seller/stores/archived?page&limit` (cap 100 per `[[feedback_pagination_limit_cap_100]]`).

### Dati figli del negozio

| Entità | Comportamento alla cancellazione |
|---|---|
| `store_products` | Restano linkati, invisibili via filtro `store.deletedAt IS NULL` |
| `orders` storici | Conservati |
| `store_employees` | Restano; employee assegnati solo a quel negozio perdono accesso (filtro `getAccessibleStoreIds`) |
| `store_images`, `store_phone_numbers` | Restano. Storage S3 non viene pulito (cleanup eventuale = future work) |

---

## UI seller `/billing`

`apps/seller/src/routes/_authenticated/billing.tsx` (nuova).

### Header card "Riepilogo"

```
┌─────────────────────────────────────────────────────┐
│ Stai pagando €87/mese per 3 negozi attivi           │
│ Prossimo rinnovo: 24 dicembre — Pasticceria Bianchi │
│                                                     │
│ [Gestisci pagamenti su Stripe]                      │
└─────────────────────────────────────────────────────┘
```

CTA → `POST /seller/billing/portal` → Customer Portal session → redirect.

### Tabella subscription

| Negozio | Stato | Quota | Prossimo rinnovo | Azioni |
|---|---|---|---|---|
| Pasticceria Bianchi | ●Attivo | €29 | 24 dic | ⋯ |
| Bianchi via XX | ●Rinnovo fallito | €29 | scaduto il 10 dic | ⋯ |
| Bianchi Loreto | ●In cancellazione | €29 | disattivazione 5 gen | ⋯ |

Azioni per riga (kebab):
- `Gestisci pagamento` → Customer Portal session
- `Cancella` (se `active`/`past_due`) → confirm dialog
- `Annulla cancellazione` (se `canceling`)
- `Riattiva` (se `suspended`) → Customer Portal session

### Storico fatture

Tabella read-only, paginata: data, negozio, importo, stato (Stripe invoice status), link "Scarica PDF" (URL `invoice.invoice_pdf`).

Le invoice non sono memorizzate in MVP: chiamiamo `stripe.invoices.list({ customer, limit })` lazy. SDI = future work.

### Endpoint seller billing

```
GET /seller/billing/summary
  → { totalMonthlyCents, activeStoresCount, nextRenewal: { storeId, date, amountCents } }

GET /seller/billing/subscriptions
  → [{ storeId, storeName, status, feeAmountCents, currentPeriodEnd, cancelAtPeriodEnd, suspendedAt }]

GET /seller/billing/invoices?page&limit
  → { data: [...], pagination: { ... } }  // limit ≤ 100

POST /seller/billing/portal
  → { url }
```

---

## UI admin `/admin/billing/*`

Sostituisce il placeholder `apps/admin/src/routes/_authenticated/payments.tsx`. Diventa una sezione `/admin/billing` con tab.

### `/admin/billing/overview`

Card:
- **MRR** = `SUM(fee_amount_cents) FROM store_subscriptions WHERE status IN ('active','past_due','canceling')`
- Negozi attivi (COUNT)
- Negozi in dunning (COUNT `past_due`)
- Negozi sospesi (COUNT `suspended`)

### `/admin/billing/pricing`

Card "Configurazione attuale":
```
Quota mensile: €29 EUR
Auto-cancel sospensione: 60 giorni
Expiry checkout pendente: 24 ore
[Modifica configurazione]

⚠️ Modificare la quota crea un nuovo Stripe Price. Le subscription
esistenti restano sul prezzo precedente. Solo i negozi creati da
questo momento useranno la nuova quota.
```

Modale modifica: form con `storeMonthlyFeeCents`, `currency` (whitelist), `suspendedAutoCancelDays`, `pendingCreationExpiryHours`. Submit → backend crea nuovo Stripe Price + flippa `is_active`.

Tabella sotto: storico configurazioni (read-only).

### `/admin/billing/subscriptions`

Lista globale `store_subscriptions` con filtri: stato, seller email, store nome, range date. Drill-down a `/admin/sellers/:id`. Read-only in MVP.

### Endpoint admin billing

```
GET /admin/billing/overview
  → { mrrCents, activeStoresCount, pastDueCount, suspendedCount }

GET /admin/billing/pricing/current
  → pricing_config con is_active=true

PUT /admin/billing/pricing
  body: { storeMonthlyFeeCents, currency, suspendedAutoCancelDays, pendingCreationExpiryHours }
  logica: crea nuovo Stripe Price + INSERT row + flip is_active sulla precedente

GET /admin/billing/pricing/history?page&limit
GET /admin/billing/subscriptions?page&limit&filters
```

---

## Customer Portal Stripe — configurazione one-time

Dashboard Stripe → Settings → Billing → Customer portal:

- ✅ Update payment method
- ✅ View invoice history
- ✅ Download invoice PDF
- ❌ Cancel subscription (gestita da nostro endpoint per usare `cancelReason` e UX custom)
- ❌ Update billing details (gestita dal nostro profilo seller)
- ❌ Change quantity / change plan

Return URL: `https://<seller-app>/billing`.

---

## Schema DB — riepilogo

### Nuova: `store_subscriptions`

```ts
export const storeSubscriptionStatuses = [
  'active', 'past_due', 'canceling', 'suspended', 'canceled',
] as const;

export const storeSubscription = pgTable('store_subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  storeId: text('store_id').notNull().unique()
    .references(() => store.id, { onDelete: 'restrict' }),
  stripeSubscriptionId: text('stripe_subscription_id').notNull().unique(),
  stripeCustomerId: text('stripe_customer_id').notNull(),
  stripePriceId: text('stripe_price_id').notNull(),
  feeAmountCents: integer('fee_amount_cents').notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
  status: text('status', { enum: storeSubscriptionStatuses }).notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  cancelReason: text('cancel_reason'),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
    .$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('store_subscription_status_idx').on(t.status),
  index('store_subscription_period_end_idx').on(t.currentPeriodEnd),
  index('store_subscription_suspended_idx')
    .on(t.suspendedAt).where(sql`${t.status} = 'suspended'`),
]);
```

`onDelete: 'restrict'` su `storeId`: impedisce hard-delete di `store` con sub esistente. La cancellazione passa sempre dal flusso webhook → `store.deletedAt`.

### Nuova: `pending_store_creations`

Vedi sezione "Flusso aggiungere un negozio".

### Nuova: `stripe_events`

```ts
export const stripeEvent = pgTable('stripe_events', {
  eventId: text('event_id').primaryKey(),  // Stripe event.id
  eventType: text('event_type').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});
```

### Nuova: `pricing_config`

```ts
export const pricingConfig = pgTable('pricing_config', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  storeMonthlyFeeCents: integer('store_monthly_fee_cents').notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
  stripePriceId: text('stripe_price_id').notNull(),
  suspendedAutoCancelDays: integer('suspended_auto_cancel_days').notNull().default(60),
  pendingCreationExpiryHours: integer('pending_creation_expiry_hours').notNull().default(24),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  createdByUserId: text('created_by_user_id')
    .references(() => user.id, { onDelete: 'set null' }),
}, (t) => [
  uniqueIndex('pricing_config_single_active_idx')
    .on(t.isActive).where(sql`${t.isActive} = true`),
]);
```

### ALTER: `seller_profiles.stripeCustomerId`

```ts
stripeCustomerId: text('stripe_customer_id').unique(),
```

Popolato al primo checkout (lazy); riusato per Customer Portal + checkout successivi.

### Dormienti

- **`payment_methods`** (Stripe Connect, ricezione customer): intatta, nessuna mutation/UI in MVP.
- **`store.deletedAt`**: già presente, riusato per soft delete.

### Migration sequence

```sql
-- A) Onboarding cleanup (seller cleanup + CHECK constraint)
-- (vedi sezione Onboarding rework)

-- B) seller_profiles.stripe_customer_id
ALTER TABLE seller_profiles ADD COLUMN stripe_customer_id text UNIQUE;

-- C) Nuove tabelle
CREATE TABLE pricing_config (…);
CREATE TABLE store_subscriptions (…);
CREATE TABLE pending_store_creations (…);
CREATE TABLE stripe_events (…);

-- D) Seed iniziale pricing_config (richiede Stripe Price creato prima)
INSERT INTO pricing_config (
  store_monthly_fee_cents, currency, stripe_price_id,
  suspended_auto_cancel_days, pending_creation_expiry_hours, is_active
) VALUES (2900, 'EUR', '<seed_stripe_price_id>', 60, 24, true);
```

### Seed dev/test

Script `bun run stripe:bootstrap` (nuovo, idempotente):
1. Usa `STRIPE_SECRET_KEY` (test) da env.
2. Crea Product "bibs - Quota mensile per negozio" (recurring, EUR €29) se non esiste.
3. Stampa `STRIPE_DEV_PRICE_ID` da copiare in `apps/api/.env.local`.
4. Seed `db/seed/fixtures/` inserisce `pricing_config` con quel price ID.

Webhook locale: `stripe listen --forward-to http://localhost:3000/webhooks/stripe`.

---

## Edge case (riepilogo)

**Coperti dal design**:
- Webhook duplicato → `stripe_events` dedupe.
- Pagamento ok ma webhook in ritardo → polling con timeout + fallback.
- Doppio click "Continua al pagamento" → unique index parziale su pending open.
- Seller abbandona checkout → expiration TTL 24h.
- Carta scaduta durante grace → Customer Portal + Stripe ritenta.
- Seller cancella in `past_due` → `cancel_at_period_end`.
- Seller cancella in `suspended` → cancel immediato.
- Cancellazione dell'unico negozio → empty state + Customer/carta preservati.
- Pricing change mid-month → cristallizzazione su sub esistente.
- Auto-cancel suspended prolungato → cron.

**Log + alert manuale (no auto-handling in MVP)**:
- Stripe Customer eliminato manualmente dal dashboard.
- Refund manuale di una invoice tramite dashboard.
- Disputa / chargeback (`charge.dispute.created`).
- Pagamento ok ma webhook MAI arrivato (Stripe outage prolungato): recovery via reconciliation manuale.

**Impossibile per design**:
- Seller `rejected` con sub attive (sequencing: review precede primo checkout).

---

## Future work

Ordinati per priorità.

1. **Fattura elettronica SDI** — design separato. Provider candidato: FattureInCloud. Webhook `invoice.payment_succeeded` → emissione XML SDI. Richiede: campo `codice_destinatario_sdi`/PEC sul seller, sincronizzazione cambio P.IVA, tabella `fiscal_invoice` tracciante.
2. **Stripe Tax + Tax ID Italia**. Setup IVA italiana (22%), P.IVA seller come `tax_id` sul Stripe Customer, invoice con IVA scorporata.
3. **Reconciliation tools admin**. Endpoint per recuperare store orphaned da Stripe Checkout sessions vs DB. Drift detection sub Stripe ↔ `store_subscriptions`.
4. **Email transactional branded** (Resend/Postmark) per dunning, welcome, cancellation. Sostituisce le email Stripe di default. Italiane.
5. **Dispute / chargeback handler**. Sospensione automatica su `charge.dispute.created` + workflow admin review.
6. **Multi-currency**. Schema già preparato, serve abilitare logica calcolo + UI.
7. **Stripe Connect** (payouts merchant). Slegato dal billing; `payment_methods` già preparata. Attivato col design "ordini customer".
8. **Revenue analytics**. MRR trend, churn, LTV, dashboard admin avanzata.
9. **Plan upgrade/downgrade**. Se mai si evolve da flat a piani multipli.
10. **Self-service reactivation** di negozi `canceled`. Oggi serve crearne uno nuovo.
11. **S3 cleanup** dei dati orphaned dai negozi cancellati (immagini, foto profilo storage).

---

## Open question (da chiudere prima del plan)

1. **Job runner / cron**. Per `auto-cancel-suspended-stores` ed `expire-pending-store-creations` (e altri futuri). 3 opzioni:
   - (a) `setInterval` Bun nel processo API (semplice, ma muore al restart, non distribuito).
   - (b) Cron sul container/host (Docker / fly.io / …).
   - (c) GitHub Actions scheduled workflow → chiama endpoint admin protetto.
2. **Suspended auto-cancel default**. 60 giorni in `pricing_config.suspendedAutoCancelDays` è una scelta ragionevole ma da confermare prima del go-live (alternative: 30 / 90).

---

## Stripe configuration — riepilogo one-time

Da fare manualmente nel Dashboard Stripe (test mode prima, replicare in live al go-live):

- **Smart Retries**: 4 tentativi su 7-10gg, azione finale `Mark as unpaid`.
- **Customer Portal**: abilitare update payment + invoice history + download PDF; disabilitare cancel/billing-details/plan-change.
- **Customer emails locale**: italiano.
- **Webhook endpoint**: `https://<api-host>/webhooks/stripe` con eventi `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.deleted`. `STRIPE_WEBHOOK_SECRET` in `.env`.
- **Product + Price seed**: via `bun run stripe:bootstrap`. `STRIPE_DEV_PRICE_ID` (test) e `STRIPE_LIVE_PRICE_ID` (prod) salvati in env separati.
