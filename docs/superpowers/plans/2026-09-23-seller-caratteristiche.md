# Caratteristiche nel form seller — piano di implementazione (PR 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il seller compila le caratteristiche della sotto-categoria nel form prodotto, l'API le valida con logica di dominio pura e le salva, e cambiare sotto-categoria non lascia mai valori dormienti (il quarto atto di D10).

**Architecture:** Lato API, un modulo puro `lib/characteristic-values.ts` (accanto a `lib/vat.ts`, in TDD) decide se un valore è ammesso e quali obbligatorie mancano; un service seller `product-characteristics.ts` lo applica dentro la transazione di `createProduct` / `updateProduct`. Al cambio di sotto-categoria, lo stesso service cancella i valori fuori dalla nuova matrice con `.returning()` e li confronta con `confirmAffected`, sulla guardia estratta dalla PR 3 e spostata in `lib/characteristic-impact.ts`. Lato seller, una sezione *Caratteristiche* richiudibile sotto il picker, con la conferma dei valori persi al momento del salvataggio.

**Tech Stack:** Bun, Elysia, Drizzle ORM, PostgreSQL 18, TypeBox, `bun:test` con testcontainers; seller in TanStack Start + TanStack Query, react-hook-form, `@bibs/ui` (Radix v1).

**Spec:** [`docs/superpowers/specs/2026-09-22-caratteristiche-prodotto-design.md`](../specs/2026-09-22-caratteristiche-prodotto-design.md) — sezioni «Invariante centrale (D10)», «Seller e scheda prodotto» e «Collaudo». Questo piano copre la **PR 4** delle cinque. PR 1 in `43c35da`, PR 2 in `10fe3bf`, PR 3 in `8ff171d`. Modello di forma: [`2026-09-23-admin-caratteristiche.md`](2026-09-23-admin-caratteristiche.md).

## Decisioni prese per questa PR

Da non rimettere in discussione durante l'esecuzione.

| # | Decisione | Motivo |
|---|---|---|
| P1 | **Obbligatorie: blocca solo i nuovi ingressi.** Un'obbligatoria vuota blocca il salvataggio quando il prodotto **nasce dal form** o **cambia sotto-categoria**. Sui prodotti che restano nella loro sotto-categoria il salvataggio passa (la sezione ricorda quante mancano), ma **non si può svuotare un'obbligatoria già compilata**. L'import CSV è escluso: non ha colonne per le caratteristiche | Scelta di Marco (2026-09-23). Un interruttore acceso dall'admin non deve impedire di correggere al volo il prezzo di un prodotto vecchio; il blocco scatta quando il seller ha comunque davanti la sezione da compilare |
| P2 | **Cambio di sotto-categoria: si perdono solo i valori fuori dalla nuova matrice.** Le caratteristiche in comune (Peso, Colore, … le universali) restano con il loro valore | D10 dice «esattamente quelli della matrice»: un valore di una caratteristica presente anche nella nuova matrice non è dormiente. Il tipo e le opzioni stanno sul dizionario globale (D3), quindi il valore resta valido |
| P3 | **La conferma avviene al salvataggio**, non al cambio della tendina. Cambiando sotto-categoria, sopra la sezione compare subito l'avviso «Al salvataggio verranno eliminati N valori…»; al click su *Salva* un dialog li elenca per nome e manda `confirmAffected` = quel numero | Il numero mostrato è esattamente quello che il server confronta. Tornare alla categoria di partenza prima di salvare non perde nulla, perché lo stato del form tiene i valori di tutte le caratteristiche toccate. Il cambio di macro (che azzera la sotto-categoria) passa dallo stesso punto senza un secondo dialog |
| P4 | **Import CSV seller: nessuna conferma, perché l'atto non può avvenire.** `importProductsFromCsv` **crea soltanto**: una riga con un EAN già usato viene saltata e il prodotto esistente resta intatto, quindi nessun prodotto con valori cambia mai sotto-categoria da lì. La PR fissa questa proprietà con un test e un commento nel service, che dice cosa fare se un giorno l'import aggiornerà prodotti esistenti: **rifiutare la riga** con un errore di riga che elenca i valori che si perderebbero. Un CSV non ha un dialog, e un file ricaricato identico non deve cancellare dati a sorpresa | Motivazione chiesta da Marco. Un meccanismo di conferma per un atto che il codice non compie sarebbe codice morto non testabile |
| P5 | **Sì/no come interruttore a due voci «Sì / No», deselezionabile**, non come casella singola | Una casella ha due stati, ma una caratteristica sì/no ne ha tre: *sì*, *no*, *non indicato*. Con una casella «No» sarebbe indistinguibile da «non compilato»: il riepilogo lo conterebbe come vuoto e la scheda customer (PR 5) non potrebbe mai mostrare «No». **Scostamento dalla richiesta, segnalato a Marco** |
| P6 | **`ProductCategoriesPicker` resta com'è.** È già macro-categoria e poi **una** sotto-categoria (lo ha semplificato la PR 1) | La richiesta lo dava ancora a multiselezione; il codice in `main` dice il contrario |
| P7 | **Semantica di scrittura dei valori:** `characteristicValues` è una lista di `{ characteristicId, value }`. Una voce con valore aggiorna, una voce `null` (o testo vuoto) cancella, **una caratteristica assente dalla lista resta com'è**. Il form manda sempre tutte le caratteristiche della matrice corrente | Un client che omette il campo (per esempio un PATCH che cambia solo il nome) non cancella nulla per sbaglio |

## Global Constraints

- **Nessun commit diretto su `main`.** Branch `feat/product-characteristics-seller`, già creato da `main` a `8ff171d`.
- **Conventional Commits** con scope dalla lista del repo: qui `api`, `seller`, `products`. Descrizione minuscola, imperativa, **prima riga sotto i 72 caratteri — misurala**.
- **Ogni commit chiude con** `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Mai `--no-verify`**. Mai `bun run db:reset`, `db:push`, `db:seed` o `infra:reset` senza conferma esplicita di Marco.
- **Nessuna modifica allo schema del database** in questa PR: `bun run db:generate` deve rispondere «No schema changes» alla fine di ogni task.
- **Biome**: rientri a tabulazione, virgolette doppie, file in kebab-case.
- **`ServiceError` accetta solo `(status, message)`.** Il frontend discrimina per status, mai per codice custom. Valore non valido o obbligatoria mancante → `400`; conferma insufficiente → `409`.
- **Copy in italiano** su ogni superficie utente, in ogni messaggio di `ServiceError` nuovo e in ogni `description` OpenAPI. **Nomi dei test in inglese**. Nel form seller la copy è scritta direttamente nei componenti, come nel resto di `product-form.tsx` (niente Paraglide qui).
- **D10, nessun valore dormiente**: i valori di un prodotto sono esattamente quelli previsti dalla matrice della sua sotto-categoria. La pulizia al cambio di sotto-categoria avviene **nella stessa transazione** dell'update.
- **Protocollo di conferma** (ereditato dalla PR 3): il server conta i valori **effettivamente cancellati** (`.returning()`), non un conteggio separato; se sono **più** di `confirmAffected` risponde `409` e la transazione va in rollback. Uguale o minore passa. `confirmAffected` assente vale `0`.
- **Il seller non importa dal modulo admin.** Ciò che serve a entrambi sta in `apps/api/src/lib/`.
- **Logica di dominio pura** in `apps/api/src/lib/characteristic-values.ts`: nessun import di `db`, nessun I/O; solo `import type` dallo schema. Test unitari in `apps/api/tests/lib/`, scritti **prima** dell'implementazione.
- **Ordine della matrice nel form**: `sortOrder` crescente, poi **nome** crescente (i `sortOrder` possono ripetersi). Opzioni: `sortOrder`, poi valore.
- **Numeri**: `numeric(14,4)`, quindi valore assoluto sotto `1e10` e al massimo 4 decimali; fuori da questi limiti è un errore, non un arrotondamento silenzioso.
- **react-hook-form**: niente `useEffect(() => reset(defaultValues))`. Lo stato delle caratteristiche vive in uno `useState` inizializzato una volta, fuori dallo schema TypeBox del form.
- **Radix v1**: si stila con `data-[state=open]:` / `group-data-[state=open]:`, mai `data-open:` / `data-checked:`.
- **Select Radix**: nessun `SelectItem` con `value=""`. La voce «Non indicato» viaggia con un valore sentinella, come `NO_CATEGORY` nel picker.
- **Toast** da `@bibs/ui/components/sonner`, mai da `sonner` diretto.
- **Test negativi sui service**: `await expect(fn()).rejects.toMatchObject({ status: 409 })`. Per leggere il messaggio usare il helper `caught()` già in uso in `admin-category-characteristics.test.ts`.
- **Suite completa**: sempre `bun run --cwd apps/api test`, mai `cd apps/api && bun test` nudo (salta `--isolate` e fa fallire apposta `tests/integration/isolation-guard-2.test.ts`: un rosso lì è l'invocazione sbagliata, non una regressione).
- **Singolo file di test**: `cd apps/api && bun test <percorso>`.
- **I subagenti su questo repo sono lenti, non bloccati**: la suite completa gira per minuti. Controllare `git status` e aspettare, non ridispacciare.
- **Typecheck workspace per workspace**, mai l'aggregato come prova: `bun run --cwd apps/api typecheck`, `bun run --cwd apps/seller typecheck`, `bun run --cwd apps/admin typecheck`, `bun run --cwd apps/customer typecheck`, controllando `$?` di ciascuno. Le rotte API cambiano i tipi Eden di tutti e tre i frontend.
- **Nessuna route seller nuova** in questa PR: `routeTree.gen.ts` non deve cambiare. Se cambiasse, va committato.
- **Collaudi nel browser** (seller `seller@dev.bibs` / `password123` su `localhost:3002`, API su `localhost:3000`): si creano, modificano e cancellano **solo prodotti creati dal collaudo stesso**, con nome che inizia per `Collaudo PR4`. Sui dati del seed si apre e si annulla, e basta: **nessun salvataggio**, e nessun interruttore dell'admin (compreso *obbligatoria*) si tocca. Conteggi del database **prima e dopo**. Le dimensioni si misurano con `getBoundingClientRect`, non descrivendo lo screenshot.
- psql: `docker exec -i bibs-postgis psql -U pgadmin -d bibs-db` — il `-i` è obbligatorio.

## Review Focus

Condizioni che la spec implica ma che nessun caso felice esercita, le più probabili per prime. Ciascuna ha il suo test nel task indicato.

1. **Il form di modifica rimanda sempre `productCategoryId`, anche invariato.** Un salvataggio che non cambia categoria non deve né pulire né chiedere conferma → test «resending the same category is not a change» (Task 5).
2. **Una caratteristica in comune fra le due sotto-categorie sopravvive al cambio** (P2) → il test del cambio phones→tablets verifica che Peso e Colore restino (Task 5).
3. **Conferma vecchia**: il seller ha visto 1 valore, nel frattempo ne è stato salvato un secondo → `409`, niente cambia (Task 5).
4. **Un PATCH che non tocca le caratteristiche** (solo il nome, solo l'ordine delle immagini) non deve cancellare valori né far scattare le obbligatorie → test «leaves values alone when the list is omitted» (Task 4).
5. **Prodotto senza sotto-categoria che riceve valori** → `400` «non prevista», non un inserimento orfano (Task 4).

---

## Struttura dei file

| File | Responsabilità |
|---|---|
| `apps/api/src/lib/characteristic-impact.ts` | **spostato** da `modules/admin/services/`; aggiunge `valuesPhrase` e `assertValueLossConfirmed` |
| `apps/api/src/modules/admin/services/{characteristic-import,category-characteristics,product-characteristics}.ts` | importano da `@/lib/characteristic-impact` |
| `apps/api/tests/integration/characteristic-impact.test.ts` | **rinominato** da `admin-characteristic-impact.test.ts`, più i test di `assertValueLossConfirmed` |
| `apps/api/src/lib/characteristic-values.ts` | **nuovo** — validazione pura dei valori, obbligatorie, conversione in uscita |
| `apps/api/tests/lib/characteristic-values.test.ts` | **nuovo** — test unitari |
| `apps/api/src/modules/seller/services/product-characteristics.ts` | **nuovo** — lettura della matrice per il form, lettura dei valori di un prodotto, salvataggio |
| `apps/api/src/modules/seller/routes/product-characteristics.ts` | **nuovo** — `GET /seller/product-categories/:productCategoryId/characteristics` |
| `apps/api/src/modules/seller/index.ts` | registra la rotta nuova |
| `apps/api/src/modules/seller/services/products.ts` | `getProduct` restituisce i valori; `createProduct` / `updateProduct` li salvano |
| `apps/api/src/modules/seller/routes/products.ts` | corpo di POST e PATCH, risposta del dettaglio |
| `apps/api/src/modules/seller/services/product-import.ts` | solo il commento di P4 |
| `apps/api/src/lib/schemas/entities.ts` | `SellerCategoryCharacteristicSchema`, `ProductCharacteristicValueSchema` |
| `apps/api/src/lib/schemas/composed.ts` | `SellerProductDetailSchema` |
| `apps/api/src/lib/schemas/forms/products.ts`, `forms/index.ts` | `CharacteristicValueInputSchema`, campo in `CreateProductBody` |
| `apps/api/tests/integration/seller-product-characteristics.test.ts` | **nuovo** |
| `apps/seller/src/features/products/lib/characteristic-form.ts` | **nuovo** — conversioni fra stato del form e API, obbligatorie, valori persi |
| `apps/seller/src/features/products/hooks/use-category-characteristics.ts` | **nuovo** — query della matrice |
| `apps/seller/src/features/products/components/product-characteristics-section.tsx` | **nuovo** — la sezione richiudibile e i quattro controlli |
| `apps/seller/src/features/products/components/characteristic-loss-dialog.tsx` | **nuovo** — la conferma dei valori persi |
| `apps/seller/src/features/products/components/product-form.tsx` | stato delle caratteristiche, controlli prima dell'invio, dialog |
| `apps/seller/src/routes/_authenticated/products/new.tsx`, `$productId.tsx` | mandano i valori; la modifica passa i valori salvati |

Fuori da questa PR, per scelta (come da spec): le caratteristiche nel caricamento massivo CSV (~195 colonne), la scheda prodotto customer (PR 5), filtri e facet.

---

### Task 1: Spostare i conteggi in `lib` e aggiungere la guardia per i valori persi

Il seller non importa dall'admin, quindi il modulo dei conteggi della PR 3 passa in `lib`. Il comportamento dell'admin non cambia: i suoi test sono la prova. In più, la guardia che il seller userà al cambio di sotto-categoria, che conta **valori** (non prodotti) e li nomina.

**Files:**
- Move: `apps/api/src/modules/admin/services/characteristic-impact.ts` → `apps/api/src/lib/characteristic-impact.ts`
- Modify: `apps/api/src/modules/admin/services/characteristic-import.ts:18`, `category-characteristics.ts:21`, `product-characteristics.ts:14` (solo il percorso dell'import)
- Move: `apps/api/tests/integration/admin-characteristic-impact.test.ts` → `apps/api/tests/integration/characteristic-impact.test.ts`

**Interfaces:**
- Consumes: niente di nuovo.
- Produces (in `@/lib/characteristic-impact`, oltre a quanto già esportato: `Executor`, `countValuesByCharacteristic`, `countValuesByOption`, `countCategoryCharacteristicValues`, `sumCounts`, `productsPhrase`, `assertImpactConfirmed`):
  - `valuesPhrase(n: number): string` — `"1 valore"` / `"3 valori"`
  - `assertValueLossConfirmed(lostNames: string[], confirmed: number): void` — lancia `ServiceError(409, …)` se `lostNames.length > confirmed`.

- [ ] **Step 0: Misurare la baseline**

Run: `bun run --cwd apps/api test 2>&1 | tail -8`
Annotare i totali `N pass / 0 fail` sia del blocco unitario sia di quello d'integrazione (riferimento dopo la PR 3: 566 d'integrazione). Sono i numeri da confrontare alla fine di ogni task: un'esecuzione troncata stampa comunque `0 fail`, conta il **totale**.

- [ ] **Step 1: Spostare i due file**

```bash
git mv apps/api/src/modules/admin/services/characteristic-impact.ts apps/api/src/lib/characteristic-impact.ts
git mv apps/api/tests/integration/admin-characteristic-impact.test.ts apps/api/tests/integration/characteristic-impact.test.ts
```

Nei tre service admin sostituire `from "./characteristic-impact"` con `from "@/lib/characteristic-impact"`. Nel test sostituire `from "@/modules/admin/services/characteristic-impact"` con `from "@/lib/characteristic-impact"`.

Run: `grep -rn "admin/services/characteristic-impact\|\./characteristic-impact" apps/api/src apps/api/tests`
Expected: nessuna riga.

- [ ] **Step 2: Scrivere i test che falliscono**

In `apps/api/tests/integration/characteristic-impact.test.ts` aggiungere `assertValueLossConfirmed` all'import da `@/lib/characteristic-impact` e, in fondo al file:

```ts
describe("assertValueLossConfirmed", () => {
	async function caught(fn: () => void): Promise<ServiceError> {
		try {
			fn();
		} catch (e) {
			if (e instanceof ServiceError) return e;
			throw e;
		}
		throw new Error("expected a ServiceError");
	}

	it("passes when nothing is lost or the confirmation covers the loss", () => {
		expect(() => assertValueLossConfirmed([], 0)).not.toThrow();
		expect(() => assertValueLossConfirmed(["Peso", "RAM"], 2)).not.toThrow();
		expect(() => assertValueLossConfirmed(["Peso"], 3)).not.toThrow();
	});

	it("asks for an explicit confirmation naming the lost values", async () => {
		const err = await caught(() => assertValueLossConfirmed(["Peso", "RAM"], 0));
		expect(err.status).toBe(409);
		expect(err.message).toContain("2 valori già compilati (Peso, RAM)");
		expect(err.message).toContain("serve una conferma esplicita");
	});

	it("uses the singular for a single lost value", async () => {
		const err = await caught(() => assertValueLossConfirmed(["Peso"], 0));
		expect(err.message).toContain("1 valore già compilato (Peso)");
	});

	it("rejects a stale confirmation that covered fewer values", async () => {
		const err = await caught(() => assertValueLossConfirmed(["Peso", "RAM"], 1));
		expect(err.status).toBe(409);
		expect(err.message).toContain("la conferma ne copriva 1");
	});
});
```

Se il file importa già `ServiceError`, non duplicare l'import.

- [ ] **Step 3: Verificare che falliscano**

Run: `cd apps/api && bun test tests/integration/characteristic-impact.test.ts`
Expected: FAIL — `assertValueLossConfirmed` non è esportata.

- [ ] **Step 4: Implementare**

In fondo a `apps/api/src/lib/characteristic-impact.ts`:

```ts
export function valuesPhrase(n: number): string {
	return `${n} valor${n === 1 ? "e" : "i"}`;
}

/**
 * La guardia di D10 per il cambio di sotto-categoria di UN prodotto. Qui si
 * contano valori, non prodotti, e i nomi entrano nel messaggio perché il
 * venditore sappia che cosa perde. La regola è quella di
 * assertImpactConfirmed: passa solo se i valori effettivamente cancellati non
 * superano quelli che l'interfaccia ha mostrato.
 */
export function assertValueLossConfirmed(
	lostNames: string[],
	confirmed: number,
) {
	const n = lostNames.length;
	if (n <= confirmed) return;
	const what = `${valuesPhrase(n)} già compilat${n === 1 ? "o" : "i"} (${lostNames.join(", ")})`;
	if (confirmed === 0) {
		throw new ServiceError(
			409,
			`Cambiando sotto-categoria si perdono ${what}: serve una conferma esplicita.`,
		);
	}
	throw new ServiceError(
		409,
		`I valori da eliminare sono cambiati: ora si perdono ${what}, la conferma ne copriva ${confirmed}. Ricarica e conferma di nuovo.`,
	);
}
```

- [ ] **Step 5: Verificare**

Run: `cd apps/api && bun test tests/integration/characteristic-impact.test.ts tests/integration/admin-characteristic-import.test.ts tests/integration/admin-category-characteristics.test.ts tests/integration/admin-product-characteristics.test.ts`
Expected: PASS, nessun fallimento.

Run: `bun run --cwd apps/api typecheck; echo $?` → `0`.

- [ ] **Step 6: Commit**

```bash
git add -A apps/api/src/lib/characteristic-impact.ts apps/api/src/modules/admin/services apps/api/tests/integration/characteristic-impact.test.ts apps/api/tests/integration/admin-characteristic-impact.test.ts
git commit -m "refactor(api): conteggi delle caratteristiche in lib condivisa" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Validazione pura dei valori (TDD)

Il cuore della PR: decide se un valore è ammesso, in quale colonna finisce, quali obbligatorie mancano, e come un valore salvato torna al client. Nessun accesso al database: le definizioni arrivano già caricate.

**Files:**
- Create: `apps/api/src/lib/characteristic-values.ts`
- Test: `apps/api/tests/lib/characteristic-values.test.ts`

**Interfaces:**
- Consumes: `type CharacteristicDataType` da `@/db/schemas/product-characteristic` (solo `import type`).
- Produces:
  - `MAX_TEXT_LENGTH = 2000`
  - `interface CharacteristicDefinition { id: string; name: string; dataType: CharacteristicDataType; required: boolean; options: { id: string; value: string }[] }`
  - `type CharacteristicInputValue = string | number | boolean | null`
  - `interface CharacteristicValueInput { characteristicId: string; value: CharacteristicInputValue }`
  - `interface CharacteristicValueRow { characteristicId: string; dataType: CharacteristicDataType; valueText: string | null; valueNumber: string | null; valueBoolean: boolean | null; optionId: string | null }`
  - `interface ValidatedCharacteristicValues { upserts: CharacteristicValueRow[]; clears: string[]; errors: string[] }`
  - `validateCharacteristicValues(definitions: CharacteristicDefinition[], inputs: CharacteristicValueInput[]): ValidatedCharacteristicValues`
  - `filledAfter(before: ReadonlySet<string>, validated: ValidatedCharacteristicValues): Set<string>`
  - `missingRequired(params: { definitions: CharacteristicDefinition[]; before: ReadonlySet<string>; after: ReadonlySet<string>; entering: boolean }): string[]` — **nomi**, nell'ordine delle definizioni
  - `type StoredCharacteristicValue = Omit<CharacteristicValueRow, "characteristicId">`
  - `toCharacteristicOutputValue(stored: StoredCharacteristicValue): string | number | boolean` — per `enum` restituisce l'**id dell'opzione**

- [ ] **Step 1: Scrivere i test che falliscono**

Create `apps/api/tests/lib/characteristic-values.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
	type CharacteristicDefinition,
	filledAfter,
	MAX_TEXT_LENGTH,
	missingRequired,
	toCharacteristicOutputValue,
	validateCharacteristicValues,
} from "@/lib/characteristic-values";

const peso: CharacteristicDefinition = {
	id: "c-peso",
	name: "Peso",
	dataType: "number",
	required: false,
	options: [],
};
const modello: CharacteristicDefinition = {
	id: "c-modello",
	name: "Modello",
	dataType: "text",
	required: true,
	options: [],
};
const g5: CharacteristicDefinition = {
	id: "c-5g",
	name: "5G",
	dataType: "boolean",
	required: false,
	options: [],
};
const colore: CharacteristicDefinition = {
	id: "c-colore",
	name: "Colore",
	dataType: "enum",
	required: true,
	options: [
		{ id: "o-nero", value: "Nero" },
		{ id: "o-bianco", value: "Bianco" },
	],
};
const defs = [peso, modello, g5, colore];

describe("validateCharacteristicValues", () => {
	it("puts each value in the column of its type and nowhere else", () => {
		const result = validateCharacteristicValues(defs, [
			{ characteristicId: "c-peso", value: 180.5 },
			{ characteristicId: "c-modello", value: "X1" },
			{ characteristicId: "c-5g", value: false },
			{ characteristicId: "c-colore", value: "o-nero" },
		]);

		expect(result.errors).toEqual([]);
		expect(result.clears).toEqual([]);
		expect(result.upserts).toEqual([
			{
				characteristicId: "c-peso",
				dataType: "number",
				valueText: null,
				valueNumber: "180.5",
				valueBoolean: null,
				optionId: null,
			},
			{
				characteristicId: "c-modello",
				dataType: "text",
				valueText: "X1",
				valueNumber: null,
				valueBoolean: null,
				optionId: null,
			},
			{
				characteristicId: "c-5g",
				dataType: "boolean",
				valueText: null,
				valueNumber: null,
				valueBoolean: false,
				optionId: null,
			},
			{
				characteristicId: "c-colore",
				dataType: "enum",
				valueText: null,
				valueNumber: null,
				valueBoolean: null,
				optionId: "o-nero",
			},
		]);
	});

	it("treats null and blank text as a request to clear", () => {
		const result = validateCharacteristicValues(defs, [
			{ characteristicId: "c-peso", value: null },
			{ characteristicId: "c-modello", value: "   " },
		]);

		expect(result.errors).toEqual([]);
		expect(result.upserts).toEqual([]);
		expect(result.clears).toEqual(["c-peso", "c-modello"]);
	});

	it("trims text before storing it", () => {
		const result = validateCharacteristicValues(defs, [
			{ characteristicId: "c-modello", value: "  X1 Pro  " },
		]);
		expect(result.upserts[0].valueText).toBe("X1 Pro");
	});

	it("rejects a characteristic that is not in the matrix", () => {
		const result = validateCharacteristicValues([peso], [
			{ characteristicId: "c-modello", value: "X1" },
		]);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("non prevista");
	});

	it("rejects a value whose type does not match the characteristic", () => {
		const result = validateCharacteristicValues(defs, [
			{ characteristicId: "c-peso", value: "180" },
			{ characteristicId: "c-modello", value: 12 },
			{ characteristicId: "c-5g", value: "sì" },
			{ characteristicId: "c-colore", value: true },
		]);
		expect(result.errors).toEqual([
			"Peso: atteso un numero",
			"Modello: atteso un testo",
			"5G: atteso sì o no",
			"Colore: atteso una delle opzioni",
		]);
		expect(result.upserts).toEqual([]);
	});

	it("rejects an option that does not belong to the list", () => {
		const result = validateCharacteristicValues(defs, [
			{ characteristicId: "c-colore", value: "o-rosso" },
		]);
		expect(result.errors).toEqual(["Colore: valore non ammesso"]);
	});

	it("rejects numbers that do not fit numeric(14,4)", () => {
		const result = validateCharacteristicValues([peso], [
			{ characteristicId: "c-peso", value: 1e10 },
		]);
		expect(result.errors[0]).toContain("Peso");

		const decimals = validateCharacteristicValues([peso], [
			{ characteristicId: "c-peso", value: 1.23456 },
		]);
		expect(decimals.errors[0]).toContain("4 decimali");

		const infinite = validateCharacteristicValues([peso], [
			{ characteristicId: "c-peso", value: Number.POSITIVE_INFINITY },
		]);
		expect(infinite.errors).toHaveLength(1);
	});

	it("accepts the largest number that fits, and negatives", () => {
		const result = validateCharacteristicValues([peso], [
			{ characteristicId: "c-peso", value: 9999999999.9999 },
		]);
		expect(result.errors).toEqual([]);

		const negative = validateCharacteristicValues([peso], [
			{ characteristicId: "c-peso", value: -20 },
		]);
		expect(negative.upserts[0].valueNumber).toBe("-20");
	});

	it("rejects text longer than the limit", () => {
		const result = validateCharacteristicValues([modello], [
			{ characteristicId: "c-modello", value: "x".repeat(MAX_TEXT_LENGTH + 1) },
		]);
		expect(result.errors[0]).toContain(`${MAX_TEXT_LENGTH} caratteri`);
	});

	it("rejects the same characteristic sent twice", () => {
		const result = validateCharacteristicValues(defs, [
			{ characteristicId: "c-peso", value: 1 },
			{ characteristicId: "c-peso", value: 2 },
		]);
		expect(result.errors).toEqual(["Peso: indicata più di una volta"]);
	});
});

describe("filledAfter", () => {
	it("removes the cleared ids and adds the written ones", () => {
		const validated = validateCharacteristicValues(defs, [
			{ characteristicId: "c-peso", value: null },
			{ characteristicId: "c-5g", value: true },
		]);
		const after = filledAfter(new Set(["c-peso", "c-modello"]), validated);
		expect([...after].sort()).toEqual(["c-5g", "c-modello"]);
	});
});

describe("missingRequired", () => {
	it("when entering, lists every required characteristic without a value", () => {
		expect(
			missingRequired({
				definitions: defs,
				before: new Set(),
				after: new Set(["c-peso"]),
				entering: true,
			}),
		).toEqual(["Modello", "Colore"]);
	});

	it("when entering, is satisfied once the required ones are filled", () => {
		expect(
			missingRequired({
				definitions: defs,
				before: new Set(),
				after: new Set(["c-modello", "c-colore"]),
				entering: true,
			}),
		).toEqual([]);
	});

	it("when staying, ignores required characteristics that were never filled", () => {
		expect(
			missingRequired({
				definitions: defs,
				before: new Set(["c-peso"]),
				after: new Set(["c-peso"]),
				entering: false,
			}),
		).toEqual([]);
	});

	it("when staying, reports a required characteristic that gets cleared", () => {
		expect(
			missingRequired({
				definitions: defs,
				before: new Set(["c-modello", "c-peso"]),
				after: new Set(["c-peso"]),
				entering: false,
			}),
		).toEqual(["Modello"]);
	});

	it("never reports an optional characteristic", () => {
		expect(
			missingRequired({
				definitions: defs,
				before: new Set(["c-peso", "c-modello", "c-colore"]),
				after: new Set(["c-modello", "c-colore"]),
				entering: false,
			}),
		).toEqual([]);
	});
});

describe("toCharacteristicOutputValue", () => {
	const empty = {
		valueText: null,
		valueNumber: null,
		valueBoolean: null,
		optionId: null,
	};

	it("returns the value of the column of its type", () => {
		expect(
			toCharacteristicOutputValue({
				...empty,
				dataType: "number",
				valueNumber: "180.5000",
			}),
		).toBe(180.5);
		expect(
			toCharacteristicOutputValue({ ...empty, dataType: "text", valueText: "X1" }),
		).toBe("X1");
		expect(
			toCharacteristicOutputValue({
				...empty,
				dataType: "boolean",
				valueBoolean: false,
			}),
		).toBe(false);
		expect(
			toCharacteristicOutputValue({ ...empty, dataType: "enum", optionId: "o-nero" }),
		).toBe("o-nero");
	});
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `cd apps/api && bun test tests/lib/characteristic-values.test.ts`
Expected: FAIL — `Cannot find module '@/lib/characteristic-values'`.

- [ ] **Step 3: Implementare**

Create `apps/api/src/lib/characteristic-values.ts`:

```ts
import type { CharacteristicDataType } from "@/db/schemas/product-characteristic";

/**
 * Validazione dei valori delle caratteristiche di prodotto. Logica pura, come
 * lib/vat.ts: le definizioni (la matrice della sotto-categoria, con tipo e
 * opzioni) arrivano già caricate, e il risultato dice cosa scrivere, cosa
 * cancellare e cosa rifiutare. Il database ha comunque il suo CHECK sulla
 * colonna giusta: qui si produce il messaggio che il venditore legge.
 */

export const MAX_TEXT_LENGTH = 2000;
// numeric(14,4): dieci cifre intere e quattro decimali.
const MAX_NUMBER_ABS = 1e10;
const MAX_DECIMALS = 4;

export interface CharacteristicDefinition {
	id: string;
	name: string;
	dataType: CharacteristicDataType;
	required: boolean;
	options: { id: string; value: string }[];
}

export type CharacteristicInputValue = string | number | boolean | null;

export interface CharacteristicValueInput {
	characteristicId: string;
	value: CharacteristicInputValue;
}

export interface CharacteristicValueRow {
	characteristicId: string;
	dataType: CharacteristicDataType;
	valueText: string | null;
	valueNumber: string | null;
	valueBoolean: boolean | null;
	optionId: string | null;
}

export interface ValidatedCharacteristicValues {
	upserts: CharacteristicValueRow[];
	clears: string[];
	errors: string[];
}

export type StoredCharacteristicValue = Omit<
	CharacteristicValueRow,
	"characteristicId"
>;

const EXPECTED: Record<CharacteristicDataType, string> = {
	text: "un testo",
	number: "un numero",
	boolean: "sì o no",
	enum: "una delle opzioni",
};

function row(
	def: CharacteristicDefinition,
	column: Partial<StoredCharacteristicValue>,
): CharacteristicValueRow {
	return {
		characteristicId: def.id,
		dataType: def.dataType,
		valueText: null,
		valueNumber: null,
		valueBoolean: null,
		optionId: null,
		...column,
	};
}

function hasTooManyDecimals(n: number): boolean {
	const scale = 10 ** MAX_DECIMALS;
	return Math.round(n * scale) / scale !== n;
}

/** Un valore non vuoto: la riga da scrivere, oppure il messaggio d'errore. */
function toRow(
	def: CharacteristicDefinition,
	value: string | number | boolean,
): CharacteristicValueRow | string {
	const mismatch = `${def.name}: atteso ${EXPECTED[def.dataType]}`;
	switch (def.dataType) {
		case "text": {
			if (typeof value !== "string") return mismatch;
			const text = value.trim();
			if (text.length > MAX_TEXT_LENGTH) {
				return `${def.name}: massimo ${MAX_TEXT_LENGTH} caratteri`;
			}
			return row(def, { valueText: text });
		}
		case "number": {
			if (typeof value !== "number" || !Number.isFinite(value)) return mismatch;
			if (Math.abs(value) >= MAX_NUMBER_ABS) {
				return `${def.name}: numero troppo grande`;
			}
			if (hasTooManyDecimals(value)) {
				return `${def.name}: al massimo ${MAX_DECIMALS} decimali`;
			}
			return row(def, { valueNumber: String(value) });
		}
		case "boolean":
			if (typeof value !== "boolean") return mismatch;
			return row(def, { valueBoolean: value });
		case "enum": {
			if (typeof value !== "string") return mismatch;
			if (!def.options.some((o) => o.id === value)) {
				return `${def.name}: valore non ammesso`;
			}
			return row(def, { optionId: value });
		}
	}
}

function isEmpty(value: CharacteristicInputValue): value is null | string {
	return value === null || (typeof value === "string" && value.trim() === "");
}

/**
 * Tutti gli errori, non solo il primo: il venditore corregge il form in una
 * passata sola. Chi chiama non scrive nulla se `errors` non è vuoto.
 */
export function validateCharacteristicValues(
	definitions: CharacteristicDefinition[],
	inputs: CharacteristicValueInput[],
): ValidatedCharacteristicValues {
	const byId = new Map(definitions.map((d) => [d.id, d]));
	const seen = new Set<string>();
	const result: ValidatedCharacteristicValues = {
		upserts: [],
		clears: [],
		errors: [],
	};

	for (const input of inputs) {
		const def = byId.get(input.characteristicId);
		if (!def) {
			result.errors.push(
				`Caratteristica non prevista per la sotto-categoria del prodotto (${input.characteristicId})`,
			);
			continue;
		}
		if (seen.has(def.id)) {
			result.errors.push(`${def.name}: indicata più di una volta`);
			continue;
		}
		seen.add(def.id);

		// Il testo vuoto di un tipo diverso da text è comunque un «non indicato»:
		// un campo numerico svuotato arriva così da certi client.
		if (isEmpty(input.value)) {
			result.clears.push(def.id);
			continue;
		}
		const outcome = toRow(def, input.value);
		if (typeof outcome === "string") result.errors.push(outcome);
		else result.upserts.push(outcome);
	}

	return result;
}

export function filledAfter(
	before: ReadonlySet<string>,
	validated: ValidatedCharacteristicValues,
): Set<string> {
	const after = new Set(before);
	for (const id of validated.clears) after.delete(id);
	for (const r of validated.upserts) after.add(r.characteristicId);
	return after;
}

/**
 * La regola sulle obbligatorie (decisione P1 del piano PR 4). `entering`: il
 * prodotto nasce o cambia sotto-categoria, quindi ogni obbligatoria va
 * compilata. Altrimenti il prodotto resta dov'è: le obbligatorie mai compilate
 * sono tollerate, ma una già compilata non si può svuotare.
 */
export function missingRequired(params: {
	definitions: CharacteristicDefinition[];
	before: ReadonlySet<string>;
	after: ReadonlySet<string>;
	entering: boolean;
}): string[] {
	const { definitions, before, after, entering } = params;
	return definitions
		.filter(
			(d) =>
				d.required && !after.has(d.id) && (entering || before.has(d.id)),
		)
		.map((d) => d.name);
}

/** Il valore come lo vede il client: per le liste chiuse, l'id dell'opzione. */
export function toCharacteristicOutputValue(
	stored: StoredCharacteristicValue,
): string | number | boolean {
	switch (stored.dataType) {
		case "text":
			return stored.valueText as string;
		case "number":
			return Number(stored.valueNumber);
		case "boolean":
			return stored.valueBoolean as boolean;
		case "enum":
			return stored.optionId as string;
	}
}
```

Il CHECK del database garantisce che la colonna del tipo sia valorizzata: i cast in `toCharacteristicOutputValue` non mentono.

- [ ] **Step 4: Verificare che passino**

Run: `cd apps/api && bun test tests/lib/characteristic-values.test.ts`
Expected: PASS, 17 test.

Run: `bun run --cwd apps/api typecheck; echo $?` → `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/characteristic-values.ts apps/api/tests/lib/characteristic-values.test.ts
git commit -m "feat(products): validazione pura dei valori delle caratteristiche" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Letture seller — la matrice per il form e i valori del prodotto

La lettura admin della matrice è ordinata per nome e senza opzioni: il form ha bisogno della sua. E il dettaglio prodotto deve portare i valori salvati, con il nome (serve al dialog dei valori persi).

**Files:**
- Create: `apps/api/src/modules/seller/services/product-characteristics.ts`
- Create: `apps/api/src/modules/seller/routes/product-characteristics.ts`
- Modify: `apps/api/src/modules/seller/index.ts:135` (registrare `productCharacteristicsRoutes` subito dopo `.use(productsRoutes)`)
- Modify: `apps/api/src/modules/seller/services/products.ts` (`getProduct`)
- Modify: `apps/api/src/modules/seller/routes/products.ts:290` (risposta del dettaglio)
- Modify: `apps/api/src/lib/schemas/entities.ts` (dopo `CategoryCharacteristicLinkSchema`), `apps/api/src/lib/schemas/composed.ts` (dopo `ProductWithRelationsSchema`)
- Test: `apps/api/tests/integration/seller-product-characteristics.test.ts`

**Interfaces:**
- Consumes: `Executor` da `@/lib/characteristic-impact`; `CharacteristicDefinition`, `toCharacteristicOutputValue` da `@/lib/characteristic-values`.
- Produces:
  - `interface FormCharacteristic extends CharacteristicDefinition { unit: string | null }`
  - `listFormCharacteristics(productCategoryId: string, executor?: Executor): Promise<FormCharacteristic[]>` — ordinate per `sortOrder`, poi nome; opzioni per `sortOrder`, poi valore; `[]` se la sotto-categoria non ha caratteristiche (**non** controlla che esista)
  - `getFormCharacteristics(productCategoryId: string): Promise<FormCharacteristic[]>` — come sopra, `404` se la sotto-categoria non esiste
  - `listProductCharacteristicValues(productId: string, executor?: Executor): Promise<{ characteristicId: string; name: string; value: string | number | boolean }[]>` — ordinati per nome
  - `getProduct(...)` restituisce in più `characteristicValues` con quella forma
  - Schemi: `SellerCategoryCharacteristicSchema`, `ProductCharacteristicValueSchema`, `SellerProductDetailSchema`
  - Rotta: `GET /seller/product-categories/:productCategoryId/characteristics` → `okRes(t.Array(SellerCategoryCharacteristicSchema))`. In Eden: `api().seller["product-categories"]({ productCategoryId }).characteristics.get()`

- [ ] **Step 1: Scrivere i test che falliscono**

Create `apps/api/tests/integration/seller-product-characteristics.test.ts`. La fixture `seedCatalog` serve anche ai task 4 e 5: Smartphone con Peso, Modello (**obbligatoria**), Colore e 5G — Colore e 5G con lo **stesso** `sortOrder`, perché si veda il nome decidere —; Tablet con Colore e Peso, cioè un sottoinsieme di Smartphone.

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

mock.module("@/lib/s3", () => ({
	s3: { delete: mock(async () => {}) },
}));

import {
	productCategoryCharacteristic,
	productCharacteristic,
	productCharacteristicOption,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { ServiceError } from "@/lib/errors";
import {
	getFormCharacteristics,
	listProductCharacteristicValues,
} from "@/modules/seller/services/product-characteristics";
import { getProduct } from "@/modules/seller/services/products";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCategory,
	createTestMacroCategory,
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
});

async function caught(fn: () => Promise<unknown>): Promise<ServiceError> {
	try {
		await fn();
	} catch (e) {
		if (e instanceof ServiceError) return e;
		throw e;
	}
	throw new Error("expected a ServiceError");
}

async function seedCatalog() {
	const db = getTestDb();
	const macro = await createTestMacroCategory(db, "Elettronica");
	const phones = await createTestCategory(db, "Smartphone", macro.id);
	const tablets = await createTestCategory(db, "Tablet", macro.id);
	const [peso, modello, g5, colore] = await db
		.insert(productCharacteristic)
		.values([
			{ name: "Peso", dataType: "number", unit: "g" },
			{ name: "Modello", dataType: "text" },
			{ name: "5G", dataType: "boolean" },
			{ name: "Colore", dataType: "enum" },
		])
		.returning();
	const [bianco, nero] = await db
		.insert(productCharacteristicOption)
		.values([
			{ characteristicId: colore.id, value: "Bianco", sortOrder: 1 },
			{ characteristicId: colore.id, value: "Nero", sortOrder: 0 },
		])
		.returning();
	await db.insert(productCategoryCharacteristic).values([
		{ productCategoryId: phones.id, characteristicId: peso.id, sortOrder: 0 },
		{
			productCategoryId: phones.id,
			characteristicId: modello.id,
			sortOrder: 1,
			required: true,
		},
		// Stesso sortOrder: decide il nome, «5G» prima di «Colore».
		{ productCategoryId: phones.id, characteristicId: colore.id, sortOrder: 2 },
		{ productCategoryId: phones.id, characteristicId: g5.id, sortOrder: 2 },
		{ productCategoryId: tablets.id, characteristicId: colore.id, sortOrder: 0 },
		{ productCategoryId: tablets.id, characteristicId: peso.id, sortOrder: 1 },
	]);
	const seller = await createTestSeller(db);
	const store = await createTestStore(db, seller.profile.id);
	return {
		db,
		phones,
		tablets,
		peso,
		modello,
		g5,
		colore,
		bianco,
		nero,
		seller,
		store,
	};
}

/** Un prodotto Smartphone con tutti e quattro i valori, inseriti a mano. */
async function seedPhoneWithValues(c: Awaited<ReturnType<typeof seedCatalog>>) {
	const p = await createTestProduct(c.db, c.seller.profile.id, {
		name: "Telefono",
		categoryIds: [c.phones.id],
	});
	await createTestStoreProduct(c.db, c.store.id, p.id);
	await c.db.insert(productCharacteristicValue).values([
		{
			productId: p.id,
			characteristicId: c.peso.id,
			dataType: "number",
			valueNumber: "180",
		},
		{
			productId: p.id,
			characteristicId: c.modello.id,
			dataType: "text",
			valueText: "X1",
		},
		{
			productId: p.id,
			characteristicId: c.g5.id,
			dataType: "boolean",
			valueBoolean: true,
		},
		{
			productId: p.id,
			characteristicId: c.colore.id,
			dataType: "enum",
			optionId: c.nero.id,
		},
	]);
	return p;
}

describe("getFormCharacteristics", () => {
	it("orders by sortOrder, then by name, with the options of closed lists", async () => {
		const c = await seedCatalog();

		const result = await getFormCharacteristics(c.phones.id);

		expect(result.map((r) => r.name)).toEqual([
			"Peso",
			"Modello",
			"5G",
			"Colore",
		]);
		const byName = new Map(result.map((r) => [r.name, r]));
		expect(byName.get("Peso")).toMatchObject({
			dataType: "number",
			unit: "g",
			required: false,
			options: [],
		});
		expect(byName.get("Modello")?.required).toBe(true);
		expect(byName.get("Colore")?.options).toEqual([
			{ id: c.nero.id, value: "Nero" },
			{ id: c.bianco.id, value: "Bianco" },
		]);
	});

	it("returns only the characteristics of that subcategory", async () => {
		const c = await seedCatalog();
		const result = await getFormCharacteristics(c.tablets.id);
		expect(result.map((r) => r.name)).toEqual(["Colore", "Peso"]);
	});

	it("answers 404 for an unknown subcategory", async () => {
		await seedCatalog();
		const err = await caught(() => getFormCharacteristics("nope"));
		expect(err.status).toBe(404);
	});
});

describe("product detail values", () => {
	it("returns the saved values with names and typed values", async () => {
		const c = await seedCatalog();
		const p = await seedPhoneWithValues(c);

		const found = await getProduct({
			productId: p.id,
			sellerProfileId: c.seller.profile.id,
			accessibleStoreIds: [c.store.id],
		});

		expect(found.characteristicValues).toEqual([
			{ characteristicId: c.g5.id, name: "5G", value: true },
			{ characteristicId: c.colore.id, name: "Colore", value: c.nero.id },
			{ characteristicId: c.modello.id, name: "Modello", value: "X1" },
			{ characteristicId: c.peso.id, name: "Peso", value: 180 },
		]);
	});

	it("returns an empty list for a product without values", async () => {
		const c = await seedCatalog();
		const p = await createTestProduct(c.db, c.seller.profile.id, {
			categoryIds: [c.phones.id],
		});
		expect(await listProductCharacteristicValues(p.id)).toEqual([]);
	});
});
```

`noUnusedLocals` è attivo: ciò che serve solo ai task 4 e 5 (`valuesOf`, `eq`, `product`) si aggiunge lì, non qui.

- [ ] **Step 2: Verificare che falliscano**

Run: `cd apps/api && bun test tests/integration/seller-product-characteristics.test.ts`
Expected: FAIL — modulo `@/modules/seller/services/product-characteristics` inesistente.

- [ ] **Step 3: Il service di lettura**

Create `apps/api/src/modules/seller/services/product-characteristics.ts`:

```ts
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { productCategory } from "@/db/schemas/category";
import {
	productCategoryCharacteristic,
	productCharacteristic,
	productCharacteristicOption,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import type { Executor } from "@/lib/characteristic-impact";
import {
	type CharacteristicDefinition,
	toCharacteristicOutputValue,
} from "@/lib/characteristic-values";
import { ServiceError } from "@/lib/errors";

export interface FormCharacteristic extends CharacteristicDefinition {
	unit: string | null;
}

/**
 * La matrice di una sotto-categoria come la usa il form del venditore: solo le
 * caratteristiche incluse, nell'ordine di sortOrder (il nome come secondo
 * criterio, perché i sortOrder possono ripetersi), con le opzioni delle liste
 * chiuse. Accetta una `tx`: il salvataggio la rilegge dentro la transazione.
 */
export async function listFormCharacteristics(
	productCategoryId: string,
	executor: Executor = db,
): Promise<FormCharacteristic[]> {
	const rows = await executor
		.select({
			id: productCharacteristic.id,
			name: productCharacteristic.name,
			dataType: productCharacteristic.dataType,
			unit: productCharacteristic.unit,
			required: productCategoryCharacteristic.required,
		})
		.from(productCategoryCharacteristic)
		.innerJoin(
			productCharacteristic,
			eq(productCharacteristic.id, productCategoryCharacteristic.characteristicId),
		)
		.where(eq(productCategoryCharacteristic.productCategoryId, productCategoryId))
		.orderBy(
			asc(productCategoryCharacteristic.sortOrder),
			asc(productCharacteristic.name),
		);

	const enumIds = rows.filter((r) => r.dataType === "enum").map((r) => r.id);
	const options =
		enumIds.length === 0
			? []
			: await executor
					.select({
						id: productCharacteristicOption.id,
						characteristicId: productCharacteristicOption.characteristicId,
						value: productCharacteristicOption.value,
					})
					.from(productCharacteristicOption)
					.where(inArray(productCharacteristicOption.characteristicId, enumIds))
					.orderBy(
						asc(productCharacteristicOption.sortOrder),
						asc(productCharacteristicOption.value),
					);

	const optionsById = new Map<string, { id: string; value: string }[]>();
	for (const o of options) {
		const list = optionsById.get(o.characteristicId) ?? [];
		list.push({ id: o.id, value: o.value });
		optionsById.set(o.characteristicId, list);
	}
	return rows.map((r) => ({ ...r, options: optionsById.get(r.id) ?? [] }));
}

export async function getFormCharacteristics(productCategoryId: string) {
	const found = await db.query.productCategory.findFirst({
		where: eq(productCategory.id, productCategoryId),
		columns: { id: true },
	});
	if (!found) throw new ServiceError(404, "Sotto-categoria non trovata");
	return listFormCharacteristics(productCategoryId);
}

/** I valori salvati di un prodotto, con il nome della caratteristica. */
export async function listProductCharacteristicValues(
	productId: string,
	executor: Executor = db,
) {
	const rows = await executor
		.select({
			characteristicId: productCharacteristicValue.characteristicId,
			name: productCharacteristic.name,
			dataType: productCharacteristicValue.dataType,
			valueText: productCharacteristicValue.valueText,
			valueNumber: productCharacteristicValue.valueNumber,
			valueBoolean: productCharacteristicValue.valueBoolean,
			optionId: productCharacteristicValue.optionId,
		})
		.from(productCharacteristicValue)
		.innerJoin(
			productCharacteristic,
			eq(productCharacteristic.id, productCharacteristicValue.characteristicId),
		)
		.where(eq(productCharacteristicValue.productId, productId))
		.orderBy(asc(productCharacteristic.name));

	return rows.map(({ characteristicId, name, ...stored }) => ({
		characteristicId,
		name,
		value: toCharacteristicOutputValue(stored),
	}));
}
```

- [ ] **Step 4: Gli schemi**

In `apps/api/src/lib/schemas/entities.ts`, dopo `CategoryCharacteristicLinkSchema`:

```ts
export const SellerCategoryCharacteristicSchema = t.Object({
	id: t.String({ description: "ID della caratteristica" }),
	name: t.String({ description: "Nome della caratteristica" }),
	dataType: CharacteristicDataTypeSchema,
	unit: t.Nullable(
		t.String({ description: "Unità di misura, solo per il tipo number" }),
	),
	required: t.Boolean({
		description:
			"Obbligatoria: va compilata quando il prodotto nasce o cambia sotto-categoria, e una volta compilata non si può svuotare",
	}),
	options: t.Array(
		t.Object({
			id: t.String({ description: "ID dell'opzione, il valore da inviare" }),
			value: t.String({ description: "Etichetta dell'opzione" }),
		}),
		{ description: "Opzioni della lista chiusa, vuota per gli altri tipi" },
	),
});

export const CharacteristicOutputValueSchema = t.Union(
	[t.String(), t.Number(), t.Boolean()],
	{
		description:
			"Testo, numero o sì/no secondo il tipo; per le liste chiuse, l'ID dell'opzione",
	},
);

export const ProductCharacteristicValueSchema = t.Object({
	characteristicId: t.String({ description: "ID della caratteristica" }),
	name: t.String({ description: "Nome della caratteristica" }),
	value: CharacteristicOutputValueSchema,
});
```

In `apps/api/src/lib/schemas/composed.ts`, dopo `ProductWithRelationsSchema` (importando `ProductCharacteristicValueSchema` da `./entities`, come gli altri schemi del file):

```ts
export const SellerProductDetailSchema = t.Object({
	...ProductWithRelationsSchema.properties,
	characteristicValues: t.Array(ProductCharacteristicValueSchema, {
		description: "Valori compilati delle caratteristiche, ordinati per nome",
	}),
});
```

- [ ] **Step 5: Dettaglio prodotto e rotta nuova**

In `apps/api/src/modules/seller/services/products.ts`, importare `listProductCharacteristicValues` da `./product-characteristics` e, in `getProduct`, cambiare il `return`:

```ts
	return {
		...found,
		storeProducts: found.storeProducts.map(({ store, ...sp }) => ({
			...sp,
			store: {
				...store,
				municipality: toMunicipalityCompact(store.municipality),
			},
		})),
		characteristicValues: await listProductCharacteristicValues(found.id),
	};
```

In `apps/api/src/modules/seller/routes/products.ts`, la rotta `GET /products/:productId` risponde con `okRes(SellerProductDetailSchema)` al posto di `ProductWithRelationsSchema` (aggiornare l'import da `@/lib/schemas`; se `ProductWithRelationsSchema` resta inutilizzato, toglierlo dall'import). Nella `description` del dettaglio aggiungere «e i valori delle caratteristiche».

Create `apps/api/src/modules/seller/routes/product-characteristics.ts`:

```ts
import { Elysia, t } from "elysia";
import { ok } from "@/lib/responses";
import {
	okRes,
	SellerCategoryCharacteristicSchema,
	withErrors,
} from "@/lib/schemas";
import { getFormCharacteristics } from "../services/product-characteristics";

export const productCharacteristicsRoutes = new Elysia().get(
	"/product-categories/:productCategoryId/characteristics",
	async ({ params }) => ok(await getFormCharacteristics(params.productCategoryId)),
	{
		params: t.Object({
			productCategoryId: t.String({ description: "ID della sotto-categoria" }),
		}),
		response: withErrors({
			200: okRes(t.Array(SellerCategoryCharacteristicSchema)),
		}),
		detail: {
			summary: "Caratteristiche di una sotto-categoria per il form",
			description:
				"Restituisce, non paginate, le caratteristiche previste per la sotto-categoria, nell'ordine del form (posizione, poi nome), con le opzioni delle liste chiuse. 404 se la sotto-categoria non esiste.",
			tags: ["Seller - Products"],
		},
	},
);
```

Se `withErrors` o `okRes` in questo repo richiedono un contesto diverso (confrontare con `routes/brands.ts`, la rotta seller più semplice), ricalcare quella forma. In `apps/api/src/modules/seller/index.ts` importare `productCharacteristicsRoutes` e aggiungere `.use(productCharacteristicsRoutes)` subito dopo `.use(productsRoutes)`.

- [ ] **Step 6: Verificare**

Run: `cd apps/api && bun test tests/integration/seller-product-characteristics.test.ts tests/integration/seller-products.test.ts`
Expected: PASS. I test di `seller-products.test.ts` su `getProduct` restano verdi (il campo nuovo si aggiunge).

Run: `bun run --cwd apps/api typecheck; echo $?` → `0`. Poi `bun run --cwd apps/seller typecheck; echo $?` → `0` (il dettaglio ha un campo in più: nessun consumatore si rompe).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src apps/api/tests/integration/seller-product-characteristics.test.ts
git commit -m "feat(api): matrice del form e valori nel dettaglio prodotto seller" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Salvare i valori alla creazione e alla modifica

`createProduct` e `updateProduct` accettano `characteristicValues` e li salvano nella loro transazione, validati dal Task 2. Qui la sotto-categoria non cambia: il cambio è il Task 5. La regola P1 si applica già: alla creazione tutte le obbligatorie; in modifica, nessuna obbligatoria compilata può essere svuotata.

**Files:**
- Modify: `apps/api/src/modules/seller/services/product-characteristics.ts` (aggiungere `saveProductCharacteristics`)
- Modify: `apps/api/src/modules/seller/services/products.ts` (`createProduct`, `updateProduct`)
- Modify: `apps/api/src/lib/schemas/forms/products.ts`, `apps/api/src/lib/schemas/forms/index.ts`
- Modify: `apps/api/src/modules/seller/routes/products.ts` (corpo del PATCH, `description` di POST e PATCH)
- Test: `apps/api/tests/integration/seller-product-characteristics.test.ts`

**Interfaces:**
- Consumes: `listFormCharacteristics` (Task 3); `validateCharacteristicValues`, `filledAfter`, `missingRequired`, `CharacteristicValueInput` (Task 2).
- Produces:
  - `type SaveMode = "create" | "stay" | "change"`
  - `saveProductCharacteristics(tx: Executor, params: { productId: string; productCategoryId: string | null; inputs: CharacteristicValueInput[]; mode: SaveMode; confirmAffected: number }): Promise<void>` — in questo task `"change"` si comporta come `"create"` (tutte le obbligatorie); la pulizia arriva nel Task 5
  - `CreateProductParams.characteristicValues?: CharacteristicValueInput[]`
  - `UpdateProductParams.characteristicValues?: CharacteristicValueInput[]`, `UpdateProductParams.confirmAffected?: number` (usato dal Task 5)
  - `CharacteristicValueInputSchema` in `@bibs/api/schemas`; `CreateProductBody.characteristicValues` opzionale
  - Il PATCH accetta `characteristicValues` e `confirmAffected`

- [ ] **Step 1: Scrivere i test che falliscono**

In `seller-product-characteristics.test.ts` aggiungere agli import `createProduct, updateProduct` da `@/modules/seller/services/products`, `import { eq } from "drizzle-orm";` e `import { product } from "@/db/schemas/product";`; dopo `seedPhoneWithValues` aggiungere il helper:

```ts
async function valuesOf(productId: string) {
	const rows = await getTestDb()
		.select({ id: productCharacteristicValue.characteristicId })
		.from(productCharacteristicValue)
		.where(eq(productCharacteristicValue.productId, productId));
	return new Set(rows.map((r) => r.id));
}
```

e, in fondo al file:

```ts
describe("createProduct with characteristics", () => {
	it("stores one value per type", async () => {
		const c = await seedCatalog();

		const created = await createProduct({
			sellerProfileId: c.seller.profile.id,
			storeId: c.store.id,
			name: "Telefono",
			price: "199.00",
			productCategoryId: c.phones.id,
			characteristicValues: [
				{ characteristicId: c.peso.id, value: 180 },
				{ characteristicId: c.modello.id, value: "X1" },
				{ characteristicId: c.g5.id, value: false },
				{ characteristicId: c.colore.id, value: c.bianco.id },
			],
		});

		expect(await listProductCharacteristicValues(created.id)).toEqual([
			{ characteristicId: c.g5.id, name: "5G", value: false },
			{ characteristicId: c.colore.id, name: "Colore", value: c.bianco.id },
			{ characteristicId: c.modello.id, name: "Modello", value: "X1" },
			{ characteristicId: c.peso.id, name: "Peso", value: 180 },
		]);
	});

	it("saves a product with an empty section when nothing is required (D8)", async () => {
		const c = await seedCatalog();
		const created = await createProduct({
			sellerProfileId: c.seller.profile.id,
			storeId: c.store.id,
			name: "Tablet",
			price: "299.00",
			productCategoryId: c.tablets.id,
		});
		expect((await valuesOf(created.id)).size).toBe(0);
	});

	it("refuses a new product that leaves a required characteristic empty", async () => {
		const c = await seedCatalog();

		const err = await caught(() =>
			createProduct({
				sellerProfileId: c.seller.profile.id,
				storeId: c.store.id,
				name: "Telefono",
				price: "199.00",
				productCategoryId: c.phones.id,
				characteristicValues: [{ characteristicId: c.peso.id, value: 180 }],
			}),
		);

		expect(err.status).toBe(400);
		expect(err.message).toContain("Modello");
		// La transazione è annullata: nessun prodotto a metà.
		const rows = await c.db.select().from(product);
		expect(rows).toHaveLength(0);
	});

	it("refuses an invalid value and writes nothing", async () => {
		const c = await seedCatalog();

		const err = await caught(() =>
			createProduct({
				sellerProfileId: c.seller.profile.id,
				storeId: c.store.id,
				name: "Telefono",
				price: "199.00",
				productCategoryId: c.phones.id,
				characteristicValues: [
					{ characteristicId: c.modello.id, value: "X1" },
					{ characteristicId: c.peso.id, value: "tanto" },
				],
			}),
		);

		expect(err.status).toBe(400);
		expect(err.message).toContain("Peso: atteso un numero");
		expect(await c.db.select().from(product)).toHaveLength(0);
	});

	it("refuses values on a product without a subcategory", async () => {
		const c = await seedCatalog();

		const err = await caught(() =>
			createProduct({
				sellerProfileId: c.seller.profile.id,
				storeId: c.store.id,
				name: "Senza categoria",
				price: "1.00",
				productCategoryId: null,
				characteristicValues: [{ characteristicId: c.peso.id, value: 1 }],
			}),
		);

		expect(err.status).toBe(400);
		expect(err.message).toContain("non prevista");
	});
});

describe("updateProduct in the same subcategory", () => {
	it("updates, clears and leaves alone according to the list", async () => {
		const c = await seedCatalog();
		const p = await seedPhoneWithValues(c);

		await updateProduct({
			productId: p.id,
			sellerProfileId: c.seller.profile.id,
			accessibleStoreIds: [c.store.id],
			productCategoryId: c.phones.id,
			characteristicValues: [
				{ characteristicId: c.peso.id, value: 200 },
				{ characteristicId: c.g5.id, value: null },
			],
		});

		expect(await listProductCharacteristicValues(p.id)).toEqual([
			{ characteristicId: c.colore.id, name: "Colore", value: c.nero.id },
			{ characteristicId: c.modello.id, name: "Modello", value: "X1" },
			{ characteristicId: c.peso.id, name: "Peso", value: 200 },
		]);
	});

	it("leaves values alone when the list is omitted", async () => {
		const c = await seedCatalog();
		const p = await seedPhoneWithValues(c);

		await updateProduct({
			productId: p.id,
			sellerProfileId: c.seller.profile.id,
			accessibleStoreIds: [c.store.id],
			name: "Nuovo nome",
		});

		expect((await valuesOf(p.id)).size).toBe(4);
	});

	it("tolerates a required characteristic that was never filled (P1)", async () => {
		const c = await seedCatalog();
		const p = await createTestProduct(c.db, c.seller.profile.id, {
			categoryIds: [c.phones.id],
		});
		await createTestStoreProduct(c.db, c.store.id, p.id);

		const updated = await updateProduct({
			productId: p.id,
			sellerProfileId: c.seller.profile.id,
			accessibleStoreIds: [c.store.id],
			productCategoryId: c.phones.id,
			price: "12.00",
			characteristicValues: [
				{ characteristicId: c.peso.id, value: 150 },
				{ characteristicId: c.modello.id, value: null },
			],
		});

		expect(updated?.price).toBe("12.00");
		expect([...(await valuesOf(p.id))]).toEqual([c.peso.id]);
	});

	it("refuses to clear a required characteristic already filled", async () => {
		const c = await seedCatalog();
		const p = await seedPhoneWithValues(c);

		const err = await caught(() =>
			updateProduct({
				productId: p.id,
				sellerProfileId: c.seller.profile.id,
				accessibleStoreIds: [c.store.id],
				productCategoryId: c.phones.id,
				characteristicValues: [{ characteristicId: c.modello.id, value: "" }],
			}),
		);

		expect(err.status).toBe(400);
		expect(err.message).toContain("Non puoi svuotare");
		expect(err.message).toContain("Modello");
		expect((await valuesOf(p.id)).has(c.modello.id)).toBe(true);
	});
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `cd apps/api && bun test tests/integration/seller-product-characteristics.test.ts`
Expected: FAIL — `characteristicValues` viene ignorato (nessun valore scritto) e i due test di rifiuto non ricevono un `ServiceError`.

- [ ] **Step 3: `saveProductCharacteristics`**

In `apps/api/src/modules/seller/services/product-characteristics.ts`, estendere gli import (`and`, `sql` da `drizzle-orm`; `filledAfter`, `missingRequired`, `validateCharacteristicValues`, `type CharacteristicValueInput` da `@/lib/characteristic-values`) e aggiungere:

```ts
/**
 * - `create`: il prodotto nasce dal form, ogni obbligatoria va compilata.
 * - `stay`: resta nella sua sotto-categoria; un'obbligatoria mai compilata è
 *   tollerata, una già compilata non si svuota.
 * - `change`: cambia sotto-categoria; come `create`, più la pulizia di D10.
 * (Decisione P1 del piano PR 4.)
 */
export type SaveMode = "create" | "stay" | "change";

interface SaveProductCharacteristicsParams {
	productId: string;
	productCategoryId: string | null;
	inputs: CharacteristicValueInput[];
	mode: SaveMode;
	/** Solo per `change`: i valori persi che l'interfaccia ha mostrato. */
	confirmAffected: number;
}

/**
 * Scrive i valori delle caratteristiche di un prodotto dentro la transazione
 * di chi chiama. Una voce con valore aggiorna, una voce vuota cancella, una
 * caratteristica assente dalla lista resta com'è. Ogni errore lancia, e la
 * transazione dell'intero salvataggio va in rollback.
 */
export async function saveProductCharacteristics(
	tx: Executor,
	params: SaveProductCharacteristicsParams,
) {
	const { productId, productCategoryId, inputs, mode } = params;
	if (mode === "stay" && inputs.length === 0) return;

	const definitions = productCategoryId
		? await listFormCharacteristics(productCategoryId, tx)
		: [];

	const existing = await tx
		.select({ id: productCharacteristicValue.characteristicId })
		.from(productCharacteristicValue)
		.where(eq(productCharacteristicValue.productId, productId));
	const before = new Set(existing.map((r) => r.id));

	const validated = validateCharacteristicValues(definitions, inputs);
	if (validated.errors.length > 0) {
		throw new ServiceError(400, validated.errors.join("; "));
	}

	const entering = mode !== "stay";
	const missing = missingRequired({
		definitions,
		before,
		after: filledAfter(before, validated),
		entering,
	});
	if (missing.length > 0) {
		throw new ServiceError(
			400,
			entering
				? `Compila le caratteristiche obbligatorie: ${missing.join(", ")}`
				: `Non puoi svuotare una caratteristica obbligatoria: ${missing.join(", ")}`,
		);
	}

	if (validated.clears.length > 0) {
		await tx
			.delete(productCharacteristicValue)
			.where(
				and(
					eq(productCharacteristicValue.productId, productId),
					inArray(productCharacteristicValue.characteristicId, validated.clears),
				),
			);
	}
	if (validated.upserts.length > 0) {
		await tx
			.insert(productCharacteristicValue)
			.values(validated.upserts.map((r) => ({ productId, ...r })))
			// Tutte le colonne, anche quelle a null: il CHECK vuole valorizzata
			// solo la colonna del tipo.
			.onConflictDoUpdate({
				target: [
					productCharacteristicValue.productId,
					productCharacteristicValue.characteristicId,
				],
				set: {
					dataType: sql`excluded.data_type`,
					valueText: sql`excluded.value_text`,
					valueNumber: sql`excluded.value_number`,
					valueBoolean: sql`excluded.value_boolean`,
					optionId: sql`excluded.option_id`,
				},
			});
	}
}
```

- [ ] **Step 4: Chiamarla da `createProduct` e `updateProduct`**

In `apps/api/src/modules/seller/services/products.ts`, importare `saveProductCharacteristics` da `./product-characteristics` e `type CharacteristicValueInput` da `@/lib/characteristic-values`.

`CreateProductParams` guadagna `characteristicValues?: CharacteristicValueInput[];`. Nel destructuring di `createProduct` aggiungere `characteristicValues,` (così non finisce in `productData`), e nella transazione, dopo l'inserimento in `storeProduct`:

```ts
		await saveProductCharacteristics(tx, {
			productId: created.id,
			productCategoryId: created.productCategoryId,
			inputs: characteristicValues ?? [],
			mode: "create",
			confirmAffected: 0,
		});
```

`UpdateProductParams` guadagna `characteristicValues?: CharacteristicValueInput[];` e `confirmAffected?: number;`. Nel destructuring di `updateProduct` aggiungere `characteristicValues,` e `confirmAffected,`. Dopo il blocco `if (!updated) return null;` e prima di `if (imageOrder)`:

```ts
		// Il form di modifica rimanda sempre la sotto-categoria, anche invariata:
		// è un cambio solo se diversa da quella salvata.
		const categoryChanged =
			productCategoryId !== undefined &&
			productCategoryId !== existing.productCategoryId;
		await saveProductCharacteristics(tx, {
			productId: updated.id,
			productCategoryId: updated.productCategoryId,
			inputs: characteristicValues ?? [],
			mode: categoryChanged ? "change" : "stay",
			confirmAffected: confirmAffected ?? 0,
		});
```

`existing` è già caricato all'inizio di `updateProduct` con tutte le colonne di `product`, `productCategoryId` compreso.

- [ ] **Step 5: Il corpo delle rotte**

In `apps/api/src/lib/schemas/forms/products.ts`, prima di `CreateProductBody`:

```ts
export const CharacteristicValueInputSchema = Type.Object({
	characteristicId: Type.String({ description: "ID della caratteristica" }),
	value: Type.Union(
		[
			Type.String({ maxLength: 2000 }),
			Type.Number(),
			Type.Boolean(),
			Type.Null(),
		],
		{
			description:
				"Testo, numero o sì/no secondo il tipo; per le liste chiuse l'ID dell'opzione. null o testo vuoto cancella il valore",
		},
	),
});

export const CharacteristicValuesField = Type.Array(
	CharacteristicValueInputSchema,
	{
		maxItems: 100,
		description:
			"Valori delle caratteristiche della sotto-categoria. Una voce con valore aggiorna, una vuota cancella, una caratteristica assente resta com'è",
	},
);
```

In `CreateProductBody`, dopo `brandName`:

```ts
	characteristicValues: Type.Optional(CharacteristicValuesField),
```

In `apps/api/src/lib/schemas/forms/index.ts`, esportare anche `CharacteristicValueInputSchema` e `CharacteristicValuesField` accanto a `CreateProductBody`.

In `apps/api/src/modules/seller/routes/products.ts`, importare `CharacteristicValuesField` da `@/lib/schemas/forms` e, nel `body` del PATCH, dopo `brandName`:

```ts
				characteristicValues: t.Optional(CharacteristicValuesField),
				confirmAffected: t.Optional(
					t.Integer({
						minimum: 0,
						description:
							"Solo al cambio di sotto-categoria: quanti valori già salvati, fuori dalla nuova matrice, l'interfaccia ha mostrato nella conferma. Se se ne perdono di più, 409 e nulla cambia. Assente vale 0.",
					}),
				),
```

Nelle `description` di POST e PATCH aggiungere una frase: POST «Salva anche i valori delle caratteristiche: le obbligatorie della sotto-categoria vanno tutte compilate.»; PATCH «Salva i valori delle caratteristiche; un'obbligatoria già compilata non si può svuotare. Cambiando sotto-categoria si perdono i valori fuori dalla nuova matrice, dietro confirmAffected, e le nuove obbligatorie vanno compilate.»

- [ ] **Step 6: Verificare**

Run: `cd apps/api && bun test tests/integration/seller-product-characteristics.test.ts tests/integration/seller-products.test.ts`
Expected: PASS.

Run: `bun run --cwd apps/api typecheck; echo $?` → `0`; `bun run --cwd apps/seller typecheck; echo $?` → `0` (lo schema TypeBox del form seller deriva da `CreateProductBody`: un campo opzionale in più non rompe nulla, lo esclude il Task 7).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src apps/api/tests/integration/seller-product-characteristics.test.ts
git commit -m "feat(api): salvataggio dei valori delle caratteristiche dal seller" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Il quarto atto di D10 — cambio di sotto-categoria

Oggi su `main` cambiare sotto-categoria lascia i valori dove sono. Si chiude nell'update, nella stessa transazione, dietro `confirmAffected`; e si fissa con un test che l'import CSV non può compiere l'atto (P4).

**Files:**
- Modify: `apps/api/src/modules/seller/services/product-characteristics.ts`
- Modify: `apps/api/src/modules/seller/services/product-import.ts` (solo commento)
- Test: `apps/api/tests/integration/seller-product-characteristics.test.ts`

**Interfaces:**
- Consumes: `saveProductCharacteristics` (Task 4), `assertValueLossConfirmed` (Task 1), `importProductsFromCsv`.
- Produces: in modalità `"change"`, `saveProductCharacteristics` cancella i valori fuori dalla nuova matrice **prima** di validare, e lancia `409` se sono più di `confirmAffected`.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere agli import `importProductsFromCsv` da `@/modules/seller/services/product-import` e, in fondo:

```ts
describe("updateProduct changing subcategory (D10)", () => {
	it("asks for a confirmation naming the values that would be lost", async () => {
		const c = await seedCatalog();
		const p = await seedPhoneWithValues(c);

		const err = await caught(() =>
			updateProduct({
				productId: p.id,
				sellerProfileId: c.seller.profile.id,
				accessibleStoreIds: [c.store.id],
				productCategoryId: c.tablets.id,
			}),
		);

		expect(err.status).toBe(409);
		expect(err.message).toContain("2 valori già compilati (5G, Modello)");
		// Rollback: la categoria e i quattro valori restano.
		const [row] = await c.db
			.select({ categoryId: product.productCategoryId })
			.from(product)
			.where(eq(product.id, p.id));
		expect(row.categoryId).toBe(c.phones.id);
		expect((await valuesOf(p.id)).size).toBe(4);
	});

	it("drops only the values outside the new matrix once confirmed", async () => {
		const c = await seedCatalog();
		const p = await seedPhoneWithValues(c);

		await updateProduct({
			productId: p.id,
			sellerProfileId: c.seller.profile.id,
			accessibleStoreIds: [c.store.id],
			productCategoryId: c.tablets.id,
			confirmAffected: 2,
		});

		// Peso e Colore sono anche in Tablet: restano, con il loro valore.
		expect(await listProductCharacteristicValues(p.id)).toEqual([
			{ characteristicId: c.colore.id, name: "Colore", value: c.nero.id },
			{ characteristicId: c.peso.id, name: "Peso", value: 180 },
		]);
	});

	it("rejects a stale confirmation that covered fewer values", async () => {
		const c = await seedCatalog();
		const p = await seedPhoneWithValues(c);

		const err = await caught(() =>
			updateProduct({
				productId: p.id,
				sellerProfileId: c.seller.profile.id,
				accessibleStoreIds: [c.store.id],
				productCategoryId: c.tablets.id,
				confirmAffected: 1,
			}),
		);

		expect(err.status).toBe(409);
		expect(err.message).toContain("la conferma ne copriva 1");
		expect((await valuesOf(p.id)).size).toBe(4);
	});

	it("drops every value when the subcategory is removed", async () => {
		const c = await seedCatalog();
		const p = await seedPhoneWithValues(c);

		await updateProduct({
			productId: p.id,
			sellerProfileId: c.seller.profile.id,
			accessibleStoreIds: [c.store.id],
			productCategoryId: null,
			confirmAffected: 4,
		});

		expect((await valuesOf(p.id)).size).toBe(0);
	});

	it("requires the new required characteristics on entry", async () => {
		const c = await seedCatalog();
		const p = await createTestProduct(c.db, c.seller.profile.id, {
			categoryIds: [c.tablets.id],
		});
		await createTestStoreProduct(c.db, c.store.id, p.id);

		const err = await caught(() =>
			updateProduct({
				productId: p.id,
				sellerProfileId: c.seller.profile.id,
				accessibleStoreIds: [c.store.id],
				productCategoryId: c.phones.id,
			}),
		);
		expect(err.status).toBe(400);
		expect(err.message).toContain("Modello");

		await updateProduct({
			productId: p.id,
			sellerProfileId: c.seller.profile.id,
			accessibleStoreIds: [c.store.id],
			productCategoryId: c.phones.id,
			characteristicValues: [{ characteristicId: c.modello.id, value: "X2" }],
		});
		expect([...(await valuesOf(p.id))]).toEqual([c.modello.id]);
	});

	it("resending the same subcategory is not a change", async () => {
		const c = await seedCatalog();
		const p = await seedPhoneWithValues(c);

		const updated = await updateProduct({
			productId: p.id,
			sellerProfileId: c.seller.profile.id,
			accessibleStoreIds: [c.store.id],
			productCategoryId: c.phones.id,
			name: "Rinominato",
			characteristicValues: [{ characteristicId: c.peso.id, value: 181 }],
		});

		expect(updated?.name).toBe("Rinominato");
		expect((await valuesOf(p.id)).size).toBe(4);
	});
});

describe("CSV import and D10 (P4)", () => {
	it("never moves an existing product, so its values stay", async () => {
		const c = await seedCatalog();
		const p = await createProduct({
			sellerProfileId: c.seller.profile.id,
			storeId: c.store.id,
			name: "Telefono",
			price: "199.00",
			productCategoryId: c.phones.id,
			ean: "1111111111116",
			characteristicValues: [
				{ characteristicId: c.modello.id, value: "X1" },
				{ characteristicId: c.g5.id, value: true },
			],
		});

		const result = await importProductsFromCsv({
			sellerProfileId: c.seller.profile.id,
			storeId: c.store.id,
			csvText: [
				"name,description,price,categories,ean",
				"Telefono,,199.00,Tablet,1111111111116",
			].join("\n"),
		});

		expect(result.created).toBe(0);
		expect(result.skipped).toBe(1);
		const [row] = await c.db
			.select({ categoryId: product.productCategoryId })
			.from(product)
			.where(eq(product.id, p.id));
		expect(row.categoryId).toBe(c.phones.id);
		expect((await valuesOf(p.id)).size).toBe(2);
	});

	it("creates products without values even where some are required", async () => {
		const c = await seedCatalog();

		const result = await importProductsFromCsv({
			sellerProfileId: c.seller.profile.id,
			storeId: c.store.id,
			csvText: [
				"name,description,price,categories",
				"Telefono importato,,99.00,Smartphone",
			].join("\n"),
		});

		expect(result.created).toBe(1);
		const [created] = await c.db
			.select({ id: product.id })
			.from(product)
			.where(eq(product.name, "Telefono importato"));
		expect((await valuesOf(created.id)).size).toBe(0);
	});
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `cd apps/api && bun test tests/integration/seller-product-characteristics.test.ts`
Expected: FAIL — i tre test sul `409` e quello della rimozione non vedono né errore né pulizia; `drops only the values…` trova ancora i quattro valori. I test dell'import passano già: fissano una proprietà esistente, ed è giusto così.

- [ ] **Step 3: La pulizia**

In `apps/api/src/modules/seller/services/product-characteristics.ts`, importare `notInArray` da `drizzle-orm` e `assertValueLossConfirmed` da `@/lib/characteristic-impact`, e aggiungere:

```ts
/**
 * D10 al cambio di sotto-categoria: via i valori delle caratteristiche che la
 * nuova matrice non prevede. Quelle in comune restano, con il loro valore: tipo
 * e opzioni stanno sul dizionario, quindi il valore è ancora valido. Il
 * confronto con la conferma è sulle righe EFFETTIVAMENTE cancellate: se sono
 * di più, l'assert lancia e la transazione va in rollback.
 */
async function dropValuesOutsideMatrix(
	tx: Executor,
	productId: string,
	keepIds: string[],
	confirmAffected: number,
) {
	const dropped = await tx
		.delete(productCharacteristicValue)
		.where(
			and(
				eq(productCharacteristicValue.productId, productId),
				keepIds.length > 0
					? notInArray(productCharacteristicValue.characteristicId, keepIds)
					: undefined,
			),
		)
		.returning({ id: productCharacteristicValue.characteristicId });
	if (dropped.length === 0) return;

	const names = await tx
		.select({ name: productCharacteristic.name })
		.from(productCharacteristic)
		.where(
			inArray(
				productCharacteristic.id,
				dropped.map((d) => d.id),
			),
		)
		.orderBy(asc(productCharacteristic.name));
	assertValueLossConfirmed(
		names.map((n) => n.name),
		confirmAffected,
	);
}
```

In `saveProductCharacteristics`, subito dopo il calcolo di `definitions` e **prima** di leggere `existing`:

```ts
	if (mode === "change") {
		await dropValuesOutsideMatrix(
			tx,
			productId,
			definitions.map((d) => d.id),
			params.confirmAffected,
		);
	}
```

L'ordine conta: `before` si legge dopo la pulizia, così una caratteristica appena cancellata non conta come «già compilata».

- [ ] **Step 4: Il commento nell'import**

In `apps/api/src/modules/seller/services/product-import.ts`, sopra `export async function importProductsFromCsv`:

```ts
/**
 * L'import CREA soltanto: una riga con un EAN già usato viene saltata e il
 * prodotto esistente resta intatto. Per questo non può cambiare la
 * sotto-categoria di un prodotto che ha valori, e non gli serve la conferma di
 * D10 che il form chiede. I prodotti creati da qui nascono senza caratteristiche
 * (il CSV non ha le loro colonne), anche dove alcune sono obbligatorie.
 *
 * Se un giorno l'import aggiornerà prodotti esistenti, un cambio di
 * sotto-categoria che fa perdere valori va RIFIUTATO come errore di riga, con
 * l'elenco dei valori persi: un CSV non ha un dialog, e un file ricaricato
 * identico non deve cancellare dati a sorpresa.
 */
```

- [ ] **Step 5: Verificare**

Run: `cd apps/api && bun test tests/integration/seller-product-characteristics.test.ts tests/integration/seller-products.test.ts`
Expected: PASS.

Run: `bun run --cwd apps/api test 2>&1 | tail -8`
Expected: `0 fail`; totale unitario = baseline + 17; totale d'integrazione = baseline + 4 (Task 1) + 5 (Task 3) + 9 (Task 4) + 8 (Task 5) = baseline + 26.

Run: `bun run --cwd apps/api typecheck; echo $?` → `0`; `bun run db:generate` → «No schema changes».

- [ ] **Step 6: Commit**

```bash
git add apps/api/src apps/api/tests/integration/seller-product-characteristics.test.ts
git commit -m "fix(products): il cambio di sotto-categoria cancella i valori fuori matrice" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Seller — la sezione Caratteristiche

Il componente e i suoi aiutanti, non ancora collegati al form (lo fa il Task 7). Il seller non ha una suite di test frontend: le conversioni stanno in un modulo puro separato perché si leggano da sole, e la prova è il typecheck più il collaudo del Task 8.

**Files:**
- Create: `apps/seller/src/features/products/lib/characteristic-form.ts`
- Create: `apps/seller/src/features/products/hooks/use-category-characteristics.ts`
- Create: `apps/seller/src/features/products/components/product-characteristics-section.tsx`

**Interfaces:**
- Consumes: `GET /seller/product-categories/:productCategoryId/characteristics` (Task 3), la forma di `characteristicValues` nel dettaglio (Task 3), `CharacteristicValuesField` (Task 4).
- Produces:
  - `useCategoryCharacteristics(productCategoryId: string | null | undefined)` — `useQuery` con chiave `["seller-category-characteristics", productCategoryId]`
  - `type CategoryCharacteristic` — un elemento della risposta
  - `type CharacteristicFormValue = string | boolean | null` (i numeri restano stringhe finché si scrive)
  - `type CharacteristicFormValues = Record<string, CharacteristicFormValue>`
  - `interface SavedCharacteristicValue { characteristicId: string; name: string; value: string | number | boolean }`
  - `toFormValues(saved: SavedCharacteristicValue[]): CharacteristicFormValues`
  - `isFilled(v: CharacteristicFormValue | undefined): boolean`
  - `buildCharacteristicPayload(defs: CategoryCharacteristic[], values: CharacteristicFormValues): { characteristicId: string; value: string | number | boolean | null }[]`
  - `requiredToFill(params: { defs: CategoryCharacteristic[]; values: CharacteristicFormValues; savedIds: ReadonlySet<string>; entering: boolean }): CategoryCharacteristic[]`
  - `lostOnSave(saved: SavedCharacteristicValue[], defs: CategoryCharacteristic[]): SavedCharacteristicValue[]`
  - `valuesPhrase(n: number): string` e `filledPhrase(n: number): string` — `"1 valore già compilato"` / `"3 valori già compilati"`
  - `<ProductCharacteristicsSection definitions values onChange errorIds open onOpenChange pendingLoss />`

- [ ] **Step 1: Il modulo delle conversioni**

Create `apps/seller/src/features/products/lib/characteristic-form.ts`:

```ts
import type { CategoryCharacteristic } from "../hooks/use-category-characteristics";

/**
 * Stato del form per le caratteristiche. I numeri restano stringhe mentre il
 * venditore scrive (un campo numerico svuotato vale ""); si convertono solo
 * all'invio. `null` è «non indicato», per ogni tipo.
 */
export type CharacteristicFormValue = string | boolean | null;
export type CharacteristicFormValues = Record<string, CharacteristicFormValue>;

export interface SavedCharacteristicValue {
	characteristicId: string;
	name: string;
	value: string | number | boolean;
}

export function toFormValues(
	saved: SavedCharacteristicValue[],
): CharacteristicFormValues {
	return Object.fromEntries(
		saved.map((v) => [
			v.characteristicId,
			typeof v.value === "number" ? String(v.value) : v.value,
		]),
	);
}

export function isFilled(v: CharacteristicFormValue | undefined): boolean {
	if (v === null || v === undefined) return false;
	if (typeof v === "string") return v.trim().length > 0;
	return true;
}

/**
 * Tutte le caratteristiche della matrice corrente, le vuote a null: il server
 * cancella le vuote e ignora quelle che non riceve. Le caratteristiche di una
 * categoria scelta e poi abbandonata restano nello stato ma non partono.
 */
export function buildCharacteristicPayload(
	defs: CategoryCharacteristic[],
	values: CharacteristicFormValues,
) {
	return defs.map((d) => {
		const v = values[d.id];
		if (!isFilled(v)) return { characteristicId: d.id, value: null };
		if (d.dataType === "number") {
			const n = Number(v);
			return { characteristicId: d.id, value: Number.isNaN(n) ? null : n };
		}
		return { characteristicId: d.id, value: v as string | boolean };
	});
}

/**
 * La regola P1, lato client (il server la ripete). `entering`: prodotto nuovo o
 * sotto-categoria cambiata, ogni obbligatoria va compilata. Altrimenti solo
 * quelle già salvate non si possono svuotare.
 */
export function requiredToFill(params: {
	defs: CategoryCharacteristic[];
	values: CharacteristicFormValues;
	savedIds: ReadonlySet<string>;
	entering: boolean;
}) {
	const { defs, values, savedIds, entering } = params;
	return defs.filter(
		(d) =>
			d.required &&
			!isFilled(values[d.id]) &&
			(entering || savedIds.has(d.id)),
	);
}

/** I valori salvati che la nuova sotto-categoria non prevede (D10). */
export function lostOnSave(
	saved: SavedCharacteristicValue[],
	defs: CategoryCharacteristic[],
) {
	const keep = new Set(defs.map((d) => d.id));
	return saved.filter((v) => !keep.has(v.characteristicId));
}

export function valuesPhrase(n: number) {
	return `${n} valor${n === 1 ? "e" : "i"}`;
}

export function filledPhrase(n: number) {
	return `${valuesPhrase(n)} già compilat${n === 1 ? "o" : "i"}`;
}
```

- [ ] **Step 2: L'hook**

Create `apps/seller/src/features/products/hooks/use-category-characteristics.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";

async function fetchCategoryCharacteristics(productCategoryId: string) {
	const res = await api()
		.seller["product-categories"]({ productCategoryId })
		.characteristics.get();
	return unwrap(res, "Errore nel caricamento delle caratteristiche").data;
}

export type CategoryCharacteristic = Awaited<
	ReturnType<typeof fetchCategoryCharacteristics>
>[number];

export function useCategoryCharacteristics(
	productCategoryId: string | null | undefined,
) {
	return useQuery({
		queryKey: ["seller-category-characteristics", productCategoryId],
		queryFn: () => fetchCategoryCharacteristics(productCategoryId as string),
		enabled: !!productCategoryId,
		// La matrice cambia solo dall'admin: non serve rileggerla a ogni focus.
		staleTime: 5 * 60_000,
	});
}
```

- [ ] **Step 3: La sezione**

Create `apps/seller/src/features/products/components/product-characteristics-section.tsx`:

```tsx
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@bibs/ui/components/collapsible";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@bibs/ui/components/input-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@bibs/ui/components/select";
import { ToggleGroup, ToggleGroupItem } from "@bibs/ui/components/toggle-group";
import { ChevronDownIcon } from "lucide-react";
import type { CategoryCharacteristic } from "../hooks/use-category-characteristics";
import {
	type CharacteristicFormValue,
	type CharacteristicFormValues,
	filledPhrase,
	isFilled,
	type SavedCharacteristicValue,
} from "../lib/characteristic-form";

// Radix rifiuta value="" su un SelectItem: «non indicato» viaggia così.
const NOT_SET = "__not_set__";

interface Props {
	definitions: CategoryCharacteristic[];
	values: CharacteristicFormValues;
	onChange: (characteristicId: string, value: CharacteristicFormValue) => void;
	/** Obbligatorie che l'ultimo tentativo di salvataggio ha trovato vuote. */
	errorIds: ReadonlySet<string>;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Valori salvati che il cambio di sotto-categoria farà perdere. */
	pendingLoss: SavedCharacteristicValue[];
}

export function ProductCharacteristicsSection({
	definitions,
	values,
	onChange,
	errorIds,
	open,
	onOpenChange,
	pendingLoss,
}: Props) {
	if (definitions.length === 0 && pendingLoss.length === 0) return null;

	const filled = definitions.filter((d) => isFilled(values[d.id])).length;
	const requiredEmpty = definitions.filter(
		(d) => d.required && !isFilled(values[d.id]),
	).length;

	return (
		<div className="space-y-3">
			{pendingLoss.length > 0 && (
				<p
					role="status"
					className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
				>
					Al salvataggio verranno eliminati {filledPhrase(pendingLoss.length)}{" "}
					della categoria precedente:{" "}
					{pendingLoss.map((v) => v.name).join(", ")}.
				</p>
			)}

			{definitions.length > 0 && (
				<Collapsible
					open={open}
					onOpenChange={onOpenChange}
					className="rounded-lg border border-warm-line"
				>
					<CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
						<span className="text-sm font-medium text-foreground">
							Caratteristiche
						</span>
						<span className="flex items-center gap-2 text-xs text-muted-foreground">
							<span>
								{filled} di {definitions.length} compilate
							</span>
							{requiredEmpty > 0 && (
								<span className="text-destructive">
									· {requiredEmpty}{" "}
									{requiredEmpty === 1 ? "obbligatoria" : "obbligatorie"} da
									compilare
								</span>
							)}
							<ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180" />
						</span>
					</CollapsibleTrigger>
					<CollapsibleContent className="border-t border-warm-line px-4 py-4">
						<div className="@container">
							<div className="grid gap-4 @md:grid-cols-2">
								{definitions.map((def) => (
									<CharacteristicField
										key={def.id}
										def={def}
										value={values[def.id] ?? null}
										invalid={errorIds.has(def.id)}
										onChange={(v) => onChange(def.id, v)}
									/>
								))}
							</div>
						</div>
					</CollapsibleContent>
				</Collapsible>
			)}
		</div>
	);
}

function CharacteristicField({
	def,
	value,
	invalid,
	onChange,
}: {
	def: CategoryCharacteristic;
	value: CharacteristicFormValue;
	invalid: boolean;
	onChange: (value: CharacteristicFormValue) => void;
}) {
	const id = `characteristic-${def.id}`;
	return (
		<Field data-invalid={invalid}>
			<FieldLabel htmlFor={id} required={def.required}>
				{def.name}
			</FieldLabel>
			<CharacteristicControl
				id={id}
				def={def}
				value={value}
				onChange={onChange}
			/>
			{invalid && <FieldError errors={[{ message: "Obbligatoria" }]} />}
		</Field>
	);
}

function CharacteristicControl({
	id,
	def,
	value,
	onChange,
}: {
	id: string;
	def: CategoryCharacteristic;
	value: CharacteristicFormValue;
	onChange: (value: CharacteristicFormValue) => void;
}) {
	switch (def.dataType) {
		case "boolean":
			// Tre stati, non due: «Sì», «No» e «non indicato» (un secondo click
			// sulla voce attiva la deseleziona). Decisione P5 del piano PR 4.
			return (
				<ToggleGroup
					id={id}
					type="single"
					variant="outline"
					aria-label={def.name}
					value={value === true ? "yes" : value === false ? "no" : ""}
					onValueChange={(v) =>
						onChange(v === "yes" ? true : v === "no" ? false : null)
					}
					className="justify-start"
				>
					<ToggleGroupItem value="yes">Sì</ToggleGroupItem>
					<ToggleGroupItem value="no">No</ToggleGroupItem>
				</ToggleGroup>
			);
		case "number":
			return (
				<InputGroup>
					<InputGroupInput
						id={id}
						type="number"
						step="any"
						inputMode="decimal"
						value={typeof value === "string" ? value : ""}
						onChange={(e) => onChange(e.target.value)}
					/>
					{def.unit && (
						<InputGroupAddon align="inline-end">
							<InputGroupText>{def.unit}</InputGroupText>
						</InputGroupAddon>
					)}
				</InputGroup>
			);
		case "enum":
			return (
				<Select
					value={typeof value === "string" && value ? value : NOT_SET}
					onValueChange={(v) => onChange(v === NOT_SET ? null : v)}
				>
					<SelectTrigger id={id} className="w-full">
						<SelectValue placeholder="Non indicato" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={NOT_SET}>Non indicato</SelectItem>
						{def.options.map((o) => (
							<SelectItem key={o.id} value={o.id}>
								{o.value}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			);
		case "text":
			return (
				<Input
					id={id}
					maxLength={2000}
					value={typeof value === "string" ? value : ""}
					onChange={(e) => onChange(e.target.value)}
				/>
			);
	}
}
```

Prima di andare avanti, aprire `packages/ui/src/components/toggle-group.tsx` e controllare che accetti `variant="outline"` e che la voce attiva sia stilata con `data-[state=on]:` (Radix v1). Se usasse `data-on:`, correggere lì con `data-[state=on]:` — è la stessa trappola di `feedback_shadcn_data_state_mismatch`.

- [ ] **Step 4: Verificare**

Run: `bun run --cwd apps/seller typecheck; echo $?` → `0`.
Run: `bun run lint` → pulito. Gli export non ancora usati non sono un errore: la sezione si aggancia nel Task 7.

- [ ] **Step 5: Commit**

```bash
git add apps/seller/src/features/products
git commit -m "feat(seller): sezione caratteristiche del form prodotto" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Seller — collegare la sezione al form, con la conferma dei valori persi

**Files:**
- Create: `apps/seller/src/features/products/components/characteristic-loss-dialog.tsx`
- Modify: `apps/seller/src/features/products/components/product-form.tsx`
- Modify: `apps/seller/src/routes/_authenticated/products/new.tsx`, `apps/seller/src/routes/_authenticated/products/$productId.tsx`

**Interfaces:**
- Consumes: tutto il Task 6.
- Produces:
  - `ProductFormValues` guadagna `characteristicValues: { characteristicId: string; value: string | number | boolean | null }[]` e `confirmAffected: number`
  - `ProductFormProps` guadagna `savedCharacteristicValues?: SavedCharacteristicValue[]`
  - `<CharacteristicLossDialog lost open onCancel onConfirm />`

- [ ] **Step 1: Il dialog**

Create `apps/seller/src/features/products/components/characteristic-loss-dialog.tsx`:

```tsx
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	AlertDialogTitle,
} from "@bibs/ui/components/alert-dialog";
import {
	filledPhrase,
	type SavedCharacteristicValue,
} from "../lib/characteristic-form";

interface Props {
	lost: SavedCharacteristicValue[];
	open: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}

export function CharacteristicLossDialog({
	lost,
	open,
	onCancel,
	onConfirm,
}: Props) {
	return (
		<AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogMedia variant="destructive" />
					<AlertDialogTitle>Cambiare sotto-categoria?</AlertDialogTitle>
					<AlertDialogDescription>
						Cambiando categoria perderai {filledPhrase(lost.length)}:{" "}
						{lost.map((v) => v.name).join(", ")}. Non si potranno recuperare.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Annulla</AlertDialogCancel>
					<AlertDialogAction variant="destructive" onClick={onConfirm}>
						Salva ed elimina
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
```

- [ ] **Step 2: Il form**

In `apps/seller/src/features/products/components/product-form.tsx`:

1. Escludere il campo nuovo dallo schema del form (lo stato delle caratteristiche vive fuori da RHF):

```ts
const CreateProductFormBody = Type.Object({
	...Type.Omit(CreateProductBody, ["storeId", "price", "characteristicValues"])
		.properties,
	price: Type.String({ /* invariato */ }),
});
```

2. Tipi e props:

```ts
export interface ProductFormValues extends ProductFormData {
	files: File[];
	imageOrder?: string[];
	characteristicValues: {
		characteristicId: string;
		value: string | number | boolean | null;
	}[];
	/** Valori salvati che il cambio di sotto-categoria cancella, confermati. */
	confirmAffected: number;
}
```

In `ProductFormProps` aggiungere `savedCharacteristicValues?: SavedCharacteristicValue[];`, e riceverlo nella firma di `ProductForm`.

3. Import: `useCategoryCharacteristics`, `ProductCharacteristicsSection`, `CharacteristicLossDialog`, e da `../lib/characteristic-form` `buildCharacteristicPayload`, `lostOnSave`, `requiredToFill`, `toFormValues`, `type CharacteristicFormValue`, `type CharacteristicFormValues`, `type SavedCharacteristicValue`.

4. Stato, subito dopo `const [imageOrder, setImageOrder] = …`:

```ts
	// Fuori da react-hook-form, inizializzato una volta: niente reset in un
	// effetto, che con riferimenti instabili desincronizza le select. Tiene i
	// valori di ogni caratteristica toccata, anche di una categoria poi
	// abbandonata: tornandoci prima di salvare non si perde nulla.
	const [characteristicValues, setCharacteristicValues] =
		useState<CharacteristicFormValues>(() =>
			toFormValues(savedCharacteristicValues ?? []),
		);
	const [characteristicsDirty, setCharacteristicsDirty] = useState(false);
	const [characteristicsOpen, setCharacteristicsOpen] = useState(false);
	const [characteristicErrors, setCharacteristicErrors] = useState<
		ReadonlySet<string>
	>(new Set());
	const [pendingSubmit, setPendingSubmit] = useState<ProductFormValues | null>(
		null,
	);

	const characteristics = useCategoryCharacteristics(productCategoryId);
	const definitions = productCategoryId ? characteristics.data : [];
	const saved = savedCharacteristicValues ?? [];
	const savedCategoryId = defaultValues?.productCategoryId ?? null;
	// Prodotto nuovo o sotto-categoria cambiata: tutte le obbligatorie (P1).
	const entering = !isEdit || (productCategoryId ?? null) !== savedCategoryId;
	// I valori fuori matrice si perdono solo se la categoria cambia davvero.
	const pendingLoss =
		isEdit && entering && definitions ? lostOnSave(saved, definitions) : [];

	const onCharacteristicChange = (
		characteristicId: string,
		value: CharacteristicFormValue,
	) => {
		setCharacteristicValues((prev) => ({ ...prev, [characteristicId]: value }));
		setCharacteristicsDirty(true);
		if (characteristicErrors.has(characteristicId)) {
			const next = new Set(characteristicErrors);
			next.delete(characteristicId);
			setCharacteristicErrors(next);
		}
	};
```

5. `onFormSubmit` diventa:

```ts
	const onFormSubmit: SubmitHandler<ProductFormData> = (data) => {
		// Il pulsante è disabilitato mentre la matrice carica; è una rete.
		if (!definitions) return;

		const missing = requiredToFill({
			defs: definitions,
			values: characteristicValues,
			savedIds: new Set(saved.map((v) => v.characteristicId)),
			entering,
		});
		if (missing.length > 0) {
			setCharacteristicErrors(new Set(missing.map((d) => d.id)));
			setCharacteristicsOpen(true);
			const names = missing.map((d) => d.name).join(", ");
			toast.error(
				entering
					? `Compila le caratteristiche obbligatorie: ${names}`
					: `Non puoi svuotare una caratteristica obbligatoria: ${names}`,
			);
			return;
		}
		setCharacteristicErrors(new Set());

		// data.price is validated to `^\d+(\.\d{1,2})?$`; normalize to exactly two
		// decimals (e.g. `9` → `9.00`, `9.9` → `9.90`) for the strict API schema.
		const price = data.price.includes(".")
			? data.price.padEnd(data.price.indexOf(".") + 3, "0")
			: `${data.price}.00`;
		const values: ProductFormValues = {
			...data,
			ean: data.ean || undefined,
			price,
			files,
			imageOrder,
			characteristicValues: buildCharacteristicPayload(
				definitions,
				characteristicValues,
			),
			confirmAffected: 0,
		};
		// D10: la conferma arriva qui, con il numero che il server confronterà.
		if (pendingLoss.length > 0) {
			setPendingSubmit(values);
			return;
		}
		onSubmit(values);
	};
```

6. Nella `FormSection` «Catalogo», dopo il `Field` del picker:

```tsx
						{definitions && (
							<ProductCharacteristicsSection
								definitions={definitions}
								values={characteristicValues}
								onChange={onCharacteristicChange}
								errorIds={characteristicErrors}
								open={characteristicsOpen}
								onOpenChange={setCharacteristicsOpen}
								pendingLoss={pendingLoss}
							/>
						)}
```

La `FormSection` «Catalogo» oggi non ha `grid` né spaziatura fra i figli: avvolgere i due figli in `<div className="space-y-4">…</div>`.

7. Il pulsante di invio:

```tsx
				<Button
					type="submit"
					disabled={
						isPending ||
						(!!productCategoryId && characteristics.isLoading) ||
						(!isDirty &&
							files.length === 0 &&
							imageOrder === undefined &&
							!characteristicsDirty)
					}
				>
```

8. Prima della chiusura di `</form>`:

```tsx
			<CharacteristicLossDialog
				lost={pendingLoss}
				open={pendingSubmit !== null}
				onCancel={() => setPendingSubmit(null)}
				onConfirm={() => {
					if (pendingSubmit) {
						onSubmit({ ...pendingSubmit, confirmAffected: pendingLoss.length });
					}
					setPendingSubmit(null);
				}}
			/>
```

- [ ] **Step 3: Le due route**

In `apps/seller/src/routes/_authenticated/products/new.tsx`, nel corpo del `post`, dopo `brandName`: `characteristicValues: formData.characteristicValues,`.

In `apps/seller/src/routes/_authenticated/products/$productId.tsx`:
- nel corpo del `patch`, dopo `brandName`: `characteristicValues: formData.characteristicValues,` e `confirmAffected: formData.confirmAffected,`;
- in `onSuccess`, oltre alle invalidazioni esistenti, nessun cambiamento (`["product", productId]` è già invalidata);
- in `onError`, **prima** del toast: `void queryClient.invalidateQueries({ queryKey: ["product", productId] });` — dopo un `409` per conferma vecchia, `savedCharacteristicValues` arriva aggiornato e il prossimo dialog mostra il numero nuovo;
- su `<ProductForm>`: `savedCharacteristicValues={product.characteristicValues}`.

- [ ] **Step 4: Verificare**

Run: `bun run --cwd apps/seller typecheck; echo $?` → `0`.
Run: `bun run lint` → pulito.
Run: `bun run --cwd apps/seller build; echo $?` → `0`.
Run: `git status --short apps/seller/src/routeTree.gen.ts` → nessuna riga (nessuna route nuova).

- [ ] **Step 5: Commit**

```bash
git add apps/seller/src
git commit -m "feat(seller): caratteristiche nel form prodotto con conferma dei valori persi" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Collaudo nel browser

Non sostituisce lo smoke di Marco: serve a portarglielo senza difetti evidenti. Nessuna riga di codice, salvo le correzioni che il collaudo trova (ognuna con il suo commit, e il collaudo si ripete dal passo che ha fallito).

**Regole di questo task**, in aggiunta ai Global Constraints: si salvano solo prodotti con nome che inizia per `Collaudo PR4`; sui prodotti del seed si apre, si guarda e si **annulla**; nessun interruttore dell'admin si tocca. Le obbligatorie sono coperte dai test d'integrazione dei Task 4 e 5 e non si collaudano qui, perché accenderne una modificherebbe la matrice del seed.

- [ ] **Step 1: Preparare**

Con API (`:3000`) e seller (`:3002`) in esecuzione (se non lo sono, avviarli con `bun run dev` dalla radice), scegliere due sotto-categorie della **stessa** macro-categoria: la prima con tutti e quattro i tipi, la seconda con almeno una caratteristica in comune e almeno una no.

```bash
docker exec -i bibs-postgis psql -U pgadmin -d bibs-db <<'SQL'
SELECT m.name AS macro, pc.name AS sub,
       count(*) FILTER (WHERE c.data_type = 'boolean') AS bool,
       count(*) FILTER (WHERE c.data_type = 'number')  AS num,
       count(*) FILTER (WHERE c.data_type = 'enum')    AS enum,
       count(*) FILTER (WHERE c.data_type = 'text')    AS txt,
       bool_or(pcc.required) AS any_required
FROM product_category_characteristics pcc
JOIN product_characteristics c ON c.id = pcc.characteristic_id
JOIN product_categories pc ON pc.id = pcc.product_category_id
JOIN product_macro_categories m ON m.id = pc.macro_category_id
GROUP BY m.name, pc.name
HAVING count(*) FILTER (WHERE c.data_type = 'boolean') > 0
   AND count(*) FILTER (WHERE c.data_type = 'number') > 0
   AND count(*) FILTER (WHERE c.data_type = 'enum') > 0
ORDER BY m.name, pc.name
LIMIT 20;
SQL
```

Annotare le due sotto-categorie scelte (A e B) e quali caratteristiche hanno in comune. Poi i conteggi di partenza:

```bash
docker exec -i bibs-postgis psql -U pgadmin -d bibs-db -c "SELECT (SELECT count(*) FROM products) AS products, (SELECT count(*) FROM product_characteristic_values) AS values, (SELECT count(*) FROM product_category_characteristics) AS matrix;"
```

- [ ] **Step 2: Creazione**

Login come `seller@dev.bibs` / `password123`, *Prodotti → Nuovo*. Nome `Collaudo PR4 uno`, prezzo `9.99`, macro e sotto-categoria A. Verificare e riportare:

- la sezione compare chiusa, con «0 di N compilate» (N = numero di caratteristiche di A dalla query);
- aperta, l'ordine dei campi coincide con `SELECT c.name FROM product_category_characteristics pcc JOIN product_characteristics c ON c.id = pcc.characteristic_id WHERE pcc.product_category_id = '<A>' ORDER BY pcc.sort_order, c.name;`;
- geometria, con `getBoundingClientRect()`: larghezza del riquadro della sezione rispetto alla `FormSection` «Catalogo» che la contiene (atteso: uguale, al pixel); a 1280 px di viewport i campi stanno su due colonne (due `left` distinti fra i primi due campi);
- un sì/no: *Sì* acceso, poi un secondo click lo spegne (torna «non indicato»), poi *No*;
- un numero con l'unità in coda, un menu a tendina con «Non indicato» come prima voce, un testo.

Compilare un campo per tipo, salvare. Dal database:

```bash
docker exec -i bibs-postgis psql -U pgadmin -d bibs-db -c "SELECT c.name, v.data_type, v.value_text, v.value_number, v.value_boolean, o.value AS option FROM product_characteristic_values v JOIN product_characteristics c ON c.id = v.characteristic_id LEFT JOIN product_characteristic_options o ON o.id = v.option_id JOIN products p ON p.id = v.product_id WHERE p.name = 'Collaudo PR4 uno' ORDER BY c.name;"
```

Atteso: quattro righe, ciascuna con la sola colonna del suo tipo, *No* salvato come `false`.

- [ ] **Step 3: Modifica e riapertura**

Riaprire `Collaudo PR4 uno`: il riepilogo dice «4 di N compilate» e i quattro valori sono al loro posto. Cambiare il numero e svuotare il testo, salvare; nel database il numero è cambiato e la riga del testo non c'è più.

- [ ] **Step 4: Cambio di sotto-categoria**

Riaprire, scegliere la sotto-categoria B. Verificare:

- sopra la sezione compare subito l'avviso «Al salvataggio verranno eliminati …» con i nomi dei soli valori **non** previsti da B;
- tornando ad A l'avviso sparisce e i valori sono ancora lì; di nuovo B;
- *Salva* apre il dialog con gli stessi nomi; **Annulla** → nessuna richiesta partita (controllare la rete) e nel database i valori sono intatti;
- *Salva* → **Salva ed elimina** → nel database restano solo i valori delle caratteristiche in comune fra A e B, e il prodotto è in B.

Poi il cambio di macro-categoria: riaprire, cambiare macro (la sotto-categoria si azzera), salvare → dialog con tutti i valori rimasti; confermare → zero valori.

- [ ] **Step 5: Il seed si guarda e basta**

Aprire un prodotto del seed che ha valori (`SELECT p.id, p.name FROM products p WHERE EXISTS (SELECT 1 FROM product_characteristic_values v WHERE v.product_id = p.id) LIMIT 1;`): la sezione mostra i valori salvati. Cambiare sotto-categoria, premere *Salva*, e al dialog premere **Annulla**; poi *Annulla* del form. Nessun salvataggio.

- [ ] **Step 6: Pulizia e conteggi finali**

Spostare `Collaudo PR4 uno` nel cestino e cancellarlo definitivamente dall'interfaccia. Ripetere la query dei conteggi dello Step 1: **i tre numeri devono coincidere** con quelli di partenza. Riportare prima e dopo, e ogni scostamento dal comportamento atteso.

---

## Chiusura della PR

- [ ] `bun run lint` (Biome) — pulito.
- [ ] Typecheck workspace per workspace — `apps/api`, `apps/seller`, `apps/admin`, `apps/customer`, `packages/ui` — ciascuno con `$?` a 0.
- [ ] `bun run --cwd apps/api test` — `0 fail`, totali = baseline + 17 unitari e + 26 d'integrazione. Poi `bun run test` dalla radice (emails, api, customer).
- [ ] `bun run --cwd apps/api build` e `bun run --cwd apps/seller build` — riusciti.
- [ ] `bun run db:generate` — «No schema changes».
- [ ] Con l'API in esecuzione, `curl -s localhost:3000/openapi/json | jq '.paths | keys[] | select(test("seller/product"))'` elenca `/seller/product-categories/{productCategoryId}/characteristics`, con `description` in italiano.
- [ ] `git diff main...HEAD --stat`: nessun file fuori dalla sezione «Struttura dei file» (più questo piano); `routeTree.gen.ts` non compare.
- [ ] Revisione finale dell'intero branch (subagente), prima dello smoke.
- [ ] **Smoke di Marco nel browser** prima di aprire la PR: su UI il gate è «Marco l'ha provata», non «i test sono verdi». Da segnalargli in particolare: P5 (sì/no a due voci invece della casella) e che le obbligatorie si provano accendendone una dall'admin su una sotto-categoria di prova.
- [ ] Aprire la PR verso `main` citando spec e piano, con fuori ambito dichiarato (caratteristiche nel CSV massivo, scheda customer, filtri), chiudendo con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] Dopo il merge: `git fetch --prune` e cancellare i branch locali `[gone]`.
