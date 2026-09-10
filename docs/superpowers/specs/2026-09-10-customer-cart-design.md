# Carrello acquisti customer — design

**Date:** 2026-09-10
**Status:** approved, not implemented
**Riferimenti:** i riferimenti `file:riga` puntano allo stato pre-implementazione (base `1755080`)
**Branch:** `feat/customer-cart`

## Problema

Lo storefront customer sa scoprire negozi (#131), leggerne la scheda (#132) e
sfogliarne il catalogo (#133), ma non sa raccogliere nulla: `apps/customer/README.md:8`
dichiara che «cart/checkout is **not built yet** — the API for it exists, the UI
doesn't». Il cliente vede il prodotto della bottega sotto casa e non ha un gesto
per prenderlo.

L'API ordini esiste ed è completa: `POST /customer/orders`
(`apps/api/src/modules/customer/routes/orders.ts:24`) accetta
`{ type, storeId, items: [{ storeProductId, quantity }], … }`, decrementa lo
stock in transazione, applica sconti venditore, scorporo IVA e punti fedeltà.
Manca il gradino prima: un posto dove accumulare l'intento d'acquisto fra la
scoperta e l'ordine.

**C'è anche un buco nel contratto del catalogo.** Né
`GET /customer/stores/:id/products` né `/customer/search` espongono lo
`store_products.id`: entrambi selezionano da `products` e verificano la
disponibilità con un `EXISTS` (`services/store-products.ts:41`,
`services/search.ts:52`). Ma è proprio `storeProductId` l'identificatore che
l'ordine pretende. Finché il catalogo non lo restituisce, nessuna superficie
customer può costruire una riga d'ordine.

## Scope

**Dentro:** il carrello — aggiungere, vedere, cambiare quantità, rimuovere.

**Fuori, deliberatamente:** il checkout. Arriva in una PR successiva e si porta
dietro la scelta del tipo d'ordine, l'indirizzo di spedizione, i punti da
spendere e la creazione degli ordini.

**Conseguenza accettata:** per una iterazione la pagina carrello non ha un CTA
d'uscita. Mostra il totale e si ferma lì — nessun bottone disabilitato, nessuna
nota di scuse. È la stessa regola già applicata a `ProductTile`
(`apps/customer/src/features/catalog/product-tile.tsx:24`), che non è un link
perché la pagina prodotto non esiste: niente controlli morti.

## Decisioni

| Decisione | Scelta | Perché |
|---|---|---|
| Persistenza | Server, tabella dedicata | Il catalogo è già dietro `_authenticated` (`routes/_authenticated.tsx:17`): il caso «carrello anonimo da fondere al login» non esiste, quindi il localStorage non compra nulla e costa cross-device, flicker SSR e una seconda fonte di verità |
| Multi-negozio | Un carrello, raggruppato per negozio | Un ordine è mono-negozio (`orders.store_id` NOT NULL), quindi il fan-out è inevitabile; renderlo visibile fin dal carrello è coerente con «neighborhood is the unit» e con il giro fra due-tre botteghe che è il caso d'uso di bibs |
| Superfici | Solo la scheda negozio | È l'unico posto dove il negozio è già scelto. Ricerca e discovery sono **per prodotto** e deduplicano con `EXISTS` mostrando solo la distanza del negozio più vicino (`services/search.ts:82`): da lì «aggiungi» sarebbe ambiguo |
| Forma UI | Pagina `/cart` + badge in header | Linkabile, sopravvive al refresh, ed è la pagina su cui atterrerà il checkout. Su mobile — e il customer è mobile-primary — un drawer sarebbe comunque a tutto schermo |
| Copy | Paraglide, migrando anche lo storefront | AGENTS.md lo impone; oggi Paraglide copre solo i flussi auth e lo storefront di #130–#133 hardcoda l'italiano. La divergenza si sana adesso |

### Alternative scartate

**Snapshot del prezzo nella riga di carrello.** Creerebbe un secondo prezzo da
riconciliare con quello che `createOrder` calcola davvero al checkout. Il
servizio ordini ha già una semantica dichiarata — se la promo viene messa in
pausa fra display e checkout si paga il listino
(`services/orders.ts:263`, commento «semantica last-word») — e il carrello la
eredita leggendo prezzi e sconti a ogni GET.

**Un negozio alla volta** (modello Glovo: aggiungere da un'altra bottega
svuota il carrello). Più semplice in ogni strato, ma penalizza esattamente il
comportamento che il prodotto vuole incoraggiare.

**Cancellare in silenzio le righe diventate invalide** al GET. Far sparire roba
senza spiegazione è peggio che mostrarla con la ragione accanto.

## Modello dati

Una sola tabella nuova, `apps/api/src/db/schemas/cart.ts`. **Niente tabella
`carts`**: il carrello *è* l'insieme delle righe di un `customer_profile`, quindi
non c'è riga-contenitore da creare al primo add né da raccogliere quando si
svuota.

```ts
export const cartItem = pgTable(
  "cart_items",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    customerProfileId: text("customer_profile_id")
      .notNull()
      .references(() => customerProfile.id, { onDelete: "cascade" }),
    storeProductId: text("store_product_id")
      .notNull()
      .references(() => storeProduct.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("cart_item_customer_store_product_idx").on(
      table.customerProfileId,
      table.storeProductId,
    ),
    index("cart_item_store_product_id_idx").on(table.storeProductId),
    check("cart_item_quantity_range", sql`${table.quantity} BETWEEN 1 AND 99`),
  ],
);
```

- **`storeProductId`, non `productId`.** Pinna prodotto *e* negozio in una
  colonna sola, ed è esattamente ciò che `POST /customer/orders` si aspetta. Il
  raggruppamento per negozio è una join in lettura, non una colonna
  denormalizzata da tenere in sync.
- **`onDelete: cascade` sullo store product.** Se il venditore toglie il
  prodotto da quel negozio la riga sparisce — corretto per un carrello, al
  contrario di `order_items`, che snapshotta perché deve restare leggibile per
  sempre (`db/schemas/order.ts:139`).
- **Nessun indice su `customerProfileId` da solo:** è il prefisso sinistro
  dell'unique. L'indice su `storeProductId` invece serve, perché il cascade
  della FK non può usare quell'unique — stesso ragionamento già documentato per
  `store_product_store_id_idx` (`db/schemas/product.ts:156`).
- **`quantity BETWEEN 1 AND 99`** a livello DB, non solo in TypeBox: la casa usa
  CHECK a specchio del dominio (`order_item_quantity_positive`,
  `product_status_valid`).

## Contratto API

Nuovi `modules/customer/routes/cart.ts` e `services/cart.ts`, montati **dentro**
il guard autenticato di `modules/customer/index.ts:21` — così `customerProfile` è
già risolto dal `.resolve()` esistente e non serve alcun lookup nei handler.

| Metodo | Path | Corpo | Semantica |
|---|---|---|---|
| `GET` | `/customer/cart` | — | Carrello completo, già raggruppato per negozio |
| `POST` | `/customer/cart/items` | `{ storeProductId, quantity }` | Upsert: se la riga esiste, **somma** |
| `PATCH` | `/customer/cart/items/:id` | `{ quantity }` | Set assoluto (lo stepper) |
| `DELETE` | `/customer/cart/items/:id` | — | Rimuove una riga |

Il `GET` porta anche `itemCount` e `total`, così il badge in header non ha
bisogno di un endpoint proprio.

`DELETE /customer/cart` (svuota tutto) è **omesso**: con la rimozione per riga
non serve, e non c'è ancora un flusso che lo richieda.

**Nessun campo data nel DTO.** Eden Treaty idrata le stringhe-data in `Date` e
manderebbe in errore il render; `StoreProductCardSchema`
(`lib/schemas/entities.ts:746`) ha già questa accortezza documentata. `createdAt`
e `updatedAt` restano in tabella e non escono.

Forma della risposta del `GET` (schemi in `lib/schemas/entities.ts`, re-export da
`index.ts`, `description` in italiano):

```
{
  groups: [{
    store: { id, name, municipality: { name, provinceAcronym } },
    items: [{
      id, storeProductId, quantity,
      product: { id, name, imageUrl },
      unitPrice, discountedPrice, discountPercent,
      lineTotal, availableStock,
      issue: "ok" | "insufficient_stock" | "unavailable"
    }],
    subtotal
  }],
  itemCount,
  total
}
```

## Regole di dominio

**Aggiunta validata, lettura tollerante.** Il `POST` rifiuta se il negozio non
supera `publiclyVisibleStore()` (`lib/store-visibility.ts:11`), se il prodotto
non è `active`, o se la quantità risultante supera lo stock. Il `GET` invece non
fallisce **mai**: annota ogni riga con `availableStock` e un `issue`, e lascia
decidere al cliente.

Casi al bordo, fissati per non lasciarli all'implementazione:

| Caso | Comportamento |
|---|---|
| `POST` la cui somma supera 99 | 400, messaggio sul limite per riga. Il CHECK non deve mai essere ciò che ferma la richiesta |
| `PATCH` con `quantity: 0` | 400 (`minimum: 1`). La rimozione passa dal `DELETE`; nello stepper, a quantità 1 il `−` diventa un cestino |
| Riga con `stock` sceso sotto la quantità, **incluso stock 0** | `issue: "insufficient_stock"`, con `availableStock` a dire quanto ne resta (anche 0) |
| Negozio uscito da `publiclyVisibleStore()` o prodotto non più `active` | `issue: "unavailable"`. Il negozio compare comunque come gruppo, così il cliente capisce di cosa si parla |
| Prodotto tolto dal negozio (riga `store_products` cancellata) | La riga di carrello non esiste più: il cascade l'ha rimossa. Nessun `issue` da mostrare |

**Il carrello non riserva stock.** Nessun decremento: quello lo fa `createOrder`
in transazione, dove sta bene. Il carrello è intento, non prenotazione.

**Prezzi via `getBestActiveDiscounts`** — la versione batch, che esiste già
(`modules/seller/services/discount-pricing.ts:70`) ed è quella usata dal catalogo:
una query per tutte le righe, non l'N+1 che `createOrder` si concede
deliberatamente dentro la transazione.

**IDOR.** `PATCH` e `DELETE` filtrano per `customerProfileId` oltre che per `id`,
e su riga altrui rispondono **404**, non 403: non si conferma l'esistenza di
righe di altri.

**Debito noto:** nessuno svuota il carrello dopo l'ordine, perché il checkout non
esiste. Rimuovere le righe ordinate sarà parte di quella PR.

## Frontend

### Il catalogo deve esporre l'ID d'acquisto

`getStoreProducts` (`services/store-products.ts:21`) va convertito dall'`EXISTS`
a una JOIN su `store_products` filtrata per `store_id`, aggiungendo
`storeProductId` e `stock` a `StoreProductCardSchema`. La cardinalità non cambia:
`store_product_product_store_idx` è unique su `(product_id, store_id)`.

Attenzione alla trappola già documentata in quel file: dentro un `sql` usato come
**campo della SELECT** Drizzle rende le Column interpolate senza qualificarle, il
che romperebbe la subquery correlata delle immagini. La JOIN va nella clausola
`.from()/.innerJoin()`, non nel template.

### Componenti

- `ProductTile` guadagna `action?: ReactNode` e resta presentazionale. La
  discovery non la passa (tile senza controlli, come oggi); solo il catalogo del
  negozio ci mette il pulsante.
- `features/cart/use-cart.ts` — query `["cart"]` + le tre mutation, ognuna con
  `invalidateQueries(["cart"])`. Nessuno stato locale che duplichi il server.
- `features/cart/add-to-cart.tsx` — "Aggiungi" finché la riga non c'è, poi
  stepper −/+ che legge la quantità dalla stessa query. Disabilitato a
  `stock === 0`; il `+` si ferma allo stock.
- `features/cart/cart-badge.tsx` — contatore in `SiteHeader`, da `itemCount`.
- `routes/_authenticated/cart.tsx` — sezioni per negozio (nome + comune in testa,
  «trust through identity»), righe con immagine/nome/prezzo/stepper/rimuovi,
  subtotale per gruppo, totale in fondo, empty state verso `/stores`. Le righe
  con `issue` diverso da `ok` mostrano la ragione e l'azione per toglierle.

Toast via `@bibs/ui/components/sonner`, mai da `sonner` diretto.
`routeTree.gen.ts` va **committato** con la route nuova: è generato ma tracciato,
e rigenerato da build/dev, non da `tsc` — dimenticarlo dà CI rossa con locale
verde.

### Migrazione Paraglide dello storefront

Commit separato **che precede** il carrello
(`refactor(customer): move storefront copy to Paraglide`), così il diff del
carrello resta leggibile. ~60 stringhe su una decina di file; le più dense sono
`routes/_authenticated/profile.tsx`, `routes/_authenticated/stores/index.tsx` e
`features/discovery/nearby-products.tsx`.

Un file merita attenzione: `features/stores/format-opening-hours.ts` è una
funzione **pura con test** (`format-opening-hours.test.ts`). Le sue stringhe
(nomi dei giorni, "Chiuso") vanno passate come parametro dal chiamante o estratte
in un dizionario iniettabile, non importando `m` dentro il modulo puro: l'import
di Paraglide in un modulo puro lega il test al runtime i18n. Se il costo si
rivela sproporzionato, quel singolo file resta fuori dalla migrazione e la
ragione va scritta nel commit.

## Test

**TDD sul servizio di dominio**, come impone CLAUDE.md per la logica nuova.

`apps/api/tests/integration/customer-cart.test.ts`:

- upsert che somma sulla riga esistente invece di duplicarla;
- quantità oltre lo stock → 400, sia sul `POST` sia sul `PATCH`;
- negozio non `publiclyVisibleStore()` → 404;
- prodotto non `active` → 404;
- raggruppamento con prodotti di due negozi distinti;
- prezzo scontato e `discountPercent` presenti in lettura quando la promo è
  attiva;
- riga con stock sceso sotto la quantità → `issue: "insufficient_stock"`, e il
  `GET` risponde comunque 200;
- IDOR: `PATCH`/`DELETE` su riga di un altro customer → 404.

`apps/api/tests/integration/customer-store-products.test.ts` guadagna
l'asserzione su `storeProductId` e `stock`.

## Verifica

```bash
bun run typecheck   # da root: Eden propaga i tipi su tre frontend
bun run lint
bun run test        # apps/api
bun run db:generate # poi LEGGERE l'SQL prima di db:migrate
```

Più lo smoke in browser su `http://localhost:3001` con un customer di seed
(password `password123`, `db/seed/fixtures/customers.ts:56`): aggiungere dal
catalogo di un negozio, vedere il badge salire, cambiare quantità, rimuovere,
aggiungere da un secondo negozio e verificare i due gruppi. Il typecheck non
verifica l'UI.
