# Carrello acquisti customer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare al cliente un carrello persistito lato server in cui accumulare prodotti dal catalogo di un negozio, vederli raggruppati per negozio, cambiarne la quantità e rimuoverli.

**Architecture:** Una sola tabella `cart_items` legata a `(customer_profile, store_product)`; il raggruppamento per negozio è una join in lettura, non una colonna. Prezzi e sconti si rileggono a ogni GET (nessuno snapshot), lo stock non viene mai riservato. Sul frontend una sola query TanStack `["cart"]` alimenta pulsante, stepper, badge e pagina: nessuno stato locale che duplichi il server.

**Tech Stack:** Elysia + Drizzle (PostgreSQL/PostGIS) + TypeBox · TanStack Start/Router/Query + Eden Treaty · Paraglide · Tailwind v4 + `@bibs/ui` · bun:test con testcontainers.

**Spec:** `docs/superpowers/specs/2026-09-10-customer-cart-design.md`

## Global Constraints

- **Branch:** `feat/customer-cart`. Mai commit diretti su `main`.
- **Commit:** Conventional Commits, descrizione minuscola all'imperativo, prima riga < 72 caratteri. Scope ammessi qui: `api`, `customer`, `db`, `ui`. Ogni commit termina con `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Formattazione:** Biome, indentazione a **tab**, doppi apici. Il hook Lefthook pre-commit la applica da solo — non combatterlo.
- **File naming:** kebab-case ovunque.
- **Copy utente:** **sempre** via Paraglide (`import { m } from "@/paraglide/messages"`), mai stringhe in chiaro nel JSX. Le chiavi vanno in `apps/customer/messages/it.json` **e** `en.json`, entrambi.
- **Nessun campo data nei DTO dell'API.** Eden Treaty idrata le stringhe-data in `Date` e il render va in errore. `createdAt` / `updatedAt` restano in tabella e non escono mai dalla risposta.
- **Toast:** `import { toast } from "@bibs/ui/components/sonner"`, mai `from "sonner"`.
- **`routeTree.gen.ts` va committato** insieme a ogni route nuova: è generato ma tracciato, e lo rigenera `build`/`dev`, non `tsc`. Dimenticarlo dà CI rossa con locale verde.
- **Messaggi di `ServiceError` in italiano** su questo modulo: arrivano dritti sotto gli occhi del cliente.
- **Gotcha Drizzle, load-bearing:** dentro un `sql` template usato **come campo della SELECT**, le Column interpolate (`${table.col}`) vengono rese **senza qualificazione**. In una query con più join `"id"` diventa ambiguo e la subquery correlata si rompe. In quel contesto: alias espliciti per le tabelle interne e nomi letterali qualificati (`products.id`, `stores.id`) per quelle esterne. Dentro `.where()` la qualificazione invece funziona.
- **Verifica prima di dire "fatto":** `bun run typecheck` da root (Eden propaga i tipi su tre frontend), `bun run lint`, `bun run test`.

## File Structure

**API — creati**

| File | Responsabilità |
|---|---|
| `apps/api/src/db/schemas/cart.ts` | Tabella `cart_items` e sue relations |
| `apps/api/src/modules/customer/services/cart.ts` | Logica di dominio: lettura raggruppata, upsert, quantità, rimozione |
| `apps/api/src/modules/customer/routes/cart.ts` | Quattro route Elysia + contratto OpenAPI |
| `apps/api/tests/integration/customer-cart.test.ts` | Test del servizio |

**API — modificati**

| File | Modifica |
|---|---|
| `apps/api/src/db/schemas/index.ts` | `export * from "./cart";` |
| `apps/api/src/lib/schemas/entities.ts` | `CartSchema` e satelliti; `StoreProductCardSchema` guadagna `storeProductId` e `stock` |
| `apps/api/src/modules/customer/services/store-products.ts` | `EXISTS` → `innerJoin`, per far uscire `store_products.id` |
| `apps/api/src/modules/customer/index.ts` | Monta `cartRoutes` dentro il guard autenticato |
| `apps/api/tests/helpers/fixtures.ts` | `createTestCartItem` |
| `apps/api/tests/integration/customer-store-products.test.ts` | Asserzioni su `storeProductId` / `stock` |

**Customer — creati**

| File | Responsabilità |
|---|---|
| `apps/customer/src/features/cart/use-cart.ts` | La query `["cart"]` e le tre mutation |
| `apps/customer/src/features/cart/add-to-cart.tsx` | Pulsante "Aggiungi" che diventa stepper |
| `apps/customer/src/features/cart/cart-badge.tsx` | Contatore nella top app bar |
| `apps/customer/src/routes/_authenticated/cart.tsx` | La pagina carrello |

**Customer — modificati**

| File | Modifica |
|---|---|
| `apps/customer/src/features/catalog/product-tile.tsx` | Prop `action?: ReactNode` |
| `apps/customer/src/features/stores/store-products.tsx` | Passa `<AddToCart>` alla tile |
| `apps/customer/src/features/stores/use-store-products.ts` | Propaga `storeProductId` e `stock` |
| `apps/customer/src/components/site-header.tsx` | Monta `<CartBadge>` |
| `apps/customer/messages/{it,en}.json` | Chiavi nuove + migrazione dello storefront |
| ~10 file dello storefront | Migrazione copy → Paraglide (Task 7) |

---

### Task 1: Il catalogo negozio espone `storeProductId` e `stock`

Senza questo, nessuna superficie customer può costruire una riga d'ordine: `POST /customer/orders` vuole `store_products.id`, e oggi l'endpoint non lo restituisce.

**Files:**
- Modify: `apps/api/src/modules/customer/services/store-products.ts:11-90`
- Modify: `apps/api/src/lib/schemas/entities.ts:746`
- Test: `apps/api/tests/integration/customer-store-products.test.ts`

**Interfaces:**
- Produces: `StoreProductCard` guadagna `storeProductId: string` e `stock: number`. Task 8 li consuma dal frontend.

- [ ] **Step 1: Scrivi il test che fallisce**

In `apps/api/tests/integration/customer-store-products.test.ts`, dentro il `describe("getStoreProducts — visible store")`, aggiungi:

```ts
	it("exposes the store_products row id and stock for ordering", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id);
		const other = await visibleStore(profile.id, "Altro");

		const p = await createTestProduct(db, profile.id, { name: "Vendibile" });
		const spHere = await createTestStoreProduct(db, s.id, p.id, { stock: 7 });
		// Stesso prodotto, altro negozio: non deve inquinare né la riga né lo stock
		await createTestStoreProduct(db, other.id, p.id, { stock: 99 });

		const result = await getStoreProducts(s.id, {});

		expect(result.data).toHaveLength(1);
		expect(result.data[0].storeProductId).toBe(spHere.id);
		expect(result.data[0].stock).toBe(7);
	});
```

- [ ] **Step 2: Lancia il test e verifica che fallisca**

```bash
cd apps/api && bun test tests/integration/customer-store-products.test.ts -t "exposes the store_products row id"
```

Atteso: FAIL. TypeScript si lamenta che `storeProductId` non esiste su `StoreProductCard`.

- [ ] **Step 3: Converti la query da `EXISTS` a `innerJoin`**

In `apps/api/src/modules/customer/services/store-products.ts`, estendi l'interfaccia:

```ts
export interface StoreProductCard {
	id: string;
	storeProductId: string;
	stock: number;
	name: string;
	description: string | null;
	price: string;
	images: { id: string; url: string; position: number }[];
	discountedPrice: string | null;
	discountPercent: number | null;
}
```

Sostituisci il blocco `whereClause` + le due query con:

```ts
	// La disponibilità in QUESTO negozio era un EXISTS: ora è una join, perché
	// serve far uscire store_products.id (l'identificatore che l'ordine pretende).
	// La cardinalità non cambia: store_product_product_store_idx è unique su
	// (product_id, store_id), quindi al massimo una riga per prodotto.
	const storeProductJoin = and(
		eq(storeProduct.productId, product.id),
		eq(storeProduct.storeId, storeId),
	);

	const whereClause = sql`
		${product.status} = 'active'
		AND ${storeProduct.stock} > 0
	`;

	const [data, [{ total }]] = await Promise.all([
		db
			.select({
				id: product.id,
				storeProductId: storeProduct.id,
				stock: storeProduct.stock,
				name: product.name,
				description: product.description,
				price: product.price,
				// Subquery correlata: alias l'interna (pi) e riferisci l'esterna
				// letteralmente (products.id) — le Column interpolate in un campo
				// SELECT vengono rese senza qualificazione e romperebbero la
				// correlazione.
				images: sql<{ id: string; url: string; position: number }[]>`(
          SELECT coalesce(json_agg(json_build_object(
            'id', pi.id,
            'url', pi.url,
            'position', pi.position
          ) ORDER BY pi.position), '[]'::json)
          FROM ${productImage} pi
          WHERE pi.product_id = products.id
        )`.as("images"),
			})
			.from(product)
			.innerJoin(storeProduct, storeProductJoin)
			.where(whereClause)
			.orderBy(sql`${product.createdAt} DESC, ${product.id} ASC`)
			.limit(limit)
			.offset(offset),
		db
			.select({ total: sql<number>`count(*)::int` })
			.from(product)
			.innerJoin(storeProduct, storeProductJoin)
			.where(whereClause),
	]);
```

Nel `map` che costruisce `annotated`, aggiungi i due campi nuovi:

```ts
		return {
			id: r.id,
			storeProductId: r.storeProductId,
			stock: r.stock,
			name: r.name,
			description: r.description,
			price: r.price,
			images: r.images,
			discountedPrice: info?.discountedPrice ?? null,
```

(il resto del `return` resta invariato)

- [ ] **Step 4: Estendi lo schema TypeBox**

In `apps/api/src/lib/schemas/entities.ts`, dentro `StoreProductCardSchema`, subito dopo `id`:

```ts
	storeProductId: t.String({
		description: "ID della riga store_products, da usare per ordinare",
	}),
	stock: t.Integer({
		minimum: 0,
		description: "Disponibilità del prodotto in questo negozio",
	}),
```

- [ ] **Step 5: Lancia i test del file e verifica che passino tutti**

```bash
cd apps/api && bun test tests/integration/customer-store-products.test.ts
```

Atteso: PASS su tutti i test del file, non solo quello nuovo. Se un test preesistente si rompe, la join ha cambiato la cardinalità: controlla che il filtro `storeId` sia dentro la condizione di join e non nella `where`.

- [ ] **Step 6: Verifica che i tre frontend continuino a compilare**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run typecheck
```

Atteso: PASS. Aggiungere campi a una risposta è retrocompatibile per Eden.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/customer/services/store-products.ts \
        apps/api/src/lib/schemas/entities.ts \
        apps/api/tests/integration/customer-store-products.test.ts
git commit -m "$(cat <<'EOF'
feat(api): expose store product id and stock in the store catalog

The catalog resolved availability with an EXISTS, so store_products.id never
left the endpoint — and that is the identifier order items are keyed on.
Turning it into a join keeps the cardinality (the (product_id, store_id)
index is unique) and unblocks add-to-cart.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Tabella `cart_items` e migrazione

**Files:**
- Create: `apps/api/src/db/schemas/cart.ts`
- Modify: `apps/api/src/db/schemas/index.ts`
- Modify: `apps/api/tests/helpers/fixtures.ts`
- Create: `apps/api/tests/integration/customer-cart.test.ts`
- Create: `apps/api/src/db/migrations/<generata>.sql` (la genera `db:generate`, non scriverla a mano)

**Interfaces:**
- Produces: `cartItem` (tabella Drizzle) e `createTestCartItem(db, customerProfileId, storeProductId, params?)`. Task 3, 4, 5 li consumano.

- [ ] **Step 1: Scrivi lo schema**

Crea `apps/api/src/db/schemas/cart.ts`:

```ts
import { relations, sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { customerProfile } from "./customer";
import { storeProduct } from "./product";

/** Tetto per riga: tiene fuori le quantità assurde senza inventare un dominio. */
export const MAX_CART_ITEM_QUANTITY = 99;

export const cartItem = pgTable(
	"cart_items",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		customerProfileId: text("customer_profile_id")
			.notNull()
			.references(() => customerProfile.id, { onDelete: "cascade" }),
		// storeProduct, non product: pinna prodotto E negozio in una colonna sola,
		// ed è l'identificatore che POST /customer/orders si aspetta. Il cascade è
		// voluto: se il venditore toglie il prodotto dal negozio, la riga sparisce
		// (al contrario di order_items, che snapshotta per restare leggibile).
		storeProductId: text("store_product_id")
			.notNull()
			.references(() => storeProduct.id, { onDelete: "cascade" }),
		quantity: integer("quantity").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		// Una riga per (cliente, prodotto-in-negozio): il secondo "aggiungi" somma.
		uniqueIndex("cart_item_customer_store_product_idx").on(
			table.customerProfileId,
			table.storeProductId,
		),
		// Niente indice su customer_profile_id da solo: è il prefisso sinistro
		// dell'unique qui sopra. Questo invece serve, perché il cascade della FK
		// su store_products non può usare quell'unique (product-leading).
		index("cart_item_store_product_id_idx").on(table.storeProductId),
		check(
			"cart_item_quantity_range",
			sql`${table.quantity} BETWEEN 1 AND ${sql.raw(String(MAX_CART_ITEM_QUANTITY))}`,
		),
	],
);

export const cartItemRelations = relations(cartItem, ({ one }) => ({
	customerProfile: one(customerProfile, {
		fields: [cartItem.customerProfileId],
		references: [customerProfile.id],
	}),
	storeProduct: one(storeProduct, {
		fields: [cartItem.storeProductId],
		references: [storeProduct.id],
	}),
}));
```

- [ ] **Step 2: Registra lo schema nel barrel**

In `apps/api/src/db/schemas/index.ts`, fra `./brand` e `./category` (l'elenco è alfabetico):

```ts
export * from "./cart";
```

- [ ] **Step 3: Aggiungi la fixture di test**

In `apps/api/tests/helpers/fixtures.ts`, aggiungi l'import di `cartItem` in cima insieme agli altri schemi e in fondo al file:

```ts
export async function createTestCartItem(
	db: DrizzleTestDb,
	customerProfileId: string,
	storeProductId: string,
	params: { quantity?: number } = {},
) {
	const [row] = await db
		.insert(cartItem)
		.values({
			customerProfileId,
			storeProductId,
			quantity: params.quantity ?? 1,
		})
		.returning();

	return row;
}
```

- [ ] **Step 4: Scrivi il test dei vincoli**

Crea `apps/api/tests/integration/customer-cart.test.ts`:

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

import { cartItem } from "@/db/schemas/cart";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCartItem,
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

/** Negozio pubblicamente visibile: vivo e con abbonamento attivo. */
async function visibleStore(sellerProfileId: string, name = "Negozio") {
	const db = getTestDb();
	const s = await createTestStore(db, sellerProfileId, { name });
	await createTestStoreSubscription(db, s.id, { status: "active" });
	return s;
}

/** Scorciatoia: un negozio visibile con dentro un prodotto attivo e stoccato. */
async function sellableProduct(
	sellerProfileId: string,
	opts: { storeName?: string; price?: string; stock?: number } = {},
) {
	const db = getTestDb();
	const s = await visibleStore(sellerProfileId, opts.storeName ?? "Negozio");
	const p = await createTestProduct(db, sellerProfileId, {
		price: opts.price ?? "10.00",
	});
	const sp = await createTestStoreProduct(db, s.id, p.id, {
		stock: opts.stock ?? 10,
	});
	return { store: s, product: p, storeProduct: sp };
}

describe("cart_items — vincoli di schema", () => {
	it("rejects a quantity outside 1..99", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id);
		const { profile: cp } = await createTestCustomer(db);

		await expect(
			db.insert(cartItem).values({
				customerProfileId: cp.id,
				storeProductId: sp.id,
				quantity: 0,
			}),
		).rejects.toThrow();

		await expect(
			db.insert(cartItem).values({
				customerProfileId: cp.id,
				storeProductId: sp.id,
				quantity: 100,
			}),
		).rejects.toThrow();
	});

	it("rejects two rows for the same customer and store product", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id);
		const { profile: cp } = await createTestCustomer(db);

		await createTestCartItem(db, cp.id, sp.id, { quantity: 1 });

		await expect(
			createTestCartItem(db, cp.id, sp.id, { quantity: 2 }),
		).rejects.toThrow();
	});

	it("drops the row when the product leaves the store", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id);
		const { profile: cp } = await createTestCustomer(db);
		await createTestCartItem(db, cp.id, sp.id);

		await db.delete(storeProductTable).where(eq(storeProductTable.id, sp.id));

		const left = await db.select().from(cartItem);
		expect(left).toHaveLength(0);
	});
});
```

Il terzo test usa due simboli in più: aggiungi in cima al blocco di import (dopo il `mock.module`)

```ts
import { eq } from "drizzle-orm";
import { storeProduct as storeProductTable } from "@/db/schemas/product";
```

- [ ] **Step 5: Nota sulle firme delle fixture**

`createTestCustomer(db, params?)` restituisce `{ user, profile }` — nel test serve solo `profile`, da cui `const { profile: cp } = await createTestCustomer(db)`. `createTestSeller(db, params?)` restituisce anch'essa `{ user, profile }`. `createTestStoreProduct(db, storeId, productId, { stock })` prende lo **store per primo**, il prodotto per secondo: invertirli compila ma produce righe senza senso.

- [ ] **Step 6: Genera la migrazione e LEGGI l'SQL**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run db:generate
```

Poi apri il file appena creato sotto `apps/api/src/db/migrations/` e verifica che contenga, e nient'altro: `CREATE TABLE "cart_items"`, le due FK con `ON DELETE cascade`, l'unique index, l'index su `store_product_id`, il CHECK `BETWEEN 1 AND 99`. **Se la migrazione tocca altre tabelle, fermati**: significa che il branch ha uno scostamento schema/migrazioni preesistente da chiarire prima.

- [ ] **Step 7: Applica la migrazione**

```bash
bun run db:migrate
```

- [ ] **Step 8: Lancia i test**

```bash
cd apps/api && bun test tests/integration/customer-cart.test.ts
```

Atteso: PASS su tutti e tre. I testcontainers applicano la cartella migrazioni da soli, quindi il CHECK c'è.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/db/schemas/cart.ts \
        apps/api/src/db/schemas/index.ts \
        apps/api/src/db/migrations \
        apps/api/tests/helpers/fixtures.ts \
        apps/api/tests/integration/customer-cart.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add cart_items table

One row per (customer, store product), so a second add sums instead of
duplicating. No carts table: the cart is the set of a customer's rows, so
there is no container to create or garbage-collect. Cascade on the store
product is deliberate — a cart is intent, not a record.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Servizio — `addCartItem`

Validazione severa in scrittura: qui si decide se una riga può esistere.

**Files:**
- Create: `apps/api/src/modules/customer/services/cart.ts`
- Test: `apps/api/tests/integration/customer-cart.test.ts` (estende quello del Task 2)

**Interfaces:**
- Consumes: `cartItem`, `MAX_CART_ITEM_QUANTITY` (Task 2).
- Produces: `addCartItem(params: { customerProfileId: string; storeProductId: string; quantity: number }): Promise<{ id: string; quantity: number }>`. Task 6 la chiama dalla route.

- [ ] **Step 1: Scrivi i test che falliscono**

Appendi a `apps/api/tests/integration/customer-cart.test.ts`:

```ts
describe("addCartItem", () => {
	it("creates the row, then sums on the second add", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id, {
			stock: 10,
		});
		const { profile: cp } = await createTestCustomer(db);

		const first = await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 2,
		});
		expect(first.quantity).toBe(2);

		const second = await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 3,
		});
		expect(second.id).toBe(first.id);
		expect(second.quantity).toBe(5);

		const rows = await db.select().from(cartItem);
		expect(rows).toHaveLength(1);
	});

	it("refuses a quantity beyond the available stock", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id, {
			stock: 3,
		});
		const { profile: cp } = await createTestCustomer(db);

		await expect(
			addCartItem({
				customerProfileId: cp.id,
				storeProductId: sp.id,
				quantity: 4,
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("refuses when the sum of two adds exceeds the stock", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id, {
			stock: 3,
		});
		const { profile: cp } = await createTestCustomer(db);

		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 2,
		});

		await expect(
			addCartItem({
				customerProfileId: cp.id,
				storeProductId: sp.id,
				quantity: 2,
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("refuses to go past the per-row cap", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id, {
			stock: 500,
		});
		const { profile: cp } = await createTestCustomer(db);

		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 99,
		});

		await expect(
			addCartItem({
				customerProfileId: cp.id,
				storeProductId: sp.id,
				quantity: 1,
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("refuses a store that is not publicly visible", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		// Negozio senza abbonamento: publiclyVisibleStore() lo esclude
		const s = await createTestStore(db, profile.id, { name: "Invisibile" });
		const p = await createTestProduct(db, profile.id);
		const sp = await createTestStoreProduct(db, s.id, p.id, { stock: 5 });
		const { profile: cp } = await createTestCustomer(db);

		await expect(
			addCartItem({
				customerProfileId: cp.id,
				storeProductId: sp.id,
				quantity: 1,
			}),
		).rejects.toMatchObject({ status: 404 });
	});

	it("refuses a product that is not active", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id);
		const p = await createTestProduct(db, profile.id, { status: "disabled" });
		const sp = await createTestStoreProduct(db, s.id, p.id, { stock: 5 });
		const { profile: cp } = await createTestCustomer(db);

		await expect(
			addCartItem({
				customerProfileId: cp.id,
				storeProductId: sp.id,
				quantity: 1,
			}),
		).rejects.toMatchObject({ status: 404 });
	});

	it("keeps two customers' carts apart", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id);
		const { profile: a } = await createTestCustomer(db);
		const { profile: b } = await createTestCustomer(db);

		await addCartItem({
			customerProfileId: a.id,
			storeProductId: sp.id,
			quantity: 1,
		});
		await addCartItem({
			customerProfileId: b.id,
			storeProductId: sp.id,
			quantity: 4,
		});

		const rows = await db.select().from(cartItem);
		expect(rows).toHaveLength(2);
	});
});
```

Aggiungi in cima al file, insieme agli altri import dopo il `mock.module`:

```ts
import { addCartItem } from "@/modules/customer/services/cart";
```

- [ ] **Step 2: Lancia i test e verifica che falliscano**

```bash
cd apps/api && bun test tests/integration/customer-cart.test.ts -t "addCartItem"
```

Atteso: FAIL, il modulo `services/cart` non esiste.

- [ ] **Step 3: Scrivi il servizio**

Crea `apps/api/src/modules/customer/services/cart.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cartItem, MAX_CART_ITEM_QUANTITY } from "@/db/schemas/cart";
import { product, storeProduct } from "@/db/schemas/product";
import { store } from "@/db/schemas/store";
import { ServiceError } from "@/lib/errors";
import { publiclyVisibleStore } from "@/lib/store-visibility";

interface AddCartItemParams {
	customerProfileId: string;
	storeProductId: string;
	quantity: number;
}

/**
 * Aggiunge un prodotto al carrello, sommando se la riga esiste già.
 *
 * Il carrello NON riserva stock: lo decrementa `createOrder`, in transazione.
 * Qui lo stock è solo un tetto, così il cliente non accumula un'intenzione che
 * non potrà mai diventare un ordine.
 */
export async function addCartItem(
	params: AddCartItemParams,
): Promise<{ id: string; quantity: number }> {
	const { customerProfileId, storeProductId, quantity } = params;

	return db.transaction(async (tx) => {
		// publiclyVisibleStore() vive in una .where(): lì Drizzle qualifica le
		// Column correttamente (a differenza di un campo SELECT).
		const [sellable] = await tx
			.select({ stock: storeProduct.stock, status: product.status })
			.from(storeProduct)
			.innerJoin(product, eq(product.id, storeProduct.productId))
			.innerJoin(store, eq(store.id, storeProduct.storeId))
			.where(and(eq(storeProduct.id, storeProductId), publiclyVisibleStore()))
			.limit(1);

		// Un prodotto non acquistabile e un prodotto inesistente collassano nello
		// stesso 404: non si conferma l'esistenza di righe che non si possono
		// comprare.
		if (!sellable || sellable.status !== "active")
			throw new ServiceError(404, "Prodotto non disponibile");

		const [existing] = await tx
			.select({ id: cartItem.id, quantity: cartItem.quantity })
			.from(cartItem)
			.where(
				and(
					eq(cartItem.customerProfileId, customerProfileId),
					eq(cartItem.storeProductId, storeProductId),
				),
			)
			.limit(1);

		const nextQuantity = (existing?.quantity ?? 0) + quantity;

		if (nextQuantity > MAX_CART_ITEM_QUANTITY)
			throw new ServiceError(
				400,
				`Puoi aggiungere al massimo ${MAX_CART_ITEM_QUANTITY} pezzi per prodotto`,
			);

		if (nextQuantity > sellable.stock)
			throw new ServiceError(
				400,
				sellable.stock === 0
					? "Questo prodotto è esaurito"
					: `Ne restano solo ${sellable.stock}`,
			);

		if (existing) {
			const [updated] = await tx
				.update(cartItem)
				.set({ quantity: nextQuantity })
				.where(eq(cartItem.id, existing.id))
				.returning({ id: cartItem.id, quantity: cartItem.quantity });
			return updated;
		}

		const [created] = await tx
			.insert(cartItem)
			.values({ customerProfileId, storeProductId, quantity: nextQuantity })
			.returning({ id: cartItem.id, quantity: cartItem.quantity });
		return created;
	});
}
```

- [ ] **Step 4: Lancia i test e verifica che passino**

```bash
cd apps/api && bun test tests/integration/customer-cart.test.ts
```

Atteso: PASS su tutti, compresi i tre del Task 2.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/customer/services/cart.ts \
        apps/api/tests/integration/customer-cart.test.ts
git commit -m "$(cat <<'EOF'
feat(api): add the cart add-item service

Upsert that sums on re-add, bounded by both the per-row cap and the real
stock. Store visibility and product status collapse into one 404: an
unbuyable row and a missing row look the same from outside.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Servizio — `getCart`

Lettura tollerante: non fallisce mai, annota. È il rovescio del Task 3.

**Files:**
- Modify: `apps/api/src/modules/customer/services/cart.ts`
- Test: `apps/api/tests/integration/customer-cart.test.ts`

**Interfaces:**
- Consumes: `cartItem` (Task 2), `getBestActiveDiscounts(productIds, executor?)` da `@/modules/seller/services/discount-pricing`, `toCents` / `fromCents` da `@/lib/money`.
- Produces: `getCart(customerProfileId: string): Promise<CartView>` più i tipi esportati `CartItemIssue`, `CartItemView`, `CartStoreGroup`, `CartView`. Task 6 li usa per lo schema TypeBox, Task 8 e 9 per il frontend.

- [ ] **Step 1: Scrivi i test che falliscono**

Appendi a `apps/api/tests/integration/customer-cart.test.ts`:

```ts
describe("getCart", () => {
	it("returns zeros for an empty cart", async () => {
		const db = getTestDb();
		const { profile: cp } = await createTestCustomer(db);

		const cart = await getCart(cp.id);

		expect(cart.groups).toEqual([]);
		expect(cart.itemCount).toBe(0);
		expect(cart.total).toBe("0.00");
	});

	it("groups rows by store, ordered by store name", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: spB } = await sellableProduct(profile.id, {
			storeName: "Bottega Zeta",
			price: "5.00",
		});
		const { storeProduct: spA } = await sellableProduct(profile.id, {
			storeName: "Alimentari Alfa",
			price: "3.00",
		});
		const { profile: cp } = await createTestCustomer(db);

		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: spB.id,
			quantity: 1,
		});
		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: spA.id,
			quantity: 2,
		});

		const cart = await getCart(cp.id);

		expect(cart.groups.map((g) => g.store.name)).toEqual([
			"Alimentari Alfa",
			"Bottega Zeta",
		]);
		expect(cart.groups[0].subtotal).toBe("6.00");
		expect(cart.groups[1].subtotal).toBe("5.00");
		expect(cart.itemCount).toBe(3);
		expect(cart.total).toBe("11.00");
	});

	it("prices the line at the discounted price when a promo is active", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id);
		const p = await createTestProduct(db, profile.id, { price: "10.00" });
		const sp = await createTestStoreProduct(db, s.id, p.id, { stock: 10 });
		const d = await createTestDiscount(db, profile.id, { percent: 20 });
		await createTestDiscountProduct(db, d.id, p.id);
		const { profile: cp } = await createTestCustomer(db);

		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 3,
		});

		const cart = await getCart(cp.id);
		const item = cart.groups[0].items[0];

		expect(item.unitPrice).toBe("10.00");
		expect(item.discountedPrice).toBe("8.00");
		expect(item.discountPercent).toBe(20);
		expect(item.lineTotal).toBe("24.00");
		expect(cart.total).toBe("24.00");
	});

	it("flags a line whose stock fell below the quantity, without failing", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id, {
			stock: 5,
			price: "4.00",
		});
		const { profile: cp } = await createTestCustomer(db);
		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 4,
		});

		// Il venditore vende altrove: lo stock scende sotto il carrello
		await db
			.update(storeProductTable)
			.set({ stock: 1 })
			.where(eq(storeProductTable.id, sp.id));

		const cart = await getCart(cp.id);
		const item = cart.groups[0].items[0];

		expect(item.issue).toBe("insufficient_stock");
		expect(item.availableStock).toBe(1);
		// Prezzabile comunque: la riga resta nei totali
		expect(item.lineTotal).toBe("16.00");
		expect(cart.total).toBe("16.00");
	});

	it("flags an unavailable line and keeps it out of the totals", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { store: s, storeProduct: sp } = await sellableProduct(profile.id, {
			price: "9.00",
		});
		const { storeProduct: spOk } = await sellableProduct(profile.id, {
			storeName: "Ancora Viva",
			price: "2.00",
		});
		const { profile: cp } = await createTestCustomer(db);
		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 1,
		});
		await addCartItem({
			customerProfileId: cp.id,
			storeProductId: spOk.id,
			quantity: 1,
		});

		// Il negozio esce dalla visibilità pubblica (soft delete)
		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, s.id));

		const cart = await getCart(cp.id);
		const flagged = cart.groups
			.flatMap((g) => g.items)
			.find((i) => i.storeProductId === sp.id);

		expect(flagged?.issue).toBe("unavailable");
		// Fuori dai totali, ma ancora contata come "roba nel carrello"
		expect(cart.total).toBe("2.00");
		expect(cart.itemCount).toBe(2);
	});

	it("never returns another customer's rows", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id);
		const { profile: a } = await createTestCustomer(db);
		const { profile: b } = await createTestCustomer(db);
		await addCartItem({
			customerProfileId: b.id,
			storeProductId: sp.id,
			quantity: 2,
		});

		const cart = await getCart(a.id);

		expect(cart.groups).toEqual([]);
	});
});
```

Aggiorna gli import in cima al file:

```ts
import { getCart } from "@/modules/customer/services/cart";
import { store as storeTable } from "@/db/schemas/store";
import {
	createTestDiscount,
	createTestDiscountProduct,
} from "../helpers/fixtures";
```

(`createTestDiscount` / `createTestDiscountProduct` vanno aggiunti alla lista di import già presente, non duplicati in una seconda `import` dallo stesso modulo)

- [ ] **Step 2: Lancia i test e verifica che falliscano**

```bash
cd apps/api && bun test tests/integration/customer-cart.test.ts -t "getCart"
```

Atteso: FAIL, `getCart` non è esportata.

- [ ] **Step 3: Implementa `getCart`**

In `apps/api/src/modules/customer/services/cart.ts`, estendi gli import in cima:

```ts
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { cartItem, MAX_CART_ITEM_QUANTITY } from "@/db/schemas/cart";
import { municipality, province } from "@/db/schemas/location";
import { product, storeProduct } from "@/db/schemas/product";
import { store } from "@/db/schemas/store";
import { ServiceError } from "@/lib/errors";
import { fromCents, toCents } from "@/lib/money";
import { publiclyVisibleStore } from "@/lib/store-visibility";
import { getBestActiveDiscounts } from "@/modules/seller/services/discount-pricing";
```

e aggiungi in fondo al file:

```ts
/** Perché una riga non è (del tutto) acquistabile. `ok` = nessun problema. */
export type CartItemIssue = "ok" | "insufficient_stock" | "unavailable";

export interface CartItemView {
	id: string;
	storeProductId: string;
	quantity: number;
	product: { id: string; name: string; imageUrl: string | null };
	unitPrice: string;
	discountedPrice: string | null;
	discountPercent: number | null;
	lineTotal: string;
	availableStock: number;
	issue: CartItemIssue;
}

export interface CartStoreGroup {
	store: {
		id: string;
		name: string;
		municipality: { name: string; provinceAcronym: string };
	};
	items: CartItemView[];
	subtotal: string;
}

export interface CartView {
	groups: CartStoreGroup[];
	itemCount: number;
	total: string;
}

/**
 * Il carrello del cliente, già raggruppato per negozio.
 *
 * Non fallisce mai per righe diventate problematiche: le annota con `issue` e
 * `availableStock` e lascia decidere al cliente. I prezzi si rileggono qui a
 * ogni chiamata — nessuno snapshot — così il carrello dice la stessa cosa che
 * dirà `createOrder` al checkout.
 */
export async function getCart(customerProfileId: string): Promise<CartView> {
	const rows = await db
		.select({
			id: cartItem.id,
			quantity: cartItem.quantity,
			storeProductId: storeProduct.id,
			stock: storeProduct.stock,
			productId: product.id,
			productName: product.name,
			productStatus: product.status,
			price: product.price,
			storeId: store.id,
			storeName: store.name,
			municipalityName: municipality.name,
			provinceAcronym: province.acronym,
			// publiclyVisibleStore() NON è usabile qui: è scritto per una .where(),
			// e come campo SELECT le sue Column interpolate perderebbero la
			// qualificazione — con sei tabelle in join "id" sarebbe ambiguo. Stessa
			// condizione, riscritta con nomi letterali qualificati e alias interno.
			storeVisible: sql<boolean>`(
        stores.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM store_subscriptions ss
          WHERE ss.store_id = stores.id
          AND ss.status IN ('active', 'past_due', 'canceling')
        )
      )`.as("store_visible"),
			imageUrl: sql<string | null>`(
        SELECT pi.url FROM product_images pi
        WHERE pi.product_id = products.id
        ORDER BY pi.position ASC
        LIMIT 1
      )`.as("image_url"),
		})
		.from(cartItem)
		.innerJoin(storeProduct, eq(storeProduct.id, cartItem.storeProductId))
		.innerJoin(product, eq(product.id, storeProduct.productId))
		.innerJoin(store, eq(store.id, storeProduct.storeId))
		.innerJoin(municipality, eq(municipality.id, store.municipalityId))
		.innerJoin(province, eq(province.id, municipality.provinceId))
		.where(eq(cartItem.customerProfileId, customerProfileId))
		.orderBy(store.name, store.id, cartItem.createdAt);

	if (rows.length === 0) return { groups: [], itemCount: 0, total: "0.00" };

	// Batch: una query per tutti i prodotti del carrello. `ActiveDiscountInfo`
	// porta anche `endsAt: Date`, che NON deve finire nel DTO — qui si leggono
	// solo `percent` e `discountedPrice`.
	const discountMap = await getBestActiveDiscounts([
		...new Set(rows.map((r) => r.productId)),
	]);

	const groups = new Map<string, CartStoreGroup>();
	let totalCents = 0;
	let itemCount = 0;

	for (const row of rows) {
		const discount = discountMap.get(row.productId);
		const lineCents =
			toCents(discount?.discountedPrice ?? row.price) * row.quantity;

		const issue: CartItemIssue =
			!row.storeVisible || row.productStatus !== "active"
				? "unavailable"
				: row.stock < row.quantity
					? "insufficient_stock"
					: "ok";

		let group = groups.get(row.storeId);
		if (!group) {
			group = {
				store: {
					id: row.storeId,
					name: row.storeName,
					municipality: {
						name: row.municipalityName,
						provinceAcronym: row.provinceAcronym,
					},
				},
				items: [],
				subtotal: "0.00",
			};
			groups.set(row.storeId, group);
		}

		group.items.push({
			id: row.id,
			storeProductId: row.storeProductId,
			quantity: row.quantity,
			product: {
				id: row.productId,
				name: row.productName,
				imageUrl: row.imageUrl,
			},
			unitPrice: row.price,
			discountedPrice: discount?.discountedPrice ?? null,
			discountPercent: discount?.percent ?? null,
			lineTotal: fromCents(lineCents),
			availableStock: row.stock,
			issue,
		});

		// itemCount conta tutto ciò che è nel carrello, problemi inclusi: il badge
		// dice "quanta roba c'è", e le righe rotte vogliono comunque attenzione.
		itemCount += row.quantity;

		// I totali invece escludono le righe non acquistabili: gonfierebbero una
		// cifra che il cliente non pagherà mai.
		if (issue !== "unavailable") {
			group.subtotal = fromCents(toCents(group.subtotal) + lineCents);
			totalCents += lineCents;
		}
	}

	return {
		groups: [...groups.values()],
		itemCount,
		total: fromCents(totalCents),
	};
}
```

- [ ] **Step 4: Lancia tutti i test del file**

```bash
cd apps/api && bun test tests/integration/customer-cart.test.ts
```

Atteso: PASS. Se `storeVisible` torna `undefined` invece di un booleano, l'alias `.as("store_visible")` è saltato o il nome della tabella nel frammento SQL è sbagliato: sono `stores` e `store_subscriptions`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/customer/services/cart.ts \
        apps/api/tests/integration/customer-cart.test.ts
git commit -m "$(cat <<'EOF'
feat(api): add the grouped cart read service

Reads live prices and discounts on every call rather than snapshotting, so
the cart says what createOrder will say. Rows that went bad are annotated,
never dropped: unavailable ones stay visible with their reason but out of
the totals.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Servizio — quantità e rimozione

Entrambe filtrano per `customerProfileId` oltre che per `id`, e rispondono **404** su riga altrui: non si conferma l'esistenza di righe di altri.

**Files:**
- Modify: `apps/api/src/modules/customer/services/cart.ts`
- Test: `apps/api/tests/integration/customer-cart.test.ts`

**Interfaces:**
- Consumes: `cartItem` (Task 2).
- Produces: `setCartItemQuantity(params: { cartItemId: string; customerProfileId: string; quantity: number }): Promise<{ id: string; quantity: number }>` e `removeCartItem(params: { cartItemId: string; customerProfileId: string }): Promise<void>`. Task 6 le chiama dalle route.

- [ ] **Step 1: Scrivi i test che falliscono**

Appendi a `apps/api/tests/integration/customer-cart.test.ts`:

```ts
describe("setCartItemQuantity", () => {
	it("sets the quantity absolutely, not incrementally", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id, {
			stock: 10,
		});
		const { profile: cp } = await createTestCustomer(db);
		const row = await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 5,
		});

		const updated = await setCartItemQuantity({
			cartItemId: row.id,
			customerProfileId: cp.id,
			quantity: 2,
		});

		expect(updated.quantity).toBe(2);
	});

	it("refuses a quantity beyond the available stock", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id, {
			stock: 3,
		});
		const { profile: cp } = await createTestCustomer(db);
		const row = await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 1,
		});

		await expect(
			setCartItemQuantity({
				cartItemId: row.id,
				customerProfileId: cp.id,
				quantity: 4,
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("404s on another customer's row instead of 403", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id);
		const { profile: owner } = await createTestCustomer(db);
		const { profile: intruder } = await createTestCustomer(db);
		const row = await addCartItem({
			customerProfileId: owner.id,
			storeProductId: sp.id,
			quantity: 1,
		});

		await expect(
			setCartItemQuantity({
				cartItemId: row.id,
				customerProfileId: intruder.id,
				quantity: 2,
			}),
		).rejects.toMatchObject({ status: 404 });

		// E la riga della vittima è rimasta intatta
		const [untouched] = await db
			.select()
			.from(cartItem)
			.where(eq(cartItem.id, row.id));
		expect(untouched.quantity).toBe(1);
	});
});

describe("removeCartItem", () => {
	it("removes the caller's own row", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id);
		const { profile: cp } = await createTestCustomer(db);
		const row = await addCartItem({
			customerProfileId: cp.id,
			storeProductId: sp.id,
			quantity: 1,
		});

		await removeCartItem({ cartItemId: row.id, customerProfileId: cp.id });

		const left = await db.select().from(cartItem);
		expect(left).toHaveLength(0);
	});

	it("404s on another customer's row and leaves it alone", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const { storeProduct: sp } = await sellableProduct(profile.id);
		const { profile: owner } = await createTestCustomer(db);
		const { profile: intruder } = await createTestCustomer(db);
		const row = await addCartItem({
			customerProfileId: owner.id,
			storeProductId: sp.id,
			quantity: 1,
		});

		await expect(
			removeCartItem({ cartItemId: row.id, customerProfileId: intruder.id }),
		).rejects.toMatchObject({ status: 404 });

		const left = await db.select().from(cartItem);
		expect(left).toHaveLength(1);
	});
});
```

Estendi l'import del servizio in cima al file:

```ts
import {
	addCartItem,
	getCart,
	removeCartItem,
	setCartItemQuantity,
} from "@/modules/customer/services/cart";
```

- [ ] **Step 2: Lancia i test e verifica che falliscano**

```bash
cd apps/api && bun test tests/integration/customer-cart.test.ts -t "CartItem"
```

Atteso: FAIL, le due funzioni non esistono.

- [ ] **Step 3: Implementa le due funzioni**

In fondo a `apps/api/src/modules/customer/services/cart.ts`:

```ts
interface SetCartItemQuantityParams {
	cartItemId: string;
	customerProfileId: string;
	quantity: number;
}

/**
 * Imposta la quantità di una riga (valore assoluto, è lo stepper).
 *
 * Il filtro su `customerProfileId` è la difesa IDOR: senza, l'id della riga
 * basterebbe a toccare il carrello di chiunque. Riga altrui → 404, non 403.
 */
export async function setCartItemQuantity(
	params: SetCartItemQuantityParams,
): Promise<{ id: string; quantity: number }> {
	const { cartItemId, customerProfileId, quantity } = params;

	return db.transaction(async (tx) => {
		const [owned] = await tx
			.select({ stock: storeProduct.stock })
			.from(cartItem)
			.innerJoin(storeProduct, eq(storeProduct.id, cartItem.storeProductId))
			.where(
				and(
					eq(cartItem.id, cartItemId),
					eq(cartItem.customerProfileId, customerProfileId),
				),
			)
			.limit(1);

		if (!owned) throw new ServiceError(404, "Prodotto non nel carrello");

		if (quantity > owned.stock)
			throw new ServiceError(
				400,
				owned.stock === 0
					? "Questo prodotto è esaurito"
					: `Ne restano solo ${owned.stock}`,
			);

		const [updated] = await tx
			.update(cartItem)
			.set({ quantity })
			.where(eq(cartItem.id, cartItemId))
			.returning({ id: cartItem.id, quantity: cartItem.quantity });

		return updated;
	});
}

interface RemoveCartItemParams {
	cartItemId: string;
	customerProfileId: string;
}

/** Toglie una riga dal carrello. Riga altrui → 404, come sopra. */
export async function removeCartItem(
	params: RemoveCartItemParams,
): Promise<void> {
	const { cartItemId, customerProfileId } = params;

	const [deleted] = await db
		.delete(cartItem)
		.where(
			and(
				eq(cartItem.id, cartItemId),
				eq(cartItem.customerProfileId, customerProfileId),
			),
		)
		.returning({ id: cartItem.id });

	if (!deleted) throw new ServiceError(404, "Prodotto non nel carrello");
}
```

- [ ] **Step 4: Lancia tutti i test del file**

```bash
cd apps/api && bun test tests/integration/customer-cart.test.ts
```

Atteso: PASS su tutto il file.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/customer/services/cart.ts \
        apps/api/tests/integration/customer-cart.test.ts
git commit -m "$(cat <<'EOF'
feat(api): add cart quantity and removal services

Both scope the write by customer profile, not just by row id, and answer
404 on someone else's row: a 403 would confirm it exists.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Schemi TypeBox e route Elysia

**Files:**
- Modify: `apps/api/src/lib/schemas/entities.ts`
- Create: `apps/api/src/modules/customer/routes/cart.ts`
- Modify: `apps/api/src/modules/customer/index.ts`

**Interfaces:**
- Consumes: `getCart`, `addCartItem`, `setCartItemQuantity`, `removeCartItem` (Task 3–5).
- Produces: gli endpoint `GET /customer/cart`, `POST /customer/cart/items`, `PATCH /customer/cart/items/:id`, `DELETE /customer/cart/items/:id`. Task 8 e 9 li chiamano via Eden.

- [ ] **Step 1: Aggiungi gli schemi**

In fondo a `apps/api/src/lib/schemas/entities.ts`:

```ts
// Carrello customer. Nessun campo data: Eden Treaty idrata le stringhe-data in
// Date e manderebbe in errore il render. createdAt/updatedAt restano in tabella.
export const CartItemSchema = t.Object({
	id: t.String({ description: "ID della riga di carrello" }),
	storeProductId: t.String({
		description: "ID della riga store_products, da usare per ordinare",
	}),
	quantity: t.Integer({ minimum: 1, description: "Quantità nel carrello" }),
	product: t.Object({
		id: t.String(),
		name: t.String({ description: "Nome del prodotto" }),
		imageUrl: t.Nullable(
			t.String({ description: "URL della prima immagine del prodotto" }),
		),
	}),
	unitPrice: t.String({ description: "Prezzo di listino in formato decimale" }),
	discountedPrice: t.Nullable(
		t.String({ description: "Prezzo scontato, se promo attiva" }),
	),
	discountPercent: t.Nullable(t.Integer({ minimum: 1, maximum: 99 })),
	lineTotal: t.String({
		description: "Totale di riga: prezzo effettivo per quantità",
	}),
	availableStock: t.Integer({
		minimum: 0,
		description: "Disponibilità residua nel negozio",
	}),
	issue: t.Union(
		[
			t.Literal("ok"),
			t.Literal("insufficient_stock"),
			t.Literal("unavailable"),
		],
		{
			description:
				"Stato della riga: ok, disponibilità insufficiente, oppure non più acquistabile (negozio non visibile o prodotto non attivo)",
		},
	),
});

export const CartStoreGroupSchema = t.Object({
	store: t.Object({
		id: t.String(),
		name: t.String({ description: "Nome del negozio" }),
		municipality: t.Object({
			name: t.String({ description: "Comune del negozio" }),
			provinceAcronym: t.String({ description: "Sigla della provincia" }),
		}),
	}),
	items: t.Array(CartItemSchema),
	subtotal: t.String({
		description:
			"Subtotale del negozio, escluse le righe non più acquistabili",
	}),
});

export const CartSchema = t.Object({
	groups: t.Array(CartStoreGroupSchema, {
		description: "Righe raggruppate per negozio, ordinate per nome",
	}),
	itemCount: t.Integer({
		minimum: 0,
		description: "Somma delle quantità, righe problematiche incluse",
	}),
	total: t.String({
		description: "Totale del carrello, escluse le righe non acquistabili",
	}),
});

export const CartItemMutationSchema = t.Object({
	id: t.String({ description: "ID della riga di carrello" }),
	quantity: t.Integer({ minimum: 1, description: "Quantità risultante" }),
});
```

- [ ] **Step 2: Scrivi le route**

Crea `apps/api/src/modules/customer/routes/cart.ts`:

```ts
import { Elysia, t } from "elysia";
import { MAX_CART_ITEM_QUANTITY } from "@/db/schemas/cart";
import { getLogger } from "@/lib/logger";
import { ok, okMessage } from "@/lib/responses";
import {
	CartItemMutationSchema,
	CartSchema,
	OkMessage,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { withCustomer } from "../context";
import {
	addCartItem,
	getCart,
	removeCartItem,
	setCartItemQuantity,
} from "../services/cart";

export const cartRoutes = new Elysia()
	.get(
		"/cart",
		async (ctx) => {
			const { customerProfile: cp } = withCustomer(ctx);
			return ok(await getCart(cp.id));
		},
		{
			response: withErrors({ 200: okRes(CartSchema) }),
			detail: {
				summary: "Carrello",
				description:
					"Restituisce il carrello del cliente, raggruppato per negozio. Prezzi e sconti sono letti al momento della richiesta. Le righe non più acquistabili vengono annotate, non rimosse.",
				tags: ["Customer - Cart"],
			},
		},
	)
	.post(
		"/cart/items",
		async (ctx) => {
			const { customerProfile: cp, body, store, user } = withCustomer(ctx);
			const pino = getLogger(store);

			const data = await addCartItem({
				customerProfileId: cp.id,
				...body,
			});

			pino.info(
				{
					userId: user.id,
					customerProfileId: cp.id,
					cartItemId: data.id,
					storeProductId: body.storeProductId,
					quantity: data.quantity,
					action: "cart_item_added",
				},
				"Prodotto aggiunto al carrello",
			);

			return ok(data);
		},
		{
			body: t.Object({
				storeProductId: t.String({
					description: "ID della riga store_products da aggiungere",
				}),
				quantity: t.Integer({
					minimum: 1,
					maximum: MAX_CART_ITEM_QUANTITY,
					description: "Quantità da aggiungere a quella già presente",
				}),
			}),
			response: withConflictErrors({ 200: okRes(CartItemMutationSchema) }),
			detail: {
				summary: "Aggiungi al carrello",
				description:
					"Aggiunge un prodotto al carrello. Se il prodotto è già presente, la quantità viene sommata. Rifiuta se il negozio non è pubblicamente visibile, se il prodotto non è attivo, o se si supera la disponibilità.",
				tags: ["Customer - Cart"],
			},
		},
	)
	.patch(
		"/cart/items/:id",
		async (ctx) => {
			const { customerProfile: cp, params, body } = withCustomer(ctx);
			const data = await setCartItemQuantity({
				cartItemId: params.id,
				customerProfileId: cp.id,
				...body,
			});
			return ok(data);
		},
		{
			params: t.Object({
				id: t.String({ description: "ID della riga di carrello" }),
			}),
			body: t.Object({
				quantity: t.Integer({
					minimum: 1,
					maximum: MAX_CART_ITEM_QUANTITY,
					description: "Nuova quantità (valore assoluto)",
				}),
			}),
			response: withErrors({ 200: okRes(CartItemMutationSchema) }),
			detail: {
				summary: "Aggiorna quantità",
				description:
					"Imposta la quantità di una riga del carrello. Per rimuoverla usa DELETE: la quantità minima è 1.",
				tags: ["Customer - Cart"],
			},
		},
	)
	.delete(
		"/cart/items/:id",
		async (ctx) => {
			const { customerProfile: cp, params } = withCustomer(ctx);
			await removeCartItem({
				cartItemId: params.id,
				customerProfileId: cp.id,
			});
			return okMessage("Prodotto rimosso dal carrello");
		},
		{
			params: t.Object({
				id: t.String({ description: "ID della riga di carrello" }),
			}),
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Rimuovi dal carrello",
				description: "Rimuove una riga dal carrello del cliente.",
				tags: ["Customer - Cart"],
			},
		},
	);
```

Nota sul `POST`: usa `withConflictErrors` perché l'unique `(customer_profile_id, store_product_id)` può scattare su due aggiunte simultanee dello stesso prodotto; il gestore globale traduce `23505` in 409 da solo, non serve un try/catch.

- [ ] **Step 3: Monta le route**

In `apps/api/src/modules/customer/index.ts`, aggiungi l'import

```ts
import { cartRoutes } from "./routes/cart";
```

e la `.use()` in coda alla catena dentro il guard, dopo `ordersRoutes`:

```ts
				.use(ordersRoutes)
				.use(cartRoutes),
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run typecheck
```

Atteso: PASS. Se i tre frontend si lamentano di tipi Eden incoerenti dopo aver toccato solo l'API, è la copia stantia nello store `.bun`: `bun install` pulito e ricontrolla.

- [ ] **Step 5: Verifica il contratto OpenAPI a mano**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run dev:api
```

In un'altra shell:

```bash
curl -s localhost:3000/openapi/json | jq '.paths | keys[] | select(startswith("/customer/cart"))'
```

Atteso, esattamente queste due chiavi:

```
"/customer/cart"
"/customer/cart/items"
"/customer/cart/items/{id}"
```

Controlla anche che le quattro operazioni portino il tag `Customer - Cart` e che `GET /customer/cart` richieda `bearerAuth` (viene dal guard, non va dichiarato a mano). Poi ferma il server.

- [ ] **Step 6: Lancia lint e la suite API**

```bash
cd /Users/marcogelli/repos/jelaz/bibs && bun run lint && cd apps/api && bun test
```

Atteso: PASS. Se la suite completa fallisce mentre il file del carrello da solo passa, è ordine fra file: rilancia con `bun test --parallel=4 --isolate` e confronta.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/schemas/entities.ts \
        apps/api/src/modules/customer/routes/cart.ts \
        apps/api/src/modules/customer/index.ts
git commit -m "$(cat <<'EOF'
feat(api): add the customer cart endpoints

GET returns the cart already grouped by store and carries itemCount, so the
header badge needs no endpoint of its own. Mutations answer with the
resulting row and let the client invalidate.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Migrazione del copy dello storefront a Paraglide

AGENTS.md vuole tutto il copy in Paraglide; oggi Paraglide copre solo i flussi auth e lo storefront costruito nelle PR #130–#133 ha l'italiano in chiaro. Questo task sana la divergenza **prima** che il carrello ne aggiunga altro. È un commit a sé: il diff del carrello deve restare leggibile.

**Files:**
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json`
- Modify: `apps/customer/src/routes/_authenticated/profile.tsx` (~29 stringhe)
- Modify: `apps/customer/src/routes/_authenticated/stores/index.tsx` (~14)
- Modify: `apps/customer/src/routes/_authenticated/stores/$storeId.tsx` (~8)
- Modify: `apps/customer/src/features/discovery/nearby-products.tsx` (~8)
- Modify: `apps/customer/src/features/stores/format-opening-hours.ts` (~8, trattamento speciale)
- Modify: `apps/customer/src/features/stores/opening-hours.tsx`
- Modify: `apps/customer/src/features/stores/store-products.tsx`
- Modify: `apps/customer/src/routes/_authenticated/index.tsx`
- Modify: `apps/customer/src/components/site-header.tsx`
- Modify: `apps/customer/src/components/user-menu.tsx`
- Test: `apps/customer/src/features/stores/format-opening-hours.test.ts`

**Interfaces:**
- Produces: `formatWeeklyHours(openingHours, todayDow, dayLabels)` — terzo parametro obbligatorio, una 7-tupla di stringhe. Nessun altro modulo cambia firma.

- [ ] **Step 1: Fissa la convenzione delle chiavi**

Le chiavi esistenti sono `auth_*`. Le nuove seguono `<area>_<cosa>`:

| Area | Prefisso | Esempi |
|---|---|---|
| Navigazione e chrome | `nav_` | `nav_stores`, `nav_cart` |
| Scoperta / home | `discovery_` | `discovery_nearby_title`, `discovery_enable_location` |
| Elenco e scheda negozio | `store_` | `store_products_title`, `store_load_more`, `store_closed` |
| Giorni della settimana | `day_` | `day_monday` … `day_sunday` |
| Profilo | `profile_` | `profile_title`, `profile_save` |
| Errori comuni | `error_` | `error_generic`, `error_load_failed` |

Le stringhe con interpolazione usano la sintassi Paraglide: `"store_results_count": "{count} negozi trovati"`, chiamata come `m.store_results_count({ count })`.

- [ ] **Step 2: Migra `format-opening-hours.ts`, che è il caso delicato**

È un modulo **puro con test**: importarci dentro `m` legherebbe il test al runtime i18n. Le etichette diventano un parametro.

In `apps/customer/src/features/stores/format-opening-hours.ts`, cancella la costante `DAY_LABELS` e cambia la firma:

```ts
/** Etichette dei sette giorni, lunedì per primo. Le fornisce il chiamante:
 *  questo modulo resta puro e testabile senza il runtime i18n. */
export type DayLabels = readonly [
	string,
	string,
	string,
	string,
	string,
	string,
	string,
];

export function formatWeeklyHours(
	openingHours: OpeningHoursDayInput[] | null,
	todayDow: number,
	dayLabels: DayLabels,
): WeekRow[] {
	return dayLabels.map((label, dow) => {
		const day = openingHours?.find((d) => d.dayOfWeek === dow);
		const hours =
			day && day.slots.length > 0
				? day.slots.map((s) => `${s.open}–${s.close}`).join(" · ")
				: null;
		return { dayOfWeek: dow, label, hours, isToday: dow === todayDow };
	});
}
```

In `apps/customer/src/features/stores/opening-hours.tsx`:

```tsx
import { m } from "@/paraglide/messages";
import {
	type DayLabels,
	formatWeeklyHours,
	type OpeningHoursDayInput,
	romeDayOfWeek,
} from "./format-opening-hours";

export function OpeningHours({
	openingHours,
}: {
	openingHours: OpeningHoursDayInput[] | null;
}) {
	const dayLabels: DayLabels = [
		m.day_monday(),
		m.day_tuesday(),
		m.day_wednesday(),
		m.day_thursday(),
		m.day_friday(),
		m.day_saturday(),
		m.day_sunday(),
	];
	const rows = formatWeeklyHours(
		openingHours,
		romeDayOfWeek(new Date()),
		dayLabels,
	);
```

e più sotto `{r.hours ?? m.store_closed()}` al posto di `{r.hours ?? "Chiuso"}`.

In `apps/customer/src/features/stores/format-opening-hours.test.ts`, aggiungi in cima e passa la tupla a ogni chiamata:

```ts
const TEST_DAY_LABELS = [
	"Lun",
	"Mar",
	"Mer",
	"Gio",
	"Ven",
	"Sab",
	"Dom",
] as const;
```

Le due asserzioni sulle etichette diventano:

```ts
		expect(rows[0].label).toBe("Lun");
		expect(rows[6].label).toBe("Dom");
```

Il test ora verifica la **mappatura** giorno→etichetta, non le parole italiane: è ciò che quella funzione fa davvero.

- [ ] **Step 3: Migra i file rimanenti, uno alla volta**

Per ciascun file dell'elenco in **Files**: apri, individua ogni stringa che finisce sotto gli occhi dell'utente (testo nel JSX, `placeholder`, `aria-label`, `title`, argomenti di `toast.*`), aggiungi la chiave a **entrambi** `messages/it.json` e `messages/en.json`, sostituisci con `m.<chiave>()`, aggiungi `import { m } from "@/paraglide/messages";` se manca.

Esempio dal file più denso, `store-products.tsx`:

```tsx
			<h2 className="font-display font-semibold text-foreground text-lg">
				{m.store_products_title()}
			</h2>
```

e per il pulsante di paginazione:

```tsx
								{isFetchingNextPage
									? m.store_loading()
									: m.store_load_more()}
```

con, in `it.json`:

```json
	"store_products_title": "Prodotti",
	"store_loading": "Caricamento…",
	"store_load_more": "Carica altri",
	"store_load_failed": "Non siamo riusciti a caricare i prodotti.",
	"store_retry": "Riprova",
```

e in `en.json` le stesse chiavi tradotte:

```json
	"store_products_title": "Products",
	"store_loading": "Loading…",
	"store_load_more": "Load more",
	"store_load_failed": "We couldn't load the products.",
	"store_retry": "Retry",
```

**Non toccare** le stringhe che non sono copy: nomi di classi Tailwind, chiavi di query, valori di `to=` nei `Link`, `data-*`.

- [ ] **Step 4: Ricompila Paraglide e verifica i tipi**

```bash
cd apps/customer && bun run paraglide:compile && bun run typecheck
```

Atteso: PASS. Una chiave usata nel codice ma assente dai JSON dà errore di tipo su `m.<chiave>` — è la rete di sicurezza contro le chiavi orfane. `src/paraglide/` è generato: non modificarlo mai a mano.

- [ ] **Step 5: Verifica che non sia rimasto copy in chiaro**

```bash
cd apps/customer/src && grep -rnE '>[[:space:]]*[A-ZÀ-Ù][a-zà-ù]{3,}' --include='*.tsx' components features routes | grep -v paraglide
```

Atteso: nessuna riga di testo utente. Quel che resta deve essere solo markup o nomi di componenti (`<Button ...>`, `<Card ...>`). Controlla a occhio ogni riga superstite e giustificala.

- [ ] **Step 6: Lancia i test del customer e il build**

```bash
cd apps/customer && bun run test && bun run build
```

Atteso: PASS su entrambi. Il `build` è il gate vero per il customer: intercetta le rotture SSR che il typecheck non vede.

- [ ] **Step 7: Commit**

```bash
git add apps/customer/messages apps/customer/src
git commit -m "$(cat <<'EOF'
refactor(customer): move storefront copy to Paraglide

The storefront shipped with Italian inline while Paraglide covered only the
auth flows. Doing this before the cart keeps the cart's own diff readable
and stops the divergence from growing.

formatWeeklyHours now takes the day labels as an argument: importing the
i18n runtime into a pure, tested module would have tied its test to it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Frontend — la query del carrello e il pulsante nel catalogo

**Files:**
- Create: `apps/customer/src/features/cart/use-cart.ts`
- Create: `apps/customer/src/features/cart/add-to-cart.tsx`
- Modify: `apps/customer/src/features/catalog/product-tile.tsx`
- Modify: `apps/customer/src/features/stores/use-store-products.ts`
- Modify: `apps/customer/src/features/stores/store-products.tsx`
- Modify: `apps/customer/messages/{it,en}.json`

**Interfaces:**
- Consumes: gli endpoint del Task 6 via Eden; `storeProductId` / `stock` dal Task 1.
- Produces: `useCart()` con `{ cart, isPending, isError, refetch, linesByStoreProductId, addItem, setQuantity, removeItem }`, i tipi `CartData` / `CartGroup` / `CartLine`, e il componente `<AddToCart storeProductId stock productName />`. Task 9 li riusa.

- [ ] **Step 1: Aggiungi le chiavi di traduzione**

In `apps/customer/messages/it.json`:

```json
	"cart_add": "Aggiungi",
	"cart_out_of_stock": "Esaurito",
	"cart_item_added": "Aggiunto al carrello",
	"cart_load_failed": "Non siamo riusciti a caricare il carrello.",
	"cart_add_aria": "Aggiungi {product} al carrello",
	"cart_increase_aria": "Aumenta la quantità di {product}",
	"cart_decrease_aria": "Riduci la quantità di {product}",
	"cart_remove_aria": "Togli {product} dal carrello",
	"error_generic": "Qualcosa è andato storto. Riprova."
```

e in `en.json`:

```json
	"cart_add": "Add",
	"cart_out_of_stock": "Out of stock",
	"cart_item_added": "Added to cart",
	"cart_load_failed": "We couldn't load your cart.",
	"cart_add_aria": "Add {product} to the cart",
	"cart_increase_aria": "Increase the quantity of {product}",
	"cart_decrease_aria": "Decrease the quantity of {product}",
	"cart_remove_aria": "Remove {product} from the cart",
	"error_generic": "Something went wrong. Please try again."
```

- [ ] **Step 2: Scrivi `use-cart.ts`**

Crea `apps/customer/src/features/cart/use-cart.ts`:

```ts
import { toast } from "@bibs/ui/components/sonner";
import { unwrap } from "@bibs/ui/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

const CART_KEY = ["cart"] as const;

// `unwrap` (da @bibs/ui/lib/api-client) lancia il messaggio dell'API se c'è,
// altrimenti il fallback: è così che il testo specifico del server — "Ne
// restano solo 3" — arriva intatto al toast. Non riscrivere quella logica.
async function fetchCart() {
	const res = await api().customer.cart.get();
	return unwrap(res, m.cart_load_failed()).data;
}

// I tipi vengono dall'API via Eden: nessun DTO scritto a mano da tenere in sync.
export type CartData = Awaited<ReturnType<typeof fetchCart>>;
export type CartGroup = CartData["groups"][number];
export type CartLine = CartGroup["items"][number];

/**
 * Unica fonte di verità del carrello sul frontend: pulsante, stepper, badge e
 * pagina leggono tutti da questa query. Nessuno stato locale che duplichi il
 * server — dopo ogni mutation si invalida e si rilegge.
 */
export function useCart() {
	const queryClient = useQueryClient();
	const invalidate = () => queryClient.invalidateQueries({ queryKey: CART_KEY });

	const cartQuery = useQuery({
		queryKey: CART_KEY,
		staleTime: 30_000,
		queryFn: fetchCart,
	});

	const cart = cartQuery.data;

	// Indice per storeProductId: la tile del catalogo deve sapere in O(1) se quel
	// prodotto è già nel carrello e in che quantità.
	const linesByStoreProductId = useMemo(() => {
		const map = new Map<string, CartLine>();
		for (const group of cart?.groups ?? [])
			for (const item of group.items) map.set(item.storeProductId, item);
		return map;
	}, [cart]);

	const addItem = useMutation({
		mutationFn: async (vars: { storeProductId: string; quantity: number }) => {
			const res = await api().customer.cart.items.post(vars);
			return unwrap(res, m.error_generic()).data;
		},
		onSuccess: () => {
			void invalidate();
			toast.success(m.cart_item_added());
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const setQuantity = useMutation({
		mutationFn: async (vars: { cartItemId: string; quantity: number }) => {
			const res = await api()
				.customer.cart.items({ id: vars.cartItemId })
				.patch({ quantity: vars.quantity });
			return unwrap(res, m.error_generic()).data;
		},
		onSuccess: () => void invalidate(),
		onError: (e: Error) => toast.error(e.message),
	});

	const removeItem = useMutation({
		mutationFn: async (cartItemId: string) => {
			const res = await api().customer.cart.items({ id: cartItemId }).delete();
			unwrap(res, m.error_generic());
		},
		onSuccess: () => void invalidate(),
		onError: (e: Error) => toast.error(e.message),
	});

	return {
		cart,
		isPending: cartQuery.isPending,
		isError: cartQuery.isError,
		refetch: cartQuery.refetch,
		linesByStoreProductId,
		addItem,
		setQuantity,
		removeItem,
	};
}
```

- [ ] **Step 3: Scrivi `add-to-cart.tsx`**

Crea `apps/customer/src/features/cart/add-to-cart.tsx`:

```tsx
import { Button } from "@bibs/ui/components/button";
import { Minus, Plus, Trash2 } from "lucide-react";
import { m } from "@/paraglide/messages";
import { useCart } from "./use-cart";

/** Stesso tetto per riga del DB (cart_item_quantity_range). */
const MAX_QUANTITY = 99;

interface AddToCartProps {
	storeProductId: string;
	stock: number;
	/** Serve solo alle etichette accessibili: i controlli sono icone. */
	productName: string;
}

/**
 * "Aggiungi" finché il prodotto non è nel carrello, poi stepper −/+.
 * La quantità mostrata viene sempre dalla query `["cart"]`: niente stato locale
 * da risincronizzare. A quantità 1 il "−" diventa un cestino, così togliere una
 * riga non richiede di andare in pagina carrello.
 */
export function AddToCart({
	storeProductId,
	stock,
	productName,
}: AddToCartProps) {
	const { linesByStoreProductId, addItem, setQuantity, removeItem } = useCart();
	const line = linesByStoreProductId.get(storeProductId);
	const busy =
		addItem.isPending || setQuantity.isPending || removeItem.isPending;

	if (stock === 0)
		return (
			<Button variant="secondary" size="sm" className="w-full" disabled>
				{m.cart_out_of_stock()}
			</Button>
		);

	if (!line)
		return (
			<Button
				size="sm"
				className="w-full"
				disabled={busy}
				aria-label={m.cart_add_aria({ product: productName })}
				onClick={() => addItem.mutate({ storeProductId, quantity: 1 })}
			>
				{m.cart_add()}
			</Button>
		);

	const atCeiling = line.quantity >= Math.min(stock, MAX_QUANTITY);
	const isLast = line.quantity === 1;

	return (
		<div className="flex items-center justify-between gap-1 rounded-md border border-border p-1">
			<Button
				variant="ghost"
				size="icon"
				className="size-8"
				disabled={busy}
				aria-label={
					isLast
						? m.cart_remove_aria({ product: productName })
						: m.cart_decrease_aria({ product: productName })
				}
				onClick={() =>
					isLast
						? removeItem.mutate(line.id)
						: setQuantity.mutate({
								cartItemId: line.id,
								quantity: line.quantity - 1,
							})
				}
			>
				{isLast ? (
					<Trash2 className="size-4" aria-hidden />
				) : (
					<Minus className="size-4" aria-hidden />
				)}
			</Button>
			<span className="min-w-6 text-center font-medium text-sm tabular-nums">
				{line.quantity}
			</span>
			<Button
				variant="ghost"
				size="icon"
				className="size-8"
				disabled={busy || atCeiling}
				aria-label={m.cart_increase_aria({ product: productName })}
				onClick={() =>
					setQuantity.mutate({
						cartItemId: line.id,
						quantity: line.quantity + 1,
					})
				}
			>
				<Plus className="size-4" aria-hidden />
			</Button>
		</div>
	);
}
```

- [ ] **Step 4: Dai alla tile uno slot azione**

In `apps/customer/src/features/catalog/product-tile.tsx`, aggiungi `import type { ReactNode } from "react";`, estendi le props e rendi lo slot:

```tsx
interface ProductTileProps {
	product: ProductCardData;
	/** Mostra la pill della distanza (solo quando c'è una posizione). */
	showDistance: boolean;
	/**
	 * Azione opzionale sotto il prezzo. La discovery non la passa: lì il negozio
	 * non è ancora scelto e "aggiungi" sarebbe ambiguo (lo stesso prodotto può
	 * stare in più botteghe).
	 */
	action?: ReactNode;
}
```

e, subito dopo `<DiscountedPrice … />`, dentro lo stesso `<div className="flex flex-col gap-1">`:

```tsx
				{action ? <div className="mt-2">{action}</div> : null}
```

Aggiorna la firma: `export function ProductTile({ product, showDistance, action }: ProductTileProps)`. **Non** cambiare `ProductCardData`: la discovery la condivide e non ha quei campi.

- [ ] **Step 5: Propaga i due campi nuovi nel catalogo negozio**

In `apps/customer/src/features/stores/use-store-products.ts`, aggiungi il tipo e arricchisci il map:

```ts
/** La tile del catalogo negozio sa anche cosa ordinare e quanto ce n'è. */
export interface StoreProductCardData extends ProductCardData {
	storeProductId: string;
	stock: number;
}
```

```ts
	const products: StoreProductCardData[] =
		query.data?.pages.flatMap((p) =>
			p.data.map((prod) => ({
				id: prod.id,
				storeProductId: prod.storeProductId,
				stock: prod.stock,
				name: prod.name,
				price: prod.price,
				images: prod.images.map((img) => ({ url: img.url })),
				discountedPrice: prod.discountedPrice,
				discountPercent: prod.discountPercent,
			})),
		) ?? [];
```

- [ ] **Step 6: Monta il pulsante nel catalogo**

In `apps/customer/src/features/stores/store-products.tsx`, aggiungi `import { AddToCart } from "@/features/cart/add-to-cart";` e passa l'azione:

```tsx
						{products.map((product) => (
							<li key={product.id}>
								<ProductTile
									product={product}
									showDistance={false}
									action={
										<AddToCart
											storeProductId={product.storeProductId}
											stock={product.stock}
											productName={product.name}
										/>
									}
								/>
							</li>
						))}
```

- [ ] **Step 7: Compila e verifica i tipi**

```bash
cd apps/customer && bun run paraglide:compile && bun run typecheck && bun run build
```

Atteso: PASS. Se `api().customer.cart` non esiste come proprietà, l'API non è stata ricostruita: i tipi Eden vengono da `@bibs/api`, quindi il Task 6 dev'essere committato e `bun install` coerente.

- [ ] **Step 8: Commit**

```bash
git add apps/customer/src/features/cart \
        apps/customer/src/features/catalog/product-tile.tsx \
        apps/customer/src/features/stores/use-store-products.ts \
        apps/customer/src/features/stores/store-products.tsx \
        apps/customer/messages
git commit -m "$(cat <<'EOF'
feat(customer): add products to the cart from a store catalog

One TanStack query feeds the button and the stepper, so the quantity on
screen is always the server's. The tile keeps an optional action slot
instead of learning about carts: discovery passes none, because there the
store is not chosen yet.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Frontend — pagina `/cart` e badge in header

**Files:**
- Create: `apps/customer/src/features/cart/cart-badge.tsx`
- Create: `apps/customer/src/routes/_authenticated/cart.tsx`
- Modify: `apps/customer/src/components/site-header.tsx`
- Modify: `apps/customer/src/routeTree.gen.ts` (rigenerato, **da committare**)
- Modify: `apps/customer/messages/{it,en}.json`

**Interfaces:**
- Consumes: `useCart()`, `CartGroup`, `CartLine`, `<AddToCart>` (Task 8); `Notice` / `NoticePage` da `@/components/notice`.

- [ ] **Step 1: Aggiungi le chiavi di traduzione**

In `apps/customer/messages/it.json`:

```json
	"nav_cart": "Carrello",
	"cart_badge_aria": "Carrello, {count} articoli",
	"cart_title": "Il tuo carrello",
	"cart_empty_title": "Il carrello è vuoto",
	"cart_empty_description": "Sfoglia i negozi del tuo quartiere e aggiungi i prodotti che ti servono.",
	"cart_empty_cta": "Scopri i negozi",
	"cart_error_title": "Carrello non disponibile",
	"cart_error_description": "Non siamo riusciti a caricare il carrello. Riprova fra un momento.",
	"cart_retry": "Riprova",
	"cart_subtotal": "Subtotale",
	"cart_total": "Totale",
	"cart_remove": "Rimuovi",
	"cart_only_left": "Ne restano solo {count}",
	"cart_unavailable": "Non più disponibile",
	"cart_unavailable_description": "Questo prodotto non è più acquistabile e non è conteggiato nel totale."
```

In `apps/customer/messages/en.json`:

```json
	"nav_cart": "Cart",
	"cart_badge_aria": "Cart, {count} items",
	"cart_title": "Your cart",
	"cart_empty_title": "Your cart is empty",
	"cart_empty_description": "Browse the shops in your neighbourhood and add what you need.",
	"cart_empty_cta": "Discover shops",
	"cart_error_title": "Cart unavailable",
	"cart_error_description": "We couldn't load your cart. Try again in a moment.",
	"cart_retry": "Retry",
	"cart_subtotal": "Subtotal",
	"cart_total": "Total",
	"cart_remove": "Remove",
	"cart_only_left": "Only {count} left",
	"cart_unavailable": "No longer available",
	"cart_unavailable_description": "This product can no longer be bought and is not counted in the total."
```

- [ ] **Step 2: Scrivi il badge**

Crea `apps/customer/src/features/cart/cart-badge.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import { ShoppingBag } from "lucide-react";
import { m } from "@/paraglide/messages";
import { useCart } from "./use-cart";

/**
 * Contatore nella top app bar. Legge `itemCount` dalla stessa query `["cart"]`
 * che alimenta pagina e stepper: nessun endpoint né fetch dedicato.
 *
 * Borsa e non carrello della spesa: il registro del brand è la bottega, non il
 * supermercato (vedi le anti-reference in PRODUCT.md).
 */
export function CartBadge() {
	const { cart } = useCart();
	const count = cart?.itemCount ?? 0;

	return (
		<Link
			to="/cart"
			aria-label={m.cart_badge_aria({ count })}
			className="relative rounded-md p-2 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-saffron focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[status=active]:text-foreground"
		>
			<ShoppingBag className="size-5" aria-hidden />
			{count > 0 && (
				<span className="-top-0.5 -right-0.5 absolute flex min-w-4.5 items-center justify-center rounded-full bg-saffron px-1 font-semibold text-[0.6875rem] text-ink tabular-nums">
					{count}
				</span>
			)}
		</Link>
	);
}
```

- [ ] **Step 3: Montalo nell'header**

In `apps/customer/src/components/site-header.tsx`, importa `CartBadge` e mettilo fra il link "Negozi" e `<UserMenu />`:

```tsx
				<nav className="ml-auto mr-2 flex items-center gap-1">
					<Link
						to="/stores"
						search={{ q: undefined, categoryId: undefined }}
						className="rounded-md px-3 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground data-[status=active]:text-foreground"
					>
						{m.nav_stores()}
					</Link>
					<CartBadge />
				</nav>
```

(`m.nav_stores()` arriva dal Task 7; se quel task ha usato un'altra chiave, usa quella.)

- [ ] **Step 4: Scrivi la pagina**

Crea `apps/customer/src/routes/_authenticated/cart.tsx`:

```tsx
import { Button } from "@bibs/ui/components/button";
import { DiscountedPrice } from "@bibs/ui/components/discounted-price";
import { formatPriceEur } from "@bibs/ui/components/price";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ShoppingBag, TriangleAlert } from "lucide-react";
import { Notice, NoticePage } from "@/components/notice";
import { TileImage } from "@/components/tile";
import { AddToCart } from "@/features/cart/add-to-cart";
import type { CartGroup, CartLine } from "@/features/cart/use-cart";
import { useCart } from "@/features/cart/use-cart";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/cart")({
	component: CartPage,
});

function CartPage() {
	const { cart, isPending, isError, refetch } = useCart();

	if (isPending)
		return (
			<div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8 sm:px-6">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-28 w-full" />
				<Skeleton className="h-28 w-full" />
			</div>
		);

	if (isError)
		return (
			<NoticePage
				icon={TriangleAlert}
				title={m.cart_error_title()}
				description={m.cart_error_description()}
				action={
					<Button variant="secondary" onClick={() => refetch()}>
						{m.cart_retry()}
					</Button>
				}
			/>
		);

	if (!cart || cart.groups.length === 0)
		return (
			<NoticePage
				icon={ShoppingBag}
				title={m.cart_empty_title()}
				description={m.cart_empty_description()}
				action={
					<Button asChild>
						<Link to="/stores" search={{ q: undefined, categoryId: undefined }}>
							{m.cart_empty_cta()}
						</Link>
					</Button>
				}
			/>
		);

	return (
		<div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 sm:px-6">
			<h1 className="font-display font-semibold text-2xl text-foreground">
				{m.cart_title()}
			</h1>

			{cart.groups.map((group) => (
				<StoreSection key={group.store.id} group={group} />
			))}

			{/* Nessun CTA di checkout: non esiste ancora una pagina dove mandarlo, e
			    un bottone disabilitato sarebbe un controllo morto. */}
			<div className="flex items-baseline justify-between border-border border-t pt-4">
				<span className="font-medium text-foreground">{m.cart_total()}</span>
				<span className="font-display font-semibold text-foreground text-xl tabular-nums">
					{formatPriceEur(cart.total)}
				</span>
			</div>
		</div>
	);
}

/** Un negozio e le sue righe. L'identità del negozio apre la sezione: è la
 *  regola del prodotto, non un dettaglio grafico. */
function StoreSection({ group }: { group: CartGroup }) {
	return (
		<section className="space-y-3">
			<div className="flex items-baseline justify-between gap-3">
				<Link
					to="/stores/$storeId"
					params={{ storeId: group.store.id }}
					className="font-display font-semibold text-foreground text-lg hover:underline"
				>
					{group.store.name}
				</Link>
				<span className="text-muted-foreground text-sm">
					{group.store.municipality.name} (
					{group.store.municipality.provinceAcronym})
				</span>
			</div>

			<ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
				{group.items.map((item) => (
					<li key={item.id}>
						<CartRow item={item} />
					</li>
				))}
			</ul>

			<div className="flex items-baseline justify-between px-1">
				<span className="text-muted-foreground text-sm">
					{m.cart_subtotal()}
				</span>
				<span className="font-medium text-foreground tabular-nums">
					{formatPriceEur(group.subtotal)}
				</span>
			</div>
		</section>
	);
}

function CartRow({ item }: { item: CartLine }) {
	const { removeItem } = useCart();
	const unavailable = item.issue === "unavailable";

	return (
		<div className="flex gap-3 p-3">
			<div className="size-20 shrink-0 overflow-hidden rounded-lg border border-border">
				<TileImage url={item.product.imageUrl} name={item.product.name} />
			</div>

			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<h2 className="line-clamp-2 font-medium text-foreground text-sm leading-snug">
					{item.product.name}
				</h2>

				<DiscountedPrice
					size="sm"
					className="tabular-nums"
					originalPrice={item.unitPrice}
					discountedPrice={item.discountedPrice}
					percent={item.discountPercent}
				/>

				{item.issue === "insufficient_stock" && (
					<p className="text-destructive text-xs">
						{m.cart_only_left({ count: item.availableStock })}
					</p>
				)}
				{unavailable && (
					<p className="text-muted-foreground text-xs">
						{m.cart_unavailable_description()}
					</p>
				)}

				<div className="flex items-end justify-between gap-3 pt-1">
					{unavailable ? (
						// Niente stepper su una riga che non si può comprare: l'unica
						// azione sensata è toglierla.
						<Button
							variant="secondary"
							size="sm"
							onClick={() => removeItem.mutate(item.id)}
							disabled={removeItem.isPending}
						>
							{m.cart_remove()}
						</Button>
					) : (
						<div className="w-32">
							<AddToCart
								storeProductId={item.storeProductId}
								stock={item.availableStock}
								productName={item.product.name}
							/>
						</div>
					)}

					<span
						className={`font-medium tabular-nums ${unavailable ? "text-muted-foreground line-through" : "text-foreground"}`}
					>
						{formatPriceEur(item.lineTotal)}
					</span>
				</div>
			</div>
		</div>
	);
}
```

Nota: la pagina riusa `<AddToCart>` invece di reinventare uno stepper. Il carrello passa `availableStock` come `stock`, quindi il `+` si ferma da solo sulle righe con disponibilità calata. Gli stati vuoto/errore usano `Notice`/`NoticePage` del customer, non `EmptyState` di `@bibs/ui`: quest'ultimo ha l'accent cobalt, che è il register di seller e admin.

- [ ] **Step 5: Rigenera l'albero delle route e compila**

```bash
cd apps/customer && bun run paraglide:compile && bun run build && bun run typecheck
```

Il `build` rigenera `src/routeTree.gen.ts`. **Verifica che il file sia cambiato** e che contenga la route del carrello:

```bash
git diff --stat apps/customer/src/routeTree.gen.ts && grep -c "_authenticated/cart" apps/customer/src/routeTree.gen.ts
```

Atteso: il file compare nel diff e il grep trova almeno un'occorrenza. Se non è cambiato, il build non è stato eseguito: `tsc` da solo non lo rigenera, e committare senza dà CI rossa con locale verde.

- [ ] **Step 6: Commit**

```bash
git add apps/customer/src/features/cart/cart-badge.tsx \
        apps/customer/src/routes/_authenticated/cart.tsx \
        apps/customer/src/routeTree.gen.ts \
        apps/customer/src/components/site-header.tsx \
        apps/customer/messages
git commit -m "$(cat <<'EOF'
feat(customer): add the cart page and header badge

Sections are led by the shop's name and comune, so the cart reads as "what
you are picking up, and from whom" rather than a flat list. Rows reuse the
catalog's stepper; unavailable ones keep only a remove action and stay out
of the totals.

No checkout call to action: there is nowhere to send it yet, and a disabled
button would be a dead control.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Verifica end-to-end e documentazione

Il typecheck non verifica l'UI. Questo task è il gate prima della PR.

**Files:**
- Modify: `apps/customer/README.md:6-9`

- [ ] **Step 1: Verifica l'intero monorepo**

```bash
cd /Users/marcogelli/repos/jelaz/bibs
bun run typecheck && bun run lint && bun run test
```

Atteso: PASS su tutti e tre. `bun run --filter '*'` aggrega gli exit code: se l'output scorre via, ricontrolla `echo $?` prima di dichiarare verde.

- [ ] **Step 2: Prepara un database con dati veri**

```bash
bun run infra:up && bun run db:migrate && bun run db:seed
```

Se il seed protesta per schema sporco, `bun run db:reset` fa wipe + migrate + seed in un colpo — ma cancella il volume locale, quindi chiedi prima se ci sono dati che servono.

- [ ] **Step 3: Avvia API e customer**

```bash
bun run dev:api      # :3000
bun run dev:customer # :3001, in un'altra shell
```

- [ ] **Step 4: Smoke in browser**

Accedi su `http://localhost:3001` con `customer1@test.com` / `password123`, poi percorri, nell'ordine:

1. `/stores` → apri un negozio che ha prodotti a catalogo.
2. Sulla scheda, ogni tile del catalogo ha "Aggiungi". Cliccalo: compare il toast, il pulsante diventa uno stepper `− 1 +`, il badge in header passa a 1.
3. Premi `+` due volte → 3. Premi `−` fino a 1: il `−` diventa un cestino. Premilo: la riga sparisce, il badge torna a 0, il pulsante torna "Aggiungi".
4. Aggiungi due prodotti diversi dello **stesso** negozio, poi vai su un **altro** negozio e aggiungine uno.
5. Clicca il badge → `/cart`. Verifica: due sezioni, una per negozio, ognuna col nome del negozio e il comune; subtotale per sezione; totale in fondo; **nessun pulsante di checkout**.
6. Da `/cart` cambia una quantità con lo stepper e rimuovi una riga: i totali si aggiornano senza ricaricare la pagina.
7. Ricarica la pagina: il carrello è ancora lì (è sul server, non nel browser).
8. Prova il tetto dello stock: prendi un prodotto con poco stock e premi `+` finché il pulsante si disabilita. Non deve mai comparire un errore rosso — il `+` si ferma prima.
9. Passa al tema scuro (in console: `localStorage.theme = "dark"`, poi ricarica) e ricontrolla pagina carrello e badge: nessun testo invisibile.
10. Restringi la finestra a ~390px: le sezioni e le righe reggono, niente scroll orizzontale.

- [ ] **Step 5: Verifica il caso "riga diventata non disponibile"**

Con un prodotto nel carrello, mettilo fuori commercio da un'altra shell:

```bash
psql "$DATABASE_URL" -c "UPDATE products SET status='disabled' WHERE id = '<product-id>';"
```

Ricarica `/cart`: la riga mostra "Non più disponibile", ha solo "Rimuovi", il totale di riga è barrato e **non** è nel totale. Poi rimettila `active`.

- [ ] **Step 6: Aggiorna il README del customer**

In `apps/customer/README.md`, sostituisci il paragrafo "Implemented today" con:

```markdown
**Implemented today:** registration and the full password lifecycle (verify-email,
forgot/reset password), the user profile, store discovery and detail, the store
catalog, and the shopping cart. **Checkout is not built yet** — the order API
exists (see [apps/api](../api/README.md)), the UI doesn't.
```

- [ ] **Step 7: Commit**

```bash
git add apps/customer/README.md
git commit -m "$(cat <<'EOF'
docs(customer): record the cart as shipped and checkout as pending

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Apri la PR**

Usa `/commit-commands:commit-push-pr`, oppure a mano:

```bash
git push -u origin feat/customer-cart
gh pr create --title "feat(customer): shopping cart" --body-file /tmp/pr-body.md
```

Nel corpo della PR: link alla spec, l'elenco delle decisioni, e in evidenza il debito noto — **nessuno svuota il carrello dopo l'ordine, perché il checkout non esiste ancora; togliere le righe ordinate sarà parte di quella PR**. Chiudi con la riga di attribuzione:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## Fuori scope, da non fare in questa PR

Elencati perché durante l'esecuzione verrà la tentazione:

- **Checkout.** Nessuna chiamata a `POST /customer/orders`, nessun CTA che ci porti.
- **Aggiungi al carrello da ricerca o discovery.** La ricerca è per prodotto e deduplica fra negozi: servirebbe prima risolvere l'ambiguità multi-negozio.
- **Pagina di dettaglio prodotto.** Resta nel backlog; `ProductTile` continua a non essere un link.
- **`DELETE /customer/cart`** (svuota tutto) e il "rimuovi tutto il gruppo".
- **Riservare stock.** Il carrello è intento; il decremento resta in `createOrder`.
