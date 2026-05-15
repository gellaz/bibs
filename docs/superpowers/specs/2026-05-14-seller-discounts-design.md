# Seller — Promozioni e sconti

**Data**: 2026-05-14
**Scope**: `apps/api`, `apps/seller`, `apps/customer` (estensione payload + display read-only)
**Out of scope**: `apps/admin`; snapshot del prezzo scontato sull'`order_item` al momento dell'acquisto; promo cart-level e codici sconto; importi fissi o prezzi finali specifici; aliquote IVA per prodotto; limite numero promo per seller (anti-abuso); E2E test frontend.

## Obiettivo

Permettere al venditore di creare e gestire **promozioni a percentuale di sconto** su un sottoinsieme dei propri prodotti, con periodo di validità e visibilità immediata sul prezzo lato cliente.

Una promozione ha titolo, percentuale (intero 1–99), data di inizio e una data di fine opzionale ("fino a esaurimento" = senza scadenza, fino a pausa/archivio manuale). Si associa a una **lista esplicita di prodotti** selezionati tramite un picker con filtri (search testuale, marca, categoria, macro-categoria, range prezzo, stato, disponibilità in stock). Il prezzo mostrato al cliente è calcolato a query-time scegliendo la promozione **più vantaggiosa per il cliente** (% più alta) tra quelle attive.

## Decisioni chiave (negoziate in brainstorming)

| Tema | Decisione |
|---|---|
| Tipo sconto | Solo percentuale, intero 1–99. Importo fisso e prezzo finale esplicito sono fuori scope (campagne diverse, eventuale spec futuro). |
| Granularità % | Intero (no decimali). I saldi italiani usano sempre interi (-10, -20, -50, -70). |
| IVA | **Esclusa dall'analisi**. Il prezzo del prodotto è l'unico riferimento, nessun flag/aliquota. |
| Overlap di promo sullo stesso prodotto | "Vince la migliore per il cliente": si applica la promo con `percent` più alto tra le attive (status `active`, in range temporale, non scadute). |
| Scope multi-store | Seller-wide. Una promo è del seller e vale in tutti i suoi negozi. Coerente con `product.price` unico. Nessuna tabella `discount_store`. |
| Lifecycle | Stato persistito `active | paused | archived`. Stati operativi `scheduled / running / expired` derivati dalle date in query, non persistiti. `paused` manuale (toggle), `archived` come soft-delete. Niente "bozza". |
| `endsAt` | **Nullable**. NULL = "fino a esaurimento" (gira finché il seller non pausa/archivia). |
| Assegnazione prodotti | Lista esplicita di product IDs in tabella di join `discount_products`. I filtri del picker sono solo strumento di ricerca; nuovi prodotti aggiunti dopo al catalogo NON entrano automaticamente nelle promo. |
| Filtri del picker prodotti | Obbligatori: search testuale (nome/EAN), marca, categoria, macro-categoria. Aggiuntivi confermati: range prezzo, stato prodotto, disponibilità in stock. |
| Scelta `text + CHECK` vs `pgEnum` | `text + CHECK` per `status` (policy bibs: default per colonne enumerate). |
| Editing post-start | `title`, `endsAt` (se futura), e set prodotti sono modificabili sempre. `percent` e `startsAt` modificabili solo se `now() < startsAt`. Tentativo contrario → 409 `ServiceError`. |
| Scope spec | Backend + seller UI + estensione payload customer con display read-only (badge "-X%" + prezzo barrato). Niente impatto su carrello/ordini. |
| Naming | UI italiano: "Promozioni" / "Promozione". DB e codice: `discount` / `discount_products`. Coerente con il resto del codebase in inglese. |
| Granularità input % | Input numerico (suffix "%"), non slider. Più preciso quando il seller vuole digitare "37". |
| Countdown UI customer | Niente live countdown. Solo "fino a {data}" se `endsAt` definito, altrimenti badge senza scadenza visibile. |
| UI editing prodotti | **Sheet laterale** full-height per il picker (non Dialog). Search debounced 300ms, bulk select "tutti i risultati visibili", footer con counter. |

---

## Architettura — Schema DB

### Nuovo file: `apps/api/src/db/schemas/discount.ts`

```ts
import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { product } from "./product";
import { sellerProfile } from "./seller";

export const discountStatuses = ["active", "paused", "archived"] as const;
export type DiscountStatus = (typeof discountStatuses)[number];

export const discount = pgTable(
  "discounts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sellerProfileId: text("seller_profile_id")
      .notNull()
      .references(() => sellerProfile.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    percent: integer("percent").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    status: text("status", { enum: discountStatuses })
      .default("active")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("discount_seller_profile_id_idx").on(table.sellerProfileId),
    index("discount_status_idx").on(table.status),
    index("discount_period_idx").on(table.startsAt, table.endsAt),
    check("discount_percent_range", sql`${table.percent} BETWEEN 1 AND 99`),
    check(
      "discount_period_valid",
      sql`${table.endsAt} IS NULL OR ${table.endsAt} > ${table.startsAt}`,
    ),
    check(
      "discount_status_valid",
      sql`${table.status} IN ('active','paused','archived')`,
    ),
    check("discount_title_non_empty", sql`length(trim(${table.title})) > 0`),
  ],
);

export const discountRelations = relations(discount, ({ one, many }) => ({
  sellerProfile: one(sellerProfile, {
    fields: [discount.sellerProfileId],
    references: [sellerProfile.id],
  }),
  discountProducts: many(discountProduct),
}));

export const discountProduct = pgTable(
  "discount_products",
  {
    discountId: text("discount_id")
      .notNull()
      .references(() => discount.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.discountId, table.productId] }),
    index("discount_products_product_id_idx").on(table.productId),
  ],
);

export const discountProductRelations = relations(discountProduct, ({ one }) => ({
  discount: one(discount, {
    fields: [discountProduct.discountId],
    references: [discount.id],
  }),
  product: one(product, {
    fields: [discountProduct.productId],
    references: [product.id],
  }),
}));
```

Re-export da `apps/api/src/db/schemas/index.ts`.

### Note schema

- `endsAt` nullable. CHECK `discount_period_valid` ammette `endsAt IS NULL`.
- Niente unique constraint sul titolo: il seller può legittimamente creare due promo con lo stesso nome (es. "Saldi estivi" nel 2026 e nel 2027).
- Cascade su `seller_profile_id`: rimuovere un seller rimuove le sue promo.
- Cascade su `product_id` in `discount_products`: cancellare un prodotto lo rimuove dalla promo senza distruggere la promo.
- Indice composto `(startsAt, endsAt)` per supportare le query "running / scheduled / expired".

---

## Stato operativo (derivato in query)

Lo stato persistito è `active | paused | archived`. Lo stato operativo mostrato all'utente è derivato:

| `status` | `startsAt` vs `now()` | `endsAt` vs `now()` | Stato operativo |
|---|---|---|---|
| `paused` | * | * | **paused** |
| `archived` | * | * | **archived** (nascosta dalla lista principale) |
| `active` | `now() < startsAt` | * | **scheduled** |
| `active` | `now() ≥ startsAt` | `endsAt IS NULL OR now() ≤ endsAt` | **running** |
| `active` | `now() ≥ startsAt` | `endsAt IS NOT NULL AND now() > endsAt` | **expired** |

Una promo `expired` resta in `status='active'` finché il seller non la archivia esplicitamente. Si può comunque pausare e modificare `endsAt` per riavviarla.

---

## Architettura — API

### Schemi TypeBox

Nuovo file `apps/api/src/lib/schemas/discount.ts` con:

- `DiscountSchema` (entità completa)
- `DiscountListItemSchema` (lista, include `productCount` e `operationalState` calcolati)
- `DiscountCreateSchema` (body POST)
- `DiscountUpdateSchema` (body PATCH, tutti i campi opzionali)
- `DiscountProductsAddSchema` / `DiscountProductsRemoveSchema` (`productIds: string[]`, max 100)
- `DiscountListQuerySchema` (page, limit, state, search)

Tutti con `description` in italiano, re-export da `apps/api/src/lib/schemas/index.ts`.

### Modulo: `apps/api/src/modules/seller/routes/discounts.ts`

Pattern coerente con `products.ts`:
- `okRes()` / `okPageRes()` da `responses.ts`
- `withErrors()` / `withConflictErrors()`
- `ServiceError` per errori di business; pg unique violations gestite dal global handler
- `{ auth: true }` su tutte le route + macro `auth`
- `description` OpenAPI in italiano

| Method | Path | Scopo |
|---|---|---|
| `GET` | `/seller/discounts` | Lista paginata. Query: `page`, `limit`, `state` (filtra su stato operativo), `search` |
| `GET` | `/seller/discounts/:id` | Dettaglio promo + `productCount` |
| `GET` | `/seller/discounts/:id/products` | Prodotti inclusi, paginati, con prezzo originale + scontato |
| `POST` | `/seller/discounts` | Crea. Body: `title`, `percent`, `startsAt`, `endsAt?`, `initialProductIds?` |
| `PATCH` | `/seller/discounts/:id` | Modifica campi. Errore 409 se campo bloccato (vedi regole sotto) |
| `POST` | `/seller/discounts/:id/pause` | Toggle pausa/riprendi (status `active` ⇄ `paused`) |
| `POST` | `/seller/discounts/:id/archive` | Soft-delete (status → `archived`). Errore 409 se già archived |
| `POST` | `/seller/discounts/:id/products` | Aggiungi prodotti. Idempotente (ON CONFLICT DO NOTHING). Response: `{ added, alreadyPresent }` |
| `DELETE` | `/seller/discounts/:id/products/:productId` | Rimuovi singolo |
| `DELETE` | `/seller/discounts/:id/products` | Rimuovi bulk. Body: `productIds: string[]` |

### Estensione: `GET /seller/products`

Già esistente. Aggiungo query params opzionali (tutti coerenti col picker UI):

- `brandId?: string`
- `productCategoryId?: string`
- `productMacroCategoryId?: string`
- `minPrice?: number` / `maxPrice?: number`
- `inStock?: boolean` (true → almeno una riga in `store_products` con `stock > 0` in qualunque negozio del seller)
- `excludeDiscountId?: string` (utile in modifica: nel picker, escludo prodotti già nella promo corrente — la UI può usarlo)

**Cambiamento `storeId`**: oggi è required; nel modulo seller diventa **opzionale**. Se assente → query seller-wide (tutti i prodotti del `sellerProfileId` corrente, indipendentemente dalla presenza in `store_products`). Necessario perché il picker della promo è seller-wide, non legato al negozio attivo. Le call esistenti che passano `storeId` continuano a funzionare invariate.

`statusFilter` esiste già (active/disabled/trashed). Default invariato.

### Customer payload

Endpoint customer prodotti (lista + dettaglio) estesi con 5 campi opzionali in response:

```ts
{
  // …campi esistenti
  originalPrice: string,          // = product.price (sempre presente)
  discountedPrice: string | null, // null se nessuna promo attiva
  discountPercent: number | null,
  discountTitle: string | null,
  discountEndsAt: string | null,  // ISO, null se promo senza scadenza
}
```

**Default proposto**: mantenere il campo `price` esistente come prezzo "di listino" (semantica invariata per i consumer Eden Treaty già scritti) e aggiungere SOLO i 4 campi `discount*`. Il consumer chiama `discountedPrice ?? price` per scegliere quale mostrare. Niente duplicato `originalPrice`. Se in fase di implementazione si scopre che un consumer esistente assume che `price` sia sempre il "prezzo finale", si valuta allora la rinomina; ma da audit veloce non risulta.

### Helper riusabile: `withActiveDiscount(productsQuery)`

In `apps/api/src/modules/customer/services/` (o utility condivisa), un helper che annota una query Drizzle su `product` con LATERAL JOIN alla "miglior promo attiva". Pseudocodice SQL:

```sql
SELECT p.*,
  d.id   AS discount_id,
  d.title AS discount_title,
  d.percent AS discount_percent,
  d.ends_at AS discount_ends_at,
  CASE WHEN d.id IS NOT NULL
       THEN ROUND(p.price * (1 - d.percent::numeric / 100), 2)
       ELSE NULL
  END AS discounted_price
FROM products p
LEFT JOIN LATERAL (
  SELECT d.id, d.title, d.percent, d.ends_at
  FROM discounts d
  JOIN discount_products dp ON dp.discount_id = d.id
  WHERE dp.product_id = p.id
    AND d.seller_profile_id = p.seller_profile_id
    AND d.status = 'active'
    AND now() >= d.starts_at
    AND (d.ends_at IS NULL OR now() <= d.ends_at)
  ORDER BY d.percent DESC, d.starts_at DESC
  LIMIT 1
) d ON true
WHERE p.id = ANY(:ids);
```

Centralizzare qui evita di sparpagliare la logica "miglior promo" tra endpoint customer (lista, dettaglio, search).

### Regole di business

1. **Editing post-start**: in `PATCH /seller/discounts/:id`, se `now() ≥ startsAt` (cioè la promo è running/expired), accetta solo `title` ed `endsAt` (futura, > now). Tentativo di modificare `percent` o `startsAt` → 409 `ServiceError("Promo già iniziata: campo non modificabile")`. Modifica del set prodotti (`POST /products`, `DELETE /products`) è sempre permessa.
2. **Pause/archive coerenti**: pausa di una promo `archived` → 409. Archive di una promo `archived` → 409 (no-op).
3. **Ownership prodotti**: in `POST /seller/discounts/:id/products`, ogni `productId` deve avere `sellerProfileId` uguale a quello della promo. Filtro in WHERE; productId non corrispondenti finiscono in `rejected: []` nella response.
4. **Validazioni TypeBox**: `percent` integer 1–99; `title` 1–80 caratteri trimmati; `startsAt` ISO timestamp; `endsAt` ISO o null; `productIds` array di 1–100 stringhe uuid.
5. **Bulk limits**: max 100 IDs per `POST /products` e `DELETE /products`. Validato in TypeBox.

---

## Architettura — UI seller

### Navigazione

Nuova voce in `apps/seller/src/components/app-sidebar.tsx`:
- Label: "Promozioni" (Paraglide chiave `nav_promotions`)
- Icona: lucide `TagIcon` (alternativa `PercentIcon`)
- Posizione: tra "Prodotti" e "Team"

### Routes (TanStack Start file-based)

```
apps/seller/src/routes/_authenticated/
  promotions.tsx              ← layout (breadcrumb "Promozioni")
  promotions/
    index.tsx                 ← lista
    new.tsx                   ← form creazione
    $discountId.tsx           ← dettaglio/modifica
```

### Lista — `/promotions`

- Header: `<h1>Promozioni</h1>` + `<Button asChild><Link to="/promotions/new">Nuova promozione</Link></Button>`
- Tabs di filtro stato operativo: `Tutte | In corso | Pianificate | In pausa | Scadute | Archiviate` (pattern analogo a `ProductStatusTabs`, file `PromotionStateTabs.tsx`)
- Tabella `@bibs/ui` con colonne:
  - Titolo (link → dettaglio)
  - Sconto (`<Badge>-X%</Badge>`)
  - Periodo: `12 mag → 25 mag 2026` oppure `12 mag 2026 → ∞`
  - N° prodotti (link → tab "Prodotti" del dettaglio)
  - Stato (pill colorato: in corso=success, pianificata=info, pausa=warning, scaduta=muted, archiviata=muted)
  - Azioni: kebab menu (`DropdownMenu`) con `Modifica`, `Pausa`/`Riprendi`, `Archivia`
- Paginazione (`DataPagination` + `PageSizeSelector`)
- Empty state per tab vuoto

### Form crea/modifica

`/promotions/new` e `/promotions/$discountId` condividono `<DiscountForm>` (in `src/features/promotions/components/`):

- React Hook Form + `@hookform/resolvers` + Zod schema specchio del TypeBox API
- Campi base:
  - **Titolo** (`<Input>`, max 80)
  - **% Sconto** (`<Input type="number" min={1} max={99} step={1}>` con suffix "%")
  - **Periodo**:
    - `<DatePicker>` Inizio
    - `<Switch>` "Senza data di fine" (`endsAtUndefined` controllato)
    - `<DatePicker>` Fine (disabled se switch on)
  - Sotto-sezione "Prodotti inclusi":
    - Counter "X prodotti selezionati"
    - `<Button>` "Aggiungi prodotti" → apre `<ProductPickerSheet>`
    - Tabella inline dei prodotti già inclusi con "Rimuovi" per riga e bulk select

Comportamento submit:
- `/new` → `POST /seller/discounts` con `initialProductIds` (se selezionati). Redirect a `/promotions/$id`.
- `/$id` (modifica) → `PATCH` per campi base; aggiunta/rimozione prodotti via `POST`/`DELETE` separati. Errori 409 mappati a inline form errors.

Disabilitazione campi sensibili:
- Calcolare lato client `isStarted = now() >= form.startsAt` (best effort) E rispettare 409 server-side se l'utente by-passa.
- Disabled UI per `percent` e `startsAt` se promo running/expired.

### Product Picker — `<ProductPickerSheet>`

Componente in `src/features/promotions/components/product-picker-sheet.tsx`. Aperto come `<Sheet>` shadcn da destra, full-height.

- Header del Sheet: titolo "Aggiungi prodotti alla promozione"
- Filter row (sticky in alto, sotto header):
  - `<Input>` Search (debounced 300ms, search su nome + EAN)
  - `<Combobox>` Marca (popolato da `useBrands()`)
  - `<Combobox>` Macro-categoria (`useMacroCategories()`)
  - `<Combobox>` Categoria (dipendente dalla macro, `useCategories(macroId)`)
  - Range prezzo: due `<Input type="number">` (min, max)
  - `<Switch>` "Solo in stock"
  - `<Switch>` "Includi disabilitati"
  - Pulsante "Reset filtri"
- Tabella prodotti con checkbox + indicatore "Già in altra promo" (badge giallo informativo, non blocca):
  - Colonne: ☐ · Nome · Marca · Prezzo · Stock totale · Indicatori
- Bulk select: "Seleziona tutti i risultati visibili" / "Deseleziona tutti"
- Footer sticky: `X selezionati · <Button>Aggiungi</Button>`
- Comportamento `Aggiungi`:
  - In `/new`: passa gli ID al form-state (Hook Form `useFieldArray` o array semplice in state)
  - In `/$id`: chiama `POST /seller/discounts/:id/products` con `productIds`, mostra toast "X aggiunti, Y già presenti", invalida query lista prodotti della promo

Query usata: `GET /seller/products` con i nuovi parametri `brandId`, `productCategoryId`, `productMacroCategoryId`, `minPrice`, `maxPrice`, `inStock`, `statusFilter`, più `excludeDiscountId` (in modifica) per nascondere quelli già inclusi.

### i18n

Tutte le stringhe in `apps/seller/messages/it.json` (e specchio `en.json`) con prefisso `promotions_*` / `discount_*`. Niente hard-coded.

### Componenti `@bibs/ui` riusati

Tutti già presenti: `Button`, `Input`, `Badge`, `Table`, `Tabs`, `Sheet`, `Dialog`, `AlertDialog`, `DatePicker`, `Combobox`, `Switch`, `Spinner`, `DataPagination`, `PageSizeSelector`, `DropdownMenu`. Nessun nuovo componente UI da creare nel package shared (eccetto eventuale `<DiscountedPrice>` — vedi sezione customer).

---

## Architettura — UI customer (display read-only)

### Modifiche

1. **Nuovo componente `<DiscountedPrice>`** in `packages/ui/src/components/discounted-price.tsx`:
   - Props: `originalPrice: string | number`, `discountedPrice: string | number | null`, `percent: number | null`
   - Render: se `discountedPrice` null → solo prezzo originale. Altrimenti: prezzo scontato in evidenza, prezzo originale barrato `<span className="line-through text-muted-foreground">`, badge "-X%"
   - Coerente con `DESIGN.md`: badge in colore Saffron, prezzo scontato in Ink scuro, hierarchy tipografica chiara
2. **Card prodotto customer**: sostituire l'attuale render del prezzo con `<DiscountedPrice>`
3. **Pagina dettaglio prodotto customer**:
   - `<DiscountedPrice>` in posizione prezzo principale
   - Sotto, pill informativa: "Promozione: {discountTitle}" + (se `discountEndsAt`) "fino al {data}"
   - Nessun countdown live

### Calcolo prezzo

Lato DB tramite `withActiveDiscount` helper: `ROUND(price * (1 - percent::numeric / 100), 2)` come `numeric(10,2)`. Rounding default PostgreSQL "half away from zero": 19,99 × 0,80 = 15,99 (accettabile).

`percent ≤ 99` garantisce `discounted_price > 0` finché `price > 0`. Il CHECK esistente `product_price_non_negative` resta valido.

---

## Edge cases

1. **Prodotto `trashed` incluso in promo attiva**: gli endpoint customer già filtrano `status='trashed'`, quindi non viene mostrato. Lato seller picker: di default mostriamo solo `active` + `disabled` (toggle per includere `trashed` non in MVP, fuori scope).
2. **Promo con `endsAt` nullable e `percent` editato dopo l'inizio**: bloccato dalla regola di business (409 server-side).
3. **Fuso orario**: tutti i timestamp `timestamptz`. UI converte in `Europe/Rome` per visualizzazione tramite l'helper di formattazione data esistente.
4. **Snapshot ordini**: fuori scope. Se una promo scade dopo un ordine, lo storico ordini non riflette più la promo. Affrontato in spec futuro quando il modulo ordini sarà maturo.
5. **Cancellazione hard di una promo**: non supportata. Solo `archived` (soft-delete). Per il purge fisico, fuori scope.
6. **Concorrenza nell'aggiunta prodotti**: `INSERT ... ON CONFLICT (discount_id, product_id) DO NOTHING`. Response indica `{ added, alreadyPresent, rejected }`.
7. **Cancellazione di un prodotto referenziato in promo**: cascade `ON DELETE CASCADE` su `discount_products.product_id`. Il prodotto sparisce dalla promo, la promo continua con gli altri prodotti.
8. **Cancellazione di un seller**: cascade `ON DELETE CASCADE` su `discount.seller_profile_id`. Tutte le sue promo cancellate.
9. **Tentativo di aggiungere prodotto di altro seller**: ricerca per `sellerProfileId` mismatch → rejected nella response, mai inserito.
10. **Promo "expired" mai archiviata**: resta in `status='active'`, lo stato operativo derivato è `expired`. Listata nella tab "Scadute".
11. **Riavvio di una promo scaduta**: il seller modifica `endsAt` a una data futura (consentito, basta che `endsAt > now()` e quindi `> startsAt`, dato che `startsAt < now()`). Lo stato operativo torna `running`.

---

## Testing

### Unit (Bun test, `apps/api`)

- `services/discount.service.test.ts`:
  - `getBestActiveDiscount(productId)`: nessuna promo → null; una promo running → quella; due running con percent diversi → quella più alta; una in pausa → ignorata; una scaduta → ignorata; una scheduled → ignorata; due running stesso percent → la più recente (ORDER BY startsAt DESC tiebreaker).
  - `updateDiscount(id, patch)`: success su `title` sempre; success su `percent` se scheduled; 409 su `percent` se running/expired; 409 su `startsAt` se running/expired.
  - `addProductsToDiscount(id, productIds)`: filtra cross-seller (rejected non vuoto); idempotenza (ON CONFLICT); rispetto del limite 100.
  - `pauseDiscount`/`archiveDiscount`: 409 se stato non valido.

### Integration (testcontainers Postgres, `apps/api`)

- CHECK constraints (`percent` 0/100/-1, `endsAt < startsAt` con e senza NULL, `status` invalido, `title` empty/whitespace).
- Cascade su delete seller / delete product.
- LATERAL JOIN su `withActiveDiscount`: composizione con paginazione e ordinamento.
- Indici applicati (verifica via `EXPLAIN`).
- Idempotenza ON CONFLICT su `discount_products`.

### Manuale pre-PR

- `bun run typecheck` (root, propaga via Eden Treaty)
- `bun run lint`
- `bun run test`
- `bun run dev:seller`: creare promo, includere prodotti via picker (testare tutti i filtri), verificare i 5 stati operativi (in corso, pianificata, pausa, scaduta, archiviata), modificare campi sensibili/non sensibili.
- `bun run dev:customer`: aprire lista prodotti e dettaglio, verificare badge "-X%", prezzo barrato, pill promozione.
- `bun run db:generate` → leggere SQL → `bun run db:migrate`.

---

## Strategia di migrazione

1. `bun run db:generate` produce migration SQL con le due nuove tabelle e i CHECK.
2. Leggere il SQL generato. Verifiche manuali:
   - Indici nominati come da spec.
   - CHECK constraints riportati nel formato `discount_*`.
   - FK con `ON DELETE CASCADE` corrette.
3. `bun run db:migrate` su DB locale.
4. Test integrazione con testcontainers (parte di `bun run test`).

Nessun seed change necessario. Eventuale seed di esempio (1–2 promo demo) può essere aggiunto in `apps/api/src/db/seed/` ma non è bloccante.

---

## Componenti del lavoro (per piano di implementazione)

Suddivisione naturale per il follow-up con `writing-plans`:

1. **Schema + migration** (`apps/api`): file `schemas/discount.ts`, re-export, db:generate, review SQL.
2. **Schemi TypeBox** (`apps/api`): `lib/schemas/discount.ts`.
3. **Modulo seller discount** (`apps/api`): route, service, ownership validation, regole editing.
4. **Estensione `GET /seller/products`** (`apps/api`): nuovi query params.
5. **Helper `withActiveDiscount`** (`apps/api`): logica miglior promo, integrazione in endpoint customer.
6. **Test API**: unit + integration.
7. **Componente `<DiscountedPrice>`** (`packages/ui`).
8. **Seller UI lista promozioni** (`apps/seller`): route, tabs, tabella, actions.
9. **Seller UI form crea/modifica** (`apps/seller`): form, validazioni, disabilitazione campi sensibili.
10. **Seller UI product picker Sheet** (`apps/seller`): filtri, bulk select, integrazione con form / API.
11. **Customer UI display** (`apps/customer`): card + dettaglio prodotto con `<DiscountedPrice>`.
12. **i18n**: chiavi Paraglide in tutti i frontend toccati.
13. **Verifica finale**: typecheck, lint, test, dev manuale su tutti e 3 i frontend.

## Follow-up noti (fuori scope, da affrontare in spec futuri)

- Snapshot del prezzo scontato sull'`order_item` al momento dell'acquisto (richiede modulo ordini maturo).
- Promo cart-level / codici sconto.
- Sconti come importo fisso o prezzo finale specifico.
- Aliquote IVA per aliquota a livello prodotto (se mai serviranno per fatturazione elettronica).
- Limite anti-abuso al numero di promo per seller.
- Auto-terminazione su esaurimento scorte (oggi: solo manuale dal seller).
- UI admin per supervisione promozioni cross-seller.
- Cron di auto-archiviazione promo scadute da N giorni.
