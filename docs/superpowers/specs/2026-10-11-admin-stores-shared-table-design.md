# Negozi in admin e kit liste condiviso — design

**Date:** 2026-10-11
**Status:** in revisione
**Riferimenti:** i percorsi puntano a `main` @ `ff91dbf` (dopo #263).

## Problema

1. **Admin → Negozi** è un segnaposto «Prossimamente» (`apps/admin/src/routes/_authenticated/stores.tsx`).
   L'API non ha un endpoint admin per i negozi.
2. **Le tabelle admin non somigliano a quelle seller.** `DataTable`, `SortableHeader`,
   `DataPagination`, `PageSizeSelector`, `TableColumnsToggle` ed `EmptyState` sono già in
   `packages/ui`: la differenza sta in ciò che le pagine montano attorno.

| | Seller | Admin |
|---|---|---|
| Shell | header sticky con blur, contenuto `flex min-h-0 min-w-0 flex-1 flex-col overflow-x-clip p-4` | header statico, contenuto `flex-1 p-4` |
| Padding celle | default `px-3` (orders, products, promotions) | `pl-6`/`pr-6` su prima e ultima colonna; in sellers e CRUD header `pl-4` e celle `pl-6` non allineati |
| Titolo | `<h1>` inline, `font-display font-semibold tracking-tight` | `PageHeader`, `text-2xl font-bold` |
| Ordinamento | `SortableHeader` (maiuscoletto) | `CategoryCrudPanel` (5 tab di Configurazioni) usa ancora `SortableHeadButton` |
| Ricerca | `InputGroup` con icona e «cancella» | `<Input>` nudo nel CRUD e in `billing/subscriptions` |
| Tabella | sempre `DataTable` | `billing/subscriptions` disegna `<Table>` a mano, con `Spinner` ed `EmptyState` fuori tabella |

**Scorrimento: identico.** Verificato nel browser (seller `/products`, 32 righe, finestra 900 px:
documento 2042 px). In entrambe le app scorre la finestra: lo `SidebarProvider` è `min-h-svh`,
quindi `h-full` delle liste seller e `flex-1 min-h-0 overflow-auto` sul `DataTable` non hanno
effetto. Il kit non cambia lo scorrimento; quelle classi seller restano (inerti, fuori scope).

Duplicazione: il footer di paginazione (~40 righe) è copiato in ~10 pagine; ricerca con debounce
sincronizzata con l'URL (input + `useDebouncedValue` + due `useEffect`, ~30 righe) in 4.

## Decisioni di prodotto

1. **Negozi eliminati: tab separata** «Eliminati». Le altre tab mostrano solo negozi vivi.
2. **Filtri: ricerca + tab per stato abbonamento** con conteggi, come la pagina Venditori.
3. **Il nome del negozio e del venditore portano a `/sellers/$sellerId`.** Niente pagina dettaglio
   negozio. Link nella cella, non riga cliccabile: tastiera e «apri in nuova scheda» funzionano.
4. **Seller è il modello.** Customer non ha tabelle: non si tocca.

## Approccio

Pezzi piccoli condivisi attorno a `DataTable`; ogni pagina tiene colonne, query e filtri.
Scartati: un `<ListPage>` guidato da configurazione (rigido: products ha selezione multipla,
filter sheet e colonne sticky) e la sola copia delle classi seller (lascia la duplicazione).

Due PR, in ordine:

- **PR 1 — `refactor/shared-list-kit`**: kit in `packages/ui`, migrazione admin e seller.
- **PR 2 — negozi admin**: endpoint + pagina, nati sul kit.

## PR 1 — Kit condiviso

### Componenti nuovi in `packages/ui/src/custom/`

**`page-header.tsx` — `PageHeader`**

```tsx
<PageHeader title={…} description={…}>{/* azioni a destra, opzionali */}</PageHeader>
```

Stile seller: `h1` `font-display text-2xl font-semibold tracking-tight`, descrizione
`text-muted-foreground text-sm`, wrapper `flex shrink-0 items-center justify-between gap-3`.
Sostituisce `apps/admin/src/components/page-header.tsx` (cancellato) e gli `<h1>` inline delle
liste seller (orders, products, promotions, team).

**`search-input.tsx` — `SearchInput`**

```tsx
<SearchInput
	value={routeQ ?? ""}          // valore confermato (URL o state)
	onValueChange={(q) => …}      // chiamato dopo il debounce, solo se cambia
	placeholder={…}
	aria-label={…}
	clearLabel={…}
	className="max-w-md"
/>
```

`InputGroup` con `SearchIcon` e bottone «cancella» (markup attuale di seller products). Tiene
il testo locale, lo debounce (300 ms, `useDebouncedValue`), chiama `onValueChange` quando il
valore deboundato differisce da `value`, e si riallinea quando `value` cambia da fuori
(back/forward). Nessuna dipendenza dal router: va bene sia con l'URL (users, sellers, products)
sia con state locale (`CategoryCrudPanel`, `billing/subscriptions`).

**`data-table-footer.tsx` — `DataTableFooter`**

```tsx
<DataTableFooter
	page={page}
	pageSize={limit}
	total={total}
	onPageChange={(next, options) => …}   // stessa firma di DataPagination
	onPageSizeChange={(size) => …}
	rangeLabel={(r) => (r.total === 1 ? m.users_pagination_range_one : m.users_pagination_range)(r)}
	labels={dataTableFooterLabels()}       // { rowsPerPage, pagination }
/>
```

Calcola `start`/`end`/`totalPages`, non rende nulla con `total === 0`. Markup del footer seller
attuale con `shrink-0`. Le chiavi `*_pagination_range(_one)` restano per entità (il nome cambia).
`dataTableFooterLabels()` si aggiunge a `lib/ui-labels.ts` di admin e seller accanto a
`dataPaginationLabels()`.

### Migrazioni

- **Shell admin** (`routes/_authenticated.tsx`): header sticky con blur e wrapper del contenuto
  come seller. Breadcrumb admin resta statica.
- **Padding**: via gli override `pl-4`/`pl-6`/`pr-6` di prima e ultima colonna (admin users,
  sellers, CRUD, holidays; seller team): tutte le tabelle col `px-3` di default.
- **Admin users, sellers**: `PageHeader`, `SearchInput`, `DataTableFooter`.
- **`CategoryCrudPanel`**: `SortableHeader` + `manualSorting` (stato locale → `SortingState`),
  `SearchInput`, `DataTableFooter`, `EmptyState` al posto del vuoto fatto a mano (via `emptyIcon`
  dalle 5 config: l'icona di `EmptyState` è fissata per variante). Il testo del range resta
  `labels.total(n)`.
- **`billing/subscriptions`**: passa a `DataTable` (colonne + `TableColumnsToggle`), due
  `SearchInput` a state locale (email venditore, nome negozio), `DataTableFooter`. Oggi interroga
  a ogni tasto: col debounce smette.
- **`CategoryCharacteristicsPanel`**: solo `SearchInput` al posto dell'`<Input>` con icona
  assoluta (filtro locale: col debounce risponde dopo 300 ms). Niente paginazione, layout
  invariato (vive in un dialog). `HolidaysPanel` non ha ricerca né paginazione: non si tocca.
- **Seller orders, products, promotions, team**: sostituzione meccanica con `PageHeader`,
  `SearchInput`, `DataTableFooter`. Refactor puro.
- **Cancellati**: `packages/ui/src/custom/sortable-table-head.tsx` (nessun uso rimasto),
  `apps/admin/src/components/page-header.tsx`.

### Fuori scope

Breadcrumb dinamica admin; tabelle a mano in `csv-import-dialog` (admin), `billing`,
`store/archived`, `included-products-list` (seller): piccole, non sono liste paginate.

### Verifica PR 1

- Vitest in `packages/ui`: `SearchInput` (debounce chiama una volta; `value` esterno riallinea;
  «cancella» svuota) e `DataTableFooter` (range `21–40 di 45`, nulla con `total=0`).
- Seller: diff dell'`outerHTML` prima/dopo sulle 4 liste (senza `data-tsd-source`): deve
  cambiare solo ciò che il kit uniforma, motivato riga per riga.
- Admin: Chrome DevTools MCP su users, sellers, Configurazioni (una tab), Abbonamenti —
  ordinamento, ricerca, back/forward con ricerca nell'URL, vuoto, dark mode.
- `bun run typecheck`, `bun run lint`, `bun run test`; smoke manuale di Marco prima della PR.

## PR 2 — Negozi in admin

### API — `apps/api/src/modules/admin`

**`GET /admin/stores`** — `query: StoreListQuery`, risposta `okPageRes(AdminStoreListItemSchema)`.

| Parametro | Valori |
|---|---|
| `page`, `limit` | `PaginationQuery` |
| `status` | `all` (default) · `active` · `past_due` · `suspended` · `none` · `deleted` |
| `search` | max 100; `ilike` su nome negozio, `organization.businessName`, nome comune |
| `sortBy` / `sortOrder` | `name` · `createdAt` (default) / `asc` · `desc` (default) |

Semantica di `status` (subscription in `LEFT JOIN store_subscription`, unica per negozio):

- `all`: `deleted_at IS NULL`
- `active`: vivo e subscription `active` o `canceling` (pagata fino a fine periodo)
- `past_due`, `suspended`: vivo e subscription con quello stato
- `none`: vivo e nessuna subscription oppure `canceled`
- `deleted`: `deleted_at IS NOT NULL`, qualunque abbonamento

Riga (`AdminStoreListItemSchema`):

```ts
{
	id, name, createdAt, deletedAt,           // deletedAt: Date | null
	sellerProfileId, businessName,            // da organization
	categoryName,                             // string | null
	municipality: { name, provinceAcronym },
	subscriptionStatus,                       // stato grezzo | null
}
```

**`GET /admin/stores/counts`** — `{ all, active, past_due, suspended, none, deleted }`, stessi
predicati della lista (una sola definizione SQL per stato, condivisa tra lista e conteggi).

Servizio in `services/stores.ts`, rotte in `routes/stores.ts`, query in `lib/queries.ts`, schema
in `lib/schemas`. Errori: nessun caso oltre ai `withErrors` standard.

**Test** (integration, testcontainer): un negozio per ogni stato + uno eliminato + uno senza
subscription; ogni `status` restituisce esattamente i suoi; `search` su ciascuno dei tre campi;
ordinamento; parità `counts[status] === list(status).pagination.total` per ogni stato.

### Pagina — `apps/admin/src/routes/_authenticated/stores.tsx`

Search params: `page`, `limit`, `q`, `status`, `sort`, `order` (come users/sellers).

- `PageHeader` → `SearchInput` → `TabNav` con conteggi: Tutti · Attivi · Rinnovo fallito ·
  Sospesi · Senza abbonamento · Eliminati («Rinnovo fallito» come il badge `billing_status_past_due`).
- Colonne: **Negozio** (link) · **Venditore** (link) · Categoria · Comune (`Bologna (BO)`) ·
  **Abbonamento** (`subscriptionStatusBadge`, «—» se null) · Creato il · toggle colonne.
  Ordinabili: Negozio, Creato il. In tab Eliminati in più la colonna «Eliminato il» (non ordinabile).
- `EmptyState`: vuoto senza filtri (`hideHeaderWhenEmpty`), «nessun risultato» con ricerca.
- `DataTableFooter`; `storageKey="admin.stores.columns"`.
- Messaggi `stores_*` in `apps/admin/messages/{it,en}.json`; `placeholder_stores_description`
  rimossa se non più usata.

### Verifica PR 2

API test verdi; Chrome DevTools MCP sul seed Bologna (86 negozi): tab e conteggi coerenti,
ricerca per comune, link al venditore, ordinamento, vuoto; dark mode; smoke manuale di Marco.
