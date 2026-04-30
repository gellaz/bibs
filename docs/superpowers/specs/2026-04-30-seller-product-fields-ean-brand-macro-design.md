# Seller — Nuovi campi prodotto: EAN, Brand, Macrocategoria

**Data**: 2026-04-30
**Scope**: `apps/api`, `apps/seller`
**Out of scope**: `apps/admin`, `apps/customer` (filtri/ricerca per brand o EAN — PR separati)

## Obiettivo

Estendere il form di inserimento/modifica prodotto lato seller per supportare:

1. **EAN** (codice a barre, opzionale).
2. **Brand** (entità per-seller, opzionale, con autocomplete + create-on-save).
3. **Macrocategoria** (filtro UI per le sotto-categorie esistenti, scelta singola obbligatoria).

L'EAN, se valorizzato, attiva una **lookup cross-seller** che pre-compila i campi del form (esclusi prezzo e immagini) con i dati dell'ultimo prodotto esistente con quello stesso EAN — su consenso esplicito del seller (banner di conferma, niente auto-fill silenzioso).

## Decisioni chiave (negoziate in brainstorming)

| Tema | Decisione |
|---|---|
| Brand — modello | Entità per-seller, opzionale, combobox con autocomplete + create-on-save. Match-or-create al submit. |
| EAN — formato | Opzionale. 8 o 13 cifre, **senza** verifica check digit. |
| EAN — unicità | `UNIQUE (seller_profile_id, ean) WHERE ean IS NOT NULL`. Cross-seller può ripetersi (è anzi atteso). |
| EAN — pre-compilazione | Lookup ultimo prodotto cross-seller con stesso EAN. Pre-compila `name`, `description`, `macroCategoryId`, `categoryIds`, `brandName`. **Mai** prezzo o immagini. |
| EAN — UX | Banner inline con bottone *"Compila campi"*. Niente auto-fill silenzioso. |
| Macrocategoria — modello | Solo filtro UI nel picker delle sotto-categorie. Nessuna nuova colonna su `products` (la macro è già derivabile da `product_categories.macro_category_id`). |

## Architettura — Schema DB

### Nuova tabella `brands`

`apps/api/src/db/schemas/brand.ts`:

```ts
brands(
  id text pk,
  sellerProfileId text not null FK → sellerProfile.id ON DELETE CASCADE,
  name text not null,
  createdAt timestamptz default now() not null,
  updatedAt timestamptz default now() not null,
)
unique index brands_seller_name_unique on (seller_profile_id, lower(name))
index brands_seller_profile_id_idx on (seller_profile_id)
```

L'unique index su `lower(name)` garantisce che "Nike", "nike" e "NIKE" siano riconosciuti come lo stesso brand.

### Modifiche a `products`

`apps/api/src/db/schemas/product.ts`:

```ts
products + {
  ean      text  null,
  brandId  text  null  FK → brands.id ON DELETE SET NULL,
}
+ unique index product_seller_ean_unique on (seller_profile_id, ean) WHERE ean IS NOT NULL
+ index product_ean_idx on (ean)
+ index product_brand_id_idx on (brand_id)
+ check ean ~ '^(\d{8}|\d{13})$'  -- coerenza DB-level con la validazione TypeBox
```

L'index `product_ean_idx` (non partial) abilita la lookup cross-seller veloce.

### Migrazione

Generata via `bun run db:generate`, revisionata, applicata via `bun run db:migrate`. **Non** usare `db:push` (deny-listed).

## Architettura — Schemi TypeBox

### Nuovi schemi entity

`apps/api/src/lib/schemas/entities.ts`:

```ts
BrandSchema = t.Object({
  id: t.String(),
  sellerProfileId: t.String(),
  name: t.String({ description: "Nome del brand" }),
  createdAt: t.Date(),
  updatedAt: t.Date(),
})

EanLookupResultSchema = t.Object({
  name: t.String(),
  description: t.Nullable(t.String()),
  ean: t.String(),
  brandName: t.Nullable(t.String({ description: "Nome del brand del prodotto sorgente — il seller corrente farà match-or-create" })),
  macroCategoryId: t.Nullable(t.String()),
  categoryIds: t.Array(t.String()),
})
```

`EanLookupResultSchema` **non** include `id` né `sellerProfileId` del prodotto sorgente: evita leak di dati cross-seller.

### Modifica `ProductSchema`

`apps/api/src/lib/schemas/entities.ts`:

```ts
ProductSchema + {
  ean:     t.Nullable(t.String()),
  brandId: t.Nullable(t.String()),
}
```

`ProductWithRelationsSchema` (composed) include la relazione `brand: t.Nullable(BrandSchema)`.

### Modifica `CreateProductBody` e `UpdateProductBody`

`apps/api/src/lib/schemas/forms/products.ts`:

```ts
CreateProductBody + {
  ean:       t.Optional(t.String({ pattern: '^(\\d{8}|\\d{13})$', error: "EAN deve essere 8 o 13 cifre" })),
  brandId:   t.Optional(t.String()),
  brandName: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
}
```

`UpdateProductBody` (inline in `apps/api/src/modules/seller/routes/products.ts`): stessi tre campi opzionali.

Regola di precedenza nel service:

1. Se `brandId` è presente e valido (esiste, appartiene al seller) → usa quello.
2. Altrimenti se `brandName` è presente → `findOrCreateBrandByName`.
3. Altrimenti il prodotto resta senza brand (`brandId = null`).
4. Se `brandId` non appartiene al seller corrente → 404 (`ServiceError(404, "Brand not found")`).

## Architettura — API

### Nuovo modulo `brands` (seller-scoped)

`apps/api/src/modules/seller/services/brands.ts`:

```ts
listBrands({ sellerProfileId, q?, page, limit }) → { data: Brand[], pagination }
findOrCreateBrandByName({ sellerProfileId, name, tx? }) → Brand
```

`findOrCreateBrandByName` è atomic e race-safe — implementata con:

```sql
INSERT INTO brands (seller_profile_id, name)
VALUES ($1, $2)
ON CONFLICT (seller_profile_id, lower(name))
DO UPDATE SET updated_at = now()
RETURNING *
```

Accetta una transazione opzionale (`tx?`) per essere riusabile dentro `createProduct`.

`apps/api/src/modules/seller/routes/brands.ts`:

| Metodo | Path | Body / Query | Risposta | Note |
|---|---|---|---|---|
| `GET` | `/seller/brands` | `?q=&page=&limit=` | `okPageRes(BrandSchema)` | `q` filtra case-insensitive con `ILIKE`. Default `limit=20`. Solo brand del seller corrente. |
| `POST` | `/seller/brands` | `{ name }` | `okRes(BrandSchema)` | Match-or-create: se esiste un brand con stesso `lower(name)` per il seller, ritorna quello. Niente 23505/409. |

Niente `PATCH` o `DELETE` in questa fase (YAGNI).

Registrato in `apps/api/src/modules/seller/index.ts` accanto a `productsRoutes`.

### Endpoint lookup EAN

`apps/api/src/modules/seller/services/products.ts`:

```ts
lookupProductByEan({ ean }) → EanLookupResult | null
```

Query Drizzle:

```ts
db.query.product.findFirst({
  where: eq(product.ean, ean),
  orderBy: [desc(product.createdAt)],
  with: {
    brand: true,
    productClassifications: { with: { category: true } },
  },
})
```

Se trovato:

```ts
{
  name, description, ean,
  brandName: row.brand?.name ?? null,
  macroCategoryId: row.productClassifications[0]?.category.macroCategoryId ?? null,
  categoryIds: row.productClassifications.map(c => c.productCategoryId),
}
```

Se non trovato → ritorna `null`.

`apps/api/src/modules/seller/routes/products.ts`:

```ts
GET /seller/products/lookup?ean=…
  query: t.Object({ ean: t.String({ pattern: '^(\\d{8}|\\d{13})$' }) })
  auth: true (macro `withSeller`)
  response: okRes(t.Nullable(EanLookupResultSchema))
  detail: { summary: "Lookup prodotto per EAN", description: "Restituisce i dati pre-compilabili dell'ultimo prodotto creato con questo EAN, da qualsiasi venditore. Esclude prezzo e immagini." }
```

Risposta 200 con `data: null` quando non trovato (NON 404 — "non trovato" è un esito normale dell'autocompletamento, non un errore).

### Estensioni endpoint esistenti

**`POST /seller/products`**: il service `createProduct` chiama `findOrCreateBrandByName` se `brandName` è presente e `brandId` no. Tutto in transazione (è già transazionale). Conflitto unique `(seller_profile_id, ean)` → 23505 → 409 dal global error handler (già configurato).

**`PATCH /seller/products/:productId`**: `ean: null` esplicito permesso (per cancellarlo). Logica brand identica a create. La route in `apps/api/src/modules/seller/routes/products.ts` aggiorna lo schema body inline.

**`POST /seller/products/import`** (CSV): aggiungo colonne opzionali `ean` e `brand` al parser in `services/product-import.ts`. Per ogni riga, se `brand` valorizzato → `findOrCreateBrandByName`. Se EAN duplicato per il seller → la riga viene segnata in `errors[]` come "EAN già usato in un altro prodotto".

**`GET /product-categories`** (esistente, in `apps/api/src/modules/product-categories.ts`): aggiungo `?macroCategoryId=` come filtro opzionale (`WHERE macro_category_id = $1`). Una riga in più nel service `listProductCategories`.

## Architettura — Frontend

### Nuovo componente `BrandCombobox`

`apps/seller/src/features/products/components/brand-combobox.tsx`.

Composizione su shadcn `Command` + `Popover` (pattern già usato altrove nel repo).

```ts
interface BrandComboboxProps {
  value: { brandId?: string; brandName?: string } | null;
  onChange: (next: { brandId?: string; brandName?: string } | null) => void;
  placeholder?: string;
}
```

Comportamento:

- Input testuale con debounce 250ms → `useQuery(['seller-brands', q], fetch /seller/brands?q=&limit=20)`.
- Risultati come opzioni cliccabili.
- Se nessuna opzione matcha l'input corrente con case-insensitive equals (`results.some(r => r.name.toLowerCase() === q.toLowerCase()) === false`), opzione finale *"+ Crea brand «{input}»"*. Cliccare imposta `value = { brandName: input }` (nessun POST ancora — la creazione avviene al submit del prodotto, lato API).
- Cliccare un brand esistente imposta `value = { brandId, brandName }`. Al submit prevale `brandId`.
- Pulsante "x" per pulire la selezione → `onChange(null)`.
- A11y: `role="combobox"`, `aria-expanded`, navigazione tastiera (gratis da shadcn `Command`).

Vive **fuori** da react-hook-form per via dell'oggetto composito; sincronizzato via `useEffect` con `setValue('brandId' / 'brandName')` nel form (stesso pattern di `files` e `imageOrder`).

### Refactor del category picker

`apps/seller/src/features/products/components/product-classification-picker.tsx` (rinomina + estende l'attuale `product-category-picker.tsx`; quest'ultimo non è usato altrove, viene cancellato).

```ts
interface ProductClassificationPickerProps {
  macroCategoryId: string | null;
  categoryIds: string[];
  onMacroChange: (macroId: string | null) => void;
  onToggleCategory: (categoryId: string) => void;
  required?: boolean;
}
```

Comportamento:

- shadcn `Select` per la macro-categoria, popolata da `useQuery(['product-macro-categories'], …)` → `GET /product-macro-categories?page=1&limit=100`.
- Quando `macroCategoryId` è settato, una seconda `useQuery(['product-categories', macroId], …)` → `GET /product-categories?macroCategoryId=…&limit=200`.
- Sotto la select macro, le sotto-categorie filtrate appaiono come checkbox (UI invariata rispetto a oggi).
- Cambiare macro **resetta** `categoryIds`. Se ce n'erano selezionate, toast informativo.
- Modalità edit: la macro è derivata dalla prima sotto-cat selezionata. Tutte le sotto-cat di un prodotto appartengono alla stessa macro per design — i service `createProduct` e `updateProduct` validano che le `categoryIds` provengano da una sola macro (`SELECT DISTINCT macro_category_id FROM product_categories WHERE id IN (...)` deve ritornare 1 riga, altrimenti `ServiceError(400, "Le categorie devono appartenere a una sola macro")`).

### Estensione `ProductForm`

`apps/seller/src/features/products/components/product-form.tsx`.

Ordine UX dei campi (pensato per favorire il flow "scansiona EAN → form pre-compilato"):

1. **`ean`** (input testuale, opzionale) — primo campo.
   - Hook `useEanLookup(ean)`: `useQuery(['ean-lookup', ean], …, { enabled: /^(\d{8}|\d{13})$/.test(ean) && !defaultValues, staleTime: Infinity })`.
   - Solo in modalità **create** (no lookup in edit).
   - Quando la query risolve a un risultato, banner inline sotto l'input:

     > ℹ️ Trovato un prodotto esistente per questo EAN.
     > **[Compila campi]** **[Ignora]**

   - "Compila campi" applica i campi da `EanLookupResultSchema` solo dove l'utente non ha ancora digitato (rispetto del consenso). Se ci sono valori già editati, il bottone diventa *"Compila campi (sovrascrive)"*.
   - "Ignora" nasconde il banner per quella query.
   - **Nessuna sovrascrittura silenziosa**, mai.

2. **`name`** (esistente).
3. **`description`** (esistente).
4. **`price`** (esistente).
5. **`brand`** (`BrandCombobox`, opzionale) — sotto a price.
6. Separator + `ProductClassificationPicker` (macro + sotto-cat).
7. Separator + immagini (esistente).

`onFormSubmit` invariato salvo l'aggiunta dei nuovi campi nel payload (`ean`, `brandId`, `brandName`).

### Route handlers

`apps/seller/src/routes/_authenticated/products/new.tsx`:

- `mutationFn` aggiunge `ean`, `brandId`, `brandName` al payload `api().seller.products.post(...)`.
- Niente altra logica.

`apps/seller/src/routes/_authenticated/products/$productId.tsx`:

- `defaultValues` include:
  - `ean: product.ean ?? ""`
  - `brandId: product.brand?.id`, `brandName: product.brand?.name`
  - `macroCategoryId`: derivato dalla prima `productClassification.category.macroCategoryId`
- `mutationFn` per il PATCH passa i nuovi campi.

### i18n

Tutte le nuove stringhe user-facing aggiunte a `messages/*.json` (Paraglide). Nessuna stringa hard-coded.

Strings nuove (chiavi proposte, italiano + inglese):

- `productForm.eanLabel`: "EAN"
- `productForm.eanPlaceholder`: "8 o 13 cifre"
- `productForm.eanLookupFound`: "Trovato un prodotto esistente per questo EAN."
- `productForm.eanLookupApply`: "Compila campi"
- `productForm.eanLookupApplyOverwrite`: "Compila campi (sovrascrive)"
- `productForm.eanLookupDismiss`: "Ignora"
- `productForm.brandLabel`: "Brand"
- `productForm.brandPlaceholder`: "Cerca o crea un brand"
- `productForm.brandCreate`: 'Crea brand "{name}"'
- `productForm.macroLabel`: "Macrocategoria"
- `productForm.macroPlaceholder`: "Seleziona una macrocategoria"
- `productForm.macroChangedResetCategories`: "Categorie resettate per via del cambio di macro"

## Testing

### API (vitest, esistente)

`apps/api/src/modules/seller/services/brands.test.ts` (nuovo):

- `findOrCreateBrandByName` — happy path: crea quando non esiste.
- `findOrCreateBrandByName` — riusa: crea esiste già stesso name (case-insensitive).
- `findOrCreateBrandByName` — race: due chiamate concorrenti producono 1 solo brand.
- `listBrands` — filtro `q` case-insensitive.
- `listBrands` — scoping: non ritorna brand di altri seller.

`apps/api/src/modules/seller/services/products.test.ts` (esteso):

- `createProduct` con `brandName` → crea brand e associa.
- `createProduct` con `brandId` valido → associa.
- `createProduct` con `brandId` di altro seller → `ServiceError(404)`.
- `createProduct` con stesso EAN duplicato per stesso seller → 23505/409.
- `createProduct` con stesso EAN di altro seller → ok.
- `lookupProductByEan` — match con relations, `null` se non trovato, ordinamento `created_at DESC`.

### Frontend

Niente unit test (il repo non ha component testing setup, da CLAUDE.md). Verifica manuale browser tramite `bun run dev:seller` su `localhost:3003`:

- Golden path create: digito EAN noto → banner appare → "Compila campi" pre-compila → modifico prezzo → submit → prodotto creato.
- Golden path create senza EAN: lascio EAN vuoto → form normale → submit ok.
- Brand esistente: combobox suggerisce → seleziono → submit usa `brandId`.
- Brand nuovo: digito nome inesistente → opzione "Crea" → submit usa `brandName` → verificare che il brand appaia nella `GET /seller/brands` successiva.
- Macro change: cambio macro con sotto-cat selezionate → checkbox si svuotano + toast.
- Edit: apro prodotto esistente con EAN/brand/macro → defaultValues popolati correttamente.
- Edit: tolgo brand esistente → `brandId: null` salvato.
- Errore: provo a creare due prodotti con stesso EAN per stesso seller → toast con messaggio 409.

## Verifica prima del merge

1. `bun run typecheck` (root) — propaga tipi via Eden Treaty alle 3 frontend.
2. `bun run lint` (Biome).
3. `bun run test --filter='@bibs/api'`.
4. OpenAPI a `/openapi` mostra i nuovi endpoint con descrizioni italiane.
5. Manual browser test su `localhost:3003` (vedi testing frontend).

## Out of scope (esplicito)

- Ricerca/filtro prodotti per brand o EAN nelle list view del seller.
- Catalogo brand globale curato da admin.
- Validazione check digit EAN.
- Bulk edit brand su più prodotti.
- Modifica/cancellazione brand dal lato seller.
- Customer app: filtraggio per brand, mostrare brand in scheda prodotto.
- Admin app: gestione brand cross-seller.
