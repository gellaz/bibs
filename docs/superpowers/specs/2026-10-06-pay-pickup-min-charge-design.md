# «Paga e ritira» sotto 0,50 € — design

**Date:** 2026-10-06
**Status:** in revisione
**Riferimenti:** i percorsi puntano a `main` @ `5d6a963` (dopo #248). Regola dei pagamenti in
[`docs/pagamenti.md`](../../pagamenti.md), «Cosa NON esiste ancora».

## Problema

Stripe in EUR non incassa meno di 0,50 € (`config.stripeMinChargeCents`). Un checkout ha **un
solo** PaymentIntent, sulla somma dei totali `pay_pickup` (PR2) meno i punti.

- Con i punti la regola c'è già: `allocateCheckoutPoints` (`apps/api/src/lib/points-allocation.ts`)
  lascia 0 € oppure almeno 0,50 €. Se il lordo è sotto 0,50 € e il saldo non basta ad azzerarlo,
  lo sconto diventa 0 e `withPoints` dell'anteprima è `null`.
- **Senza punti** (o con saldo insufficiente), se l'importo online è tra 0,01 e 0,49 €,
  `createCheckoutPaymentIntent` riceve un rifiuto da Stripe → 502. Il cliente non ha avviso
  prima di confermare, e lato customer un 5xx porta al ramo `retry` di `checkoutFailure`: riprova
  all'infinito un checkout che non può riuscire.

`reserve_pickup` non è toccato: si paga in negozio, non c'è minimo.

## Decisioni di prodotto

1. **Avviso nel riepilogo** (`/checkout/review`), bottone di conferma disabilitato. Il riepilogo è
   l'unico punto in cui l'importo è certo (prezzi del server, punti, somma tra negozi). Niente
   avvisi in `/checkout`, niente cambio automatico di modalità.
2. **La soglia vale per la somma online del checkout**, non per singolo negozio: è il vincolo del
   PaymentIntent unico. Due negozi PR2 da 0,30 € = 0,60 €: si paga.
3. **Punti che azzerano il lordo: permesso (0 €).** A interruttore spento l'avviso propone
   «Attiva i punti per pagare 0 €». L'interruttore resta spento di default.

## Design

### Dominio — `apps/api/src/lib/online-charge.ts` (nuovo)

```ts
/** Un importo online che Stripe rifiuterebbe: tra 0,01 € e il minimo (0,50 €). */
export function isBelowOnlineMinimum(cents: number): boolean {
	return cents > 0 && cents < config.stripeMinChargeCents;
}
```

`allocateCheckoutPoints` la usa al posto della condizione inline sul residuo: la regola vive in un
punto solo. Unit test (TDD): 0, 1, 49, 50, 51 centesimi.

### Servizio — `apps/api/src/modules/customer/services/checkout.ts`

- **`priceCheckout`** restituisce, oltre al piano per negozio, `amountDueOnlineCents`: Σ lordo PR2
  − Σ sconto punti dello scenario richiesto (`usePoints`). Il ritorno passa da array a
  `{ steps, amountDueOnlineCents }`; si adeguano i due chiamanti.
- **`createCheckout`**: subito dopo `priceCheckout`, dentro la tx e prima di ogni insert,
  `isBelowOnlineMinimum(amountDueOnlineCents)` → `ServiceError(400, "Il pagamento online parte da
  0,50 €: scegli «Prenota e paga in negozio» o aggiungi articoli")`. Nessun ordine nasce, il
  carrello resta. Stripe non riceve più questi importi.
- **`previewCheckout`**: `withoutPoints.belowMinimum: boolean` e, in cima, `minAmountOnline:
  "0.50"` (da `fromCents(config.stripeMinChargeCents)`), per il testo dell'avviso.
  `withPoints.amountDueOnline` per costruzione vale 0 o almeno 0,50: lo fissa un test, nessun flag.

Il controllo di `createCheckout` è sul **numero** calcolato dalle stesse funzioni dell'anteprima:
la conferma con `usePoints` coerente con la preview non può incontrare il 400; lo incontra solo
una gara (prezzi o carrello cambiati tra anteprima e conferma) o un client che ignora il flag.

### Schema e OpenAPI

- `CheckoutPreviewSchema` (`apps/api/src/lib/schemas/composed.ts`): `minAmountOnline` e
  `withoutPoints.belowMinimum`, con descrizioni.
- Route `POST /customer/checkout`: la descrizione cita il nuovo 400; la route dell'anteprima dice
  che sotto soglia risponde 200 con `belowMinimum: true`.

### Customer — `apps/customer`

- Helper puro `onlineChargeBlocked(preview, usePoints)` in `features/checkout/points-toggle.ts`:
  vero se l'interruttore è spento (o `withPoints` è `null`) e `withoutPoints.belowMinimum`. Con i
  punti accesi è sempre falso (invariante sopra). Test Vitest.
- `routes/_authenticated/checkout/review.tsx`, quando l'helper è vero:
  - riquadro (stesso stile della nota prenotazione, `bg-muted`) con «I pagamenti online partono
    da {min}. Per questo ordine scegli «Prenota e paga in negozio» o aggiungi articoli.»;
  - se `withPoints` esiste, una riga in più: «Oppure attiva i punti: paghi 0 €.»;
  - bottone di conferma disabilitato.
  Attivando i punti l'avviso sparisce e il bottone diventa «Conferma ordine» (già esistente).
  «Modifica scelta» resta la via per cambiare modalità.
- Un 400 dalla conferma segue il ramo `back_to_cart` già esistente, con il messaggio del server.
- Messaggi paraglide nuovi in `it` ed `en`.

### Docs — `docs/pagamenti.md`

Tolta la riga da «Cosa NON esiste ancora»; la regola (somma del checkout, 0 € o ≥ 0,50 €, punti
che azzerano permessi, avviso nel riepilogo, 400 alla conferma) va nella sezione del checkout, con
un esempio. Tabella «Dove sta nel codice»: `lib/online-charge.ts`.

## Test

- **Unit (bun test)**: `isBelowOnlineMinimum`; `allocateCheckoutPoints` invariata nel comportamento
  (i test esistenti restano verdi).
- **Integrazione** (`bun run test:integration`, nuovo `customer-checkout-min-charge.test.ts`
  accanto a `customer-checkout-points.test.ts`):
  1. un negozio PR2 da 0,30 €: anteprima `belowMinimum: true`, `withPoints: null` senza saldo;
     conferma → 400, nessun ordine né checkout, carrello invariato, Stripe mai chiamato;
  2. due negozi PR2 da 0,30 €: anteprima `belowMinimum: false`, conferma crea un PI da 0,60 €;
  3. PR2 0,30 € + `reserve_pickup` qualsiasi: 400 (la prenotazione non conta nella somma online);
  4. PR2 0,30 € con saldo ≥ 30 punti e `usePoints`: 0 €, ordine confermato, nessun PI;
  5. stesso carrello del 4 senza `usePoints`: 400;
  6. PR2 da 0,30 € con saldo insufficiente (es. 10 punti) e `usePoints`: 400.
- **Vitest customer**: `onlineChargeBlocked` (spento/acceso, `withPoints` null/presente, sopra
  soglia).
- **Smoke manuale di Marco** nel browser prima della PR: riepilogo con un PR2 sotto 0,50 €
  (avviso, bottone disabilitato, mouse e tastiera), attivazione punti, «Modifica scelta» →
  «Prenota e paga in negozio», due negozi sopra soglia in somma.

## Fuori scope

- Avvisi o blocchi nella scelta della modalità (`/checkout`).
- Minimi diversi per valute diverse (bibs incassa solo EUR).
- Il 502 di Stripe resta gestito come oggi per gli altri errori del PaymentIntent.
