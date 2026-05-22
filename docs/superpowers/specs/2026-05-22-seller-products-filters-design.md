# Filtri (prezzo + categoria) e sort di default `updatedAt` nella lista prodotti seller

**Data**: 2026-05-22
**Scope**: `apps/seller/src/routes/_authenticated/products/index.tsx` (URL state + integrazione), nuovi componenti in `apps/seller/src/features/products/components/` (filter bar + popover), `apps/api/src/modules/seller/services/products.ts` (sort default).
**Out of scope**: filtro brand, filtro `inStock`, multi-select categoria, slider prezzo, filtro al solo livello macro, persistenza filtri in localStorage, customer/admin app, qualsiasi cambio al contratto API (i query params filtro sono già supportati).

## Obiettivo

Dare al seller due capacità nella lista `/products`:

1. **Filtrare** il catalogo per **prezzo** (min/max) e per **categoria** (foglia, single-select).
2. Vedere di default i prodotti **ordinati per ultimo aggiornamento decrescente**, così che le righe modificate di recente siano in cima.

Il backend `GET /seller/products` già accetta `productCategoryId`, `minPrice`, `maxPrice` e sa ordinare per `updatedAt` — quindi il lavoro è quasi interamente frontend + un cambio del default lato service.

## Decisioni chiave (negoziate in brainstorming)

| Tema | Decisione |
|---|---|
| Superficie filtri | Popover "Filtri" accanto alla search + chip rimovibili sotto. Niente Sheet, niente riga inline sempre visibile. |
| Granularità categoria | Single-select sulla **categoria foglia**, dropdown searchable raggruppato per macro come header visivo (non cliccabile). Niente cascade macro→foglia, niente multi-select, niente macro-only. |
| Stile prezzo | Due `Input` numerici **Min** / **Max** con suffisso €. Vuoto = nessun bound. Niente slider. |
| Sort default | `updatedAt DESC, createdAt DESC` (tiebreaker stabile). Cambia lato service. |
| Colonna `Aggiornato` | Visibile di default (perché è il campo di sort di default). `Creato` resta nascosta. |
| URL state | I filtri vivono in URL come `categoryId`, `minPrice`, `maxPrice` — coerente con `q`, `sort`, `order`, `statusFilter`. |
| Mutation timing filtri | Categoria applica subito al clic. Prezzo: stato locale debounced 300 ms (stesso pattern della search). |
| Reset paginazione | Ogni cambio di filtro setta `page: 1`. |
| Backend changes | Solo cambio del default di sort. Nessun nuovo endpoint, nessuna migration, nessun nuovo schema. |
| YAGNI esplicito | Niente filtro brand / inStock / multi-cat / slider / Sheet. Si aggiungeranno solo se un seller li chiederà. |

---

## Architettura — Backend

### Cambio del sort default in `listProducts`

File: `apps/api/src/modules/seller/services/products.ts`.

Nel `switch(sort)` interno alla funzione, il branch `default` (eseguito quando `sort === undefined`) passa da:

```ts
default:
  return [desc(product.createdAt)];
```

a:

```ts
default:
  return [desc(product.updatedAt), desc(product.createdAt)];
```

Razionale del tiebreaker: due righe con identico `updatedAt` (es. dump iniziale o creazione + nessuna successiva modifica) tornano in ordine deterministico per `createdAt`, evitando jitter di paginazione tra una request e l'altra.

Nessun cambio al case `searchActive` (lì vince la rilevanza, immutato).

### Test (`apps/api/src/modules/seller/services/products.test.ts`)

- Aggiungere un caso che verifica: senza `sort` esplicito, le righe arrivano ordinate per `updatedAt` decrescente.
- Aggiungere un caso con due prodotti che hanno lo stesso `updatedAt` per verificare il tiebreaker `createdAt DESC`.
- Verificare che nessun test esistente sull'ordine "createdAt come default" si rompa (se esiste, va aggiornato al nuovo default).

### Contratto API

**Invariato.** I query params `productCategoryId`, `minPrice`, `maxPrice` esistono già nella TypeBox schema della route. Eden Treaty resta type-coerente lato seller. Niente bump di OpenAPI semantics oltre al cambio comportamentale del default.

---

## Architettura — Frontend (apps/seller)

### URL state esteso

In `apps/seller/src/routes/_authenticated/products/index.tsx`, estendere il `validateSearch`:

```ts
validateSearch: (search: Record<string, unknown>): {
  page: number;
  limit: number;
  statusFilter: ProductStatusFilter;
  q?: string;
  sort?: ProductSortField;
  order?: SortOrder;
  categoryId?: string;
  minPrice?: string;
  maxPrice?: string;
} => { … }
```

Parsing:
- `categoryId`: stringa non vuota o omessa.
- `minPrice`, `maxPrice`: stringhe che matchano `^\d+(\.\d{1,2})?$` (stesso regex del backend). Se la stringa non matcha → omessa. Decimali normalizzati a `.` (non `,`).

### Nuovi componenti

#### `ProductsFilterBar`

File: `apps/seller/src/features/products/components/products-filter-bar.tsx`.

Props:

```ts
interface ProductsFilterBarProps {
  categoryId?: string;
  minPrice?: string;
  maxPrice?: string;
  onChange: (next: {
    categoryId?: string;
    minPrice?: string;
    maxPrice?: string;
  }) => void;
}
```

Responsabilità:
- Renderizza il pulsante `[Filtri ▾]` che apre `ProductsFilterPopover`.
- Sotto, una riga di `Badge` chip — una per ogni filtro attivo — con un `XIcon` per rimuovere.
- Il pulsante mostra un contatore (es. `Filtri · 2`) quando ci sono filtri attivi.
- Le chip:
  - **Categoria**: `Categoria: Vino ✕`. Risolve l'id in nome via la stessa query React di sotto (cache key condivisa).
  - **Prezzo**: format intelligente — `Prezzo: 5–25 €` se entrambi, `Prezzo: ≥ 5 €` se solo min, `Prezzo: ≤ 25 €` se solo max.
- Clic su ✕ → chiama `onChange` con quel singolo filtro rimosso (non resetta gli altri).

#### `ProductsFilterPopover`

File: `apps/seller/src/features/products/components/products-filter-popover.tsx`.

Props: identiche a `ProductsFilterBar` + `open`, `onOpenChange`.

Contenuto dentro `<Popover>`:

```
┌────────────────────────────────────┐
│ Categoria                          │
│ [ Cerca categoria…              ▾]│
│   ─ CIBO & BEVANDE ────────────── │
│     Vino                          │
│     Birra                         │
│   ─ ABBIGLIAMENTO ─────────────── │
│     Scarpe                        │
│                                    │
│ Prezzo                             │
│   Min [ 5,00     € ]               │
│   Max [ 25,00    € ]               │
│                                    │
│              [Reset]               │
└────────────────────────────────────┘
```

- **Categoria**: un `<Command>` con `<CommandInput>` per la ricerca; `<CommandGroup heading={macroName}>` non cliccabili come header; `<CommandItem>` per ogni foglia. Stato selezionato: pallino o check a sinistra. Clic su una foglia → chiama `onChange({ categoryId: id })` ma **il popover resta aperto** (così l'utente può anche regolare il prezzo nella stessa interazione). Voce "Tutte le categorie" in cima per resettare solo questo filtro. Il popover si chiude solo via clic fuori, `Esc`, o ri-clic sul trigger — stesso pattern dei Popover Radix standard.
- **Prezzo**: due `Input` separati, `inputMode="decimal"`. Stato locale `localMin` / `localMax`, sincronizzato con prop via `useEffect`. `useDebouncedValue(300)` su entrambi → quando cambia, chiama `onChange({ minPrice: …, maxPrice: … })`. Errore inline "Min superiore a max" se entrambi valorizzati e `min > max` numericamente, ma NON blocca la chiamata (l'utente potrebbe essere a metà digitazione). Conversione `,` → `.` al volo, riformat in display IT (5,00 €) solo on-blur.
- Footer: pulsante **Reset** che azzera tutti e tre i filtri in una chiamata.

Dati categoria: una sola useQuery con `queryKey: ["product-categories", "all"]`, `queryFn: api()["product-categories"].get({ query: { page: 1, limit: 200 } })`. La risposta include `macroCategory` perché lo schema della relazione lo nesta — verificare lo schema esatto al momento dell'implementazione (vedi `apps/api/src/lib/schemas`). Se non lo includesse di default, due query in parallelo (`product-macro-categories` + `product-categories`) e join client-side.

### Modifiche a `products/index.tsx`

1. Aggiungere `categoryId`, `minPrice`, `maxPrice` al `validateSearch` (sopra).
2. Aggiungerli al `Route.useSearch()` destructuring.
3. Aggiungerli al `queryKey` di `useQuery` e ai query params di `api().seller.products.get`.
4. Sopra `<ProductStatusTabs>`, inserire `<ProductsFilterBar … />` collegato a `navigate({ search: prev => ({ ...prev, …next, page: 1 }) })`.
5. `INITIAL_COLUMN_VISIBILITY`: rimuovere `updatedAt: false` (la colonna diventa visibile di default). `brand` e `ean` restano nascosti.
6. La logica `emptyMessage` esistente continua a funzionare — il messaggio "no results" è già scelto in base a `q.length > 0` / `statusFilter`. Per coerenza, se `q.length === 0` ma ci sono filtri attivi, lasciare il messaggio status-based attuale è accettabile (è già "Nessun prodotto attivo" che è vero anche con filtri).

### Reset locale on URL change

Stesso pattern già usato per `localQ`: `useEffect(() => setLocalMin(routeMin), [routeMin])` e analogo per max. Garantisce coerenza su back/forward.

---

## Error / edge cases

| Caso | Comportamento |
|---|---|
| `categoryId` in URL ma non esiste / non del seller | Backend filtra a zero risultati → empty state esistente. Chip resta visibile, l'utente la rimuove. |
| `minPrice` > `maxPrice` numericamente | Inline hint "Min superiore a max". Mandiamo comunque i due valori al backend, che ritornerà 0 risultati. Non blocchiamo l'input. |
| Input prezzo con `,` decimale | Convertito a `.` prima di mettere in URL. Display visualizza `,` se l'utente l'aveva digitato. |
| Categoria query in errore | Popover mostra `<CommandEmpty>Errore caricamento categorie</CommandEmpty>`. |
| Catalogo seller con molte categorie (>200) | `limit: 200` di default. Se cresce, scrollabile dentro `<CommandList>`. La ricerca text-side filtra istantaneamente. |
| Filtro attivo + paginazione su `page=5` poi cambio filtro | Reset a `page: 1` (regola applicata in tutti i toggle filtro). |
| `searchActive` (`q` valorizzato) + filtri | I filtri si applicano in AND con la ricerca (backend già fa così). Sort = rilevanza, indipendente da `updatedAt` default. |

---

## Test

### Backend

- `apps/api/src/modules/seller/services/products.test.ts`:
  - **Nuovo**: con `sort` undefined, le righe arrivano ordinate per `updatedAt DESC`.
  - **Nuovo**: due prodotti con identico `updatedAt` → tiebreaker `createdAt DESC`.
  - **Aggiornare** (se esistente) qualsiasi test che asseriva il vecchio default `createdAt DESC` come "default sort".

### Frontend

- Niente unit test (pattern del repo). Verifica manuale via dev server:
  - Filtro categoria applica e mostra chip, ✕ rimuove, popover si chiude.
  - Filtro prezzo con debounce: digitare e vedere request partire dopo ~300 ms.
  - Reset svuota tutti i filtri.
  - URL state condiviso: copiare l'URL con filtri attivi e aprire in nuova tab → stato ripristinato.
  - Default sort: arrivare sulla pagina senza `?sort` → header "Aggiornato" visibile e ordine `desc` su `updatedAt`.
  - Back/forward del browser: ripristinano filtri correttamente.

### Verification gate

`bun run typecheck` (root) + `bun run test --filter @bibs/api` + dev server visivo prima di merge.

---

## File toccati / creati

```
apps/api/src/modules/seller/services/products.ts                  (modified — sort default)
apps/api/src/modules/seller/services/products.test.ts             (modified — nuovi test)

apps/seller/src/routes/_authenticated/products/index.tsx          (modified — URL state + integrazione)
apps/seller/src/features/products/components/products-filter-bar.tsx       (new)
apps/seller/src/features/products/components/products-filter-popover.tsx   (new)
```

## DB migrations

**Nessuna.** Schema invariato.
