# Prodotto a sotto-categoria unica — piano di implementazione (PR 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un prodotto appartiene a esattamente una sotto-categoria, attraverso la colonna `products.product_category_id`, al posto della tabella di associazione molti-a-molti `product_category_assignments`.

**Architecture:** Migrazione in espansione e contrazione. Prima si aggiunge la colonna e si travasano i dati lasciando in piedi la vecchia tabella (Task 1); poi si spostano i lettori (Task 3) e il contratto API con il frontend (Task 4); infine si elimina la tabella (Task 5). Ogni task lascia il repository che compila e i test verdi — nessuno stato intermedio rotto. La guardia applicativa sul nuovo `ON DELETE RESTRICT` (Task 2) è indipendente e può essere eseguita in qualunque momento dopo il Task 1.

**Tech Stack:** Bun, Elysia, Drizzle ORM, PostgreSQL 18 + PostGIS, TypeBox, TanStack Start/Query, Eden Treaty, `bun:test` con testcontainers.

**Spec:** [`docs/superpowers/specs/2026-09-22-caratteristiche-prodotto-design.md`](../specs/2026-09-22-caratteristiche-prodotto-design.md) — sezioni «Modifica a `products`» e «Migrazione». Questo piano copre la **PR 1** delle cinque; le caratteristiche non entrano qui.

## Global Constraints

- **Nessun commit diretto su `main`.** Il lavoro sta sul branch `feat/product-characteristics`, già creato.
- **Conventional Commits** con scope dalla lista del repo: qui `db`, `api`, `seller`, `products`, `categories`. Descrizione minuscola, imperativa, prima riga sotto i 72 caratteri.
- **Ogni commit chiude con** `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Mai `db:push`**: sempre `bun run db:generate`, **leggere l'SQL generato**, poi `bun run db:migrate`.
- **Mai `--no-verify`**: Lefthook esegue Biome e la validazione del messaggio, ed è portante.
- **Biome**: rientri a tabulazione, virgolette doppie, file in kebab-case.
- **Typecheck workspace per workspace**, non aggregato: `bun run --filter '*'` può inghiottire il fallimento di un singolo workspace.
- **Enumerati**: `text({ enum })` più `CHECK`, mai `pgEnum`.
- **`ServiceError` accetta solo `(status, message)`** — nessun terzo argomento per un codice personalizzato.
- **Copy in italiano** su ogni superficie utente e in ogni `description` OpenAPI.
- Il database di sviluppo dev'essere in piedi: `bun run infra:up`.

---

## Struttura dei file

| File | Responsabilità dopo la PR |
|---|---|
| `apps/api/src/db/schemas/product.ts` | `products.productCategoryId` + relazione `productCategory`; sparisce `productCategoryAssignment` |
| `apps/api/src/db/schemas/category.ts` | perde la relazione `productCategoryAssignments` |
| `apps/api/drizzle/*.sql` | due migrazioni: espansione (con travaso) e contrazione |
| `apps/api/src/modules/admin/services/product-categories.ts` | guardia 409 sulla cancellazione di categoria in uso |
| `apps/api/src/modules/seller/services/products.ts` | filtri, facet e scrittura sulla colonna |
| `apps/api/src/modules/seller/services/product-import.ts` | scrive la colonna |
| `apps/api/src/modules/customer/services/product-facets.ts` | join diretto sulla colonna |
| `apps/api/src/modules/customer/services/product-search-conditions.ts` | predicati diretti sulla colonna |
| `apps/api/src/lib/schemas/composed.ts` | `productCategory` nullable al posto di `productCategoryAssignments` |
| `apps/api/src/lib/schemas/forms/products.ts`, `apps/api/src/modules/seller/routes/products.ts` | `productCategoryId` al posto di `categoryIds` |
| `apps/api/src/db/seed/fixtures/products.ts`, `apps/api/tests/helpers/fixtures.ts` | scrivono la colonna |
| `apps/seller/src/features/products/components/product-categories-picker.tsx` | selezione singola |
| `apps/seller/src/features/products/components/product-form.tsx`, `routes/_authenticated/products/{index,$productId}.tsx` | leggono `productCategory` |

---

### Task 1: Espansione — colonna, migrazione con travaso, scritture

**Files:**
- Modify: `apps/api/src/db/schemas/product.ts:20-100`
- Modify: `apps/api/src/db/seed/fixtures/products.ts:142-205`
- Modify: `apps/api/tests/helpers/fixtures.ts:212-245`
- Create: `apps/api/drizzle/<timestamp>_<nome-generato>.sql` (generata, poi modificata a mano)
- Test: `apps/api/tests/integration/seller-products.test.ts`

**Interfaces:**
- Produces: `product.productCategoryId` (`text | null`) sullo schema Drizzle; la relazione `productCategory` per `db.query.product.findMany({ with: { productCategory: { with: { macroCategory: true } } } })`; `createTestProduct(db, sellerProfileId, { categoryIds })` che scrive sia la colonna sia la vecchia associazione.
- Consumes: niente.

- [ ] **Step 1: Contare i prodotti con più di un'assegnazione**

Prima di scrivere qualunque migrazione. Il travaso ne tiene una sola: se il conteggio non è zero, si perdono dati e va saputo adesso.

```bash
docker exec -i bibs-postgis psql -U postgres -d bibs -c "
SELECT count(*) AS prodotti_con_piu_assegnazioni FROM (
  SELECT product_id FROM product_category_assignments
  GROUP BY product_id HAVING count(*) > 1
) t;"
```

Atteso: `0`. Se è diverso da zero, **fermarsi e riferire** prima di proseguire: il seed ne assegna esattamente una (`apps/api/src/db/seed/fixtures/products.ts:258`), quindi un valore diverso significa dati inseriti a mano che il travaso taglierebbe.

Nota: `docker exec` senza `-i` scarta l'input in silenzio uscendo con 0. Il `-i` è obbligatorio.

- [ ] **Step 2: Scrivere il test che fallisce**

In `apps/api/tests/integration/seller-products.test.ts`, dentro il `describe` esistente sulla creazione prodotto:

```ts
it("scrive la sotto-categoria sulla colonna del prodotto", async () => {
	const db = getTestDb();
	const macro = await createTestMacroCategory(db, "Elettronica");
	const cat = await createTestCategory(db, "Smartphone", macro.id);

	const created = await createTestProduct(db, sellerProfileId, {
		name: "Telefono",
		categoryIds: [cat.id],
	});

	const [row] = await db
		.select({ categoryId: product.productCategoryId })
		.from(product)
		.where(eq(product.id, created.id));

	expect(row.categoryId).toBe(cat.id);
});
```

- [ ] **Step 3: Eseguirlo e verificare che fallisca**

```bash
bun run --cwd apps/api test tests/integration/seller-products.test.ts -t "scrive la sotto-categoria sulla colonna"
```

Atteso: FAIL. `product.productCategoryId` non esiste ancora — l'errore è di compilazione, non di asserzione.

- [ ] **Step 4: Aggiungere la colonna allo schema Drizzle**

In `apps/api/src/db/schemas/product.ts`, dentro `pgTable("products", …)`, dopo `brandId`:

```ts
		productCategoryId: text("product_category_id").references(
			() => productCategory.id,
			{ onDelete: "restrict" },
		),
```

Nell'array dei vincoli, accanto agli altri indici:

```ts
		index("product_product_category_id_idx").on(table.productCategoryId),
```

E in `productRelations`, accanto a `brand`:

```ts
	productCategory: one(productCategory, {
		fields: [product.productCategoryId],
		references: [productCategory.id],
	}),
```

`productCategory` è già importato da `./category` in cima al file. La tabella `productCategoryAssignment` e le sue relazioni **restano dove sono**: si eliminano nel Task 5.

- [ ] **Step 5: Generare la migrazione e leggerla**

```bash
bun run db:generate
```

Aprire il file `.sql` appena creato in `apps/api/drizzle/`. Drizzle produce l'`ADD COLUMN`, il vincolo di chiave esterna e l'indice, ma **non** il travaso.

- [ ] **Step 6: Inserire il travaso a mano nella migrazione**

Nel file generato, subito **dopo** l'`ADD COLUMN` e **prima** dell'`ADD CONSTRAINT`, inserire:

```sql
--> statement-breakpoint
UPDATE "products" p SET "product_category_id" = (
	SELECT pca."product_category_id"
	FROM "product_category_assignments" pca
	WHERE pca."product_id" = p."id"
	ORDER BY pca."product_category_id"
	LIMIT 1
);
```

L'ordine conta: il travaso deve avvenire prima che il vincolo di chiave esterna sia in vigore solo per chiarezza di lettura — in realtà i valori provengono dalla tabella referenziata e sarebbero validi comunque, ma tenere insieme «popolo» e poi «vincolo» rende il file leggibile. L'`ORDER BY` rende deterministica la scelta quando un prodotto avesse più assegnazioni (lo Step 1 ha già verificato che non accade).

- [ ] **Step 7: Applicare la migrazione**

```bash
bun run db:migrate
```

Se esce con 1 senza dire nulla, lo spinner sta mangiando `stderr`: quasi sempre `__drizzle_migrations` è fuori sincrono con il journal. Verificare con `docker exec -i bibs-postgis psql -U postgres -d bibs -c "SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5;"`.

- [ ] **Step 8: Verificare il travaso sul database di sviluppo**

```bash
docker exec -i bibs-postgis psql -U postgres -d bibs -c "
SELECT
  (SELECT count(*) FROM product_category_assignments) AS assegnazioni,
  (SELECT count(*) FROM products WHERE product_category_id IS NOT NULL) AS colonna_popolata;"
```

I due numeri devono coincidere.

- [ ] **Step 9: Far scrivere la colonna alla fixture di test**

In `apps/api/tests/helpers/fixtures.ts`, dentro `createTestProduct`, aggiungere al `.values({…})` dell'insert:

```ts
			productCategoryId: params.categoryIds?.[0] ?? null,
```

Il blocco `if (params.categoryIds?.length)` che inserisce in `productCategoryAssignment` **resta**: fino al Task 5 si scrive in entrambi i posti, così i lettori non ancora migrati continuano a funzionare.

- [ ] **Step 10: Far scrivere la colonna al seed**

In `apps/api/src/db/seed/fixtures/products.ts`, la sotto-categoria è già calcolabile prima dell'inserimento: `subsByMacro` è costruita alla riga 116, mentre `productRows` si popola dalla 148. Dentro il ciclo che costruisce `productRows`, accanto a `price` e `status`, aggiungere:

```ts
				productCategoryId: (() => {
					const subs = subsByMacro.get(macro);
					return subs && subs.length > 0 ? subs[i % subs.length].id : null;
				})(),
```

`i` è lo stesso indice già usato per `_idxInSeller`, quindi la sotto-categoria scelta coincide con quella che il blocco `productCategoryAssignment` (riga 252) assegnerà: le due scritture restano d'accordo. Quel blocco **resta** fino al Task 5.

- [ ] **Step 11: Eseguire il test e verificare che passi**

```bash
bun run --cwd apps/api test tests/integration/seller-products.test.ts -t "scrive la sotto-categoria sulla colonna"
```

Atteso: PASS.

- [ ] **Step 12: Suite completa e coerenza dello schema**

```bash
bun run test
bun run db:generate   # atteso: "No schema changes"
bun run lint
bun run --cwd apps/api typecheck
```

- [ ] **Step 13: Commit**

```bash
git add apps/api/src/db/schemas/product.ts apps/api/drizzle apps/api/src/db/seed/fixtures/products.ts apps/api/tests/helpers/fixtures.ts apps/api/tests/integration/seller-products.test.ts
git commit -m "$(cat <<'EOF'
feat(db): aggiungi products.product_category_id con travaso

La colonna affianca product_category_assignments: i lettori migrano nei
commit successivi, la tabella sparisce alla fine.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Guardia 409 sulla cancellazione di categoria in uso

**Files:**
- Modify: `apps/api/src/modules/admin/services/product-categories.ts:79-87`
- Test: `apps/api/tests/integration/admin-product-categories.test.ts` (creare se assente)

**Interfaces:**
- Consumes: `product.productCategoryId` dal Task 1.
- Produces: `deleteProductCategory(productCategoryId)` che solleva `ServiceError(409, …)` invece di lasciar passare una violazione di chiave esterna.

Il `ON DELETE RESTRICT` del Task 1 fa fallire la cancellazione di una categoria in uso a livello di database. Il gestore errori globale riconosce solo le violazioni di unicità (`apps/api/src/lib/errors.ts:75`), quindi senza guardia l'admin riceverebbe un 500.

- [ ] **Step 1: Scrivere il test che fallisce**

Se il file non esiste, crearlo ricalcando l'intestazione di `apps/api/tests/integration/seller-products.test.ts:1-30` (mock di `@/db` con il Proxy su `getTestDb()`, `setupTestContainer` / `teardownTestContainer`, `truncateAll` in `beforeEach`).

```ts
it("rifiuta con 409 la cancellazione di una categoria usata da un prodotto", async () => {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const macro = await createTestMacroCategory(db, "Elettronica");
	const cat = await createTestCategory(db, "Smartphone", macro.id);
	await createTestProduct(db, seller.sellerProfileId, {
		name: "Telefono",
		categoryIds: [cat.id],
	});

	let caught: unknown;
	try {
		await deleteProductCategory(cat.id);
	} catch (e) {
		caught = e;
	}

	expect(caught).toBeInstanceOf(ServiceError);
	expect((caught as ServiceError).status).toBe(409);
	expect((caught as ServiceError).message).toContain("1");
});

it("cancella una categoria non usata", async () => {
	const db = getTestDb();
	const macro = await createTestMacroCategory(db, "Elettronica");
	const cat = await createTestCategory(db, "Tablet", macro.id);

	const deleted = await deleteProductCategory(cat.id);

	expect(deleted.id).toBe(cat.id);
});
```

- [ ] **Step 2: Eseguirlo e verificare che fallisca**

```bash
bun run --cwd apps/api test tests/integration/admin-product-categories.test.ts
```

Atteso: il primo test FAIL — la cancellazione solleva l'errore grezzo di PostgreSQL (`23503`), non uno `ServiceError` con stato 409.

- [ ] **Step 3: Implementare la guardia**

In `apps/api/src/modules/admin/services/product-categories.ts`, sostituire il corpo di `deleteProductCategory`:

```ts
export async function deleteProductCategory(productCategoryId: string) {
	const [{ total }] = await db
		.select({ total: count() })
		.from(product)
		.where(eq(product.productCategoryId, productCategoryId));

	if (total > 0) {
		throw new ServiceError(
			409,
			`Categoria non eliminabile: ${total} prodott${total === 1 ? "o la usa" : "i la usano"}. Riassegnali a un'altra categoria e riprova.`,
		);
	}

	const [deleted] = await db
		.delete(productCategory)
		.where(eq(productCategory.id, productCategoryId))
		.returning();

	if (!deleted) throw new ServiceError(404, "Product category not found");
	return deleted;
}
```

Aggiungere in cima al file gli import mancanti: `count` da `drizzle-orm` e `product` da `@/db/schemas/product`.

Il singolare e il plurale seguono la convenzione del repo: il conteggio riguarda un insieme, ma il messaggio parla del caso concreto.

- [ ] **Step 4: Eseguire i test e verificare che passino**

```bash
bun run --cwd apps/api test tests/integration/admin-product-categories.test.ts
```

Atteso: PASS entrambi.

- [ ] **Step 5: Verificare che la rotta dichiari il 409**

In `apps/api/src/modules/admin/routes/product-categories.ts`, la `DELETE` deve usare `withConflictErrors({ … })` e non `withErrors`. Se usa `withErrors`, sostituirlo: senza, il 409 non compare in `/openapi` e i client Eden non lo conoscono.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/admin/services/product-categories.ts apps/api/src/modules/admin/routes/product-categories.ts apps/api/tests/integration/admin-product-categories.test.ts
git commit -m "$(cat <<'EOF'
feat(api): 409 esplicito sulla cancellazione di categoria in uso

Il RESTRICT sul prodotto darebbe un 500: il gestore globale mappa solo le
violazioni di unicita'. La guardia conta i prodotti e lo dice.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: I lettori SQL passano alla colonna

**Files:**
- Modify: `apps/api/src/modules/seller/services/products.ts:175-189` (filtri), `:399-410` (facet categorie seller)
- Modify: `apps/api/src/modules/customer/services/product-facets.ts:110-158`
- Modify: `apps/api/src/modules/customer/services/product-search-conditions.ts:63-77`
- Test: `apps/api/tests/integration/seller-products.test.ts`, `apps/api/tests/integration/customer-product-search.test.ts` (i test esistenti sono la rete)

**Interfaces:**
- Consumes: `product.productCategoryId` dal Task 1.
- Produces: nessun cambio di contratto. Le firme delle funzioni non cambiano; cambia solo l'SQL sotto.

Nessuna risposta cambia forma, quindi i test di integrazione esistenti su filtri, facet e ricerca sono già la verifica: devono restare verdi dal primo all'ultimo.

- [ ] **Step 1: Registrare il verde di partenza**

```bash
bun run test 2>&1 | tail -20
```

Annotare il numero di test superati. Alla fine del task dev'essere identico: questo task non aggiunge comportamento, lo riscrive.

- [ ] **Step 2: Filtri seller**

In `apps/api/src/modules/seller/services/products.ts`, sostituire i due blocchi alle righe 175-189:

```ts
	if (productCategoryIds && productCategoryIds.length > 0) {
		const idList = sql.join(
			productCategoryIds.map((id) => sql`${id}`),
			sql`, `,
		);
		conditions.push(sql`${product.productCategoryId} IN (${idList})`);
	}

	if (productMacroCategoryId) {
		conditions.push(sql`EXISTS (
			SELECT 1 FROM product_categories pc
			WHERE pc.id = ${product.productCategoryId}
				AND pc.macro_category_id = ${productMacroCategoryId}
		)`);
	}
```

`sql.join` con `IN (…)` resta obbligatorio: dentro un tagged literal `= ANY(${array})` non funziona, e `inArray()` non si usa dentro i template grezzi.

- [ ] **Step 3: Facet categorie del seller**

Sempre in `products.ts`, le due varianti di `baseQuery` alle righe 399-410 non passano più dalla tabella di associazione:

```ts
	const baseQuery = storeId
		? db
				.selectDistinct({ id: product.productCategoryId })
				.from(product)
				.innerJoin(storeProduct, eq(storeProduct.productId, product.id))
				.where(and(...conditions, isNotNull(product.productCategoryId)))
		: db
				.selectDistinct({ id: product.productCategoryId })
				.from(product)
				.where(and(...conditions, isNotNull(product.productCategoryId)));
```

`isNotNull` va importato da `drizzle-orm`. Serve: la colonna è nullable, e senza il filtro il `selectDistinct` restituirebbe una riga `null` che manderebbe `inArray(productCategory.id, ids)` a cercare un id nullo.

La riga successiva `const ids = rows.map((r) => r.id)` ora produce `(string | null)[]` per il tipo pur non contenendo `null` a runtime: restringere con `.filter((id): id is string => id !== null)`.

- [ ] **Step 4: Facet customer**

In `apps/api/src/modules/customer/services/product-facets.ts`, entrambe le query (macro e categorie) perdono il primo `innerJoin`. Sostituire in ciascuna:

```ts
				.innerJoin(
					productCategoryAssignment,
					sql`${productCategoryAssignment.productId} = ${product.id}`,
				)
				.innerJoin(
					productCategory,
					eq(productCategory.id, productCategoryAssignment.productCategoryId),
				)
```

con:

```ts
				.innerJoin(
					productCategory,
					eq(productCategory.id, product.productCategoryId),
				)
```

`count(DISTINCT products.id)` resta: con la colonna singola il conteggio non può più gonfiarsi, ma il `DISTINCT` non costa nulla e regge se in futuro si aggiungono join. Rimuovere l'import ora inutilizzato di `productCategoryAssignment`.

- [ ] **Step 5: Condizioni di ricerca customer**

In `apps/api/src/modules/customer/services/product-search-conditions.ts`, sostituire il blocco alle righe 63-77:

```ts
	if (p.categoryId) {
		conditions.push(sql`products.product_category_id = ${p.categoryId}`);
	} else if (p.macroCategoryId) {
		conditions.push(sql`EXISTS (
			SELECT 1 FROM ${productCategory} pc
			WHERE pc.id = products.product_category_id
				AND pc.macro_category_id = ${p.macroCategoryId}
		)`);
	}
```

`products.product_category_id` va scritto letterale, non come `${product.productCategoryId}`: in un template usato dentro una sottoquery correlata le colonne nude escono senza qualificazione e la correlazione si rompe in silenzio. Qui il resto del file usa già `products.id` letterale per la stessa ragione. Rimuovere l'import ora inutilizzato di `productCategoryAssignment`.

- [ ] **Step 6: Eseguire la suite e confrontare con lo Step 1**

```bash
bun run test 2>&1 | tail -20
bun run lint
bun run --cwd apps/api typecheck
```

Atteso: stesso numero di test superati dello Step 1, zero falliti. Se un test di facet o ricerca diventa rosso, la traduzione SQL non è equivalente — **non indebolire l'asserzione**: sistemare la query.

- [ ] **Step 7: Verificare la parità sul database di sviluppo**

Con il seed caricato, le due formulazioni devono dare gli stessi conteggi per macro:

```bash
docker exec -i bibs-postgis psql -U postgres -d bibs -c "
SELECT pmc.name,
       count(DISTINCT p_old.id) AS via_assegnazioni,
       count(DISTINCT p_new.id) AS via_colonna
FROM product_macro_categories pmc
LEFT JOIN product_categories pc ON pc.macro_category_id = pmc.id
LEFT JOIN product_category_assignments pca ON pca.product_category_id = pc.id
LEFT JOIN products p_old ON p_old.id = pca.product_id AND p_old.status = 'active'
LEFT JOIN products p_new ON p_new.product_category_id = pc.id AND p_new.status = 'active'
GROUP BY pmc.name ORDER BY pmc.name;"
```

Le due colonne devono coincidere riga per riga.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/seller/services/products.ts apps/api/src/modules/customer/services/product-facets.ts apps/api/src/modules/customer/services/product-search-conditions.ts
git commit -m "$(cat <<'EOF'
refactor(api): filtri, facet e ricerca leggono product_category_id

Nessun cambio di contratto: le stesse risposte, senza passare dalla
tabella di associazione. Parita' verificata sui conteggi per macro.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Contratto API e frontend seller

**Files:**
- Modify: `apps/api/src/lib/schemas/composed.ts:88-108`
- Modify: `apps/api/src/lib/schemas/forms/products.ts:34`
- Modify: `apps/api/src/modules/seller/routes/products.ts:320,362,417`
- Modify: `apps/api/src/modules/seller/services/products.ts:316,510,620-630,680-760`
- Modify: `apps/api/src/modules/seller/services/product-import.ts:213-220`
- Modify: `apps/seller/src/features/products/components/product-categories-picker.tsx`
- Modify: `apps/seller/src/features/products/components/product-form.tsx:58,107,114,169-222,394-401`
- Modify: `apps/seller/src/routes/_authenticated/products/$productId.tsx:139-160`
- Modify: `apps/seller/src/routes/_authenticated/products/index.tsx:450-475`
- Test: `apps/api/tests/integration/seller-products.test.ts:220-380`

**Interfaces:**
- Consumes: `product.productCategoryId` e la relazione `productCategory` dal Task 1.
- Produces:
  - `ProductWithRelationsSchema.productCategory: ProductCategoryWithMacroSchema | null` (sostituisce `productCategoryAssignments: Array<…>`);
  - corpo di `POST` e `PATCH /seller/products`: `productCategoryId?: string | null` (sostituisce `categoryIds?: string[]`);
  - `createProduct` / `updateProduct` accettano `productCategoryId?: string | null`;
  - `ProductCategoriesPicker` con prop `categoryId: string | null` e `onCategoryChange: (id: string | null) => void`.

Questo task cambia la forma della risposta, quindi API e frontend si muovono insieme: Eden Treaty propaga i tipi e separarli lascerebbe `apps/seller` che non compila.

- [ ] **Step 1: Scrivere i test che falliscono**

In `apps/api/tests/integration/seller-products.test.ts` tre punti leggono ancora il vecchio modello e vanno riscritti:

- riga 232, `expect(result.productCategoryAssignments).toEqual([])` → `expect(result.productCategory).toBeNull()`;
- righe 293-294 e 374-375, che interrogano la tabella `productCategoryAssignment` per contare le assegnazioni → leggere `product.productCategoryId` con una `select` sulla tabella `products`;
- riga 38, l'import di `productCategoryAssignment` da `@/db/schemas/product` → toglierlo, altrimenti `noUnusedLocals` fa fallire il typecheck.

Poi aggiungere:

```ts
it("espone la sotto-categoria con la sua macro", async () => {
	const db = getTestDb();
	const macro = await createTestMacroCategory(db, "Elettronica");
	const cat = await createTestCategory(db, "Smartphone", macro.id);
	const created = await createProduct({
		sellerProfileId,
		storeId,
		name: "Telefono",
		price: "10.00",
		productCategoryId: cat.id,
	});

	const found = await getProduct({
		productId: created.id,
		sellerProfileId,
		accessibleStoreIds: [storeId],
	});

	expect(found.productCategory?.id).toBe(cat.id);
	expect(found.productCategory?.macroCategory.name).toBe("Elettronica");
});

it("azzera la categoria quando si passa null", async () => {
	const db = getTestDb();
	const macro = await createTestMacroCategory(db, "Elettronica");
	const cat = await createTestCategory(db, "Smartphone", macro.id);
	const created = await createTestProduct(db, sellerProfileId, {
		name: "Telefono",
		categoryIds: [cat.id],
	});

	const updated = await updateProduct({
		productId: created.id,
		sellerProfileId,
		accessibleStoreIds: [storeId],
		productCategoryId: null,
	});

	expect(updated?.productCategoryId).toBeNull();
});
```

- [ ] **Step 2: Eseguirli e verificare che falliscano**

```bash
bun run --cwd apps/api test tests/integration/seller-products.test.ts
```

Atteso: FAIL di compilazione — `productCategoryId` non è un parametro di `createProduct`.

- [ ] **Step 3: Schema di risposta**

In `apps/api/src/lib/schemas/composed.ts`, eliminare `ProductCategoryAssignmentWithCategory` (righe 88-93) e in `ProductWithRelationsSchema` sostituire:

```ts
	productCategoryAssignments: t.Array(ProductCategoryAssignmentWithCategory),
```

con:

```ts
	productCategory: t.Nullable(ProductCategoryWithMacroSchema),
```

- [ ] **Step 4: Schema del corpo**

In `apps/api/src/lib/schemas/forms/products.ts`, sostituire il blocco `categoryIds` (riga 34) con:

```ts
	productCategoryId: Type.Optional(
		Type.Union([Type.String(), Type.Null()], {
			description:
				"ID della sotto-categoria del prodotto. null per rimuoverla.",
		}),
	),
```

In `apps/api/src/modules/seller/routes/products.ts` fare lo stesso alla riga 362 con la sintassi `t.` e aggiornare la riga 320 (`productCategoryId: body.productCategoryId`) e la descrizione OpenAPI alla riga 417:

```
"Aggiorna i dati di un prodotto. Se viene fornita productCategoryId, la classificazione viene sostituita; null la rimuove."
```

- [ ] **Step 5: Lettura nei service**

In `apps/api/src/modules/seller/services/products.ts`, nelle due `findMany` / `findFirst` (righe 316 e 510) sostituire:

```ts
						productCategoryAssignments: {
							with: { category: { with: { macroCategory: true } } },
						},
```

con:

```ts
						productCategory: { with: { macroCategory: true } },
```

- [ ] **Step 6: Scrittura nei service**

In `createProduct`, sostituire il parametro `categoryIds: string[]` con `productCategoryId?: string | null` e il blocco di inserimento (righe 623-630) sparisce: il valore entra direttamente nel `.values({…})` dell'insert del prodotto, accanto a `brandId`:

```ts
				productCategoryId: productCategoryId ?? null,
```

In `updateProduct`, eliminare la validazione «tutte le categorie appartengono a una sola macro» (righe 679-691): con una sola sotto-categoria non ha più senso. Eliminare il blocco `if (categoryIds) { delete… insert… }` in coda e aggiungere invece, accanto alla gestione di `ean` e `brandId`:

```ts
		if (productCategoryId !== undefined) {
			productUpdates.productCategoryId = productCategoryId;
		}
```

`undefined` significa «non toccare», `null` significa «rimuovi»: è la stessa distinzione già usata per `ean` e `brandId` poco sopra.

- [ ] **Step 7: Caricamento massivo prodotti**

In `apps/api/src/modules/seller/services/product-import.ts`, sostituire il blocco delle righe 213-220 spostando il valore dentro il `.values({…})` dell'insert:

```ts
								productCategoryId: p.categoryIds[0] ?? null,
```

Il parser CSV a monte continua a produrre `categoryIds`: se il file ne indica più di una si prende la prima. Non è un cambio di comportamento visibile — il CSV di import non è oggetto di questa PR.

- [ ] **Step 8: Eseguire i test dell'API**

```bash
bun run --cwd apps/api test tests/integration/seller-products.test.ts
```

Atteso: PASS.

- [ ] **Step 9: Selettore a scelta singola**

In `apps/seller/src/features/products/components/product-categories-picker.tsx`, sostituire le prop `categoryIds: string[]` / `onToggleCategory` con `categoryId: string | null` / `onCategoryChange: (id: string | null) => void`, e il `Popover` + `Command` con pastiglie multiple (righe 98-180) con un secondo `Select` uguale a quello della macro:

```tsx
			{macroCategoryId && (
				<div className="space-y-2">
					<Label>Categoria{required && " *"}</Label>
					<Select
						value={categoryId ?? ""}
						onValueChange={(v) => onCategoryChange(v || null)}
					>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Seleziona una categoria" />
						</SelectTrigger>
						<SelectContent>
							{categories.map((c) => (
								<SelectItem key={c.id} value={c.id}>
									{c.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}
```

Rimuovere gli import ora inutilizzati (`Checkbox`, `Command*`, `Popover*`, `XIcon`, `ChevronDownIcon`, `useState`) — `noUnusedLocals` li farebbe fallire in typecheck.

- [ ] **Step 10: Form prodotto**

In `apps/seller/src/features/products/components/product-form.tsx`, cinque punti.

Il tipo del campo (riga 58):

```ts
	productCategoryId: string | null;
```

Il valore di partenza (riga 107):

```ts
			productCategoryId: defaultValues?.productCategoryId ?? null,
```

Il valore osservato (riga 114) — `selectedCategories` sparisce:

```ts
	const productCategoryId = watch("productCategoryId") ?? null;
```

Il travaso dal codice EAN (righe 169-171), che oggi riempie l'elenco solo se vuoto:

```ts
		if (overwrite || !getValues("productCategoryId")) {
			setValue("productCategoryId", lookupResult.categoryIds[0] ?? null, {
				shouldValidate: true,
				shouldDirty: true,
			});
		}
```

La condizione «ha già una classificazione» alle righe 183-184 e il ripristino al cambio di macro alle righe 209-222, dove `[]` diventa `null`:

```ts
	const hasClassification = !!macroCategoryId || !!getValues("productCategoryId");

	// … dentro il gestore del cambio macro:
	setValue("productCategoryId", null, { shouldValidate: true, shouldDirty: true });
```

E il blocco `Field` (righe 394-401), con le nuove prop:

```tsx
							<ProductCategoriesPicker
								macroCategoryId={macroCategoryId}
								categoryId={productCategoryId}
								onCategoryChange={(id) =>
									setValue("productCategoryId", id, {
										shouldValidate: true,
										shouldDirty: true,
									})
								}
								onMacroChange={onMacroChange}
							/>
							<FieldError errors={[errors.productCategoryId]} />
```

`onMacroChange` resta quello già presente nel file: non cambia firma.

- [ ] **Step 11: Pagina di modifica**

In `apps/seller/src/routes/_authenticated/products/$productId.tsx`, sostituire le righe 139-140 e 157-159:

```tsx
	const macroCategoryId = product.productCategory?.macroCategoryId ?? null;
```

e nel `defaultValues`:

```tsx
					productCategoryId: product.productCategory?.id ?? null,
```

- [ ] **Step 12: Colonna della tabella**

In `apps/seller/src/routes/_authenticated/products/index.tsx`, la cella `category` (righe 457-480) non ha più un elenco da troncare:

```tsx
				cell: ({ row }) => {
					const cat = row.original.productCategory;
					if (!cat) {
						return <span className="text-muted-foreground">—</span>;
					}
					return (
						<div className="flex flex-col gap-1 leading-tight">
							<span className="text-muted-foreground text-[0.65rem] font-medium tracking-[0.06em] uppercase">
								{cat.macroCategory.name}
							</span>
							<span>{cat.name}</span>
						</div>
					);
				},
```

Rimuovere `MAX_VISIBLE`, `visible` e `overflow`, ora senza uso.

- [ ] **Step 13: Verifica completa**

```bash
bun run test
bun run lint
for w in packages/ui packages/emails apps/api apps/admin apps/customer apps/seller; do
  bun run --cwd "$w" typecheck || echo "FAILED: $w"
done
bun run --cwd apps/api build
```

Nessun `FAILED:` deve comparire.

- [ ] **Step 14: Prova nel browser**

Con `bun run dev` attivo, entrare in `http://localhost:3002` come `seller@dev.bibs` / `password123` e verificare:
1. l'elenco prodotti mostra macro e categoria nella colonna;
2. aprendo un prodotto, macro e categoria sono precompilate;
3. cambiando macro la categoria si azzera e il menu si ripopola;
4. il salvataggio va a buon fine e ricaricando la pagina il valore è rimasto;
5. la console del browser non riporta errori.

Il typecheck non verifica l'interfaccia: questo passo è il collaudo.

- [ ] **Step 15: Commit**

```bash
git add apps/api/src/lib/schemas apps/api/src/modules/seller apps/api/tests/integration/seller-products.test.ts apps/seller/src
git commit -m "$(cat <<'EOF'
feat(seller): un prodotto ha una sola sotto-categoria

La risposta espone productCategory al posto dell'elenco di assegnazioni e
il corpo accetta productCategoryId; il selettore diventa a scelta singola.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Contrazione — via la tabella di associazione

**Files:**
- Modify: `apps/api/src/db/schemas/product.ts:102-134`
- Modify: `apps/api/src/db/schemas/category.ts:3,40`
- Modify: `apps/api/src/db/seed/fixtures/products.ts:250-270`
- Modify: `apps/api/tests/helpers/fixtures.ts:236-243,312-320`
- Create: `apps/api/drizzle/<timestamp>_<nome-generato>.sql`

**Interfaces:**
- Consumes: tutto quanto prodotto dai Task 1, 3 e 4.
- Produces: nessuna nuova interfaccia. Spariscono `productCategoryAssignment`, `productCategoryAssignmentRelations` e `createTestProductCategoryAssignment`.

Arriva per ultimo perché fino a qui la vecchia tabella era la rete di sicurezza: se un lettore fosse rimasto indietro, i test lo avrebbero mostrato leggendo dati ancora corretti invece di dati vuoti.

- [ ] **Step 1: Verificare che nessuno la usi più**

```bash
grep -rn "productCategoryAssignment\|product_category_assignments" --include="*.ts" --include="*.tsx" apps packages | grep -v node_modules
```

Atteso: solo i file elencati sopra (definizione dello schema, seed, fixture di test). Qualunque altra occorrenza significa che un lettore è rimasto indietro: **fermarsi e sistemarlo prima di proseguire.**

- [ ] **Step 2: Togliere la doppia scrittura dal seed**

In `apps/api/src/db/seed/fixtures/products.ts`, eliminare l'intero blocco `// ── productCategoryAssignment ──` (righe 252-270) e l'import di `productCategoryAssignment`. Il valore è già scritto sulla colonna dal Task 1, Step 10.

- [ ] **Step 3: Togliere la doppia scrittura dalle fixture di test**

In `apps/api/tests/helpers/fixtures.ts`, eliminare da `createTestProduct` il blocco `if (params.categoryIds?.length) { … }` (righe 236-243), la funzione `createTestProductCategoryAssignment` (righe 312-320) e l'import di `productCategoryAssignment`. `createTestProduct` continua ad accettare `categoryIds` e a usarne la prima per la colonna: la firma non cambia, così i test chiamanti restano intatti.

- [ ] **Step 4: Togliere la tabella dallo schema**

In `apps/api/src/db/schemas/product.ts` eliminare `productCategoryAssignment` (righe 102-118), `productCategoryAssignmentRelations` (righe 120-134) e la voce `productCategoryAssignments: many(productCategoryAssignment)` da `productRelations` (riga 97). Rimuovere l'import ora inutilizzato di `primaryKey` se non serve ad altro nel file.

In `apps/api/src/db/schemas/category.ts` eliminare l'import (riga 3) e la voce `productCategoryAssignments: many(productCategoryAssignment)` da `productCategoryRelations` (riga 40). Se `many` resta senza uso, toglierlo dalla destrutturazione.

- [ ] **Step 5: Generare e leggere la migrazione**

```bash
bun run db:generate
```

Il file deve contenere **solo** `DROP TABLE "product_category_assignments" CASCADE;`. Se contiene altro — in particolare un qualunque `ALTER TABLE "products"` — significa che lo schema è andato alla deriva: leggere e capire prima di applicare.

- [ ] **Step 6: Applicare e verificare**

```bash
bun run db:migrate
docker exec -i bibs-postgis psql -U postgres -d bibs -c "\d product_category_assignments"
```

Atteso: `Did not find any relation named "product_category_assignments"`.

- [ ] **Step 7: Ricostruire il database da zero**

La prova che il seed regge senza la tabella:

```bash
bun run db:reset
```

**Distrugge i volumi di sviluppo locali.** Chiedere conferma prima di eseguirlo. Atteso: migrazioni e seed fino in fondo, senza errori.

- [ ] **Step 8: Verifica completa**

```bash
bun run test
bun run lint
for w in packages/ui packages/emails apps/api apps/admin apps/customer apps/seller; do
  bun run --cwd "$w" typecheck || echo "FAILED: $w"
done
bun run --cwd apps/api build
bun run db:generate   # atteso: "No schema changes"
```

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/db apps/api/tests/helpers/fixtures.ts apps/api/drizzle
git commit -m "$(cat <<'EOF'
refactor(db): elimina product_category_assignments

Ogni lettore e scrittore e' passato a products.product_category_id.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Chiusura della PR

- [ ] Rileggere il diff completo: `git diff main...HEAD --stat`. Nessun file fuori dall'elenco della sezione «Struttura dei file».
- [ ] Verificare che `/openapi` rifletta il nuovo corpo: con l'API in esecuzione, `curl -s localhost:3000/openapi | grep -c productCategoryId` dev'essere maggiore di zero, e `grep -c categoryIds` pari a zero.
- [ ] Aprire la PR verso `main` con `/commit-commands:commit-push-pr`, citando la spec nel corpo e chiudendo con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] Dopo il merge: `git fetch --prune` e cancellare i branch locali `[gone]`.
