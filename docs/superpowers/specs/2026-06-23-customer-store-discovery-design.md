# Spec — Customer store discovery (#1: endpoint + lista UI)

> Data: 2026-06-23 · Branch: `feat/customer-store-discovery`
>
> Questo è il **sotto-progetto #1** di un lavoro più ampio ("ricerca per negozio" lato
> customer), decomposto in:
>
> 1. **Store discovery — endpoint + lista UI** ← *questa spec*
> 2. Dettaglio negozio — endpoint `GET /customer/stores/:id` + pagina dettaglio (spec separata, dopo)
>
> Ogni sotto-progetto ha il suo ciclo spec → plan → implementazione.

## Obiettivo

Dare al customer una **ricerca per negozio**: un endpoint pubblico che restituisce i
negozi ordinati per vicinanza all'utente, con ricerca testuale **opzionale**. Se non
viene passato testo, restituisce **tutti** i negozi visibili (paginati). Più una UI di
ricerca/esplorazione nell'app customer.

## Contesto esistente (verificato)

- La ricerca prodotti `GET /customer/search`
  (`apps/api/src/modules/customer/services/search.ts`) usa PostGIS
  (`ST_DWithin`/`ST_Distance` su `::geography`, SRID 4326) e full-text italiano. È
  montata **fuori dal guard auth** in `apps/api/src/modules/customer/index.ts:16`
  → l'endpoint negozi sarà pubblico allo stesso modo.
- `stores` (`apps/api/src/db/schemas/store.ts`): `location` geometry point SRID 4326
  (indice GIST `store_location_idx`, **nullable**), `deletedAt` soft-delete,
  `categoryId`, `openingHours`/`closures` jsonb, `municipalityId` NOT NULL.
  Relazioni: `images` (`store_images`: `url`, `position`), `subscription`,
  `category`, `municipality`.
- `store_subscriptions` (`store-subscription.ts`): `status ∈ {active, past_due,
  canceling, suspended, canceled}`. La ricerca prodotti **non** filtra per
  subscription (solo `deletedAt IS NULL`) → noto finding "suspended visibili".
- `municipalities` → `name` (città) + `provinceId` → `provinces.acronym` (sigla, es. "MI").
- Open-status: dominio puro già esistente in `apps/api/src/lib/holidays`
  (`resolveStoreClosedDates`, `getOpenStatus`, fuso `Europe/Rome`). Il seller lo usa
  in batch in `apps/api/src/modules/seller/services/stores.ts:81-129`.
- Categorie negozio pubbliche: `GET /store-categories`
  (`apps/api/src/modules/store-categories.ts`, montato al root, no auth) → fonte per
  il filtro categoria nella UI.
- Eden treaty idrata le stringhe data → `Date` lato client (anche date-only): il campo
  `openStatus.opensAt.date` va coerced con `toYMD`.
- App customer: route sotto `_authenticated` (`apps/customer/src/routes/`), discovery
  "Vicino a te" in `apps/customer/src/features/discovery/` con pattern geolocalizzazione
  (idle/pending/granted/denied/unsupported) in `nearby-products.tsx`.

## API — `GET /customer/stores` (pubblico, no auth)

### Query params (tutti opzionali)

| param | tipo | effetto |
|---|---|---|
| `q` | string | match `ILIKE '%q%'` su **nome negozio** OR **nome comune** (case-insensitive) |
| `categoryId` | string | filtro `store.categoryId` |
| `lat`, `lng` | number | posizione utente → ordine per vicinanza + campo `distance` (metri) |
| `radius` | number (km) | **opzionale, spento di default**; se passato filtra entro N km (`ST_DWithin`) |
| `page`, `limit` | number | paginazione (`parsePagination`, cap 100, default limit 20) |

Schema in `apps/api/src/lib/queries.ts` come `StoreSearchQuery` (riusa lo stile di
`ProductSearchQuery`). `lat`/`lng` validati in range, `radius` opzionale senza default.

### Visibilità — predicato condiviso

Un negozio è **pubblicamente visibile** sse:

- `deletedAt IS NULL`, **e**
- esiste una `store_subscriptions` con `status ∈ {active, past_due, canceling}`.

Esclude: soft-deleted, `suspended`, `canceled`, e negozi senza subscription.
Estratto in `apps/api/src/lib/store-visibility.ts` come frammento SQL riusabile
(es. `publiclyVisibleStore()` → `EXISTS (...)`). La ricerca prodotti **non** viene
modificata in questo sotto-progetto (adozione del predicato lì = follow-up separato,
fuori scope).

### Ordinamento

Composto, deterministico:

1. `relevance` **solo se `q` presente** (CASE):
   - `2` se `name ILIKE q || '%'` (prefisso sul nome)
   - `1` se `name ILIKE '%' || q || '%'` (nome contiene)
   - `0` altrimenti (match solo via comune)
   - `relevance DESC`
2. se geo (`lat`/`lng`): `distance ASC` con **`NULLS LAST`** (negozi senza `location`
   in fondo)
3. `name ASC`
4. `id ASC` (tiebreaker stabile → paginazione deterministica)

Casi:
- geo + testo → relevance, distanza, alfabetico
- geo, no testo → distanza, alfabetico
- no geo + testo → relevance, alfabetico
- no geo, no testo → puramente alfabetico

`distance` = `ST_Distance(stores.location::geography, ST_SetSRID(ST_MakePoint(lng,
lat),4326)::geography)` (metri), `NULL` quando geo assente o `location` nulla. La
distanza è sul record `stores` direttamente (no subquery correlata come nei prodotti),
quindi niente trappola di qualificazione colonne nel main query.

### Response — `StoreCardSchema` (paginato)

```jsonc
{
  "id": "string",
  "name": "string",
  "category": { "id": "string", "name": "string" } | null,
  "city": "string",          // municipality.name
  "province": "string|null", // provinces.acronym (es. "MI")
  "addressLine1": "string",
  "distance": "number|null", // metri, presente solo con geo
  "image": { "url": "string" } | null, // immagine a position minima
  "openStatus": {            // dal dominio holidays
    "isOpen": "boolean",
    "status": "open|closed|closed_holiday",
    "closesAt": "string?",                 // se aperto (HH:MM)
    "opensAt": { "date": "YYYY-MM-DD", "time": "HH:MM" } "?" // se chiuso
  }
}
```

Schema in `apps/api/src/lib/schemas/entities.ts` (`StoreCardSchema`) + export
nell'index. Riusa lo schema `OpenStatus` già presente (`schemas/composed.ts`).

L'immagine primaria via subquery `(SELECT url FROM store_images WHERE store_id =
stores.id ORDER BY position LIMIT 1)` — attenzione al gotcha "colonne non qualificate
nei campi SELECT": alias interno + riferimento letterale `stores.id`.

### Open-status batch (riuso + estrazione)

`apps/api/src/modules/seller/services/stores.ts:81-129` fa già: carica
`holidayDefinition` attive (una volta) + `storeHolidayOptout` per gli store-id della
pagina, raggruppa gli opt-out, poi per ogni store `resolveStoreClosedDates` +
`getOpenStatus` (now in `Europe/Rome`, finestra 60gg).

→ **Estrarre** questa logica in un helper condiviso
`apps/api/src/lib/store-open-status.ts`:
`resolveOpenStatuses(stores: Array<{ id, openingHours, closures }>, now: Date):
Map<string, OpenStatus>`. Sia il seller sia la nuova store-discovery lo usano (no
duplicazione). Risolto **solo per i negozi della pagina corrente**.

### File API

- NEW `apps/api/src/lib/store-visibility.ts` — predicato `publiclyVisibleStore()`
- NEW `apps/api/src/lib/store-open-status.ts` — `resolveOpenStatuses()` (estratto dal seller)
- EDIT `apps/api/src/modules/seller/services/stores.ts` — usa l'helper estratto
- NEW `apps/api/src/modules/customer/services/store-discovery.ts` — query + assemblaggio
- NEW `apps/api/src/modules/customer/routes/stores.ts` — route pubblica
- EDIT `apps/api/src/modules/customer/index.ts` — monta `storesRoutes` fuori dal guard
- EDIT `apps/api/src/lib/queries.ts` — `StoreSearchQuery`
- EDIT `apps/api/src/lib/schemas/entities.ts` (+ index) — `StoreCardSchema`

## UI customer

- **Nuova route** `apps/customer/src/routes/_authenticated/stores/index.tsx`
  (URL `/stores`). `q`/`categoryId` nei **search param** validati (TanStack Router);
  la geo dal browser (non in URL).
- **Feature module** `apps/customer/src/features/stores/`:
  - `store-tile.tsx` — immagine (fallback iniziale), nome, categoria, città, pill
    distanza (solo se geo concessa & `distance != null`), badge Aperto/Chiuso +
    riga "Chiude alle 19:30" / "Apre domani 9:00" (da `openStatus`).
  - `use-store-search.ts` — React Query; **paginazione: "Carica altri"
    (`useInfiniteQuery`)**; query key su `[q, categoryId, lat, lng]`.
  - hook geolocalizzazione **estratto** dal pattern inline di `nearby-products.tsx`
    (riusabile da entrambe le superfici): stati idle/pending/granted/denied/unsupported.
- **Input ricerca** in cima (debounced → aggiorna `q`) + **filtro categoria**
  (da `GET /store-categories`).
- **Stati**: skeleton in load; empty differenziato (no testo → "esplora i negozi" /
  con testo → "nessun risultato per '…'"); error + retry.
- **Theming**: superfici theme-aware (`background/foreground/muted/border`), token fissi
  solo per accenti — verifica dark via `localStorage.theme='dark'` (evita testo
  invisibile in dark).
- **Date hydration**: coerce `openStatus.opensAt.date` con `toYMD` lato client
  (creare `apps/customer/src/lib/date.ts` se non esiste, come seller/admin).
- **Entry point**: voce "Negozi" → `/stores` nella top app bar condivisa (PR #130) +
  eventuale CTA "Esplora i negozi" vicino alla sezione discovery in home.

### File UI

- NEW `apps/customer/src/routes/_authenticated/stores/index.tsx`
- NEW `apps/customer/src/features/stores/{store-tile,use-store-search}.tsx/.ts`
- NEW/EDIT hook geolocalizzazione condiviso (estratto da `nearby-products.tsx`)
- EDIT top app bar / home per l'entry point
- NEW `apps/customer/src/lib/date.ts` se mancante

## Testing

- **API (TDD, testcontainer harness)** — file in `apps/api/src/modules/customer/`:
  - visibilità: esclude soft-deleted, `suspended`, `canceled`, senza-subscription;
    include `active`/`past_due`/`canceling`
  - match testo: nome (prefisso e contains) e comune; relevance ordering
  - geo: ordine per distanza ascendente; `location` nulla → `NULLS LAST`; campo
    `distance` presente/assente
  - fallback senza geo: ordine alfabetico
  - paginazione: `total` corretto, ordine stabile tra pagine
  - open-status: negozio con una `closures` → `status` atteso
- **Frontend**: smoke browser manuale (a carico di Marco, come da prassi).

## Note / decisioni prese in brainstorming

- Visibilità = **solo abbonamento "vivo"** (active/past_due/canceling).
- Geo = **tutti i negozi ordinati per vicinanza** (nessun raggio fisso; `radius`
  opzionale spento di default).
- Fallback senza posizione = **alfabetico A→Z**.
- Ricerca testo = **nome + comune (ILIKE)** + **filtro categoria** separato.
- Tile = badge **Aperto/Chiuso + orario di oggi**.
- Paginazione UI = **"Carica altri"** (infinite), confermata.

## Fuori scope (sotto-progetto #2)

- Endpoint `GET /customer/stores/:id` e pagina dettaglio negozio.
- Adozione del predicato `publiclyVisibleStore()` nella ricerca prodotti (follow-up).
- Tile/prodotti cliccabili verso il dettaglio (dipende dal #2).
