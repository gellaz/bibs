# Tempo massimo di ritiro per negozio («Prenota e paga in negozio») — design

**Date:** 2026-10-18
**Status:** in attesa dell'approvazione di Marco. Le varianti dei testi sono state scelte da Marco su
anteprime temporanee (`/reservation-time-preview` nel seller e nel customer), già cancellate.
Riletto da un revisore nel ruolo di chi lo deve costruire.

## Perché

Oggi ogni prenotazione `reserve_pickup` scade 48 ore di calendario dopo la conferma
(`config.reservationHours`, usato in `insertOrder` in `apps/api/src/modules/customer/services/orders.ts`).
Il valore è lo stesso per tutti, ma i negozi hanno esigenze diverse: un forno vuole tempi brevi, un
negozio di abbigliamento può aspettare di più. In più il tempo di calendario consuma anche le ore a
negozio chiuso: con un tempo breve, chi prenota la sera trova la prenotazione già scaduta alla
riapertura.

## Obiettivi

- Il titolare di ogni negozio sceglie il tempo massimo di ritiro.
- Il tempo conta solo le **ore di apertura** del negozio, così il cliente ha sempre a disposizione
  tutto il tempo promesso con il negozio aperto.
- Seller e customer capiscono il meccanismo nel momento in cui conta: il seller quando imposta il
  valore, il customer quando prenota e mentre aspetta di ritirare.

## Non obiettivi

- Prolungare a mano una prenotazione già fatta.
- Promemoria (email o push) prima della scadenza: oggi non esiste nessuna email d'ordine.
- Mostrare il tempo di ritiro nella pagina pubblica del negozio o nella scheda prodotto. *(Mia
  scelta: la spiegazione arriva nel checkout, dove il cliente sceglie la modalità.)*
- Impostazione da admin.
- Toccare `pay_pickup` (la finestra di pagamento di 30 minuti resta com'è).

## Anti-obiettivi

- Promettere al cliente «ore di apertura» per un negozio che non ha dichiarato gli orari.
- Cambiare la scadenza di una prenotazione già fatta.
- Due implementazioni del calcolo, una nel server e una nel frontend, che possono divergere.

## Decisioni di Marco

1. **Valore per negozio, da 1 a 72 ore di apertura.**
2. **Contano solo le ore di apertura.** Si usano gli orari settimanali, le chiusure personalizzate e
   le festività, rispettando gli opt-out del negozio: le stesse fonti di `getOpenStatus`
   (`apps/api/src/lib/holidays/open-status.ts`) e di `resolveOpenStatuses`
   (`apps/api/src/lib/store-open-status.ts`). Notti, giorni di chiusura e festivi non consumano tempo.
3. **Valore predefinito: 24 ore di apertura**, per tutti i negozi, esistenti e nuovi.
4. **Varianti dei testi scelte**: seller **A**; customer **1B**, **2A** e **3B** (dettaglio sotto).
5. **Tolleranza di 15 minuti dopo la scadenza.** Contando le ore di apertura, molte prenotazioni
   scadono esattamente all'ora di chiusura: tutte quelle fatte di sera o di notte, con ore intere.
   Per 15 minuti dopo la scadenza il seller può ancora completare il ritiro, e il cron non manda
   l'ordine in «Scaduto» e non rimette in vendita i prodotti. **Il cliente vede sempre la scadenza
   vera** e la tolleranza non compare da nessuna parte nei suoi testi. Codice di ritiro, giacenza e
   QR restano come oggi. Un'alternativa scartata con Marco: far passare un ordine da «Scaduto» a
   «Completato» alla scansione. Avrebbe richiesto di bloccare i codici sulle scadute, ritogliere la
   merce dalla giacenza e lasciare visibile il QR scaduto.

## Comportamento

### Calcolo della scadenza

- La scadenza si calcola **una sola volta, alla conferma dell'ordine**, e si salva in
  `orders.reservation_expires_at` come oggi. Il cron `expireReservations`, i timer e la lettura degli
  ordini non cambiano.
- Algoritmo: si parte da «adesso» nell'ora di Roma e si scorrono in avanti le fasce di apertura dei
  giorni non chiusi. Di ciascuna si consuma la parte successiva all'istante di partenza, finché non
  si esauriscono `N × 60` minuti. La scadenza è il minuto in cui si esauriscono, riconvertito in
  istante UTC. La chiusura di una fascia è esclusiva come in `getOpenStatus`: se il tempo finisce
  esattamente alla chiusura, la scadenza è l'ora di chiusura.
- Gli orari delle fasce sono **ore locali di Roma**. Nei giorni del cambio d'ora (es. 25 ottobre 2026
  e 28 marzo 2027) la conversione in UTC deve restare corretta.
- **Negozio senza orari dichiarati** (stesso predicato del ramo `unknown` di `getOpenStatus`): il
  tempo scorre in ore di calendario, come oggi. *(Mia scelta: non c'è altro su cui contare.)*
- **Nessuna apertura sufficiente nei prossimi 60 giorni** (chiusura lunghissima): ore di calendario,
  con un commento `ponytail:` sul limite. *(Mia scelta: caso rarissimo; 60 giorni è la stessa finestra
  di `getOpenStatus`.)*
- «Pronto per il ritiro» non sposta la scadenza (come oggi).
- **Tolleranza** (decisione 5): la scadenza salvata resta quella vera. I 15 minuti, come costante
  di configurazione, si aggiungono solo nei due punti che oggi confrontano la scadenza con «adesso»:
  il controllo sul completamento in `apps/api/src/modules/seller/services/orders.ts` (`expiresAt <
  now`) e il cron `expireReservations` in `apps/api/src/lib/jobs/expire-reservations.ts`. Valgono
  anche per i negozi senza orari. Nell'app seller, durante la tolleranza, la lista e il dettaglio
  ordine mostrano già la prenotazione come scaduta (in rosso), ma la scansione la completa. *(Mia
  scelta: non si cambia, perché il seller vede la verità e il ritiro passa comunque.)*
- Se il seller cambia il valore, la modifica vale **solo per le prenotazioni nuove**. *(Mia scelta: al
  cliente è già stata promessa una scadenza.)*
- Le prenotazioni aperte al momento del rilascio tengono la loro scadenza (48 ore di calendario).
- Se il seller cambia orari, chiusure o opt-out delle festività dopo una prenotazione, la scadenza
  già salvata **non si ricalcola**. *(Mia scelta: vale l'anti-obiettivo. Ricalcolare a ogni modifica
  di orari, chiusure e festività (anche quelle dell'admin) costa molto di più. Il caso è raro: una
  chiusura improvvisa con prenotazioni aperte.)*

### Un solo calcolo, nel server

Il calcolo è una **funzione pura** in `apps/api/src/lib/` (accanto a `holidays/`). Riceve orari,
date di chiusura, istante di partenza e ore, e restituisce la scadenza e il tipo di conteggio
(`opening` | `calendar`). Un helper a lotti, sul modello di `resolveOpenStatuses` (una query per
definizioni e opt-out, poi calcolo in memoria), la applica a più negozi. Tutte le scadenze mostrate in
anticipo (seller e checkout) arrivano dall'API, che usa la stessa funzione della conferma: è la stessa
scelta di parità fatta per l'anteprima del checkout in #248. *(Mia scelta.)*

Il calcolo serve in quattro punti:

| Dove | Cosa serve |
|---|---|
| `insertOrder` (chiamata da checkout e da `placeOrder`) | la scadenza vera, al posto di `config.reservationHours` |
| seller, sezione «Tipologie d'acquisto» | scadenza d'esempio «se prenotassero adesso» con il valore che il seller sta digitando, **prima** di salvarlo |
| customer `/checkout` (scelta della modalità, dati dal carrello) | per ogni negozio con `reserve_pickup`: ore, scadenza «se confermi adesso», tipo di conteggio |
| customer `/checkout/review` (`GET /customer/checkout/preview`) | le stesse informazioni per i negozi scelti in `reserve_pickup` |

La forma esatta degli endpoint (campi nuovi in risposte esistenti oppure un endpoint dedicato) è
lasciata a chi costruisce. Deve seguire le rubriche endpoint di `AGENTS.md`, e i literal vanno
espliciti negli schemi (vedi il gotcha di Eden sulle Union).

La scadenza «se confermi adesso» mostrata nel checkout si calcola quando la pagina viene caricata. Se
il cliente resta a lungo sulla pagina può spostarsi di qualche minuto: quella vera è quella calcolata
alla conferma, mostrata subito dopo. *(Accettato: è un'anteprima.)*

### Dati

- Nuova colonna `stores.reservation_hours integer NOT NULL DEFAULT 24`, con CHECK tra 1 e 72. Il
  default copre in un colpo solo i negozi esistenti e quelli nuovi. L'app non è in produzione, quindi
  la migrazione può essere diretta.
- `config.reservationHours` sparisce. I limiti 1 e 72 vivono in un solo posto, usato sia dallo schema
  della route sia dal CHECK. Come nominarli è lasciato a chi costruisce.
- Il seed non ha bisogno di modifiche per i negozi, grazie al default. Le fixture d'ordine che
  scrivono `reservationExpiresAt` a mano restano valide.

### Permessi

Il valore lo legge e lo scrive **solo il titolare**, come le tipologie d'acquisto
(`requireOwner`). *(Mia scelta, per coerenza con la sezione in cui vive.)*

## Testi e interfaccia

Testi in italiano qui sotto; servono anche le traduzioni `en` nei messaggi paraglide di ogni app.
Le date seguono il formato già usato da `PickupCountdown`/`pickupDeadline` nel customer (giorno della
settimana, giorno, mese, ora).

### Seller — variante A

Nella sezione «Tipologie d'acquisto» (`apps/seller/src/features/stores/components/order-types-section.tsx`,
colonna destra da 18rem della pagina Negozio), sotto l'interruttore «Prenota e paga in negozio»,
rientrato con un filo a sinistra. Il blocco **compare solo quando «Prenota e paga in negozio» è
attivo**; da spento il valore resta salvato. *(Mia scelta.)*

- Hint dell'interruttore, che oggi dice «entro 48 ore»: **«Il cliente prenota online, poi paga e
  ritira in negozio.»**
- Etichetta **«Tempo per ritirare»**, campo numerico intero (1–72), suffisso **«ore di apertura»** e
  pulsante **«Salva»**. Stesso schema di `LowStockThresholdSection`: pulsante disattivato se il valore
  non è valido o non è cambiato, toast al salvataggio.
- Errore: **«Inserisci un numero intero da 1 a 72.»**
- Aiuto: **«Da 1 a 72 ore. Contano solo le ore in cui il negozio è aperto, secondo gli orari, le
  chiusure e le festività che hai impostato: notti e giorni di chiusura non consumano tempo.»**
- Riquadro d'esempio (fondo `muted`): **«Con i tuoi orari, una prenotazione fatta adesso scadrebbe
  _mer 21 ott alle 17:00_.»** Si aggiorna mentre il seller digita un valore valido, calcolato dall'API
  con il valore non ancora salvato (con debounce). Gli orari usati sono quelli **salvati**: dopo il
  salvataggio del form negozio l'esempio si aggiorna. *(Mia scelta.)*
- Nota: **«Le prenotazioni già fatte tengono la loro scadenza.»**
- **Negozio senza orari** (solo questo caso: non il ripiego dei 60 giorni, che ha gli orari): il riquadro d'esempio diventa **«Il negozio non ha orari di apertura: il
  tempo scorre sempre, anche di notte e nei giorni di chiusura. Aggiungi gli orari»**, dove «Aggiungi
  gli orari» porta agli orari nel form della stessa pagina. Il suffisso e l'aiuto non devono parlare
  di «ore di apertura»: la formulazione esatta è lasciata a chi costruisce, nel rispetto
  dell'anti-obiettivo.

### Customer 1 — scelta della modalità (`/checkout`), variante B

Hint dell'opzione «Prenota e paga in negozio» in `apps/customer/src/features/checkout/store-choice.tsx`
(oggi «Prenoti ora, paghi al ritiro entro {hours} ore.», con `RESERVATION_HOURS = 48` scritto nel
codice):

> Prenoti ora e paghi al ritiro. Il negozio tiene i prodotti per **{N} ore di apertura**: se confermi
> adesso, entro **{data e ora}**.

Negozio senza orari: «… per {N} ore: se confermi adesso, entro {data e ora}.» (senza «di apertura»).

### Customer 2 — nota nel riepilogo (`/checkout/review`), variante A

Sostituisce `checkout_reserve_note` (oggi «Hai {hours} ore per ritirare: …», anche qui con
`RESERVATION_HOURS = 48` nel codice). Riquadro `muted`:

> **Se confermi adesso, ritira entro:**
> Forno Ricci ........................ mer 21 ott alle 17:00
> Pasticceria Bianchi ............. dom 18 ott alle 8:00
> Contano solo le ore di apertura di ogni negozio. Dopo, la prenotazione scade e i prodotti tornano
> disponibili.

Una riga per ogni negozio in `reserve_pickup`, con nome a sinistra e scadenza a destra. La frase sulle
ore di apertura non deve mai riguardare un negozio senza orari: la formulazione dei casi misti o di
soli negozi senza orari è lasciata a chi costruisce.

### Customer 3 — dettaglio dell'ordine e conferma, variante B

Nel dettaglio ordine (`apps/customer/src/routes/_authenticated/orders/$orderId.tsx`) e nella pagina di
conferma del checkout (`checkout/$checkoutId/index.tsx`) resta il `PickupCountdown` di oggi
(«Ritira entro {data} · timer»). Sotto si aggiunge una riga, **solo se la prenotazione è aperta e il
negozio in questo momento è chiuso** (`closed` o `closed_holiday` con `opensAt`):

> Il negozio ora è chiuso e riapre **{giorno} alle {ora}**. Per il ritiro contano solo le ore di
> apertura.

La riga serve a evitare che il timer che scorre di notte spaventi il cliente. Per averla, le due
risposte (`GET /customer/orders/:id` e `GET /customer/checkouts/:id`, o i nomi che hanno) devono
portare lo stato di apertura del negozio, calcolato con `resolveOpenStatuses` come fanno già le
schede negozio. La riga non compare con il negozio aperto, con il negozio senza orari, né quando la
riapertura cade alla scadenza o dopo: succede se gli orari sono cambiati dopo la prenotazione o se la
scadenza è stata contata in ore di calendario. *(Mia scelta: lì la riga sarebbe falsa.)* La lista ordini resta com'è.
*(Mia scelta: la riga va solo dove c'è spazio per leggerla.)*

## Verifica

- **Test unitari della funzione pura**, scritti prima del codice (TDD, come chiede `CLAUDE.md` per la
  logica di dominio). Casi minimi:
  - partenza dentro una fascia, tra due fasce e di notte;
  - giorno di chiusura settimanale, festività, festività con opt-out, chiusura personalizzata di più
    giorni;
  - tempo che finisce esattamente alla chiusura di una fascia;
  - 1 ora e 72 ore;
  - cambio d'ora di ottobre e di marzo;
  - negozio senza orari, che va in calendario;
  - nessuna apertura entro 60 giorni, che va in calendario.
- **Integrazione**:
  - il checkout `reserve_pickup` salva la scadenza calcolata con le ore del negozio;
  - il PATCH rifiuta 0, 73 e i decimali e accetta 1 e 72;
  - l'endpoint del valore è solo per il titolare;
  - l'anteprima del seller con un valore non salvato non scrive nulla;
  - tolleranza: completamento riuscito 1 minuto e 14 minuti dopo la scadenza, rifiutato 16 minuti
    dopo; il cron non tocca una prenotazione scaduta da 14 minuti e fa scadere
    quella scaduta da 16.
- I test che oggi pinnano le 48 ore (`customer-checkout`, `customer-orders`, `seller-orders`) vanno
  aggiornati.
- **Smoke manuale di Marco** prima della PR, come da regola per le PR con UI. Da provare:
  - impostazione del valore e riquadro d'esempio, anche col negozio senza orari;
  - checkout con due negozi, uno con 2 ore e uno con 24;
  - dettaglio ordine a negozio chiuso.
- Documentazione da aggiornare: `apps/api/AGENTS.md` (oggi dice `reservationHours (48)` e «expire
  after 48 hours») e la guida `docs/pagamenti.md`, se ne parla.

## Lasciato a chi costruisce

- La forma degli endpoint e i nomi dei campi.
- Il nome della funzione e dei limiti.
- Come convertire l'ora di Roma in UTC nei giorni del cambio d'ora, purché sia testato.
- Le formulazioni dei casi «senza orari» e misti, entro l'anti-obiettivo.
- Il debounce dell'anteprima seller.
