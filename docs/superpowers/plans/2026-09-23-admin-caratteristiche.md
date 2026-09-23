# Admin delle caratteristiche — piano di implementazione (PR 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare all'amministratore un'interfaccia per ritoccare il dizionario delle caratteristiche e decidere, sotto-categoria per sotto-categoria, quali si applicano — senza mai lasciare valori dormienti sui prodotti.

**Architecture:** Lato API, un modulo di conteggi estratto dall'import della PR 2 (`characteristic-impact.ts`) diventa l'unica fonte dei numeri che le conferme mostrano; tutte e tre le uscite dalla matrice (rimozione di una caratteristica da una sotto-categoria, cancellazione dal dizionario, rimozione di un'opzione o cambio di tipo) cancellano i valori nella stessa transazione, e solo se il client dichiara in `confirmAffected` di aver mostrato almeno quel numero. Lato admin, il dizionario è la quinta configurazione di `CategoryCrudPanel`; la matrice è un pannello laterale aperto da una pastiglia `N caratteristiche` nella tabella delle sotto-categorie.

**Tech Stack:** Bun, Elysia, Drizzle ORM, PostgreSQL 18, TypeBox, `bun:test` con testcontainers; admin in TanStack Start + TanStack Query/Table, react-hook-form + zod, `@bibs/ui`.

**Spec:** [`docs/superpowers/specs/2026-09-22-caratteristiche-prodotto-design.md`](../specs/2026-09-22-caratteristiche-prodotto-design.md) — sezioni «Invariante centrale (D10)» e «Admin». Questo piano copre la **PR 3** delle cinque. PR 1 in `43c35da`, PR 2 in `10fe3bf`. La nota di revisione (`docs/products/caratteristiche-nota-di-revisione.md`) è stata rivista da Marco senza correzioni: i due CSV restano come sono.

## Global Constraints

- **Nessun commit diretto su `main`.** Branch `feat/product-characteristics-admin`, già creato da `main` a `10fe3bf`.
- **Conventional Commits** con scope dalla lista del repo: qui `api`, `admin`, `products`. Descrizione minuscola, imperativa, **prima riga sotto i 72 caratteri — misurala**.
- **Ogni commit chiude con** `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Mai `--no-verify`**. Mai `bun run db:reset`, `db:push`, `db:seed` o `infra:reset` senza conferma esplicita di Marco.
- **Nessuna modifica allo schema del database** in questa PR: `bun run db:generate` deve rispondere «No schema changes» alla fine di ogni task.
- **Biome**: rientri a tabulazione, virgolette doppie, file in kebab-case.
- **`ServiceError` accetta solo `(status, message)`.** Il frontend discrimina per status, mai per codice custom.
- **Copy in italiano** su ogni superficie utente e in ogni `description` OpenAPI. **Nomi dei test in inglese**, come tutti i loro fratelli. Nell'admin la copy è scritta direttamente nei componenti, come in `CategoryCrudPanel` e nelle sue configurazioni (niente Paraglide in queste superfici).
- **D10, nessun valore dormiente**: ogni atto che fa uscire una caratteristica dalla matrice di un prodotto cancella i suoi valori **nella stessa transazione**, **prima** della definizione (le chiavi esterne dei valori sono `RESTRICT` apposta: un percorso che saltasse il primo passo deve fallire).
- **Protocollo di conferma**: i tre endpoint distruttivi accettano `confirmAffected` (intero ≥ 0, il numero di prodotti che l'interfaccia ha mostrato). Il service ricalcola il numero dentro la transazione; se è **maggiore** di `confirmAffected` risponde `409` senza toccare nulla. Un numero uguale o minore passa: cancellare meno di quanto si è approvato è sicuro.
- **Un valore per (prodotto, caratteristica)**: la PK di `product_characteristic_values` lo garantisce, quindi «valori» e «prodotti» coincidono in ogni conteggio di questo piano. La copy dice «prodotti».
- **Sottoquery correlate in un campo SELECT**: le `Column` interpolate in un template `sql` usato come campo escono **senza qualificazione** e la correlazione si rompe in silenzio. Alias esplicito sulla tabella interna e riferimento **letterale** alla tabella esterna (`pcc.product_category_id = product_categories.id`), mai `${productCategory.id}`.
- **React Compiler ↔ TanStack Table**: ogni componente che possiede lo stato di una tabella porta `"use no memo";` come **prima istruzione** del corpo.
- **react-hook-form**: niente effetto `useEffect(() => reset(defaultValues))` nei form nuovi — i dialog rimontano il form (il panel lo avvolge in `key={selected.id}`), e quel `reset` con riferimento instabile desincronizza le select.
- **Selezione fra molti elementi**: una sola tabella con lo stato sulla riga e schede `Tutte / Incluse`, mai due riquadri affiancati.
- **Toast** da `@bibs/ui/components/sonner`, mai da `sonner` diretto.
- **Liste paginate**: `limit` massimo 100. L'elenco della matrice per sotto-categoria non è paginato (è limitato dalla dimensione del dizionario, ~207 voci), come `GET /seller/products/categories` che risponde già con un array.
- **Test negativi**: `expect(promise).rejects` su un query-builder Drizzle non scatta; qui i test chiamano funzioni di service `async`, quindi `await expect(fn()).rejects.toMatchObject({ status: 409 })` funziona. Per leggere il messaggio usare il `try/catch` già in uso in `admin-product-categories.test.ts`.
- **Suite completa**: sempre `bun run --cwd apps/api test`, mai `cd apps/api && bun test` nudo (salta `--isolate` e fa fallire apposta `tests/integration/isolation-guard-2.test.ts`: un rosso lì è l'invocazione sbagliata, non una regressione).
- **Singolo file di test**: `cd apps/api && bun test <percorso>` (lo script `test` è composto e non passa l'argomento al primo comando).
- **I subagenti su questo repo sono lenti, non bloccati**: la suite completa gira per minuti. Controllare `git status` e aspettare, non ridispacciare.
- **Typecheck workspace per workspace**, mai `bun run typecheck` aggregato come prova: `bun run --cwd apps/api typecheck`, `bun run --cwd apps/admin typecheck`, `bun run --cwd apps/seller typecheck`, `bun run --cwd apps/customer typecheck`, controllando `$?` di ciascuno. Le rotte API cambiano i tipi Eden di tutti e tre i frontend.
- **Credenziali di sviluppo**: admin `admin1@test.com` / `password123`; admin su `localhost:3003`, API su `localhost:3000`.
- psql: `docker exec -i bibs-postgis psql -U pgadmin -d bibs-db` — il `-i` è obbligatorio.

---

## Struttura dei file

| File | Responsabilità |
|---|---|
| `apps/api/src/modules/admin/services/characteristic-impact.ts` | **nuovo** — i conteggi dei valori a rischio e la guardia di conferma |
| `apps/api/src/modules/admin/services/characteristic-import.ts` | usa i conteggi estratti invece delle query in linea |
| `apps/api/src/modules/admin/services/product-characteristics.ts` | **nuovo** — CRUD del dizionario |
| `apps/api/src/modules/admin/routes/product-characteristics.ts` | **nuovo** — `GET/POST /admin/product-characteristics`, `PATCH/DELETE /admin/product-characteristics/:characteristicId` |
| `apps/api/src/modules/admin/services/category-characteristics.ts` | **nuovo** — elenco admin delle sotto-categorie con conteggio, e la matrice di una sotto-categoria |
| `apps/api/src/modules/admin/routes/category-characteristics.ts` | **nuovo** — `GET /admin/product-categories` e `GET/PUT/DELETE /admin/product-categories/:productCategoryId/characteristics[/:characteristicId]` |
| `apps/api/src/modules/admin/index.ts` | registra le due rotte nuove |
| `apps/api/src/modules/admin/services/configurations.ts`, `routes/configurations.ts` | contatore `productCharacteristics` |
| `apps/api/src/lib/schemas/entities.ts` | gli schemi TypeBox nuovi |
| `apps/api/src/lib/queries.ts` | `ProductCategoryListQuery` (spostata dal modulo pubblico) e `CharacteristicListQuery` |
| `apps/api/src/modules/product-categories.ts` | importa `ProductCategoryListQuery` da `lib/queries` |
| `apps/api/tests/integration/admin-characteristic-impact.test.ts` | **nuovo** |
| `apps/api/tests/integration/admin-product-characteristics.test.ts` | **nuovo** |
| `apps/api/tests/integration/admin-category-characteristics.test.ts` | **nuovo** |
| `apps/admin/src/features/crud/category-crud-panel.tsx` | `remove` e `deleteDescription` ricevono anche l'entità |
| `apps/admin/src/features/csv-import/components/csv-import-dialog.tsx` | il risultato può riportare `updated` invece di `skipped` |
| `apps/admin/src/features/product-characteristics/**` | **nuovo** — configurazione, form, etichette dei tipi, calcolo dell'impatto |
| `apps/admin/src/features/category-characteristics/**` | **nuovo** — pastiglia, pannello laterale, hook dati |
| `apps/admin/src/features/product-categories/product-categories.config.tsx` | lista dall'endpoint admin, colonna *Caratteristiche* |
| `apps/admin/src/routes/_authenticated/configurations.tsx` | scheda *Caratteristiche Prodotto* |

Fuori da questa PR, per scelta: un'interfaccia per l'import CSV della **matrice** (l'endpoint esiste dalla PR 2 e lo usa il seed; il pannello condiviso ha un solo slot di import e sulla scheda delle sotto-categorie è già occupato dall'import delle categorie), il riordino dei campi (`sortOrder` non si espone, come da spec), il riordino delle opzioni di una lista chiusa.

---

### Task 1: Estrarre i conteggi dall'import

Il refactoring che tutti gli altri task consumano. L'import della PR 2 contiene già due conteggi — i valori di una caratteristica (prima di un cambio di tipo) e i valori collegati a un insieme di opzioni (prima di cancellarle) — scritti in linea. Si estraggono in un modulo, se ne aggiunge un terzo (i valori di una caratteristica sui prodotti di una sotto-categoria) e la guardia di conferma. **Il comportamento dell'import non cambia**: i suoi test esistenti sono la prova.

**Files:**
- Create: `apps/api/src/modules/admin/services/characteristic-impact.ts`
- Modify: `apps/api/src/modules/admin/services/characteristic-import.ts` (le due query in `importCharacteristicsFromCsv`: il blocco `if (current.dataType !== parsed.dataType)` e il blocco `if (toDeleteOptions.length > 0)`)
- Test: `apps/api/tests/integration/admin-characteristic-impact.test.ts`

**Interfaces:**
- Consumes: `productCharacteristicValue` (`@/db/schemas/product-characteristic`), `product` (`@/db/schemas/product`).
- Produces:
  - `type Executor` — `db` oppure la `tx` di una transazione Drizzle.
  - `countValuesByCharacteristic(characteristicIds: string[], executor?: Executor): Promise<Map<string, number>>`
  - `countValuesByOption(optionIds: string[], executor?: Executor): Promise<Map<string, number>>`
  - `countCategoryCharacteristicValues(productCategoryId: string, characteristicId: string, executor?: Executor): Promise<number>`
  - `sumCounts(counts: Map<string, number>): number`
  - `productsPhrase(n: number): string` — `"1 prodotto"` / `"3 prodotti"`
  - `assertImpactConfirmed(affected: number, confirmed: number): void` — lancia `ServiceError(409, …)` se `affected > confirmed`.
  Le mappe contengono **solo** le chiavi con almeno un valore: chi legge usa `?? 0`.

- [ ] **Step 0: Misurare la baseline**

Run: `bun run --cwd apps/api test 2>&1 | tail -8`
Annotare `N pass / 0 fail / M expect` dell'ultimo blocco (integrazione). È il numero da confrontare alla fine di ogni task: una esecuzione troncata stampa comunque `0 fail`, conta il **totale**.

- [ ] **Step 1: Scrivere i test che falliscono**

Create `apps/api/tests/integration/admin-characteristic-impact.test.ts`:

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
	productCharacteristic,
	productCharacteristicOption,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { ServiceError } from "@/lib/errors";
import {
	assertImpactConfirmed,
	countCategoryCharacteristicValues,
	countValuesByCharacteristic,
	countValuesByOption,
	productsPhrase,
	sumCounts,
} from "@/modules/admin/services/characteristic-impact";
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

// Colore (enum Rosso|Blu) e Peso (number) su due sotto-categorie: tre prodotti
// Rosso in Smartphone, uno Blu in Tablet, un Peso in Smartphone.
async function seedValues() {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const macro = await createTestMacroCategory(db, "Elettronica");
	const phones = await createTestCategory(db, "Smartphone", macro.id);
	const tablets = await createTestCategory(db, "Tablet", macro.id);

	const [colore] = await db
		.insert(productCharacteristic)
		.values({ name: "Colore", dataType: "enum" })
		.returning();
	const [peso] = await db
		.insert(productCharacteristic)
		.values({ name: "Peso", dataType: "number", unit: "g" })
		.returning();
	const [rosso, blu] = await db
		.insert(productCharacteristicOption)
		.values([
			{ characteristicId: colore.id, value: "Rosso", sortOrder: 0 },
			{ characteristicId: colore.id, value: "Blu", sortOrder: 1 },
		])
		.returning();

	const phoneProducts = [];
	for (const name of ["A", "B", "C"]) {
		phoneProducts.push(
			await createTestProduct(db, seller.profile.id, {
				name,
				categoryIds: [phones.id],
			}),
		);
	}
	const tablet = await createTestProduct(db, seller.profile.id, {
		name: "D",
		categoryIds: [tablets.id],
	});

	await db.insert(productCharacteristicValue).values([
		...phoneProducts.map((p) => ({
			productId: p.id,
			characteristicId: colore.id,
			dataType: "enum" as const,
			optionId: rosso.id,
		})),
		{
			productId: tablet.id,
			characteristicId: colore.id,
			dataType: "enum" as const,
			optionId: blu.id,
		},
		{
			productId: phoneProducts[0].id,
			characteristicId: peso.id,
			dataType: "number" as const,
			valueNumber: "180",
		},
	]);

	return { phones, tablets, colore, peso, rosso, blu };
}

describe("countValuesByCharacteristic", () => {
	it("counts values per characteristic and omits the ones without values", async () => {
		const { colore, peso } = await seedValues();
		const [{ id: vuota }] = await getTestDb()
			.insert(productCharacteristic)
			.values({ name: "Modello", dataType: "text" })
			.returning();

		const counts = await countValuesByCharacteristic([colore.id, peso.id, vuota]);

		expect(counts.get(colore.id)).toBe(4);
		expect(counts.get(peso.id)).toBe(1);
		expect(counts.has(vuota)).toBe(false);
	});

	it("returns an empty map for an empty id list without querying", async () => {
		expect((await countValuesByCharacteristic([])).size).toBe(0);
	});
});

describe("countValuesByOption", () => {
	it("counts values per option", async () => {
		const { rosso, blu } = await seedValues();

		const counts = await countValuesByOption([rosso.id, blu.id]);

		expect(counts.get(rosso.id)).toBe(3);
		expect(counts.get(blu.id)).toBe(1);
		expect(sumCounts(counts)).toBe(4);
	});
});

describe("countCategoryCharacteristicValues", () => {
	it("counts only the values on products of that subcategory", async () => {
		const { phones, tablets, colore } = await seedValues();

		expect(await countCategoryCharacteristicValues(phones.id, colore.id)).toBe(3);
		expect(await countCategoryCharacteristicValues(tablets.id, colore.id)).toBe(1);
	});
});

describe("assertImpactConfirmed", () => {
	it("passes when the confirmation covers the impact", () => {
		expect(() => assertImpactConfirmed(0, 0)).not.toThrow();
		expect(() => assertImpactConfirmed(3, 3)).not.toThrow();
		// meno del confermato: si cancella meno di quanto approvato, è sicuro
		expect(() => assertImpactConfirmed(2, 3)).not.toThrow();
	});

	it("rejects with 409 an unconfirmed impact", () => {
		let caught: unknown;
		try {
			assertImpactConfirmed(1, 0);
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ServiceError);
		expect((caught as ServiceError).status).toBe(409);
		expect((caught as ServiceError).message).toBe(
			"L'operazione elimina i valori già compilati su 1 prodotto: serve una conferma esplicita.",
		);
	});

	it("rejects with 409 a confirmation that has gone stale", () => {
		let caught: unknown;
		try {
			assertImpactConfirmed(5, 3);
		} catch (e) {
			caught = e;
		}
		expect((caught as ServiceError).status).toBe(409);
		expect((caught as ServiceError).message).toBe(
			"I valori da eliminare sono cambiati: ora riguardano 5 prodotti, la conferma ne copriva 3. Ricarica e conferma di nuovo.",
		);
	});

	it("phrases singular and plural", () => {
		expect(productsPhrase(1)).toBe("1 prodotto");
		expect(productsPhrase(0)).toBe("0 prodotti");
		expect(productsPhrase(12)).toBe("12 prodotti");
	});
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `cd apps/api && bun test tests/integration/admin-characteristic-impact.test.ts`
Expected: FAIL — `Cannot find module '@/modules/admin/services/characteristic-impact'`.

- [ ] **Step 3: Scrivere il modulo**

Create `apps/api/src/modules/admin/services/characteristic-impact.ts`:

```ts
import {
	and,
	count,
	eq,
	type ExtractTablesWithRelations,
	inArray,
} from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { product } from "@/db/schemas/product";
import { productCharacteristicValue } from "@/db/schemas/product-characteristic";
import { ServiceError } from "@/lib/errors";

// Gli stessi conteggi servono all'import (fuori transazione, per rifiutare una
// riga) e alle modifiche admin (dentro la transazione che poi cancella, per
// confermare): accettano quindi sia `db` sia una `tx`.
export type Executor =
	| PgTransaction<any, any, ExtractTablesWithRelations<any>>
	| typeof db;

// Un prodotto ha al più un valore per caratteristica (PK product_id +
// characteristic_id), quindi ogni conteggio di valori qui sotto è anche un
// conteggio di prodotti. Le mappe contengono solo le chiavi con almeno un
// valore: chi legge usa `?? 0`.

export async function countValuesByCharacteristic(
	characteristicIds: string[],
	executor: Executor = db,
): Promise<Map<string, number>> {
	if (characteristicIds.length === 0) return new Map();
	const rows = await executor
		.select({
			id: productCharacteristicValue.characteristicId,
			cnt: count(),
		})
		.from(productCharacteristicValue)
		.where(inArray(productCharacteristicValue.characteristicId, characteristicIds))
		.groupBy(productCharacteristicValue.characteristicId);
	return new Map(rows.map((r) => [r.id, r.cnt]));
}

export async function countValuesByOption(
	optionIds: string[],
	executor: Executor = db,
): Promise<Map<string, number>> {
	if (optionIds.length === 0) return new Map();
	const rows = await executor
		.select({ id: productCharacteristicValue.optionId, cnt: count() })
		.from(productCharacteristicValue)
		.where(inArray(productCharacteristicValue.optionId, optionIds))
		.groupBy(productCharacteristicValue.optionId);
	// `optionId` è nullable nello schema, ma il WHERE lo esclude.
	return new Map(rows.map((r) => [r.id as string, r.cnt]));
}

export async function countCategoryCharacteristicValues(
	productCategoryId: string,
	characteristicId: string,
	executor: Executor = db,
): Promise<number> {
	const [{ cnt }] = await executor
		.select({ cnt: count() })
		.from(productCharacteristicValue)
		.innerJoin(product, eq(product.id, productCharacteristicValue.productId))
		.where(
			and(
				eq(product.productCategoryId, productCategoryId),
				eq(productCharacteristicValue.characteristicId, characteristicId),
			),
		);
	return cnt;
}

export function sumCounts(counts: Map<string, number>): number {
	let total = 0;
	for (const n of counts.values()) total += n;
	return total;
}

export function productsPhrase(n: number): string {
	return `${n} prodott${n === 1 ? "o" : "i"}`;
}

/**
 * La guardia di D10: un atto che cancella valori passa solo se il client
 * dichiara di aver mostrato almeno quel numero. Il conteggio si rifà dentro la
 * transazione dell'atto, quindi una conferma data su un numero vecchio e più
 * basso viene respinta invece di cancellare più di quanto approvato.
 */
export function assertImpactConfirmed(affected: number, confirmed: number) {
	if (affected <= confirmed) return;
	if (confirmed === 0) {
		throw new ServiceError(
			409,
			`L'operazione elimina i valori già compilati su ${productsPhrase(affected)}: serve una conferma esplicita.`,
		);
	}
	throw new ServiceError(
		409,
		`I valori da eliminare sono cambiati: ora riguardano ${productsPhrase(affected)}, la conferma ne copriva ${confirmed}. Ricarica e conferma di nuovo.`,
	);
}
```

- [ ] **Step 4: Verificare che passino**

Run: `cd apps/api && bun test tests/integration/admin-characteristic-impact.test.ts`
Expected: PASS, 8 test.

- [ ] **Step 5: Far usare i conteggi all'import**

In `apps/api/src/modules/admin/services/characteristic-import.ts`:

1. Aggiungere l'import:
   ```ts
   import {
   	countValuesByCharacteristic,
   	countValuesByOption,
   	sumCounts,
   } from "./characteristic-impact";
   ```
2. Nel blocco del cambio di tipo, sostituire la query `db.select({ valueCount: count() })…` con:
   ```ts
   const valueCount =
   	(await countValuesByCharacteristic([current.id])).get(current.id) ?? 0;
   ```
   Il resto del blocco (`if (valueCount > 0) { errors.push(…); continue; }`) resta identico, messaggio compreso.
3. Nel blocco `if (toDeleteOptions.length > 0)`, sostituire la query `referencedRows` e i due calcoli che ne derivano con:
   ```ts
   const referenced = await countValuesByOption(toDeleteOptions.map((o) => o.id));

   if (referenced.size > 0) {
   	const valueById = new Map(existingOptions.map((o) => [o.id, o.value]));
   	const stillUsedValues = Array.from(referenced.keys()).map(
   		(id) => valueById.get(id) ?? "?",
   	);
   	const totalReferenced = sumCounts(referenced);
   ```
   e da `const optionsPhrase = …` in giù il blocco resta identico.
4. Togliere `count` dall'import di `drizzle-orm` se non è più usato nel file (Biome lo segnala).

- [ ] **Step 6: Verificare che l'import non sia cambiato**

Run: `cd apps/api && bun test tests/integration/admin-characteristic-import.test.ts tests/integration/admin-characteristic-impact.test.ts`
Expected: PASS, tutti — in particolare `refuses a type change on a characteristic that already has values` e i test sulle opzioni collegate, che verificano i messaggi alla lettera.

Run: `bun run --cwd apps/api typecheck && bunx biome check apps/api/src/modules/admin/services apps/api/tests/integration/admin-characteristic-impact.test.ts`
Expected: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/admin/services/characteristic-impact.ts \
	apps/api/src/modules/admin/services/characteristic-import.ts \
	apps/api/tests/integration/admin-characteristic-impact.test.ts
git commit -m "refactor(api): estrai i conteggi dei valori dall'import

I conteggi che l'import usava per rifiutare un cambio di tipo o la
rimozione di un'opzione in uso servono anche alle conferme dell'admin.
Aggiunge il conteggio per sotto-categoria e la guardia confirmAffected.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Dizionario — elenco, creazione, cancellazione

**Files:**
- Create: `apps/api/src/modules/admin/services/product-characteristics.ts`
- Create: `apps/api/src/modules/admin/routes/product-characteristics.ts`
- Modify: `apps/api/src/modules/admin/index.ts`, `apps/api/src/lib/schemas/entities.ts`, `apps/api/src/lib/queries.ts`, `apps/api/src/modules/admin/services/configurations.ts`, `apps/api/src/modules/admin/routes/configurations.ts`
- Test: `apps/api/tests/integration/admin-product-characteristics.test.ts`

**Interfaces:**
- Consumes: dal Task 1 `countValuesByCharacteristic`, `countValuesByOption`, `assertImpactConfirmed`, `type Executor`; `listByNamePaged` e `ListByNameParams` (`./list-by-name-paged`); `CHARACTERISTIC_DATA_TYPES`, `CharacteristicDataType`.
- Produces:
  - `interface CharacteristicOptionInput { id?: string; value: string }`
  - `normalizeDefinition(p: { dataType: CharacteristicDataType; unit?: string | null; options?: CharacteristicOptionInput[] }): { unit: string | null; options: CharacteristicOptionInput[] }` — esportata, la riusa il Task 3.
  - `listProductCharacteristics(params: ListByNameParams & { dataType?: CharacteristicDataType })` → `{ data: AdminCharacteristicRow[]; pagination }`, dove ogni riga è `{ id, name, dataType, unit, createdAt, updatedAt, valueCount, options: { id, value, sortOrder, valueCount }[] }` con le opzioni in `sortOrder`.
  - `createProductCharacteristic(p: { name: string; dataType: CharacteristicDataType; unit?: string | null; options?: CharacteristicOptionInput[] })` → la riga di `product_characteristics`.
  - `deleteProductCharacteristic(characteristicId: string, confirmAffected: number)` → `{ deleted, deletedValues: number }`.
  - Schemi: `CharacteristicDataTypeSchema`, `ProductCharacteristicSchema`, `AdminProductCharacteristicSchema`; query `CharacteristicListQuery`.
  - Rotte: `GET /admin/product-characteristics`, `POST /admin/product-characteristics`, `DELETE /admin/product-characteristics/:characteristicId` con body `{ confirmAffected: number }`.
  - `countConfigurations()` restituisce anche `productCharacteristics`.

- [ ] **Step 1: Scrivere i test che falliscono**

Create `apps/api/tests/integration/admin-product-characteristics.test.ts` con la stessa intestazione del Task 1 (import `bun:test`, `test-db`, `mock.module("@/db", …)` **prima** degli import del codice sotto test, `beforeAll`/`afterAll`/`beforeEach` con `truncateAll`), poi:

```ts
import { eq } from "drizzle-orm";
import {
	productCategoryCharacteristic,
	productCharacteristic,
	productCharacteristicOption,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { ServiceError } from "@/lib/errors";
import { countConfigurations } from "@/modules/admin/services/configurations";
import {
	createProductCharacteristic,
	deleteProductCharacteristic,
	listProductCharacteristics,
} from "@/modules/admin/services/product-characteristics";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCategory,
	createTestMacroCategory,
	createTestProduct,
	createTestSeller,
} from "../helpers/fixtures";

async function caught(fn: () => Promise<unknown>): Promise<ServiceError> {
	try {
		await fn();
	} catch (e) {
		if (e instanceof ServiceError) return e;
		throw e;
	}
	throw new Error("expected a ServiceError");
}

// Un prodotto con Colore = Rosso.
async function giveRossoToOneProduct(colore: { id: string }) {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const p = await createTestProduct(db, seller.profile.id, { name: "P" });
	const [rosso] = await db
		.select()
		.from(productCharacteristicOption)
		.where(eq(productCharacteristicOption.value, "Rosso"));
	await db.insert(productCharacteristicValue).values({
		productId: p.id,
		characteristicId: colore.id,
		dataType: "enum",
		optionId: rosso.id,
	});
	return { product: p, rosso };
}

describe("createProductCharacteristic", () => {
	it("creates an enum with its options in order", async () => {
		const c = await createProductCharacteristic({
			name: " Colore ",
			dataType: "enum",
			options: [{ value: "Rosso" }, { value: " Blu " }, { value: "" }],
		});

		expect(c.name).toBe("Colore");
		const opts = await getTestDb()
			.select()
			.from(productCharacteristicOption)
			.where(eq(productCharacteristicOption.characteristicId, c.id));
		expect(
			opts.sort((a, b) => a.sortOrder - b.sortOrder).map((o) => o.value),
		).toEqual(["Rosso", "Blu"]);
	});

	it("keeps the unit only for numbers", async () => {
		const peso = await createProductCharacteristic({
			name: "Peso",
			dataType: "number",
			unit: "g",
		});
		expect(peso.unit).toBe("g");

		const err = await caught(() =>
			createProductCharacteristic({ name: "Modello", dataType: "text", unit: "g" }),
		);
		expect(err.status).toBe(400);
		expect(err.message).toBe(`L'unità di misura ha senso solo per il tipo "number"`);
	});

	it("rejects an enum without options, options on a non-enum and duplicates", async () => {
		expect(
			(await caught(() =>
				createProductCharacteristic({ name: "Colore", dataType: "enum", options: [] }),
			)).message,
		).toBe(`Il tipo "enum" richiede almeno un'opzione`);
		expect(
			(await caught(() =>
				createProductCharacteristic({
					name: "5G",
					dataType: "boolean",
					options: [{ value: "Sì" }],
				}),
			)).message,
		).toBe(`Le opzioni hanno senso solo per il tipo "enum"`);
		expect(
			(await caught(() =>
				createProductCharacteristic({
					name: "Colore",
					dataType: "enum",
					options: [{ value: "Rosso" }, { value: "Rosso " }],
				}),
			)).message,
		).toBe(`Opzione ripetuta: "Rosso"`);
	});
});

describe("listProductCharacteristics", () => {
	it("returns options in order with per-option and per-characteristic value counts", async () => {
		const colore = await createProductCharacteristic({
			name: "Colore",
			dataType: "enum",
			options: [{ value: "Rosso" }, { value: "Blu" }],
		});
		await createProductCharacteristic({ name: "Peso", dataType: "number", unit: "g" });
		await giveRossoToOneProduct(colore);

		const result = await listProductCharacteristics({ sortBy: "name", sortOrder: "asc" });

		expect(result.pagination.total).toBe(2);
		const [c, p] = result.data;
		expect(c.name).toBe("Colore");
		expect(c.valueCount).toBe(1);
		expect(c.options.map((o) => [o.value, o.valueCount])).toEqual([
			["Rosso", 1],
			["Blu", 0],
		]);
		expect(p.name).toBe("Peso");
		expect(p.valueCount).toBe(0);
		expect(p.options).toEqual([]);
	});

	it("filters by data type", async () => {
		await createProductCharacteristic({ name: "Peso", dataType: "number", unit: "g" });
		await createProductCharacteristic({ name: "Modello", dataType: "text" });

		const result = await listProductCharacteristics({ dataType: "number" });

		expect(result.data.map((c) => c.name)).toEqual(["Peso"]);
		expect(result.pagination.total).toBe(1);
	});
});

describe("deleteProductCharacteristic", () => {
	it("refuses with 409 when products have values and nothing is confirmed", async () => {
		const colore = await createProductCharacteristic({
			name: "Colore",
			dataType: "enum",
			options: [{ value: "Rosso" }],
		});
		await giveRossoToOneProduct(colore);

		const err = await caught(() => deleteProductCharacteristic(colore.id, 0));

		expect(err.status).toBe(409);
		const still = await getTestDb()
			.select()
			.from(productCharacteristic)
			.where(eq(productCharacteristic.id, colore.id));
		expect(still).toHaveLength(1);
		expect(await getTestDb().select().from(productCharacteristicValue)).toHaveLength(1);
	});

	it("deletes values, options and matrix rows with the definition once confirmed", async () => {
		const db = getTestDb();
		const colore = await createProductCharacteristic({
			name: "Colore",
			dataType: "enum",
			options: [{ value: "Rosso" }],
		});
		await giveRossoToOneProduct(colore);
		const macro = await createTestMacroCategory(db, "Elettronica");
		const cat = await createTestCategory(db, "Smartphone", macro.id);
		await db.insert(productCategoryCharacteristic).values({
			productCategoryId: cat.id,
			characteristicId: colore.id,
			sortOrder: 0,
		});

		const result = await deleteProductCharacteristic(colore.id, 1);

		expect(result.deletedValues).toBe(1);
		expect(await db.select().from(productCharacteristic)).toHaveLength(0);
		expect(await db.select().from(productCharacteristicOption)).toHaveLength(0);
		expect(await db.select().from(productCharacteristicValue)).toHaveLength(0);
		expect(await db.select().from(productCategoryCharacteristic)).toHaveLength(0);
	});

	it("returns 404 for an unknown characteristic", async () => {
		const err = await caught(() => deleteProductCharacteristic("missing", 0));
		expect(err.status).toBe(404);
	});
});

describe("countConfigurations", () => {
	it("counts the dictionary", async () => {
		await createProductCharacteristic({ name: "Modello", dataType: "text" });
		expect((await countConfigurations()).productCharacteristics).toBe(1);
	});
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `cd apps/api && bun test tests/integration/admin-product-characteristics.test.ts`
Expected: FAIL — `Cannot find module '@/modules/admin/services/product-characteristics'`.

- [ ] **Step 3: Scrivere il service**

Create `apps/api/src/modules/admin/services/product-characteristics.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
	type CharacteristicDataType,
	productCharacteristic,
	productCharacteristicOption,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { ServiceError } from "@/lib/errors";
import {
	assertImpactConfirmed,
	countValuesByCharacteristic,
	countValuesByOption,
} from "./characteristic-impact";
import { type ListByNameParams, listByNamePaged } from "./list-by-name-paged";

export interface CharacteristicOptionInput {
	// Presente per un'opzione esistente: tenere l'id è ciò che permette di
	// rinominare un'opzione senza perdere i valori che la usano.
	id?: string;
	value: string;
}

/**
 * Le regole di forma di una caratteristica, le stesse dell'import CSV e con
 * gli stessi messaggi: unità solo per i numeri, opzioni solo (e almeno una)
 * per le liste chiuse, nessuna opzione ripetuta. Le opzioni vuote si scartano.
 */
export function normalizeDefinition(p: {
	dataType: CharacteristicDataType;
	unit?: string | null;
	options?: CharacteristicOptionInput[];
}): { unit: string | null; options: CharacteristicOptionInput[] } {
	const unit = p.unit?.trim() || null;
	if (unit && p.dataType !== "number") {
		throw new ServiceError(400, `L'unità di misura ha senso solo per il tipo "number"`);
	}

	const options = (p.options ?? [])
		.map((o) => ({ ...o, value: o.value.trim() }))
		.filter((o) => o.value.length > 0);
	if (options.length > 0 && p.dataType !== "enum") {
		throw new ServiceError(400, `Le opzioni hanno senso solo per il tipo "enum"`);
	}
	if (p.dataType === "enum" && options.length === 0) {
		throw new ServiceError(400, `Il tipo "enum" richiede almeno un'opzione`);
	}

	const seen = new Set<string>();
	for (const o of options) {
		if (seen.has(o.value)) {
			throw new ServiceError(400, `Opzione ripetuta: "${o.value}"`);
		}
		seen.add(o.value);
	}

	return { unit, options };
}

interface ListProductCharacteristicsParams extends ListByNameParams {
	dataType?: CharacteristicDataType;
}

export async function listProductCharacteristics(
	params: ListProductCharacteristicsParams,
) {
	const page = await listByNamePaged(
		productCharacteristic,
		params,
		(opts) =>
			db.query.productCharacteristic.findMany({
				...opts,
				with: {
					options: { orderBy: (o, { asc }) => [asc(o.sortOrder)] },
				},
			}),
		[
			params.dataType
				? eq(productCharacteristic.dataType, params.dataType)
				: undefined,
		],
	);

	// Due query raggruppate sulla pagina invece di una sottoquery per riga: i
	// numeri servono all'interfaccia per dire, prima di chiedere conferma,
	// quanti prodotti perderebbero un valore.
	const [valueCounts, optionCounts] = await Promise.all([
		countValuesByCharacteristic(page.data.map((c) => c.id)),
		countValuesByOption(page.data.flatMap((c) => c.options.map((o) => o.id))),
	]);

	return {
		pagination: page.pagination,
		data: page.data.map((c) => ({
			id: c.id,
			name: c.name,
			dataType: c.dataType,
			unit: c.unit,
			createdAt: c.createdAt,
			updatedAt: c.updatedAt,
			valueCount: valueCounts.get(c.id) ?? 0,
			options: c.options.map((o) => ({
				id: o.id,
				value: o.value,
				sortOrder: o.sortOrder,
				valueCount: optionCounts.get(o.id) ?? 0,
			})),
		})),
	};
}

interface CreateProductCharacteristicParams {
	name: string;
	dataType: CharacteristicDataType;
	unit?: string | null;
	options?: CharacteristicOptionInput[];
}

export async function createProductCharacteristic(
	params: CreateProductCharacteristicParams,
) {
	const { unit, options } = normalizeDefinition(params);

	return db.transaction(async (tx) => {
		const [created] = await tx
			.insert(productCharacteristic)
			.values({ name: params.name.trim(), dataType: params.dataType, unit })
			.returning();

		if (options.length > 0) {
			await tx.insert(productCharacteristicOption).values(
				options.map((o, sortOrder) => ({
					characteristicId: created.id,
					value: o.value,
					sortOrder,
				})),
			);
		}

		return created;
	});
}

export async function deleteProductCharacteristic(
	characteristicId: string,
	confirmAffected: number,
) {
	return db.transaction(async (tx) => {
		const affected =
			(await countValuesByCharacteristic([characteristicId], tx)).get(
				characteristicId,
			) ?? 0;
		assertImpactConfirmed(affected, confirmAffected);

		// Prima i valori, poi la definizione (D10): le chiavi esterne dei valori
		// sono RESTRICT apposta. Opzioni e righe di matrice vanno in CASCADE.
		await tx
			.delete(productCharacteristicValue)
			.where(eq(productCharacteristicValue.characteristicId, characteristicId));

		const [deleted] = await tx
			.delete(productCharacteristic)
			.where(eq(productCharacteristic.id, characteristicId))
			.returning();

		if (!deleted) throw new ServiceError(404, "Caratteristica non trovata");
		return { deleted, deletedValues: affected };
	});
}
```

- [ ] **Step 4: Aggiungere il contatore alle configurazioni**

In `apps/api/src/modules/admin/services/configurations.ts` aggiungere `productCharacteristic` all'import da `@/db/schemas/product-characteristic`, un quinto elemento alla `Promise.all`:

```ts
		db.select({ productCharacteristics: count() }).from(productCharacteristic),
```

destrutturato come `[{ productCharacteristics }]` e restituito nell'oggetto. In `apps/api/src/modules/admin/routes/configurations.ts` aggiungere allo schema di risposta:

```ts
					productCharacteristics: t.Number({
						description: "Numero totale di caratteristiche nel dizionario",
					}),
```

e aggiornare la `description` della rotta: «Restituisce il numero totale di macro categorie e categorie, prodotto e negozio, e di caratteristiche prodotto.»

- [ ] **Step 5: Verificare che i test del service passino**

Run: `cd apps/api && bun test tests/integration/admin-product-characteristics.test.ts`
Expected: PASS, 9 test.

- [ ] **Step 6: Schemi e query**

In `apps/api/src/lib/schemas/entities.ts`, subito dopo `CsvUpsertResultSchema`, importando `CHARACTERISTIC_DATA_TYPES` da `@/db/schemas/product-characteristic`:

```ts
export const CharacteristicDataTypeSchema = t.Union(
	CHARACTERISTIC_DATA_TYPES.map((d) => t.Literal(d)),
	{
		description:
			"Tipo di dato: text (testo libero), number (numero, con unità facoltativa), boolean (sì/no), enum (lista chiusa di opzioni)",
	},
);

export const ProductCharacteristicSchema = t.Object({
	id: t.String(),
	name: t.String({ description: "Nome della caratteristica" }),
	dataType: CharacteristicDataTypeSchema,
	unit: t.Nullable(
		t.String({ description: "Unità di misura, solo per il tipo number" }),
	),
	createdAt: t.Date(),
	updatedAt: t.Date(),
});

export const AdminProductCharacteristicSchema = t.Object({
	...ProductCharacteristicSchema.properties,
	valueCount: t.Integer({
		description:
			"Numero di prodotti che hanno un valore per questa caratteristica",
	}),
	options: t.Array(
		t.Object({
			id: t.String(),
			value: t.String({ description: "Valore ammesso" }),
			sortOrder: t.Integer({ description: "Posizione nella lista" }),
			valueCount: t.Integer({
				description: "Numero di prodotti che hanno scelto questa opzione",
			}),
		}),
		{ description: "Opzioni della lista chiusa, vuota per gli altri tipi" },
	),
});
```

Se `CHARACTERISTIC_DATA_TYPES.map(...)` non soddisfa il tipo di `t.Union`, usare la forma esplicita `t.Union([t.Literal("text"), t.Literal("number"), t.Literal("boolean"), t.Literal("enum")], {...})`, come `ProductMacroCategorySchema.suggestedVatRate`.

In `apps/api/src/lib/queries.ts`, dopo `CategoryListQuery`:

```ts
export const CharacteristicListQuery = t.Object({
	...CategoryListQuery.properties,
	dataType: t.Optional(
		t.Union(
			CHARACTERISTIC_DATA_TYPES.map((d) => t.Literal(d)),
			{ description: "Filtra per tipo di dato" },
		),
	),
});
```

(stesso stile di `OrderListQuery`, import di `CHARACTERISTIC_DATA_TYPES` da `@/db/schemas/product-characteristic`).

- [ ] **Step 7: Le rotte**

Create `apps/api/src/modules/admin/routes/product-characteristics.ts`:

```ts
import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { CharacteristicListQuery } from "@/lib/queries";
import { ok, okMessage, okPage } from "@/lib/responses";
import {
	AdminProductCharacteristicSchema,
	CharacteristicDataTypeSchema,
	OkMessage,
	okPageRes,
	okRes,
	ProductCharacteristicSchema,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { withAdmin } from "../context";
import {
	createProductCharacteristic,
	deleteProductCharacteristic,
	listProductCharacteristics,
} from "../services/product-characteristics";

const OptionsBody = t.Array(
	t.Object({
		id: t.Optional(
			t.String({
				description:
					"ID di un'opzione esistente: tenerlo permette di rinominarla senza perdere i valori dei prodotti",
			}),
		),
		value: t.String({ maxLength: 100, description: "Valore ammesso" }),
	}),
	{ description: "Opzioni della lista chiusa, nell'ordine di presentazione" },
);

export const productCharacteristicsRoutes = new Elysia()
	.get(
		"/product-characteristics",
		async ({ query }) => {
			const result = await listProductCharacteristics(query);
			return okPage(result.data, result.pagination);
		},
		{
			query: CharacteristicListQuery,
			response: withErrors({ 200: okPageRes(AdminProductCharacteristicSchema) }),
			detail: {
				summary: "Lista caratteristiche prodotto",
				description:
					"Restituisce il dizionario delle caratteristiche, paginato, con le opzioni delle liste chiuse e, per ogni voce e ogni opzione, il numero di prodotti che hanno già un valore.",
				tags: ["Admin"],
			},
		},
	)
	.post(
		"/product-characteristics",
		async (ctx) => {
			const { body, store, user } = withAdmin(ctx);
			const data = await createProductCharacteristic(body);

			getLogger(store).info(
				{
					adminId: user.id,
					characteristicId: data.id,
					characteristicName: data.name,
					dataType: data.dataType,
					action: "product_characteristic_created",
				},
				"Caratteristica prodotto creata",
			);

			return ok(data);
		},
		{
			body: t.Object({
				name: t.String({
					minLength: 1,
					maxLength: 100,
					description: "Nome della caratteristica, univoco nel dizionario",
				}),
				dataType: CharacteristicDataTypeSchema,
				unit: t.Optional(
					t.Nullable(
						t.String({
							maxLength: 20,
							description: "Unità di misura, solo per il tipo number",
						}),
					),
				),
				options: t.Optional(OptionsBody),
			}),
			response: withConflictErrors({ 200: okRes(ProductCharacteristicSchema) }),
			detail: {
				summary: "Crea caratteristica prodotto",
				description:
					"Aggiunge una voce al dizionario. L'unità è ammessa solo per il tipo number, le opzioni solo (e almeno una) per il tipo enum. Il nome deve essere univoco.",
				tags: ["Admin"],
			},
		},
	)
	.delete(
		"/product-characteristics/:characteristicId",
		async (ctx) => {
			const { params, body, store, user } = withAdmin(ctx);
			const { deleted, deletedValues } = await deleteProductCharacteristic(
				params.characteristicId,
				body.confirmAffected,
			);

			getLogger(store).info(
				{
					adminId: user.id,
					characteristicId: deleted.id,
					characteristicName: deleted.name,
					deletedValues,
					action: "product_characteristic_deleted",
				},
				"Caratteristica prodotto eliminata",
			);

			return okMessage("Product characteristic deleted");
		},
		{
			params: t.Object({
				characteristicId: t.String({ description: "ID della caratteristica" }),
			}),
			body: t.Object({
				confirmAffected: t.Integer({
					minimum: 0,
					description:
						"Numero di prodotti con un valore che l'interfaccia ha mostrato nella conferma. Se i prodotti coinvolti sono di più, la richiesta è respinta con 409 e nulla viene cancellato.",
				}),
			}),
			response: withConflictErrors({ 200: OkMessage }),
			detail: {
				summary: "Elimina caratteristica prodotto",
				description:
					"Elimina una voce dal dizionario insieme alle sue opzioni, alle righe di matrice e ai valori già compilati sui prodotti. Richiede confirmAffected pari almeno al numero di prodotti coinvolti (409 altrimenti); 404 se la voce non esiste.",
				tags: ["Admin"],
			},
		},
	);
```

In `apps/api/src/modules/admin/index.ts` importare `productCharacteristicsRoutes` da `./routes/product-characteristics` e aggiungere `.use(productCharacteristicsRoutes)` subito prima di `.use(characteristicImportsRoutes)`.

- [ ] **Step 8: Verificare tipi, lint e documento OpenAPI**

Run: `bun run --cwd apps/api typecheck; echo "api=$?"`
Expected: `api=0`.

Run: `bunx biome check apps/api/src apps/api/tests/integration/admin-product-characteristics.test.ts`
Expected: nessun errore.

Run: `cd apps/api && bun test tests/integration/admin-product-characteristics.test.ts tests/integration/admin-characteristic-impact.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/admin apps/api/src/lib/schemas/entities.ts \
	apps/api/src/lib/queries.ts \
	apps/api/tests/integration/admin-product-characteristics.test.ts
git commit -m "feat(api): elenco, creazione ed eliminazione delle caratteristiche

L'elenco riporta per ogni voce e ogni opzione quanti prodotti hanno un
valore, cosi' l'admin sa cosa perde prima di confermare. L'eliminazione
cancella i valori nella stessa transazione, solo se confermati.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Dizionario — modifica

La modifica è il caso più delicato: tre dei quattro atti di D10 passano da qui o le somigliano. Le opzioni si sincronizzano **per id**, non per valore come nell'import: un'opzione che arriva con il suo `id` resta la stessa riga anche se cambia testo, quindi **correggere un refuso in `Rosso` non cancella i valori** di chi l'ha scelto. Un'opzione esistente assente dall'elenco è rimossa, e i suoi valori con lei. Un cambio di tipo cancella tutti i valori della caratteristica (e le opzioni, se si esce da `enum`).

**Files:**
- Modify: `apps/api/src/modules/admin/services/product-characteristics.ts`
- Modify: `apps/api/src/modules/admin/routes/product-characteristics.ts`
- Test: `apps/api/tests/integration/admin-product-characteristics.test.ts`

**Interfaces:**
- Consumes: `normalizeDefinition`, `CharacteristicOptionInput` (Task 2); `countValuesByCharacteristic`, `countValuesByOption`, `sumCounts`, `assertImpactConfirmed` (Task 1).
- Produces:
  - `updateProductCharacteristic(p: { characteristicId: string; name?: string; dataType?: CharacteristicDataType; unit?: string | null; options?: CharacteristicOptionInput[]; confirmAffected: number })` → `{ updated, deletedValues: number }`.
  - Rotta `PATCH /admin/product-characteristics/:characteristicId` con body `{ name?, dataType?, unit?, options?, confirmAffected? }` (`confirmAffected` default 0).
  - Regola di impatto, che il frontend (Task 5) replica per mostrare il numero: **se il tipo cambia**, l'impatto è il `valueCount` della caratteristica; **altrimenti** è la somma dei `valueCount` delle opzioni esistenti il cui `id` non compare nell'elenco inviato.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere a `apps/api/tests/integration/admin-product-characteristics.test.ts` `updateProductCharacteristic` all'import dal service, poi:

```ts
describe("updateProductCharacteristic", () => {
	async function coloreWithRosso() {
		const colore = await createProductCharacteristic({
			name: "Colore",
			dataType: "enum",
			options: [{ value: "Rosso" }, { value: "Blu" }],
		});
		const { product, rosso } = await giveRossoToOneProduct(colore);
		const [blu] = await getTestDb()
			.select()
			.from(productCharacteristicOption)
			.where(eq(productCharacteristicOption.value, "Blu"));
		return { colore, product, rosso, blu };
	}

	it("renames an option in place, keeping the product value", async () => {
		const { colore, rosso, blu } = await coloreWithRosso();

		const { deletedValues } = await updateProductCharacteristic({
			characteristicId: colore.id,
			options: [
				{ id: rosso.id, value: "Rosso scuro" },
				{ id: blu.id, value: "Blu" },
			],
			confirmAffected: 0,
		});

		expect(deletedValues).toBe(0);
		const [value] = await getTestDb().select().from(productCharacteristicValue);
		expect(value.optionId).toBe(rosso.id);
		const [renamed] = await getTestDb()
			.select()
			.from(productCharacteristicOption)
			.where(eq(productCharacteristicOption.id, rosso.id));
		expect(renamed.value).toBe("Rosso scuro");
	});

	it("swaps two option values without tripping the unique constraint", async () => {
		const { colore, rosso, blu } = await coloreWithRosso();

		await updateProductCharacteristic({
			characteristicId: colore.id,
			options: [
				{ id: rosso.id, value: "Blu" },
				{ id: blu.id, value: "Rosso" },
			],
			confirmAffected: 0,
		});

		const opts = await getTestDb().select().from(productCharacteristicOption);
		expect(opts.find((o) => o.id === rosso.id)?.value).toBe("Blu");
		expect(opts.find((o) => o.id === blu.id)?.value).toBe("Rosso");
	});

	it("adds new options after the kept ones, in the given order", async () => {
		const { colore, rosso, blu } = await coloreWithRosso();

		await updateProductCharacteristic({
			characteristicId: colore.id,
			options: [
				{ id: blu.id, value: "Blu" },
				{ value: "Verde" },
				{ id: rosso.id, value: "Rosso" },
			],
			confirmAffected: 0,
		});

		const opts = await getTestDb().select().from(productCharacteristicOption);
		expect(
			opts.sort((a, b) => a.sortOrder - b.sortOrder).map((o) => o.value),
		).toEqual(["Blu", "Verde", "Rosso"]);
	});

	it("refuses to drop a used option without confirmation and changes nothing", async () => {
		const { colore, blu } = await coloreWithRosso();

		const err = await caught(() =>
			updateProductCharacteristic({
				characteristicId: colore.id,
				name: "Colore principale",
				options: [{ id: blu.id, value: "Blu" }],
				confirmAffected: 0,
			}),
		);

		expect(err.status).toBe(409);
		expect(await getTestDb().select().from(productCharacteristicOption)).toHaveLength(2);
		const [c] = await getTestDb().select().from(productCharacteristic);
		expect(c.name).toBe("Colore");
	});

	it("drops a used option and its values once confirmed", async () => {
		const { colore, blu } = await coloreWithRosso();

		const { deletedValues } = await updateProductCharacteristic({
			characteristicId: colore.id,
			options: [{ id: blu.id, value: "Blu" }],
			confirmAffected: 1,
		});

		expect(deletedValues).toBe(1);
		expect(await getTestDb().select().from(productCharacteristicValue)).toHaveLength(0);
		const opts = await getTestDb().select().from(productCharacteristicOption);
		expect(opts.map((o) => o.value)).toEqual(["Blu"]);
	});

	it("changes the type once confirmed, dropping values and options", async () => {
		const { colore } = await coloreWithRosso();

		const err = await caught(() =>
			updateProductCharacteristic({
				characteristicId: colore.id,
				dataType: "text",
				confirmAffected: 0,
			}),
		);
		expect(err.status).toBe(409);

		const { updated, deletedValues } = await updateProductCharacteristic({
			characteristicId: colore.id,
			dataType: "text",
			confirmAffected: 1,
		});

		expect(updated.dataType).toBe("text");
		expect(deletedValues).toBe(1);
		expect(await getTestDb().select().from(productCharacteristicValue)).toHaveLength(0);
		expect(await getTestDb().select().from(productCharacteristicOption)).toHaveLength(0);
	});

	it("keeps the current options when only the name changes", async () => {
		const { colore } = await coloreWithRosso();

		await updateProductCharacteristic({
			characteristicId: colore.id,
			name: "Colore principale",
			confirmAffected: 0,
		});

		expect(await getTestDb().select().from(productCharacteristicOption)).toHaveLength(2);
		expect(await getTestDb().select().from(productCharacteristicValue)).toHaveLength(1);
	});

	it("drops the unit when leaving the number type", async () => {
		const peso = await createProductCharacteristic({
			name: "Peso",
			dataType: "number",
			unit: "g",
		});

		const { updated } = await updateProductCharacteristic({
			characteristicId: peso.id,
			dataType: "text",
			confirmAffected: 0,
		});

		expect(updated.unit).toBeNull();
	});

	it("rejects an option id that belongs to another characteristic", async () => {
		const { rosso } = await coloreWithRosso();
		const taglia = await createProductCharacteristic({
			name: "Taglia",
			dataType: "enum",
			options: [{ value: "M" }],
		});

		const err = await caught(() =>
			updateProductCharacteristic({
				characteristicId: taglia.id,
				options: [{ id: rosso.id, value: "M" }],
				confirmAffected: 0,
			}),
		);

		expect(err.status).toBe(400);
		expect(err.message).toBe(`Opzione sconosciuta per "Taglia"`);
	});

	it("returns 404 for an unknown characteristic", async () => {
		const err = await caught(() =>
			updateProductCharacteristic({ characteristicId: "missing", confirmAffected: 0 }),
		);
		expect(err.status).toBe(404);
	});
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `cd apps/api && bun test tests/integration/admin-product-characteristics.test.ts`
Expected: FAIL — `updateProductCharacteristic` non è esportata.

- [ ] **Step 3: Scrivere la modifica**

In `apps/api/src/modules/admin/services/product-characteristics.ts` estendere l'import di `drizzle-orm` a `{ eq, inArray }`, l'import da `./characteristic-impact` con `sumCounts`, e aggiungere:

```ts
interface UpdateProductCharacteristicParams {
	characteristicId: string;
	name?: string;
	dataType?: CharacteristicDataType;
	unit?: string | null;
	options?: CharacteristicOptionInput[];
	confirmAffected: number;
}

/**
 * Modifica una voce del dizionario. Le opzioni si sincronizzano per id: una
 * che arriva con il suo id resta la stessa riga anche se cambia testo, quindi
 * i valori che la usano sopravvivono. Due atti cancellano valori (D10) e
 * passano solo se confermati: rimuovere un'opzione in uso e cambiare il tipo.
 */
export async function updateProductCharacteristic(
	params: UpdateProductCharacteristicParams,
) {
	const { characteristicId } = params;

	return db.transaction(async (tx) => {
		const current = await tx.query.productCharacteristic.findFirst({
			where: eq(productCharacteristic.id, characteristicId),
			with: { options: true },
		});
		if (!current) throw new ServiceError(404, "Caratteristica non trovata");

		const dataType = params.dataType ?? current.dataType;
		const typeChanged = dataType !== current.dataType;

		// Campi omessi = invariati. Ma un cambio di tipo non eredita né l'unità
		// né le opzioni del tipo precedente.
		const proposedOptions =
			params.options ??
			(typeChanged
				? []
				: current.options.map((o) => ({ id: o.id, value: o.value })));
		const proposedUnit =
			params.unit !== undefined ? params.unit : typeChanged ? null : current.unit;

		const { unit, options } = normalizeDefinition({
			dataType,
			unit: proposedUnit,
			options: proposedOptions,
		});

		const currentOptionIds = new Set(current.options.map((o) => o.id));
		for (const o of options) {
			if (o.id && !currentOptionIds.has(o.id)) {
				throw new ServiceError(400, `Opzione sconosciuta per "${current.name}"`);
			}
		}

		const keptIds = new Set(options.flatMap((o) => (o.id ? [o.id] : [])));
		const removedOptionIds = current.options
			.filter((o) => !keptIds.has(o.id))
			.map((o) => o.id);

		const affected = typeChanged
			? ((await countValuesByCharacteristic([characteristicId], tx)).get(
					characteristicId,
				) ?? 0)
			: sumCounts(await countValuesByOption(removedOptionIds, tx));
		assertImpactConfirmed(affected, params.confirmAffected);

		// Prima i valori (D10), poi le opzioni: option_id è RESTRICT.
		if (typeChanged) {
			await tx
				.delete(productCharacteristicValue)
				.where(eq(productCharacteristicValue.characteristicId, characteristicId));
		} else if (removedOptionIds.length > 0) {
			await tx
				.delete(productCharacteristicValue)
				.where(inArray(productCharacteristicValue.optionId, removedOptionIds));
		}
		if (removedOptionIds.length > 0) {
			await tx
				.delete(productCharacteristicOption)
				.where(inArray(productCharacteristicOption.id, removedOptionIds));
		}

		// La chiave esterna composta (id, data_type) dei valori accetta il nuovo
		// tipo solo perché i valori del tipo vecchio sono già stati cancellati.
		const [updated] = await tx
			.update(productCharacteristic)
			.set({
				...(params.name !== undefined ? { name: params.name.trim() } : {}),
				dataType,
				unit,
			})
			.where(eq(productCharacteristic.id, characteristicId))
			.returning();

		// Opzioni tenute in due passi: prima un valore provvisorio univoco per
		// quelle che cambiano testo, poi quello definitivo. Senza, uno scambio
		// (Rosso↔Blu) violerebbe UNIQUE (characteristic_id, value) a metà strada.
		const valueById = new Map(current.options.map((o) => [o.id, o.value]));
		const kept = options.flatMap((o, sortOrder) =>
			o.id ? [{ id: o.id, value: o.value, sortOrder }] : [],
		);
		for (const k of kept) {
			if (valueById.get(k.id) === k.value) continue;
			await tx
				.update(productCharacteristicOption)
				// Postgres rifiuta il byte NUL nei testi: il prefisso basta a non
				// collidere, perché nessun valore reale inizia così.
				.set({ value: `__rinomina__${k.id}` })
				.where(eq(productCharacteristicOption.id, k.id));
		}
		for (const k of kept) {
			await tx
				.update(productCharacteristicOption)
				.set({ value: k.value, sortOrder: k.sortOrder })
				.where(eq(productCharacteristicOption.id, k.id));
		}

		const inserted = options.flatMap((o, sortOrder) =>
			o.id ? [] : [{ characteristicId, value: o.value, sortOrder }],
		);
		if (inserted.length > 0) {
			await tx.insert(productCharacteristicOption).values(inserted);
		}

		return { updated, deletedValues: affected };
	});
}
```

- [ ] **Step 4: Verificare che passino**

Run: `cd apps/api && bun test tests/integration/admin-product-characteristics.test.ts`
Expected: PASS, 19 test.

- [ ] **Step 5: La rotta**

In `apps/api/src/modules/admin/routes/product-characteristics.ts` aggiungere `updateProductCharacteristic` all'import e, fra `.post` e `.delete`:

```ts
	.patch(
		"/product-characteristics/:characteristicId",
		async (ctx) => {
			const { params, body, store, user } = withAdmin(ctx);
			const { updated, deletedValues } = await updateProductCharacteristic({
				characteristicId: params.characteristicId,
				name: body.name,
				dataType: body.dataType,
				unit: body.unit,
				options: body.options,
				confirmAffected: body.confirmAffected ?? 0,
			});

			getLogger(store).info(
				{
					adminId: user.id,
					characteristicId: updated.id,
					characteristicName: updated.name,
					dataType: updated.dataType,
					deletedValues,
					action: "product_characteristic_updated",
				},
				"Caratteristica prodotto aggiornata",
			);

			return ok(updated);
		},
		{
			params: t.Object({
				characteristicId: t.String({ description: "ID della caratteristica" }),
			}),
			body: t.Object({
				name: t.Optional(
					t.String({
						minLength: 1,
						maxLength: 100,
						description: "Nuovo nome della caratteristica",
					}),
				),
				dataType: t.Optional(CharacteristicDataTypeSchema),
				unit: t.Optional(
					t.Nullable(
						t.String({
							maxLength: 20,
							description: "Unità di misura, solo per il tipo number",
						}),
					),
				),
				options: t.Optional(OptionsBody),
				confirmAffected: t.Optional(
					t.Integer({
						minimum: 0,
						default: 0,
						description:
							"Numero di prodotti con un valore che l'interfaccia ha mostrato nella conferma. Serve quando la modifica rimuove opzioni in uso o cambia il tipo: se i prodotti coinvolti sono di più, 409 e nulla cambia.",
					}),
				),
			}),
			response: withConflictErrors({ 200: okRes(ProductCharacteristicSchema) }),
			detail: {
				summary: "Aggiorna caratteristica prodotto",
				description:
					"Modifica nome, tipo, unità e opzioni. Le opzioni inviate con il loro id restano le stesse righe anche se cambiano testo, e i valori dei prodotti sopravvivono; quelle esistenti non inviate sono rimosse insieme ai valori che le usano. Un cambio di tipo elimina tutti i valori della caratteristica. Entrambi gli atti richiedono confirmAffected.",
				tags: ["Admin"],
			},
		},
	)
```

- [ ] **Step 6: Verificare**

Run: `bun run --cwd apps/api typecheck; echo "api=$?"` — Expected: `api=0`.
Run: `bunx biome check apps/api/src/modules/admin apps/api/tests/integration/admin-product-characteristics.test.ts` — Expected: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/admin apps/api/tests/integration/admin-product-characteristics.test.ts
git commit -m "feat(api): modifica delle caratteristiche con opzioni per id

Rinominare un'opzione non cancella i valori di chi l'ha scelta. Togliere
un'opzione in uso o cambiare il tipo cancella i valori, solo se
confermati.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Matrice per sotto-categoria

**Files:**
- Create: `apps/api/src/modules/admin/services/category-characteristics.ts`
- Create: `apps/api/src/modules/admin/routes/category-characteristics.ts`
- Modify: `apps/api/src/modules/admin/index.ts`, `apps/api/src/lib/schemas/entities.ts`, `apps/api/src/lib/queries.ts`, `apps/api/src/modules/product-categories.ts`
- Test: `apps/api/tests/integration/admin-category-characteristics.test.ts`

**Interfaces:**
- Consumes: `countCategoryCharacteristicValues`, `assertImpactConfirmed` (Task 1); `CharacteristicDataTypeSchema` (Task 2); `listByNamePaged`.
- Produces:
  - `listAdminProductCategories(params: ListByNameParams & { macroCategoryId?: string })` → pagina di `{ id, macroCategoryId, name, createdAt, updatedAt, macroCategory, characteristicCount }`.
  - `listCategoryCharacteristics(productCategoryId: string)` → `{ id, name, dataType, unit, included: boolean, required: boolean, valueCount: number }[]`, **tutte** le voci del dizionario, in ordine di nome. `id` è l'id della caratteristica; `valueCount` conta i prodotti **di questa sotto-categoria** con un valore.
  - `setCategoryCharacteristic(p: { productCategoryId: string; characteristicId: string; required: boolean })` → la riga di matrice. Include se assente (in coda: `sortOrder` = massimo + 1), aggiorna `required` se presente.
  - `removeCategoryCharacteristic(p: { productCategoryId: string; characteristicId: string; confirmAffected: number })` → `{ deletedValues: number }`.
  - Schemi `AdminProductCategorySchema`, `CategoryCharacteristicStateSchema`, `CategoryCharacteristicLinkSchema`; `ProductCategoryListQuery` spostata in `lib/queries.ts`.
  - Rotte: `GET /admin/product-categories`, `GET /admin/product-categories/:productCategoryId/characteristics`, `PUT` e `DELETE /admin/product-categories/:productCategoryId/characteristics/:characteristicId` (il `DELETE` con body `{ confirmAffected }`).

- [ ] **Step 1: Scrivere i test che falliscono**

Create `apps/api/tests/integration/admin-category-characteristics.test.ts` con l'intestazione del Task 1, poi:

```ts
import { eq } from "drizzle-orm";
import {
	productCategoryCharacteristic,
	productCharacteristic,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { ServiceError } from "@/lib/errors";
import {
	listAdminProductCategories,
	listCategoryCharacteristics,
	removeCategoryCharacteristic,
	setCategoryCharacteristic,
} from "@/modules/admin/services/category-characteristics";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCategory,
	createTestMacroCategory,
	createTestProduct,
	createTestSeller,
} from "../helpers/fixtures";

async function caught(fn: () => Promise<unknown>): Promise<ServiceError> {
	try {
		await fn();
	} catch (e) {
		if (e instanceof ServiceError) return e;
		throw e;
	}
	throw new Error("expected a ServiceError");
}

// Smartphone con Modello e Peso nella matrice, Tablet con niente; un prodotto
// Smartphone con un Peso, un prodotto Tablet con un Peso (fuori matrice: è
// esattamente il valore che non deve essere contato per Smartphone).
async function seedMatrix() {
	const db = getTestDb();
	const macro = await createTestMacroCategory(db, "Elettronica");
	const phones = await createTestCategory(db, "Smartphone", macro.id);
	const tablets = await createTestCategory(db, "Tablet", macro.id);
	const [modello, peso, colore] = await db
		.insert(productCharacteristic)
		.values([
			{ name: "Modello", dataType: "text" },
			{ name: "Peso", dataType: "number", unit: "g" },
			{ name: "Colore", dataType: "text" },
		])
		.returning();
	await db.insert(productCategoryCharacteristic).values([
		{ productCategoryId: phones.id, characteristicId: modello.id, sortOrder: 0 },
		{ productCategoryId: phones.id, characteristicId: peso.id, sortOrder: 1 },
	]);
	const seller = await createTestSeller(db);
	const phone = await createTestProduct(db, seller.profile.id, {
		name: "Telefono",
		categoryIds: [phones.id],
	});
	const tablet = await createTestProduct(db, seller.profile.id, {
		name: "Tablet",
		categoryIds: [tablets.id],
	});
	await db.insert(productCharacteristicValue).values([
		{ productId: phone.id, characteristicId: peso.id, dataType: "number", valueNumber: "180" },
		{ productId: tablet.id, characteristicId: peso.id, dataType: "number", valueNumber: "450" },
	]);
	return { macro, phones, tablets, modello, peso, colore, phone };
}

describe("listAdminProductCategories", () => {
	it("counts the characteristics of each subcategory separately", async () => {
		const { phones, tablets } = await seedMatrix();

		const result = await listAdminProductCategories({ sortBy: "name", sortOrder: "asc" });

		const byId = new Map(result.data.map((c) => [c.id, c]));
		expect(byId.get(phones.id)?.characteristicCount).toBe(2);
		expect(byId.get(tablets.id)?.characteristicCount).toBe(0);
		expect(byId.get(phones.id)?.macroCategory.name).toBe("Elettronica");
		expect(result.pagination.total).toBe(2);
	});

	it("keeps search and macro filter working with the join", async () => {
		const { macro, phones } = await seedMatrix();
		const other = await createTestMacroCategory(getTestDb(), "Casa");
		await createTestCategory(getTestDb(), "Smart home", other.id);

		const result = await listAdminProductCategories({
			search: "smart",
			macroCategoryId: macro.id,
		});

		expect(result.data.map((c) => c.id)).toEqual([phones.id]);
		expect(result.pagination.total).toBe(1);
	});
});

describe("listCategoryCharacteristics", () => {
	it("returns the whole dictionary with inclusion state and in-category value counts", async () => {
		const { phones } = await seedMatrix();

		const rows = await listCategoryCharacteristics(phones.id);

		expect(rows.map((r) => [r.name, r.included, r.valueCount])).toEqual([
			["Colore", false, 0],
			["Modello", true, 0],
			["Peso", true, 1],
		]);
	});

	it("returns 404 for an unknown subcategory", async () => {
		expect((await caught(() => listCategoryCharacteristics("missing"))).status).toBe(404);
	});
});

describe("setCategoryCharacteristic", () => {
	it("appends a new link at the end of the subcategory", async () => {
		const { phones, colore } = await seedMatrix();

		const link = await setCategoryCharacteristic({
			productCategoryId: phones.id,
			characteristicId: colore.id,
			required: false,
		});

		expect(link.sortOrder).toBe(2);
		expect(link.required).toBe(false);
	});

	it("updates required on an existing link without moving it", async () => {
		const { phones, modello } = await seedMatrix();

		const link = await setCategoryCharacteristic({
			productCategoryId: phones.id,
			characteristicId: modello.id,
			required: true,
		});

		expect(link.required).toBe(true);
		expect(link.sortOrder).toBe(0);
	});

	it("starts at zero on an empty subcategory", async () => {
		const { tablets, colore } = await seedMatrix();

		const link = await setCategoryCharacteristic({
			productCategoryId: tablets.id,
			characteristicId: colore.id,
			required: false,
		});

		expect(link.sortOrder).toBe(0);
	});

	it("returns 404 instead of a foreign key error for unknown ids", async () => {
		const { phones, colore } = await seedMatrix();

		expect(
			(await caught(() =>
				setCategoryCharacteristic({
					productCategoryId: "missing",
					characteristicId: colore.id,
					required: false,
				}),
			)).status,
		).toBe(404);
		expect(
			(await caught(() =>
				setCategoryCharacteristic({
					productCategoryId: phones.id,
					characteristicId: "missing",
					required: false,
				}),
			)).status,
		).toBe(404);
	});
});

describe("removeCategoryCharacteristic", () => {
	it("refuses with 409 when products of the subcategory have a value", async () => {
		const { phones, peso } = await seedMatrix();

		const err = await caught(() =>
			removeCategoryCharacteristic({
				productCategoryId: phones.id,
				characteristicId: peso.id,
				confirmAffected: 0,
			}),
		);

		expect(err.status).toBe(409);
		expect(await getTestDb().select().from(productCategoryCharacteristic)).toHaveLength(2);
	});

	it("deletes the link and only the values of that subcategory once confirmed", async () => {
		const { phones, peso, phone } = await seedMatrix();

		const { deletedValues } = await removeCategoryCharacteristic({
			productCategoryId: phones.id,
			characteristicId: peso.id,
			confirmAffected: 1,
		});

		expect(deletedValues).toBe(1);
		const values = await getTestDb().select().from(productCharacteristicValue);
		expect(values).toHaveLength(1);
		expect(values[0].productId).not.toBe(phone.id);
		const links = await getTestDb()
			.select()
			.from(productCategoryCharacteristic)
			.where(eq(productCategoryCharacteristic.productCategoryId, phones.id));
		expect(links).toHaveLength(1);
	});

	it("returns 404 when the characteristic is not in the subcategory", async () => {
		const { phones, colore } = await seedMatrix();

		const err = await caught(() =>
			removeCategoryCharacteristic({
				productCategoryId: phones.id,
				characteristicId: colore.id,
				confirmAffected: 0,
			}),
		);

		expect(err.status).toBe(404);
	});
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `cd apps/api && bun test tests/integration/admin-category-characteristics.test.ts`
Expected: FAIL — modulo non trovato.

- [ ] **Step 3: Scrivere il service**

Create `apps/api/src/modules/admin/services/category-characteristics.ts`:

```ts
import { and, asc, count, eq, getTableColumns, inArray, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { productCategory } from "@/db/schemas/category";
import { product } from "@/db/schemas/product";
import {
	productCategoryCharacteristic,
	productCharacteristic,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { productMacroCategory } from "@/db/schemas/product-macro-category";
import { ServiceError } from "@/lib/errors";
import {
	assertImpactConfirmed,
	countCategoryCharacteristicValues,
} from "./characteristic-impact";
import { type ListByNameParams, listByNamePaged } from "./list-by-name-paged";

interface ListAdminProductCategoriesParams extends ListByNameParams {
	macroCategoryId?: string;
}

/**
 * Le sotto-categorie come le vede l'admin: le stesse del listato pubblico più
 * quante caratteristiche ha ciascuna nella matrice.
 */
export async function listAdminProductCategories(
	params: ListAdminProductCategoriesParams,
) {
	return listByNamePaged(
		productCategory,
		params,
		({ where, orderBy, limit, offset }) =>
			db
				.select({
					...getTableColumns(productCategory),
					macroCategory: getTableColumns(productMacroCategory),
					// Sottoquery correlata in un campo SELECT: le Column interpolate qui
					// escono SENZA qualificazione di tabella, e `${productCategory.id}`
					// diventerebbe un "id" nudo risolto sulla tabella interna. Alias
					// interno e riferimento letterale alla tabella esterna.
					characteristicCount: sql<number>`(
						SELECT count(*)::int
						FROM ${productCategoryCharacteristic} pcc
						WHERE pcc.product_category_id = product_categories.id
					)`,
				})
				.from(productCategory)
				.innerJoin(
					productMacroCategory,
					eq(productCategory.macroCategoryId, productMacroCategory.id),
				)
				.where(where)
				.orderBy(orderBy)
				.limit(limit)
				.offset(offset),
		[
			params.macroCategoryId
				? eq(productCategory.macroCategoryId, params.macroCategoryId)
				: undefined,
		],
	);
}

async function assertCategoryExists(productCategoryId: string) {
	const found = await db.query.productCategory.findFirst({
		where: eq(productCategory.id, productCategoryId),
		columns: { id: true },
	});
	if (!found) throw new ServiceError(404, "Sotto-categoria non trovata");
}

/**
 * Tutto il dizionario, con lo stato della riga per questa sotto-categoria:
 * inclusa o no, obbligatoria o no, e quanti suoi prodotti hanno già un valore
 * (il numero che la conferma di rimozione deve mostrare).
 */
export async function listCategoryCharacteristics(productCategoryId: string) {
	await assertCategoryExists(productCategoryId);

	const [rows, counts] = await Promise.all([
		db
			.select({
				id: productCharacteristic.id,
				name: productCharacteristic.name,
				dataType: productCharacteristic.dataType,
				unit: productCharacteristic.unit,
				linkSortOrder: productCategoryCharacteristic.sortOrder,
				required: productCategoryCharacteristic.required,
			})
			.from(productCharacteristic)
			.leftJoin(
				productCategoryCharacteristic,
				and(
					eq(productCategoryCharacteristic.characteristicId, productCharacteristic.id),
					eq(productCategoryCharacteristic.productCategoryId, productCategoryId),
				),
			)
			.orderBy(asc(productCharacteristic.name)),
		db
			.select({
				id: productCharacteristicValue.characteristicId,
				cnt: count(),
			})
			.from(productCharacteristicValue)
			.innerJoin(product, eq(product.id, productCharacteristicValue.productId))
			.where(eq(product.productCategoryId, productCategoryId))
			.groupBy(productCharacteristicValue.characteristicId),
	]);

	const countById = new Map(counts.map((c) => [c.id, c.cnt]));
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		dataType: r.dataType,
		unit: r.unit,
		included: r.linkSortOrder !== null,
		required: r.required ?? false,
		valueCount: countById.get(r.id) ?? 0,
	}));
}

export async function setCategoryCharacteristic(params: {
	productCategoryId: string;
	characteristicId: string;
	required: boolean;
}) {
	const { productCategoryId, characteristicId, required } = params;
	await assertCategoryExists(productCategoryId);
	// Senza questo controllo un id inesistente arriverebbe alla chiave esterna,
	// che il gestore errori globale non traduce: un 500 invece di un 404.
	const characteristic = await db.query.productCharacteristic.findFirst({
		where: eq(productCharacteristic.id, characteristicId),
		columns: { id: true },
	});
	if (!characteristic) throw new ServiceError(404, "Caratteristica non trovata");

	return db.transaction(async (tx) => {
		const [{ last }] = await tx
			.select({ last: max(productCategoryCharacteristic.sortOrder) })
			.from(productCategoryCharacteristic)
			.where(eq(productCategoryCharacteristic.productCategoryId, productCategoryId));

		const [link] = await tx
			.insert(productCategoryCharacteristic)
			.values({
				productCategoryId,
				characteristicId,
				required,
				sortOrder: (last ?? -1) + 1,
			})
			// Già inclusa: cambia solo l'obbligatorietà, la posizione resta.
			.onConflictDoUpdate({
				target: [
					productCategoryCharacteristic.productCategoryId,
					productCategoryCharacteristic.characteristicId,
				],
				set: { required },
			})
			.returning();

		return link;
	});
}

export async function removeCategoryCharacteristic(params: {
	productCategoryId: string;
	characteristicId: string;
	confirmAffected: number;
}) {
	const { productCategoryId, characteristicId } = params;

	return db.transaction(async (tx) => {
		const affected = await countCategoryCharacteristicValues(
			productCategoryId,
			characteristicId,
			tx,
		);
		assertImpactConfirmed(affected, params.confirmAffected);

		// Prima i valori dei prodotti di QUESTA sotto-categoria (D10): la stessa
		// caratteristica resta valida, con i suoi valori, sulle altre.
		await tx.delete(productCharacteristicValue).where(
			and(
				eq(productCharacteristicValue.characteristicId, characteristicId),
				inArray(
					productCharacteristicValue.productId,
					tx
						.select({ id: product.id })
						.from(product)
						.where(eq(product.productCategoryId, productCategoryId)),
				),
			),
		);

		const [deleted] = await tx
			.delete(productCategoryCharacteristic)
			.where(
				and(
					eq(productCategoryCharacteristic.productCategoryId, productCategoryId),
					eq(productCategoryCharacteristic.characteristicId, characteristicId),
				),
			)
			.returning();

		if (!deleted) {
			throw new ServiceError(404, "Caratteristica non presente in questa sotto-categoria");
		}
		return { deletedValues: affected };
	});
}
```

Nota per l'implementatore: se `max` non è esportato dalla versione di `drizzle-orm` del repo (`^0.45`), usare `sql<number | null>\`max(${productCategoryCharacteristic.sortOrder})\`` — nel `.select()` di una query **non correlata** l'assenza di qualificazione non fa danni.

- [ ] **Step 4: Verificare che passino**

Run: `cd apps/api && bun test tests/integration/admin-category-characteristics.test.ts`
Expected: PASS, 11 test.

Poi, per vedere con i propri occhi che la correlazione è quella giusta (un test verde non lo prova: la tabella interna non ha una colonna `id`, quindi anche la forma sbagliata darebbe numeri corretti per caso):

Run: `grep -n "product_categories.id" apps/api/src/modules/admin/services/category-characteristics.ts`
Expected: una riga con `pcc.product_category_id = product_categories.id`.

- [ ] **Step 5: Schemi e query**

In `apps/api/src/lib/queries.ts` spostare da `apps/api/src/modules/product-categories.ts` la costante `ProductCategoryListQuery` (identica, ora `export`), e in quel modulo importarla da `@/lib/queries` al posto della definizione locale (rimuovendo l'import di `t` se non serve più).

In `apps/api/src/lib/schemas/entities.ts`, dopo `ProductCategoryWithMacroSchema`:

```ts
export const AdminProductCategorySchema = t.Object({
	...ProductCategoryWithMacroSchema.properties,
	characteristicCount: t.Integer({
		description: "Numero di caratteristiche assegnate alla sotto-categoria",
	}),
});
```

e dopo `AdminProductCharacteristicSchema` (Task 2):

```ts
export const CategoryCharacteristicStateSchema = t.Object({
	id: t.String({ description: "ID della caratteristica" }),
	name: t.String({ description: "Nome della caratteristica" }),
	dataType: CharacteristicDataTypeSchema,
	unit: t.Nullable(t.String()),
	included: t.Boolean({
		description: "La caratteristica è assegnata alla sotto-categoria",
	}),
	required: t.Boolean({
		description: "Il venditore deve compilarla (sempre false se non inclusa)",
	}),
	valueCount: t.Integer({
		description:
			"Prodotti della sotto-categoria che hanno già un valore per questa caratteristica",
	}),
});

export const CategoryCharacteristicLinkSchema = t.Object({
	productCategoryId: t.String(),
	characteristicId: t.String(),
	required: t.Boolean(),
	sortOrder: t.Integer({ description: "Posizione nel form del venditore" }),
});
```

- [ ] **Step 6: Le rotte**

Create `apps/api/src/modules/admin/routes/category-characteristics.ts`:

```ts
import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ProductCategoryListQuery } from "@/lib/queries";
import { ok, okMessage, okPage } from "@/lib/responses";
import {
	AdminProductCategorySchema,
	CategoryCharacteristicLinkSchema,
	CategoryCharacteristicStateSchema,
	OkMessage,
	okPageRes,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { withAdmin } from "../context";
import {
	listAdminProductCategories,
	listCategoryCharacteristics,
	removeCategoryCharacteristic,
	setCategoryCharacteristic,
} from "../services/category-characteristics";

const LinkParams = t.Object({
	productCategoryId: t.String({ description: "ID della sotto-categoria" }),
	characteristicId: t.String({ description: "ID della caratteristica" }),
});

export const categoryCharacteristicsRoutes = new Elysia()
	.get(
		"/product-categories",
		async ({ query }) => {
			const result = await listAdminProductCategories(query);
			return okPage(result.data, result.pagination);
		},
		{
			query: ProductCategoryListQuery,
			response: withErrors({ 200: okPageRes(AdminProductCategorySchema) }),
			detail: {
				summary: "Lista categorie prodotto (admin)",
				description:
					"Come la lista pubblica delle sotto-categorie, con in più il numero di caratteristiche assegnate a ciascuna.",
				tags: ["Admin"],
			},
		},
	)
	.get(
		"/product-categories/:productCategoryId/characteristics",
		async ({ params }) => {
			const data = await listCategoryCharacteristics(params.productCategoryId);
			return ok(data);
		},
		{
			params: t.Object({
				productCategoryId: t.String({ description: "ID della sotto-categoria" }),
			}),
			response: withErrors({
				200: okRes(t.Array(CategoryCharacteristicStateSchema)),
			}),
			detail: {
				summary: "Caratteristiche di una sotto-categoria",
				description:
					"Restituisce l'intero dizionario, non paginato, con lo stato di ogni voce per questa sotto-categoria: inclusa, obbligatoria e quanti prodotti della sotto-categoria hanno già un valore. 404 se la sotto-categoria non esiste.",
				tags: ["Admin"],
			},
		},
	)
	.put(
		"/product-categories/:productCategoryId/characteristics/:characteristicId",
		async (ctx) => {
			const { params, body, store, user } = withAdmin(ctx);
			const link = await setCategoryCharacteristic({ ...params, required: body.required });

			getLogger(store).info(
				{
					adminId: user.id,
					productCategoryId: link.productCategoryId,
					characteristicId: link.characteristicId,
					required: link.required,
					action: "product_category_characteristic_set",
				},
				"Caratteristica assegnata alla sotto-categoria",
			);

			return ok(link);
		},
		{
			params: LinkParams,
			body: t.Object({
				required: t.Boolean({ description: "Il venditore deve compilarla" }),
			}),
			response: withConflictErrors({ 200: okRes(CategoryCharacteristicLinkSchema) }),
			detail: {
				summary: "Assegna caratteristica a sotto-categoria",
				description:
					"Include la caratteristica nella sotto-categoria (in coda al form del venditore) o, se è già inclusa, ne cambia solo l'obbligatorietà. Idempotente. 404 se sotto-categoria o caratteristica non esistono.",
				tags: ["Admin"],
			},
		},
	)
	.delete(
		"/product-categories/:productCategoryId/characteristics/:characteristicId",
		async (ctx) => {
			const { params, body, store, user } = withAdmin(ctx);
			const { deletedValues } = await removeCategoryCharacteristic({
				...params,
				confirmAffected: body.confirmAffected,
			});

			getLogger(store).info(
				{
					adminId: user.id,
					productCategoryId: params.productCategoryId,
					characteristicId: params.characteristicId,
					deletedValues,
					action: "product_category_characteristic_removed",
				},
				"Caratteristica rimossa dalla sotto-categoria",
			);

			return okMessage("Characteristic removed from product category");
		},
		{
			params: LinkParams,
			body: t.Object({
				confirmAffected: t.Integer({
					minimum: 0,
					description:
						"Numero di prodotti della sotto-categoria con un valore che l'interfaccia ha mostrato nella conferma. Se sono di più, 409 e nulla viene cancellato.",
				}),
			}),
			response: withConflictErrors({ 200: OkMessage }),
			detail: {
				summary: "Rimuovi caratteristica da sotto-categoria",
				description:
					"Toglie la caratteristica dalla sotto-categoria e cancella i valori già compilati sui suoi prodotti; sulle altre sotto-categorie la caratteristica e i suoi valori restano. Richiede confirmAffected (409 altrimenti); 404 se la caratteristica non è assegnata.",
				tags: ["Admin"],
			},
		},
	);
```

In `apps/api/src/modules/admin/index.ts` importare `categoryCharacteristicsRoutes` e aggiungere `.use(categoryCharacteristicsRoutes)` subito dopo `.use(productCategoriesWriteRoutes)`.

- [ ] **Step 7: Verificare**

Run: `bun run --cwd apps/api typecheck; echo "api=$?"` — Expected: `api=0`.
Run: `bunx biome check apps/api/src apps/api/tests/integration/admin-category-characteristics.test.ts` — Expected: nessun errore.
Run: `cd apps/api && bun test tests/integration/admin-category-characteristics.test.ts tests/integration/admin-product-categories.test.ts` — Expected: PASS.

- [ ] **Step 8: Suite completa e schema**

Run: `bun run --cwd apps/api test 2>&1 | tail -8`
Expected: `0 fail` e un totale pari alla baseline dello Step 0 del Task 1 **più** i test aggiunti nei Task 1-4 (8 + 19 + 11 = 38).

Run: `bun run db:generate`
Expected: `No schema changes, nothing to migrate`.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src apps/api/tests/integration/admin-category-characteristics.test.ts
git commit -m "feat(api): matrice delle caratteristiche per sotto-categoria

Elenco admin delle sotto-categorie con il conteggio, stato del dizionario
per una sotto-categoria, inclusione e rimozione. La rimozione cancella i
valori dei soli prodotti di quella sotto-categoria, se confermata.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Admin — dizionario

**Files:**
- Modify: `apps/admin/src/features/crud/category-crud-panel.tsx`
- Modify: `apps/admin/src/features/csv-import/components/csv-import-dialog.tsx`
- Create: `apps/admin/src/features/product-characteristics/data-type.ts`
- Create: `apps/admin/src/features/product-characteristics/impact.ts`
- Create: `apps/admin/src/features/product-characteristics/schemas/product-characteristic.ts`
- Create: `apps/admin/src/features/product-characteristics/components/product-characteristic-form.tsx`
- Create: `apps/admin/src/features/product-characteristics/product-characteristics.config.tsx`
- Modify: `apps/admin/src/routes/_authenticated/configurations.tsx`

**Interfaces:**
- Consumes: le rotte dei Task 2 e 3 via Eden (`api().admin["product-characteristics"]`), `GET /admin/configurations/counts` con `productCharacteristics`.
- Produces:
  - `CategoryCrudConfig.remove: (id: string, entity: TEntity) => …` e `labels.deleteDescription: (name: string, entity: TEntity) => ReactNode` — il secondo argomento è nuovo e le quattro configurazioni esistenti lo ignorano senza modifiche.
  - `CsvImportResult` accetta `skipped` **oppure** `updated`.
  - `DATA_TYPE_LABELS: Record<CharacteristicDataType, string>` e `type CharacteristicDataType` in `data-type.ts` (li riusa il Task 6).
  - `characteristicUpdateImpact(baseline: CharacteristicBaseline, form: ProductCharacteristicFormData): number` in `impact.ts`.

- [ ] **Step 1: Il pannello condiviso passa l'entità a `remove` e `deleteDescription`**

In `apps/admin/src/features/crud/category-crud-panel.tsx`:

```ts
	remove: (id: string, entity: TEntity) => Promise<EdenRes<unknown>>;
```
```ts
		deleteDescription: (name: string, entity: TEntity) => ReactNode;
```

La mutazione di eliminazione riceve l'entità intera, e in caso di errore ricarica la lista: se il conteggio mostrato nella conferma era vecchio (409 dal server), riaprendo la conferma l'admin vede quello nuovo. Per la stessa ragione anche l'`onError` di `updateMutation` chiama `invalidateAll()` prima del toast: il form di modifica misura l'impatto sui conteggi della lista.

```ts
	const deleteMutation = useMutation({
		mutationFn: (entity: TEntity) =>
			unwrap(config.remove(entity.id, entity), "Errore durante l'eliminazione"),
		onSuccess: () => {
			invalidateAll();
			setDeleteOpen(false);
			setSelected(null);
			toast.success(config.labels.toasts.deleteOk);
		},
		onError: (e: Error) => {
			invalidateAll();
			toast.error(e.message || "Errore durante l'eliminazione");
		},
	});

	const handleDelete = () => {
		if (!selected) return;
		deleteMutation.mutate(selected);
	};
```

e nell'`AlertDialogDescription`:

```tsx
							{selected
								? config.labels.deleteDescription(selected.name, selected)
								: null}
```

Le quattro configurazioni esistenti (`remove: (id) => …`, `deleteDescription: (name) => …`) restano valide: una funzione con meno parametri è assegnabile.

- [ ] **Step 2: Il dialog di import riconosce `updated`**

In `apps/admin/src/features/csv-import/components/csv-import-dialog.tsx`:

```ts
// Gli import di categorie sono additivi e riportano le righe saltate; quello
// del dizionario è in aggiornamento e riporta le righe aggiornate.
export type CsvImportResult = {
	created: number;
	failed: number;
	errors: Array<{ row: number; message: string }>;
} & ({ skipped: number } | { updated: number });
```

Nel `handleSubmit`, la condizione di successo parziale diventa:

```ts
			} else if (data.created > 0 || ("skipped" in data ? data.skipped : data.updated) > 0) {
```

e nella griglia del risultato la seconda casella mostra l'etichetta e il numero giusti:

```tsx
								<div className="text-muted-foreground text-xs">
									{"updated" in result ? "Aggiornate" : "Saltate"}
								</div>
								<div className="text-2xl font-semibold">
									{"updated" in result ? result.updated : result.skipped}
								</div>
```

(conservare le classi già presenti sulla casella; qui sono indicative).

- [ ] **Step 3: Etichette dei tipi e calcolo dell'impatto**

Create `apps/admin/src/features/product-characteristics/data-type.ts`:

```ts
export const CHARACTERISTIC_DATA_TYPES = ["text", "number", "boolean", "enum"] as const;
export type CharacteristicDataType = (typeof CHARACTERISTIC_DATA_TYPES)[number];

export const DATA_TYPE_LABELS: Record<CharacteristicDataType, string> = {
	text: "Testo",
	number: "Numero",
	boolean: "Sì/No",
	enum: "Lista chiusa",
};

export function productsPhrase(n: number): string {
	return `${n} prodott${n === 1 ? "o" : "i"}`;
}
```

Create `apps/admin/src/features/product-characteristics/schemas/product-characteristic.ts`:

```ts
import { z } from "zod";
import { CHARACTERISTIC_DATA_TYPES } from "../data-type";

export const productCharacteristicFormSchema = z
	.object({
		name: z.string().trim().min(1, "Il nome è obbligatorio").max(100),
		dataType: z.enum(CHARACTERISTIC_DATA_TYPES),
		unit: z.string().trim().max(20),
		// `optionId`, non `id`: useFieldArray riserva `id` per le sue chiavi.
		options: z.array(
			z.object({
				optionId: z.string().optional(),
				value: z.string().trim().max(100),
			}),
		),
	})
	.superRefine((data, ctx) => {
		if (data.dataType !== "enum") return;
		const values = data.options.map((o) => o.value).filter(Boolean);
		if (values.length === 0) {
			ctx.addIssue({
				code: "custom",
				path: ["options"],
				message: "Una lista chiusa richiede almeno un'opzione",
			});
		}
		const dup = values.find((v, i) => values.indexOf(v) !== i);
		if (dup) {
			ctx.addIssue({
				code: "custom",
				path: ["options"],
				message: `Opzione ripetuta: "${dup}"`,
			});
		}
	});

export type ProductCharacteristicFormData = z.infer<
	typeof productCharacteristicFormSchema
>;

/** Lo stato salvato, contro cui il form misura quanti prodotti perdono un valore. */
export interface CharacteristicBaseline {
	dataType: ProductCharacteristicFormData["dataType"];
	valueCount: number;
	options: { id: string; valueCount: number }[];
}

/** Quello che il form consegna al pannello: i dati, e il numero confermato. */
export interface ProductCharacteristicSubmit {
	form: ProductCharacteristicFormData;
	baseline?: CharacteristicBaseline;
	confirmAffected: number;
}
```

Create `apps/admin/src/features/product-characteristics/impact.ts`:

```ts
import type {
	CharacteristicBaseline,
	ProductCharacteristicFormData,
} from "./schemas/product-characteristic";

/**
 * Quanti prodotti perdono un valore salvando `form`. Replica la regola del
 * server (updateProductCharacteristic): un cambio di tipo li tocca tutti,
 * altrimenti contano le sole opzioni salvate che il form non contiene più.
 * Il server ricalcola comunque e respinge con 409 una conferma troppo bassa.
 */
export function characteristicUpdateImpact(
	baseline: CharacteristicBaseline,
	form: ProductCharacteristicFormData,
): number {
	if (form.dataType !== baseline.dataType) return baseline.valueCount;
	if (form.dataType !== "enum") return 0;
	const kept = new Set(form.options.flatMap((o) => (o.optionId ? [o.optionId] : [])));
	return baseline.options
		.filter((o) => !kept.has(o.id))
		.reduce((sum, o) => sum + o.valueCount, 0);
}
```

- [ ] **Step 4: Il form**

Create `apps/admin/src/features/product-characteristics/components/product-characteristic-form.tsx`. Il form segue `ProductCategoryForm` (RHF + `zodResolver`, `Field`/`FieldLabel`/`FieldError`, `NativeSelect`, pulsanti Annulla/Salva), **senza** l'effetto `reset(defaultValues)`. Quando c'è un impatto, prima di consegnare i dati apre un `AlertDialog` con il numero:

```tsx
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@bibs/ui/components/alert-dialog";
import { Button } from "@bibs/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@bibs/ui/components/native-select";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import type { CrudFormProps } from "@/features/crud/category-crud-panel";
import {
	CHARACTERISTIC_DATA_TYPES,
	DATA_TYPE_LABELS,
	productsPhrase,
} from "../data-type";
import { characteristicUpdateImpact } from "../impact";
import {
	type ProductCharacteristicFormData,
	type ProductCharacteristicSubmit,
	productCharacteristicFormSchema,
} from "../schemas/product-characteristic";

const EMPTY_FORM: ProductCharacteristicFormData = {
	name: "",
	dataType: "text",
	unit: "",
	options: [],
};

export function ProductCharacteristicForm({
	defaultValues,
	onSubmit,
	onCancel,
	isPending,
	submitLabel,
	pendingLabel,
}: CrudFormProps<ProductCharacteristicSubmit>) {
	const baseline = defaultValues?.baseline;
	const {
		register,
		control,
		handleSubmit,
		watch,
		formState: { errors },
	} = useForm<ProductCharacteristicFormData>({
		resolver: zodResolver(productCharacteristicFormSchema),
		defaultValues: defaultValues?.form ?? EMPTY_FORM,
	});
	const { fields, append, remove } = useFieldArray({ control, name: "options" });
	const dataType = watch("dataType");
	const [pending, setPending] = useState<{
		form: ProductCharacteristicFormData;
		affected: number;
	} | null>(null);

	const submit = (form: ProductCharacteristicFormData) => {
		const affected = baseline ? characteristicUpdateImpact(baseline, form) : 0;
		if (affected > 0) {
			setPending({ form, affected });
			return;
		}
		onSubmit({ form, baseline, confirmAffected: 0 });
	};

	const typeChanged = !!baseline && pending?.form.dataType !== baseline.dataType;

	return (
		<>
			<form onSubmit={handleSubmit(submit)}>
				<div className="space-y-4 py-4">
					<Field data-invalid={!!errors.name}>
						<FieldLabel htmlFor="characteristic-name">Nome</FieldLabel>
						<Input id="characteristic-name" placeholder="Es. Colore" {...register("name")} />
						<FieldError errors={[errors.name]} />
					</Field>

					<Field>
						<FieldLabel htmlFor="characteristic-type">Tipo</FieldLabel>
						<NativeSelect id="characteristic-type" className="w-full" {...register("dataType")}>
							{CHARACTERISTIC_DATA_TYPES.map((d) => (
								<NativeSelectOption key={d} value={d}>
									{DATA_TYPE_LABELS[d]}
								</NativeSelectOption>
							))}
						</NativeSelect>
						{baseline && baseline.valueCount > 0 && (
							<FieldDescription>
								Cambiare tipo elimina i valori già compilati su{" "}
								{productsPhrase(baseline.valueCount)}.
							</FieldDescription>
						)}
					</Field>

					{dataType === "number" && (
						<Field data-invalid={!!errors.unit}>
							<FieldLabel htmlFor="characteristic-unit">Unità di misura</FieldLabel>
							<Input id="characteristic-unit" placeholder="Es. g, cm, W" {...register("unit")} />
							<FieldDescription>
								Facoltativa. Cambiarla non converte i valori già inseriti.
							</FieldDescription>
							<FieldError errors={[errors.unit]} />
						</Field>
					)}

					{dataType === "enum" && (
						<Field data-invalid={!!errors.options}>
							<FieldLabel>Opzioni</FieldLabel>
							<div className="space-y-2">
								{fields.map((field, index) => (
									<div key={field.id} className="flex items-center gap-2">
										<Input
											aria-label={`Opzione ${index + 1}`}
											{...register(`options.${index}.value`)}
										/>
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											aria-label={`Rimuovi opzione ${index + 1}`}
											onClick={() => remove(index)}
										>
											<XIcon className="size-4" />
										</Button>
									</div>
								))}
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => append({ value: "" })}
								>
									<PlusIcon />
									Aggiungi opzione
								</Button>
							</div>
							<FieldDescription>
								Rinominare un'opzione conserva i valori dei prodotti; rimuoverla li elimina.
							</FieldDescription>
							<FieldError errors={[errors.options?.root ?? errors.options]} />
						</Field>
					)}
				</div>

				<div className="flex justify-end gap-3">
					<Button type="button" variant="outline" onClick={onCancel}>
						Annulla
					</Button>
					<Button type="submit" disabled={isPending}>
						{isPending ? pendingLabel : submitLabel}
					</Button>
				</div>
			</form>

			<AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Conferma modifica</AlertDialogTitle>
						<AlertDialogDescription>
							{typeChanged
								? `Cambiando tipo, i valori già compilati su ${productsPhrase(pending?.affected ?? 0)} verranno eliminati definitivamente.`
								: `Le opzioni rimosse sono in uso: ${productsPhrase(pending?.affected ?? 0)} perderanno il valore, che verrà eliminato definitivamente.`}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => setPending(null)}>Annulla</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => {
								if (!pending) return;
								onSubmit({ form: pending.form, baseline, confirmAffected: pending.affected });
								setPending(null);
							}}
						>
							Elimina i valori e salva
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
```

Se `FieldDescription` non è esportato da `@bibs/ui/components/field`, usare `<p className="text-muted-foreground text-sm">`. Se il `FieldError` di un array non accetta `errors.options?.root ?? errors.options` per tipo, passare `{ message: errors.options?.root?.message ?? errors.options?.message }`.

- [ ] **Step 5: La configurazione**

Create `apps/admin/src/features/product-characteristics/product-characteristics.config.tsx`:

```tsx
import {
	NativeSelect,
	NativeSelectOption,
} from "@bibs/ui/components/native-select";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { ListChecksIcon } from "lucide-react";
import type { CategoryCrudConfig } from "@/features/crud/category-crud-panel";
import type { CsvImportResult } from "@/features/csv-import/components/csv-import-dialog";
import { api } from "@/lib/api";
import { ProductCharacteristicForm } from "./components/product-characteristic-form";
import {
	CHARACTERISTIC_DATA_TYPES,
	type CharacteristicDataType,
	DATA_TYPE_LABELS,
	productsPhrase,
} from "./data-type";
import type { ProductCharacteristicSubmit } from "./schemas/product-characteristic";

interface ProductCharacteristic {
	id: string;
	name: string;
	dataType: CharacteristicDataType;
	unit: string | null;
	valueCount: number;
	options: { id: string; value: string; sortOrder: number; valueCount: number }[];
	createdAt: Date | string;
}

const PREVIEW_OPTIONS = 3;

function toBody({ form }: ProductCharacteristicSubmit) {
	return {
		name: form.name,
		dataType: form.dataType,
		unit: form.dataType === "number" && form.unit ? form.unit : null,
		options:
			form.dataType === "enum"
				? form.options
						.filter((o) => o.value)
						.map((o) => ({ ...(o.optionId ? { id: o.optionId } : {}), value: o.value }))
				: [],
	};
}

const extraColumns: DataTableColumnDef<ProductCharacteristic>[] = [
	{
		id: "dataType",
		header: "Tipo",
		meta: { cellClassName: "text-muted-foreground" },
		cell: ({ row }) => DATA_TYPE_LABELS[row.original.dataType],
	},
	{
		id: "unit",
		header: "Unità",
		meta: { cellClassName: "text-muted-foreground" },
		cell: ({ row }) => row.original.unit ?? "—",
	},
	{
		id: "options",
		header: "Valori ammessi",
		meta: { cellClassName: "text-muted-foreground max-w-80 truncate" },
		cell: ({ row }) => {
			const { options } = row.original;
			if (options.length === 0) return "—";
			const shown = options.slice(0, PREVIEW_OPTIONS).map((o) => o.value).join(", ");
			const rest = options.length - PREVIEW_OPTIONS;
			return rest > 0 ? `${shown} +${rest}` : shown;
		},
	},
];

function DataTypeFilter({
	values,
	set,
}: {
	values: Record<string, string>;
	set: (key: string, value: string) => void;
}) {
	return (
		<NativeSelect
			className="w-48"
			value={values.dataType ?? ""}
			onChange={(e) => set("dataType", e.target.value)}
			aria-label="Filtra per tipo"
		>
			<NativeSelectOption value="">Tutti i tipi</NativeSelectOption>
			{CHARACTERISTIC_DATA_TYPES.map((d) => (
				<NativeSelectOption key={d} value={d}>
					{DATA_TYPE_LABELS[d]}
				</NativeSelectOption>
			))}
		</NativeSelect>
	);
}

export const productCharacteristicsConfig: CategoryCrudConfig<
	ProductCharacteristic,
	ProductCharacteristicSubmit
> = {
	queryKeyBase: "product-characteristics",
	storageKey: "admin.product-characteristics.columns",
	// La pastiglia delle sotto-categorie conta le voci della matrice, che una
	// cancellazione dal dizionario porta via in cascata.
	extraInvalidate: [["admin-configurations-counts"], ["product-categories"]],

	list: (q) =>
		api().admin["product-characteristics"].get({
			query: {
				page: q.page,
				limit: q.limit,
				...(q.search ? { search: q.search } : {}),
				...(q.dataType ? { dataType: q.dataType as CharacteristicDataType } : {}),
				sortBy: q.sortBy,
				sortOrder: q.sortOrder,
			},
		}),
	create: (submit) => api().admin["product-characteristics"].post(toBody(submit)),
	update: (id, submit) =>
		api()
			.admin["product-characteristics"]({ characteristicId: id })
			.patch({ ...toBody(submit), confirmAffected: submit.confirmAffected }),
	remove: (id, entity) =>
		api()
			.admin["product-characteristics"]({ characteristicId: id })
			.delete({ confirmAffected: entity.valueCount }),

	extraColumns,
	emptyIcon: <ListChecksIcon className="text-muted-foreground/40 size-8" />,

	renderForm: (p) => <ProductCharacteristicForm {...p} />,
	editDefaults: (e) => ({
		form: {
			name: e.name,
			dataType: e.dataType,
			unit: e.unit ?? "",
			options: e.options.map((o) => ({ optionId: o.id, value: o.value })),
		},
		baseline: {
			dataType: e.dataType,
			valueCount: e.valueCount,
			options: e.options.map((o) => ({ id: o.id, valueCount: o.valueCount })),
		},
		confirmAffected: 0,
	}),

	toolbarFilter: (ctx) => <DataTypeFilter values={ctx.values} set={ctx.set} />,

	csvImport: {
		onImport: async (file): Promise<CsvImportResult> => {
			const res = await api().admin["product-characteristics"].import.post({ file });
			if (res.error)
				throw new Error(res.error.value?.message || "Errore durante l'import");
			const data = res.data?.data;
			if (!data) throw new Error("Risposta non valida dal server");
			return data;
		},
		title: "Importa Caratteristiche Prodotto",
		description: "Carica un file CSV per creare o correggere in blocco il dizionario.",
		formatHint:
			"Header attesi: name, data_type, unit, options (separate da |). Le voci già presenti vengono aggiornate; un cambio di tipo su una voce con valori viene rifiutato e va fatto da qui.",
	},

	labels: {
		searchPlaceholder: "Cerca caratteristica...",
		empty: {
			title: "Nessuna caratteristica trovata",
			subtitle: "Crea la prima caratteristica o importa il dizionario da CSV",
		},
		total: (n) => `Totale: ${n} caratteristic${n === 1 ? "a" : "he"}`,
		createDialog: {
			title: "Nuova Caratteristica",
			description: "Scegli nome e tipo. Le liste chiuse richiedono almeno un'opzione.",
		},
		editDialog: {
			title: "Modifica Caratteristica",
			description: "Modifica nome, tipo, unità e opzioni della caratteristica.",
		},
		deleteDescription: (name, e) =>
			e.valueCount > 0
				? `"${name}" ha valori su ${productsPhrase(e.valueCount)}: verranno eliminati definitivamente, insieme alla caratteristica e alle sue assegnazioni alle sotto-categorie.`
				: `Sei sicuro di voler eliminare la caratteristica "${name}"? Verrà tolta da tutte le sotto-categorie. Questa azione non può essere annullata.`,
		toasts: {
			createOk: "Caratteristica creata con successo",
			updateOk: "Caratteristica aggiornata con successo",
			deleteOk: "Caratteristica eliminata con successo",
		},
		rowAria: {
			edit: "Modifica caratteristica",
			delete: "Elimina caratteristica",
		},
	},
};
```

- [ ] **Step 6: La scheda nella pagina Configurazioni**

In `apps/admin/src/routes/_authenticated/configurations.tsx`:

- importare `productCharacteristicsConfig`;
- nell'array `tabs`, subito dopo `product-categories`:
  ```ts
  		{
  			value: "product-characteristics",
  			label: "Caratteristiche Prodotto",
  			count: countsData?.productCharacteristics ?? null,
  		},
  ```
- l'etichetta del pulsante di creazione:
  ```tsx
  				<CreateButton onClick={() => setCreateOpen(true)}>
  					{tab === "holidays"
  						? "Nuova Festività"
  						: tab === "product-characteristics"
  							? "Nuova Caratteristica"
  							: "Nuova Categoria"}
  				</CreateButton>
  ```
- il pannello, dopo quello di `product-categories`:
  ```tsx
  			{tab === "product-characteristics" && (
  				<CategoryCrudPanel
  					config={productCharacteristicsConfig}
  					createOpen={createOpen}
  					onCreateOpenChange={setCreateOpen}
  				/>
  			)}
  ```

- [ ] **Step 7: Verificare**

Run: `bun run --cwd apps/admin typecheck; echo "admin=$?"` — Expected: `admin=0`. Un errore sui tipi Eden (`.delete({ confirmAffected })`, `.patch(...)`) va risolto allineando le chiamate alle rotte, mai con un cast.
Run: `bunx biome check apps/admin/src` — Expected: nessun errore.
Run: `bun run --cwd apps/seller typecheck; echo "seller=$?"; bun run --cwd apps/customer typecheck; echo "customer=$?"` — Expected: `0` e `0`.

- [ ] **Step 8: Collaudo nel browser**

Con infrastruttura e seed già presenti (non lanciare `db:reset`/`db:seed` senza Marco): `bun run --cwd apps/api dev` e `bun run --cwd apps/admin dev`. Entrare su `http://localhost:3003` come `admin1@test.com` / `password123`, pagina *Configurazioni* → *Caratteristiche Prodotto*.

Verificare, con **mouse e tastiera come percorsi distinti** (Tab / Invio / Spazio):
1. La scheda mostra il contatore 207 e la lista paginata; il filtro *Tipo* = *Lista chiusa* riduce a 69.
2. Creare `Prova` di tipo *Numero* con unità `kg`: il campo unità compare solo con *Numero*; il campo opzioni solo con *Lista chiusa*.
3. Modificare `Colore`: rinominare un'opzione usata dai prodotti del seed → salva **senza** conferma. Rimuovere un'opzione usata → compare la conferma con il numero di prodotti; *Annulla* non salva nulla.
4. Eliminare `Prova` (senza valori): testo di conferma semplice. Su una voce con valori (es. `Colore`) il testo riporta il numero — **fermarsi a *Annulla***, non eliminarla sul database di sviluppo.
5. Tema scuro (`localStorage.theme = 'dark'` e ricarica): testo leggibile in tabella, form e conferme.

Riportare nel resoconto cosa è stato visto, con screenshot aperti e guardati, non descritti.

- [ ] **Step 9: Commit**

```bash
git add apps/admin/src
git commit -m "feat(admin): gestione del dizionario delle caratteristiche

Quinta configurazione di CategoryCrudPanel: tipo, unita', opzioni con
rinomina che conserva i valori, e conferme che dicono quanti prodotti
perdono un valore prima di salvare o eliminare.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Admin — pannello di assegnazione

**Files:**
- Modify: `apps/admin/src/features/product-categories/product-categories.config.tsx`
- Create: `apps/admin/src/features/category-characteristics/hooks/use-category-characteristics.ts`
- Create: `apps/admin/src/features/category-characteristics/components/category-characteristics-panel.tsx`
- Create: `apps/admin/src/features/category-characteristics/components/category-characteristics-button.tsx`

**Interfaces:**
- Consumes: le rotte del Task 4 via Eden; `DATA_TYPE_LABELS`, `productsPhrase`, `CharacteristicDataType` (Task 5).
- Produces:
  - `useCategoryCharacteristics(categoryId: string)` → `{ rows, isLoading, error, include, remove, isMutating }`, dove `include.mutate({ characteristicId, required })` e `remove.mutate({ characteristicId, confirmAffected })`.
  - `<CategoryCharacteristicsPanel categoryId={…} />` — la tabella.
  - `<CategoryCharacteristicsButton category={{ id, name, characteristicCount, macroCategory: { name } }} />` — la pastiglia che apre il pannello laterale.

- [ ] **Step 1: L'hook dei dati**

Create `apps/admin/src/features/category-characteristics/hooks/use-category-characteristics.ts`:

```ts
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function categoryCharacteristicsKey(categoryId: string) {
	return ["admin-category-characteristics", categoryId] as const;
}

export function useCategoryCharacteristics(categoryId: string) {
	const queryClient = useQueryClient();
	const endpoint = () =>
		api().admin["product-categories"]({ productCategoryId: categoryId }).characteristics;

	const { data, isLoading, error } = useQuery({
		queryKey: categoryCharacteristicsKey(categoryId),
		queryFn: async () => {
			const res = await endpoint().get();
			if (res.error)
				throw new Error(res.error.value?.message || "Errore nel caricamento delle caratteristiche");
			return res.data?.data ?? [];
		},
	});

	// Il pannello e la pastiglia nella tabella delle sotto-categorie (che mostra
	// il conteggio) leggono da due query diverse: si aggiornano entrambe.
	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: categoryCharacteristicsKey(categoryId) });
		void queryClient.invalidateQueries({ queryKey: ["product-categories"] });
	};

	const include = useMutation({
		mutationFn: async (p: { characteristicId: string; required: boolean }) => {
			const res = await endpoint()({ characteristicId: p.characteristicId }).put({
				required: p.required,
			});
			if (res.error) throw new Error(res.error.value?.message || "Errore durante il salvataggio");
		},
		onSuccess: refresh,
		onError: (e: Error) => toast.error(e.message),
	});

	const remove = useMutation({
		mutationFn: async (p: { characteristicId: string; confirmAffected: number }) => {
			const res = await endpoint()({ characteristicId: p.characteristicId }).delete({
				confirmAffected: p.confirmAffected,
			});
			if (res.error) throw new Error(res.error.value?.message || "Errore durante la rimozione");
		},
		onSuccess: refresh,
		// Anche sull'errore: un 409 per conteggio vecchio deve portare in pagina
		// il numero nuovo prima che l'admin riprovi.
		onError: (e: Error) => {
			refresh();
			toast.error(e.message);
		},
	});

	return {
		rows: data ?? [],
		isLoading,
		error: error as Error | null,
		include,
		remove,
		isMutating: include.isPending || remove.isPending,
	};
}
```

- [ ] **Step 2: Il pannello**

Create `apps/admin/src/features/category-characteristics/components/category-characteristics-panel.tsx`:

```tsx
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@bibs/ui/components/alert-dialog";
import { DataTable } from "@bibs/ui/components/data-table";
import { Input } from "@bibs/ui/components/input";
import { Switch } from "@bibs/ui/components/switch";
import { TabNav } from "@bibs/ui/components/tab-nav";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { SearchIcon } from "lucide-react";
import { useState } from "react";
import {
	type CharacteristicDataType,
	DATA_TYPE_LABELS,
	productsPhrase,
} from "@/features/product-characteristics/data-type";
import { useCategoryCharacteristics } from "../hooks/use-category-characteristics";

interface Row {
	id: string;
	name: string;
	dataType: CharacteristicDataType;
	unit: string | null;
	included: boolean;
	required: boolean;
	valueCount: number;
}

type Tab = "all" | "included";

export function CategoryCharacteristicsPanel({ categoryId }: { categoryId: string }) {
	"use no memo";

	const { rows, isLoading, error, include, remove, isMutating } =
		useCategoryCharacteristics(categoryId);
	const [tab, setTab] = useState<Tab>("all");
	const [search, setSearch] = useState("");
	const [pendingRemoval, setPendingRemoval] = useState<Row | null>(null);

	const needle = search.trim().toLowerCase();
	const visible = rows.filter(
		(r) => (tab === "all" || r.included) && r.name.toLowerCase().includes(needle),
	);
	const includedCount = rows.filter((r) => r.included).length;

	const toggleIncluded = (row: Row, next: boolean) => {
		if (next) {
			include.mutate({ characteristicId: row.id, required: false });
		} else if (row.valueCount > 0) {
			setPendingRemoval(row);
		} else {
			remove.mutate({ characteristicId: row.id, confirmAffected: 0 });
		}
	};

	const columns: DataTableColumnDef<Row>[] = [
		{
			id: "name",
			header: "Caratteristica",
			meta: { cellClassName: "pl-4" , headerClassName: "pl-4" },
			cell: ({ row }) => (
				<div className="flex flex-col">
					<span className="font-medium">{row.original.name}</span>
					<span className="text-muted-foreground text-xs">
						{DATA_TYPE_LABELS[row.original.dataType]}
						{row.original.unit ? ` · ${row.original.unit}` : ""}
						{row.original.valueCount > 0
							? ` · valori su ${productsPhrase(row.original.valueCount)}`
							: ""}
					</span>
				</div>
			),
		},
		{
			id: "included",
			header: "Inclusa",
			meta: { cellClassName: "w-24" },
			cell: ({ row }) => (
				<Switch
					checked={row.original.included}
					disabled={isMutating}
					onCheckedChange={(v) => toggleIncluded(row.original, v)}
					aria-label={`Includi ${row.original.name}`}
				/>
			),
		},
		{
			id: "required",
			header: "Obbligatoria",
			meta: { cellClassName: "w-28 pr-4", headerClassName: "pr-4" },
			cell: ({ row }) => (
				<Switch
					checked={row.original.required}
					disabled={!row.original.included || isMutating}
					onCheckedChange={(v) =>
						include.mutate({ characteristicId: row.original.id, required: v })
					}
					aria-label={`Rendi obbligatoria ${row.original.name}`}
				/>
			),
		},
	];

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			{error && (
				<p className="text-destructive text-sm">Errore nel caricamento: {error.message}</p>
			)}

			<TabNav
				tabs={[
					{ value: "all", label: "Tutte", count: rows.length },
					{ value: "included", label: "Incluse", count: includedCount },
				]}
				activeTab={tab}
				onTabChange={(v) => setTab(v as Tab)}
			/>

			<div className="relative">
				<SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
				<Input
					placeholder="Cerca caratteristica..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="pl-9"
				/>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<DataTable
					data={visible}
					columns={columns}
					getRowId={(r) => r.id}
					isLoading={isLoading}
					isRowSelected={(r) => r.original.included}
					emptyState={
						<p className="text-muted-foreground text-sm">
							{tab === "included"
								? "Nessuna caratteristica inclusa in questa sotto-categoria."
								: "Nessuna caratteristica corrisponde alla ricerca."}
						</p>
					}
				/>
			</div>

			<AlertDialog
				open={!!pendingRemoval}
				onOpenChange={(open) => !open && setPendingRemoval(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Rimuovere "{pendingRemoval?.name}"?</AlertDialogTitle>
						<AlertDialogDescription>
							Questa caratteristica ha valori su{" "}
							{productsPhrase(pendingRemoval?.valueCount ?? 0)} di questa
							sotto-categoria: verranno eliminati definitivamente.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => setPendingRemoval(null)}>Annulla</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => {
								if (!pendingRemoval) return;
								remove.mutate({
									characteristicId: pendingRemoval.id,
									confirmAffected: pendingRemoval.valueCount,
								});
								setPendingRemoval(null);
							}}
						>
							Rimuovi ed elimina i valori
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
```

Controllare la firma di `isRowSelected` in `packages/ui/src/components/data-table.tsx` (riceve una `DataTableRow<TData>`, quindi `r.original`); se `TabNav` richiede `children`, non passarne.

- [ ] **Step 3: La pastiglia**

Create `apps/admin/src/features/category-characteristics/components/category-characteristics-button.tsx`:

```tsx
import { Button } from "@bibs/ui/components/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@bibs/ui/components/sheet";
import { useState } from "react";
import { CategoryCharacteristicsPanel } from "./category-characteristics-panel";

interface CategoryRef {
	id: string;
	name: string;
	characteristicCount: number;
	macroCategory: { name: string };
}

/**
 * Il conteggio è anche il comando: la tabella condivisa delle categorie non
 * ha un punto di estensione per le azioni di riga, ma accetta celle
 * arbitrarie. Il pannello si monta solo ad apertura avvenuta, così la lista
 * delle sotto-categorie non scarica 179 volte il dizionario.
 */
export function CategoryCharacteristicsButton({ category }: { category: CategoryRef }) {
	const [open, setOpen] = useState(false);
	const n = category.characteristicCount;

	return (
		<>
			<Button
				variant="outline"
				size="xs"
				className="rounded-full tabular-nums"
				onClick={() => setOpen(true)}
				aria-label={`Gestisci le caratteristiche di ${category.name}`}
			>
				{n} caratteristic{n === 1 ? "a" : "he"}
			</Button>
			<Sheet open={open} onOpenChange={setOpen}>
				<SheetContent className="w-full data-[side=right]:sm:max-w-2xl">
					<SheetHeader>
						<SheetTitle>{category.name}</SheetTitle>
						<SheetDescription>
							{category.macroCategory.name} · Scegli quali caratteristiche compila il
							venditore per i prodotti di questa sotto-categoria.
						</SheetDescription>
					</SheetHeader>
					<div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
						{open && <CategoryCharacteristicsPanel categoryId={category.id} />}
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
}
```

- [ ] **Step 4: La colonna nella tabella delle sotto-categorie**

In `apps/admin/src/features/product-categories/product-categories.config.tsx`:

- `interface ProductCategory` aggiunge `characteristicCount: number;`
- `list` legge dall'endpoint admin (stessi parametri):
  ```ts
  	list: (q) =>
  		api().admin["product-categories"].get({
  			query: { /* identico a prima */ },
  		}),
  ```
- nuova colonna, dopo `macroColumn`:
  ```tsx
  const characteristicsColumn: DataTableColumnDef<ProductCategory> = {
  	id: "characteristics",
  	header: "Caratteristiche",
  	meta: { menuLabel: "Caratteristiche" },
  	cell: ({ row }) => <CategoryCharacteristicsButton category={row.original} />,
  };
  ```
  e `extraColumns: [macroColumn, characteristicsColumn]`, con l'import di `CategoryCharacteristicsButton`.

- [ ] **Step 5: Verificare**

Run: `bun run --cwd apps/admin typecheck; echo "admin=$?"` — Expected: `admin=0`.
Run: `bunx biome check apps/admin/src` — Expected: nessun errore.
Run: `grep -n '"use no memo"' apps/admin/src/features/category-characteristics/components/category-characteristics-panel.tsx` — Expected: la prima riga del corpo di `CategoryCharacteristicsPanel`.

- [ ] **Step 6: Collaudo nel browser**

Stessa sessione del Task 5, scheda *Categorie Prodotto*:
1. Ogni riga mostra la pastiglia; `Custodie smartphone` dice `20 caratteristiche`, `Peluche` `8 caratteristiche`.
2. Aprire `Peluche`: pannello laterale, scheda *Tutte* con 207 righe, *Incluse* con 8; le righe incluse hanno lo sfondo di riga selezionata.
3. Includere una caratteristica: il contatore di *Incluse* e la pastiglia nella tabella sotto il pannello passano a 9 senza ricaricare la pagina. *Obbligatoria* si abilita solo sulle righe incluse.
4. Escludere la caratteristica appena inclusa (nessun valore): nessuna conferma, torna a 8. Escludere una caratteristica che ha valori sui prodotti del seed (la riga lo dice: «valori su N prodotti»): compare la conferma con N — **fermarsi a *Annulla***.
5. La ricerca filtra in entrambe le schede; con la tastiera, Tab raggiunge gli interruttori e Spazio li commuta.
6. Il pannello a 390px di larghezza (DevTools): nessuno scroll orizzontale della pagina, la tabella scorre dentro il pannello. Tema scuro leggibile.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src
git commit -m "feat(admin): assegna le caratteristiche alle sotto-categorie

Una pastiglia con il conteggio apre un pannello laterale: una tabella con
l'intero dizionario, schede Tutte/Incluse e ricerca. Escludere una
caratteristica con valori chiede conferma con il numero di prodotti.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Chiusura della PR

- [ ] `bun run lint` (Biome) — pulito.
- [ ] Typecheck workspace per workspace — `apps/api`, `apps/admin`, `apps/seller`, `apps/customer`, `packages/ui` — ciascuno con `$?` a 0.
- [ ] `bun run --cwd apps/api test` — `0 fail`, totale = baseline + 38. Poi `bun run test` dalla radice (emails, api, customer).
- [ ] `bun run --cwd apps/api build` — riuscito.
- [ ] `bun run db:generate` — «No schema changes».
- [ ] Con l'API in esecuzione, `curl -s localhost:3000/openapi/json | jq '.paths | keys[] | select(test("characteristic|admin/product-categories"))'` elenca le rotte nuove, con `description` in italiano.
- [ ] `git diff main...HEAD --stat`: nessun file fuori dalla sezione «Struttura dei file» (più questo piano).
- [ ] **Smoke di Marco nel browser** prima di aprire la PR: su UI il gate è «Marco l'ha provata», non «i test sono verdi».
- [ ] Aprire la PR verso `main` citando spec e piano, con fuori ambito dichiarato (UI dell'import matrice, riordino di campi e opzioni), chiudendo con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] Dopo il merge: `git fetch --prune` e cancellare i branch locali `[gone]`.
