# PR F — «Paga e ritira» (PR2) end-to-end Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il cliente sceglie «Paga e ritira» al checkout, paga una volta sola online (Payment Element, anche 3DS) l'importo di tutti i negozi PR2 del carrello, e ogni ordine PR2 passa da `pending` a `confirmed` solo a incasso avvenuto, con un trasferimento al conto Connect del negozio al netto della commissione bibs del 5%. Un PR2 non pagato entro 30 minuti si annulla da solo e restituisce lo stock; un PR2 pagato e poi annullato (dal cliente o dal negozio) si rimborsa con storno del trasferimento. `POST /customer/orders` non crea più ordini `pay_*` senza pagamento.

**Architecture:** `placeOrder` fa nascere ogni `pay_*` `pending` con `payment_expires_at = now + 30 min` e (solo `pay_pickup`) `platform_fee`. `createCheckout` somma i totali PR2, crea **un** PaymentIntent sulla piattaforma (`transfer_group = checkoutId`, solo carte) dentro la sua transazione e lo salva su `checkouts`; `getCheckout` restituisce `payment.clientSecret` finché c'è qualcosa da pagare. Un servizio unico `modules/billing/services/order-payments.ts` possiede tutto ciò che parla con Stripe per gli ordini: creazione del PI, `settleCheckoutPayment` (CAS `pending → confirmed`, rimborso degli ordini annullati nel frattempo, un `transfers.create` per ordine con `source_transaction` e idempotency key per ordine), `refundOrderPayment` (rimborso + storno). Il webhook piattaforma instrada `payment_intent.*` a un handler nuovo; un cron ogni minuto (`expireUnpaidOrders`) rilegge il PI prima di annullare, così un pagamento arrivato all'ultimo secondo si conferma invece di perdersi. FE customer: pagina `/checkout/$checkoutId/pay` con Payment Element caricato solo lato client; la pagina di ordine effettuato legge lo stato dall'API e fa polling finché il pagamento è in conferma. Seller: tab «In attesa di pagamento», annullamento con testo del rimborso.

**Tech Stack:** Elysia + TypeBox, Drizzle (drizzle-kit generate), stripe-node 22.6.2 (API `2026-08-26.dahlia`), `@elysiajs/cron`, bun:test + testcontainers; TanStack Start/Router/Query, `@stripe/stripe-js` 9.x + `@stripe/react-stripe-js` 6.x, paraglide (it/en), `@bibs/ui`.

**Spec:** `docs/superpowers/specs/2026-09-24-customer-checkout-design.md` — sezioni «Pagamento PR2 (PR E + F)», «Macchina a stati» (PR2), «Entità `checkouts`», «`POST /customer/checkout`», riga **F** di «Taglio in PR». Backlog: riga **P1.1** e paragrafo «P1.1, buco aperto» di `docs/audit/2026-09-24-followup-gap-analysis.md` (questa PR chiude P1.1).

## Global Constraints

- **Separate charges and transfers**: un solo PaymentIntent sulla piattaforma per l'importo PR2 del checkout, `transfer_group = checkoutId`, `currency: "eur"`. Nessun `on_behalf_of`, nessun `transfer_data` (i conti sono Accounts v2 con sola configurazione `recipient`: non possono avere `card_payments`).
- Trasferimento per ordine: `amount = totalCents − platformFeeCents`, `destination = payment_methods.stripe_account_id` (riga `is_default` del seller del negozio), `source_transaction = pi.latest_charge`. Parte solo su `payment_intent.succeeded`. Doppio evento → un solo trasferimento.
- **Commissione**: `config.platformFeePercent = 5`; `orders.platform_fee = Math.round(totalCents * 5 / 100)` calcolata alla creazione, **0 per ogni ordine non `pay_pickup`**. Le fee Stripe restano a bibs.
- **Finestra di pagamento**: `config.paymentWindowMinutes = 30`; cron **ogni minuto** su `pending` scaduti → `cancelled` + restock.
- Macchina a stati **invariata** (`lib/order-state-machine.ts`): PR2 = `pending → confirmed → ready_for_pickup → completed`, `pending|confirmed → cancelled`.
- `payment_methods.charges_enabled` con Accounts v2 = «trasferimenti attivi» (`stripe_balance.stripe_transfers`), vedi `db/schemas/payment-method.ts`. È la condizione per offrire `pay_pickup` (`offeredOrderTypes`).
- Webhook `payment_intent.*` sulla route **piattaforma** (`POST /webhooks/stripe`), idempotente sul ledger `stripe_events` esistente (`webhooks/services/dispatcher.ts`). Un handler che lancia → 500 → Stripe riconsegna: gli handler devono essere **rieseguibili**.
- Stripe v22: `latest_charge: string | Charge | null` su `PaymentIntent`; `stripe.transfers.createReversal(id, params, options)`; errore di stato del PI = `code: "payment_intent_unexpected_state"`.
- Stripe nei test: `mock.module("@/lib/stripe", …)` con solo i metodi usati, niente rete; `@/lib/env` mockato solo dove il codice lo legge (dispatcher). Test d'integrazione in file nuovi (girano con `--isolate`).
- Testi utente in italiano (paraglide `messages/it.json` + `en.json` in customer e seller). Badge di stato al singolare, tab al plurale.
- Mai `from "sonner"`: `@bibs/ui/components/sonner`. Customer e seller: alias `@/*` → `./src/*`.
- Nuove route TanStack: committa `apps/customer/src/routeTree.gen.ts` (rigenerato da `bun run --cwd apps/customer build`).
- Librerie DOM-only (Stripe.js) via `lazy()` + mount-gate dentro `Suspense`, come `LazyStoreMap` in `routes/_authenticated/stores/$storeId.tsx:16,67-78`. `bun run --cwd apps/customer build` è il gate SSR.
- Commit Conventional, scope della whitelist `AGENTS.md:396-397` (`db`, `orders`, `api`, `customer`, `seller`; docs `docs(orders)`). Mai indebolire asserzioni o toccare la produzione per ottenere un RED.
- PR **senza auto-merge** (ha UI): `/commit-commands:commit-push-pr`, non la skill `commit-push-pr`.

## Rulings

Decisioni prese qui; ognuna con il costo se sbagliata.

1. **Buco di `POST /customer/orders` (bloccante per il deploy): entrambe le cose.** (a) `placeOrder` fa nascere **ogni** `pay_*` `pending` con `payment_expires_at`: è la regola di dominio dello spec e vale per qualunque chiamante, quindi nessun percorso crea più un `pay_*` `confirmed` senza pagamento. (b) Il body di `POST /customer/orders` accetta solo `direct | reserve_pickup` (422 sugli altri): quell'endpoint non crea PaymentIntent, e un `pending` senza PI servirebbe solo a bloccare stock per 30 minuti (vettore di abuso). `offeredOrderTypes` lì non basterebbe: non chiude `pay_deliver` e lascerebbe comunque un ordine non pagabile. Nessun FE usa `customer.orders.post` (verificato). Costo se sbagliato: nessuno, PS3 riaprirà `pay_deliver` col suo flusso.
2. **`ONLINE_PAYMENT_LIVE` si rimuove, non si mette a `true`.** Con il PI in piedi il flag non protegge più niente: si toglie la costante e l'opzione `live` da `offeredOrderTypes(configured, { chargesEnabled })`. I test che la pinnano cambiano asserzione (PR2 offerto con conto abilitato). Il testo seller «Attiva, ma i clienti non la vedono ancora» diventa morto e si rimuove. Si accende solo nel Task 3, insieme al PaymentIntent, mai prima.
3. **Pagamento rifiutato ≠ annullamento.** Con il Payment Element un tentativo fallito lascia il PI in `requires_payment_method`: il cliente può riprovare con un'altra carta sulla stessa pagina. Quindi `payment_intent.payment_failed` **non** annulla gli ordini (solo log); l'annullamento avviene alla scadenza dei 30 minuti (cron) o su `payment_intent.canceled`. È una deviazione voluta dalla lettera dello spec («Pagamento fallito → cancelled»): annullare al primo rifiuto costringerebbe a rifare il checkout per una carta sbagliata. Costo se sbagliato: basta instradare `payment_failed` a `cancelUnpaidOrder`.
4. **Annullamento di un PR2 `pending`: vietato** (cliente e seller, 409). Il PI copre tutti i negozi PR2 del checkout: annullarne uno solo non può cancellare il PI, e un annullamento "a metà" lascerebbe il cliente libero di pagare anche l'ordine annullato. Un `pending` si annulla da solo entro 30 minuti. Il FE nasconde il bottone (`canCancel`/`canCustomerCancel`), il seller vede il `pending` nella tab nuova, in sola lettura. La transizione `pending → cancelled` resta nella macchina a stati per cron e webhook.
5. **Annullamento di un PR2 `confirmed` = rimborso dentro la transazione.** Ordine: CAS di stato (la riga resta bloccata fino al commit, un annullamento concorrente trova 0 righe → 409) → `refunds.create` con idempotency key `refund:<orderId>` (se Stripe fallisce: 502 e rollback, l'ordine resta confermato) → `stripe_refund_id` sull'ordine → storno del trasferimento **best-effort** (`createReversal`, key `reversal:<orderId>`): se il seller ha già incassato e il saldo non basta, Stripe rifiuta lo storno; il cliente è comunque rimborsato, l'errore va nel log per il recupero manuale. Bloccare l'annullamento per uno storno fallito lascerebbe il cliente senza rimborso. Chiamata Stripe dentro una tx con lock: precedente in `ensureConnectAccount`. Costo se sbagliato: bibs anticipa il rimborso di un ordine già versato al seller (raro, visibile nel log e nella dashboard Stripe).
6. **Pagamento arrivato dopo la scadenza.** Due reti: (a) il cron, prima di annullare, **rilegge il PI**: `succeeded` → chiama `settleCheckoutPayment` invece di annullare; `processing` → aspetta; altrimenti `paymentIntents.cancel` e poi annulla gli ordini. (b) Se comunque un ordine è già `cancelled` quando arriva `succeeded` (race tra cancel del PI e conferma del cliente), `settleCheckoutPayment` rimborsa la sua quota (`status = cancelled AND stripe_refund_id IS NULL`). Nuova colonna `orders.stripe_refund_id` per non rimborsare due volte (serve anche al Ruling 5).
7. **Solo carte** (`payment_method_types: ["card"]`, che include Apple Pay/Google Pay). I metodi a notifica differita (SEPA, bonifico) sono incompatibili con una finestra di 30 minuti e con `source_transaction` (la doc Stripe sconsiglia `source_transaction` con metodi asincroni). Costo se sbagliato: allargare a `automatic_payment_methods` richiede di gestire `processing` lungo.
8. **PI creato dentro la transazione del checkout**, idempotency key `checkout-pi:<checkoutId>`. Se Stripe fallisce → 502, rollback, carrello intatto. Se il commit fallisce dopo un PI creato → PI orfano in `requires_payment_method`, mai addebitato (accettato, come il conto orfano della PR E). Il `clientSecret` **non** si salva: `getCheckout` lo rilegge con `paymentIntents.retrieve` solo se c'è ancora un PR2 `pending` e il PI è in uno stato pagabile; così refresh e ritorno dal 3DS funzionano.
9. **Trasferimenti rieseguibili.** `settleCheckoutPayment`: (1) un UPDATE CAS `pending → confirmed` di tutti i PR2 del checkout (idempotente di suo), (2) rimborsi tardivi, (3) per ogni PR2 del checkout in `confirmed|ready_for_pickup|completed` con `stripe_transfer_id IS NULL`: `transfers.create` con key `transfer:<orderId>` e poi `stripe_transfer_id` con guardia `IS NULL`. Se un trasferimento fallisce (conto disabilitato) gli altri proseguono e alla fine si lancia → 500 → Stripe riconsegna e si riprova solo ciò che manca. Doppio evento: il ledger lo salta; evento riconsegnato dopo un fallimento: la guardia `IS NULL` + key per ordine impediscono il doppio trasferimento.
10. **Schema risposta**: `OrderSchema` guadagna `paymentExpiresAt`; `platformFee`, `stripeTransferId`, `stripeRefundId` restano interni (il plugin `normalize` scarta i campi non dichiarati). `CheckoutSchema` guadagna `amountDueOnline` e `payment: { clientSecret } | null`.
11. **Fuori scope**: dispute/chargeback, rimborsi parziali, dashboard dei trasferimenti falliti, `direct` via `POST /customer/orders` (crea un ordine `completed` con punti senza pagamento: **finding preesistente**, da mettere in backlog, non cambia con questa PR), PS3.

## Review Focus

1. **Il cliente paga proprio mentre scadono i 30 minuti** → deve risultare pagato (se il PI è riuscito) o rimborsato, mai «annullato ma addebitato» → test in Task 4 (rimborso della quota di un ordine già annullato) e Task 5 (cron con PI `succeeded` conferma invece di annullare).
2. **`payment_intent.succeeded` consegnato due volte, o riconsegnato dopo un trasferimento fallito** → un solo trasferimento per ordine, si ritenta solo quello mancante → test in Task 4.
3. **Carta rifiutata, poi seconda carta buona** → gli ordini restano `pending` dopo il rifiuto e si confermano col secondo tentativo → test in Task 4 (`payment_failed` non tocca nulla) + smoke (carta `4000 0000 0000 0002`).
4. **Il negozio annulla un PR2 già trasferito e il seller ha già incassato** → il cliente è rimborsato anche se lo storno fallisce; annullamenti concorrenti cliente+negozio → un solo rimborso → test in Task 6.
5. **Refresh della pagina di pagamento o ritorno dal redirect 3DS** → la pagina rilegge il `clientSecret` dall'API; la pagina di ordine effettuato legge lo stato dall'API, non dall'URL, e aspetta la conferma → test in Task 3 (`getCheckout` con/ senza `payment`) + Task 7 (`paymentState`) + smoke 3DS.

---

### Task 1: Schema — colonne di pagamento su `orders` e `checkouts`, config, commissione

**Files:**
- Modify: `apps/api/src/db/schemas/order.ts`
- Modify: `apps/api/src/db/schemas/checkout.ts`
- Modify: `apps/api/src/lib/config.ts`
- Create: `apps/api/src/lib/platform-fee.ts`
- Create: `apps/api/src/db/migrations/0013_*.sql` (+ `meta/`, generati)
- Test: `apps/api/tests/lib/platform-fee.test.ts`

**Interfaces:**
- Produces: `platformFeeCents(totalCents: number): number`; `config.platformFeePercent = 5`, `config.paymentWindowMinutes = 30`; colonne `order.paymentExpiresAt: Date | null`, `order.platformFee: string` (default `"0.00"`), `order.stripeTransferId: string | null`, `order.stripeRefundId: string | null`, `checkout.stripePaymentIntentId: string | null`, `checkout.amountDueOnline: string` (default `"0.00"`).

- [ ] **Step 1: Test RED della commissione**

`apps/api/tests/lib/platform-fee.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { platformFeeCents } from "@/lib/platform-fee";

describe("platformFeeCents", () => {
	it("è il 5% del totale, arrotondato al centesimo", () => {
		expect(platformFeeCents(1000)).toBe(50);
		expect(platformFeeCents(1999)).toBe(100); // 99,95 → 100
		expect(platformFeeCents(1990)).toBe(100); // 99,5 → 100 (half-up)
		expect(platformFeeCents(1)).toBe(0);
	});

	it("zero su totale zero", () => {
		expect(platformFeeCents(0)).toBe(0);
	});
});
```

- [ ] **Step 2: Verifica RED**

Run: `bun test --cwd apps/api tests/lib/platform-fee.test.ts`
Expected: FAIL, `Cannot find module '@/lib/platform-fee'`.

- [ ] **Step 3: Config e funzione**

In `apps/api/src/lib/config.ts`, dopo `reservationHours`:

```ts
	/** Minuti entro cui pagare un ordine pay_* prima che si annulli da solo */
	paymentWindowMinutes: 30,
	/** Commissione bibs sui pagamenti online (PR2), in percentuale del totale */
	platformFeePercent: 5,
```

`apps/api/src/lib/platform-fee.ts`:

```ts
import { config } from "@/lib/config";

/**
 * Commissione bibs su un ordine pagato online, in centesimi. Le fee Stripe
 * restano a bibs e le copre questa commissione.
 */
export function platformFeeCents(totalCents: number): number {
	return Math.round((totalCents * config.platformFeePercent) / 100);
}
```

- [ ] **Step 4: Verifica GREEN**

Run: `bun test --cwd apps/api tests/lib/platform-fee.test.ts`
Expected: PASS.

- [ ] **Step 5: Colonne su `orders`**

In `apps/api/src/db/schemas/order.ts`, dopo `pickupCode`:

```ts
		// Solo pay_*: oltre questa data un ordine ancora `pending` si annulla da
		// solo (cron expireUnpaidOrders) e lo stock torna disponibile.
		paymentExpiresAt: timestamp("payment_expires_at", { withTimezone: true }),
		// Commissione bibs (lib/platform-fee.ts), fissata alla creazione; 0 per
		// ogni ordine che non è pay_pickup.
		platformFee: numeric("platform_fee", { precision: 10, scale: 2 })
			.default("0")
			.notNull(),
		// Trasferimento al conto Connect del negozio (settleCheckoutPayment) e
		// rimborso al cliente (refundOrderPayment): mai due volte.
		stripeTransferId: text("stripe_transfer_id"),
		stripeRefundId: text("stripe_refund_id"),
```

Nella lista degli indici, dopo `order_active_reservation_idx`:

```ts
		// Sweep dei pagamenti scaduti (expireUnpaidOrders), ogni minuto.
		index("order_unpaid_expiry_idx")
			.on(table.paymentExpiresAt)
			.where(
				sql`${table.status} = 'pending' AND ${table.paymentExpiresAt} IS NOT NULL`,
			),
```

Nei `check`, dopo `order_points_spent_non_negative`:

```ts
		check(
			"order_platform_fee_range",
			sql`${table.platformFee} >= 0 AND ${table.platformFee} <= ${table.total}`,
		),
```

- [ ] **Step 6: Colonne su `checkouts`**

In `apps/api/src/db/schemas/checkout.ts`: import `check`, `numeric` da `drizzle-orm/pg-core` e `sql` da `drizzle-orm`; aggiorna il commento della tabella («dalla PR F» → «il PaymentIntent unico degli ordini da pagare online»), e dopo `idempotencyKey`:

```ts
		// PaymentIntent unico per gli ordini pay_pickup del checkout; NULL se il
		// checkout ha solo prenotazioni.
		stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
		// Σ total degli ordini pay_pickup, l'importo del PaymentIntent.
		amountDueOnline: numeric("amount_due_online", { precision: 10, scale: 2 })
			.default("0")
			.notNull(),
```

e nel callback delle constraint:

```ts
	(t) => [
		index("checkout_customer_profile_id_idx").on(t.customerProfileId),
		check("checkout_amount_due_online_non_negative", sql`${t.amountDueOnline} >= 0`),
	],
```

- [ ] **Step 7: Migrazione**

Run: `bun run --cwd apps/api db:generate`
Expected: nuovo `apps/api/src/db/migrations/0013_*.sql` con 4 `ADD COLUMN` su `orders`, 2 su `checkouts` (NOT NULL **con** DEFAULT: sicuro su tabelle popolate), unique, indice parziale, 2 CHECK. Aprilo e verifica che non ci siano `DROP` o la ri-emissione di `pg_trgm` (memoria: generate non la riemette, controlla solo che non tocchi altro).

- [ ] **Step 8: Typecheck e test esistenti degli schemi**

Run: `bun run --cwd apps/api typecheck && bun test --cwd apps/api tests/integration/db-enum-check-constraints.test.ts`
Expected: typecheck verde; test PASS (il container applica la migrazione nuova).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/db/schemas/order.ts apps/api/src/db/schemas/checkout.ts apps/api/src/lib/config.ts apps/api/src/lib/platform-fee.ts apps/api/src/db/migrations apps/api/tests/lib/platform-fee.test.ts
git commit -m "feat(db): colonne di pagamento online su ordini e checkout"
```

---

### Task 2: `pay_*` nasce `pending` + chiusura del buco di `POST /customer/orders`

**Files:**
- Modify: `apps/api/src/modules/customer/services/orders.ts` (`placeOrder`, righe ~420-455)
- Modify: `apps/api/src/modules/customer/routes/orders.ts:52-65` (body `type`)
- Modify: `apps/api/src/lib/schemas/entities.ts:634+` (`OrderSchema.paymentExpiresAt`)
- Modify: `apps/api/tests/integration/customer-orders.test.ts` (righe 210-225, 419-480)
- Modify: `apps/api/tests/modules/integer-inputs.test.ts:73-77`
- Create: `apps/api/tests/integration/customer-orders-pay-types.test.ts`

**Interfaces:**
- Consumes: `platformFeeCents`, `config.paymentWindowMinutes` (Task 1).
- Produces: `placeOrder` restituisce per `pay_pickup` un ordine `{ status: "pending", paymentExpiresAt: Date, platformFee: string }`; `export const PAY_TYPES: readonly OrderType[] = ["pay_pickup", "pay_deliver"]` da `customer/services/orders.ts` (lo usano Task 5 e 6).

- [ ] **Step 1: Test RED**

`apps/api/tests/integration/customer-orders-pay-types.test.ts`:

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

import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { user as userTable } from "@/db/schemas/auth";
import { customerProfile as customerProfileTable } from "@/db/schemas/customer";
import { order } from "@/db/schemas/order";
import { ordersRoutes } from "@/modules/customer/routes/orders";
import { createOrder } from "@/modules/customer/services/orders";
import { errorHandler } from "@/plugins/error-handler";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCustomer,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
	createTestStoreSubscription,
} from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

const noopPino = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	trace: () => {},
} as any;

const app = new Elysia()
	.state("pino", noopPino)
	.use(errorHandler)
	.resolve(async ({ request }) => {
		const id = request.headers.get("x-test-user") ?? "";
		const db = getTestDb();
		const u = await db.query.user.findFirst({ where: eq(userTable.id, id) });
		const cp = await db.query.customerProfile.findFirst({
			where: eq(customerProfileTable.userId, id),
		});
		if (!u || !cp) throw new Error("test customer missing");
		return { user: u, customerProfile: cp };
	})
	.use(ordersRoutes);

async function seed() {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const store = await createTestStore(db, seller.profile.id);
	await createTestStoreSubscription(db, store.id);
	const product = await createTestProduct(db, seller.profile.id, {
		price: "10.00",
	});
	const sp = await createTestStoreProduct(db, store.id, product.id, {
		stock: 5,
	});
	const customer = await createTestCustomer(db);
	return { store, sp, customer };
}

describe("placeOrder — pay_*", () => {
	it("pay_pickup nasce pending, con scadenza a 30 minuti, commissione e stock già tolto", async () => {
		const { store, sp, customer } = await seed();
		const before = Date.now();
		const created = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "pay_pickup",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 2 }],
		});
		expect(created.status).toBe("pending");
		expect(created.platformFee).toBe("1.00"); // 5% di 20,00
		const exp = created.paymentExpiresAt?.getTime() ?? 0;
		expect(exp).toBeGreaterThanOrEqual(before + 30 * 60_000 - 1000);
		expect(exp).toBeLessThanOrEqual(Date.now() + 30 * 60_000 + 1000);
		const [row] = await getTestDb()
			.select()
			.from(order)
			.where(eq(order.id, created.id));
		expect(row.status).toBe("pending");
	});

	it("reserve_pickup resta confirmed, senza scadenza di pagamento né commissione", async () => {
		const { store, sp, customer } = await seed();
		const created = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "reserve_pickup",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});
		expect(created.status).toBe("confirmed");
		expect(created.paymentExpiresAt).toBeNull();
		expect(created.platformFee).toBe("0.00");
	});
});

describe("POST /orders — niente pay_* senza pagamento", () => {
	for (const type of ["pay_pickup", "pay_deliver"] as const) {
		it(`${type} → 422 e nessun ordine`, async () => {
			const { store, sp, customer } = await seed();
			const res = await app.handle(
				new Request("http://localhost/orders", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-test-user": customer.user.id,
					},
					body: JSON.stringify({
						type,
						storeId: store.id,
						items: [{ storeProductId: sp.id, quantity: 1 }],
					}),
				}),
			);
			expect(res.status).toBe(422);
			expect(await getTestDb().select().from(order)).toHaveLength(0);
		});
	}

	it("reserve_pickup passa", async () => {
		const { store, sp, customer } = await seed();
		const res = await app.handle(
			new Request("http://localhost/orders", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-test-user": customer.user.id,
				},
				body: JSON.stringify({
					type: "reserve_pickup",
					storeId: store.id,
					items: [{ storeProductId: sp.id, quantity: 1 }],
				}),
			}),
		);
		expect(res.status).toBe(200);
	});
});
```

- [ ] **Step 2: Verifica RED**

Run: `bun test --cwd apps/api tests/integration/customer-orders-pay-types.test.ts --timeout 180000`
Expected: FAIL — `status` è `"confirmed"` invece di `"pending"`; `platformFee` undefined; `POST` con `pay_pickup` → 200.

- [ ] **Step 3: `placeOrder`**

In `apps/api/src/modules/customer/services/orders.ts`: import `platformFeeCents` da `@/lib/platform-fee`. Accanto a `PICKUP_TYPES`:

```ts
/** Tipi pagati online: nascono `pending` e si confermano solo a incasso. */
export const PAY_TYPES: readonly OrderType[] = ["pay_pickup", "pay_deliver"];
```

Sostituisci `const initialStatus = type === "direct" ? "completed" : "confirmed";` con:

```ts
	// pay_*: nessun ordine confermato senza pagamento. Nasce pending con lo
	// stock già tolto; lo conferma il webhook del PaymentIntent, oppure il cron
	// lo annulla allo scadere della finestra di pagamento.
	const isPay = PAY_TYPES.includes(type);
	const initialStatus =
		type === "direct" ? "completed" : isPay ? "pending" : "confirmed";
	const paymentExpiresAt = isPay
		? new Date(Date.now() + config.paymentWindowMinutes * 60 * 1000)
		: null;
	// Commissione solo su PR2 (spec: per gli ordini non PR2 resta 0).
	const platformFee = fromCents(
		type === "pay_pickup" ? platformFeeCents(finalTotalCents) : 0,
	);
```

e nell'insert dell'ordine aggiungi `paymentExpiresAt, platformFee,` dopo `reservationExpiresAt,`.

- [ ] **Step 4: Route**

In `apps/api/src/modules/customer/routes/orders.ts`, body di `POST /orders`:

```ts
				type: t.Union([t.Literal("direct"), t.Literal("reserve_pickup")], {
					description:
						"Tipo di ordine: direct (acquisto diretto) o reserve_pickup (prenota e ritira). Gli ordini pagati online nascono solo da POST /customer/checkout, che crea il pagamento.",
				}),
```

Rimuovi `shippingAddressId` dal body? **No**: `placeOrder` lo ignora per i tipi non `pay_deliver`; lascialo per non allargare il diff (verrà ripreso da PS3). Aggiorna la `description` del `detail`: «Crea un ordine diretto o una prenotazione. Per pagare online usare POST /customer/checkout.»

- [ ] **Step 5: `OrderSchema`**

In `apps/api/src/lib/schemas/entities.ts`, dopo `reservationExpiresAt`:

```ts
	paymentExpiresAt: t.Nullable(
		t.Date({
			description:
				"Solo ordini da pagare online: oltre questa data un ordine ancora in attesa di pagamento si annulla",
		}),
	),
```

- [ ] **Step 6: Adegua i test che creavano `pay_pickup` confermati via service**

`tests/integration/customer-orders.test.ts`:
- `describe("createOrder — pay_pickup")` (riga ~210): rinomina il test in `"creates order with status 'pending' (paid online)"` e asserisci `expect(result.status).toBe("pending")`.
- `describe("cancelOrder")` righe ~419-480: nei due test che creano l'ordine con `type: "pay_pickup"` usa `type: "reserve_pickup"` (il test verifica restock e rimborso punti di un ordine confermato annullabile: con `pay_pickup` ora nascerebbe `pending`, che dal Task 6 non si annulla, e il `confirmed` richiederebbe Stripe). Non toccare le asserzioni.
- riga ~607 (`order2`, test di vendibilità: verifica che non nasca nulla): lascia `pay_pickup`, il test asserisce l'assenza di ordini e stock intatto, invariato.

`tests/modules/integer-inputs.test.ts:74`: `type: "reserve_pickup"` (il test deve fallire sulla quantità frazionaria, non sul tipo).

- [ ] **Step 7: Verifica GREEN**

Run: `bun test --cwd apps/api tests/integration/customer-orders-pay-types.test.ts tests/integration/customer-orders.test.ts tests/integration/customer-orders-address-idor.test.ts tests/integration/customer-orders-address-snapshot.test.ts tests/integration/customer-checkout.test.ts tests/modules/integer-inputs.test.ts --timeout 180000`
Expected: PASS. (I test `pay_deliver` di idor/snapshot passano: asseriscono indirizzo e snapshot, non lo stato. Se uno asserisce `confirmed`, cambialo in `pending` e annotalo nel commit.)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/customer apps/api/src/lib/schemas/entities.ts apps/api/tests
git commit -m "fix(orders): ordini pay_* nascono in attesa di pagamento, POST /orders non li accetta più"
```

---

### Task 3: PaymentIntent del checkout + PR2 offerto al cliente

**Files:**
- Create: `apps/api/src/modules/billing/services/order-payments.ts`
- Modify: `apps/api/src/modules/customer/services/checkout.ts`
- Modify: `apps/api/src/modules/customer/routes/checkout.ts` (log `amountDueOnline`)
- Modify: `apps/api/src/lib/schemas/composed.ts:162` (`CheckoutSchema`)
- Modify: `apps/api/src/lib/order-types.ts` (rimozione flag)
- Modify: `apps/api/tests/lib/order-types.test.ts`, `apps/api/tests/integration/seller-store-order-types.test.ts:66-120`, `apps/api/tests/integration/customer-cart.test.ts:320-362`, `apps/api/tests/integration/customer-checkout.test.ts:232-256`
- Modify: `apps/api/tests/helpers/fixtures.ts` (helper `enableOnlinePayments`)
- Create: `apps/api/tests/integration/customer-checkout-pay.test.ts`

**Interfaces:**
- Consumes: `PAY_TYPES`, `placeOrder` (Task 2); colonne `checkout.stripePaymentIntentId`, `checkout.amountDueOnline` (Task 1).
- Produces:
  - `createCheckoutPaymentIntent(params: { checkoutId: string; customerProfileId: string; amountCents: number }): Promise<string>` (id del PI)
  - `payableClientSecret(paymentIntentId: string): Promise<string | null>`
  - `offeredOrderTypes(configured: readonly string[], opts: { chargesEnabled: boolean }): StoreOrderType[]` (senza `live`)
  - `getCheckout` → `{ id, createdAt, amountDueOnline: string, payment: { clientSecret: string } | null, orders }`
  - fixture `enableOnlinePayments(db, { sellerProfileId, storeId, accountId? }): Promise<void>`

- [ ] **Step 1: Fixture**

In `apps/api/tests/helpers/fixtures.ts` (import `paymentMethod` da `@/db/schemas/payment-method` e `store` se non già importati):

```ts
/** Negozio che offre PR2: tipologia accesa e conto Connect abilitato. */
export async function enableOnlinePayments(
	db: DrizzleTestDb,
	params: { sellerProfileId: string; storeId: string; accountId?: string },
) {
	await db
		.update(store)
		.set({ orderTypes: ["reserve_pickup", "pay_pickup"] })
		.where(eq(store.id, params.storeId));
	await db
		.insert(paymentMethod)
		.values({
			sellerProfileId: params.sellerProfileId,
			stripeAccountId: params.accountId ?? "acct_SELLER",
			chargesEnabled: true,
			payoutsEnabled: true,
			detailsSubmitted: true,
		})
		.onConflictDoNothing();
}
```

- [ ] **Step 2: Test RED del checkout PR2**

`apps/api/tests/integration/customer-checkout-pay.test.ts`:

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

let piStatus = "requires_payment_method";
const paymentIntentsCreate = mock(async (p: any, _o?: any) => ({
	id: "pi_TEST",
	amount: p.amount,
	client_secret: "pi_TEST_secret_abc",
	status: "requires_payment_method",
}));
const paymentIntentsRetrieve = mock(async (id: string) => ({
	id,
	client_secret: "pi_TEST_secret_abc",
	status: piStatus,
}));

mock.module("@/lib/stripe", () => ({
	stripe: {
		paymentIntents: {
			create: paymentIntentsCreate,
			retrieve: paymentIntentsRetrieve,
		},
	},
}));

import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { cartItem } from "@/db/schemas/cart";
import { checkout } from "@/db/schemas/checkout";
import { order } from "@/db/schemas/order";
import { storeProduct } from "@/db/schemas/product";
import {
	createCheckout,
	getCheckout,
} from "@/modules/customer/services/checkout";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCartItem,
	createTestCustomer,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
	createTestStoreSubscription,
	enableOnlinePayments,
} from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
	paymentIntentsCreate.mockClear();
	paymentIntentsRetrieve.mockClear();
	piStatus = "requires_payment_method";
});

async function sellable(
	sellerProfileId: string,
	name: string,
	price = "10.00",
	stock = 5,
) {
	const db = getTestDb();
	const store = await createTestStore(db, sellerProfileId, { name });
	await createTestStoreSubscription(db, store.id);
	const product = await createTestProduct(db, sellerProfileId, { price });
	const sp = await createTestStoreProduct(db, store.id, product.id, { stock });
	return { store, sp };
}

async function mixedCart() {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const customer = await createTestCustomer(db);
	const pay1 = await sellable(seller.profile.id, "Paga 1", "10.00");
	const pay2 = await sellable(seller.profile.id, "Paga 2", "7.50");
	const reserve = await sellable(seller.profile.id, "Prenota", "4.00");
	for (const s of [pay1, pay2])
		await enableOnlinePayments(db, {
			sellerProfileId: seller.profile.id,
			storeId: s.store.id,
		});
	await createTestCartItem(db, customer.profile.id, pay1.sp.id, { quantity: 2 });
	await createTestCartItem(db, customer.profile.id, pay2.sp.id, { quantity: 1 });
	await createTestCartItem(db, customer.profile.id, reserve.sp.id, {
		quantity: 1,
	});
	return { customer, pay1, pay2, reserve };
}

describe("checkout con Paga e ritira", () => {
	it("un solo PaymentIntent per la somma dei PR2, ordini PR2 pending, PP1 confermato", async () => {
		const { customer, pay1, pay2, reserve } = await mixedCart();

		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [
				{ storeId: pay1.store.id, type: "pay_pickup" },
				{ storeId: pay2.store.id, type: "pay_pickup" },
				{ storeId: reserve.store.id, type: "reserve_pickup" },
			],
		});

		expect(paymentIntentsCreate).toHaveBeenCalledTimes(1);
		const [params, opts] = paymentIntentsCreate.mock.calls[0];
		expect(params).toMatchObject({
			amount: 2750, // 2×10,00 + 7,50
			currency: "eur",
			payment_method_types: ["card"],
			transfer_group: result.id,
			metadata: { checkoutId: result.id },
		});
		expect(opts).toEqual({ idempotencyKey: `checkout-pi:${result.id}` });

		expect(result.amountDueOnline).toBe("27.50");
		expect(result.payment).toEqual({ clientSecret: "pi_TEST_secret_abc" });
		const byStore = Object.fromEntries(
			result.orders.map((o) => [o.storeId, o]),
		);
		expect(byStore[pay1.store.id].status).toBe("pending");
		expect(byStore[pay2.store.id].status).toBe("pending");
		expect(byStore[reserve.store.id].status).toBe("confirmed");

		const [co] = await getTestDb()
			.select()
			.from(checkout)
			.where(eq(checkout.id, result.id));
		expect(co.stripePaymentIntentId).toBe("pi_TEST");
		expect(co.amountDueOnline).toBe("27.50");
	});

	it("solo prenotazioni: nessun PaymentIntent, payment null", async () => {
		const { customer, reserve } = await mixedCart();
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [{ storeId: reserve.store.id, type: "reserve_pickup" }],
		});
		expect(paymentIntentsCreate).not.toHaveBeenCalled();
		expect(result.payment).toBeNull();
		expect(result.amountDueOnline).toBe("0.00");
	});

	it("Stripe giù: 502, nessun ordine, carrello e stock intatti", async () => {
		const { customer, pay1 } = await mixedCart();
		paymentIntentsCreate.mockImplementationOnce(async () => {
			throw new Stripe.errors.StripeAPIError({
				message: "down",
				type: "api_error",
			} as any);
		});
		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 0,
				idempotencyKey: crypto.randomUUID(),
				stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
			}),
		).rejects.toMatchObject({ status: 502 });
		const db = getTestDb();
		expect(await db.select().from(order)).toHaveLength(0);
		expect(await db.select().from(checkout)).toHaveLength(0);
		expect(
			await db
				.select()
				.from(cartItem)
				.where(eq(cartItem.customerProfileId, customer.profile.id)),
		).toHaveLength(3);
		const [sp] = await db
			.select()
			.from(storeProduct)
			.where(eq(storeProduct.id, pay1.sp.id));
		expect(sp.stock).toBe(5);
	});

	it("la stessa key restituisce lo stesso checkout senza un secondo PaymentIntent", async () => {
		const { customer, pay1 } = await mixedCart();
		const key = crypto.randomUUID();
		const body = {
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: key,
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" as const }],
		};
		const first = await createCheckout(body);
		const second = await createCheckout(body);
		expect(second.id).toBe(first.id);
		expect(second.payment).toEqual({ clientSecret: "pi_TEST_secret_abc" });
		expect(paymentIntentsCreate).toHaveBeenCalledTimes(1);
	});
});

describe("getCheckout — payment", () => {
	it("dopo il pagamento (nessun PR2 pending) payment è null e Stripe non si interroga", async () => {
		const { customer, pay1 } = await mixedCart();
		const created = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
		});
		await getTestDb()
			.update(order)
			.set({ status: "confirmed" })
			.where(eq(order.checkoutId, created.id));
		paymentIntentsRetrieve.mockClear();

		const read = await getCheckout({
			checkoutId: created.id,
			customerProfileId: customer.profile.id,
		});
		expect(read.payment).toBeNull();
		expect(paymentIntentsRetrieve).not.toHaveBeenCalled();
	});

	it("PI non più pagabile (succeeded in volo) → payment null anche con ordini pending", async () => {
		const { customer, pay1 } = await mixedCart();
		const created = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
		});
		piStatus = "succeeded";
		const read = await getCheckout({
			checkoutId: created.id,
			customerProfileId: customer.profile.id,
		});
		expect(read.payment).toBeNull();
	});
});
```

- [ ] **Step 3: Verifica RED**

Run: `bun test --cwd apps/api tests/integration/customer-checkout-pay.test.ts --timeout 180000`
Expected: FAIL — `createCheckout` rifiuta `pay_pickup` con 400 (flag spento) / `amountDueOnline` undefined.

- [ ] **Step 4: Servizio `order-payments.ts` (parte 1: PaymentIntent)**

`apps/api/src/modules/billing/services/order-payments.ts`:

```ts
import Stripe from "stripe";
import { ServiceError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { stripe } from "@/lib/stripe";

/** Stati in cui il cliente può ancora (ri)tentare il pagamento. */
const PAYABLE: readonly Stripe.PaymentIntent.Status[] = [
	"requires_payment_method",
	"requires_confirmation",
	"requires_action",
];

/**
 * Un PaymentIntent sulla piattaforma per tutti gli ordini pay_pickup del
 * checkout (separate charges and transfers): i soldi arrivano a bibs, i
 * trasferimenti ai negozi partono a incasso avvenuto (settleCheckoutPayment).
 * Solo carte (Apple/Google Pay inclusi): i metodi a notifica differita non
 * stanno in una finestra di 30 minuti. Chiamato dentro la tx del checkout: se
 * Stripe fallisce, nessun ordine nasce.
 */
export async function createCheckoutPaymentIntent(params: {
	checkoutId: string;
	customerProfileId: string;
	amountCents: number;
}): Promise<string> {
	try {
		const pi = await stripe.paymentIntents.create(
			{
				amount: params.amountCents,
				currency: "eur",
				payment_method_types: ["card"],
				transfer_group: params.checkoutId,
				metadata: {
					checkoutId: params.checkoutId,
					customerProfileId: params.customerProfileId,
				},
			},
			{ idempotencyKey: `checkout-pi:${params.checkoutId}` },
		);
		return pi.id;
	} catch (err) {
		if (err instanceof Stripe.errors.StripeError) {
			logger.error(
				{ err, checkoutId: params.checkoutId },
				"stripe.paymentIntents.create failed",
			);
			throw new ServiceError(
				502,
				"Il pagamento online non è disponibile in questo momento. Riprova tra qualche minuto.",
			);
		}
		throw err;
	}
}

/**
 * Il client secret per il Payment Element, riletto da Stripe (non si salva):
 * null se il PI non è più pagabile (riuscito, in elaborazione o annullato).
 */
export async function payableClientSecret(
	paymentIntentId: string,
): Promise<string | null> {
	const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
	return PAYABLE.includes(pi.status) ? pi.client_secret : null;
}
```

- [ ] **Step 5: `createCheckout` e `getCheckout`**

In `apps/api/src/modules/customer/services/checkout.ts`:
- import `toCents`, `fromCents` da `@/lib/money`; `createCheckoutPaymentIntent`, `payableClientSecret` da `@/modules/billing/services/order-payments`.
- in `createCheckout`, prima del `for (const choice of stores)`: `let amountDueCents = 0;`
- sostituisci `await placeOrder(tx, …, { checkoutId: row.id });` con `const placed = await placeOrder(tx, …, { checkoutId: row.id });` e subito dopo:

```ts
				if (placed.type === "pay_pickup") amountDueCents += toCents(placed.total);
```

- dopo il `for`, prima di `return row.id;`:

```ts
			// Un solo pagamento per tutti i negozi PR2 del checkout. Dentro la tx:
			// se Stripe fallisce (502) non nasce nessun ordine e il carrello resta.
			if (amountDueCents > 0) {
				const paymentIntentId = await createCheckoutPaymentIntent({
					checkoutId: row.id,
					customerProfileId,
					amountCents: amountDueCents,
				});
				await tx
					.update(checkout)
					.set({
						stripePaymentIntentId: paymentIntentId,
						amountDueOnline: fromCents(amountDueCents),
					})
					.where(eq(checkout.id, row.id));
			}
```

- in `getCheckout`, sostituisci il `return`:

```ts
	// Il Payment Element serve finché resta un PR2 da pagare; il secret si
	// rilegge da Stripe così refresh e ritorno dal 3DS funzionano.
	const awaitingPayment = data.some(
		(o) => o.type === "pay_pickup" && o.status === "pending",
	);
	const clientSecret =
		awaitingPayment && found.stripePaymentIntentId
			? await payableClientSecret(found.stripePaymentIntentId)
			: null;
	return {
		id: found.id,
		createdAt: found.createdAt,
		amountDueOnline: found.amountDueOnline,
		payment: clientSecret ? { clientSecret } : null,
		orders: data,
	};
```

- aggiorna il JSDoc di `createCheckout`: «PR2 nasce pending; il PaymentIntent unico copre la somma dei PR2».

- [ ] **Step 6: `CheckoutSchema`**

In `apps/api/src/lib/schemas/composed.ts`:

```ts
export const CheckoutSchema = t.Object({
	id: t.String(),
	createdAt: t.Date(),
	amountDueOnline: t.String({
		description: "Importo da pagare online (somma degli ordini Paga e ritira)",
	}),
	payment: t.Nullable(
		t.Object(
			{ clientSecret: t.String({ description: "Per il Payment Element di Stripe" }) },
			{
				description:
					"Presente finché c'è un ordine Paga e ritira in attesa di pagamento e il pagamento è ancora possibile",
			},
		),
	),
	orders: t.Array(CustomerOrderWithRelationsSchema),
});
```

In `routes/checkout.ts` aggiungi `amountDueOnline: data.amountDueOnline` al log `checkout_created`, e nella `description` della POST: «Con ordini Paga e ritira crea un unico pagamento: la risposta porta `payment.clientSecret`. 502 se il pagamento online non è disponibile.»

- [ ] **Step 7: Rimuovi `ONLINE_PAYMENT_LIVE`**

`apps/api/src/lib/order-types.ts`: elimina il commento e la costante `ONLINE_PAYMENT_LIVE`; `offeredOrderTypes` diventa:

```ts
/**
 * Unica regola su cosa si offre al checkout: la usano il carrello (per mostrare
 * la scelta), il checkout (per validarla) e il seller (per mostrare cosa vede il
 * cliente), così non possono divergere. PR2 richiede il conto Connect abilitato
 * a ricevere i trasferimenti.
 */
export function offeredOrderTypes(
	configured: readonly string[],
	opts: { chargesEnabled: boolean },
): StoreOrderType[] {
	return storeOrderTypes.filter(
		(t) => configured.includes(t) && (t !== "pay_pickup" || opts.chargesEnabled),
	);
}
```

Run: `grep -rn "ONLINE_PAYMENT_LIVE\|live:" apps/api/src apps/seller/src` → nessun risultato in `src` dopo le modifiche (il commento seller lo sistema il Task 8).

- [ ] **Step 8: Adegua i test che pinnavano il flag**

`tests/lib/order-types.test.ts`: togli l'import di `ONLINE_PAYMENT_LIVE` e ogni `live: true`; sostituisci il test «finché la PR F non accende…» con:

```ts
	it("pay_pickup si offre con incassi abilitati", () => {
		expect(offeredOrderTypes(both, { chargesEnabled: true })).toEqual(both);
		expect(offeredOrderTypes(both, { chargesEnabled: false })).toEqual([
			"reserve_pickup",
		]);
	});
```

(e nel test «offre pay_pickup solo con incassi abilitati…» rinomina in «senza incassi abilitati pay_pickup non si offre», tenendo i due casi `chargesEnabled: false`).

`tests/integration/seller-store-order-types.test.ts`:
- riga 73: `offeredOrderTypes: ["reserve_pickup", "pay_pickup"],` (togli il commento).
- test di riga 110: rinomina in `"solo pay_pickup con conto abilitato è permesso"` e asserisci `(await updateStoreOrderTypes({ ...s, orderTypes: ["pay_pickup"] })).offeredOrderTypes` `toEqual(["pay_pickup"])`.
- aggiungi subito dopo:

```ts
	it("deve restare almeno una tipologia offerta: solo pay_pickup a conto disabilitato → 400", async () => {
		const s = await setup({
			chargesEnabled: false,
			orderTypes: ["reserve_pickup", "pay_pickup"],
		});
		await expect(
			updateStoreOrderTypes({ ...s, orderTypes: ["pay_pickup"] }),
		).rejects.toMatchObject({ status: 400 });
	});
```

`tests/integration/customer-cart.test.ts:339-340`: commento «conto abilitato: pay_pickup si offre» e `toEqual(["reserve_pickup", "pay_pickup"])`; test di riga 343 rinominato «conto non abilitato: pay_pickup non si offre» (asserzione invariata).

`tests/integration/customer-checkout.test.ts:232`: il test «rifiuta un tipo non offerto (pay_pickup) con 400» ora deve usare `chargesEnabled: false` nell'insert di `paymentMethod` (con conto abilitato il tipo è offerto e chiamerebbe Stripe). Rinominalo «rifiuta pay_pickup con conto non abilitato (400)».

- [ ] **Step 9: Verifica GREEN**

Run: `bun test --cwd apps/api tests/integration/customer-checkout-pay.test.ts tests/integration/customer-checkout.test.ts tests/integration/customer-cart.test.ts tests/integration/seller-store-order-types.test.ts tests/lib/order-types.test.ts --timeout 180000 && bun run --cwd apps/api typecheck`
Expected: PASS, typecheck verde.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src apps/api/tests
git commit -m "feat(orders): un solo PaymentIntent per i Paga e ritira del checkout, PR2 offerto ai clienti"
```

---

### Task 4: Webhook `payment_intent.*` — conferma, trasferimenti, rimborsi tardivi

**Files:**
- Modify: `apps/api/src/modules/billing/services/order-payments.ts` (+ `settleCheckoutPayment`)
- Create: `apps/api/src/modules/webhooks/services/handlers/payment-intent.ts`
- Modify: `apps/api/src/modules/webhooks/services/dispatcher.ts` (switch piattaforma)
- Create: `apps/api/src/lib/jobs/expire-unpaid-orders.ts` (solo `cancelUnpaidOrder` qui; lo sweep nel Task 5)
- Create: `apps/api/tests/integration/stripe-webhook-payment-intent.test.ts`

**Interfaces:**
- Consumes: colonne Task 1; `checkout.stripePaymentIntentId` (Task 3); `refundStockAndPoints` (`lib/order-helpers.ts`).
- Produces:
  - `settleCheckoutPayment(pi: Pick<Stripe.PaymentIntent, "id" | "latest_charge">): Promise<void>`
  - `cancelUnpaidOrder(orderId: string): Promise<boolean>` (CAS `pending → cancelled` + restock)
  - `handlePaymentIntentEvent(event: Stripe.Event): Promise<void>`

- [ ] **Step 1: Test RED**

`apps/api/tests/integration/stripe-webhook-payment-intent.test.ts`:

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
const constructEventAsync = mock(async () => currentEvent);
let transferSeq = 0;
const transfersCreate = mock(async (p: any, _o?: any) => ({
	id: `tr_${++transferSeq}`,
	amount: p.amount,
}));
const refundsCreate = mock(async (_p: any, _o?: any) => ({ id: "re_LATE" }));

mock.module("@/lib/stripe", () => ({
	stripe: {
		webhooks: { constructEventAsync },
		transfers: { create: transfersCreate },
		refunds: { create: refundsCreate },
	},
}));
mock.module("@/lib/env", () => ({
	env: {
		STRIPE_SECRET_KEY: "sk_test_FAKE",
		STRIPE_WEBHOOK_SECRET: "whsec_PLATFORM",
	},
}));

import { eq } from "drizzle-orm";
import { checkout } from "@/db/schemas/checkout";
import { order, orderItem } from "@/db/schemas/order";
import { storeProduct } from "@/db/schemas/product";
import { handleStripeWebhook } from "@/modules/webhooks/services/dispatcher";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCustomer,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
	enableOnlinePayments,
} from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
	transfersCreate.mockClear();
	refundsCreate.mockClear();
	transferSeq = 0;
});

/** Checkout pagato online con due negozi di due seller diversi. */
async function seedPaidCheckout() {
	const db = getTestDb();
	const customer = await createTestCustomer(db);
	const [co] = await db
		.insert(checkout)
		.values({
			customerProfileId: customer.profile.id,
			idempotencyKey: crypto.randomUUID(),
			stripePaymentIntentId: "pi_1",
			amountDueOnline: "30.00",
		})
		.returning();
	const orders = [];
	for (const [i, total, fee] of [
		[1, "10.00", "0.50"],
		[2, "20.00", "1.00"],
	] as const) {
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		await enableOnlinePayments(db, {
			sellerProfileId: seller.profile.id,
			storeId: store.id,
			accountId: `acct_${i}`,
		});
		const product = await createTestProduct(db, seller.profile.id);
		const sp = await createTestStoreProduct(db, store.id, product.id, {
			stock: 4,
		});
		const [o] = await db
			.insert(order)
			.values({
				customerProfileId: customer.profile.id,
				storeId: store.id,
				type: "pay_pickup",
				status: "pending",
				total,
				platformFee: fee,
				checkoutId: co.id,
				paymentExpiresAt: new Date(Date.now() + 60_000),
			})
			.returning();
		await db.insert(orderItem).values({
			orderId: o.id,
			productName: "P",
			productId: product.id,
			storeProductId: sp.id,
			quantity: 1,
			unitPrice: total,
		});
		orders.push({ order: o, sp });
	}
	return { co, orders };
}

function piEvent(id: string, type: string, extra: Record<string, unknown> = {}) {
	return {
		id,
		type,
		data: {
			object: { id: "pi_1", object: "payment_intent", latest_charge: "ch_1", ...extra },
		},
	};
}

async function deliver(event: any) {
	currentEvent = event;
	await handleStripeWebhook({ payload: "{}", signature: "sig" });
}

async function reload(id: string) {
	const [r] = await getTestDb().select().from(order).where(eq(order.id, id));
	return r;
}

describe("payment_intent.succeeded", () => {
	it("conferma ogni PR2 del checkout e trasferisce totale − commissione al conto del negozio", async () => {
		const { co, orders } = await seedPaidCheckout();
		await deliver(piEvent("evt_ok", "payment_intent.succeeded"));

		for (const { order: o } of orders)
			expect((await reload(o.id)).status).toBe("confirmed");
		expect(transfersCreate).toHaveBeenCalledTimes(2);
		const calls = transfersCreate.mock.calls.map(([p, opts]) => ({ p, opts }));
		expect(calls).toContainEqual({
			p: expect.objectContaining({
				amount: 950,
				currency: "eur",
				destination: "acct_1",
				source_transaction: "ch_1",
				transfer_group: co.id,
			}),
			opts: { idempotencyKey: `transfer:${orders[0].order.id}` },
		});
		expect(calls).toContainEqual({
			p: expect.objectContaining({ amount: 1900, destination: "acct_2" }),
			opts: { idempotencyKey: `transfer:${orders[1].order.id}` },
		});
		expect((await reload(orders[0].order.id)).stripeTransferId).toMatch(/^tr_/);
	});

	it("evento doppio (stesso id) → un solo trasferimento per ordine", async () => {
		const { orders } = await seedPaidCheckout();
		await deliver(piEvent("evt_dup", "payment_intent.succeeded"));
		await deliver(piEvent("evt_dup", "payment_intent.succeeded"));
		expect(transfersCreate).toHaveBeenCalledTimes(2);
		expect((await reload(orders[1].order.id)).status).toBe("confirmed");
	});

	it("trasferimento fallito → 5xx, alla riconsegna si ritenta solo quello mancante", async () => {
		const { orders } = await seedPaidCheckout();
		transfersCreate.mockImplementationOnce(async () => {
			throw new Error("account disabled");
		});
		await expect(
			deliver(piEvent("evt_retry", "payment_intent.succeeded")),
		).rejects.toThrow();
		// Uno dei due è passato, l'altro no; entrambi confermati.
		const after1 = await Promise.all(orders.map((o) => reload(o.order.id)));
		expect(after1.every((o) => o.status === "confirmed")).toBe(true);
		expect(after1.filter((o) => o.stripeTransferId).length).toBe(1);

		transfersCreate.mockClear();
		await deliver(piEvent("evt_retry", "payment_intent.succeeded"));
		expect(transfersCreate).toHaveBeenCalledTimes(1);
		const after2 = await Promise.all(orders.map((o) => reload(o.order.id)));
		expect(after2.every((o) => o.stripeTransferId)).toBe(true);
	});

	it("un ordine già annullato per scadenza viene rimborsato, non trasferito", async () => {
		const { orders } = await seedPaidCheckout();
		await getTestDb()
			.update(order)
			.set({ status: "cancelled" })
			.where(eq(order.id, orders[0].order.id));

		await deliver(piEvent("evt_late", "payment_intent.succeeded"));

		expect(refundsCreate).toHaveBeenCalledTimes(1);
		expect(refundsCreate.mock.calls[0]).toEqual([
			expect.objectContaining({ payment_intent: "pi_1", amount: 1000 }),
			{ idempotencyKey: `refund:${orders[0].order.id}` },
		]);
		const late = await reload(orders[0].order.id);
		expect(late.status).toBe("cancelled");
		expect(late.stripeRefundId).toBe("re_LATE");
		expect(late.stripeTransferId).toBeNull();
		expect(transfersCreate).toHaveBeenCalledTimes(1); // solo l'altro
	});

	it("PI sconosciuto → ignorato senza errori", async () => {
		await seedPaidCheckout();
		await deliver({
			...piEvent("evt_x", "payment_intent.succeeded"),
			data: { object: { id: "pi_OTHER", latest_charge: "ch_9" } },
		});
		expect(transfersCreate).not.toHaveBeenCalled();
	});
});

describe("payment_intent.payment_failed / canceled", () => {
	it("pagamento rifiutato: gli ordini restano pending (il cliente può riprovare)", async () => {
		const { orders } = await seedPaidCheckout();
		await deliver(piEvent("evt_fail", "payment_intent.payment_failed"));
		for (const { order: o } of orders)
			expect((await reload(o.id)).status).toBe("pending");
	});

	it("PI annullato: PR2 pending → cancelled con restock", async () => {
		const { orders } = await seedPaidCheckout();
		await deliver(piEvent("evt_cancel", "payment_intent.canceled"));
		for (const { order: o, sp } of orders) {
			expect((await reload(o.id)).status).toBe("cancelled");
			const [row] = await getTestDb()
				.select()
				.from(storeProduct)
				.where(eq(storeProduct.id, sp.id));
			expect(row.stock).toBe(5);
		}
	});
});
```

- [ ] **Step 2: Verifica RED**

Run: `bun test --cwd apps/api tests/integration/stripe-webhook-payment-intent.test.ts --timeout 180000`
Expected: FAIL — gli ordini restano `pending` («Stripe event received but not handled»).

- [ ] **Step 3: `cancelUnpaidOrder`**

`apps/api/src/lib/jobs/expire-unpaid-orders.ts`:

```ts
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { order } from "@/db/schemas/order";
import { refundStockAndPoints } from "@/lib/order-helpers";

/**
 * Annulla un ordine pay_* mai pagato e restituisce lo stock. CAS sullo stato:
 * se nel frattempo il pagamento l'ha confermato (o un altro sweep l'ha già
 * annullato), non fa nulla.
 */
export async function cancelUnpaidOrder(orderId: string): Promise<boolean> {
	return db.transaction(async (tx) => {
		const [claimed] = await tx
			.update(order)
			.set({ status: "cancelled" })
			.where(
				and(
					eq(order.id, orderId),
					eq(order.status, "pending"),
					inArray(order.type, ["pay_pickup", "pay_deliver"]),
				),
			)
			.returning();
		if (!claimed) return false;
		const items = await tx.query.orderItem.findMany({
			where: (i, { eq }) => eq(i.orderId, orderId),
		});
		await refundStockAndPoints(tx, { ...claimed, items });
		return true;
	});
}
```

- [ ] **Step 4: `settleCheckoutPayment`**

In `order-payments.ts` aggiungi gli import `and, eq, inArray, isNull` da `drizzle-orm`, `db`, `checkout`, `order`, `paymentMethod`, `store`, `toCents`, e:

```ts
const PAID_STATUSES = ["confirmed", "ready_for_pickup", "completed"] as const;

/**
 * payment_intent.succeeded (o il cron che trova il PI riuscito). Rieseguibile:
 * 1. CAS pending → confirmed di tutti i PR2 del checkout;
 * 2. i PR2 già annullati (scaduti mentre il cliente pagava) si rimborsano;
 * 3. un trasferimento per ogni PR2 pagato senza stripe_transfer_id, con key per
 *    ordine: un evento riconsegnato non trasferisce due volte. Se un
 *    trasferimento fallisce gli altri proseguono, poi si lancia: il webhook
 *    risponde 5xx e Stripe riconsegna, e si ritenta solo ciò che manca.
 */
export async function settleCheckoutPayment(
	pi: Pick<Stripe.PaymentIntent, "id" | "latest_charge">,
): Promise<void> {
	const co = await db.query.checkout.findFirst({
		where: eq(checkout.stripePaymentIntentId, pi.id),
		columns: { id: true },
	});
	if (!co) {
		logger.warn({ paymentIntentId: pi.id }, "PaymentIntent senza checkout, ignorato");
		return;
	}
	const chargeId =
		typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;
	if (!chargeId) throw new Error(`PaymentIntent ${pi.id} riuscito senza charge`);

	const ofCheckout = and(eq(order.checkoutId, co.id), eq(order.type, "pay_pickup"));

	await db
		.update(order)
		.set({ status: "confirmed" })
		.where(and(ofCheckout, eq(order.status, "pending")));

	const late = await db
		.select({ id: order.id, total: order.total })
		.from(order)
		.where(and(ofCheckout, eq(order.status, "cancelled"), isNull(order.stripeRefundId)));
	for (const o of late) {
		const refund = await stripe.refunds.create(
			{
				payment_intent: pi.id,
				amount: toCents(o.total),
				metadata: { orderId: o.id, reason: "paid_after_expiry" },
			},
			{ idempotencyKey: `refund:${o.id}` },
		);
		await db
			.update(order)
			.set({ stripeRefundId: refund.id })
			.where(and(eq(order.id, o.id), isNull(order.stripeRefundId)));
		logger.warn({ orderId: o.id, refundId: refund.id }, "Pagato dopo la scadenza: rimborsato");
	}

	const payable = await db
		.select({
			id: order.id,
			total: order.total,
			platformFee: order.platformFee,
			destination: paymentMethod.stripeAccountId,
		})
		.from(order)
		.innerJoin(store, eq(store.id, order.storeId))
		.leftJoin(
			paymentMethod,
			and(
				eq(paymentMethod.sellerProfileId, store.sellerProfileId),
				eq(paymentMethod.isDefault, true),
			),
		)
		.where(
			and(ofCheckout, inArray(order.status, [...PAID_STATUSES]), isNull(order.stripeTransferId)),
		);

	const failed: string[] = [];
	for (const o of payable) {
		const amount = toCents(o.total) - toCents(o.platformFee);
		if (amount <= 0) continue;
		if (!o.destination) {
			logger.error({ orderId: o.id }, "Trasferimento impossibile: negozio senza conto Connect");
			failed.push(o.id);
			continue;
		}
		try {
			const transfer = await stripe.transfers.create(
				{
					amount,
					currency: "eur",
					destination: o.destination,
					source_transaction: chargeId,
					transfer_group: co.id,
					metadata: { orderId: o.id, checkoutId: co.id },
				},
				{ idempotencyKey: `transfer:${o.id}` },
			);
			await db
				.update(order)
				.set({ stripeTransferId: transfer.id })
				.where(and(eq(order.id, o.id), isNull(order.stripeTransferId)));
		} catch (err) {
			logger.error({ err, orderId: o.id }, "stripe.transfers.create failed");
			failed.push(o.id);
		}
	}
	if (failed.length > 0)
		throw new Error(`Trasferimenti non riusciti per gli ordini ${failed.join(", ")}`);
}
```

- [ ] **Step 5: Handler e dispatcher**

`apps/api/src/modules/webhooks/services/handlers/payment-intent.ts`:

```ts
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { checkout } from "@/db/schemas/checkout";
import { order } from "@/db/schemas/order";
import { cancelUnpaidOrder } from "@/lib/jobs/expire-unpaid-orders";
import { logger } from "@/lib/logger";
import { settleCheckoutPayment } from "@/modules/billing/services/order-payments";

/**
 * Pagamento dei PR2 di un checkout. Un rifiuto della carta NON annulla gli
 * ordini: il PI torna in requires_payment_method e il cliente può riprovare
 * finché non scade la finestra di pagamento (cron expireUnpaidOrders).
 */
export async function handlePaymentIntentEvent(event: Stripe.Event): Promise<void> {
	const pi = event.data.object as Stripe.PaymentIntent;
	switch (event.type) {
		case "payment_intent.succeeded":
			return settleCheckoutPayment(pi);
		case "payment_intent.canceled": {
			const co = await db.query.checkout.findFirst({
				where: eq(checkout.stripePaymentIntentId, pi.id),
				columns: { id: true },
			});
			if (!co) return;
			const pending = await db
				.select({ id: order.id })
				.from(order)
				.where(eq(order.checkoutId, co.id));
			for (const o of pending) await cancelUnpaidOrder(o.id);
			return;
		}
		default:
			logger.info(
				{ eventId: event.id, type: event.type, paymentIntentId: pi.id },
				"PaymentIntent event: nessuna azione",
			);
	}
}
```

In `dispatcher.ts`: import `handlePaymentIntentEvent`; nello switch piattaforma, prima di `default`:

```ts
		case "payment_intent.succeeded":
		case "payment_intent.payment_failed":
		case "payment_intent.canceled":
			return handlePaymentIntentEvent(event);
```

- [ ] **Step 6: Verifica GREEN**

Run: `bun test --cwd apps/api tests/integration/stripe-webhook-payment-intent.test.ts tests/integration/stripe-webhook-scaffold.test.ts tests/integration/stripe-webhook-reprocessing.test.ts --timeout 180000 && bun run --cwd apps/api typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src apps/api/tests/integration/stripe-webhook-payment-intent.test.ts
git commit -m "feat(orders): conferma dei Paga e ritira e trasferimenti ai negozi dal webhook di pagamento"
```

---

### Task 5: Cron — i PR2 non pagati scadono dopo 30 minuti

**Files:**
- Modify: `apps/api/src/lib/jobs/expire-unpaid-orders.ts` (+ `expireUnpaidOrders`)
- Modify: `apps/api/src/plugins/cron.ts`
- Create: `apps/api/tests/integration/job-expire-unpaid-orders.test.ts`

**Interfaces:**
- Consumes: `cancelUnpaidOrder` (Task 4), `settleCheckoutPayment` (Task 4), indice `order_unpaid_expiry_idx` (Task 1).
- Produces: `expireUnpaidOrders(now?: Date): Promise<number>` (ordini annullati).

- [ ] **Step 1: Test RED**

`apps/api/tests/integration/job-expire-unpaid-orders.test.ts`:

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

let piStatus = "requires_payment_method";
const paymentIntentsRetrieve = mock(async (id: string) => ({
	id,
	status: piStatus,
	latest_charge: "ch_1",
}));
const paymentIntentsCancel = mock(async (id: string) => ({ id, status: "canceled" }));
const transfersCreate = mock(async (p: any) => ({ id: "tr_1", amount: p.amount }));

mock.module("@/lib/stripe", () => ({
	stripe: {
		paymentIntents: { retrieve: paymentIntentsRetrieve, cancel: paymentIntentsCancel },
		transfers: { create: transfersCreate },
		refunds: { create: mock(async () => ({ id: "re_1" })) },
	},
}));

import { eq } from "drizzle-orm";
import { checkout } from "@/db/schemas/checkout";
import { order, orderItem } from "@/db/schemas/order";
import { storeProduct } from "@/db/schemas/product";
import { expireUnpaidOrders } from "@/lib/jobs/expire-unpaid-orders";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCustomer,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
	enableOnlinePayments,
} from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
	piStatus = "requires_payment_method";
	paymentIntentsRetrieve.mockClear();
	paymentIntentsCancel.mockClear();
	transfersCreate.mockClear();
});

async function seedPending(expiresInMs: number, withPi = true) {
	const db = getTestDb();
	const customer = await createTestCustomer(db);
	const seller = await createTestSeller(db);
	const store = await createTestStore(db, seller.profile.id);
	await enableOnlinePayments(db, { sellerProfileId: seller.profile.id, storeId: store.id });
	const product = await createTestProduct(db, seller.profile.id);
	const sp = await createTestStoreProduct(db, store.id, product.id, { stock: 2 });
	const [co] = await db
		.insert(checkout)
		.values({
			customerProfileId: customer.profile.id,
			idempotencyKey: crypto.randomUUID(),
			stripePaymentIntentId: withPi ? `pi_${crypto.randomUUID()}` : null,
			amountDueOnline: "10.00",
		})
		.returning();
	const [o] = await db
		.insert(order)
		.values({
			customerProfileId: customer.profile.id,
			storeId: store.id,
			type: "pay_pickup",
			status: "pending",
			total: "10.00",
			platformFee: "0.50",
			checkoutId: co.id,
			paymentExpiresAt: new Date(Date.now() + expiresInMs),
		})
		.returning();
	await db.insert(orderItem).values({
		orderId: o.id,
		productName: "P",
		productId: product.id,
		storeProductId: sp.id,
		quantity: 1,
		unitPrice: "10.00",
	});
	return { order: o, sp, co };
}

const statusOf = async (id: string) =>
	(await getTestDb().select().from(order).where(eq(order.id, id)))[0].status;
const stockOf = async (id: string) =>
	(await getTestDb().select().from(storeProduct).where(eq(storeProduct.id, id)))[0].stock;

describe("expireUnpaidOrders", () => {
	it("scaduto e non pagato: annulla il PI, poi l'ordine, e restituisce lo stock", async () => {
		const s = await seedPending(-1000);
		expect(await expireUnpaidOrders()).toBe(1);
		expect(paymentIntentsCancel).toHaveBeenCalledWith(s.co.stripePaymentIntentId);
		expect(await statusOf(s.order.id)).toBe("cancelled");
		expect(await stockOf(s.sp.id)).toBe(3);
	});

	it("non ancora scaduto: nessuna azione", async () => {
		const s = await seedPending(60_000);
		expect(await expireUnpaidOrders()).toBe(0);
		expect(paymentIntentsRetrieve).not.toHaveBeenCalled();
		expect(await statusOf(s.order.id)).toBe("pending");
	});

	it("PI riuscito all'ultimo secondo: conferma e trasferisce invece di annullare", async () => {
		const s = await seedPending(-1000);
		piStatus = "succeeded";
		expect(await expireUnpaidOrders()).toBe(0);
		expect(paymentIntentsCancel).not.toHaveBeenCalled();
		expect(await statusOf(s.order.id)).toBe("confirmed");
		expect(transfersCreate).toHaveBeenCalledTimes(1);
	});

	it("PI in elaborazione: aspetta il prossimo giro", async () => {
		const s = await seedPending(-1000);
		piStatus = "processing";
		expect(await expireUnpaidOrders()).toBe(0);
		expect(await statusOf(s.order.id)).toBe("pending");
	});

	it("annullamento del PI rifiutato da Stripe: l'ordine resta pending, gli altri checkout proseguono", async () => {
		const a = await seedPending(-1000);
		const b = await seedPending(-1000);
		paymentIntentsCancel.mockImplementationOnce(async () => {
			throw new Error("stripe down");
		});
		expect(await expireUnpaidOrders()).toBe(1);
		const statuses = [await statusOf(a.order.id), await statusOf(b.order.id)].sort();
		expect(statuses).toEqual(["cancelled", "pending"]);
	});

	it("pay_* senza PaymentIntent (dati storici): annullato direttamente", async () => {
		const s = await seedPending(-1000, false);
		expect(await expireUnpaidOrders()).toBe(1);
		expect(paymentIntentsRetrieve).not.toHaveBeenCalled();
		expect(await statusOf(s.order.id)).toBe("cancelled");
	});
});
```

- [ ] **Step 2: Verifica RED**

Run: `bun test --cwd apps/api tests/integration/job-expire-unpaid-orders.test.ts --timeout 180000`
Expected: FAIL, `expireUnpaidOrders` non esportato.

- [ ] **Step 3: `expireUnpaidOrders`**

In `apps/api/src/lib/jobs/expire-unpaid-orders.ts` aggiungi import `isNotNull`, `lt`, `checkout`, `logger`, `stripe`, `settleCheckoutPayment`, e:

```ts
/**
 * Sweep ogni minuto dei pay_* ancora pending oltre payment_expires_at. Per ogni
 * PaymentIntent rilegge lo stato PRIMA di annullare: un pagamento riuscito
 * all'ultimo secondo si conferma (settleCheckoutPayment), uno in elaborazione
 * aspetta il prossimo giro, altrimenti si annulla il PI e poi gli ordini. Un
 * errore su un checkout non ferma gli altri.
 */
export async function expireUnpaidOrders(now: Date = new Date()): Promise<number> {
	const rows = await db
		.select({ id: order.id, paymentIntentId: checkout.stripePaymentIntentId })
		.from(order)
		.leftJoin(checkout, eq(checkout.id, order.checkoutId))
		.where(
			and(
				eq(order.status, "pending"),
				isNotNull(order.paymentExpiresAt),
				lt(order.paymentExpiresAt, now),
			),
		);
	if (rows.length === 0) return 0;

	const byIntent = new Map<string | null, string[]>();
	for (const r of rows) {
		const key = r.paymentIntentId ?? null;
		byIntent.set(key, [...(byIntent.get(key) ?? []), r.id]);
	}

	let count = 0;
	for (const [paymentIntentId, orderIds] of byIntent) {
		try {
			if (paymentIntentId) {
				const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
				if (pi.status === "succeeded") {
					await settleCheckoutPayment(pi);
					continue;
				}
				if (pi.status === "processing") continue;
				if (pi.status !== "canceled")
					await stripe.paymentIntents.cancel(paymentIntentId);
			}
			for (const id of orderIds) if (await cancelUnpaidOrder(id)) count++;
		} catch (err) {
			logger.error(
				{ err, paymentIntentId, orderIds },
				"Scadenza pagamento: checkout saltato, si riprova al prossimo giro",
			);
		}
	}
	return count;
}
```

(Se `stripe.paymentIntents.cancel` fallisce con `payment_intent_unexpected_state` perché nel frattempo è riuscito, il catch salta il checkout: al giro dopo `retrieve` lo vede `succeeded` e conferma. Il webhook arriva comunque.)

- [ ] **Step 4: Cron**

In `apps/api/src/plugins/cron.ts` import `expireUnpaidOrders` e aggiungi, dopo `expireReservations`:

```ts
	.use(
		cron({
			name: "expireUnpaidOrders",
			pattern: Patterns.EVERY_MINUTE,
			async run() {
				try {
					const count = await expireUnpaidOrders();
					if (count > 0)
						logger.info({ count }, "Ordini pay_* non pagati annullati via cron");
				} catch (error) {
					logger.error({ err: error }, "Errore durante scadenza pagamenti");
				}
			},
		}),
	)
```

- [ ] **Step 5: Verifica GREEN**

Run: `bun test --cwd apps/api tests/integration/job-expire-unpaid-orders.test.ts tests/integration/stripe-webhook-payment-intent.test.ts --timeout 180000 && bun run --cwd apps/api typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/jobs/expire-unpaid-orders.ts apps/api/src/plugins/cron.ts apps/api/tests/integration/job-expire-unpaid-orders.test.ts
git commit -m "feat(orders): i Paga e ritira non pagati entro 30 minuti si annullano con restock"
```

---

### Task 6: Annullamento di un PR2 — rimborso e storno (cliente e negozio)

**Files:**
- Modify: `apps/api/src/modules/billing/services/order-payments.ts` (+ `refundOrderPayment`)
- Modify: `apps/api/src/modules/customer/services/orders.ts` (`cancelOrder`)
- Modify: `apps/api/src/modules/seller/services/orders.ts` (`cancelSellerOrder`)
- Modify: `apps/api/src/modules/customer/routes/orders.ts` (description cancel), `apps/api/src/modules/seller/routes/orders.ts:259+` (description cancel)
- Create: `apps/api/tests/integration/order-cancel-refund.test.ts`

**Interfaces:**
- Consumes: `PAY_TYPES` (Task 2), colonne Task 1.
- Produces: `refundOrderPayment(tx: Tx, o: { id: string; total: string; platformFee: string; checkoutId: string | null; stripeTransferId: string | null }): Promise<void>`; `assertCancellable(o: { status: string; type: string }): void` (esportata da `customer/services/orders.ts`, usata anche dal seller).

- [ ] **Step 1: Test RED**

`apps/api/tests/integration/order-cancel-refund.test.ts`:

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

const refundsCreate = mock(async (_p: any, _o?: any) => ({ id: "re_1" }));
const createReversal = mock(async (_id: string, _p: any, _o?: any) => ({ id: "trr_1" }));

mock.module("@/lib/stripe", () => ({
	stripe: {
		refunds: { create: refundsCreate },
		transfers: { createReversal },
	},
}));

import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { checkout } from "@/db/schemas/checkout";
import { order, orderItem } from "@/db/schemas/order";
import { storeProduct } from "@/db/schemas/product";
import { cancelOrder } from "@/modules/customer/services/orders";
import { cancelSellerOrder } from "@/modules/seller/services/orders";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCustomer,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
} from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
	refundsCreate.mockClear();
	createReversal.mockClear();
});

async function seedPr2(status: "pending" | "confirmed", transferId: string | null = "tr_1") {
	const db = getTestDb();
	const customer = await createTestCustomer(db);
	const seller = await createTestSeller(db);
	const store = await createTestStore(db, seller.profile.id);
	const product = await createTestProduct(db, seller.profile.id);
	const sp = await createTestStoreProduct(db, store.id, product.id, { stock: 1 });
	const [co] = await db
		.insert(checkout)
		.values({
			customerProfileId: customer.profile.id,
			idempotencyKey: crypto.randomUUID(),
			stripePaymentIntentId: "pi_1",
			amountDueOnline: "10.00",
		})
		.returning();
	const [o] = await db
		.insert(order)
		.values({
			customerProfileId: customer.profile.id,
			storeId: store.id,
			type: "pay_pickup",
			status,
			total: "10.00",
			platformFee: "0.50",
			checkoutId: co.id,
			stripeTransferId: status === "confirmed" ? transferId : null,
		})
		.returning();
	await db.insert(orderItem).values({
		orderId: o.id,
		productName: "P",
		productId: product.id,
		storeProductId: sp.id,
		quantity: 1,
		unitPrice: "10.00",
	});
	return { customer, store, order: o, sp };
}

const reload = async (id: string) =>
	(await getTestDb().select().from(order).where(eq(order.id, id)))[0];

describe("annullamento PR2 confermato", () => {
	it("il negozio annulla: rimborso del totale, storno di totale − commissione, restock", async () => {
		const s = await seedPr2("confirmed");
		await cancelSellerOrder({ orderId: s.order.id, storeIds: [s.store.id] });

		expect(refundsCreate.mock.calls[0]).toEqual([
			expect.objectContaining({ payment_intent: "pi_1", amount: 1000 }),
			{ idempotencyKey: `refund:${s.order.id}` },
		]);
		expect(createReversal.mock.calls[0]).toEqual([
			"tr_1",
			expect.objectContaining({ amount: 950 }),
			{ idempotencyKey: `reversal:${s.order.id}` },
		]);
		const after = await reload(s.order.id);
		expect(after.status).toBe("cancelled");
		expect(after.stripeRefundId).toBe("re_1");
		const [sp] = await getTestDb().select().from(storeProduct).where(eq(storeProduct.id, s.sp.id));
		expect(sp.stock).toBe(2);
	});

	it("il cliente annulla: stesso rimborso", async () => {
		const s = await seedPr2("confirmed");
		await cancelOrder({ orderId: s.order.id, customerProfileId: s.customer.profile.id });
		expect(refundsCreate).toHaveBeenCalledTimes(1);
		expect((await reload(s.order.id)).status).toBe("cancelled");
	});

	it("trasferimento non ancora partito: rimborso senza storno", async () => {
		const s = await seedPr2("confirmed", null);
		await cancelSellerOrder({ orderId: s.order.id, storeIds: [s.store.id] });
		expect(refundsCreate).toHaveBeenCalledTimes(1);
		expect(createReversal).not.toHaveBeenCalled();
	});

	it("storno rifiutato (il seller ha già incassato): il cliente è rimborsato lo stesso", async () => {
		const s = await seedPr2("confirmed");
		createReversal.mockImplementationOnce(async () => {
			throw new Stripe.errors.StripeInvalidRequestError({
				message: "insufficient funds",
				type: "invalid_request_error",
			} as any);
		});
		await cancelSellerOrder({ orderId: s.order.id, storeIds: [s.store.id] });
		const after = await reload(s.order.id);
		expect(after.status).toBe("cancelled");
		expect(after.stripeRefundId).toBe("re_1");
	});

	it("rimborso fallito: 502 e l'ordine resta confermato, stock invariato", async () => {
		const s = await seedPr2("confirmed");
		refundsCreate.mockImplementationOnce(async () => {
			throw new Stripe.errors.StripeAPIError({ message: "down", type: "api_error" } as any);
		});
		await expect(
			cancelSellerOrder({ orderId: s.order.id, storeIds: [s.store.id] }),
		).rejects.toMatchObject({ status: 502 });
		expect((await reload(s.order.id)).status).toBe("confirmed");
		const [sp] = await getTestDb().select().from(storeProduct).where(eq(storeProduct.id, s.sp.id));
		expect(sp.stock).toBe(1);
	});

	it("cliente e negozio annullano insieme: un solo rimborso, il secondo è 409", async () => {
		const s = await seedPr2("confirmed");
		const results = await Promise.allSettled([
			cancelSellerOrder({ orderId: s.order.id, storeIds: [s.store.id] }),
			cancelOrder({ orderId: s.order.id, customerProfileId: s.customer.profile.id }),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(refundsCreate).toHaveBeenCalledTimes(1);
	});
});

describe("annullamento PR2 in attesa di pagamento", () => {
	it("vietato al negozio e al cliente (409), niente rimborsi", async () => {
		const s = await seedPr2("pending");
		await expect(
			cancelSellerOrder({ orderId: s.order.id, storeIds: [s.store.id] }),
		).rejects.toMatchObject({ status: 409 });
		await expect(
			cancelOrder({ orderId: s.order.id, customerProfileId: s.customer.profile.id }),
		).rejects.toMatchObject({ status: 409 });
		expect(refundsCreate).not.toHaveBeenCalled();
		expect((await reload(s.order.id)).status).toBe("pending");
	});
});
```

(Nota su «annullano insieme»: l'harness testcontainer serializza le transazioni (memoria), quindi il test è deterministico per sequenza: il secondo trova lo stato cambiato → 409. Non è un test di concorrenza reale, è la verifica del CAS.)

- [ ] **Step 2: Verifica RED**

Run: `bun test --cwd apps/api tests/integration/order-cancel-refund.test.ts --timeout 180000`
Expected: FAIL — nessun rimborso chiamato; il `pending` si annulla.

- [ ] **Step 3: `refundOrderPayment`**

In `order-payments.ts`:

```ts
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Rimborso di un PR2 pagato, dentro la tx di annullamento (dopo il CAS di
 * stato): se il rimborso fallisce la tx si annulla e l'ordine resta com'era.
 * Lo storno del trasferimento è best-effort: se il negozio ha già incassato e
 * non ha saldo, Stripe lo rifiuta, ma il cliente è già rimborsato; resta nel
 * log per il recupero manuale.
 */
export async function refundOrderPayment(
	tx: Tx,
	o: {
		id: string;
		total: string;
		platformFee: string;
		checkoutId: string | null;
		stripeTransferId: string | null;
	},
): Promise<void> {
	const co = o.checkoutId
		? await tx.query.checkout.findFirst({
				where: eq(checkout.id, o.checkoutId),
				columns: { stripePaymentIntentId: true },
			})
		: undefined;
	if (!co?.stripePaymentIntentId)
		throw new ServiceError(409, "Pagamento dell'ordine non trovato");

	let refundId: string;
	try {
		const refund = await stripe.refunds.create(
			{
				payment_intent: co.stripePaymentIntentId,
				amount: toCents(o.total),
				metadata: { orderId: o.id },
			},
			{ idempotencyKey: `refund:${o.id}` },
		);
		refundId = refund.id;
	} catch (err) {
		if (err instanceof Stripe.errors.StripeError) {
			logger.error({ err, orderId: o.id }, "stripe.refunds.create failed");
			throw new ServiceError(502, "Rimborso non riuscito. Riprova tra qualche minuto.");
		}
		throw err;
	}
	await tx.update(order).set({ stripeRefundId: refundId }).where(eq(order.id, o.id));

	if (o.stripeTransferId) {
		try {
			await stripe.transfers.createReversal(
				o.stripeTransferId,
				{ amount: toCents(o.total) - toCents(o.platformFee), metadata: { orderId: o.id } },
				{ idempotencyKey: `reversal:${o.id}` },
			);
		} catch (err) {
			logger.error(
				{ err, orderId: o.id, transferId: o.stripeTransferId },
				"Storno del trasferimento non riuscito: recupero manuale",
			);
		}
	}
}
```

- [ ] **Step 4: Regola condivisa e `cancelOrder` cliente**

In `customer/services/orders.ts`, dopo `PAY_TYPES`:

```ts
/**
 * Un pay_* in attesa di pagamento non si annulla a mano: il PaymentIntent copre
 * tutti i negozi del checkout, e l'ordine si annulla da solo allo scadere della
 * finestra di pagamento. Poi valgono le transizioni della macchina a stati.
 */
export function assertCancellable(o: { status: string; type: string }) {
	if (o.status === "pending" && PAY_TYPES.includes(o.type as OrderType))
		throw new ServiceError(
			409,
			"L'ordine è in attesa di pagamento: se non viene pagato si annulla da solo entro 30 minuti",
		);
	assertTransition(o.status as OrderStatus, "cancelled", o.type as OrderType);
}
```

In `cancelOrder`: sostituisci la chiamata `assertTransition(...)` con `assertCancellable(existing);`, e tra il CAS e `refundStockAndPoints`:

```ts
		if (existing.type === "pay_pickup" && existing.status === "confirmed")
			await refundOrderPayment(tx, existing);
```

(import `refundOrderPayment` da `@/modules/billing/services/order-payments`).

- [ ] **Step 5: `cancelSellerOrder`**

In `seller/services/orders.ts`: import `assertCancellable` da `@/modules/customer/services/orders` e `refundOrderPayment`; sostituisci `assertTransition(...)` con `assertCancellable(existing);` e aggiungi lo stesso blocco `refundOrderPayment` tra CAS e `refundStockAndPoints`. Aggiorna il JSDoc: «Da `confirmed`: con un PR2 rimborsa il pagamento e storna il trasferimento nella stessa tx. Un PR2 `pending` non si annulla (409).» Rimuovi l'import di `assertTransition` se resta inutilizzato (`noUnusedLocals`).

- [ ] **Step 6: Descrizioni OpenAPI**

- `POST /customer/orders/:orderId/cancel`: «Annulla un ordine. Lo stock torna disponibile e i punti spesi vengono restituiti; un ordine pagato online viene rimborsato. 409 se è in attesa di pagamento.»
- `PATCH /seller/orders/:orderId/cancel`: stessa frase lato negozio.

- [ ] **Step 7: Verifica GREEN (+ regressioni annullamento)**

Run: `bun test --cwd apps/api tests/integration/order-cancel-refund.test.ts tests/integration/seller-orders.test.ts tests/integration/seller-orders-routes.test.ts tests/integration/customer-orders.test.ts --timeout 180000 && bun run --cwd apps/api typecheck`
Expected: PASS. (`seller-orders.test.ts:268+` annulla `reserve_pickup`: nessuna chiamata Stripe.)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src apps/api/tests/integration/order-cancel-refund.test.ts
git commit -m "feat(orders): annullare un Paga e ritira pagato rimborsa il cliente e storna il negozio"
```

---

### Task 7: Customer FE — pagamento con Payment Element e stato del pagamento

**Files:**
- Modify: `apps/customer/package.json` (deps), `bun.lock` (via `bun add`)
- Modify: `apps/customer/src/env.ts`, `apps/customer/.env.example`
- Create: `apps/customer/src/features/checkout/stripe.ts`
- Create: `apps/customer/src/features/checkout/pay-form.tsx`
- Create: `apps/customer/src/features/checkout/payment-state.ts` + `payment-state.test.ts`
- Create: `apps/customer/src/routes/_authenticated/checkout/$checkoutId/pay.tsx`
- Modify: `apps/customer/src/routes/_authenticated/checkout/review.tsx` (redirect al pagamento)
- Modify: `apps/customer/src/routes/_authenticated/checkout/$checkoutId/index.tsx` (stati)
- Modify: `apps/customer/src/features/checkout/use-checkout.ts` (polling)
- Modify: `apps/customer/src/features/orders/order-display.ts` (`canCustomerCancel`) + `order-display.test.ts`
- Modify: `apps/customer/src/routes/_authenticated/orders/$orderId.tsx` (completa pagamento, dialog rimborso)
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json`
- Modify: `apps/customer/src/routeTree.gen.ts` (rigenerato)

**Interfaces:**
- Consumes: `CheckoutSchema.payment`, `CheckoutSchema.amountDueOnline`, `OrderSchema.paymentExpiresAt` (Task 2-3, via Eden).
- Produces: `paymentState(orders: { type: string; status: string }[]): "none" | "awaiting" | "paid" | "failed"`; `useCheckout(checkoutId, opts?: { pollWhileAwaiting?: boolean })`.

- [ ] **Step 1: Test RED delle funzioni pure**

`apps/customer/src/features/checkout/payment-state.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { paymentState } from "./payment-state";

const o = (type: string, status: string) => ({ type, status });

describe("paymentState", () => {
	it("solo prenotazioni → none", () => {
		expect(paymentState([o("reserve_pickup", "confirmed")])).toBe("none");
	});
	it("un PR2 ancora pending → awaiting", () => {
		expect(
			paymentState([o("pay_pickup", "confirmed"), o("pay_pickup", "pending")]),
		).toBe("awaiting");
	});
	it("PR2 confermati → paid, anche se poi uno è annullato dal negozio", () => {
		expect(
			paymentState([o("pay_pickup", "confirmed"), o("pay_pickup", "cancelled")]),
		).toBe("paid");
	});
	it("tutti i PR2 annullati senza pagamento → failed (le prenotazioni non contano)", () => {
		expect(
			paymentState([o("pay_pickup", "cancelled"), o("reserve_pickup", "confirmed")]),
		).toBe("failed");
	});
});
```

In `apps/customer/src/features/orders/order-display.test.ts` aggiungi:

```ts
describe("canCustomerCancel", () => {
	it("un Paga e ritira in attesa di pagamento non si annulla a mano", () => {
		expect(canCustomerCancel({ type: "pay_pickup", status: "pending" })).toBe(false);
	});
	it("un Paga e ritira confermato sì (con rimborso)", () => {
		expect(canCustomerCancel({ type: "pay_pickup", status: "confirmed" })).toBe(true);
	});
	it("una prenotazione confermata sì", () => {
		expect(canCustomerCancel({ type: "reserve_pickup", status: "confirmed" })).toBe(true);
	});
});
```

(importa `canCustomerCancel` accanto agli import esistenti del file).

- [ ] **Step 2: Verifica RED**

Run: `bun run --cwd apps/customer test src/features/checkout/payment-state.test.ts src/features/orders/order-display.test.ts`
Expected: FAIL — modulo `payment-state` mancante; `pay_pickup`/`pending` restituisce `true`.

- [ ] **Step 3: Implementa le funzioni pure**

`apps/customer/src/features/checkout/payment-state.ts`:

```ts
export type PaymentState = "none" | "awaiting" | "paid" | "failed";

/**
 * Stato del pagamento online di un checkout, letto dagli ordini dell'API (mai
 * dall'URL di ritorno di Stripe). failed = nessun PR2 è mai stato pagato: sono
 * scaduti o il pagamento è stato annullato.
 */
export function paymentState(
	orders: readonly { type: string; status: string }[],
): PaymentState {
	const pay = orders.filter((o) => o.type === "pay_pickup");
	if (pay.length === 0) return "none";
	if (pay.some((o) => o.status === "pending")) return "awaiting";
	if (pay.every((o) => o.status === "cancelled" || o.status === "expired"))
		return "failed";
	return "paid";
}
```

In `order-display.ts`, `canCustomerCancel`:

```ts
/** Rispecchia l'API: si annulla finché il negozio non ha preparato; un Paga e
 *  ritira in attesa di pagamento no (si annulla da solo). L'API resta
 *  l'autorità. */
export function canCustomerCancel(o: { status: string; type: string }) {
	if (o.type === "reserve_pickup")
		return o.status === "pending" || o.status === "confirmed";
	return o.type === "pay_pickup" && o.status === "confirmed";
}
```

Run di nuovo lo Step 2 → PASS.

- [ ] **Step 4: Dipendenze ed env**

```bash
bun add --cwd apps/customer @stripe/stripe-js@^9.17.0 @stripe/react-stripe-js@^6.12.0
```

(Aggiunta diretta in `apps/customer`, come `uqr`: nessun altro workspace li usa. Non usare `bun update`.)

`apps/customer/src/env.ts`, in `client`:

```ts
		VITE_STRIPE_PUBLISHABLE_KEY: z.string().startsWith("pk_").optional(),
```

`apps/customer/.env.example`:

```bash
# Stripe publishable key (pagamento «Paga e ritira»). Stessa modalità (test/live)
# della STRIPE_SECRET_KEY dell'API.
# VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

`apps/customer/src/features/checkout/stripe.ts`:

```ts
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { env } from "@/env";

let promise: Promise<Stripe | null> | undefined;

/** Stripe.js caricato una volta sola, solo lato client. null senza chiave. */
export function getStripe(): Promise<Stripe | null> | null {
	if (!env.VITE_STRIPE_PUBLISHABLE_KEY) return null;
	promise ??= loadStripe(env.VITE_STRIPE_PUBLISHABLE_KEY);
	return promise;
}
```

- [ ] **Step 5: Messaggi**

`apps/customer/messages/it.json` (accanto alle chiavi `checkout_*` / `orders_*`):

```json
	"checkout_pay_title": "Pagamento",
	"checkout_pay_amount": "Da pagare ora",
	"checkout_pay_submit": "Paga {amount}",
	"checkout_pay_expires": "Completa il pagamento entro le {time}: dopo, gli ordini da pagare si annullano e i prodotti tornano disponibili.",
	"checkout_pay_unavailable": "Il pagamento online non è disponibile in questo momento. Riprova tra qualche minuto.",
	"checkout_pay_failed_generic": "Pagamento non riuscito. Riprova o usa un'altra carta.",
	"checkout_done_awaiting_title": "Stiamo confermando il pagamento",
	"checkout_done_awaiting_body": "Ci vuole qualche secondo, puoi restare su questa pagina.",
	"checkout_done_back_to_pay": "Torna al pagamento",
	"checkout_done_payment_failed_title": "Pagamento non completato",
	"checkout_done_payment_failed_body": "Gli ordini da pagare online sono stati annullati e i prodotti tornano disponibili. Le prenotazioni restano valide.",
	"orders_complete_payment": "Completa il pagamento",
	"orders_cancel_paid": "Annulla ordine",
	"orders_cancel_paid_title": "Annullare l'ordine?",
	"orders_cancel_paid_description": "Ti rimborsiamo {amount} sulla carta con cui hai pagato: di solito arriva in 5-10 giorni lavorativi.",
	"orders_cancel_paid_success": "Ordine annullato, rimborso avviato",
```

`apps/customer/messages/en.json`:

```json
	"checkout_pay_title": "Payment",
	"checkout_pay_amount": "To pay now",
	"checkout_pay_submit": "Pay {amount}",
	"checkout_pay_expires": "Complete the payment by {time}: after that, unpaid orders are cancelled and the products become available again.",
	"checkout_pay_unavailable": "Online payment is not available right now. Please try again in a few minutes.",
	"checkout_pay_failed_generic": "Payment failed. Try again or use another card.",
	"checkout_done_awaiting_title": "Confirming your payment",
	"checkout_done_awaiting_body": "It takes a few seconds, you can stay on this page.",
	"checkout_done_back_to_pay": "Back to payment",
	"checkout_done_payment_failed_title": "Payment not completed",
	"checkout_done_payment_failed_body": "The orders to pay online have been cancelled and the products are available again. Your reservations are still valid.",
	"orders_complete_payment": "Complete payment",
	"orders_cancel_paid": "Cancel order",
	"orders_cancel_paid_title": "Cancel the order?",
	"orders_cancel_paid_description": "We'll refund {amount} to the card you paid with: it usually takes 5-10 business days.",
	"orders_cancel_paid_success": "Order cancelled, refund started",
```

- [ ] **Step 6: Polling in `useCheckout`**

In `use-checkout.ts` (import `paymentState`):

```ts
export function useCheckout(
	checkoutId: string,
	opts: { pollWhileAwaiting?: boolean } = {},
) {
	return useQuery({
		queryKey: ["customer", "checkout", checkoutId],
		queryFn: async () =>
			unwrap(
				await api().customer.checkouts({ checkoutId }).get(),
				m.checkout_not_found(),
			).data,
		// Dopo il pagamento la conferma arriva dal webhook: si rilegge finché i
		// PR2 escono da pending.
		refetchInterval: (q) =>
			opts.pollWhileAwaiting &&
			paymentState(q.state.data?.orders ?? []) === "awaiting"
				? 2000
				: false,
	});
}
```

- [ ] **Step 7: Form di pagamento (DOM-only)**

`apps/customer/src/features/checkout/pay-form.tsx`:

```tsx
import { Button } from "@bibs/ui/components/button";
import { formatPriceEur } from "@bibs/ui/components/price";
import {
	Elements,
	PaymentElement,
	useElements,
	useStripe,
} from "@stripe/react-stripe-js";
import { type FormEvent, useState } from "react";
import { m } from "@/paraglide/messages";
import { getStripe } from "./stripe";

interface Props {
	clientSecret: string;
	amount: string;
	returnUrl: string;
	/** Pagamento riuscito senza redirect: si va alla pagina di ordine effettuato. */
	onPaid: () => void;
	/** Il PI non è più pagabile (scaduto o già pagato): rileggere lo stato. */
	onStale: () => void;
}

/** Caricato con lazy() solo lato client: Stripe.js tocca window. */
export default function PayForm({ clientSecret, ...rest }: Props) {
	const dark = document.documentElement.classList.contains("dark");
	return (
		<Elements
			stripe={getStripe()}
			options={{
				clientSecret,
				locale: "it",
				appearance: { theme: dark ? "night" : "stripe" },
			}}
		>
			<Inner {...rest} />
		</Elements>
	);
}

function Inner({ amount, returnUrl, onPaid, onStale }: Omit<Props, "clientSecret">) {
	const stripe = useStripe();
	const elements = useElements();
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (!stripe || !elements) return;
		setBusy(true);
		setError(null);
		// 3DS e wallet con redirect tornano su returnUrl; le carte senza
		// autenticazione restano qui.
		const result = await stripe.confirmPayment({
			elements,
			confirmParams: { return_url: returnUrl },
			redirect: "if_required",
		});
		setBusy(false);
		if (result.error) {
			if (result.error.code === "payment_intent_unexpected_state") return onStale();
			return setError(result.error.message ?? m.checkout_pay_failed_generic());
		}
		const status = result.paymentIntent?.status;
		if (status === "succeeded" || status === "processing") onPaid();
	};

	return (
		<form onSubmit={submit} className="space-y-4">
			<PaymentElement />
			{error && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			<Button
				type="submit"
				size="lg"
				className="min-h-11 w-full"
				disabled={!stripe || !elements || busy}
			>
				{m.checkout_pay_submit({ amount: formatPriceEur(amount) })}
			</Button>
		</form>
	);
}
```

(Verifica in `packages/ui` come `ThemeToggle` applica il tema: se usa un attributo invece della classe `dark`, adegua la riga `dark`.)

- [ ] **Step 8: Route di pagamento**

`apps/customer/src/routes/_authenticated/checkout/$checkoutId/pay.tsx`:

```tsx
import { Button } from "@bibs/ui/components/button";
import { formatPriceEur } from "@bibs/ui/components/price";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Navigate,
	useNavigate,
} from "@tanstack/react-router";
import { CreditCard, SearchX } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { NoticePage } from "@/components/notice";
import { getStripe } from "@/features/checkout/stripe";
import { ORDERS_KEY, useCheckout } from "@/features/checkout/use-checkout";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/checkout/$checkoutId/pay")({
	component: CheckoutPayPage,
});

const LazyPayForm = lazy(() => import("@/features/checkout/pay-form"));
const TIME_FMT: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

function CheckoutPayPage() {
	const { checkoutId } = Route.useParams();
	const navigate = useNavigate();
	const qc = useQueryClient();
	const { data, isPending, isError, refetch } = useCheckout(checkoutId);
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	const goToDone = () => {
		void qc.invalidateQueries({ queryKey: ORDERS_KEY });
		void navigate({
			to: "/checkout/$checkoutId",
			params: { checkoutId },
			replace: true,
		});
	};

	if (isPending)
		return (
			<div className="mx-auto w-full max-w-lg space-y-4 px-4 py-8 sm:px-6">
				<Skeleton className="h-8 w-40" />
				<Skeleton className="h-64 w-full" />
			</div>
		);

	if (isError || !data)
		return (
			<NoticePage
				icon={SearchX}
				title={m.checkout_not_found()}
				description={m.orders_empty_description()}
				action={
					<Button asChild>
						<Link to="/orders" search={{ tab: "paid", page: 1 }}>
							{m.checkout_done_orders_cta()}
						</Link>
					</Button>
				}
			/>
		);

	// Niente da pagare (già pagato, scaduto, solo prenotazioni): lo stato vero
	// lo mostra la pagina di ordine effettuato.
	if (!data.payment)
		return (
			<Navigate to="/checkout/$checkoutId" params={{ checkoutId }} replace />
		);

	if (!getStripe())
		return (
			<NoticePage
				icon={CreditCard}
				title={m.checkout_pay_title()}
				description={m.checkout_pay_unavailable()}
			/>
		);

	const expiresAt = data.orders.find(
		(o) => o.type === "pay_pickup" && o.paymentExpiresAt,
	)?.paymentExpiresAt;

	return (
		<div className="mx-auto w-full max-w-lg space-y-6 px-4 py-8 sm:px-6">
			<h1 className="font-display font-semibold text-2xl text-foreground">
				{m.checkout_pay_title()}
			</h1>
			<div className="flex items-baseline justify-between">
				<span className="font-medium text-foreground">{m.checkout_pay_amount()}</span>
				<span className="font-semibold text-foreground text-xl tabular-nums">
					{formatPriceEur(data.amountDueOnline)}
				</span>
			</div>
			{expiresAt && (
				<p className="rounded-lg bg-muted p-3 text-foreground text-sm">
					{m.checkout_pay_expires({
						time: new Date(expiresAt).toLocaleTimeString("it-IT", TIME_FMT),
					})}
				</p>
			)}
			{mounted ? (
				<Suspense fallback={<Skeleton className="h-64 w-full" />}>
					<LazyPayForm
						clientSecret={data.payment.clientSecret}
						amount={data.amountDueOnline}
						// Stessa URL senza /pay, prefisso di lingua incluso.
						returnUrl={window.location.href.split("?")[0].replace(/\/pay\/?$/, "")}
						onPaid={goToDone}
						onStale={() => void refetch()}
					/>
				</Suspense>
			) : (
				<Skeleton className="h-64 w-full" />
			)}
		</div>
	);
}
```

- [ ] **Step 9: Riepilogo → pagamento**

In `review.tsx`, nell'`onSuccess` di `createCheckout.mutate`:

```ts
				onSuccess: (data) =>
					void navigate({
						to: data.payment ? "/checkout/$checkoutId/pay" : "/checkout/$checkoutId",
						params: { checkoutId: data.id },
						replace: true,
					}),
```

- [ ] **Step 10: Pagina di ordine effettuato**

In `routes/_authenticated/checkout/$checkoutId/index.tsx`:
- `const { data, isPending, isError } = useCheckout(checkoutId, { pollWhileAwaiting: true });`
- import `paymentState`, `Loader2`, `XCircle` da `lucide-react`.
- dopo i due early return: `const payment = paymentState(data.orders);`
- sostituisci l'`<header>` con:

```tsx
			<header className="flex items-start gap-4">
				<div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-saffron/15">
					{payment === "awaiting" ? (
						<Loader2 className="size-6 animate-spin text-saffron-deep" aria-hidden />
					) : payment === "failed" ? (
						<XCircle className="size-6 text-destructive" aria-hidden />
					) : (
						<CheckCircle2 className="size-6 text-saffron-deep" aria-hidden />
					)}
				</div>
				<div className="space-y-1" aria-live="polite">
					<h1 className="font-display font-semibold text-2xl text-foreground">
						{payment === "awaiting"
							? m.checkout_done_awaiting_title()
							: payment === "failed"
								? m.checkout_done_payment_failed_title()
								: data.orders.length > 1
									? m.checkout_done_title_many()
									: m.checkout_done_title()}
					</h1>
					<p className="text-muted-foreground text-sm">
						{payment === "awaiting"
							? m.checkout_done_awaiting_body()
							: payment === "failed"
								? m.checkout_done_payment_failed_body()
								: m.checkout_done_subtitle()}
					</p>
					{payment === "awaiting" && (
						<Link
							to="/checkout/$checkoutId/pay"
							params={{ checkoutId }}
							className="inline-flex min-h-11 items-center font-medium text-primary text-sm hover:underline"
						>
							{m.checkout_done_back_to_pay()}
						</Link>
					)}
				</div>
			</header>
```

- nella card di ogni ordine: il codice di ritiro solo se ritirabile — `{o.pickupCode && (o.status === "confirmed" || o.status === "ready_for_pickup") && (…)}`; aggiungi `<OrderStatusBadge status={o.status} />` accanto al numero ordine (import da `@/features/orders/order-status-badge`), così un PR2 annullato si vede tale.
- il bottone «I miei ordini» porta alla tab giusta: `search={{ tab: payment === "none" ? "reserved" : "paid", page: 1 }}`.

- [ ] **Step 11: Dettaglio ordine**

In `routes/_authenticated/orders/$orderId.tsx`:
- per un `pay_pickup` `pending` con `checkoutId`, sopra le azioni:

```tsx
			{order.type === "pay_pickup" && order.status === "pending" && order.checkoutId && (
				<Button asChild size="lg" className="min-h-11">
					<Link to="/checkout/$checkoutId/pay" params={{ checkoutId: order.checkoutId }}>
						{m.orders_complete_payment()}
					</Link>
				</Button>
			)}
```

- nel dialog di annullamento esistente (righe ~160-190) scegli i testi per tipo:

```tsx
const paid = order.type === "pay_pickup";
// trigger:      paid ? m.orders_cancel_paid()       : m.orders_cancel()
// title:        paid ? m.orders_cancel_paid_title() : m.orders_cancel_title()
// description:  paid ? m.orders_cancel_paid_description({ amount: formatPriceEur(order.total) }) : m.orders_cancel_description()
// confirm:      paid ? m.orders_cancel_paid()       : m.orders_cancel_confirm()
// toast:        paid ? m.orders_cancel_paid_success() : m.orders_cancel_success()
```

(Il bottone compare già solo se `canCustomerCancel(order)`; verifica che la condizione di render usi quella funzione e non una copia inline.)

- [ ] **Step 12: Verifiche**

Run:
```bash
bun run --cwd apps/customer test
bun run --cwd apps/customer typecheck
bun run --cwd apps/customer build
```
Expected: test PASS; typecheck verde (i tipi Eden vedono `payment`, `amountDueOnline`, `paymentExpiresAt`); build verde (gate SSR: Stripe.js non deve finire nel bundle server — se la build fallisce con `window is not defined`, qualcosa importa `pay-form` o `stripe.ts` staticamente fuori dal `lazy`). La build rigenera `src/routeTree.gen.ts`: controlla che contenga `/checkout/$checkoutId/pay`.

Smoke veloce (API :3000 + customer :3001, `stripe listen --forward-to localhost:3000/webhooks/stripe`, `VITE_STRIPE_PUBLISHABLE_KEY` in `apps/customer/.env.local`): carrello con un negozio PR2 → Riepilogo «PAGA» → pagina pagamento → carta `4242 4242 4242 4242` → ordine effettuato «Stiamo confermando…» → confermato. Mouse e tastiera (Tab fino a «Paga», Invio).

- [ ] **Step 13: Commit**

```bash
git add apps/customer bun.lock
git commit -m "feat(customer): pagamento Paga e ritira con Payment Element e stato dell'ordine"
```

---

### Task 8: Seller FE — tab «In attesa di pagamento», annullamento con rimborso

**Files:**
- Modify: `apps/seller/src/features/orders/order-labels.ts` (`canCancel`)
- Create: `apps/seller/src/features/orders/order-labels.test.ts`
- Modify: `apps/seller/src/features/orders/components/order-status-tabs.tsx`
- Modify: `apps/seller/src/features/orders/components/order-actions.tsx`
- Modify: `apps/seller/src/routes/_authenticated/orders/$orderId.tsx:205-214`
- Modify: `apps/seller/src/features/stores/components/order-types-section.tsx` (commento e testo morto)
- Modify: `apps/seller/messages/it.json`, `apps/seller/messages/en.json`

**Interfaces:**
- Consumes: regola «PR2 pending non annullabile» (Task 6), `countSellerOrdersByStatus` (già conta `pending`).
- Produces: `canCancel(o: { status: OrderStatus; type: OrderType }): boolean` aggiornato; `OrderTab` include `"pending"`.

- [ ] **Step 1: Test RED**

`apps/seller/src/features/orders/order-labels.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { canCancel } from "./order-labels";

describe("canCancel", () => {
	it("un Paga e ritira in attesa di pagamento non si annulla (si annulla da solo)", () => {
		expect(canCancel({ type: "pay_pickup", status: "pending" })).toBe(false);
	});
	it("un Paga e ritira confermato sì (con rimborso)", () => {
		expect(canCancel({ type: "pay_pickup", status: "confirmed" })).toBe(true);
	});
	it("una prenotazione confermata sì, un ordine pronto no", () => {
		expect(canCancel({ type: "reserve_pickup", status: "confirmed" })).toBe(true);
		expect(canCancel({ type: "reserve_pickup", status: "ready_for_pickup" })).toBe(false);
	});
	it("un acquisto diretto mai", () => {
		expect(canCancel({ type: "direct", status: "confirmed" })).toBe(false);
	});
});
```

Run: `bun run --cwd apps/seller test src/features/orders/order-labels.test.ts`
Expected: FAIL sul primo caso (oggi `pending` → `true`).

- [ ] **Step 2: `canCancel`**

```ts
export function canCancel(o: { status: OrderStatus; type: OrderType }) {
	// Un pay_* pending non si annulla a mano: il pagamento copre tutto il
	// checkout e l'ordine scade da solo (API: 409).
	return o.type !== "direct" && o.status === "confirmed";
}
```

(`reserve_pickup` non nasce mai `pending`; con `pay_*` pending escluso, resta solo `confirmed`.) Run lo Step 1 → PASS.

- [ ] **Step 3: Tab `pending`**

In `order-status-tabs.tsx`: aggiungi `"pending"` al tipo `OrderTab` e a `ORDER_TABS` subito dopo `"all"`; in `LABEL`: `pending: m.orders_tab_pending,`. Messaggi:

- it: `"orders_tab_pending": "In attesa di pagamento",`
- en: `"orders_tab_pending": "Awaiting payment",`

(`validateSearch` in `routes/_authenticated/orders/index.tsx:58` usa `ORDER_TABS`: nessuna modifica. Verifica che il filtro per tab passi `status: tab` all'API per ogni tab diversa da `all`, come per le altre.)

- [ ] **Step 4: Dialog di annullamento**

In `order-actions.tsx`, nella `AlertDialogDescription`:

```tsx
							{confirm === "cancel"
								? order.type === "pay_pickup"
									? m.orders_cancel_description_paid()
									: m.orders_cancel_description()
								: order.type === "reserve_pickup"
									? m.orders_picked_up_description_reserve()
									: m.orders_picked_up_description()}
```

Messaggi:
- it: `"orders_cancel_description_paid": "Il cliente riceve il rimborso completo sulla carta con cui ha pagato e l'incasso di questo ordine ti viene stornato. Lo stock torna disponibile.",`
- en: `"orders_cancel_description_paid": "The customer gets a full refund to the card they paid with and this order's payout is reversed. Stock becomes available again.",`

In `onError` del cancel lascia `toast.error(e.message)`: il 502 dell'API ha già un testo in italiano per il negoziante.

- [ ] **Step 5: Dettaglio ordine**

In `routes/_authenticated/orders/$orderId.tsx:210-214` sostituisci il paragrafo `pay_pickup`:

```tsx
						{order.type === "pay_pickup" && (
							<p className="text-muted-foreground text-xs">
								{order.status === "pending"
									? m.orders_detail_awaiting_payment()
									: m.orders_detail_paid_online()}
							</p>
						)}
```

Messaggi:
- it: `"orders_detail_awaiting_payment": "In attesa del pagamento online: se non arriva entro 30 minuti l'ordine si annulla da solo.",`
- en: `"orders_detail_awaiting_payment": "Awaiting online payment: if it doesn't arrive within 30 minutes the order cancels itself.",`

- [ ] **Step 6: Tipologie d'acquisto**

In `order-types-section.tsx`: il commento di riga 16-17 diventa «offeredOrderTypes riflette cosa vede davvero il cliente: PR2 solo con il conto abilitato.»; il ramo `{payOn && !payOffered && (…)}` mostra sempre `m["store.orderTypes.pay.accountDisabled"]()` (con il flag rimosso, `payOn && !payOffered` implica conto non abilitato):

```tsx
					{payOn && !payOffered && (
						<p className="text-xs text-muted-foreground">
							{m["store.orderTypes.pay.accountDisabled"]()}
						</p>
					)}
```

Rimuovi la chiave `store.orderTypes.pay.notOffered` da `it.json` e `en.json`.

- [ ] **Step 7: Verifiche**

Run:
```bash
bun run --cwd apps/seller test
bun run --cwd apps/seller typecheck
bun run --cwd apps/seller build
grep -rn "ONLINE_PAYMENT\|notOffered" apps/seller/src apps/seller/messages
```
Expected: test PASS, typecheck e build verdi, grep vuoto.

Smoke (seller :3002, `seller@dev.bibs` / `password123`): tab «In attesa di pagamento» con il conteggio, dettaglio di un PR2 `pending` senza «Annulla»; su un PR2 confermato «Annulla» → dialog col testo del rimborso → conferma → toast e stato «Annullato».

- [ ] **Step 8: Commit**

```bash
git add apps/seller
git commit -m "feat(seller): ordini in attesa di pagamento e annullamento con rimborso"
```

---

### Task 9: Docs, backlog, verifica completa e PR

**Files:**
- Modify: `docs/audit/2026-09-24-followup-gap-analysis.md` (P1.1 chiuso, paragrafo «buco aperto», finding `direct`)
- Modify: `docs/superpowers/specs/2026-09-24-customer-checkout-design.md` (nota di implementazione PR F)
- Modify: `docs/stripe-billing.md` (sezione «Paga e ritira in locale»)

- [ ] **Step 1: Backlog**

In `docs/audit/2026-09-24-followup-gap-analysis.md`:
- riga P1.1: «… **Connect fatto in #201**, **PR2 fatto in #NNN**» e segna la riga come chiusa come fatto per gli altri item chiusi del file (stesso stile: barrato o «chiuso»).
- sostituisci il paragrafo «**P1.1, buco aperto**…» con: «**P1.1, buco chiuso (#NNN)**: `pay_*` nasce sempre `pending` (`placeOrder`) e `POST /customer/orders` accetta solo `direct | reserve_pickup`.»
- aggiungi una riga nuova nella sezione più adatta (P1 o P6, segui il criterio del file): «`POST /customer/orders` con `type: direct` crea un ordine `completed` con accredito punti senza alcun pagamento (preesistente; `customer/routes/orders.ts`). Decidere se `direct` va tolto dall'endpoint customer.»

(`#NNN` = numero della PR, da sostituire dopo averla aperta, con un commit `docs(orders)` di una riga.)

- [ ] **Step 2: Spec**

In fondo alla sezione «Pagamento PR2 (PR E + F)» dello spec aggiungi:

```md
**Implementazione (PR F):** un rifiuto della carta non annulla gli ordini (il
cliente riprova sulla stessa pagina); si annullano alla scadenza dei 30 minuti o
su `payment_intent.canceled`. Un PR2 `pending` non si annulla a mano (409): il
PaymentIntent copre tutto il checkout. Lo storno del trasferimento è
best-effort, il rimborso al cliente no. Solo carte (wallet inclusi). Dettagli e
motivazioni: `docs/superpowers/plans/2026-09-25-pr-f-pay-pickup.md`, «Rulings».
```

- [ ] **Step 3: Guida locale**

In `docs/stripe-billing.md` aggiungi una sezione «Paga e ritira (PR2) in locale»:

```md
## Paga e ritira (PR2) in locale

1. `STRIPE_SECRET_KEY` (API) e `VITE_STRIPE_PUBLISHABLE_KEY` (`apps/customer/.env.local`)
   della stessa modalità test.
2. `stripe listen --forward-to localhost:3000/webhooks/stripe --forward-connect-to localhost:3000/webhooks/stripe/connect`
   — i `payment_intent.*` arrivano sulla route piattaforma.
3. Il negozio deve avere «Paga e ritira» acceso e il conto Connect abilitato (profilo seller →
   Pagamenti online, onboarding di test).
4. Carte di test: `4242 4242 4242 4242` (ok), `4000 0025 0000 3155` (3DS), `4000 0000 0000 0002`
   (rifiutata). Scadenza futura qualsiasi, CVC qualsiasi.
5. Senza `stripe listen` la conferma arriva solo quando il cron `expireUnpaidOrders` trova la
   finestra scaduta (fino a 30 minuti) e rilegge il PaymentIntent: per provare il flusso normale
   serve il webhook.
6. I trasferimenti si vedono in Dashboard → Connect → conto → Trasferimenti (`transfer_group` = id del checkout).
```

- [ ] **Step 4: Verifica completa (verification-before-completion)**

Run:
```bash
bun run --cwd apps/api typecheck; echo "api tc $?"
bun run --cwd apps/api test; echo "api test $?"
bun run --cwd apps/customer typecheck; echo "customer tc $?"
bun run --cwd apps/customer test; echo "customer test $?"
bun run --cwd apps/customer build; echo "customer build $?"
bun run --cwd apps/seller typecheck; echo "seller tc $?"
bun run --cwd apps/seller test; echo "seller test $?"
bun run --cwd apps/seller build; echo "seller build $?"
bun run --cwd apps/admin typecheck; echo "admin tc $?"
bunx biome check .; echo "biome $?"
git status --short
```
Expected: ogni `$?` = 0 (controllali uno per uno: un aggregato può nascondere un fallimento); `git status` pulito a parte ciò che si committa; `routeTree.gen.ts` del customer incluso. Admin: typecheck perché i tipi Eden cambiano (`OrderSchema`).

- [ ] **Step 5: Commit docs**

```bash
git add docs
git commit -m "docs(orders): PR2 chiude P1.1, guida locale Paga e ritira"
```

- [ ] **Step 6: PR (senza auto-merge)**

Usa `/commit-commands:commit-push-pr`. Titolo: `feat(orders): Paga e ritira con pagamento online (PR F)`. Corpo: obiettivo, Rulings in breve (1-7), cosa chiude (P1.1 e il buco di `POST /customer/orders`), finding `direct`, e questa checklist di smoke manuale per Marco:

```md
## Smoke manuale (prima del merge)

Setup: API :3000, customer :3001, seller :3002, `stripe listen` (vedi docs/stripe-billing.md),
negozio con «Paga e ritira» acceso e conto Connect di test abilitato.

- [ ] **Pagamento ok** — carrello con un negozio PR2 → Scelta «Paga e ritira» → Riepilogo «PAGA»
      → pagamento con `4242 4242 4242 4242` → «Stiamo confermando…» → ordine confermato con codice
      di ritiro; in /orders tab «Pagati» lo stato è «Da preparare» / confermato.
- [ ] **3DS** — `4000 0025 0000 3155`: si apre la verifica, «Completa» → torna alla pagina di
      ordine effettuato e si conferma. Ripetere con «Fallisci»: resta sulla pagina di pagamento con
      l'errore e si può riprovare.
- [ ] **Carta rifiutata** — `4000 0000 0000 0002`: messaggio di errore sotto il form, l'ordine resta
      «In attesa di pagamento»; poi `4242…` sulla stessa pagina → confermato.
- [ ] **Misto** — carrello con un negozio PP1 e due PR2 → «PRENOTA E PAGA» → un solo pagamento della
      somma dei due PR2; la prenotazione è confermata subito, indipendente dal pagamento.
- [ ] **Refresh** — ricaricare la pagina di pagamento: il form ricompare; ricaricare la pagina di
      ordine effettuato durante la conferma: lo stato si aggiorna da solo.
- [ ] **Abbandono** — lasciare un PR2 non pagato: dopo 30 minuti (o accorciando
      `config.paymentWindowMinutes` in locale) è «Annullato» e lo stock è tornato.
- [ ] **Seller** — tab «In attesa di pagamento» col conteggio, niente «Annulla» sul pending; su un PR2
      confermato «Annulla» mostra il testo del rimborso; dopo la conferma: rimborso visibile in
      Dashboard Stripe (Pagamenti → rimborsi) e storno del trasferimento.
- [ ] **Cliente annulla un PR2 confermato** — dialog col rimborso di X €, poi «Annullato».
- [ ] **Dashboard Stripe** — un PaymentIntent per checkout con `transfer_group` = id checkout, un
      trasferimento per negozio pari a totale − 5%.
- [ ] Mouse **e** tastiera sui form (Tab/Invio sul Payment Element e sui dialog); dark mode sulla
      pagina di pagamento.
```

Poi aggiorna `#NNN` nei docs (Step 1) con un commit `docs(orders)` e push.

---

## Self-review

- **Copertura spec (riga F e «Pagamento PR2»):** `pending` + stock decrementato + `payment_expires_at` (Task 2); cron ogni minuto (Task 5); un PI, `transfer_group`, `stripe_payment_intent_id`, `amount_due_online`, `payment.clientSecret` (Task 3); webhook idempotente, CAS, `transfers.create` con `source_transaction`, doppio evento (Task 4); `platformFeePercent`, `platform_fee`, `stripe_transfer_id` (Task 1-2, 4); annullamento seller da `confirmed` con rimborso + storno nella stessa CAS, da `pending` vietato, dialog e tab `pending` (Task 6, 8); Payment Element, `return_url`, pagina che legge dall'API, tab PR2 (già esistente, verificata) (Task 7); flag acceso = rimosso + test (Task 3); buco `POST /customer/orders` (Task 2); P1.1 (Task 9). Deviazione dichiarata: pagamento rifiutato non annulla (Ruling 3).
- **Oltre lo spec, motivato:** annullamento **cliente** di un PR2 confermato con rimborso (la macchina a stati e il FE customer lo permettevano già: senza, un cliente annullerebbe un ordine pagato senza rimborso); `orders.stripe_refund_id` (Ruling 5-6).
- **Nomi coerenti:** `PAY_TYPES`, `assertCancellable` (Task 2, 6); `createCheckoutPaymentIntent`, `payableClientSecret`, `settleCheckoutPayment`, `refundOrderPayment` (`order-payments.ts`, Task 3-6); `cancelUnpaidOrder`, `expireUnpaidOrders` (`lib/jobs/expire-unpaid-orders.ts`, Task 4-5); `paymentState`, `useCheckout(id, { pollWhileAwaiting })` (Task 7); `enableOnlinePayments` (fixture, Task 3-5).
