# Punti fedeltà nel checkout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** il cliente spende i punti fedeltà nel checkout dal carrello sugli ordini «Paga e ritira», con anteprima dall'API, checkout a 0 € senza Stripe e regola 0 / ≥0,50 €.

**Architecture:** `placeOrder` si divide in `priceOrder` (sola lettura) + `insertOrder`; una funzione pura `allocateCheckoutPoints` decide quanti punti usare e come ripartirli. `createCheckout` (scrive) e il nuovo `previewCheckout` (legge) usano le stesse funzioni, quindi l'anteprima coincide con la conferma per costruzione. I trasferimenti ai negozi escono da `settleCheckoutPayment` in `transferStorePayouts`, usabile anche senza PaymentIntent.

**Tech Stack:** Bun + Elysia + Drizzle (API, `bun test`, testcontainers), TanStack Start/Router/Query + Vitest + paraglide (customer), Stripe (mockato nei test).

**Spec:** [`docs/superpowers/specs/2026-10-06-checkout-points-design.md`](../specs/2026-10-06-checkout-points-design.md)

## Global Constraints

- Branch `feat/checkout-points`; mai commit su `main`. Conventional Commits (`feat(api): …`, `feat(customer): …`, `docs: …`); ogni commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Punti spendibili **solo** su `pay_pickup`; `reserve_pickup` mai, e `usePoints: true` con sole prenotazioni non è un errore.
- 100 punti = 1 € (`config.pointsPerEuroDiscount`), aritmetica intera in centesimi.
- Importo online del checkout: **0 € oppure ≥ 0,50 €** (`config.stripeMinChargeCents = 50`).
- Ripartizione tra PR2 **proporzionale al lordo**, resti maggiori, somma esatta.
- Interruttore nel FE **spento di default**, stato solo nella pagina.
- Errori API in italiano via `ServiceError(status, message)` (due argomenti, niente code custom).
- Toast nel FE solo da `@bibs/ui/components/sonner`, mai da `"sonner"`.
- Commenti nel codice in italiano, densità come i file circostanti.
- Test API unit: `cd apps/api && bun test tests/lib/<file>`; integrazione: `cd apps/api && bun run test:integration` (singolo file: `bun run test:image && bun test tests/integration/<file> --timeout 180000`). Mai `bun test` nudo per la suite completa.
- Test FE: `cd apps/customer && bun run test` (Vitest; `pretest` compila paraglide).

## Review Focus

1. **Saldo speso in un'altra scheda tra anteprima e conferma** → la conferma risponde 409 «Punti insufficienti, riprova», nessun ordine nasce, il carrello resta. Test in Task 3.
2. **Retry con la stessa idempotency key dopo aver cambiato l'interruttore** → restituisce il checkout già creato. Il FE congela `usePoints` al primo click e disabilita l'interruttore dopo l'invio. Test in Task 3 (API) e Task 6 (stato congelato in `submitted`).
3. **Trasferimento punti fallito su un checkout a 0 €** → la risposta al cliente è comunque 200 con ordini confermati; il cron lo ritenta. Test in Task 4.
4. **Checkout a 0 € e il cron delle scadenze** → gli ordini non sono `pending`, quindi `expireUnpaidOrders` non li annulla mai. Test in Task 3.
5. **Annullare un solo ordine di un checkout con punti ripartiti** → tornano solo i punti di quell'ordine e si storna solo la sua quota punti. Test in Task 4.

---

## File map

| File | Responsabilità |
|---|---|
| `apps/api/src/lib/config.ts` | + `stripeMinChargeCents: 50` |
| `apps/api/src/lib/points-allocation.ts` (nuovo) | `allocateCheckoutPoints`, puro |
| `apps/api/tests/lib/points-allocation.test.ts` (nuovo) | unit |
| `apps/api/src/modules/customer/services/orders.ts` | `priceOrder` + `insertOrder`; `placeOrder` le compone |
| `apps/api/src/modules/customer/services/checkout.ts` | `parseStoresParam`, `resolveCheckoutLines`, `createCheckout` con `usePoints` e 0 €, `previewCheckout` |
| `apps/api/src/modules/billing/services/order-payments.ts` | `transferStorePayouts` estratta da `settleCheckoutPayment` |
| `apps/api/src/lib/jobs/retry-store-transfers.ts` | include i checkout senza PI |
| `apps/api/src/lib/schemas/composed.ts` | `CheckoutPreviewSchema` |
| `apps/api/src/lib/schemas/entities.ts` | `OrderSchema` + `pointsDiscount` |
| `apps/api/src/modules/customer/routes/checkout.ts` | `usePoints` nel body, `GET /checkout/preview` |
| `apps/api/tests/integration/customer-checkout-points.test.ts` (nuovo) | integrazione punti |
| `apps/api/tests/integration/job-retry-store-transfers.test.ts` | + caso senza PI |
| `apps/customer/src/features/checkout/points-toggle.ts` (+ `.test.ts`, nuovi) | logica pura dell'interruttore |
| `apps/customer/src/features/checkout/checkout-choice.ts` (+ test) | `confirmLabel` col caso 0 € |
| `apps/customer/src/features/checkout/use-checkout.ts` | `useCheckoutPreview`, `usePoints` nella mutation |
| `apps/customer/src/features/checkout/store-choice.tsx` | suggerimento punti |
| `apps/customer/src/routes/_authenticated/checkout/index.tsx` | passa il saldo a `StoreChoice` |
| `apps/customer/src/routes/_authenticated/checkout/review.tsx` | numeri dalla preview, interruttore |
| `apps/customer/src/routes/_authenticated/checkout/$checkoutId/index.tsx` | riga «Punti usati» |
| `apps/customer/messages/{it,en}.json` | stringhe nuove |
| `docs/pagamenti.md` | regola, flusso 0 €, esempi |

---

### Task 1: `allocateCheckoutPoints`

**Files:**
- Modify: `apps/api/src/lib/config.ts`
- Create: `apps/api/src/lib/points-allocation.ts`
- Test: `apps/api/tests/lib/points-allocation.test.ts`

**Interfaces:**
- Produces: `allocateCheckoutPoints(input: { balance: number; grossCents: number[] }): { discountCents: number[]; points: number[] }` — stessi indici di `grossCents`; `Σ discountCents` = sconto totale; `points[i] = discountCents[i] * pointsPerEuroDiscount / 100`. `config.stripeMinChargeCents: 50`.

- [ ] **Step 1: Aggiungi la costante in `config.ts`** dopo `platformFeePercent`:

```ts
	/** Minimo addebito Stripe in EUR (centesimi): sotto, il PaymentIntent è rifiutato */
	stripeMinChargeCents: 50,
```

- [ ] **Step 2: Scrivi il test che fallisce** — `apps/api/tests/lib/points-allocation.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { allocateCheckoutPoints } from "@/lib/points-allocation";

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe("allocateCheckoutPoints", () => {
	it("saldo zero: nessuno sconto", () => {
		expect(allocateCheckoutPoints({ balance: 0, grossCents: [2000] })).toEqual({
			discountCents: [0],
			points: [0],
		});
	});

	it("nessun ordine: liste vuote", () => {
		expect(allocateCheckoutPoints({ balance: 500, grossCents: [] })).toEqual({
			discountCents: [],
			points: [],
		});
	});

	it("saldo che copre tutto: sconto = totale, plafonato", () => {
		const r = allocateCheckoutPoints({ balance: 5000, grossCents: [2000] });
		expect(r).toEqual({ discountCents: [2000], points: [2000] });
	});

	it("saldo parziale con residuo ≥ 0,50 €: usa tutto il saldo", () => {
		const r = allocateCheckoutPoints({ balance: 1000, grossCents: [2000] });
		expect(r).toEqual({ discountCents: [1000], points: [1000] });
	});

	it("residuo tra 0,01 e 0,49 €: usa meno punti e lascia 0,50 €", () => {
		const r = allocateCheckoutPoints({ balance: 1980, grossCents: [2000] });
		expect(r).toEqual({ discountCents: [1950], points: [1950] });
	});

	it("residuo di esattamente 0,50 €: invariato", () => {
		const r = allocateCheckoutPoints({ balance: 1950, grossCents: [2000] });
		expect(r.discountCents).toEqual([1950]);
	});

	it("totale sotto 0,50 € e saldo insufficiente: nessuno sconto", () => {
		const r = allocateCheckoutPoints({ balance: 10, grossCents: [40] });
		expect(r).toEqual({ discountCents: [0], points: [0] });
	});

	it("totale sotto 0,50 € e saldo sufficiente: 0 €", () => {
		const r = allocateCheckoutPoints({ balance: 40, grossCents: [40] });
		expect(r).toEqual({ discountCents: [40], points: [40] });
	});

	it("due negozi: proporzionale al lordo, resti maggiori, somma esatta", () => {
		// 1000 su 2000 + 750: 727,27 → 727 (resto 750), 272,72 → 272 (resto 2000)
		// il centesimo residuo va al resto maggiore (secondo negozio).
		const r = allocateCheckoutPoints({ balance: 1000, grossCents: [2000, 750] });
		expect(r.discountCents).toEqual([727, 273]);
		expect(sum(r.discountCents)).toBe(1000);
		expect(r.points).toEqual([727, 273]);
	});

	it("a parità di resto vince il primo, per determinismo", () => {
		const r = allocateCheckoutPoints({ balance: 101, grossCents: [1000, 1000] });
		expect(r.discountCents).toEqual([51, 50]);
	});

	it("la regola 0,50 € vale sulla somma, non per negozio", () => {
		// Σ 2750, saldo 2730 → residuo 20 → sconto 2700, ripartito.
		const r = allocateCheckoutPoints({ balance: 2730, grossCents: [2000, 750] });
		expect(sum(r.discountCents)).toBe(2700);
		r.discountCents.forEach((d, i) =>
			expect(d).toBeLessThanOrEqual([2000, 750][i]),
		);
	});

	it("nessuna quota supera il lordo del suo ordine", () => {
		for (const balance of [1, 99, 1234, 2749, 2750, 9999]) {
			const gross = [1999, 1, 750];
			const r = allocateCheckoutPoints({ balance, grossCents: gross });
			r.discountCents.forEach((d, i) => {
				expect(d).toBeGreaterThanOrEqual(0);
				expect(d).toBeLessThanOrEqual(gross[i]);
			});
		}
	});
});
```

- [ ] **Step 3: Verifica che fallisca**

Run: `cd apps/api && bun test tests/lib/points-allocation.test.ts`
Expected: FAIL, `Cannot find module '@/lib/points-allocation'`.

- [ ] **Step 4: Implementa** — `apps/api/src/lib/points-allocation.ts`:

```ts
import { config } from "@/lib/config";

/**
 * Quanti punti usare in un checkout e come dividerli tra i suoi ordini «Paga e
 * ritira», dato il lordo di ciascuno (prima dei punti).
 *
 * 1. Sconto massimo: il saldo in centesimi, plafonato alla somma dei lordi.
 * 2. L'importo online resta 0 € oppure ≥ 0,50 € (minimo Stripe): se il residuo
 *    cadrebbe tra 0,01 e 0,49 € si usano meno punti, quanto basta a lasciare
 *    0,50 €. Con saldo sufficiente il passo 1 dà già 0 €.
 * 3. Lo sconto si ripartisce in proporzione al lordo, resti maggiori al
 *    centesimo (a parità vince l'ordine che viene prima): Σ quote = sconto.
 */
export function allocateCheckoutPoints(input: {
	balance: number;
	grossCents: number[];
}): { discountCents: number[]; points: number[] } {
	const { grossCents } = input;
	const total = grossCents.reduce((s, g) => s + g, 0);
	const balanceCents = Math.floor(
		(input.balance * 100) / config.pointsPerEuroDiscount,
	);

	let discount = Math.min(balanceCents, total);
	const residual = total - discount;
	if (residual > 0 && residual < config.stripeMinChargeCents)
		discount = Math.max(0, total - config.stripeMinChargeCents);

	const discountCents = grossCents.map(() => 0);
	if (discount > 0) {
		// Resti interi, non frazioni: due resti uguali devono risultare uguali.
		const shares = grossCents.map((g, i) => {
			const scaled = discount * g;
			const remainder = scaled % total;
			discountCents[i] = (scaled - remainder) / total;
			return { i, remainder };
		});
		let left = discount - discountCents.reduce((s, d) => s + d, 0);
		// Sort stabile: a parità di resto resta l'ordine originale.
		for (const { i } of shares.sort((a, b) => b.remainder - a.remainder)) {
			if (left === 0) break;
			discountCents[i] += 1;
			left -= 1;
		}
	}

	return {
		discountCents,
		points: discountCents.map((d) => (d * config.pointsPerEuroDiscount) / 100),
	};
}
```

- [ ] **Step 5: Verifica che passi**

Run: `cd apps/api && bun test tests/lib/points-allocation.test.ts`
Expected: PASS, 12 test.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/config.ts apps/api/src/lib/points-allocation.ts apps/api/tests/lib/points-allocation.test.ts
git commit -m "feat(points): ripartizione dei punti tra gli ordini del checkout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `placeOrder` → `priceOrder` + `insertOrder` (refactor puro)

**Files:**
- Modify: `apps/api/src/modules/customer/services/orders.ts` (funzione `placeOrder`, righe ~251–575 su `7fe39bd`)
- Test: suite esistente (`tests/integration/customer-orders.test.ts`, `customer-checkout*.test.ts`, `order-cancel-refund.test.ts`) come rete

**Interfaces:**
- Produces:
  ```ts
  export interface PricedOrder {
    customerProfileId: string;
    type: PlaceOrderParams["type"];
    storeId: string;
    shippingAddressId?: string;
    shippingCost: string | null;
    shippingAddressSnapshot: ShippingAddressSnapshot | null;
    totalCents: number;            // lordo, prima dei punti
    resolvedItems: ResolvedItem[];
  }
  export async function priceOrder(tx: OrderTx, params: Omit<PlaceOrderParams, "customerPoints" | "pointsToSpend">): Promise<PricedOrder>
  export async function insertOrder(tx: OrderTx, priced: PricedOrder, opts: { customerPoints: number; pointsToSpend?: number; link?: { idempotencyKey?: string; checkoutId?: string } }): Promise<typeof order.$inferSelect>
  export async function placeOrder(tx, params, link = {})  // invariata: priceOrder + insertOrder
  ```

- [ ] **Step 1: Esegui la suite di riferimento prima del refactor**

Run: `cd apps/api && bun run test:image && bun test tests/integration/customer-orders.test.ts tests/integration/customer-checkout.test.ts tests/integration/customer-checkout-pay.test.ts tests/integration/order-cancel-refund.test.ts --timeout 180000`
Expected: PASS. Annota il numero di test.

- [ ] **Step 2: Estrai il tipo delle righe risolte** sopra `placeOrder`, sostituendo il tipo inline di `resolvedItems`:

```ts
interface ResolvedItem {
	storeProductId: string;
	productId: string;
	productName: string;
	productEan: string | null;
	brandName: string | null;
	productImageUrl: string | null;
	quantity: number;
	unitPrice: string;
	listPrice: string;
	discountPercent: number | null;
	vatRate: string;
	vatAmount: string;
}

/** Un ordine prezzato e validato, non ancora scritto: lordo prima dei punti. */
export interface PricedOrder {
	customerProfileId: string;
	type: PlaceOrderParams["type"];
	storeId: string;
	shippingAddressId?: string;
	shippingCost: string | null;
	shippingAddressSnapshot: ShippingAddressSnapshot | null;
	totalCents: number;
	resolvedItems: ResolvedItem[];
}
```

- [ ] **Step 3: Crea `priceOrder`** spostando in essa, **senza cambiarlo**, il corpo di `placeOrder` dall'inizio (guardia `direct`) fino alla fine del ciclo `for (const item of items)` incluso. Firma e ritorno:

```ts
/**
 * Prima metà di placeOrder: valida (tipo, indirizzo, negozio vendibile,
 * prodotti, stock) e prezza le righe con gli sconti venditore. Solo letture:
 * l'anteprima del checkout la chiama senza scrivere niente.
 */
export async function priceOrder(
	tx: OrderTx,
	params: Omit<PlaceOrderParams, "customerPoints" | "pointsToSpend">,
): Promise<PricedOrder> {
	const { customerProfileId, type, storeId, items, shippingAddressId } = params;
	// … codice spostato da placeOrder, identico …
	return {
		customerProfileId,
		type,
		storeId,
		shippingAddressId,
		shippingCost,
		shippingAddressSnapshot,
		totalCents,
		resolvedItems,
	};
}
```

- [ ] **Step 4: Crea `insertOrder`** col resto del corpo (dal blocco «Points discount» fino a `return newOrder`), che legge i valori da `priced`:

```ts
/**
 * Seconda metà di placeOrder: sconto punti, castelletto, insert di ordine e
 * righe, scalo di stock e punti (CAS). I punti valgono solo su pay_pickup.
 */
export async function insertOrder(
	tx: OrderTx,
	priced: PricedOrder,
	opts: {
		customerPoints: number;
		pointsToSpend?: number;
		link?: { idempotencyKey?: string; checkoutId?: string };
	},
) {
	const {
		customerProfileId,
		type,
		storeId,
		shippingAddressId,
		shippingCost,
		shippingAddressSnapshot,
		totalCents,
		resolvedItems,
	} = priced;
	const { customerPoints, pointsToSpend = 0, link = {} } = opts;
	// … codice spostato da placeOrder, identico …
}
```

- [ ] **Step 5: Riscrivi `placeOrder`** come composizione:

```ts
export async function placeOrder(
	tx: OrderTx,
	params: PlaceOrderParams,
	link: { idempotencyKey?: string; checkoutId?: string } = {},
) {
	const { customerPoints, pointsToSpend, ...rest } = params;
	const priced = await priceOrder(tx, rest);
	return insertOrder(tx, priced, { customerPoints, pointsToSpend, link });
}
```

- [ ] **Step 6: Typecheck e suite**

Run: `cd apps/api && bun run typecheck && bun test tests/integration/customer-orders.test.ts tests/integration/customer-checkout.test.ts tests/integration/customer-checkout-pay.test.ts tests/integration/order-cancel-refund.test.ts --timeout 180000`
Expected: typecheck pulito; stessi test di Step 1, tutti PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/customer/services/orders.ts
git commit -m "refactor(api): placeOrder in priceOrder e insertOrder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `createCheckout` con `usePoints` e checkout a 0 €

**Files:**
- Modify: `apps/api/src/modules/customer/services/checkout.ts`
- Modify: `apps/api/src/modules/customer/routes/checkout.ts` (body del POST)
- Create: `apps/api/tests/integration/customer-checkout-points.test.ts`

**Interfaces:**
- Consumes: `priceOrder`, `insertOrder`, `PricedOrder` (Task 2); `allocateCheckoutPoints` (Task 1).
- Produces:
  ```ts
  export interface CheckoutStoreChoice { storeId: string; type: "reserve_pickup" | "pay_pickup" }
  export async function resolveCheckoutLines(tx: OrderTx, p: { customerProfileId: string; stores: CheckoutStoreChoice[]; lock: boolean }): Promise<{ choice: CheckoutStoreChoice; buyable: { id: string; storeProductId: string; quantity: number }[] }[]>
  export async function priceCheckout(tx: OrderTx, p: { customerProfileId: string; customerPoints: number; usePoints: boolean; resolved: Awaited<ReturnType<typeof resolveCheckoutLines>> }): Promise<{ choice: CheckoutStoreChoice; buyable: …; priced: PricedOrder; points: number; discountCents: number }[]>
  CreateCheckoutParams += usePoints?: boolean
  ```
  In questo task il checkout a 0 € conferma gli ordini ma **non** fa ancora partire la quota punti: la chiamata a `transferStorePayouts` arriva nel Task 4, insieme alla funzione.

- [ ] **Step 1: Scrivi i test che falliscono** — `apps/api/tests/integration/customer-checkout-points.test.ts`. Intestazione e mock come `customer-checkout-pay.test.ts`, più `transfers` e `refunds`:

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
let transferSeq = 0;
const transfersCreate = mock(async (p: any, _o?: any) => ({
	id: `tr_${++transferSeq}`,
	amount: p.amount,
}));
const createReversal = mock(async (_id: string, _p: any, _o?: any) => ({
	id: "trr_1",
}));
const refundsCreate = mock(async (_p: any, _o?: any) => ({ id: "re_1" }));

mock.module("@/lib/stripe", () => ({
	stripe: {
		paymentIntents: {
			create: paymentIntentsCreate,
			retrieve: paymentIntentsRetrieve,
		},
		transfers: { create: transfersCreate, createReversal },
		refunds: { create: refundsCreate },
	},
}));

import { eq } from "drizzle-orm";
import { customerProfile } from "@/db/schemas/customer";
import { order } from "@/db/schemas/order";
import { pointTransaction } from "@/db/schemas/points";
import { expireUnpaidOrders } from "@/lib/jobs/expire-unpaid-orders";
import { createCheckout } from "@/modules/customer/services/checkout";
import { cancelOrder } from "@/modules/customer/services/orders";
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
	for (const m of [
		paymentIntentsCreate,
		paymentIntentsRetrieve,
		transfersCreate,
		createReversal,
		refundsCreate,
	])
		m.mockClear();
	transferSeq = 0;
});

async function sellable(sellerProfileId: string, name: string, price: string) {
	const db = getTestDb();
	const store = await createTestStore(db, sellerProfileId, { name });
	await createTestStoreSubscription(db, store.id);
	const product = await createTestProduct(db, sellerProfileId, { price });
	const sp = await createTestStoreProduct(db, store.id, product.id, { stock: 5 });
	return { store, sp };
}

/** Due PR2 (20,00 € e 7,50 €) e una prenotazione (4,00 €). */
async function cart(points: number) {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const customer = await createTestCustomer(db, { points });
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
	await createTestCartItem(db, customer.profile.id, reserve.sp.id, { quantity: 1 });
	return { customer, pay1, pay2, reserve };
}

const balanceOf = async (customerProfileId: string) =>
	(
		await getTestDb()
			.select({ points: customerProfile.points })
			.from(customerProfile)
			.where(eq(customerProfile.id, customerProfileId))
	)[0].points;

describe("checkout con i punti", () => {
	it("due PR2: punti ripartiti, un PI sul netto, registro scalato", async () => {
		const { customer, pay1, pay2 } = await cart(1000);
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 1000,
			idempotencyKey: crypto.randomUUID(),
			usePoints: true,
			stores: [
				{ storeId: pay1.store.id, type: "pay_pickup" },
				{ storeId: pay2.store.id, type: "pay_pickup" },
			],
		});

		expect(paymentIntentsCreate).toHaveBeenCalledTimes(1);
		expect(paymentIntentsCreate.mock.calls[0][0].amount).toBe(1750);
		expect(result.amountDueOnline).toBe("17.50");
		const byStore = Object.fromEntries(result.orders.map((o) => [o.storeId, o]));
		expect(byStore[pay1.store.id]).toMatchObject({
			total: "12.73",
			pointsSpent: 727,
			status: "pending",
		});
		expect(byStore[pay2.store.id]).toMatchObject({
			total: "4.77",
			pointsSpent: 273,
			status: "pending",
		});
		expect(await balanceOf(customer.profile.id)).toBe(0);
		const ledger = await getTestDb()
			.select()
			.from(pointTransaction)
			.where(eq(pointTransaction.customerProfileId, customer.profile.id));
		expect(ledger.map((l) => l.amount).sort()).toEqual([-273, -727]);
	});

	it("usePoints assente: nessun punto speso", async () => {
		const { customer, pay1 } = await cart(1000);
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 1000,
			idempotencyKey: crypto.randomUUID(),
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
		});
		expect(result.orders[0].pointsSpent).toBe(0);
		expect(await balanceOf(customer.profile.id)).toBe(1000);
	});

	it("usePoints con sole prenotazioni: ignorato, nessun errore", async () => {
		const { customer, reserve } = await cart(1000);
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 1000,
			idempotencyKey: crypto.randomUUID(),
			usePoints: true,
			stores: [{ storeId: reserve.store.id, type: "reserve_pickup" }],
		});
		expect(result.orders[0]).toMatchObject({ pointsSpent: 0, total: "4.00" });
		expect(await balanceOf(customer.profile.id)).toBe(1000);
	});

	it("misto: la prenotazione non usa punti, il PR2 sì", async () => {
		const { customer, pay2, reserve } = await cart(300);
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 300,
			idempotencyKey: crypto.randomUUID(),
			usePoints: true,
			stores: [
				{ storeId: pay2.store.id, type: "pay_pickup" },
				{ storeId: reserve.store.id, type: "reserve_pickup" },
			],
		});
		const byStore = Object.fromEntries(result.orders.map((o) => [o.storeId, o]));
		expect(byStore[pay2.store.id]).toMatchObject({ total: "4.50", pointsSpent: 300 });
		expect(byStore[reserve.store.id]).toMatchObject({ total: "4.00", pointsSpent: 0 });
	});

	it("residuo sotto 0,50 €: il PI resta a 0,50 €", async () => {
		const { customer, pay1 } = await cart(1980);
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 1980,
			idempotencyKey: crypto.randomUUID(),
			usePoints: true,
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
		});
		expect(paymentIntentsCreate.mock.calls[0][0].amount).toBe(50);
		expect(result.orders[0]).toMatchObject({ total: "0.50", pointsSpent: 1950 });
		expect(await balanceOf(customer.profile.id)).toBe(30);
	});

	it("a 0 €: nessun PI, PR2 confermati subito, il cron delle scadenze non li tocca", async () => {
		const { customer, pay1, pay2 } = await cart(5000);
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 5000,
			idempotencyKey: crypto.randomUUID(),
			usePoints: true,
			stores: [
				{ storeId: pay1.store.id, type: "pay_pickup" },
				{ storeId: pay2.store.id, type: "pay_pickup" },
			],
		});
		expect(paymentIntentsCreate).not.toHaveBeenCalled();
		expect(result.payment).toBeNull();
		expect(result.amountDueOnline).toBe("0.00");
		for (const o of result.orders) {
			expect(o).toMatchObject({ status: "confirmed", total: "0.00" });
			expect(o.paymentExpiresAt).toBeNull();
		}
		expect(await balanceOf(customer.profile.id)).toBe(2250);

		await expireUnpaidOrders(new Date(Date.now() + 24 * 3600 * 1000));
		const rows = await getTestDb().select().from(order);
		expect(rows.every((o) => o.status === "confirmed")).toBe(true);
	});

	it("saldo sceso dopo la lettura (altra scheda): 409, nessun ordine", async () => {
		const { customer, pay1 } = await cart(0);
		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 1000, // foto vecchia
				idempotencyKey: crypto.randomUUID(),
				usePoints: true,
				stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
			}),
		).rejects.toMatchObject({ status: 409 });
		expect(await getTestDb().select().from(order)).toHaveLength(0);
	});

	it("stessa key con usePoints diverso: restituisce il checkout già creato", async () => {
		const { customer, pay1 } = await cart(1000);
		const key = crypto.randomUUID();
		const first = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 1000,
			idempotencyKey: key,
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
		});
		const again = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 1000,
			idempotencyKey: key,
			usePoints: true,
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
		});
		expect(again.id).toBe(first.id);
		expect(again.orders[0].pointsSpent).toBe(0);
		expect(await balanceOf(customer.profile.id)).toBe(1000);
	});
});
```

- [ ] **Step 2: Verifica che falliscano**

Run: `cd apps/api && bun run test:image && bun test tests/integration/customer-checkout-points.test.ts --timeout 180000`
Expected: FAIL — typecheck/`usePoints` sconosciuto e punti mai spesi (`pointsSpent` 0, PI da 2750).

- [ ] **Step 3: Estrai `resolveCheckoutLines`** in `checkout.ts`. Sposta la query delle righe e i tre controlli per negozio dal corpo della tx di `createCheckout`:

```ts
import type { OrderTx, PricedOrder } from "./orders";
import { insertOrder, listCustomerOrders, priceOrder } from "./orders";
import { allocateCheckoutPoints } from "@/lib/points-allocation";

export interface CheckoutStoreChoice {
	storeId: string;
	type: "reserve_pickup" | "pay_pickup";
}

/**
 * Le righe del carrello per i negozi scelti, con gli stessi rifiuti per
 * conferma e anteprima: negozio senza articoli acquistabili (409), modalità
 * non offerta (400), stock insufficiente (409). Con `lock` le righe si
 * bloccano: due conferme concorrenti non leggono le stesse righe.
 */
export async function resolveCheckoutLines(
	tx: OrderTx,
	p: { customerProfileId: string; stores: CheckoutStoreChoice[]; lock: boolean },
) {
	const storeIds = p.stores.map((s) => s.storeId);
	if (new Set(storeIds).size !== storeIds.length)
		throw new ServiceError(400, "Ogni negozio può comparire una sola volta");

	const query = tx
		.select({
			id: cartItem.id,
			storeProductId: cartItem.storeProductId,
			quantity: cartItem.quantity,
			stock: storeProduct.stock,
			productStatus: product.status,
			storeId: store.id,
			storeName: store.name,
			orderTypes: store.orderTypes,
			chargesEnabled: sellerChargesEnabledSql,
		})
		.from(cartItem)
		.innerJoin(storeProduct, eq(storeProduct.id, cartItem.storeProductId))
		.innerJoin(product, eq(product.id, storeProduct.productId))
		.innerJoin(store, eq(store.id, storeProduct.storeId))
		.where(
			and(
				eq(cartItem.customerProfileId, p.customerProfileId),
				inArray(store.id, storeIds),
				publiclyVisibleStore(),
			),
		)
		.$dynamic();
	// Due checkout dello stesso cliente (due schede, chiavi diverse) non
	// devono leggere le stesse righe: il secondo aspetta il primo e poi
	// non le trova più → 409, invece di un ordine doppio.
	const lines = p.lock
		? await query.for("update", { of: cartItem })
		: await query;

	return p.stores.map((choice) => {
		const own = lines.filter((l) => l.storeId === choice.storeId);
		const buyable = own.filter((l) => l.productStatus === "active");
		if (buyable.length === 0)
			throw new ServiceError(
				409,
				"Il carrello è cambiato: questo negozio non ha più articoli acquistabili",
			);
		if (
			!offeredOrderTypes(own[0].orderTypes, {
				chargesEnabled: own[0].chargesEnabled,
			}).includes(choice.type)
		)
			throw new ServiceError(
				400,
				`${own[0].storeName} non offre questa modalità d'acquisto`,
			);
		if (buyable.some((l) => l.stock < l.quantity))
			throw new ServiceError(
				409,
				"Il carrello è cambiato: alcune quantità non sono più disponibili",
			);
		return {
			choice,
			buyable: buyable.map((l) => ({
				id: l.id,
				storeProductId: l.storeProductId,
				quantity: l.quantity,
			})),
		};
	});
}
```

Rimuovi il controllo dei duplicati da `createCheckout` (ora vive qui). Esporta `OrderTx` da `orders.ts` se non lo è già (lo è: `export type OrderTx`).

- [ ] **Step 4: Aggiungi `priceCheckout`**, condiviso da conferma e anteprima:

```ts
/**
 * Prezza ogni negozio e, se il cliente usa i punti, li ripartisce tra i PR2
 * (allocateCheckoutPoints). Solo letture: la conferma inserisce dopo,
 * l'anteprima si ferma qui.
 */
export async function priceCheckout(
	tx: OrderTx,
	p: {
		customerProfileId: string;
		customerPoints: number;
		usePoints: boolean;
		resolved: Awaited<ReturnType<typeof resolveCheckoutLines>>;
	},
) {
	const priced: PricedOrder[] = [];
	for (const r of p.resolved)
		priced.push(
			await priceOrder(tx, {
				customerProfileId: p.customerProfileId,
				type: r.choice.type,
				storeId: r.choice.storeId,
				items: r.buyable.map((l) => ({
					storeProductId: l.storeProductId,
					quantity: l.quantity,
				})),
			}),
		);

	const payIdx = priced.flatMap((o, i) => (o.type === "pay_pickup" ? [i] : []));
	const allocation = allocateCheckoutPoints({
		balance: p.usePoints ? p.customerPoints : 0,
		grossCents: payIdx.map((i) => priced[i].totalCents),
	});
	const points = priced.map(() => 0);
	const discountCents = priced.map(() => 0);
	payIdx.forEach((i, k) => {
		points[i] = allocation.points[k];
		discountCents[i] = allocation.discountCents[k];
	});

	return p.resolved.map((r, i) => ({
		...r,
		priced: priced[i],
		points: points[i],
		discountCents: discountCents[i],
	}));
}
```

- [ ] **Step 5: Riscrivi il corpo della tx di `createCheckout`** (dopo l'insert della riga `checkout`):

```ts
			const resolved = await resolveCheckoutLines(tx, {
				customerProfileId,
				stores,
				lock: true,
			});
			const plan = await priceCheckout(tx, {
				customerProfileId,
				customerPoints,
				usePoints,
				resolved,
			});

			let amountDueCents = 0;
			let hasPay = false;
			for (const step of plan) {
				const placed = await insertOrder(tx, step.priced, {
					customerPoints,
					pointsToSpend: step.points,
					link: { checkoutId: row.id },
				});
				if (placed.type === "pay_pickup") {
					hasPay = true;
					amountDueCents += toCents(placed.total);
				}

				const removed = await tx
					.delete(cartItem)
					.where(
						and(
							eq(cartItem.customerProfileId, customerProfileId),
							inArray(
								cartItem.id,
								step.buyable.map((l) => l.id),
							),
						),
					)
					.returning({ id: cartItem.id });
				// Rete di sicurezza del lock: se le righe ordinate non sono più
				// tutte lì, qualcun altro le ha già consumate.
				if (removed.length !== step.buyable.length)
					throw new ServiceError(
						409,
						"Il carrello è cambiato: alcune quantità non sono più disponibili",
					);
			}

			if (amountDueCents > 0) {
				// … blocco createCheckoutPaymentIntent invariato …
			} else if (hasPay) {
				// Tutto coperto dai punti: niente da incassare, niente PaymentIntent.
				// I PR2 si confermano qui, senza finestra di pagamento: il cron
				// delle scadenze guarda solo i pending e non li tocca.
				await tx
					.update(order)
					.set({ status: "confirmed", paymentExpiresAt: null })
					.where(
						and(
							eq(order.checkoutId, row.id),
							eq(order.type, "pay_pickup"),
						),
					);
			}

			return row.id;
```

Aggiungi `usePoints?: boolean` a `CreateCheckoutParams`, destrutturalo con default `false`, e importa `order` da `@/db/schemas/order`. Aggiorna il JSDoc di `createCheckout` con una riga: «Con `usePoints` i punti si ripartiscono tra i PR2 (allocateCheckoutPoints); se coprono tutto, i PR2 nascono confermati senza PaymentIntent.»

- [ ] **Step 6: Body del POST** in `routes/checkout.ts`, dopo `stores`:

```ts
				usePoints: t.Optional(
					t.Boolean({
						description:
							"Usa i punti sugli ordini Paga e ritira: il server decide quanti (saldo, regola 0 € o almeno 0,50 €) e li ripartisce tra i negozi",
					}),
				),
```

e aggiungi alla `description` del POST: «Con `usePoints` gli ordini Paga e ritira possono arrivare a 0 €: in quel caso nascono confermati e `payment` è null.»

- [ ] **Step 7: Verifica**

Run: `cd apps/api && bun run typecheck && bun test tests/integration/customer-checkout-points.test.ts tests/integration/customer-checkout.test.ts tests/integration/customer-checkout-pay.test.ts --timeout 180000`
Expected: tutti PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/customer/services/checkout.ts apps/api/src/modules/customer/routes/checkout.ts apps/api/tests/integration/customer-checkout-points.test.ts
git commit -m "feat(api): punti nel checkout, ripartiti tra i negozi Paga e ritira

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `transferStorePayouts` e trasferimenti senza PaymentIntent

**Files:**
- Modify: `apps/api/src/modules/billing/services/order-payments.ts`
- Modify: `apps/api/src/modules/customer/services/checkout.ts`
- Modify: `apps/api/src/lib/jobs/retry-store-transfers.ts`
- Test: `apps/api/tests/integration/customer-checkout-points.test.ts`, `apps/api/tests/integration/job-retry-store-transfers.test.ts`

**Interfaces:**
- Consumes: `createCheckout` del Task 3.
- Produces: `export async function transferStorePayouts(checkoutId: string, chargeId: string | null): Promise<string[]>` — restituisce gli id degli ordini il cui trasferimento non è riuscito; non lancia per errori Stripe.

- [ ] **Step 1: Test che falliscono.** In `customer-checkout-points.test.ts` aggiungi:

```ts
	it("a 0 €: parte solo la quota punti, dal saldo bibs", async () => {
		const { customer, pay1 } = await cart(5000);
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 5000,
			idempotencyKey: crypto.randomUUID(),
			usePoints: true,
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
		});
		const o = result.orders[0];
		expect(transfersCreate).toHaveBeenCalledTimes(1);
		const [params, opts] = transfersCreate.mock.calls[0];
		// lordo 20,00 − commissione 1,00 = 19,00, tutto dal saldo bibs
		expect(params.amount).toBe(1900);
		expect(params.source_transaction).toBeUndefined();
		expect(params.transfer_group).toBe(result.id);
		expect(opts).toEqual({ idempotencyKey: `points-transfer:${o.id}` });
		const [row] = await getTestDb().select().from(order).where(eq(order.id, o.id));
		expect(row.stripePointsTransferId).toBe("tr_1");
		expect(row.stripeTransferId).toBeNull();
	});

	it("a 0 € con trasferimento rifiutato: checkout riuscito, quota in sospeso", async () => {
		const { customer, pay1 } = await cart(5000);
		transfersCreate.mockImplementationOnce(async () => {
			throw new Error("insufficient balance");
		});
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 5000,
			idempotencyKey: crypto.randomUUID(),
			usePoints: true,
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
		});
		expect(result.orders[0].status).toBe("confirmed");
		const [row] = await getTestDb()
			.select()
			.from(order)
			.where(eq(order.id, result.orders[0].id));
		expect(row.stripePointsTransferId).toBeNull();
	});

	it("annullare un ordine di un checkout a 0 €: tornano solo i suoi punti", async () => {
		const { customer, pay1, pay2 } = await cart(5000);
		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 5000,
			idempotencyKey: crypto.randomUUID(),
			usePoints: true,
			stores: [
				{ storeId: pay1.store.id, type: "pay_pickup" },
				{ storeId: pay2.store.id, type: "pay_pickup" },
			],
		});
		expect(await balanceOf(customer.profile.id)).toBe(2250);
		const o2 = result.orders.find((o) => o.storeId === pay2.store.id)!;

		await cancelOrder({ orderId: o2.id, customerProfileId: customer.profile.id });

		expect(await balanceOf(customer.profile.id)).toBe(3000);
		expect(refundsCreate).not.toHaveBeenCalled(); // pagato 0 €
		expect(createReversal).toHaveBeenCalledTimes(1);
		// quota punti di o2: 7,50 − commissione 0,38 = 7,12
		expect(createReversal.mock.calls[0][1].amount).toBe(712);
	});
```

In `job-retry-store-transfers.test.ts` aggiungi:

```ts
	it("checkout a 0 € senza PaymentIntent: ritenta la quota punti senza interrogare Stripe sul PI", async () => {
		const o = await seedPaid({ total: "0.00", pointsDiscount: "20.00", platformFee: "1.00", stripeTransferId: null });
		await getTestDb()
			.update(checkout)
			.set({ stripePaymentIntentId: null, amountDueOnline: "0" })
			.where(eq(checkout.id, o.checkoutId as string));

		expect(await retryStoreTransfers()).toBe(1);
		expect(paymentIntentsRetrieve).not.toHaveBeenCalled();
		expect(transfersCreate).toHaveBeenCalledTimes(1);
		expect(transfersCreate.mock.calls[0][0]).toMatchObject({ amount: 1900 });
		expect(transfersCreate.mock.calls[0][0].source_transaction).toBeUndefined();
		expect((await reload(o.id)).stripePointsTransferId).toMatch(/^tr_/);
	});
```

- [ ] **Step 2: Verifica che falliscano**

Run: `cd apps/api && bun run test:image && bun test tests/integration/customer-checkout-points.test.ts tests/integration/job-retry-store-transfers.test.ts --timeout 180000`
Expected: FAIL — nessun trasferimento a 0 € (`transfersCreate` 0 chiamate), cron che salta i checkout senza PI.

- [ ] **Step 3: Estrai `transferStorePayouts`** in `order-payments.ts`. Sposta la query `payable` e il ciclo `for (const o of payable)` di `settleCheckoutPayment` in:

```ts
/**
 * I trasferimenti ai negozi dei PR2 pagati di un checkout che non li hanno
 * ancora (pagato con source_transaction, quota punti dal saldo bibs), con key
 * per ordine: rieseguibile. `chargeId` null = checkout coperto dai punti,
 * senza incasso: c'è solo la quota punti. Non lancia per errori Stripe:
 * restituisce gli ordini rimasti indietro, li ritenta il chiamante o il cron.
 */
export async function transferStorePayouts(
	checkoutId: string,
	chargeId: string | null,
): Promise<string[]> {
	const ofCheckout = and(
		eq(order.checkoutId, checkoutId),
		eq(order.type, "pay_pickup"),
	);
	// … query `payable` invariata (usa ofCheckout) …
	const transferFailed: string[] = [];
	for (const o of payable) {
		// … calcolo split e controllo destination invariati …
		try {
			if (split.fromCharge > 0 && !chargeId)
				throw new Error(
					`Ordine ${o.id}: quota pagata senza charge da cui trasferirla`,
				);
			// … le due transazioni invariate; nella prima `source_transaction:
			// chargeId` (qui sicuramente non null perché fromCharge > 0) …
		} catch (err) {
			logger.error({ err, orderId: o.id }, "stripe.transfers.create failed");
			transferFailed.push(o.id);
		}
	}
	return transferFailed;
}
```

Sostituisci `co.id` con `checkoutId` nel codice spostato. In `settleCheckoutPayment`, al posto del blocco spostato:

```ts
	const transferFailed = await transferStorePayouts(co.id, chargeId);
```

Il blocco finale che compone l'errore resta invariato.

- [ ] **Step 4: Chiama il trasferimento dopo il checkout a 0 €** in `createCheckout`. La tx restituisce `{ id: row.id, zeroDue: hasPay && amountDueCents === 0 }`; nel `.catch` dell'idempotenza restituisci `{ id: winner.id, zeroDue: false }`. Dopo:

```ts
	const { id, zeroDue } = await created;
	// Fuori dalla tx: Stripe non si chiama con le righe ancora non committate.
	// Un fallimento non tocca il cliente (gli ordini sono confermati): la quota
	// punti la ritenta retryStoreTransfers.
	if (zeroDue) {
		const failed = await transferStorePayouts(id, null);
		if (failed.length > 0)
			logger.error(
				{ checkoutId: id, orderIds: failed },
				"Quota punti al negozio rimasta in sospeso: la ritenta il cron",
			);
	}
	return getCheckout({ checkoutId: id, customerProfileId });
```

Importa `transferStorePayouts` da `@/modules/billing/services/order-payments` e `logger` da `@/lib/logger`.

- [ ] **Step 5: `retryStoreTransfers` senza PI.** Seleziona anche il checkout e togli il filtro sul PI:

```ts
	const rows = await db
		.selectDistinct({
			checkoutId: checkout.id,
			paymentIntentId: checkout.stripePaymentIntentId,
		})
		.from(order)
		.innerJoin(checkout, eq(checkout.id, order.checkoutId))
		.where(
			and(
				eq(order.type, "pay_pickup"),
				inArray(order.status, ["confirmed", "ready_for_pickup", "completed"]),
				sql`( … condizione invariata … )`,
			),
		);

	let count = 0;
	for (const { checkoutId, paymentIntentId } of rows) {
		try {
			if (paymentIntentId) {
				const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
				if (pi.status !== "succeeded") continue;
				await settleCheckoutPayment(pi);
			} else {
				// Checkout coperto dai punti: nessun incasso, solo la quota punti.
				const failed = await transferStorePayouts(checkoutId, null);
				if (failed.length > 0)
					throw new Error(`trasferimenti non riusciti per gli ordini ${failed.join(", ")}`);
			}
			count++;
		} catch (err) {
			logger.error(
				{ err, checkoutId, paymentIntentId },
				"Trasferimenti al negozio ancora in sospeso: si riprova al prossimo giro",
			);
		}
	}
	return count;
```

Togli `isNotNull` dagli import se non usato più; aggiorna il JSDoc: «… o un checkout coperto dai punti, senza PaymentIntent: lì si passa direttamente a transferStorePayouts.»

- [ ] **Step 6: Verifica**

Run: `cd apps/api && bun run typecheck && bun test tests/integration/customer-checkout-points.test.ts tests/integration/job-retry-store-transfers.test.ts tests/integration/stripe-webhook-checkout-completed.test.ts tests/integration/order-cancel-refund.test.ts tests/integration/job-expire-unpaid-orders.test.ts --timeout 180000`
Expected: tutti PASS (il test «parità con storePayoutSplit» resta verde: i suoi checkout hanno tutti il PI).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/billing/services/order-payments.ts apps/api/src/modules/customer/services/checkout.ts apps/api/src/lib/jobs/retry-store-transfers.ts apps/api/tests/integration/customer-checkout-points.test.ts apps/api/tests/integration/job-retry-store-transfers.test.ts
git commit -m "feat(api): checkout coperto dai punti confermato senza Stripe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: anteprima `GET /customer/checkout/preview`

**Files:**
- Modify: `apps/api/src/modules/customer/services/checkout.ts`
- Modify: `apps/api/src/modules/customer/routes/checkout.ts`
- Modify: `apps/api/src/lib/schemas/composed.ts`, `apps/api/src/lib/schemas/entities.ts`
- Test: `apps/api/tests/integration/customer-checkout-points.test.ts`

**Interfaces:**
- Consumes: `resolveCheckoutLines`, `priceCheckout` (Task 3).
- Produces:
  ```ts
  export function parseStoresParam(raw: string): CheckoutStoreChoice[]  // 400 se malformato o vuoto
  export async function previewCheckout(p: { customerProfileId: string; customerPoints: number; stores: CheckoutStoreChoice[] }): Promise<CheckoutPreview>
  type CheckoutPreview = {
    balance: number;
    payInStore: string;
    withoutPoints: { amountDueOnline: string };
    withPoints: { pointsSpent: number; discount: string; amountDueOnline: string; perStore: { storeId: string; pointsSpent: number; discount: string }[] } | null;
  }
  ```
  Eden lato FE: `api().customer.checkout.preview.get({ query: { stores } })`. `OrderSchema` espone `pointsDiscount: string`.

- [ ] **Step 1: Test che falliscono** in `customer-checkout-points.test.ts`. Aggiungi agli import `parseStoresParam, previewCheckout` e:

```ts
describe("anteprima del checkout", () => {
	it("parità: la preview prevede esattamente gli ordini creati", async () => {
		const { customer, pay1, pay2, reserve } = await cart(1000);
		const stores = [
			{ storeId: pay1.store.id, type: "pay_pickup" as const },
			{ storeId: pay2.store.id, type: "pay_pickup" as const },
			{ storeId: reserve.store.id, type: "reserve_pickup" as const },
		];
		const preview = await previewCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 1000,
			stores,
		});
		expect(preview).toEqual({
			balance: 1000,
			payInStore: "4.00",
			withoutPoints: { amountDueOnline: "27.50" },
			withPoints: {
				pointsSpent: 1000,
				discount: "10.00",
				amountDueOnline: "17.50",
				perStore: [
					{ storeId: pay1.store.id, pointsSpent: 727, discount: "7.27" },
					{ storeId: pay2.store.id, pointsSpent: 273, discount: "2.73" },
				],
			},
		});

		const created = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 1000,
			idempotencyKey: crypto.randomUUID(),
			usePoints: true,
			stores,
		});
		expect(created.amountDueOnline).toBe(preview.withPoints!.amountDueOnline);
		for (const s of preview.withPoints!.perStore) {
			const o = created.orders.find((x) => x.storeId === s.storeId)!;
			expect(o.pointsSpent).toBe(s.pointsSpent);
			expect(o.pointsDiscount).toBe(s.discount);
		}
	});

	it("non scrive niente: carrello, stock e saldo intatti", async () => {
		const { customer, pay1 } = await cart(1000);
		await previewCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 1000,
			stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
		});
		expect(await getTestDb().select().from(order)).toHaveLength(0);
		expect(await balanceOf(customer.profile.id)).toBe(1000);
	});

	it("withPoints null senza PR2 o con saldo zero", async () => {
		const a = await cart(1000);
		expect(
			(
				await previewCheckout({
					customerProfileId: a.customer.profile.id,
					customerPoints: 1000,
					stores: [{ storeId: a.reserve.store.id, type: "reserve_pickup" }],
				})
			).withPoints,
		).toBeNull();
		await truncateAll(getTestDb());
		const b = await cart(0);
		expect(
			(
				await previewCheckout({
					customerProfileId: b.customer.profile.id,
					customerPoints: 0,
					stores: [{ storeId: b.pay1.store.id, type: "pay_pickup" }],
				})
			).withPoints,
		).toBeNull();
	});

	it("rifiuta come la conferma: modalità non offerta 400, negozio senza righe 409", async () => {
		const { customer, reserve, pay1 } = await cart(1000);
		await expect(
			previewCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 1000,
				stores: [{ storeId: reserve.store.id, type: "pay_pickup" }],
			}),
		).rejects.toMatchObject({ status: 400 });
		await getTestDb().delete(cartItem).where(eq(cartItem.storeProductId, pay1.sp.id));
		await expect(
			previewCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 1000,
				stores: [{ storeId: pay1.store.id, type: "pay_pickup" }],
			}),
		).rejects.toMatchObject({ status: 409 });
	});
});

describe("parseStoresParam", () => {
	it("legge il formato di serializeChoice", () => {
		expect(parseStoresParam("a:pay_pickup,b:reserve_pickup")).toEqual([
			{ storeId: "a", type: "pay_pickup" },
			{ storeId: "b", type: "reserve_pickup" },
		]);
	});
	it("400 su vuoto, tipo sconosciuto o coppia rotta", () => {
		for (const raw of ["", "a:direct", "a", ":pay_pickup"])
			expect(() => parseStoresParam(raw)).toThrow(
				expect.objectContaining({ status: 400 }),
			);
	});
});
```

Aggiungi `import { cartItem } from "@/db/schemas/cart";` in testa.

- [ ] **Step 2: Verifica che falliscano**

Run: `cd apps/api && bun run test:image && bun test tests/integration/customer-checkout-points.test.ts --timeout 180000`
Expected: FAIL, `previewCheckout`/`parseStoresParam` non esportati.

- [ ] **Step 3: Implementa** in `checkout.ts`:

```ts
const CHECKOUT_TYPES = ["reserve_pickup", "pay_pickup"] as const;

/** `storeId:type,storeId:type` (il formato della scelta nel customer). */
export function parseStoresParam(raw: string): CheckoutStoreChoice[] {
	const stores = raw
		.split(",")
		.filter(Boolean)
		.map((pair) => {
			const [storeId, type] = pair.split(":");
			if (
				!storeId ||
				!CHECKOUT_TYPES.includes(type as CheckoutStoreChoice["type"])
			)
				throw new ServiceError(400, "Scelta dei negozi non valida");
			return { storeId, type: type as CheckoutStoreChoice["type"] };
		});
	if (stores.length === 0)
		throw new ServiceError(400, "Scelta dei negozi non valida");
	return stores;
}

/**
 * Gli importi del checkout prima della conferma, con e senza punti, calcolati
 * dalle stesse funzioni di createCheckout (righe, prezzi, ripartizione): la
 * conferma con `usePoints` produce esattamente `withPoints`. Solo letture.
 */
export async function previewCheckout(p: {
	customerProfileId: string;
	customerPoints: number;
	stores: CheckoutStoreChoice[];
}) {
	return db.transaction(async (tx) => {
		const resolved = await resolveCheckoutLines(tx, {
			customerProfileId: p.customerProfileId,
			stores: p.stores,
			lock: false,
		});
		const plan = await priceCheckout(tx, {
			customerProfileId: p.customerProfileId,
			customerPoints: p.customerPoints,
			usePoints: true,
			resolved,
		});
		const pay = plan.filter((s) => s.priced.type === "pay_pickup");
		const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
		const grossPay = sum(pay.map((s) => s.priced.totalCents));
		const discount = sum(pay.map((s) => s.discountCents));
		return {
			balance: p.customerPoints,
			payInStore: fromCents(
				sum(
					plan
						.filter((s) => s.priced.type === "reserve_pickup")
						.map((s) => s.priced.totalCents),
				),
			),
			withoutPoints: { amountDueOnline: fromCents(grossPay) },
			withPoints:
				discount > 0
					? {
							pointsSpent: sum(pay.map((s) => s.points)),
							discount: fromCents(discount),
							amountDueOnline: fromCents(grossPay - discount),
							perStore: pay.map((s) => ({
								storeId: s.choice.storeId,
								pointsSpent: s.points,
								discount: fromCents(s.discountCents),
							})),
						}
					: null,
		};
	});
}
```

- [ ] **Step 4: Schemi.** In `entities.ts`, in `OrderSchema` dopo `pointsSpent`:

```ts
	pointsDiscount: t.String({
		description: "Sconto punti in euro, coperto da bibs (0 se nessun punto)",
	}),
```

In `composed.ts`, dopo `CheckoutSchema`:

```ts
export const CheckoutPreviewSchema = t.Object({
	balance: t.Number({ minimum: 0, description: "Saldo punti del cliente" }),
	payInStore: t.String({
		description: "Somma degli ordini Prenota e paga in negozio",
	}),
	withoutPoints: t.Object({
		amountDueOnline: t.String({ description: "Da pagare online senza punti" }),
	}),
	withPoints: t.Nullable(
		t.Object(
			{
				pointsSpent: t.Number({ minimum: 0 }),
				discount: t.String({ description: "Sconto punti totale in euro" }),
				amountDueOnline: t.String({
					description: "Da pagare online con i punti: 0 oppure almeno 0,50",
				}),
				perStore: t.Array(
					t.Object({
						storeId: t.String(),
						pointsSpent: t.Number({ minimum: 0 }),
						discount: t.String(),
					}),
				),
			},
			{
				description:
					"Null se non ci sono ordini Paga e ritira o i punti non danno sconto",
			},
		),
	),
});
```

- [ ] **Step 5: Route.** In `routes/checkout.ts`, prima di `.post("/checkout", …)` (così `/checkout/preview` è registrata come statica):

```ts
	.get(
		"/checkout/preview",
		async (ctx) => {
			const { customerProfile: cp, query } = withCustomer(ctx);
			return ok(
				await previewCheckout({
					customerProfileId: cp.id,
					customerPoints: cp.points,
					stores: parseStoresParam(query.stores),
				}),
			);
		},
		{
			query: t.Object({
				stores: t.String({
					description:
						"Scelta per negozio, `storeId:tipo` separati da virgola (tipo: reserve_pickup | pay_pickup)",
				}),
			}),
			response: withConflictErrors({ 200: okRes(CheckoutPreviewSchema) }),
			detail: {
				summary: "Anteprima checkout",
				description:
					"Gli importi del checkout con e senza punti, senza creare niente. Stessi rifiuti della conferma: 409 se il carrello è cambiato, 400 se una modalità non è offerta.",
				tags: ["Customer - Checkout"],
			},
		},
	)
```

Importa `CheckoutPreviewSchema` e `parseStoresParam, previewCheckout`.

- [ ] **Step 6: Verifica**

Run: `cd apps/api && bun run typecheck && bun test tests/integration/customer-checkout-points.test.ts tests/integration/customer-orders.test.ts --timeout 180000 && cd ../customer && bun run typecheck`
Expected: tutto PASS; il typecheck del customer conferma che Eden vede `customer.checkout.preview`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/customer apps/api/src/lib/schemas apps/api/tests/integration/customer-checkout-points.test.ts
git commit -m "feat(api): anteprima del checkout con e senza punti

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: UI customer

**Files:**
- Create: `apps/customer/src/features/checkout/points-toggle.ts`, `points-toggle.test.ts`
- Modify: `apps/customer/src/features/checkout/checkout-choice.ts`, `checkout-choice.test.ts`
- Modify: `apps/customer/src/features/checkout/use-checkout.ts`
- Modify: `apps/customer/src/features/checkout/store-choice.tsx`
- Modify: `apps/customer/src/routes/_authenticated/checkout/index.tsx`, `review.tsx`, `$checkoutId/index.tsx`
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json`

**Interfaces:**
- Consumes: `GET /customer/checkout/preview` (Task 5), `usePoints` sul POST (Task 3), `OrderSchema.pointsDiscount`.
- Produces: `formatPoints(n: number): string`, `pointsToggleLabel(w: { pointsSpent: number; discount: string }, balance: number): string`, `amountDueOnline(preview, usePoints): string`, `confirmLabel(types, payNowCents?: number)`.

- [ ] **Step 1: Stringhe** in `messages/it.json` (vicino alle altre `checkout_*`):

```json
	"checkout_type_pay_pickup_points_hint": "Puoi usare i tuoi {points} punti.",
	"checkout_points_use_all": "Usa {points} punti",
	"checkout_points_use_some": "Usa {points} dei tuoi {balance} punti",
	"checkout_points_balance": "Saldo: {balance} punti",
	"checkout_points_store_discount": "Punti",
	"checkout_pay_by_card": "Da pagare con carta",
	"checkout_confirm_order": "Conferma ordine",
	"checkout_preview_failed": "Non riusciamo a calcolare il totale.",
	"checkout_done_points_used": "Punti usati: {points} (−{amount})",
```

e in `messages/en.json`:

```json
	"checkout_type_pay_pickup_points_hint": "You can use your {points} points.",
	"checkout_points_use_all": "Use {points} points",
	"checkout_points_use_some": "Use {points} of your {balance} points",
	"checkout_points_balance": "Balance: {balance} points",
	"checkout_points_store_discount": "Points",
	"checkout_pay_by_card": "To pay by card",
	"checkout_confirm_order": "Confirm order",
	"checkout_preview_failed": "We couldn't work out the total.",
	"checkout_done_points_used": "Points used: {points} (−{amount})",
```

- [ ] **Step 2: Test che falliscono** — `points-toggle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { amountDueOnline, formatPoints, pointsToggleLabel } from "./points-toggle";

describe("formatPoints", () => {
	it("separatore delle migliaia della lingua", () => {
		expect(formatPoints(1240)).toBe("1.240");
	});
});

describe("pointsToggleLabel", () => {
	it("usa tutto il saldo", () => {
		expect(pointsToggleLabel({ pointsSpent: 1240, discount: "12.40" }, 1240)).toBe(
			"Usa 1.240 punti",
		);
	});
	it("ne usa meno del saldo (plafond o regola 0,50 €)", () => {
		expect(pointsToggleLabel({ pointsSpent: 1190, discount: "11.90" }, 1240)).toBe(
			"Usa 1.190 dei tuoi 1.240 punti",
		);
	});
});

describe("amountDueOnline", () => {
	const preview = {
		withoutPoints: { amountDueOnline: "24.80" },
		withPoints: { amountDueOnline: "12.40" },
	};
	it("spento: senza punti", () => {
		expect(amountDueOnline(preview, false)).toBe("24.80");
	});
	it("acceso: con punti", () => {
		expect(amountDueOnline(preview, true)).toBe("12.40");
	});
	it("acceso ma withPoints null: senza punti", () => {
		expect(amountDueOnline({ ...preview, withPoints: null }, true)).toBe("24.80");
	});
});
```

In `checkout-choice.test.ts` aggiungi:

```ts
describe("confirmLabel a 0 €", () => {
	it("PR2 coperto dai punti: Conferma ordine, non Paga", () => {
		expect(confirmLabel(["pay_pickup"], 0)).toBe("Conferma ordine");
		expect(confirmLabel(["pay_pickup", "reserve_pickup"], 0)).toBe("Conferma ordine");
	});
	it("con importo: invariato", () => {
		expect(confirmLabel(["pay_pickup"], 1240)).toBe("Paga");
		expect(confirmLabel(["pay_pickup"])).toBe("Paga");
	});
});
```

- [ ] **Step 3: Verifica che falliscano**

Run: `cd apps/customer && bun run test -- src/features/checkout`
Expected: FAIL, modulo `./points-toggle` assente e «Conferma ordine» non restituito.

- [ ] **Step 4: Implementa** `points-toggle.ts`:

```ts
import { m } from "@/paraglide/messages";
import { getLocale } from "@/paraglide/runtime";

export function formatPoints(n: number): string {
	return new Intl.NumberFormat(getLocale()).format(n);
}

/** «Usa N punti», o «Usa N dei tuoi M» quando il server ne usa meno del saldo. */
export function pointsToggleLabel(
	w: { pointsSpent: number },
	balance: number,
): string {
	return w.pointsSpent < balance
		? m.checkout_points_use_some({
				points: formatPoints(w.pointsSpent),
				balance: formatPoints(balance),
			})
		: m.checkout_points_use_all({ points: formatPoints(w.pointsSpent) });
}

/** L'importo online dello scenario scelto dall'interruttore. */
export function amountDueOnline(
	preview: {
		withoutPoints: { amountDueOnline: string };
		withPoints: { amountDueOnline: string } | null;
	},
	usePoints: boolean,
): string {
	return usePoints && preview.withPoints
		? preview.withPoints.amountDueOnline
		: preview.withoutPoints.amountDueOnline;
}
```

In `checkout-choice.ts`:

```ts
/** Il bottone dice cosa succede: prenotazione, pagamento, o entrambi. Con un
 *  PR2 interamente coperto dai punti non si paga niente: «Conferma ordine». */
export function confirmLabel(types: CheckoutType[], payNowCents?: number): string {
	const reserve = types.includes("reserve_pickup");
	const pay = types.includes("pay_pickup");
	if (pay && payNowCents === 0) return m.checkout_confirm_order();
	if (reserve && pay) return m.checkout_confirm_reserve_and_pay();
	return pay ? m.checkout_confirm_pay() : m.checkout_confirm_reserve();
}
```

- [ ] **Step 5: Verifica che passino**

Run: `cd apps/customer && bun run test -- src/features/checkout`
Expected: PASS. I test fissano la lingua come `src/features/stores/open-status.test.ts`: in testa a `points-toggle.test.ts` aggiungi `import { beforeEach } from "vitest"; import { overwriteGetLocale } from "@/paraglide/runtime";` e `beforeEach(() => overwriteGetLocale(() => "it"));`.

- [ ] **Step 6: Hook** in `use-checkout.ts`:

```ts
import { POINTS_KEY } from "@/features/points/use-points";
import { type CheckoutChoice, serializeChoice } from "./checkout-choice";

export const CHECKOUT_PREVIEW_KEY = ["customer", "checkout-preview"] as const;

/** Importi del riepilogo dall'API, con e senza punti: l'interruttore non fa chiamate. */
export function useCheckoutPreview(choice: CheckoutChoice, enabled: boolean) {
	const stores = serializeChoice(choice) ?? "";
	return useQuery({
		queryKey: [...CHECKOUT_PREVIEW_KEY, stores],
		enabled: enabled && stores !== "",
		retry: false,
		queryFn: async () => {
			const res = await api().customer.checkout.preview.get({ query: { stores } });
			if (res.error)
				throw new CheckoutError(
					errorMessage(res),
					(res.error as { status?: number }).status,
				);
			return unwrap(res, m.error_generic()).data;
		},
	});
}
```

In `useCreateCheckout`: aggiungi `usePoints: boolean` al tipo del body; in `onSuccess` invalida anche `POINTS_KEY` e `CHECKOUT_PREVIEW_KEY`.

- [ ] **Step 7: Suggerimento in `/checkout`.** `StoreChoice` riceve `pointsBalance?: number`; la spiegazione di `pay_pickup` diventa:

```tsx
							<span className="block text-muted-foreground text-sm">
								{HINT[type]()}
								{type === "pay_pickup" && pointsBalance
									? ` ${m.checkout_type_pay_pickup_points_hint({ points: formatPoints(pointsBalance) })}`
									: null}
							</span>
```

In `routes/_authenticated/checkout/index.tsx`: `const points = useCustomerPoints(1);` e passa `pointsBalance={points.data?.balance}` a `StoreChoice`.

- [ ] **Step 8: Riepilogo** (`review.tsx`):
  - `const [usePoints, setUsePoints] = useState(false);` e `submitted` include `usePoints`: `const points = submitted?.usePoints ?? usePoints;`.
  - `const preview = useCheckoutPreview(choice, !submitted && resolved.complete);`. Se `preview.error` è un `CheckoutError` con `checkoutFailure(status) === "back_to_cart"` → `toast.error(e.message)` + `navigate({ to: "/cart" })` in un `useEffect` sull'errore; altrimenti nella zona totali `m.checkout_preview_failed()` con `<Button variant="secondary" className="min-h-11" onClick={() => void preview.refetch()}>{m.cart_retry()}</Button>`.
  - Totali: al posto di `payNow`/`payInStore` calcolati dal carrello usa `preview.data` (`toCents(amountDueOnline(preview.data, points))`, `preview.data.payInStore`). Mentre `preview.isPending`: `<Skeleton className="h-20 w-full" />` al posto dei totali e bottone disabilitato. Dopo l'invio (`submitted`) la preview è disabilitata: congela anche `preview.data` in `submitted` per non perdere i totali.
  - Interruttore sotto «Da pagare ora», solo se `preview.data.withPoints`:

```tsx
<label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border p-3">
	<span className="space-y-0.5">
		<span className="block font-medium text-foreground text-sm">
			{pointsToggleLabel(w, preview.data.balance)}
		</span>
		<span className="block text-muted-foreground text-xs">
			{m.checkout_points_balance({ balance: formatPoints(preview.data.balance) })}
		</span>
	</span>
	<span className="flex items-center gap-3">
		<span className="font-medium tabular-nums">−{formatPriceEur(w.discount)}</span>
		<Switch
			checked={points}
			onCheckedChange={setUsePoints}
			disabled={!!submitted}
		/>
	</span>
</label>
```

  - Con interruttore acceso: riga «Da pagare con carta» (`m.checkout_pay_by_card()`) col netto; con più PR2, in ogni blocco negozio sotto il subtotale la riga `m.checkout_points_store_discount()` con `−{formatPriceEur(perStore.discount)}` dello store.
  - Mutation: `usePoints: points`; bottone `confirmLabel(types, toCents(amountDueOnline(preview.data, points)))`, disabilitato anche senza `preview.data`.
  - Importa `Switch` da `@bibs/ui/components/switch`.

- [ ] **Step 9: Conferma** (`$checkoutId/index.tsx`), sopra i bottoni finali:

```tsx
{(() => {
	const spent = data.orders.reduce((s, o) => s + o.pointsSpent, 0);
	const discount = data.orders.reduce((s, o) => s + toCents(o.pointsDiscount), 0);
	return spent > 0 ? (
		<p className="text-muted-foreground text-sm tabular-nums">
			{m.checkout_done_points_used({
				points: formatPoints(spent),
				amount: formatPriceEur(discount / 100),
			})}
		</p>
	) : null;
})()}
```

con `const toCents = (v: string) => Math.round(Number(v) * 100);` come in `review.tsx`.

- [ ] **Step 10: Verifica**

Run: `cd apps/customer && bun run test && bun run typecheck && bun run build`
Expected: test PASS, typecheck pulito, build riuscita.

- [ ] **Step 11: Prova nel browser** (API su :3000, customer su :3001, seed caricato; cliente del seed con punti — se nessuno ne ha, assegnali **solo a un cliente di prova creato apposta**, mai sul seed condiviso): `/checkout` mostra il suggerimento; `/checkout/review` con interruttore spento/acceso cambia i totali senza richieste di rete (verifica nel pannello Network); a 0 € il bottone è «Conferma ordine» e porta alla conferma con «Punti usati». Prova anche con la tastiera (Tab sull'interruttore, Spazio per attivarlo).

- [ ] **Step 12: Commit**

```bash
git add apps/customer
git commit -m "feat(customer): usa i punti nel riepilogo del checkout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `docs/pagamenti.md` e gate finale

**Files:**
- Modify: `docs/pagamenti.md`

- [ ] **Step 1: Aggiorna la guida.**
  - Diagramma «Paga e ritira»: aggiungi il ramo

    ```text
       ├─ punti coprono tutto (0 €) ──► ordini «confirmed» subito, nessun PaymentIntent
       │                                  └► solo trasferimento quota punti dal saldo bibs
    ```

  - In «Chi paga lo sconto punti», sostituisci il blocco «> **Non ancora attivo per i clienti:** …» con una sottosezione «Usare i punti al checkout»:
    - l'interruttore nel riepilogo, spento di default, usa il massimo spendibile;
    - la regola: online si paga **0 € oppure almeno 0,50 €** (minimo Stripe in EUR); esempio: 20 € con 1.980 punti → usa 1.950 punti, paga 0,50 €;
    - la ripartizione proporzionale con l'esempio: negozi A 20,00 € e B 7,50 €, 1.000 punti → A −7,27 €, B −2,73 €, un pagamento da 17,50 €; annullando B tornano 273 punti;
    - il checkout a 0 €: ordini confermati subito, solo la quota punti dal saldo bibs (`transferStorePayouts`), ritentata da `retryStoreTransfers` se il saldo non basta;
    - l'anteprima `GET /customer/checkout/preview` usa le stesse funzioni della conferma.
  - In «Cosa NON esiste ancora»: togli la voce dei punti; aggiungi «Ordine "Paga e ritira" con totale sotto 0,50 € senza punti: Stripe lo rifiuta (502)».
  - In «Dove sta nel codice»: `Ripartizione dei punti tra gli ordini | apps/api/src/lib/points-allocation.ts` e `Anteprima del checkout | apps/api/src/modules/customer/services/checkout.ts (previewCheckout)`.

- [ ] **Step 2: Gate completo**

Run (dalla root): `bun run typecheck && bun run test`
Expected: typecheck pulito su tutti i workspace; test verdi. Controlla l'esito **per workspace** (`bun --filter` può nascondere un fallimento nell'aggregato).

- [ ] **Step 3: Commit**

```bash
git add docs/pagamenti.md
git commit -m "docs: punti al checkout, regola 0,50 € e checkout a 0 €

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Smoke manuale di Marco** prima della PR: 1 PR2 con e senza punti, 2 PR2, PR2 + prenotazione, totale coperto (0 €), residuo sotto 0,50 €; mouse e tastiera. La PR si apre solo dopo il suo ok.
