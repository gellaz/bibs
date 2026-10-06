# Punti fedeltà nel checkout dal carrello — design

**Date:** 2026-10-06
**Status:** in revisione
**Riferimenti:** i percorsi puntano a `main` @ `7fe39bd`
**Prerequisito:** #247 (sconto punti a carico di bibs, `orders.points_discount`,
`storePayoutSplit`, trasferimento quota punti, `retryStoreTransfers`). Regola di prodotto in
[`docs/pagamenti.md`](../../pagamenti.md#chi-paga-lo-sconto-punti).

## Problema

`placeOrder` (`apps/api/src/modules/customer/services/orders.ts`) sa già spendere punti
(`pointsToSpend`, 100 punti = 1 €, CAS sul saldo, registro `point_transactions`, solo
`pay_pickup`), ma:

- `createCheckout` (`apps/api/src/modules/customer/services/checkout.ts`) non gli passa mai
  `pointsToSpend`, e l'app customer non ha nessuna UI per usarli;
- un checkout con più negozi `pay_pickup` ha **un solo** PaymentIntent (somma dei totali PR2):
  manca la regola per dividere i punti tra gli ordini;
- **importo da pagare 0 €**: il PaymentIntent non nasce (`if (amountDueCents > 0)`), gli ordini
  restano `pending` e `expireUnpaidOrders` li annulla dopo 30 minuti. In più
  `settleCheckoutPayment` richiede un PI con charge e `retryStoreTransfers` filtra
  `stripe_payment_intent_id IS NOT NULL`: la quota punti al negozio non partirebbe mai;
- **importo tra 0,01 € e 0,49 €**: Stripe rifiuta il PaymentIntent (minimo 0,50 € in EUR) →
  502, checkout fallito.

## Decisioni di prodotto

1. **Soglia 0,50 €: si paga 0 € oppure almeno 0,50 €.** Se il saldo copre tutto, si copre tutto
   (0 €, nessuna carta). Se il residuo finirebbe tra 0,01 e 0,49 € e il saldo non basta per
   azzerarlo, si usano meno punti, quanto serve a lasciare esattamente 0,50 €.
2. **Un solo totale di punti per checkout, ripartito tra i PR2 in proporzione al lordo** (resti
   maggiori). Annullando un solo ordine tornano i punti di quell'ordine.
3. **Interruttore tutto/niente** «Usa N punti · −X €» nel riepilogo (`/checkout/review`), sotto
   «Paga ora». Acceso usa il massimo spendibile (saldo, plafonato al totale PR2 e alla regola
   del punto 1). Nessuna quantità libera.
4. **Spento di default.** Lo stato vive nella pagina, non nell'URL: un ricaricamento lo riporta
   spento.
5. **Nessun PR2 scelto:** nel riepilogo l'interruttore non c'è. Se il saldo è > 0, in
   `/checkout` la spiegazione di «Paga e ritira» aggiunge «Puoi usare i tuoi N punti».
6. Invariati: si guadagna 1 punto per euro del `total` pagato al completamento; un checkout a 0 €
   porta alla pagina di conferma come una prenotazione.

## Decisioni tecniche

### Contratto: conferma booleana, anteprima dall'API (approccio C)

- `POST /customer/checkout` aggiunge `usePoints?: boolean` (default `false`). Il client non
  manda mai un numero di punti: il server legge il saldo e ricalcola tutto alla conferma.
- Nuovo `GET /customer/checkout/preview?stores=<storeId>:<type>,…` (stesso formato di
  `serializeChoice` nel customer). Calcola gli importi con **le stesse funzioni** della conferma,
  in sola lettura, e restituisce entrambi gli scenari, così l'interruttore non fa chiamate:

  ```ts
  {
    balance: number,               // saldo punti del cliente
    payInStore: string,            // Σ totali reserve_pickup
    withoutPoints: { amountDueOnline: string },
    withPoints: {
      pointsSpent: number,
      discount: string,
      amountDueOnline: string,
      perStore: { storeId: string; pointsSpent: number; discount: string }[],
    } | null,                      // null se nessun PR2, saldo 0 o sconto applicabile 0
  }
  ```

- Scartato A (regola copiata nel FE): due copie della regola, e prezzi diversi tra carrello
  (`getBestActiveDiscounts`, batch SQL) e conferma (`getBestActiveDiscount` per riga). Scartato B
  (`pointsToSpend` numerico): a saldo o prezzi cambiati obbliga a scegliere tra 400 e correzione
  silenziosa, cioè di nuovo A.

### Allocazione: `apps/api/src/lib/points-allocation.ts` (puro)

`allocateCheckoutPoints({ balance, grossCents: number[] }) → { pointsPerOrder: number[], discountCentsPerOrder: number[] }`

1. `Σ = somma dei lordi`; sconto massimo `D = min(centesimi del saldo, Σ)`, dove centesimi del
   saldo `= floor(balance * 100 / pointsPerEuroDiscount)`.
2. Se `0 < Σ − D < 50`: con `centesimi del saldo ≥ Σ` → `D = Σ`; altrimenti `D = max(0, Σ − 50)`.
3. `D` ripartito sui lordi con resti maggiori (riuso `apportionDiscount` di `lib/vat.ts` se la
   firma regge, altrimenti una gemella locale con lo stesso algoritmo). Σ delle quote = `D`.
4. Punti per ordine `= quota_cent * pointsPerEuroDiscount / 100` (oggi 1:1, intero).
5. Costante `STRIPE_MIN_CHARGE_CENTS = 50` in `lib/config.ts`.

### `placeOrder` diviso in due fasi

- `priceOrder(tx, params)`: validazioni (tipo, indirizzo, negozio vendibile, prodotti, stock),
  prezzi e sconti venditore → `{ totalCents, resolvedItems, … }`. Sola lettura.
- `insertOrder(tx, priced, { pointsToSpend, link })`: punti, castelletto, insert ordine/righe,
  scalo stock, CAS punti, registro. Il codice dei punti è quello che c'è oggi.
- `placeOrder` resta `priceOrder` + `insertOrder` in fila: `createOrder` e i test esistenti non
  cambiano comportamento.

### `createCheckout` e anteprima condividono la validazione

- `resolveCheckoutLines(tx, { customerProfileId, stores, lock })` estrae da `createCheckout` la
  lettura del carrello e i controlli (negozi duplicati 400, nessun articolo acquistabile 409,
  modalità non offerta 400, stock 409). Con `lock: true` fa il `FOR UPDATE` della conferma; la
  preview la chiama senza lock.
- `createCheckout`: risolve le righe, prezza ogni negozio, chiama `allocateCheckoutPoints` sui
  PR2 se `usePoints`, poi inserisce ogni ordine con la sua quota. `reserve_pickup` sempre senza
  punti (anche con `usePoints: true`: non è un errore).
- `previewCheckout`: stesse funzioni dentro una tx in sola lettura, nessuna scrittura; il saldo
  arriva dalla route (`cp.points`), come per la conferma.
- Saldo sceso tra anteprima e conferma: il CAS di `insertOrder` lancia il 409 «Punti
  insufficienti, riprova» già esistente; il FE rilegge la preview.

### Checkout a 0 €

- Ci sono PR2 e `amountDueCents === 0`: niente PaymentIntent; dentro la tx i PR2 passano a
  `confirmed` con `paymentExpiresAt = null`; `amountDueOnline` resta `0`. `expireUnpaidOrders`
  guarda solo i `pending`, quindi non li tocca.
- Dopo il commit, `transferStorePayouts(checkoutId, null)` fa partire la quota punti dal saldo
  bibs. Un fallimento non fa fallire la risposta (log + retry del cron).

### Trasferimenti

- Da `settleCheckoutPayment` (`apps/api/src/modules/billing/services/order-payments.ts`) estraggo
  il ciclo dei trasferimenti in `transferStorePayouts(checkoutId, chargeId: string | null)`. Con
  `chargeId = null` si salta `fromCharge` (a 0 € vale 0 per costruzione di `storePayoutSplit`);
  se `fromCharge > 0` e manca la charge è un errore di programmazione e si lancia.
- `retryStoreTransfers` (`apps/api/src/lib/jobs/retry-store-transfers.ts`) seleziona anche i
  checkout senza PI con ordini PR2 pagati e quota punti mancante, e li manda direttamente a
  `transferStorePayouts(checkoutId, null)`; quelli con PI continuano a passare da
  `settleCheckoutPayment` dopo il controllo `succeeded`.

### Fuori scope

Un checkout PR2 con lordo già sotto 0,50 € fallisce oggi con 502, punti o no. Con i punti spenti
resta così; va in una PR a parte (minimo d'ordine o messaggio dedicato).

## UI customer

- **`/checkout`** (`features/checkout/store-choice.tsx`): con saldo > 0 (da `useCustomerPoints`)
  la spiegazione di «Paga e ritira» aggiunge «Puoi usare i tuoi N punti».
- **`/checkout/review`** (`routes/_authenticated/checkout/review.tsx`):
  - «Paga ora», «Paga in negozio» e la riga punti vengono dalla preview; le righe articolo
    restano quelle del carrello.
  - Interruttore (spento) solo se `withPoints != null`: «Usa 1.240 punti · −12,40 €» con il
    saldo sotto; se usa meno del saldo, «Usa 1.190 dei tuoi 1.240 punti». Acceso: «Da pagare con
    carta X €». Con più PR2, ogni blocco negozio mostra «Punti −Y €».
  - A 0 €: bottone «Conferma ordine»; la conferma porta a `/checkout/$id` perché `payment` è
    `null` (già così).
  - Caricamento: skeleton nei totali, bottone disabilitato. 409: toast e ritorno al carrello
    (stessa `checkoutFailure`). Errore di rete: «Riprova» inline.
  - Query key `["customer", "checkout-preview", serializeChoice(choice)]`; invalidata insieme a
    `CART_KEY` e `POINTS_KEY`. Dopo la conferma si invalida anche `POINTS_KEY`.
- **`/checkout/$checkoutId`**: con punti usati, «Punti usati: N (−X €)» sommando `pointsSpent`
  e `pointsDiscount` degli ordini. La pagina di pagamento mostra già `amountDueOnline` netto.
- Stringhe nuove in it/en (paraglide).

## Test

- **Unit API** `lib/points-allocation.test.ts` (prima del codice): saldo 0; saldo che copre
  tutto; residuo 0,01–0,49 € con saldo sufficiente (→ 0 €) e insufficiente (→ 0,50 €); Σ < 0,50 €
  (sconto 0); ripartizione con resti e somma esatta; un solo negozio; plafond al totale.
- **Unit FE** (Vitest): scelta dello scenario, etichette dell'interruttore, `confirmLabel` a 0 €.
- **Integrazione API** (`bun run test:integration`, Stripe mockato):
  - parità: gli importi della preview coincidono con gli ordini creati da `POST` con
    `usePoints: true`;
  - due PR2: punti ripartiti, un PI sul netto, registro `point_transactions` scalato;
  - 0 €: nessun PI, PR2 `confirmed` senza `paymentExpiresAt`, solo trasferimento punti,
    `expireUnpaidOrders` non li tocca;
  - 0 € con trasferimento fallito: `retryStoreTransfers` lo ritenta;
  - residuo sotto 0,50 €: PI da 0,50 €;
  - saldo sceso tra preview e conferma: 409;
  - `usePoints: true` con sole prenotazioni: nessun punto speso, nessun errore;
  - annullamento di un solo ordine: tornano solo i suoi punti;
  - la preview rifiuta come la conferma (409 carrello cambiato, 400 modalità non offerta).
- **Smoke manuale di Marco** prima della PR: 1 PR2 con e senza punti, 2 PR2, PR2 + prenotazione,
  totale coperto (0 €), residuo sotto 0,50 €; mouse e tastiera.

## Documentazione

`docs/pagamenti.md`, stessa PR: via il blocco «Non ancora attivo» e la voce in «Cosa NON esiste
ancora»; in «Chi paga lo sconto punti» la regola 0 / ≥0,50 €, l'esempio a due negozi, il flusso a
0 € (conferma immediata, solo quota punti, retry); diagramma PR2 aggiornato; tabella «Dove sta
nel codice» con `points-allocation.ts` e la preview; il caso fuori scope del lordo < 0,50 €.

## Sequenza dei commit (branch `feat/checkout-points`, una PR)

1. `allocateCheckoutPoints` + test.
2. `placeOrder` → `priceOrder` + `insertOrder`, senza cambiamenti di comportamento.
3. `resolveCheckoutLines` + `usePoints` in `createCheckout` + checkout a 0 €.
4. `transferStorePayouts` + `retryStoreTransfers` esteso ai checkout senza PI.
5. Endpoint di preview + test di parità.
6. FE: suggerimento in `/checkout`, interruttore e numeri dalla preview, riga punti in conferma,
   i18n.
7. `docs/pagamenti.md`.

Gate prima della PR: typecheck, `bun run test`, `bun run test:integration`, build dei FE, smoke.
