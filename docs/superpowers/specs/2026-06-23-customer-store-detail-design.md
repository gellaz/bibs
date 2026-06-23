# #2a — Scheda dettaglio negozio (customer)

> Stato: design approvato · 2026-06-23 · branch `feat/customer-store-detail`

## Contesto

La discovery negozi customer è arrivata fino a #131: endpoint pubblico
`GET /customer/stores` (lista/ricerca) + pagina `/stores` con griglia di
`StoreTile`. Manca il passo successivo: la **scheda di dettaglio** su cui si
atterra toccando un tile. Oggi `StoreTile` è puramente presentazionale e **non
naviga da nessuna parte**.

Questo sotto-progetto (#2a) costruisce la **vetrina/identità** del negozio:
header con foto, stato apertura, orari, posizione su mappa, contatti,
descrizione. Il **catalogo prodotti del negozio è esplicitamente rimandato a
#2b** (richiede un endpoint prodotti-per-negozio che oggi non esiste — la
ricerca prodotti è globale, senza filtro `storeId`).

### Decisioni prese in brainstorming

- **Scope**: solo vetrina/identità. Prodotti → #2b.
- **Mappa**: interattiva (Leaflet + tile OpenStreetMap, no API key). Va resa
  **client-only** per non rompere l'SSR di TanStack Start.
- **Route**: `/stores/$storeId` sotto `_authenticated` (coerente con
  home/lista). Pagine pubbliche/condivisibili + SEO = progetto futuro a parte.
- **Layout**: **cover full-bleed + sezioni** a colonna singola.
- **Visibilità**: i negozi non-visibili (sospesi/cancellati/soft-deleted/senza
  subscription viva) tornano **404** — niente deep-link a negozi nascosti.

## Architettura

### 1. API — `GET /customer/stores/:id` (pubblico, no auth)

Handler aggiunto a `apps/api/src/modules/customer/routes/stores.ts` (accanto
all'esistente `GET /stores`). Nuovo service
`apps/api/src/modules/customer/services/store-detail.ts` — `store-discovery.ts`
resta dedicato a lista/ricerca (un file = uno scopo).

`getStoreDetail(id)`:

- Query store `WHERE id = :id AND publiclyVisibleStore()` (riusa il predicato di
  `apps/api/src/lib/store-visibility.ts`). Nessuna riga → `throw new
  ServiceError(404, "Negozio non trovato")`. Questo applica al dettaglio la
  **stessa visibilità della lista**: un negozio nascosto non è deep-linkabile.
- Join `municipality` + `province` (name, acronym) e `storeCategory` (name).
- Carica **tutte** le `storeImage` ordinate per `position`, e i
  `storePhoneNumber` ordinati per `position`.
- Coordinate: la colonna `store.location` è `geometry` mode `xy` → in JS arriva
  come `{ x, y }` (vedi `apps/api/src/modules/seller/services/stores.ts:100`).
  Mappatura **`lng = x`, `lat = y`**. Può essere `null` (location nullable) →
  `coordinates: null`, la mappa non viene mostrata.
- `openStatus` live via `resolveOpenStatuses([{ id, openingHours, closures }],
  new Date())` di `apps/api/src/lib/store-open-status.ts` (già holiday-aware).

**DTO `StoreDetail`** (schema `StoreDetailSchema` in
`apps/api/src/lib/schemas/entities.ts`, accanto a `StoreCardSchema`):

```
id: string
name: string
description: string | null
category: { id, name } | null
municipality: { id, name, provinceAcronym }
addressLine1: string
addressLine2: string | null
zipCode: string
coordinates: { lat: number; lng: number } | null
images: { id, url }[]            // ordinate per position
phoneNumbers: { id, label: string|null, number }[]   // ordinate per position
websiteUrl: string | null
openingHours: OpeningHoursDay[] | null   // settimanale grezzo, dayOfWeek 0=Lun..6=Dom
openStatus: OpenStatus           // riusa OpenStatusSchema
```

> **Niente `closures` nel DTO**: lo `openStatus` le incorpora già (incl.
> festività), quindi non servono al client e riducono la superficie di
> idratazione-date di Eden.

Route response: `withErrors({ 200: okRes(StoreDetailSchema), 404: ... })` usando
`okRes`/`withErrors` di `apps/api/src/lib/schemas/responses.ts` e il body via
`ok(detail)` di `apps/api/src/lib/responses.ts`. `OpenStatusSchema` è in
`apps/api/src/lib/schemas/holidays.ts`. Tag OpenAPI: `Customer - Search`.

### 2. Frontend — route + pagina

Route file: `apps/customer/src/routes/_authenticated/stores/$storeId.tsx`.

Il layout `_authenticated` rende `<main className="flex-1"><Outlet/></main>`
**senza container** e le pagine si auto-vincolano → la cover può essere
**full-bleed** mentre le sezioni sotto usano `mx-auto max-w-3xl`.

**Composizione (cover full-bleed + sezioni, mobile-first):**

- **Cover hero** full-bleed: sfondo `images[0]` `object-cover` + **scrim**
  gradiente (`bg-gradient-to-t from-ink/70`) per il contrasto. Sovrapposti, in
  **token fissi** (`text-cream` su foto — regola fixed-vs-theme: token fissi per
  accenti/su-foto, theme-aware per le superfici): nome (font-display grande),
  `categoria · comune (PR)`, **badge stato apertura**. Back-link "‹ Negozi" in
  alto a sinistra su backdrop sottile.
- **Fallback senza foto**: cover con gradiente brand (saffron) + iniziale
  grande, niente scrim (nessun rischio contrasto).
- **Gallery**: se `images.length > 1`, striscia orizzontale a scorrimento sotto
  l'header (presentazionale; nessun lightbox in #2a).
- **Sezioni** (container `max-w-3xl`, separatori sottili):
  - **Descrizione** — solo se presente.
  - **Orari** — vedi componente `opening-hours`.
  - **Dove siamo** — mappa Leaflet + indirizzo completo + bottone "Apri in
    Mappe" (link universale Google Maps su `lat,lng`: apre app nativa su mobile,
    web su desktop; non richiede la posizione dell'utente). Sezione omessa se
    `coordinates` è `null`.
  - **Contatti** — telefoni come `tel:` link, sito come link esterno
    (`rel="noopener noreferrer"`). Sezione omessa se non c'è nulla.

### 3. Componenti (in `apps/customer/src/features/stores/`)

- **`use-store-detail.ts`** — `useQuery` su `api().customer.stores({ id }).get()`
  (treaty da confermare contro i tipi generati; mirror di
  `use-store-search.ts:49`). Coercion **`toYMD()`** su
  `openStatus.opensAt.date` come nella lista (`@/lib/date`) — Eden idrata le
  stringhe-data in `Date`.
- **`open-status.tsx`** (condiviso) — **estrai** `describeOpensAt` + la logica
  della label dallo `StoreTile` (`store-tile.tsx:38-80`) in un modulo riusato da
  tile e scheda. Refactor in-scope ("migliora il codice che tocchi").
- **`store-cover.tsx`** — hero/fallback + identità + badge.
- **`opening-hours.tsx`** — formatta `openingHours` in it-IT: giorni **Lun–Dom**
  (`dayOfWeek` 0=Lun..6=Dom, convenzione confermata in
  `apps/api/src/lib/holidays/types.ts:20` e `dates.ts:20`), slot multipli uniti
  ("09:00–13:00 · 16:00–19:00"), giorni assenti = "Chiuso", **oggi evidenziato**
  (Europe/Rome). Funzione di formattazione **pura** (testabile).
- **`store-map.tsx`** — **client-only**: mount-gate (`useState(false)` →
  `true` in `useEffect`; finché non montato, placeholder/skeleton con
  l'indirizzo) per non toccare `window` in SSR. `react-leaflet` + `leaflet`,
  tile OSM con attribution. Marker come **`divIcon`** (pin in HTML) per evitare
  la gotcha degli asset-marker col bundler. Import di `leaflet/dist/leaflet.css`.
- **`StoreTile`** → avvolto in `<Link to="/stores/$storeId" params={{ storeId:
  store.id }}>`. La navigazione dalla griglia discovery (`stores/index.tsx`) è
  **parte di #2a**.

Nuove dipendenze su `apps/customer`: `leaflet`, `react-leaflet`,
`@types/leaflet`.

## Testing

TDD sulla logica nuova (CLAUDE.md):

- **API** (harness `apps/api`): `getStoreDetail` —
  - DTO completo per negozio visibile: immagini e telefoni **ordinati** per
    `position`, `coordinates` corrette (lat=y, lng=x), category + municipality.
  - **404** per: id inesistente, store soft-deleted, store senza subscription
    viva (sospeso/canceled) — specchio di `publiclyVisibleStore()`.
  - `openStatus` presente.
- **FE** (unit, `apps/customer`): formatter `opening-hours` — merge slot,
  evidenziazione "oggi", giorni chiusi, mapping `dayOfWeek` 0=Lun.
- **Manuale/browser**: mappa Leaflet (montaggio client-only, marker, tile),
  cover (con/senza foto, contrasto in dark via `localStorage.theme='dark'`),
  assenza `[object Date]` su `opensAt`. Su pagina autenticata vera
  (customer dev).

## Fuori scope (→ #2b e oltre)

- **Catalogo prodotti del negozio** → #2b (nuovo endpoint prodotti-per-negozio /
  filtro `storeId` sulla ricerca).
- Pagine pubbliche/condivisibili (logged-out) + SEO.
- Recensioni, preferiti, "distanza da te" sul dettaglio.
- Lista esplicita chiusure/festività imminenti (lo `openStatus` live le copre
  già per lo stato corrente).

## File toccati (riepilogo)

**API**
- `apps/api/src/modules/customer/routes/stores.ts` — nuovo `GET /stores/:id`
- `apps/api/src/modules/customer/services/store-detail.ts` — nuovo service
- `apps/api/src/lib/schemas/entities.ts` — `StoreDetailSchema`
- test del nuovo endpoint (cartella test API)

**Customer**
- `apps/customer/src/routes/_authenticated/stores/$storeId.tsx` — nuova route
- `apps/customer/src/features/stores/use-store-detail.ts`
- `apps/customer/src/features/stores/open-status.tsx` — estratto da `store-tile`
- `apps/customer/src/features/stores/store-cover.tsx`
- `apps/customer/src/features/stores/opening-hours.tsx` (+ test)
- `apps/customer/src/features/stores/store-map.tsx`
- `apps/customer/src/features/stores/store-tile.tsx` — wrap in `<Link>` + riuso `open-status`
- `apps/customer/package.json` — `leaflet`, `react-leaflet`, `@types/leaflet`
