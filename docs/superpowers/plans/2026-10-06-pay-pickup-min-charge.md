# «Paga e ritira» sotto 0,50 € — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nessun checkout arriva a Stripe con un importo online tra 0,01 e 0,49 €: l'anteprima lo
segnala, il riepilogo customer mostra un avviso e disabilita la conferma, la conferma risponde 400.

**Architecture:** Una funzione pura `isBelowOnlineMinimum` in `apps/api/src/lib/online-charge.ts`,
usata da `allocateCheckoutPoints`, da `createCheckout` (rifiuto 400 prima degli insert) e da
`previewCheckout` (flag `withoutPoints.belowMinimum`). Il customer legge il flag tramite un helper
puro `onlineChargeBlocked` e mostra l'avviso in `/checkout/review`.

**Tech Stack:** Bun + Elysia + Drizzle (API, `bun test`), TanStack Start + paraglide (customer,
Vitest), Testcontainers per l'integrazione.

**Spec:** `docs/superpowers/specs/2026-10-06-pay-pickup-min-charge-design.md`

## Global Constraints

- Branch `feat/pay-pickup-min-charge`; mai commit su `main`. Conventional Commits.
- Soglia sempre da `config.stripeMinChargeCents` (50), mai `50` scritto a mano nel codice di produzione.
- La soglia vale per la **somma online del checkout** (Σ PR2 − sconto punti), non per negozio.
- 0 € è sempre permesso (punti che coprono tutto).
- Messaggio 400: `Il pagamento online parte da 0,50 €: scegli «Prenota e paga in negozio» o aggiungi articoli` (importo derivato da config).
- Toast solo da `@bibs/ui/components/sonner`; messaggi customer in `messages/it.json` **e** `messages/en.json`.
- Suite API completa con `bun run test` (mai `bun test` nudo: salta `--isolate`); integrazione con `bun run test:integration`.
- `docs/pagamenti.md` aggiornato nella stessa PR.
- Niente PR prima dello smoke manuale di Marco nel browser.

## Review Focus

- Lordo PR2 sotto soglia **ma** checkout con anche una prenotazione grande: la prenotazione non deve "salvare" il PR2 (somma online = solo PR2) → test in Task 2 (caso 3).
- Interruttore punti acceso con saldo insufficiente (`withPoints: null`): la UI non deve credere che i punti risolvano → test di `onlineChargeBlocked` in Task 3 («acceso ma withPoints null»).
- Saldo che azzera ma interruttore spento alla conferma (`usePoints` assente): deve essere 400, non 0 € silenzioso → Task 2 caso 5.
- Esattamente 0,50 €: deve passare (bordo della soglia) → unit in Task 1 e caso integrazione 7 in Task 2.
- Retry idempotente dopo il 400: la stessa chiave non deve trovare un checkout fantasma (la tx è annullata) → Task 2 caso 1 verifica che non esista nessuna riga `checkouts`.

---

### Task 1: Regola di dominio `isBelowOnlineMinimum`

**Files:**
- Create: `apps/api/src/lib/online-charge.ts`
- Create: `apps/api/tests/lib/online-charge.test.ts`
- Modify: `apps/api/src/lib/points-allocation.ts:24-27`

**Interfaces:**
- Produces: `isBelowOnlineMinimum(cents: number): boolean` — vero per `0 < cents < config.stripeMinChargeCents`.

- [ ] **Step 1: Test che fallisce**

`apps/api/tests/lib/online-charge.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { isBelowOnlineMinimum } from "@/lib/online-charge";

describe("isBelowOnlineMinimum", () => {
	it("0 €: niente da incassare, permesso", () => {
		expect(isBelowOnlineMinimum(0)).toBe(false);
	});
	it("tra 0,01 e 0,49 €: Stripe lo rifiuterebbe", () => {
		expect(isBelowOnlineMinimum(1)).toBe(true);
		expect(isBelowOnlineMinimum(49)).toBe(true);
	});
	it("0,50 € e oltre: permesso", () => {
		expect(isBelowOnlineMinimum(50)).toBe(false);
		expect(isBelowOnlineMinimum(51)).toBe(false);
	});
});
```

- [ ] **Step 2: Verifica che fallisca**

Run: `cd apps/api && bun test tests/lib/online-charge.test.ts`
Expected: FAIL (modulo `@/lib/online-charge` non trovato).

- [ ] **Step 3: Implementazione**

`apps/api/src/lib/online-charge.ts`:

```ts
import { config } from "@/lib/config";

/** Un importo online che Stripe rifiuterebbe: tra 0,01 € e il minimo (0,50 €).
 *  0 € non lo è: niente da incassare, nessun PaymentIntent. */
export function isBelowOnlineMinimum(cents: number): boolean {
	return cents > 0 && cents < config.stripeMinChargeCents;
}
```

In `apps/api/src/lib/points-allocation.ts` aggiungi `import { isBelowOnlineMinimum } from "@/lib/online-charge";` e sostituisci:

```ts
	if (residual > 0 && residual < config.stripeMinChargeCents)
		discount = Math.max(0, total - config.stripeMinChargeCents);
```

con:

```ts
	if (isBelowOnlineMinimum(residual))
		discount = Math.max(0, total - config.stripeMinChargeCents);
```

- [ ] **Step 4: Verifica**

Run: `cd apps/api && bun test tests/lib/online-charge.test.ts tests/lib/points-allocation.test.ts`
Expected: PASS (i test di `allocateCheckoutPoints` restano invariati e verdi).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/online-charge.ts apps/api/tests/lib/online-charge.test.ts apps/api/src/lib/points-allocation.ts
git commit -m "feat(api): regola isBelowOnlineMinimum per il minimo Stripe"
```

---

### Task 2: Checkout API — rifiuto alla conferma e flag nell'anteprima

**Files:**
- Modify: `apps/api/src/modules/customer/services/checkout.ts` (`priceCheckout` ~L122-162, `createCheckout` ~L236-246, `previewCheckout` ~L375-421)
- Modify: `apps/api/src/lib/schemas/composed.ts` (`CheckoutPreviewSchema` ~L190-198)
- Modify: `apps/api/src/modules/customer/routes/checkout.ts` (descrizioni OpenAPI)
- Modify: `apps/api/tests/integration/customer-checkout-points.test.ts:395-398` (forma dell'anteprima)
- Create: `apps/api/tests/integration/customer-checkout-min-charge.test.ts`

**Interfaces:**
- Consumes: `isBelowOnlineMinimum` (Task 1).
- Produces:
  - `priceCheckout(...)` → `Promise<{ steps: Step[]; grossOnlineCents: number; amountDueOnlineCents: number }>` dove `Step` è l'elemento che oggi restituisce (`{ choice, buyable, priced, points, discountCents }`).
  - Risposta anteprima: `{ balance, minAmountOnline: string, payInStore, withoutPoints: { amountDueOnline: string; belowMinimum: boolean }, withPoints }`.
  - `createCheckout` lancia `ServiceError(400, …)` sotto soglia.

- [ ] **Step 1: Test di integrazione che falliscono**

`apps/api/tests/integration/customer-checkout-min-charge.test.ts` (stesso preambolo di mock di `customer-checkout-points.test.ts`):

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

const paymentIntentsCreate = mock(async (p: any, _o?: any) => ({
	id: "pi_TEST",
	amount: p.amount,
	client_secret: "pi_TEST_secret_abc",
	status: "requires_payment_method",
}));
const paymentIntentsRetrieve = mock(async (id: string) => ({
	id,
	client_secret: "pi_TEST_secret_abc",
	status: "requires_payment_method",
}));
const transfersCreate = mock(async (p: any, _o?: any) => ({
	id: "tr_1",
	amount: p.amount,
}));

mock.module("@/lib/stripe", () => ({
	stripe: {
		paymentIntents: {
			create: paymentIntentsCreate,
			retrieve: paymentIntentsRetrieve,
		},
		transfers: { create: transfersCreate },
	},
}));

import { eq } from "drizzle-orm";
import { cartItem } from "@/db/schemas/cart";
import { checkout } from "@/db/schemas/checkout";
import { order } from "@/db/schemas/order";
import {
	createCheckout,
	previewCheckout,
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
	for (const m of [paymentIntentsCreate, paymentIntentsRetrieve, transfersCreate])
		m.mockClear();
});

/** Un negozio con un prodotto a `price`, pagamenti online attivi. */
async function sellable(sellerProfileId: string, name: string, price: string) {
	const db = getTestDb();
	const store = await createTestStore(db, sellerProfileId, { name });
	await createTestStoreSubscription(db, store.id);
	const product = await createTestProduct(db, sellerProfileId, { price });
	const sp = await createTestStoreProduct(db, store.id, product.id, {
		stock: 5,
	});
	await enableOnlinePayments(db, { sellerProfileId, storeId: store.id });
	return { store, sp };
}

/** Due negozi da 0,30 € (prodotti a 0,30, qty 1), un terzo da 4,00 €. */
async function cart(points: number) {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const customer = await createTestCustomer(db, { points });
	const a = await sellable(seller.profile.id, "Piccolo A", "0.30");
	const b = await sellable(seller.profile.id, "Piccolo B", "0.30");
	const big = await sellable(seller.profile.id, "Grande", "4.00");
	for (const s of [a, b, big])
		await createTestCartItem(db, customer.profile.id, s.sp.id, {
			quantity: 1,
		});
	return { customer, a, b, big };
}

const ordersCount = async () =>
	(await getTestDb().select({ id: order.id }).from(order)).length;
const checkoutsCount = async () =>
	(await getTestDb().select({ id: checkout.id }).from(checkout)).length;
const cartCount = async (customerProfileId: string) =>
	(
		await getTestDb()
			.select({ id: cartItem.id })
			.from(cartItem)
			.where(eq(cartItem.customerProfileId, customerProfileId))
	).length;

describe("Paga e ritira sotto 0,50 €", () => {
	it("1. un PR2 da 0,30 €: anteprima belowMinimum, conferma 400, niente creato", async () => {
		const { customer, a } = await cart(0);
		const stores = [{ storeId: a.store.id, type: "pay_pickup" as const }];

		const preview = await previewCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			stores,
		});
		expect(preview).toMatchObject({
			minAmountOnline: "0.50",
			withoutPoints: { amountDueOnline: "0.30", belowMinimum: true },
			withPoints: null,
		});

		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 0,
				idempotencyKey: crypto.randomUUID(),
				stores,
			}),
		).rejects.toMatchObject({
			status: 400,
			message:
				"Il pagamento online parte da 0,50 €: scegli «Prenota e paga in negozio» o aggiungi articoli",
		});
		expect(paymentIntentsCreate).not.toHaveBeenCalled();
		expect(await ordersCount()).toBe(0);
		expect(await checkoutsCount()).toBe(0);
		expect(await cartCount(customer.profile.id)).toBe(3);
	});

	it("2. due PR2 da 0,30 €: la somma 0,60 € si paga", async () => {
		const { customer, a, b } = await cart(0);
		const stores = [
			{ storeId: a.store.id, type: "pay_pickup" as const },
			{ storeId: b.store.id, type: "pay_pickup" as const },
		];
		const preview = await previewCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			stores,
		});
		expect(preview.withoutPoints).toEqual({
			amountDueOnline: "0.60",
			belowMinimum: false,
		});
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores,
		});
		expect(paymentIntentsCreate.mock.calls[0][0].amount).toBe(60);
		expect(result.amountDueOnline).toBe("0.60");
	});

	it("3. PR2 0,30 € + prenotazione 4,00 €: la prenotazione non conta, 400", async () => {
		const { customer, a, big } = await cart(0);
		const stores = [
			{ storeId: a.store.id, type: "pay_pickup" as const },
			{ storeId: big.store.id, type: "reserve_pickup" as const },
		];
		const preview = await previewCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			stores,
		});
		expect(preview.withoutPoints.belowMinimum).toBe(true);
		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 0,
				idempotencyKey: crypto.randomUUID(),
				stores,
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("4. PR2 0,30 € con punti che azzerano: 0 €, confermato, nessun PI", async () => {
		const { customer, a } = await cart(100);
		const stores = [{ storeId: a.store.id, type: "pay_pickup" as const }];
		const preview = await previewCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 100,
			stores,
		});
		expect(preview.withoutPoints.belowMinimum).toBe(true);
		expect(preview.withPoints).toMatchObject({
			pointsSpent: 30,
			amountDueOnline: "0.00",
		});
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 100,
			idempotencyKey: crypto.randomUUID(),
			usePoints: true,
			stores,
		});
		expect(paymentIntentsCreate).not.toHaveBeenCalled();
		expect(result.orders[0]).toMatchObject({
			status: "confirmed",
			pointsSpent: 30,
		});
	});

	it("5. stesso carrello senza usePoints: 400", async () => {
		const { customer, a } = await cart(100);
		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 100,
				idempotencyKey: crypto.randomUUID(),
				stores: [{ storeId: a.store.id, type: "pay_pickup" }],
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("6. saldo insufficiente con usePoints: nessuno sconto, 400", async () => {
		const { customer, a } = await cart(10);
		const stores = [{ storeId: a.store.id, type: "pay_pickup" as const }];
		const preview = await previewCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 10,
			stores,
		});
		expect(preview.withPoints).toBeNull();
		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 10,
				idempotencyKey: crypto.randomUUID(),
				usePoints: true,
				stores,
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("7. esattamente 0,50 €: si paga", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db, { points: 0 });
		const s = await sellable(seller.profile.id, "Soglia", "0.50");
		await createTestCartItem(db, customer.profile.id, s.sp.id, {
			quantity: 1,
		});
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [{ storeId: s.store.id, type: "pay_pickup" }],
		});
		expect(paymentIntentsCreate.mock.calls[0][0].amount).toBe(50);
		expect(result.amountDueOnline).toBe("0.50");
	});
});
```

Nota: se `priceOrder` applica regole di prezzo che rendono il totale diverso dal `price` del
prodotto (sconti, arrotondamenti IVA), controlla l'anteprima del caso 2 per i totali reali e
adatta i prezzi dei fixture, non le asserzioni sulla soglia.

- [ ] **Step 2: Verifica che falliscano**

Run: `cd apps/api && bun run test:image && bun test tests/integration/customer-checkout-min-charge.test.ts --timeout 180000`
Expected: FAIL — `minAmountOnline`/`belowMinimum` assenti (1, 2), caso 1/3/5/6 ricevono 502 o nessun rifiuto invece di 400. Il 7 può già passare.

- [ ] **Step 3: `priceCheckout` restituisce i totali online**

In `checkout.ts` importa `import { config } from "@/lib/config";` e `import { isBelowOnlineMinimum } from "@/lib/online-charge";`. Sostituisci il `return` finale di `priceCheckout` con:

```ts
	const steps = p.resolved.map((r, i) => ({
		...r,
		priced: priced[i],
		points: points[i],
		discountCents: discountCents[i],
	}));
	const grossOnlineCents = payIdx.reduce(
		(s, i) => s + priced[i].totalCents,
		0,
	);
	return {
		steps,
		grossOnlineCents,
		// Quel che il PaymentIntent unico incasserebbe in questo scenario.
		amountDueOnlineCents:
			grossOnlineCents - discountCents.reduce((s, d) => s + d, 0),
	};
```

Aggiorna il JSDoc: «Restituisce anche il lordo online (somma PR2) e l'importo online dello scenario (lordo − punti).»

- [ ] **Step 4: `createCheckout` rifiuta prima degli insert**

Subito dopo la chiamata a `priceCheckout` in `createCheckout`:

```ts
			const plan = await priceCheckout(tx, {
				customerProfileId,
				customerPoints,
				usePoints,
				resolved,
			});
			// Stripe non incassa tra 0,01 e 0,49 €: si rifiuta qui, prima di
			// qualunque insert, così la tx si annulla e il carrello resta.
			if (isBelowOnlineMinimum(plan.amountDueOnlineCents))
				throw new ServiceError(
					400,
					`Il pagamento online parte da ${fromCents(config.stripeMinChargeCents).replace(".", ",")} €: scegli «Prenota e paga in negozio» o aggiungi articoli`,
				);
```

e cambia il ciclo `for (const step of plan)` in `for (const step of plan.steps)`.

Aggiorna il JSDoc di `createCheckout`: aggiungi «Importo online tra 0,01 e 0,49 € (minimo Stripe): 400, nessun ordine.»

- [ ] **Step 5: `previewCheckout` espone il flag**

Nel corpo di `previewCheckout` sostituisci l'uso di `plan`:

```ts
			const { steps, grossOnlineCents } = await priceCheckout(tx, {
				customerProfileId: p.customerProfileId,
				customerPoints: p.customerPoints,
				usePoints: true,
				resolved,
			});
			const pay = steps.filter((s) => s.priced.type === "pay_pickup");
			const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
			const discount = sum(pay.map((s) => s.discountCents));
			return {
				balance: p.customerPoints,
				minAmountOnline: fromCents(config.stripeMinChargeCents),
				payInStore: fromCents(
					sum(
						steps
							.filter((s) => s.priced.type === "reserve_pickup")
							.map((s) => s.priced.totalCents),
					),
				),
				withoutPoints: {
					amountDueOnline: fromCents(grossOnlineCents),
					belowMinimum: isBelowOnlineMinimum(grossOnlineCents),
				},
				withPoints:
					discount > 0
						? {
								pointsSpent: sum(pay.map((s) => s.points)),
								discount: fromCents(discount),
								amountDueOnline: fromCents(grossOnlineCents - discount),
								perStore: pay.map((s) => ({
									storeId: s.choice.storeId,
									pointsSpent: s.points,
									discount: fromCents(s.discountCents),
								})),
							}
						: null,
			};
```

(rimuove la variabile `grossPay`, ora `grossOnlineCents`). Nel JSDoc aggiungi: «Sotto il minimo Stripe risponde comunque, con `withoutPoints.belowMinimum`; `withPoints` è per costruzione 0 € o ≥ minimo.»

- [ ] **Step 6: Schema e OpenAPI**

In `apps/api/src/lib/schemas/composed.ts`, `CheckoutPreviewSchema`:

```ts
export const CheckoutPreviewSchema = t.Object({
	balance: t.Number({ minimum: 0, description: "Saldo punti del cliente" }),
	minAmountOnline: t.String({
		description:
			"Minimo incassabile online (limite Stripe in EUR): sotto, solo 0 €",
	}),
	payInStore: t.String({
		description: "Somma degli ordini Prenota e paga in negozio",
	}),
	withoutPoints: t.Object({
		amountDueOnline: t.String({ description: "Da pagare online senza punti" }),
		belowMinimum: t.Boolean({
			description:
				"Importo online tra 0,01 € e minAmountOnline: senza punti la conferma risponde 400",
		}),
	}),
	// withPoints invariato
```

In `apps/api/src/modules/customer/routes/checkout.ts`:
- anteprima, `detail.description`: aggiungi « Sotto il minimo online risponde 200 con `withoutPoints.belowMinimum: true`.»
- `POST /checkout`, `detail.description`: aggiungi « 400 se l'importo online è tra 0,01 € e il minimo Stripe (0,50 €).» Verifica che `response` della POST includa già un 400 (`withConflictErrors`/`withErrors`); se non c'è, usa lo stesso helper dell'anteprima.

- [ ] **Step 7: Allinea il test di forma esistente**

In `apps/api/tests/integration/customer-checkout-points.test.ts` (~L395) l'`expect(preview).toEqual({...})` diventa:

```ts
		expect(preview).toEqual({
			balance: 1000,
			minAmountOnline: "0.50",
			payInStore: "4.00",
			withoutPoints: { amountDueOnline: "27.50", belowMinimum: false },
			// withPoints invariato
```

- [ ] **Step 8: Verifica**

Run: `cd apps/api && bun run typecheck && bun run test`
Expected: typecheck pulito; unit + integrazione verdi (compresi i 7 casi nuovi e i test esistenti di checkout). Controlla l'exit code per workspace, non solo l'aggregato.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/customer apps/api/src/lib/schemas/composed.ts apps/api/tests/integration
git commit -m "feat(checkout): rifiuta l'importo online sotto 0,50 € e lo segnala nell'anteprima"
```

---

### Task 3: Customer — avviso nel riepilogo e conferma disabilitata

**Files:**
- Modify: `apps/customer/src/features/checkout/points-toggle.ts`
- Modify: `apps/customer/src/features/checkout/points-toggle.test.ts`
- Modify: `apps/customer/src/routes/_authenticated/checkout/review.tsx`
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json`

**Interfaces:**
- Consumes: risposta anteprima di Task 2 (`minAmountOnline`, `withoutPoints.belowMinimum`), tipizzata da Eden.
- Produces: `onlineChargeBlocked(preview, usePoints): boolean`.

- [ ] **Step 1: Test che fallisce**

In `points-toggle.test.ts` importa anche `onlineChargeBlocked` e aggiungi:

```ts
describe("onlineChargeBlocked", () => {
	const below = {
		withoutPoints: { belowMinimum: true },
		withPoints: { amountDueOnline: "0.00" },
	};
	it("spento e sotto soglia: bloccato", () => {
		expect(onlineChargeBlocked(below, false)).toBe(true);
	});
	it("acceso con punti che azzerano: libero", () => {
		expect(onlineChargeBlocked(below, true)).toBe(false);
	});
	it("acceso ma withPoints null (saldo insufficiente): bloccato", () => {
		expect(onlineChargeBlocked({ ...below, withPoints: null }, true)).toBe(
			true,
		);
	});
	it("sopra soglia: mai bloccato", () => {
		expect(
			onlineChargeBlocked(
				{ withoutPoints: { belowMinimum: false }, withPoints: null },
				false,
			),
		).toBe(false);
	});
});
```

- [ ] **Step 2: Verifica che fallisca**

Run: `cd apps/customer && bun run test -- src/features/checkout/points-toggle.test.ts`
Expected: FAIL (`onlineChargeBlocked` non esportata).

- [ ] **Step 3: Helper**

In `points-toggle.ts`:

```ts
/** L'importo online dello scenario scelto è sotto il minimo Stripe: la
 *  conferma va bloccata. Con i punti accesi l'importo è per costruzione
 *  0 € o almeno il minimo, quindi conta solo lo scenario senza punti. */
export function onlineChargeBlocked(
	preview: {
		withoutPoints: { belowMinimum: boolean };
		withPoints: unknown | null;
	},
	usePoints: boolean,
): boolean {
	if (usePoints && preview.withPoints) return false;
	return preview.withoutPoints.belowMinimum;
}
```

- [ ] **Step 4: Verifica**

Run: `cd apps/customer && bun run test -- src/features/checkout/points-toggle.test.ts`
Expected: PASS.

- [ ] **Step 5: Messaggi**

`apps/customer/messages/it.json` (vicino a `checkout_confirm_order`):

```json
	"checkout_min_charge_note": "I pagamenti online partono da {min}. Per questo ordine scegli «Prenota e paga in negozio» o aggiungi articoli.",
	"checkout_min_charge_points": "Oppure attiva i punti: paghi 0 €.",
```

`apps/customer/messages/en.json`:

```json
	"checkout_min_charge_note": "Online payments start at {min}. For this order choose “Reserve and pay in store” or add more items.",
	"checkout_min_charge_points": "Or turn on your points: you pay €0.",
```

Controlla in `en.json` l'etichetta reale di `checkout_type_reserve_pickup` e usa la stessa dicitura tra virgolette.

- [ ] **Step 6: UI in `review.tsx`**

Importa `onlineChargeBlocked` da `@/features/checkout/points-toggle`. Dopo `const payInStore = ...`:

```ts
	// Sotto il minimo Stripe la conferma fallirebbe: avviso e bottone spento.
	const blocked = data ? onlineChargeBlocked(data, points) : false;
```

Nel blocco `<div className="space-y-3">` degli importi, dopo il `pointsOn &&` di «Da pagare con carta» e prima di `payInStore > 0`:

```tsx
					{blocked && (
						<div
							role="status"
							className="space-y-1 rounded-lg bg-muted p-3 text-foreground text-sm"
						>
							<p>
								{m.checkout_min_charge_note({
									min: formatPriceEur(data.minAmountOnline),
								})}
							</p>
							{withPoints && <p>{m.checkout_min_charge_points()}</p>}
						</div>
					)}
```

Nel `disabled` del bottone di conferma aggiungi `|| blocked`:

```tsx
					disabled={
						!data ||
						blocked ||
						createCheckout.isPending ||
						createCheckout.isSuccess
					}
```

In `confirm()`, dopo `if (!data) return;`, aggiungi `if (blocked) return;` (difesa contro Enter su un bottone rimasto a fuoco).

- [ ] **Step 7: Verifica**

Run: `cd apps/customer && bun run typecheck && bun run test && bun run build`
Expected: tutto verde; nessun errore paraglide.

Poi curl SSR della pagina (i server dev sono già accesi su 3001):
Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/cart`
Expected: `200` o redirect di login (non 500).

- [ ] **Step 8: Commit**

```bash
git add apps/customer
git commit -m "feat(checkout): avviso sotto 0,50 € nel riepilogo, conferma disabilitata"
```

---

### Task 4: Documentazione `docs/pagamenti.md`

**Files:**
- Modify: `docs/pagamenti.md` (sezione «Paga e ritira» ~L74-84, «Cosa NON esiste ancora» L301, «Dove sta nel codice» ~L311)

- [ ] **Step 1: Regola nella sezione PR2**

Nell'elenco «Dettagli che contano» di «Paga e ritira (`pay_pickup`, PR2)», dopo «Un solo pagamento per checkout»:

```markdown
- **Minimo online 0,50 €.** Stripe in EUR non incassa meno di 0,50 €. La soglia vale per la
  somma online del checkout (Σ ordini «Paga e ritira» − sconto punti), non per negozio: due
  negozi da 0,30 € fanno 0,60 € e si pagano. Si paga 0 € (punti che coprono tutto) oppure almeno
  0,50 €. Tra 0,01 e 0,49 € il riepilogo mostra un avviso, il bottone di conferma è disabilitato
  e l'API risponde 400 alla conferma; le vie d'uscita sono «Prenota e paga in negozio», aggiungere
  articoli o, se il saldo basta ad azzerare, attivare i punti. Esempio: un solo prodotto da
  0,30 € in «Paga e ritira» senza punti → avviso; con 30 punti attivi → 0 €, ordine confermato.
```

- [ ] **Step 2: Togli la riga**

Rimuovi da «Cosa NON esiste ancora»:

```markdown
- Ordine «Paga e ritira» con totale sotto 0,50 € senza punti: Stripe lo rifiuta (502).
```

- [ ] **Step 3: Dove sta nel codice**

Aggiungi una riga alla tabella, dopo «Ripartizione dei punti tra gli ordini»:

```markdown
| Minimo online 0,50 € (regola condivisa da punti, anteprima e conferma) | `apps/api/src/lib/online-charge.ts` |
```

- [ ] **Step 4: Commit**

```bash
git add docs/pagamenti.md
git commit -m "docs: minimo online 0,50 € nel checkout «Paga e ritira»"
```

---

### Task 5: Verifica finale e consegna a Marco

- [ ] **Step 1: Suite completa**

Run (dalla root): `bun run typecheck && bun run lint && bun run --filter @bibs/api test && bun run --filter @bibs/customer test`
Expected: tutto verde; controlla l'esito di ogni workspace separatamente.

- [ ] **Step 2: Push del branch, niente PR**

```bash
git push -u origin feat/pay-pickup-min-charge
```

- [ ] **Step 3: Chiedi a Marco lo smoke manuale** (http://localhost:3001), con mouse e tastiera:
  1. carrello con un solo prodotto sotto 0,50 € in «Paga e ritira», senza punti → avviso, bottone disabilitato;
  2. stesso carrello con saldo ≥ importo → riga «Oppure attiva i punti», attivandoli l'avviso sparisce e il bottone diventa «Conferma ordine»;
  3. «Modifica scelta» → «Prenota e paga in negozio» → conferma ok;
  4. due negozi sotto 0,50 € ciascuno ma ≥ 0,50 € in somma → nessun avviso, pagamento ok.

  Usa entità di prova, non i dati del seed.

- [ ] **Step 4: Solo dopo l'ok di Marco**, apri la PR (`superpowers:finishing-a-development-branch`).
