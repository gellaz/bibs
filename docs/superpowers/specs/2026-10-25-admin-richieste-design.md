# Pagina «Richieste» dell'admin — design

Nasce dal n. 6 dell'audit ponytail 2026-10-11 (`docs/audit/2026-10-11-ponytail-audit.md`).

## Perché

Il titolare di un negozio può chiedere dal profilo una nuova partita IVA. L'API
crea una richiesta «in attesa» (`seller_profile_change`), ma l'app admin non ha
nessuna schermata per vederla né per deciderla. Il titolare legge «Verrà rivista
da un amministratore», poi non succede niente. Se riprova riceve un 409 «richiesta
già in attesa», per sempre. La finestra gli promette anche il blocco dei nuovi
ordini durante l'attesa: il flag `vatChangeBlocked` viene scritto, ma nessuno lo
legge.

Lo stesso vale per le richieste di cambio documento d'identità: l'API le sa
ricevere, approvare e rifiutare, ma nessuna schermata admin le mostra.

Le API di decisione esistono già (`apps/api/src/modules/admin/routes/seller-changes.ts`):
`GET /admin/sellers/changes/pending`, `PATCH …/:changeId/approve`,
`PATCH …/:changeId/reject`. Approvazione e rifiuto sono già protetti da una
compare-and-set sullo stato. Manca tutto il resto.

## Cosa si costruisce

### 1. Admin: pagina «Richieste»

- **Voce nel menu laterale** «Richieste», con accanto il numero delle richieste
  in attesa (`SidebarMenuBadge` del kit sidebar). Il numero è la notifica in app
  di questa prima versione.
- **Una sola tabella** con le schede per tipo: Tutte · Candidature · Partita IVA ·
  Documento. Ordine: dalla più vecchia, così chi aspetta da più tempo viene servito
  per primo. Si usa il kit liste già presente (`PageHeader`, `DataTable`,
  `DataTableFooter`, schede con badge come in Venditori).
- **Colonne:** venditore (nome e ragione sociale), tipo, cosa cambia in breve
  (per esempio «IT0123… → IT0456…»; per il documento il tipo e il numero nuovi;
  per una candidatura «Nuovo venditore»), da quanto aspetta.
- **Candidature:** sono i venditori in `pending_review`, cioè quelli che oggi
  stanno in Venditori › «In revisione». Compaiono anche qui. La riga apre la
  scheda venditore esistente (`/sellers/$sellerId`), dove c'è già la finestra di
  moderazione con il motivo strutturato (#291, #292). La moderazione non si rifà.
- **Pagina di dettaglio di una richiesta di modifica** (`/requests/$changeId`):
  - valore attuale e valore richiesto affiancati: per la partita IVA i due numeri;
    per il documento tipo, numero, scadenza, comune di rilascio e foto, vecchi e
    nuovi;
  - link alla scheda del venditore;
  - bottoni Approva e Rifiuta. Rifiuta apre una finestra con il motivo
    (obbligatorio, massimo 500 caratteri, lo stesso limite dell'API);
  - dopo la decisione: toast e ritorno alla lista. Se l'API risponde «La richiesta
    di modifica non è più in attesa» (un altro admin ha deciso prima), si mostra
    il messaggio e si ricaricano i dati.
- **Dashboard admin:** una card «Richieste in attesa: N» che porta alla pagina.
  La gestione resta nella pagina Richieste.

### 2. Email agli admin

A ogni nuova richiesta parte un'email a **tutti gli utenti con ruolo admin** (non
bannati), con il tipo di richiesta, il venditore e il link alla pagina della
richiesta (per le candidature, alla scheda venditore). I momenti sono:

- una candidatura entra in `pending_review` (i due punti di
  `modules/seller/services/onboarding.ts` che oggi chiamano
  `notifyApplicationReceived`);
- una richiesta di cambio partita IVA (`requestVatChange`);
- una richiesta di cambio documento (`requestDocumentChange`; oggi nessuna app la
  chiama, ma l'API sì).

L'invio è best-effort, come le email di onboarding e di billing: se fallisce
scrive un log e la richiesta resta comunque creata. Serve una nuova variabile
`ADMIN_APP_URL` (default `http://localhost:3003`), sul modello di
`SELLER_APP_URL`, per costruire il link.

### 3. Il blocco degli ordini durante un cambio partita IVA

Decisione di Marco: finché la nuova partita IVA non è approvata, il venditore non
riceve nuovi ordini.

- **Cosa si blocca:** i nuovi ordini di **tutti i negozi** del venditore, di ogni
  tipo («Prenota e ritira» e «Paga e ritira»). La partita IVA appartiene al
  venditore, non al singolo negozio. Gli ordini già fatti proseguono normalmente.
- **Dove:** nella regola unica `offeredOrderTypes` (`apps/api/src/lib/order-types.ts`),
  che usano carrello, checkout e seller. Con `vatChangeBlocked` vero restituisce
  una lista vuota. Le query che la chiamano devono leggere anche il flag del
  venditore, come oggi leggono `sellerChargesEnabledSql`.
- **Cosa vede il cliente:** il negozio resta visibile nelle ricerche e nella sua
  pagina. Nel carrello le righe di quel negozio diventano «non disponibili»,
  quindi il cliente compra lo stesso dagli altri negozi. Il checkout rifiuta un
  ordine per quel negozio. Questa regola del carrello è la stessa del n. 19
  dell'audit: un negozio senza modalità d'acquisto, per qualunque motivo, segna
  le sue righe come non disponibili invece di bloccare tutto il checkout. Il
  n. 19 si chiude con questo progetto.
- **Quando finisce:** con l'approvazione (nuova partita IVA) o con il rifiuto
  (resta la vecchia). Entrambi i servizi azzerano già il flag.
- **Lato seller:** la card «cosa vede il cliente» delle tipologie d'acquisto
  mostra il blocco, perché è quello che vede davvero il cliente. Il controllo al
  salvataggio delle tipologie («Deve restare almeno una tipologia d'acquisto
  disponibile ai clienti») invece non considera il flag: durante l'attesa il
  titolare può comunque cambiare le sue impostazioni. La copia della regola nel
  frontend seller (`apps/seller/src/features/stores/lib/order-types.ts`) va
  allineata o tolta, come propone il n. 17 dell'audit.
- **Partita IVA presa nel frattempo:** la colonna `organization.vat_number` è
  unica. Se un altro venditore registra la stessa partita IVA tra la richiesta e
  l'approvazione, `approveChange` deve rispondere 409 «Questa partita IVA è già
  registrata da un altro venditore» invece di un errore interno; l'admin allora
  rifiuta la richiesta.

### 4. Lato venditore (il minimo)

- **Avviso nel profilo** quando c'è un cambio partita IVA in attesa: «Cambio
  partita IVA in attesa di approvazione: i tuoi negozi non ricevono nuovi ordini
  finché non viene approvato.» I dati ci sono già: `GET /seller/settings`
  restituisce `pendingChanges`, che oggi l'app non legge.
- **Niente secondo tentativo durante l'attesa:** al posto del bottone «Richiedi
  cambio» si vede lo stato «in attesa» con la partita IVA richiesta. Così il
  409 non si presenta più.
- **«Annulla richiesta»** (decisione di Marco): accanto allo stato «in attesa»
  il titolare può annullare da solo la sua richiesta. L'annullamento toglie
  subito il blocco degli ordini e lascia la partita IVA vecchia; dopo, il
  titolare può fare una nuova richiesta. Serve:
  - un endpoint seller che passa la richiesta da `pending` a un nuovo stato
    `cancelled` con la stessa compare-and-set di `approveChange`/`rejectChange`
    (se l'admin ha già deciso, risponde che la richiesta non è più in attesa) e
    azzera `vatChangeBlocked` nella stessa transazione;
  - il nuovo valore nel CHECK `seller_profile_change_status_valid`;
  - la pagina di dettaglio admin di una richiesta annullata mostra che non è più
    in attesa, senza bottoni.
- **Testo della finestra di cambio partita IVA:** deve dire il vero, cioè che i
  nuovi ordini restano bloccati fino alla decisione.
- **Email al titolare con l'esito:** approvata, oppure rifiutata con il motivo
  scritto dall'admin. Best-effort, sul modello di `onboarding-notifications.ts`.
  Vale per partita IVA e documento.

## Non obiettivi (per ora)

- **Campanella / centro notifiche in app**, con elenco, letto e non letto per
  ogni admin. È un progetto a sé, da fare dopo.
- **Form del venditore per chiedere il cambio documento.** Viene subito dopo
  questo progetto. Fino ad allora la scheda «Documento» resta vuota (stato vuoto).
- **Storico delle richieste decise.** Admin e seller leggono solo quelle in attesa
  (scelta di #292).
- Allineare la partita IVA su Stripe o su altri sistemi esterni dopo
  l'approvazione.
- Avviso «non accetta ordini» sulla pagina del negozio nel customer: il blocco si
  vede nel carrello e nel checkout.

## Da evitare (anche se tecnicamente funziona)

- Un venditore bloccato che riceve lo stesso un ordine da qualche percorso.
  `POST /customer/orders` non ha chiamanti e oggi non legge le modalità del
  negozio (n. 14 dell'audit): va tolto o bloccato insieme agli altri.
- Un negozio bloccato che impedisce al cliente di comprare dagli altri negozi del
  carrello.
- Un admin che approva senza vedere valore vecchio e valore nuovo affiancati.
- Un titolare che non viene mai a sapere l'esito o il motivo del rifiuto.

## Vincoli

- La decisione resta nei servizi esistenti (`approveChange`, `rejectChange`) con
  la loro compare-and-set: non si duplicano.
- Testi in italiano e inglese nelle due app (Paraglide); badge di stato al
  singolare, schede e filtri al plurale.
- L'app è ancora in sviluppo, non deployata: le modifiche allo schema sono libere.

## Lasciato a chi costruisce

- La forma delle API nuove: un endpoint che unisce candidature e richieste di
  modifica per la lista e per il conteggio del menu, oppure due chiamate separate.
  Serve anche un `GET` della singola richiesta per la pagina di dettaglio.
- Per ordinare le candidature insieme alle richieste serve la data di ingresso in
  revisione. Si può usare un dato già presente (per esempio `updatedAt` del
  venditore) oppure aggiungere un timestamp.
- Il layout della pagina di dettaglio, la sezione del menu in cui sta «Richieste»
  e i template delle email nuove in `packages/emails`.
- I test: almeno la regola del blocco (`offeredOrderTypes`), le righe non
  disponibili nel carrello, il rifiuto del checkout, lo sblocco dopo una decisione,
  le email (con `sendEmail` finto) e le route admin nuove.

## Scelte fatte da Claude (da controllare)

- Email a tutti gli admin, non a uno solo o a una casella dedicata.
- Motivo del rifiuto obbligatorio nella UI (l'API lo accetta opzionale).
- Le candidature in Richieste aprono la scheda venditore esistente invece di una
  pagina di dettaglio nuova.
- Scheda «Documento» visibile anche quando è vuota.
- Nessun avviso sulla pagina del negozio nel customer.
- Il blocco si vede nella card seller «cosa vede il cliente», ma non impedisce
  di salvare le tipologie d'acquisto.
- Nessuna email agli admin quando il titolare annulla: la richiesta sparisce
  dalla lista e il numero nel menu scende.
- L'endpoint di annullamento vale per qualunque richiesta in attesa del
  venditore, ma per ora il bottone c'è solo per la partita IVA (il form del
  documento arriva dopo).
- 409 all'approvazione se la partita IVA richiesta è stata presa da un altro
  venditore nel frattempo.
