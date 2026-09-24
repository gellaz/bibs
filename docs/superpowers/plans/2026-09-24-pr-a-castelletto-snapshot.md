# PR A — Castelletto dopo i punti, snapshot indirizzo, core `placeOrder` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere `createOrder` riusabile dal futuro checkout multi-negozio (core `placeOrder(tx, …)`), far tornare il castelletto IVA col totale quando si spendono punti (P6.2) e salvare lo snapshot dell'indirizzo sull'ordine (P1.5).

**Architecture:** Il corpo della transazione di `createOrder` diventa `placeOrder(tx, params)` esportato dallo stesso modulo; `createOrder` resta il wrapper con idempotenza e `db.transaction`. Una funzione pura `apportionDiscount` in `lib/vat.ts` ripartisce lo sconto punti tra le aliquote con i resti maggiori, e il castelletto si costruisce sul lordo scontato. Una colonna jsonb `orders.shipping_address_snapshot` viene scritta da `placeOrder`.

**Tech Stack:** Bun, Elysia + TypeBox, Drizzle ORM (Postgres/PostGIS), bun:test + testcontainers.

**Spec:** `docs/superpowers/specs/2026-09-24-customer-checkout-design.md` (sezioni «Core placeOrder», «P6.2», «P1.5»)

## Global Constraints

- Importi sempre in centesimi interi; conversioni solo con `toCents`/`fromCents` di `@/lib/money`.
- Aliquote ammesse: `22, 10, 5, 4, 0` (`VAT_RATES`).
- Castelletto ordinato per aliquota decrescente (contratto esistente di `buildCastelletto`).
- `ServiceError(status, message)` con due soli argomenti.
- Test di integrazione: `mock.module("@/db", …)` con Proxy su `getTestDb()` prima degli import dei service (pattern dei file `tests/integration/customer-orders-*.test.ts`).
- Mai indebolire asserzioni esistenti né modificare codice di produzione per ottenere un RED.
- Commit Conventional con scope della whitelist AGENTS.md (qui: `orders`, `db`, `api`, `docs`).
- Migrazione generata con `bun run db:generate` in `apps/api`, committata insieme allo schema.

## Review Focus

1. **Sconto punti = 100% del totale**: ogni aliquota deve andare a imponibile/IVA `"0.00"`, non negativa → test in Task 2.
2. **Sconto con resti tutti uguali** (tre aliquote, sconto non divisibile): la ripartizione deve essere deterministica → test in Task 2 (tie-break per aliquota più alta).
3. **Ordine senza punti**: castelletto identico a oggi (nessuna regressione per chi non usa punti) → già coperto da `customer-orders-vat.test.ts` esistente, deve restare verde senza modifiche in Task 3.
4. **Indirizzo cancellato dopo l'ordine**: l'ordine deve mantenere lo snapshot mentre la FK diventa `NULL` → test in Task 4.
5. **Punti che in virgola mobile perdono un centesimo** (es. 232 → 2,31 €): lo sconto deve valere esattamente punti/100 € → test in Task 3 (asserzione su `total` e `pointsSpent`).
6. **Indirizzo di un altro cliente** passato a `pay_deliver`: deve restare 404 dopo lo spostamento del controllo dentro `placeOrder` → `customer-orders-address-idor.test.ts` esistente, deve restare verde in Task 1.

---

### Task 1: Estrarre `placeOrder(tx, …)` da `createOrder` (refactor puro)

**Files:**
- Modify: `apps/api/src/modules/customer/services/orders.ts:152-436` (interfaccia `CreateOrderParams`, `createOrder`)

**Interfaces:**
- Produces:
  ```ts
  export type OrderTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
  export interface PlaceOrderParams {
    customerProfileId: string;
    customerPoints: number;
    type: "direct" | "reserve_pickup" | "pay_pickup" | "pay_deliver";
    storeId: string;
    items: { storeProductId: string; quantity: number }[];
    shippingAddressId?: string;
    pointsToSpend?: number;
    idempotencyKey?: string;
  }
  export async function placeOrder(tx: OrderTx, params: PlaceOrderParams): Promise<typeof order.$inferSelect>;
  ```
  `CreateOrderParams` diventa alias di `PlaceOrderParams`.

- [ ] **Step 1: Baseline verde**

Run (da `apps/api`, Docker attivo): `bun test tests/integration/customer-orders.test.ts tests/integration/customer-orders-vat.test.ts tests/integration/customer-orders-discounts.test.ts tests/integration/customer-orders-address-idor.test.ts --timeout 180000`
Expected: tutti PASS. È la rete di sicurezza del refactor: nessun test viene modificato in questo task.

- [ ] **Step 2: Estrarre il core**

In `orders.ts`:
1. Aggiungi sotto gli import:
   ```ts
   export type OrderTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
   ```
2. Rinomina `interface CreateOrderParams` in `export interface PlaceOrderParams` e aggiungi `export type CreateOrderParams = PlaceOrderParams;`.
3. Crea `export async function placeOrder(tx: OrderTx, params: PlaceOrderParams)` che contiene, in quest'ordine:
   - la destrutturazione dei params (senza `idempotencyKey` pre-check);
   - il calcolo `shippingCost` e il check «Shipping address is required for delivery orders»;
   - il controllo IDOR dell'indirizzo, **ora eseguito con `tx`** invece di `db`;
   - tutto il corpo attuale della callback `db.transaction(async (tx) => { … })` (vendibilità, righe, castelletto, punti, insert, stock, debito punti, award `direct`), con lo stesso `return`.
4. `createOrder` diventa:
   ```ts
   export async function createOrder(params: CreateOrderParams) {
   	const { idempotencyKey } = params;

   	// Idempotency: return existing order if key was already used
   	if (idempotencyKey) {
   		const existing = await db.query.order.findFirst({
   			where: eq(order.idempotencyKey, idempotencyKey),
   		});
   		if (existing) return existing;
   	}

   	// Created eagerly so the idempotency .catch below can be attached
   	// synchronously.
   	const pendingOrder = db.transaction((tx) => placeOrder(tx, params));

   	return pendingOrder.catch(async (err: unknown) => {
   		// (commento esistente sulla race di idempotenza, invariato)
   		if (idempotencyKey && isUniqueViolation(err)) {
   			const existing = await db.query.order.findFirst({
   				where: eq(order.idempotencyKey, idempotencyKey),
   			});
   			if (existing) return existing;
   		}
   		throw err;
   	});
   }
   ```
   Un docblock breve su `placeOrder`: «Crea un ordine dentro una transazione esistente. Non gestisce l'idempotenza: è compito del chiamante (`createOrder` per ordine, il checkout per checkout).»

- [ ] **Step 3: Test verdi e typecheck**

Run: stesso comando dello Step 1, poi `bun run typecheck` in `apps/api`.
Expected: tutti PASS, typecheck pulito.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/customer/services/orders.ts
git commit -m "refactor(orders): core placeOrder(tx) estratto da createOrder"
```

---

### Task 2: `apportionDiscount` — ripartizione dello sconto tra le aliquote

**Files:**
- Modify: `apps/api/src/lib/vat.ts` (in coda)
- Test: `apps/api/tests/lib/vat.test.ts` (in coda)

**Interfaces:**
- Produces:
  ```ts
  export function apportionDiscount(
    lines: { grossCents: number; rate: number }[],
    discountCents: number,
  ): { grossCents: number; rate: number }[];
  ```
  Output: una voce per aliquota (lordo aggregato già scontato), ordinata per aliquota decrescente. Precondizione: `0 <= discountCents <= Σ grossCents` (garantita dal clamp in `placeOrder`); fuori range lancia `RangeError`.

- [ ] **Step 1: Test RED**

Aggiungi l'import `apportionDiscount` accanto a quelli esistenti e in coda al file:

```ts
describe("apportionDiscount", () => {
	it("con sconto zero restituisce il lordo aggregato per aliquota", () => {
		expect(
			apportionDiscount(
				[
					{ grossCents: 1100, rate: 10 },
					{ grossCents: 1220, rate: 22 },
				],
				0,
			),
		).toEqual([
			{ rate: 22, grossCents: 1220 },
			{ rate: 10, grossCents: 1100 },
		]);
	});

	it("aggrega le righe con la stessa aliquota prima di ripartire", () => {
		expect(
			apportionDiscount(
				[
					{ grossCents: 500, rate: 22 },
					{ grossCents: 500, rate: 22 },
				],
				100,
			),
		).toEqual([{ rate: 22, grossCents: 900 }]);
	});

	it("ripartisce in proporzione al lordo di ciascuna aliquota", () => {
		// 2,32 € su 23,20 €: 1,22 alla 22% (1220/2320), 1,10 alla 10%
		expect(
			apportionDiscount(
				[
					{ grossCents: 1220, rate: 22 },
					{ grossCents: 1100, rate: 10 },
				],
				232,
			),
		).toEqual([
			{ rate: 22, grossCents: 1098 },
			{ rate: 10, grossCents: 990 },
		]);
	});

	it("assegna i centesimi residui coi resti maggiori, a parità all'aliquota più alta", () => {
		// 100 su tre quote uguali: 33 ciascuna + 1 residuo → alla 22%
		expect(
			apportionDiscount(
				[
					{ grossCents: 100, rate: 4 },
					{ grossCents: 100, rate: 22 },
					{ grossCents: 100, rate: 10 },
				],
				100,
			),
		).toEqual([
			{ rate: 22, grossCents: 66 },
			{ rate: 10, grossCents: 67 },
			{ rate: 4, grossCents: 67 },
		]);
	});

	it("il resto maggiore vince sull'aliquota", () => {
		// 10 su 700 (22%) + 300 (10%): quote 7,0 e 3,0 → nessun residuo;
		// 11 su 700 + 300: quote 7,7 e 3,3 → base 7+3, residuo 1 alla 22% (0,7 > 0,3)
		expect(
			apportionDiscount(
				[
					{ grossCents: 300, rate: 10 },
					{ grossCents: 700, rate: 22 },
				],
				11,
			),
		).toEqual([
			{ rate: 22, grossCents: 692 },
			{ rate: 10, grossCents: 297 },
		]);
		// 13 su 700 + 300: quote 9,1 e 3,9 → residuo alla 10% (0,9 > 0,1)
		expect(
			apportionDiscount(
				[
					{ grossCents: 700, rate: 22 },
					{ grossCents: 300, rate: 10 },
				],
				13,
			),
		).toEqual([
			{ rate: 22, grossCents: 691 },
			{ rate: 10, grossCents: 296 },
		]);
	});

	it("con sconto pari al totale azzera ogni aliquota", () => {
		expect(
			apportionDiscount(
				[
					{ grossCents: 1220, rate: 22 },
					{ grossCents: 1100, rate: 10 },
				],
				2320,
			),
		).toEqual([
			{ rate: 22, grossCents: 0 },
			{ rate: 10, grossCents: 0 },
		]);
	});

	it("conserva sempre il totale scontato e non va mai sotto zero", () => {
		const lines = [
			{ grossCents: 1999, rate: 22 },
			{ grossCents: 347, rate: 10 },
			{ grossCents: 58, rate: 5 },
			{ grossCents: 1, rate: 4 },
		];
		const gross = lines.reduce((s, l) => s + l.grossCents, 0);
		for (let d = 0; d <= gross; d += 7) {
			const out = apportionDiscount(lines, d);
			expect(out.reduce((s, l) => s + l.grossCents, 0)).toBe(gross - d);
			for (const l of out) expect(l.grossCents).toBeGreaterThanOrEqual(0);
		}
	});

	it("rifiuta uno sconto negativo o superiore al lordo", () => {
		const lines = [{ grossCents: 100, rate: 22 }];
		expect(() => apportionDiscount(lines, -1)).toThrow(RangeError);
		expect(() => apportionDiscount(lines, 101)).toThrow(RangeError);
	});
});
```

- [ ] **Step 2: Verifica RED**

Run (da `apps/api`): `bun test tests/lib/vat.test.ts`
Expected: FAIL — `apportionDiscount` non esportata (SyntaxError/undefined).

- [ ] **Step 3: Implementazione**

In coda a `lib/vat.ts`:

```ts
/**
 * Ripartisce uno sconto sull'ordine (es. punti fedeltà) tra le aliquote, in
 * proporzione al lordo di ciascuna. Lo sconto incondizionato riduce la base
 * imponibile di ogni aliquota, quindi il castelletto va costruito sul lordo che
 * esce di qui: così Σ(imponibile + imposta) == totale pagato.
 *
 * Metodo dei resti maggiori al centesimo: la somma ripartita è esattamente
 * `discountCents`. A parità di resto vince l'aliquota più alta, per
 * determinismo. Output aggregato per aliquota, ordinato per aliquota desc.
 */
export function apportionDiscount(
	lines: { grossCents: number; rate: number }[],
	discountCents: number,
): { grossCents: number; rate: number }[] {
	const grossByRate = new Map<number, number>();
	for (const l of lines) {
		grossByRate.set(l.rate, (grossByRate.get(l.rate) ?? 0) + l.grossCents);
	}
	const buckets = [...grossByRate.entries()]
		.sort((a, b) => b[0] - a[0])
		.map(([rate, grossCents]) => ({ rate, grossCents }));
	const totalGross = buckets.reduce((s, b) => s + b.grossCents, 0);

	if (discountCents < 0 || discountCents > totalGross)
		throw new RangeError(
			`discountCents ${discountCents} fuori da [0, ${totalGross}]`,
		);
	if (discountCents === 0 || totalGross === 0) return buckets;

	const shares = buckets.map((b) => {
		const exact = (discountCents * b.grossCents) / totalGross;
		const base = Math.floor(exact);
		return { rate: b.rate, base, fraction: exact - base };
	});
	let residual = discountCents - shares.reduce((s, x) => s + x.base, 0);
	// Già ordinati per aliquota desc: il sort stabile tiene quell'ordine a parità.
	const byFraction = [...shares].sort((a, b) => b.fraction - a.fraction);
	for (const share of byFraction) {
		if (residual === 0) break;
		share.base += 1;
		residual -= 1;
	}

	return buckets.map((b, i) => ({
		rate: b.rate,
		grossCents: b.grossCents - shares[i].base,
	}));
}
```

- [ ] **Step 4: Verifica GREEN**

Run: `bun test tests/lib/vat.test.ts`
Expected: tutti PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/vat.ts apps/api/tests/lib/vat.test.ts
git commit -m "feat(orders): apportionDiscount ripartisce lo sconto tra le aliquote"
```

---

### Task 3: Castelletto costruito dopo lo sconto punti (P6.2)

**Files:**
- Modify: `apps/api/src/modules/customer/services/orders.ts` (blocco «Castelletto IVA» e «Points discount» dentro `placeOrder`)
- Test: `apps/api/tests/integration/customer-orders-vat.test.ts` (nuovo `it` nello stesso `describe`)

**Interfaces:**
- Consumes: `apportionDiscount` (Task 2), `placeOrder` (Task 1).

- [ ] **Step 1: Test RED**

Aggiungi `import { config } from "@/lib/config";` agli import e questo `it` nel `describe` esistente:

```ts
	it("con punti spesi il castelletto torna col totale pagato", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		await createTestStoreSubscription(db, store.id);

		const prodA = await createTestProduct(db, seller.profile.id, {
			price: "12.20",
		});
		await db
			.update(productTable)
			.set({ vatRate: "22" })
			.where(eq(productTable.id, prodA.id));
		const prodB = await createTestProduct(db, seller.profile.id, {
			price: "11.00",
		});
		await db
			.update(productTable)
			.set({ vatRate: "10" })
			.where(eq(productTable.id, prodB.id));
		const spA = await createTestStoreProduct(db, store.id, prodA.id, {
			stock: 5,
		});
		const spB = await createTestStoreProduct(db, store.id, prodB.id, {
			stock: 5,
		});

		// 2,32 € di sconto punti
		const points = (232 * config.pointsPerEuroDiscount) / 100;
		const customer = await createTestCustomer(db, { points });

		const newOrder = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: points,
			type: "reserve_pickup",
			storeId: store.id,
			items: [
				{ storeProductId: spA.id, quantity: 1 },
				{ storeProductId: spB.id, quantity: 1 },
			],
			pointsToSpend: points,
		});

		expect(newOrder.total).toBe("21.88");
		expect(newOrder.pointsSpent).toBe(points);
		// 22%: 12,20 − 1,22 = 10,98 → 9,00 + 1,98
		// 10%: 11,00 − 1,10 =  9,90 → 9,00 + 0,90
		expect(newOrder.vatBreakdown).toEqual([
			{ rate: 22, taxableAmount: "9.00", taxAmount: "1.98" },
			{ rate: 10, taxableAmount: "9.00", taxAmount: "0.90" },
		]);
		const castellettoCents = (newOrder.vatBreakdown ?? []).reduce(
			(s, l) =>
				s + Math.round(Number(l.taxableAmount) * 100) +
				Math.round(Number(l.taxAmount) * 100),
			0,
		);
		expect(castellettoCents).toBe(2188);
	});
```

(Uso `reserve_pickup` e non `direct` per non mescolare l'accredito punti immediato.)

- [ ] **Step 2: Verifica RED**

Run: `bun test tests/integration/customer-orders-vat.test.ts --timeout 180000`
Expected: FAIL già sul `total`: arriva `"21.89"`, perché `Math.floor((232 / 100) * 100)` in virgola mobile vale 231 (bug latente: 4.586 valori di punti su 100.000 perdono un centesimo). Corretto quello, fallirebbe il `vatBreakdown`: oggi arriva `[{22,"10.00","2.20"},{10,"10.00","1.00"}]` (castelletto pre-sconto, somma 2320 ≠ 2188).

- [ ] **Step 3: Implementazione**

In `placeOrder`, nel blocco «Points discount», passa all'aritmetica intera (niente divisione prima della moltiplicazione):

```ts
			discountCents = Math.floor(
				(pointsToSpend * 100) / config.pointsPerEuroDiscount,
			);
```
e
```ts
		const actualPointsSpent = Math.floor(
			(discountCents * config.pointsPerEuroDiscount) / 100,
		);
```

Poi sposta il calcolo del castelletto **dopo** il blocco «Points discount» (che calcola `discountCents`) e sostituiscilo con:

```ts
		// Castelletto IVA sul lordo GIÀ scontato dai punti: lo sconto punti è
		// incondizionato, riduce la base imponibile di ogni aliquota in proporzione
		// (resti maggiori, vedi apportionDiscount). Così Σ castelletto == total.
		// order_items.vatAmount resta lo scorporo della riga prima dei punti:
		// l'unica fonte fiscale dell'ordine è vatBreakdown.
		const vatBreakdown = buildCastelletto(
			apportionDiscount(
				resolvedItems.map((it) => ({
					grossCents: toCents(it.unitPrice) * it.quantity,
					rate: Number(it.vatRate),
				})),
				discountCents,
			),
		);
```

Aggiorna l'import: `import { apportionDiscount, buildCastelletto, scorporo } from "@/lib/vat";`. Rimuovi il vecchio blocco e il suo commento «PRIMA dello sconto punti… demandato al futuro layer di fatturazione».

- [ ] **Step 4: Verifica GREEN e non-regressione**

Run: `bun test tests/lib/vat.test.ts tests/integration/customer-orders.test.ts tests/integration/customer-orders-vat.test.ts tests/integration/customer-orders-discounts.test.ts tests/integration/customer-orders-address-idor.test.ts --timeout 180000`
Expected: tutti PASS. In particolare il test esistente «reflects the discounted gross in vatBreakdown» (`customer-orders-discounts.test.ts`) e quello senza punti in `customer-orders-vat.test.ts` restano verdi senza modifiche.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/customer/services/orders.ts apps/api/tests/integration/customer-orders-vat.test.ts
git commit -m "fix(orders): castelletto IVA dopo lo sconto punti, conversione punti intera"
```

---

### Task 4: Snapshot dell'indirizzo sull'ordine (P1.5)

**Files:**
- Modify: `apps/api/src/db/schemas/order.ts` (tipo + colonna)
- Create: `apps/api/src/db/migrations/00NN_*.sql` + `meta/` (generati)
- Modify: `apps/api/src/lib/schemas/entities.ts:654` (`OrderSchema`)
- Modify: `apps/api/src/modules/customer/services/orders.ts` (controllo IDOR in `placeOrder` → legge anche comune e provincia, scrive lo snapshot)
- Test: `apps/api/tests/integration/customer-orders-address-snapshot.test.ts` (nuovo)

**Interfaces:**
- Produces (in `db/schemas/order.ts`):
  ```ts
  export interface ShippingAddressSnapshot {
    recipientName: string | null;
    phone: string | null;
    addressLine1: string;
    addressLine2: string | null;
    zipCode: string;
    municipalityName: string;
    provinceAcronym: string;
    country: string;
  }
  // colonna
  shippingAddressSnapshot: jsonb("shipping_address_snapshot").$type<ShippingAddressSnapshot>(),
  ```

- [ ] **Step 1: Test RED**

Crea `tests/integration/customer-orders-address-snapshot.test.ts`:

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
import { customerAddress } from "@/db/schemas/address";
import { order } from "@/db/schemas/order";
import { createOrder } from "@/modules/customer/services/orders";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCustomer,
	createTestCustomerAddress,
	createTestMunicipality,
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

async function seedDeliveryOrder() {
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
	const municipality = await createTestMunicipality(db, {
		municipalityName: "Bologna",
		provinceAcronym: "BO",
	});
	const address = await createTestCustomerAddress(db, customer.profile.id, {
		addressLine1: "Via Indipendenza 10",
		municipalityId: municipality.id,
		zipCode: "40121",
	});
	const created = await createOrder({
		customerProfileId: customer.profile.id,
		customerPoints: 0,
		type: "pay_deliver",
		storeId: store.id,
		items: [{ storeProductId: sp.id, quantity: 1 }],
		shippingAddressId: address.id,
	});
	return { db, address, created };
}

describe("createOrder — snapshot dell'indirizzo", () => {
	it("salva sull'ordine una copia dell'indirizzo di spedizione", async () => {
		const { created } = await seedDeliveryOrder();

		expect(created.shippingAddressSnapshot).toEqual({
			recipientName: null,
			phone: null,
			addressLine1: "Via Indipendenza 10",
			addressLine2: null,
			zipCode: "40121",
			municipalityName: "Bologna",
			provinceAcronym: "BO",
			country: "IT",
		});
	});

	it("l'ordine conserva lo snapshot quando l'indirizzo viene cancellato", async () => {
		const { db, address, created } = await seedDeliveryOrder();

		await db.delete(customerAddress).where(eq(customerAddress.id, address.id));

		const [after] = await db
			.select()
			.from(order)
			.where(eq(order.id, created.id));
		expect(after.shippingAddressId).toBeNull();
		expect(after.shippingAddressSnapshot?.addressLine1).toBe(
			"Via Indipendenza 10",
		);
		expect(after.shippingAddressSnapshot?.municipalityName).toBe("Bologna");
	});

	it("gli ordini da ritirare non hanno snapshot", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const store = await createTestStore(db, seller.profile.id);
		await createTestStoreSubscription(db, store.id);
		const product = await createTestProduct(db, seller.profile.id);
		const sp = await createTestStoreProduct(db, store.id, product.id, {
			stock: 5,
		});
		const customer = await createTestCustomer(db);

		const created = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "reserve_pickup",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});

		expect(created.shippingAddressSnapshot).toBeNull();
	});
});
```

Prima di eseguire, verifica in `tests/helpers/fixtures.ts:95` che `createTestMunicipality` accetti `municipalityName` e `provinceAcronym` (sì, dalla firma) e che la provincia venga creata con quell'acronimo.

- [ ] **Step 2: Verifica RED**

Run: `bun test tests/integration/customer-orders-address-snapshot.test.ts --timeout 180000`
Expected: FAIL — `shippingAddressSnapshot` è `undefined` (colonna inesistente); il primo `toEqual` fallisce.

- [ ] **Step 3: Schema + migrazione**

In `db/schemas/order.ts` aggiungi l'interfaccia `ShippingAddressSnapshot` (vedi Interfaces) sopra `export const order`, e subito dopo `shippingAddressId`:

```ts
		// Snapshot dell'indirizzo al momento dell'ordine: la FK qui sopra va a NULL
		// se il cliente cancella l'indirizzo dalla rubrica, lo snapshot resta.
		shippingAddressSnapshot: jsonb(
			"shipping_address_snapshot",
		).$type<ShippingAddressSnapshot>(),
```

Run (da `apps/api`): `bun run db:generate`
Expected: nuovo file `src/db/migrations/0008_*.sql` con un solo `ALTER TABLE "orders" ADD COLUMN "shipping_address_snapshot" jsonb;`. Aprilo e verifica che non contenga altro (in particolare nessun DROP o re-emissione di estensioni).

- [ ] **Step 4: Response schema**

In `lib/schemas/entities.ts`, dentro `OrderSchema` dopo `shippingAddressId`:

```ts
	shippingAddressSnapshot: t.Nullable(
		t.Object(
			{
				recipientName: t.Nullable(t.String()),
				phone: t.Nullable(t.String()),
				addressLine1: t.String(),
				addressLine2: t.Nullable(t.String()),
				zipCode: t.String(),
				municipalityName: t.String(),
				provinceAcronym: t.String(),
				country: t.String(),
			},
			{
				description:
					"Copia dell'indirizzo di spedizione al momento dell'ordine. NULL per ordini senza spedizione o storici",
			},
		),
	),
```

- [ ] **Step 5: Scrittura in `placeOrder`**

Sostituisci il controllo IDOR in `placeOrder` con una lettura che porta anche comune e provincia e costruisce lo snapshot:

```ts
	// IDOR guard: the shipping address must belong to the ordering customer.
	// The FK alone only proves existence, not ownership. La stessa lettura
	// produce lo snapshot salvato sull'ordine.
	let shippingAddressSnapshot: ShippingAddressSnapshot | null = null;
	if (type === "pay_deliver" && shippingAddressId) {
		const addr = await tx.query.customerAddress.findFirst({
			where: and(
				eq(customerAddress.id, shippingAddressId),
				eq(customerAddress.customerProfileId, customerProfileId),
			),
			with: {
				municipality: {
					columns: { name: true },
					with: { province: { columns: { acronym: true } } },
				},
			},
		});
		if (!addr) throw new ServiceError(404, "Shipping address not found");
		shippingAddressSnapshot = {
			recipientName: addr.recipientName,
			phone: addr.phone,
			addressLine1: addr.addressLine1,
			addressLine2: addr.addressLine2,
			zipCode: addr.zipCode,
			municipalityName: addr.municipality.name,
			provinceAcronym: addr.municipality.province.acronym,
			country: addr.country,
		};
	}
```

Aggiungi `shippingAddressSnapshot,` ai `.values({ … })` dell'insert dell'ordine e `type ShippingAddressSnapshot` all'import da `@/db/schemas/order`. Verifica che la relazione `customerAddress.municipality` esista in `db/schemas/address.ts` (le letture di `listCustomerOrders` la usano già con `with: { municipality: … }`).

- [ ] **Step 6: Verifica GREEN, suite ordini, typecheck**

Run: `bun test tests/integration/customer-orders-address-snapshot.test.ts tests/integration/customer-orders.test.ts tests/integration/customer-orders-address-idor.test.ts tests/integration/customer-orders-vat.test.ts --timeout 180000` poi `bun run typecheck`.
Expected: tutti PASS; typecheck pulito.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/schemas/order.ts apps/api/src/db/migrations apps/api/src/lib/schemas/entities.ts apps/api/src/modules/customer/services/orders.ts apps/api/tests/integration/customer-orders-address-snapshot.test.ts
git commit -m "feat(orders): snapshot dell'indirizzo di spedizione sull'ordine"
```

---

### Task 5: Gate completo, backlog, PR

**Files:**
- Modify: `docs/audit/2026-09-24-followup-gap-analysis.md` (P1.5 → «Chiusi»; P6.2 riformulata)

- [ ] **Step 1: Gate**

Da root, un comando alla volta controllando `$?` (memoria: `bun --filter` aggregato può nascondere fallimenti):
```bash
bun run lint; echo "lint=$?"
(cd apps/api && bun run typecheck); echo "api=$?"
(cd apps/customer && bun run typecheck); echo "customer=$?"
(cd apps/seller && bun run typecheck); echo "seller=$?"
(cd apps/admin && bun run typecheck); echo "admin=$?"
(cd apps/api && bun run test); echo "apitest=$?"
for a in customer seller admin; do (cd apps/$a && bun run build >/dev/null); echo "$a build=$?"; done
```
Expected: tutti `=0`. Il typecheck dei FE conta perché `OrderSchema` cambia i tipi Eden.

- [ ] **Step 2: Backlog**

Nel documento:
- rimuovi la riga **P1.5** dalla tabella P1 e aggiungila a «Chiusi»: `| **P1.5** | Snapshot dell'indirizzo sull'ordine (`orders.shipping_address_snapshot`), scritto da `placeOrder`; la FK resta `set null` | #NN |`;
- aggiungi a «Chiusi» `| **P6.2 (punti)** | Castelletto costruito sul lordo già scontato dai punti con ripartizione a resti maggiori (`apportionDiscount`); Σ castelletto = totale | #NN |`;
- nella voce **P6.2 Fiscale** di P6 togli la frase sul castelletto prima dello sconto punti e lascia SDI/XML, scontrino telematico, Stripe Tax, codici natura;
- nella riga **P1.1** aggiungi alle note «spec: `docs/superpowers/specs/2026-09-24-customer-checkout-design.md`, PR A–F».

`#NN` si sostituisce col numero della PR dopo averla aperta (Step 3), con un commit successivo.

- [ ] **Step 3: Commit, push, PR con auto-merge**

```bash
git add docs/audit/2026-09-24-followup-gap-analysis.md docs/superpowers/plans/2026-09-24-pr-a-castelletto-snapshot.md
git commit -m "docs(orders): backlog aggiornato per P1.5 e P6.2"
git push -u origin feat/orders-castelletto-snapshot
gh pr create --title "feat(orders): castelletto dopo i punti, snapshot indirizzo, core placeOrder" --body "<riassunto + test plan + 🤖 Generated with [Claude Code](https://claude.com/claude-code)>"
gh pr merge --auto --squash
```
Poi sostituisci `#NN` col numero reale, commit `docs(orders): numero PR nel backlog`, push. PR senza UI: nessuno smoke browser.
