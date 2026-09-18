# Rubrica indirizzi del customer e origine della ricerca — design

**Date:** 2026-09-18
**Status:** approved
**Riferimenti:** i riferimenti `file:riga` puntano allo stato pre-implementazione (base `3cec0d3`)
**Branch:** `feat/customer-address-book`

## Problema

Il cliente deve poter salvare i propri indirizzi e riusarli per due cose: **cercare
prodotti e negozi vicino a uno di essi**, e **farsi spedire la merce** lì.

Il backend è già quasi tutto in piedi, e va riconosciuto prima di progettare:

- `customer_addresses` (`apps/api/src/db/schemas/address.ts`) ha etichetta,
  destinatario, telefono, comune, CAP, `location` come punto PostGIS con indice
  GiST, e `isDefault` reso unico per cliente da un indice parziale.
- Il CRUD paginato esiste (`apps/api/src/modules/customer/routes/addresses.ts`),
  con test d'integrazione.
- La spedizione è già agganciata: `orders.shippingAddressId` e `createOrder` lo
  esige per gli ordini `pay_deliver` (`services/orders.ts:189`).
- La ricerca per prossimità è già parametrica: `/customer/search`,
  `/customer/stores`, `/stores/facets` e `/stores/map` accettano
  `lat`/`lng`/`radius`.

Mancano invece due cose, e sono il vero lavoro:

1. **Nel customer non esiste nessuna UI per gli indirizzi.** L'unica origine
   geografica dell'app è `navigator.geolocation`, chiamata da due pagine con due
   stati scollegati (`features/discovery/use-geolocation.ts`, usato sia dalla home
   sia da `/stores`), non persistita e non presente nell'URL.
2. **`location` è opzionale e arriva dal client.** Nel repo non esiste geocoding
   (zero occorrenze), i comuni non hanno centroide, e infatti nemmeno il seller
   imposta la posizione del negozio: le coordinate dei negozi vengono solo dal
   seed — da cui il caso `mappable === 0` già gestito in `/stores`. Senza
   coordinate, un indirizzo salvato non può essere origine di una ricerca.

## Scope

**Dentro:**

- Una capability di geocoding nell'API, con provider sostituibile e cache.
- La rubrica indirizzi nel customer: route `/addresses`, ricerca con
  autocomplete, mappa col pin trascinabile, CRUD completo.
- L'origine della ricerca come nozione unica dell'app: un chip nella top app bar
  che alimenta home, lista negozi, facet e mappa.

**Fuori, deliberatamente:**

- **Il checkout.** L'API accetta già `shippingAddressId`, ma nel customer non
  esiste nessuna pagina dove usarlo (`cart.tsx:70`: "Nessun CTA di checkout").
  Gli indirizzi nascono già completi di destinatario e telefono, quindi il
  checkout, quando arriverà, li troverà pronti. Costruirne un abbozzo adesso
  vorrebbe dire tirare dentro pagamento, stato ordine e ritiro-vs-consegna.
- **Il geocoding dei negozi del seller.** L'endpoint nasce nel modulo
  `locations` e con `auth: true` proprio perché il seller lo riuserà, ma la
  schermata del seller non è di questa iterazione.
- **Il centroide dei comuni.** Nessuna colonna nuova su `municipalities`: con il
  geocoding non serve un fallback grossolano.

## Decisioni

| Decisione | Scelta | Perché |
|---|---|---|
| Come si ottengono le coordinate | Geocoding + conferma su mappa | Precisione al civico con pochi tap; il pin trascinabile copre ciò che il geocoder sbaglia |
| Dove sta il geocoder | Proxy nell'API, provider dietro un'interfaccia | In produzione si passerà a Google: la chiave non deve mai stare nel bundle, e la quota va controllata lato nostro |
| Come si inserisce un indirizzo | Autocomplete a digitazione | È il flusso che la gente si aspetta; il rischio sul `municipalityId` è circoscritto (vedi sotto) |
| Dove vive la scelta dell'origine | URL + `localStorage`, default = indirizzo `isDefault` | Link condivisibili senza rivelare coordinate; nessuna migrazione |
| Dove vive il selettore | Chip nella top app bar, globale | Elimina i due stati GPS scollegati e rende raggiungibile "cerca vicino a Casa" da ogni pagina |
| Entità separata per gli indirizzi "di ricerca" | No | Sono gli stessi indirizzi: destinatario e telefono sono già opzionali nello schema |

## 1. Capability di geocoding (API)

**Nessuna modifica agli endpoint indirizzi.** `POST`/`PATCH /customer/addresses`
accettano già `location: {x, y}` e `municipalityId`: la rubrica usa il contratto
esistente così com'è.

### Tabella di cache

Nuovo `apps/api/src/db/schemas/geocoding.ts` → `geocoding_lookups`:

| colonna | tipo | note |
|---|---|---|
| `id` | `text` uuid | come le altre tabelle |
| `provider` | `text({ enum: ["photon", "google"] })` + CHECK | convenzione del repo, non `pgEnum` |
| `query` | `text` | query normalizzata (lowercase, spazi collassati) |
| `biasCell` | `text` | `"45.46,9.19"` (2 decimali, ~1,1 km) oppure `"-"` |
| `results` | `jsonb` | risposta del provider **già normalizzata nella nostra forma**, non il GeoJSON grezzo |
| `fetchedAt` | `timestamptz` | TTL di 30 giorni valutato in lettura: oltre il TTL la entry viene rinfrescata dal provider, e servita così com'è solo se il provider non risponde |

`unique(provider, query, biasCell)` con upsert `ON CONFLICT DO UPDATE`.

Due proprietà volute:

- **La cache non memorizza il `municipalityId`.** La risoluzione del comune è
  deterministica e locale: correggere il matching non richiede di invalidare nulla.
- **La cella di bias è parte della chiave.** Senza di essa il ranking di un
  utente a Milano finirebbe servito a un utente a Roma (vedi le misure sotto: il
  bias cambia *quali* risultati arrivano, non solo il loro ordine).

### La porta del provider

`apps/api/src/lib/geocoding/`:

- `provider.ts` — `interface GeocodingProvider { search(q, { limit, near? }): Promise<GeocodeHit[]> }`,
  con `GeocodeHit` nostro: `{ addressLine1, zipCode, location: {x, y}, rawCity, rawCounty, providerRef }`.
- `photon.ts` — `GET https://photon.komoot.io/api` con `q`, `limit`, e `lat`/`lon`
  per il bias. **Senza `lang=it`: verificato il 2026-09-18 che Photon accetta solo
  `default`/`de`/`en`/`fr` e risponde 400 altrimenti.** Scarta i risultati con
  `countrycode !== "IT"`; `addressLine1` = `street` + civico quando presente;
  `geometry.coordinates` è `[lon, lat]`, che è già il nostro `{x, y}`. Timeout 5 s
  via `AbortSignal.timeout`, User-Agent identificativo.
- `google.ts` — **non implementato ora.** La porta esiste perché il passaggio in
  produzione sia un file nuovo più una env, non un refactor.
- `index.ts` — sceglie l'implementazione da `GEOCODING_PROVIDER` (nuova env in
  `lib/env.ts`, default `photon`).

### Risoluzione del comune

`resolve-municipality.ts`. Serve perché `customer_addresses.municipalityId` è una
**FK obbligatoria** verso `municipalities`: un risultato del geocoder che non si
riconduce a una nostra riga non è salvabile.

Forma dei dati, verificata sul provider e sul nostro seed:

- Photon restituisce `city` = comune (`Pioltello`, `Cesano Boscone`), `county` =
  provincia, `postcode`, `countrycode`.
- I nostri comuni sono in italiano (`Bolzano`), Photon li scrive bilingui
  (`city: "Bolzano - Bozen"`); le nostre province sono `Roma` e `Bolzano/Bozen`,
  Photon scrive `county: "Roma Capitale"` e `"Bolzano - Bozen"`. **Il matching per
  provincia è rumoroso e va usato solo come spareggio.**
- In tutta Italia esistono **solo 6 nomi di comune omonimi** (Samone, Calliano,
  Livo, Peglio, Castro, San Teodoro — 12 righe su 7904): l'ambiguità è un caso
  raro e circoscritto, non la norma.

Algoritmo: normalizza (NFD senza diacritici, apostrofi e `-`/`/` come
separatori, split dei bilingui su `" - "`, prova ogni parte) e cerca su una mappa
`nome → righe` costruita una volta e memoizzata — i comuni sono immutabili, e
c'è già il precedente di `/municipalities/all` cacheato 24 h. Esiti:

- **un match** → `municipalityId`;
- **più match** → spareggio con la provincia da `county`; se resta incerto,
  restituisce i candidati;
- **zero match** → nessun id, e la UI chiede il comune.

### L'endpoint

`GET /locations/geocode` — nel modulo `locations`, non in `customer`: i comuni
stanno lì, e il seller lo riuserà per geolocalizzare i negozi.

- `query`: `q` (min 3 caratteri), `limit` (default 5, max 10), `lat`/`lng` opzionali.
- `auth: true` — la quota del provider non si regala agli anonimi.
- `beforeHandle: rateLimit({ name: "geocode", limits: [{ by: "ip", window: MINUTE, max: 30 }] })`,
  riusando `plugins/rate-limit.ts`, con `MINUTE` costante locale del file di route
  come in `modules/registration/index.ts:24`.
- risposta `okRes(t.Array(GeocodeSuggestionSchema))` con
  `municipality: t.Nullable(MunicipalityCompactSchema)` e
  `municipalityCandidates: t.Array(MunicipalityCompactSchema)`; `withErrors` + `429`.
- descrizione OpenAPI in italiano, come da rubrica in AGENTS.md.

### La regola del bias di prossimità

Requisito: **coi permessi concessi, i primi suggerimenti devono essere quelli
vicini alla posizione attuale.** Photon supporta il bias via `lat`/`lon`, ed è
decisivo: senza bias la query `via roma 12` restituisce spazzatura.

Misure del 2026-09-18, bias su Milano (45.4642, 9.1900):

| `zoom` | `via roma 12` | `via roma 12 palermo` |
|---|---|---|
| default (16) | cinque `Via Roma 12` a 8-9 km | **restituisce `Via Palermo 12` a Parma** |
| 10 | perde i civici, risultati a 43-130 km | Palermo |
| 5 | `Santa Vittoria d'Alba` a 130 km | Palermo |

Nessun singolo valore soddisfa entrambi i casi, e `location_bias_scale` non ha
effetto visibile. Quindi:

**Bias pieno per default; una seconda chiamata senza bias parte solo se il testo
nomina un comune.** Riconoscere un comune nel testo è gratis: la mappa dei 7904
nomi è già memoizzata per la risoluzione del `municipalityId`.

- `via roma 12` → **1 chiamata** con bias: vicini per primi.
- `via roma 12 palermo` → **2 chiamate**; i risultati che cadono nel comune
  nominato vanno in testa, gli altri restano sotto nell'ordine del bias. Salvare
  da Milano l'indirizzo dei genitori a Palermo resta possibile.
- Dedup per `providerRef` (`photon:N7137139871`).

**Coordinate del bias**, in ordine: posizione GPS se il consenso c'è già →
altrimenti l'origine attiva nel chip, se è un indirizzo salvato (chi aggiunge un
secondo indirizzo di solito lo aggiunge vicino al primo) → altrimenti nessun bias.

Il form **non** fa scattare il prompt dei permessi da solo: legge
`navigator.permissions.query({ name: "geolocation" })` in try/catch (il supporto
Safari è irregolare) e se è già `granted` prende la posizione in silenzio;
altrimenti mostra un invito *"Attiva la posizione per vedere prima gli indirizzi
vicini"* che la chiede solo al tocco.

## 2. La rubrica indirizzi (customer)

Pezzi già in casa da riusare, non da riscrivere: `@bibs/ui` ha `combobox.tsx`,
`command.tsx` e **`municipality-combobox.tsx`** (già usato da 5 schermate del
seller), che è esattamente il fallback "conferma il comune".

**Dove vive:** route dedicata `/addresses` sotto `_authenticated`, con una voce
di rimando da `/profile`. Non una terza sezione dentro il profilo: ricerca, mappa
e campi peserebbero più di identità e anagrafica messe insieme, e `/profile` sta
su `max-w-3xl`.

La lista chiede `limit: 50` in una pagina sola: il cap dell'API è 100, e una
rubrica personale non arriva a quei numeri.

**File nuovi** in `apps/customer/src/features/addresses/`: `use-addresses.ts`,
`use-address-mutations.ts` (create/update/delete/predefinito, con invalidate
della lista), `use-geocode.ts` (debounce 300 ms, min 3 caratteri),
`address-list.tsx`, `address-dialog.tsx`, `address-search.tsx`,
`address-map-preview.tsx`.

**Il dialog, nell'ordine in cui lo si usa:**

1. **Un solo campo in cima:** cerchi l'indirizzo, i suggerimenti arrivano coi
   vicini per primi; selezionandone uno si riempiono via+civico, CAP, comune e
   coordinate in un colpo.
2. **Mappa piccola col pin trascinabile** — client-only via `lazy()` + mount
   gate dentro Suspense, come la scheda negozio: Leaflet è DOM-only e un import
   statico rompe l'SSR.
3. **Campi editabili sotto:** via e civico, interno/scala (`addressLine2`), CAP,
   comune (`MunicipalityCombobox`). Photon non sempre restituisce `postcode`: in
   quel caso il CAP resta vuoto e obbligatorio, perché l'API esige 5 cifre
   (`AddressFieldsRequired` in `lib/schemas/entities.ts`).
4. **Comune non risolto** → combobox vuoto e obbligatorio con l'avviso *"Conferma
   il comune"*; **candidati ambigui** → precompilato col primo e invito a
   verificare. Non salviamo mai un indirizzo agganciato al comune sbagliato.
5. **Etichetta** libera con tre scorciatoie (Casa / Lavoro / Altro): la colonna è
   già `text`, nessun enum nel DB.
6. **Destinatario e telefono** opzionali, con nota *"Serviranno per le consegne"*.
7. **"Imposta come predefinito"**: l'unicità è già garantita da
   `customer_address_single_default_idx`, e il service già sbianca gli altri in
   transazione.

Form con stato controllato più `Field`/`FieldLabel`/`FieldError` e toast, come
`personal-info-form.tsx` — non `react-hook-form`: nel customer non è usato, e ci
evita il `reset(defaultValues)` che desincronizza i Select.

Lista con una card per indirizzo: etichetta, badge **"Predefinito"** al
singolare, azioni *Cerca qui vicino* / Modifica / Elimina (con `AlertDialog` di
conferma), `EmptyState` quando è vuota. Copy in
`apps/customer/messages/{it,en}.json` via Paraglide, mai hardcoded.

## 3. L'origine della ricerca (il chip)

**Un provider condiviso** — `apps/customer/src/features/location/search-origin.tsx`,
montato in `_authenticated`:

```
origin: { kind: "gps", coords } | { kind: "address", addressId, coords, label } | { kind: "none" }
```

`useGeolocation` non scompare: diventa un dettaglio interno del provider invece
di essere invocato da due pagine con due stati scollegati.

Persistenza in `localStorage` (`{ kind, addressId }`, mai le coordinate GPS che
scadono) dentro try/catch. All'avvio: l'ultima scelta se l'indirizzo esiste
ancora → altrimenti l'indirizzo `isDefault` → altrimenti `none`, **senza mai far
scattare il prompt dei permessi da solo**.

**Il chip** in `components/site-header.tsx`: `MapPin` più etichetta ("Casa",
"Posizione attuale", "Tutta l'Italia"), apre un `Popover` su desktop e un
`Drawer` su mobile con: posizione attuale (permesso chiesto solo al tocco), gli
indirizzi salvati, "Tutta l'Italia", e *"Gestisci indirizzi"* verso `/addresses`.

**URL su `/stores`:** un solo parametro, `near=gps` oppure `near=<addressId>`;
assente significa "eredita dal provider". Le coordinate non entrano mai
nell'URL — un link condiviso non rivela dove abiti, e a chi lo riceve l'id non
risolve nulla e cade su "nessuna origine" senza errori.

**Wiring:** `use-nearby-products`, `use-store-search`, `use-store-facets` e
`use-store-map` accettano già `coords: Coords | null`; cambia solo **chi** glielo
passa. E `radiusApplies` in `routes/_authenticated/stores/index.tsx` passa da
`geoStatus === "granted"` a `origin.coords !== null`: così un raggio ha senso
anche partendo da un indirizzo salvato, cosa che oggi è impossibile.

**Cambio visibile in home:** la sezione "Vicino a te" perde il proprio bottone
*"Mostra le distanze"* e legge l'origine dal chip; con origine `none` l'invito
diventa *"Scegli da dove cercare"* e apre il chip.

## Errori e degrado

Il provider esterno è l'unica dipendenza nuova, quindi il form deve funzionare
anche quando è giù:

- **Timeout o errore del provider** → `ServiceError(503, …)`; la UI mostra
  *"Ricerca indirizzi non disponibile — inseriscilo a mano"* e lascia attivi
  campi, `MunicipalityCombobox` e pin sulla mappa. Nessun percorso morto.
- **Stale-if-error**: se la cache ha una entry scaduta e il provider non
  risponde, serviamo la scaduta invece di fallire.
- **Zero risultati** → empty nel combobox, con lo stesso invito manuale.
- **429** dal nostro limiter: in pratica invisibile col debounce, ma sta nel
  contratto della risposta.
- **Indirizzo cancellato mentre è l'origine attiva** → il provider non trova più
  l'id e cade sull'`isDefault`, o su `none`.
- `ServiceError` resta a due argomenti: il `code` lo determina
  `ERROR_CODES[status]`, e il frontend discrimina per status.

## Test

TDD sul dominio nuovo, come chiede CLAUDE.md.

**Unit** — `resolve-municipality`: nome unico; bilingue `"Bolzano - Bozen"` →
`Bolzano`; accenti e apostrofi (`Agliè`, `Sant'Ambrogio di Torino`); i 6 omonimi
con e senza provincia; `"Roma Capitale"` → `Roma`; zero match. E `photon.ts`:
filtro `countrycode`, civico assente, `[lon, lat]` → `{x, y}`, timeout.

**Integrazione** — `/locations/geocode` con provider finto: la cache hit **non**
chiama il provider (spy); celle di bias diverse non si contaminano; la seconda
chiamata parte solo quando il testo nomina un comune; 401 senza auth; 429 oltre
il limite; stale-if-error. I mock stanno **dentro** il test (`mock.module` è
process-global) e la suite gira `--parallel=4 --isolate`.

## Verifica prima di completare

- `bun run typecheck` su api e sui 3 frontend (Eden propaga i tipi), `bun run lint`,
  `bun run test`.
- `bun run db:generate`, **lettura dell'SQL generato**, poi `bun run db:migrate`.
  La tabella è nuova e vuota: nessun backfill, nessun `NOT NULL` su tabella popolata.
- `/openapi` riflette il nuovo endpoint.
- `routeTree.gen.ts` committato assieme alla route `/addresses`, altrimenti la CI
  typecheck va rossa pur essendo verde in locale.
- Browser vero su `localhost:3001` con `customer1@test.com` / `password123`:
  aggiunta indirizzo, suggerimenti vicini col GPS concesso, il caso
  Palermo-da-Milano, comune non risolto, chip su home/lista/mappa, e un link
  `?near=<id>` appartenente a un altro utente.

## Decomposizione in PR

1. `feat(api): geocoding indirizzi con provider sostituibile` — porta, Photon,
   cache, `resolve-municipality`, endpoint, test. Nessun impatto sui frontend.
2. `feat(customer): rubrica indirizzi` — route `/addresses`, dialog, mappa,
   riuso di `MunicipalityCombobox`. Dipende dalla 1.
3. `feat(customer): origine della ricerca nel chip` — provider condiviso, chip,
   wiring dei 4 hook, `near` in URL. Dipende dalla 2.

## Finding aperti, fuori da questo scope

- **Gli ordini passati perdono l'indirizzo di consegna se l'indirizzo viene
  cancellato.** `orders.shipping_address_id` ha `onDelete: "set null"`
  (`apps/api/src/db/schemas/order.ts:55`). Non è un crash, ed è la scelta giusta
  rispetto al bloccare la cancellazione; la cura è uno snapshot dell'indirizzo
  sull'ordine, lo stesso pattern già usato per prezzi e IVA in `order_items`. Il
  momento giusto è quando arriva il checkout.
- **I negozi creati dal seller non hanno coordinate.** Solo il seed le imposta,
  e `/stores` già convive col caso `mappable === 0`. La capability di geocoding
  di questa spec è ciò che serve per chiudere il buco, in un'iterazione dedicata
  al seller.
