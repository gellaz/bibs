# PR C — Checkout «Prenota e paga in negozio» (PP1) + Ordini customer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il cliente passa dal carrello a N prenotazioni in un colpo, una per negozio. Le righe ordinate escono dal carrello. Il cliente ritrova le sue prenotazioni in «Ordini», con la scadenza del ritiro, e può annullarle.

**Architecture:** API: colonna `stores.order_types`; tabella `checkouts` + `orders.checkout_id`; `createCheckout` legge il carrello lato server e crea tutti gli ordini in **una** transazione con `placeOrder`, cancellando nella stessa tx le righe ordinate. `idempotencyKey` esce da `PlaceOrderParams`: l'idempotenza è del chiamante. Una regola unica, `offeredOrderTypes`, decide quali tipi si offrono: oggi solo `reserve_pickup`, perché `pay_pickup` richiede Connect (PR E) e il pagamento (PR F). FE customer: CTA nel carrello, `/checkout` (scelta), `/checkout/review` (riepilogo), `/checkout/$checkoutId` (prenotazione confermata), `/orders` (tab Prenotazioni / Pagati), `/orders/$orderId` (dettaglio + annulla).

**Tech Stack:** Elysia + TypeBox, Drizzle, bun:test + testcontainers; TanStack Start/Router/Query, `@bibs/ui`, paraglide.

**Spec:** `docs/superpowers/specs/2026-09-24-customer-checkout-design.md` (sezioni «Flusso customer», «Entità checkouts», «POST /customer/checkout», «Tipologie consentite dal negozio»)

## Global Constraints

- Nomi: PP1 = `reserve_pickup` = «Prenota e paga in negozio»; PR2 = `pay_pickup` = «Paga e ritira».
- Bottone di conferma: **PRENOTA** (solo PP1), **PAGA** (solo PR2), **PRENOTA E PAGA** (misto). In questa PR esiste solo PRENOTA, ma la funzione copre i tre casi.
- **Timer di ritiro** (decisione di Marco, 2026-09-25): sulle prenotazioni aperte un conto alla rovescia vivo `hh:mm:ss` accanto alla scadenza «Ritira entro ven 27 set, 09:27». DESIGN.md vietava i countdown: la regola si aggiorna in questa PR (Task 5) con l'eccezione della scadenza reale di una prenotazione; resta vietata l'urgenza di marketing. Il timer è testo neutro `tabular-nums` (niente rosso lampeggiante, niente saffron), `role="timer"` con `aria-live="off"` e la data completa per gli screen reader.
- Saffron solo per momenti-segnale (≤5%); bottone primario Ink; tap target ≥44px su mobile; Satoshi (`font-display`) mai su prezzi o bottoni; token semantici per le superfici (dark mode).
- Badge al singolare, tab al plurale.
- Eden idrata le date ISO in `Date`.
- Toast da `@bibs/ui/components/sonner`. Route nuove → committare `apps/customer/src/routeTree.gen.ts`.
- `ServiceError(status, message)` con due argomenti. Messaggi rivolti al cliente in italiano.
- Commit Conventional con scope della whitelist (`orders`, `customer`, `db`, `api`, `docs`). Mai indebolire asserzioni o produzione per ottenere un RED.

## Review Focus

1. **Doppio click / retry di rete su «Prenota»** → un solo checkout, stessi ordini, carrello svuotato una volta → test di idempotenza in Task 3 (stessa key due volte) e `idempotencyKey` stabile per montaggio in Task 6.
2. **Il carrello cambia fra riepilogo e conferma** (stock sceso, prodotto disattivato): 409 senza ordini parziali, carrello intatto; il FE torna al carrello con un messaggio → test in Task 3, gestione in Task 6.
3. **Negozio nel body ma non nel carrello**, o `storeId` duplicati → 409 / 400 → test in Task 3.
4. **Prenotazione annullata dal negozio mentre il cliente guarda il dettaglio**: «Annulla» fallisce con un messaggio umano e la pagina si riallinea → Task 7 (invalidate su `onSettled`, messaggio 409/400 in italiano).
5. **Una riga non disponibile nello stesso negozio di righe buone**: si ordinano solo quelle buone; la riga non disponibile resta nel carrello → test in Task 3.

## Rulings

- La tabella `checkouts` nasce **senza** `stripe_payment_intent_id` e `amount_due_online`: li aggiunge la PR F, che li usa (YAGNI). Costo se sbagliato: una colonna in una migrazione della PR F.
- `POST /customer/orders` resta invariato: i test esistenti lo usano, e togliere l'endpoint è una scelta della PR F, quando `pay_*` prende il pagamento vero.
- `pay_pickup` è rifiutato dal checkout con 400 finché `offeredOrderTypes` non lo offre (PR E + F).

---

### Task 1: `stores.order_types` + `offeredOrderTypes` + tipi nel carrello

**Files:**
- Create: `apps/api/src/lib/order-types.ts`
- Modify: `apps/api/src/db/schemas/store.ts` (colonna + CHECK)
- Create: migrazione generata `apps/api/src/db/migrations/0009_*.sql`
- Modify: `apps/api/src/modules/customer/services/cart.ts` (select + gruppo)
- Modify: `apps/api/src/lib/schemas/entities.ts` (`CartStoreGroupSchema.store.orderTypes`)
- Modify: `apps/api/tests/helpers/fixtures.ts` (`createTestStore` accetta `orderTypes`)
- Test: `apps/api/tests/lib/order-types.test.ts`, `apps/api/tests/integration/customer-cart.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // lib/order-types.ts — senza import dal DB, così store.ts lo può importare
  export const storeOrderTypes = ["reserve_pickup", "pay_pickup"] as const;
  export type StoreOrderType = (typeof storeOrderTypes)[number];
  export function offeredOrderTypes(configured: readonly string[]): StoreOrderType[];
  // colonna
  store.orderTypes: text("order_types").array().$type<StoreOrderType[]>().notNull().default(sql`'{reserve_pickup}'`)
  // carrello
  CartStoreGroup.store.orderTypes: StoreOrderType[]   // già filtrati da offeredOrderTypes
  ```

- [ ] **Step 1: Test RED — regola pura**

`tests/lib/order-types.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { offeredOrderTypes } from "@/lib/order-types";

describe("offeredOrderTypes", () => {
	it("offre la prenotazione configurata dal negozio", () => {
		expect(offeredOrderTypes(["reserve_pickup"])).toEqual(["reserve_pickup"]);
	});

	it("non offre il pagamento online finché non c'è l'incasso (PR E/F)", () => {
		expect(offeredOrderTypes(["reserve_pickup", "pay_pickup"])).toEqual([
			"reserve_pickup",
		]);
		expect(offeredOrderTypes(["pay_pickup"])).toEqual([]);
	});

	it("ignora valori sconosciuti", () => {
		expect(offeredOrderTypes(["direct", "reserve_pickup"])).toEqual([
			"reserve_pickup",
		]);
	});
});
```

Run (da `apps/api`): `bun test tests/lib/order-types.test.ts` → Expected: FAIL (modulo mancante).

- [ ] **Step 2: Implementazione della regola**

`lib/order-types.ts`:

```ts
/** Tipi d'ordine che un negozio può offrire al checkout (colonna stores.order_types). */
export const storeOrderTypes = ["reserve_pickup", "pay_pickup"] as const;
export type StoreOrderType = (typeof storeOrderTypes)[number];

// Pagamento online non ancora attivo: arriva con Connect (PR E) e il pagamento
// (PR F). Fino ad allora un negozio può averlo configurato ma non lo offre.
const ONLINE_PAYMENT_LIVE = false;

/**
 * Unica regola su cosa si offre al checkout: la usano il carrello (per mostrare
 * la scelta) e il checkout (per validarla), così non possono divergere.
 */
export function offeredOrderTypes(
	configured: readonly string[],
): StoreOrderType[] {
	return storeOrderTypes.filter(
		(t) =>
			configured.includes(t) && (t !== "pay_pickup" || ONLINE_PAYMENT_LIVE),
	);
}
```

Run: `bun test tests/lib/order-types.test.ts` → PASS.

- [ ] **Step 3: Test RED — colonna e carrello**

In `tests/integration/customer-cart.test.ts`:
- nel `describe` dei vincoli di schema aggiungi:

```ts
	it("stores.order_types rifiuta un insieme vuoto o un tipo sconosciuto", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);
		await expect(
			db.execute(sql`UPDATE stores SET order_types = '{}' WHERE id = ${s.id}`),
		).rejects.toThrow();
		await expect(
			db.execute(
				sql`UPDATE stores SET order_types = '{direct}' WHERE id = ${s.id}`,
			),
		).rejects.toThrow();
		const [row] = await db.select().from(store).where(eq(store.id, s.id));
		expect(row.orderTypes).toEqual(["reserve_pickup"]);
	});
```

- nel `describe` di `getCart` aggiungi:

```ts
	it("ogni gruppo porta i tipi d'ordine offerti dal negozio", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const { sp } = await sellableProduct(seller.profile.id, { stock: 5 });
		await createTestCartItem(db, customer.profile.id, sp.id, { quantity: 1 });
		await db
			.update(store)
			.set({ orderTypes: ["reserve_pickup", "pay_pickup"] })
			.where(eq(store.id, sp.storeId));

		const cart = await getCart(customer.profile.id);
		// pay_pickup configurato ma non offerto finché non c'è l'incasso
		expect(cart.groups[0].store.orderTypes).toEqual(["reserve_pickup"]);
	});
```

Adegua gli import (`sql`, `store`) e il nome dell'helper `sellableProduct` / del campo `sp.storeId` a quelli reali del file (righe 65-85). Run: `bun test tests/integration/customer-cart.test.ts --timeout 180000` → Expected: FAIL (colonna inesistente).

- [ ] **Step 4: Colonna + migrazione**

In `db/schemas/store.ts`: import `storeOrderTypes`, `StoreOrderType` da `@/lib/order-types`; dopo `closures`:

```ts
		// Tipi d'ordine che il negozio accetta. Cosa si offre davvero al checkout
		// lo decide offeredOrderTypes() (il pagamento online richiede Connect).
		orderTypes: text("order_types")
			.array()
			.$type<StoreOrderType[]>()
			.notNull()
			.default(sql`'{reserve_pickup}'`),
```

e fra i vincoli della tabella:

```ts
		check(
			"store_order_types_valid",
			sql`cardinality(${t.orderTypes}) > 0 AND ${t.orderTypes} <@ ARRAY[${sql.raw(
				storeOrderTypes.map((v) => `'${v}'`).join(", "),
			)}]::text[]`,
		),
```

(adegua `t`/`table` al nome del parametro usato nel file e aggiungi `check` agli import di `drizzle-orm/pg-core`). Run: `bun run db:generate` → nuova migrazione con solo `ADD COLUMN "order_types" text[] DEFAULT '{reserve_pickup}' NOT NULL` + `ADD CONSTRAINT "store_order_types_valid" CHECK (...)`. Aprila e verifica che non contenga altro. Applica al DB locale: `bun run db:migrate`.

- [ ] **Step 5: Carrello**

In `services/cart.ts`: aggiungi `storeOrderTypes: store.orderTypes` al select di `getCart`, `orderTypes: StoreOrderType[]` a `CartStoreGroup.store`, e nel gruppo `orderTypes: offeredOrderTypes(row.storeOrderTypes)`. In `entities.ts`, dentro `CartStoreGroupSchema.store`:

```ts
			orderTypes: t.Array(
				t.Union([t.Literal("reserve_pickup"), t.Literal("pay_pickup")]),
				{ description: "Tipi d'ordine offerti al checkout per questo negozio" },
			),
```

In `fixtures.ts` `createTestStore`: param `orderTypes?: ("reserve_pickup" | "pay_pickup")[]`, passato a `values` se definito.

- [ ] **Step 6: Verifica GREEN + typecheck + commit**

Run: `bun test tests/lib/order-types.test.ts tests/integration/customer-cart.test.ts --timeout 180000 && bun run typecheck` → PASS.

```bash
git add apps/api/src/lib/order-types.ts apps/api/src/db apps/api/src/modules/customer/services/cart.ts apps/api/src/lib/schemas/entities.ts apps/api/tests
git commit -m "feat(stores): tipi d'ordine del negozio e regola unica di cosa si offre"
```

---

### Task 2: `checkouts` + `orders.checkout_id`, `placeOrder` senza idempotenza

**Files:**
- Create: `apps/api/src/db/schemas/checkout.ts`
- Modify: `apps/api/src/db/schemas/index.ts`, `apps/api/src/db/schemas/order.ts`, `apps/api/src/db/schemas/customer.ts` (relazione inversa, se il pattern la prevede)
- Create: migrazione `0010_*.sql`
- Modify: `apps/api/src/modules/customer/services/orders.ts`
- Test: suite ordini esistenti (non regressione)

**Interfaces:**
- Produces:
  ```ts
  export const checkout = pgTable("checkouts", { id, customerProfileId, idempotencyKey (unique, not null), createdAt });
  order.checkoutId: text("checkout_id").references(() => checkout.id, { onDelete: "set null" })  // + index order_checkout_id_idx
  export interface PlaceOrderParams { customerProfileId; customerPoints; type; storeId; items; shippingAddressId?; pointsToSpend? } // niente idempotencyKey
  export async function placeOrder(tx: OrderTx, params: PlaceOrderParams, link?: { idempotencyKey?: string; checkoutId?: string }): Promise<Order>
  export interface CreateOrderParams extends PlaceOrderParams { idempotencyKey?: string }
  ```

- [ ] **Step 1: Schema**

`db/schemas/checkout.ts`:

```ts
import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { customerProfile } from "./customer";
import { order } from "./order";

/**
 * Un checkout = una conferma del cliente, che produce un ordine per negozio.
 * Porta l'idempotenza (doppio click, retry di rete) e, dalla PR F, il
 * PaymentIntent unico degli ordini da pagare online.
 */
export const checkout = pgTable(
	"checkouts",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		customerProfileId: text("customer_profile_id")
			.notNull()
			.references(() => customerProfile.id, { onDelete: "cascade" }),
		idempotencyKey: text("idempotency_key").notNull().unique(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(t) => [index("checkout_customer_profile_id_idx").on(t.customerProfileId)],
);

export const checkoutRelations = relations(checkout, ({ one, many }) => ({
	customerProfile: one(customerProfile, {
		fields: [checkout.customerProfileId],
		references: [customerProfile.id],
	}),
	orders: many(order),
}));
```

In `order.ts`: import `checkout` da `./checkout` (se crea un ciclo di import che rompe l'inizializzazione, usa il callback lazy `references(() => checkout.id)` che è già lazy; drizzle gestisce i cicli fra file di schema — verifica col typecheck e con un test), colonna `checkoutId` dopo `idempotencyKey` con commento «Checkout che ha prodotto l'ordine; NULL per ordini creati da POST /customer/orders», indice `index("order_checkout_id_idx").on(table.checkoutId)`, relazione `checkout: one(checkout, { fields: [order.checkoutId], references: [checkout.id] })` in `orderRelations`. In `schemas/index.ts`: `export * from "./checkout";` in ordine alfabetico.

Run: `bun run db:generate` → migrazione con `CREATE TABLE "checkouts"`, unique, indice, FK, `ADD COLUMN "checkout_id"` + FK + indice su `orders`; nient'altro. `bun run db:migrate`.

- [ ] **Step 2: `placeOrder` senza idempotenza**

In `customer/services/orders.ts`:
- togli `idempotencyKey?` da `PlaceOrderParams`;
- `export interface CreateOrderParams extends PlaceOrderParams { idempotencyKey?: string }` (sostituisce l'alias);
- firma `placeOrder(tx: OrderTx, params: PlaceOrderParams, link: { idempotencyKey?: string; checkoutId?: string } = {})`; nell'insert `idempotencyKey: link.idempotencyKey ?? null, checkoutId: link.checkoutId ?? null`; togli `idempotencyKey` dalla destrutturazione;
- `createOrder`: `const { idempotencyKey, ...orderParams } = params;` e `db.transaction((tx) => placeOrder(tx, orderParams, { idempotencyKey }))`;
- docblock di `placeOrder`: «… Il chiamante gestisce l'idempotenza: `createOrder` passa la sua key, il checkout nessuna (una key unica su N ordini violerebbe l'indice) e lega gli ordini col `checkoutId`.»

Aggiungi anche `checkoutId: t.Nullable(t.String({ description: "Checkout che ha creato l'ordine" }))` a `OrderSchema` in `entities.ts`.

- [ ] **Step 3: Non regressione + commit**

Run: `bun test tests/integration/customer-orders.test.ts tests/integration/customer-orders-vat.test.ts tests/integration/customer-orders-discounts.test.ts tests/integration/customer-orders-address-idor.test.ts tests/integration/customer-orders-address-snapshot.test.ts tests/integration/order-reads-store-location.test.ts --timeout 180000 && bun run typecheck` → tutti PASS (l'idempotenza di `POST /customer/orders` ha già i suoi test).

```bash
git add apps/api/src/db apps/api/src/modules/customer/services/orders.ts apps/api/src/lib/schemas/entities.ts
git commit -m "feat(orders): entità checkout e placeOrder senza idempotenza propria"
```

---

### Task 3: `createCheckout` + `getCheckout` (dominio, TDD)

**Files:**
- Create: `apps/api/src/modules/customer/services/checkout.ts`
- Modify: `apps/api/src/modules/customer/services/orders.ts` (`listCustomerOrders` accetta `checkoutId?`)
- Test: `apps/api/tests/integration/customer-checkout.test.ts`

**Interfaces:**
- Consumes: `placeOrder` + `link` (Task 2), `offeredOrderTypes` (Task 1), `listCustomerOrders`.
- Produces:
  ```ts
  export interface CreateCheckoutParams {
    customerProfileId: string;
    customerPoints: number;
    idempotencyKey: string;
    stores: { storeId: string; type: "reserve_pickup" | "pay_pickup" }[];
  }
  export async function createCheckout(p: CreateCheckoutParams): Promise<CheckoutView>;
  export async function getCheckout(p: { checkoutId: string; customerProfileId: string }): Promise<CheckoutView>;
  export type CheckoutView = { id: string; createdAt: Date; orders: CustomerOrderWithRelations[] };
  ```

- [ ] **Step 1: Test RED**

`tests/integration/customer-checkout.test.ts` (setup identico a `customer-cart.test.ts`: mock `@/db` con Proxy **prima** degli import, container, `truncateAll`). Helper locale:

```ts
async function sellable(sellerProfileId: string, storeName: string, stock = 5) {
	const db = getTestDb();
	const store = await createTestStore(db, sellerProfileId, { name: storeName });
	await createTestStoreSubscription(db, store.id);
	const product = await createTestProduct(db, sellerProfileId, {
		price: "10.00",
	});
	const sp = await createTestStoreProduct(db, store.id, product.id, { stock });
	return { store, product, sp };
}
```

Test (ognuno con cliente e seller propri):

```ts
describe("createCheckout", () => {
	it("crea una prenotazione per negozio e toglie dal carrello solo le righe ordinate", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const a = await sellable(seller.profile.id, "Negozio A");
		const b = await sellable(seller.profile.id, "Negozio B");
		const c = await sellable(seller.profile.id, "Negozio C");
		await createTestCartItem(db, customer.profile.id, a.sp.id, { quantity: 2 });
		await createTestCartItem(db, customer.profile.id, b.sp.id, { quantity: 1 });
		await createTestCartItem(db, customer.profile.id, c.sp.id, { quantity: 1 });

		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [
				{ storeId: a.store.id, type: "reserve_pickup" },
				{ storeId: b.store.id, type: "reserve_pickup" },
			],
		});

		expect(result.orders).toHaveLength(2);
		for (const o of result.orders) {
			expect(o.type).toBe("reserve_pickup");
			expect(o.status).toBe("confirmed");
			expect(o.checkoutId).toBe(result.id);
			expect(o.reservationExpiresAt).not.toBeNull();
		}
		const left = await db
			.select()
			.from(cartItem)
			.where(eq(cartItem.customerProfileId, customer.profile.id));
		expect(left.map((r) => r.storeProductId)).toEqual([c.sp.id]);
		const [spA] = await db
			.select()
			.from(storeProduct)
			.where(eq(storeProduct.id, a.sp.id));
		expect(spA.stock).toBe(3);
	});

	it("con una riga a stock insufficiente non crea nulla e lascia il carrello intatto", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const a = await sellable(seller.profile.id, "Negozio A");
		const b = await sellable(seller.profile.id, "Negozio B", 1);
		await createTestCartItem(db, customer.profile.id, a.sp.id, { quantity: 1 });
		await createTestCartItem(db, customer.profile.id, b.sp.id, { quantity: 1 });
		await db
			.update(storeProduct)
			.set({ stock: 0 })
			.where(eq(storeProduct.id, b.sp.id));

		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 0,
				idempotencyKey: crypto.randomUUID(),
				stores: [
					{ storeId: a.store.id, type: "reserve_pickup" },
					{ storeId: b.store.id, type: "reserve_pickup" },
				],
			}),
		).rejects.toMatchObject({ status: 409 });

		expect(await db.select().from(order)).toHaveLength(0);
		expect(await db.select().from(checkout)).toHaveLength(0);
		expect(
			await db
				.select()
				.from(cartItem)
				.where(eq(cartItem.customerProfileId, customer.profile.id)),
		).toHaveLength(2);
	});

	it("salta le righe non disponibili e le lascia nel carrello", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const a = await sellable(seller.profile.id, "Negozio A");
		const other = await createTestProduct(db, seller.profile.id, {
			price: "4.00",
		});
		const spOff = await createTestStoreProduct(db, a.store.id, other.id, {
			stock: 5,
		});
		await createTestCartItem(db, customer.profile.id, a.sp.id, { quantity: 1 });
		await createTestCartItem(db, customer.profile.id, spOff.id, {
			quantity: 1,
		});
		await db
			.update(productTable)
			.set({ status: "disabled" })
			.where(eq(productTable.id, other.id));

		const result = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [{ storeId: a.store.id, type: "reserve_pickup" }],
		});

		expect(result.orders[0].items).toHaveLength(1);
		expect(result.orders[0].total).toBe("10.00");
		const left = await db
			.select()
			.from(cartItem)
			.where(eq(cartItem.customerProfileId, customer.profile.id));
		expect(left.map((r) => r.storeProductId)).toEqual([spOff.id]);
	});

	it("la stessa key restituisce lo stesso checkout senza ordini in più", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const a = await sellable(seller.profile.id, "Negozio A");
		await createTestCartItem(db, customer.profile.id, a.sp.id, { quantity: 1 });
		const params = {
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [{ storeId: a.store.id, type: "reserve_pickup" as const }],
		};

		const first = await createCheckout(params);
		const second = await createCheckout(params);

		expect(second.id).toBe(first.id);
		expect(second.orders.map((o) => o.id)).toEqual(
			first.orders.map((o) => o.id),
		);
		expect(await db.select().from(order)).toHaveLength(1);
	});

	it("rifiuta un tipo non offerto (pay_pickup) con 400", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const a = await sellable(seller.profile.id, "Negozio A");
		await db
			.update(storeTable)
			.set({ orderTypes: ["reserve_pickup", "pay_pickup"] })
			.where(eq(storeTable.id, a.store.id));
		await createTestCartItem(db, customer.profile.id, a.sp.id, { quantity: 1 });

		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 0,
				idempotencyKey: crypto.randomUUID(),
				stores: [{ storeId: a.store.id, type: "pay_pickup" }],
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("un negozio senza righe acquistabili nel carrello è 409", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const a = await sellable(seller.profile.id, "Negozio A");
		const b = await sellable(seller.profile.id, "Negozio B");
		await createTestCartItem(db, customer.profile.id, a.sp.id, { quantity: 1 });

		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 0,
				idempotencyKey: crypto.randomUUID(),
				stores: [{ storeId: b.store.id, type: "reserve_pickup" }],
			}),
		).rejects.toMatchObject({ status: 409 });
	});

	it("storeId duplicati sono 400", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const a = await sellable(seller.profile.id, "Negozio A");
		await createTestCartItem(db, customer.profile.id, a.sp.id, { quantity: 1 });

		await expect(
			createCheckout({
				customerProfileId: customer.profile.id,
				customerPoints: 0,
				idempotencyKey: crypto.randomUUID(),
				stores: [
					{ storeId: a.store.id, type: "reserve_pickup" },
					{ storeId: a.store.id, type: "reserve_pickup" },
				],
			}),
		).rejects.toMatchObject({ status: 400 });
	});
});

describe("getCheckout", () => {
	it("restituisce gli ordini del checkout solo al suo cliente", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const stranger = await createTestCustomer(db);
		const a = await sellable(seller.profile.id, "Negozio A");
		await createTestCartItem(db, customer.profile.id, a.sp.id, { quantity: 1 });
		const created = await createCheckout({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			idempotencyKey: crypto.randomUUID(),
			stores: [{ storeId: a.store.id, type: "reserve_pickup" }],
		});

		const view = await getCheckout({
			checkoutId: created.id,
			customerProfileId: customer.profile.id,
		});
		expect(view.orders.map((o) => o.store.name)).toEqual(["Negozio A"]);

		await expect(
			getCheckout({
				checkoutId: created.id,
				customerProfileId: stranger.profile.id,
			}),
		).rejects.toMatchObject({ status: 404 });
	});
});
```

Import: `checkout` da `@/db/schemas/checkout`, `cartItem`, `order`, `product as productTable`, `storeProduct`, `store as storeTable`, fixture. Verifica il valore reale di «prodotto disattivato» in `productStatuses` (`db/schemas/product.ts`) e usalo al posto di `"disabled"` se diverso.

Run: `bun test tests/integration/customer-checkout.test.ts --timeout 180000` → Expected: FAIL (modulo mancante).

- [ ] **Step 2: `listCustomerOrders` filtra per checkout**

In `ListCustomerOrdersParams` aggiungi `checkoutId?: string` e `if (checkoutId) conditions.push(eq(order.checkoutId, checkoutId));`.

- [ ] **Step 3: Service**

`services/checkout.ts`:

```ts
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { cartItem } from "@/db/schemas/cart";
import { checkout } from "@/db/schemas/checkout";
import { product, storeProduct } from "@/db/schemas/product";
import { store } from "@/db/schemas/store";
import { isUniqueViolation, ServiceError } from "@/lib/errors";
import { offeredOrderTypes } from "@/lib/order-types";
import { publiclyVisibleStore } from "@/lib/store-visibility";
import { listCustomerOrders, placeOrder } from "./orders";

export interface CreateCheckoutParams {
	customerProfileId: string;
	customerPoints: number;
	idempotencyKey: string;
	stores: { storeId: string; type: "reserve_pickup" | "pay_pickup" }[];
}

/** Un checkout con i suoi ordini, nella stessa forma della lista ordini. */
export async function getCheckout(params: {
	checkoutId: string;
	customerProfileId: string;
}) {
	const found = await db.query.checkout.findFirst({
		where: and(
			eq(checkout.id, params.checkoutId),
			eq(checkout.customerProfileId, params.customerProfileId),
		),
	});
	if (!found) throw new ServiceError(404, "Checkout non trovato");
	const { data } = await listCustomerOrders({
		customerProfileId: params.customerProfileId,
		checkoutId: found.id,
		page: 1,
		limit: 100,
	});
	return { id: found.id, createdAt: found.createdAt, orders: data };
}

/**
 * Trasforma il carrello in un ordine per negozio, in UNA transazione: o nascono
 * tutti o nessuno, e nella stessa tx escono dal carrello le righe ordinate.
 * Le righe si leggono dal carrello lato server: il client sceglie solo negozi e
 * tipologia. Righe non disponibili: saltate, restano nel carrello. Stock
 * insufficiente: 409, il cliente torna al carrello.
 */
export async function createCheckout(params: CreateCheckoutParams) {
	const { customerProfileId, customerPoints, idempotencyKey, stores } = params;

	const existing = await db.query.checkout.findFirst({
		where: eq(checkout.idempotencyKey, idempotencyKey),
	});
	if (existing) {
		if (existing.customerProfileId !== customerProfileId)
			throw new ServiceError(409, "Chiave di idempotenza già usata");
		return getCheckout({ checkoutId: existing.id, customerProfileId });
	}

	const storeIds = stores.map((s) => s.storeId);
	if (new Set(storeIds).size !== storeIds.length)
		throw new ServiceError(400, "Ogni negozio può comparire una sola volta");

	const created = db
		.transaction(async (tx) => {
			const [row] = await tx
				.insert(checkout)
				.values({ customerProfileId, idempotencyKey })
				.returning({ id: checkout.id });

			// Righe del carrello per i negozi scelti, con quanto serve a decidere
			// se sono acquistabili (stessa definizione di getCart).
			const lines = await tx
				.select({
					id: cartItem.id,
					storeProductId: cartItem.storeProductId,
					quantity: cartItem.quantity,
					stock: storeProduct.stock,
					productStatus: product.status,
					storeId: store.id,
					storeName: store.name,
					orderTypes: store.orderTypes,
				})
				.from(cartItem)
				.innerJoin(storeProduct, eq(storeProduct.id, cartItem.storeProductId))
				.innerJoin(product, eq(product.id, storeProduct.productId))
				.innerJoin(store, eq(store.id, storeProduct.storeId))
				.where(
					and(
						eq(cartItem.customerProfileId, customerProfileId),
						inArray(store.id, storeIds),
						publiclyVisibleStore(),
					),
				);

			for (const choice of stores) {
				const own = lines.filter((l) => l.storeId === choice.storeId);
				const buyable = own.filter((l) => l.productStatus === "active");
				if (buyable.length === 0)
					throw new ServiceError(
						409,
						"Il carrello è cambiato: questo negozio non ha più articoli acquistabili",
					);
				if (!offeredOrderTypes(own[0].orderTypes).includes(choice.type))
					throw new ServiceError(
						400,
						`${own[0].storeName} non offre questa modalità d'acquisto`,
					);
				if (buyable.some((l) => l.stock < l.quantity))
					throw new ServiceError(
						409,
						"Il carrello è cambiato: alcune quantità non sono più disponibili",
					);

				await placeOrder(
					tx,
					{
						customerProfileId,
						customerPoints,
						type: choice.type,
						storeId: choice.storeId,
						items: buyable.map((l) => ({
							storeProductId: l.storeProductId,
							quantity: l.quantity,
						})),
					},
					{ checkoutId: row.id },
				);

				await tx.delete(cartItem).where(
					and(
						eq(cartItem.customerProfileId, customerProfileId),
						inArray(
							cartItem.id,
							buyable.map((l) => l.id),
						),
					),
				);
			}

			return row.id;
		})
		.catch(async (err: unknown) => {
			// Race sulla key: un'altra richiesta identica ha vinto l'insert.
			if (isUniqueViolation(err)) {
				const winner = await db.query.checkout.findFirst({
					where: eq(checkout.idempotencyKey, idempotencyKey),
				});
				if (winner?.customerProfileId === customerProfileId) return winner.id;
			}
			throw err;
		});

	return getCheckout({ checkoutId: await created, customerProfileId });
}
```

Nota: un negozio non visibile al pubblico non compare in `lines` → 409 come «non ha più articoli acquistabili». `placeOrder` ri-verifica vendibilità e stock dentro la stessa tx (CAS sullo stock → 409 su race).

- [ ] **Step 4: Verifica GREEN + typecheck + commit**

Run: `bun test tests/integration/customer-checkout.test.ts --timeout 180000 && bun run typecheck` → PASS.

```bash
git add apps/api/src/modules/customer/services apps/api/tests/integration/customer-checkout.test.ts
git commit -m "feat(orders): checkout multi-negozio in una transazione che svuota il carrello"
```

---

### Task 4: Route del checkout

**Files:**
- Create: `apps/api/src/modules/customer/routes/checkout.ts`
- Modify: `apps/api/src/modules/customer/index.ts` (`.use(checkoutRoutes)`)
- Modify: `apps/api/src/lib/schemas/composed.ts` (`CheckoutSchema`)
- Test: `apps/api/tests/integration/customer-checkout.test.ts` (un test HTTP)

**Interfaces:**
- Produces: `POST /customer/checkout` body `{ idempotencyKey: uuid, stores: [{ storeId, type }] (minItems 1) }` → `okRes(CheckoutSchema)`; `GET /customer/checkouts/:checkoutId` → `okRes(CheckoutSchema)`. `CheckoutSchema = t.Object({ id: t.String(), createdAt: t.Date(), orders: t.Array(CustomerOrderWithRelationsSchema) })`.

- [ ] **Step 1: Test RED (HTTP)**

In `customer-checkout.test.ts`, un harness come `seller-orders-routes.test.ts` (Elysia con `.state("pino", noopPino).use(errorHandler).resolve(...)` che restituisce `{ user, customerProfile }` letti dal DB tramite header `x-test-user`, poi `.use(checkoutRoutes)`):

```ts
describe("POST /checkout", () => {
	it("crea il checkout e la risposta rispetta lo schema", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const customer = await createTestCustomer(db);
		const a = await sellable(seller.profile.id, "Negozio A");
		await createTestCartItem(db, customer.profile.id, a.sp.id, { quantity: 1 });

		const res = await app.handle(
			new Request("http://localhost/checkout", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-test-user": customer.user.id,
				},
				body: JSON.stringify({
					idempotencyKey: crypto.randomUUID(),
					stores: [{ storeId: a.store.id, type: "reserve_pickup" }],
				}),
			}),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.orders).toHaveLength(1);
	});

	it("body senza negozi → 422", async () => {
		const db = getTestDb();
		const customer = await createTestCustomer(db);
		const res = await app.handle(
			new Request("http://localhost/checkout", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-test-user": customer.user.id,
				},
				body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), stores: [] }),
			}),
		);
		expect(res.status).toBe(422);
	});
});
```

Verifica in `createTestCustomer` il nome del campo utente restituito (`user`) e nel customer module cosa legge la resolve (`customerProfile` per `userId`). Verifica il codice di validazione di Elysia nel progetto (422 in `store-update-validation.test.ts`).

Run → Expected: FAIL (route mancante).

- [ ] **Step 2: Schema e route**

`composed.ts`:

```ts
// Checkout — conferma del cliente con gli ordini che ha prodotto
export const CheckoutSchema = t.Object({
	id: t.String(),
	createdAt: t.Date(),
	orders: t.Array(CustomerOrderWithRelationsSchema),
});
```

`routes/checkout.ts`:

```ts
import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok } from "@/lib/responses";
import {
	CheckoutSchema,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { withCustomer } from "../context";
import { createCheckout, getCheckout } from "../services/checkout";

export const checkoutRoutes = new Elysia()
	.post(
		"/checkout",
		async (ctx) => {
			const { customerProfile: cp, body, store, user } = withCustomer(ctx);
			const pino = getLogger(store);
			const data = await createCheckout({
				customerProfileId: cp.id,
				customerPoints: cp.points,
				...body,
			});
			pino.info(
				{
					userId: user.id,
					customerProfileId: cp.id,
					checkoutId: data.id,
					orderCount: data.orders.length,
					action: "checkout_created",
				},
				"Checkout creato",
			);
			return ok(data);
		},
		{
			body: t.Object({
				idempotencyKey: t.String({
					format: "uuid",
					description:
						"UUID generato dal client per questa conferma: richieste ripetute restituiscono lo stesso checkout",
				}),
				stores: t.Array(
					t.Object({
						storeId: t.String({ description: "ID del negozio" }),
						type: t.Union(
							[t.Literal("reserve_pickup"), t.Literal("pay_pickup")],
							{ description: "Modalità d'acquisto scelta per il negozio" },
						),
					}),
					{ minItems: 1, description: "Negozi del carrello da ordinare" },
				),
			}),
			response: withConflictErrors({ 200: okRes(CheckoutSchema) }),
			detail: {
				summary: "Conferma checkout",
				description:
					"Crea un ordine per ogni negozio scelto, leggendo le righe dal carrello, in un'unica transazione. Le righe ordinate escono dal carrello; quelle non disponibili restano. 409 se il carrello è cambiato.",
				tags: ["Customer - Checkout"],
			},
		},
	)
	.get(
		"/checkouts/:checkoutId",
		async (ctx) => {
			const { customerProfile: cp, params } = withCustomer(ctx);
			return ok(
				await getCheckout({
					checkoutId: params.checkoutId,
					customerProfileId: cp.id,
				}),
			);
		},
		{
			params: t.Object({ checkoutId: t.String() }),
			response: withErrors({ 200: okRes(CheckoutSchema) }),
			detail: {
				summary: "Dettaglio checkout",
				description: "Il checkout con i suoi ordini (pagina di ordine effettuato).",
				tags: ["Customer - Checkout"],
			},
		},
	);
```

In `customer/index.ts`: import e `.use(checkoutRoutes)` dopo `cartRoutes`.

- [ ] **Step 3: Verifica GREEN + typecheck + commit**

Run: `bun test tests/integration/customer-checkout.test.ts --timeout 180000 && bun run typecheck` → PASS. Poi `(cd ../customer && bun run typecheck)` per i tipi Eden.

```bash
git add apps/api/src apps/api/tests/integration/customer-checkout.test.ts
git commit -m "feat(orders): route di checkout e dettaglio checkout"
```

---

### Task 5: Funzioni pure del customer (TDD)

**Files:**
- Create: `apps/customer/src/features/checkout/checkout-choice.ts` + `.test.ts`
- Create: `apps/customer/src/features/orders/order-display.ts` + `.test.ts`
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json`

**Interfaces:**
- Produces:
  ```ts
  export function formatCountdown(ms: number): string;               // "47:59:12"
  export function PickupCountdown(props: { expiresAt: Date | string }): JSX.Element;
  export type CheckoutType = "reserve_pickup" | "pay_pickup";
  export type CheckoutChoice = Record<string, CheckoutType>;          // storeId → tipo
  export function parseChoice(raw: unknown): CheckoutChoice;          // "id1:reserve_pickup,id2:pay_pickup"
  export function serializeChoice(c: CheckoutChoice): string | undefined;
  export function resolveChoice(groups: { store: { id: string; orderTypes: CheckoutType[] } }[], choice: CheckoutChoice): { choice: CheckoutChoice; complete: boolean };
  export function confirmLabel(types: CheckoutType[]): string;        // PRENOTA / PAGA / PRENOTA E PAGA
  export function pickupDeadline(expiresAt: Date | string, now?: number): { expired: boolean; date: string; left: string };
  export const CUSTOMER_ORDER_STATUS: Record<OrderStatus, () => string>;
  export function canCustomerCancel(o: { status: string; type: string }): boolean;
  ```

- [ ] **Step 1: Messaggi**

Aggiungi a `it.json` (e l'inglese a `en.json`, stesse chiavi):

```json
"nav_orders": "Ordini",
"cart_checkout_cta": "Avanti",
"cart_fix_quantities": "Riduci le quantità segnate per continuare.",
"checkout_choose_title": "Come vuoi acquistare?",
"checkout_choose_subtitle": "Scegli la modalità per ogni negozio.",
"checkout_type_reserve_pickup": "Prenota e paga in negozio",
"checkout_type_reserve_pickup_hint": "Prenoti ora, paghi al ritiro entro {hours} ore.",
"checkout_type_pay_pickup": "Paga e ritira",
"checkout_type_pay_pickup_hint": "Paghi ora online e ritiri in negozio.",
"checkout_items_count": "{count} articoli",
"checkout_items_count_one": "1 articolo",
"checkout_next": "Avanti",
"checkout_back_to_cart": "Torna al carrello",
"checkout_review_title": "Riepilogo",
"checkout_pay_now": "Da pagare ora",
"checkout_pay_in_store": "Da pagare in negozio",
"checkout_reserve_note": "Hai {hours} ore per ritirare: dopo la prenotazione scade e i prodotti tornano disponibili.",
"checkout_confirm_reserve": "Prenota",
"checkout_confirm_pay": "Paga",
"checkout_confirm_reserve_and_pay": "Prenota e paga",
"checkout_cart_changed": "Il carrello è cambiato: controlla le quantità e riprova.",
"checkout_done_title": "Prenotazione confermata",
"checkout_done_title_many": "Prenotazioni confermate",
"checkout_done_subtitle": "Ti aspettano in negozio. Trovi tutto anche in Ordini.",
"checkout_done_orders_cta": "Vai ai tuoi ordini",
"checkout_done_continue": "Continua a esplorare",
"checkout_not_found": "Non troviamo questo checkout.",
"orders_title": "I tuoi ordini",
"orders_tab_reserved": "Prenotazioni",
"orders_tab_paid": "Pagati",
"orders_empty_reserved": "Nessuna prenotazione",
"orders_empty_paid": "Nessun ordine pagato",
"orders_empty_description": "Quando prenoti o compri in un negozio, lo ritrovi qui.",
"orders_status_pending": "In attesa di pagamento",
"orders_status_confirmed": "Confermato",
"orders_status_ready_for_pickup": "Pronto per il ritiro",
"orders_status_shipped": "Spedito",
"orders_status_delivered": "Consegnato",
"orders_status_completed": "Ritirato",
"orders_status_cancelled": "Annullato",
"orders_status_expired": "Scaduto",
"orders_pickup_by": "Ritira entro {date}",
"orders_pickup_left": "tra {time}",
"orders_pickup_expired": "Prenotazione scaduta",
"orders_order_number": "Ordine {number}",
"orders_total_in_store": "Da pagare in negozio",
"orders_total": "Totale",
"orders_items": "Articoli",
"orders_store": "Dove ritirare",
"orders_cancel": "Annulla prenotazione",
"orders_cancel_title": "Annullare la prenotazione?",
"orders_cancel_description": "Il negozio non la preparerà e i prodotti tornano disponibili per altri.",
"orders_cancel_confirm": "Annulla prenotazione",
"orders_cancel_keep": "Mantieni",
"orders_cancel_success": "Prenotazione annullata",
"orders_changed": "L'ordine è cambiato nel frattempo: ecco lo stato aggiornato.",
"orders_not_found": "Non troviamo questo ordine.",
"orders_load_failed": "Non siamo riusciti a caricare gli ordini."
```

Correggi anche `addresses_delete_description`: con lo snapshot (#197) gli ordini conservano l'indirizzo. Nuovo testo: «L'indirizzo sparisce dalla rubrica. Gli ordini già fatti conservano una copia dell'indirizzo di consegna.»

- [ ] **Step 2: Test RED**

`features/checkout/checkout-choice.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
	confirmLabel,
	parseChoice,
	resolveChoice,
	serializeChoice,
} from "./checkout-choice";

describe("parse/serializeChoice", () => {
	it("fa il giro completo", () => {
		const c = { s1: "reserve_pickup", s2: "pay_pickup" } as const;
		expect(parseChoice(serializeChoice(c))).toEqual(c);
	});
	it("scarta valori malformati o tipi sconosciuti", () => {
		expect(parseChoice("s1:reserve_pickup,s2:direct,broken,:x")).toEqual({
			s1: "reserve_pickup",
		});
		expect(parseChoice(undefined)).toEqual({});
		expect(parseChoice(42)).toEqual({});
	});
	it("una scelta vuota non va in URL", () => {
		expect(serializeChoice({})).toBeUndefined();
	});
});

describe("resolveChoice", () => {
	const groups = [
		{ store: { id: "s1", orderTypes: ["reserve_pickup" as const] } },
		{
			store: {
				id: "s2",
				orderTypes: ["reserve_pickup" as const, "pay_pickup" as const],
			},
		},
	];
	it("preseleziona l'unico tipo offerto", () => {
		expect(resolveChoice(groups, {})).toEqual({
			choice: { s1: "reserve_pickup" },
			complete: false,
		});
	});
	it("è completa quando ogni negozio ha un tipo offerto", () => {
		expect(resolveChoice(groups, { s2: "pay_pickup" })).toEqual({
			choice: { s1: "reserve_pickup", s2: "pay_pickup" },
			complete: true,
		});
	});
	it("scarta un tipo non offerto e i negozi non più nel carrello", () => {
		expect(
			resolveChoice(groups, { s1: "pay_pickup", gone: "reserve_pickup" }),
		).toEqual({ choice: { s1: "reserve_pickup" }, complete: false });
	});
});

describe("confirmLabel", () => {
	it("dice cosa succede", () => {
		expect(confirmLabel(["reserve_pickup"])).toBe("Prenota");
		expect(confirmLabel(["pay_pickup", "pay_pickup"])).toBe("Paga");
		expect(confirmLabel(["reserve_pickup", "pay_pickup"])).toBe(
			"Prenota e paga",
		);
	});
});
```

`features/orders/order-display.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { canCustomerCancel, pickupDeadline } from "./order-display";

describe("pickupDeadline", () => {
	const now = Date.parse("2026-09-25T09:00:00+02:00");
	it("mostra data e ora di scadenza e il tempo residuo, senza countdown", () => {
		const d = pickupDeadline("2026-09-27T09:30:00+02:00", now);
		expect(d.expired).toBe(false);
		expect(d.left).toBe("tra 48 h");
		expect(d.date).toContain("27");
	});
	it("sotto l'ora passa ai minuti", () => {
		expect(pickupDeadline(new Date(now + 25 * 60_000), now).left).toBe(
			"tra 25 min",
		);
	});
	it("scaduta", () => {
		expect(pickupDeadline(new Date(now - 1000), now).expired).toBe(true);
	});
});

describe("canCustomerCancel", () => {
	it("solo prenotazioni ancora da preparare", () => {
		expect(
			canCustomerCancel({ status: "confirmed", type: "reserve_pickup" }),
		).toBe(true);
		expect(
			canCustomerCancel({ status: "ready_for_pickup", type: "reserve_pickup" }),
		).toBe(false);
		expect(canCustomerCancel({ status: "completed", type: "reserve_pickup" }))
			.toBe(false);
	});
});
```

Run (da `apps/customer`): `bun test src/features/checkout src/features/orders` → Expected: FAIL (moduli mancanti).

- [ ] **Step 3: Implementazione**

`features/checkout/checkout-choice.ts`:

```ts
import { m } from "@/paraglide/messages";

export type CheckoutType = "reserve_pickup" | "pay_pickup";
/** storeId → tipologia scelta. Vive nei search params: sopravvive al refresh. */
export type CheckoutChoice = Record<string, CheckoutType>;

const TYPES: readonly CheckoutType[] = ["reserve_pickup", "pay_pickup"];

export function parseChoice(raw: unknown): CheckoutChoice {
	if (typeof raw !== "string") return {};
	const out: CheckoutChoice = {};
	for (const pair of raw.split(",")) {
		const [storeId, type] = pair.split(":");
		if (storeId && TYPES.includes(type as CheckoutType))
			out[storeId] = type as CheckoutType;
	}
	return out;
}

export function serializeChoice(c: CheckoutChoice): string | undefined {
	const pairs = Object.entries(c).map(([id, type]) => `${id}:${type}`);
	return pairs.length ? pairs.join(",") : undefined;
}

/**
 * Riconcilia la scelta in URL col carrello attuale: tiene solo negozi ancora
 * presenti e tipi ancora offerti, e preseleziona quando c'è una sola opzione.
 */
export function resolveChoice(
	groups: { store: { id: string; orderTypes: CheckoutType[] } }[],
	choice: CheckoutChoice,
): { choice: CheckoutChoice; complete: boolean } {
	const out: CheckoutChoice = {};
	for (const g of groups) {
		const picked = choice[g.store.id];
		if (picked && g.store.orderTypes.includes(picked)) out[g.store.id] = picked;
		else if (g.store.orderTypes.length === 1)
			out[g.store.id] = g.store.orderTypes[0];
	}
	return {
		choice: out,
		complete:
			groups.length > 0 && groups.every((g) => out[g.store.id] !== undefined),
	};
}

/** Il bottone dice cosa succede: prenotazione, pagamento, o entrambi. */
export function confirmLabel(types: CheckoutType[]): string {
	const reserve = types.includes("reserve_pickup");
	const pay = types.includes("pay_pickup");
	if (reserve && pay) return m.checkout_confirm_reserve_and_pay();
	return pay ? m.checkout_confirm_pay() : m.checkout_confirm_reserve();
}
```

`features/orders/order-display.ts`:

```ts
import { m } from "@/paraglide/messages";

export type OrderStatus =
	| "pending"
	| "confirmed"
	| "ready_for_pickup"
	| "shipped"
	| "delivered"
	| "completed"
	| "cancelled"
	| "expired";

/** Badge di un ordine, dal punto di vista del cliente: al singolare. */
export const CUSTOMER_ORDER_STATUS: Record<OrderStatus, () => string> = {
	pending: m.orders_status_pending,
	confirmed: m.orders_status_confirmed,
	ready_for_pickup: m.orders_status_ready_for_pickup,
	shipped: m.orders_status_shipped,
	delivered: m.orders_status_delivered,
	completed: m.orders_status_completed,
	cancelled: m.orders_status_cancelled,
	expired: m.orders_status_expired,
};

const DATE_FMT: Intl.DateTimeFormatOptions = {
	weekday: "short",
	day: "numeric",
	month: "short",
	hour: "2-digit",
	minute: "2-digit",
};

/**
 * Scadenza del ritiro come informazione statica (DESIGN.md vieta i countdown):
 * data e ora, più il tempo residuo arrotondato. Non si aggiorna da sola.
 */
export function pickupDeadline(
	expiresAt: Date | string,
	now: number = Date.now(),
): { expired: boolean; date: string; left: string } {
	const at = new Date(expiresAt);
	const ms = at.getTime() - now;
	const date = at.toLocaleString("it-IT", DATE_FMT);
	if (ms <= 0) return { expired: true, date, left: m.orders_pickup_expired() };
	const minutes = Math.ceil(ms / 60_000);
	const time =
		minutes >= 60 ? `${Math.floor(minutes / 60)} h` : `${minutes} min`;
	return { expired: false, date, left: m.orders_pickup_left({ time }) };
}

/** Rispecchia la macchina a stati dell'API: il cliente annulla solo finché il
 *  negozio non ha preparato. L'API resta l'autorità. */
export function canCustomerCancel(o: { status: string; type: string }) {
	return (
		(o.type === "reserve_pickup" || o.type === "pay_pickup") &&
		(o.status === "pending" || o.status === "confirmed")
	);
}
```

Run: `bun test src/features/checkout src/features/orders` → PASS; `bun run typecheck` → pulito.

- [ ] **Step 4: Timer (RED → GREEN)**

In `order-display.test.ts` aggiungi:

```ts
describe("formatCountdown", () => {
	it("ore:minuti:secondi, ore oltre le 24", () => {
		expect(formatCountdown(47 * 3_600_000 + 59 * 60_000 + 12_000)).toBe(
			"47:59:12",
		);
		expect(formatCountdown(65_000)).toBe("00:01:05");
	});
	it("mai negativo", () => {
		expect(formatCountdown(-5000)).toBe("00:00:00");
	});
});
```

Run → FAIL; poi in `order-display.ts`:

```ts
/** Conto alla rovescia di una prenotazione: hh:mm:ss, ore anche oltre 24. */
export function formatCountdown(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}
```

Run → PASS. Poi il componente `features/orders/pickup-countdown.tsx`:

```tsx
import { useEffect, useState } from "react";
import { m } from "@/paraglide/messages";
import { formatCountdown, pickupDeadline } from "./order-display";

/** Tick al secondo solo finché la prenotazione è aperta. */
function useNow(active: boolean) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [active]);
	return now;
}

export function PickupCountdown({ expiresAt }: { expiresAt: Date | string }) {
	const end = new Date(expiresAt).getTime();
	const now = useNow(Date.now() < end);
	const { expired, date } = pickupDeadline(expiresAt, now);
	if (expired)
		return (
			<span className="text-muted-foreground text-sm">
				{m.orders_pickup_expired()}
			</span>
		);
	return (
		<span className="text-sm">
			{m.orders_pickup_by({ date })}{" "}
			<span
				role="timer"
				aria-live="off"
				className="font-medium text-foreground tabular-nums"
			>
				{formatCountdown(end - now)}
			</span>
		</span>
	);
}
```

Il timer si usa in lista ordini (righe PP1 aperte), dettaglio e pagina di conferma, al posto del testo statico `left`.

- [ ] **Step 5: DESIGN.md**

In `DESIGN.md:551-552` sostituisci il bullet con:

```md
- **Don't** ship Groupon-style coupon stickers, "offer ends in" countdowns, or
  manipulative urgency. The reward system is a relationship, not a hook.
  *Exception:* the pickup timer of a real reservation (PP1) is information,
  not pressure: when it runs out the reservation expires. It stays neutral
  (Ink, tabular figures, no red, no saffron, no motion beyond the digits).
```

e lo stesso concetto in `.impeccable/design.json:409` (stringa del «Don't»). Preserva il resto dei file.

- [ ] **Step 6: Commit**

```bash
git add apps/customer/src/features/checkout apps/customer/src/features/orders apps/customer/messages DESIGN.md .impeccable/design.json
git commit -m "feat(customer): scelta del checkout, etichette e timer di ritiro"
```

---

### Task 6: Flusso di checkout nel customer

**Files:**
- Modify: `apps/customer/src/features/cart/use-cart.ts` (esporta `CART_KEY`)
- Create: `apps/customer/src/features/checkout/use-checkout.ts`
- Modify: `apps/customer/src/routes/_authenticated/cart.tsx` (CTA)
- Create: `apps/customer/src/routes/_authenticated/checkout/index.tsx` (scelta)
- Create: `apps/customer/src/routes/_authenticated/checkout/review.tsx` (riepilogo)
- Create: `apps/customer/src/routes/_authenticated/checkout/$checkoutId/index.tsx` (ordine effettuato)
- Create: `apps/customer/src/features/checkout/store-choice.tsx` (selettore per negozio)
- Modify: `apps/customer/src/routeTree.gen.ts` (rigenerato)

**Interfaces:**
- Consumes: Task 4 (`api().customer.checkout.post`, `api().customer.checkouts({ checkoutId }).get()`), Task 5.
- Produces: `useCreateCheckout()` (mutation `{ idempotencyKey, stores }` → `CheckoutView`), `useCheckout(checkoutId)`; search param `?choice=storeId:type,...` su `/checkout` e `/checkout/review`.

- [ ] **Step 1: Hook**

`use-checkout.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CART_KEY } from "@/features/cart/use-cart";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";
import type { CheckoutType } from "./checkout-choice";

export const ORDERS_KEY = ["customer", "orders"] as const;

export function useCreateCheckout() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (body: {
			idempotencyKey: string;
			stores: { storeId: string; type: CheckoutType }[];
		}) => unwrap(await api().customer.checkout.post(body), m.error_generic()).data,
		// Anche sull'errore: un 409 vuol dire carrello cambiato.
		onSettled: () => {
			void qc.invalidateQueries({ queryKey: CART_KEY });
			void qc.invalidateQueries({ queryKey: ORDERS_KEY });
		},
	});
}

export function useCheckout(checkoutId: string) {
	return useQuery({
		queryKey: ["customer", "checkout", checkoutId],
		queryFn: async () =>
			unwrap(
				await api().customer.checkouts({ checkoutId }).get(),
				m.checkout_not_found(),
			).data,
	});
}
```

In `use-cart.ts`: `export const CART_KEY`.

- [ ] **Step 2: CTA nel carrello**

In `cart.tsx`, al posto del commento «Nessun CTA di checkout…», sotto il blocco del totale:
- `const blocked = cart.groups.some((g) => g.items.some((i) => i.issue === "insufficient_stock"));`
- `const buyable = cart.groups.some((g) => g.items.some((i) => i.issue !== "unavailable"));`
- se `buyable`: `<Button asChild size="lg" className="min-h-11 w-full sm:w-auto" disabled={blocked}>` con `<Link to="/checkout" search={{ choice: undefined }}>{m.cart_checkout_cta()}</Link>`; se `blocked` il bottone non è un link (niente `asChild`, `disabled`) e sotto compare `m.cart_fix_quantities()` in `text-destructive text-sm`. Allineato a destra da `sm`, a tutta larghezza sotto.

- [ ] **Step 3: Scelta `/checkout`**

`checkout/index.tsx`:
- `validateSearch: (s) => ({ choice: typeof s.choice === "string" ? s.choice : undefined })`.
- Legge `useCart()`; considera solo i gruppi con almeno una riga non `unavailable` (`groups`).
- `const { choice, complete } = resolveChoice(groups, parseChoice(search.choice))`.
- Carrello vuoto / senza gruppi acquistabili → `NoticePage` con link al carrello.
- Header: h1 `checkout_choose_title` (stile di `addresses.tsx`), sottotitolo.
- Per negozio una sezione (bordo `border-border rounded-xl p-4`, niente card annidate): nome negozio + comune, `checkout_items_count` e subtotale, poi `<StoreChoice>`.
- `store-choice.tsx`: `RadioGroup` di `@bibs/ui/components/radio-group` con un'opzione per ogni tipo **offerto** (`group.store.orderTypes`): label in Geist medium, hint sotto in `text-muted-foreground text-sm` (`checkout_type_reserve_pickup_hint` con `hours: 48`). Ogni opzione è una riga intera cliccabile da ≥44px (`<label>` che avvolge item e testo). Valore = `choice[storeId]`; `onValueChange` naviga con `search: { choice: serializeChoice({ ...choice, [storeId]: v }) }` e `replace: true`.
- Piede: `checkout_back_to_cart` (link secondario) e «Avanti» primario → `/checkout/review` con `search: { choice: serializeChoice(choice) }`, `disabled={!complete}`.

- [ ] **Step 4: Riepilogo `/checkout/review`**

`checkout/review.tsx`:
- Stesso `validateSearch` e `resolveChoice`; se `!complete` → `<Navigate to="/checkout" search={...} replace />`.
- Per negozio: nome, modalità scelta (etichetta), righe (miniatura `TileImage`, nome, quantità × prezzo, totale di riga), subtotale.
- Totali: «Da pagare ora» = somma dei subtotali `pay_pickup` (mostrato solo se > 0), «Da pagare in negozio» = somma `reserve_pickup` (solo se > 0). Se c'è almeno un PP1: `checkout_reserve_note` con `hours: 48` in un riquadro `bg-muted` (non saffron).
- Bottone: `confirmLabel(types)`, primario Ink, `min-h-11 w-full sm:w-auto`, `disabled` durante `isPending`.
- `const idempotencyKey = useMemo(() => crypto.randomUUID(), [])` — stabile per tutta la vita della pagina: un doppio click o un retry riusano la stessa key.
- `onClick`: `createCheckout.mutate({ idempotencyKey, stores: groups.map((g) => ({ storeId: g.store.id, type: choice[g.store.id] })) }, { onSuccess: (data) => navigate({ to: "/checkout/$checkoutId", params: { checkoutId: data.id }, replace: true }), onError: (e) => { toast.error(e.message || m.checkout_cart_changed()); navigate({ to: "/cart" }); } })`.

- [ ] **Step 5: Ordine effettuato `/checkout/$checkoutId`**

`checkout/$checkoutId/index.tsx` (cartella per lasciare spazio a `pay` nella PR F):
- `useCheckout(checkoutId)`; skeleton; errore → `NoticePage` con `checkout_not_found`.
- Header con icona di conferma (cerchio `bg-saffron/15`, icona `CheckCircle2` in `text-saffron-deep`: momento-segnale), titolo `checkout_done_title` o `_many`, sottotitolo.
- Per ordine: nome negozio, indirizzo (`store.addressLine1`, CAP, comune), `orders_order_number` con numero breve, articoli (nome × quantità), totale «Da pagare in negozio», e per PP1 `<PickupCountdown expiresAt={o.reservationExpiresAt} />`.
- Azioni: `checkout_done_orders_cta` → `/orders` (primario) e `checkout_done_continue` → `/stores` (secondario).

- [ ] **Step 6: Rigenera, typecheck, build, lint, commit**

Run (da `apps/customer`): `bun run build >/dev/null && bun run typecheck && bun test`, da root `bun run lint`. Expected: tutto pulito, `routeTree.gen.ts` aggiornato.

```bash
git add apps/customer
git commit -m "feat(customer): checkout dal carrello con scelta, riepilogo e conferma"
```

---

### Task 7: «Ordini» nel customer

**Files:**
- Create: `apps/customer/src/features/orders/use-orders.ts`
- Create: `apps/customer/src/features/orders/order-status-badge.tsx`
- Create: `apps/customer/src/routes/_authenticated/orders/index.tsx`
- Create: `apps/customer/src/routes/_authenticated/orders/$orderId.tsx`
- Modify: `apps/customer/src/components/site-header.tsx` (link «Ordini»)
- Modify: `apps/customer/src/routeTree.gen.ts`

**Interfaces:**
- Consumes: `GET /customer/orders?type=&page=&limit=`, `GET /customer/orders/:orderId`, `POST /customer/orders/:orderId/cancel`; Task 5.

- [ ] **Step 1: Hook e badge**

`use-orders.ts`: `useCustomerOrders({ type, page })` → `api().customer.orders.get({ query: { type, page, limit: 20 } })`, chiave `[...ORDERS_KEY, "list", type, page]`; `useCustomerOrder(orderId)` → `.data`, chiave `[...ORDERS_KEY, "detail", orderId]`; `useCancelOrder()` → `api().customer.orders({ orderId }).cancel.post()`, `onSettled` invalida `ORDERS_KEY`. Nell'`onError` della chiamata: per 400/409 (transizione non valida o già aggiornato) toast `orders_changed`, altrimenti il messaggio.

`order-status-badge.tsx`: pill come il seller, ma con token del customer: `confirmed`/`pending` neutri (`bg-muted text-foreground`), `ready_for_pickup` evidenziato (`bg-saffron/15 text-saffron-deep`: è il momento in cui il cliente deve muoversi), `completed` muted, `cancelled`/`expired` `text-destructive`. Etichette da `CUSTOMER_ORDER_STATUS`.

- [ ] **Step 2: Lista `/orders`**

- `validateSearch`: `tab: "reserved" | "paid"` (default `"reserved"`), `page` (default 1). `reserved` → `type: "reserve_pickup"`, `paid` → `type: "pay_pickup"`.
- Header h1 `orders_title`; tab con `TabNav` di `@bibs/ui` o due link-segmento `min-h-11` (`orders_tab_reserved`, `orders_tab_paid`).
- Lista `<ul className="space-y-3">` di righe-link (modello: card link di `profile.tsx`): nome negozio, `orders_order_number`, data, numero articoli, totale; a destra il badge. Per PP1 aperti (`confirmed`/`ready_for_pickup`) una seconda riga `<PickupCountdown />`.
- Vuoto: `Notice` inline con `orders_empty_reserved`/`orders_empty_paid` + `orders_empty_description` e link a `/stores`.
- Paginazione semplice «Precedenti / Successivi» se `total > 20`.

- [ ] **Step 3: Dettaglio `/orders/$orderId`**

- Header: `orders_order_number`, badge, data; per PP1 aperti `<PickupCountdown />`.
- «Dove ritirare»: nome negozio (link a `/stores/$storeId`), indirizzo.
- Articoli: miniatura (`productImageUrl`), nome, quantità × `unitPrice`, totale riga; poi «Totale» e, per PP1, «Da pagare in negozio».
- Se `canCustomerCancel(order)`: `orders_cancel` (variant destructive-ghost, `min-h-11`) → `AlertDialog` come `address-card.tsx` (focus iniziale su «Mantieni»); conferma → `useCancelOrder`, toast `orders_cancel_success`.
- 404 → `NoticePage` `orders_not_found` con link a `/orders`.

- [ ] **Step 4: Link in header**

In `site-header.tsx`, nel `<nav>` prima di `<CartBadge />`: `<Link to="/orders" search={{ tab: "reserved", page: 1 }} className="…stesse classi dei link…" aria-label={m.nav_orders()}>` con icona `ReceiptText` (`size-5`) sempre e testo `m.nav_orders()` solo da `sm` (`max-sm:sr-only`); sotto `sm` il link è un'icona da 44px (`max-sm:size-11 max-sm:justify-center`), come la borsa.

- [ ] **Step 5: Rigenera, typecheck, build, test, lint, commit**

Run (da `apps/customer`): `bun run build >/dev/null && bun run typecheck && bun test`; da root `bun run lint`.

```bash
git add apps/customer
git commit -m "feat(customer): ordini con prenotazioni, scadenza e annullamento"
```

---

### Task 8: Smoke, gate, review, backlog, PR

- [ ] **Step 1: Smoke browser** (customer :3001, API :3000; un cliente di prova creato allo scopo, es. `customer299@test.com` / `password123`, **non** toccare ordini del seed):
  - Aggiungi al carrello prodotti di 2 negozi e una riga di un terzo; «Avanti» → scelta con PP1 preselezionato per tutti → «Avanti» → riepilogo con «Da pagare in negozio» e nota 48 h → «Prenota».
  - Pagina di conferma con N prenotazioni; il badge del carrello scende; nel carrello restano solo le righe non ordinate.
  - Refresh sul riepilogo: la scelta sopravvive (search params). Refresh sulla conferma: si ricarica dall'API.
  - Stock cambiato fra riepilogo e conferma (abbassalo con un `UPDATE` sul prodotto di prova) → toast e ritorno al carrello, nessun ordine creato.
  - «Ordini»: tab Prenotazioni con timer che scende (e si ferma a «Prenotazione scaduta»); dettaglio; «Annulla prenotazione» con dialog (Esc, poi conferma); stato Annullato.
  - Il seller (:3002, negozio del prodotto) vede le prenotazioni nella sua lista.
  - Mouse e tastiera; 390px con screenshot guardato; dark mode (`localStorage.theme='dark'`).
  - Alla fine riporta a zero ciò che hai creato: annulla le prenotazioni di prova ancora aperte.

- [ ] **Step 2: Gate** (da root, `$?` per comando): lint; typecheck api/customer/seller/admin; `bun run test` di root (emails, api, customer, seller); build dei 3 frontend; `bun run db:generate` in `apps/api` deve dire «No schema changes»; `git status` pulito.

- [ ] **Step 3: Review finale** con agente fresco (modello più capace), Review Focus incluso; fix Critical/Important in TDD; minor nel corpo della PR.

- [ ] **Step 4: Backlog**: in P1.1 annota «PP1 fatto in #NN; resta PR2 (PR E + F)»; P1.6 annota che la sezione Ordini esiste (tab Prenotazioni/Pagati), restano movimenti punti e storico completo; debito #163 (svuotamento carrello) chiuso: aggiungilo a «Chiusi» con #NN.

- [ ] **Step 5: PR** su `feat/customer-checkout-reserve`: body con riassunto, rulings (incluso l'aggiornamento di DESIGN.md per il timer), minor rimandati, test plan con smoke; **senza auto-merge** (PR con UI: il gate è lo smoke di Marco). `#NN` → numero reale in un commit successivo.
