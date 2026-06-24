# #2b — Catalogo prodotti del negozio (customer)

> Stato: design approvato · 2026-06-23 · branch `feat/customer-store-products`

## Contesto

La discovery negozi customer è arrivata fino a #132: endpoint pubblico
`GET /customer/stores/:id` + scheda di dettaglio `/stores/$storeId` (cover,
gallery, descrizione, orari, mappa, contatti). Il **catalogo prodotti del
negozio era esplicitamente rimandato da #2a**, perché richiede un endpoint
prodotti-per-negozio che non esiste: la ricerca prodotti (`GET /customer/search`)
è globale e geo-centrica, senza filtro `storeId`.

Questo sotto-progetto (#2b) aggiunge alla scheda dettaglio una sezione
**"Prodotti"** con la griglia dei prodotti venduti dal negozio, e l'endpoint che
la alimenta.

### Decisioni prese in brainstorming

- **Endpoint dedicato** `GET /customer/stores/:id/products`, **non** un filtro
  `storeId` su `/customer/search`. La ricerca è geo-centrica (DTO con `distance`
  richiesto, ranking per distanza, stock cross-store via `EXISTS`) e usa una
  visibilità diversa (`store.deletedAt IS NULL` soltanto, **non**
  `publiclyVisibleStore()`). Mescolare i due intreccerebbe modelli incompatibili
  e produrrebbe un campo `distance` privo di senso. Un endpoint annidato sul
  negozio ottiene gratis la **stessa semantica 404** del dettaglio.
- **Quali prodotti**: solo `store_products.stock > 0` in **questo** negozio +
  `product.status = 'active'`. Esauriti **nascosti** (coerente con discovery e
  ricerca), nessuna variante "Esaurito" da progettare.
- **Ordinamento**: default fisso **novità prima** (`created_at DESC`, tiebreaker
  `id ASC`). Nessun controllo di sort in #2b.
- **Visibilità**: il negozio nascosto (sospeso/cancellato/soft-deleted/senza
  subscription viva) torna **404**, specchio di `publiclyVisibleStore()` e del
  dettaglio. Niente deep-link a cataloghi di negozi nascosti.
- **Posizione UI**: la sezione "Prodotti" è il **primo blocco sotto la cover**
  (catalog-first) — è il motivo per cui si entra in un negozio.
- **Catalogo vuoto**: sezione **omessa del tutto** (coerente col pattern "ometti
  sezioni vuote" della scheda), niente empty-state ingombrante in cima.
- **`ProductTile`**: **estratto** da `features/discovery` in un modulo condiviso
  `features/catalog`, consumato sia da discovery sia dalla scheda negozio.

## Architettura

### 1. API — `GET /customer/stores/:id/products` (pubblico, no auth)

Handler aggiunto a `apps/api/src/modules/customer/routes/stores.ts` (accanto a
`GET /stores` e `GET /stores/:id`). Nuovo service
`apps/api/src/modules/customer/services/store-products.ts` — un file = uno
scopo, come la coppia `store-detail.ts` / `store-discovery.ts`.

**`getStoreProducts(storeId, { page, limit })`** — due query + annotazione:

1. **Guardia di visibilità** (distinta dal "catalogo vuoto"):
   `SELECT 1 FROM store WHERE id = :id AND publiclyVisibleStore() LIMIT 1`
   (riusa il predicato di `apps/api/src/lib/store-visibility.ts`). Nessuna riga →
   `throw new ServiceError(404, "Negozio non trovato")`. Serve un check separato:
   un risultato prodotti vuoto è un **200 con catalogo vuoto** (negozio visibile
   senza prodotti), mentre il negozio nascosto è **404** — i due casi non possono
   collassare in un'unica query.
2. **Query prodotti**: `product` JOIN `store_products` su
   `store_products.store_id = :id AND store_products.stock > 0 AND
   product.status = 'active'`. Select `id, name, description, price` + subquery
   immagini (`coalesce(json_agg(... ORDER BY pi.position), '[]')`). **Gotcha
   colonne non qualificate**: in un `sql` template usato come campo SELECT,
   Drizzle rende le Column interpolate senza qualificarle → in una subquery
   correlata `products.id` va scritto **letteralmente** e la tabella interna
   aliasata (`pi`), esattamente come in `search.ts`. `ORDER BY products.created_at
   DESC, products.id ASC`. `LIMIT/OFFSET` via `parsePagination`. Query
   `count(*)::int` parallela (stesso JOIN/WHERE) per `total`.
3. **Annotazione sconti**: `getBestActiveDiscounts(productIds)` (riuso del batch
   helper di `apps/api/src/modules/seller/services/discount-pricing.ts`) → mappa
   `discountedPrice` e `discountPercent` su ogni riga.

Ritorna `{ data, pagination: { page, limit, total } }`.

**Route**:
- `params: t.Object({ id: t.String(...) })`
- `query: PaginationQuery` (riuso da `apps/api/src/lib/pagination.ts`)
- `response: withErrors({ 200: okPageRes(StoreProductCardSchema) })` — il 404 è
  già nel set di `withErrors`.
- Body via `okPage(result.data, result.pagination)` di `apps/api/src/lib/responses.ts`.
- Tag OpenAPI: `Customer - Search`.

**DTO `StoreProductCardSchema`** (nuovo, in `apps/api/src/lib/schemas/entities.ts`
accanto a `SearchResultSchema`) — è `SearchResultSchema` **meno `distance`/`rank`**,
esattamente ciò che `ProductTile` consuma:

```
id: string
name: string
description: string | null
price: string                                   // decimale, es. "9.99"
images: { id, url, position }[]                 // ordinate per position
discountedPrice: string | null                  // se promo attiva
discountPercent: int | null                     // 1..99
```

> Niente `distance`/`rank` (non sei in ricerca geo). Niente
> `discountTitle`/`discountEndsAt`: il tile non li usa → si riduce la superficie
> di idratazione-date di Eden (stessa accortezza di #2a sul DTO dettaglio).

### 2. Frontend — sezione "Prodotti" catalog-first

Route file invariato come entry point: `apps/customer/src/routes/_authenticated/stores/$storeId.tsx`.

- **`apps/customer/src/features/stores/use-store-products.ts`** (nuovo) —
  `useInfiniteQuery` (mirror di `features/stores/use-store-search.ts`):
  - Query key `["store-products", storeId]`.
  - `queryFn` chiama `api().customer.stores({ id: storeId }).products.get({
    query: { page, limit } })` (treaty da confermare contro i tipi generati).
  - `getNextPageParam`: pagina successiva finché `page * limit < total`.
  - Page size **12** (3 righe piene sulla griglia `lg:grid-cols-4`).
  - Espone `products / hasNextPage / fetchNextPage / isFetchingNextPage /
    isPending / isError / refetch`, appiattendo le pagine.
  - Mappa al tipo dati del tile condiviso (vedi §3): nessuna distanza.
- **Posizione**: la sezione è il **primo blocco sotto la cover** (catalog-first),
  dentro il branch di successo di `$storeId.tsx`. Monta solo quando il dettaglio
  ha già caricato (negozio visibile); la query prodotti gira in parallelo,
  keyed sullo stesso `storeId`. Sotto seguono gallery, descrizione, orari, mappa,
  contatti (ordine esistente invariato).
- **Stati** (riuso dei pattern della discovery: `Notice`, `TileSkeleton`, griglia
  `GRID = "grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4"`):
  - **pending** → skeleton grid;
  - **error** → `Notice` con bottone "Riprova" (`refetch`);
  - **populated** → griglia di `ProductTile` (`showDistance={false}`) + bottone
    **"Carica altri"** quando `hasNextPage` (come `/stores`);
  - **empty** (`products.length === 0`) → **la sezione non viene renderizzata**
    affatto. Coerente col pattern "ometti sezioni vuote" della scheda; evita un
    riquadro vuoto come prima cosa sotto la cover.

### 3. Refactor in-scope — `ProductTile` condiviso

`ProductTile` oggi vive in `apps/customer/src/features/discovery/product-tile.tsx`
ed è tipizzato su `NearbyProduct` (che richiede `distance: number`). Il catalogo
negozio non ha mai distanza.

- **Estrarre** il tile + il suo tipo dati in `apps/customer/src/features/catalog/`:
  - `product-tile.tsx` — componente presentazionale (immagine con fallback
    iniziale, nome, `DiscountedPrice`, pill distanza opzionale). `distance`
    diventa **opzionale**; la pill appare solo con `showDistance && distance`.
  - tipo dati `ProductCardData` (`id, name, price, images, discountedPrice,
    discountPercent, distance?`), soddisfatto sia dal mapping discovery sia da
    quello store.
- **Aggiornare gli import** di `features/discovery/nearby-products.tsx` (e di
  `use-nearby-products.ts` se esporta il tipo riusato) al nuovo modulo. Refactor
  mirato "migliora il codice che tocchi" (precedente: l'estrazione di
  `open-status` in #2a). Nessun cambiamento visivo per la discovery.

## Testing

TDD sulla logica nuova (CLAUDE.md):

- **API** (harness `apps/api`): `getStoreProducts` —
  - Negozio visibile: ritorna i prodotti `stock>0 @ questo store` +
    `status='active'`, ordinati `created_at DESC`, con `discountedPrice` /
    `discountPercent` annotati e immagini ordinate per `position`.
  - **Esclude**: stock=0 in questo negozio, `status != 'active'`, prodotti di
    **altri** negozi (incluso un prodotto stoccato altrove ma con stock=0 qui).
  - **404** per: id inesistente, store soft-deleted, store senza subscription
    viva (sospeso/canceled) — specchio di `publiclyVisibleStore()`.
  - **Paginazione**: `total` corretto; offset pagina 2 restituisce il blocco
    successivo senza sovrapposizioni.
- **FE** (unit, opzionale): mappatura dell'hook `use-store-products` (è sottile).
- **Manuale/browser** (customer dev autenticato): sezione catalog-first sotto la
  cover, "Carica altri", prezzo scontato renderizzato, assenza di `[object Date]`,
  e il caso vuoto (sezione assente, non box vuoto).

## Fuori scope (→ futuro)

- **Pagina dettaglio prodotto**: il tile resta presentazionale (non-link), come
  in discovery — nessuna pagina prodotto ancora.
- Recensioni, preferiti, sort/filtri all'interno del catalogo del negozio.
- Il fix trasversale **`publiclyVisibleStore()` nella ricerca prodotti**
  (`/customer/search` usa solo `deletedAt`): resta deferito, **non** toccato qui.

## File toccati (riepilogo)

**API**
- `apps/api/src/modules/customer/routes/stores.ts` — nuovo `GET /stores/:id/products`
- `apps/api/src/modules/customer/services/store-products.ts` — nuovo service
- `apps/api/src/lib/schemas/entities.ts` — `StoreProductCardSchema`
- test del nuovo endpoint (cartella test API)

**Customer**
- `apps/customer/src/routes/_authenticated/stores/$storeId.tsx` — sezione Prodotti
- `apps/customer/src/features/stores/use-store-products.ts` — nuovo hook
- `apps/customer/src/features/catalog/product-tile.tsx` — tile estratto + tipo dati
- `apps/customer/src/features/discovery/nearby-products.tsx` — import aggiornati
- `apps/customer/src/features/discovery/use-nearby-products.ts` — import/tipo aggiornati (se serve)
