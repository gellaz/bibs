# PR D — Ritiro con codice QR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il cliente mostra al banco un QR (con il codice leggibile sotto); il negoziante lo scansiona o lo digita nella pagina «Ritiro» del seller, vede l'anteprima dell'ordine e conferma il ritiro. Il cliente non può più segnare da solo un ordine come ritirato.

**Architecture:** `orders.pickup_code` (6 caratteri, alfabeto senza ambigui) generato da `placeOrder` per i tipi ritirabili, unico tra gli ordini aperti dello stesso negozio (indice unico parziale). API seller: anteprima `GET /seller/orders/pickup/:code?storeId=` e conferma `POST /seller/orders/pickup { storeId, code }`, che riusa `transitionOrder(…, "completed")` (CAS, punti, scadenza con rimborso). Si rimuovono `POST /customer/orders/:id/pickup` e `pickupOrder`. Customer: QR SVG con `uqr` nel dettaglio ordine. Seller: pagina «Ritiro» con campo manuale e scansione via `barcode-detector` (ponyfill di `BarcodeDetector` su zxing-wasm), caricato solo lato client al click su «Scansiona».

**Tech Stack:** Elysia + TypeBox, Drizzle, bun:test + testcontainers; TanStack Start; `uqr` (customer), `barcode-detector` (seller).

**Spec:** `docs/superpowers/specs/2026-09-24-customer-checkout-design.md` (sezione «QR di ritiro (PR D)»)

## Global Constraints

- Codice: 6 caratteri da `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (niente 0/O/1/I/L), **non segreto**: identifica l'ordine al banco. Si mostra raggruppato 3-3 (`K7X M4P`); l'input accetta minuscole, spazi e trattini.
- Unicità: `(store_id, pickup_code)` tra gli ordini in `pending`/`confirmed`/`ready_for_pickup`. Un codice di un altro negozio equivale a un codice inesistente (404).
- Solo tipi ritirabili (`reserve_pickup`, `pay_pickup`) hanno il codice; `direct`/`pay_deliver` no.
- Il QR codifica **solo** il codice, mai l'id dell'ordine. Sfondo sempre bianco (anche in dark mode) perché gli scanner lo leggano.
- Librerie DOM-only (camera, wasm) caricate con `import()` dinamico dentro un handler/effetto, mai import statico in una route SSR.
- Messaggi al seller e al cliente in italiano; i18n seller/customer con paraglide (it + en).
- Commit Conventional con scope della whitelist (`orders`, `customer`, `seller`, `db`, `api`, `docs`). Mai indebolire asserzioni o produzione per ottenere un RED.

## Review Focus

1. **Codice digitato in minuscolo, con spazi o col trattino** (`k7x m4p`, `K7X-M4P`) → trovato lo stesso ordine → test in Task 2.
2. **Stessa prenotazione confermata due volte** (doppio tap, due casse) → un solo accredito punti, il secondo tentativo 409/404 senza effetti → test in Task 2.
3. **Prenotazione scaduta ma non ancora spazzata dal cron** → la conferma la fa scadere, rimborsa stock e punti e risponde 400 «La prenotazione è scaduta» → test in Task 2.
4. **Camera negata o assente** (permesso rifiutato, laptop senza webcam) → messaggio chiaro, il campo manuale resta usabile → Task 5.
5. **Codice di un ordine già chiuso** (completato/annullato/scaduto) → «Codice non trovato» per questo negozio, non l'anteprima di un ordine chiuso → test in Task 2.

## Rulings

- Gli ordini aperti **esistenti** non ricevono un codice (nessun backfill): l'app è in dev, il seed si rigenera, e il negoziante può comunque chiuderli con «Segna come ritirato». Costo se sbagliato: un backfill SQL in una migrazione successiva.
- Collisione del codice: pre-controllo nella tx e rigenerazione (fino a 5 tentativi); l'indice unico resta la rete di sicurezza (una race improbabilissima risponde 409 e il cliente riprova). Niente savepoint.
- «Segna come ritirato» manuale nel seller resta (alternativa senza codice).

---

### Task 1: `orders.pickup_code` + generazione (TDD)

**Files:**
- Create: `apps/api/src/lib/pickup-code.ts`
- Modify: `apps/api/src/db/schemas/order.ts` (colonna + indice unico parziale)
- Create: migrazione `0011_*.sql`
- Modify: `apps/api/src/modules/customer/services/orders.ts` (`placeOrder` assegna il codice)
- Modify: `apps/api/src/lib/schemas/entities.ts` (`OrderSchema.pickupCode`)
- Test: `apps/api/tests/lib/pickup-code.test.ts`, `apps/api/tests/integration/customer-orders.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PICKUP_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  export const PICKUP_CODE_LENGTH = 6;
  export function generatePickupCode(random?: (n: number) => Uint8Array): string;
  export function normalizePickupCode(input: string): string;          // maiuscolo, senza spazi e trattini
  export async function assignPickupCode(tx: OrderTx, storeId: string, generate?: () => string): Promise<string>;
  order.pickupCode: text("pickup_code")                                // nullable
  ```

- [ ] **Step 1: Test RED (puri)**

`tests/lib/pickup-code.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
	generatePickupCode,
	normalizePickupCode,
	PICKUP_CODE_ALPHABET,
} from "@/lib/pickup-code";

describe("generatePickupCode", () => {
	it("6 caratteri dall'alfabeto senza ambigui", () => {
		for (let i = 0; i < 500; i++) {
			const code = generatePickupCode();
			expect(code).toHaveLength(6);
			for (const ch of code) expect(PICKUP_CODE_ALPHABET).toContain(ch);
		}
		expect(PICKUP_CODE_ALPHABET).not.toMatch(/[01ILO]/);
	});

	it("scarta i byte che introdurrebbero bias (rejection sampling)", () => {
		// 31 simboli: si accettano solo byte < 248 (8 × 31). 255 va scartato.
		const bytes = [255, 0, 255, 30, 1, 2, 3, 4];
		let i = 0;
		const random = (n: number) =>
			Uint8Array.from({ length: n }, () => bytes[i++ % bytes.length]);
		expect(generatePickupCode(random)).toBe("A9BCDE");
	});
});

describe("normalizePickupCode", () => {
	it("maiuscolo, senza spazi e trattini", () => {
		expect(normalizePickupCode(" k7x m4p ")).toBe("K7XM4P");
		expect(normalizePickupCode("K7X-M4P")).toBe("K7XM4P");
	});
});
```

(Con l'alfabeto sopra, indice 0 = `A`, 30 = `9`, 1 = `B`, 2 = `C`, 3 = `D`, 4 = `E`: la sequenza dopo gli scarti è 0, 30, 1, 2, 3, 4.)

Run (da `apps/api`): `bun test tests/lib/pickup-code.test.ts` → FAIL (modulo mancante).

- [ ] **Step 2: Implementazione pura**

`lib/pickup-code.ts`:

```ts
/**
 * Codice di ritiro: identifica un ordine al banco, NON è un segreto (il seller
 * può già chiudere gli ordini dei suoi negozi). Corto, leggibile a voce, senza
 * caratteri che si confondono (0/O, 1/I/L).
 */
export const PICKUP_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PICKUP_CODE_LENGTH = 6;

// Il più grande multiplo di 31 che sta in un byte: sopra si scarta, così ogni
// simbolo ha la stessa probabilità.
const LIMIT =
	Math.floor(256 / PICKUP_CODE_ALPHABET.length) * PICKUP_CODE_ALPHABET.length;

export function generatePickupCode(
	random: (n: number) => Uint8Array = (n) =>
		crypto.getRandomValues(new Uint8Array(n)),
): string {
	let out = "";
	while (out.length < PICKUP_CODE_LENGTH) {
		for (const b of random(PICKUP_CODE_LENGTH)) {
			if (b >= LIMIT) continue;
			out += PICKUP_CODE_ALPHABET[b % PICKUP_CODE_ALPHABET.length];
			if (out.length === PICKUP_CODE_LENGTH) break;
		}
	}
	return out;
}

export function normalizePickupCode(input: string): string {
	return input.toUpperCase().replace(/[\s-]/g, "");
}
```

Run → PASS.

- [ ] **Step 3: Test RED (integrazione)**

In `tests/integration/customer-orders.test.ts`, nuovo `describe`:

```ts
describe("createOrder — codice di ritiro", () => {
	it("gli ordini da ritirare hanno un codice, gli altri no", async () => {
		const { store, storeProduct: sp, customer } = await seedBasicFixtures();
		const reserve = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "reserve_pickup",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});
		const direct = await createOrder({
			customerProfileId: customer.profile.id,
			customerPoints: 0,
			type: "direct",
			storeId: store.id,
			items: [{ storeProductId: sp.id, quantity: 1 }],
		});
		expect(reserve.pickupCode).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
		expect(direct.pickupCode).toBeNull();
	});

	it("rigenera il codice se è già usato da un ordine aperto dello stesso negozio", async () => {
		const { store } = await seedBasicFixtures();
		const db = getTestDb();
		const { customer } = await seedBasicFixtures();
		await db.insert(order).values({
			customerProfileId: customer.profile.id,
			storeId: store.id,
			type: "reserve_pickup",
			status: "confirmed",
			total: "1.00",
			pickupCode: "AAAAAA",
		});
		const codes = ["AAAAAA", "BBBBBB"];
		const code = await db.transaction((tx) =>
			assignPickupCode(tx, store.id, () => codes.shift() as string),
		);
		expect(code).toBe("BBBBBB");
	});

	it("un codice di un ordine chiuso si può riusare", async () => {
		const { store, customer } = await seedBasicFixtures();
		const db = getTestDb();
		await db.insert(order).values({
			customerProfileId: customer.profile.id,
			storeId: store.id,
			type: "reserve_pickup",
			status: "completed",
			total: "1.00",
			pickupCode: "AAAAAA",
		});
		const code = await db.transaction((tx) =>
			assignPickupCode(tx, store.id, () => "AAAAAA"),
		);
		expect(code).toBe("AAAAAA");
	});
});
```

Verifica il nome reale dell'helper di fixture del file (`seedBasicFixtures`) e cosa restituisce; se crea un seller nuovo a ogni chiamata, nel secondo test usa un solo `seedBasicFixtures()` e un cliente in più con `createTestCustomer`. Import `assignPickupCode` da `@/modules/customer/services/orders`.

Run → FAIL.

- [ ] **Step 4: Schema, migrazione, assegnazione**

`order.ts`, dopo `checkoutId`:

```ts
		// Codice di ritiro al banco (lib/pickup-code.ts): solo per gli ordini da
		// ritirare, unico tra gli ordini aperti dello stesso negozio.
		pickupCode: text("pickup_code"),
```

fra gli indici:

```ts
		uniqueIndex("order_open_pickup_code_idx")
			.on(table.storeId, table.pickupCode)
			.where(
				sql`${table.pickupCode} IS NOT NULL AND ${table.status} IN ('pending','confirmed','ready_for_pickup')`,
			),
```

`bun run db:generate` → migrazione con `ADD COLUMN "pickup_code" text` e il `CREATE UNIQUE INDEX … WHERE …`; nient'altro. `bun run db:migrate`.

In `customer/services/orders.ts`:

```ts
const OPEN_STATUSES = ["pending", "confirmed", "ready_for_pickup"] as const;

/**
 * Codice libero tra gli ordini aperti del negozio. Il pre-controllo copre il
 * caso normale; l'indice unico parziale resta la rete per una race (409).
 */
export async function assignPickupCode(
	tx: OrderTx,
	storeId: string,
	generate: () => string = generatePickupCode,
): Promise<string> {
	for (let attempt = 0; attempt < 5; attempt++) {
		const code = generate();
		const [taken] = await tx
			.select({ id: order.id })
			.from(order)
			.where(
				and(
					eq(order.storeId, storeId),
					eq(order.pickupCode, code),
					inArray(order.status, [...OPEN_STATUSES]),
				),
			)
			.limit(1);
		if (!taken) return code;
	}
	throw new ServiceError(409, "Riprova: codice di ritiro non disponibile");
}
```

In `placeOrder`, prima dell'insert dell'ordine: `const pickupCode = PICKUP_TYPES.includes(type) ? await assignPickupCode(tx, storeId) : null;` e `pickupCode` nei `.values`. (`PICKUP_TYPES` esiste già nel file; spostalo sopra `placeOrder` se è dichiarato dopo.) Import `inArray`, `generatePickupCode`.

`entities.ts`, `OrderSchema`: `pickupCode: t.Nullable(t.String({ description: "Codice di ritiro al banco (solo ordini da ritirare)" })),`.

- [ ] **Step 5: GREEN + non regressione + commit**

Run: `bun test tests/lib/pickup-code.test.ts tests/integration/customer-orders.test.ts tests/integration/customer-checkout.test.ts --timeout 180000 && bun run typecheck` → PASS.

```bash
git add apps/api/src apps/api/tests
git commit -m "feat(orders): codice di ritiro sugli ordini da ritirare"
```

---

### Task 2: Anteprima e conferma del ritiro dal seller (TDD)

**Files:**
- Modify: `apps/api/src/modules/seller/services/orders.ts` (`findOpenOrderByPickupCode`, `completePickupByCode`)
- Modify: `apps/api/src/modules/seller/routes/orders.ts` (due route, **prima** di `/orders/:orderId`)
- Test: `apps/api/tests/integration/seller-orders.test.ts`, `apps/api/tests/integration/seller-orders-routes.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function findOpenOrderByPickupCode(p: { storeId: string; code: string }): Promise<SellerOrderWithRelations>;  // 404 se assente/chiuso/altro negozio
  export async function completePickupByCode(p: { storeId: string; code: string; sellerProfileId: string }): Promise<Order>;
  // GET  /seller/orders/pickup/:code?storeId=   → okRes(SellerOrderWithRelationsSchema)
  // POST /seller/orders/pickup  { storeId, code } → okRes(OrderSchema)
  ```

- [ ] **Step 1: Test RED (service)**

In `seller-orders.test.ts` (helper `seedReservePickupOrder` esistente: aggiungi un parametro `pickupCode?: string` all'insert dell'ordine) :

```ts
describe("ritiro con codice", () => {
	it("anteprima: trova l'ordine aperto del negozio, anche con codice sporco", async () => {
		const db = getTestDb();
		const { store, order: ord } = await seedReservePickupOrder(db, {
			reservationExpiresAt: new Date(Date.now() + 3_600_000),
			pickupCode: "K7XM4P",
		});
		const found = await findOpenOrderByPickupCode({
			storeId: store.id,
			code: " k7x-m4p ",
		});
		expect(found.id).toBe(ord.id);
		expect(found.items).toHaveLength(1);
	});

	it("un codice di un altro negozio o di un ordine chiuso è 404", async () => {
		const db = getTestDb();
		const { store, order: ord } = await seedReservePickupOrder(db, {
			reservationExpiresAt: new Date(Date.now() + 3_600_000),
			pickupCode: "K7XM4P",
		});
		const other = await seedReservePickupOrder(db, {
			reservationExpiresAt: new Date(Date.now() + 3_600_000),
		});
		await expect(
			findOpenOrderByPickupCode({ storeId: other.store.id, code: "K7XM4P" }),
		).rejects.toMatchObject({ status: 404 });
		await db
			.update(order)
			.set({ status: "completed" })
			.where(eq(order.id, ord.id));
		await expect(
			findOpenOrderByPickupCode({ storeId: store.id, code: "K7XM4P" }),
		).rejects.toMatchObject({ status: 404 });
	});

	it("conferma: completa, accredita i punti una volta sola", async () => {
		const db = getTestDb();
		const { seller, store, customer, order: ord } = await seedReservePickupOrder(
			db,
			{
				reservationExpiresAt: new Date(Date.now() + 3_600_000),
				customerPoints: 0,
				pointsSpent: 0,
				pickupCode: "K7XM4P",
			},
		);
		const done = await completePickupByCode({
			storeId: store.id,
			code: "k7xm4p",
			sellerProfileId: seller.profile.id,
		});
		expect(done.status).toBe("completed");
		await expect(
			completePickupByCode({
				storeId: store.id,
				code: "K7XM4P",
				sellerProfileId: seller.profile.id,
			}),
		).rejects.toMatchObject({ status: 404 });
		const earned = await db
			.select()
			.from(pointTransaction)
			.where(
				and(
					eq(pointTransaction.orderId, ord.id),
					eq(pointTransaction.type, "earned"),
				),
			);
		expect(earned).toHaveLength(1);
		const [cp] = await db
			.select()
			.from(customerProfile)
			.where(eq(customerProfile.id, customer.profile.id));
		expect(cp.points).toBe(earned[0].amount);
	});

	it("una prenotazione scaduta non ancora spazzata: scade, rimborsa e risponde 400", async () => {
		const db = getTestDb();
		const { seller, store, sp, order: ord } = await seedReservePickupOrder(db, {
			reservationExpiresAt: new Date(Date.now() - 60_000),
			pickupCode: "K7XM4P",
		});
		await expect(
			completePickupByCode({
				storeId: store.id,
				code: "K7XM4P",
				sellerProfileId: seller.profile.id,
			}),
		).rejects.toMatchObject({ status: 400, message: "La prenotazione è scaduta" });
		const fresh = await db.query.order.findFirst({ where: eq(order.id, ord.id) });
		expect(fresh?.status).toBe("expired");
		const [spAfter] = await db
			.select()
			.from(storeProductTable)
			.where(eq(storeProductTable.id, sp.id));
		expect(spAfter.stock).toBe(12);
	});
});
```

Run: `bun test tests/integration/seller-orders.test.ts --timeout 180000` → FAIL.

- [ ] **Step 2: Service**

```ts
/** Ordine aperto del negozio con quel codice di ritiro (anteprima al banco). */
export async function findOpenOrderByPickupCode(params: {
	storeId: string;
	code: string;
}) {
	const found = await db.query.order.findFirst({
		where: and(
			eq(order.storeId, params.storeId),
			eq(order.pickupCode, normalizePickupCode(params.code)),
			inArray(order.status, ["confirmed", "ready_for_pickup"]),
		),
		columns: { id: true },
	});
	if (!found) throw new ServiceError(404, "Codice non trovato per questo negozio");
	return getSellerOrder({ orderId: found.id, storeIds: [params.storeId] });
}

/**
 * Conferma del ritiro al banco: stessa transizione di «Segna come ritirato»
 * (CAS, punti, scadenza con rimborso), cercata per codice nel negozio attivo.
 */
export async function completePickupByCode(params: {
	storeId: string;
	code: string;
	sellerProfileId: string;
}) {
	const found = await findOpenOrderByPickupCode(params);
	return transitionOrder(found.id, params.sellerProfileId, "completed", [
		params.storeId,
	]);
}
```

(import `inArray`, `normalizePickupCode`.) Nota: `findOpenOrderByPickupCode` non filtra per scadenza apposta: una prenotazione scaduta non spazzata va trovata perché `transitionOrder` la faccia scadere con rimborso.

- [ ] **Step 3: Route + test HTTP RED → GREEN**

In `seller-orders-routes.test.ts`:

```ts
describe("ritiro con codice via HTTP", () => {
	it("employee su un negozio non assegnato → 403; owner → 200", async () => {
		const { owner, empUserId, other, orderOnOther } = await seed();
		await getTestDb()
			.update(order)
			.set({ pickupCode: "K7XM4P" })
			.where(eq(order.id, orderOnOther.id));

		const denied = await call(
			empUserId,
			"GET",
			`/orders/pickup/K7XM4P?storeId=${other.id}`,
		);
		expect(denied.status).toBe(403);

		const preview = await call(
			owner.user.id,
			"GET",
			`/orders/pickup/K7XM4P?storeId=${other.id}`,
		);
		expect(preview.status).toBe(200);
		expect((await preview.json()).data.id).toBe(orderOnOther.id);
	});
});
```

Estendi `call()` del file perché accetti un body JSON (per il POST). Route in `seller/routes/orders.ts`, **subito dopo** `/orders/counts`:

```ts
	.get(
		"/orders/pickup/:code",
		async (ctx) => {
			const { params, query, accessCtx } = withSeller(ctx);
			await ensureStoreAccess(query.storeId, accessCtx);
			return ok(
				await findOpenOrderByPickupCode({
					storeId: query.storeId,
					code: params.code,
				}),
			);
		},
		{
			params: t.Object({ code: t.String({ maxLength: 20 }) }),
			query: t.Object({ storeId: t.String({ description: "Negozio attivo" }) }),
			response: withErrors({ 200: okRes(SellerOrderWithRelationsSchema) }),
			detail: {
				summary: "Anteprima ritiro per codice",
				description:
					"L'ordine aperto del negozio con quel codice di ritiro, da mostrare al banco prima di confermare.",
				tags: ["Seller - Orders"],
			},
		},
	)
	.post(
		"/orders/pickup",
		async (ctx) => {
			const sellerCtx = withSeller(ctx);
			const { body, accessCtx, sellerProfile: sp, store, user } = sellerCtx;
			await ensureStoreAccess(body.storeId, accessCtx);
			const data = await completePickupByCode({
				storeId: body.storeId,
				code: body.code,
				sellerProfileId: sp.id,
			});
			getLogger(store).info(
				{ userId: user.id, orderId: data.id, action: "order_picked_up_by_code" },
				"Ritiro confermato al banco",
			);
			return ok(data);
		},
		{
			body: t.Object({
				storeId: t.String({ description: "Negozio attivo" }),
				code: t.String({ maxLength: 20, description: "Codice di ritiro" }),
			}),
			response: withConflictErrors({ 200: okRes(OrderSchema) }),
			detail: {
				summary: "Conferma ritiro per codice",
				description:
					"Completa l'ordine aperto con quel codice nel negozio: accredita i punti; una prenotazione scaduta viene fatta scadere con rimborso (400).",
				tags: ["Seller - Orders"],
			},
		},
	)
```

Run: `bun test tests/integration/seller-orders.test.ts tests/integration/seller-orders-routes.test.ts --timeout 180000 && bun run typecheck` → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/seller apps/api/tests/integration
git commit -m "feat(orders): anteprima e conferma del ritiro per codice dal negozio"
```

---

### Task 3: Via il ritiro lato cliente

**Files:**
- Modify: `apps/api/src/modules/customer/services/orders.ts` (rimuovi `pickupOrder`, `RESERVATION_EXPIRED`)
- Modify: `apps/api/src/modules/customer/routes/orders.ts` (rimuovi `POST /orders/:orderId/pickup`)
- Modify: `apps/api/tests/integration/customer-orders.test.ts` (rimuovi il `describe("pickupOrder")`)

- [ ] **Step 1:** Prima di rimuovere, confronta i casi del `describe("pickupOrder")` (righe ~602-700) con quelli coperti ora dal seller (Task 2 e `transitionOrder — reserve_pickup expiry`): completamento con punti, ordine altrui → 404, stati non ritirabili, scadenza con rimborso. Ogni caso deve avere un equivalente lato seller; se ne manca uno, aggiungilo al `describe("ritiro con codice")` prima di cancellare.
- [ ] **Step 2:** Rimuovi route, service e test; `grep -rn "pickupOrder\|/pickup\"" apps/api/src apps/api/tests` → nessun riferimento residuo (tranne le route seller nuove).
- [ ] **Step 3:** `bun test tests/integration/customer-orders.test.ts --timeout 180000 && bun run typecheck` (api e customer) → PASS.
- [ ] **Step 4: Commit**

```bash
git add apps/api
git commit -m "refactor(orders): il ritiro lo conferma solo il negozio"
```

---

### Task 4: QR nel dettaglio ordine del cliente

**Files:**
- Modify: `apps/customer/package.json` (dipendenza `uqr`)
- Create: `apps/customer/src/features/orders/pickup-code.ts` + `.test.ts` (`formatPickupCode`)
- Create: `apps/customer/src/features/orders/pickup-qr.tsx`
- Modify: `apps/customer/src/routes/_authenticated/orders/$orderId.tsx`, `.../checkout/$checkoutId/index.tsx`
- Modify: `apps/customer/messages/{it,en}.json`

- [ ] **Step 1:** `cd apps/customer && bun add uqr` (se la versione nel catalog di root è la convenzione per le dipendenze condivise, lascia la dipendenza locale: è solo del customer). Verifica con `bun pm ls | grep uqr`.
- [ ] **Step 2: Test RED** — `pickup-code.test.ts`: `formatPickupCode("K7XM4P") === "K7X M4P"`; `formatPickupCode(null) === ""`. Run → FAIL; implementa (`code ? `${code.slice(0,3)} ${code.slice(3)}` : ""`) → PASS.
- [ ] **Step 3: Componente** `pickup-qr.tsx`:

```tsx
import { renderSVG } from "uqr";
import { m } from "@/paraglide/messages";
import { formatPickupCode } from "./pickup-code";

/** QR del codice di ritiro. Sfondo sempre bianco: gli scanner non leggono il
 *  QR invertito della dark mode. Il QR codifica solo il codice. */
export function PickupQr({ code }: { code: string }) {
	const svg = renderSVG(code, { border: 2 });
	return (
		<figure className="flex flex-col items-center gap-3">
			<div
				role="img"
				aria-label={m.orders_pickup_qr_aria({ code: formatPickupCode(code) })}
				className="size-52 rounded-xl bg-white p-2 [&_svg]:size-full"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generato localmente da uqr a partire da un codice di 6 caratteri del nostro alfabeto
				dangerouslySetInnerHTML={{ __html: svg }}
			/>
			<figcaption className="text-center">
				<span className="block text-muted-foreground text-xs">
					{m.orders_pickup_code_label()}
				</span>
				<span className="font-mono font-semibold text-2xl text-foreground tracking-[0.2em]">
					{formatPickupCode(code)}
				</span>
			</figcaption>
		</figure>
	);
}
```

Verifica l'API reale di `uqr` (`renderSVG(text, options)`) nel `README`/tipi del pacchetto installato e adegua le opzioni.
- [ ] **Step 4:** Nel dettaglio ordine, se `order.pickupCode` e lo stato è `confirmed`/`ready_for_pickup`: sezione in cima, `<PickupQr code={order.pickupCode} />` con sotto `orders_pickup_qr_hint` («Mostralo in negozio: il negoziante lo scansiona e ti consegna la merce.»). Nella pagina di conferma, per ogni ordine con codice: il codice formattato in piccolo + link «Mostra QR» al dettaglio.
- [ ] **Step 5:** Messaggi it/en: `orders_pickup_code_label` («Codice di ritiro»), `orders_pickup_qr_aria` («Codice QR di ritiro {code}»), `orders_pickup_qr_hint`, `orders_show_qr` («Mostra QR»).
- [ ] **Step 6:** `bun test && bun run typecheck && bun run build` (customer), lint da root.

```bash
git add apps/customer bun.lock
git commit -m "feat(customer): QR del codice di ritiro nel dettaglio ordine"
```

---

### Task 5: Pagina «Ritiro» nel seller

**Files:**
- Modify: `apps/seller/package.json` (dipendenza `barcode-detector`)
- Create: `apps/seller/src/features/orders/pickup-code.ts` + `.test.ts` (`normalizePickupCode`, `formatPickupCode`, `isCompletePickupCode`)
- Create: `apps/seller/src/features/orders/hooks/use-pickup.ts` (`usePickupPreview`, `useConfirmPickup`)
- Create: `apps/seller/src/features/orders/components/pickup-scanner.tsx`
- Create: `apps/seller/src/routes/_authenticated/pickup.tsx`
- Modify: `apps/seller/src/components/app-sidebar.tsx`, `app-breadcrumb.tsx`, `messages/{it,en}.json`, `routeTree.gen.ts`

- [ ] **Step 1: Test RED** (`bun test` nel seller): `normalizePickupCode(" k7x-m4p ") === "K7XM4P"`; `isCompletePickupCode("K7XM4P") === true`, `("K7X") === false`, `("K7XM40") === false` (0 fuori alfabeto); `formatPickupCode("K7XM4P") === "K7X M4P"`. Implementa con lo stesso alfabeto dell'API (commento che rimanda a `apps/api/src/lib/pickup-code.ts`).
- [ ] **Step 2: Hook** — `usePickupPreview(storeId, code)`: `useQuery` abilitata solo se `isCompletePickupCode(code)`, `retry: false`, chiave `["orders","pickup",storeId,code]`, `api().seller.orders.pickup({ code }).get({ query: { storeId } })` → `.data`. `useConfirmPickup()`: `api().seller.orders.pickup.post({ storeId, code })`, `onSettled` invalida `["orders"]`.
- [ ] **Step 3: Scanner** `pickup-scanner.tsx`: bottone «Scansiona»; al click `const { BarcodeDetector } = await import("barcode-detector/ponyfill")` (import dinamico: wasm e camera solo lato client); `navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })` su un `<video playsInline muted>`; loop `requestAnimationFrame` (al massimo ~6 detect/s) con `detector.detect(video)`; al primo valore che dopo `normalizePickupCode` passa `isCompletePickupCode` → `onCode(code)`, stop dei track. Errori: `NotAllowedError` → `pickup_camera_denied`, `NotFoundError`/assenza di `mediaDevices` → `pickup_camera_missing`. Cleanup dei track all'unmount. Verifica dal pacchetto installato se il wasm viene preso da CDN (jsdelivr) di default: se sì, servilo in locale con `import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url"` e `prepareZXingModule({ overrides: { locateFile: (p, pre) => p.endsWith(".wasm") ? wasmUrl : pre + p } })` (nomi da verificare nei tipi del pacchetto).
- [ ] **Step 4: Pagina** `/pickup`: titolo «Ritiro»; campo codice grande (`inputMode="text"`, `autoCapitalize="characters"`, `maxLength` 7, mostra il valore formattato 3-3), `<PickupScanner onCode={setCode} />` accanto. Con codice completo: anteprima (cliente, numero ordine, tipologia, righe, «Da incassare» per PP1 / «Pagato online» per PR2, badge stato); bottone primario «Conferma ritiro» → `useConfirmPickup` → stato di successo «Ritiro confermato» con «Nuovo ritiro» che svuota il campo e rimette il focus. 404 → «Codice non trovato per questo negozio»; 400 scaduta → messaggio dell'API; errori mostrati sotto il campo (non solo toast). Senza negozio attivo: stato vuoto come le altre pagine.
- [ ] **Step 5: Navigazione**: voce «Ritiro» (icona `ScanLine`) in sidebar dopo «Ordini», visibile anche agli employee; `pickup: "Ritiro"` nel breadcrumb.
- [ ] **Step 6:** messaggi seller it/en (`pickup_title`, `pickup_subtitle`, `pickup_code_label`, `pickup_scan`, `pickup_scan_stop`, `pickup_camera_denied`, `pickup_camera_missing`, `pickup_not_found`, `pickup_confirm`, `pickup_done`, `pickup_new`, `pickup_to_collect`, `pickup_paid_online`); `bun test && bun run typecheck && bun run build` (seller), lint.

```bash
git add apps/seller bun.lock
git commit -m "feat(seller): pagina Ritiro con codice e scansione del QR"
```

---

### Task 6: Smoke, gate, review, backlog, PR

- [ ] **Smoke** (customer :3001 con cliente di prova, seller :3002 con `seller1@test.com`): prenota su «Alimentari Ricci» → dettaglio con QR e codice → nel seller «Ritiro»: codice digitato in minuscolo con spazio → anteprima → «Conferma ritiro» → successo; il cliente vede «Ritirato» dopo refresh; lo stesso codice di nuovo → «non trovato». Scansione: con la webcam del Mac inquadra il QR mostrato sul telefono o su un'altra finestra (se la camera non è disponibile nel browser di automazione, verifica almeno il messaggio `pickup_camera_missing`/`denied` e fai provare a Marco). Mouse e tastiera, 390px, dark mode (QR su bianco).
- [ ] **Gate**: lint; typecheck dei 4 workspace; `bun run test` di root; build dei 3 frontend; `db:generate` → «No schema changes»; `git status` pulito.
- [ ] **Review finale** con agente fresco (modello più capace), Review Focus incluso, **senza** test di integrazione mentre gira il gate; fix Critical/Important in TDD.
- [ ] **Backlog**: nella riga P1.1 «QR fatto in #NN».
- [ ] **PR** `feat/pickup-qr` senza auto-merge (UI: gate = smoke di Marco); `#NN` → numero reale dopo l'apertura.
