# Ricerca prodotti nell'app customer — design

**Date:** 2026-09-21
**Status:** proposed
**Riferimenti:** i riferimenti `file:riga` puntano allo stato pre-implementazione (base `18b7a78`)
**Branch:** `feat/customer-product-search`

## Problema

L'app customer sa cercare negozi e non sa cercare prodotti. `/stores` è una
superficie matura — rail di facet, toggle lista/mappa, origine della ricerca nel
chip, stato nell'URL — mentre la domanda più ovvia di un marketplace di
commercio locale, *"chi ha questa cosa vicino a me?"*, non ha una pagina.

Un endpoint di ricerca prodotti **esiste già**: `GET /customer/search`
(`apps/api/src/modules/customer/routes/search.ts`, servizio
`services/search.ts`) fa full-text italiano pesato su nome e descrizione,
filtro geografico PostGIS e filtro per categoria, e annota gli sconti attivi.
Ma è nato per alimentare una sola sezione: la striscia "Vicino a te" della home
(`apps/customer/src/features/discovery/use-nearby-products.ts:30`, `limit 12`).
Rispetto a ciò che serve a una pagina di ricerca gli mancano quattro cose:

1. **Nessuna identità del negozio nel risultato.** `SearchResultSchema`
   (`apps/api/src/lib/schemas/entities.ts:852`) espone prezzo, immagini e una
   `distance`, ma non dice *da chi*. È il motivo per cui `ProductTile` oggi non
   ha né riga negozio né pulsante "Aggiungi": il carrello vuole uno
   `storeProductId`, e il risultato non ce l'ha.
2. **Nessun facet.** Nessun conteggio per macro-categoria, quindi nessun rail.
3. **Nessun filtro oltre `categoryId` e la geografia.**
4. **Un buco di visibilità noto.** La ricerca prodotti non applica
   `publiclyVisibleStore()` (`apps/api/src/lib/store-visibility.ts:11`): basta
   `stores.deleted_at IS NULL`. I prodotti dei negozi sospesi o senza
   abbonamento attivo compaiono ancora. Il debito è dichiarato nella spec di
   store-discovery (`2026-06-23-customer-store-discovery-design.md:212`) e non è
   mai stato chiuso.

Un vincolo di dominio che decide gran parte del design: **un prodotto appartiene
a un solo venditore** ed è stoccato in uno o più negozi *suoi*
(`store_products`, `apps/api/src/db/schemas/product.ts`). Non esiste un catalogo
condiviso fra venditori. Quindi lo stesso prodotto in più negozi significa
sempre "più filiali della stessa insegna", mai "due botteghe che vendono lo
stesso articolo".

## Scope

**Dentro:** una pagina `/products` nell'app customer con rail di facet e
filtri, l'endpoint che la serve, i facet, il ponte fra le due ricerche, e la
chiusura del buco di visibilità.

**Fuori, deliberatamente:**

- **La pagina di dettaglio prodotto.** Non esiste, e non la si inventa qui: il
  tile resta non cliccabile nel suo complesso (l'unico link è il nome del
  negozio). È la stessa scelta già presa in `product-tile.tsx` — niente
  controlli morti.
- **La vista mappa dei prodotti.** Un prodotto non è un luogo. Il negozio
  agganciato sì, ma una mappa di negozi esiste già ed è `/stores?view=map`.
- **Il filtro per marca.** `products.brandId` esiste, ma i brand sono
  per-venditore, non un catalogo condiviso: il facet sarebbe una lista
  lunghissima di marchi che compaiono una volta sola. Ha senso quando lo si può
  limitare alle prime N marche del risultato corrente, su dati veri.
- **Il selettore di ordinamento.** L'ordine resta rilevanza → distanza →
  tiebreaker stabile.
- **L'istogramma dei prezzi** dietro al filtro min/max.
- **Il pulsante "Aggiungi" nella home.** La home resta scoperta; `/products` è
  dove si agisce.

## Decisioni

1. **Un risultato è un prodotto, agganciato a un negozio.** Non una coppia
   (prodotto, negozio): una catena con cinque filiali inonderebbe la pagina con
   lo stesso articolo cinque volte, e i conteggi dei facet conterebbero offerte
   invece di cose comprabili.
2. **Il negozio agganciato è il più vicino** fra quelli che soddisfano tutti i
   filtri. Senza posizione, **il primo per nome**: serve un ordine totale, o la
   paginazione balla fra una pagina e l'altra.
3. **"Aperti ora" restringe anche l'aggancio, non solo l'insieme.** Altrimenti
   si mostrerebbe un prodotto sotto il cartello "aperto" attaccato a un negozio
   chiuso.
4. **Il filtro di prezzo lavora sul prezzo che si paga**, cioè su quello
   scontato quando c'è una promozione attiva, non sul listino.
5. **`publiclyVisibleStore()` entra nella ricerca prodotti**, chiudendo il
   debito. Ne beneficia anche "Vicino a te" in home, che passa dal vecchio
   endpoint al nuovo.
6. **`GET /customer/search` viene rinominato in `GET /customer/products`**, con
   `GET /customer/products/facets` accanto, simmetrico a `/customer/stores` +
   `/stores/facets`. Il vecchio path sparisce: l'unico consumatore è la home, e
   l'app non è deployata.
7. **I facet contano prodotti distinti**, coerenti con la decisione 1.
8. **Due pagine, un ponte.** `/products` e `/stores` restano rotte separate con
   i propri facet e la propria cronologia; un tab in cima a entrambe le porta
   l'una nell'altra conservando `q`, `near`, `radius` e `openNow`.

### Alternative scartate

- **Una riga per coppia (prodotto, negozio).** Più semplice da scrivere e più
  onesta nel conteggio delle disponibilità, ma vedi la decisione 1.
- **Un risultato puramente aggregato** ("disponibile in 3 negozi, dal più
  vicino a 2,1 km") senza negozio agganciato. Il più pulito da modellare, ma
  toglie l'"Aggiungi" dalla lista e allunga di un passo ogni acquisto.
- **Una sola rotta `/search?type=products|stores`.** Il pivot sarebbe gratis,
  ma la pagina dovrebbe montare due alberi di facet, due query e la mappa dei
  negozi, e i due stati URL si mescolerebbero.
- **Parametrizzare `publiclyVisibleStore()` e `openNowCondition()` con un
  alias.** Sembrava necessario per usarli dentro il laterale, e non lo è: vedi
  "La regola di aggancio" qui sotto.

## Contratto API

### `GET /customer/products` (pubblico, no auth)

Query — `ProductSearchQuery` (`apps/api/src/lib/queries.ts:66`) esteso:

| Parametro | Tipo | Note |
|---|---|---|
| `page`, `limit` | int | da `PaginationQuery`; `limit` max 100 |
| `q` | string | full-text italiano su nome (peso A) e descrizione (peso B) |
| `macroCategoryId` | string | **nuovo**; ignorato se c'è `categoryId` |
| `categoryId` | string | categoria prodotto foglia |
| `lat`, `lng` | number | origine della ricerca |
| `radius` | number | km; applicato solo con `lat`/`lng` |
| `openNow` | boolean | **nuovo** |
| `onSale` | boolean | **nuovo**; solo prodotti con sconto attivo adesso |
| `minPrice`, `maxPrice` | number | **nuovo**; sul prezzo effettivo (decisione 4) |

`radius` perde il default di 50 km che ha oggi, per allinearsi a
`StoreSearchQuery`: geo senza raggio ordina per vicinanza senza tagliare nulla.
"50 km" era un limite invisibile, deciso dall'endpoint per conto del chiamante.

Ma la home *vuole* un limite: "Vicino a te" senza raggio mostrerebbe prodotti a
300 km quando la zona è vuota, che è peggio di una striscia corta. Quindi il
default non sparisce, si sposta: l'endpoint non ne ha, e `useNearbyProducts`
passa un `radius` esplicito. Il comportamento della home non cambia, ma adesso
è scritto dove lo si può leggere.

Risposta — `okPage(ProductCardSchema)`, dove `ProductCardSchema` sostituisce
`SearchResultSchema`:

```
id, name, description, price
storeProductId    // riga store_products del negozio agganciato → serve al carrello
stock             // disponibilità in quel negozio
store: { id, name, municipality: MunicipalityCompactSchema }
distance          // metri dall'origine, null senza geo
otherStoreCount   // altri negozi che soddisfano i filtri, oltre a quello agganciato
rank              // rilevanza full-text, 0 senza q
images[]          // { id, url, position }
discountedPrice, discountPercent
```

`discountTitle` e `discountEndsAt` **escono** dal DTO: `endsAt` è una `Date`, e
Eden Treaty idrata le stringhe-data in `Date` costringendo il frontend a
`toYMD()`. Nessuno dei due è mostrato nel tile — è la stessa scelta già presa
per `StoreProductCardSchema` (`entities.ts:820`).

### La regola di aggancio

Il cuore della query. `JOIN LATERAL ... LIMIT 1` sostituisce insieme l'`EXISTS`
e la subquery correlata che oggi calcola la `MIN(distance)`:

```sql
FROM products
JOIN LATERAL (
  SELECT store_products.id AS store_product_id,
         store_products.stock,
         stores.id AS store_id, stores.name AS store_name,
         municipalities.id, municipalities.name, provinces.acronym,
         ST_Distance(stores.location::geography, <origine>) AS distance,
         count(*) OVER () AS match_count
  FROM store_products
  JOIN stores        ON stores.id = store_products.store_id
  JOIN municipalities ON municipalities.id = stores.municipality_id
  JOIN provinces      ON provinces.id = municipalities.province_id
  WHERE store_products.product_id = products.id
    AND store_products.stock > 0
    AND <publiclyVisibleStore()>
    AND <ST_DWithin(...)  se lat/lng/radius>
    AND <openNowCondition() se openNow>
  ORDER BY distance ASC NULLS LAST, stores.name ASC, stores.id ASC
  LIMIT 1
) AS offer ON true
WHERE products.status = 'active' AND <testo> AND <categoria> AND <prezzo/offerta>
ORDER BY rank DESC, offer.distance ASC NULLS LAST,
         products.created_at DESC, products.id ASC
```

Tre proprietà che cadono fuori da sole invece di richiedere rami separati:

- **Senza geo** `distance` è `NULL` per tutte le righe, quindi
  `distance ASC NULLS LAST, stores.name ASC` degenera nell'ordine per nome: la
  decisione 2 è la stessa `ORDER BY`, non un caso speciale.
- **`count(*) OVER ()` dentro un laterale con `LIMIT 1`** conta tutte le righe
  che passano il `WHERE`: le window si valutano prima di `ORDER BY`/`LIMIT`.
  `otherStoreCount = match_count - 1`, senza una seconda query.
- **`JOIN LATERAL` interno** scarta i prodotti senza nessun negozio idoneo, che
  è esattamente ciò che l'`EXISTS` di oggi fa a mano.

**Sulla qualificazione delle colonne.** Drizzle 0.45.3 ha `innerJoinLateral`
nativo (`pg-core/query-builders/select.d.ts:187`), quindi il sottoquery si
costruisce col query builder e le sue condizioni finiscono in un `.where()`
vero — dove Drizzle **qualifica** le `Column` interpolate (`"stores"."id"`).
`publiclyVisibleStore()` e `openNowCondition()` si riusano **così come sono**:
dentro il laterale `"stores"."opening_hours"` e `"stores"."id"` puntano al join
interno, che è ciò che serve. La regola nota resta valida solo per i **campi
della SELECT**, dove le `Column` si renderizzano nude: la `distance` va scritta
`stores.location` alla lettera, come già fa `store-discovery.ts:57`.

Senza il laterale l'alternativa sarebbe stata scrivere le condizioni a mano con
i prefissi espliciti, cioè una seconda copia della logica di `openNowCondition`
— il tipo di duplicazione che questo repository ha già pagato.

### Il predicato dello sconto

`onSale`, `minPrice` e `maxPrice` hanno bisogno del prezzo scontato **nel
`WHERE`**: filtrare dopo la query darebbe un `total` e una paginazione che non
corrispondono ai risultati. Oggi lo sconto si calcola dopo, in
`getBestActiveDiscounts()`
(`apps/api/src/modules/seller/services/discount-pricing.ts:70`).

Per non avere due definizioni di "sconto attivo", si estrae da
`discount-pricing.ts` un frammento SQL condiviso:

```ts
/** Percentuale del miglior sconto attivo su un prodotto, o NULL. */
export function bestActiveDiscountPercent(productRef = sql`products.id`)
```

usato sia dalla nuova `WHERE` sia — riscritto sopra — dal batch esistente. Il
prezzo effettivo è
`ROUND(products.price * (1 - coalesce(<percent>, 0)::numeric / 100), 2)`.
Un test di parità confronta le due strade: è la regola "gemella SQL", nata
esattamente da questo tipo di doppione.

### `GET /customer/products/facets` (pubblico, no auth)

Ricalca `getStoreFacets()`
(`apps/api/src/modules/customer/services/store-facets.ts:48`), su
`product_macro_categories` / `product_categories` e contando **prodotti
distinti**.

Query: `t.Omit(ProductSearchQuery, ["page", "limit", "categoryId", "macroCategoryId"])`.
I facet rispondono a "quanti prodotti restano se aggiungo questo filtro",
quindi applicano testo, geo, prezzo e offerta ma **mai la categoria già
selezionata** — altrimenti il rail mostrerebbe solo il ramo aperto.

Risposta:

```
total          // prodotti che corrispondono, senza filtro di categoria
openNowTotal   // quanti se si accende "Aperti ora"
onSaleTotal    // quanti se si accende "Solo in offerta"
macros[]       // { id, name, productCount, categories[] { id, name, productCount } }
```

Le macro a zero non si restituiscono: un filtro che garantisce zero risultati è
rumore, non una scelta.

`openNowTotal` e `onSaleTotal` rispondono sempre alla stessa domanda — "quanti
prodotti restano se lo accendo?" — quindi ciascuno si misura sulle condizioni
di base **senza il proprio** filtro, anche quando è già attivo (nel qual caso
coincide con `total` e la query in più si salta). È lo stesso schema di
`getStoreFacets()`, che costruisce `openNowClause` a parte prima di decidere se
spingere la condizione dentro `conditions`.

### Registrazione

In `apps/api/src/modules/customer/index.ts:18`, `searchRoutes` diventa
`productsRoutes` e resta fuori dalla `guard` autenticata. `/products/facets` va
registrata **prima** di un eventuale `/products/:id` futuro, come già fanno i
negozi.

### Condizioni condivise

Nasce `services/product-search-conditions.ts`, gemello di
`store-search-conditions.ts:30`: le condizioni del `WHERE` esterno (testo,
categoria, prezzo, offerta) e quelle del laterale (stock, visibilità, raggio,
aperti) vivono in un posto solo, perché ricerca e facet rispondono alla stessa
domanda e due copie sono due occasioni di divergere.

## Frontend

### Rotta e stato URL

`apps/customer/src/routes/_authenticated/products/index.tsx`, stessa shell di
`stores/index.tsx`: rail di filtri da `lg`, `Sheet` sotto, griglia a container
query (`@xl:grid-cols-3 @4xl:grid-cols-4`) perché le colonne le decide la
larghezza della colonna, non del viewport.

Parametri: `q`, `macroCategoryId`, `categoryId`, `radius`, `openNow`, `onSale`,
`minPrice`, `maxPrice`, `near`. Niente `view`.

`routeTree.gen.ts` va committato insieme alla rotta, o la CI di typecheck va
rossa mentre in locale è verde.

### Il ponte fra le due ricerche

`components/search-tabs.tsx`, in cima sia a `/products` sia a `/stores`. Porta
con sé `q`, `near`, `radius` e `openNow` — esistono su entrambe. **Non** porta
le categorie (alberi diversi: 14 macro prodotto e 179 categorie foglia,
contro 16 macro negozio) né
`view=map`.

### Il tile

`ProductTile` (`apps/customer/src/features/catalog/product-tile.tsx:35`) ha già
lo slot `action:ReactNode` (riga 27): lì dentro va `AddToCart` con lo
`storeProductId` e lo `stock` del negozio agganciato. Si aggiungono:

- la riga negozio, col nome **linkato a `/stores/$storeId`** — non testo morto;
- "anche in altri N negozi" quando `otherStoreCount > 0`, come testo piatto.

Il commento del componente va aggiornato: diceva che la discovery non passa
un'azione perché "il negozio non è ancora scelto", e da qui in poi lo è.

### Il rail

`features/catalog/product-filters.tsx`, sul modello di `store-filters.tsx:176`:
macro/categoria con conteggi, raggio, e tre controlli nuovi — "Solo in offerta"
e "Aperti ora" come toggle con conteggio, prezzo come coppia min/max in €.
Senza posizione il raggio non si invia e non si conta fra i filtri attivi,
esattamente come su `/stores`.

### Tre estrazioni, non di più

`/stores` e `/products` condividono logica sottile che in due copie divergerà:

- `components/search-field.tsx` — il campo di ricerca con icona e pulsante di
  pulizia (`stores/index.tsx:454`), una trentina di righe identiche;
- `useSearchTextParam()` — il debounce a 300 ms verso l'URL più la
  risincronizzazione quando `q` cambia da fuori (`stores/index.tsx:112` e `:124`);
- `useNearParam()` — i due effetti con memoria che tengono allineati `near` e
  origine (`stores/index.tsx:139` e `:160`), con i ref `adoptedNear` e
  `lastOriginKey`. È il pezzo più delicato dei due file.

Tutto il resto resta dov'è: nessun refactoring a strascico.

### Home

`useNearbyProducts` (`use-nearby-products.ts:30`) punta al nuovo endpoint. I
tile della striscia "Vicino a te" guadagnano la riga negozio — è un arretrato
dichiarato di #130 ("identità negozio sui tile") che qui arriva gratis — ma
**non** il pulsante "Aggiungi".

### i18n

Nuove chiavi paraglide sotto il prefisso `product_*`, sul modello di `store_*`:
titolo e sottotitolo, placeholder e aria della ricerca, etichette dei filtri,
conteggi (singolare e plurale, come da convenzione: badge al singolare, tab al
plurale), stati vuoti ed errori, etichette del tab di pivot.

## Test

Integration sul harness testcontainer, in `apps/api/tests/integration/`:
`customer-products-search.test.ts` e `customer-products-facets.test.ts`, che
riscrivono e assorbono `customer-search.test.ts` e
`customer-search-soft-deleted.test.ts`.

**Aggancio**

- con origine, vince il negozio più vicino fra quelli con stock;
- con `openNow`, vince il più vicino **aperto** — non il più vicino in assoluto;
- senza origine vince il primo per nome, e due chiamate identiche danno lo
  stesso ordine;
- `otherStoreCount` conta solo i negozi che soddisfano i filtri, non tutti
  quelli dell'insegna;
- `storeProductId` e `stock` sono quelli del negozio agganciato, non di un
  altro (il test che protegge il carrello).

**Visibilità** — un prodotto stoccato solo in un negozio sospeso, senza
abbonamento o soft-deleted non compare. È il buco che si chiude.

**Filtri**

- `maxPrice=60` include un prodotto da 100 scontato a 50, ed esclude uno da 100
  senza sconto;
- `onSale` tiene solo chi ha uno sconto attivo adesso (uno scaduto non conta);
- `total` corrisponde alle righe restituite su tutte le pagine: nessun
  post-filtro in JS.

**Facet** — prodotti distinti, categoria selezionata non applicata, macro a
zero assenti, `onSaleTotal` e `openNowTotal` coerenti con la ricerca filtrata.

**Parità** — `bestActiveDiscountPercent()` e `getBestActiveDiscounts()`
concordano sullo stesso insieme di prodotti.

Frontend: i test unitari degli helper puri estratti (`search-origin-state.test.ts`
si estende a `useNearParam`). I componenti si verificano nel browser.

## Verifica prima di completare

- `bun run lint`, `bun run typecheck` **per workspace** (api e i tre frontend
  separatamente: l'aggregato `--filter '*'` può nascondere un fallimento
  singolo), `bun run test`;
- `bun run build` sull'app customer — è il gate che prende gli errori SSR;
- `routeTree.gen.ts` committato;
- smoke manuale nel browser su `localhost:3001` con un cliente vero, **mouse e
  tastiera come percorsi distinti**: ricerca, ogni filtro, il tab di pivot che
  conserva testo e origine, "Aggiungi" da un risultato, il link al negozio,
  dark mode. È il gate vero per la UI, e lo fa Marco.

## Decomposizione in PR

**PR 1 — API.** `GET /customer/products` + `/facets`, la regola di aggancio, il
frammento sullo sconto, `publiclyVisibleStore()` adottato, i test, e la home
ripuntata al nuovo path. Il repoint deve stare qui: senza, il typecheck dei
frontend va rosso.

**PR 2 — Frontend.** La rotta `/products`, il rail, il tab di pivot, le tre
estrazioni condivise, la riga negozio nel tile e in home, le chiavi i18n.

## Rischi noti

- **`innerJoinLateral` è nuovo per questo repository.** Nessun'altra query lo
  usa. Il primo task del piano stampa l'SQL generato e lo verifica su dati
  seed, prima di costruirci sopra.
- **Costo della query.** Il laterale gira per ogni prodotto candidato. Gli
  indici che servono ci sono già (`store_product_store_id_idx`,
  `product_search_idx` GIN, l'indice spaziale su `stores.location`), ma il
  piano va letto con `EXPLAIN` sul seed, che ha circa 2.200 prodotti.
- **`radius` perde il default di 50 km.** Ogni chiamante che oggi lo omette si
  affida a un troncamento che non ha scritto. Dentro questo repository il
  chiamante è uno solo — la home — e lo si aggiorna nella PR 1; ma se il valore
  esplicito non ci arriva, il sintomo è una striscia "Vicino a te" con dentro
  mezza Italia, non un errore.
