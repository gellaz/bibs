# Seed selettivo, pulizia Stripe e dati del seed aggiornati — design

**Date:** 2026-10-17
**Status:** in revisione
**Riferimenti:** i percorsi puntano a `main` @ `06e14cb` (dopo #269). Il seed vive in
`apps/api/src/db/seed/`, l'entrypoint è `apps/api/src/scripts/seed.ts`.

## Problema

1. **Il seed è tutto o niente.** `bun run db:seed` carica dati di base + 16 fixture in ordine fisso
   (`fixtures/index.ts`). Marco vuole un ambiente senza seller per creare a mano un seller e seguire
   tutto il flusso — registrazione, documento, verifica email, Connect, abbonamento, prodotti, primo
   ordine — vedendo su Stripe solo ciò che genera in quel giro.
2. **La dashboard Stripe è sporca.** Il seed non scrive niente su Stripe (gli id che inserisce sono
   finti: `cus_seed_…`, `sub_seed_…`): lo sporco viene dagli smoke manuali. Serve un modo per
   ripartire puliti.
3. **I dati del seed sono rimasti indietro rispetto alle PR recenti.** La ricognizione del
   2026-10-17 (seed completo su un DB vuoto + lettura dei fixture contro le regole correnti) ha
   trovato dati che rompono flussi, dati mostrati male e funzioni senza copertura. Elenco sotto,
   parte C e D.

## Decisioni di prodotto (di Marco)

1. Si sceglie cosa caricare: **tutto** (default, come oggi), **solo customer**, **solo seller**,
   **solo admin**.
2. La pulizia di Stripe è una **procedura documentata**, non un'opzione del seed né uno script.
3. Si correggono **tutti i dieci problemi** della parte C.
4. Delle lacune si coprono **solo quelle economiche** (parte D). Restano fuori le caratteristiche
   obbligatorie (richiedono di cambiare il dizionario CSV) e i pagamenti online / Connect (il seed
   non può creare un account Connect abilitato).
5. **Nessun controllo permanente del seed in CI.** La verifica è uno script usa-e-getta (vedi
   «Verifica»).
6. **Il catalogo del seed è coerente con il tipo di negozio** (una Macelleria vende carne, non pasta
   e tè), e per questo **si cambia il dizionario delle categorie** (`product_categories.csv` e la
   matrice delle caratteristiche), che è anche quello reale dell'admin.

## Obiettivi / non obiettivi

- **Obiettivo:** su un DB appena resettato, ogni modalità di seed produce dati che l'app accetta e
  mostra correttamente, e la modalità «solo customer» lascia Stripe e il back-office seller vuoti.
- **Non obiettivo:** rendere il seed additivo tra modalità diverse (es. `--only=customer` oggi,
  tutto domani sullo stesso DB). I canary probabilmente lo reggono, ma non è garantito né testato:
  la strada supportata è `db:reset`.
- **Anti-obiettivo:** codice dell'app che riconosce i dati del seed (es. `if id.startsWith("sub_seed_")`).
  Il seed si adatta all'app, non il contrario. Unica modifica all'app ammessa: C4, che è un
  comportamento corretto anche in produzione.

## Design

### A. Scegliere cosa caricare

- CLI: `bun run db:seed` = tutto. `bun run db:seed -- --only=<admin|customer|seller>` = un pezzo.
  Un solo valore. Parsing con `parseArgs` di `node:util` (strict): valore sconosciuto → messaggio
  d'uso su stderr ed exit 1, prima di toccare il DB.
- **Sempre caricati**, qualunque modalità: `seedBase()` (comuni, categorie, caratteristiche,
  festività), `seedPricingConfig()`, `seedAdmins()` (3 righe; senza admin non si approva il seller
  creato a mano).
- **Gruppo customer:** `seedCustomers()` + rubrica indirizzi (D2).
- **Gruppo seller:** `seedDevSeller`, `seedSellers`, `seedExtraStores`, `seedBillingSubscriptions`,
  `seedStoreImages`, `seedStoreProfiles`, `seedTeam`, `seedBrands`, `seedProducts`,
  `seedDevSellerCatalog` (senza i suoi ordini, vedi sotto), `seedCharacteristicValues`,
  `seedDiscounts`.
- **Ordini** (`seedOrders()` e gli ordini del catalogo dev, oggi dentro `dev-seller-catalog.ts`):
  solo quando ci sono entrambi i gruppi, cioè solo in «tutto». Gli ordini del catalogo dev vanno
  separati dalla creazione del catalogo così da poterli saltare.
- L'ordine relativo dei fixture resta quello di oggi.
- `db:reset` (root `package.json`) passa l'opzione al seed: `bun run db:reset -- --only=customer`.
  Bun accoda gli argomenti all'ultimo comando della catena; da verificare che arrivino fino a
  `seed.ts` (passano per due `bun run` annidati). Se non arrivano, la soluzione più piccola che
  funziona.
- Il log iniziale dice quale modalità sta girando e quali gruppi salta.

### B. Pulire Stripe (solo documentazione)

Nuova sezione in `docs/stripe-billing.md`, «Ripartire puliti», con questi passi in ordine:

1. Dashboard Stripe, dentro la sandbox delle chiavi `sk_test_…`: **Developers → Overview → Test
   data → Review test data → Delete test data**. Irreversibile; la sandbox resta inutilizzabile
   finché la cancellazione è in corso (fonte: `stripe docs /testing-use-cases`, «Delete test
   data»). Cancella anche il Product/Price dell'abbonamento.
2. `bun run --cwd apps/api stripe:bootstrap` → copia il nuovo `STRIPE_DEV_PRICE_ID` in
   `apps/api/.env`.
3. `bun run db:reset -- --only=customer` (o la modalità che serve).

Perché l'ordine conta: il DB contiene id Stripe (customer, abbonamenti, account Connect, pagamenti);
resettare il DB dopo aver svuotato Stripe evita righe che puntano a oggetti inesistenti, e il seed
ha bisogno del nuovo `STRIPE_DEV_PRICE_ID`. Il webhook in dev passa da `stripe listen`, che non è
toccato.

### C. Correzioni (i dieci problemi)

Ogni voce: sintomo verificato → correzione. «Verificato sul DB» = osservato sul DB di prova.

**C1. Le promozioni dei 95 seller non vengono mai create** (verificato sul DB: 3 sconti, 1
seller). `seedDevSellerCatalog()` crea 3 promo prima di `seedDiscounts()`, il cui canary
(`discounts.ts:186-194`) salta se esiste *qualunque* sconto. Regressione da #202.
→ Il canary non deve scattare per le promo del seller di sviluppo. Approccio a scelta del builder
(canary ristretto ai seller che il fixture popola, oppure spostare il catalogo dev dopo gli sconti
rispettando i vincoli d'ordine in `fixtures/index.ts`).

**C2. I seller a metà registrazione hanno già la riga azienda** (verificato: `organizations` per
tutti i 190). `sellers.ts:386-397` la inserisce per ogni stadio; il flusso vero la crea solo in
`updateCompany` (`modules/seller/services/onboarding.ts:167`) e `organizations.seller_profile_id` è
unique → al passo azienda 409, i 10 seller in `pending_company` non arrivano mai in revisione.
→ Riga azienda (e partita IVA) solo per `pending_review`, `active`, `rejected`.

**C3. Ordini «Paga e ritira» pagati senza pagamento** (verificato: 5 ordini `pay_pickup` senza
`checkout_id`). `orders.ts` forza `pending → confirmed` senza checkout; annullarli chiama
`refundOrderPayment` → 409 «Pagamento dell'ordine non trovato»
(`modules/billing/services/order-payments.ts:117-124`). Inoltre il negozio di seller1 ha
`order_types = {reserve_pickup}` e nessun Connect.
→ Togliere da `orders.ts` tutti i piani `pay_pickup`, come fa già `dev-seller-catalog.ts:497-498`.
Gli stati coperti restano coperti dai piani `reserve_pickup`.

**C4. Annullare/riattivare un negozio del seed → 500.** Gli abbonamenti hanno id finti
(`billing-subscriptions.ts:147`, `dev-seller.ts:130`); `cancelStoreSubscription` /
`reactivateStoreSubscription` (`modules/seller/services/stores.ts:275-360`) chiamano Stripe, che
risponde `resource_missing`, non mappato.
→ **Modifica all'app**, sul precedente di `jobs/auto-cancel-suspended-stores.ts:66-80` («already
canceled / missing on Stripe: the subscription is provably gone»):
- **annulla** (rami `active`/`past_due` e `suspended`): su `resource_missing` l'abbonamento è
  finito → si finalizza in locale come fa il job (stato `canceled`, soft-delete del negozio) e si
  risponde `{ status: "canceled" }`. Nel ramo `suspended` il revert del `cancelReason` non deve
  scattare in questo caso.
- **riattiva**: su `resource_missing` → `ServiceError(409, …)` con un messaggio chiaro
  (l'abbonamento non esiste più, va creato un nuovo negozio).
- Altri errori Stripe: comportamento invariato.
- Test per i nuovi rami (unit con Stripe mockato, come i test esistenti del modulo).
Il portale di fatturazione resta com'è: 404 «Nessun cliente Stripe associato» è corretto per un
seller che non ha mai pagato. Va corretto il commento fuorviante in `billing-subscriptions.ts:58`
(«recoverable via portal»).

**C5. IVA al 22% su quasi tutto** (verificato: 3751 prodotti su 3768). `products.ts:189-200` non
imposta `vatRate`. → Aliquota dalla macro-categoria del prodotto, la stessa che applica il form
seller (`apps/seller/src/features/products/components/product-form.tsx:269-275`; mappa in
`base/categories.ts:52-55`: Alimentari e bevande 10%, Libri e media 4%, il resto 22%), **tranne
gli alcolici** (Vino, Birra, Liquori e distillati, vedi C6): 22%. Le aliquote fini (4% su pane e
latticini) non si modellano: il seed segue il default del form.

**C6. Prodotti nella sotto-categoria sbagliata e caratteristiche contraddittorie.** Nome
(`products.ts:171`, `nouns[i % 12]`) e sotto-categoria (`products.ts:197-200`, `subs[i % 11]`)
sono scelti indipendentemente; la query delle sotto-categorie (`products.ts:99-110`) non ha
`ORDER BY`. `characteristic-values.ts:762-811` pesca valori da pool fissi ignorando il nome.
Esempi: «Cuffie wireless» in Smartphone (con 5G e Dual SIM), «Spaghetti 500 g» con peso netto 1 kg,
«Fusilli senza glutine» con «Materiale: Pelle», «Tagliere» con potenza 300–2000 W.
C'è un secondo livello: 14 tipi di negozio (`prefixToMacro`, `utils.ts:248-288`) pescano tutti
dallo stesso pool «Alimentari e bevande», e quella macro ha solo 11 sotto-categorie (Pasta, Riso,
Conserve, Snack, Dolci, Bevande analcoliche, Succhi, Caffè, Tè, Prodotti bio, Senza glutine):
niente carne, pesce, vino, formaggi, pane. Una Macelleria vende pasta e tè.

→ Criterio di accettazione: **ogni negozio vende solo prodotti che un cliente si aspetta da quel
tipo di negozio, e nessun prodotto ha contraddizioni visibili tra nome, sotto-categoria e
caratteristiche.** Vale per tutti i 41 tipi (`businessPrefixes` + `bolognaPrefixes`) e anche per il
catalogo del seller dev.

**Dizionario (base data, vale in ogni ambiente).** Nuove sotto-categorie in «Alimentari e bevande»
in `data/product_categories.csv`, proposta di partenza (scelta di Claude, da rivedere nella PR):

| Sotto-categoria | Serve a |
|---|---|
| Pane e prodotti da forno | Panificio |
| Carne | Macelleria |
| Salumi | Macelleria, Gastronomia |
| Pesce | Pescheria |
| Formaggi e latticini | Gastronomia, Alimentari |
| Vino | Enoteca, ristorazione, Bar |
| Birra | Enoteca, Bar |
| Liquori e distillati | Enoteca, Bar |
| Gelati | Gelateria |
| Piatti pronti | Gastronomia, Ristorante, Trattoria, Osteria, Pizzeria |
| Olio e condimenti | Alimentari |

Per ognuna, righe nella matrice `data/product_category_characteristics.csv`: le caratteristiche
universali che oggi stanno su tutte le sotto-categorie (Modello, Colore, Materiale, Dimensioni,
Peso, Tipologia, Uso previsto, Compatibilità — scelta di design documentata in
`docs/products/caratteristiche-nota-di-revisione.md` §2–3, non si toccano) più quelle specifiche
del dominio (es. gradazione alcolica, annata, denominazione per il vino; taglio e provenienza per la
carne; stagionatura e tipo di latte per i formaggi; fresco/surgelato per il pesce), nuove voci in
`data/product_characteristics.csv` dove servono, seguendo le regole enum/testo della nota di
revisione. Si corregge anche l'errore trovato: «Macchine caffè» ha caratteristiche alimentari
(Ingredienti, Allergeni, Scadenza/TMC; `product_category_characteristics.csv:710-721`).
`bun run apps/api/src/db/seed/data/validate-characteristics.ts` deve passare; tutte le nuove righe
restano `required=false` (le obbligatorie sono fuori scope).

**Fixture.**
- I pool di nomi passano da «per macro» a **«per tipo di negozio»**: ogni tipo ha il suo pool, e
  ogni voce dichiara la sua coppia macro + sotto-categoria (per nome; i nomi delle sotto-categorie
  non sono unici tra macro, es. «Pennelli»). Un tipo può vendere in più macro (es. Erboristeria:
  tisane in Tè e creme in Bellezza). Query delle sotto-categorie con `ORDER BY`.
- La macro del prodotto (e quindi l'IVA di C5) viene dalla voce, non più da `prefixToMacro`.
- I valori che il nome dichiara (formato, peso) vengono dal nome, o il nome dal valore.
- Non si valorizzano caratteristiche universali che non c'entrano con il prodotto (es. Colore e
  Materiale sugli alimentari, Potenza sugli utensili non elettrici): sono facoltative.
- Rispettare la regola dei «due pool» e dei passi coprimi documentata in `apps/api/AGENTS.md`
  (sezione `utils.ts`): l'assegnazione del tipo ai seller (`prefixForSeller`, `pickHandle`) non
  cambia, cambia solo cosa vende ogni tipo.
- La tabella tipo di negozio → sotto-categorie va nella descrizione della PR, perché Marco la
  rilegga.
- Il rimescolamento del catalogo che ne deriva è accettato (app in dev, si fa `db:reset`).

**C7. Seller in `pending_email` con email già verificata** (verificato: tutti `email_verified =
true`). `sellers.ts:340`; l'uscita da `pending_email` passa solo da `afterEmailVerification`
(`lib/auth.ts:129-147`) → restano su «controlla la tua email» e il flusso #268 (`?verified=1`) non
si prova. Insieme: `sellers.ts:329` registra tutti con «Nome Cognome», mentre la registrazione vera
mette la parte locale dell'email (`modules/registration/services.ts:107`) e solo il passo dati
personali la riscrive (`onboarding.ts:80`).
→ `emailVerified: false` per `pending_email`; `name` = parte locale dell'email per `pending_email`
e `pending_personal`.

**C8. Le prenotazioni aperte scadono 48 h dopo il seed.** Il cron `expireReservations`
(`plugins/cron.ts:12-14`, `reservationHours: 48` in `lib/config.ts:7`) porta a `expired` gli
ordini `reserve_pickup` confermati/pronti di `orders.ts` e del catalogo dev.
→ Il seed sposta `reservationExpiresAt` delle prenotazioni aperte a ~30 giorni dalla data del seed,
così il DB di dev resta usabile per settimane. Verificare che le pagine che mostrano la scadenza
(seller `orders/index.tsx`, `orders/$orderId.tsx`; customer `orders/index.tsx`,
`orders/$orderId.tsx`) non abbiano problemi con una data lontana. Le prenotazioni volutamente
scadute (`orders.ts:142`, `dev-seller-catalog.ts:562`) restano come sono.

**C9. Ordini intestati a customer100…110** (verificato). La scelta è
`orderBy(asc(user.email)).limit(12)` (`orders.ts:83-85`, `dev-seller-catalog.ts:529-531`), ordine
alfabetico. → Customer scelti per email esplicita a partire da `customer1@test.com`, così i login
di sviluppo con i punti (`customers.ts:15-19`) hanno ordini.

**C10. Date dei negozi tutte uguali** (verificato: 117 negozi su 119 con lo stesso `created_at`).
Un solo INSERT per lotto (`sellers.ts:417`, `extra-stores.ts:232`, `dev-seller.ts:100`) → stesso
`now()`. Il negozio eliminato risulta «creato oggi, eliminato 14 giorni fa»
(`billing-subscriptions.ts:71-74,175-178`).
→ `createdAt` esplicito e deterministico per indice, sparso sugli ultimi ~12 mesi; per il negozio
eliminato, `createdAt` precedente a `currentPeriodEnd`/`canceledAt`/`deletedAt`. Le date collegate
si spostano con lui, altrimenti la contraddizione si sposta sulle liste admin (seller
`sellers/index.tsx:268`, abbonamenti `billing/subscriptions.tsx:115`): `user.createdAt` e
`seller_profiles.created_at` del seller ≤ `createdAt` del suo primo negozio ≤
`store_subscriptions.created_at` (in `sellers.ts`, `dev-seller.ts`, `billing-subscriptions.ts`);
l'abbonamento annullato è creato prima di `canceledAt`. Lo script di verifica controlla questa
catena. Insieme:
`ORDER BY` nella query di `billing-subscriptions.ts:93`, così gli stati misti cadono sempre sugli
stessi negozi.

### D. Lacune coperte (solo quelle economiche)

**D1. Foto del documento e tipi di documento.** Nessun seller ha `documentImageKey/Url`
(`sellers.ts:357-381`, `dev-seller.ts:66-84`) → in revisione l'admin non vede il link «Vedi
documento» (`apps/admin/src/routes/_authenticated/sellers/$sellerId.tsx:208`). Tutti gli
`identity_card` usano il formato cartaceo `AX0000001`; nessuna patente.
→ Foto segnaposto (URL pubblico, stesso schema dei segnaposto immagine già usati dal seed; l'URL è
pubblico, vedi `publicUrl(key)` in `modules/seller/services/settings.ts:360`) per ogni seller da
`pending_review` in poi e per il seller dev. Numeri: CIE elettronica (`CA12345AB`) per la maggior
parte delle carte, qualche cartacea, qualche patente (`U1…`), passaporti come oggi; tutti validi
per `isValidDocumentNumber` (`lib/schemas/forms/identity-document.ts`).

**D2. Rubrica indirizzi (#262).** Nessuna riga in `customer_addresses` (`db/schemas/address.ts`).
→ 1–3 indirizzi per `customer1…5` e per una parte degli altri, con `location` e comune validi
(riusare le ancore geografiche di `utils.ts`, area Bologna inclusa, così l'origine di ricerca
«indirizzo salvato» del customer produce risultati).

**D3. Scorte basse ed esaurite per i seller generati.** `products.ts:270` dà stock 5–54 → le
regole della home seller (`modules/seller/services/dashboard.ts:114-118`) non scattano.
→ Una piccola quota di righe `store_products` a 0 e tra 1 e soglia−1 per i seller generati,
evitando i prodotti che usano gli ordini (che pescano stock > 5).

**D4. Stati del negozio mai visti.**
→ Un negozio senza posizione (avviso #204 nella home seller), un negozio vivo senza foto (fallback
della copertina customer), un negozio vivo senza abbonamento (tab «none» della lista negozi
admin). Su seller diversi da quelli usati da ordini/team/sconti, così non si tocca altro.

## Fuori scope (trovati, da discutere a parte)

- **Caratteristiche obbligatorie.** Nessuna lo è (`required=false` ovunque, imposto dal controllo 7
  di `data/validate-characteristics.ts`), quindi la regola di #187 non si vede in dev.
- **IVA di default per sotto-categoria nel form seller.** Il form propone l'aliquota della macro
  (`base/categories.ts:52-55`): un seller vero che crea un «Vino» si vede proporre il 10% invece
  del 22%. È codice dell'app, non del seed.
- **Pagamenti online nel seed** (Connect, checkout, ordini `pending` da pagare, punti spesi negli
  ordini): richiedono oggetti Stripe veri.
- **Altri stati non coperti:** richieste di modifica dati seller (`seller_profile_changes`),
  dipendenti `banned`/`removed`, utenti bannati, avatar, scadenza inviti realistica.
- **Commento stantio** in `store-images.ts:22-23` su `extractOurKey` (che vive solo in
  `me/services/avatar.ts`): si corregge se si passa di lì, non è un obiettivo.

## Documentazione da aggiornare

- `AGENTS.md` (comandi, riga `db:seed` / `db:reset`): l'opzione `--only`.
- `apps/api/AGENTS.md`, sezione `src/db/seed/`: gruppi, ordini solo in «tutto», e le voci dei
  fixture cambiati (C2, C3, C5, C6, C7, C8, C10, D1–D4).
- `docs/stripe-billing.md`: sezione «Ripartire puliti» (parte B).
- `docs/products/caratteristiche-nota-di-revisione.md`: i conteggi delle sotto-categorie e le
  nuove voci del dizionario (C6).

## Verifica

- DB di prova separato sullo stesso Postgres locale, mai il DB di sviluppo: `bibs_seedcheck`,
  ricreato vuoto a ogni giro (`CREATE DATABASE`, poi `CREATE EXTENSION postgis; CREATE EXTENSION
  pg_trgm;` — le estensioni le crea l'init del container solo su `bibs-db` — poi
  `drizzle-kit migrate` e seed con `DATABASE_URL` puntato lì).
- Seed in tutte e quattro le modalità, ognuna su un DB vuoto: exit 0, nessun «already seeded» su DB
  vuoto, conteggi attesi per gruppo (es. `--only=customer`: zero `seller_profiles`, `stores`,
  `orders`; admin e customer presenti).
- Script usa-e-getta in `apps/api/src/scripts/` (poi cancellato) che rilegge il DB e controlla
  ogni voce C/D con le regole dell'app: `isValidDocumentNumber`, stadio ↔ riga azienda ↔
  `emailVerified`, aliquota ↔ macro-categoria, nessun `pay_pickup` senza checkout, scadenze delle
  prenotazioni aperte, destinatari degli ordini, dispersione di `created_at`, istogrammi di stock e
  indirizzi. Per C6: stampa di un campione nome / sotto-categoria / caratteristiche per macro da
  leggere a occhio.
- C4: test automatici dei nuovi rami; `bun run test` (non `bun test` nudo) in `apps/api`.
- `bun run typecheck` e `bun run lint` dalla root.
- `bun run db:reset -- --only=customer` lanciato davvero almeno una volta (sul DB di sviluppo solo
  con l'ok di Marco).
- A fine lavoro: `DROP DATABASE bibs_seedcheck`.

## Scelte del builder / scelte fatte da Claude (da rivedere)

- **C4 tocca l'app**: annullare un abbonamento che su Stripe non esiste più lo chiude in locale
  (come già fa il job), riattivarlo dà un 409 chiaro. Alternativa scartata: creare abbonamenti
  Stripe veri dal seed (sporca Stripe, lento, serve un metodo di pagamento).
- **Portale di fatturazione invariato** (404 corretto), si corregge solo il commento.
- **C3 toglie tutti gli ordini `pay_pickup`** dal seed, anche quello annullato.
- **C7 include il nome** dei seller nei primi passi (non era nella lista dei dieci, stessa causa).
- **C10 include l'`ORDER BY`** di `billing-subscriptions.ts` e sposta anche le date di
  registrazione dei seller e di creazione degli abbonamenti, coerenti con quella del negozio.
- **C6: l'elenco delle 11 nuove sotto-categorie** e la correzione di «Macchine caffè» nel
  dizionario; le caratteristiche universali restano su tutto (scelta della nota di revisione).
- **C5: alcolici al 22%** nel seed; il default del form seller per macro resta (fuori scope).
- **Admin sempre caricati**, quindi «solo admin» = dati di base + pricing + admin.
- Come risolvere C1 e come strutturare C6: lasciato al builder entro i criteri sopra.
