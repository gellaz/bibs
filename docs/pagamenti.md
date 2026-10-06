# Pagamenti — come girano i soldi in bibs

Guida concettuale a tutti i flussi di pagamento, con esempi numerici. Per far girare i
flussi in locale (chiavi, `stripe listen`, carte di test) vedi il runbook
[stripe-billing.md](stripe-billing.md); per l'architettura generale
[architecture.md](architecture.md).

> Le tariffe Stripe citate sono quelle pubblicate su <https://stripe.com/it/pricing> e
> <https://stripe.com/it/connect/pricing>, verificate il **2026-10-05**. Possono cambiare:
> ricontrollale prima di usarle per decisioni di prezzo.

## Il quadro in un minuto

In bibs ci sono **due flussi di denaro**, indipendenti:

| Flusso | Chi paga | Chi incassa | Quando |
|---|---|---|---|
| **Abbonamento negozio** | il seller | bibs | ogni mese, per ogni negozio attivo (default 29 €) |
| **Ordini dei clienti** | il cliente | il negozio (meno la commissione bibs) | solo per «Paga e ritira»; gli altri tipi si pagano in negozio |

Stripe entra in entrambi, ma in modo diverso:

- **Abbonamento** → Stripe Billing (Checkout in modalità `subscription`). bibs è il venditore.
- **Ordini online** → Stripe Connect, schema *separate charges and transfers*: il cliente
  paga **bibs**, poi bibs **trasferisce** al negozio la sua parte. bibs è *merchant of
  record*, quindi **tutte le fee Stripe le paga bibs** e le copre con la commissione del 5%.

## Tipologie d'ordine

Ogni negozio sceglie quali tipologie offrire (colonna `stores.order_types`); la regola
unica su cosa vede il cliente è `offeredOrderTypes` in
[`apps/api/src/lib/order-types.ts`](../apps/api/src/lib/order-types.ts).

| Tipo (`order.type`) | Etichetta in app | Pagamento | Stato oggi |
|---|---|---|---|
| `reserve_pickup` | «Prenota e paga in negozio» | in negozio, fuori da bibs | **attivo** |
| `pay_pickup` (PR2) | «Paga e ritira» | online con carta, al checkout | **attivo**, solo se il seller ha il conto Connect abilitato |
| `pay_deliver` (PS3) | «Paga e spedizione» | online + spedizione fissa 5 € | **non offerto**: esiste nell'enum e nella macchina a stati, nessun checkout lo propone |
| `direct` | — | — | **disabilitato** (era pensato per il QR in negozio, non costruito) |

### Prenota e paga in negozio (`reserve_pickup`)

```text
cliente fa il checkout ──► ordine «confirmed», stock scalato, codice di ritiro
                               │
           entro 48 h          ▼
seller: «pronto» ──► cliente ritira e paga alla cassa ──► seller: «completato»
                                                            └► punti accreditati
           oltre 48 h senza ritiro ──► cron: «expired», stock e punti restituiti
```

Nessun euro passa da bibs o da Stripe: bibs guadagna solo l'abbonamento del negozio.

### Paga e ritira (`pay_pickup`, PR2)

```text
checkout ──► ordine «pending», stock scalato, PaymentIntent creato (finestra 30 min)
   │
   ├─ cliente paga ──► webhook payment_intent.succeeded
   │                     ├► ordine «confirmed»
   │                     └► transfer al negozio = totale − commissione bibs
   │
   └─ nessun pagamento entro 30 min ──► cron expireUnpaidOrders
                         ├► PaymentIntent annullato (nessuna fee Stripe)
                         └► ordine «cancelled», stock e punti restituiti

confirmed ──► seller: «pronto» ──► ritiro con QR/codice ──► «completato» + punti
```

Dettagli che contano:

- **Un solo pagamento per checkout.** Se il carrello ha più negozi in «Paga e ritira», il
  cliente paga una volta sola (un PaymentIntent per la somma) e bibs fa un trasferimento
  per ogni negozio (`transfer_group` = id del checkout).
- **Solo carte** (Apple Pay e Google Pay inclusi): i metodi con conferma differita non
  stanno nella finestra di 30 minuti.
- **Il trasferimento parte appena il pagamento è confermato**, non al ritiro. Il negozio
  vede i soldi sul suo saldo Stripe e li riceve in banca secondo il calendario di payout.
- **Un pagamento in ritardo** (arrivato dopo che il cron ha già annullato l'ordine) viene
  rimborsato automaticamente.
- Lo stato si legge sempre dall'API, mai dall'URL di ritorno di Stripe.

## Commissione bibs e fee Stripe

La commissione è `platformFeePercent: 5` in
[`apps/api/src/lib/config.ts`](../apps/api/src/lib/config.ts), calcolata da
`platformFeeCents` sul totale dell'ordine e salvata in `orders.platform_fee`. Vale solo
per `pay_pickup`; per gli altri tipi è 0.

### Fee Stripe sui pagamenti (Italia)

| Carta | Fee |
|---|---|
| Standard SEE | 1,5% + 0,25 € |
| Premium SEE (business, alcune carte premium) | 2,8% + 0,25 € |
| UK | 2,5% + 0,25 € |
| Internazionale | 3,15% + 0,25 € |
| Conversione valuta | +2% (non ci riguarda: tutto in EUR) |

La fee si paga **solo sui pagamenti riusciti** e **non viene restituita sui rimborsi**.

### Fee Stripe Connect

Le paghiamo perché i prezzi verso i negozi li decidiamo noi (`fees_collector:
"application"` sul conto collegato):

| Voce | Costo |
|---|---|
| Conto attivo nel mese (ha ricevuto almeno un bonifico) | 2 € al mese per negozio |
| Bonifico (payout) dal saldo Stripe del negozio alla sua banca | 0,25% + 0,10 € per bonifico |

Il payout è **per bonifico, non per ordine**: con payout giornalieri o settimanali più
ordini finiscono nello stesso bonifico.

### Fee Stripe Billing (abbonamenti)

0,7% del volume fatturato, oltre alla fee carta della singola fattura.

## Esempi

Negli esempi «fee Stripe» è la fee carta standard SEE, arrotondata al centesimo.

### 1. Un ordine «Paga e ritira» da 40 €

| | Importo |
|---|---|
| Il cliente paga | 40,00 € |
| Commissione bibs (5%) | 2,00 € |
| Trasferimento al negozio | **38,00 €** |
| Fee Stripe (1,5% × 40 + 0,25) | 0,85 € |
| **Resta a bibs** | **1,15 €** |

Sul mese, per quel negozio, bibs paga anche i 2 € di conto attivo e le fee dei bonifici
(es. 38 € in un bonifico: 0,25% × 38 + 0,10 = 0,20 €).

### 2. Stesso ordine, carta premium

Fee Stripe = 2,8% × 40 + 0,25 = **1,37 €** → a bibs restano **0,63 €**. La carta la sceglie
il cliente: è una variabilità che non controlliamo.

### 3. Ordini piccoli: la soglia di pareggio

La parte fissa da 0,25 € pesa sugli ordini piccoli. Commissione e fee si pareggiano a:

| Carta | Pareggio | Ordine da 5 € |
|---|---|---|
| Standard SEE | ~7,15 € | commissione 0,25 €, fee 0,33 € → **−0,08 €** |
| Premium SEE | ~11,40 € | commissione 0,25 €, fee 0,39 € → **−0,14 €** |

Sotto soglia ogni ordine ci costa (prima ancora delle fee Connect).

### 4. Un carrello con tre negozi

| Negozio | Tipo | Totale | Commissione | Trasferimento |
|---|---|---|---|---|
| A | Paga e ritira | 30,00 € | 1,50 € | 28,50 € |
| B | Paga e ritira | 15,00 € | 0,75 € | 14,25 € |
| C | Prenota e paga in negozio | 20,00 € | — | — (paga in negozio) |

- Il cliente paga online **45,00 €** (A + B) in un unico pagamento; i 20 € di C li paga alla cassa.
- Fee Stripe: 1,5% × 45 + 0,25 = **0,93 €**, una volta sola (con due pagamenti separati i
  0,25 € fissi sarebbero due).
- A bibs restano 2,25 − 0,93 = **1,32 €**.

### 5. Annullamento di un ordine pagato

Si può annullare un `pay_pickup` **confermato** (dal cliente o dal seller), non uno
`pending` (quello si annulla da solo allo scadere dei 30 minuti). Riprendendo l'esempio 1:

| Movimento | bibs | Negozio | Cliente |
|---|---|---|---|
| Pagamento | +40,00 | | −40,00 |
| Fee Stripe | −0,85 | | |
| Trasferimento | −38,00 | +38,00 | |
| Rimborso al cliente (totale) | −40,00 | | +40,00 |
| Storno del trasferimento | +38,00 | −38,00 | |
| **Saldo** | **−0,85** | **0** | **0** |

Il cliente riavrà tutto, il negozio torna a zero, bibs rinuncia alla commissione e **perde
la fee Stripe**. Stock e punti spesi tornano indietro.

Lo storno è *best-effort*: se il negozio ha già ricevuto il bonifico e non ha saldo
Stripe, lo storno fallisce, il cliente è comunque rimborsato e l'errore resta nel log per
il recupero manuale. In quel caso bibs è esposta per altri 38 €.

### 6. Pagamento non completato

Il cliente apre la pagina di pagamento e non paga. Dopo 30 minuti il cron annulla il
PaymentIntent e l'ordine: **nessuna fee**, nessun movimento. Se invece paga dopo
l'annullamento, il pagamento viene rimborsato in automatico e bibs perde la fee (0,85 €
sull'esempio da 40 €).

### 7. Abbonamento di un seller con due negozi

Un abbonamento Stripe per negozio, ognuno con la sua fattura mensile:

| Per negozio | Importo |
|---|---|
| Canone (`pricing_config.store_monthly_fee_cents`) | 29,00 € |
| Fee carta (1,5% × 29 + 0,25) | 0,69 € |
| Stripe Billing (0,7% × 29) | 0,20 € |
| **Resta a bibs** | **28,11 €** |

Il seller paga 58 € al mese; a bibs restano 56,22 €. Ciclo di vita dell'abbonamento
(rinnovo fallito, sospensione, cancellazione, riattivazione): vedi
[stripe-billing.md](stripe-billing.md#subscription-states).

## Punti fedeltà

- **Si guadagnano** quando il seller segna l'ordine «completato»: 1 punto per euro del
  totale pagato (arrotondato per difetto). Ordine da 40 € → 40 punti.
- **Si spendono** come sconto: 100 punti = 1 €.
- Annullamento o scadenza: i punti spesi tornano al cliente.

### Chi paga lo sconto punti

**Regola (decisione di prodotto, 2026-10-05): lo sconto punti lo copre bibs, mai il
negozio.** Il negozio incassa come se il cliente non avesse usato punti. Per questo i
punti si spendono **solo su «Paga e ritira»**: lì i soldi passano da bibs, che può
trasferire al negozio la cifra piena. Su «Prenota e paga in negozio» il cliente pagherebbe
alla cassa il prezzo scontato e non avremmo modo di restituire la differenza al negozio.

Esempio: ordine «Paga e ritira» da 12 € con 500 punti (5 €).

| | Importo |
|---|---|
| Il cliente paga | 7,00 € |
| Commissione bibs (5% del lordo, 12 €) | 0,60 € |
| Trasferimento al negozio (12 − 0,60) | **11,40 €** — uguale a un ordine senza punti |
| Fee Stripe (1,5% × 7 + 0,25) | 0,36 € |
| **Resta a bibs** | 7,00 − 11,40 − 0,36 = **−4,76 €** (i 5 € di sconto meno la commissione, più la fee) |

> **Stato del codice: non ancora allineato.** Oggi `placeOrder` scala i punti da
> `orders.total`, e commissione e trasferimento partono dal totale già scontato, cioè lo
> sconto lo paga il negozio (nell'esempio riceverebbe 6,65 €). Non è raggiungibile dai
> clienti perché il **checkout dal carrello non fa spendere punti** (lo sconto esiste solo
> sul vecchio `POST /customer/orders`). Prima di abilitare i punti nel checkout vanno
> fatti: punti solo su `pay_pickup`; commissione e trasferimento calcolati sul lordo
> pre-punti; rimborso e storno coerenti con i nuovi importi; gestire un importo da pagare
> pari a 0 (oggi l'ordine resta senza PaymentIntent e il cron lo annulla dopo 30 minuti)
> o sotto 0,50 € (minimo di Stripe per un addebito in EUR).

## Cosa NON esiste ancora

- Pagamento online per `pay_deliver` (PS3) e per gli ordini `direct`.
- Punti spendibili al checkout, con lo sconto a carico di bibs (vedi
  [Chi paga lo sconto punti](#chi-paga-lo-sconto-punti)).
- Gestione delle contestazioni (*dispute/chargeback*): si fa a mano dalla Dashboard Stripe.
- Importo minimo per pagare online o commissione con parte fissa: oggi la commissione è
  solo percentuale (vedi esempio 3).
- Fattura elettronica (SDI): ci si affida alle ricevute Stripe.

## Dove sta nel codice

| Cosa | File |
|---|---|
| Tipologie offerte al checkout | `apps/api/src/lib/order-types.ts` |
| Commissione | `apps/api/src/lib/config.ts`, `apps/api/src/lib/platform-fee.ts` |
| Checkout (un ordine per negozio, un PaymentIntent) | `apps/api/src/modules/customer/services/checkout.ts` |
| Creazione ordine, totale, punti, IVA | `apps/api/src/modules/customer/services/orders.ts` |
| PaymentIntent, trasferimenti, rimborsi, storni | `apps/api/src/modules/billing/services/order-payments.ts` |
| Scadenze (30 min pagamento, 48 h prenotazione) | `apps/api/src/lib/jobs/expire-unpaid-orders.ts`, `expire-reservations.ts` |
| Stati e transizioni d'ordine | `apps/api/src/lib/order-state-machine.ts` |
| Conto Connect del seller | `apps/api/src/modules/billing/services/connect-account.ts`, `apps/api/src/lib/connect-status.ts` |
| Abbonamenti e webhook | `apps/api/src/modules/webhooks/`, [stripe-billing.md](stripe-billing.md) |
