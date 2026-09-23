# Dizionario e matrice delle caratteristiche — piano di implementazione (PR 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portare nel database il dizionario tipizzato delle caratteristiche di prodotto e la matrice che dice quali si applicano a quale sotto-categoria, con i due import CSV che le alimentano.

**Architecture:** Quattro tabelle nuove — dizionario, opzioni delle liste chiuse, matrice, valori del prodotto — più due endpoint di import ricalcati su quelli già esistenti per le categorie. I dati partono da due file CSV committati accanto a quelli del seed: uno redatto a mano in questa PR, l'altro trasposto dal foglio `Mapping`. Nessuna interfaccia: l'admin arriva nella PR 3, il form seller nella PR 4, la scheda customer nella PR 5.

**Tech Stack:** Bun, Elysia, Drizzle ORM, PostgreSQL 18 + PostGIS, TypeBox, `bun:test` con testcontainers.

**Spec:** [`docs/superpowers/specs/2026-09-22-caratteristiche-prodotto-design.md`](../specs/2026-09-22-caratteristiche-prodotto-design.md) — sezioni «Modello dati», «Dizionario tipizzato» e «Import». Questo piano copre la **PR 2** delle cinque. La PR 1 (prodotto a sotto-categoria unica) è merged in `43c35da`.

## Global Constraints

- **Nessun commit diretto su `main`.** Branch `feat/product-characteristics-dictionary`, già creato da `main` a `43c35da`.
- **Conventional Commits** con scope dalla lista del repo: qui `db`, `api`, `products`, `categories`. Descrizione minuscola, imperativa, **prima riga sotto i 72 caratteri — misurala, non fidarti del testo prescritto qui sotto**: un oggetto di questo piano era gia' di 78.
- **Ogni commit chiude con** `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Mai `db:push`**: sempre `bun run db:generate`, **leggere l'SQL generato**, poi `bun run db:migrate`.
- **Mai `--no-verify`**. Mai `bun run db:reset` o `infra:reset` senza conferma esplicita dell'utente.
- **Biome**: rientri a tabulazione, virgolette doppie, file in kebab-case.
- **Enumerati**: `text({ enum })` più `CHECK`, mai `pgEnum`.
- **`ServiceError` accetta solo `(status, message)`.**
- **Copy in italiano** su ogni superficie utente e in ogni `description` OpenAPI. **Nomi dei test in inglese**, come tutti i loro fratelli.
- **Typecheck workspace per workspace**, mai la forma aggregata `--filter '*'`, che può inghiottire il fallimento di un singolo workspace.
- I nomi delle caratteristiche e delle opzioni vivono nel database e restano **solo in italiano**, come i nomi di categoria.
- psql: `docker exec -i bibs-postgis psql -U pgadmin -d bibs-db` — il `-i` è obbligatorio, senza scarta l'SQL in silenzio con codice 0.
- Migrazioni in `apps/api/src/db/migrations/`.
- **Test negativi sui vincoli del database**: `expect(query).rejects.toThrow()` su un query-builder Drizzle **non funziona** — il thenable non arriva a `expect().rejects`. La convenzione del repo, documentata in `apps/api/tests/integration/db-enum-check-constraints.test.ts:57-68`, è avvolgere l'insert in una funzione asincrona: `await expect(insertBogus()).rejects.toThrow()`.
- **Suite completa**: sempre `bun run --cwd apps/api test`, mai `cd apps/api && bun test` nudo. Senza argomenti Bun salta `--isolate`, e il repo ha una guardia apposta — `tests/integration/isolation-guard-2.test.ts` — che fallisce proprio in quel caso. Un rosso lì non è una regressione, è l'invocazione sbagliata.
- **Esecuzione di un singolo file di test**: `bun run --cwd apps/api test <file>` **non isola nulla** — lo script `test` è composto (`test:unit && test:integration`) e Bun passa l'argomento solo all'ultimo comando. Per il file singolo: `cd apps/api && bun test <percorso>`.
- **Baseline suite:** 511 pass / 0 fail / 1167 expect su 64 file in `apps/api` (dopo il Task 1). Una esecuzione troncata stampa comunque `0 fail` con un totale più basso: il numero che conta è il **totale**, non i fallimenti.

---

## Struttura dei file

| File | Responsabilità |
|---|---|
| `apps/api/src/db/schemas/product-characteristic.ts` | le 4 tabelle nuove e le loro relazioni |
| `apps/api/src/db/schemas/index.ts` | re-export |
| `apps/api/src/db/schemas/product.ts` | relazione `characteristicValues` su `product` |
| `apps/api/src/db/schemas/category.ts` | relazione `characteristics` su `productCategory` |
| `apps/api/src/db/migrations/*.sql` | una migrazione: quattro `CREATE TABLE` |
| `apps/api/src/db/seed/data/product_characteristics.csv` | il dizionario tipizzato |
| `apps/api/src/db/seed/data/product_category_characteristics.csv` | la matrice |
| `docs/products/caratteristiche-nota-di-revisione.md` | le scelte non ovvie, per la revisione di Marco |
| `apps/api/src/modules/admin/services/characteristic-import.ts` | i due import |
| `apps/api/src/modules/admin/routes/characteristic-imports.ts` | i due endpoint |
| `apps/api/src/db/seed/base/characteristics.ts` | seed di dizionario e matrice |
| `apps/api/src/db/seed/fixtures/characteristic-values.ts` | valori sui prodotti finti |
| `apps/api/tests/integration/admin-characteristic-import.test.ts` | test degli import |

---

### Task 1: Le quattro tabelle

**Files:**
- Create: `apps/api/src/db/schemas/product-characteristic.ts`
- Modify: `apps/api/src/db/schemas/index.ts`, `apps/api/src/db/schemas/product.ts`, `apps/api/src/db/schemas/category.ts`
- Create: `apps/api/src/db/migrations/<generata>.sql`
- Test: `apps/api/tests/integration/product-characteristics-schema.test.ts`

**Interfaces:**
- Consumes: `productCategory` (`db/schemas/category.ts`), `product` (`db/schemas/product.ts`).
- Produces: `productCharacteristic`, `productCharacteristicOption`, `productCategoryCharacteristic`, `productCharacteristicValue`; il tipo `CharacteristicDataType = "text" | "number" | "boolean" | "enum"` e la costante `CHARACTERISTIC_DATA_TYPES`.

- [ ] **Step 1: Scrivere i test che falliscono**

Creare il file con l'intestazione di harness copiata da `apps/api/tests/integration/admin-product-categories.test.ts` (import `bun:test`, `mock.module("@/db", …)` con il Proxy su `getTestDb()` **prima** degli import del codice sotto test, `setupTestContainer`/`teardownTestContainer`, `truncateAll` in `beforeEach`).

I vincoli del database sono il cuore di questo task, quindi i test li mettono alla prova direttamente:

```ts
it("rejects a value whose column does not match its data type", async () => {
	const db = getTestDb();
	const [c] = await db
		.insert(productCharacteristic)
		.values({ name: "Peso", dataType: "number", unit: "g" })
		.returning();
	const seller = await createTestSeller(db);
	const p = await createTestProduct(db, seller.profile.id, { name: "P" });

	// numero dichiarato, ma valorizzata la colonna di testo
	const bad = db.insert(productCharacteristicValue).values({
		productId: p.id,
		characteristicId: c.id,
		dataType: "number",
		valueText: "pesante",
	});

	expect(bad).rejects.toThrow();
});

it("rejects a value whose data type diverges from the dictionary", async () => {
	const db = getTestDb();
	const [c] = await db
		.insert(productCharacteristic)
		.values({ name: "5G", dataType: "boolean" })
		.returning();
	const seller = await createTestSeller(db);
	const p = await createTestProduct(db, seller.profile.id, { name: "P" });

	// la copia denormalizzata mente sul tipo: la chiave esterna composta deve rifiutare
	const bad = db.insert(productCharacteristicValue).values({
		productId: p.id,
		characteristicId: c.id,
		dataType: "text",
		valueText: "sì",
	});

	expect(bad).rejects.toThrow();
});

it("rejects a unit on a characteristic that is not a number", async () => {
	const db = getTestDb();
	const bad = db
		.insert(productCharacteristic)
		.values({ name: "Colore", dataType: "enum", unit: "g" });

	expect(bad).rejects.toThrow();
});

it("accepts a well-formed number value", async () => {
	const db = getTestDb();
	const [c] = await db
		.insert(productCharacteristic)
		.values({ name: "Peso", dataType: "number", unit: "g" })
		.returning();
	const seller = await createTestSeller(db);
	const p = await createTestProduct(db, seller.profile.id, { name: "P" });

	const [v] = await db
		.insert(productCharacteristicValue)
		.values({
			productId: p.id,
			characteristicId: c.id,
			dataType: "number",
			valueNumber: "1250.0000",
		})
		.returning();

	expect(v.valueNumber).toBe("1250.0000");
});
```

- [ ] **Step 2: Eseguirli e verificare che falliscano**

```bash
cd apps/api && bun test tests/integration/product-characteristics-schema.test.ts
```

Atteso: FAIL di compilazione — le tabelle non esistono ancora.

- [ ] **Step 3: Scrivere lo schema**

In `apps/api/src/db/schemas/product-characteristic.ts`:

```ts
import { relations, sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	numeric,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";
import { productCategory } from "./category";
import { product } from "./product";

export const CHARACTERISTIC_DATA_TYPES = [
	"text",
	"number",
	"boolean",
	"enum",
] as const;
export type CharacteristicDataType = (typeof CHARACTERISTIC_DATA_TYPES)[number];

export const productCharacteristic = pgTable(
	"product_characteristics",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: text("name").notNull().unique(),
		dataType: text("data_type", { enum: CHARACTERISTIC_DATA_TYPES }).notNull(),
		unit: text("unit"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		check(
			"product_characteristic_data_type_valid",
			sql`${table.dataType} IN ('text','number','boolean','enum')`,
		),
		// L'unità ha senso solo per un numero.
		check(
			"product_characteristic_unit_only_for_number",
			sql`${table.unit} IS NULL OR ${table.dataType} = 'number'`,
		),
		// Bersaglio della chiave esterna composta dei valori: impedisce alla copia
		// denormalizzata di `data_type` di divergere dall'originale.
		unique("product_characteristic_id_data_type_unique").on(
			table.id,
			table.dataType,
		),
	],
);

export const productCharacteristicOption = pgTable(
	"product_characteristic_options",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		characteristicId: text("characteristic_id")
			.notNull()
			.references(() => productCharacteristic.id, { onDelete: "cascade" }),
		value: text("value").notNull(),
		sortOrder: integer("sort_order").notNull(),
	},
	(table) => [
		unique("product_characteristic_option_value_unique").on(
			table.characteristicId,
			table.value,
		),
	],
);

export const productCategoryCharacteristic = pgTable(
	"product_category_characteristics",
	{
		productCategoryId: text("product_category_id")
			.notNull()
			.references(() => productCategory.id, { onDelete: "cascade" }),
		characteristicId: text("characteristic_id")
			.notNull()
			.references(() => productCharacteristic.id, { onDelete: "cascade" }),
		required: boolean("required").default(false).notNull(),
		sortOrder: integer("sort_order").notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.productCategoryId, table.characteristicId],
		}),
		// La chiave primaria ha product_category_id come prefisso sinistro: senza
		// questo, «quali categorie usano questa caratteristica» va in seq scan.
		index("product_category_characteristic_characteristic_id_idx").on(
			table.characteristicId,
		),
	],
);

export const productCharacteristicValue = pgTable(
	"product_characteristic_values",
	{
		productId: text("product_id")
			.notNull()
			.references(() => product.id, { onDelete: "cascade" }),
		characteristicId: text("characteristic_id").notNull(),
		dataType: text("data_type", { enum: CHARACTERISTIC_DATA_TYPES }).notNull(),
		valueText: text("value_text"),
		valueNumber: numeric("value_number", { precision: 14, scale: 4 }),
		valueBoolean: boolean("value_boolean"),
		optionId: text("option_id").references(
			() => productCharacteristicOption.id,
			{ onDelete: "restrict" },
		),
	},
	(table) => [
		primaryKey({ columns: [table.productId, table.characteristicId] }),
		index("product_characteristic_value_characteristic_id_idx").on(
			table.characteristicId,
		),
		// Esattamente la colonna del tipo dichiarato, e solo quella.
		check(
			"product_characteristic_value_matches_data_type",
			sql`(
				CASE WHEN ${table.valueText} IS NOT NULL THEN 1 ELSE 0 END +
				CASE WHEN ${table.valueNumber} IS NOT NULL THEN 1 ELSE 0 END +
				CASE WHEN ${table.valueBoolean} IS NOT NULL THEN 1 ELSE 0 END +
				CASE WHEN ${table.optionId} IS NOT NULL THEN 1 ELSE 0 END
			) = 1 AND (
				(${table.dataType} = 'text' AND ${table.valueText} IS NOT NULL) OR
				(${table.dataType} = 'number' AND ${table.valueNumber} IS NOT NULL) OR
				(${table.dataType} = 'boolean' AND ${table.valueBoolean} IS NOT NULL) OR
				(${table.dataType} = 'enum' AND ${table.optionId} IS NOT NULL)
			)`,
		),
	],
);
```

La chiave esterna composta `(characteristic_id, data_type)` **non è esprimibile nel DSL di Drizzle**: va aggiunta a mano nella migrazione allo Step 5.

Relazioni, nello stesso file:

```ts
export const productCharacteristicRelations = relations(
	productCharacteristic,
	({ many }) => ({
		options: many(productCharacteristicOption),
		categories: many(productCategoryCharacteristic),
	}),
);

export const productCharacteristicOptionRelations = relations(
	productCharacteristicOption,
	({ one }) => ({
		characteristic: one(productCharacteristic, {
			fields: [productCharacteristicOption.characteristicId],
			references: [productCharacteristic.id],
		}),
	}),
);

export const productCategoryCharacteristicRelations = relations(
	productCategoryCharacteristic,
	({ one }) => ({
		category: one(productCategory, {
			fields: [productCategoryCharacteristic.productCategoryId],
			references: [productCategory.id],
		}),
		characteristic: one(productCharacteristic, {
			fields: [productCategoryCharacteristic.characteristicId],
			references: [productCharacteristic.id],
		}),
	}),
);

export const productCharacteristicValueRelations = relations(
	productCharacteristicValue,
	({ one }) => ({
		product: one(product, {
			fields: [productCharacteristicValue.productId],
			references: [product.id],
		}),
		characteristic: one(productCharacteristic, {
			fields: [productCharacteristicValue.characteristicId],
			references: [productCharacteristic.id],
		}),
		option: one(productCharacteristicOption, {
			fields: [productCharacteristicValue.optionId],
			references: [productCharacteristicOption.id],
		}),
	}),
);
```

Poi il re-export in `apps/api/src/db/schemas/index.ts`, seguendo la forma già usata dagli altri file; la relazione `characteristicValues: many(productCharacteristicValue)` dentro `productRelations` in `product.ts`; e `characteristics: many(productCategoryCharacteristic)` dentro `productCategoryRelations` in `category.ts`.

- [ ] **Step 4: Generare la migrazione e leggerla**

```bash
bun run db:generate
```

Aprire il file generato: deve contenere quattro `CREATE TABLE`, i loro indici e i `CHECK`. **Non** contiene la chiave esterna composta.

- [ ] **Step 5: Aggiungere a mano la chiave esterna composta**

In coda al file generato:

```sql
--> statement-breakpoint
ALTER TABLE "product_characteristic_values"
	ADD CONSTRAINT "product_characteristic_value_characteristic_data_type_fk"
	FOREIGN KEY ("characteristic_id","data_type")
	REFERENCES "public"."product_characteristics"("id","data_type")
	ON DELETE restrict ON UPDATE no action;
```

È questa a rendere impossibile che la copia di `data_type` sul valore diverga dal dizionario, e a far rifiutare dal database il cambio di tipo di una caratteristica che ha già valori.

- [ ] **Step 6: Applicare ed eseguire i test**

```bash
bun run db:migrate
cd apps/api && bun test tests/integration/product-characteristics-schema.test.ts
```

Atteso: PASS tutti e quattro. Se il secondo test passa senza la chiave esterna composta, quella non è stata aggiunta: verificare con
`docker exec -i bibs-postgis psql -U pgadmin -d bibs-db -c "\d product_characteristic_values"`.

- [ ] **Step 7: Verifica e commit**

```bash
bun run lint
bun run --cwd apps/api typecheck
bun run --cwd apps/api test
bun run db:generate   # atteso: "No schema changes"
```

```bash
git add apps/api/src/db apps/api/tests/integration/product-characteristics-schema.test.ts
git commit -m "$(cat <<'EOF'
feat(db): aggiungi le quattro tabelle delle caratteristiche

I vincoli portano il peso: CHECK sul tipo di valore e chiave esterna
composta perche' la copia di data_type non possa divergere.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: I due CSV e la nota di revisione

**Files:**
- Create: `apps/api/src/db/seed/data/product_characteristics.csv`
- Create: `apps/api/src/db/seed/data/product_category_characteristics.csv`
- Create: `docs/products/caratteristiche-nota-di-revisione.md`
- Create: `apps/api/src/db/seed/data/validate-characteristics.ts` (script di validazione, usa-e-getta ma committato)

**Interfaces:**
- Consumes: `apps/api/src/db/seed/data/product_categories.csv` (179 coppie, invariato).
- Produces: i due CSV che il Task 3, il Task 4 e il Task 5 importano.

Questo task **non scrive codice applicativo**: è lavoro di dominio. La fonte è il foglio `Mapping` (1952 righe `macro, sotto, caratteristica, Sì`), che vive fuori dal repo; il suo contenuto è già stato estratto e i conteggi attesi sono fissati sotto.

- [ ] **Step 1: Il dizionario**

`product_characteristics.csv`, intestazione `name,data_type,unit,options`. Le opzioni sono separate da `|` nella stessa cella; `unit` è valorizzata **solo** per `data_type=number`.

Regole di classificazione, in ordine di precedenza:

1. **`boolean`** — la caratteristica è una proprietà che un prodotto ha o non ha, e il nome è già un predicato: `5G`, `Dual SIM`, `Smart TV`, `Fronte-retro`, `Scanner integrato`, `Alimentatore automatico`, `Wireless`, `Retroilluminazione`, `Dimmerabile`, `Impermeabile`, `Waterproof`, `No Frost`, `Montaggio richiesto`, `Reclinabile`, `Runflat`, `Termometro`, `Batterie richieste`, `Autofocus`, `Stabilizzazione`, `Microfono integrato`, `GPS`, `Ricarica rapida`, `Indicatore carica`, `HDR`, `VESA`.
2. **`number`** — è una grandezza misurabile e la domanda «quanto?» ha una risposta numerica con un'unità sola. Sempre con `unit`, tranne i conteggi interi (`Numero porte`, `Numero pezzi`, `Numero bruciatori`, `Numero giocatori`, `Numero velocità`, `Numero tasti`, `Numero ripiani/cassetti`), che restano senza. Esempi con unità: `Peso` g, `Larghezza`/`Altezza`/`Profondità` cm, `Potenza` W, `Capacità batteria` mAh, `Dimensione display`/`Dimensione schermo` pollici, `Rumorosità` dB, `Autonomia` h, `Flusso luminoso` lm, `Temperatura colore` K, `Consumo annuo` kWh, `Impedenza` Ω, `Altezza tacco` cm, `Lunghezza focale` mm, `Diametro filtro` mm, `Tempo asciugatura` h, `Resa` m², `Volume` l.
3. **`enum`** — i valori possibili sono pochi, noti e stabili nel dominio italiano del retail: `Genere`, `Stagione`, `Classe energetica`, `Grado IP`, `Tipo chiusura`, `Vestibilità`, `Livello utilizzo`, `Tipo freni`, `Tipo storage`, `Finish`, `Tonalità` e simili.
4. **`text`** — tutto il resto, e in particolare ciò che è prosa: `Modello`, `Ingredienti`, `Ingredienti principali`, `Avvertenze`, `Valori nutrizionali`, `Composizione`, `Paese di origine`, `Conservazione`, `Compatibilità` e le sue varianti.

Due regole che valgono più delle quattro famiglie:

- **`Marca` esce dal dizionario.** Esiste già come `products.brandId` con la sua tabella. Non compare né nel dizionario né nella matrice.
- **Una voce si sdoppia quando cambia la lista dei valori ammessi, non quando compare sotto macro diverse.** `Sistema operativo` sta in Elettronica e in Abbigliamento solo perché ci sono gli smartwatch, e vuol dire la stessa cosa: resta una voce sola. Lo sdoppiamento obbligatorio, già analizzato, è **`Taglia`** (17 sotto-categorie, cinque sistemi incompatibili):

| Nuova voce | Sotto-categorie | Valori |
|---|---|---|
| `Taglia abbigliamento` | Abbigliamento uomo, Abbigliamento donna, Abbigliamento bambino, Intimo, Pigiami, Costumi da bagno | XS, S, M, L, XL, XXL, XXXL |
| `Taglia calzature` | Scarpe uomo, Scarpe donna, Sneakers | 35–48 |
| `Taglia bagagli` | Borse, Zaini, Valigie | Piccola, Media, Grande |
| `Taglia accessori` | Cinture, Cappelli, Gioielli | testo libero (misure eterogenee) |
| `Taglia pannolini` | Pannolini | 1, 2, 3, 4, 5, 6 |

`Taglia/Misura` (9 sotto-categorie sportive) è già una voce distinta nel foglio e resta tale.

Valutare, e **motivare nella nota qualunque sia la scelta**, questi quattro casi limite: `Materiale` (su tutte e 179, quindi una lista chiusa unica sarebbe enorme o inutile) e i tre generici `Tipologia` (66), `Uso previsto` (60) e `Compatibilità` (75), che attraversano domini troppo lontani.

- [ ] **Step 2: La matrice**

`product_category_characteristics.csv`, intestazione `macro_category,subcategory,characteristic,required`.

È il foglio `Mapping` con due trasformazioni: le 179 righe di `Marca` spariscono, e ogni riga che citava una voce sdoppiata cita adesso la voce giusta per quella sotto-categoria.

**`required` vale `false` su ogni riga.** La colonna esiste e l'import la legge, ma l'obbligatorietà si accende dall'admin quando serve — imporre dieci campi a chi carica un catalogo è il modo più rapido per far abbandonare l'inserimento.

**Conteggio atteso: 1773 righe di dati** (1952 − 179 di `Marca`). Uno sdoppiamento non cambia il totale: ridistribuisce le righe fra le nuove voci.

- [ ] **Step 3: Lo script di validazione**

`validate-characteristics.ts`, eseguibile con `bun run apps/api/src/db/seed/data/validate-characteristics.ts`. Non tocca il database: legge i tre CSV e verifica, stampando un rapporto e uscendo con 1 al primo errore:

1. il dizionario non ha nomi duplicati;
2. ogni riga `enum` ha almeno due opzioni; nessuna riga non-`enum` ha opzioni;
3. ogni riga `number` può avere un'unità; nessuna riga di altro tipo ce l'ha;
4. ogni `characteristic` della matrice esiste nel dizionario, confronto esatto;
5. ogni coppia `(macro_category, subcategory)` della matrice esiste in `product_categories.csv`;
6. la matrice ha **1773** righe di dati;
7. `required` è `false` ovunque;
8. nessuna riga della matrice cita `Marca`;
9. un istogramma delle caratteristiche per sotto-categoria, con minimo, massimo e mediana, e un istogramma dei quattro tipi.

L'istogramma non è decorazione: serve a vedere a colpo d'occhio se una regola di classificazione ha collassato troppe voci in una famiglia sola.

- [ ] **Step 4: Eseguire la validazione**

```bash
bun run apps/api/src/db/seed/data/validate-characteristics.ts
```

Atteso: uscita 0, 1773 righe, la mediana delle caratteristiche per sotto-categoria intorno a 10, e nessuna famiglia che da sola supera la metà del dizionario. Se una di queste non torna, **fermarsi e riferire**: è un difetto della classificazione, non dello script.

- [ ] **Step 5: La nota di revisione**

`docs/products/caratteristiche-nota-di-revisione.md`. Non è un elenco delle voci — quello è il CSV. Contiene **solo ciò su cui un lettore potrebbe non essere d'accordo**, in sezioni:

1. **Sdoppiamenti** — ciascuno con le sotto-categorie coinvolte e i valori, incluso `Taglia`.
2. **Liste di valori inventate** — ogni `enum` la cui lista non viene dal foglio ma dal dominio: il valore proposto e perché quella granularità. `Colore` e `Materiale` per primi.
3. **I quattro casi limite** dello Step 1, con la scelta fatta e la motivazione.
4. **Applicabilità sospette** — le righe che il foglio marca ma che sembrano prive di senso: `Colore`, `Materiale` e `Peso` su *Pasta* e *Riso*; le sotto-categorie che hanno solo le universali più il terzetto generico. **Non vanno corrette nel CSV**: elencarle e basta, la decisione è di Marco.
5. **Unità scelte** dove ce n'era più d'una plausibile (grammi contro chili, cm contro mm).

Ogni sezione dice cosa cambiare e dove, se la risposta è «no».

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/seed/data docs/products/caratteristiche-nota-di-revisione.md
git commit -m "$(cat <<'EOF'
feat(products): redigi dizionario e matrice delle caratteristiche

1773 righe di matrice, Marca esclusa perche' e' gia' products.brandId,
Taglia sdoppiata nei suoi cinque sistemi di valori.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Import del dizionario

**Files:**
- Create: `apps/api/src/modules/admin/services/characteristic-import.ts`
- Create: `apps/api/src/modules/admin/routes/characteristic-imports.ts`
- Modify: `apps/api/src/modules/admin/index.ts:37` — montare accanto a `categoryImportsRoutes`
- Test: `apps/api/tests/integration/admin-characteristic-import.test.ts`

**Interfaces:**
- Consumes: le tabelle del Task 1; `parseCsv` da `@/lib/utils/csv`; `CsvImportResultSchema`, `okRes`, `withConflictErrors` da `@/lib/schemas`.
- Produces: `importCharacteristicsFromCsv(csvText): Promise<CategoryImportResult>` e `POST /admin/product-characteristics/import`.

L'import del dizionario è **in aggiornamento**: una riga il cui `name` esiste già aggiorna tipo, unità e opzioni, invece di essere saltata. Correggere un errore di tipizzazione deve poter passare dal CSV.

- [ ] **Step 1: Scrivere i test che falliscono**

Ricalcare l'intestazione di harness da `admin-category-import.test.ts`. I casi:

```ts
it("creates characteristics with their options", async () => {
	const csv = [
		"name,data_type,unit,options",
		"Colore,enum,,Rosso|Blu|Verde",
		"Peso,number,g,",
		"5G,boolean,,",
		"Modello,text,,",
	].join("\n");

	const result = await importCharacteristicsFromCsv(csv);

	expect(result.created).toBe(4);
	expect(result.failed).toBe(0);
	const rows = await getTestDb().select().from(productCharacteristic);
	expect(rows).toHaveLength(4);
	const colore = rows.find((r) => r.name === "Colore");
	const opts = await getTestDb()
		.select()
		.from(productCharacteristicOption)
		.where(eq(productCharacteristicOption.characteristicId, colore!.id));
	expect(opts.map((o) => o.value).sort()).toEqual(["Blu", "Rosso", "Verde"]);
});

it("updates an existing characteristic instead of skipping it", async () => {
	await importCharacteristicsFromCsv(
		["name,data_type,unit,options", "Peso,number,kg,"].join("\n"),
	);

	const result = await importCharacteristicsFromCsv(
		["name,data_type,unit,options", "Peso,number,g,"].join("\n"),
	);

	expect(result.created).toBe(0);
	const [row] = await getTestDb().select().from(productCharacteristic);
	expect(row.unit).toBe("g");
});

it("replaces the option list on update", async () => {
	await importCharacteristicsFromCsv(
		["name,data_type,unit,options", "Colore,enum,,Rosso|Blu"].join("\n"),
	);

	await importCharacteristicsFromCsv(
		["name,data_type,unit,options", "Colore,enum,,Rosso|Verde"].join("\n"),
	);

	const opts = await getTestDb().select().from(productCharacteristicOption);
	expect(opts.map((o) => o.value).sort()).toEqual(["Rosso", "Verde"]);
});

it("refuses a type change on a characteristic that already has values", async () => {
	const db = getTestDb();
	await importCharacteristicsFromCsv(
		["name,data_type,unit,options", "Peso,text,,"].join("\n"),
	);
	const [c] = await db.select().from(productCharacteristic);
	const seller = await createTestSeller(db);
	const p = await createTestProduct(db, seller.profile.id, { name: "P" });
	await db.insert(productCharacteristicValue).values({
		productId: p.id,
		characteristicId: c.id,
		dataType: "text",
		valueText: "pesante",
	});

	const result = await importCharacteristicsFromCsv(
		["name,data_type,unit,options", "Peso,number,g,"].join("\n"),
	);

	expect(result.failed).toBe(1);
	expect(result.errors[0].message).toContain("Peso");
	expect(result.errors[0].message).toContain("1");
	const [after] = await db.select().from(productCharacteristic);
	expect(after.dataType).toBe("text");
});

it("reports the row number of an invalid data type", async () => {
	const csv = [
		"name,data_type,unit,options",
		"Colore,enum,,Rosso|Blu",
		"Peso,quantita,,",
	].join("\n");

	const result = await importCharacteristicsFromCsv(csv);

	expect(result.created).toBe(1);
	expect(result.failed).toBe(1);
	expect(result.errors[0].row).toBe(3);
});

it("rejects an enum row with no options", async () => {
	const result = await importCharacteristicsFromCsv(
		["name,data_type,unit,options", "Colore,enum,,"].join("\n"),
	);

	expect(result.created).toBe(0);
	expect(result.failed).toBe(1);
});
```

Il numero di riga è 1-indicizzato più l'intestazione, come in `category-import.ts`.

- [ ] **Step 2: Eseguirli e verificare che falliscano**

```bash
cd apps/api && bun test tests/integration/admin-characteristic-import.test.ts
```

Atteso: FAIL di compilazione — `importCharacteristicsFromCsv` non esiste.

- [ ] **Step 3: Implementare il service**

Ricalcare la forma di `apps/api/src/modules/admin/services/category-import.ts`: `assertHeaders`, accumulo degli errori con il numero di riga, una sola transazione in coda. Le intestazioni attese sono `["name", "data_type", "unit", "options"]`.

Regole, oltre a quelle dei test:

- `data_type` fuori da `text|number|boolean|enum` → errore di riga, la riga non entra;
- `unit` valorizzata con `data_type` diverso da `number` → errore di riga;
- `options` valorizzate con `data_type` diverso da `enum` → errore di riga;
- `enum` senza opzioni → errore di riga;
- il cambio di `data_type` su una caratteristica esistente si controlla **prima** di tentare l'`UPDATE`, contando i valori: se ce ne sono, errore di riga con nome e conteggio e la riga non entra. Il database lo rifiuterebbe comunque con la chiave esterna composta, ma un vincolo che scatta dà un messaggio inutilizzabile;
- in aggiornamento, le opzioni si sostituiscono per intero: `DELETE` di quelle esistenti e `INSERT` delle nuove, dentro la stessa transazione. Un'opzione ancora referenziata da un valore fa fallire il `DELETE` per via del `RESTRICT`: intercettarlo e trasformarlo in errore di riga con il conteggio.
- `sortOrder` delle opzioni segue l'ordine nella cella.

- [ ] **Step 4: Eseguire i test**

```bash
cd apps/api && bun test tests/integration/admin-characteristic-import.test.ts
```

Atteso: PASS.

- [ ] **Step 5: La rotta**

In `characteristic-imports.ts`, ricalcando `apps/api/src/modules/admin/routes/category-imports.ts`: corpo `t.Object({ file: t.File({ description: "…" }) })`, risposta `withConflictErrors({ 200: okRes(CsvImportResultSchema) })`, `detail.description` in italiano che elenca le colonne attese e dice che l'import aggiorna le voci già presenti. Log strutturato con `adminId` e i conteggi, come fa la rotta delle categorie.

Montarla in `apps/api/src/modules/admin/index.ts`, accanto a `categoryImportsRoutes` (riga 37).

- [ ] **Step 6: Verifica e commit**

```bash
bun run lint
bun run --cwd apps/api typecheck
bun run --cwd apps/api test
```

```bash
git add apps/api/src/modules/admin apps/api/tests/integration/admin-characteristic-import.test.ts
git commit -m "$(cat <<'EOF'
feat(api): import CSV del dizionario delle caratteristiche

In aggiornamento, non additivo: correggere una tipizzazione deve poter
passare dal CSV. Il cambio di tipo su voci con valori e' rifiutato.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Import della matrice

**Files:**
- Modify: `apps/api/src/modules/admin/services/characteristic-import.ts`, `apps/api/src/modules/admin/routes/characteristic-imports.ts`
- Modify: `apps/api/src/lib/schemas/` — il file che definisce `CsvImportResultSchema`
- Test: `apps/api/tests/integration/admin-characteristic-import.test.ts`

**Interfaces:**
- Consumes: il dizionario importato dal Task 3.
- Produces: `importCategoryCharacteristicsFromCsv(csvText)`, che restituisce `CategoryImportResult` più `missing: Array<{ subcategory: string; characteristics: string[] }>`; e `POST /admin/product-category-characteristics/import`.

L'import della matrice è **solo additivo**: non cancella mai. In cambio riporta le righe presenti nel database e assenti dal file, raggruppate per sotto-categoria — il confronto si calcola comunque per decidere cosa inserire, quindi riportarlo non costa nulla. È la scelta della spec (D6): l'additivo non sa cancellare, il sostitutivo calpesta i ritocchi fatti a mano, e la divergenza va **segnalata**, non risolta cancellando.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
it("links characteristics to a sub-category", async () => {
	const db = getTestDb();
	const macro = await createTestMacroCategory(db, "Elettronica");
	await createTestCategory(db, "Smartphone", macro.id);
	await importCharacteristicsFromCsv(
		["name,data_type,unit,options", "Peso,number,g,", "5G,boolean,,"].join("\n"),
	);

	const result = await importCategoryCharacteristicsFromCsv(
		[
			"macro_category,subcategory,characteristic,required",
			"Elettronica,Smartphone,Peso,false",
			"Elettronica,Smartphone,5G,false",
		].join("\n"),
	);

	expect(result.created).toBe(2);
	const rows = await db.select().from(productCategoryCharacteristic);
	expect(rows).toHaveLength(2);
	expect(rows.every((r) => r.required === false)).toBe(true);
});

it("is idempotent: a second import creates nothing", async () => {
	const db = getTestDb();
	const macro = await createTestMacroCategory(db, "Elettronica");
	await createTestCategory(db, "Smartphone", macro.id);
	await importCharacteristicsFromCsv(
		["name,data_type,unit,options", "Peso,number,g,"].join("\n"),
	);
	const csv = [
		"macro_category,subcategory,characteristic,required",
		"Elettronica,Smartphone,Peso,false",
	].join("\n");
	await importCategoryCharacteristicsFromCsv(csv);

	const result = await importCategoryCharacteristicsFromCsv(csv);

	expect(result.created).toBe(0);
	expect(result.skipped).toBe(1);
});

it("never deletes, and reports what the file does not contain", async () => {
	const db = getTestDb();
	const macro = await createTestMacroCategory(db, "Elettronica");
	await createTestCategory(db, "Smartphone", macro.id);
	await importCharacteristicsFromCsv(
		["name,data_type,unit,options", "Peso,number,g,", "5G,boolean,,"].join("\n"),
	);
	await importCategoryCharacteristicsFromCsv(
		[
			"macro_category,subcategory,characteristic,required",
			"Elettronica,Smartphone,Peso,false",
			"Elettronica,Smartphone,5G,false",
		].join("\n"),
	);

	// il file nuovo non cita piu' 5G
	const result = await importCategoryCharacteristicsFromCsv(
		[
			"macro_category,subcategory,characteristic,required",
			"Elettronica,Smartphone,Peso,false",
		].join("\n"),
	);

	const rows = await db.select().from(productCategoryCharacteristic);
	expect(rows).toHaveLength(2); // nulla e' stato cancellato
	expect(result.missing).toEqual([
		{ subcategory: "Smartphone", characteristics: ["5G"] },
	]);
});

it("reports an unknown characteristic with its row number", async () => {
	const db = getTestDb();
	const macro = await createTestMacroCategory(db, "Elettronica");
	await createTestCategory(db, "Smartphone", macro.id);

	const result = await importCategoryCharacteristicsFromCsv(
		[
			"macro_category,subcategory,characteristic,required",
			"Elettronica,Smartphone,Inesistente,false",
		].join("\n"),
	);

	expect(result.failed).toBe(1);
	expect(result.errors[0].row).toBe(2);
	expect(result.errors[0].message).toContain("Inesistente");
});

it("reports an unknown sub-category", async () => {
	const result = await importCategoryCharacteristicsFromCsv(
		[
			"macro_category,subcategory,characteristic,required",
			"Elettronica,Inesistente,Peso,false",
		].join("\n"),
	);

	expect(result.failed).toBe(1);
	expect(result.errors[0].message).toContain("Inesistente");
});
```

- [ ] **Step 2: Eseguirli e verificare che falliscano**

```bash
cd apps/api && bun test tests/integration/admin-characteristic-import.test.ts
```

Atteso: FAIL di compilazione sui test nuovi; quelli del Task 3 restano verdi.

- [ ] **Step 3: Estendere lo schema di risposta**

`CsvImportResultSchema` è condiviso con gli import delle categorie, che non hanno un rapporto di divergenza. **Non modificarlo.** Definire accanto un `CsvImportWithMissingResultSchema` che ne estende le proprietà con:

```ts
missing: t.Array(
	t.Object({
		subcategory: t.String(),
		characteristics: t.Array(t.String()),
	}),
	{
		description:
			"Righe presenti nel database e assenti dal file, per sotto-categoria. L'import non cancella nulla: servono a vedere dove il foglio e il database divergono.",
	},
),
```

- [ ] **Step 4: Implementare il service**

`sortOrder` viene dall'ordine di riga nel CSV, contato **per sotto-categoria**: la prima caratteristica di ogni sotto-categoria è 0. È quell'ordine che il form del seller userà nella PR 4.

Il calcolo di `missing`: caricare le righe esistenti per le sole sotto-categorie citate dal file, sottrarre quelle presenti nel file, raggruppare per nome di sotto-categoria. Le sotto-categorie che il file non cita affatto **non compaiono** nel rapporto — il file non dice nulla su di loro, quindi non c'è divergenza da segnalare.

- [ ] **Step 5: La rotta**

`POST /admin/product-category-characteristics/import`, risposta `okRes(CsvImportWithMissingResultSchema)`, `detail.description` in italiano che dice le colonne attese **e** che l'import non cancella mai, riportando la divergenza.

- [ ] **Step 6: Verifica e commit**

```bash
bun run lint
bun run --cwd apps/api typecheck
bun run --cwd apps/api test
```

```bash
git add apps/api/src apps/api/tests/integration/admin-characteristic-import.test.ts
git commit -m "$(cat <<'EOF'
feat(api): import CSV della matrice categoria-caratteristiche

Solo additivo, con rapporto di divergenza: il file non cancella mai, ma
dice quali righe del database non contiene.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Seed

**Files:**
- Create: `apps/api/src/db/seed/base/characteristics.ts`
- Create: `apps/api/src/db/seed/fixtures/characteristic-values.ts`
- Modify: `apps/api/src/db/seed/base/index.ts`, `apps/api/src/db/seed/fixtures/index.ts`, `apps/api/src/db/seed/index.ts`

**Interfaces:**
- Consumes: i due CSV del Task 2, i due import dei Task 3 e 4, `products` già seminati con la loro `product_category_id`.
- Produces: dizionario e matrice popolati; valori su una fetta dei prodotti.

- [ ] **Step 1: Seed di dizionario e matrice**

In `base/characteristics.ts`, sulla forma di `apps/api/src/db/seed/base/categories.ts`: leggere i due CSV da `../data`, saltare se il dizionario è già popolato, chiamare i due service di import in ordine — prima il dizionario, poi la matrice, che senza il primo fallirebbe su ogni riga.

Montarlo in `base/index.ts` **dopo** `seedProductCategories()`: la matrice referenzia le sotto-categorie.

- [ ] **Step 2: Valori sui prodotti**

In `fixtures/characteristic-values.ts`: per ogni prodotto attivo che ha una `product_category_id`, leggere le caratteristiche della sua categoria dalla matrice e valorizzarne una parte.

- copertura: **circa il 40% dei prodotti**, scelti con un passo **coprimo** rispetto alla lunghezza della lista. `(idx * 7) % 14` dà due soli valori; verificare a secco con un istogramma prima di scrivere sul database;
- per i prodotti scelti, valorizzare le prime `n` caratteristiche in `sortOrder`, con `n` che varia fra 3 e tutte, sempre con un passo coprimo;
- i valori rispettano il tipo: `enum` pesca fra le opzioni della caratteristica, `boolean` alterna, `number` genera dentro un intervallo plausibile per l'unità, `text` prende da una manciata di stringhe per famiglia;
- inserire a blocchi con `chunked(...)`, come fanno le altre fixture.

- [ ] **Step 3: Verifica a secco della distribuzione**

Prima di considerare il task finito:

```bash
docker exec -i bibs-postgis psql -U pgadmin -d bibs-db -c "
SELECT
  (SELECT count(*) FROM product_characteristics) AS voci_dizionario,
  (SELECT count(*) FROM product_characteristic_options) AS opzioni,
  (SELECT count(*) FROM product_category_characteristics) AS righe_matrice,
  (SELECT count(*) FROM product_characteristic_values) AS valori,
  (SELECT count(DISTINCT product_id) FROM product_characteristic_values) AS prodotti_con_valori,
  (SELECT count(*) FROM products WHERE product_category_id IS NOT NULL) AS prodotti_categorizzati;"
```

`righe_matrice` deve valere **1773**. `prodotti_con_valori` deve stare intorno al 40% di `prodotti_categorizzati` — se è vicino a 0% o a 100%, il passo è collassato.

E la distribuzione per tipo, che non deve avere una famiglia sola a dominare:

```bash
docker exec -i bibs-postgis psql -U pgadmin -d bibs-db -c "
SELECT data_type, count(*) FROM product_characteristic_values GROUP BY data_type ORDER BY 2 DESC;"
```

- [ ] **Step 4: Ricostruzione da zero**

`bun run db:reset` **distrugge i volumi di sviluppo locali** e le regole del repo pretendono la conferma esplicita dell'utente. **Non eseguirlo.** Fermarsi, riferire che il task è pronto per quella verifica, e lasciarla al controller.

- [ ] **Step 5: Verifica e commit**

```bash
bun run lint
bun run --cwd apps/api typecheck
bun run --cwd apps/api test
bun run db:generate   # atteso: "No schema changes"
```

```bash
git add apps/api/src/db/seed
git commit -m "$(cat <<'EOF'
feat(db): semina dizionario, matrice e valori delle caratteristiche

Copertura al 40% dei prodotti categorizzati, con passi coprimi perche' la
distribuzione non collassi su due soli valori.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Chiusura della PR

- [ ] `bun run db:reset` con la conferma dell'utente, poi rieseguire le query dello Step 3 del Task 5 su un database ricostruito da zero.
- [ ] Con l'API in esecuzione, verificare che i due endpoint compaiano in `/openapi/json` (non `/openapi`, che è la pagina del visualizzatore) e che le loro `description` siano in italiano.
- [ ] Rileggere il diff completo: `git diff main...HEAD --stat`. Nessun file fuori dall'elenco della sezione «Struttura dei file».
- [ ] **Far rivedere a Marco la nota di revisione** prima di aprire la PR: è il punto di controllo fra la PR 2 e la PR 3, e le sue correzioni rientrano come nuovo CSV e reimport, senza toccare codice.
- [ ] Aprire la PR verso `main` citando la spec, chiudendo con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] Dopo il merge: `git fetch --prune` e cancellare i branch locali `[gone]`.
