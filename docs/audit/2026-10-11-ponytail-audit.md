# Audit ponytail — codice da centralizzare e test (2026-10-11)

> Audit in sola lettura su `main` @ `8b62c34`. Nessun file del repo è stato modificato durante l'audit.
> Domande di partenza: quale codice si può centralizzare per non ripeterlo; come rendere i test più veloci ed efficaci; se i test coprono ogni lato dell'applicazione.
> I numeri 1–20 sono gli stessi del report consegnato in chat: si può dire «fai il 2 e il 5».

## Indice

1. [Sintesi](#1-sintesi)
2. [I 20 finding numerati](#2-i-20-finding-numerati)
3. [Altre copie da centralizzare](#3-altre-copie-da-centralizzare)
4. [Dettaglio degli altri finding verificati](#4-dettaglio-degli-altri-finding-verificati)
5. [Problemi visti di passaggio, verificati dopo](#5-problemi-visti-di-passaggio-verificati-dopo)
6. [Misure](#6-misure)
7. [Mappa della copertura dei test](#7-mappa-della-copertura-dei-test)
8. [Copie tenute apposta e decisioni rispettate](#8-copie-tenute-apposta-e-decisioni-rispettate)
9. [Note minori non verificate una per una](#9-note-minori-non-verificate-una-per-una)
10. [Metodo e limiti](#10-metodo-e-limiti)

## 1. Sintesi

**Cosa fa questo repo:** bibs è un marketplace di quartiere. I clienti trovano i negozi vicini e comprano da loro, i venditori gestiscono il negozio, bibs incassa un abbonamento per negozio e gestisce i punti fedeltà. Il repo contiene l'API (Elysia, Bun, Postgres/PostGIS, Stripe), tre frontend (customer, seller, admin) e due pacchetti condivisi (`packages/ui`, `packages/emails`).

**Carico ipotizzato:** una sola istanza dell'API, qualche centinaio di negozi, qualche migliaio di clienti, qualche decina di utenti collegati insieme; i cron (lavori automatici a orario) girano dentro l'API; app non ancora in produzione.

### Le tre domande, in breve

- **Codice da centralizzare.** Il codice copiato è il 3,4% del sorgente (2.855 righe su ~83.000) ma il 13,8% dei test (5.103 righe). I guadagni più grossi:
  - il blocco iniziale dei test di integrazione copiato in 91 file (n. 13, −2.700 righe);
  - dieci endpoint (indirizzi dell'API) che nessuna app usa (n. 14, ~−1.000);
  - il codice gemello nell'API (n. 15) e nelle pagine di accesso dei frontend (n. 16);
  - le regole scritte sia nell'API sia nei frontend (n. 17);
  - il resto è nella [sezione 3](#3-altre-copie-da-centralizzare), con il dettaglio nella [sezione 4](#4-dettaglio-degli-altri-finding-verificati).

  Il pacchetto `@bibs/app-kit` previsto nel backlog (P5) non serve: tra le tre app sono davvero identiche solo ~120 righe, e sono file di avvio che TanStack Start vuole in ogni app.
- **Velocità dei test.** La CI dura quanto il job «API tests», ~7 minuti, di cui 5:23 sono i test di integrazione. Un test dura di solito 0,87 s, ma ~0,7 s servono solo a svuotare il database. Con i n. 11 e 12 il job API scende a ~2:20 e la CI intera da ~7 a ~4 (a quel punto il job più lungo diventa la build Docker, senza contare il passo di seed proposto nel n. 9). In locale l'integrazione passa da 5 minuti a ~1:40. Sono stime: il calcolo è nella [sezione 6](#6-misure).
- **Completezza: no, i test non coprono tutto.**
  - **Coperto bene:** soldi, IVA, punti e webhook (gli avvisi automatici di Stripe), con asserzioni forti (importi in centesimi, chiavi di idempotenza contro le operazioni doppie, stato del DB dopo ogni scrittura).
  - **API:** i test chiamano quasi sempre le funzioni di servizio e saltano le route. 48 file dell'API su 245 non vengono mai caricati da nessun test (2 contengono solo tipi): 13 file di route admin su 14, 6 customer su 8, prodotti e onboarding (registrazione guidata) del seller, e i file con le guardie dei ruoli. Il «93% di righe coperte» conta solo i file caricati. Dei 177 endpoint, 41 non hanno nessun test che ne esegua la logica.
  - **Frontend:** 65 file di test nelle tre app, quasi solo funzioni pure. Nessuna delle 75 pagine ha un test, e non c'è nessun test nel browser (E2E). Per ora non aggiungerei Playwright: quando tocchi un form, aggiungi un test con Vitest e Testing Library.
  - **CI:** il seed (lo script che riempie il DB di dati di prova) e la modalità produzione non girano mai.

### Verdetto

Il codice è curato e la parte soldi è testata bene. Prima di qualsiasi deploy vanno corretti 1 e 2: l'immagine Docker non manderebbe nessuna email. Poi i bug 3–7. Dopo, 11 e 12 tolgono due terzi del tempo del job API, 13 metà delle righe copiate nei test, e 8 copre la parte più scoperta, cioè i permessi. Tra i problemi verificati dopo il report in chat ([sezione 5](#5-problemi-visti-di-passaggio-verificati-dopo)), i primi da correggere sono P1–P3: un salvataggio fallito che toglie l'indirizzo predefinito, un invito annullato che fa entrare lo stesso il collaboratore, un'eliminazione definitiva che può cancellare un prodotto appena ripristinato.

**Bilancio:** circa −8.800 righe possibili (~3.900 nei test, ~2.050 di componenti shadcn mai usati) e −7 dipendenze. Correzioni e test nuovi aggiungono circa +450 righe per i n. 1–20 e circa +350 per le sezioni 4 e 5.

### Non controllato

- Le app non sono state provate nel browser: i bug sono riprodotti con script (fuso orario, Elysia, `bun build`).
- Non sono stati eseguiti seed, `db:generate`, la build Docker o il typecheck (controllo dei tipi) con le correzioni applicate.
- Letti solo a campione: i corpi dei 95 file di integrazione, le pagine grandi del seller (`products/index.tsx`, `team`), le fixture del seed (le funzioni che creano i dati di prova), i template email, i servizi di geocoding.
- La lettura fiscale del n. 5 va confermata dal commercialista.
- I tempi di CI dopo le correzioni sono calcolati da log e misure, non da un run vero.

## 2. I 20 finding numerati

Stessa numerazione e stesso testo del report in chat. Un controllo riga per riga sul codice, fatto dopo, ha corretto alcuni dettagli (conteggi, casi, parole troppo forti); a ogni finding è aggiunta la riga «Prove». Nelle prove, «HEAD» è il commit `8b62c34` su cui è stato fatto l'audit.

### Da correggere subito

#### 1. L'immagine Docker dell'API resta sempre in modalità sviluppo

**Dove:** `apps/api/Dockerfile:32`, `apps/api/package.json:6`, `apps/api/src/lib/env.ts:56`, `apps/api/src/lib/email.ts:57-76`, `apps/api/src/lib/cors.ts:20-26`, `.github/workflows/ci.yml:105-128`

- **Cos'è:** il Dockerfile compila l'API in un solo file JavaScript (il «bundle») con `bun build`. La variabile `NODE_ENV` decide se l'API gira in modalità sviluppo o produzione.
- **Problema:** `bun build` scrive dentro il bundle il valore di `NODE_ENV` che trova mentre compila, e il Dockerfile compila senza impostarlo. L'immagine resta quindi in sviluppo anche con `NODE_ENV=production` al deploy (provato con bun 1.4.2). Così nessuna email parte: finiscono nel log, link di reset compresi. In più il CORS (la regola su chi può chiamare l'API dal browser) accetta `localhost` con i cookie.
- **Correzione:** alla riga 32 scrivi `RUN NODE_ENV=production bun run --cwd apps/api build`. Nello smoke della CI (la prova che avvia l'immagine), dopo `/ready`, controlla che una richiesta con `Origin: http://localhost:9999` non riceva l'header `access-control-allow-origin`.
- **Se non lo facciamo:** il primo deploy risponde «sano» a `/ready`, ma nessun nuovo utente riesce a verificare l'account. Il punto P6.6 del backlog parla solo di pipeline e chiavi segrete, non di questo.
- **Prove:** Riprodotto con bun 1.4.2 nello scratchpad, la cartella temporanea dell'audit (nodeenv-final): se compili senza NODE_ENV, il bundle contiene la costante "development", e NODE_ENV=production al runtime non la cambia; se compili con NODE_ENV=production, il bundle contiene "production". Letti a HEAD Dockerfile:32 (build senza NODE_ENV), env.ts:56, email.ts:57-76, cors.ts:24 e lo smoke in ci.yml:105-128, che chiama solo /ready.

#### 2. Un'email rifiutata da Resend risulta «inviata»

**Dove:** `apps/api/src/lib/email.ts:78-103`, `apps/api/src/modules/seller/services/employees.ts:219-229`, `apps/api/tests/integration/seller-employees.test.ts:416-428`

- **Cos'è:** `sendEmail` spedisce tutte le email. In produzione passa da Resend, il servizio esterno di invio.
- **Problema:** se Resend rifiuta l'invio (per esempio dominio non verificato o quota finita), o se manca la chiave, la funzione scrive un log e finisce come se fosse andata bene. Il venditore preme «Reinvia invito» e vede «Invito reinviato», ma non parte niente. I test non se ne accorgono: usano una `sendEmail` finta che lancia un errore, cosa che quella vera fa solo se cade la rete.
- **Correzione:** nel ramo produzione lancia un errore quando manca la chiave e quando `res.ok` è falso, tenendo il log. I 4 punti che la chiamano gestiscono già l'errore. Aggiungi un test in `tests/lib/email.test.ts`: `Object.assign(env, { NODE_ENV: "production", RESEND_API_KEY: "re_test" })` e un fetch finto che risponde 403; in `afterEach` rimetti `env` com'era.
- **Se non lo facciamo:** al lancio i bottoni «Reinvia» mentono. Va fatto insieme al n. 1, perché oggi questo ramo non gira mai.
- **Prove:** Letti a HEAD email.ts:78-103 (solo log, nessun throw) e resendInvitation in employees.ts:220-229, che dà 502 solo se sendEmail lancia; il test seller-employees.test.ts:416-428 usa un sendEmail finto che lancia «smtp down». La seconda verifica ha controllato i 4 chiamanti (auth.ts:92 e :127, employees.ts:180, billing-notifications.ts:68): lanciare non rompe niente.

#### 3. Modificare una promozione ne sposta le date indietro di 1–2 ore

**Dove:** `apps/seller/src/routes/_authenticated/promotions/$discountId.tsx:127-129`, `apps/seller/src/routes/_authenticated/promotions/$discountId.tsx:144-150`, `apps/seller/src/features/promotions/components/discount-period-picker.tsx:29-34`

- **Cos'è:** è la pagina in cui il venditore modifica una promozione. Il form tiene le date come ora italiana, senza fuso.
- **Problema:** la pagina riempie il form con l'ora UTC (`toISOString().slice(0, 16)`) e al salvataggio la rilegge come ora italiana. Prendi una promo dal 15/10 00:00 al 20/10 23:59: in modifica il calendario mostra già il 14/10. Se cambi solo il titolo, la fine diventa 21:59, e ogni volta che riapri e salvi perde altre 2 ore (1 d'inverno), senza nessun avviso.
- **Correzione:** esporta `toLocal` da `discount-period-picker.tsx`, dove c'è già la conversione giusta, e usala per `startsAt` e `endsAt`. `defaultLocalNow()` diventa `toLocal(new Date())`. Nel test fissa `process.env.TZ = "Europe/Rome"`: la CI gira in UTC, e lì il bug non si vede.
- **Se non lo facciamo:** dopo ogni modifica, carrello e checkout applicano lo sconto nelle ore sbagliate.
- **Prove:** Rifatto con node e TZ=Europe/Rome, con le stesse espressioni della pagina: la promo 15/10 00:00–20/10 23:59 si salva come 14T22:00Z/20T21:59Z, il primo salvataggio porta la fine alle 21:59 e il secondo alle 19:59; con TZ=UTC non si sposta niente. Righe lette a HEAD: $discountId.tsx:127-129 e :144-150, toLocal in discount-period-picker.tsx:29-34, defaultLocalNow in discount-form.tsx:49-55.

#### 4. La registrazione toglie gli spazi dalla password, il login no

**Dove:** `apps/api/src/plugins/normalize.ts:7-20`, `apps/api/src/index.ts:56`, `apps/api/src/modules/registration/index.ts:51-55`

- **Cos'è:** `normalize` è un plugin globale che toglie gli spazi a inizio e fine di ogni testo che arriva all'API.
- **Problema:** lo fa anche sulle password di `/register/customer`, `/register/seller` e `/register/accept-invite`. Il login invece passa dall'endpoint di better-auth, dove il plugin non agisce. Chi si registra con «Mare2026 » (con lo spazio finale, per esempio incollata dal gestore di password) salva «Mare2026», e al login riceve «credenziali errate» finché non reimposta la password (o la scrive senza lo spazio).
- **Correzione:** nel ciclo di `deepTrim` scrivi `result[key] = /password/i.test(key) ? val : deepTrim(val)`. Copre anche `confirmPassword`, altrimenti l'invito risponde «Le password non coincidono». Aggiungi un test in `tests/plugins/normalize.test.ts`.
- **Se non lo facciamo:** qualche cliente, venditore o dipendente resta chiuso fuori subito dopo la registrazione.
- **Prove:** Riprodotto due volte con il vero normalize.ts, Elysia 1.4.30 e better-auth 1.7.7 in memoria: /register/customer riceve «Mare2026», mentre /auth/api/sign-in/email riceve «Mare2026 » e risponde 401. Letti a HEAD deepTrim (normalize.ts:7-20, il ciclo è alla riga 15) e il controllo «Le password non coincidono» in registration/index.ts:126-127.

#### 5. Castelletto IVA e fatturato tolgono ancora lo sconto punti, che però paga bibs

**Dove:** `apps/api/src/modules/customer/services/orders.ts:467-480`, `apps/api/src/lib/vat.ts:56-109`, `apps/api/src/modules/seller/services/dashboard.ts:91`, `apps/api/tests/integration/customer-orders-vat.test.ts:155-167`

- **Cos'è:** ogni ordine salva il castelletto IVA (imponibile e imposta per ogni aliquota), che è la sua fonte fiscale. La home del venditore mostra il fatturato del giorno.
- **Problema:** dal #247 lo sconto punti lo paga bibs e il negozio incassa il prezzo pieno, meno la commissione. Il castelletto però si calcola ancora sul prezzo scontato, come prima del #247, e il fatturato somma solo `total`. Esempio: un articolo da 12,20 € (IVA 22%) e uno da 11,00 € (IVA 10%), pagati in parte con 232 punti. Il negozio riceve 22,04 €, ma il castelletto dichiara 2,88 € di IVA su 20,88 € invece di 3,20 € su 23,20 €. Un ordine pagato tutto a punti vale 0 € nella dashboard.
- **Correzione:** in `insertOrder` costruisci il castelletto sulle righe prima dei punti, cioè `buildCastelletto` senza `apportionDiscount`. Nella dashboard somma `total + points_discount`. Cancella `apportionDiscount` e i suoi test (−200 righe) e fai confermare la lettura fiscale al commercialista (art. 13 DPR 633/72).
- **Se non lo facciamo:** ogni ordine con punti salva meno IVA del dovuto. Il backlog segna come chiusa la parte punti di P6.2 (#197) con la regola vecchia, quindi il futuro scontrino/SDI partirebbe da questi numeri.
- **Prove:** Ricalcolato con le funzioni vere di lib/vat.ts: 12,20 € al 22% e 11,00 € al 10% con 232 punti (100 punti = 1 €) danno un castelletto di 20,88 € con 2,88 € di IVA, mentre storePayoutSplit paga al negozio 22,04 €; customer-orders-vat.test.ts fissa proprio 20,88. Letti a HEAD orders.ts:467-480, dashboard.ts:91 (somma solo order.total) e le righe 99 e 140 del backlog.

#### 6. La richiesta di cambio partita IVA non la può approvare nessuno

**Dove:** `apps/seller/src/features/profile/components/business-info-card.tsx:141`, `apps/api/src/modules/seller/services/settings.ts:31-50`, `apps/api/src/modules/seller/services/settings.ts:309-326`, `apps/api/src/modules/admin/routes/seller-changes.ts:21-121`, `apps/api/src/db/schemas/seller.ts:69`

- **Cos'è:** dal profilo il titolare chiede una nuova partita IVA, e l'API crea una richiesta «in attesa» che un admin dovrebbe approvare.
- **Problema:** l'app admin non ha questa schermata e non chiama mai le route di approvazione. Il titolare legge «Verrà rivista da un amministratore» e poi non succede niente. Se riprova riceve un 409 «richiesta già in attesa», per sempre. Il blocco degli ordini promesso (`vatChangeBlocked`) viene scritto ma nessuno lo legge.
- **Correzione:** nascondi il bottone (1 riga) finché non esiste la schermata admin. Togli `vatChangeBlocked` e le sue 3 scritture, oppure implementa il blocco quando fai la schermata.
- **Se non lo facciamo:** ogni richiesta resta appesa senza che nessuno la veda, e l'interfaccia promette due cose false: la revisione e il blocco degli ordini.
- **Prove:** Letto a HEAD: apps/admin/src non chiama mai le route di seller-changes, assertNoPendingChange (settings.ts:34-51) dà 409 a ogni nuovo tentativo, e vatChangeBlocked ha solo 3 scritture (settings.ts:322, admin/services/sellers.ts:512 e :584) e nessuna lettura. La seconda verifica non ha trovato job, email o endpoint che chiudano la richiesta.

#### 7. Cambio account sullo stesso browser: il nuovo utente vede i dati del precedente

**Dove:** `apps/customer/src/routes/login.tsx:47-63`, `apps/seller/src/routes/login.tsx:40-57`, `apps/admin/src/routes/login.tsx:38-55`, `packages/ui/src/integrations/tanstack-query/root-provider.tsx:9-22`

- **Cos'è:** le app tengono in memoria le risposte dell'API (la «cache» di TanStack Query) finché la scheda resta aperta. Login e logout cambiano pagina senza ricaricarla.
- **Problema:** nessuno svuota la cache quando cambia l'utente. Sul telefono di casa A esce e B entra entro un minuto: B vede gli indirizzi di A nella ricerca e il carrello di A, e le sue ricerche partono dalla casa di A.
- **Correzione:** nei tre login, dopo l'accesso riuscito e prima di `navigate`, chiama `queryClient.clear()` (da `useQueryClient()`). Sono circa 9 righe.
- **Se non lo facciamo:** su un dispositivo condiviso i dati personali di un account passano al successivo.
- **Prove:** Letto a HEAD: root-provider.tsx:21 tiene un solo QueryClient per scheda, i tre login (customer :47-63, seller :40-57, admin :38-55) chiamano navigate senza ricaricare la pagina, e nei frontend non c'è nessun clear o resetQueries. La seconda verifica ha seguito la catena: le chiavi ['customer','addresses'] (60 s) e ['cart'] (30 s) non contengono l'utente, quindi B legge dalla cache i dati di A.

### Da correggere

#### 8. Le guardie dei ruoli e 18 controlli di permesso non li prova nessun test

**Dove:** `apps/api/src/modules/admin/index.ts:30-36`, `apps/api/src/modules/seller/index.ts:23-70`, `apps/api/src/modules/customer/index.ts:16-47`, `apps/api/src/modules/seller/routes/products.ts:314`, `apps/api/src/modules/seller/routes/stock.ts:29-196`, `apps/api/src/modules/seller/routes/discounts.ts:64-276`

- **Cos'è:** la «guardia» è il controllo all'ingresso di un gruppo di route (solo admin, solo venditore, solo cliente). Dentro le route del seller, `requireOwner` e `ensureStoreAccess` controllano titolare e negozio.
- **Problema:** i moduli admin, seller e customer non vengono mai caricati dai test, e 18 controlli di permesso su 57 non girano mai. Se tolgo il controllo sul ruolo admin, un venditore in attesa si auto-approva con `PATCH /admin/sellers/<suo id>/verify`. Se tolgo `ensureStoreAccess` alla riga 314, un venditore crea prodotti nel negozio di un altro. In entrambi i casi la CI resta verde.
- **Correzione:** un file in `tests/integration` che monta i tre moduli veri, con `@/lib/auth` finto che legge il ruolo da un header. Verifica 401 senza sessione e, su admin e seller, 403 con il ruolo sbagliato; non serve il database. Aggiungi poi gli 8 casi mancanti ai file `*-owner-only` e una tabella prodotti/stock in `seller-orders-routes.test.ts`. In tutto circa +130 righe.
- **Se non lo facciamo:** un refactor (una riscrittura del codice) che sposta una route o perde una riga apre dati e azioni ad altri utenti, e la CI resta verde.
- **Prove:** Contato sul report di copertura (lcov) dell'audit, con le righe di HEAD: delle 57 chiamate requireOwner/ensureStoreAccess nelle route seller, 18 non girano mai, e nessun test carica admin/index.ts, seller/index.ts o customer/index.ts. Lette le tre guardie (la resolve di Elysia): admin (index.ts:30-36) e seller rispondono 403 senza toccare il DB, customer cerca il profilo nel DB.

#### 9. Quattro flussi importanti senza nessun test

**Dove:** `apps/api/src/lib/jobs/expire-reservations.ts:64-70`, `apps/api/src/modules/seller/services/onboarding.ts`, `apps/api/src/lib/auth.ts:129-146`, `apps/api/src/modules/seller/services/employees.ts:262-347`, `.github/workflows/ci.yml:83-131`

- **Cos'è:** il cron (un lavoro automatico che gira ogni minuto) che fa scadere le prenotazioni; l'onboarding dei venditori; la sospensione dei dipendenti; il seed.
- **Problema:** nessun test li esegue.
  - Se `lt` diventa `gt` alla riga 68, ogni minuto scadono tutte le prenotazioni ancora valide.
  - Se l'hook di verifica email smette di scattare dopo un aggiornamento di better-auth, ogni nuovo venditore resta bloccato al primo passo.
  - Il seed si è rotto nel #202 e la CI non l'ha visto.
- **Correzione:**
  - in `seller-orders.test.ts`, una prenotazione scaduta e una valida: `expireReservations()` deve restituire 1 (~20 righe);
  - onboarding completo: registrazione, link di verifica, tre passi e «Indietro» (~60 righe);
  - un dipendente sospeso deve ricevere 403 da `resolveSellerAccess` (~14 righe);
  - nel job Docker della CI, `bun run db:seed` su `localhost:5432` con un `STRIPE_DEV_PRICE_ID` finto, poi `curl` sulle GET pubbliche con `jq -e '.data | length > 0'`.
- **Se non lo facciamo:** questi errori li scoprono clienti e venditori.
- **Prove:** Cercato nei test con grep: expireReservations, i servizi di onboarding e banEmployee/removeEmployee non compaiono mai, e l'lcov segna 0 su expire-reservations.ts:61-80, auth.ts:129-146 ed employees.ts:262-347 (il filtro lt è alla riga 68). Il caso del seed è verificato con git (05c0764 fa nascere i pay_* in pending, 83ab4a2 ripara il seed) e ci.yml non ha nessun passo di seed.

#### 10. Controlli che danno un falso verde

**Dove:** `biome.json`, `apps/api/tests/unit/stripe.test.ts`, `apps/api/tests/unit/*-schema*.test.ts`, `apps/api/tests/integration/loyalty-points-race.test.ts:182-214`, `apps/api/tests/integration/customer-store-discovery.test.ts:538-552`

- **Cos'è:** il lint (Biome, il controllo automatico del codice) e alcuni test che dovrebbero accorgersi dei bug.
- **Problema:**
  - Biome accende le regole React solo se trova React nel package.json, ma qui la versione è scritta `catalog:` (rimando alle versioni comuni nel package.json di root) e Biome non la riconosce. Così nelle tre app tutte le regole React sono spente, e un hook dopo un `return` (il bug #74) passerebbe di nuovo. L'ho verificato: forzando la regola `useExhaustiveDependencies` escono 28 errori che oggi nessuno vede.
  - 6 file di test unitari controllano solo nomi di colonne o liste di stati (uno solo che il client Stripe esista): i cambi di nome li vede già il typecheck, e il database vero non lo guardano.
  - Il test «due completamenti insieme» passa anche senza il controllo che impedisce di chiudere due volte lo stesso ordine.
  - Una decina di test diventano rossi se girano alle 23:59 ora di Roma, perché i negozi «sempre aperti» dei test chiudono alle 23:59.
- **Correzione:** in `biome.json` aggiungi `"correctness": { "useHookAtTopLevel": "error" }` (oggi dà 0 errori). Cancella i 6 test di schema e il test di concorrenza finto (−173 righe). Nelle fixture usa `close: "24:00"`, e nel test della dashboard un `now` fisso.
- **Se non lo facciamo:** il verde della CI promette protezioni che non ci sono, e ogni tanto la CI diventa rossa senza nessun bug.
- **Prove:** Rilanciato in sola lettura: forzando useExhaustiveDependencies sulle tre app e su packages/ui/src/custom escono 28 errori (tutti nelle app), mentre il lint normale e useHookAtTopLevel danno 0. Una copia ridotta nello scratchpad mostra che le regole React si accendono in packages/ui e non nelle app con «catalog:»; contate 140 righe nei 6 test unitari e 33 nel test di concorrenza (loyalty-points-race.test.ts:182-214).

#### 11. I test di integrazione passano metà del tempo a preparare il database

**Dove:** `apps/api/tests/helpers/cleanup.ts:9-25`, `apps/api/tests/helpers/test-db.ts:43-110`, `apps/api/package.json:9-10`, `.github/workflows/ci.yml:54-57`

- **Cos'è:** prima di ogni test `truncateAll` svuota tutte le tabelle. Ogni file di test avvia poi il suo Postgres in Docker (un «container») e applica le migrazioni.
- **Problema:** `truncateAll` svuota le tabelle una alla volta con CASCADE, quindi fa 283 svuotamenti a ogni chiamata. Con 4 test in parallelo costa ~0,7 s; un solo `TRUNCATE` di tutte le tabelle costa 30 ms (misurato). Infatti i test che non svuotano il DB durano 7–31 ms. In più ognuno dei 93 file paga ~3,5 s per avviare e migrare il suo Postgres.
- **Correzione:**
  - nel `DO`, sostituisci il ciclo con un solo `EXECUTE` che costruisce `TRUNCATE t1, t2, … RESTART IDENTITY CASCADE` con `string_agg`: −140 s in CI;
  - avvia un solo container per run e migra `bibs_test` una volta; ogni file crea la sua copia con `CREATE DATABASE <nome> TEMPLATE bibs_test` (~0,1 s, lanciato dal database `postgres`) e la cancella alla fine: −80 s, +45 righe;
  - in CI costruisci l'immagine PostGIS mentre gira `bun install`: `docker build … & bun install --frozen-lockfile; wait $!` (−18 s).
- **Se non lo facciamo:** il job API resta ~4 minuti più lungo del necessario, e il costo cresce con ogni nuovo file di test.
- **Prove:** Misurato su un container di prova con 4 sessioni: il ciclo di oggi 688–768 ms, un solo TRUNCATE 28–33 ms. I ~5 s per file vengono dal log CI del run 38131278805, e la verifica li ha divisi in ~3,5–4 s per avviare e migrare il container, più gli import. A HEAD ho ricontrollato righe e conteggi: 95 file, 93 con setupTestContainer, 91 con truncateAll.

#### 12. In CI i test dei frontend aspettano la fine dei test API

**Dove:** `package.json:21`, `.github/workflows/ci.yml:46-81`, `apps/admin/package.json:12`, `apps/customer/package.json:13`, `apps/seller/package.json:13`

- **Cos'è:** il job «API tests» lancia lo script `test` di root, che esegue in fila emails, ui, api, admin, customer e seller.
- **Problema:** i test dei frontend non usano né Docker né l'API, eppure partono dopo i 5:23 dell'integrazione. Aggiungono 44 s al job più lungo, e se un test API fallisce non girano proprio. In più 43 file di test frontend su 65 ricaricano tutti i moduli delle traduzioni (~1.000 nel seller, ~500 in admin e customer).
- **Correzione:** nel job `web-build` aggiungi `- run: bun run test` con `working-directory: apps/${{ matrix.app }}`, e nel job API lancia solo emails, ui e api. Aggiungi poi `--output-structure locale-modules` ai tre script `paraglide:compile`: è la struttura che il plugin Vite usa già in sviluppo, e i bundle di produzione non cambiano. In una prova, 12 file di test sono passati da ~3,3 s a 0,7 s.
- **Se non lo facciamo:** ogni PR aspetta ~45 s in più, e un errore dell'API nasconde quelli dei frontend.
- **Prove:** Tempi presi dal log del job API del run 38131278805: admin, customer e seller fanno 43,7 s dopo i 323 s di integrazione. La prova con la config Vitest vera su 12 file ha dato 2,9–3,7 s contro 0,71 s; a HEAD ho ricontato 26/20/19 file di test e 1.004/489/495 moduli di messaggi.

#### 13. Lo stesso blocco di avvio del database è copiato in 91 file di test

**Dove:** `apps/api/tests/helpers/test-db.ts`, l'inizio di 91 file in `apps/api/tests/integration/`

- **Cos'è:** ogni test di integrazione inizia con lo stesso blocco: un `@/db` finto (un «mock») che punta al Postgres di prova, più avvio, chiusura e svuotamento del DB.
- **Problema:** il blocco, circa 30 righe, è copiato in 91 file su 95. In 21 file c'è anche un commento falso, «Bun sposta mock.module prima degli import», che Bun non fa. Cambiare il blocco (per esempio il timeout di 120 s) costa 91 modifiche.
- **Correzione:** aggiungi `useTestDb()` in `test-db.ts`, con il mock e i tre passi. Chiamala nel corpo di ogni file, dopo gli import e prima di ogni `await import(...)`. Non deve essere un import che esegue codice da solo: con Bun 1.4.2 il vero `@/db` verrebbe caricato dopo e cancellerebbe il mock.
- **Se non lo facciamo:** restano 2.700 righe copiate, e ogni nuovo file ne aggiunge altre 30.
- **Prove:** Contati a HEAD: mock di @/db in 92 file, setupTestContainer in 93, truncateAll in 91, commento «hoisted» in 21. Un esperimento con Bun 1.4.2 nello scratchpad, ripetuto dalla verifica, mostra che un helper importato per primo perde il mock, mentre una funzione chiamata nel corpo lo tiene.

#### 14. Dieci endpoint che nessuna app usa, tre dei quali con un buco

**Dove:** `apps/api/src/modules/registration/index.ts:162-205`, `apps/api/src/modules/customer/routes/orders.ts:22-86`, `apps/api/src/modules/seller/routes/stores.ts:77-109`, `apps/api/src/modules/seller/routes/profile.ts:14-41`, `apps/api/src/modules/seller/routes/products.ts:608-646`, `apps/api/src/modules/seller/routes/discounts.ts:272-295`, `apps/api/src/modules/seller/routes/brands.ts:46-71`, `apps/api/src/modules/locations/routes/locations.ts:48-107`

- **Cos'è:** un endpoint è un indirizzo dell'API. Ho confrontato le 175 route con le chiamate delle tre app.
- **Problema:** questi 10 non li chiama nessuno, e quasi tutti rifanno il lavoro di un altro endpoint che le app usano già. Tre sono anche pericolosi:
  - `POST /register/sign-in` è una seconda porta per provare password e non funziona nemmeno come login (non manda il cookie);
  - `POST /customer/orders` crea prenotazioni anche nei negozi che le hanno disattivate e blocca lo stock per 48 ore;
  - `POST /seller/stores` crea un negozio senza pagare l'abbonamento (i clienti però non lo vedono).
- **Correzione:** cancella i tre sopra, `GET /seller/profile`, `DELETE /seller/products/:id`, `DELETE /seller/discounts/:id/products/:productId`, `POST /seller/brands` e `GET /locations/regions|provinces|municipalities`. Togli con loro anche servizi, schemi e test usati solo da questi endpoint. `createOrder` e il tipo `direct` restano. Aggiorna README, AGENTS.md e docs/architecture.md.
- **Se non lo facciamo:** restano ~1.000 righe da mantenere e tre modi per aggirare regole che le app rispettano.
- **Prove:** Grep delle chiamate Eden (il client tipizzato dell'API) nei tre frontend: nessuna chiamata ai 10 endpoint. Letti a HEAD signIn (chiama auth.api.signInEmail dal server, quindi nessun cookie arriva al browser), createOrder/priceOrder (non leggono le modalità del negozio, il checkout sì a checkout.ts:95) e publiclyVisibleStore.

#### 15. API: codice gemello che deve cambiare insieme

**Dove:** `apps/api/src/modules/customer/services/orders.ts:663-684` e `apps/api/src/modules/seller/services/orders.ts:271-290`; `apps/api/src/modules/seller/services/images.ts` e `apps/api/src/modules/seller/services/store-images.ts`; `apps/api/src/modules/seller/context.ts:76-89`; `apps/api/src/modules/admin/services/sellers.ts:74-428`

- **Cos'è:** blocchi uguali in più file:
  - l'annullamento ordine, con rimborso e restituzione di stock e punti;
  - il caricamento delle foto di prodotto e di negozio;
  - il controllo «negozio mio e non cancellato», scritto 5 volte;
  - il «comune compatto», scritto 10 volte.
- **Problema:** ogni correzione va fatta in più posti, e la storia lo conferma. #202 e #220 hanno toccato entrambe le copie dell'annullamento, e #70, #209 e #220 entrambe le foto. Un crash della geometria già corretto nei prodotti è tornato negli ordini, e #198 ha dovuto correggerlo in 4 copie. L'annullamento muove soldi: se una copia resta indietro, cliente e negozio rimborsano in modo diverso.
- **Correzione:**
  - `cancelLoadedOrder(tx, existing)` usata dai due annullamenti (−17);
  - un solo servizio foto in un nuovo `lib/upload.ts`, non in `lib/s3.ts` perché 10 test lo sostituiscono con un mock (−95);
  - riusa `ensureStoreOwnership` e `loadOwnedSubscription` (−35);
  - `reshapeAddress` e `storeCompactWith` in `lib/municipality.ts`, confrontando le risposte prima e dopo (backlog P5, −250).
- **Se non lo facciamo:** la prossima modifica a rimborsi, foto o accessi rischia di restare a metà.
- **Prove:** Diff dei file gemelli e git log: 28cf4d4 (#202) tocca i due annullamenti; ed0d0cd (#70), 24389ba (#209) e f0f128b (#220) toccano i due servizi foto; b5f0bd4 (#198) rimette `location: false` negli ordini dopo b7b8be1 nei prodotti. A HEAD ho contato 10 file di test con mock di @/lib/s3.

#### 16. Frontend: recupero password e verifica email copiati tra customer e seller

**Dove:** `apps/customer/src/routes/forgot-password.tsx`, `apps/customer/src/routes/reset-password.tsx`, `apps/customer/src/routes/verify-email.tsx` e le stesse tre in `apps/seller/src/routes/`; `apps/customer/src/features/auth/components/pending-verification-banner-connected.tsx` e la sua copia in `apps/seller/src/features/auth/components/`

- **Cos'è:** tre pagine per chi non ha ancora fatto login, più il banner «email in attesa» con il tasto «Reinvia».
- **Problema:** esistono due volte, quasi uguali (~450 righe per copia; il banner è identico), e la logica del reinvio è scritta 4 volte. Le copie sono già diverse: in inglese il seller mostra ancora «email@esempio.it». Inoltre, se l'orologio del PC va indietro di un'ora, il «Reinvia» del banner resta bloccato 61 minuti; verify-email questo caso lo gestisce, il banner no.
- **Correzione:** un componente per pagina in `@bibs/ui/custom` (ForgotPasswordCard, ResetPasswordCard, VerifyEmailCard). Ognuno riceve i testi (`labels`), i link come elementi `<Link>` e una funzione che chiama `authClient` dentro l'app, così i tipi di better-auth restano nelle app. L'attesa del reinvio entra in `PendingVerificationBanner` e parte da `Math.min(resentAt, Date.now())`.
- **Se non lo facciamo:** ogni correzione all'accesso si fa due volte. Si risparmiano circa 190 righe.
- **Prove:** Diff customer↔seller: banner identico (79/79 righe), 457 e 451 righe per copia contate a HEAD. Letti il placeholder fisso in apps/seller/src/routes/forgot-password.tsx:80 e il banner che parte da `resentAt` senza limite, mentre verify-email usa `sentAtFromSearch` (Math.min).

#### 17. Regole copiate tra API e frontend, con due difetti già visibili

**Dove:** `apps/api/src/lib/validation-message.ts:170-173`, `apps/seller/src/lib/typebox-errors.ts:52-69`, `apps/seller/src/features/profile/components/business-info-card.tsx:27-45`, `apps/seller/src/features/orders/pickup-code.ts:1-16`, `apps/seller/src/features/stores/lib/validate-opening-hours.ts:1-30`, `apps/customer/src/features/stores/format-opening-hours.ts:28-56`

- **Cos'è:** la stessa regola è scritta nell'API e poi di nuovo nei frontend: dati aziendali del profilo, codice di ritiro, orari dei negozi.
- **Problema:** il profilo seller usa regole zod scritte a mano, senza le lunghezze massime. L'API, a differenza del seller, mostra il messaggio d'errore scritto nello schema anche quando il testo è troppo lungo. Risultato: una ragione sociale di 201 caratteri dà «La ragione sociale è obbligatoria». In più il cliente vede le fasce orarie nell'ordine in cui sono state inserite (14:30–19:00 prima di 09:00–13:00), mentre l'API le ordina solo per dire se il negozio è aperto.
- **Correzione:**
  - nel profilo usa `typeboxResolver(TypeCompiler.Compile(CompanySettingsBody))`, come fa già l'onboarding (−55);
  - metti in `validation-rule.ts` la regola «il messaggio dello schema non vale per la lunghezza massima», usala in API e seller e aggiungi un test API;
  - esporta `pickup-code.ts` e `opening-hours.ts`, che non importano niente, e cancella le copie nei frontend (−68);
  - ordina le fasce in `formatWeeklyHours` (1 riga).
- **Se non lo facciamo:** ogni cambio di regola si fa in 2–3 posti, e chi sbaglia un campo legge un messaggio falso.
- **Prove:** Riprodotto con Elysia 1.4.30 e il validationMessage vero: una ragione sociale di 201 caratteri dà «La ragione sociale è obbligatoria», e la seconda verifica ha ripetuto la prova. Letti a HEAD formatWeeklyHours (nessun ordinamento) e slotsFor (ordina solo per lo stato).

#### 18. Chiamate a Stripe senza timeout dentro le transazioni, ed errori che diventano 500

**Dove:** `apps/api/src/lib/stripe.ts:9-16`, `apps/api/src/plugins/error-handler.ts:211-225`, `apps/api/src/modules/customer/services/checkout.ts:241-327`, `apps/api/src/modules/billing/services/order-payments.ts:101-181`, `apps/api/src/modules/billing/services/order-payments.ts:359-435`

- **Cos'è:** checkout, annullamenti e trasferimenti chiamano Stripe mentre una transazione del database (scritture che riescono o si annullano tutte insieme) è aperta. È voluto, così niente resta a metà.
- **Problema:** il client Stripe usa i valori predefiniti: 80 s per tentativo e 2 ritentativi, cioè fino a ~4 minuti per chiamata, con righe bloccate e una delle 20 connessioni al DB occupata. Se Stripe non risponde per qualche minuto, bastano pochi checkout al minuto per finire le connessioni, e falliscono anche login e pagine che non usano Stripe. In più 11 chiamate Stripe senza gestione dell'errore rispondono 500 «Errore interno» invece del 502 «riprova» usato dalle altre.
- **Correzione:** passa `timeout: 10_000, maxNetworkRetries: 1` al costruttore: le chiavi di idempotenza che ci sono già rendono sicuri i ritentativi. Nel gestore globale degli errori aggiungi un ramo che trasforma `Stripe.errors.StripeError` in 502, con un test. A parte, esporta una sola `getSubscriptionIdFromInvoice` (oggi copiata 3 volte), non da `lib/stripe.ts`, che 23 file di test sostituiscono con un mock.
- **Se non lo facciamo:** un rallentamento di Stripe ferma tutta l'API invece di far fallire qualche pagamento.
- **Prove:** Letti a HEAD lib/stripe.ts (nessun timeout), stripe@22.6.2 (DEFAULT_TIMEOUT 80000, 2 ritentativi) e il pool in env.ts (20 connessioni, attesa 5 s). La verifica ha confermato le chiamate dentro le transazioni, e anche le 11 chiamate senza catch che finiscono nel 500 di error-handler.ts:211-225.

#### 19. Un negozio senza modalità d'acquisto blocca il checkout di tutto il carrello

**Dove:** `apps/api/src/modules/customer/services/cart.ts:218-237`, `apps/customer/src/features/checkout/checkout-choice.ts:29-45`, `apps/customer/src/routes/_authenticated/checkout/index.tsx:96-139`

- **Cos'è:** per ogni negozio il carrello indica le modalità d'acquisto offerte. «Paga e ritira» compare solo se il conto Stripe del venditore può incassare.
- **Problema:** prendi un negozio che offre solo «Paga e ritira», e Stripe sospende il suo conto (per esempio per un documento scaduto). Le modalità diventano zero, ma le sue righe restano «ok». Nel checkout quel negozio non ha opzioni e «Avanti» resta spento senza spiegazione, quindi il cliente non può comprare nemmeno dagli altri negozi.
- **Correzione:** in `getCart` segna come «non disponibili» le righe dei negozi senza modalità: è una condizione in più su `issue`. Aggiungi un test sul modello di «conto non abilitato».
- **Se non lo facciamo:** ogni sospensione del conto di un negozio con solo «Paga e ritira» blocca i clienti che hanno quel negozio nel carrello.
- **Prove:** Percorso letto per intero a HEAD: cart.ts:218-223 non guarda le modalità, offeredOrderTypes (lib/order-types.ts:13-21) toglie «Paga e ritira» se il conto non incassa, e checkout/index.tsx:134 lascia «Avanti» spento se un negozio non ha una scelta.

#### 20. Negozio archiviato: gli ordini già pagati restano bloccati

**Dove:** `apps/api/src/modules/webhooks/services/handlers/subscription-deleted.ts:32-52`, `apps/api/src/jobs/auto-cancel-suspended-stores.ts:71-81`, `apps/api/src/modules/seller/context.ts:41-52`, `apps/api/src/lib/order-state-machine.ts:20-23`, `apps/api/src/plugins/cron.ts:48-68`

- **Cos'è:** quando l'abbonamento finisce, il negozio va in archivio e il venditore perde l'accesso ai suoi ordini.
- **Problema:** l'archiviazione non tocca gli ordini aperti. Esempio: il negozio in disdetta vende fino a mezzanotte, alle 23:50 un cliente paga 30 € e il negozio segna l'ordine «pronto». Il giorno dopo il negoziante non trova più l'ordine, e nessuno può annullarlo. La UI del seller invece promette che gli ordini restano visibili in sola lettura.
- **Correzione:** è una decisione di prodotto. Io aggiungerei un passaggio al cron orario: annulla e rimborsa gli ordini «Paga e ritira» ancora aperti dei negozi archiviati (CAS, cioè l'aggiornamento che riesce solo se lo stato non è cambiato, più `refundOrderPayment` e `refundStockAndPoints`), con un test. L'alternativa è lasciare al titolare l'accesso agli ordini del negozio archiviato.
- **Se non lo facciamo:** ogni chiusura con ordini aperti va sistemata a mano sul database, e su Stripe se il cliente va rimborsato.
- **Prove:** Letti a HEAD i due punti che archiviano (subscription-deleted.ts:42-46, auto-cancel-suspended-stores.ts:72-75), il filtro deletedAt delle route seller e la macchina a stati (i passaggi di stato ammessi) senza ready_for_pickup→cancelled. La seconda verifica l'ha declassato (niente soldi persi), ma l'ordine resta aperto e il testo del seller promette la «sola lettura» (it.json:691-694).

## 3. Altre copie da centralizzare

Le altre copie e il codice mai usato, oltre ai n. 13–17, in ordine di righe. Il dettaglio di ognuna è nella [sezione 4](#4-dettaglio-degli-altri-finding-verificati), con il codice indicato nell'ultima colonna.

| Cosa | Dove | Righe | Voce |
|---|---|---|---|
| 16 componenti shadcn mai importati e 5 dipendenze che nessuno usa (resto dell'audit di giugno) | `packages/ui/src/components/` | −2.050, −5 dipendenze | F2 |
| Test «solo titolare»: stesso server di prova in 7 file, `noopPino` in 18 | `apps/api/tests/modules/` | −400 | T2 |
| 143 testi tradotti uguali in 2–3 app, e altri già diversi in inglese | `apps/*/messages/` | −359 | F8 |
| `id`, `createdAt` e `updatedAt` riscritti in ogni tabella | `apps/api/src/db/schemas/` | −175 | A3 |
| `env.ts` mai usati e 2 pacchetti installati per niente (backlog P5) | `apps/*/src/env.ts` | −150, −2 dipendenze | F1 |
| Form, schema e filtro delle categorie prodotto e negozio gemelli | `apps/admin/src/features/` | −130 | F3 |
| Il PATCH di negozio e prodotto ricopia i limiti della creazione | `apps/api/src/modules/seller/routes/` | −95 | A1 |
| Fixture dell'abbonamento troppo stretta: 11 insert a mano | `apps/api/tests/` | −90 | T3 |
| Schemi di risposta ricopiati e 2 liste paginate fatte a mano | `apps/api/src/lib/schemas/` | −85 | A4 |
| `RootDocument` copiato 3 volte e la chiave del tema in 4 file | `apps/*/src/routes/__root.tsx` | −80 (circa 0 col solo primo passo) | F9 |
| `caught()` copiato in 4 file di test | `apps/api/tests/integration/` | −70 | T4 |
| `richMessage` e il suo test identici in admin e seller | `apps/{admin,seller}/src/lib/` | −58 | F10 |
| 3 menu «paese» copiati nell'onboarding, senza etichetta collegata | `apps/seller/src/routes/_authenticated/onboarding/` | −34 | F4 |
| Controllo di colonne e «file vuoto» ripetuto in 5 import CSV | `apps/api/src/modules/*/services/` | −35 | A5 |
| Billing seller: banner e pagina fanno le stesse due azioni | `apps/seller/src/` | −30 | F7 |
| `ruleMessage` copiato in 3 app | `apps/*/src/lib/` | −25 | F11 |
| Stessa cornice di pagina in `/products` e `/stores` del customer | `apps/customer/src/routes/_authenticated/` | −25 | F6 |
| Stato «aperto/chiuso» convertito in 3 hook | `apps/customer/src/features/stores/` | −15 | F12 |
| Import caratteristiche: regole ricopiate, la copia ha perso un controllo | `apps/api/src/modules/admin/services/` | −8 (test compreso) | A2 |
| Numero corto dell'ordine scritto 5 volte | `apps/{customer,seller}/src/` | 0 | F13 |
| 7 test di codice di `@bibs/ui` che stanno nelle app | `apps/*/src/` | 0 | T5 |

## 4. Dettaglio degli altri finding verificati

Tutti verificati come i 20 numerati, da un secondo agente che ha provato a smentirli. Ogni voce ha un codice (F = frontend, A = API, T = test e CI) per poterla citare. «Righe» è il saldo stimato dopo la correzione. Nelle righe «Prove», i «dati del workflow» sono i risultati di ricerca e verifica descritti nella [sezione 10](#10-metodo-e-limiti).

### 4.1 Frontend e `packages/ui` (F)

**Da correggere**

#### F1. env.ts mai usati e due pacchetti installati per niente (P5)

**Dove:** `apps/admin/src/env.ts:1-40`, `apps/seller/src/env.ts:1-40`, `apps/customer/src/env.ts:1-41`, `apps/customer/src/features/checkout/stripe.ts:2-9`, `apps/admin/package.json:26-33`, `apps/customer/package.json:29-36`, `apps/seller/package.json:31-38`, `package.json:44-53`, `apps/admin/.env.example:4-12`, `apps/customer/.env.example:4-8`, `apps/seller/.env.example:4-8`, `apps/admin/README.md:33-35`, `apps/customer/README.md:33`, `apps/seller/README.md:37`, `apps/admin/src/routes/__root.tsx:31`, `docs/architecture.md:159`, `AGENTS.md:105-112`

**Gruppo:** da correggere · **Righe:** −150 · **Dipendenze:** −2 · **Backlog:** P5

- **Cos'è:** env.ts dovrebbe controllare all'avvio le variabili d'ambiente (impostazioni come VITE_API_URL) con @t3-oss/env-core. In admin e seller nessun file lo importa; nel customer lo usa solo stripe.ts, per la chiave pubblica di Stripe.
- **Problema:** In admin e seller il controllo non gira mai, e README ed .env.example promettono variabili che non fanno niente: con VITE_APP_TITLE=Bibs Admin il titolo non cambia (è scritto a mano in __root.tsx:31) e con VITE_API_URL=foo il seller parte senza errori. Anche @tanstack/react-router-ssr-query è installato nelle tre app e nessun file lo importa.
- **Correzione:** Cancella i tre env.ts e in stripe.ts leggi import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY, come già fanno api.ts e auth-client.ts (una chiave segreta la rifiuta già Stripe.js); togli @t3-oss/env-core e @tanstack/react-router-ssr-query dalle tre app e dal catalog (le versioni comuni in package.json). Pulisci README, .env.example, docs/architecture.md:159 e AGENTS.md:105 e :112; router.tsx e server.ts restano perché sono i file d'ingresso di TanStack Start, quindi niente @bibs/app-kit.
- **Se non lo facciamo:** Chi configura un'app si fida di un controllo che non esiste. E a ogni aggiornamento di TanStack va allineato anche un pacchetto che nessuno usa.
- **Prove:** Dati del workflow (la verifica ha esteso la correzione all'env.ts del customer e a docs/architecture.md) più mio grep a HEAD: '@/env' è importato solo da stripe.ts:2, i due pacchetti compaiono solo nei package.json, e AGENTS.md:105 e :112 citano ancora T3Env.

#### F2. 16 componenti shadcn e 5 dipendenze che nessuno usa

**Dove:** `packages/ui/src/components/chart.tsx:1-356`, `packages/ui/src/components/carousel.tsx:1-241`, `packages/ui/src/components/input-otp.tsx:1-85`, `packages/ui/src/components/resizable.tsx:1-50`, `packages/ui/src/components/accordion.tsx:1-86`, `packages/ui/src/components/aspect-ratio.tsx:1-11`, `packages/ui/src/components/button-group.tsx:1-82`, `packages/ui/src/components/context-menu.tsx:1-266`, `packages/ui/src/components/direction.tsx:1-22`, `packages/ui/src/components/empty.tsx:1-101`, `packages/ui/src/components/hover-card.tsx:1-44`, `packages/ui/src/components/item.tsx:1-195`, `packages/ui/src/components/kbd.tsx:1-26`, `packages/ui/src/components/menubar.tsx:1-283`, `packages/ui/src/components/navigation-menu.tsx:1-166`, `packages/ui/src/components/progress.tsx:1-31`, `packages/ui/package.json:22-24`, `packages/ui/package.json:31-32`, `package.json:81`, `packages/ui/README.md:12-25`, `docs/audit/2026-09-24-followup-gap-analysis.md:115`

**Gruppo:** da correggere · **Righe:** −2.050 · **Dipendenze:** −5

- **Cos'è:** packages/ui/src/components contiene i componenti copiati dal registro shadcn (la raccolta da cui si generano i componenti di base). 16 di questi non li importa nessuna app, né packages/ui, né packages/emails, anche se l'export ./components/* li rende importabili.
- **Problema:** Sono 2.045 righe e 5 dipendenze tenute per niente: recharts, embla-carousel-react, input-otp e react-resizable-panels servono solo a chart, carousel, input-otp e resizable, e date-fns non la importa nessun file. Il costo si vede già: il backlog rimanda l'aggiornamento a recharts 3 per una «primitive inutilizzata».
- **Correzione:** Cancella i 16 file, togli le 5 dipendenze da packages/ui/package.json e react-resizable-panels dal catalog (package.json:81), poi aggiorna le righe 12-25 del README di packages/ui. Se un componente servirà, `bunx shadcn add <nome>` da packages/ui lo rigenera; date-fns resta installata perché la porta react-day-picker.
- **Se non lo facciamo:** Ogni aggiornamento delle dipendenze e ogni typecheck (controllo dei tipi) di ui si portano dietro codice che nessuna pagina usa. È la PR a parte decisa a #136 e mai fatta.
- **Prove:** Mio grep a HEAD su apps/*/src, packages/ui/src, packages/emails/src e sulle config, con import statici, dinamici, relativi e via ~/ (prima provato sui componenti usati): 16 file senza import per 2.045 righe, collapsible oggi usato da product-characteristics-section.tsx, le 4 librerie importate solo dai loro componenti e date-fns da nessun file, già dipendenza di react-day-picker 9.14.

#### F3. Admin: form, schema e filtro delle categorie copiati due volte

**Dove:** `apps/admin/src/features/product-categories/components/product-category-form.tsx:1-108`, `apps/admin/src/features/store-categories/components/store-category-form.tsx:1-108`, `apps/admin/src/features/product-categories/schemas/product-category.ts:1-11`, `apps/admin/src/features/store-categories/schemas/store-category.ts:1-11`, `apps/admin/src/features/product-categories/product-categories.config.tsx:35-96`, `apps/admin/src/features/store-categories/store-categories.config.tsx:33-94`, `apps/admin/src/features/store-categories/store-categories.config.tsx:136-143`, `apps/admin/src/lib/zod-errors.test.ts:5-8`

**Gruppo:** da correggere · **Righe:** −130

- **Cos'è:** Nell'admin le schede «Categorie prodotto» e «Categorie negozio» hanno ognuna un form (macro categoria più nome), uno schema di validazione, un filtro per macro e una colonna «Macro».
- **Problema:** I due form sono uguali riga per riga (cambiano solo id e placeholder), e così schemi, filtro e colonna. Le copie si sono già separate: il bug «in modifica si salva il nome vecchio» è rimasto nei form categoria fino a #243. Ancora oggi la config negozio lancia errori a mano invece di usare unwrap, quindi su un errore 4xx (richiesta rifiutata) la sua lista macro riprova 3 volte e quella del prodotto no.
- **Correzione:** Tieni un solo CategoryForm (props idPrefix e namePlaceholder) e un solo schema in features/crud, accanto a CategoryCrudPanel, e sposta lì MacroFilter (riceve macros e isLoading) e macroColumn; ogni config tiene il suo useMacros. Cancella i file «store», aggiorna gli import (anche zod-errors.test.ts:5 e :8) e usa unwrap anche nella config negozio.
- **Se non lo facciamo:** La prossima correzione a uno dei due form rischia di restare a metà, come è già successo fino a #243.
- **Prove:** Dati del workflow (diff, git log, corpo del commit #243; la verifica ha portato la stima da −150 a −130) più mio controllo a HEAD: i diff di form e schemi cambiano solo nomi, id e placeholder, e shouldRetryQuery ferma solo gli ApiError 4xx, che la config negozio non produce.

#### F4. Menu «paese» dell'onboarding e «Righe per pagina» senza etichetta collegata

**Dove:** `apps/seller/src/routes/_authenticated/onboarding/personal-info.tsx:109-132`, `apps/seller/src/routes/_authenticated/onboarding/personal-info.tsx:134-157`, `apps/seller/src/routes/_authenticated/onboarding/personal-info.tsx:166-189`, `packages/ui/src/custom/page-size-selector.tsx:34-43`

**Gruppo:** da correggere · **Righe:** −34

- **Cos'è:** Nel passo «dati personali» dell'onboarding (la registrazione guidata del venditore) ci sono tre menu con l'elenco dei paesi: cittadinanza, paese di nascita e paese di residenza. In fondo a tutte le liste paginate di seller e admin c'è anche il menu «Righe per pagina» (`PageSizeSelector`).
- **Problema:** Il blocco del menu paese è copiato tre volte e in nessuna copia l'etichetta è collegata al menu: manca `htmlFor` sull'etichetta e `id` sul menu (in `PageSizeSelector` l'etichetta è solo uno `span` accanto al menu). Caso: con lo screen reader (il programma che legge lo schermo a chi non vede) e il tasto Tab, i tre menu non dicono il loro nome, quindi non si capisce quale sia la cittadinanza e quale la residenza.
- **Correzione:** Una funzione locale `countryField(name, label)` nello stesso file, con `FieldLabel htmlFor={name}` e `SelectTrigger id={name}` (come product-form.tsx:481 e 495 con «product-vat-rate»), chiamata tre volte. In page-size-selector.tsx:41 aggiungi `aria-label={label}` al `SelectTrigger`, come fa già apps/seller/src/routes/_authenticated/orders/index.tsx:281.
- **Se non lo facciamo:** Chi usa lo screen reader o i comandi vocali sceglie i paesi alla cieca, in un passo che ogni venditore deve fare. Ogni ritocco al menu paese va fatto tre volte.
- **Prove:** Dati del workflow (confermato due volte; la seconda verifica ha abbassato il gruppo a «da correggere» e ha trovato PageSizeSelector) più rilettura a HEAD delle righe citate e una bozza della funzione formattata con Biome nello scratchpad, che toglie 38 righe dal file.

#### F5. La lista ordini del venditore legge ?page e ?limit senza controlli

**Dove:** `apps/seller/src/routes/_authenticated/orders/index.tsx:74-75`, `apps/customer/src/routes/_authenticated/orders/index.tsx:25`, `apps/customer/src/routes/_authenticated/points.tsx:20`, `packages/ui/src/lib/pagination-search.ts:14-22`

**Gruppo:** da correggere · **Righe:** +2

- **Cos'è:** Le liste paginate leggono la pagina e le righe per pagina dall'indirizzo (URL), dentro `validateSearch` (la funzione che legge l'indirizzo). `parsePaginationSearch` di @bibs/ui riporta i valori non validi a pagina 1 e 20 righe, e tiene le righe entro 100.
- **Problema:** Prodotti, promozioni, team, utenti e negozi lo usano. La lista ordini del venditore fa solo `Number()`, e ordini e punti del cliente fanno un controllo a metà. Caso: con un indirizzo scritto a mano, `/orders?limit=200` o `/orders?page=abc`, l'API risponde 422 (dato non valido) e al posto della lista compare un riquadro d'errore; nel cliente succede con `/orders?page=1.5`.
- **Correzione:** Nella lista ordini del venditore metti `...parsePaginationSearch(search)` al posto delle righe 74-75. Nel cliente, in ordini e punti, scrivi `page: parsePaginationSearch(search).page`.
- **Se non lo facciamo:** Un link vecchio o ritoccato apre una pagina d'errore, senza perdere dati. La prossima correzione comune alle liste salterà di nuovo queste tre pagine.
- **Prove:** Dati del workflow (gruppo abbassato a «da correggere», perché tutti i link dell'app danno valori validi) più rilettura a HEAD: l'API accetta solo interi da 1 con limit al massimo 100 (apps/api/src/lib/pagination.ts:10-22), ed è il resto di P3.2, chiusa in #211 senza la lista ordini.

#### F6. Cliente: /products e /stores copiano la stessa cornice di pagina

**Dove:** `apps/customer/src/routes/_authenticated/products/index.tsx:30-42`, `apps/customer/src/routes/_authenticated/products/index.tsx:201-209`, `apps/customer/src/routes/_authenticated/products/index.tsx:281-383`, `apps/customer/src/routes/_authenticated/stores/index.tsx:38-46`, `apps/customer/src/routes/_authenticated/stores/index.tsx:215-223`, `apps/customer/src/routes/_authenticated/stores/index.tsx:372-478`

**Gruppo:** da correggere · **Righe:** −25

- **Cos'è:** Le due pagine di ricerca del cliente hanno la stessa cornice: titolo, distanza e ricerca in alto, filtri a sinistra (in un pannello laterale sotto i 1024px), riga «N risultati · filtri» con «Cancella filtri», poi la griglia.
- **Problema:** Tutta la cornice è copiata, comprese le due griglie che il commento di products/index.tsx:30-36 dice di tenere uguali, ma niente lo garantisce. Tutti i 6 commit su /products hanno toccato anche /stores, e 4 di loro (#212, #221, #258, #259) hanno fatto la stessa modifica alla cornice nei due file.
- **Correzione:** Un componente SearchPage in features/search con le due griglie e degli slot (pezzi passati dalla pagina: titolo, ricerca, filtri, riepilogo, azioni, risultati); le pagine tengono query, filtri e risultati. Il calcolo di scopeLabel va in filter-rail/category-selection.ts, che ha già i test.
- **Se non lo facciamo:** Ogni ritocco alla ricerca resta doppio. Alla prima svista, per esempio la colonna filtri a 18rem in una pagina sola, passando da /products a /stores il layout salta.
- **Prove:** Dati del workflow e verifica, che ha letto per intero le due cornici; a HEAD ho riletto le righe citate e il git log dei due file: 6 commit su /products, tutti anche su /stores.

#### F7. Seller: portale pagamenti e «Annulla disdetta» scritti due volte

**Dove:** `apps/seller/src/components/store-billing-banner.tsx:16-57`, `apps/seller/src/routes/_authenticated/billing.tsx:164-185`, `apps/api/src/modules/seller/services/stores.ts:348-358`, `apps/seller/src/hooks/use-active-store.tsx:69`

**Gruppo:** da correggere · **Righe:** −30

- **Cos'è:** Il banner in cima alle pagine del venditore e la pagina Billing hanno le stesse due azioni: aprire il portale pagamenti di Stripe e annullare la disdetta di un negozio.
- **Problema:** Le due chiamate sono copiate. In più il banner aggiorna a mano la cache (i dati tenuti in memoria) e rilegge dopo 1,5 s, perché il suo commento dice che il database lo aggiorna il webhook (avviso automatico) di Stripe. Ma dal #253 l'API scrive subito («non aspettiamo il webhook», stores.ts:351) e infatti la pagina Billing rilegge subito.
- **Correzione:** Due hook in features/billing, useBillingPortal e useReactivateStore, usati da banner e pagina. In onSuccess restituisci qc.invalidateQueries({ queryKey: ['seller', 'billing'] }), così il bottone resta disabilitato finché arrivano i dati nuovi, e togli setQueryData e setTimeout.
- **Se non lo facciamo:** Resta codice che sembra necessario e non lo è. Chi tocca la disdetta deve capire perché le due copie fanno cose diverse.
- **Prove:** Dati del workflow e verifica; a HEAD ho riletto banner, pagina e reactivateStoreSubscription (stores.ts:348-358, scrittura immediata arrivata con #253 il 7/10, setTimeout del banner da #60) e cercato i chiamanti di portal e reactivate: solo questi due file.

**Utile ma non urgente**

#### F8. 143 testi tradotti copiati nei messages di più app

**Dove:** `apps/admin/messages/it.json:1-490`, `apps/admin/messages/en.json:1-490`, `apps/customer/messages/it.json:1-496`, `apps/customer/messages/en.json:1-496`, `apps/seller/messages/it.json:1-1005`, `apps/seller/messages/en.json:1-1005`, `apps/admin/project.inlang/settings.json:9-11`, `apps/customer/project.inlang/settings.json:9-11`, `apps/seller/project.inlang/settings.json:9-11`, `apps/customer/messages/en.json:414`, `apps/seller/messages/en.json:922`, `apps/admin/messages/en.json:17`, `apps/seller/messages/en.json:645`

**Gruppo:** utile ma non urgente · **Righe:** −359

- **Cos'è:** Ogni app ha i suoi messages/it.json ed en.json, che Paraglide (lo strumento delle traduzioni) compila dentro quell'app. 143 chiavi hanno lo stesso testo, in italiano e in inglese, in almeno due app: 38 in tutte e tre, tra cui le 26 validation_*.
- **Problema:** Ogni testo comune va scritto in 2 o 3 app per 2 lingue (362 righe doppie), e lo stesso concetto già diverge. In inglese il customer dice «Back to login» e il seller «Back to sign in»; l'admin scrive «Saving...» e il seller «Saving…».
- **Correzione:** Metti le 143 chiavi in packages/ui/messages/{it,en}.json e in ogni project.inlang/settings.json usa come pathPattern (l'elenco dei file da leggere) ['../../packages/ui/messages/{locale}.json', './messages/{locale}.json']: l'ultimo vince, quindi un'app può ancora cambiare un testo. Paraglide resta compilato per app e ui non importa l'oggetto m dei messaggi; le chiavi già divergenti restano nelle app finché non scegli un testo unico, e alla fine prova bun run paraglide:compile nelle tre app.
- **Se non lo facciamo:** Ogni testo comune si traduce più volte e i testi continuano ad allontanarsi. Nessun bug funzionale.
- **Prove:** Dati del workflow con una prova di compilazione Paraglide 2.27 nello scratchpad (pathPattern a due file: le chiavi condivise si compilano e vince il file dell'app); a HEAD ho rifatto il conteggio con jq (143 chiavi, 38 in tutte e tre, 26 validation_*, 362 righe) e riletto le divergenze.

#### F9. Il guscio HTML della pagina è copiato nelle tre app

**Dove:** `apps/admin/src/routes/__root.tsx:24`, `apps/admin/src/routes/__root.tsx:51-86`, `apps/customer/src/routes/__root.tsx:24`, `apps/customer/src/routes/__root.tsx:51-86`, `apps/seller/src/routes/__root.tsx:24`, `apps/seller/src/routes/__root.tsx:51-86`, `packages/ui/src/custom/theme-toggle.tsx:20-45`, `packages/ui/src/custom/theme-toggle.tsx:68`

**Gruppo:** utile ma non urgente · **Righe:** −80 (circa 0 col solo primo passo)

- **Cos'è:** In ogni app __root.tsx ha RootDocument: monta `<html>`, lo script che applica il tema prima del disegno, i provider, i toast (messaggi a comparsa) e i devtools (strumenti di debug). Le tre copie cambiano solo per la posizione dei toast: nell'admin in basso, nelle altre in alto.
- **Problema:** La chiave «theme» del localStorage (la memoria del browser) sta in quattro file: i tre __root.tsx alla riga 24 e theme-toggle.tsx alle righe 22 e 68. Se la cambi in uno solo, al ricaricamento la pagina non applica il tema scelto; e tre commit (devtools, #94, #138) hanno già dovuto ripetere la stessa modifica nei tre file.
- **Correzione:** Primo passo, senza rischi: esporta THEME_INIT_SCRIPT da packages/ui/src/custom/theme-toggle.tsx, accanto ad applyThemeMode, e importalo nei tre __root.tsx. Se vuoi togliere anche il resto, crea AppDocument in @bibs/ui con lingua e posizione dei toast come parametri, sposta in ui @tanstack/react-router e i due pacchetti devtools, e prova build e curl SSR (pagina preparata dal server) delle tre app.
- **Se non lo facciamo:** Ogni ritocco al guscio va ripetuto tre volte e la chiave del tema resta in quattro file. Oggi le copie sono giuste.
- **Prove:** Dati del workflow (diff e git log; la verifica ha ridotto da 6 a 3 i commit sul corpo di RootDocument e ha declassato la voce) più mio diff a HEAD: admin e seller differiscono solo per titolo, import del CSS e Toaster, e lo script del tema è identico alla riga 24 dei tre file.

#### F10. richMessage e il suo test copiati identici in admin e seller

**Dove:** `apps/admin/src/lib/rich-message.tsx:1-25`, `apps/seller/src/lib/rich-message.tsx:1-25`, `apps/admin/src/lib/rich-message.test.tsx:1-33`, `apps/seller/src/lib/rich-message.test.tsx:1-33`, `packages/ui/package.json:62-64`

**Gruppo:** utile ma non urgente · **Righe:** −58

- **Cos'è:** richMessage mette pezzi di markup (per esempio un nome in grassetto) al posto dei segnaposto {nome} di un testo tradotto. Riceve il testo già tradotto, quindi non usa i messaggi Paraglide dell'app.
- **Problema:** Funzione (25 righe) e test (33 righe) sono uguali carattere per carattere in admin e seller. Se nel seller cambi richMessage, per esempio per nascondere un segnaposto senza valore, l'admin tiene il comportamento vecchio e il suo test resta verde sulla sua copia.
- **Correzione:** Sposta file e test in packages/ui/src/custom/rich-message.tsx (l'export ./lib/* di @bibs/ui accetta solo file .ts), cancella le due copie e cambia i 9 import (2 admin, 7 seller) in @bibs/ui/custom/rich-message.
- **Se non lo facciamo:** Due copie da tenere uguali a mano, ognuna con il suo test. Oggi coincidono.
- **Prove:** Trovato da due agenti e confermato da due verifiche (gruppi «utile ma non urgente» e «da correggere»); a HEAD il diff di sorgente e test è vuoto, gli import sono 9 e packages/ui/package.json:62 fa puntare ./lib/* solo a file .ts.

#### F11. Il testo degli errori di validazione è scelto da tre copie dello stesso codice

**Dove:** `apps/admin/src/lib/zod-errors.ts:13-73`, `apps/customer/src/lib/zod-errors.ts:13-73`, `apps/seller/src/lib/rule-message.ts:10-74`, `packages/ui/src/lib/zod-issue-rule.ts:9-28`

**Gruppo:** utile ma non urgente · **Righe:** −25

- **Cos'è:** Quando un campo non è valido, ruleMessage trasforma la regola violata (calcolata in @bibs/ui da zodIssueRule) nel testo da mostrare nella lingua dell'utente.
- **Problema:** Lo switch di circa 60 righe è scritto tre volte: admin e customer sono identici, il seller ha due casi in più (fileType, uniqueItems). TypeScript obbliga già ad aggiornarli tutti per un tipo di regola nuovo, ma non per un cambio di logica: per scrivere i numeri in un altro modo o aggiungere un singolare vanno toccati tre file uguali.
- **Correzione:** Sposta lo switch in packages/ui/src/lib/zod-issue-rule.ts come ruleMessage(rule, messages), con i numeri formattati da intlLocale(); ogni app passa un oggetto con le sue 26 funzioni ({ required: m.validation_required, … }) e il seller gestisce prima fileType e uniqueItems. Non passare m intero: porterebbe tutti i messaggi dell'app nei file JavaScript dei form.
- **Se non lo facciamo:** Restano circa 180 righe quasi uguali da tenere allineate a mano. TypeScript copre solo i tipi di regola nuovi.
- **Prove:** La verifica ha scartato il passaggio di m intero (Paraglide lo esporta come export * as m in src/paraglide/messages.js) e ha ridotto la stima da −125 a −25; a HEAD il diff admin/customer cambia solo il commento di riga 11 e rule-message.ts del seller ha lo stesso switch più fileType e uniqueItems.

#### F12. Stato «aperto/chiuso» dei negozi convertito in tre hook

**Dove:** `apps/customer/src/features/stores/use-store-search.ts:94-104`, `apps/customer/src/features/stores/use-store-detail.ts:58-68`, `apps/customer/src/features/stores/use-store-map.ts:94-106`, `apps/customer/src/features/stores/open-status.ts:5-10`, `apps/customer/src/features/stores/open-status.ts:28-33`

**Gruppo:** utile ma non urgente · **Righe:** −15

- **Cos'è:** Lista negozi, scheda negozio e mappa ricevono dall'API lo stato di apertura e lo trasformano nella forma usata dall'interfaccia (OpenStatusView).
- **Problema:** La stessa conversione è copiata in tre hook, compreso toYMD sulla data di riapertura, e il perché è scritto solo nella copia della mappa (use-store-map.ts:98-99). Eden (il client tipizzato dell'API) trasforma quella data in un Date mentre il tipo dice string: una quarta copia senza toYMD compila, e la scritta «apre …» va in errore (RangeError) invece di mostrarsi.
- **Correzione:** Una funzione toOpenStatusView in open-status.ts, con il commento su Eden, usata dai tre hook, più un caso nel test open-status.test.ts che c'è già.
- **Se non lo facciamo:** Oggi le tre copie sono giuste: è una protezione per il codice futuro, non un bug di oggi.
- **Prove:** La verifica ha corretto il caso (errore RangeError, non una data sbagliata), il gruppo e la stima; a HEAD ho riletto i tre blocchi e cercato altre conversioni di openStatus in apps/customer/src: non ce ne sono.

#### F13. Il numero corto dell'ordine è scritto cinque volte

**Dove:** `apps/seller/src/features/orders/order-labels.ts:37-39`, `apps/customer/src/routes/_authenticated/orders/$orderId.tsx:38`, `apps/customer/src/routes/_authenticated/orders/index.tsx:33`, `apps/customer/src/routes/_authenticated/points.tsx:24`, `apps/customer/src/routes/_authenticated/checkout/$checkoutId/index.tsx:26`, `apps/seller/src/features/orders/order-summary.ts:22`

**Gruppo:** utile ma non urgente · **Righe:** 0

- **Cos'è:** Cliente e negozio vedono lo stesso ordine con un numero corto: i primi 8 caratteri dell'id in maiuscolo, per esempio #ABCD1234. È il riferimento che si dicono al banco.
- **Problema:** La regola è scritta 5 volte, 4 nel customer e 1 nel seller. Se una copia passa a 6 caratteri, il cliente dice «#ABCD1234» e il negozio vede «#ABCD12»: lo stesso ordine con due numeri, e nessun test se ne accorge.
- **Correzione:** Un solo shortOrderId in @bibs/ui (per esempio packages/ui/src/lib/order-id.ts) usato dalle due app. Nel riepilogo del seller leggi order.pointsDiscount invece di ricalcolarlo; toCents lascialo com'è, spostarlo non toglie righe.
- **Se non lo facciamo:** Oggi le copie coincidono: il rischio è solo una modifica futura fatta in un posto solo.
- **Prove:** La verifica ha tolto toCents dalla correzione e ha portato la stima a 0: toCents e lo sconto punti ricalcolato danno già gli stessi valori dell'API; a HEAD il grep trova 5 copie del numero corto e il dettaglio ordine del seller restituisce già pointsDiscount (apps/api/src/lib/schemas/composed.ts:150-156).

#### F14. Il massimo di 128 caratteri della password manca in registrazione e invito

**Dove:** `apps/customer/src/routes/register.tsx:40`, `apps/seller/src/features/auth/schemas/register.ts:10`, `apps/seller/src/routes/invite.$token.tsx:36-39`, `apps/api/src/lib/schemas/forms/onboarding.ts:150-155`, `apps/customer/messages/it.json:33`, `apps/seller/messages/it.json:160`

**Gruppo:** utile ma non urgente · **Righe:** +11

- **Cos'è:** Password tra 8 e 128 caratteri, 10 foto per prodotto, 8 per negozio, 5 MB per foto: l'API impone questi limiti e i form li ripetono, per avvisare prima dell'invio.
- **Problema:** Oggi i numeri coincidono ovunque, tranne il massimo di 128 per la password: manca nella registrazione del cliente, in quella del venditore e nell'invito del dipendente. Caso: con 129 caratteri la registrazione mostra «Password: al massimo 128 caratteri» solo in italiano e in un riquadro in cima al form, e l'invito mostra un falso «La password deve avere almeno 8 caratteri», perché vince l'`error:` scritto su `AcceptInviteBody` (è lo stesso difetto del n. 17).
- **Correzione:** Aggiungi `.max(128, …)` ai due schemi di registrazione e un controllo `password.length > 128` nell'invito, con il testo che c'è già in tutte e due le app (`auth_reset_password_too_long`). Esportare `config.ts` dell'API per condividere i numeri non serve: oggi coincidono.
- **Se non lo facciamo:** Chi incolla una password molto lunga dal gestore di password riceve un errore poco chiaro e, nell'invito, sbagliato. È un caso raro.
- **Prove:** Dati del workflow (422 della registrazione riprodotto, numeri delle foto uguali quindi quel caso era ipotetico, gruppo abbassato a «utile ma non urgente») più una prova in memoria con Elysia e validationMessage a HEAD, in cui `/register/accept-invite` con 129 caratteri risponde «La password deve avere almeno 8 caratteri».

#### F15. La home del venditore scrive «Riapre il 2026-10-12» e il test lo blocca

**Dove:** `apps/seller/src/features/dashboard/dashboard-actions.ts:108-113`, `apps/seller/src/features/dashboard/dashboard-actions.test.ts:78-86`, `apps/seller/messages/it.json:349`

**Gruppo:** utile ma non urgente · **Righe:** 0

- **Cos'è:** Quando il negozio è chiuso, la home del venditore dice quando riapre, con il testo «Riapre il {date} alle {time}».
- **Problema:** La data arriva grezza da `toYMD` (anno-mese-giorno, il formato dei programmatori), e il test alla riga 85 si aspetta proprio «Riapre il 2026-09-29 alle 09:00», quindi difende il testo sbagliato. Caso: oggi, domenica 11 ottobre, un negozio chiuso che riapre lunedì mostra «Riapre il 2026-10-12 alle 09:00» invece di «Riapre il 12 ott 2026 alle 09:00».
- **Correzione:** Alla riga 110 usa `formatDate` di @bibs/ui (già usato in 5 file del seller) al posto di `toYMD`, e aggiorna l'attesa del test a «Riapre il 29 set 2026 alle 09:00».
- **Se non lo facciamo:** I venditori leggono una data da programmatore in un'interfaccia tutta in italiano, e in inglese «Reopens on 2026-10-12».
- **Prove:** Dati del workflow (confermato; la forma ISO arriva dal codice spostato in #207, senza una scelta voluta) più rilettura a HEAD di dashboard-actions.ts:108-113, del test alla riga 85 e di formatDate in packages/ui/src/lib/date.ts:31-40.

### 4.2 API (A)

**Da correggere**

#### A1. Modifica di negozio e prodotto: il PATCH ricopia a mano le regole della creazione

**Dove:** `apps/api/src/modules/seller/routes/stores.ts:127-184`, `apps/api/src/lib/schemas/forms/stores.ts:4-98`, `apps/api/src/modules/seller/routes/products.ts:365-424`, `apps/api/src/lib/schemas/forms/products.ts:40-89`, `apps/api/src/lib/schemas/entities.ts:27-77`, `apps/seller/src/features/stores/components/store-form.tsx:46-47`, `apps/seller/src/routes/_authenticated/store/index.tsx:113`, `apps/seller/src/features/products/lib/product-form-schema.ts:9-17`

**Gruppo:** da correggere · **Righe:** −95

- **Cos'è:** Lo schema del body (il corpo della richiesta, scritto con TypeBox) dice quali campi accetta l'API e con quali limiti. Il PATCH (la chiamata di modifica) di negozio e prodotto riscrive a mano i limiti della creazione, mentre il form del seller usa lo schema di creazione anche quando modifichi.
- **Problema:** Se cambia una copia sola, form e API non sono più d'accordo, e le copie hanno già perso i testi `error:` della creazione. Caso: alzi il nome negozio a 150 caratteri solo nello schema di creazione e il form di modifica accetta 140 caratteri, ma il salvataggio risponde 422 (dati non validi); con gli orari è già successo (audit del 2026-05-29: il PATCH accettava «99:99»).
- **Correzione:** Ricavare i body di modifica da quelli di creazione. Negozio: `t.Partial(CreateStoreBody)` più `categoryId` che accetta null e `lowStockThreshold`; prodotto: `t.Partial` di `CreateProductBody` senza `storeId`, più `ean` e `brandId` che accettano null, `imageOrder` e `confirmAffected`; `AddressFieldsOptional` diventa `t.Partial(t.Object(AddressFieldsRequired)).properties`.
- **Se non lo facciamo:** Ogni limite va cambiato in due posti, e quando se ne scorda uno il seller riceve in modifica un errore che il form non aveva segnalato.
- **Prove:** Dati del workflow con verifica (limiti confrontati campo per campo: oggi coincidono, e la posizione non va trattata a parte) più rilettura a HEAD dei due PATCH, degli schemi di creazione e dei form del seller (store-form.tsx:47 compila CreateStoreBody, store/index.tsx:113 lo manda al PATCH); era la voce alla riga 1662 dell'audit del 2026-05-29, mai chiusa e non nel backlog.

#### A2. Import caratteristiche: regole copiate a mano, e la copia ha perso un controllo

**Dove:** `apps/api/src/modules/admin/services/characteristic-import.ts:120-149`, `apps/api/src/modules/admin/services/characteristic-import.ts:255-262`, `apps/api/src/modules/admin/services/characteristic-import.ts:312-317`, `apps/api/src/modules/admin/services/characteristic-import.ts:342-349`, `apps/api/src/modules/admin/services/product-characteristics.ts:27-67`, `apps/api/src/db/migrations/0000_init.sql:442`, `apps/api/src/plugins/error-handler.ts:25-28`, `apps/api/src/plugins/error-handler.ts:80-96`, `apps/api/src/db/seed/data/validate-characteristics.ts:228-231`, `apps/admin/src/features/csv-import/components/csv-import-dialog.tsx:80-83`

**Gruppo:** da correggere · **Righe:** −8 (test compreso)

- **Cos'è:** Una caratteristica prodotto (es. «Colore») ha delle regole: unità solo per i numeri, opzioni solo per le liste chiuse, nessuna opzione ripetuta. Il form admin le controlla con `normalizeDefinition`; l'import CSV (file di testo a colonne) le riscrive a mano.
- **Problema:** La copia dell'import non controlla le opzioni ripetute: se il valore ripetuto è nuovo, il database rifiuta i due valori uguali e annulla l'intero import. Caso: sul DB del seed la riga `Trama,enum,,Liscia|Rigata|Liscia` (caratteristica che non esiste ancora) riceve 409 (conflitto) «Esiste già un elemento con questi dati», senza numero di riga e senza salvare nemmeno le righe buone, mentre il form rifiuta la stessa lista con 400 «Opzione ripetuta: "Liscia"».
- **Correzione:** Nel ciclo dell'import chiamare `normalizeDefinition` con le opzioni come `{ value }`, dentro un try/catch: un ServiceError diventa errore di riga, gli altri errori si rilanciano. Poi cancellare i tre controlli scritti a mano e aggiungere un test con una riga che ripete un'opzione.
- **Se non lo facciamo:** Un refuso nelle opzioni blocca tutto l'import con un messaggio che non dice quale riga correggere. Ogni regola nuova va scritta in due posti.
- **Prove:** Dati del workflow con due verifiche (la seconda l'ha declassato a «da correggere»: nel seed «Colore» ha già «Rosso», e lì il doppione passa in silenzio) più rilettura a HEAD di controlli, INSERT, vincolo e 409 generico; il caso usa «Trama» perché «Finitura» è già nel seed, e il 409 è dedotto dal codice, non riprodotto sul DB.

**Utile ma non urgente**

#### A3. Schemi del database: id, createdAt e updatedAt ricopiati in ogni tabella

**Dove:** `apps/api/src/db/schemas/brand.ts:15-28`, `apps/api/src/db/schemas/store.ts:25-27`, `apps/api/src/db/schemas/store.ts:67-73`, `apps/api/drizzle.config.ts:5`

**Gruppo:** utile ma non urgente · **Righe:** −175

- **Cos'è:** Gli schemi Drizzle (la descrizione delle tabelle nel codice) riscrivono in quasi ogni tabella le stesse tre colonne: id, data di creazione e data di modifica.
- **Problema:** In 31 file ci sono 36 copie dell'id, 32 di createdAt e 22 di updatedAt, tutte uguali (circa 290 righe). Caso: per passare gli id a UUID v7 (ordinabili per data) vanno cambiate 36 definizioni, e una dimenticata lascia una tabella diversa senza che nessun test lo noti.
- **Correzione:** Un file `apps/api/src/db/columns.ts` con `id()` e `timestamps`, da spargere con `...` in ogni tabella come nei «column helpers» della documentazione Drizzle. Poi `db:generate` deve dire che non cambia niente.
- **Se non lo facciamo:** Restano circa 175 righe di ripetizione e il rischio di una tabella fatta diversa dalle altre.
- **Prove:** Dati del workflow (confermato, stima corretta da −190 a circa −175) più riconteggio a HEAD con grep su apps/api/src/db/schemas, senza auth.ts (generato da better-auth) e index.ts: 36, 32 e 22 definizioni identiche, nessuna differenza.

#### A4. Schemi di risposta ricopiati a mano invece che riusati

**Dove:** `apps/api/src/lib/schemas/entities.ts:318-335`, `apps/api/src/lib/schemas/entities.ts:987-1001`, `apps/api/src/lib/schemas/entities.ts:134-151`, `apps/api/src/modules/catalog/routes/product-categories.ts:19`, `apps/api/src/lib/schemas/composed.ts:46-50`, `apps/api/src/lib/schemas/composed.ts:243-250`, `apps/api/src/modules/catalog/routes/store-categories.ts:11-18`, `apps/api/src/lib/queries.ts:218-223`, `apps/api/src/lib/queries.ts:199-212`, `apps/api/src/lib/schemas/entities.ts:537-548`, `apps/api/src/lib/schemas/entities.ts:465-477`, `apps/api/src/lib/schemas/entities.ts:523-535`, `apps/api/src/lib/schemas/responses.ts:39-106`, `apps/api/src/modules/admin/routes/billing.ts:33-40`, `apps/api/src/modules/admin/routes/billing.ts:155-182`, `apps/api/src/modules/seller/routes/stores.ts:313-348`, `apps/admin/src/routes/_authenticated/billing/subscriptions.tsx:46-60`, `apps/seller/src/routes/_authenticated/store/archived.tsx:68`, `apps/seller/src/hooks/use-first-store-onboarding.ts:25`

**Gruppo:** utile ma non urgente · **Righe:** −85

- **Cos'è:** Gli schemi di risposta (scritti con TypeBox) dicono a Elysia cosa restituire, e Elysia toglie in silenzio i campi che lo schema non elenca.
- **Problema:** Sei schemi ricopiano a mano uno schema già presente (orari, categoria con macro, profilo con utente, query delle categorie, tipi di caratteristica, errori CSV), 8 schemi d'errore sono uguali tranne il codice, e due liste paginate rifanno a mano paginazione e forma della risposta. Caso: aggiungi «slug» a `ProductCategorySchema`; la copia `ProductCategoryWithMacroSchema` non lo ha, quindi la lista delle sotto-categorie del catalogo e quella del seller non lo restituiscono.
- **Correzione:** Sostituire ogni copia con l'originale (con `...X.properties` dove servono campi in più) e fare gli 8 errori con un helper di schema `errorRes(codice)` che conserva il tipo esatto del codice, come fa `okRes` (non è una factory di route, cioè non crea route). Nelle due liste usare `PaginationQuery` e `okPageRes`, adattando le tre letture nel frontend.
- **Se non lo facciamo:** Un campo nuovo compare in una risposta e sparisce da un'altra senza errori, e restano due forme diverse di lista paginata (default 25 invece dei 20 della config).
- **Prove:** Dati del workflow con verifica (tutte le voci confermate, «slug» provato con bun -e: Elysia scarta il campo; stima corretta da −120 a −85) più rilettura a HEAD dei punti citati, dove gli schemi d'errore uguali in responses.ts:39-106 risultano 8, non 7.

#### A5. Import CSV: controllo colonne e «file vuoto» copiati in cinque punti

**Dove:** `apps/api/src/lib/utils/csv.ts:14-87`, `apps/api/src/modules/admin/services/category-import.ts:9-12`, `apps/api/src/modules/admin/services/category-import.ts:24-33`, `apps/api/src/modules/admin/services/category-import.ts:45-47`, `apps/api/src/modules/admin/services/category-import.ts:190-192`, `apps/api/src/modules/admin/services/characteristic-import.ts:22-36`, `apps/api/src/modules/admin/services/characteristic-import.ts:81-83`, `apps/api/src/modules/admin/services/characteristic-import.ts:427-429`, `apps/api/src/modules/seller/services/product-import.ts:66-77`

**Gruppo:** utile ma non urgente · **Righe:** −35

- **Cos'è:** Ogni import CSV (categorie prodotto e negozio, dizionario e matrice delle caratteristiche, prodotti del seller) legge il file con `parseCsv`, poi controlla le colonne obbligatorie e che ci sia almeno una riga.
- **Problema:** `assertHeaders` è scritta uguale in due file e rifatta come ciclo nel terzo, e il controllo «nessuna riga» è ripetuto 5 volte con lo stesso messaggio. Caso: in #220 la traduzione in italiano di questi due messaggi è stata fatta a mano su 6 copie, in tre file.
- **Correzione:** Dare a `parseCsv` un secondo argomento facoltativo con le colonne obbligatorie, e lanciare lì i due errori 400. Poi cancellare le due `assertHeaders`, il ciclo di product-import, i cinque controlli e il secondo `ImportError` uguale.
- **Se non lo facciamo:** Ogni ritocco a messaggi o regole sulle colonne va fatto in cinque punti, e un import nuovo ricopia il blocco.
- **Prove:** Dati del workflow (confermato) più rilettura a HEAD dei cinque punti e di `git show f0f128b`, che traduce le 3 copie del controllo colonne e 3 dei 5 «nessuna riga» (gli altri 2 sono nati già in italiano in #185); con l'argomento facoltativo csv.test.ts e il validatore del seed non cambiano.

### 4.3 Test e CI (T)

**Da correggere**

#### T1. Svuotare orari o sito del negozio (bug #93) non ha test nel seller

**Dove:** `apps/seller/src/features/stores/components/store-form.tsx:221-243`, `apps/seller/src/routes/_authenticated/store/index.tsx:113`, `packages/ui/src/custom/personal-info-card.tsx:113`, `apps/customer/src/features/profile/personal-info-form.tsx:65-67`

**Gruppo:** da correggere · **Righe:** +22 (test)

- **Cos'è:** Quando il form negozio salva, «tutti i giorni chiusi» e «sito cancellato» devono partire come `null` (store-form.tsx:229 e 232). Un valore `undefined` sparisce dal JSON e il server non vede la modifica.
- **Problema:** Questo errore è già successo (orari e sito in #93, data di nascita in #94), ma i test ci sono solo nell'API e nessuno controlla la conversione dentro `onFormSubmit`. Caso: se un refactor (riscrittura del codice che non deve cambiare cosa fa) manda `undefined`, il venditore chiude tutti i giorni e salva, il toast (l'avviso a comparsa) dice «salvato», ma il server tiene i vecchi orari e i clienti vedono «Aperto» un negozio chiuso.
- **Correzione:** Sposta il blocco `cleaned` di `onFormSubmit` in una funzione pura `toStorePayload(data, openingHours)` in `features/stores/lib/`, come `checkout-progress.ts`. Test: con `openingHours = []` e sito vuoto, `JSON.parse(JSON.stringify(toStorePayload(...)))` contiene ancora `openingHours: null` e `websiteUrl: null`.
- **Se non lo facciamo:** Basta un refactor dell'invio del form per perdere di nuovo, in silenzio, la cancellazione di orari o sito. Lo scoprono i clienti davanti al negozio chiuso.
- **Prove:** Dati del workflow (righe corrette: 54-63 e 182-185 sono il controllo delle modifiche di #73, non il null) più rilettura a HEAD: la route manda il risultato così com'è (store/index.tsx:113) e nessun test del seller cita StoreForm.

**Utile ma non urgente**

#### T2. Test «solo titolare»: stesso server di prova in 7 file, logger muto in 18

**Dove:** `apps/api/tests/modules/seller-billing-owner-only.test.ts:1-57`, `apps/api/tests/modules/seller-checkout-owner-only.test.ts:1-82`, `apps/api/tests/modules/seller-closures-owner-only.test.ts:1-49`, `apps/api/tests/modules/seller-discounts-owner-only.test.ts:1-42`, `apps/api/tests/modules/seller-employees-owner-only.test.ts:1-82`, `apps/api/tests/modules/seller-settings-owner-only.test.ts:1-105`, `apps/api/tests/modules/seller-stores-owner-only.test.ts:1-81`, `apps/api/tests/plugins/error-handler.test.ts:11-18`, `apps/api/tests/plugins/rate-limit.test.ts:5-12`

**Gruppo:** utile ma non urgente · **Righe:** −400

- **Cos'è:** I file tests/modules/seller-*-owner-only controllano che le route del venditore rispondano 403 (vietato) a chi non è titolare. Ognuno monta un piccolo server di prova con un logger muto (`noopPino`) e una funzione `call()`.
- **Problema:** Server di prova e `call()` sono uguali nei 7 file (498 righe, 34 casi 403 e 3 casi 422), e `noopPino` è copiato in 18 file. Caso: in #192 sono nati 5 di questi file insieme, ognuno con le stesse 25 righe circa di impalcatura; una route nuova in un modulo già coperto invece costa solo un `it()` di 4 righe.
- **Correzione:** Mettere `noopPino` e `jsonRequest()` in tests/helpers/http.ts. Fondere i 7 file in uno con una tabella (route, metodo, percorso, body) e un ciclo `for` che crea un `it()` per riga con i nomi di oggi e un server per modulo; i 3 casi 422 restano test a parte. Se fai anche il n. 8, i suoi 8 casi mancanti diventano righe della tabella.
- **Se non lo facciamo:** Ogni modulo nuovo ricopia l'impalcatura e ogni test che monta una route ricopia `noopPino`: solo righe in più, nessun rischio sul codice.
- **Prove:** Dati del workflow con verifica (declassato a «utile ma non urgente»: i 7 commit su questi file aggiungono solo casi e non cambiano mai l'impalcatura; `it.each` con `%p` scartato perché stampa l'oggetto Elysia nel nome del test) più riconteggio a HEAD di righe, casi, copie di `noopPino` e dei commit che hanno creato i file.

#### T3. La fixture dell'abbonamento accetta solo lo stato, così 11 test scrivono l'insert a mano

**Dove:** `apps/api/tests/helpers/fixtures.ts:485-504`, `apps/api/tests/integration/seller-stores-cancel.test.ts:63-76`, `apps/api/tests/integration/job-auto-cancel-suspended.test.ts:70-95`, `apps/api/tests/integration/job-auto-cancel-suspended.test.ts:116-128`, `apps/api/tests/integration/seller-stores-archived.test.ts:57-68`, `apps/api/tests/integration/admin-billing-overview.test.ts:50-61`, `apps/api/tests/integration/seller-billing-summary.test.ts:55-66`, `apps/api/tests/integration/seller-stores-reactivation.test.ts:134-149`, `apps/api/tests/integration/stripe-webhook-checkout-completed.test.ts:292-303`, `apps/api/tests/integration/stripe-webhook-subscription-lifecycle.test.ts:61-73`, `apps/api/tests/integration/stripe-webhook-billing-emails.test.ts:84-97`, `apps/api/tests/integration/stripe-webhook-invoice.test.ts:64-77`

**Gruppo:** utile ma non urgente · **Righe:** −90

- **Cos'è:** `createTestStoreSubscription` è la fixture (funzione che crea dati di prova) per una riga di abbonamento. Oggi si può scegliere solo `status`.
- **Problema:** Chi ha bisogno di un id Stripe fisso, una quota o una data di sospensione riscrive tutto l'insert: 11 volte in 10 file, quasi sempre con cus_FAKE, price_FAKE e 2900. Caso: se store_subscriptions riceve una colonna obbligatoria nuova, la fixture si sistema in un punto, ma questi 11 insert vanno corretti uno per uno.
- **Correzione:** Far accettare alla fixture `Partial<typeof storeSubscription.$inferInsert>`, sparso dopo i valori di default come fa già `seed` in stripe-webhook-billing-emails.test.ts, e sostituire gli 11 insert passando solo i valori che il test controlla (id fissi, quota, price_OLD). `currency: "EUR"` si toglie: è già il default della colonna.
- **Se non lo facciamo:** Ogni nuovo test sugli abbonamenti ricopia altre 12 righe, e una colonna nuova costa 11 correzioni.
- **Prove:** Dati del workflow (confermato: nessuno dei 10 file usa la fixture, e l'unico chiamante che passa uno `status` che può mancare, admin-stores.test.ts:94, è protetto da `if (status)`) più riconteggio a HEAD degli 11 insert e del default di `currency` (apps/api/src/db/schemas/store-subscription.ts:38).

#### T4. Test: una funzione per catturare gli errori ricopiata in 4 file

**Dove:** `apps/api/tests/integration/admin-category-characteristics.test.ts:58-66`, `apps/api/tests/integration/admin-product-characteristics.test.ts:60-68`, `apps/api/tests/integration/seller-product-characteristics.test.ts:70-78`, `apps/api/tests/integration/admin-sellers.test.ts:87-97`, `apps/api/tests/integration/admin-category-characteristics.test.ts:163-165`

**Gruppo:** utile ma non urgente · **Righe:** −70

- **Cos'è:** `caught()` esegue una chiamata che deve fallire e restituisce l'errore, così il test legge `err.status` o `err.message`.
- **Problema:** bun:test lo fa già con `rejects.toMatchObject`, usato 115 volte nella suite, eppure `caught()` è copiata identica in 3 file più una variante (`expectServiceError`), con 28 chiamate. Caso: in admin-category-characteristics.test.ts:163-165 tre righe con `caught()` diventano `await expect(listCategoryCharacteristics("missing")).rejects.toMatchObject({ status: 404 })`.
- **Correzione:** Usare `rejects.toMatchObject` nelle 28 chiamate e cancellare le 4 definizioni. La copia per funzioni sincrone in characteristic-impact.test.ts:215 può restare.
- **Se non lo facciamo:** Il prossimo file di test ne farà un'altra copia: solo righe in più.
- **Prove:** Dati del workflow con verifica (25 chiamate a `caught` e 3 a `expectServiceError`, tutti servizi async, quindi `.rejects` si comporta uguale; stima corretta da −40 a −70) più rilettura a HEAD delle 4 definizioni e conteggio di `rejects.toMatchObject`.

#### T5. Sette test di @bibs/ui stanno nelle app

**Dove:** `apps/customer/src/lib/cooldown.test.ts:1-59`, `apps/customer/src/lib/intl-locale.test.ts:1-56`, `apps/customer/src/lib/query-retry.test.ts:1-17`, `apps/seller/src/lib/display-name.test.ts:1-28`, `apps/seller/src/lib/pagination-search.test.ts:1-50`, `apps/admin/src/components/locale-toggle.test.tsx:1-67`, `apps/admin/src/components/tab-nav.test.tsx:1-77`, `package.json:21`

**Gruppo:** utile ma non urgente · **Righe:** 0

- **Cos'è:** Sette file di test nelle app (354 righe) provano solo codice di packages/ui: useCooldown, intlLocale, query-retry, displayName, parsePaginationSearch, LocaleToggle e TabNav. packages/ui ha solo altri 5 test.
- **Problema:** Chi modifica @bibs/ui e lancia i test del pacchetto non li esegue. Esempio: cambi parsePaginationSearch, lanci bun run --filter @bibs/ui test ed è tutto verde, ma il test di quella funzione sta in apps/seller e non è partito.
- **Correzione:** Sposta i 7 file accanto al loro codice in packages/ui/src e scrivi gli import come relativi o con ~/ invece di @bibs/ui/...: la config Vitest è la stessa e jsdom (un finto browser per i test) e Testing Library ci sono già. Nel trasloco puoi togliere da intl-locale.test.ts il caso «—», già coperto da price.test.ts.
- **Se non lo facciamo:** L'errore si vede solo col giro completo dei test. In CI la catena di package.json:21 esegue ui prima dell'API e il seller per ultimo, quindi oggi un errore di ui arriva minuti dopo. In CI questa attesa sparisce già con il n. 12.
- **Prove:** Trovato da due agenti e confermato da due verifiche; a HEAD ho riletto gli import dei 7 file (solo @bibs/ui, ~/ e vitest), i 5 test di packages/ui, la config condivisa vitest.base.ts e l'ordine dei test in package.json:21.

#### T6. Il passaggio dei messaggi d'errore dall'API ai toast (unwrap) non ha test

**Dove:** `packages/ui/src/lib/api-client.ts:50-81`, `apps/seller/src/routes/invite.$token.tsx:54-61`, `apps/customer/src/features/cart/use-cart.ts:50-59`

**Gruppo:** utile ma non urgente · **Righe:** +39 (test)

- **Cos'è:** `unwrap`, in @bibs/ui, apre le risposte dell'API nelle tre app (116 chiamate in 58 file). Se c'è un errore lancia il testo del server, letto da `edenMessage`, insieme allo status HTTP (il codice della risposta, come 400 o 404); altrimenti restituisce i dati.
- **Problema:** Nessun test chiama `unwrap` o `edenMessage`: lo status è già controllato di riflesso dal test del 404 in product-detail-api.test.ts, il testo del server no. Caso: oggi «Aggiungi» oltre la scorta riceve un 400 con «Ne restano solo 3» e il toast (l'avviso a comparsa) lo mostra; se un aggiornamento di Eden (il client HTTP delle app) sposta il corpo dell'errore, il toast dice «Qualcosa è andato storto. Riprova.» e i test restano verdi.
- **Correzione:** Scrivi `packages/ui/src/lib/api-client.test.ts` (il pacchetto ha già Vitest ed Eden): client Eden vero con un fetch finto che risponde 400 con `message: "Ne restano solo 3"`; `unwrap` deve lanciare un `ApiError` con quel testo e status 400, e senza `message` il testo di riserva. In invite.$token.tsx:55-59 usa `edenMessage(response.error) ?? m.auth_invite_create_error()` al posto della copia a mano.
- **Se non lo facciamo:** Un aggiornamento di Eden può spegnere tutti i messaggi d'errore utili (scorte, permessi, conflitti), e se ne accorgono gli utenti invece della CI.
- **Prove:** Dati del workflow (gruppo abbassato a «utile ma non urgente») più rilettura a HEAD: nessun file di test dei frontend cita unwrap o edenMessage; ho corretto il caso concreto, perché «Ne restano solo N» è un 400 (apps/api/src/modules/customer/services/cart.ts:36-43) e non un 409, e la stima, misurata su una bozza del test formattata con Biome.

#### T7. La cella delle scorte (correzione di #211) non ha test

**Dove:** `apps/seller/src/features/products/components/stock-editor-cell.tsx:51-147`, `apps/seller/src/features/products/components/stock-editor-cell.tsx:149`, `apps/seller/package.json:54-66`

**Gruppo:** utile ma non urgente · **Righe:** +55 (test)

- **Cos'è:** È la casella +/− delle scorte nella lista prodotti del venditore: somma i clic per mezzo secondo e poi manda la differenza. Un numero scritto a mano manda il valore esatto, ma prima aspetta che la differenza già partita arrivi (correzione di #211).
- **Problema:** Questa logica (timer, richiesta in corso, invio quando la cella sparisce) non ha test, e il seller non ha Testing Library (la libreria che simula clic e tasti nei test). Caso: scorta 5, due clic su +, poi scrivi subito 10 ed esci dalla casella mentre il +2 è in viaggio; se l'attesa di #211 si perde, il 10 può arrivare prima del +2 e il server finisce a 12.
- **Correzione:** Aggiungi al seller `@testing-library/react`, `@testing-library/dom` e `jsdom` (un browser finto per i test) dal catalog, come l'admin. In `stock-editor-cell.test.tsx`, con orologio finto e `useStockAdjustMutation` finto: due clic, «10» scritto, 500 ms avanti, uscita dalla casella; `set` deve partire solo a +2 finito, con stock 10.
- **Se non lo facciamo:** Un ritocco alla cella può riportare scorte sbagliate senza che la CI se ne accorga. Il rischio è basso: durante la richiesta casella e bottoni sono disabilitati, e il numero sbagliato si vedrebbe nella cella.
- **Prove:** Dati del workflow (il caso «scrivo 10 e premo Invio durante la richiesta» non si può fare perché la casella è disabilitata, quindi gruppo abbassato a «utile ma non urgente») più rilettura a HEAD: `busy` alla riga 149 disabilita i controlli, nessun test cita StockEditorCell e apps/seller/package.json:54-66 non ha Testing Library né jsdom.

#### T8. Il prezzo «9» che diventa «9.00» (bug #78) non ha test

**Dove:** `apps/seller/src/features/products/components/product-form.tsx:343-347`, `apps/seller/src/features/products/lib/product-form-schema.ts:4-17`, `apps/api/src/lib/schemas/forms/products.ts:53-57`

**Gruppo:** utile ma non urgente · **Righe:** +21 (test)

- **Cos'è:** Nel form prodotto il venditore può scrivere «9» o «9.9». Prima dell'invio il form lo trasforma in «9.00» o «9.90», l'unico formato che l'API accetta.
- **Problema:** La regola è divisa in due: lo schema del form (le regole che il form controlla) accetta da 0 a 2 decimali, e 3 righe nell'invio portano il prezzo a 2 decimali. Nessun test le esegue; con #78 il form usava lo schema dell'API e rifiutava i prezzi interi. Caso: se qualcuno rimette lo schema dell'API nel form, «9» viene rifiutato; se si perdono le 3 righe, l'API risponde 422 (dato non valido) e il prodotto non si salva.
- **Correzione:** Sposta le 3 righe in `product-form-schema.ts` come `toApiPrice(price)`. Test: lo schema del form accetta «9», «9.9» e «9.99», e il risultato di `toApiPrice` passa la regola del formato di `CreateProductBody.properties.price`.
- **Se non lo facciamo:** Un ritocco al form può bloccare di nuovo i prezzi interi. L'errore però si vede al primo salvataggio e nessun prezzo sbagliato finisce nel database.
- **Prove:** Dati del workflow (storia di #78 confermata, gruppo abbassato a «utile ma non urgente» perché tutte e due le rotture si vedono subito) più rilettura a HEAD: conversione a product-form.tsx:345-347, regola larga a product-form-schema.ts:12-16, e typebox-errors.test.ts:193 raccoglie solo i testi d'errore.

#### T9. La modifica delle categorie admin che salvava il nome vecchio (#243) non ha test

**Dove:** `apps/admin/src/features/product-categories/components/product-category-form.tsx:42-52`, `apps/admin/src/features/store-categories/components/store-category-form.tsx:42-52`, `apps/admin/src/features/store-macro-categories/components/store-macro-category-form.tsx:29-39`, `apps/admin/src/features/crud/category-crud-panel.tsx:441-454`

**Gruppo:** utile ma non urgente · **Righe:** +35 (test)

- **Cos'è:** Sono i form di modifica di categorie prodotto, categorie negozio e macro categorie negozio nell'admin. Il pannello comune, ogni volta che si ridisegna, passa ai form un oggetto nuovo con i valori di partenza (category-crud-panel.tsx:443).
- **Problema:** Fino a #243 un `reset` dentro un effetto (codice che React esegue dopo aver disegnato) riscriveva i campi prima del salvataggio; l'effetto è stato tolto e ora lo ricorda solo un commento, senza test. Caso: l'admin apre «Panetteria», scrive «Panificio» e salva; se qualcuno rimette l'effetto, riparte «Panetteria» e un nome svuotato non dà più errore.
- **Correzione:** Scrivi `category-forms.test.tsx` (jsdom) con `it.each` sui tre form (due, se fai prima F3): mostra il form con `{ name: "Panetteria", … }`, scrivi «Panificio», ridisegnalo con un oggetto nuovo (`rerender`) e premi Salva; `onSubmit` deve ricevere «Panificio». L'admin ha già Testing Library.
- **Se non lo facciamo:** Le modifiche dell'admin possono tornare a perdersi. Si nota però subito, perché la lista resta col nome vecchio.
- **Prove:** Dati del workflow (gruppo abbassato a «utile ma non urgente»: azione rara e rottura visibile) più rilettura a HEAD: i tre form hanno solo il commento contro l'effetto (righe 42-44, 42-44 e 29-31), nessun test li mostra, e 9 file di test dell'admin usano già @testing-library/react.

#### T10. Nessun controllo in CI che le migrazioni seguano lo schema Drizzle

**Dove:** `.github/workflows/ci.yml:33-44`, `apps/api/drizzle.config.ts:1-11`, `apps/api/tests/helpers/test-db.ts:87-90`, `apps/api/package.json:12`

**Gruppo:** utile ma non urgente · **Righe:** +6

- **Cos'è:** Lo schema Drizzle (src/db/schemas) descrive le tabelle nel codice; le migrazioni (src/db/migrations) sono i file SQL che le creano davvero. `db:generate` scrive una migrazione nuova quando i due non coincidono.
- **Problema:** La CI non lancia mai `db:generate`, e i test applicano gli SQL veri: una colonna mancante si vede, un indice, un CHECK o un `onDelete` dimenticati no. Caso: aggiungi un indice in schemas/order.ts senza rigenerare; test e CI restano verdi, l'indice non c'è nel database, e il prossimo `db:generate` di un'altra PR lo infila nella sua migrazione.
- **Correzione:** Un passo nel job typecheck, in apps/api: `DATABASE_URL=postgres://unused bun run db:generate && test -z "$(git status --porcelain src/db/migrations)"`. È il controllo fatto a mano nella #254 («drizzle-kit generate non trova drift»), e generate non si collega al database.
- **Se non lo facciamo:** Un indice o un vincolo dimenticato resta fuori dal database finché un'altra PR non rilancia `db:generate`. L'app non è in produzione, quindi oggi il danno è basso.
- **Prove:** Dati del workflow con verifica (declassato a «utile ma non urgente»: nessun incidente, le 14 PR che dal 16/06 toccano gli schemi avevano tutte la migrazione) più rilettura a HEAD di ci.yml, drizzle.config.ts, test-db.ts e degli import degli schemi (nessuno porta a env.ts); `db:generate` non eseguito.

#### T11. Nessun test nel browser: per ora niente Playwright, test di componente sui form di modifica

**Dove:** `apps/admin/src/features/product-categories/components/product-category-form.tsx:42-52`, `apps/admin/src/features/store-categories/components/store-category-form.tsx:42-52`, `apps/admin/src/features/store-macro-categories/components/store-macro-category-form.tsx:29-39`, `apps/admin/src/features/crud/category-crud-panel.tsx:441-454`, `apps/admin/src/features/auth/components/login-form.test.tsx:21-33`, `.github/workflows/ci.yml:1-131`

**Gruppo:** utile ma non urgente · **Righe:** 0 (il primo test è quello di T9)

- **Cos'è:** Un test E2E (end-to-end) apre un browser vero e rifà i passi di un utente. Nel repo non ce n'è nessuno (niente Playwright né Cypress) e nessuna delle 75 pagine dei tre frontend ha un test: la UI la controlla lo smoke manuale prima della PR.
- **Problema:** I bug di UI già corretti e citati in questo report (#78, #93, #94, #211, #243) stavano in form e componenti, non nel percorso d'acquisto. Caso: nell'admin la modifica di una categoria salvava il nome vecchio, perché il pannello passa un oggetto defaultValues nuovo a ogni render e un `useEffect` con `reset(defaultValues)` riscriveva il campo prima del salvataggio; è rimasto su main per mesi ed è stato corretto in #243.
- **Correzione:** Niente Playwright per ora: per il percorso d'acquisto resta lo smoke manuale. Quando tocchi un form di modifica, aggiungi un test Vitest + Testing Library come login-form.test.tsx dell'admin: render con defaultValues, cambia il valore, rifai il render con un nuovo oggetto defaultValues come fa il pannello, invia e controlla cosa riceve onSubmit.
- **Se non lo facciamo:** Un bug come quello del nome vecchio può restare su main finché qualcuno non rifà a mano proprio quel percorso.
- **Prove:** Dati del workflow con verifica (Playwright scartato: il bug era nei dialog dell'admin, il checkout è già provato via HTTP lato API, e per carrello e checkout non risulta nessuna regressione arrivata su main) più controllo a HEAD (git ls-files non trova playwright, cypress o e2e; 75 route senza test; il `reset` tolto in #243); il test rifà il render con un nuovo defaultValues perché con un render solo il bug non si riproduce.

## 5. Problemi visti di passaggio, verificati dopo

Durante l'audit alcuni agenti hanno notato problemi fuori dal loro tema. Dopo il report in chat sono stati verificati uno per uno, provando a smentirli: 7 da correggere, 12 utili, 3 veri ma da lasciare, 1 smentito.

#### P1. Un salvataggio fallito toglie l'indirizzo predefinito

**Dove:** `apps/api/src/modules/customer/services/addresses.ts:145-168`, `apps/customer/src/features/addresses/address-form-dialog.tsx:114-123`, `apps/customer/src/features/addresses/use-address-mutations.ts:32-44`, `apps/api/tests/integration/customer-addresses.test.ts:249-268`

**Gruppo:** da correggere · **Verdetto:** parziale · **Righe:** circa +20 (1 riga spostata nel servizio, più un test nuovo)

- **Cos'è:** È la rubrica indirizzi del cliente, nel profilo. Un indirizzo può essere «predefinito»: da lì parte la ricerca dei negozi vicini quando non c'è un'altra scelta salvata. Se salvi un indirizzo con «Predefinito» acceso, l'API prima toglie il segno a tutti gli indirizzi del cliente. Poi lo mette su quello salvato.
- **Problema:** L'API toglie il segno a tutti prima di sapere se l'indirizzo esiste ancora. Se non esiste, risponde 404 (non trovato). Però la transazione (un gruppo di scritture che riesce o si annulla tutto insieme) si è già chiusa con successo, quindi il segno tolto resta. Caso concreto, con il profilo aperto in due schede. «Casa» è predefinito. Nella scheda A apri «Modifica» su «Ufficio» e accendi «Predefinito». Nella scheda B elimini «Ufficio». Torni alla scheda A e premi «Salva». Compare il toast «Indirizzo non trovato» e da quel momento nessun indirizzo è predefinito. Su un dispositivo nuovo la ricerca parte senza origine invece che da «Casa» (bootChoice, apps/customer/src/features/location/search-origin-state.ts:94-109). Il form non c'entra: address-form-state.ts manda solo i valori del form. Con una scheda sola il caso non si presenta.
- **Correzione:** In updateAddress sposta il controllo dentro la transazione, subito dopo l'update: `if (!result) throw new ServiceError(404, "Indirizzo non trovato");`. Poi togli quello della riga 168. Un errore lanciato dentro db.transaction annulla anche l'azzeramento. In customer-addresses.test.ts aggiungi un caso: un 404 con isDefault: true lascia «Casa» predefinito.
- **Se non lo facciamo:** Una richiesta che fallisce cambia comunque i dati. Il cliente perde il predefinito senza accorgersene e deve rimetterlo a mano.
- **Prove:** Ho letto a HEAD tutto il flusso. In address-form-state.ts, addressFormToBody (righe 153-164) manda i valori del form e nessun id. address-form-dialog.tsx:114-123 fa il PATCH con address.id, preso dalla card all'apertura (address-book.tsx:28-31 e 108-113). In use-address-mutations.ts:32-44 l'onError mostra solo il toast. In services/addresses.ts:145-168 il 404 viene lanciato alla riga 168, fuori da db.transaction. Esiste anche l'indice unico parziale customer_address_single_default_idx (db/schemas/address.ts:48-50). Ho scritto lo script scratchpad/verify-passing/addr-default.test.ts e l'ho lanciato da apps/api con bun test sul container di test bibs-postgis-test. Lo script crea «Casa» (predefinito) e «Ufficio», elimina «Ufficio», poi chiama il vero updateAddress su «Ufficio» con isDefault: true. Risultato: «status: 404 | casa.isDefault dopo: false». Controllo: lo stesso 404 senza isDefault dà «casa.isDefault: true». Ho provato anche una copia del servizio con il throw dentro la transazione: dà «404 | casa.isDefault: true», quindi la correzione funziona. Il test esistente (customer-addresses.test.ts:249-268) prova il 404 solo con label e non vede il problema. C'è anche una variante: la scheda A risalva isDefault: true dopo che la scheda B ha spostato il predefinito. Quella non la conto: vince l'ultimo salvataggio, come per gli altri campi.

#### P2. Invito annullato, ma il collaboratore entra lo stesso

**Dove:** `apps/api/src/modules/seller/services/employees.ts:266-281`, `apps/api/src/modules/registration/services.ts:250-255`, `apps/api/src/modules/registration/services.ts:280-282`, `apps/api/src/modules/registration/services.ts:324-327`

**Gruppo:** da correggere · **Verdetto:** confermato · **Righe:** +10 circa

- **Cos'è:** Il titolare annulla un invito con cancelInvitation. L'invitato lo accetta con acceptInvite: sceglie la password e nascono l'utente, il dipendente e i suoi negozi.
- **Problema:** Né l'annullamento né l'accettazione scrivono con status = 'pending' nella condizione (WHERE). Caso: il titolare annulla mentre l'invitato conferma la password. L'accettazione ha già letto «pending» e impiega circa 50 ms a creare l'account: il titolare legge «Invito annullato», ma il dipendente nasce attivo e accede ai negozi. Può succedere anche al contrario: l'annullamento legge l'invito, l'accettazione finisce, poi l'annullamento lo segna come scaduto. Questa finestra è più piccola.
- **Correzione:** In acceptInvite metti come prima istruzione della transazione l'UPDATE ad accepted, con status = 'pending' nel WHERE e .returning(). Se torna vuoto lancia 409: provisionOrRollback cancella l'utente appena creato. In cancelInvitation aggiungi status = 'pending' al WHERE e lancia 404 se non torna niente.
- **Se non lo facciamo:** Succede di rado, ma una persona esclusa dal titolare vede ordini e dati dei negozi, e il titolare crede di averla fermata. Si rimedia solo se lui nota il nuovo dipendente e lo sospende.
- **Prove:** Letto a HEAD. employees.ts:266-273 legge l'invito con status pending, poi :277-281 fa UPDATE set expired con where(eq(id)) e basta. registration/services.ts:250-255 legge pending, :280-282 chiama auth.api.signUpEmail, :324-327 fa UPDATE set accepted con where(eq(id)) e basta. L'accesso dipende solo da store_employees.status, che di default è 'active' (db/schemas/employee.ts:31-33). Dopo l'accettazione l'invito non conta più: employeeInvitation è usato solo in employees.ts, registration/services.ts e nel seed. Lo script scratchpad/race/scrypt-time.ts misura l'hash della password di better-auth (scrypt N=16384, r=16, da @better-auth/utils): 49-57 ms su questo Mac. Quindi la finestra di acceptInvite dura circa 50 ms, mentre quella di cancelInvitation è una sola lettura. provisionOrRollback (services.ts:69-88) cancella l'utente se la transazione lancia. Niente test di concorrenza: il testcontainer (il Postgres in Docker dei test) serializza le transazioni, cioè le esegue una alla volta.

#### P3. Eliminazione definitiva: può cancellare un prodotto appena ripristinato

**Dove:** `apps/api/src/modules/seller/services/products.ts:1164-1175`, `apps/api/src/modules/seller/services/products.ts:1123-1160`, `apps/api/src/modules/seller/services/products.ts:830-843`, `apps/api/src/modules/seller/services/products.ts:820-822`, `apps/api/src/modules/seller/services/products.ts:947-952`

**Gruppo:** da correggere · **Verdetto:** confermato · **Righe:** +7 circa (+1 in deleteProduct, +6 in bulkDeletePermanent, togliendo la transazione inutile intorno a una sola DELETE)

- **Cos'è:** È «Elimina definitivamente» nel cestino dei prodotti. Prima controlla che il prodotto sia nel cestino, poi lo cancella dal database e cancella le sue foto su S3 (lo spazio dove teniamo i file).
- **Problema:** La DELETE (il comando che cancella la riga) non ripete la condizione «nel cestino». Caso: il titolare preme «Elimina definitivamente» e un dipendente, nello stesso momento, preme «Ripristina» sullo stesso prodotto. Se il ripristino cade tra il controllo e la DELETE (pochi millisecondi), il dipendente legge «ripristinato», ma il prodotto sparisce lo stesso, con foto, scorte e storico.
- **Correzione:** In bulkDeletePermanent metti eq(product.status, "trashed") nella condizione (WHERE) della DELETE e aggiungi .returning({ id }). Poi cancella da S3 solo le foto dei prodotti cancellati davvero e metti gli altri in failed come not_in_trash. In deleteProduct basta la stessa condizione, perché il 404 c'è già.
- **Se non lo facciamo:** Succede di rado, ma la perdita è definitiva: prodotto, foto e storico non tornano più.
- **Prove:** Letto a HEAD. products.ts:820 rifiuta se status !== 'trashed', poi :830-838 fa la DELETE con solo id e sellerProfileId. bulkDeletePermanent legge stato e accesso a :1124-1146, fa la DELETE a :1170-1172 con solo inArray(product.id, toDelete) e a :1175 cancella le foto su S3. Anche il ripristino scrive senza condizione sullo stato: updateProductStatus :948-952 e bulkUpdateProductStatus :1057-1059. Isolamento di default (READ COMMITTED), nessun FOR UPDATE su questi percorsi, nessun trigger in migrations/0000_init.sql. Le FK verso products sono CASCADE (store_products, product_images, discount_products, product_audit_log, valori delle caratteristiche) e SET NULL su order_items, quindi la DELETE riesce sempre. Una scheda vecchia è già coperta: il controllo legge lo stato attuale e risponde 409 o not_in_trash. Resta solo la gara vera. Il seller chiama solo bulk/delete-permanent (apps/seller/src/features/products/hooks/use-product-mutations.ts:98). La route singola (routes/products.ts:608-616) non ha chiamanti nel frontend: se il n. 14 la toglie, resta solo bulkDeletePermanent. Non ho riprodotto la gara su un database: il testcontainer serializza le transazioni.

#### P4. Sei pagine del seller mettono tutti i comuni dentro l'HTML

**Dove:** `apps/seller/src/routes/_authenticated/profile.tsx:10-11`, `apps/seller/src/routes/_authenticated/onboarding/personal-info.tsx:35-36`, `apps/seller/src/routes/_authenticated/onboarding/document.tsx:36-37`, `apps/seller/src/routes/_authenticated/onboarding/company.tsx:35-36`, `apps/seller/src/routes/_authenticated/store/index.tsx:31-32`, `apps/seller/src/routes/_authenticated/store/new.tsx:46-47`, `apps/seller/src/hooks/use-municipalities.ts:6-20`, `apps/seller/src/routes/_authenticated.tsx:36-38`, `apps/seller/src/routes/_authenticated.tsx:91-100`, `packages/ui/src/integrations/tanstack-query/root-provider.tsx:17-20`

**Gruppo:** da correggere · **Verdetto:** confermato · **Righe:** +6 (una riga `ssr: false` per route)

- **Cos'è:** Il loader è la funzione che una route esegue prima di mostrare la pagina. In queste 6 route mette nella cache delle query (la memoria di TanStack Query) la lista di tutti i 7.904 comuni, che serve al campo «Comune» dei form. Se si arriva da un link interno, il loader gira nel browser e va bene. Al primo caricamento (F5 o link diretto) gira anche sul server, nell'SSR (il server prepara l'HTML della pagina).
- **Problema:** Sul server la cache è nuova a ogni richiesta e non arriva mai al browser. In più il loader restituisce la lista, e TanStack Router copia nell'HTML tutto quello che un loader restituisce. Nessuno usa quella copia: i form leggono i comuni con useQuery. Intanto sul server il layout _authenticated mostra solo lo spinner, perché la sessione si legge nel browser. Caso concreto: apro /profile con F5, anche senza login. L'HTML pesa 738 KB invece dei 4,5 KB di /orders, con dentro tutti i 7.904 comuni. Poi il browser chiede di nuovo la lista all'API.
- **Correzione:** Aggiungi `ssr: false` alle 6 route. È un'opzione di TanStack Router: loader e pagina girano solo nel browser. Sul server la pagina era già solo uno spinner, quindi non si perde niente. Nel browser il loader riempie la cache e i form la usano subito. Da verificare dopo: le 6 pagine senza comuni nell'HTML e il campo «Comune» già pieno all'apertura.
- **Se non lo facciamo:** Ogni F5 o link diretto su queste pagine, onboarding compreso, scarica circa 730 KB in più e fa una query da 7.904 righe sul server. Con pochi utenti regge, ma sul telefono la prima pagina di un nuovo venditore è lenta.
- **Prove:** Letture a HEAD: i 6 loader restituiscono `context.queryClient.ensureQueryData(municipalitiesQueryOptions())`. _authenticated.tsx:36-38 non ha beforeLoad; alle righe 91-100 mostra lo spinner finché la sessione è in attesa (better-auth 1.7.7, dist/client/session-atom.mjs:49-51: stato iniziale isPending true). root-provider.tsx:17-20 crea un QueryClient nuovo per ogni richiesta SSR. @tanstack/react-router-ssr-query è in apps/seller/package.json:38 ma nessun file lo importa. router-core 1.171.35: ssr-server.js:14-27 mette `loaderData` nell'HTML; load-client.js:1175 nel browser lo rimette nella route senza rieseguire il loader. I form usano useMunicipalities() (useQuery); nessuno usa useLoaderData. Misura con scratchpad/verify-passing/ssr-size.ts (GET senza cookie sul seller in dev, working tree pulito a 8b62c34): /profile, /store, /store/new e /onboarding/{company,document,personal-info} pesano 738 KB e contengono «provinceAcronym» 7.904 volte; /orders e /products pesano 4,5 KB. muni-size.ts: la risposta dell'API pesa 711 KB (241 KB compressa). La lista è pubblica (apps/api/src/modules/locations/routes/locations.ts:108-130), quindi non c'è fuga di dati. La correzione non è stata provata.

#### P5. I riquadri d'errore non vengono letti dallo screen reader

**Dove:** `apps/customer/src/routes/login.tsx:98`, `apps/customer/src/routes/register.tsx:134`, `apps/seller/src/features/auth/components/login-form.tsx:36`, `apps/seller/src/features/auth/components/register-form.tsx:45`, `apps/admin/src/features/auth/components/login-form.tsx:36`, `apps/seller/src/routes/invite.$token.tsx:104`, `apps/seller/src/routes/_authenticated/onboarding/personal-info.tsx:80`, `apps/seller/src/routes/_authenticated/onboarding/company.tsx:82`, `apps/seller/src/routes/_authenticated/onboarding/document.tsx:92`, `packages/ui/src/custom/personal-info-card.tsx:155`, `apps/seller/src/routes/_authenticated/team/index.tsx:262`, `apps/admin/src/features/csv-import/components/csv-import-dialog.tsx:164`, `apps/admin/src/routes/_authenticated/sellers/$sellerId.tsx:65`, `apps/admin/src/routes/_authenticated/sellers/index.tsx:372`, `apps/admin/src/routes/_authenticated/billing/index.tsx:30`, `apps/admin/src/routes/_authenticated/billing/pricing.tsx:91`, `apps/admin/src/routes/_authenticated/billing/subscriptions.tsx:159`, `apps/admin/src/routes/_authenticated/users.tsx:236`, `apps/admin/src/routes/_authenticated/stores.tsx:306`, `apps/admin/src/features/crud/category-crud-panel.tsx:351`, `apps/admin/src/features/holidays/components/holidays-panel.tsx:279`, `apps/seller/src/routes/_authenticated/store/closures.tsx:69`, `apps/seller/src/routes/_authenticated/store/index.tsx:154`, `apps/seller/src/routes/_authenticated/products/$productId.tsx:140`, `apps/seller/src/routes/_authenticated/products/index.tsx:636`, `apps/seller/src/routes/_authenticated/orders/index.tsx:296`, `apps/seller/src/routes/_authenticated/promotions/index.tsx:279`, `apps/seller/src/routes/_authenticated/team/index.tsx:798`

**Gruppo:** da correggere · **Verdetto:** confermato · **Righe:** circa +84 (28 attributi; Biome spezza ogni div su 4 righe)

- **Cos'è:** Nei tre frontend alcuni errori compaiono in un div rosso (classi bg-destructive/10 text-destructive), sopra il form o al posto della lista. Succede dopo un'azione (login, registrazione, invito, onboarding, salvataggio del profilo, import CSV) o quando un caricamento fallisce.
- **Problema:** Questi div non hanno role="alert", l'attributo che fa leggere subito il testo allo screen reader (il programma che legge lo schermo a chi non vede). Sono 28: 12 compaiono dopo un'azione, 16 quando una lista o una pagina non si carica. Nessuno di questi punti sposta il focus o mostra un toast. Caso concreto: un venditore che usa VoiceOver sbaglia la password su /login del seller e preme «Accedi». Compare «Credenziali non valide», ma il focus resta sul bottone e VoiceOver non dice niente. Gli errori dei singoli campi invece si sentono, perché FieldError ha già role="alert".
- **Correzione:** Aggiungi role="alert" ai 28 div, come fanno già personal-info-form.tsx:94 e pay-form.tsx:77 del customer. Parti dai primi 12 della lista, quelli che compaiono dopo un'azione.
- **Se non lo facciamo:** Chi usa uno screen reader preme «Accedi» o «Salva» e non sa che è andato male. Pensa che la pagina sia bloccata.
- **Prove:** Ho lanciato rg -n 'bg-destructive/10' apps/*/src packages/ui/src, togliendo hover:, focus: e i componenti generati (badge, button, menu, tab-nav). Risultato: 29 div d'errore. Solo apps/customer/src/features/profile/personal-info-form.tsx:94 ha role="alert". Gli altri 28 non hanno role. Non hanno nemmeno un contenitore aria-live intorno: le 6 aria-live del repo stanno in altri file. Nei file di login, registrazione, invito e onboarding: 0 chiamate a toast e 0 a .focus(). FieldError ha role="alert" (packages/ui/src/components/field.tsx:225). Ho controllato i div a campione: per esempio seller login-form.tsx:34-38 mostra apiError, admin users.tsx:235-240 mostra l'errore di caricamento. biome format su stdin: un div con role e className diventa di 4 righe.

#### P6. Il profilo del cliente può mostrare un errore in inglese

**Dove:** `apps/customer/src/features/profile/personal-info-form.tsx:70-73`, `apps/customer/src/lib/auth-error.ts:12-29`, `apps/seller/src/features/profile/components/personal-info-card.tsx:54-69`, `apps/admin/src/routes/_authenticated/profile.tsx:59-74`

**Gruppo:** da correggere · **Verdetto:** confermato · **Righe:** +1 (un import, più la riga 71 cambiata)

- **Cos'è:** Il form «Dati personali» del profilo cliente salva nome, cognome e data di nascita. Lo fa con authClient.updateUser di better-auth (la libreria che gestisce login e sessioni).
- **Problema:** Se better-auth risponde con un errore, il form mostra error.message così com'è, e better-auth scrive i messaggi in inglese. Seller e admin passano invece da authErrorMessage, che traduce dal codice dell'errore o usa un testo italiano di riserva. Caso concreto: il cliente reimposta la password dal telefono. La configurazione chiude tutte le altre sessioni (revokeSessionsOnPasswordReset). Sul PC la pagina profilo è ancora aperta e in primo piano. Il cliente cambia il cognome e preme «Salva»: il riquadro rosso dice «Unauthorized». Nel seller lo stesso caso mostra «Errore durante il salvataggio. Riprova.».
- **Correzione:** In personal-info-form.tsx:71 scrivi `setApiError(authErrorMessage(error, m.profile_error_update()))`. Importa authErrorMessage da @/lib/auth-error: nel customer il file c'è già e lo usano login e reset-password.
- **Se non lo facciamo:** In un caso raro il cliente legge una parola tecnica in inglese dentro una pagina in italiano.
- **Prove:** personal-info-form.tsx:71 contiene `setApiError(error.message ?? m.profile_error_update())`. In better-auth 1.7.7, dist/api/routes/update-user.mjs:13-17 usa sessionMiddleware, e dist/api/routes/session.mjs:292-297 lancia { message: "Unauthorized", code: "UNAUTHORIZED" }. In apps/api/src/lib/auth.ts:77 c'è revokeSessionsOnPasswordReset: true. Il client rilegge la sessione in due casi: quando la scheda torna visibile (dist/client/session-refresh.mjs:58-62, con una pausa di 5 secondi) o tramite BroadcastChannel nello stesso browser. Quindi non vede una sessione chiusa da un altro dispositivo prima del «Salva». Seller (personal-info-card.tsx:64-68) e admin (profile.tsx:69-73) usano authErrorMessage, con il commento «Il message di better-auth è in inglese». customer/src/lib/auth-error.ts:12-29 è già usato in login.tsx:58 e reset-password.tsx:63. Il limite generico di 100 richieste ogni 10 secondi su /update-user non si raggiunge a mano, quindi il 429 non è un caso reale.

#### P7. Il form di pagamento resta in italiano anche in inglese

**Dove:** `apps/customer/src/features/checkout/pay-form.tsx:27-34`, `apps/customer/src/features/checkout/pay-form.tsx:64-67`

**Gruppo:** da correggere · **Verdetto:** confermato · **Righe:** +1 (un import, più la riga 31 cambiata)

- **Cos'è:** Nel checkout del cliente, PayForm mostra il Payment Element di Stripe: il riquadro con i campi della carta, disegnato da Stripe. La lingua del riquadro si sceglie con l'opzione locale di Elements.
- **Problema:** locale è fisso a "it". Dal #224 il cliente può scegliere l'inglese dal menu utente, e la scelta resta in un cookie. Caso concreto: il cliente sceglie «English», mette un prodotto nel carrello e arriva al pagamento. Titolo, importo e bottone sono in inglese, ma le etichette dei campi della carta sono in italiano. Se la carta viene rifiutata, anche il messaggio di Stripe arriva in italiano: la riga 67 lo mostra così com'è.
- **Correzione:** Usa `locale: getLocale()` e importa getLocale da @/paraglide/runtime. Restituisce "it" o "en", e Stripe li accetta tutti e due.
- **Se non lo facciamo:** Chi usa l'app in inglese paga con un form in italiano. Legge in italiano anche il motivo di un pagamento rifiutato.
- **Prove:** pay-form.tsx:31 contiene `locale: "it"`. Alla riga 67, result.error.message di Stripe finisce nel paragrafo d'errore. Con git log ho visto che pay-form.tsx nasce nel #202 (28/09). Il #224 (b94fce3, 04/10) porta l'inglese e nella cartella checkout tocca solo pay.tsx. La specifica docs/superpowers/specs/2026-10-04-locale-en-cookie-design.md non nomina Stripe. vite.base.ts:39 imposta la strategia ["cookie", "baseLocale"], e LocaleSelect sta nel menu utente (apps/customer/src/components/user-menu.tsx:78). Il resto della pagina segue già la lingua: pay.tsx:110 usa intlLocale(). Nel backlog (docs/audit) non c'è una voce su Elements.

#### P8. 23 chiamate mettono l'id fidato prima dei dati del client

**Dove:** `apps/api/src/modules/seller/routes/settings.ts:68-72`, `apps/api/src/modules/seller/routes/settings.ts:98-101`, `apps/api/src/modules/seller/routes/settings.ts:127-130`, `apps/api/src/modules/seller/routes/employees.ts:58`, `apps/api/src/modules/seller/routes/brands.ts:32`, `apps/api/src/modules/seller/routes/orders.ts:31-34`, `apps/api/src/modules/seller/routes/onboarding.ts:47`, `apps/api/src/modules/seller/routes/onboarding.ts:109`, `apps/api/src/modules/seller/routes/stores.ts:84`, `apps/api/src/modules/seller/routes/stores.ts:116-120`, `apps/api/src/modules/seller/routes/products.ts:315`, `apps/api/src/modules/seller/routes/products.ts:351-356`, `apps/api/src/modules/seller/routes/closures.ts:39-43`, `apps/api/src/modules/customer/routes/points.ts:12-16`, `apps/api/src/modules/customer/routes/cart.ts:44-47`, `apps/api/src/modules/customer/routes/cart.ts:87-91`, `apps/api/src/modules/customer/routes/addresses.ts:39-42`, `apps/api/src/modules/customer/routes/addresses.ts:62`, `apps/api/src/modules/customer/routes/addresses.ts:108-112`, `apps/api/src/modules/customer/routes/checkout.ts:54-58`, `apps/api/src/modules/customer/routes/orders.ts:28-32`, `apps/api/src/modules/customer/routes/orders.ts:91-94`, `apps/api/src/modules/admin/routes/holiday-definitions.ts:97-100`

**Gruppo:** utile ma non urgente · **Verdetto:** confermato · **Righe:** 0 (si spostano righe in 23 chiamate)

- **Cos'è:** Le route passano al servizio un oggetto con gli id presi dalla sessione (sellerProfileId, customerProfileId, userId, storeIds, customerPoints…). Subito dopo c'è lo spread (...body o ...query, cioè «copia qui tutte le chiavi mandate dal client»).
- **Problema:** Con lo spread dopo, una chiave del client con lo stesso nome vince. Oggi è innocuo: Elysia 1.4.30 toglie le chiavi che lo schema (la descrizione dei dati ammessi) non dichiara, e nessuno schema dichiara quei nomi. Ma se un giorno OrderListQuery riceve uno storeIds opzionale, seller/routes/orders.ts:31-34 passa al servizio i negozi scelti dal client: un venditore legge gli ordini di negozi non suoi e il controllo dei tipi resta verde.
- **Correzione:** Inverti l'ordine nelle 23 chiamate (21 se fai prima il n. 14): prima lo spread, poi le chiavi fidate. Per esempio createProduct({ ...body, sellerProfileId: sp.id }) e listSellerOrders({ ...query, storeIds: [query.storeId] }). Così la sicurezza non dipende più da Elysia e non serve nessun test.
- **Se non lo facciamo:** Oggi niente. Il buco si apre senza avvisi il giorno in cui uno schema dichiara una chiave con il nome di un id fidato.
- **Prove:** Le chiamate sono 23, non circa 15: 13 seller, 9 customer, 1 admin. Le ho trovate con grep di '...body', '...query' e '...ctx.body' nelle route. Sono già nell'ordine sicuro admin/routes/billing.ts:126-129 e admin/routes/category-characteristics.ts:73-76 e :111-114. Elysia 1.4.30 ha normalize attivo di default (node_modules/.bun/elysia@1.4.30…/dist/index.mjs:198) e nessun new Elysia({...}) del repo lo cambia. Nessuno schema di richiesta usa additionalProperties o t.Any. t.Unknown c'è solo in schemi di risposta (lib/schemas/entities.ts:920; seller/routes/checkout.ts:29-31, usato a :96). Nessuno schema dichiara il nome di una chiave fidata. Lo script scratchpad/owner-spread/probe.ts costruisce l'app come index.ts: plugin normalize vero, moduli con prefix, schemi veri (OrderListQuery, PaginationQuery, PersonalSettingsBody, CompanySettingsBody con Type.Omit, VatChangeBody, UpdateHolidayDefinitionBody). GET /seller/orders?storeId=A&storeIds=B&storeIds=C&sellerProfileId=evil dà query {page:1, limit:20, storeId:'A'}. sellerProfileId, userId, customerProfileId, customerPoints, balance e id spariscono con body JSON, urlencoded e multipart. Con what-if.ts, se lo schema dichiara storeIds opzionale, il servizio riceve ['OTHER']. Con ts-overwrite.ts, tsc dà TS2783 solo se la chiave è obbligatoria, nessun errore se è opzionale. Nessun test manda chiavi in più. Per i punti c'è comunque una rete in SQL (customer/services/orders.ts:583); per gli ordini del seller no (seller/services/orders.ts:139 filtra solo per storeIds).

#### P9. «Pausa/Riprendi» può annullare l'archiviazione di una promozione

**Dove:** `apps/api/src/modules/seller/services/discounts.ts:126-144`, `apps/api/src/modules/seller/services/discount-pricing.ts:46`

**Gruppo:** utile ma non urgente · **Verdetto:** confermato · **Righe:** +5 circa

- **Cos'è:** pauseDiscount è il servizio del pulsante «Pausa/Riprendi» delle promozioni. Legge lo stato, rifiuta le promo archiviate e scambia active con paused.
- **Problema:** La scrittura ha solo l'id nella condizione (WHERE, cioè la parte che sceglie la riga), non lo stato letto. Caso: il titolare, da due schede, preme «Riprendi» e «Archivia» sulla stessa promo in pausa. Se l'archiviazione cade tra lettura e scrittura, la promo torna active e lo sconto torna nei prezzi dei clienti. Con «Pausa» invece di «Riprendi», la promo archiviata torna solo in pausa.
- **Correzione:** Aggiungi eq(discount.status, existing.status) al WHERE dell'UPDATE. È un CAS: scrivi solo se lo stato è ancora quello letto. Se non torna nessuna riga, lancia ServiceError(409, "La promozione è cambiata, ricarica la pagina").
- **Se non lo facciamo:** Quasi impossibile da colpire: le due azioni sono solo del titolare e la finestra dura pochi millisecondi. Se succede, lo sconto resta attivo finché il titolare non archivia di nuovo la promo.
- **Prove:** Letto a HEAD. discounts.ts:131 rifiuta archived, :137 calcola nextStatus, :138-142 fa l'UPDATE con where(eq(discount.id, …)) e basta. archiveDiscount (:146-160) è l'unico che scrive 'archived' (grep in apps/api/src, seed escluso). Le due route (routes/discounts.ts:182-224) chiamano requireOwner. Lo sconto vale solo con d.status = 'active' (discount-pricing.ts:46, :101, :144). Una scheda vecchia è già coperta: pauseDiscount rilegge lo stato e risponde 409. Il frontend le chiama come azioni separate (apps/seller/src/features/promotions/hooks/use-discounts.ts:45 e :58).

#### P10. Seed: due funzioni sui comuni da cancellare

**Dove:** `apps/api/src/db/seed/fixtures/utils.ts:187-195`, `apps/api/src/db/seed/fixtures/utils.ts:151-165`, `apps/api/src/db/seed/fixtures/utils.ts:611-626`, `apps/api/src/db/seed/fixtures/dev-seller.ts:10`, `apps/api/src/db/seed/fixtures/dev-seller.ts:43-44`

**Gruppo:** utile ma non urgente · **Verdetto:** confermato · **Righe:** −27 circa

- **Cos'è:** Sono funzioni del seed (lo script che riempie il database di sviluppo) che trovano l'id di un comune partendo dal suo codice ISTAT.
- **Problema:** ISTAT_TO_SEED_HANDLE non lo importa nessuno. getSeedMunicipalityIds cerca 10 comuni che getAllMunicipalityIds cerca già, e il suo unico chiamante (dev-seller.ts:43-44) usa solo Milano.
- **Correzione:** Cancella le due definizioni. In dev-seller.ts scrivi const milanoId = await getMunicipalityIdByIstat(SEED_MUNICIPALITIES.milano); e sistema l'import.
- **Se non lo facciamo:** Restano circa 25 righe che nessuno usa, da rileggere ogni volta che si tocca il seed.
- **Prove:** Con git grep, ISTAT_TO_SEED_HANDLE compare solo nella sua definizione (utils.ts:188). getSeedMunicipalityIds è definito a utils.ts:151 e usato solo da dev-seller.ts:10 e :43, più un vecchio piano in docs/superpowers/plans/2026-05-28-municipality-combobox.md da lasciare com'è. dev-seller.ts legge solo .milano (:44) e poi usa milanoId (:77-116). getAllMunicipalityIds (utils.ts:612-626) cerca SEED_MUNICIPALITIES più BOLOGNA_BELT. getMunicipalityIdByIstat è già esportato (utils.ts:117). Il seed è dentro il typecheck (tsconfig include src/**) ma non gira in CI: dopo il taglio servono il typecheck e un db:reset in locale.

#### P11. 10 testi tradotti che nessuna pagina usa

**Dove:** `apps/customer/messages/it.json:3,5,58,95-96,124`, `apps/customer/messages/en.json:3,5,58,95-96,124`, `apps/seller/messages/it.json:3,5,116,229`, `apps/seller/messages/en.json:3,5,116,229`

**Gruppo:** utile ma non urgente · **Verdetto:** confermato · **Righe:** −20 (10 chiavi × 2 file)

- **Cos'è:** Paraglide (la libreria delle traduzioni) legge i testi da messages/it.json ed en.json di ogni app. Ogni chiave diventa una funzione, per esempio m.store_near_me(), che le pagine chiamano.
- **Problema:** Nessun file chiama 10 di queste chiavi. Customer (6): welcome_message, current_locale, store_near_me, store_filters_open, store_filters_active, profile_description. Seller (4): welcome_message, current_locale, promotions_form_period_presets_label, orders_nav. Admin: nessuna. Caso concreto: store_near_me («Vicino a me») non è più usata da #172, ma è ancora tradotta in due lingue. Chi cerca «Vicino a me» nel codice trova solo una chiave morta.
- **Correzione:** Cancella le 10 chiavi da it.json ed en.json delle due app. Se una servisse ancora, il typecheck lo segnala subito, perché m.chiave non esiste più.
- **Se non lo facciamo:** Chi traduce continua ad aggiornare 20 testi che nessuno vede. Per gli utenti non cambia niente.
- **Prove:** Lo script scratchpad/verify-passing/unused-keys.ts cerca ogni chiave di messages/it.json, come parola intera, in tutti i file di `apps/<app>/src`, esclusa l'uscita di paraglide. Risultato: admin 0 su 487, customer 6 su 493, seller 4 su 1002. Nessun accesso dinamico: grep `m[` nelle tre app trova solo un commento (apps/seller/src/features/profile/components/online-payments-card.tsx:22), e i 242 import sono tutti `import { m } from "@/paraglide/messages"`. Fuori dai file messages, le 10 chiavi compaiono solo nella cache project.inlang/cache e in vecchi piani in docs/superpowers/plans. profile_description è usata solo dal seller (profile.tsx:24), non dal customer. git show 9344bf5 (#172) toglie l'ultimo m.store_near_me().

#### P12. createApiClient ha due rami uguali per server e browser

**Dove:** `packages/ui/src/lib/api-client.ts:2`, `packages/ui/src/lib/api-client.ts:18-45`, `apps/customer/src/features/products/product-detail-api.test.ts:5-12`

**Gruppo:** utile ma non urgente · **Verdetto:** confermato · **Righe:** −9 (−12 se accorci anche il commento)

- **Cos'è:** createApiClient crea il client Eden (il client tipizzato che chiama l'API) per admin, customer e seller. Usa createIsomorphicFn di TanStack Start, che tiene un ramo per il server e uno per il browser.
- **Problema:** I due rami sono uguali parola per parola (righe 33-38 e 39-44). Il commento alle righe 23-26 fa pensare che sul server succeda qualcosa di diverso, ma non è così. Caso concreto: chi aggiunge un'opzione (per esempio un header) in un solo ramo si ritrova server e browser diversi, e nessun test se ne accorge.
- **Correzione:** Al posto di createIsomorphicFn restituisci una funzione normale: `return () => treaty<App>(apiUrl, { fetch: { credentials: "include" as RequestCredentials }, parseDate });` e togli l'import alla riga 2. Le chiamate `api()` restano uguali e il client resta nuovo a ogni chiamata, quindi il test product-detail-api continua a funzionare. Aggiorna il commento del test alle righe 9-10, AGENTS.md:110 e docs/architecture.md:166-167, che citano createIsomorphicFn. Dopo, @tanstack/react-start in packages/ui/package.json:17 non serve più.
- **Se non lo facciamo:** Restano 8 righe doppie e un commento che promette una differenza che non c'è.
- **Prove:** Lettura di api-client.ts:32-44: i due rami sono identici. grep di createIsomorphicFn in `apps/*/src` e `packages/*/src`: unico uso qui, più il commento del test. Il test sostituisce globalThis.fetch. Con @elysiajs/eden 1.4.9 (dist/chunk-TTKI5TQ7.mjs, cioè treaty2) `fetcher = fetch` si legge dentro la chiamata del metodo, cioè al momento della richiesta: il test passerebbe anche con un client unico. La versione proposta crea comunque un client a ogni chiamata. Nessun test lanciato.

#### P13. La query degli abbonamenti è scritta due volte nel seller

**Dove:** `apps/seller/src/hooks/use-active-store.tsx:68-76`, `apps/seller/src/routes/_authenticated/billing.tsx:144-151`, `apps/seller/src/components/store-billing-banner.tsx:41-49`

**Gruppo:** utile ma non urgente · **Verdetto:** confermato · **Righe:** circa 0

- **Cos'è:** Il seller legge la lista degli abbonamenti dei negozi (GET /seller/billing/subscriptions) in due punti. Il primo è il provider del negozio attivo, che deve sapere se il negozio è sospeso. Il secondo è la pagina Billing. Tutti e due usano la chiave di cache ['seller','billing','subscriptions'] di TanStack Query (la libreria che tiene in memoria le risposte dell'API).
- **Problema:** Le due useQuery hanno la stessa chiave e la stessa funzione copiata. Con la stessa chiave la cache è una sola, e i dati li decide la funzione di chi carica per primo. Oggi le due copie fanno la stessa cosa, quindi non c'è un bug. La chiave è scritta una terza volta nel banner, per il setQueryData. Caso concreto: chi aggiunge un parametro alla richiesta in billing.tsx e non tocca use-active-store.tsx ottiene dati diversi a seconda della pagina aperta per prima.
- **Correzione:** Esporta da use-active-store.tsx una `subscriptionsQuery = queryOptions({ queryKey, queryFn })`. Usala nelle due useQuery, ognuno con il suo enabled: `enabled && isOwner` nel provider, `isOwner` in billing.tsx. Il setQueryData del banner lo toglie già F7; se resta, usa subscriptionsQuery.queryKey.
- **Se non lo facciamo:** Oggi non si rompe niente. Però ogni modifica alla richiesta va fatta in due file, e quella alla chiave in tre.
- **Prove:** use-active-store.tsx:68-76 e billing.tsx:144-151 hanno la stessa chiave, lo stesso GET e lo stesso unwrap. Il provider aggiunge solo il cast as Subscription[]. L'interfaccia Subscription è scritta a mano (use-active-store.tsx:24-33) ed è uguale a SubscriptionRowSchema (apps/api/src/modules/seller/routes/billing.ts:31-40). La terza copia della chiave è in store-billing-banner.tsx:42. statusBadge accetta string (billing.tsx:57-59), quindi condividere la query non rompe i tipi della pagina. Non è una factory intorno a route Elysia o al client better-auth: è il queryOptions standard di TanStack, quindi non tocca la decisione sui tipi di Eden.

#### P14. Le frecce per cambiare pagina in /orders non hanno un nome

**Dove:** `apps/customer/src/routes/_authenticated/orders/index.tsx:162-173`, `apps/customer/src/routes/_authenticated/points.tsx:106-125`

**Gruppo:** utile ma non urgente · **Verdetto:** confermato · **Righe:** +8 (Biome manda a capo i due Link)

- **Cos'è:** In fondo alla lista ordini del cliente ci sono due link per cambiare pagina. Si vedono quando il cliente ha più di 20 ordini. Il testo dei link è solo una freccia, ← o →.
- **Problema:** I due link non hanno aria-label, cioè il nome che lo screen reader legge al posto del testo visibile. Così lo screen reader legge solo il simbolo, per esempio «freccia destra, link». In /points gli stessi link hanno aria-label «Pagina precedente» e «Pagina successiva». Caso concreto: un cliente con VoiceOver e più di 20 ordini arriva in fondo alla lista e sente «freccia destra». Deve indovinare che porta alla pagina dopo.
- **Correzione:** Aggiungi aria-label={m.points_page_prev()} e aria-label={m.points_page_next()} ai due Link, come in points.tsx:109 e 122. I testi sono già generici e c'è anche la versione inglese.
- **Se non lo facciamo:** Chi usa uno screen reader sente «freccia» invece di «Pagina successiva». Di solito capisce lo stesso, ma fa più fatica che in /points.
- **Prove:** In orders/index.tsx:162 e 171 i Link contengono solo «←» (riga 163) e «→» (riga 172), senza aria-label. In points.tsx:106-125 gli stessi Link hanno aria-label alle righe 109 e 122. I testi sono in apps/customer/messages/it.json:412-413 («Pagina precedente», «Pagina successiva») e in en.json:412-413 («Previous page», «Next page»). Le frecce compaiono con più di 20 ordini, perché ORDERS_PAGE_SIZE = 20 (apps/customer/src/features/orders/use-orders.ts:8).

#### P15. Le distanze usano la virgola anche in inglese

**Dove:** `apps/customer/src/components/tile.tsx:17-21`, `apps/customer/src/features/catalog/product-tile.tsx:79`, `apps/customer/src/features/products/product-offer.tsx:57`, `apps/customer/src/features/stores/store-search-map.tsx:75`, `apps/customer/src/features/stores/store-tile.tsx:50`

**Gruppo:** utile ma non urgente · **Verdetto:** confermato · **Righe:** +5

- **Cos'è:** formatDistance trasforma i metri in testo, per esempio «240 m» o «1,2 km». La usano le tile di negozi e prodotti, le offerte nella scheda prodotto e le etichette della mappa.
- **Problema:** La virgola è scritta a mano: `toFixed(1).replace(".", ",")`. Prezzi e date invece seguono la lingua scelta tramite intlLocale() (il codice di lingua usato per formattare numeri e date). Caso concreto: il cliente sceglie «English». La tile di un prodotto a 1.234 m mostra il prezzo «€12.50», con il punto, e sotto «1,2 km», con la virgola.
- **Correzione:** In tile.tsx:20 calcola i km con `(meters / 1000).toLocaleString(intlLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })` al posto di toFixed + replace. Importa intlLocale da @bibs/ui/lib/intl-locale. In italiano resta «1,2 km», in inglese diventa «1.2 km». Aggiorna anche il commento della riga 17.
- **Se non lo facciamo:** In inglese distanza e prezzo hanno due formati diversi sulla stessa tile. Si capisce lo stesso, ma sembra un errore.
- **Prove:** tile.tsx:20 contiene `${(meters / 1000).toFixed(1).replace(".", ",")} km`. Con git blame ho visto che la funzione è stata scritta il 24/06 (97164910), prima del #224 del 04/10 che ha portato l'inglese. Il prezzo della tile passa da DiscountedPrice (product-tile.tsx:92), poi da formatPriceEur e da intlLocale() (packages/ui/src/custom/price.tsx:28). apps/customer/src/router.tsx:8 registra il resolver della lingua. Ho scritto lo script scratchpad/verify-passing/distance.ts. Per 1234 m: oggi «1,2 km», con Intl it-IT «1,2 km», con en-GB «1.2 km».

#### P16. Il test del CHECK sull'enum passa grazie a un altro vincolo

**Dove:** `apps/api/tests/integration/db-enum-check-constraints.test.ts:80-92`, `apps/api/tests/integration/db-enum-check-constraints.test.ts:41-53`, `apps/api/src/db/schemas/points.ts:48-55`, `apps/api/src/db/migrations/0000_init.sql:362-363`

**Gruppo:** utile ma non urgente · **Verdetto:** confermato · **Righe:** −3

- **Cos'è:** Il test vuole provare che il database rifiuta in point_transactions un type fuori elenco (enum). Il controllo lo fa un CHECK, cioè una regola scritta nella tabella: point_transaction_type_valid.
- **Problema:** La riga 91 usa rejects.toThrow() senza argomenti, quindi passa con qualunque errore. E oggi l'errore arriva da un altro CHECK, point_transaction_amount_sign, che ammette solo i tre tipi noti. Postgres prova i CHECK in ordine alfabetico di nome, quindi questo scatta per primo. Caso concreto: in un Postgres usa-e-getta ho tolto point_transaction_type_valid e l'insert del test fallisce lo stesso, sempre su amount_sign: il test resterebbe verde. Resterebbe verde anche se l'insert fallisse per un altro motivo, per esempio una nuova colonna obbligatoria.
- **Correzione:** Usa l'helper che c'è già nel file: `await expectConstraintViolation(getTestDb().insert(pointTransaction).values({ customerProfileId, amount: 10, type: bogusType }), "point_transaction_amount_sign")` e togli insertBogus. Rinomina il test per dire che il tipo sconosciuto lo ferma il CHECK sul segno. Così il test fissa una regola vera del registro punti, che oggi nessun test nomina.
- **Se non lo facciamo:** Il test sembra provare il vincolo sull'enum, ma non lo prova. Se l'insert si rompe per un altro motivo, resta verde lo stesso.
- **Prove:** Lettura: alla riga 91 c'è `rejects.toThrow()`; l'helper (righe 41-53) è usato solo alle righe 97 e 117. Prova: Postgres usa-e-getta dall'immagine locale bibs-postgis-test (PostgreSQL 18.6), con una tabella che ha gli stessi due CHECK di 0000_init.sql:362-363. INSERT (10, 'bogus') viola point_transaction_amount_sign; dopo il DROP di point_transaction_type_valid l'errore è lo stesso. Container fermato e rimosso. grep in apps/api/tests: nessun test nomina point_transaction_amount_sign o point_transaction_type_valid.

#### P17. Il test «with the request body» non controlla il body

**Dove:** `apps/api/tests/modules/registration.test.ts:194-201`, `apps/api/src/modules/registration/index.ts:33-35`

**Gruppo:** utile ma non urgente · **Verdetto:** confermato · **Righe:** +3

- **Cos'è:** È un test della route POST /register/customer. Il servizio registerCustomer è un mock, cioè una funzione finta che si segna con quali argomenti viene chiamata.
- **Problema:** Il nome dice «con il body della richiesta», ma l'unica verifica è toHaveBeenCalledTimes(1) alla riga 200: conta le chiamate e non guarda gli argomenti. Nessun altro test passa dalla route fino al servizio, perché i test di integrazione chiamano registerCustomer direttamente. Caso concreto: se la riga 35 di registration/index.ts passasse `{ email: body.email, password: body.email }`, il test resterebbe verde.
- **Correzione:** Alla riga 200 scrivi `expect(mockRegisterCustomer).toHaveBeenCalledWith({ email: "mario@example.it", password: "password123" }, expect.anything());` (il secondo argomento è il logger).
- **Se non lo facciamo:** Il test resta un doppione di quello sopra. Il rischio è basso: oggi la route passa il body così com'è.
- **Prove:** Lettura di registration.test.ts:194-201: c'è solo toHaveBeenCalledTimes(1) e mock.calls non viene mai letto. grep 'register/customer' in apps/api/tests: compare solo in registration.test.ts e in registration-response-schema.test.ts, che usa handler finti senza servizio (righe 95-117). I test di integrazione chiamano il servizio senza passare dalla route (registration-pending-resend.test.ts:79-82). Nessun test lanciato.

#### P18. Un container Postgres solo per due controlli di status

**Dove:** `apps/api/tests/integration/locations-geocode-route.test.ts:34-67`, `apps/api/tests/integration/locations.test.ts:10-34`

**Gruppo:** utile ma non urgente · **Verdetto:** confermato · **Righe:** circa −30

- **Cos'è:** Il file controlla due cose: GET /locations/geocode senza login risponde 401, e GET /locations/municipalities/all è pubblica e risponde 200. È l'unico test che prova il 401 della vera macro auth (il controllo di login sulle route).
- **Problema:** Per due status il file avvia un suo testcontainer (un Postgres in Docker usa-e-getta) e applica le migrazioni. locations.test.ts ha già lo stesso mock di @/db e un container, e in più carica tutti i comuni. Caso concreto: nel log CI di oggi i due test durano 26 ms e 7 ms, ma il file paga l'avvio del container: circa 3 s in locale e circa 5 s di un worker (uno dei 4 processi di test in parallelo) in CI (misure dell'audit).
- **Correzione:** Sposta i due test in locations.test.ts. Nel suo beforeAll, dopo seedLocations(), importa elysia, errorHandler e locationsModule con un import dinamico e costruisci l'app. L'import resta dinamico come oggi, perché @/lib/auth va caricato dopo il mock di @/db. Poi cancella locations-geocode-route.test.ts. Tieni il test del 401. In più il 200 passerà dallo schema di risposta con 7.904 righe vere, non con una tabella vuota.
- **Se non lo facciamo:** Ogni giro di test avvia un container in più e perde qualche secondo, finché non si fa il n. 11 (un solo container per run). Nient'altro.
- **Prove:** Lettura del file: setupTestContainer alle righe 34-35 e solo due asserzioni sullo status (righe 57 e 65). locations.test.ts:10-34 ha lo stesso mock di @/db, setupTestContainer e seedLocations(). grep di toBe(401) in apps/api/tests: gli altri tre casi provano la conversione degli errori o un servizio finto, quindi questo è l'unico 401 della macro vera. Log CI (scratchpad/speed/ci-tests.tsv:758-759): 25,9 ms e 6,76 ms. Costo di un container dall'audit: pronto in ~2,6 s più 0,23 s di migrazione in locale, ~5 s per file in CI. Lo spostamento non è stato eseguito.

#### P19. Due attese da 50 ms inutili nel test dell'avatar

**Dove:** `apps/api/tests/integration/me-avatar.test.ts:124-125`, `apps/api/tests/integration/me-avatar.test.ts:139-140`, `apps/api/src/modules/me/services/avatar.ts:62-79`

**Gruppo:** utile ma non urgente · **Verdetto:** confermato · **Righe:** −4

- **Cos'è:** Dopo aver caricato il nuovo avatar, il servizio cancella la foto vecchia da S3 (lo spazio dove salviamo i file) senza aspettare la fine: s3.delete(oldKey).catch(...) senza await.
- **Problema:** Prima di guardare il mock di s3.delete il test aspetta 50 ms; il commento dice «give the microtask queue a tick». Non serve: s3.delete parte prima del return di uploadUserAvatar (avatar.ts:65), e il mock registra la chiamata nel momento in cui parte. Caso concreto: uno script con la stessa forma (await, delete senza await, return) passa senza nessuna attesa, sia quando cancella sia quando non cancella.
- **Correzione:** Cancella le due attese con i loro commenti (righe 124-125 e 139-140).
- **Se non lo facciamo:** Il test resta 0,1 s più lento e il commento continua a spiegare una cosa falsa.
- **Prove:** Lettura di avatar.ts:62-79: s3.delete(oldKey) viene chiamata senza await prima del return; i mock di bun registrano la chiamata subito. Lo script scratchpad/verify-passing/avatar/nowait.test.ts riproduce la stessa forma: 2 test passano senza attese. Il test vero non l'ho lanciato senza le attese, perché bisognerebbe modificare il repo.

**Veri, ma da lasciare come sono**

- **Reinvio e annullamento dell'invito restituiscono anche negozi archiviati.** Le due risposte includono `storeIds` senza togliere i negozi archiviati, mentre la lista degli inviti li toglie (`apps/api/src/modules/seller/services/employees.ts:231-234`, `:283-286`). Nessuna pagina legge quel campo: il frontend usa solo l'email e poi ricarica la lista, che è filtrata. Se un giorno un client lo leggerà, basta applicare lo stesso filtro della lista (`getSellerStoreIds`).
- **Il tipo della transazione è scritto in 12 posti, 7 con `any`.** Le 7 funzioni con `any` (che spegne il controllo dei tipi) usano solo `insert`, `select` ed `execute` sulle tabelle, che portano con sé i loro tipi: oggi nessun errore passa inosservato. Se un giorno servirà `tx.query` in una di queste funzioni, basta esportare un solo tipo `Tx` da `apps/api/src/db/index.ts`.
- **«Annulla ordine» del cliente: un caso che non capita mai.** `canCustomerCancel` (`apps/customer/src/features/orders/order-display.ts:55-59`) accetta anche una prenotazione in stato `pending`, che non esiste: le prenotazioni nascono già `confirmed`. Il ramo rispecchia però la macchina a stati dell'API, e toglierlo non toglie righe: nessun comportamento è sbagliato.

**Smentiti**

- **Festività admin: scostamento dalla Pasqua senza limiti nel form.** Nel form è una tendina con due sole voci, 0 (Pasqua) e 1 (Pasquetta) (`apps/admin/src/features/holidays/components/holiday-form.tsx:117-136`), sempre dentro i limiti dell'API (da −60 a 60). Il 422 arriva solo modificando la pagina dagli strumenti del browser, ed è giusto così.

## 6. Misure

Tutte le misure sono del 2026-10-11. La CI è quella di GitHub Actions (`ubuntu-24.04`, 4 vCPU); in locale si usa un Mac con 8 CPU e Docker Desktop.

### 6.1 CI

| Job | Durata (ultimi 8 run) |
|---|---|
| API tests (unit + integration + test dei frontend) | 375–485 s (422 s nel run 38131278805) |
| Docker image (api) | 87–228 s |
| Typecheck | 77–126 s |
| Build (admin, customer, seller) | 28–59 s |
| Lint (Biome) | 24–38 s |

Negli ultimi 100 run: 87 riusciti, 12 annullati, 1 fallito.

Dentro il job «API tests» (run 38131278805, 422 s):

| Passo | Tempo |
|---|---|
| setup | 2,5 s |
| `bun install` | 23,2 s |
| emails, ui e test unitari API (462 test unitari API) | 5,1 s |
| `test:image` (build dell'immagine PostGIS) | 21,7 s |
| test di integrazione (885 test in 95 file) | 323,3 s |
| admin 18,9 s + customer 6,5 s + seller 18,4 s (compreso il pretest Paraglide) | 43,7 s |

### 6.2 Test di integrazione

- Durata dei singoli test in CI: p10 798 ms (il 10% dei test dura meno), mediana 873 ms, p90 984 ms (il 90% dura meno), massimo 3.648 ms; somma 786 s.
- Tempo dei 4 worker: 4 × 323 s = 1.293 s. Di questi, 786 s dentro i test, 476 s per preparare i file (container, migrazioni, import) e 31 s di attesa a fine coda.
- Tra la fine di un file e il primo test del file successivo passano in mediana 5,07 s (p10 4,76 s, p90 5,8 s).
- I test che non svuotano il DB (`locations*.test.ts`) durano 7–31 ms; i test più semplici che lo svuotano non scendono sotto ~590 ms. Il più lento (3.648 ms) chiama `truncateAll` 4 volte.

**Prova sullo svuotamento del DB** (container usa e getta con le migrazioni vere; 15–16 run per variante; «4 in parallelo» = 4 sessioni insieme, come `--parallel=4`):

| Variante | 1 sessione | 4 in parallelo |
|---|---|---|
| ciclo attuale in `truncateAll` (283 TRUNCATE con CASCADE) | 326–340 ms | 688–768 ms |
| un solo `TRUNCATE` di tutte le 47 tabelle | 22,8 ms | 28–33 ms |
| `DO` con un solo `EXECUTE` costruito con `string_agg` | 22,6–36 ms | — |
| `DELETE` con le chiavi esterne disattivate | 1,0 ms | 1,9 ms |
| ciclo attuale con `fsync` spento | — | 148 ms |

Il database di prova non ha sequenze, quindi `RESTART IDENTITY` non cambia nulla.

**Avvio di Postgres per file** (in locale): container pronto in ~2,4–2,6 s (initdb 0,8 s, estensioni in 2 database 2 × 0,55 s, riavvio 0,35 s), migrazioni 0,23 s. Una copia con `CREATE DATABASE … TEMPLATE bibs_test` costa 71–134 ms da sola e 105–352 ms con 8 copie insieme (22–24 MB a copia). In CI avvio e migrazione costano ~3,5–4 s a file.

### 6.3 Tempi in locale

| Suite | Tempo |
|---|---|
| `test:image` (con la cache) | 3,9 s |
| API, test unitari (462 test) | 1,05 s |
| API, test di integrazione (885 test) | 303,9 s |
| un solo file piccolo (`locations.test.ts`, 4 test) | 3,15 s |
| emails | 0,3 s |
| ui | 1,8 s |
| admin | 9,5 s (import 38,8 s, transform 23 s, ambiente jsdom 6,5 s, sommati sui worker) |
| customer | 4,1 s |
| seller | 10,9 s (import 43 s sommati sui worker) |
| API con copertura (1.347 test, 151 file) | 398 s |

### 6.4 Test dei frontend e traduzioni

Paraglide oggi genera un file JavaScript per ogni messaggio. I file di test che importano i messaggi li caricano tutti:

| App | File di test che caricano i messaggi | Moduli Paraglide caricati da ognuno |
|---|---|---|
| seller | 18 su 26 | 1.005 |
| admin | 17 su 20 | 490 |
| customer | 8 su 19 | 496 |

Prova su 12 file di test del seller: 2,90–3,69 s con un file per messaggio, 0,71–0,72 s con `--output-structure locale-modules` (un file per lingua). Nelle app jsdom c'è solo in 9 file dell'admin, e tutti fanno davvero render.

### 6.5 Stima dopo le correzioni 11 e 12

| Passo | Job API in CI |
|---|---|
| oggi | ~422 s |
| un solo `TRUNCATE` (n. 11) | ~280 s |
| test dei frontend nel job `web-build` (n. 12) | ~236 s |
| immagine PostGIS in parallelo a `bun install` (n. 11) | ~218 s |
| un solo Postgres per run con database modello (n. 11) | ~135–140 s |

A quel punto il job più lungo diventa «Docker image» (87–228 s), quindi la CI intera scende da ~7 a ~4 minuti (senza il passo di seed del n. 9, che allunga il job Docker). In locale l'integrazione passa da ~304 s a ~150 s con il primo passo e a ~95 s con il database modello.

### 6.6 Codice copiato (jscpd)

| Dove | Cloni | Righe duplicate | Quota |
|---|---|---|---|
| sorgente (apps e packages, test esclusi) | 166 | 2.855 su ~83.000 | 3,4% |
| test | 304 | 5.103 | 13,8% |

Nei test, 2.517 righe duplicate sono cloni che partono dalle prime 5 righe del file: sono l'intestazione copiata del n. 13. I test dei frontend pesano solo 113 righe (5 cloni).

## 7. Mappa della copertura dei test

### 7.1 API

Run completo con copertura: 1.347 test in 151 file, 0 falliti. Funzioni coperte 86,99%, righe coperte 93,20%. Bun però conta solo i file che almeno un test carica: un file mai caricato non abbassa la media.

**Endpoint** (175 route più `/health` e `/ready`). «Eseguiti via HTTP» = una richiesta di test passa dalla route, anche solo fino al 403. «Logica eseguita» = il servizio della route gira in almeno un test.

| Modulo | Endpoint | Eseguiti via HTTP | Logica eseguita | Logica mai eseguita |
|---|---:|---:|---:|---:|
| admin | 45 | 1 | 35 | 10 |
| catalog (pubblico) | 4 | 0 | 0 | 4 |
| customer | 25 | 2 | 23 | 2 |
| locations | 6 | 1 | 4 | 2 |
| me | 2 | 0 | 2 | 0 |
| seller | 86 | 42 | 67 | 19 |
| webhooks | 3 | 3 | 3 | 0 |
| registration | 4 | 3 (servizi finti) | 2 | 2 |
| health | 2 | 0 | 0 | 2 |
| **Totale** | **177** | **52** | **136** | **41** |

Logica mai eseguita nel seller: onboarding (5), profilo (2), impostazioni (3), team (4), stock (2), portale billing, stato e ripresa del checkout. Nell'admin: CRUD delle categorie negozio, modifica di categorie e macro, storico prezzi, abbonamenti, richieste pendenti. Nel customer: `/points` e `/profile`.

**Accessi:**
- il 401 della macro `auth` è provato una sola volta (`/locations/geocode`); il ramo «sessione valida» mai;
- guardie dei moduli admin, seller e customer: 0 su 3 eseguite;
- controlli dentro le route seller (42 `requireOwner` e 15 `ensureStoreAccess`): 39 su 57 eseguiti;
- 23 chiamate passano al servizio gli id presi dalla sessione e subito dopo `...body` o `...query`: oggi è sicuro perché Elysia toglie le chiavi che lo schema non dichiara, ma nessun test lo fissa (vedi [sezione 5](#5-problemi-visti-di-passaggio-verificati-dopo)).

**File mai caricati da nessun test: 48 su 245** (seed e script esclusi; 2 contengono solo tipi). Molti servizi delle route qui sotto sono invece testati, perché i test li chiamano direttamente: manca il passaggio dalla route.

- `apps/api/src/index.ts`; tipi: `apps/api/src/types.ts`, `apps/api/src/lib/holidays/types.ts`
- admin: `modules/admin/index.ts`; route `category-characteristics`, `category-imports`, `characteristic-imports`, `configurations`, `holiday-definitions`, `product-categories`, `product-characteristics`, `product-macro-categories`, `seller-changes`, `sellers`, `store-categories`, `store-macro-categories`, `stores`; servizio `store-categories`
- catalog: `modules/catalog/index.ts`; route e servizi `product-categories`, `product-macro-categories`, `store-categories`, `store-macro-categories`
- customer: `modules/customer/index.ts`; route `addresses`, `cart`, `points`, `products`, `profile`, `stores`; servizio `points`
- seller: `modules/seller/index.ts`; route `onboarding`, `product-characteristics`, `products`, `profile`; servizio `onboarding`
- me: `modules/me/index.ts`, route `avatar`
- `modules/billing/index.ts`, `modules/webhooks/index.ts`
- plugin: `cron.ts`, `health.ts`, `normalize.ts`

**I 20 file caricati con meno righe coperte:**

| Righe coperte | Funzioni coperte | File |
|---:|---:|---|
| 10,8% | 0% | `apps/api/src/modules/seller/services/profile.ts` |
| 22,2% | 0% | `apps/api/src/lib/geocoding/index.ts` |
| 31,0% | 40% | `apps/api/src/modules/seller/services/store-images.ts` |
| 32,9% | 0% | `apps/api/src/lib/s3.ts` |
| 42,9% | 50% | `apps/api/src/modules/admin/services/product-categories.ts` |
| 43,2% | 20% | `apps/api/src/modules/locations/services/locations.ts` |
| 53,5% | 100% | `apps/api/src/lib/email.ts` |
| 53,9% | 0% | `apps/api/src/modules/seller/routes/stock.ts` |
| 55,0% | 0% | `apps/api/src/modules/seller/routes/store-images.ts` |
| 56,9% | 79% | `apps/api/src/modules/seller/services/settings.ts` |
| 61,5% | 75% | `apps/api/src/lib/jobs/expire-reservations.ts` |
| 62,0% | 80% | `apps/api/src/modules/admin/services/billing.ts` |
| 62,5% | 67% | `apps/api/src/lib/logger.ts` |
| 68,8% | 78% | `apps/api/src/modules/seller/services/checkout.ts` |
| 69,0% | 100% | `apps/api/src/modules/webhooks/services/handlers/invoice-paid.ts` |
| 69,2% | 46% | `apps/api/src/modules/seller/routes/discounts.ts` |
| 69,2% | 80% | `apps/api/src/modules/admin/services/product-macro-categories.ts` |
| 69,8% | 80% | `apps/api/src/modules/admin/services/store-macro-categories.ts` |
| 71,4% | 91% | `apps/api/src/modules/registration/services.ts` |
| 74,1% | 62% | `apps/api/src/modules/me/services/avatar.ts` |

**Il resto, per area:**
- **lib:** quasi tutto al 100% (soldi, IVA, punti, commissioni, macchina a stati degli ordini, codice di ritiro, orari, festività, CSV; geocoding tranne `geocoding/index.ts`, al 22%). Scoperti: il ramo produzione di `email.ts` (Resend), `ensureBucket`/`checkBucket` di `s3.ts`, l'hook di verifica email in `auth.ts`, la ricerca delle prenotazioni scadute in `expire-reservations.ts`.
- **soldi:** coperti bene (checkout 96%, `order-payments` ~97%, rimborsi e storni, punti, IVA, minimo 0,50 €, nuovo tentativo dei trasferimenti, prezzi admin).
- **webhook Stripe, test per tipo di evento:** `checkout.session.completed` 10 (più la riattivazione); `customer.subscription.updated` 4 più 3 email; `customer.subscription.deleted` 1 più 5 email; `invoice.payment_succeeded` 2 (i rami che saltano l'evento no); `invoice.payment_failed` 1 più 8 email; `payment_intent.*` 13; account e capability Connect 10; eventi «thin» v2 8; firma, idempotenza e rielaborazione 5; status code delle 3 route 13.
- **cron:** `auto-cancel-suspended-stores` 4 test, `expire-pending-store-creations` 1, `expire-unpaid-orders` 6, `retry-store-transfers` 5, `expire-reservations` 0; `plugins/cron.ts` mai caricato.
- **errori:** `error-handler` 100% (ServiceError, 23505/23503/23514, errori di better-auth, 404, 422, risposta non valida, upload); `validation-message` 99%.
- **plugin:** `error-handler`, `rate-limit` e `request-id` testati; la riscrittura di `X-Forwarded-For` in `plugins/better-auth.ts` mai eseguita (backlog P5); `normalize`, `health` e `cron` mai caricati.
- **seed:** nei test gira solo `seedLocations` (`locations.test.ts`); le fixture del seed (~6.000 righe, usano `createOrder` e `transitionOrder`) non girano mai, né nei test né in CI.

### 7.2 Frontend e pacchetti

Non ci sono test di pagina né test nel browser. Testing Library e jsdom ci sono solo in admin e `packages/ui`: seller e customer non possono provare stato e clic dei componenti.

| Dove | File di test | Coperto | Non coperto (logica a rischio) |
|---|---:|---|---|
| customer | 19 | scelta del checkout nell'URL, minimo 0,50 € (#249), punti, 4xx → carrello e nuovo tentativo con la stessa chiave, stati della pagina finale; ordini (conto alla rovescia, testo di annullamento, codice di ritiro); punti; orari e «aperto ora»; origine della ricerca (#212); date di Eden; stato del form indirizzi; messaggi zod e auth, attesa del reinvio, retry | PayForm (risposte di Stripe), riepilogo (chiave di idempotenza, invio bloccato), titolo della pagina finale (#253), polling dopo 3DS, carrello (quantità, pulsante bloccato), svuotamento della data di nascita (#94), guardie di login e registrazione (#74) |
| seller | 26 | ritiro: codice, sessione dello scanner, dipendenze zxing; riepilogo ordine; filtri e caratteristiche prodotto; cella prezzo; attesa dopo il checkout del negozio (#240); dashboard; paginazione (#211); messaggi TypeBox e zod | date delle promozioni (n. 3), prezzo «9 → 9.00» (#78), IVA tenuta al cambio di categoria (#195), cella scorte (#211), segno di «Sottrai» in massa, orari e sito svuotati (#93), orari modificati (#73), redirect dell'onboarding, team pagina 1 (#78), importo delle fatture (#252) |
| admin | 20 | prezzi senza NaN (#195), festività, CSV, moderazione, caratteristiche e matrice, login, badge | reset dei form categoria (#243) |
| packages/ui | 5 (+7 file testati dalle app, vedi T5) | prezzo, `SearchInput`, footer della tabella, sidebar, regola zod; dalle app: attesa, paginazione, `displayName`, `intlLocale`, retry, `LocaleToggle`, `TabNav` | `unwrap`/`edenMessage`, data di nascita → null in `PersonalInfoCard`, selezione nella tabella, combobox, ritaglio immagine |
| packages/emails | 2 | tutti e 6 i template (verifica, reset, invito, pagamento fallito, sospeso, archiviato): oggetto, link, saluto ed escape HTML | — |

**Bug passati dei frontend e test di regressione:** #249 sì; #212 sì; #240 sì; #211 paginazione sì, cella scorte no; #195 admin sì, IVA nel seller no; #78 no; #93 sì nell'API, no nel frontend; #73 no; #74 no (e nessuna regola di lint, vedi n. 10); #94 no; #243 no; #253 no; #252 no.

### 7.3 Per livello

| Livello | Cosa lo copre oggi | Cosa manca |
|---|---|---|
| API, servizi e DB | 95 file di integrazione (885 test) con le migrazioni SQL vere | onboarding seller, ricerca delle prenotazioni scadute (n. 9) |
| API, route | 15 file in `tests/modules` (guardie e validazione con servizi finti) e 5 file di integrazione via HTTP | GET pubblici `/customer/stores` e `/customer/products` mai via HTTP; schemi di risposta quasi mai provati su righe vere |
| Frontend | Vitest: admin 20, customer 19, seller 26, ui 5 file | nessun test sulle 75 pagine |
| Browser (E2E) | nessuno | ogni percorso utente; oggi fa da controllo lo smoke manuale |
| Contratto frontend ↔ API | tipi Eden e typecheck; Elysia valida le risposte (500 se fuori schema); 1 test a runtime sulle date (`product-detail-api.test.ts`) | nessun controllo su dati realistici |
| Schema ↔ migrazioni | i test applicano gli SQL veri (colonne e tabelle) | nessun controllo `db:generate` (indici, CHECK, `onDelete`) |
| Seed | solo `seedLocations` | seed completo mai in CI (rotto durante il #202) |
| Email | 12 test di render (6 template su 6) e test dei trigger con `sendEmail` finto | ramo Resend mai testato; la funzione finta lancia, quella vera solo se cade la rete (n. 2) |
| Cron | 4 job su 5 con il loro test | `expireReservations` |
| Env e Docker | build, migrate, avvio e `/ready` | sempre in modalità sviluppo (n. 1); variabili di produzione facoltative |
| Traduzioni | il typecheck controlla le chiavi usate; it ed en allineate | nessun controllo che ogni chiave abbia l'inglese |
| OpenAPI | percorsi di better-auth generati all'avvio | `/openapi/json` mai chiesto in CI |
| Accessibilità | regole a11y di Biome (una sola soppressione) | nessun controllo axe |
| Hook git | lefthook: Biome e formato del messaggio di commit | — |
| Layout CI | 6 workspace su 6 testati; Biome su ts, tsx, js, json | test dei frontend in coda all'API (n. 12) |

### 7.4 Efficacia dei test

- **Unitari API:** 56 file, ~5.500 righe, 462 test; buoni, tranne 6 file che controllano solo dichiarazioni (n. 10).
- **Integrazione API:** 95 file, ~26.000 righe, 885 test. SQL vero sempre: 93 file puntano `@/db` al database del testcontainer, nessun DB finto.
- **Frontend e ui:** 70 file (20 con render), emails 2: logica pura, niente mock interni, niente orologio vero.
- **Soldi:** asserzioni forti, con importi in centesimi, chiavi di idempotenza e stato del DB dopo ogni scrittura.
- **Mock:** i mock interni stanno solo sullo strato sotto quello testato (route di registrazione → servizi, route webhook → smistatore, smistatore → handler). Nessun test sostituisce il modulo che dice di testare. Stripe, S3, email e Photon sono finti: nessuna chiamata di rete.
- **Strato route:**
  - montate con la resolve vera: ordini e dashboard del seller;
  - con una copia della resolve: checkout e ordini del customer;
  - montate senza guardia, solo per 403 e 422: 7 moduli seller, stock, billing admin;
  - mai montate: i moduli admin, customer e seller, e le route dei prodotti del seller.
- **Concorrenza:** `loyalty-points-race` non può fallire (n. 10); `order-cancel-refund` e i tre test di `adjustStock` falliscono solo se le chiamate si sovrappongono davvero. Il testcontainer serializza le transazioni, quindi questi test non provano le gare.
- **Orologio:** le date relative reggono; il cambio d'ora e il fuso di Roma della dashboard sono testati con un «adesso» fisso. Fragili solo le 23:59 e la mezzanotte (n. 10).

## 8. Copie tenute apposta e decisioni rispettate

Non tutte le copie vanno unite. Queste restano come sono, per un motivo preciso:

| Copia | Perché resta |
|---|---|
| `router.tsx` e `server.ts` nelle tre app | sono file d'ingresso di TanStack Start: importano il `routeTree` e Paraglide di ogni app e registrano i tipi per app. Un wrapper generico rischia i tipi |
| `auth-client.ts` e `api.ts` nelle tre app | una factory sul client better-auth o su Eden fa collassare i tipi (decisione già presa) |
| `ui-labels`, `auth-error`, selettore lingua, `zod-resolver` | chiamano i messaggi Paraglide o il runtime di ogni app |
| `LoginForm` admin ≈ seller, profilo admin ≈ `PersonalInfoCard` del seller | per unirli servirebbe react-hook-form in `@bibs/ui`, o sono quasi solo etichette |
| guardie di `_authenticated` (×3) e logout (×10) | poche righe ciascuno, legate al router di ogni app |
| `nav-user` e `app-sidebar` admin ↔ seller | diversi per scelta |
| `use-municipalities` seller ↔ customer | duplicato per scelta, scritto nel codice |
| config di Vite, Vitest, tsconfig e inlang | già ridotte a wrapper di 3 righe |
| badge di stato (ordini, promo, team, onboarding, abbonamenti) | testi Paraglide e toni del brand diversi per app |
| ricerca indirizzo customer ≈ seller, mappa di anteprima ×2, 14 dialog di conferma | risparmio piccolo, oppure comportamenti diversi |
| servizi delle categorie admin prodotto ↔ negozio | regole diverse: un prodotto in uso blocca la cancellazione (409), un negozio no (la chiave esterna diventa NULL). Si uniscono i form (sezione 3), non i servizi |
| import CSV categorie ↔ caratteristiche | in comune c'è solo il prologo (sezione 4); il resto è voluto |
| aggiornamenti condizionati degli stati (ordini, abbonamenti, richieste) | ogni CAS (aggiornamento che riesce solo se lo stato non è cambiato) ha condizioni diverse |
| utilità del seed ↔ fixture dei test | nessuna sovrapposizione: il seed usa la registrazione vera di better-auth, i test inseriscono righe direttamente |
| mock di Stripe, env ed email nei test | diversi in ogni file |
| `isolation-guard-1` e `-2` | identici di proposito |
| test di `auth-error` (customer = seller) e di `zod-errors` | controllano i testi o gli schemi di ogni app |
| Stripe provato solo a mano | i bug #251–#253 dipendevano dal comportamento reale di Stripe |
| controllo delle pagine con lo smoke manuale | è il controllo scelto per la UI; per questo niente Playwright ora |

**Decisioni rispettate dall'audit:** nessuna factory generica intorno alle route Elysia o al client better-auth; nessun `.map()` sulle union di IVA o stato prodotto in `entities.ts`; `PointXY` e `LonLat` restano separati; un helper condiviso in `@bibs/ui` riceve testi ed etichette come parametri e mai l'oggetto `m` di Paraglide; niente file in `apps/seller/src/lib/` con lo stesso nome di un file dell'API (l'alias `@/` li confonde); il tipo d'ordine `direct` resta nel dominio.

**Scartato dopo la verifica:** «Il passo di pagamento con carta (PayForm) non ha test». È vero, ma sono ~10 righe intorno a `stripe.confirmPayment`, senza bug passati. Se il ramo «già pagato» si rompesse, il cliente vedrebbe il messaggio di Stripe e un ricaricamento della pagina lo riporterebbe sulla strada giusta. Il ramo `processing` non si raggiunge con i soli pagamenti con carta, e il rischio vero (integrazione Stripe, 3DS) è coperto dagli smoke manuali dei pagamenti. Un test riscriverebbe il codice con tre dipendenze nuove.

## 9. Note minori non verificate una per una

Gli agenti le hanno viste e scartate perché più piccole, senza una verifica avversariale dedicata. Prima di lavorarci, ricontrollale.

**API**
- Lista e mappa dei negozi del customer: select e card copiati ×2, calcolo della distanza ×3, raggio ×2 (il #183 le ha toccate entrambe).
- Ora di Roma calcolata in 4 punti (`store-open-status.ts`, `holidays/open-status.ts`, `closures.ts`).
- `try/catch` uguale nei 5 cron.
- Regola di visibilità del negozio riscritta in `cart.ts` (documentata nel codice).
- Body di `/register/customer` uguale a quello di `/register/seller`; paginazione a mano in 2 servizi; approva e rifiuta richiesta con lo stesso CAS ×2; classificazione dei prodotti in massa ×2; ricarica del profilo in onboarding e impostazioni ×6; nome completo ×2; disdetta dell'abbonamento orfano ×2 nei webhook.
- Errore di Postgres «spacchettato» in 3 punti con profondità diverse; due rami gemelli in `resolveSellerAccess`; tipo dell'utente ripetuto in 4 context; triple `sortBy`/`sortOrder` e lat/lng in `queries.ts`; `DiscountProductsBody` uguale a `BulkDeleteBody`; terza copia dell'inserimento del brand in `product-import.ts`.
- 4 endpoint senza interfaccia (`pricing/history`, `profile/vat`, `settings/personal`, `settings/document`): scelta di prodotto, non codice morto.

**Regole tra API e frontend (oggi coincidono)**
- Aliquote IVA 22/10/5/4/0 scritte in admin ×2 e seller ×1; paginazione 100/20; limiti degli indirizzi del customer; tempo residuo «h/min» ×2; regex della P.IVA nel dialog; specchio del filtro SQL delle promozioni nel form.

**Frontend**
- Forma giuridica: testo libero nel profilo, elenco chiuso nell'onboarding.
- `DataTableFooter` collegato al router a mano ×5 e ordinamento nell'URL ×4 (il kit è senza router per scelta).
- `SearchField` del customer quasi uguale a `SearchInput` di `@bibs/ui`; toni dei badge copiati da `tab-nav`; skeleton e «Carica altri» ripetuti nel customer; `KeepSizeInSync` ×2.

**Test**
- Catena di fixture venditore → negozio → prodotto → stock ripetuta 66 volte in 21 file; reset della lingua e `cleanup()` copiati in 33 e 8 file dei frontend (servirebbe un `setupFiles` per app); `seedAdmin` ×2 (manca `createTestAdmin`); resolve finta dall'header `x-test-user` ×4; wrapper di una riga `createTestMunicipalityNamed`.
- Frasi intere nelle attese di `category-configs`; il «doppio click» di `connect-account` è in realtà un test di idempotenza.
- Test frontend mancanti, più piccoli: IVA tenuta al cambio di categoria (#195, serve il render del form prodotto), segno di «Sottrai» in massa, titolo della pagina finale (#253), team pagina 1, importo delle fatture, redirect dell'onboarding, polling che duplica `donePageState`, `buyableGroups`.
- API: caso normale e limite delle immagini del negozio, impostazioni personali, azienda e documento, polling dello stato del checkout (il test del webhook non controlla `pending.stripeSubscriptionId`), CRUD delle categorie admin, `/points` e `/profile`, portale billing, `/ready`, telefoni nel `checkout-completed`.
- Ancora aperti nel backlog (P5): test di `X-Forwarded-For`/`x-real-ip` (`plugins/better-auth.ts`, mai eseguito) e sotto-categorie con lo stesso nome nel report «missing».

**CI e velocità**
- `fsync=off` sul container di test (pochi secondi); cache di `bun install` (23 s a job, guadagno non misurato); 2 test di badge admin in jsdom che potrebbero usare `renderToStaticMarkup`; import di testcontainers in ogni file (~150 ms); Postgres con la sola estensione postgis (~0,8 s a file, assorbito dal n. 11).
- Nessun controllo che ogni chiave di traduzione abbia l'inglese; `/openapi/json` mai chiesto in CI; nessun controllo axe a runtime.

## 10. Metodo e limiti

**Come è stato fatto**

1. **Ricerca.** 12 agenti in parallelo, uno per tema: copie nel guscio dei frontend, copie nelle funzionalità dei frontend, copie nei servizi API, copie in route e schemi API, regole scritte in più livelli, bug nel codice cambiato dal 2026-09-24, copie nei test, efficacia dei test, completezza dei test frontend, completezza per livello, velocità dei test, copertura API. Risultato: 87 finding.
2. **Verifica avversariale.** Per ogni tema un secondo agente ha provato a smontare i finding leggendo il codice e, dove serviva, riproducendoli con piccoli script: 46 confermati, 40 confermati con correzioni (casi, righe o stime), 1 scartato.
3. **Seconda verifica dei più gravi.** I 14 finding ancora «da correggere subito» sono stati ricontrollati da un altro agente: nessuno smentito, 9 restano gravi (7 problemi distinti, i n. 1–7) e 5 sono scesi a «da correggere».
4. **Report completo.** Un secondo giro di agenti ha scritto le voci della sezione 4, verificato i problemi visti di passaggio (sezione 5) e ricontrollato percorsi e affermazioni dei 20 finding numerati.

**Misure ed esperimenti** (tutti fuori dal repo, in una cartella temporanea):
- suite completa in locale con i tempi di ogni parte, e run completo dell'API con la copertura (`bun test --coverage`, report lcov);
- log della CI con `gh` (run 38131278805 e durate degli ultimi run);
- jscpd 4.0.5 su sorgente e test;
- svuotamento del DB e database modello provati su un container Postgres usa e getta, poi rimosso;
- prove con `bun build` (NODE_ENV), con Elysia (plugin `normalize`, chiavi in più nel body, `maxLength`), con better-auth e con il fuso `Europe/Rome` in Node;
- `biome lint` con le regole React forzate.

**Limiti**
- Nessuna prova nel browser e nessun deploy.
- Seed, `db:generate`, build Docker e typecheck non lanciati con le correzioni.
- Corpi dei test di integrazione, pagine grandi del seller, fixture del seed, template email e geocoding letti solo in parte.
- Le stime di righe e secondi sono calcoli, non diff veri.
- La sezione 9 non è verificata voce per voce.
