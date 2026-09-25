# PR E — Stripe Connect Express per i pagamenti online Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il titolare attiva i pagamenti online dal proprio profilo seller (onboarding Stripe ospitato), bibs tiene lo stato del conto in `payment_methods` aggiornato dal webhook `account.updated`, e il negozio può accendere «Paga e ritira» (PR2) nelle sue «Tipologie d'acquisto» solo con il conto abilitato. Il vecchio flusso manuale (ID `acct_…` digitato dal seller e approvato dall'admin) sparisce. Nessun cliente può ancora scegliere PR2: il pagamento vero arriva con la PR F.

**Architecture:** API: `payment_methods` guadagna `charges_enabled`, `payouts_enabled`, `details_submitted`, `updated_at` e un unique su `stripe_account_id`. Un servizio unico in `modules/billing/services/connect-account.ts` crea il conto (v1 Accounts con controller properties equivalenti a Express, country IT, idempotency key per seller), genera l'Account Link e rilegge il conto da Stripe (`refreshConnectAccount`) — lo usano sia la route seller `sync` sia il webhook. Il webhook Connect ha una route sua (`POST /webhooks/stripe/connect`) con il suo segreto e riusa dispatcher e ledger `stripe_events`. `offeredOrderTypes(configured, { chargesEnabled })` resta l'unica regola su cosa si offre al checkout: `pay_pickup` richiede `chargesEnabled` **e** `ONLINE_PAYMENT_LIVE`, che resta `false` fino alla PR F. Seller FE: card «Pagamenti online» nel profilo, route `/payments/return` e `/payments/refresh`, sezione «Tipologie d'acquisto» nella pagina negozio.

**Tech Stack:** Elysia + TypeBox, Drizzle (drizzle-kit generate), stripe-node 22.6.2 (API `2026-08-26.dahlia`), bun:test + testcontainers; TanStack Start + TanStack Query, paraglide (it/en), `@bibs/ui`.

**Spec:** `docs/superpowers/specs/2026-09-24-customer-checkout-design.md` — sezioni «Pagamento PR2 (PR E + F)», «Tipologie consentite dal negozio», riga **E** di «Taglio in PR». Backlog: riga **P1.1** di `docs/audit/2026-09-24-followup-gap-analysis.md`.

## Global Constraints

- Conto Connect: `country: "IT"`, onboarding **ospitato da Stripe** via Account Link `type: "account_onboarding"`; `return_url = ${SELLER_APP_URL}/payments/return`, `refresh_url = ${SELLER_APP_URL}/payments/refresh` (seller su `:3002` in dev).
- `payment_methods` è la **fonte** del conto: `stripe_account_id`, `charges_enabled`, `payouts_enabled` (più `details_submitted`), aggiornati dal webhook `account.updated`, idempotente sulla tabella `stripe_events` esistente.
- Si rimuovono la richiesta di modifica `payment` (`seller/services/settings.ts:350-378`, route `PATCH /seller/settings/payment`) e la sua approvazione admin (`admin/services/sellers.ts:525-548`).
- `pay_pickup` attivabile nelle «Tipologie d'acquisto» **solo** con `charges_enabled`; `offeredOrderTypes` lo offre solo in quel caso — e, fino alla PR F, mai (`ONLINE_PAYMENT_LIVE = false`).
- Stripe v22: niente campi rimossi/spostati (vedi memoria `current_period_end`); `charges_enabled`, `payouts_enabled`, `details_submitted` stanno top-level su `Stripe.Account`; `event.account` porta l'id del conto collegato.
- Stripe nei test: `mock.module("@/lib/stripe", …)` come nei test di billing, niente rete. `@/lib/env` mockato con tutte le chiavi che il codice sotto test legge.
- Solo il **titolare** gestisce pagamenti e tipologie (`requireOwner`); un employee non vede lo stato del conto (redazione in `getSellerSettings`).
- Testi in italiano per l'utente; i18n seller con paraglide (`apps/seller/messages/it.json` + `en.json`). Badge di stato al singolare.
- Mai `from "sonner"` diretto: `@bibs/ui/components/sonner`. In seller l'alias è `@/*` → `./src/*`.
- Nuove route TanStack: committa anche `apps/seller/src/routeTree.gen.ts` (rigenerato da `bun run --cwd apps/seller build`).
- Commit Conventional con scope della whitelist di `AGENTS.md:394-397` (`api`, `db`, `seller`, `orders`, `stores`; per i docs `docs(orders)` come nelle PR A–D). Mai indebolire asserzioni o toccare la produzione per ottenere un RED.
- PR **senza auto-merge** (ha UI): `/commit-commands:commit-push-pr`, non la skill `commit-push-pr`.

## Rulings

Decisioni prese qui; ognuna con il costo se sbagliata.

1. **Come si evita un `pay_pickup` non pagabile prima della F.** Resta il flag `ONLINE_PAYMENT_LIVE = false` dentro `lib/order-types.ts`, ma ora in `and` con `chargesEnabled`: il seller può accendere PR2 (con il conto abilitato), il carrello e il checkout non lo offrono finché la F non mette il flag a `true` insieme al PaymentIntent. `offeredOrderTypes` accetta `live` come opzione con default al flag, così lo unit test copre anche il ramo vero senza che nessun chiamante lo passi. Il seller vede nella sezione «Tipologie d'acquisto» che PR2 è acceso ma non ancora offerto (campo `offeredOrderTypes` nella risposta). Costo se sbagliato: zero rework, la F cambia una costante e un test.
2. **Regole sul salvataggio delle tipologie** (`PATCH /seller/stores/:storeId/order-types`): (a) *aggiungere* `pay_pickup` senza `chargesEnabled` → 400; toglierlo è sempre permesso, e tenerlo acceso se il conto viene poi disabilitato è permesso (resta configurato, non offerto). (b) dopo il salvataggio deve restare **almeno una tipologia offerta** ai clienti → 400 altrimenti. Prima della F (b) obbliga a tenere acceso PP1: un negozio con solo PR2 sarebbe invisibile al checkout. Endpoint separato da `PATCH /stores/:id` perché una regola che dipende dal conto non deve bloccare il salvataggio di nome/orari.
3. **Conto v1 con controller properties, non `type: "express"` né Accounts v2.** Stripe marca `type` come legacy e raccomanda le controller properties; la combinazione `stripe_dashboard.type: "express"`, `fees.payer: "application"`, `losses.payments: "application"`, `requirement_collection: "stripe"` è l'Express documentato (la differenza `application` vs `application_express` conta solo per le direct charge, che non usiamo: la F fa separate charges and transfers). Accounts v2 scartato: il webhook dello spec è il v1 `account.updated` (scope «Connected accounts») e v2 porterebbe thin events e un secondo schema di eventi. Capabilities richieste: `card_payments` e `transfers`, così `charges_enabled` ha il significato che lo spec gli dà e `on_behalf_of` resta possibile nella F. Costo se sbagliato: il tipo di dashboard è immutabile → i conti creati andrebbero ricreati; in dev non ne esiste nessuno.
4. **Il webhook rilegge il conto da Stripe** (`stripe.accounts.retrieve`) invece di fidarsi dello snapshot dell'evento: gli `account.updated` possono arrivare fuori ordine e uno snapshot vecchio sovrascriverebbe uno nuovo. Una chiamata API in più per evento, in cambio di uno stato sempre corretto. La stessa funzione serve a `POST /seller/settings/payments/sync`, che il FE chiama al ritorno dall'onboarding (la doc Stripe dice di non fidarsi del `return_url` e di rileggere il conto; in locale il webhook Connect può anche non essere inoltrato). Costo se sbagliato: nessuno funzionale, solo latenza.
5. **Route webhook separata** `POST /webhooks/stripe/connect` con `STRIPE_CONNECT_WEBHOOK_SECRET` (fallback a `STRIPE_WEBHOOK_SECRET`): in produzione gli eventi dei conti collegati arrivano da una event destination diversa, con un segreto diverso; in locale `stripe listen --forward-to … --forward-connect-to …` usa un solo segreto, da qui il fallback. Dispatcher e ledger `stripe_events` sono gli stessi (gli `event.id` sono unici su Stripe).
6. **Creazione del conto senza doppioni**: nella transazione si prende il lock sulla riga `seller_profiles` (`FOR UPDATE`), si rilegge `payment_methods`, e solo se manca il conto si chiama `accounts.create` con `idempotencyKey: "connect-account:<sellerProfileId>"`. Doppio click o due schede → un solo conto. Il conto si crea con la mail dell'utente e `metadata.sellerProfileId`.
7. **Dati legacy**: la migrazione cancella le righe `seller_profile_changes` con `change_type = 'payment'` (altrimenti il nuovo CHECK fallisce) e azzera `payment_methods.stripe_account_id` inseriti a mano (non sono conti creati dalla piattaforma: un Account Link su di essi fallirebbe). App in dev, seed senza `payment_methods`. Costo se sbagliato: nessuno, non ci sono dati reali.
8. **UI seller/admin del flusso manuale**: verificato che **non esistono** (nessun uso di `settings.payment` in `apps/seller`, nessuna UI di approvazione modifiche in `apps/admin`). La rimozione è solo API + test + docs (`apps/api/AGENTS.md:223`).
9. **Lo stato per il FE lo calcola l'API**: `GET /seller/settings` sostituisce `paymentMethod` con `onlinePayments: { status, chargesEnabled, payoutsEnabled } | null` (`status` ∈ `none | incomplete | in_review | enabled`, funzione pura `connectStatus`). Il FE non conosce più `stripeAccountId`. Nessun consumer FE di `paymentMethod` oggi.
10. **Fuori scope**: login link all'Express Dashboard, `POST /customer/orders` con `pay_*` (buco preesistente dello spec, lo chiude la F con PR2 che nasce `pending`), `account.application.deauthorized`.

**Aggiornamento (smoke 2026-09-25):** Stripe rifiuta Accounts v1 per le nuove piattaforme → migrato a Accounts v2 con configurazione `recipient` (`stripe_balance.stripe_transfers`), dashboard express, fees/losses all'application; `charges_enabled` = transfers attivi. Il Ruling 3 è superato.

## Review Focus

1. **Doppio click su «Attiva pagamenti online»** (o due schede) → un solo conto Stripe e una sola riga `payment_methods` → test in Task 2 (due chiamate in parallelo, `accounts.create` chiamato una volta).
2. **Il seller torna dall'onboarding prima che arrivi il webhook** (o senza webhook inoltrato in locale) → la pagina di ritorno rilegge il conto e mostra lo stato vero, non «Da attivare» → test in Task 2 (`refreshConnectAccount`) + Task 6 (route `/payments/return` chiama `sync`).
3. **`account.updated` duplicato o fuori ordine** → stato finale = quello attuale su Stripe, l'evento duplicato non rilancia niente → test in Task 3.
4. **Conto che perde `charges_enabled` dopo che PR2 era acceso** (verifica fallita, requisiti scaduti) → PR2 resta configurato ma non offerto; il seller vede l'avviso; salvare le tipologie non è bloccato → test in Task 5.
5. **Link di onboarding scaduto o già visitato** (refresh, back del browser) → Stripe manda a `/payments/refresh`, che genera un link nuovo e reindirizza senza chiedere niente → Task 6.

---

### Task 1: Schema `payment_methods` + rimozione del flusso manuale `payment`

**Files:**
- Modify: `apps/api/src/db/schemas/payment-method.ts`
- Modify: `apps/api/src/db/schemas/seller-profile-change.ts` (`changeTypes`, CHECK)
- Create: `apps/api/src/db/migrations/0012_*.sql` (generata + righe a mano) e `meta/`
- Modify: `apps/api/src/lib/schemas/forms/settings.ts` (via `PaymentChangeBody`), `apps/api/src/lib/schemas/forms/index.ts:21`
- Modify: `apps/api/src/lib/schemas/entities.ts:278-285` (`PaymentMethodSchema`), `:872-876` (`SellerProfileChangeSchema.changeType`)
- Modify: `apps/api/src/modules/seller/services/settings.ts:350-378` (via `requestPaymentChange`)
- Modify: `apps/api/src/modules/seller/routes/settings.ts:16,24,194-222` (via `PATCH /payment`)
- Modify: `apps/api/src/modules/admin/services/sellers.ts:7,14,449,525-548`
- Test: `apps/api/tests/integration/admin-sellers.test.ts:341,453-473`, `apps/api/tests/modules/seller-settings-owner-only.test.ts:86-91`, `apps/api/tests/integration/db-enum-check-constraints.test.ts`

**Interfaces:**
- Produces:
  ```ts
  paymentMethod.chargesEnabled: boolean("charges_enabled").notNull().default(false)
  paymentMethod.payoutsEnabled: boolean("payouts_enabled").notNull().default(false)
  paymentMethod.detailsSubmitted: boolean("details_submitted").notNull().default(false)
  paymentMethod.updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull()
  paymentMethod.stripeAccountId: text("stripe_account_id").unique("payment_method_stripe_account_id_unique")
  changeTypes = ["vat", "document"] as const
  ```

- [ ] **Step 1: Test RED — il CHECK rifiuta `payment`**

In `tests/integration/db-enum-check-constraints.test.ts` aggiungi (seguendo lo stile dei casi esistenti del file, che fanno un INSERT raw e si aspettano la violazione):

```ts
it("seller_profile_changes rifiuta change_type 'payment'", async () => {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	await expect(
		db.execute(
			sql`INSERT INTO seller_profile_changes (id, seller_profile_id, change_type, change_data)
			    VALUES (${crypto.randomUUID()}, ${seller.profile.id}, 'payment', '{}'::jsonb)`,
		),
	).rejects.toThrow(/seller_profile_change_type_valid/);
});

it("payment_methods: stripe_account_id unico e flag a false di default", async () => {
	const db = getTestDb();
	const a = await createTestSeller(db);
	const b = await createTestSeller(db);
	const [pm] = await db
		.insert(paymentMethod)
		.values({ sellerProfileId: a.profile.id, stripeAccountId: "acct_DUP" })
		.returning();
	expect(pm.chargesEnabled).toBe(false);
	expect(pm.payoutsEnabled).toBe(false);
	expect(pm.detailsSubmitted).toBe(false);
	await expect(
		db
			.insert(paymentMethod)
			.values({ sellerProfileId: b.profile.id, stripeAccountId: "acct_DUP" }),
	).rejects.toThrow(/payment_method_stripe_account_id_unique/);
});
```

- [ ] **Step 2: Verifica RED**

Run: `cd apps/api && bun test tests/integration/db-enum-check-constraints.test.ts`
Expected: FAIL — il primo INSERT riesce; il secondo test non compila (`chargesEnabled` non esiste).

- [ ] **Step 3: Schema**

`payment-method.ts`:

```ts
		stripeAccountId: text("stripe_account_id").unique(
			"payment_method_stripe_account_id_unique",
		),
		// Stato del conto Connect, copiato da Stripe (webhook account.updated o
		// sync al ritorno dall'onboarding). Mai scritto da input dell'utente.
		chargesEnabled: boolean("charges_enabled").default(false).notNull(),
		payoutsEnabled: boolean("payouts_enabled").default(false).notNull(),
		detailsSubmitted: boolean("details_submitted").default(false).notNull(),
		isDefault: boolean("is_default").default(true).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
```

`seller-profile-change.ts`: `changeTypes = ["vat", "document"] as const` e CHECK `sql\`${t.changeType} IN ('vat','document')\``.

- [ ] **Step 4: Migrazione**

Run: `bun run db:generate` (repo root). Apri il file `0012_*.sql` generato e **prima** del `ADD CONSTRAINT "seller_profile_change_type_valid"` aggiungi:

```sql
DELETE FROM "seller_profile_changes" WHERE "change_type" = 'payment';--> statement-breakpoint
UPDATE "payment_methods" SET "stripe_account_id" = NULL;--> statement-breakpoint
```

(l'UPDATE va prima dell'`ADD CONSTRAINT … UNIQUE`). Controlla che il file contenga: 4 `ADD COLUMN`, il DROP/ADD del CHECK, l'unique. Se drizzle ha emesso `ALTER COLUMN … SET DATA TYPE varchar` per l'enum, lascialo.

- [ ] **Step 5: Rimozione del flusso manuale**

- `lib/schemas/forms/settings.ts`: elimina `PaymentChangeBody`; `forms/index.ts`: togli l'export.
- `lib/schemas/entities.ts`: `SellerProfileChangeSchema.changeType` → `t.Union([t.Literal("vat"), t.Literal("document")], …)`; `PaymentMethodSchema` aggiunge `chargesEnabled: t.Boolean()`, `payoutsEnabled: t.Boolean()`, `detailsSubmitted: t.Boolean()`, `updatedAt: t.Date()`.
- `seller/services/settings.ts`: elimina `PaymentChangeParams` e `requestPaymentChange`.
- `seller/routes/settings.ts`: elimina il `.patch("/payment", …)` e gli import `PaymentChangeBody`, `requestPaymentChange` (il `.patch("/document")` diventa l'ultimo della catena, chiudi con `);`).
- `admin/services/sellers.ts`: togli `payment` da `changeDataCheckers`, il blocco `if (change.changeType === "payment") { … }`, e gli import `paymentMethod` e `PaymentChangeBody`.
- Test: in `admin-sellers.test.ts` togli `["payment", {}]` dal loop di `:338-342` e le righe `methods`/`paymentMethod` dell'asserzione in coda al loop (non c'è più niente da controllare lì), elimina il test `"inserts a default payment method on a payment change"` e l'import `paymentMethod` se resta inutilizzato; in `seller-settings-owner-only.test.ts` elimina il caso `PATCH /settings/payment`.

- [ ] **Step 6: Verifica GREEN**

Run: `cd apps/api && bun test tests/integration/db-enum-check-constraints.test.ts tests/integration/admin-sellers.test.ts tests/modules/seller-settings-owner-only.test.ts && bun run typecheck`
Expected: PASS, typecheck pulito. `grep -rn "PaymentChangeBody\|requestPaymentChange" apps/api/src apps/api/tests` → nessun risultato.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src apps/api/tests
git commit -m "feat(db): stato del conto Connect su payment_methods e via la richiesta payment"
```

---

### Task 2: Servizio conto Connect (TDD)

**Files:**
- Create: `apps/api/src/lib/connect-status.ts`
- Create: `apps/api/src/modules/billing/services/connect-account.ts`
- Test: `apps/api/tests/lib/connect-status.test.ts`, `apps/api/tests/integration/connect-account.test.ts`

**Interfaces:**
- Consumes: colonne del Task 1.
- Produces:
  ```ts
  // lib/connect-status.ts
  export type ConnectStatus = "none" | "incomplete" | "in_review" | "enabled";
  export function connectStatus(
    pm: { stripeAccountId: string | null; detailsSubmitted: boolean; chargesEnabled: boolean } | null | undefined,
  ): ConnectStatus;

  // modules/billing/services/connect-account.ts
  export function getDefaultPaymentMethod(sellerProfileId: string, tx?: Tx): Promise<PaymentMethodRow | undefined>;
  export function createOnboardingLink(params: { sellerProfileId: string; email: string }): Promise<{ url: string }>;
  export function refreshConnectAccount(stripeAccountId: string): Promise<PaymentMethodRow | null>; // null = conto sconosciuto
  ```

- [ ] **Step 1: Test RED (puro)**

`tests/lib/connect-status.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { connectStatus } from "@/lib/connect-status";

const pm = (o: Partial<{ stripeAccountId: string | null; detailsSubmitted: boolean; chargesEnabled: boolean }>) => ({
	stripeAccountId: "acct_1",
	detailsSubmitted: false,
	chargesEnabled: false,
	...o,
});

describe("connectStatus", () => {
	it("none senza riga o senza conto", () => {
		expect(connectStatus(null)).toBe("none");
		expect(connectStatus(undefined)).toBe("none");
		expect(connectStatus(pm({ stripeAccountId: null }))).toBe("none");
	});
	it("incomplete finché l'onboarding non è inviato", () => {
		expect(connectStatus(pm({}))).toBe("incomplete");
	});
	it("in_review con dati inviati ma incassi non ancora abilitati", () => {
		expect(connectStatus(pm({ detailsSubmitted: true }))).toBe("in_review");
	});
	it("enabled quando Stripe abilita gli incassi, a prescindere da details_submitted", () => {
		expect(connectStatus(pm({ chargesEnabled: true }))).toBe("enabled");
		expect(connectStatus(pm({ detailsSubmitted: true, chargesEnabled: true }))).toBe("enabled");
	});
});
```

- [ ] **Step 2: Verifica RED** — `cd apps/api && bun test tests/lib/connect-status.test.ts` → FAIL (modulo inesistente).

- [ ] **Step 3: Implementazione pura**

`lib/connect-status.ts`:

```ts
export type ConnectStatus = "none" | "incomplete" | "in_review" | "enabled";

/**
 * Stato del conto Connect come lo vede il seller. `charges_enabled` vince su
 * tutto: è l'unico flag che rende PR2 attivabile.
 */
export function connectStatus(
	pm:
		| { stripeAccountId: string | null; detailsSubmitted: boolean; chargesEnabled: boolean }
		| null
		| undefined,
): ConnectStatus {
	if (!pm?.stripeAccountId) return "none";
	if (pm.chargesEnabled) return "enabled";
	return pm.detailsSubmitted ? "in_review" : "incomplete";
}
```

Run: `bun test tests/lib/connect-status.test.ts` → PASS.

- [ ] **Step 4: Test RED (integrazione)**

`tests/integration/connect-account.test.ts` — preambolo come `seller-stores-checkout.test.ts` (mock `@/db` via Proxy su `getTestDb()`, container in `beforeAll`, `truncateAll` in `beforeEach`), con questi mock:

```ts
const accountsCreate = mock(async (_p: unknown, _o: unknown) => ({ id: "acct_NEW" }));
let remoteAccount = {
	id: "acct_NEW",
	charges_enabled: false,
	payouts_enabled: false,
	details_submitted: false,
};
const accountsRetrieve = mock(async (_id: string) => remoteAccount);
const accountLinksCreate = mock(async (_p: unknown) => ({
	url: "https://connect.stripe.test/setup/abc",
}));

mock.module("@/lib/stripe", () => ({
	stripe: {
		accounts: { create: accountsCreate, retrieve: accountsRetrieve },
		accountLinks: { create: accountLinksCreate },
	},
}));

mock.module("@/lib/env", () => ({
	env: {
		STRIPE_SECRET_KEY: "sk_test_FAKE",
		SELLER_APP_URL: "http://localhost:3002",
	},
}));
```

In `beforeEach` anche `accountsCreate.mockClear(); accountsRetrieve.mockClear(); accountLinksCreate.mockClear();` e `remoteAccount = { id: "acct_NEW", charges_enabled: false, payouts_enabled: false, details_submitted: false };`.

Test:

```ts
describe("createOnboardingLink", () => {
	it("crea il conto (IT, controller Express, card_payments+transfers) e salva la riga", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db, { email: "neg@test.it" });

		const res = await createOnboardingLink({
			sellerProfileId: seller.profile.id,
			email: "neg@test.it",
		});

		expect(res.url).toBe("https://connect.stripe.test/setup/abc");
		expect(accountsCreate).toHaveBeenCalledTimes(1);
		const [params, opts] = accountsCreate.mock.calls[0] as [any, any];
		expect(params).toMatchObject({
			country: "IT",
			email: "neg@test.it",
			controller: {
				stripe_dashboard: { type: "express" },
				fees: { payer: "application" },
				losses: { payments: "application" },
				requirement_collection: "stripe",
			},
			capabilities: {
				card_payments: { requested: true },
				transfers: { requested: true },
			},
			metadata: { sellerProfileId: seller.profile.id },
		});
		expect(opts).toEqual({ idempotencyKey: `connect-account:${seller.profile.id}` });
		expect(accountLinksCreate.mock.calls[0][0]).toEqual({
			account: "acct_NEW",
			type: "account_onboarding",
			return_url: "http://localhost:3002/payments/return",
			refresh_url: "http://localhost:3002/payments/refresh",
		});
		const rows = await db
			.select()
			.from(paymentMethod)
			.where(eq(paymentMethod.sellerProfileId, seller.profile.id));
		expect(rows).toHaveLength(1);
		expect(rows[0].stripeAccountId).toBe("acct_NEW");
		expect(rows[0].isDefault).toBe(true);
	});

	it("riusa il conto esistente: nessun secondo accounts.create", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await db
			.insert(paymentMethod)
			.values({ sellerProfileId: seller.profile.id, stripeAccountId: "acct_OLD" });

		await createOnboardingLink({ sellerProfileId: seller.profile.id, email: "x@test.it" });

		expect(accountsCreate).not.toHaveBeenCalled();
		expect((accountLinksCreate.mock.calls[0][0] as any).account).toBe("acct_OLD");
	});

	it("riempie una riga default senza conto invece di crearne un'altra", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await db.insert(paymentMethod).values({ sellerProfileId: seller.profile.id });

		await createOnboardingLink({ sellerProfileId: seller.profile.id, email: "x@test.it" });

		const rows = await db
			.select()
			.from(paymentMethod)
			.where(eq(paymentMethod.sellerProfileId, seller.profile.id));
		expect(rows).toHaveLength(1);
		expect(rows[0].stripeAccountId).toBe("acct_NEW");
	});

	it("doppio click: due chiamate insieme → un solo conto e una sola riga", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = { sellerProfileId: seller.profile.id, email: "x@test.it" };

		await Promise.all([createOnboardingLink(p), createOnboardingLink(p)]);

		expect(accountsCreate).toHaveBeenCalledTimes(1);
		const rows = await db
			.select()
			.from(paymentMethod)
			.where(eq(paymentMethod.sellerProfileId, seller.profile.id));
		expect(rows).toHaveLength(1);
	});
});

describe("refreshConnectAccount", () => {
	it("copia charges/payouts/details da Stripe sulla riga", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await db
			.insert(paymentMethod)
			.values({ sellerProfileId: seller.profile.id, stripeAccountId: "acct_NEW" });
		remoteAccount = { id: "acct_NEW", charges_enabled: true, payouts_enabled: false, details_submitted: true };

		const row = await refreshConnectAccount("acct_NEW");

		expect(accountsRetrieve).toHaveBeenCalledWith("acct_NEW");
		expect(row).toMatchObject({ chargesEnabled: true, payoutsEnabled: false, detailsSubmitted: true });
	});

	it("un conto che perde gli incassi torna a false", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await db.insert(paymentMethod).values({
			sellerProfileId: seller.profile.id,
			stripeAccountId: "acct_NEW",
			chargesEnabled: true,
			payoutsEnabled: true,
			detailsSubmitted: true,
		});

		const row = await refreshConnectAccount("acct_NEW");

		expect(row).toMatchObject({ chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false });
	});

	it("conto sconosciuto → null, nessuna chiamata a Stripe", async () => {
		expect(await refreshConnectAccount("acct_GHOST")).toBeNull();
		expect(accountsRetrieve).not.toHaveBeenCalled();
	});
});
```

Nota sul test «doppio click»: l'harness serializza le transazioni (memoria `feedback_testcontainer_serializes_tx`), quindi il test prova la *seconda lettura sotto lock*, non la race vera. La correttezza sotto concorrenza sta nel `FOR UPDATE` + idempotency key; il commento nel codice lo dice.

- [ ] **Step 5: Verifica RED** — `bun test tests/integration/connect-account.test.ts` → FAIL (modulo inesistente).

- [ ] **Step 6: Implementazione**

`modules/billing/services/connect-account.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { paymentMethod } from "@/db/schemas/payment-method";
import { sellerProfile } from "@/db/schemas/seller";
import { env } from "@/lib/env";
import { stripe } from "@/lib/stripe";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type PaymentMethodRow = typeof paymentMethod.$inferSelect;

export function getDefaultPaymentMethod(sellerProfileId: string, tx: Tx | typeof db = db) {
	return tx.query.paymentMethod.findFirst({
		where: and(
			eq(paymentMethod.sellerProfileId, sellerProfileId),
			eq(paymentMethod.isDefault, true),
		),
	});
}

/**
 * Il conto Connect del seller, creato alla prima richiesta. Il lock sulla riga
 * seller_profiles serializza due click ravvicinati: il secondo rilegge
 * payment_methods dopo il primo e trova il conto. L'idempotency key copre il
 * caso in cui la tx fallisca dopo accounts.create (retry → stesso conto).
 */
async function ensureConnectAccount(sellerProfileId: string, email: string): Promise<string> {
	return db.transaction(async (tx) => {
		await tx
			.select({ id: sellerProfile.id })
			.from(sellerProfile)
			.where(eq(sellerProfile.id, sellerProfileId))
			.for("update");

		const existing = await getDefaultPaymentMethod(sellerProfileId, tx);
		if (existing?.stripeAccountId) return existing.stripeAccountId;

		// Controller properties equivalenti a un conto Express (Stripe marca
		// `type` come legacy). card_payments + transfers: charges_enabled
		// significa "può incassare", e la PR F trasferisce con separate charges.
		const account = await stripe.accounts.create(
			{
				country: "IT",
				email,
				controller: {
					stripe_dashboard: { type: "express" },
					fees: { payer: "application" },
					losses: { payments: "application" },
					requirement_collection: "stripe",
				},
				capabilities: {
					card_payments: { requested: true },
					transfers: { requested: true },
				},
				metadata: { sellerProfileId },
			},
			{ idempotencyKey: `connect-account:${sellerProfileId}` },
		);

		if (existing) {
			await tx
				.update(paymentMethod)
				.set({ stripeAccountId: account.id })
				.where(eq(paymentMethod.id, existing.id));
		} else {
			await tx
				.insert(paymentMethod)
				.values({ sellerProfileId, stripeAccountId: account.id });
		}
		return account.id;
	});
}

/** Link all'onboarding ospitato da Stripe; scade in pochi minuti, va usato subito. */
export async function createOnboardingLink(params: {
	sellerProfileId: string;
	email: string;
}): Promise<{ url: string }> {
	const account = await ensureConnectAccount(params.sellerProfileId, params.email);
	const link = await stripe.accountLinks.create({
		account,
		type: "account_onboarding",
		return_url: `${env.SELLER_APP_URL}/payments/return`,
		refresh_url: `${env.SELLER_APP_URL}/payments/refresh`,
	});
	return { url: link.url };
}

/**
 * Rilegge il conto da Stripe e ne copia lo stato. Usata dal webhook
 * account.updated e dal sync al ritorno dall'onboarding: rileggere invece di
 * fidarsi dello snapshot dell'evento rende innocui gli eventi fuori ordine.
 */
export async function refreshConnectAccount(
	stripeAccountId: string,
): Promise<PaymentMethodRow | null> {
	const known = await db.query.paymentMethod.findFirst({
		where: eq(paymentMethod.stripeAccountId, stripeAccountId),
	});
	if (!known) return null;

	const account = await stripe.accounts.retrieve(stripeAccountId);
	const [row] = await db
		.update(paymentMethod)
		.set({
			chargesEnabled: account.charges_enabled,
			payoutsEnabled: account.payouts_enabled,
			detailsSubmitted: account.details_submitted,
		})
		.where(eq(paymentMethod.id, known.id))
		.returning();
	return row;
}
```

Se `stripe.accounts.retrieve` ha overload con parametri opzionali che rompono `toHaveBeenCalledWith("acct_NEW")`, lascia la chiamata a un argomento come sopra.

- [ ] **Step 7: Verifica GREEN** — `bun test tests/lib/connect-status.test.ts tests/integration/connect-account.test.ts && bun run typecheck` → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/lib/connect-status.ts apps/api/src/modules/billing/services/connect-account.ts apps/api/tests
git commit -m "feat(api): conto Connect Express con onboarding ospitato e rilettura da Stripe"
```

---

### Task 3: Webhook `account.updated` su route Connect (TDD)

**Files:**
- Create: `apps/api/src/modules/webhooks/services/handlers/account-updated.ts`
- Modify: `apps/api/src/modules/webhooks/services/dispatcher.ts`
- Modify: `apps/api/src/modules/webhooks/routes/stripe.ts`
- Modify: `apps/api/src/lib/env.ts` (`STRIPE_CONNECT_WEBHOOK_SECRET`)
- Test: `apps/api/tests/integration/stripe-webhook-account-updated.test.ts`, `apps/api/tests/modules/stripe-webhook-route.test.ts`

**Interfaces:**
- Consumes: `refreshConnectAccount(stripeAccountId)` (Task 2).
- Produces:
  ```ts
  handleStripeWebhook(params: { payload: string; signature: string; scope?: "platform" | "connect" }): Promise<void>
  // scope "connect" verifica con STRIPE_CONNECT_WEBHOOK_SECRET ?? STRIPE_WEBHOOK_SECRET
  POST /webhooks/stripe/connect   // stessi status code di /webhooks/stripe
  ```

- [ ] **Step 1: Test RED (dispatcher + handler)**

`tests/integration/stripe-webhook-account-updated.test.ts` — preambolo come `stripe-webhook-subscription-lifecycle.test.ts`, con:

```ts
let currentEvent: any = null;
const constructEventAsync = mock(async (_p: string, _s: string, _secret: string) => currentEvent);
let remote = { id: "acct_1", charges_enabled: true, payouts_enabled: true, details_submitted: true };
const accountsRetrieve = mock(async (_id: string) => remote);

mock.module("@/lib/stripe", () => ({
	stripe: {
		webhooks: { constructEventAsync },
		accounts: { retrieve: accountsRetrieve },
	},
}));
mock.module("@/lib/env", () => ({
	env: {
		STRIPE_SECRET_KEY: "sk_test_FAKE",
		STRIPE_WEBHOOK_SECRET: "whsec_PLATFORM",
		STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_CONNECT",
	},
}));
```

`beforeEach`: `truncateAll`, `constructEventAsync.mockClear()`, `accountsRetrieve.mockClear()`, `remote = {…true…}`. Helper:

```ts
function accountEvent(id: string, snapshot: Record<string, unknown> = {}) {
	return {
		id,
		type: "account.updated",
		account: "acct_1",
		data: { object: { id: "acct_1", charges_enabled: false, payouts_enabled: false, details_submitted: false, ...snapshot } },
	};
}
async function seedAccount() {
	const seller = await createTestSeller(getTestDb());
	await getTestDb()
		.insert(paymentMethod)
		.values({ sellerProfileId: seller.profile.id, stripeAccountId: "acct_1" });
	return seller;
}
async function row() {
	const [r] = await getTestDb()
		.select()
		.from(paymentMethod)
		.where(eq(paymentMethod.stripeAccountId, "acct_1"));
	return r;
}
```

Test:

```ts
it("verifica la firma col segreto Connect sulla scope connect", async () => {
	await seedAccount();
	currentEvent = accountEvent("evt_A1");
	await handleStripeWebhook({ payload: "raw", signature: "sig", scope: "connect" });
	expect(constructEventAsync.mock.calls[0][2]).toBe("whsec_CONNECT");
});

it("aggiorna la riga con lo stato riletto da Stripe, non con lo snapshot", async () => {
	await seedAccount();
	currentEvent = accountEvent("evt_A2"); // snapshot tutto false
	await handleStripeWebhook({ payload: "raw", signature: "sig", scope: "connect" });
	expect(await row()).toMatchObject({ chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true });
});

it("evento duplicato: la seconda consegna non rilegge né riscrive", async () => {
	await seedAccount();
	currentEvent = accountEvent("evt_A3");
	await handleStripeWebhook({ payload: "raw", signature: "sig", scope: "connect" });
	await handleStripeWebhook({ payload: "raw", signature: "sig", scope: "connect" });
	expect(accountsRetrieve).toHaveBeenCalledTimes(1);
	const [ev] = await getTestDb().select().from(stripeEvent).where(eq(stripeEvent.eventId, "evt_A3"));
	expect(ev.processedAt).toBeTruthy();
});

it("evento vecchio arrivato dopo: lo stato resta quello attuale di Stripe", async () => {
	await seedAccount();
	currentEvent = accountEvent("evt_NEW", { charges_enabled: true });
	await handleStripeWebhook({ payload: "raw", signature: "sig", scope: "connect" });
	currentEvent = accountEvent("evt_OLD", { charges_enabled: false });
	await handleStripeWebhook({ payload: "raw", signature: "sig", scope: "connect" });
	expect((await row()).chargesEnabled).toBe(true);
});

it("conto sconosciuto: evento marcato processato, nessun errore", async () => {
	currentEvent = accountEvent("evt_GHOST");
	await handleStripeWebhook({ payload: "raw", signature: "sig", scope: "connect" });
	expect(accountsRetrieve).not.toHaveBeenCalled();
	const [ev] = await getTestDb().select().from(stripeEvent).where(eq(stripeEvent.eventId, "evt_GHOST"));
	expect(ev.processedAt).toBeTruthy();
});

it("errore di Stripe nel retrieve: processed_at resta null e l'errore risale (→ 500, retry)", async () => {
	await seedAccount();
	accountsRetrieve.mockImplementationOnce(async () => {
		throw new Error("stripe down");
	});
	currentEvent = accountEvent("evt_FAIL");
	await expect(
		handleStripeWebhook({ payload: "raw", signature: "sig", scope: "connect" }),
	).rejects.toThrow("stripe down");
	const [ev] = await getTestDb().select().from(stripeEvent).where(eq(stripeEvent.eventId, "evt_FAIL"));
	expect(ev.processedAt).toBeNull();
});
```

In `tests/modules/stripe-webhook-route.test.ts` aggiungi un `describe` gemello per `/webhooks/stripe/connect` (helper `post` con path parametrico) con i 4 casi esistenti (400 senza firma, 400 firma, 500 handler, 200) più:

```ts
it("la route connect passa scope: 'connect' al dispatcher", async () => {
	await post("raw", { "stripe-signature": "sig" }, "/webhooks/stripe/connect");
	expect(handleStripeWebhook).toHaveBeenCalledWith({ payload: "raw", signature: "sig", scope: "connect" });
});
it("la route piattaforma passa scope: 'platform'", async () => {
	await post("raw");
	expect(handleStripeWebhook).toHaveBeenCalledWith({ payload: "raw", signature: "sig", scope: "platform" });
});
```

- [ ] **Step 2: Verifica RED** — `bun test tests/integration/stripe-webhook-account-updated.test.ts tests/modules/stripe-webhook-route.test.ts` → FAIL.

- [ ] **Step 3: Implementazione**

`lib/env.ts`: nello schema `STRIPE_CONNECT_WEBHOOK_SECRET: t.Optional(t.String()),` accanto a `STRIPE_WEBHOOK_SECRET`; nei valori `STRIPE_CONNECT_WEBHOOK_SECRET: process.env.STRIPE_CONNECT_WEBHOOK_SECRET,`.

`handlers/account-updated.ts`:

```ts
import type Stripe from "stripe";
import { logger } from "@/lib/logger";
import { refreshConnectAccount } from "@/modules/billing/services/connect-account";

export async function handleAccountUpdated(event: Stripe.Event): Promise<void> {
	const account = event.data.object as Stripe.Account;
	const row = await refreshConnectAccount(account.id);
	if (!row) {
		logger.warn(
			{ eventId: event.id, stripeAccountId: account.id },
			"account.updated for unknown connected account, skipping",
		);
	}
}
```

`dispatcher.ts`:

```ts
interface HandleWebhookParams {
	payload: string;
	signature: string;
	/**
	 * platform: eventi del nostro conto (billing). connect: eventi dei conti
	 * collegati, che in produzione arrivano da una event destination separata
	 * con un segreto suo; `stripe listen --forward-connect-to` usa invece lo
	 * stesso segreto di --forward-to, da qui il fallback.
	 */
	scope?: "platform" | "connect";
}
```

e dentro `handleStripeWebhook`:

```ts
	const { payload, signature, scope = "platform" } = params;
	const secret =
		scope === "connect"
			? (env.STRIPE_CONNECT_WEBHOOK_SECRET ?? env.STRIPE_WEBHOOK_SECRET)
			: env.STRIPE_WEBHOOK_SECRET;
	if (!secret) {
		throw new ServiceError(500, "Stripe webhook secret not configured");
	}
```

(usa `secret` al posto di `env.STRIPE_WEBHOOK_SECRET` in `constructEventAsync`); in `dispatch` aggiungi `case "account.updated": return handleAccountUpdated(event);`.

`routes/stripe.ts`: estrai il corpo dell'handler in una funzione `receive(scope)` e monta due `.post`:

```ts
function receive(scope: "platform" | "connect") {
	return async (ctx: Context) => {
		// …corpo attuale invariato, con
		await handleStripeWebhook({ payload, signature, scope });
	};
}

const webhookOptions = (summary: string, description: string) => ({
	parse: "none" as const,
	detail: { summary, description, tags: ["Webhooks"] },
});

export const stripeWebhookRoutes = new Elysia()
	.post(
		"/webhooks/stripe",
		receive("platform"),
		webhookOptions(
			"Webhook Stripe",
			"Endpoint pubblico per eventi Stripe. Firma obbligatoria nell'header stripe-signature.",
		),
	)
	.post(
		"/webhooks/stripe/connect",
		receive("connect"),
		webhookOptions(
			"Webhook Stripe Connect",
			"Eventi dei conti collegati (account.updated). Firma verificata con STRIPE_CONNECT_WEBHOOK_SECRET.",
		),
	);
```

Il commento sul raw body e quello sul 5xx restano dentro `receive`. `Context` da `elysia`; se il tipo generico non torna, tipizza il parametro come `{ headers: Record<string, string | undefined>; request: Request; set: { status?: number | string } }`.

- [ ] **Step 4: Verifica GREEN** — `bun test tests/integration/stripe-webhook-account-updated.test.ts tests/modules/stripe-webhook-route.test.ts tests/integration/stripe-webhook-scaffold.test.ts tests/integration/stripe-webhook-reprocessing.test.ts && bun run typecheck` → PASS (i test esistenti non passano `scope`: default `platform`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src apps/api/tests
git commit -m "feat(api): webhook account.updated su route Connect con rilettura del conto"
```

---

### Task 4: API seller — stato, onboarding, sync (TDD)

**Files:**
- Modify: `apps/api/src/modules/seller/services/settings.ts:79-148` (`onlinePayments` al posto di `paymentMethod`)
- Modify: `apps/api/src/lib/schemas/composed.ts:169-179` (`SellerSettingsSchema`)
- Modify: `apps/api/src/lib/schemas/entities.ts` (nuovo `OnlinePaymentsSchema`)
- Modify: `apps/api/src/modules/seller/routes/settings.ts` (due POST)
- Test: `apps/api/tests/integration/seller-settings-employee-redaction.test.ts:82-172`, `apps/api/tests/integration/seller-settings.test.ts`, `apps/api/tests/modules/seller-settings-owner-only.test.ts`

**Interfaces:**
- Consumes: `connectStatus`, `createOnboardingLink`, `refreshConnectAccount`, `getDefaultPaymentMethod`.
- Produces:
  ```ts
  OnlinePaymentsSchema = t.Object({
    status: t.Union([t.Literal("none"), t.Literal("incomplete"), t.Literal("in_review"), t.Literal("enabled")]),
    chargesEnabled: t.Boolean(),
    payoutsEnabled: t.Boolean(),
  })
  GET  /seller/settings                       → data.onlinePayments: OnlinePayments | null  (null per employee)
  POST /seller/settings/payments/onboarding   → { url: string }         (owner)
  POST /seller/settings/payments/sync         → OnlinePayments          (owner; 404 senza conto)
  ```
  In Eden: `api().seller.settings.payments.onboarding.post()`, `api().seller.settings.payments.sync.post()`.

- [ ] **Step 1: Test RED**

`seller-settings-employee-redaction.test.ts`: sostituisci `result.paymentMethod` con `result.onlinePayments`; per l'owner l'asserzione diventa:

```ts
expect(result.onlinePayments).toEqual({
	status: "incomplete",
	chargesEnabled: false,
	payoutsEnabled: false,
});
```

(la riga seedata a `:82-85` ha `stripeAccountId: "acct_OWNER"` e i flag al default) e per l'employee `expect(result.onlinePayments).toBeNull()`.

`seller-settings.test.ts` (integrazione sul servizio): aggiungi

```ts
it("owner senza conto → onlinePayments status none", async () => {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const res = await getSellerSettings({ sellerProfileId: seller.profile.id, userId: seller.user.id, isOwner: true });
	expect(res.onlinePayments).toEqual({ status: "none", chargesEnabled: false, payoutsEnabled: false });
});
```

`seller-settings-owner-only.test.ts`:

```ts
it("POST /settings/payments/onboarding → 403 for a non-owner", async () => {
	const res = await call("POST", "/settings/payments/onboarding");
	expect(res.status).toBe(403);
});
it("POST /settings/payments/sync → 403 for a non-owner", async () => {
	const res = await call("POST", "/settings/payments/sync");
	expect(res.status).toBe(403);
});
```

In `connect-account.test.ts` (Task 2) aggiungi il caso del servizio di sync:

```ts
it("syncOnlinePayments senza conto → 404", async () => {
	const seller = await createTestSeller(getTestDb());
	await expect(syncOnlinePayments(seller.profile.id)).rejects.toMatchObject({ status: 404 });
});
it("syncOnlinePayments rilegge e restituisce lo stato", async () => {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	await db.insert(paymentMethod).values({ sellerProfileId: seller.profile.id, stripeAccountId: "acct_NEW" });
	remoteAccount = { id: "acct_NEW", charges_enabled: true, payouts_enabled: true, details_submitted: true };
	expect(await syncOnlinePayments(seller.profile.id)).toEqual({ status: "enabled", chargesEnabled: true, payoutsEnabled: true });
});
```

- [ ] **Step 2: Verifica RED** — `bun test tests/integration/seller-settings-employee-redaction.test.ts tests/integration/seller-settings.test.ts tests/modules/seller-settings-owner-only.test.ts tests/integration/connect-account.test.ts` → FAIL.

- [ ] **Step 3: Implementazione**

In `connect-account.ts` aggiungi:

```ts
import { type ConnectStatus, connectStatus } from "@/lib/connect-status";
import { ServiceError } from "@/lib/errors";

export interface OnlinePayments {
	status: ConnectStatus;
	chargesEnabled: boolean;
	payoutsEnabled: boolean;
}

export function toOnlinePayments(pm: PaymentMethodRow | null | undefined): OnlinePayments {
	return {
		status: connectStatus(pm),
		chargesEnabled: pm?.chargesEnabled ?? false,
		payoutsEnabled: pm?.payoutsEnabled ?? false,
	};
}

export async function syncOnlinePayments(sellerProfileId: string): Promise<OnlinePayments> {
	const pm = await getDefaultPaymentMethod(sellerProfileId);
	if (!pm?.stripeAccountId)
		throw new ServiceError(404, "Pagamenti online non ancora attivati");
	return toOnlinePayments(await refreshConnectAccount(pm.stripeAccountId));
}
```

`entities.ts`: definisci `OnlinePaymentsSchema` (Interfaces sopra) accanto a `PaymentMethodSchema`, con descrizioni: `status` «Stato dei pagamenti online: none (da attivare), incomplete (onboarding da completare), in_review (in verifica da Stripe), enabled (attivi)».

`composed.ts`: `paymentMethod: t.Nullable(PaymentMethodSchema)` → `onlinePayments: t.Nullable(OnlinePaymentsSchema)`; aggiorna il commento `// Seller settings (profile + org + online payments + pending changes)`. Se `PaymentMethodSchema` resta senza usi, eliminala.

`seller/services/settings.ts`: la query `db.query.paymentMethod.findFirst` diventa `getDefaultPaymentMethod(sellerProfileId)`; nel ramo employee `onlinePayments: null`; nel ramo owner `onlinePayments: toOnlinePayments(payment)`. Commento della redazione: «…the owner's online-payments status…».

`seller/routes/settings.ts`, in coda alla catena:

```ts
	.post(
		"/payments/onboarding",
		async (ctx) => {
			const { sellerProfile: sp, store, isOwner, user } = withSeller(ctx);
			requireOwner(isOwner);
			const data = await createOnboardingLink({ sellerProfileId: sp.id, email: user.email });
			getLogger(store).info(
				{ sellerId: sp.id, action: "connect_onboarding_link" },
				"Connect onboarding link created",
			);
			return ok(data);
		},
		{
			response: withErrors({ 200: okRes(t.Object({ url: t.String() })) }),
			detail: {
				summary: "Link di attivazione pagamenti online",
				description:
					"Crea il conto Stripe Connect del venditore se manca e restituisce il link all'onboarding ospitato da Stripe. Il link scade in pochi minuti. Solo il titolare.",
				tags: ["Seller - Settings"],
			},
		},
	)
	.post(
		"/payments/sync",
		async (ctx) => {
			const { sellerProfile: sp, isOwner } = withSeller(ctx);
			requireOwner(isOwner);
			return ok(await syncOnlinePayments(sp.id));
		},
		{
			response: withErrors({ 200: okRes(OnlinePaymentsSchema) }),
			detail: {
				summary: "Aggiorna stato pagamenti online",
				description:
					"Rilegge il conto Stripe Connect e aggiorna lo stato salvato. Da chiamare al ritorno dall'onboarding. Solo il titolare.",
				tags: ["Seller - Settings"],
			},
		},
	);
```

- [ ] **Step 4: Verifica GREEN** — stessi test del Step 2 + `bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src apps/api/tests
git commit -m "feat(api): stato, attivazione e sync dei pagamenti online nelle impostazioni seller"
```

---

### Task 5: `offeredOrderTypes` col conto + tipologie del negozio (TDD)

**Files:**
- Modify: `apps/api/src/lib/order-types.ts`
- Modify: `apps/api/src/modules/customer/services/cart.ts:161,230`
- Modify: `apps/api/src/modules/customer/services/checkout.ts:81,107`
- Create: `apps/api/src/modules/seller/services/order-types.ts`
- Modify: `apps/api/src/modules/seller/routes/stores.ts` (GET + PATCH `/stores/:storeId/order-types`)
- Test: `apps/api/tests/lib/order-types.test.ts`, `apps/api/tests/integration/customer-cart.test.ts:315-335`, `apps/api/tests/integration/customer-checkout.test.ts:231-250`, `apps/api/tests/integration/seller-store-order-types.test.ts`, `apps/api/tests/modules/seller-stores-owner-only.test.ts`

**Interfaces:**
- Consumes: `paymentMethod.chargesEnabled` (Task 1), `getDefaultPaymentMethod` (Task 2).
- Produces:
  ```ts
  export const ONLINE_PAYMENT_LIVE = false;
  export function offeredOrderTypes(
    configured: readonly string[],
    opts: { chargesEnabled: boolean; live?: boolean },   // live default ONLINE_PAYMENT_LIVE
  ): StoreOrderType[];
  /** SELECT-field: il seller del negozio (tabella `stores` in FROM) può incassare. */
  export const sellerChargesEnabledSql: SQL.Aliased<boolean>;
  // seller
  GET   /seller/stores/:storeId/order-types → StoreOrderTypes
  PATCH /seller/stores/:storeId/order-types { orderTypes: StoreOrderType[] } → StoreOrderTypes
  StoreOrderTypes = { orderTypes: StoreOrderType[]; offeredOrderTypes: StoreOrderType[]; chargesEnabled: boolean }
  ```

- [ ] **Step 1: Test RED**

`tests/lib/order-types.test.ts` — sostituisci il file:

```ts
import { describe, expect, it } from "bun:test";
import { ONLINE_PAYMENT_LIVE, offeredOrderTypes } from "@/lib/order-types";

const both = ["reserve_pickup", "pay_pickup"];

describe("offeredOrderTypes", () => {
	it("offre la prenotazione configurata dal negozio", () => {
		expect(offeredOrderTypes(["reserve_pickup"], { chargesEnabled: false })).toEqual(["reserve_pickup"]);
	});

	it("offre pay_pickup solo con incassi abilitati E pagamento online attivo", () => {
		expect(offeredOrderTypes(both, { chargesEnabled: true, live: true })).toEqual(both);
		expect(offeredOrderTypes(both, { chargesEnabled: false, live: true })).toEqual(["reserve_pickup"]);
		expect(offeredOrderTypes(["pay_pickup"], { chargesEnabled: false, live: true })).toEqual([]);
	});

	it("finché la PR F non accende il pagamento, pay_pickup non si offre mai", () => {
		expect(ONLINE_PAYMENT_LIVE).toBe(false);
		expect(offeredOrderTypes(both, { chargesEnabled: true })).toEqual(["reserve_pickup"]);
	});

	it("ignora valori sconosciuti", () => {
		expect(offeredOrderTypes(["direct", "reserve_pickup"], { chargesEnabled: true, live: true })).toEqual([
			"reserve_pickup",
		]);
	});
});
```

`customer-cart.test.ts:315-335`: nel test esistente aggiungi prima di `getCart` una riga `payment_methods` del seller con `chargesEnabled: true` (così il test prova il flag, non il conto) e aggiorna il commento: `// conto abilitato, ma pay_pickup non si offre finché la PR F non accende il pagamento`. Aggiungi un secondo test con conto non abilitato che ottiene `["reserve_pickup"]` — resta verde anche dopo la F.

`customer-checkout.test.ts:231-250`: stessa cosa — seed `payment_methods` con `chargesEnabled: true`; l'attesa resta 400.

Nuovo `tests/integration/seller-store-order-types.test.ts` (preambolo `@/db` mock come gli altri integration; nessun mock Stripe: il servizio non chiama Stripe):

```ts
async function setup(opts: { chargesEnabled?: boolean; orderTypes?: ("reserve_pickup" | "pay_pickup")[] } = {}) {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const store = await createTestStore(db, seller.profile.id, { orderTypes: opts.orderTypes });
	if (opts.chargesEnabled !== undefined)
		await db.insert(paymentMethod).values({
			sellerProfileId: seller.profile.id,
			stripeAccountId: "acct_T",
			chargesEnabled: opts.chargesEnabled,
		});
	return { sellerProfileId: seller.profile.id, storeId: store.id };
}

describe("tipologie d'acquisto del negozio", () => {
	it("GET: configurate, offerte e stato incassi", async () => {
		const s = await setup({ chargesEnabled: true, orderTypes: ["reserve_pickup", "pay_pickup"] });
		expect(await getStoreOrderTypes(s)).toEqual({
			orderTypes: ["reserve_pickup", "pay_pickup"],
			offeredOrderTypes: ["reserve_pickup"], // ONLINE_PAYMENT_LIVE = false
			chargesEnabled: true,
		});
	});

	it("attivare pay_pickup senza conto abilitato → 400, niente scritto", async () => {
		const s = await setup({ chargesEnabled: false });
		await expect(
			updateStoreOrderTypes({ ...s, orderTypes: ["reserve_pickup", "pay_pickup"] }),
		).rejects.toMatchObject({ status: 400 });
		expect((await getStoreOrderTypes(s)).orderTypes).toEqual(["reserve_pickup"]);
	});

	it("senza nessuna riga payment_methods è come un conto non abilitato", async () => {
		const s = await setup();
		await expect(
			updateStoreOrderTypes({ ...s, orderTypes: ["reserve_pickup", "pay_pickup"] }),
		).rejects.toMatchObject({ status: 400 });
	});

	it("con conto abilitato si attiva pay_pickup", async () => {
		const s = await setup({ chargesEnabled: true });
		const res = await updateStoreOrderTypes({ ...s, orderTypes: ["pay_pickup", "reserve_pickup"] });
		expect(res.orderTypes).toEqual(["reserve_pickup", "pay_pickup"]); // ordine canonico
	});

	it("deve restare almeno una tipologia offerta: solo pay_pickup prima della PR F → 400", async () => {
		const s = await setup({ chargesEnabled: true, orderTypes: ["reserve_pickup", "pay_pickup"] });
		await expect(updateStoreOrderTypes({ ...s, orderTypes: ["pay_pickup"] })).rejects.toMatchObject({
			status: 400,
		});
	});

	it("conto disabilitato dopo: tenere pay_pickup acceso non blocca il salvataggio", async () => {
		const s = await setup({ chargesEnabled: false, orderTypes: ["reserve_pickup", "pay_pickup"] });
		const res = await updateStoreOrderTypes({ ...s, orderTypes: ["reserve_pickup", "pay_pickup"] });
		expect(res).toEqual({
			orderTypes: ["reserve_pickup", "pay_pickup"],
			offeredOrderTypes: ["reserve_pickup"],
			chargesEnabled: false,
		});
	});

	it("spegnere pay_pickup è sempre permesso", async () => {
		const s = await setup({ chargesEnabled: false, orderTypes: ["reserve_pickup", "pay_pickup"] });
		const res = await updateStoreOrderTypes({ ...s, orderTypes: ["reserve_pickup"] });
		expect(res.orderTypes).toEqual(["reserve_pickup"]);
	});

	it("negozio di un altro seller → 404", async () => {
		const a = await setup();
		const b = await setup();
		await expect(
			updateStoreOrderTypes({ sellerProfileId: b.sellerProfileId, storeId: a.storeId, orderTypes: ["reserve_pickup"] }),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			getStoreOrderTypes({ sellerProfileId: b.sellerProfileId, storeId: a.storeId }),
		).rejects.toMatchObject({ status: 404 });
	});
});
```

`tests/modules/seller-stores-owner-only.test.ts` (stesso stile del file): `PATCH /stores/x/order-types` con body valido `{ orderTypes: ["reserve_pickup"] }` → 403.

- [ ] **Step 2: Verifica RED** — `bun test tests/lib/order-types.test.ts tests/integration/seller-store-order-types.test.ts tests/integration/customer-cart.test.ts tests/integration/customer-checkout.test.ts tests/modules/seller-stores-owner-only.test.ts` → FAIL.

- [ ] **Step 3: Implementazione `lib/order-types.ts`**

```ts
import { sql } from "drizzle-orm";

/** Tipi d'ordine che un negozio può offrire al checkout (colonna stores.order_types). */
export const storeOrderTypes = ["reserve_pickup", "pay_pickup"] as const;
export type StoreOrderType = (typeof storeOrderTypes)[number];

// Il pagamento del cliente (PaymentIntent, trasferimenti) arriva con la PR F.
// Fino ad allora un negozio può avere PR2 acceso e il conto abilitato, ma il
// checkout non lo offre: nessun ordine pay_pickup senza un modo di pagarlo.
export const ONLINE_PAYMENT_LIVE = false;

/**
 * Unica regola su cosa si offre al checkout: la usano il carrello (per mostrare
 * la scelta), il checkout (per validarla) e il seller (per mostrare cosa vede il
 * cliente), così non possono divergere. `live` esiste per i test.
 */
export function offeredOrderTypes(
	configured: readonly string[],
	opts: { chargesEnabled: boolean; live?: boolean },
): StoreOrderType[] {
	const online = (opts.live ?? ONLINE_PAYMENT_LIVE) && opts.chargesEnabled;
	return storeOrderTypes.filter(
		(t) => configured.includes(t) && (t !== "pay_pickup" || online),
	);
}

/**
 * Campo SELECT: il seller del negozio può incassare online. Nomi letterali
 * qualificati: come campo SELECT le Column interpolate perdono la tabella.
 * Richiede `stores` nel FROM.
 */
export const sellerChargesEnabledSql = sql<boolean>`COALESCE((
  SELECT pm.charges_enabled FROM payment_methods pm
  WHERE pm.seller_profile_id = stores.seller_profile_id AND pm.is_default
), false)`.as("seller_charges_enabled");
```

`cart.ts`: nel `select` aggiungi `sellerChargesEnabled: sellerChargesEnabledSql,`; a `:230` `orderTypes: offeredOrderTypes(row.storeOrderTypes, { chargesEnabled: row.sellerChargesEnabled }),`.

`checkout.ts`: nel `select` delle `lines` aggiungi `chargesEnabled: sellerChargesEnabledSql,`; a `:107` `offeredOrderTypes(own[0].orderTypes, { chargesEnabled: own[0].chargesEnabled })`. Il `.for("update", { of: cartItem })` resta: la subquery non prende lock.

Se lo stesso alias `.as("seller_charges_enabled")` usato da due query diverse dà problemi a drizzle (un `SQL.Aliased` è un oggetto condiviso), esporta una funzione `sellerChargesEnabledSql()` che restituisce un nuovo aliased a ogni chiamata e aggiorna l'Interfaces.

- [ ] **Step 4: Implementazione servizio seller**

`seller/services/order-types.ts`:

```ts
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { store } from "@/db/schemas/store";
import { ServiceError } from "@/lib/errors";
import { offeredOrderTypes, type StoreOrderType, storeOrderTypes } from "@/lib/order-types";
import { getDefaultPaymentMethod } from "@/modules/billing/services/connect-account";

interface StoreRef {
	sellerProfileId: string;
	storeId: string;
}

async function ownStore({ sellerProfileId, storeId }: StoreRef) {
	const found = await db.query.store.findFirst({
		where: and(eq(store.id, storeId), eq(store.sellerProfileId, sellerProfileId), isNull(store.deletedAt)),
		columns: { id: true, orderTypes: true },
	});
	if (!found) throw new ServiceError(404, "Negozio non trovato");
	return found;
}

function view(orderTypes: StoreOrderType[], chargesEnabled: boolean) {
	return { orderTypes, offeredOrderTypes: offeredOrderTypes(orderTypes, { chargesEnabled }), chargesEnabled };
}

export async function getStoreOrderTypes(ref: StoreRef) {
	const [s, pm] = await Promise.all([ownStore(ref), getDefaultPaymentMethod(ref.sellerProfileId)]);
	return view(s.orderTypes, pm?.chargesEnabled ?? false);
}

export async function updateStoreOrderTypes(ref: StoreRef & { orderTypes: StoreOrderType[] }) {
	const [s, pm] = await Promise.all([ownStore(ref), getDefaultPaymentMethod(ref.sellerProfileId)]);
	const chargesEnabled = pm?.chargesEnabled ?? false;
	// Ordine canonico e senza doppioni, qualunque cosa mandi il client.
	const next = storeOrderTypes.filter((t) => ref.orderTypes.includes(t));

	const adding = next.includes("pay_pickup") && !s.orderTypes.includes("pay_pickup");
	if (adding && !chargesEnabled)
		throw new ServiceError(400, "Per «Paga e ritira» attiva prima i pagamenti online");
	if (offeredOrderTypes(next, { chargesEnabled }).length === 0)
		throw new ServiceError(400, "Deve restare almeno una tipologia d'acquisto disponibile ai clienti");

	await db.update(store).set({ orderTypes: next }).where(eq(store.id, s.id));
	return view(next, chargesEnabled);
}
```

`seller/routes/stores.ts`, dopo il `.patch("/stores/:storeId", …)`:

```ts
	.get(
		"/stores/:storeId/order-types",
		async (ctx) => {
			const sellerCtx = withSeller(ctx);
			const { sellerProfile: sp, params } = sellerCtx;
			// guardia employee: vedi sotto
			return ok(await getStoreOrderTypes({ sellerProfileId: sp.id, storeId: params.storeId }));
		},
		{
			params: t.Object({ storeId: t.String({ description: "ID del negozio" }) }),
			response: withErrors({ 200: okRes(StoreOrderTypesSchema) }),
			detail: {
				summary: "Tipologie d'acquisto del negozio",
				description:
					"Tipologie configurate, quelle offerte davvero ai clienti e se il venditore può incassare online.",
				tags: ["Seller - Stores"],
			},
		},
	)
	.patch(
		"/stores/:storeId/order-types",
		async (ctx) => {
			const { sellerProfile: sp, isOwner, params, body } = withSeller(ctx);
			requireOwner(isOwner);
			return ok(
				await updateStoreOrderTypes({ sellerProfileId: sp.id, storeId: params.storeId, orderTypes: body.orderTypes }),
			);
		},
		{
			params: t.Object({ storeId: t.String({ description: "ID del negozio" }) }),
			body: t.Object({
				orderTypes: t.Array(
					t.Union([t.Literal("reserve_pickup"), t.Literal("pay_pickup")]),
					{ minItems: 1, uniqueItems: true, description: "Tipologie d'acquisto accettate dal negozio" },
				),
			}),
			response: withErrors({ 200: okRes(StoreOrderTypesSchema) }),
			detail: {
				summary: "Aggiorna tipologie d'acquisto",
				description:
					"«Paga e ritira» si attiva solo con i pagamenti online abilitati; deve restare almeno una tipologia offerta ai clienti. Solo il titolare.",
				tags: ["Seller - Stores"],
			},
		},
	)
```

`StoreOrderTypesSchema` in `entities.ts`:

```ts
const StoreOrderTypeLiteral = t.Union([t.Literal("reserve_pickup"), t.Literal("pay_pickup")]);
export const StoreOrderTypesSchema = t.Object({
	orderTypes: t.Array(StoreOrderTypeLiteral, { description: "Tipologie configurate dal negozio" }),
	offeredOrderTypes: t.Array(StoreOrderTypeLiteral, { description: "Tipologie che i clienti vedono al checkout" }),
	chargesEnabled: t.Boolean({ description: "Il venditore può incassare online (Stripe Connect)" }),
});
```

Il GET segue la regola di `GET /stores` (`stores.ts:42-47`): un employee legge solo i negozi assegnati. Nella route, prima del servizio:

```ts
			const sellerCtx = withSeller(ctx);
			if (!sellerCtx.isOwner) {
				const allowed = await sellerCtx.getAccessibleStoreIds();
				if (!allowed.includes(params.storeId)) throw new ServiceError(404, "Negozio non trovato");
			}
```

(`ServiceError` da `@/lib/errors`). La sezione FE si mostra solo all'owner; il GET resta leggibile dagli employee assegnati per coerenza con le altre letture.

- [ ] **Step 5: Verifica GREEN** — test del Step 2 + `bun run typecheck` → PASS. Poi `grep -rn "offeredOrderTypes(" apps/api/src` → tutte le chiamate hanno il secondo argomento.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src apps/api/tests
git commit -m "feat(orders): Paga e ritira attivabile solo con il conto abilitato"
```

---

### Task 6: Seller FE — card «Pagamenti online» + ritorno/refresh dall'onboarding

**Files:**
- Create: `apps/seller/src/features/profile/components/online-payments-card.tsx`
- Create: `apps/seller/src/features/profile/hooks/use-online-payments.ts`
- Create: `apps/seller/src/routes/_authenticated/payments/return.tsx`
- Create: `apps/seller/src/routes/_authenticated/payments/refresh.tsx`
- Modify: `apps/seller/src/routes/_authenticated/profile.tsx`
- Modify: `apps/seller/messages/it.json`, `apps/seller/messages/en.json`
- Modify: `apps/seller/src/routeTree.gen.ts` (rigenerato)

**Interfaces:**
- Consumes: `GET /seller/settings` → `onlinePayments`; `POST /seller/settings/payments/onboarding` → `{ url }`; `POST /seller/settings/payments/sync` → `OnlinePayments` (Task 4).
- Produces:
  ```ts
  export function useStartOnboarding(): UseMutationResult<void, Error, void>; // redirect a Stripe
  export function useSyncOnlinePayments(): UseMutationResult<OnlinePayments, Error, void>;
  export function OnlinePaymentsCard(): JSX.Element | null;
  ```

- [ ] **Step 1: Messaggi**

`it.json` (chiavi nuove, stesso stile piatto del file):

```json
"payments.title": "Pagamenti online",
"payments.description": "Incassa online con «Paga e ritira». Stripe verifica i tuoi dati e ti versa gli incassi sul conto.",
"payments.status.none": "Da attivare",
"payments.status.incomplete": "Da completare",
"payments.status.in_review": "In verifica",
"payments.status.enabled": "Attivo",
"payments.none.body": "Non hai ancora attivato i pagamenti online. Servono pochi minuti su Stripe: dati dell'attività, documento e IBAN.",
"payments.incomplete.body": "Hai iniziato l'attivazione ma mancano dei dati.",
"payments.in_review.body": "Stripe sta verificando i tuoi dati. Di solito servono pochi minuti, a volte qualche giorno.",
"payments.enabled.body": "Puoi attivare «Paga e ritira» nelle tipologie d'acquisto di ogni negozio.",
"payments.payouts.pending": "I versamenti sul tuo conto partono appena Stripe completa la verifica.",
"payments.cta.start": "Attiva pagamenti online",
"payments.cta.continue": "Completa l'attivazione",
"payments.cta.refresh": "Aggiorna stato",
"payments.redirecting": "Ti portiamo su Stripe…",
"payments.return.checking": "Controlliamo lo stato dei pagamenti online…",
"payments.error.start": "Non è stato possibile aprire l'attivazione. Riprova.",
"payments.error.sync": "Non è stato possibile aggiornare lo stato. Riprova dal profilo."
```

`en.json`: stesse chiavi tradotte («Online payments», «To activate», «Incomplete», «Under review», «Active», …).

- [ ] **Step 2: Hook**

`use-online-payments.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

/** Porta il titolare sull'onboarding Stripe. Il link scade in pochi minuti: si usa subito. */
export function useStartOnboarding() {
	return useMutation({
		mutationFn: async () => {
			const r = await api().seller.settings.payments.onboarding.post();
			const { url } = unwrap(r, m["payments.error.start"]());
			window.location.assign(url);
		},
	});
}

export function useSyncOnlinePayments() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async () => {
			const r = await api().seller.settings.payments.sync.post();
			return unwrap(r, m["payments.error.sync"]());
		},
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["seller", "settings"] }),
	});
}
```

(Se `unwrap` ha firma diversa, allineati a come lo usa `business-info-card.tsx:66-67`.)

- [ ] **Step 3: Card**

`online-payments-card.tsx` — `Card` di `@bibs/ui` come `BusinessInfoCard`, `Badge` per lo stato (singolare), testo per stato, bottoni:

```tsx
import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@bibs/ui/components/card";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { useSellerSettings } from "@/hooks/use-seller-settings";
import { m } from "@/paraglide/messages";
import { useStartOnboarding, useSyncOnlinePayments } from "../hooks/use-online-payments";

const STATUS_VARIANT = {
	none: "secondary",
	incomplete: "secondary",
	in_review: "outline",
	enabled: "outline",
} as const;

export function OnlinePaymentsCard() {
	const { data } = useSellerSettings();
	const start = useStartOnboarding();
	const sync = useSyncOnlinePayments();
	const op = data?.onlinePayments;
	if (!op) return null; // employee o caricamento

	const onStart = () => start.mutate(undefined, { onError: (e) => toast.error(e.message) });
	const onSync = () => sync.mutate(undefined, { onError: (e) => toast.error(e.message) });

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between gap-3">
					<CardTitle>{m["payments.title"]()}</CardTitle>
					<Badge
						variant={STATUS_VARIANT[op.status]}
						className={op.status === "enabled" ? "border-olive/30 bg-olive/10 text-olive" : undefined}
					>
						{m[`payments.status.${op.status}`]()}
					</Badge>
				</div>
				<CardDescription>{m["payments.description"]()}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4 text-sm">
				<p>{m[`payments.${op.status}.body`]()}</p>
				{op.status === "enabled" && !op.payoutsEnabled && (
					<p className="text-muted-foreground">{m["payments.payouts.pending"]()}</p>
				)}
				<div className="flex flex-wrap gap-2">
					{op.status === "none" && (
						<Button onClick={onStart} disabled={start.isPending || start.isSuccess}>
							{start.isPending || start.isSuccess ? m["payments.redirecting"]() : m["payments.cta.start"]()}
						</Button>
					)}
					{(op.status === "incomplete" || op.status === "in_review") && (
						<Button onClick={onStart} disabled={start.isPending || start.isSuccess}>
							{start.isPending || start.isSuccess ? m["payments.redirecting"]() : m["payments.cta.continue"]()}
						</Button>
					)}
					{op.status !== "none" && op.status !== "enabled" && (
						<Button variant="outline" onClick={onSync} disabled={sync.isPending}>
							{sync.isPending && <Spinner className="size-4" />}
							{m["payments.cta.refresh"]()}
						</Button>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
```

Paraglide genera funzioni per chiave: se l'accesso con template literal non tipizza (`m[\`payments.status.${op.status}\`]`), usa una mappa esplicita `const STATUS_LABEL = { none: m["payments.status.none"], … }` (memoria `feedback_tanstack_query_noinfer`: index con literal union). Il colore del badge «Attivo» ricalca `onboarding-status-badge.tsx` in admin (`olive`).

`profile.tsx`: sotto `<BusinessInfoCard …/>` aggiungi `{isOwner && <OnlinePaymentsCard />}` e cambia il sottotitolo in «Dati personali, informazioni dell'azienda e pagamenti online.».

- [ ] **Step 4: Route di ritorno e refresh**

`payments/return.tsx`:

```tsx
import { Spinner } from "@bibs/ui/components/spinner";
import { toast } from "@bibs/ui/components/sonner";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useSyncOnlinePayments } from "@/features/profile/hooks/use-online-payments";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/payments/return")({
	component: PaymentsReturnPage,
});

// Stripe rimanda qui a fine onboarding senza dire com'è andata: si rilegge il
// conto (il webhook può non essere ancora arrivato) e si torna al profilo.
function PaymentsReturnPage() {
	const navigate = useNavigate();
	const sync = useSyncOnlinePayments();
	const started = useRef(false);

	useEffect(() => {
		if (started.current) return;
		started.current = true;
		sync.mutate(undefined, {
			onError: (e) => toast.error(e.message),
			onSettled: () => void navigate({ to: "/profile", replace: true }),
		});
	}, [sync, navigate]);

	return (
		<div className="flex h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
			<Spinner className="size-8" />
			{m["payments.return.checking"]()}
		</div>
	);
}
```

`payments/refresh.tsx`: stessa struttura, ma chiama `useStartOnboarding().mutate` (nuovo link → `window.location.assign`); `onError` → toast + `navigate({ to: "/profile", replace: true })`; testo `m["payments.redirecting"]()`.

Il ref evita la doppia chiamata di StrictMode in dev. Attenzione alla memoria `feedback_react_compiler_ref_in_render`: il ref è scritto dentro `useEffect`, non in render — ok. Se il React Compiler segnala `sync` come dipendenza instabile, tieni `[]` con il ref come unica guardia.

- [ ] **Step 5: Verifica**

Run: `bun run --cwd apps/seller build && bun run --cwd apps/seller typecheck && bun run --cwd apps/seller test`
Expected: build ok (rigenera `routeTree.gen.ts` con `/payments/return` e `/payments/refresh`), typecheck e test verdi. `git status` mostra `routeTree.gen.ts` modificato.

Smoke nel browser (seller `:3002`, `seller@dev.bibs` / `password123`, API con `STRIPE_SECRET_KEY` di test): Profilo → card «Pagamenti online» «Da attivare» → «Attiva pagamenti online» porta su `connect.stripe.com`; completare con i dati di test Stripe (vedi `stripe:test-cards` / «Test mode» dell'onboarding) → ritorno su `/payments/return` → profilo con «In verifica» o «Attivo». Prova sia mouse sia tastiera (Tab + Invio sul bottone). Da employee: la card non c'è.

- [ ] **Step 6: Commit**

```bash
git add apps/seller
git commit -m "feat(seller): attivazione dei pagamenti online dal profilo"
```

---

### Task 7: Seller FE — sezione «Tipologie d'acquisto» nella pagina negozio

**Files:**
- Create: `apps/seller/src/features/stores/components/order-types-section.tsx`
- Modify: `apps/seller/src/routes/_authenticated/store/index.tsx` (aside dell'owner, sotto «Vetrina»)
- Modify: `apps/seller/messages/it.json`, `apps/seller/messages/en.json`

**Interfaces:**
- Consumes: `GET/PATCH /seller/stores/:storeId/order-types` → `{ orderTypes, offeredOrderTypes, chargesEnabled }` (Task 5); `m.orders_type_reserve_pickup`, `m.orders_type_pay_pickup` (etichette esistenti, `features/orders/order-labels.ts:31-32`).
- Produces: `export function OrderTypesSection({ storeId }: { storeId: string }): JSX.Element`.

- [ ] **Step 1: Messaggi**

```json
"store.orderTypes.title": "Tipologie d'acquisto",
"store.orderTypes.description": "Come possono comprare i clienti in questo negozio. Almeno una deve restare attiva.",
"store.orderTypes.reserve.hint": "Il cliente prenota, paga e ritira in negozio entro 48 ore.",
"store.orderTypes.pay.hint": "Il cliente paga online e ritira in negozio.",
"store.orderTypes.pay.needsPayments": "Attiva prima i pagamenti online dal profilo.",
"store.orderTypes.pay.goToProfile": "Vai ai pagamenti online",
"store.orderTypes.pay.notOffered": "Attiva, ma i clienti non la vedono ancora: il pagamento online arriva a breve.",
"store.orderTypes.pay.accountDisabled": "I pagamenti online non sono più abilitati: i clienti non vedono questa tipologia.",
"store.orderTypes.saved": "Tipologie aggiornate",
"store.orderTypes.error": "Errore nel salvataggio delle tipologie"
```

(+ `en.json`.)

- [ ] **Step 2: Componente**

Una riga per tipologia con `Switch` di `@bibs/ui` (verifica che esista in `packages/ui/src/components/switch.tsx`; con Radix v1.x usa `data-[state=checked]:` — memoria `feedback_shadcn_data_state_mismatch`), etichetta + hint, salvataggio immediato al toggle:

```tsx
import { Label } from "@bibs/ui/components/label";
import { toast } from "@bibs/ui/components/sonner";
import { Switch } from "@bibs/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FormSection } from "@/components/form-section";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

type T = "reserve_pickup" | "pay_pickup";

export function OrderTypesSection({ storeId }: { storeId: string }) {
	const qc = useQueryClient();
	const key = ["store", storeId, "order-types"];
	const { data } = useQuery({
		queryKey: key,
		queryFn: async () =>
			unwrap(await api().seller.stores({ storeId })["order-types"].get(), m["store.orderTypes.error"]()),
	});
	const save = useMutation({
		mutationFn: async (orderTypes: T[]) =>
			unwrap(
				await api().seller.stores({ storeId })["order-types"].patch({ orderTypes }),
				m["store.orderTypes.error"](),
			),
		onSuccess: (next) => {
			qc.setQueryData(key, next);
			toast.success(m["store.orderTypes.saved"]());
		},
		onError: (e: Error) => toast.error(e.message),
	});

	if (!data) return <FormSection title={m["store.orderTypes.title"]()}>{null}</FormSection>;

	const on = (t: T) => data.orderTypes.includes(t);
	const toggle = (t: T, checked: boolean) =>
		save.mutate(checked ? [...data.orderTypes, t] : data.orderTypes.filter((x) => x !== t));
	const payOn = on("pay_pickup");
	const payOffered = data.offeredOrderTypes.includes("pay_pickup");
	// Spegnere l'ultima tipologia offerta lo rifiuterebbe l'API: si disabilita prima.
	const lastOffered = (t: T) => data.offeredOrderTypes.length === 1 && data.offeredOrderTypes[0] === t;

	return (
		<FormSection title={m["store.orderTypes.title"]()} description={m["store.orderTypes.description"]()}>
			<div className="space-y-5">
				<Row
					id="ot-reserve"
					label={m.orders_type_reserve_pickup()}
					hint={m["store.orderTypes.reserve.hint"]()}
					checked={on("reserve_pickup")}
					disabled={save.isPending || (on("reserve_pickup") && lastOffered("reserve_pickup"))}
					onChange={(c) => toggle("reserve_pickup", c)}
				/>
				<Row
					id="ot-pay"
					label={m.orders_type_pay_pickup()}
					hint={m["store.orderTypes.pay.hint"]()}
					checked={payOn}
					// Accendere richiede il conto; spegnere è sempre possibile.
					disabled={save.isPending || (!payOn && !data.chargesEnabled) || (payOn && lastOffered("pay_pickup"))}
					onChange={(c) => toggle("pay_pickup", c)}
				>
					{!payOn && !data.chargesEnabled && (
						<p className="text-xs text-muted-foreground">
							{m["store.orderTypes.pay.needsPayments"]()}{" "}
							<Link to="/profile" className="font-medium text-foreground underline-offset-4 hover:underline">
								{m["store.orderTypes.pay.goToProfile"]()}
							</Link>
						</p>
					)}
					{payOn && !payOffered && (
						<p className="text-xs text-muted-foreground">
							{data.chargesEnabled
								? m["store.orderTypes.pay.notOffered"]()
								: m["store.orderTypes.pay.accountDisabled"]()}
						</p>
					)}
				</Row>
			</div>
		</FormSection>
	);
}

function Row(props: {
	id: string;
	label: string;
	hint: string;
	checked: boolean;
	disabled: boolean;
	onChange: (checked: boolean) => void;
	children?: React.ReactNode;
}) {
	return (
		<div className="flex items-start justify-between gap-4">
			<div className="space-y-1">
				<Label htmlFor={props.id}>{props.label}</Label>
				<p className="text-xs text-muted-foreground">{props.hint}</p>
				{props.children}
			</div>
			<Switch id={props.id} checked={props.checked} disabled={props.disabled} onCheckedChange={props.onChange} />
		</div>
	);
}
```

Nella pagina negozio (`store/index.tsx`), nel `<div className="space-y-8">` dell'aside owner, dopo la `FormSection` «Vetrina»: `<OrderTypesSection key={activeStore.id} storeId={activeStore.id} />` (il `key` rimonta la sezione quando si cambia negozio, come fa `StoreForm`). Gli employee non la vedono (l'aside è solo owner).

- [ ] **Step 3: Verifica**

Run: `bun run --cwd apps/seller typecheck && bun run --cwd apps/seller build`
Expected: verdi.

Smoke (seller `:3002`): conto non attivo → «Paga e ritira» spento e disabilitato, link al profilo; PP1 acceso e disabilitato (unico offerto). Con il conto attivo (dopo il Task 6, o `UPDATE payment_methods SET charges_enabled = true` sul seller dev): accendi «Paga e ritira» → toast, compare «Attiva, ma i clienti non la vedono ancora…», PP1 resta non spegnibile. Cambia negozio attivo → la sezione mostra i dati del nuovo negozio. Tastiera: Tab raggiunge gli switch, Spazio li commuta. Customer `:3001`: il carrello di quel negozio offre ancora solo «Prenota e paga in negozio».

- [ ] **Step 4: Commit**

```bash
git add apps/seller
git commit -m "feat(seller): tipologie d'acquisto del negozio con Paga e ritira"
```

---

### Task 8: Docs, env, backlog e verifica finale

**Files:**
- Modify: `docs/stripe-billing.md` (sezione Connect)
- Modify: `apps/api/.env.example`
- Modify: `apps/api/AGENTS.md:223`
- Modify: `docs/audit/2026-09-24-followup-gap-analysis.md:40` (riga P1.1)

- [ ] **Step 1: Docs**

`docs/stripe-billing.md` — nuova sezione `## Connect (pagamenti online dei negozi)` dopo la parte webhook:

- cosa fa (conto Express-equivalente IT per seller, `payment_methods` fonte dello stato, `account.updated` → `refreshConnectAccount`);
- prerequisito una tantum: Connect abilitato sul conto Stripe di test (Dashboard → Connect → Get started) e profilo piattaforma compilato, altrimenti `accounts.create` risponde 400 «You can only create new accounts if you've signed up for Connect»;
- forwarding locale:
  ```bash
  stripe listen \
    --forward-to localhost:3000/webhooks/stripe \
    --forward-connect-to localhost:3000/webhooks/stripe/connect
  ```
  un solo `whsec_…` per entrambi → basta `STRIPE_WEBHOOK_SECRET`; in produzione una event destination «Connected accounts» con evento `account.updated` e il suo segreto in `STRIPE_CONNECT_WEBHOOK_SECRET`;
- prova: `stripe trigger account.updated` non tocca i nostri conti (crea un conto nuovo) → il log dice «unknown connected account, skipping»; il test vero è l'onboarding dal profilo seller;
- `ONLINE_PAYMENT_LIVE` in `apps/api/src/lib/order-types.ts`: resta `false` fino alla PR F.

`apps/api/.env.example`: sotto `STRIPE_WEBHOOK_SECRET` aggiungi
`# STRIPE_CONNECT_WEBHOOK_SECRET=whsec_…  (optional; defaults to STRIPE_WEBHOOK_SECRET, needed in prod for the Connect event destination)`.

`apps/api/AGENTS.md:223`: togli `PATCH /settings/payment` dall'elenco delle richieste con approvazione admin e aggiungi una riga: pagamenti online via `POST /settings/payments/onboarding` + `sync`, stato in `payment_methods` aggiornato da `POST /webhooks/stripe/connect`.

Backlog P1.1: «**PP1 fatto in #199**, **QR fatto in #200**, **Connect fatto in #NNN**; resta PR2 (F)».

- [ ] **Step 2: Verifica completa** (skill `superpowers:verification-before-completion`)

```bash
bun run --cwd apps/api test:unit
bun run --cwd apps/api test:integration
bun run typecheck; echo "exit $?"
bun run --cwd apps/seller test
bun run --cwd apps/seller build
bun run --cwd apps/customer build
bunx biome check .
```

Expected: tutto verde, `exit 0` (memoria: `bun --filter` può nascondere un workspace rosso → controlla l'exit code e, se dubbio, typecheck per workspace). `git status` pulito a parte i commit.

- [ ] **Step 3: Commit docs**

```bash
git add docs apps/api/.env.example apps/api/AGENTS.md
git commit -m "docs(orders): Stripe Connect in locale e backlog P1.1"
```

- [ ] **Step 4: PR senza auto-merge**

`/commit-commands:commit-push-pr` (non la skill `commit-push-pr`, che attiva l'auto-merge). Titolo: `feat(seller): pagamenti online con Stripe Connect Express (PR E)`. Corpo: riassunto per task, Rulings 1–5 in breve, «Chiude: parte E di P1.1», la checklist di smoke qui sotto, e in coda `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Dopo il merge aggiorna `#NNN` nel backlog se non era noto.

## Smoke manuale (per Marco, prima del merge)

Prerequisiti: `bun run dev`; `STRIPE_SECRET_KEY` di test con Connect abilitato; `stripe listen --forward-to localhost:3000/webhooks/stripe --forward-connect-to localhost:3000/webhooks/stripe/connect` attivo e `STRIPE_WEBHOOK_SECRET` aggiornato; migrazione applicata (`bun run db:migrate` o `db:reset`).

- [ ] Seller `:3002` come titolare (`seller@dev.bibs` / `password123`) → **Profilo**: card «Pagamenti online» con badge «Da attivare».
- [ ] «Attiva pagamenti online» → si apre l'onboarding Stripe (co-branded, in italiano). Doppio click veloce → un solo conto in Dashboard → Connect → Accounts.
- [ ] Chiudi la scheda a metà, torna al profilo → badge «Da completare», bottone «Completa l'attivazione» riprende lo stesso conto.
- [ ] Ricarica la pagina Stripe dopo qualche minuto (link scaduto) → passa da `/payments/refresh` e riapre l'onboarding senza errori.
- [ ] Completa l'onboarding con i dati di test → ritorno su `/payments/return` (spinner breve) → profilo con «In verifica» o «Attivo»; nel log di `stripe listen` compaiono `account.updated → 200` sulla route `/connect`.
- [ ] Con `stripe listen` spento, completa/aggiorna un conto → al ritorno lo stato è comunque giusto (sync).
- [ ] **Negozio** → sezione «Tipologie d'acquisto»: prima dell'attivazione «Paga e ritira» è disabilitato con link al profilo; «Prenota e paga in negozio» non si spegne.
- [ ] Con il conto attivo: accendi «Paga e ritira» → toast; sotto compare «Attiva, ma i clienti non la vedono ancora…». Spegnilo e riaccendilo. Solo tastiera: Tab fino agli switch, Spazio.
- [ ] Customer `:3001`: carrello con un prodotto di quel negozio → al checkout c'è solo «Prenota e paga in negozio».
- [ ] Da employee (un utente del team): nessuna card «Pagamenti online» nel profilo, nessuna sezione tipologie.
- [ ] Admin `:3003`: nessuna traccia di richieste «payment» (non esistevano UI; verifica che la pagina venditori carichi).
- [ ] Dark mode (`localStorage.theme='dark'`): card e sezione leggibili, badge «Attivo» visibile.
