# Vista mappa nella ricerca negozi customer — design

**Date:** 2026-09-15
**Status:** approved, not implemented
**Riferimenti:** i riferimenti `file:riga` puntano allo stato pre-implementazione (base `4e9ae92`)
**Branch:** `feat/customer-store-map-view`

## Problema

`/stores` nell'app customer è una griglia di card con un rail di filtri
(`apps/customer/src/routes/_authenticated/stores/index.tsx`). Funziona per
scorrere un elenco, ma nasconde l'unica cosa che conta in un marketplace di
commercio locale: **dove sono i negozi, uno rispetto all'altro e rispetto a
me**. Oggi l'utente può leggere "450 m" su una card alla volta; non può vedere
che tre delle botteghe che sta confrontando sono sulla stessa via.

La mappa esiste già nel prodotto, ma solo al singolare: la scheda negozio monta
un Leaflet con un pin (`apps/customer/src/features/stores/store-map.tsx`). Manca
la vista plurale.

**Il blocco tecnico è nel contratto API.** `GET /customer/stores` non
restituisce le coordinate: `StoreCardSchema`
(`apps/api/src/lib/schemas/entities.ts:686`) espone `distance` ma non
`lat`/`lng`, e le coordinate vivono solo nel dettaglio
(`services/store-detail.ts:105`). Inoltre la lista pagina a 20 risultati per
volta, mentre una mappa ha senso solo se mostra *tutto* ciò che corrisponde ai
filtri: i pin non si "scorrono".

## Scope

**Dentro:** un secondo modo di leggere la ricerca negozi — toggle Lista/Mappa su
`/stores`, pin raggruppati in cluster, popup con mini-card, stato nell'URL, e
l'endpoint che serve i pin.

**Fuori, deliberatamente:**

- **Ricerca per riquadro** ("cerca in quest'area" mentre si trascina la mappa).
  La mappa è un'altra lettura degli stessi risultati, non una seconda ricerca:
  spostarla non cambia il set. Due nozioni di "dove" (raggio dalla posizione
  utente + riquadro visibile) andrebbero riconciliate, ed è una decisione che
  merita la sua iterazione.
- **La mappa nella home** (`/customer/search` e la sezione "Vicino a te"):
  questa iterazione tocca solo `/stores`, come il filtro "Aperti ora" (#173).
- **Hover su una card che evidenzia il pin**: non esiste una vista in cui card e
  mappa sono visibili insieme, quindi non c'è niente da evidenziare.

## Decisioni

1. **La mappa mostra gli stessi risultati della lista.** Stessi filtri, stesso
   `total`. Trascinare o zoomare non rifà la ricerca.
2. **La mappa prende il posto della griglia**, nella stessa colonna. Il rail dei
   filtri resta dov'è e non viene toccato: una sola versione dei filtri da
   mantenere, e passare da lista a mappa non perde nulla di ciò che l'utente ha
   selezionato.
3. **Clustering dei marker** invece di un tetto basso ai pin. I negozi vicini si
   aggregano in bolle numerate che si aprono zoomando; è il comportamento che
   una mappa densa deve avere, e regge la crescita del catalogo. Il tetto resta
   solo come valvola di sicurezza (500).
4. **Tap sul pin = popup mini-card sulla mappa**, non navigazione diretta.
   Confrontare due negozi non deve costare due navigazioni e due indietro.
5. **Endpoint dedicato** `GET /customer/stores/map`, con il payload minimo che
   serve al popup. Una richiesta sola, e la vista lista resta identica a oggi.

### Alternative scartate

- **Coordinate dentro `StoreCardSchema` + la mappa scorre le pagine.** Nessun
  endpoint nuovo, ma cinque richieste per 500 negozi, campi inutili alla mappa
  su ogni pagina, e i pin che compaiono a ondate sotto gli occhi dell'utente.
- **Endpoint di soli pin (`id`, `lat`, `lng`) + mini-card richiesta al tap.**
  Il payload più leggero possibile, ma ogni tap costa un giro di rete e apre un
  popup da riempire. Il guadagno si vede solo oltre le migliaia di pin; a quel
  punto la mappa avrà comunque bisogno della ricerca per riquadro, ed è lì che
  questa scelta andrà riaperta.
- **Split desktop lista + mappa** (stile Airbnb). La pagina ha già un rail di
  filtri: diventerebbe a tre colonne, con card da 1-2 per riga, e su mobile
  servirebbe comunque un toggle.

## Contratto API

### `GET /customer/stores/map` (pubblico, no auth)

**Query:** `t.Omit(StoreSearchQuery, ["page", "limit"])` — cioè `q`,
`categoryId`, `macroCategoryId`, `lat`, `lng`, `radius`, `openNow`, con la
stessa semantica della lista (`apps/api/src/lib/queries.ts:98`). Stessa scelta
già fatta per `/stores/facets` (`routes/stores.ts:53`), che pure vive senza
paginazione.

**Response:** `okRes(StoreMapSchema)`

```ts
StoreMapPinSchema = t.Object({
  id: t.String(),
  name: t.String(),
  coordinates: t.Object({ lat: t.Number(), lng: t.Number() }),
  category: t.Nullable(t.Object({ id: t.String(), name: t.String() })),
  municipality: MunicipalityCompactSchema,
  distance: t.Nullable(t.Number({ minimum: 0 })),
  image: t.Nullable(t.Object({ url: t.String() })),
  openStatus: OpenStatusSchema,
});

StoreMapSchema = t.Object({
  pins: t.Array(StoreMapPinSchema),
  total: t.Integer(),      // negozi che corrispondono ai filtri (= total della lista)
  mappable: t.Integer(),   // quanti di quelli hanno una posizione
  truncated: t.Boolean(),  // mappable > MAP_PIN_CAP
});
```

`total`, `mappable` e `pins.length` sono tre numeri diversi di proposito:

- `total` è lo stesso numero che la lista mostra sopra i risultati. Se la mappa
  ne calcolasse uno suo, le due viste si contraddirebbero a schermo.
- `mappable` esclude i negozi senza `stores.location` (la colonna è nullable:
  `apps/api/src/db/schemas/store.ts:38`). Il delta `total - mappable` è ciò che
  la UI dichiara, invece di lasciare all'utente il sospetto che manchino dei
  pin.
- `pins.length` è `min(mappable, 500)`; oltre quella soglia `truncated` è
  `true`.

**Ordinamento** (decide *quali* pin sopravvivono al tetto): distanza crescente
se c'è la posizione, altrimenti nome. Cioè il criterio della lista meno la
rilevanza testuale, che su una mappa non ha un significato spaziale.

**Registrazione:** prima di `/stores/:id` (`routes/stores.ts:87`), come già fa
`/stores/facets`.

### Condizioni di filtro condivise

`store-discovery.ts:44` e `store-facets.ts:54` costruiscono lo stesso array di
condizioni (`publiclyVisibleStore()`, testo, raggio, `openNow`) in due copie già
oggi. Un terzo consumatore è il momento di estrarre:

```ts
// services/store-search-conditions.ts
export function storeFilterConditions(params: {
  q?: string; categoryId?: string; macroCategoryId?: string;
  lat?: number; lng?: number; radius?: number;
}): ReturnType<typeof sql>[]
```

`openNow` resta **fuori** dall'helper, che così è sincrono: i facet hanno
bisogno di `openNowCondition()` come pezzo separato per contare "quanti
sarebbero aperti" a filtro spento (`store-facets.ts:71`), quindi ogni chiamante
la compone come gli serve. Allo stesso modo i facet continuano a non passare
`categoryId`/`macroCategoryId` — è la loro regola, non un dettaglio da travasare
nell'helper: un facet che applicasse la categoria selezionata mostrerebbe solo
il ramo aperto.

Nessuna factory generica sopra le route Elysia: l'estrazione è un helper di
servizio, che è esattamente il caso permesso
(vedi `feedback_elysia_betterauth_factory_generics`).

### Servizio

`services/store-map.ts` → `getStoreMapPins(params)`. Una sola query per i pin
(`ST_X`/`ST_Y` non servono: `store.location` è `mode: "xy"`, quindi Drizzle
restituisce `{ x, y }` come in `store-detail.ts:105`), più il conteggio `total`
e il conteggio `mappable`, e `resolveOpenStatuses()` in batch sulle righe
ottenute (`store-open-status.ts:51`), come fa la lista.

Il `WHERE` dei pin aggiunge `stores.location IS NOT NULL` alle condizioni
condivise; `total` usa le condizioni senza quel predicato.

## Frontend

### Stato e navigazione

Nuovo search param `view` su `/stores/`:

```ts
view: search.view === "map" ? "map" : undefined,
```

Assente = lista, così `/stores` nudo resta la vista di sempre e la lista non
scrive niente nell'URL (stessa logica di `openNow`, `index.tsx:49`). Il cambio
vista naviga con `replace: false`: tornare indietro dalla mappa alla lista è
un'aspettativa legittima, a differenza del testo di ricerca che è debounced in
`replace`.

### Toggle

`ToggleGroup` di `@bibs/ui` (`packages/ui/src/components/toggle-group.tsx`),
`type="single"`, due voci con icona + testo (`LayoutGrid` "Lista", `Map`
"Mappa"), all'estrema destra della riga dei risultati — la stessa riga che già
regge il bottone Filtri, il conteggio e "Azzera filtri". Un `ToggleGroup`
single-select espone il ruolo radio, quindi la vista attiva è annunciata senza
`aria-*` aggiunti a mano.

Lo stato visivo è già a posto nel repo: `toggleVariants`
(`packages/ui/src/components/toggle.tsx:10`) stila `data-[state=on]:bg-muted`,
non il `data-checked:` delle primitive shadcn recenti che Radix v1.x non emette
(`feedback_shadcn_data_state_mismatch`). Serve però un trattamento più marcato
del `bg-muted` per la vista attiva — è una scelta binaria, non un hover — da
applicare via `className` sugli item, senza toccare la primitiva.

### Il componente mappa

`features/stores/store-search-map.tsx`, caricato con `lazy()` e mount-gate
dentro `Suspense`, come la scheda negozio (`$storeId.tsx:16`): Leaflet è
DOM-only e un import statico in una route SSR dà `window is not defined`
(`feedback_leaflet_client_only_tanstack_start`).

- `MapContainer` con `scrollWheelZoom={false}` — la pagina scrolla, la mappa no
  finché non la si tocca.
- `MarkerClusterGroup` da `react-leaflet-cluster@4.1.3`: i peer combaciano con
  lo stack (`react` 19, `react-leaflet` ^5, `@react-leaflet/core` ^3) e porta
  `leaflet.markercluster` come dipendenza. Va nel catalog root e in
  `apps/customer/package.json`, con `@types/leaflet.markercluster` se i tipi non
  arrivano dal pacchetto.
- Icona cluster custom con i token brand (saffron/ink), della stessa famiglia
  del pin: il default di markercluster è un cerchio verde che non appartiene a
  questa interfaccia. Il CSS del plugin va importato nel componente, accanto a
  `leaflet/dist/leaflet.css`.
- `pinIcon` esce da `store-map.tsx:7` in `features/stores/map-shared.ts` e
  viene usato da entrambe le mappe. Resta un `divIcon` con SVG inline: è ciò che
  permette a `var(--saffron)` di risolversi nel documento e restare theme-aware.
- `KeepSizeInSync` (`store-map.tsx:19`) si sposta nello stesso `map-shared.ts`
  (usa hook e restituisce `null`, quindi non serve JSX): anche qui la larghezza
  cambia col breakpoint e senza `invalidateSize()` restano tile della misura
  vecchia.
- Altezza: `h-[26rem] sm:h-[32rem] lg:h-[calc(100dvh-16rem)]` con un `min-h`.
  Su desktop la mappa riempie la finestra senza far scrollare la pagina; su
  mobile resta una superficie alta ma non infinita, sotto la riga dei risultati.

**Inquadratura.** Al mount e a ogni cambio del set di pin, `fitBounds` con
padding; con un solo pin, centro su di lui a zoom 15; con zero pin non si monta
la mappa (vedi Stati). Se `geoStatus === "granted"`, un marker distinto per la
posizione dell'utente — un cerchio Ink, non un pin: non è un negozio e non deve
sembrarlo.

### Popup

Mini-card costruita con i pezzi di `StoreTile`
(`features/stores/store-tile.tsx`): miniatura quadrata, nome, `categoria ·
comune`, riga stato apertura (`openStatusLabel`), pill distanza solo quando
`geoStatus === "granted"`. Tutto il popup è un `Link` a `/stores/$storeId`.
La pill distanza tiene i token fissi cream/ink perché sta sopra una foto;
la card sotto usa le superfici theme-aware — non vanno mischiate sulla stessa
superficie (`feedback_fixed_vs_theme_tokens_dark_mode`).

### Stati

| Stato | Resa |
|---|---|
| `isPending` | Skeleton della stessa altezza della mappa (niente riquadro grigio che poi salta) |
| `isError` | La stessa `Notice` con retry della lista |
| 0 risultati | La stessa `Notice` della lista, nessuna mappa vuota |
| `truncated` | Riga sopra la mappa: "Mostrati i primi 500 negozi — restringi la ricerca" |
| `total > mappable` | Riga sopra la mappa: "N negozi non hanno una posizione sulla mappa" |

Le due righe informative esistono perché senza di esse il conteggio dei
risultati e i pin visibili non tornano, e la differenza si legge come un bug.

### Hook

`features/stores/use-store-map.ts` → `useStoreMap({ q, categoryId,
macroCategoryId, coords, radius, openNow, enabled })`, `useQuery` con
`staleTime: 60_000` come `useStoreSearch`, `enabled: view === "map"`: i pin non
si scaricano finché l'utente non chiede la mappa. La query key ha gli stessi
campi della ricerca più il discriminante `"store-map"`.

Eden idrata in `Date` le stringhe-data (`feedback_eden_date_hydration`): i pin
portano `openStatus.opensAt.date`, quindi vale lo stesso `toYMD()` che
`use-store-search.ts` applica già.

### i18n

Nuove chiavi in `apps/customer/messages/{it,en}.json` (paraglide): `Lista`,
`Mappa`, etichetta del gruppo, le due righe informative, l'alt della mappa.

## Test

**API** — in `apps/api/tests/integration/customer-store-discovery.test.ts`, che
ha già le fixture Roma/Milano e i negozi visibili: un file nuovo costerebbe un
altro testcontainer.

1. **Parità con la lista**: a parità di filtri, `getStoreMapPins()` e
   `searchStores()` restituiscono lo stesso insieme di id. È la gemella del
   test che tiene allineate due strade verso lo stesso set
   (`feedback_sql_twin_of_js_domain_rule`).
2. Rispetta `q`, `categoryId`, `macroCategoryId`, `radius`, `openNow`.
3. Esclude i negozi non pubblicamente visibili (soft-deleted, abbonamento non
   attivo) — riuso degli helper già presenti nel file.
4. Negozio senza `location`: fuori da `pins`, dentro `total`, `mappable ===
   total - 1`.
5. Tetto: oltre 500 match mappabili → `pins.length === 500`, `truncated: true`,
   e con geo i 500 sono i più vicini.
6. `distance` coerente con quella della lista per lo stesso negozio.

**Frontend** — nessun test nuovo: la logica pura è quasi nulla e il valore sta
nel rendering Leaflet, che in jsdom si verifica male. La verifica è browser
reale.

## Verifica

Prima di dichiarare fatto:

- `bun run lint`, `bun run typecheck` per workspace (aggregato `--filter '*'`
  può mascherare un fallimento singolo: `feedback_bun_filter_exit_codes`).
- `bun test` in `apps/api`.
- `bun run build` in `apps/customer` — è il gate che cattura un import Leaflet
  finito in SSR.
- Smoke browser su `localhost:3001` autenticato come customer: lista↔mappa,
  apertura di un cluster fino ai pin singoli, popup e link alla scheda, cambio
  filtro da dentro la mappa (i bounds si riadattano), `openNow` in mappa,
  posizione negata, deep link `?view=map`, indietro del browser, e la mappa in
  dark mode.
- La route non cambia file: `routeTree.gen.ts` non dovrebbe muoversi (aggiungiamo
  un search param, non una route). Se si muove, va committato
  (`feedback_commit_tanstack_routetree_gen`).

## Rischi noti

- **`react-leaflet-cluster` è una dipendenza a manutentore singolo.** Se si
  rivelasse incompatibile con react-leaflet 5 a runtime, il ripiego è usare
  `leaflet.markercluster` direttamente con un piccolo componente che crea il
  `markerClusterGroup` via `useMap()` — una quarantina di righe, nessun wrapper.
  Va verificato **prima** di costruirci sopra la UI.
- **Tap target dei controlli Leaflet**: zoom e bolle cluster restano sui 30px,
  sotto i 44px del resto dello storefront. È lo stesso debito già annotato sulla
  scheda negozio (PR #166), non viene chiuso qui.
