# PR B — Pagina ordini seller (P1.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il seller vede ed evade gli ordini del negozio attivo: lista con tab per stato e filtro tipologia, dettaglio con righe, totali e castelletto IVA, azioni «Pronto per il ritiro», «Segna come ritirato» e «Annulla».

**Architecture:** L'API ordini seller esiste già (`seller/routes/orders.ts`: lista, dettaglio, `ready`, `ship`, `complete`). Mancano due endpoint: l'annullamento seller con rimborso di stock e punti (oggi `transitionOrder` non rimborsa) e i conteggi per stato delle tab. Il FE seller aggiunge `features/orders` (etichette, badge, hook Eden) e due route: `/orders` e `/orders/$orderId`. Una fixture di seed crea ordini veri tramite i service, per lo smoke.

**Tech Stack:** Elysia + TypeBox, Drizzle, bun:test + testcontainers; TanStack Start/Router/Query, `@bibs/ui` (DataTable, TabNav, AlertDialog), paraglide.

**Spec:** `docs/superpowers/specs/2026-09-24-customer-checkout-design.md` (sezione «Seller — P1.2 (PR B)»)

## Global Constraints

- Etichette di stato: badge al **singolare**, tab e filtri al **plurale** (convenzione confermata in #119).
- Tipologie: `reserve_pickup` = «Prenota e paga in negozio», `pay_pickup` = «Paga e ritira», `pay_deliver` = «Paga e spedizione», `direct` = «Acquisto diretto».
- Fonte fiscale dell'ordine = `vatBreakdown`. **Non** sommare `order_items.vatAmount`: è pre-punti.
- Indirizzo: mostrare `shippingAddressSnapshot` (la relazione `shippingAddress` non è nel response schema seller).
- Alias seller: `@/*` → `./src/*`. Toast da `@bibs/ui/components/sonner`.
- Route nuove → committare anche `apps/seller/src/routeTree.gen.ts` rigenerato.
- `ServiceError(status, message)` con due argomenti. Commit Conventional, scope whitelist (`orders`, `seller`, `db`, `api`, `docs`).
- Mai indebolire asserzioni o produzione per ottenere un RED.

## Review Focus

1. **Annullamento concorrente** (seller e cliente nello stesso istante): un solo rimborso → CAS sullo stato; test in Task 1 con un secondo annullamento sequenziale che deve dare 400 senza doppio rimborso.
2. **Ordine di un negozio non accessibile** (employee non assegnato, altro seller): 404 su annulla e conteggi di un negozio altrui → 403/404 → test in Task 1 e Task 2.
3. **Ordine storico senza `vatBreakdown`** (`null`): il dettaglio non deve rompersi, mostra «Castelletto non disponibile» → gestito in Task 6.
4. **Prenotazione scaduta ma non ancora spazzata dal cron**: «Segna come ritirato» deve mostrare l'errore dell'API (400 «Reservation has expired») e ricaricare, non restare in uno stato finto → Task 6 (toast + invalidate).
5. **Negozio senza ordini** e **tab vuota**: stato vuoto parlante, niente tabella vuota con header → Task 5.

## Rulings rispetto allo spec

- `stores.order_types` e la sua UI **escono da B**: con PR2 non attivabile fino alla PR E, la sezione nella pagina negozio avrebbe un solo toggle obbligatorio e sempre acceso. La colonna entra in **C** (serve al checkout), il toggle in **E** (quando PR2 si può accendere). Costo se sbagliato: una migrazione in più in C, nessun rework.
- La validazione del tipo consentito vive nel **checkout** (C), non in `placeOrder`: `POST /customer/orders` crea ancora `direct`/`pay_deliver` nei test esistenti.

---

### Task 1: Annullamento seller con rimborso (API)

**Files:**
- Modify: `apps/api/src/modules/seller/services/orders.ts` (nuova `cancelSellerOrder`)
- Modify: `apps/api/src/modules/seller/routes/orders.ts` (nuova `PATCH /orders/:orderId/cancel`)
- Test: `apps/api/tests/integration/seller-orders.test.ts` (nuovo `describe`)

**Interfaces:**
- Produces: `cancelSellerOrder({ orderId, storeIds }: { orderId: string; storeIds: string[] }): Promise<Order>`; route `PATCH /seller/orders/:orderId/cancel` → `okRes(OrderSchema)`.

- [ ] **Step 1: Test RED**

In `tests/integration/seller-orders.test.ts` aggiungi `cancelSellerOrder` all'import da `@/modules/seller/services/orders` e in coda:

```ts
describe("cancelSellerOrder", () => {
	it("annulla l'ordine e restituisce stock e punti", async () => {
		const db = getTestDb();
		const { store, customer, sp, order: ord } = await seedReservePickupOrder(
			db,
			{
				reservationExpiresAt: new Date(Date.now() + 3_600_000),
				customerPoints: 100,
				pointsSpent: 50,
			},
		);

		const cancelled = await cancelSellerOrder({
			orderId: ord.id,
			storeIds: [store.id],
		});

		expect(cancelled.status).toBe("cancelled");
		const [spAfter] = await db
			.select()
			.from(storeProductTable)
			.where(eq(storeProductTable.id, sp.id));
		expect(spAfter.stock).toBe(12); // 10 + 2 restituiti
		const [cpAfter] = await db
			.select()
			.from(customerProfile)
			.where(eq(customerProfile.id, customer.profile.id));
		expect(cpAfter.points).toBe(150); // 100 + 50 rimborsati
		const refunds = await db
			.select()
			.from(pointTransaction)
			.where(
				and(
					eq(pointTransaction.orderId, ord.id),
					eq(pointTransaction.type, "refunded"),
				),
			);
		expect(refunds).toHaveLength(1);
	});

	it("un secondo annullamento fallisce e non rimborsa due volte", async () => {
		const db = getTestDb();
		const { store, customer, order: ord } = await seedReservePickupOrder(db, {
			reservationExpiresAt: new Date(Date.now() + 3_600_000),
			customerPoints: 100,
			pointsSpent: 50,
		});

		await cancelSellerOrder({ orderId: ord.id, storeIds: [store.id] });
		await expect(
			cancelSellerOrder({ orderId: ord.id, storeIds: [store.id] }),
		).rejects.toMatchObject({ status: 400 });

		const [cpAfter] = await db
			.select()
			.from(customerProfile)
			.where(eq(customerProfile.id, customer.profile.id));
		expect(cpAfter.points).toBe(150);
	});

	it("un ordine di un negozio non accessibile è 404", async () => {
		const db = getTestDb();
		const { order: ord } = await seedReservePickupOrder(db, {
			reservationExpiresAt: new Date(Date.now() + 3_600_000),
		});

		await expect(
			cancelSellerOrder({ orderId: ord.id, storeIds: ["altro-negozio"] }),
		).rejects.toMatchObject({ status: 404 });
	});

	it("un ordine pronto per il ritiro non si annulla", async () => {
		const db = getTestDb();
		const { store, order: ord } = await seedReservePickupOrder(db, {
			reservationExpiresAt: new Date(Date.now() + 3_600_000),
		});
		await db
			.update(order)
			.set({ status: "ready_for_pickup" })
			.where(eq(order.id, ord.id));

		await expect(
			cancelSellerOrder({ orderId: ord.id, storeIds: [store.id] }),
		).rejects.toMatchObject({ status: 400 });
	});
});
```

Verifica prima che `ServiceError` esponga `status` (`apps/api/src/lib/errors.ts`); se il campo si chiama diversamente, adegua `toMatchObject` al nome reale.

- [ ] **Step 2: Verifica RED**

Run (da `apps/api`): `bun test tests/integration/seller-orders.test.ts --timeout 180000`
Expected: FAIL — `cancelSellerOrder` non esportata.

- [ ] **Step 3: Service**

In `seller/services/orders.ts` aggiungi l'import `refundStockAndPoints` da `@/lib/order-helpers` (accanto ad `awardPoints`) e:

```ts
/**
 * Annullamento dal negozio: stesse regole della macchina a stati del cliente
 * (da `pending` o `confirmed`), con rimborso di stock e punti nella stessa tx.
 * CAS sullo stato prima del rimborso, così un annullamento concorrente (cliente
 * o seller) non rimborsa due volte.
 */
export async function cancelSellerOrder(params: {
	orderId: string;
	storeIds: string[];
}) {
	const { orderId, storeIds } = params;

	return db.transaction(async (tx) => {
		const existing = await tx.query.order.findFirst({
			where: eq(order.id, orderId),
			with: { items: true },
		});
		if (!existing || !storeIds.includes(existing.storeId))
			throw new ServiceError(404, "Order not found");

		assertTransition(
			existing.status as OrderStatus,
			"cancelled",
			existing.type as OrderType,
		);

		const [updated] = await tx
			.update(order)
			.set({ status: "cancelled" })
			.where(and(eq(order.id, existing.id), eq(order.status, existing.status)))
			.returning();
		if (!updated)
			throw new ServiceError(409, "L'ordine è già stato aggiornato");

		await refundStockAndPoints(tx, existing);

		return updated;
	});
}
```

- [ ] **Step 4: Route**

In `seller/routes/orders.ts` importa `cancelSellerOrder` e aggiungi in coda alla catena (dopo `/complete`):

```ts
	.patch(
		"/orders/:orderId/cancel",
		async (ctx) => {
			const sellerCtx = withSeller(ctx);
			const { params, store, user } = sellerCtx;
			const pino = getLogger(store);
			const data = await cancelSellerOrder({
				orderId: params.orderId,
				storeIds: await sellerCtx.getAccessibleStoreIds(),
			});
			pino.warn(
				{
					userId: user.id,
					orderId: data.id,
					orderType: data.type,
					action: "order_cancelled_by_seller",
				},
				"Ordine annullato dal negozio",
			);
			return ok(data);
		},
		{
			params: t.Object({
				orderId: t.String({ description: "ID dell'ordine" }),
			}),
			response: withConflictErrors({ 200: okRes(OrderSchema) }),
			detail: {
				summary: "Annulla ordine",
				description:
					"Annulla un ordine in stato pending o confirmed. Lo stock torna disponibile e i punti spesi vengono restituiti al cliente.",
				tags: ["Seller - Orders"],
			},
		},
	);
```

Import `getLogger` da `@/lib/logger`. Verifica che `withSeller(ctx)` esponga `store` e `user` (come `withCustomer` nelle route customer); se non li espone, prendili da `ctx` (`ctx.store`, `ctx.user`) come fanno le altre route seller che loggano (`grep -n "getLogger" apps/api/src/modules/seller/routes/*.ts`).

- [ ] **Step 5: Verifica GREEN + typecheck**

Run: `bun test tests/integration/seller-orders.test.ts --timeout 180000 && bun run typecheck`
Expected: PASS, typecheck pulito.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/seller apps/api/tests/integration/seller-orders.test.ts
git commit -m "feat(orders): annullamento seller con rimborso di stock e punti"
```

---

### Task 2: Conteggi per stato (API)

**Files:**
- Modify: `apps/api/src/modules/seller/services/orders.ts` (nuova `countSellerOrdersByStatus`)
- Modify: `apps/api/src/modules/seller/routes/orders.ts` (nuova `GET /orders/counts`, **prima** di `/orders/:orderId`)
- Test: `apps/api/tests/integration/seller-orders.test.ts`

**Interfaces:**
- Produces: `countSellerOrdersByStatus({ storeId, type? }): Promise<Record<OrderStatus, number>>` (tutte le chiavi presenti, zero inclusi); route `GET /seller/orders/counts?storeId=&type=` → `okRes(t.Record(t.String(), t.Integer()))`.

- [ ] **Step 1: Test RED**

```ts
describe("countSellerOrdersByStatus", () => {
	it("conta per stato solo gli ordini del negozio, con zeri espliciti", async () => {
		const db = getTestDb();
		const { store, customer } = await seedReservePickupOrder(db, {
			reservationExpiresAt: new Date(Date.now() + 3_600_000),
		});
		await db.insert(order).values([
			{
				customerProfileId: customer.profile.id,
				storeId: store.id,
				type: "pay_pickup",
				status: "ready_for_pickup",
				total: "5.00",
			},
			{
				customerProfileId: customer.profile.id,
				storeId: store.id,
				type: "reserve_pickup",
				status: "cancelled",
				total: "5.00",
			},
		]);
		// Rumore: ordine di un altro negozio
		await seedReservePickupOrder(db, {
			reservationExpiresAt: new Date(Date.now() + 3_600_000),
		});

		const counts = await countSellerOrdersByStatus({ storeId: store.id });
		expect(counts).toEqual({
			pending: 0,
			confirmed: 1,
			ready_for_pickup: 1,
			shipped: 0,
			delivered: 0,
			completed: 0,
			cancelled: 1,
			expired: 0,
		});

		const onlyPayPickup = await countSellerOrdersByStatus({
			storeId: store.id,
			type: "pay_pickup",
		});
		expect(onlyPayPickup.ready_for_pickup).toBe(1);
		expect(onlyPayPickup.confirmed).toBe(0);
	});
});
```

- [ ] **Step 2: Verifica RED**

Run: `bun test tests/integration/seller-orders.test.ts --timeout 180000`
Expected: FAIL — `countSellerOrdersByStatus` non esportata.

- [ ] **Step 3: Service**

```ts
export async function countSellerOrdersByStatus(params: {
	storeId: string;
	type?: OrderType;
}): Promise<Record<OrderStatus, number>> {
	const conditions = [eq(order.storeId, params.storeId)];
	if (params.type) conditions.push(eq(order.type, params.type));

	const rows = await db
		.select({ status: order.status, n: count() })
		.from(order)
		.where(and(...conditions))
		.groupBy(order.status);

	const counts = Object.fromEntries(
		orderStatuses.map((s) => [s, 0]),
	) as Record<OrderStatus, number>;
	for (const r of rows) counts[r.status as OrderStatus] = r.n;
	return counts;
}
```

Import `orderStatuses` da `@/db/schemas/order`.

- [ ] **Step 4: Route**

Inserita **subito dopo** `GET /orders` (prima di `/orders/:orderId`, altrimenti `counts` verrebbe preso come `orderId`):

```ts
	.get(
		"/orders/counts",
		async (ctx) => {
			const { query, accessCtx } = withSeller(ctx);
			await ensureStoreAccess(query.storeId, accessCtx);
			const data = await countSellerOrdersByStatus(query);
			return ok(data);
		},
		{
			query: t.Object({
				storeId: t.String({ description: "ID del negozio" }),
				type: t.Optional(
					t.Union(orderTypes.map((v) => t.Literal(v)), {
						description: "Filtra per tipologia",
					}),
				),
			}),
			response: withErrors({
				200: okRes(
					t.Record(t.String(), t.Integer({ minimum: 0 }), {
						description: "Numero di ordini per stato (tutti gli stati, zeri inclusi)",
					}),
				),
			}),
			detail: {
				summary: "Conteggi ordini per stato",
				description:
					"Conta gli ordini del negozio per stato, per le tab della lista ordini.",
				tags: ["Seller - Orders"],
			},
		},
	)
```

Verifica come `GET /orders` usa `withSeller` + `ensureStoreAccess` (righe 21-45) e copia la stessa forma (nome esatto di `accessCtx`). Se `t.Union(orderTypes.map(...))` non tipizza, copia la union di `OrderListQuery` in `lib/queries.ts`.

- [ ] **Step 5: Verifica GREEN + typecheck**

Run: `bun test tests/integration/seller-orders.test.ts --timeout 180000 && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/seller apps/api/tests/integration/seller-orders.test.ts
git commit -m "feat(orders): conteggi degli ordini per stato per il seller"
```

---

### Task 3: Fixture di seed degli ordini

**Files:**
- Create: `apps/api/src/db/seed/fixtures/orders.ts`
- Modify: `apps/api/src/db/seed/fixtures/index.ts` (chiamata in coda, dopo `seedDiscounts`)

**Interfaces:**
- Consumes: `createOrder` e `cancelOrder` (`customer/services/orders.ts`), `transitionOrder` (`seller/services/orders.ts`), `expireReservations` (`lib/jobs/expire-reservations.ts`).

- [ ] **Step 1: Fixture**

Ordini per il **primo negozio di `seller1@test.com`** (il dev seller ha il catalogo vuoto), creati coi service veri così snapshot, castelletto, stock e punti sono coerenti. Idempotente: salta se il negozio ha già ordini.

```ts
import { and, asc, eq, gt, like } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { customerProfile } from "@/db/schemas/customer";
import { order } from "@/db/schemas/order";
import { product, storeProduct } from "@/db/schemas/product";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import { expireReservations } from "@/lib/jobs/expire-reservations";
import { cancelOrder, createOrder } from "@/modules/customer/services/orders";
import { transitionOrder } from "@/modules/seller/services/orders";

const SELLER_EMAIL = "seller1@test.com";

type Plan = {
	type: "reserve_pickup" | "pay_pickup";
	end: "confirmed" | "ready_for_pickup" | "completed" | "cancelled" | "expired";
};

// 12 ordini: la lista seller ha tutte le tab popolate e i due tipi.
const PLANS: Plan[] = [
	{ type: "reserve_pickup", end: "confirmed" },
	{ type: "reserve_pickup", end: "confirmed" },
	{ type: "pay_pickup", end: "confirmed" },
	{ type: "reserve_pickup", end: "ready_for_pickup" },
	{ type: "pay_pickup", end: "ready_for_pickup" },
	{ type: "pay_pickup", end: "ready_for_pickup" },
	{ type: "reserve_pickup", end: "completed" },
	{ type: "pay_pickup", end: "completed" },
	{ type: "reserve_pickup", end: "cancelled" },
	{ type: "pay_pickup", end: "cancelled" },
	{ type: "reserve_pickup", end: "expired" },
	{ type: "reserve_pickup", end: "confirmed" },
];

export async function seedOrders() {
	const [target] = await db
		.select({ storeId: store.id, sellerProfileId: sellerProfile.id })
		.from(store)
		.innerJoin(sellerProfile, eq(sellerProfile.id, store.sellerProfileId))
		.innerJoin(user, eq(user.id, sellerProfile.userId))
		.where(eq(user.email, SELLER_EMAIL))
		.orderBy(asc(store.createdAt))
		.limit(1);
	if (!target) {
		console.warn(`  ⚠️ ${SELLER_EMAIL} senza negozi: nessun ordine seedato`);
		return;
	}

	const already = await db.query.order.findFirst({
		where: eq(order.storeId, target.storeId),
	});
	if (already) {
		console.log("  ⏭ Orders already seeded, skipping");
		return;
	}

	const products = await db
		.select({ id: storeProduct.id })
		.from(storeProduct)
		.innerJoin(product, eq(product.id, storeProduct.productId))
		.where(
			and(
				eq(storeProduct.storeId, target.storeId),
				eq(product.status, "active"),
				gt(storeProduct.stock, 5),
			),
		)
		.orderBy(asc(storeProduct.id))
		.limit(PLANS.length + 2);
	if (products.length < 3) {
		console.warn("  ⚠️ Negozio senza prodotti vendibili: nessun ordine seedato");
		return;
	}

	const customers = await db
		.select({ id: customerProfile.id })
		.from(customerProfile)
		.innerJoin(user, eq(user.id, customerProfile.userId))
		.where(like(user.email, "customer%@test.com"))
		.orderBy(asc(user.email))
		.limit(PLANS.length);

	console.log(`  🧾 Seeding ${PLANS.length} orders for ${SELLER_EMAIL}...`);

	for (const [i, plan] of PLANS.entries()) {
		const customerProfileId = customers[i % customers.length].id;
		// 1–3 righe per ordine, passo coprimo con la lunghezza della lista.
		const lineCount = (i % 3) + 1;
		const items = Array.from({ length: lineCount }, (_, k) => ({
			storeProductId: products[(i * 5 + k) % products.length].id,
			quantity: (k % 2) + 1,
		}));

		const created = await createOrder({
			customerProfileId,
			customerPoints: 0,
			type: plan.type,
			storeId: target.storeId,
			items,
		});

		const storeIds = [target.storeId];
		if (plan.end === "ready_for_pickup" || plan.end === "completed")
			await transitionOrder(
				created.id,
				target.sellerProfileId,
				"ready_for_pickup",
				storeIds,
			);
		if (plan.end === "completed")
			await transitionOrder(
				created.id,
				target.sellerProfileId,
				"completed",
				storeIds,
			);
		if (plan.end === "cancelled")
			await cancelOrder({ orderId: created.id, customerProfileId });
		if (plan.end === "expired") {
			await db
				.update(order)
				.set({ reservationExpiresAt: new Date(Date.now() - 60_000) })
				.where(eq(order.id, created.id));
			await expireReservations();
		}
	}
}
```

Prima di scrivere, verifica i nomi reali: `product.status`, `storeProduct.stock`, `store.createdAt`, la firma di `expireReservations()` (nessun argomento?) e che `transitionOrder` accetti `ready_for_pickup` da `confirmed` per `pay_pickup` (sì, macchina a stati). Adegua se differiscono.

In `fixtures/index.ts`: import `seedOrders` e `await seedOrders();` dopo `await seedDiscounts();`, con commento «Dopo prodotti e sconti: gli ordini leggono prezzi e promo vere.»

- [ ] **Step 2: Esecuzione e verifica via schema**

Esegui solo la fixture (idempotente) con uno script usa-e-getta nella scratchpad, che poi rilegge gli ordini del negozio e li valida contro `SellerOrderWithRelationsSchema` con `Value.Check` di TypeBox, stampando un istogramma `status × type`:

```ts
// scratchpad/check-orders.ts — lanciato da apps/api con: bun <path>
import { Value } from "@sinclair/typebox/value";
import { seedOrders } from "@/db/seed/fixtures/orders";
import { SellerOrderWithRelationsSchema } from "@/lib/schemas";
import { listSellerOrders } from "@/modules/seller/services/orders";
// … risolvi storeId di seller1@test.com come nella fixture, chiama seedOrders(),
// poi listSellerOrders({ storeIds: [storeId], page: 1, limit: 100 }),
// Value.Check su ogni riga, e console.table dell'istogramma.
```

Expected: 12 ordini, tutti validi allo schema; istogramma = confirmed 4, ready_for_pickup 3, completed 2, cancelled 2, expired 1; `vatBreakdown` non nullo su tutti. Se il DB locale non è seedato, prima `bun run db:reset` da root (wipe + migrate + seed).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/db/seed/fixtures/orders.ts apps/api/src/db/seed/fixtures/index.ts
git commit -m "feat(db): fixture di seed con ordini in tutti gli stati"
```

---

### Task 4: `features/orders` nel seller — etichette, badge, hook

**Files:**
- Create: `apps/seller/src/features/orders/order-labels.ts`
- Create: `apps/seller/src/features/orders/components/order-status-badge.tsx`
- Create: `apps/seller/src/features/orders/hooks/use-orders.ts`
- Modify: `apps/seller/messages/it.json`, `apps/seller/messages/en.json`

**Interfaces:**
- Produces:
  ```ts
  export type OrderStatus = "pending" | "confirmed" | "ready_for_pickup" | "shipped" | "delivered" | "completed" | "cancelled" | "expired";
  export type OrderType = "direct" | "reserve_pickup" | "pay_pickup" | "pay_deliver";
  export const ORDER_STATUS_LABEL: Record<OrderStatus, () => string>;   // singolare
  export const ORDER_TYPE_LABEL: Record<OrderType, () => string>;
  export function shortOrderId(id: string): string;                     // "#" + prime 8 maiuscole
  export function reservationTimeLeft(expiresAt: Date | string, now?: number): { expired: boolean; label: string };
  export function canMarkReady(o: { status: OrderStatus; type: OrderType }): boolean;
  export function canMarkPickedUp(o: { status: OrderStatus; type: OrderType }): boolean;
  export function canCancel(o: { status: OrderStatus; type: OrderType }): boolean;
  export function OrderStatusBadge(props: { status: OrderStatus; className?: string }): JSX.Element;
  export function useOrdersList(params: { storeId?: string; page: number; limit: number; status?: OrderStatus; type?: OrderType });
  export function useOrderCounts(params: { storeId?: string; type?: OrderType });
  export function useOrder(orderId: string);
  export function useMarkReady(); export function useMarkPickedUp(); export function useCancelOrder(); // mutationFn(orderId)
  ```

- [ ] **Step 1: Messaggi**

Aggiungi a `it.json` (e l'equivalente inglese a `en.json`, stesse chiavi):

```json
"orders_nav": "Ordini",
"orders_page_title": "Ordini",
"orders_page_subtitle": "Prenotazioni e ordini del negozio attivo",
"orders_status_pending": "In attesa di pagamento",
"orders_status_confirmed": "Da preparare",
"orders_status_ready_for_pickup": "Pronto per il ritiro",
"orders_status_shipped": "Spedito",
"orders_status_delivered": "Consegnato",
"orders_status_completed": "Completato",
"orders_status_cancelled": "Annullato",
"orders_status_expired": "Scaduto",
"orders_tab_all": "Tutti",
"orders_tab_confirmed": "Da preparare",
"orders_tab_ready_for_pickup": "Pronti",
"orders_tab_completed": "Completati",
"orders_tab_cancelled": "Annullati",
"orders_tab_expired": "Scaduti",
"orders_type_reserve_pickup": "Prenota e paga in negozio",
"orders_type_pay_pickup": "Paga e ritira",
"orders_type_pay_deliver": "Paga e spedizione",
"orders_type_direct": "Acquisto diretto",
"orders_type_all": "Tutte le tipologie",
"orders_col_order": "Ordine",
"orders_col_date": "Data",
"orders_col_customer": "Cliente",
"orders_col_type": "Tipologia",
"orders_col_items": "Articoli",
"orders_col_total": "Totale",
"orders_col_status": "Stato",
"orders_col_deadline": "Scadenza",
"orders_deadline_left": "tra {time}",
"orders_deadline_expired": "Scaduta",
"orders_action_detail": "Dettaglio",
"orders_action_ready": "Pronto per il ritiro",
"orders_action_picked_up": "Segna come ritirato",
"orders_action_cancel": "Annulla ordine",
"orders_ready_success": "Ordine segnato come pronto",
"orders_picked_up_success": "Ordine segnato come ritirato",
"orders_cancel_success": "Ordine annullato",
"orders_cancel_title": "Annullare l'ordine?",
"orders_cancel_description": "Il cliente vedrà l'ordine annullato. Lo stock torna disponibile e gli eventuali punti spesi vengono restituiti.",
"orders_cancel_confirm": "Annulla ordine",
"orders_cancel_keep": "Mantieni",
"orders_picked_up_title": "Confermi il ritiro?",
"orders_picked_up_description": "Conferma solo dopo aver consegnato la merce al cliente.",
"orders_picked_up_description_reserve": "Conferma solo dopo aver incassato l'importo e consegnato la merce al cliente.",
"orders_picked_up_confirm": "Conferma ritiro",
"orders_empty_all": "Nessun ordine ancora",
"orders_empty_all_description": "Quando un cliente prenota o compra dal tuo negozio, lo trovi qui.",
"orders_empty_tab": "Nessun ordine in questa vista",
"orders_detail_items": "Articoli",
"orders_detail_summary": "Riepilogo",
"orders_detail_subtotal": "Subtotale",
"orders_detail_points_discount": "Sconto punti",
"orders_detail_total": "Totale",
"orders_detail_to_collect": "Da incassare in negozio",
"orders_detail_paid_online": "Pagato online",
"orders_detail_vat": "Castelletto IVA",
"orders_detail_vat_rate": "Aliquota",
"orders_detail_vat_taxable": "Imponibile",
"orders_detail_vat_tax": "Imposta",
"orders_detail_vat_missing": "Castelletto non disponibile per questo ordine",
"orders_detail_customer": "Cliente",
"orders_detail_created": "Creato il {date}",
"orders_detail_deadline": "Ritiro entro {date}",
"orders_detail_shipping": "Spedizione",
"orders_detail_not_found": "Ordine non trovato"
```

(`orders_detail_paid_online` per `pay_pickup`: il pagamento arriva con la PR F, ma l'etichetta descrive già il tipo.)

- [ ] **Step 2: `order-labels.ts`**

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
export type OrderType = "direct" | "reserve_pickup" | "pay_pickup" | "pay_deliver";

/** Badge di un singolo ordine: al singolare. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, () => string> = {
	pending: m.orders_status_pending,
	confirmed: m.orders_status_confirmed,
	ready_for_pickup: m.orders_status_ready_for_pickup,
	shipped: m.orders_status_shipped,
	delivered: m.orders_status_delivered,
	completed: m.orders_status_completed,
	cancelled: m.orders_status_cancelled,
	expired: m.orders_status_expired,
};

export const ORDER_TYPE_LABEL: Record<OrderType, () => string> = {
	reserve_pickup: m.orders_type_reserve_pickup,
	pay_pickup: m.orders_type_pay_pickup,
	pay_deliver: m.orders_type_pay_deliver,
	direct: m.orders_type_direct,
};

export function shortOrderId(id: string): string {
	return `#${id.slice(0, 8).toUpperCase()}`;
}

const PICKUP: readonly OrderType[] = ["reserve_pickup", "pay_pickup"];

// Rispecchiano la macchina a stati dell'API (lib/order-state-machine.ts): il
// bottone compare solo se la transizione è valida. L'API resta l'autorità.
export function canMarkReady(o: { status: OrderStatus; type: OrderType }) {
	return o.status === "confirmed" && o.type !== "direct";
}
export function canMarkPickedUp(o: { status: OrderStatus; type: OrderType }) {
	return (
		PICKUP.includes(o.type) &&
		(o.status === "confirmed" || o.status === "ready_for_pickup")
	);
}
export function canCancel(o: { status: OrderStatus; type: OrderType }) {
	return (
		o.type !== "direct" && (o.status === "pending" || o.status === "confirmed")
	);
}

/** Tempo alla scadenza di una prenotazione, in forma breve ("5 h", "40 min"). */
export function reservationTimeLeft(
	expiresAt: Date | string,
	now: number = Date.now(),
): { expired: boolean; label: string } {
	const ms = new Date(expiresAt).getTime() - now;
	if (ms <= 0) return { expired: true, label: m.orders_deadline_expired() };
	const minutes = Math.ceil(ms / 60_000);
	const time =
		minutes >= 60 ? `${Math.floor(minutes / 60)} h` : `${minutes} min`;
	return { expired: false, label: m.orders_deadline_left({ time }) };
}
```

- [ ] **Step 3: `order-status-badge.tsx`**

Stesso pattern di `features/promotions/components/promotion-state-badge.tsx` (pill + pallino):

```tsx
import { cn } from "@bibs/ui/lib/utils";
import { ORDER_STATUS_LABEL, type OrderStatus } from "../order-labels";

const AMBER =
	"bg-amber-50 text-amber-700 ring-amber-300/50 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-500/30";
const EMERALD =
	"bg-emerald-50 text-emerald-700 ring-emerald-300/50 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/30";
const MUTED =
	"bg-muted text-muted-foreground ring-foreground/10 dark:ring-foreground/20";
const RED =
	"bg-red-50 text-red-700 ring-red-300/50 dark:bg-red-500/15 dark:text-red-400 dark:ring-red-500/30";

const CLASSES: Record<OrderStatus, string> = {
	pending: AMBER,
	confirmed: AMBER,
	ready_for_pickup: EMERALD,
	shipped: EMERALD,
	delivered: MUTED,
	completed: MUTED,
	cancelled: RED,
	expired: RED,
};

export function OrderStatusBadge({
	status,
	className,
}: {
	status: OrderStatus;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium text-xs ring-1 ring-inset",
				CLASSES[status],
				className,
			)}
		>
			<span aria-hidden className="size-1.5 rounded-full bg-current" />
			{ORDER_STATUS_LABEL[status]()}
		</span>
	);
}
```

Controlla con `grep -rn "bg-red-50" apps/seller/src` che i rossi esistano già altrove (es. `membership-status-badge.tsx`); se il progetto usa `destructive` per il rosso, usa quelle classi.

- [ ] **Step 4: `use-orders.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";
import type { OrderStatus, OrderType } from "../order-labels";

const ORDERS_KEY = ["orders"] as const;

export function useOrdersList(params: {
	storeId?: string;
	page: number;
	limit: number;
	status?: OrderStatus;
	type?: OrderType;
}) {
	const { storeId, ...rest } = params;
	return useQuery({
		queryKey: [...ORDERS_KEY, "list", storeId, rest],
		queryFn: async () => {
			if (!storeId) throw new Error("missing store");
			const res = await api().seller.orders.get({
				query: { storeId, ...rest },
			});
			return unwrap(res, "Errore caricamento ordini");
		},
		enabled: !!storeId,
	});
}

export function useOrderCounts(params: { storeId?: string; type?: OrderType }) {
	const { storeId, type } = params;
	return useQuery({
		queryKey: [...ORDERS_KEY, "counts", storeId, type],
		queryFn: async () => {
			if (!storeId) throw new Error("missing store");
			const res = await api().seller.orders.counts.get({
				query: { storeId, type },
			});
			return unwrap(res, "Errore caricamento conteggi");
		},
		enabled: !!storeId,
	});
}

export function useOrder(orderId: string) {
	return useQuery({
		queryKey: [...ORDERS_KEY, "detail", orderId],
		queryFn: async () => {
			const res = await api().seller.orders({ orderId }).get();
			return unwrap(res, "Errore caricamento ordine");
		},
	});
}

function useOrderTransition(
	call: (orderId: string) => Promise<unknown>,
) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: call,
		// Anche sull'errore: un 400/409 vuol dire che l'ordine è cambiato sotto
		// (scaduto, annullato dal cliente) e la vista va riallineata.
		onSettled: () => {
			void qc.invalidateQueries({ queryKey: ORDERS_KEY });
		},
	});
}

export function useMarkReady() {
	return useOrderTransition(async (orderId) =>
		unwrap(await api().seller.orders({ orderId }).ready.patch(), "Errore"),
	);
}
export function useMarkPickedUp() {
	return useOrderTransition(async (orderId) =>
		unwrap(await api().seller.orders({ orderId }).complete.patch(), "Errore"),
	);
}
export function useCancelOrder() {
	return useOrderTransition(async (orderId) =>
		unwrap(await api().seller.orders({ orderId }).cancel.patch(), "Errore"),
	);
}
```

Verifica che `unwrap` lanci un `Error` col messaggio dell'API (così `onError: e => toast.error(e.message)` mostra «Reservation has expired»): leggi `lib/api.ts` e il pacchetto da cui re-esporta.

- [ ] **Step 5: Typecheck**

Run (da `apps/seller`): `bun run typecheck`
Expected: pulito (il `pretypecheck` compila paraglide).

- [ ] **Step 6: Commit**

```bash
git add apps/seller/src/features/orders apps/seller/messages
git commit -m "feat(seller): etichette, badge e hook degli ordini"
```

---

### Task 5: Lista ordini `/orders` + voce in sidebar

**Files:**
- Create: `apps/seller/src/routes/_authenticated/orders.tsx` (layout `<Outlet/>`)
- Create: `apps/seller/src/routes/_authenticated/orders/index.tsx`
- Create: `apps/seller/src/features/orders/components/order-status-tabs.tsx`
- Modify: `apps/seller/src/components/app-sidebar.tsx` (voce «Ordini» dopo «Prodotti»)
- Modify: `apps/seller/src/components/app-breadcrumb.tsx` (`orders: "Ordini"` in `SEGMENT_LABEL`)
- Modify: `apps/seller/src/routeTree.gen.ts` (rigenerato)

**Interfaces:**
- Consumes: tutto da Task 4.
- Produces: search params `/orders?tab=all|confirmed|ready_for_pickup|completed|cancelled|expired&type=&page=&limit=`.

- [ ] **Step 1: Tab**

`order-status-tabs.tsx`:

```tsx
import { TabNav, type TabNavItem } from "@bibs/ui/components/tab-nav";
import { m } from "@/paraglide/messages";
import type { OrderStatus } from "../order-labels";

export type OrderTab =
	| "all"
	| "confirmed"
	| "ready_for_pickup"
	| "completed"
	| "cancelled"
	| "expired";
export const ORDER_TABS: readonly OrderTab[] = [
	"all",
	"confirmed",
	"ready_for_pickup",
	"completed",
	"cancelled",
	"expired",
];

/** Tab = insieme di ordini: al plurale. */
const LABEL: Record<OrderTab, () => string> = {
	all: m.orders_tab_all,
	confirmed: m.orders_tab_confirmed,
	ready_for_pickup: m.orders_tab_ready_for_pickup,
	completed: m.orders_tab_completed,
	cancelled: m.orders_tab_cancelled,
	expired: m.orders_tab_expired,
};

export function OrderStatusTabs({
	value,
	onChange,
	counts,
}: {
	value: OrderTab;
	onChange: (v: OrderTab) => void;
	counts?: Record<string, number>;
}) {
	const total = counts
		? Object.values(counts).reduce((s, n) => s + n, 0)
		: undefined;
	const tabs: TabNavItem[] = ORDER_TABS.map((t) => ({
		value: t,
		label: LABEL[t](),
		count: t === "all" ? total : counts?.[t as OrderStatus],
	}));
	return (
		<TabNav
			tabs={tabs}
			activeTab={value}
			onTabChange={(v) => onChange(v as OrderTab)}
		/>
	);
}
```

- [ ] **Step 2: Pagina lista**

`orders.tsx` (layout):

```tsx
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/orders")({
	component: Outlet,
});
```

`orders/index.tsx` — stessa struttura di `promotions/index.tsx` (header, tab, errore, `DataTable`, paginazione `PageSizeSelector` + `DataPagination`), con:

- `validateSearch`: `tab` in `ORDER_TABS` (default `"all"`), `type` in `["reserve_pickup","pay_pickup","pay_deliver","direct"]` o `undefined`, `page` (default 1), `limit` (default 20).
- `const { activeStore } = useActiveStore();` e
  `useOrdersList({ storeId: activeStore?.id, page, limit, status: tab === "all" ? undefined : tab, type })`,
  `useOrderCounts({ storeId: activeStore?.id, type })`.
- Toolbar sopra la tabella: `Select` di `@bibs/ui/components/select` con «Tutte le tipologie» + `ORDER_TYPE_LABEL`, che naviga con `type` e `page: 1`.
- Colonne (`DataTableColumnDef<Row>[]`, `Row = NonNullable<typeof data>["data"][number]`):
  - `order`: `<Link to="/orders/$orderId" params={{ orderId: r.id }} className="font-medium tabular-nums hover:underline">{shortOrderId(r.id)}</Link>`, `enableHiding: false`;
  - `date`: `new Date(r.createdAt).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })`;
  - `customer`: `r.customerProfile.user.name`;
  - `type`: `ORDER_TYPE_LABEL[r.type]()`;
  - `items`: somma delle quantità, `text-right tabular-nums`;
  - `total`: `<Price value={r.total} />`, `text-right`;
  - `deadline`: solo se `r.type === "reserve_pickup" && r.reservationExpiresAt && (r.status === "confirmed" || r.status === "ready_for_pickup")` → `reservationTimeLeft(r.reservationExpiresAt).label`, rosso (`text-destructive`) se `expired`; altrimenti `—`;
  - `status`: `<OrderStatusBadge status={r.status} />`, `enableHiding: false`;
  - `actions`: `DropdownMenu` con «Dettaglio» (Link) e, se `canMarkReady(r)`, «Pronto per il ritiro» → `markReady.mutate(r.id, { onSuccess: () => toast.success(m.orders_ready_success()), onError: (e) => toast.error(e.message) })`. (Ritiro e annullamento stanno nel dettaglio, dietro conferma.)
- `storageKey="seller.orders.columns"`, `hideHeaderWhenEmpty`.
- Stato vuoto: tab `all` senza `type` → `<EmptyState title={m.orders_empty_all()} description={m.orders_empty_all_description()} />`; altrimenti `<EmptyState title={m.orders_empty_tab()} />`.
- Senza negozio attivo (`!activeStore && !isLoading`): stesso stato vuoto di `products/index.tsx` quando manca il negozio (copialo).
- Il cambio negozio riparte da pagina 1: il `queryKey` include `storeId`, basta.

- [ ] **Step 3: Sidebar e breadcrumb**

In `app-sidebar.tsx`, dopo «Prodotti»:

```ts
	{
		title: "Ordini",
		to: "/orders" as const,
		icon: ReceiptIcon,
		match: (p: string) => p.startsWith("/orders"),
	},
```

con `ReceiptIcon` importato da `lucide-react`. Visibile anche agli employee (evadono gli ordini). In `app-breadcrumb.tsx`: `orders: "Ordini"` in `SEGMENT_LABEL`.

- [ ] **Step 4: Rigenera route tree, typecheck, lint**

Run (da `apps/seller`): `bun run build >/dev/null && bun run typecheck`, poi da root `bun run lint`.
Expected: build ok (rigenera `routeTree.gen.ts`), typecheck e lint puliti. `git status` deve mostrare `routeTree.gen.ts` modificato.

- [ ] **Step 5: Smoke browser (lista)**

Dev server seller (:3002) e API (:3000) attivi; login `seller1@test.com` / `password123`; `/orders`:
- tab con conteggi 12 / 4 / 3 / 2 / 2 / 1; ogni tab filtra; il filtro tipologia aggiorna righe **e** conteggi;
- colonna Scadenza valorizzata solo sulle prenotazioni aperte;
- «Pronto per il ritiro» dal menu riga: toast, la riga passa nella tab «Pronti», i conteggi si aggiornano;
- tastiera: Tab fino al menu riga, Invio apre, frecce + Invio eseguono l'azione;
- 390px: nessuno scroll orizzontale della pagina (la tabella scrolla nel suo contenitore); screenshot aperto e guardato.

- [ ] **Step 6: Commit**

```bash
git add apps/seller/src/routes/_authenticated/orders.tsx apps/seller/src/routes/_authenticated/orders apps/seller/src/features/orders apps/seller/src/components/app-sidebar.tsx apps/seller/src/components/app-breadcrumb.tsx apps/seller/src/routeTree.gen.ts
git commit -m "feat(seller): lista ordini con tab per stato e filtro tipologia"
```

---

### Task 6: Dettaglio ordine `/orders/$orderId`

**Files:**
- Create: `apps/seller/src/routes/_authenticated/orders/$orderId.tsx`
- Create: `apps/seller/src/features/orders/components/order-vat-table.tsx`
- Create: `apps/seller/src/features/orders/components/order-actions.tsx`
- Modify: `apps/seller/src/routeTree.gen.ts` (rigenerato)

**Interfaces:**
- Consumes: Task 4 (`useOrder`, mutation, `can*`, etichette, badge).

- [ ] **Step 1: Castelletto**

`order-vat-table.tsx`:

```tsx
import { formatPriceEur } from "@bibs/ui/components/price";
import { m } from "@/paraglide/messages";

type Line = { rate: number; taxableAmount: string; taxAmount: string };

/** Castelletto IVA dell'ordine: unica fonte fiscale (vatBreakdown), mai la
 *  somma delle righe, che è calcolata prima dello sconto punti. */
export function OrderVatTable({ lines }: { lines: Line[] | null }) {
	if (!lines || lines.length === 0)
		return (
			<p className="text-muted-foreground text-sm">
				{m.orders_detail_vat_missing()}
			</p>
		);
	return (
		<table className="w-full text-sm tabular-nums">
			<thead className="text-muted-foreground">
				<tr>
					<th className="py-1 text-left font-medium">
						{m.orders_detail_vat_rate()}
					</th>
					<th className="py-1 text-right font-medium">
						{m.orders_detail_vat_taxable()}
					</th>
					<th className="py-1 text-right font-medium">
						{m.orders_detail_vat_tax()}
					</th>
				</tr>
			</thead>
			<tbody>
				{lines.map((l) => (
					<tr key={l.rate} className="border-border border-t">
						<td className="py-1">{l.rate}%</td>
						<td className="py-1 text-right">{formatPriceEur(l.taxableAmount)}</td>
						<td className="py-1 text-right">{formatPriceEur(l.taxAmount)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
```

- [ ] **Step 2: Azioni con conferma**

`order-actions.tsx`: bottoni visibili secondo `canMarkReady` / `canMarkPickedUp` / `canCancel`. «Pronto per il ritiro» è diretto (reversibile di fatto: non tocca soldi né stock). «Segna come ritirato» e «Annulla ordine» passano da `AlertDialog` (pattern di `features/products/components/confirm-permanent-delete-dialog.tsx`):
- ritiro: titolo `orders_picked_up_title`, descrizione `orders_picked_up_description_reserve` per `reserve_pickup` (va incassato), altrimenti `orders_picked_up_description`; conferma `orders_picked_up_confirm`;
- annulla: `orders_cancel_title` / `orders_cancel_description`, conferma `orders_cancel_confirm` con `variant="destructive"`, annulla `orders_cancel_keep`.
Ogni mutation: `onSuccess` → toast di successo; `onError: (e) => toast.error(e.message)`. Bottoni `disabled` durante `isPending`.

- [ ] **Step 3: Pagina dettaglio**

`$orderId.tsx`: `Route.useParams()`, `useOrder(orderId)`; `Spinner` in caricamento; su errore 404 `EmptyState` con `orders_detail_not_found` e link a `/orders`. Layout a due colonne da `@3xl` (container query sul contenitore della pagina, non breakpoint di viewport), colonna principale + aside:

- **Header**: `shortOrderId`, `OrderStatusBadge`, tipologia, `orders_detail_created` con data e ora; per `reserve_pickup` aperti `orders_detail_deadline` con data/ora di `reservationExpiresAt` e il tempo residuo (`reservationTimeLeft`), in rosso se scaduto. A destra `<OrderActions order={data} />`.
- **Articoli** (main): lista righe con miniatura (`productImageUrl`, fallback icona `PackageIcon`), `productName`, `brandName`, EAN in piccolo, `quantity × unitPrice` (con `listPrice` barrato e `-{discountPercent}%` se presenti), totale di riga a destra.
- **Riepilogo** (aside, `FormSection`-like card): Subtotale = Σ `unitPrice × quantity` (in centesimi via `Math.round(Number(x) * 100)`); se `pointsSpent > 0` «Sconto punti» = subtotale − `total` (meno `shippingCost` se presente); Totale = `total`; sotto, per `reserve_pickup` «Da incassare in negozio», per `pay_pickup` «Pagato online».
- **Castelletto IVA** (aside): `<OrderVatTable lines={data.vatBreakdown} />`.
- **Cliente** (aside): `customerProfile.user.name` ed email (`mailto:`).
- **Spedizione** (aside, solo se `shippingAddressSnapshot`): destinatario, righe indirizzo, CAP comune (provincia).

- [ ] **Step 4: Rigenera route tree, typecheck, lint**

Run (da `apps/seller`): `bun run build >/dev/null && bun run typecheck`, da root `bun run lint`.
Expected: puliti; `routeTree.gen.ts` aggiornato.

- [ ] **Step 5: Smoke browser (dettaglio)**

Su `seller1@test.com`:
- un ordine con più aliquote: il castelletto somma al totale; l'intestazione mostra la scadenza della prenotazione;
- «Segna come ritirato» su una prenotazione: dialog con testo sull'incasso → conferma → stato Completato, toast, bottoni spariti;
- «Annulla ordine» su un ordine Da preparare → Annullato; nella lista prodotti lo stock è tornato su;
- prenotazione scaduta non ancora spazzata (forzala con `UPDATE orders SET reservation_expires_at = now() - interval '1 minute'` su un ordine di prova creato allo scopo, **non** su uno del seed; se il cron la spazza prima, va bene lo stesso: la pagina deve mostrare Scaduto dopo il refresh): «Segna come ritirato» → toast d'errore dell'API, la pagina si riallinea;
- un ordine del seed scaduto (`expired`): nessuna azione;
- mouse e tastiera (Tab/Invio/Esc nel dialog), 390px con screenshot guardato, dark mode (`localStorage.theme='dark'`).

- [ ] **Step 6: Commit**

```bash
git add apps/seller/src/routes/_authenticated/orders apps/seller/src/features/orders apps/seller/src/routeTree.gen.ts
git commit -m "feat(seller): dettaglio ordine con castelletto IVA e azioni"
```

---

### Task 7: Gate, backlog, PR

**Files:**
- Modify: `docs/audit/2026-09-24-followup-gap-analysis.md`

- [ ] **Step 1: Gate** (da root, `$?` per comando)

```bash
bun run lint; echo "lint=$?"
for a in api customer seller admin; do (cd apps/$a && bun run typecheck >/dev/null); echo "$a typecheck=$?"; done
(cd apps/api && bun run test > "$SCRATCH/apitest.log" 2>&1); echo "apitest=$?"; tail -4 "$SCRATCH/apitest.log"
for a in customer seller admin; do (cd apps/$a && bun run build >/dev/null); echo "$a build=$?"; done
git status --short   # nessun generato modificato non committato
```
Expected: tutti `=0`, working tree pulito.

- [ ] **Step 2: Review finale** del branch con un agente fresco (modello più capace), Review Focus di questo plan incluso; fix Critical/Important in TDD.

- [ ] **Step 3: Backlog**

- rimuovi **P1.2** dalla tabella P1 e aggiungilo a «Chiusi»: `| **P1.2** | Pagina ordini seller: lista del negozio attivo con tab per stato (conteggi) e filtro tipologia, dettaglio con righe, riepilogo e castelletto IVA, azioni pronto/ritirato/annulla; annullamento seller con rimborso di stock e punti (`PATCH /seller/orders/:id/cancel`) | #NN |`;
- in **P1.3** annota che la card «ordini da preparare» della home può usare `GET /seller/orders/counts`.

- [ ] **Step 4: PR**

Branch `feat/seller-orders`, commit backlog, push, `gh pr create` (body: riassunto, rulings, test plan con smoke, `🤖 Generated with [Claude Code](https://claude.com/claude-code)`), `gh pr merge --auto --squash`, poi `#NN` → numero reale in un commit successivo. Nel messaggio finale a Marco: la checklist dello smoke manuale.
