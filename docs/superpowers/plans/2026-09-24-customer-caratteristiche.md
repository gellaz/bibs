# Scheda prodotto customer con le caratteristiche — piano di implementazione (PR 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il cliente apre la scheda di un prodotto dal tile, vede prezzo, foto, descrizione, il negozio da cui comprarlo e la tabella *Caratteristiche* con le sole voci valorizzate, formattate all'italiana, senza che un testo simile a una data venga mai trasformato in un `Date`.

**Architecture:** Lato API, una funzione pura in `lib/characteristic-values.ts` (TDD) decide cosa il cliente vede di un valore salvato: l'etichetta dell'opzione per le liste chiuse, `null` se non c'è nulla da mostrare. Un service customer legge i valori nell'ordine della matrice, e un secondo service compone la scheda: il prodotto, un solo negozio agganciato (quello da cui arrivi se ce l'ha, se no il più vicino, se no il primo per nome) e le caratteristiche, sotto `GET /customer/products/:id`. Lato customer, un client Eden `apiNoDates` (`parseDate: false`) legge la scheda, un formattatore puro produce le righe, e la route `/products/$productId?store=<id>` le mostra; i tile diventano link alla scheda.

**Tech Stack:** Bun, Elysia, Drizzle ORM, PostgreSQL 18 + PostGIS, TypeBox, `bun:test` con testcontainers; customer in TanStack Start + TanStack Router + TanStack Query, Paraglide, `@bibs/ui` (Radix v1), Eden Treaty.

**Spec:** [`docs/superpowers/specs/2026-09-22-caratteristiche-prodotto-design.md`](../specs/2026-09-22-caratteristiche-prodotto-design.md): il paragrafo «Scheda prodotto customer» di «Seller e scheda prodotto», e «Esplicitamente fuori ambito». Questo piano copre la **PR 5**, l'ultima delle cinque. PR 1 in `43c35da`, PR 2 in `10fe3bf`, PR 3 in `8ff171d`, PR 4 in `0f5c55c`. Modello di forma: [`2026-09-23-seller-caratteristiche.md`](2026-09-23-seller-caratteristiche.md).

## Decisioni prese per questa PR

Da non rimettere in discussione durante l'esecuzione.

| # | Decisione | Motivo |
|---|---|---|
| C1 | **La PR crea anche la scheda prodotto customer**, in forma minima: foto, nome, marca, categoria, prezzo e sconto, negozio agganciato con *Aggiungi al carrello*, descrizione, *Caratteristiche*. Niente recensioni, prodotti correlati, zoom, condivisione | Scelta di Marco (2026-09-24). La spec dava la scheda per esistente; `product-tile.tsx` dice il contrario («non esiste ancora una pagina di dettaglio prodotto») |
| C2 | **URL `/products/$productId?store=<id>`**. Il negozio agganciato è quello di `store` se lo ha disponibile, altrimenti il più vicino all'origine di ricerca, altrimenti il primo per nome: **la stessa regola del laterale di `searchProducts`**, con in più la preferenza per il negozio richiesto | Scelta di Marco (2026-09-24). Il prezzo sta sul prodotto, la giacenza sul negozio: senza un negozio la pagina non vende. Come in `/products`, **mai coordinate nell'URL**: l'origine arriva da `useSearchOrigin()` |
| C3 | **Il negozio richiesto non ce l'ha più** (esaurito, nascosto, mai avuto): la scheda aggancia un altro negozio e lo dice, con `requestedStoreUnavailable: true` | Chi arriva dal catalogo del negozio X e si vede proporre Y senza spiegazioni pensa a un errore |
| C4 | **404 se il prodotto non è `active` o nessun negozio visibile lo ha con giacenza > 0** | È lo stesso insieme che ricerca e catalogo negozio mostrano: una scheda raggiungibile solo da un link vecchio non deve vendere un prodotto che la ricerca nasconde |
| C5 | **Le caratteristiche viaggiano tipizzate** (`value` testo, numero o booleano; per le liste chiuse l'**etichetta** dell'opzione, mai l'id) con `dataType` e `unit`. La formattazione (virgola decimale, unità, «Sì» / «No») avviene nel customer | La formattazione è copy dell'interfaccia e passa da Paraglide; l'API resta riusabile dai filtri futuri |
| C6 | **Lettura nell'ordine della matrice** con una `INNER JOIN` sulla matrice della sotto-categoria corrente del prodotto: `sortOrder`, poi nome. Un valore fuori matrice (che D10 vieta) **non esce** | Il join serve comunque per l'ordine; filtrare un valore dormiente è gratis e la scheda non deve mostrarlo |
| C7 | **Nessuna ipotesi sulle obbligatorie.** Un'obbligatoria non compilata semplicemente non compare. Nessun codice legge `required` in questa PR | I prodotti nati prima che un'obbligatoria venisse accesa possono non averla (P1 della PR 4) |
| C8 | **La trappola di Eden si chiude con un client `apiNoDates`** (`parseDate: false`) in `apps/customer/src/lib/api.ts`, come nel seller, **e** con un test del customer che fa passare «05/03/2027» dal client vero e dimostra che resta una stringa, affiancato dal test di contrasto sul client di default (che lo trasforma in `Date`). Il formattatore scarta comunque un `Date` invece di mostrarlo | La perdita è irreversibile: serve una prova che fallisce se qualcuno rimette `api()` nel fetch, non un commento |
| C9 | **Il tile resta un tile**: diventano link l'immagine e il nome, non l'intero riquadro. Il nome del negozio e *Aggiungi* restano controlli separati | Un'area cliccabile che contiene altri controlli (link al negozio, stepper del carrello) crea click ambigui e annidamenti non validi |

## Global Constraints

- **Nessun commit diretto su `main`.** Branch `feat/product-characteristics-customer`, già creato da `main` a `bf6f261`.
- **Conventional Commits** con scope dalla lista del repo: qui `api`, `customer`, `products`. Descrizione minuscola, imperativa, **prima riga sotto i 72 caratteri: misurala**.
- **Ogni commit chiude con** `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Mai `--no-verify`**. Mai `bun run db:reset`, `db:push`, `db:seed` o `infra:reset` senza conferma esplicita di Marco.
- **Nessuna modifica allo schema del database**: `bun run db:generate` deve rispondere «No schema changes» alla fine di ogni task.
- **Biome**: rientri a tabulazione, virgolette doppie, file in kebab-case.
- **`ServiceError` accetta solo `(status, message)`.** Prodotto non visibile → `404` «Prodotto non trovato».
- **Copy in italiano** su ogni superficie, in ogni `ServiceError` nuovo e in ogni `description` OpenAPI. **Nomi dei test in inglese.** Nel customer la copy passa da Paraglide: chiavi nuove in **entrambi** `apps/customer/messages/it.json` e `en.json`, prefisso `product_detail_`.
- **Il seller non importa dal customer né viceversa**, per le caratteristiche. Ciò che è condiviso sta in `apps/api/src/lib/`. (L'import già esistente di `discount-pricing` dal seller nei service customer non si tocca.)
- **Logica di dominio pura** in `apps/api/src/lib/characteristic-values.ts`: nessun import di `db`, solo `import type` dallo schema. Test unitari in `apps/api/tests/lib/`, scritti **prima**.
- **Ordine delle caratteristiche**: `sortOrder` della matrice crescente, poi **nome** crescente.
- **Nessun campo `Date` nel DTO della scheda**: niente `createdAt`, `endsAt`, `discountTitle`. Ogni stringa del DTO passa comunque da `apiNoDates`.
- **Numeri**: `Intl.NumberFormat("it-IT", { maximumFractionDigits: 4 })`. In Bun e in Chrome dà `1234,5`, `6500` (nessun separatore sotto le cinque cifre) e `12.345.678,1234`. Fra numero e unità uno **spazio non separabile** (` `); per `%` nessuno spazio (`55%`).
- **DESIGN.md**: token theme-aware (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`) per le superfici; **saffron solo come accento** (al massimo l'icona del negozio, come `text-saffron-deep` in `QuickFacts`), mai su superfici, testo lungo o focus ring. Satoshi (`font-display`) solo per il nome del prodotto; prezzi in Geist con `tabular-nums`. Niente card dentro card. Corpo del testo entro `max-w-[65ch]`.
- **Radix v1**: si stila con `data-[state=…]:`, mai `data-open:` / `data-checked:`.
- **Toast** da `@bibs/ui/components/sonner`, mai da `sonner` diretto.
- **Route nuova** `apps/customer/src/routes/_authenticated/products/$productId.tsx` → **`apps/customer/src/routeTree.gen.ts` va rigenerato e committato** (lo rigenera `bun run --cwd apps/customer build` o il dev server, non `tsc`).
- **SSR**: niente librerie DOM-only nella route; niente `window` durante il render.
- **Test negativi sui service**: `await expect(fn()).rejects.toMatchObject({ status: 404 })`.
- **Suite completa API**: sempre `bun run --cwd apps/api test`, mai `cd apps/api && bun test` nudo (salta `--isolate` e fa fallire apposta `tests/integration/isolation-guard-2.test.ts`: un rosso lì indica l'invocazione sbagliata, non una regressione). Baseline dopo la PR 4: **592 d'integrazione, 303 unitari**.
- **Singolo file di test API**: `cd apps/api && bun test <percorso>`. **Test customer**: `cd apps/customer && bun test <percorso>`.
- **Se Docker è appena ripartito**, il primo giro parallelo può andare in timeout mentre costruisce l'immagine PostGIS: rilanciare prima di diagnosticare.
- **I subagenti su questo repo sono lenti, non bloccati**: la suite completa gira per minuti. Controllare `git status` e aspettare, non ridispacciare.
- **Typecheck workspace per workspace**, mai l'aggregato come prova: `bun run --cwd apps/api typecheck`, `bun run --cwd apps/customer typecheck`, `bun run --cwd apps/seller typecheck`, `bun run --cwd apps/admin typecheck`, controllando `$?` di ciascuno. Le rotte API cambiano i tipi Eden di tutti e tre i frontend.
- **Collaudi nel browser** (customer `customer1@test.com` / `password123` su `localhost:3001`, API su `localhost:3000`): **sul customer si legge soltanto**. L'unica scrittura ammessa è il prodotto di prova `Collaudo PR5 date` del Task 7, creato e poi cancellato dal seller (`seller@dev.bibs` / `password123`, `localhost:3002`), con conteggi del database prima e dopo. Le dimensioni si misurano con `getBoundingClientRect`, non descrivendo lo screenshot.
- psql: `docker exec -i bibs-postgis psql -U pgadmin -d bibs-db`: il `-i` è obbligatorio.

## Review Focus

Condizioni che la spec implica ma che nessun caso felice esercita, le più probabili per prime. Ciascuna ha il suo test nel task indicato.

1. **Un sì/no a `false` è un valore, non un vuoto.** Un controllo di «valorizzato» scritto come `if (value)` fa sparire ogni «No» → test «keeps a boolean false» (Task 1), «shows No for false» (Task 4).
2. **Un testo che sembra una data** («05/03/2027», «05-03-2027») arriva in pagina identico → test del client in Task 4, collaudo in Task 7.
3. **Il negozio richiesto non ha più il prodotto** (esaurito, abbonamento scaduto) → la scheda non va in 404 se un altro negozio ce l'ha, e lo dice → test «falls back when the requested store is out of stock / hidden» (Task 3).
4. **Un'obbligatoria mai compilata** su un prodotto vecchio → la scheda si apre, la voce manca, nessun errore → test «does not require required characteristics» (Task 2).
5. **Un numero intero salvato come `numeric(14,4)`** arriva dal database come `"12.0000"` → la scheda mostra `12`, non `12,0000` → test «drops the trailing zeros of numeric» (Task 1) e «formats integers without decimals» (Task 4).

---

## Struttura dei file

| File | Responsabilità |
|---|---|
| `apps/api/src/lib/characteristic-values.ts` | aggiunge `toCharacteristicDisplayValue` |
| `apps/api/tests/lib/characteristic-values.test.ts` | test unitari della funzione nuova |
| `apps/api/src/modules/customer/services/product-characteristics.ts` | **nuovo**: `listCustomerCharacteristics` |
| `apps/api/tests/integration/customer-product-characteristics.test.ts` | **nuovo** |
| `apps/api/src/modules/customer/services/product-detail.ts` | **nuovo**: `getProductDetail` |
| `apps/api/src/lib/queries.ts` | `ProductDetailQuery` |
| `apps/api/src/lib/schemas/entities.ts` | `CustomerProductCharacteristicSchema`, `CustomerProductDetailSchema` |
| `apps/api/src/modules/customer/routes/products.ts` | `GET /products/:id` |
| `apps/api/tests/integration/customer-product-detail.test.ts` | **nuovo** |
| `apps/customer/src/lib/api.ts` | `apiNoDates` |
| `apps/customer/src/features/products/product-detail-api.ts` | **nuovo**: tipi della vista, `fetchProductDetail` |
| `apps/customer/src/features/products/product-detail-api.test.ts` | **nuovo**: la prova della trappola di Eden |
| `apps/customer/src/features/products/format-characteristic.ts` | **nuovo**: formattatore puro |
| `apps/customer/src/features/products/format-characteristic.test.ts` | **nuovo** |
| `apps/customer/src/features/products/use-product-detail.ts` | **nuovo**: la query |
| `apps/customer/src/features/products/product-characteristics.tsx` | **nuovo**: la tabella |
| `apps/customer/src/features/products/product-gallery.tsx` | **nuovo**: foto principale e miniature |
| `apps/customer/src/features/products/product-offer.tsx` | **nuovo**: negozio agganciato e carrello |
| `apps/customer/src/routes/_authenticated/products/$productId.tsx` | **nuovo**: la scheda |
| `apps/customer/src/routeTree.gen.ts` | rigenerato |
| `apps/customer/messages/it.json`, `en.json` | chiavi `product_detail_*` |
| `apps/customer/src/features/catalog/product-tile.tsx` | immagine e nome diventano link |
| `apps/customer/src/features/stores/store-products.tsx` | passa `storeId` al tile |

Fuori da questa PR, come da spec: filtri e facet customer sulle caratteristiche, caratteristiche nel caricamento massivo CSV. E, per C1: recensioni, prodotti correlati, elenco di tutti i negozi che hanno il prodotto.

---

### Task 1: Il valore come lo vede il cliente (TDD)

**Files:**
- Modify: `apps/api/src/lib/characteristic-values.ts` (in coda, dopo `toCharacteristicOutputValue`)
- Test: `apps/api/tests/lib/characteristic-values.test.ts` (in coda)

**Interfaces:**
- Consumes: `StoredCharacteristicValue` (già esportato: `{ dataType, valueText, valueNumber, valueBoolean, optionId }`, `valueNumber` è la stringa di `numeric`).
- Produces: `toCharacteristicDisplayValue(stored: StoredCharacteristicValue, optionValue: string | null): string | number | boolean | null`. `null` significa «nessuna riga».

Non riusa `toCharacteristicOutputValue` di proposito: quella restituisce l'**id** dell'opzione (il seller rimanda quello), e per un numero assente farebbe `Number(null)`, cioè `0`: una riga «0 g» inventata.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere `toCharacteristicDisplayValue` all'import esistente da `@/lib/characteristic-values` in cima al file, poi in coda:

```ts
describe("toCharacteristicDisplayValue", () => {
	const empty = {
		valueText: null,
		valueNumber: null,
		valueBoolean: null,
		optionId: null,
	};

	it("returns the option label for an enum, not the option id", () => {
		expect(
			toCharacteristicDisplayValue(
				{ ...empty, dataType: "enum", optionId: "opt-1" },
				"Nero",
			),
		).toBe("Nero");
	});

	it("returns null for an enum whose label is missing", () => {
		expect(
			toCharacteristicDisplayValue(
				{ ...empty, dataType: "enum", optionId: "opt-1" },
				null,
			),
		).toBeNull();
	});

	it("returns the text unchanged, date-like included", () => {
		expect(
			toCharacteristicDisplayValue(
				{ ...empty, dataType: "text", valueText: "05/03/2027" },
				null,
			),
		).toBe("05/03/2027");
	});

	it("returns null for a blank text", () => {
		expect(
			toCharacteristicDisplayValue(
				{ ...empty, dataType: "text", valueText: "   " },
				null,
			),
		).toBeNull();
	});

	it("drops the trailing zeros of numeric", () => {
		expect(
			toCharacteristicDisplayValue(
				{ ...empty, dataType: "number", valueNumber: "12.0000" },
				null,
			),
		).toBe(12);
		expect(
			toCharacteristicDisplayValue(
				{ ...empty, dataType: "number", valueNumber: "6.1000" },
				null,
			),
		).toBe(6.1);
	});

	it("returns null for a missing number instead of zero", () => {
		expect(
			toCharacteristicDisplayValue({ ...empty, dataType: "number" }, null),
		).toBeNull();
	});

	it("keeps a boolean false", () => {
		expect(
			toCharacteristicDisplayValue(
				{ ...empty, dataType: "boolean", valueBoolean: false },
				null,
			),
		).toBe(false);
		expect(
			toCharacteristicDisplayValue(
				{ ...empty, dataType: "boolean", valueBoolean: true },
				null,
			),
		).toBe(true);
	});

	it("returns null for a missing boolean", () => {
		expect(
			toCharacteristicDisplayValue({ ...empty, dataType: "boolean" }, null),
		).toBeNull();
	});
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `cd apps/api && bun test tests/lib/characteristic-values.test.ts`
Expected: FAIL, `toCharacteristicDisplayValue` non è esportata (errore di import o `is not a function`).

- [ ] **Step 3: Implementare**

In coda a `apps/api/src/lib/characteristic-values.ts`:

```ts
/**
 * Il valore come lo legge il cliente sulla scheda prodotto. A differenza di
 * toCharacteristicOutputValue (il seller rimanda l'id), una lista chiusa
 * diventa l'etichetta dell'opzione. `null` vuol dire «niente da mostrare»: la
 * riga non esce. Un `false` invece è un valore («No»), non un vuoto.
 */
export function toCharacteristicDisplayValue(
	stored: StoredCharacteristicValue,
	optionValue: string | null,
): string | number | boolean | null {
	switch (stored.dataType) {
		case "enum":
			return optionValue?.trim() ? optionValue : null;
		case "text":
			return stored.valueText?.trim() ? stored.valueText : null;
		case "number": {
			// Number(null) è 0: senza questo controllo un numero assente
			// diventerebbe una riga «0 g».
			if (stored.valueNumber === null) return null;
			const n = Number(stored.valueNumber);
			return Number.isFinite(n) ? n : null;
		}
		case "boolean":
			return stored.valueBoolean;
	}
}
```

- [ ] **Step 4: Verificare che passino**

Run: `cd apps/api && bun test tests/lib/characteristic-values.test.ts`
Expected: PASS, 8 test nuovi più quelli esistenti.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/characteristic-values.ts apps/api/tests/lib/characteristic-values.test.ts
git commit -m "feat(products): valore di una caratteristica come lo vede il cliente" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Lettura customer dei valori di un prodotto

**Files:**
- Create: `apps/api/src/modules/customer/services/product-characteristics.ts`
- Test: `apps/api/tests/integration/customer-product-characteristics.test.ts`

**Interfaces:**
- Consumes: `toCharacteristicDisplayValue` (Task 1); `CharacteristicDataType` da `@/db/schemas/product-characteristic`.
- Produces:

```ts
export interface CustomerCharacteristic {
	characteristicId: string;
	name: string;
	dataType: CharacteristicDataType;
	unit: string | null;
	value: string | number | boolean;
}
export async function listCustomerCharacteristics(
	productId: string,
	productCategoryId: string | null,
): Promise<CustomerCharacteristic[]>;
```

- [ ] **Step 1: Scrivere i test che falliscono**

`apps/api/tests/integration/customer-product-characteristics.test.ts`:

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

import {
	productCategoryCharacteristic,
	productCharacteristic,
	productCharacteristicOption,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { listCustomerCharacteristics } from "@/modules/customer/services/product-characteristics";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCategory,
	createTestMacroCategory,
	createTestProduct,
	createTestSeller,
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

async function seedCatalog() {
	const db = getTestDb();
	const macro = await createTestMacroCategory(db, "Elettronica");
	const phones = await createTestCategory(db, "Smartphone", macro.id);
	const tablets = await createTestCategory(db, "Tablet", macro.id);
	const [peso, scadenza, g5, colore, dual] = await db
		.insert(productCharacteristic)
		.values([
			{ name: "Peso", dataType: "number", unit: "g" },
			{ name: "Scadenza/TMC", dataType: "text" },
			{ name: "5G", dataType: "boolean" },
			{ name: "Colore", dataType: "enum" },
			{ name: "Dual SIM", dataType: "boolean" },
		])
		.returning();
	const [nero] = await db
		.insert(productCharacteristicOption)
		.values([{ characteristicId: colore.id, value: "Nero", sortOrder: 0 }])
		.returning();
	await db.insert(productCategoryCharacteristic).values([
		{ productCategoryId: phones.id, characteristicId: peso.id, sortOrder: 0 },
		{
			productCategoryId: phones.id,
			characteristicId: scadenza.id,
			sortOrder: 1,
		},
		// Stesso sortOrder: decide il nome, «5G» prima di «Colore».
		{ productCategoryId: phones.id, characteristicId: colore.id, sortOrder: 2 },
		{ productCategoryId: phones.id, characteristicId: g5.id, sortOrder: 2 },
		{
			productCategoryId: phones.id,
			characteristicId: dual.id,
			sortOrder: 3,
			required: true,
		},
		{ productCategoryId: tablets.id, characteristicId: peso.id, sortOrder: 0 },
	]);
	const seller = await createTestSeller(db);
	const phone = await createTestProduct(db, seller.profile.id, {
		name: "Telefono",
		categoryIds: [phones.id],
	});
	return {
		db,
		phones,
		tablets,
		peso,
		scadenza,
		g5,
		colore,
		dual,
		nero,
		seller,
		phone,
	};
}

describe("listCustomerCharacteristics", () => {
	it("returns only valued characteristics, in matrix order", async () => {
		const c = await seedCatalog();
		await c.db.insert(productCharacteristicValue).values([
			{
				productId: c.phone.id,
				characteristicId: c.colore.id,
				dataType: "enum",
				optionId: c.nero.id,
			},
			{
				productId: c.phone.id,
				characteristicId: c.g5.id,
				dataType: "boolean",
				valueBoolean: true,
			},
			{
				productId: c.phone.id,
				characteristicId: c.peso.id,
				dataType: "number",
				valueNumber: "180.5000",
			},
		]);

		const rows = await listCustomerCharacteristics(
			c.phone.id,
			c.phones.id,
		);

		expect(rows.map((r) => r.name)).toEqual(["Peso", "5G", "Colore"]);
		expect(rows[0]).toEqual({
			characteristicId: c.peso.id,
			name: "Peso",
			dataType: "number",
			unit: "g",
			value: 180.5,
		});
	});

	it("returns the option label, not the option id", async () => {
		const c = await seedCatalog();
		await c.db.insert(productCharacteristicValue).values({
			productId: c.phone.id,
			characteristicId: c.colore.id,
			dataType: "enum",
			optionId: c.nero.id,
		});

		const [row] = await listCustomerCharacteristics(c.phone.id, c.phones.id);

		expect(row.value).toBe("Nero");
		expect(row.unit).toBeNull();
	});

	it("keeps a boolean false", async () => {
		const c = await seedCatalog();
		await c.db.insert(productCharacteristicValue).values({
			productId: c.phone.id,
			characteristicId: c.g5.id,
			dataType: "boolean",
			valueBoolean: false,
		});

		const rows = await listCustomerCharacteristics(c.phone.id, c.phones.id);

		expect(rows).toHaveLength(1);
		expect(rows[0].value).toBe(false);
	});

	it("returns a date-like text exactly as stored", async () => {
		const c = await seedCatalog();
		await c.db.insert(productCharacteristicValue).values({
			productId: c.phone.id,
			characteristicId: c.scadenza.id,
			dataType: "text",
			valueText: "05/03/2027",
		});

		const [row] = await listCustomerCharacteristics(c.phone.id, c.phones.id);

		expect(row.value).toBe("05/03/2027");
	});

	it("does not require required characteristics", async () => {
		const c = await seedCatalog();
		await c.db.insert(productCharacteristicValue).values({
			productId: c.phone.id,
			characteristicId: c.peso.id,
			dataType: "number",
			valueNumber: "100",
		});

		const rows = await listCustomerCharacteristics(c.phone.id, c.phones.id);

		// «Dual SIM» è obbligatoria e vuota: semplicemente non c'è.
		expect(rows.map((r) => r.name)).toEqual(["Peso"]);
	});

	it("returns nothing for a product without a subcategory", async () => {
		const c = await seedCatalog();
		const bare = await createTestProduct(c.db, c.seller.profile.id);

		expect(await listCustomerCharacteristics(bare.id, null)).toEqual([]);
	});

	it("hides a value outside the current matrix", async () => {
		const c = await seedCatalog();
		// D10 lo vieta nel service del seller; qui lo si forza a mano per
		// dimostrare che la scheda non mostra un valore dormiente.
		await c.db.insert(productCharacteristicValue).values([
			{
				productId: c.phone.id,
				characteristicId: c.peso.id,
				dataType: "number",
				valueNumber: "100",
			},
			{
				productId: c.phone.id,
				characteristicId: c.g5.id,
				dataType: "boolean",
				valueBoolean: true,
			},
		]);

		// Il prodotto letto come se fosse Tablet, la cui matrice ha solo Peso.
		const rows = await listCustomerCharacteristics(c.phone.id, c.tablets.id);

		expect(rows.map((r) => r.name)).toEqual(["Peso"]);
	});
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `cd apps/api && bun test tests/integration/customer-product-characteristics.test.ts`
Expected: FAIL, modulo `@/modules/customer/services/product-characteristics` non trovato.

- [ ] **Step 3: Implementare**

`apps/api/src/modules/customer/services/product-characteristics.ts`:

```ts
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
	type CharacteristicDataType,
	productCategoryCharacteristic,
	productCharacteristic,
	productCharacteristicOption,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { toCharacteristicDisplayValue } from "@/lib/characteristic-values";

export interface CustomerCharacteristic {
	characteristicId: string;
	name: string;
	dataType: CharacteristicDataType;
	unit: string | null;
	value: string | number | boolean;
}

/**
 * Le caratteristiche valorizzate di un prodotto, come le legge il cliente:
 * nell'ordine della matrice (sortOrder, poi nome), con l'etichetta delle
 * opzioni. Il join sulla matrice della sotto-categoria corrente dà l'ordine e,
 * per giunta, scarta un valore fuori matrice che D10 non dovrebbe mai lasciare.
 * Le obbligatorie non contano: una non compilata semplicemente non c'è.
 */
export async function listCustomerCharacteristics(
	productId: string,
	productCategoryId: string | null,
): Promise<CustomerCharacteristic[]> {
	if (!productCategoryId) return [];

	const rows = await db
		.select({
			characteristicId: productCharacteristicValue.characteristicId,
			name: productCharacteristic.name,
			unit: productCharacteristic.unit,
			dataType: productCharacteristicValue.dataType,
			valueText: productCharacteristicValue.valueText,
			valueNumber: productCharacteristicValue.valueNumber,
			valueBoolean: productCharacteristicValue.valueBoolean,
			optionId: productCharacteristicValue.optionId,
			optionValue: productCharacteristicOption.value,
		})
		.from(productCharacteristicValue)
		.innerJoin(
			productCharacteristic,
			eq(productCharacteristic.id, productCharacteristicValue.characteristicId),
		)
		.innerJoin(
			productCategoryCharacteristic,
			and(
				eq(
					productCategoryCharacteristic.characteristicId,
					productCharacteristicValue.characteristicId,
				),
				eq(productCategoryCharacteristic.productCategoryId, productCategoryId),
			),
		)
		.leftJoin(
			productCharacteristicOption,
			eq(productCharacteristicOption.id, productCharacteristicValue.optionId),
		)
		.where(eq(productCharacteristicValue.productId, productId))
		.orderBy(
			asc(productCategoryCharacteristic.sortOrder),
			asc(productCharacteristic.name),
		);

	return rows.flatMap(
		({ characteristicId, name, unit, optionValue, ...stored }) => {
			const value = toCharacteristicDisplayValue(stored, optionValue);
			if (value === null) return [];
			return [
				{ characteristicId, name, dataType: stored.dataType, unit, value },
			];
		},
	);
}
```

Se `CharacteristicDataType` non è esportato da `@/db/schemas/product-characteristic` come tipo insieme alle tabelle, importarlo con un `import type` separato dallo stesso percorso (è da lì che lo importa già `lib/characteristic-values.ts`).

- [ ] **Step 4: Verificare che passino**

Run: `cd apps/api && bun test tests/integration/customer-product-characteristics.test.ts`
Expected: PASS, 7 test.

- [ ] **Step 5: Typecheck e commit**

Run: `bun run --cwd apps/api typecheck; echo $?` → `0`.

```bash
git add apps/api/src/modules/customer/services/product-characteristics.ts apps/api/tests/integration/customer-product-characteristics.test.ts
git commit -m "feat(api): lettura customer delle caratteristiche di un prodotto" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: La scheda prodotto customer — `GET /customer/products/:id`

**Files:**
- Create: `apps/api/src/modules/customer/services/product-detail.ts`
- Modify: `apps/api/src/lib/queries.ts` (in coda), `apps/api/src/lib/schemas/entities.ts` (dopo `ProductCardSchema`), `apps/api/src/modules/customer/routes/products.ts`
- Test: `apps/api/tests/integration/customer-product-detail.test.ts`

**Interfaces:**
- Consumes: `listCustomerCharacteristics` e `CustomerCharacteristic` (Task 2); `offerConditions`, `distanceExpr` da `./product-search-conditions`; `getBestActiveDiscounts` da `@/modules/seller/services/discount-pricing` (restituisce `Map<productId, { percent, discountedPrice, … }>`).
- Produces:

```ts
export interface ProductDetailParams {
	storeId?: string;
	lat?: number;
	lng?: number;
}
export interface ProductDetail {
	id: string;
	name: string;
	description: string | null;
	price: string;
	discountedPrice: string | null;
	discountPercent: number | null;
	brandName: string | null;
	category: {
		id: string;
		name: string;
		macroCategory: { id: string; name: string };
	} | null;
	images: { id: string; url: string; position: number }[];
	offer: {
		storeProductId: string;
		stock: number;
		distance: number | null;
		store: {
			id: string;
			name: string;
			municipality: { id: string; name: string; provinceAcronym: string };
		};
	};
	otherStoreCount: number;
	requestedStoreUnavailable: boolean;
	characteristics: CustomerCharacteristic[];
}
export async function getProductDetail(
	productId: string,
	params: ProductDetailParams,
): Promise<ProductDetail>; // ServiceError(404) se non visibile
```

Rotta: `GET /customer/products/:id?storeId=&lat=&lng=`, risposta `okRes(CustomerProductDetailSchema)`; il client Eden la chiama con `customer.products({ id }).get({ query })`.

- [ ] **Step 1: Scrivere i test che falliscono**

`apps/api/tests/integration/customer-product-detail.test.ts`:

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

import {
	productCategoryCharacteristic,
	productCharacteristic,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { getProductDetail } from "@/modules/customer/services/product-detail";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestBrand,
	createTestCategory,
	createTestDiscount,
	createTestDiscountProduct,
	createTestMacroCategory,
	createTestProduct,
	createTestProductImage,
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

// Roma, piazza Venezia; Bologna è a ~300 km, Milano a ~480 km.
const ROME = { lat: 41.8958, lng: 12.4823 };
const BOLOGNA = { lat: 44.4949, lng: 11.3426 };
const MILANO = { lat: 45.4642, lng: 9.19 };

async function visibleStore(
	sellerProfileId: string,
	name: string,
	at: { lat: number; lng: number },
) {
	const db = getTestDb();
	const s = await createTestStore(db, sellerProfileId, { name, ...at });
	await createTestStoreSubscription(db, s.id, { status: "active" });
	return s;
}

/** Un prodotto in tre negozi visibili, tutti con giacenza. */
async function seedThreeStores() {
	const db = getTestDb();
	const { profile } = await createTestSeller(db);
	const milano = await visibleStore(profile.id, "A Milano", MILANO);
	const bologna = await visibleStore(profile.id, "B Bologna", BOLOGNA);
	const roma = await visibleStore(profile.id, "C Roma", ROME);
	const p = await createTestProduct(db, profile.id, {
		name: "Caffè",
		price: "10.00",
	});
	const spMilano = await createTestStoreProduct(db, milano.id, p.id, {
		stock: 3,
	});
	const spBologna = await createTestStoreProduct(db, bologna.id, p.id, {
		stock: 4,
	});
	const spRoma = await createTestStoreProduct(db, roma.id, p.id, { stock: 5 });
	return { db, profile, milano, bologna, roma, p, spMilano, spBologna, spRoma };
}

describe("getProductDetail — the attached store", () => {
	it("attaches the requested store when it has the product", async () => {
		const s = await seedThreeStores();

		const d = await getProductDetail(s.p.id, {
			storeId: s.bologna.id,
			...ROME,
		});

		expect(d.offer.store.id).toBe(s.bologna.id);
		expect(d.offer.storeProductId).toBe(s.spBologna.id);
		expect(d.offer.stock).toBe(4);
		expect(d.requestedStoreUnavailable).toBe(false);
		expect(d.otherStoreCount).toBe(2);
	});

	it("attaches the nearest store without a requested one", async () => {
		const s = await seedThreeStores();

		const d = await getProductDetail(s.p.id, { ...ROME });

		expect(d.offer.store.id).toBe(s.roma.id);
		expect(d.offer.distance).toBeGreaterThanOrEqual(0);
		expect(d.offer.distance).toBeLessThan(5_000);
		expect(d.requestedStoreUnavailable).toBe(false);
	});

	it("attaches the first store by name without store or origin", async () => {
		const s = await seedThreeStores();

		const d = await getProductDetail(s.p.id, {});

		expect(d.offer.store.id).toBe(s.milano.id);
		expect(d.offer.distance).toBeNull();
	});

	it("falls back when the requested store is out of stock", async () => {
		const s = await seedThreeStores();
		const { storeProduct } = await import("@/db/schemas/product");
		const { eq } = await import("drizzle-orm");
		await s.db
			.update(storeProduct)
			.set({ stock: 0 })
			.where(eq(storeProduct.id, s.spBologna.id));

		const d = await getProductDetail(s.p.id, {
			storeId: s.bologna.id,
			...ROME,
		});

		expect(d.offer.store.id).toBe(s.roma.id);
		expect(d.requestedStoreUnavailable).toBe(true);
		expect(d.otherStoreCount).toBe(1);
	});

	it("falls back when the requested store is hidden", async () => {
		const db = getTestDb();
		const s = await seedThreeStores();
		// Nessun abbonamento: il negozio non è pubblicamente visibile.
		const hidden = await createTestStore(db, s.profile.id, {
			name: "Nascosto",
			...ROME,
		});
		await createTestStoreProduct(db, hidden.id, s.p.id, { stock: 9 });

		const d = await getProductDetail(s.p.id, { storeId: hidden.id, ...ROME });

		expect(d.offer.store.id).toBe(s.roma.id);
		expect(d.requestedStoreUnavailable).toBe(true);
	});

	it("falls back when the requested store id does not exist", async () => {
		const s = await seedThreeStores();

		const d = await getProductDetail(s.p.id, { storeId: "nope", ...ROME });

		expect(d.offer.store.id).toBe(s.roma.id);
		expect(d.requestedStoreUnavailable).toBe(true);
	});
});

describe("getProductDetail — visibility", () => {
	it("is 404 for an unknown product", async () => {
		await expect(getProductDetail("nope", {})).rejects.toMatchObject({
			status: 404,
		});
	});

	it("is 404 for a disabled or trashed product", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const st = await visibleStore(profile.id, "Negozio", ROME);
		for (const status of ["disabled", "trashed"] as const) {
			const p = await createTestProduct(db, profile.id, { status });
			await createTestStoreProduct(db, st.id, p.id, { stock: 5 });
			await expect(getProductDetail(p.id, {})).rejects.toMatchObject({
				status: 404,
			});
		}
	});

	it("is 404 when no visible store has it in stock", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const st = await visibleStore(profile.id, "Negozio", ROME);
		const hidden = await createTestStore(db, profile.id, { name: "Nascosto" });
		const p = await createTestProduct(db, profile.id);
		await createTestStoreProduct(db, st.id, p.id, { stock: 0 });
		await createTestStoreProduct(db, hidden.id, p.id, { stock: 5 });

		await expect(getProductDetail(p.id, {})).rejects.toMatchObject({
			status: 404,
		});
	});
});

describe("getProductDetail — the product", () => {
	it("returns images in order, discount, brand and category", async () => {
		const s = await seedThreeStores();
		const macro = await createTestMacroCategory(s.db, "Alimentari");
		const cat = await createTestCategory(s.db, "Caffè e tè", macro.id);
		const brand = await createTestBrand(s.db, s.profile.id, "Torrefazione");
		const { product } = await import("@/db/schemas/product");
		const { eq } = await import("drizzle-orm");
		await s.db
			.update(product)
			.set({ productCategoryId: cat.id, brandId: brand.id })
			.where(eq(product.id, s.p.id));
		await createTestProductImage(s.db, s.p.id, {
			url: "https://img.test/b.jpg",
			position: 1,
		});
		await createTestProductImage(s.db, s.p.id, {
			url: "https://img.test/a.jpg",
			position: 0,
		});
		const disc = await createTestDiscount(s.db, s.profile.id, { percent: 20 });
		await createTestDiscountProduct(s.db, disc.id, s.p.id);

		const d = await getProductDetail(s.p.id, {});

		expect(d.name).toBe("Caffè");
		expect(d.price).toBe("10.00");
		expect(d.discountPercent).toBe(20);
		expect(d.discountedPrice).toBe("8.00");
		expect(d.brandName).toBe("Torrefazione");
		expect(d.category).toEqual({
			id: cat.id,
			name: "Caffè e tè",
			macroCategory: { id: macro.id, name: "Alimentari" },
		});
		expect(d.images.map((i) => i.url)).toEqual([
			"https://img.test/a.jpg",
			"https://img.test/b.jpg",
		]);
		expect(d.characteristics).toEqual([]);
	});

	it("returns null brand and category when unset", async () => {
		const s = await seedThreeStores();

		const d = await getProductDetail(s.p.id, {});

		expect(d.brandName).toBeNull();
		expect(d.category).toBeNull();
		expect(d.discountPercent).toBeNull();
		expect(d.characteristics).toEqual([]);
	});

	it("embeds the characteristics", async () => {
		const s = await seedThreeStores();
		const cat = await createTestCategory(s.db, "Caffè in grani");
		const [peso] = await s.db
			.insert(productCharacteristic)
			.values([{ name: "Peso", dataType: "number", unit: "g" }])
			.returning();
		await s.db.insert(productCategoryCharacteristic).values({
			productCategoryId: cat.id,
			characteristicId: peso.id,
			sortOrder: 0,
		});
		const { product } = await import("@/db/schemas/product");
		const { eq } = await import("drizzle-orm");
		await s.db
			.update(product)
			.set({ productCategoryId: cat.id })
			.where(eq(product.id, s.p.id));
		await s.db.insert(productCharacteristicValue).values({
			productId: s.p.id,
			characteristicId: peso.id,
			dataType: "number",
			valueNumber: "250",
		});

		const d = await getProductDetail(s.p.id, {});

		expect(d.characteristics).toEqual([
			{
				characteristicId: peso.id,
				name: "Peso",
				dataType: "number",
				unit: "g",
				value: 250,
			},
		]);
	});
});
```

Gli `import()` dinamici di `drizzle-orm` e dello schema dentro i test si possono spostare in cima al file (dopo il `mock.module`), accanto agli altri import: è la forma preferita, qui sono inline solo per leggibilità del piano. **Non** spostare sopra il `mock.module`.

- [ ] **Step 2: Verificare che falliscano**

Run: `cd apps/api && bun test tests/integration/customer-product-detail.test.ts`
Expected: FAIL, modulo `@/modules/customer/services/product-detail` non trovato.

- [ ] **Step 3: Il service**

`apps/api/src/modules/customer/services/product-detail.ts`:

```ts
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { brand } from "@/db/schemas/brand";
import { productCategory } from "@/db/schemas/category";
import { municipality, province } from "@/db/schemas/location";
import { product, storeProduct } from "@/db/schemas/product";
import { productImage } from "@/db/schemas/product-image";
import { productMacroCategory } from "@/db/schemas/product-macro-category";
import { store } from "@/db/schemas/store";
import { ServiceError } from "@/lib/errors";
import { getBestActiveDiscounts } from "@/modules/seller/services/discount-pricing";
import {
	type CustomerCharacteristic,
	listCustomerCharacteristics,
} from "./product-characteristics";
import { distanceExpr, offerConditions } from "./product-search-conditions";

export interface ProductDetailParams {
	/** Il negozio da cui arriva il cliente: vince se ha il prodotto. */
	storeId?: string;
	lat?: number;
	lng?: number;
}

export interface ProductDetail {
	id: string;
	name: string;
	description: string | null;
	price: string;
	discountedPrice: string | null;
	discountPercent: number | null;
	brandName: string | null;
	category: {
		id: string;
		name: string;
		macroCategory: { id: string; name: string };
	} | null;
	images: { id: string; url: string; position: number }[];
	offer: {
		storeProductId: string;
		stock: number;
		distance: number | null;
		store: {
			id: string;
			name: string;
			municipality: { id: string; name: string; provinceAcronym: string };
		};
	};
	otherStoreCount: number;
	/** Il cliente chiedeva un negozio che non ce l'ha (più): ne è stato agganciato un altro. */
	requestedStoreUnavailable: boolean;
	characteristics: CustomerCharacteristic[];
}

/**
 * La scheda prodotto del cliente. Visibile solo se il prodotto è attivo e
 * almeno un negozio pubblicamente visibile lo ha con giacenza: lo stesso
 * insieme della ricerca, perché le condizioni sul negozio sono le stesse
 * (`offerConditions`, senza raggio e senza «aperto ora»).
 *
 * Il negozio agganciato segue la regola del laterale di `searchProducts` —
 * il più vicino, e senza origine il primo per nome — con davanti la
 * preferenza per il negozio da cui il cliente arriva. `count(*) OVER ()` si
 * valuta prima del LIMIT: conta tutti i negozi idonei in una query sola.
 */
export async function getProductDetail(
	productId: string,
	params: ProductDetailParams,
): Promise<ProductDetail> {
	const distance = distanceExpr(params.lat, params.lng);
	const preferred = params.storeId
		? sql`(${store.id} = ${params.storeId}) DESC,`
		: sql``;

	const [row] = await db
		.select({
			id: product.id,
			name: product.name,
			description: product.description,
			price: product.price,
			productCategoryId: product.productCategoryId,
			brandName: brand.name,
			categoryId: productCategory.id,
			categoryName: productCategory.name,
			macroId: productMacroCategory.id,
			macroName: productMacroCategory.name,
			storeProductId: storeProduct.id,
			stock: storeProduct.stock,
			storeId: store.id,
			storeName: store.name,
			municipalityId: municipality.id,
			municipalityName: municipality.name,
			provinceAcronym: province.acronym,
			distance: sql<number | null>`${distance}`,
			matchCount: sql<number>`(count(*) OVER ())::int`,
		})
		.from(product)
		.innerJoin(storeProduct, eq(storeProduct.productId, product.id))
		.innerJoin(store, eq(store.id, storeProduct.storeId))
		.innerJoin(municipality, eq(municipality.id, store.municipalityId))
		.innerJoin(province, eq(province.id, municipality.provinceId))
		.leftJoin(brand, eq(brand.id, product.brandId))
		.leftJoin(productCategory, eq(productCategory.id, product.productCategoryId))
		.leftJoin(
			productMacroCategory,
			eq(productMacroCategory.id, productCategory.macroCategoryId),
		)
		.where(
			and(
				eq(product.id, productId),
				sql`${product.status} = 'active'`,
				// Senza `radius` il filtro geografico non si applica: lat/lng
				// servono solo a ordinare.
				...offerConditions({ lat: params.lat, lng: params.lng }, null),
			),
		)
		.orderBy(
			sql`${preferred} ${distance} ASC NULLS LAST, ${store.name} ASC, ${store.id} ASC`,
		)
		.limit(1);

	if (!row) throw new ServiceError(404, "Prodotto non trovato");

	const [images, discounts, characteristics] = await Promise.all([
		db
			.select({
				id: productImage.id,
				url: productImage.url,
				position: productImage.position,
			})
			.from(productImage)
			.where(eq(productImage.productId, row.id))
			.orderBy(asc(productImage.position)),
		getBestActiveDiscounts([row.id]),
		listCustomerCharacteristics(row.id, row.productCategoryId),
	]);
	const discount = discounts.get(row.id);

	return {
		id: row.id,
		name: row.name,
		description: row.description,
		price: row.price,
		discountedPrice: discount?.discountedPrice ?? null,
		discountPercent: discount?.percent ?? null,
		brandName: row.brandName,
		category:
			row.categoryId && row.categoryName && row.macroId && row.macroName
				? {
						id: row.categoryId,
						name: row.categoryName,
						macroCategory: { id: row.macroId, name: row.macroName },
					}
				: null,
		images,
		offer: {
			storeProductId: row.storeProductId,
			stock: row.stock,
			distance: row.distance,
			store: {
				id: row.storeId,
				name: row.storeName,
				municipality: {
					id: row.municipalityId,
					name: row.municipalityName,
					provinceAcronym: row.provinceAcronym,
				},
			},
		},
		otherStoreCount: row.matchCount - 1,
		requestedStoreUnavailable:
			params.storeId !== undefined && row.storeId !== params.storeId,
		characteristics,
	};
}
```

Due trappole di Drizzle, già note in questo repo:
- `offerConditions` e `distanceExpr` citano `products.id` e `stores.location` **alla lettera**: funzionano perché qui `product` e `store` stanno nel `FROM` con il loro nome di tabella, senza alias. Non aliasare `product` né `store`.
- Le colonne omonime (`product.id`, `store.id`, `municipality.id`) qui vanno bene: questa è la select esterna, non una subquery `.as()`, e Drizzle mappa i campi per posizione.

Se `distance` torna come stringa invece che come numero (dipende dal driver per `double precision`), avvolgerlo: `distance: row.distance === null ? null : Number(row.distance)`. Il test «attaches the nearest store» lo scopre.

- [ ] **Step 4: Verificare il service**

Run: `cd apps/api && bun test tests/integration/customer-product-detail.test.ts`
Expected: PASS, 12 test.

- [ ] **Step 5: Query, schema e rotta**

In coda a `apps/api/src/lib/queries.ts`:

```ts
export const ProductDetailQuery = t.Object({
	storeId: t.Optional(
		t.String({
			description:
				"Negozio da cui arriva il cliente: viene agganciato se ha il prodotto disponibile",
		}),
	),
	lat: t.Optional(
		t.Number({
			minimum: -90,
			maximum: 90,
			description: "Latitudine dell'origine, per scegliere il negozio più vicino",
		}),
	),
	lng: t.Optional(
		t.Number({
			minimum: -180,
			maximum: 180,
			description: "Longitudine dell'origine, per scegliere il negozio più vicino",
		}),
	),
});
```

In `apps/api/src/lib/schemas/entities.ts`, subito dopo `ProductCardSchema`:

```ts
// Scheda prodotto customer. Nessun campo data: Eden idraterebbe le
// stringhe-data in `Date`. Il customer la legge comunque con parseDate: false,
// perché un valore di testo può somigliare a una data ("05/03/2027").
export const CustomerProductCharacteristicSchema = t.Object({
	characteristicId: t.String({ description: "ID della caratteristica" }),
	name: t.String({ description: "Nome della caratteristica" }),
	dataType: CharacteristicDataTypeSchema,
	unit: t.Nullable(
		t.String({ description: "Unità di misura, solo per il tipo number" }),
	),
	value: t.Union([t.String(), t.Number(), t.Boolean()], {
		description:
			"Testo, numero o sì/no secondo il tipo; per le liste chiuse, l'etichetta dell'opzione",
	}),
});

export const CustomerProductDetailSchema = t.Object({
	id: t.String(),
	name: t.String({ description: "Nome del prodotto" }),
	description: t.Nullable(t.String({ description: "Descrizione del prodotto" })),
	price: t.String({ description: "Prezzo di listino in formato decimale" }),
	discountedPrice: t.Nullable(
		t.String({ description: "Prezzo scontato, se promo attiva" }),
	),
	discountPercent: t.Nullable(t.Integer({ minimum: 1, maximum: 99 })),
	brandName: t.Nullable(t.String({ description: "Marca del prodotto" })),
	category: t.Nullable(
		t.Object({
			id: t.String(),
			name: t.String({ description: "Sotto-categoria" }),
			macroCategory: t.Object({
				id: t.String(),
				name: t.String({ description: "Macro-categoria" }),
			}),
		}),
	),
	images: t.Array(
		t.Object({
			id: t.String(),
			url: t.String({ description: "URL dell'immagine" }),
			position: t.Number({ minimum: 0 }),
		}),
		{ description: "Immagini del prodotto ordinate per posizione" },
	),
	offer: t.Object(
		{
			storeProductId: t.String({
				description: "ID della riga store_products, da usare per il carrello",
			}),
			stock: t.Integer({
				minimum: 0,
				description: "Disponibilità nel negozio agganciato",
			}),
			distance: t.Nullable(
				t.Number({
					minimum: 0,
					description: "Distanza in metri dall'origine (null senza origine)",
				}),
			),
			store: t.Object({
				id: t.String(),
				name: t.String({ description: "Nome del negozio" }),
				municipality: MunicipalityCompactSchema,
			}),
		},
		{
			description:
				"Il negozio agganciato: quello richiesto se ce l'ha, altrimenti il più vicino, altrimenti il primo per nome",
		},
	),
	otherStoreCount: t.Integer({
		minimum: 0,
		description: "Altri negozi visibili che lo hanno disponibile",
	}),
	requestedStoreUnavailable: t.Boolean({
		description:
			"Il negozio richiesto non ha il prodotto disponibile: ne è stato agganciato un altro",
	}),
	characteristics: t.Array(CustomerProductCharacteristicSchema, {
		description:
			"Solo le caratteristiche valorizzate, nell'ordine della matrice della sotto-categoria",
	}),
});
```

`CharacteristicDataTypeSchema` e `MunicipalityCompactSchema` sono già definiti più in alto nello stesso file.

In `apps/api/src/modules/customer/routes/products.ts`: aggiungere agli import `ProductDetailQuery` (da `@/lib/queries`), `CustomerProductDetailSchema` (da `@/lib/schemas`) e `import { getProductDetail } from "../services/product-detail";`, poi in coda alla catena, **dopo** `/products/facets`:

```ts
	.get(
		"/products/:id",
		async ({ params, query, store }) => {
			const pino = getLogger(store);
			const detail = await getProductDetail(params.id, query);
			pino.info(
				{
					productId: params.id,
					requestedStoreId: query.storeId,
					attachedStoreId: detail.offer.store.id,
					hasGeo: !!(query.lat && query.lng),
					characteristicCount: detail.characteristics.length,
					action: "product_detail",
				},
				"Scheda prodotto richiesta",
			);
			return ok(detail);
		},
		{
			params: t.Object({ id: t.String({ description: "ID del prodotto" }) }),
			query: ProductDetailQuery,
			response: withErrors({ 200: okRes(CustomerProductDetailSchema) }),
			detail: {
				summary: "Scheda prodotto",
				description:
					"Scheda pubblica di un prodotto con un negozio agganciato: quello indicato da `storeId` se lo ha disponibile, altrimenti il più vicino all'origine, altrimenti il primo per nome. Include le sole caratteristiche valorizzate, con l'etichetta delle opzioni. Restituisce 404 se il prodotto non è attivo o nessun negozio visibile lo ha disponibile. Non richiede autenticazione.",
				tags: ["Customer - Search"],
			},
		},
	);
```

Nota: il `;` finale va spostato dall'attuale ultima `.get(...)` a questa. `/products/facets` è statica e in Elysia vince sulla parametrica, ma tenerla prima rende l'ordine evidente a chi legge.

- [ ] **Step 6: Verificare tutto il modulo e i tipi**

Run:
```bash
cd apps/api && bun test tests/integration/customer-product-detail.test.ts tests/integration/customer-products-search.test.ts tests/integration/customer-products-facets.test.ts
bun run --cwd apps/api typecheck; echo $?
bun run --cwd apps/customer typecheck; echo $?
bun run --cwd apps/seller typecheck; echo $?
bun run --cwd apps/admin typecheck; echo $?
```
Expected: tutto PASS, quattro `0`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/customer/services/product-detail.ts apps/api/src/lib/queries.ts apps/api/src/lib/schemas/entities.ts apps/api/src/modules/customer/routes/products.ts apps/api/tests/integration/customer-product-detail.test.ts
git commit -m "feat(api): scheda prodotto customer con negozio agganciato" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Customer — client senza date, lettura della scheda, formattatore

**Files:**
- Modify: `apps/customer/src/lib/api.ts`
- Create: `apps/customer/src/features/products/product-detail-api.ts`, `apps/customer/src/features/products/format-characteristic.ts`, `apps/customer/src/features/products/use-product-detail.ts`
- Test: `apps/customer/src/features/products/product-detail-api.test.ts`, `apps/customer/src/features/products/format-characteristic.test.ts`

**Interfaces:**
- Consumes: la rotta del Task 3 via Eden, `customer.products({ id }).get({ query: { storeId?, lat?, lng? } })`; `Coords` da `@/features/location/coords`.
- Produces:

```ts
// lib/api.ts
export const apiNoDates: typeof api;
// product-detail-api.ts
export type ProductDetailView = /* il DTO della rotta, tipato da Eden */;
export type ProductCharacteristicView = ProductDetailView["characteristics"][number];
export async function fetchProductDetail(
	productId: string,
	params: { storeId?: string; coords: Coords | null },
): Promise<ProductDetailView | null>; // null su 404
// format-characteristic.ts
export interface CharacteristicLabels { yes: string; no: string }
export interface CharacteristicRow { id: string; name: string; value: string }
export function formatCharacteristicValue(c: ProductCharacteristicView, labels: CharacteristicLabels): string | null;
export function characteristicRows(list: ProductCharacteristicView[], labels: CharacteristicLabels): CharacteristicRow[];
// use-product-detail.ts
export function useProductDetail(productId: string, storeId: string | undefined): UseQueryResult<ProductDetailView | null>;
```

- [ ] **Step 1: Il test della trappola, che fallisce**

`apps/customer/src/features/products/product-detail-api.test.ts`:

```ts
import { afterEach, describe, expect, it } from "bun:test";
import { api } from "@/lib/api";
import { fetchProductDetail } from "./product-detail-api";

/**
 * La prova di C8. Eden, con il default parseDate: true, trasforma in `Date`
 * ogni stringa che somiglia a una data, dd/mm/yyyy compreso: «05/03/2027»
 * diventa il 3 maggio e il testo originale non si recupera più. Qui il JSON
 * passa dal client vero (createIsomorphicFn fuori da Start restituisce il
 * ramo server, cioè treaty con il fetch globale), quindi il test diventa
 * rosso se qualcuno rimette `api()` dentro fetchProductDetail.
 */
const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

function serve(body: unknown) {
	globalThis.fetch = (async () =>
		new Response(JSON.stringify(body), {
			headers: { "content-type": "application/json" },
		})) as unknown as typeof fetch;
}

const detail = {
	id: "p1",
	name: "Passata",
	description: null,
	price: "2.50",
	discountedPrice: null,
	discountPercent: null,
	brandName: null,
	category: null,
	images: [],
	offer: {
		storeProductId: "sp1",
		stock: 3,
		distance: null,
		store: {
			id: "s1",
			name: "Bottega",
			municipality: { id: "m1", name: "Bologna", provinceAcronym: "BO" },
		},
	},
	otherStoreCount: 0,
	requestedStoreUnavailable: false,
	characteristics: [
		{
			characteristicId: "c1",
			name: "Scadenza/TMC",
			dataType: "text",
			unit: null,
			value: "05/03/2027",
		},
		{
			characteristicId: "c2",
			name: "Lotto",
			dataType: "text",
			unit: null,
			value: "05-03-2027",
		},
	],
};

describe("fetchProductDetail", () => {
	it("the default client turns a dd/mm/yyyy text into a Date", async () => {
		serve({ success: true, data: detail });
		const res = await api().customer.products({ id: "p1" }).get();
		const value = (res.data as { data: typeof detail }).data.characteristics[0]
			.value as unknown;
		// Se questo test si rompe, Eden ha cambiato comportamento: il test
		// sotto resta la prova che conta.
		expect(value).toBeInstanceOf(Date);
	});

	it("keeps date-like texts as strings", async () => {
		serve({ success: true, data: detail });

		const view = await fetchProductDetail("p1", { coords: null });

		expect(view?.characteristics.map((c) => c.value)).toEqual([
			"05/03/2027",
			"05-03-2027",
		]);
		expect(typeof view?.characteristics[0].value).toBe("string");
	});

	it("returns null on 404", async () => {
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ success: false, message: "Prodotto non trovato" }), {
				status: 404,
				headers: { "content-type": "application/json" },
			})) as unknown as typeof fetch;

		expect(await fetchProductDetail("p1", { coords: null })).toBeNull();
	});
});
```

Run: `cd apps/customer && bun test src/features/products/product-detail-api.test.ts`
Expected: FAIL, `./product-detail-api` non esiste.

- [ ] **Step 2: Il client e la lettura**

`apps/customer/src/lib/api.ts` diventa:

```ts
import type { App } from "@bibs/api";
import { createApiClient } from "@bibs/ui/lib/api-client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export const api = createApiClient<App>(API_URL);

/**
 * Per le risposte che portano testo libero: le caratteristiche di un prodotto
 * («Scadenza/TMC: 05/03/2027»). Con il default di Eden quel testo diventerebbe
 * un `Date` del 3 maggio, senza ritorno. Vedi product-detail-api.test.ts.
 */
export const apiNoDates = createApiClient<App>(API_URL, { parseDate: false });
```

`apps/customer/src/features/products/product-detail-api.ts`:

```ts
import type { Coords } from "@/features/location/coords";
import { apiNoDates } from "@/lib/api";

type DetailResponse = Awaited<
	ReturnType<ReturnType<ReturnType<typeof apiNoDates>["customer"]["products"]>["get"]>
>;
export type ProductDetailView = NonNullable<DetailResponse["data"]>["data"];
export type ProductCharacteristicView =
	ProductDetailView["characteristics"][number];

/**
 * La scheda di un prodotto, `null` se non è visibile (404). Passa da
 * `apiNoDates`, mai da `api`: vedi C8 nel piano PR 5.
 */
export async function fetchProductDetail(
	productId: string,
	params: { storeId?: string; coords: Coords | null },
): Promise<ProductDetailView | null> {
	// Solo le chiavi presenti: una chiave `undefined` non deve finire
	// nell'URL come stringa.
	const query: { storeId?: string; lat?: number; lng?: number } = {};
	if (params.storeId) query.storeId = params.storeId;
	if (params.coords) {
		query.lat = params.coords.lat;
		query.lng = params.coords.lng;
	}
	const { data, error } = await apiNoDates()
		.customer.products({ id: productId })
		.get({ query });
	if (error) {
		if (error.status === 404) return null;
		throw new Error(`Caricamento prodotto non riuscito (${error.status})`);
	}
	return data.data;
}
```

Se l'inferenza di `DetailResponse` è scomoda, un'alternativa equivalente è tipare `ProductDetailView` con `Static<typeof CustomerProductDetailSchema>`, ma **solo** se il customer importa già tipi TypeBox da `@bibs/api` altrove; altrimenti tenere l'inferenza Eden. In ogni caso `typecheck` del customer è il giudice.

Run: `cd apps/customer && bun test src/features/products/product-detail-api.test.ts`
Expected: PASS, 3 test. Poi, per vedere il test diventare rosso: sostituire temporaneamente `apiNoDates()` con `api()` in `fetchProductDetail`, rilanciare (atteso: FAIL su «keeps date-like texts as strings»), **ripristinare** e rilanciare (PASS). Riportare i due esiti.

- [ ] **Step 3: Il formattatore, test prima**

`apps/customer/src/features/products/format-characteristic.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
	characteristicRows,
	formatCharacteristicValue,
} from "./format-characteristic";
import type { ProductCharacteristicView } from "./product-detail-api";

const labels = { yes: "Sì", no: "No" };
const NBSP = " ";

function c(
	partial: Partial<ProductCharacteristicView> &
		Pick<ProductCharacteristicView, "dataType" | "value">,
): ProductCharacteristicView {
	return {
		characteristicId: "c1",
		name: "Voce",
		unit: null,
		...partial,
	} as ProductCharacteristicView;
}

describe("formatCharacteristicValue", () => {
	it("shows Sì for true and No for false", () => {
		expect(formatCharacteristicValue(c({ dataType: "boolean", value: true }), labels)).toBe("Sì");
		expect(formatCharacteristicValue(c({ dataType: "boolean", value: false }), labels)).toBe("No");
	});

	it("formats numbers the Italian way, with the unit after a no-break space", () => {
		expect(
			formatCharacteristicValue(c({ dataType: "number", value: 6.1, unit: "pollici" }), labels),
		).toBe(`6,1${NBSP}pollici`);
		expect(
			formatCharacteristicValue(c({ dataType: "number", value: 12345678.1234, unit: "g" }), labels),
		).toBe(`12.345.678,1234${NBSP}g`);
		expect(
			formatCharacteristicValue(c({ dataType: "number", value: 6500, unit: "K" }), labels),
		).toBe(`6500${NBSP}K`);
	});

	it("formats integers without decimals", () => {
		expect(
			formatCharacteristicValue(c({ dataType: "number", value: 12, unit: "mesi" }), labels),
		).toBe(`12${NBSP}mesi`);
	});

	it("writes percent without a space", () => {
		expect(
			formatCharacteristicValue(c({ dataType: "number", value: 55, unit: "%" }), labels),
		).toBe("55%");
	});

	it("shows a number without unit alone", () => {
		expect(formatCharacteristicValue(c({ dataType: "number", value: 4 }), labels)).toBe("4");
	});

	it("shows texts and option labels as they are", () => {
		expect(formatCharacteristicValue(c({ dataType: "text", value: "05/03/2027" }), labels)).toBe("05/03/2027");
		expect(formatCharacteristicValue(c({ dataType: "enum", value: "Nero" }), labels)).toBe("Nero");
	});

	it("never shows a value revived into a Date", () => {
		const revived = c({ dataType: "text", value: new Date(2027, 4, 3) as unknown as string });
		expect(formatCharacteristicValue(revived, labels)).toBeNull();
	});

	it("never shows an empty text or a mistyped value", () => {
		expect(formatCharacteristicValue(c({ dataType: "text", value: "  " }), labels)).toBeNull();
		expect(formatCharacteristicValue(c({ dataType: "number", value: "12" }), labels)).toBeNull();
		expect(formatCharacteristicValue(c({ dataType: "boolean", value: "true" }), labels)).toBeNull();
	});
});

describe("characteristicRows", () => {
	it("keeps the order and drops what cannot be shown", () => {
		const rows = characteristicRows(
			[
				c({ characteristicId: "a", name: "Peso", dataType: "number", value: 250, unit: "g" }),
				c({ characteristicId: "b", name: "Vuoto", dataType: "text", value: " " }),
				c({ characteristicId: "c", name: "5G", dataType: "boolean", value: false }),
			],
			labels,
		);
		expect(rows).toEqual([
			{ id: "a", name: "Peso", value: `250${NBSP}g` },
			{ id: "c", name: "5G", value: "No" },
		]);
	});

	it("returns nothing for an empty list", () => {
		expect(characteristicRows([], labels)).toEqual([]);
	});
});
```

Run: `cd apps/customer && bun test src/features/products/format-characteristic.test.ts`
Expected: FAIL, `./format-characteristic` non esiste.

- [ ] **Step 4: Implementare il formattatore**

`apps/customer/src/features/products/format-characteristic.ts`:

```ts
import type { ProductCharacteristicView } from "./product-detail-api";

export interface CharacteristicLabels {
	yes: string;
	no: string;
}

export interface CharacteristicRow {
	id: string;
	name: string;
	value: string;
}

// Quattro decimali: la precisione di numeric(14,4) lato database.
const NUMBER = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 4 });

/**
 * Il testo di una cella della tabella Caratteristiche, o `null` se la riga non
 * deve esistere. Le etichette «Sì» / «No» arrivano da Paraglide tramite il
 * chiamante, così la funzione resta pura e testabile.
 */
export function formatCharacteristicValue(
	c: ProductCharacteristicView,
	labels: CharacteristicLabels,
): string | null {
	const value: unknown = c.value;
	// Difesa, non il fix: se un fetch avesse revivificato una data, il testo
	// originale è perso. Meglio nessuna riga che una data sbagliata. Il fix è
	// apiNoDates in fetchProductDetail.
	if (value instanceof Date) return null;

	switch (c.dataType) {
		case "boolean":
			if (typeof value !== "boolean") return null;
			return value ? labels.yes : labels.no;
		case "number": {
			if (typeof value !== "number" || !Number.isFinite(value)) return null;
			const n = NUMBER.format(value);
			if (!c.unit) return n;
			return c.unit === "%" ? `${n}%` : `${n} ${c.unit}`;
		}
		case "text":
		case "enum":
			return typeof value === "string" && value.trim() !== "" ? value : null;
	}
}

export function characteristicRows(
	list: ProductCharacteristicView[],
	labels: CharacteristicLabels,
): CharacteristicRow[] {
	return list.flatMap((c) => {
		const value = formatCharacteristicValue(c, labels);
		return value === null
			? []
			: [{ id: c.characteristicId, name: c.name, value }];
	});
}
```

Run: `cd apps/customer && bun test src/features/products/format-characteristic.test.ts`
Expected: PASS, 10 test.

- [ ] **Step 5: La query**

`apps/customer/src/features/products/use-product-detail.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { useSearchOrigin } from "@/features/location/search-origin";
import { fetchProductDetail } from "./product-detail-api";

/**
 * La scheda di un prodotto. L'origine di ricerca entra nella chiave: cambiando
 * indirizzo dal chip, il negozio più vicino può cambiare. Con `storeId` le
 * coordinate servono solo se quel negozio non ce l'ha più.
 */
export function useProductDetail(productId: string, storeId: string | undefined) {
	const { coords } = useSearchOrigin();
	return useQuery({
		queryKey: [
			"product-detail",
			productId,
			storeId ?? null,
			coords?.lat ?? null,
			coords?.lng ?? null,
		],
		staleTime: 60_000,
		queryFn: () => fetchProductDetail(productId, { storeId, coords }),
	});
}
```

- [ ] **Step 6: Verificare e committare**

Run:
```bash
cd apps/customer && bun test
bun run --cwd apps/customer typecheck; echo $?
```
Expected: tutti i test del customer PASS; `0`.

```bash
git add apps/customer/src/lib/api.ts apps/customer/src/features/products/
git commit -m "feat(customer): lettura della scheda prodotto senza date di Eden" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Customer — la route `/products/$productId`

**Files:**
- Create: `apps/customer/src/routes/_authenticated/products/$productId.tsx`, `apps/customer/src/features/products/product-characteristics.tsx`, `apps/customer/src/features/products/product-gallery.tsx`, `apps/customer/src/features/products/product-offer.tsx`
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json`, `apps/customer/src/routeTree.gen.ts` (rigenerato)

**Interfaces:**
- Consumes: `useProductDetail`, `ProductDetailView` (Task 4); `characteristicRows` (Task 4); `AddToCart` da `@/features/cart/add-to-cart` (`{ storeProductId, stock, productName }`); `DiscountedPrice` da `@bibs/ui/components/discounted-price` (`size?: "sm" | "md" | "lg"`, `originalPrice`, `discountedPrice`, `percent`); `formatDistance`, `TileImage` da `@/components/tile`; `NoticePage` da `@/components/notice`; `PAGE_CONTAINER` da `@/components/page`.
- Produces: la route `/_authenticated/products/$productId` con `validateSearch` → `{ store?: string }`. Il Task 6 ci linka con `<Link to="/products/$productId" params={{ productId }} search={{ store }} />`.

- [ ] **Step 1: I messaggi**

Aggiungere in `apps/customer/messages/it.json` (prima della `}` finale, con la virgola sulla riga precedente):

```json
	"product_detail_characteristics_title": "Caratteristiche",
	"product_detail_yes": "Sì",
	"product_detail_no": "No",
	"product_detail_description_title": "Descrizione",
	"product_detail_sold_by": "Disponibile da",
	"product_detail_other_stores_one": "Anche in un altro negozio",
	"product_detail_other_stores": "Anche in altri {count} negozi",
	"product_detail_requested_store_unavailable": "Non è più disponibile nel negozio da cui arrivi. Lo trovi qui:",
	"product_detail_gallery_aria": "Foto del prodotto",
	"product_detail_photo_aria": "Mostra la foto {index}",
	"product_detail_not_found_title": "Prodotto non trovato",
	"product_detail_not_found_description": "Questo prodotto non esiste o non è più disponibile in nessun negozio.",
	"product_detail_back_to_products": "Torna ai prodotti",
	"product_detail_load_error_title": "Non siamo riusciti a caricare il prodotto",
	"product_detail_load_error_description": "Controlla la connessione e riprova.",
	"product_detail_retry": "Riprova"
```

E in `apps/customer/messages/en.json`, stesse chiavi:

```json
	"product_detail_characteristics_title": "Specifications",
	"product_detail_yes": "Yes",
	"product_detail_no": "No",
	"product_detail_description_title": "Description",
	"product_detail_sold_by": "Available at",
	"product_detail_other_stores_one": "Also in one other store",
	"product_detail_other_stores": "Also in {count} other stores",
	"product_detail_requested_store_unavailable": "It is no longer available at the store you came from. You can find it here:",
	"product_detail_gallery_aria": "Product photos",
	"product_detail_photo_aria": "Show photo {index}",
	"product_detail_not_found_title": "Product not found",
	"product_detail_not_found_description": "This product does not exist or is no longer available in any store.",
	"product_detail_back_to_products": "Back to products",
	"product_detail_load_error_title": "We couldn't load the product",
	"product_detail_load_error_description": "Check your connection and try again.",
	"product_detail_retry": "Retry"
```

Paraglide rigenera `src/paraglide/messages` al prossimo `dev`/`build`; se il typecheck non vede `m.product_detail_*`, lanciare `bun run --cwd apps/customer build` una volta.

- [ ] **Step 2: La tabella Caratteristiche**

`apps/customer/src/features/products/product-characteristics.tsx`:

```tsx
import { m } from "@/paraglide/messages";
import { characteristicRows } from "./format-characteristic";
import type { ProductCharacteristicView } from "./product-detail-api";

/**
 * Solo le voci valorizzate: il formattatore scarta ciò che non si può
 * mostrare, e senza righe la sezione non esiste (nemmeno il titolo).
 * Tabella vera, con l'intestazione di riga: uno screen reader legge
 * «Peso, 250 g» come coppia.
 */
export function ProductCharacteristics({
	characteristics,
}: {
	characteristics: ProductCharacteristicView[];
}) {
	const rows = characteristicRows(characteristics, {
		yes: m.product_detail_yes(),
		no: m.product_detail_no(),
	});
	if (rows.length === 0) return null;

	return (
		<section aria-labelledby="product-characteristics-title" className="space-y-3">
			<h2
				id="product-characteristics-title"
				className="font-display font-semibold text-foreground text-lg"
			>
				{m.product_detail_characteristics_title()}
			</h2>
			<table className="w-full table-fixed border-collapse text-sm">
				<tbody>
					{rows.map((row) => (
						<tr key={row.id} className="border-border border-b last:border-b-0">
							<th
								scope="row"
								className="w-2/5 py-2.5 pr-4 text-left align-top font-normal text-muted-foreground"
							>
								{row.name}
							</th>
							<td className="py-2.5 align-top text-foreground break-words [overflow-wrap:anywhere]">
								{row.value}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</section>
	);
}
```

`break-words` più `overflow-wrap:anywhere`: gli *Ingredienti* sono prosa lunga fino a 2000 caratteri, e un codice senza spazi non deve allargare la pagina a 390 px.

- [ ] **Step 3: La galleria**

`apps/customer/src/features/products/product-gallery.tsx`:

```tsx
import { useState } from "react";
import { TileImage } from "@/components/tile";
import { m } from "@/paraglide/messages";

/**
 * Foto principale quadrata e, se ce n'è più d'una, miniature che la
 * sostituiscono. Senza foto, il segnaposto dei tile.
 */
export function ProductGallery({
	images,
	name,
}: {
	images: { id: string; url: string }[];
	name: string;
}) {
	const [index, setIndex] = useState(0);
	const current = images[index] ?? images[0];

	return (
		<div className="space-y-3">
			<div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
				<TileImage url={current?.url} name={name} />
			</div>
			{images.length > 1 && (
				<ul
					aria-label={m.product_detail_gallery_aria()}
					className="flex gap-2 overflow-x-auto pb-1"
				>
					{images.map((img, i) => (
						<li key={img.id} className="shrink-0">
							<button
								type="button"
								aria-label={m.product_detail_photo_aria({ index: i + 1 })}
								aria-pressed={i === index}
								onClick={() => setIndex(i)}
								className="block size-16 overflow-hidden rounded-md border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-foreground"
							>
								<img
									src={img.url}
									alt=""
									loading="lazy"
									decoding="async"
									className="size-full object-cover"
								/>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
```

Prima di usare `TileImage` controllarne la firma in `apps/customer/src/components/tile.tsx:27` (`url`, `name`): se richiede altro, adeguare la chiamata, non il componente. Le miniature da 64 px sono tap target sopra i 44 px.

- [ ] **Step 4: Il negozio agganciato**

`apps/customer/src/features/products/product-offer.tsx`:

```tsx
import { DiscountedPrice } from "@bibs/ui/components/discounted-price";
import { Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import { formatDistance } from "@/components/tile";
import { AddToCart } from "@/features/cart/add-to-cart";
import { m } from "@/paraglide/messages";
import type { ProductDetailView } from "./product-detail-api";

/**
 * Prezzo, negozio e carrello: il blocco che vende. Saffron solo sull'icona del
 * luogo (la «presenza» di DESIGN.md), il resto è inchiostro su carta.
 */
export function ProductOffer({ product }: { product: ProductDetailView }) {
	const { offer } = product;
	const others = product.otherStoreCount;

	return (
		<div className="space-y-5">
			<DiscountedPrice
				size="lg"
				className="font-semibold text-foreground tabular-nums"
				originalPrice={product.price}
				discountedPrice={product.discountedPrice}
				percent={product.discountPercent}
			/>

			<div className="space-y-3 border-border border-t pt-5">
				{product.requestedStoreUnavailable && (
					<p className="text-muted-foreground text-sm">
						{m.product_detail_requested_store_unavailable()}
					</p>
				)}
				<p className="text-muted-foreground text-xs">
					{m.product_detail_sold_by()}
				</p>
				<div className="flex items-start gap-2">
					<MapPin className="mt-0.5 size-4 shrink-0 text-saffron-deep" aria-hidden />
					<div className="min-w-0 text-sm leading-snug">
						<Link
							to="/stores/$storeId"
							params={{ storeId: offer.store.id }}
							className="font-medium text-foreground hover:underline"
						>
							{offer.store.name}
						</Link>
						<span className="block text-muted-foreground">
							{offer.store.municipality.name} ({offer.store.municipality.provinceAcronym})
							{offer.distance !== null && offer.distance > 0 && (
								<> · <span className="tabular-nums">{formatDistance(offer.distance)}</span></>
							)}
						</span>
					</div>
				</div>
				<div className="max-w-xs">
					<AddToCart
						storeProductId={offer.storeProductId}
						stock={offer.stock}
						productName={product.name}
					/>
				</div>
				{others > 0 && (
					<p className="text-muted-foreground text-xs">
						{others === 1
							? m.product_detail_other_stores_one()
							: m.product_detail_other_stores({ count: others })}
					</p>
				)}
			</div>
		</div>
	);
}
```

Il link `/stores/$storeId`: copiare la forma esatta da `product-tile.tsx` (se lì passa anche `search`, passarla uguale), perché il typecheck del router la pretende.

- [ ] **Step 5: La route**

`apps/customer/src/routes/_authenticated/products/$productId.tsx`:

```tsx
import { Button } from "@bibs/ui/components/button";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Compass, RotateCw } from "lucide-react";
import { NoticePage } from "@/components/notice";
import { PAGE_CONTAINER } from "@/components/page";
import { ProductCharacteristics } from "@/features/products/product-characteristics";
import { ProductGallery } from "@/features/products/product-gallery";
import { ProductOffer } from "@/features/products/product-offer";
import { useProductDetail } from "@/features/products/use-product-detail";
import { m } from "@/paraglide/messages";

interface ProductDetailSearch {
	/** Il negozio da cui arriva il cliente. Mai coordinate nell'URL. */
	store?: string;
}

export const Route = createFileRoute("/_authenticated/products/$productId")({
	validateSearch: (search: Record<string, unknown>): ProductDetailSearch => ({
		store: typeof search.store === "string" ? search.store : undefined,
	}),
	component: ProductDetailPage,
});

/**
 * Foto a sinistra e, da `lg`, colonna di acquisto a destra; sotto `lg` tutto
 * si impila: foto, nome, prezzo e negozio, poi descrizione e caratteristiche.
 */
const LAYOUT_GRID =
	"grid items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:gap-x-14";

function ProductDetailSkeleton() {
	return (
		<div className={`${PAGE_CONTAINER} py-8 sm:py-10`}>
			<div className={LAYOUT_GRID}>
				<Skeleton className="aspect-square w-full" />
				<div className="space-y-4">
					<Skeleton className="h-8 w-3/4" />
					<Skeleton className="h-6 w-24" />
					<Skeleton className="h-32 w-full" />
				</div>
			</div>
		</div>
	);
}

function ProductDetailPage() {
	const { productId } = Route.useParams();
	const { store } = Route.useSearch();
	const { data: product, isPending, isError, refetch } = useProductDetail(
		productId,
		store,
	);

	if (isPending) return <ProductDetailSkeleton />;

	if (isError) {
		return (
			<NoticePage
				icon={RotateCw}
				title={m.product_detail_load_error_title()}
				description={m.product_detail_load_error_description()}
				action={
					<Button variant="secondary" size="sm" onClick={() => refetch()}>
						<RotateCw className="size-4" aria-hidden />
						{m.product_detail_retry()}
					</Button>
				}
			/>
		);
	}

	if (!product) {
		return (
			<NoticePage
				icon={Compass}
				title={m.product_detail_not_found_title()}
				description={m.product_detail_not_found_description()}
				action={
					<Button asChild variant="secondary" size="sm">
						<Link to="/products">{m.product_detail_back_to_products()}</Link>
					</Button>
				}
			/>
		);
	}

	const kicker = [product.brandName, product.category?.name]
		.filter(Boolean)
		.join(" · ");

	return (
		<div className={`${PAGE_CONTAINER} py-8 sm:py-10`}>
			<div className={LAYOUT_GRID}>
				<ProductGallery images={product.images} name={product.name} />

				<div className="min-w-0 space-y-6">
					<header className="space-y-2">
						{kicker && (
							<p className="text-muted-foreground text-sm">{kicker}</p>
						)}
						<h1 className="font-bold font-display text-[clamp(1.625rem,3vw,2.125rem)] text-foreground leading-[1.18] tracking-[-0.015em] break-words">
							{product.name}
						</h1>
					</header>

					<ProductOffer product={product} />
				</div>

				<div className="min-w-0 space-y-10 lg:col-span-2 lg:max-w-3xl">
					{product.description && (
						<section className="space-y-3">
							<h2 className="font-display font-semibold text-foreground text-lg">
								{m.product_detail_description_title()}
							</h2>
							<p className="max-w-[65ch] whitespace-pre-line text-foreground leading-relaxed">
								{product.description}
							</p>
						</section>
					)}
					<ProductCharacteristics characteristics={product.characteristics} />
				</div>
			</div>
		</div>
	);
}
```

Il `<Link to="/products">` verso la ricerca: se il router pretende `search` (la route indice ha `validateSearch` con tutti i campi opzionali, quindi di norma no), passare `search={{}}`. La `NoticePage` di `/stores/$storeId` è il riferimento per la forma.

- [ ] **Step 6: Rigenerare l'albero delle route e verificare**

Run:
```bash
bun run --cwd apps/customer build; echo $?
git status --short apps/customer/src/routeTree.gen.ts
bun run --cwd apps/customer typecheck; echo $?
cd apps/customer && bun test
```
Expected: build `0`; `routeTree.gen.ts` modificato (compare `/_authenticated/products/$productId`); typecheck `0`; test PASS. Il build è anche il controllo SSR: non deve comparire `window is not defined`.

- [ ] **Step 7: Commit**

```bash
git add apps/customer/src/routes/_authenticated/products/\$productId.tsx apps/customer/src/routeTree.gen.ts apps/customer/src/features/products/ apps/customer/messages/it.json apps/customer/messages/en.json
git commit -m "feat(customer): scheda prodotto con la tabella caratteristiche" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Customer — i tile portano alla scheda

**Files:**
- Modify: `apps/customer/src/features/catalog/product-tile.tsx`, `apps/customer/src/features/stores/store-products.tsx`

**Interfaces:**
- Consumes: la route del Task 5 (`/products/$productId`, search `{ store?: string }`).
- Produces: `ProductTile` con la prop nuova opzionale `storeId?: string`: il negozio da mettere nel link quando `product.store` manca (catalogo della scheda negozio). `nearby-products.tsx` e `products/index.tsx` non cambiano: i loro prodotti hanno `store`.

- [ ] **Step 1: Il tile**

In `apps/customer/src/features/catalog/product-tile.tsx`:

1. Sostituire il commento del componente (quello che dice «non esiste ancora una pagina di dettaglio prodotto») con:

```ts
/**
 * Tile prodotto presentazionale. Portano alla scheda l'immagine e il nome, non
 * l'intero riquadro: dentro ci sono altri controlli (il link al negozio, lo
 * stepper del carrello) e un'area cliccabile che li contiene darebbe click
 * ambigui. Il link porta con sé il negozio del tile, così la scheda aggancia
 * lo stesso.
 */
```

2. Aggiungere a `ProductTileProps`:

```ts
	/**
	 * Il negozio da mettere nel link alla scheda quando il prodotto non ne
	 * porta uno (catalogo della scheda negozio: il negozio è la pagina).
	 */
	storeId?: string;
```

3. Nel componente, destrutturare `storeId` e calcolare il link:

```tsx
	const linkProps = {
		to: "/products/$productId",
		params: { productId: product.id },
		search: { store: product.store?.id ?? storeId },
	} as const;
```

4. Avvolgere il riquadro dell'immagine e il nome:

```tsx
			<Link
				{...linkProps}
				tabIndex={-1}
				aria-hidden
				className="relative block aspect-square overflow-hidden rounded-lg border border-border"
			>
				<TileImage url={cover} name={product.name} />
				{hasDistance && ( /* la pill della distanza, invariata */ )}
			</Link>
```

(il `div` con `relative aspect-square overflow-hidden rounded-lg border border-border` diventa questo `Link`; il contenuto resta identico). E:

```tsx
				<h3 className="line-clamp-2 font-medium text-[0.9375rem] text-foreground leading-snug">
					<Link {...linkProps} className="hover:underline focus-visible:underline">
						{product.name}
					</Link>
				</h3>
```

L'immagine è `tabIndex={-1}` e `aria-hidden`: un solo punto di tab e un solo annuncio per prodotto, il nome.

- [ ] **Step 2: Il catalogo del negozio**

In `apps/customer/src/features/stores/store-products.tsx`, nel `ProductTile` aggiungere `storeId={storeId}`:

```tsx
								<ProductTile
									product={product}
									storeId={storeId}
									showDistance={false}
									action={ /* invariato */ }
								/>
```

- [ ] **Step 3: Verificare**

Run:
```bash
bun run --cwd apps/customer typecheck; echo $?
cd apps/customer && bun test
bun run --cwd apps/customer build; echo $?
git status --short apps/customer/src/routeTree.gen.ts
```
Expected: `0`, PASS, `0`, e `routeTree.gen.ts` **non** cambia rispetto al Task 5.

- [ ] **Step 4: Commit**

```bash
git add apps/customer/src/features/catalog/product-tile.tsx apps/customer/src/features/stores/store-products.tsx
git commit -m "feat(customer): i tile prodotto portano alla scheda" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Collaudo nel browser

Non sostituisce lo smoke di Marco: serve a portarglielo senza difetti evidenti. Nessuna riga di codice, salvo le correzioni che il collaudo trova (ognuna con il suo commit, e il collaudo si ripete dal passo che ha fallito).

**Regole di questo task**, in aggiunta ai Global Constraints: sul customer si legge soltanto (il carrello **non** si tocca). L'unica scrittura è il prodotto `Collaudo PR5 date` dello Step 5, creato dal seller e poi cancellato; nessun interruttore dell'admin si tocca.

- [ ] **Step 1: Preparare**

Con API (`:3000`), customer (`:3001`) e seller (`:3002`) in esecuzione (se non lo sono: `bun run dev` dalla radice), scegliere tre prodotti del seed, **visibili** (attivi, in un negozio visibile con giacenza):

```bash
docker exec -i bibs-postgis psql -U pgadmin -d bibs-db <<'SQL'
WITH visible AS (
  SELECT DISTINCT p.id, p.name, p.product_category_id
  FROM products p
  JOIN store_products sp ON sp.product_id = p.id AND sp.stock > 0
  JOIN stores s ON s.id = sp.store_id AND s.deleted_at IS NULL
  WHERE p.status = 'active'
    AND EXISTS (SELECT 1 FROM store_subscriptions ss WHERE ss.store_id = s.id
                AND ss.status IN ('active','past_due','canceling'))
)
SELECT v.id, v.name,
       count(*) FILTER (WHERE pv.data_type = 'boolean') AS bool,
       count(*) FILTER (WHERE pv.data_type = 'boolean' AND pv.value_boolean = false) AS bool_false,
       count(*) FILTER (WHERE pv.data_type = 'number') AS num,
       count(*) FILTER (WHERE pv.data_type = 'enum') AS enum,
       count(*) FILTER (WHERE pv.data_type = 'text') AS txt,
       max(length(pv.value_text)) AS longest_text
FROM visible v
LEFT JOIN product_characteristic_values pv ON pv.product_id = v.id
GROUP BY v.id, v.name
ORDER BY (count(*) FILTER (WHERE pv.data_type = 'boolean' AND pv.value_boolean = false) > 0) DESC,
         count(pv.*) DESC
LIMIT 10;
SQL
```

Annotare **nome e id** di: **A**, un prodotto con valori di almeno tre tipi e, se c'è, un sì/no a `false`; **B**, il prodotto con il testo più lungo; **C**, un prodotto visibile **senza** valori (`LEFT JOIN` a zero). Per A, l'ordine atteso:

```bash
docker exec -i bibs-postgis psql -U pgadmin -d bibs-db -c "SELECT c.name, pv.data_type, pv.value_text, pv.value_number, pv.value_boolean, o.value AS option, c.unit FROM product_characteristic_values pv JOIN products p ON p.id = pv.product_id JOIN product_characteristics c ON c.id = pv.characteristic_id JOIN product_category_characteristics pcc ON pcc.characteristic_id = pv.characteristic_id AND pcc.product_category_id = p.product_category_id LEFT JOIN product_characteristic_options o ON o.id = pv.option_id WHERE pv.product_id = '<A>' ORDER BY pcc.sort_order, c.name;"
```

E i conteggi di partenza:

```bash
docker exec -i bibs-postgis psql -U pgadmin -d bibs-db -c "SELECT (SELECT count(*) FROM products) AS products, (SELECT count(*) FROM product_characteristic_values) AS values, (SELECT count(*) FROM store_products) AS store_products, (SELECT count(*) FROM cart_items) AS cart_items;"
```

- [ ] **Step 2: Dal tile alla scheda**

Login customer come `customer1@test.com` / `password123`. Da `/products` cercare A per nome; verificare che il nome sul tile e l'immagine portino a `/products/<A>?store=<id del negozio del tile>` (URL senza `lat`/`lng`), e che nella scheda il negozio agganciato sia **quello del tile**. Poi da una scheda negozio che ha A (catalogo) cliccare il nome: stessa verifica, `store` = quel negozio. Con la tastiera: Tab sul tile arriva **una volta** sul nome (non sull'immagine), Invio apre la scheda.

- [ ] **Step 3: La tabella**

Sulla scheda di A, a 1280 px:

- le righe coincidono, nell'ordine, con la query dello Step 1; nessuna riga ha la cella vuota; ogni numero ha la virgola decimale e l'unità (`getComputedStyle` non serve: leggere `textContent` di ogni `td`, e verificare che fra numero e unità ci sia ` `); un sì/no a `false` si legge «No»; una lista chiusa mostra l'etichetta, non un UUID;
- geometria, con `getBoundingClientRect()`: la tabella non esce dalla sua colonna (`table.right <= colonna.right`), e la colonna del nome è il 40% della tabella (±1 px).

Su B: il testo lungo va a capo dentro la cella, `document.documentElement.scrollWidth === window.innerWidth`, **e** `td.getBoundingClientRect().right <= table.getBoundingClientRect().right` (lo `scrollWidth` da solo è un verde falso se qualcosa taglia con `overflow-hidden`).

Su C: la sezione *Caratteristiche* **non esiste nel DOM** (`document.getElementById('product-characteristics-title') === null`), e la pagina non ha buchi al suo posto.

- [ ] **Step 4: 390 px e tema scuro**

A 390 px di larghezza, su A e su B: tutto impilato (foto, nome, prezzo, negozio, descrizione, caratteristiche), `scrollWidth === innerWidth`, ogni `tr` dentro i 390 px meno le gutter, le miniature della galleria alte ≥ 44 px. Poi `localStorage.theme = 'dark'` e ricarica: testo della tabella, intestazioni di riga e separatori leggibili (misurare il contrasto di `th` e `td` sul fondo con il metodo canvas 1×1 della memoria `feedback_measure_contrast_oklch_canvas`: AA ≥ 4.5 per il testo piccolo), nessuna superficie rimasta chiara. Riportare i valori misurati. Ripristinare il tema.

- [ ] **Step 5: La trappola delle date, dal vivo**

Il seed non ha testi simili a date, quindi se ne crea uno su un prodotto di prova. Dal seller (`seller@dev.bibs`): *Prodotti → Nuovo*, nome `Collaudo PR5 date`, prezzo `1.00`, una sotto-categoria che abbia `Scadenza/TMC` (trovarla con `SELECT pc.id, pc.name FROM product_category_characteristics pcc JOIN product_characteristics c ON c.id = pcc.characteristic_id JOIN product_categories pc ON pc.id = pcc.product_category_id WHERE c.name = 'Scadenza/TMC' LIMIT 3;`), `Scadenza/TMC` = `05/03/2027`, salvare; poi giacenza `1` in uno dei negozi del seller. Sul customer aprire `/products/<id>`: la riga *Scadenza/TMC* dice **esattamente** `05/03/2027`. Aprire anche la richiesta di rete della scheda e verificare che nel JSON ci sia la stessa stringa.

Pulizia: dal seller spostare `Collaudo PR5 date` nel cestino e cancellarlo definitivamente. Ripetere i conteggi dello Step 1: **i quattro numeri devono coincidere** con quelli di partenza.

- [ ] **Step 6: Negozio richiesto e 404**

- `/products/<A>?store=inesistente`: la scheda si apre, aggancia un altro negozio e mostra «Non è più disponibile nel negozio da cui arrivi»;
- `/products/inesistente`: *Prodotto non trovato* con il bottone che riporta a `/products`;
- la console del browser è pulita (nessun errore di idratazione) su tutte le schede aperte.

Riportare: nomi e id di A, B e C, le misure, i conteggi prima e dopo, ogni scostamento.

---

## Chiusura della PR

- [ ] `bun run lint` (Biome): pulito.
- [ ] Typecheck workspace per workspace, `apps/api`, `apps/customer`, `apps/seller`, `apps/admin`, `packages/ui`, ciascuno con `$?` a 0.
- [ ] `bun run --cwd apps/api test`: `0 fail`, totali = baseline (592 d'integrazione, 303 unitari) **+ 8 unitari e + 19 d'integrazione**. Poi `bun run test` dalla radice (emails, api, customer): il customer ha **+ 13** test.
- [ ] `bun run --cwd apps/api build` e `bun run --cwd apps/customer build`: riusciti.
- [ ] `bun run db:generate`: «No schema changes».
- [ ] Con l'API in esecuzione, `curl -s localhost:3000/openapi/json | jq '.paths | keys[] | select(test("customer/products"))'` elenca `/customer/products/{id}`, con `description` in italiano.
- [ ] `git diff main...HEAD --stat`: nessun file fuori dalla sezione «Struttura dei file» (più questo piano); `routeTree.gen.ts` compare.
- [ ] Revisione finale dell'intero branch (subagente), prima dello smoke.
- [ ] **Smoke di Marco nel browser** prima di aprire la PR: su UI il gate è «Marco l'ha provata», non «i test sono verdi». Da segnalargli: C1 (la PR crea anche la scheda, in forma minima), C3 (il messaggio quando il negozio richiesto non ce l'ha più), C9 (sul tile sono cliccabili solo immagine e nome), e i prodotti A, B, C del collaudo con i loro id.
- [ ] Aprire la PR verso `main` citando spec e piano, con fuori ambito dichiarato (filtri e facet sulle caratteristiche, caratteristiche nel CSV massivo, recensioni e prodotti correlati), chiudendo con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] Dopo il merge: `git fetch --prune` e cancellare i branch locali `[gone]`.
