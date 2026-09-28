# Checkout customer (PP1 + PR2), ordini seller e ritiro con QR — design

**Date:** 2026-09-24
**Status:** approved
**Riferimenti:** i riferimenti `file:riga` puntano a `main` @ `0525104`
**Backlog:** chiude P1.1, P1.2, P1.5, P6.2 di
[`docs/audit/2026-09-24-followup-gap-analysis.md`](../../audit/2026-09-24-followup-gap-analysis.md);
avanza P1.6 (tab Ordini)

## Problema

Il cliente riempie il carrello (PR #163) ma non può comprare: `cart.tsx:70` non ha
CTA perché non esiste una pagina di checkout. L'API ha già `createOrder`
(`customer/services/orders.ts:168`) con stock atomico, snapshot di prodotto e IVA,
idempotenza e regola di vendibilità (#194), ma:

- lavora su **un negozio e una lista di righe mandata dal client**, e non tocca
  `cart_items`: dopo l'ordine le righe restano nel carrello (debito #163);
- i tipi `pay_*` creano ordini `confirmed` **senza che nessuno abbia pagato**: per i
  clienti non esiste alcun pagamento online (Stripe serve solo agli abbonamenti
  seller);
- il castelletto IVA (`orders.ts:310-318`) è costruito **prima** dello sconto punti,
  quindi con punti spesi `Σ castelletto ≠ total` (P6.2);
- l'indirizzo di spedizione è solo una FK `set null` (`order.ts:55-57`): cancellarlo
  dalla rubrica lo toglie agli ordini passati (P1.5);
- il ritiro lo conferma il **cliente** (`POST /customer/orders/:id/pickup`), non il
  negozio;
- il seller non ha nessuna pagina ordini (P1.2), anche se l'API c'è
  (`seller/routes/orders.ts`: lista, dettaglio, `ready`, `ship`, `complete`).

## Tipologie d'acquisto

Nomi di prodotto concordati col team, mappati sull'enum esistente `orderTypes`:

| Codice | Nome | Tipo API | Pagamento | Chiusura |
|---|---|---|---|---|
| **PP1** | Prenota e paga in negozio | `reserve_pickup` | in negozio, al ritiro | QR scansionato dal negoziante; scade dopo `config.reservationHours` (48h) |
| **PR2** | Paga e ritira | `pay_pickup` | online, al checkout | QR scansionato dal negoziante |
| **PS3** | Paga e spedizione | `pay_deliver` | — | **rimandato** (vedi «Fuori scope») |

`direct` resta nell'enum e nell'API ma non è offerto al checkout.

## Decisioni di prodotto

1. Checkout **multi-negozio**: un solo checkout trasforma tutti i negozi del carrello
   in ordini, **uno per negozio**.
2. Il cliente sceglie la tipologia **per negozio**, obbligatoriamente, tra quelle che
   **il negozio consente**.
3. **Niente punti** al checkout v1 (l'API `POST /customer/orders` continua ad
   accettarli).
4. PR2 incassa online con **Stripe Connect Express**: onboarding del seller ospitato
   da Stripe; il campo `stripeAccountId` manuale sparisce.
5. **Commissione bibs del 5%** sui pagamenti online, costante in config, salvata
   sull'ordine.
6. Il ritiro (PP1 e PR2) si conferma con un **QR** mostrato dal cliente e
   **scansionato dal negoziante**.
7. **P1.2 completa**: pagina ordini seller con lista, filtri, dettaglio e castelletto.
8. Voce **Ordini** in navbar customer con una tab per tipologia: PP1 con il timer,
   PR2 con dettaglio e QR.

## Flusso customer

1. **Carrello** (`/cart`): nuova CTA «Avanti» sotto il totale, attiva se esiste
   almeno un negozio con righe acquistabili.
2. **Scelta** (`/checkout`): una sezione per negozio con le sue righe e un selettore
   obbligatorio della tipologia, che mostra solo i tipi consentiti. Un negozio con un
   solo tipo lo mostra preselezionato. «Avanti» si attiva quando ogni negozio ha una
   scelta. Stato della scelta in search params (sopravvive al refresh, niente store
   client).
3. **Riepilogo** (`/checkout/review`): per negozio tipologia, righe e subtotale; poi
   «Da pagare ora» (somma PR2) e «Da pagare in negozio» (somma PP1). Il bottone dice
   cosa succede: **PRENOTA** (solo PP1), **PAGA** (solo PR2), **PRENOTA E PAGA**
   (misto). Per PP1 si mostra la regola del timer («hai 48 ore per ritirare»).
4. **Conferma**: il bottone chiama `POST /customer/checkout`.
   - Solo PP1: la risposta porta subito alla **pagina di ordine effettuato**
     (`/checkout/$checkoutId`).
   - Con PR2: si passa al **pagamento** (`/checkout/$checkoutId/pay`, Payment
     Element), poi alla stessa pagina di ordine effettuato. Gli ordini PP1 dello
     stesso checkout sono già confermati e non dipendono dall'esito del pagamento.
5. **Ordini** (`/orders`, voce in navbar): tab **PP1**, lista con timer a scadenza
   (calcolato da `reservationExpiresAt`); tab **PR2**, lista con «Dettagli» e «QR».
   Il dettaglio (`/orders/$orderId`) mostra righe, totale, negozio, stato e, per gli
   ordini ritirabili, il QR con il codice in chiaro sotto.

## Architettura

### Entità `checkouts` (nuova)

```
checkouts
  id                        text pk
  customer_profile_id       text fk → customer_profiles (cascade)
  idempotency_key           text unique not null
  stripe_payment_intent_id  text unique null      -- solo con righe PR2 (PR F)
  amount_due_online         numeric(10,2) not null -- Σ total degli ordini PR2
  created_at                timestamptz
orders.checkout_id          text fk → checkouts (set null), indicizzata
```

L'idempotenza vale per il checkout, non per l'ordine: un doppio click o un retry di
rete restituisce lo stesso checkout con gli stessi ordini.

### `POST /customer/checkout`

Body: `{ idempotencyKey: uuid, stores: [{ storeId, type: "reserve_pickup" | "pay_pickup" }] }`
(almeno un negozio, `storeId` unici).

- Le **righe si leggono dal carrello lato server** (`cart_items` del cliente per quel
  negozio). Il client non manda prodotti né quantità: così si svuota esattamente ciò
  che è stato ordinato e il client non può divergere dal carrello.
- Le righe `unavailable` vengono **saltate** e restano nel carrello. Una riga con
  `insufficient_stock` fa fallire il checkout con **409** e il FE ricarica il
  carrello. Un negozio senza righe acquistabili → 409.
- Il tipo deve stare in `stores.order_types` → altrimenti 400. `pay_pickup` richiede
  anche il conto Connect del seller abilitato (`charges_enabled`) → altrimenti 400.
- **Una sola transazione** per tutti gli N ordini (tutto o niente): nessun
  «ho prenotato metà carrello». Nella stessa tx si cancellano le righe ordinate da
  `cart_items`.
- Ogni ordine passa per il core estratto `placeOrder(tx, …)` (PR A), lo stesso di
  `POST /customer/orders`.
- Risposta: `{ checkoutId, orders: [...], payment: null | { clientSecret } }`.

### Core `placeOrder(tx, params)` (estratto da `createOrder`)

`createOrder` oggi fa vendibilità, stock, sconto venditore, snapshot, castelletto,
punti e decremento in un'unica funzione con la sua transazione. Il corpo della tx
diventa `placeOrder(tx, params)`; `createOrder` resta il wrapper con idempotenza e
tx. Il checkout chiama `placeOrder` N volte dentro la sua tx. I test esistenti di
`POST /customer/orders` devono restare verdi senza modifiche.

### P6.2 — Sconto punti ripartito tra le aliquote

Funzione pura in `lib/vat.ts`:

```ts
apportionDiscount(
  lines: { grossCents: number; rate: number }[],
  discountCents: number,
): { grossCents: number; rate: number }[]
```

- Aggrega il lordo per aliquota e ripartisce lo sconto **in proporzione al lordo** di
  ciascuna aliquota, con il **metodo dei resti maggiori** al centesimo (a parità di
  resto vince l'aliquota più alta, per determinismo).
- Invarianti testate: `Σ sconto ripartito == discountCents`; nessuna aliquota va
  sotto zero; con `discountCents == 0` restituisce l'input aggregato.
- `placeOrder` costruisce il castelletto sul lordo **già scontato**:
  `Σ(taxableAmount + taxAmount) == total`. Test d'integrazione su un ordine a due
  aliquote con punti.
- `order_items.vatAmount` resta lo scorporo della riga prima dei punti (è lo
  snapshot del prezzo di riga); l'unica fonte fiscale dell'ordine è `vatBreakdown`.
  Il commento a `orders.ts:310` si aggiorna.

### P1.5 — Snapshot dell'indirizzo

`orders.shipping_address_snapshot jsonb` nullable (`recipientName`, `phone`,
`addressLine1`, `addressLine2`, `zipCode`, `municipalityName`, `provinceAcronym`,
`country`), scritto da `placeOrder` quando c'è un indirizzo. La FK
`shipping_address_id` resta `set null`. Le letture customer e seller mostrano lo
snapshot quando la FK è nulla. Oggi serve solo agli ordini `pay_deliver` creati via
API; prepara PS3.

### Tipologie consentite dal negozio

`stores.order_types text[] not null default '{reserve_pickup}'`, con CHECK di
sottoinsieme di `{reserve_pickup, pay_pickup}` e di non vuoto. Il seller le imposta
nella pagina del negozio. `pay_pickup` si può attivare solo con il conto Connect
abilitato: fino alla PR E il toggle è visibile ma disabilitato con spiegazione. La
risposta di `GET /customer/cart` porta `orderTypes` per negozio, e per `pay_pickup`
lo include solo se il seller può incassare.

### Macchina a stati

Nessuna transizione nuova in `order-state-machine.ts`: bastano quelle esistenti.

- **PP1**: `confirmed` (timer) → `ready_for_pickup` (seller, facoltativo) →
  `completed` (QR). Da `confirmed` può andare a `cancelled` (cliente o seller) o a
  `expired` (cron `expireReservations`, già esistente). Stock e punti si rimborsano
  come oggi.
- **PR2**: nasce `pending` con lo stock già decrementato e
  `payment_expires_at = now + 30 min`. `payment_intent.succeeded` → `confirmed` +
  trasferimento → `ready_for_pickup` → `completed` (QR). Pagamento fallito o scaduto
  (cron ogni minuto su `pending` scaduti) → `cancelled` + restock. Annullamento di un
  PR2 pagato → rimborso Stripe + storno del trasferimento, dentro lo stesso flusso
  CAS di `cancelOrder`.

### QR di ritiro (PR D)

- Il codice **non è un segreto**: il seller può già chiudere qualunque ordine dei
  suoi negozi (`POST /seller/orders/:id/complete`). Serve a trovare l'ordine giusto
  al banco e a verificare che chi ritira lo abbia davvero. Quindi è corto e unico
  solo dove serve.
- `orders.pickup_code text null`: 6 caratteri da un alfabeto senza ambigui
  (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`, niente 0/O/1/I/L), generato da `placeOrder`
  per i tipi ritirabili. Unico tra gli ordini **aperti** dello stesso negozio:
  indice unico parziale su `(store_id, pickup_code)` con
  `status IN ('pending','confirmed','ready_for_pickup')`. In caso di collisione
  (unique violation) si rigenera, con un massimo di 3 tentativi.
- Il QR codifica lo stesso codice, mai l'id dell'ordine. Sotto il QR il codice si
  mostra in chiaro, da leggere a voce o digitare.
- `POST /seller/orders/pickup { code }`: cerca per `(negozio attivo del seller,
  codice)`, normalizzato in maiuscolo e senza spazi. Un codice di un altro negozio
  equivale a un codice inesistente → 404.
  Stati accettati: `confirmed` o `ready_for_pickup`. Sempre CAS verso `completed` e
  accredito punti come in `pickupOrder`. Una prenotazione scaduta si comporta come
  oggi: expire più rimborso, poi 400.
- Una risposta di **anteprima** (`GET /seller/orders/pickup/:code`) mostra al
  negoziante righe, totale e tipologia prima di confermare: per PP1 deve prima
  incassare alla cassa.
- Il seller ha una pagina «Ritiro» con fotocamera (lettura QR nel browser) e campo
  manuale.
- `POST /customer/orders/:id/pickup` e `pickupOrder` lato customer **si rimuovono**:
  il ritiro lo conferma solo il negozio.

### Pagamento PR2 (PR E + F)

- **Connect Express** (PR E): «Attiva pagamenti online» nelle impostazioni seller →
  `accounts.create` (type express, country IT) + Account Link. La tabella
  `payment_methods` diventa la fonte del conto con `stripe_account_id`,
  `charges_enabled`, `payouts_enabled`, aggiornati dal webhook `account.updated`. Si
  rimuovono la richiesta di modifica `payment` (`seller/services/settings.ts:355`) e
  la sua approvazione admin (`admin/services/sellers.ts:525`).
- **Separate charges and transfers** (PR F): un solo PaymentIntent sulla piattaforma
  per l'importo PR2 del checkout, `transfer_group = checkoutId`. Il cliente paga una
  volta sola anche con più negozi.
- Su `payment_intent.succeeded` (webhook idempotente sulla tabella `stripe_events`
  esistente): ogni ordine PR2 del checkout va CAS `pending → confirmed`, poi un
  `transfers.create` per ordine con `amount = total − platformFee`,
  `destination = conto del seller`, `source_transaction = charge`. Il trasferimento
  parte solo a incasso avvenuto.
- **Commissione**: `config.platformFeePercent = 5`; `orders.platform_fee` numeric,
  calcolata alla creazione (`Math.round(totalCents * 5 / 100)`), per gli ordini non
  PR2 resta 0. Le fee Stripe restano a bibs e le copre la commissione.
- `orders.stripe_transfer_id` per lo storno all'annullamento.
- **Annullamento seller di un PR2** (vincolo emerso nella review della PR B): oggi
  `PATCH /seller/orders/:id/cancel` rimborsa solo stock e punti. Con la PR F:
  da `confirmed` deve rimborsare anche il pagamento e stornare il trasferimento;
  da `pending` deve annullare il PaymentIntent nello stesso flusso (o essere
  vietato), altrimenti un ordine annullato può risultare pagato. Il testo del
  dialog seller va aggiornato con il rimborso; serve anche una tab `pending`.
- FE: `@stripe/stripe-js` + `@stripe/react-stripe-js`, Payment Element su
  `/checkout/$checkoutId/pay` con il `clientSecret` del checkout; `return_url` porta
  alla pagina di ordine effettuato, che legge lo stato dall'API (non dall'URL).

**Implementazione (PR F):** un rifiuto della carta non annulla gli ordini (il
cliente riprova sulla stessa pagina); si annullano alla scadenza dei 30 minuti o
su `payment_intent.canceled`. Un PR2 `pending` non si annulla a mano (409): il
PaymentIntent copre tutto il checkout. Lo storno del trasferimento è
best-effort, il rimborso al cliente no. Solo carte (wallet inclusi). Dettagli e
motivazioni: `docs/superpowers/plans/2026-09-25-pr-f-pay-pickup.md`, «Rulings».

### Seller — P1.2 (PR B)

- Route `orders` nel seller: lista del negozio attivo (tabella con filtri stato e
  tipologia, ordinamento per data), dettaglio con righe, snapshot, **castelletto IVA**
  da `vatBreakdown`, timer per PP1, azioni «Pronto per il ritiro» e «Annulla».
- Le azioni usano le route esistenti (`ready`, `complete`) più un `cancel` seller se
  manca (da verificare nella PR B).
- Pagina negozio: sezione «Tipologie d'acquisto» con i toggle.

## Taglio in PR

| PR | Contenuto | UI | Chiude |
|---|---|---|---|
| **A** | `apportionDiscount` + castelletto dopo i punti, snapshot indirizzo, estrazione di `placeOrder` | — | P6.2, P1.5 |
| **B** | `stores.order_types` + UI; pagina ordini seller completa | seller | P1.2 |
| **C** | `checkouts`, `POST /customer/checkout` (solo PP1 abilitato), svuotamento carrello, CTA + scelta + riepilogo + ordine effettuato, `/orders` con tab PP1 e dettaglio | customer | — |
| **D** | `pickup_code`, anteprima + conferma seller, pagina «Ritiro» seller, QR nel dettaglio customer, rimozione del pickup customer | entrambe | — |
| **E** | Connect Express, `account.updated`, rimozione del flusso manuale; toggle PR2 attivabile | seller, admin | — |
| **F** | PR2 end-to-end: `pending`, PaymentIntent, Payment Element, webhook, trasferimenti, fee, scadenza, rimborso; tab PR2 | customer | P1.1 |

Ogni PR sta in piedi da sola sul main: con B–D il prodotto funziona già per PP1.

## Test

- **TDD** (RED prima del codice) su: `apportionDiscount` (unit, invarianti sopra);
  castelletto post-punti (integrazione); checkout multi-negozio tutto o niente (un
  negozio con stock insufficiente → nessun ordine, carrello intatto); svuotamento
  del carrello (solo le righe ordinate, le `unavailable` restano); idempotenza del
  checkout; tipo non consentito → 400; scansione QR (codice di un altro negozio → 404, collisione del codice → rigenerato,
  doppia scansione → 409, prenotazione scaduta → expire più rimborso); webhook di
  pagamento (doppio evento → un solo trasferimento), scadenza dei `pending`.
- Stripe nei test: mock del client Stripe come nei test di billing esistenti, niente
  chiamate di rete.
- FE: smoke nel browser (customer :3001, seller :3002) per ogni PR con UI, mouse e
  tastiera; smoke manuale a Marco prima del merge.

## Fuori scope / aperti

- **PS3 Paga e spedizione**: rimandato a una decisione dedicata sulla logistica
  (tariffa del seller vs preventivo da aggregatore come Sendcloud o ShippyPro, peso e
  dimensioni dei prodotti). Quando arriva: `shippingCost` va sommato al `total`
  (oggi non lo è, `orders.ts:189`), indirizzo predefinito preselezionato, tab PS3.
- **Punti al checkout** e **chi finanzia lo sconto punti** (negozio o bibs, con un
  eventuale conguaglio su PP1 pagati in negozio): da rivedere insieme. P6.2 rende già
  corretto il castelletto quando i punti ci sono.
- **P1.6** oltre alle tab: movimenti punti e storico completo.
- Fatturazione (SDI/XML, scontrino telematico, Stripe Tax) resta in P6.2 «layer
  fatturazione».
