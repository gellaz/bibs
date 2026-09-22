# Caratteristiche di prodotto per categoria — design

**Date:** 2026-09-22
**Status:** proposed
**Riferimenti:** i riferimenti `file:riga` puntano allo stato pre-implementazione (base `c790333`)
**Branch:** `feat/product-characteristics`
**Fonte dati:** foglio `Categorie_caratteristiche.xlsx` (Google Drive, condiviso con `marco.gelli@3di.it`)

## Problema

Un prodotto su bibs oggi è nome, descrizione, EAN, marca, prezzo, IVA e categorie.
Non c'è modo di dire che quello smartphone ha 8 GB di RAM, che quelle scarpe sono
del 38, che quella passata di pomodoro contiene sedano. Il seller non ha dove
scriverlo, il cliente non ha dove leggerlo, e il giorno in cui vorremo far
filtrare il catalogo per taglia o per colore non avremo nulla su cui filtrare.

Il foglio `Categorie_caratteristiche.xlsx` definisce quali informazioni servono
per ciascuna coppia (macro-categoria, sotto-categoria). Questo documento descrive
come portarlo dentro l'applicativo.

### Cosa c'è già, e non va rifatto

La prima metà della richiesta — «macro e sotto-categorie gestite
dall'amministratore» — è in larga parte realizzata:

- `product_macro_categories` e `product_categories`
  (`apps/api/src/db/schemas/product-macro-category.ts:8`,
  `apps/api/src/db/schemas/category.ts:7`), con vincolo di unicità su
  (macro, nome);
- CRUD admin completo per entrambe, attraverso il pannello config-driven
  `CategoryCrudPanel` (`apps/admin/src/features/crud/category-crud-panel.tsx:139`)
  e le due configurazioni in `apps/admin/src/features/product-categories/` e
  `product-macro-categories/`;
- import CSV idempotente `macro_category, subcategory`
  (`apps/api/src/modules/admin/services/category-import.ts:37`), usato anche dal
  seed (`apps/api/src/db/seed/base/categories.ts:33`).

Il foglio `Cat_prod` contiene 179 coppie su 14 macro-categorie ed è **identico,
riga per riga e nello stesso ordine**, a `apps/api/src/db/seed/data/product_categories.csv`.
Su quel fronte non c'è nulla da fare.

### Cosa manca

Le caratteristiche. Nel repo non esiste alcuna traccia di attributi di prodotto:
nessuna tabella, nessun modulo, nessuna rotta.

## I dati di partenza

Il file ha quattro fogli, che sono la tassonomia più **tre viste dello stesso
fatto**:

| Foglio | Contenuto | Uso |
|---|---|---|
| `Cat_prod` | 179 coppie (macro, sotto) | già nel database |
| `Matrice` | 179 righe × 200 caratteristiche, marcate `X` | vista larga |
| `Mapping` | 1952 righe `(macro, sotto, caratteristica, Sì)` | **forma normalizzata, sorgente dell'import** |
| `Dizionario` | 200 caratteristiche con diffusione | vista calcolata, non importata |

`Matrice` e `Mapping` sono stati confrontati cella per cella: **zero discrepanze**.
`Mapping` è già nella forma che serve all'import, quindi è da lì che partiamo.

Distribuzione: da 9 a 21 caratteristiche per coppia, mediana 10. Sei caratteristiche
sono universali (presenti su tutte e 179): `Marca`, `Modello`, `Colore`,
`Materiale`, `Dimensioni`, `Peso`. La coda è lunga: 127 caratteristiche su 200
compaiono in due categorie o meno.

### Cosa il foglio non dice

1. **Nessun tipo di dato.** `5G` è un sì/no, `Peso` è un numero con unità,
   `Colore` è una lista chiusa, `Ingredienti` è prosa — nel foglio sono
   indistinguibili. Senza questo strato il seller compila dieci caselle di testo
   libero, e il testo libero non si filtra né si confronta.
2. **Nessun valore ammesso** per ciò che è a lista chiusa.
3. **Nessuna obbligatorietà.**

Questo strato va redatto (§ Dizionario tipizzato) e sottoposto a revisione.

### Problemi noti nei dati, da correggere in revisione

- **`Marca` duplica un campo esistente**: `products.brandId`
  (`apps/api/src/db/schemas/product.ts:33`) con la sua tabella `brands`. Esce dal
  dizionario.
- **Quasi-duplicati semantici**: `Taglia` / `Taglia\|Misura`, `Tipo pelle` /
  `Tipo pelle\|capelli`, `Materiale` universale più cinque varianti specifiche
  (`Materiale tomaia`, `Materiale suola`, `Materiale telaio`, …), `Colore` /
  `Colore\|Monocromatica`.
- **Applicabilità discutibili**: `Colore`, `Materiale` e `Peso` sono marcate anche
  su *Pasta* e *Riso*, dove non significano niente. Alcune sotto-categorie
  (es. *Conserve*) hanno solo le sei universali più il terzetto generico
  `Tipologia` / `Uso previsto` / `Compatibilità`, che sembra un riempitivo.

Nessuno di questi blocca il progetto: si correggono nel CSV rivisto.

## Decisioni

Prese in fase di brainstorming, elencate qui perché il piano di implementazione
non le rimetta in discussione.

| # | Decisione | Motivo |
|---|---|---|
| D1 | Schema **tipizzato dal primo giorno**, scheda prodotto adesso, filtri customer dopo | accendere i filtri più avanti non deve richiedere né una migrazione né una ricompilazione da parte dei seller |
| D2 | Un prodotto appartiene a **una sola sotto-categoria** | la matrice è per singola coppia; l'unione su più sotto-categorie gonfia il form, l'intersezione lo svuota |
| D3 | Il tipo vive sulla **caratteristica** (dizionario globale), non sulla coppia | 200 voci da tipizzare invece di 1952; i filtri trasversali restano possibili |
| D4 | I conflitti di dominio si risolvono **sdoppiando la voce** nel dizionario | invece di un meccanismo di override per categoria; il foglio già lo fa (`Materiale tomaia` / `Materiale suola`). Il criterio è **se cambia la lista dei valori ammessi**, non se la voce compare sotto macro diverse — `Sistema operativo` copre smartwatch ed smartphone con lo stesso significato. Vedi § Sdoppiamenti |
| D5 | Gestione admin: **import CSV per il grosso, interfaccia per i ritocchi** | ricalca il modello già in uso per le categorie |
| D6 | Import matrice **solo additivo**, con rapporto di divergenza | il giorno 1 additivo e sostitutivo coincidono; il sostitutivo introduce una modalità distruttiva che fra sei mesi qualcuno accende senza ricordarne la semantica. La divergenza va **segnalata**, non risolta cancellando |
| D7 | Import dizionario **in aggiornamento** | correggere un errore di tipizzazione deve poter passare dal CSV |
| D8 | Alla partenza **tutte le caratteristiche facoltative** | imporre dieci campi a chi carica un catalogo è il modo più rapido per far abbandonare l'inserimento |
| D9 | `ON DELETE RESTRICT` sulla categoria del prodotto | cancellare una categoria in uso dev'essere un errore esplicito, non uno svuotamento silenzioso |
| D10 | **Nessun valore dormiente**, mai | le caratteristiche di un prodotto sono esattamente quelle della sua sotto-categoria. Ogni uscita dalla matrice cancella i valori, dietro conferma informata |
| D11 | Le cinque universali restanti restano caratteristiche, non colonne di `products` | l'admin può disattivarle dove non hanno senso senza una migrazione |

### Esplicitamente fuori ambito

- Override delle opzioni per categoria (superato da D4).
- Storico delle modifiche alla matrice.
- Traduzione dei nomi di caratteristica: vengono dal database, come i nomi di
  categoria oggi, e restano in italiano.
- Riordino dei campi dall'interfaccia admin: la colonna `sortOrder` esiste e si
  popola dall'ordine del CSV, ma non si espone nella prima passata.
- Caratteristiche nel caricamento massivo prodotti
  (`apps/api/src/modules/seller/services/product-import.ts`): aggiungere ~195
  colonne opzionali a quel CSV è un progetto a sé.
- Filtri e facet customer sulle caratteristiche: abilitati dallo schema, non
  realizzati qui.

## Modello dati

### Tabelle nuove

**`product_characteristics`** — il dizionario, ~195 righe.

| colonna | tipo | note |
|---|---|---|
| `id` | text PK | `crypto.randomUUID()`, come le altre entità |
| `name` | text NOT NULL UNIQUE | |
| `data_type` | text NOT NULL | `text` \| `number` \| `boolean` \| `enum` |
| `unit` | text | solo per `number` (es. `g`, `cm`, `W`, `mAh`) |
| `created_at` / `updated_at` | timestamptz NOT NULL | |

Vincoli: `CHECK` sui valori ammessi di `data_type` (convenzione di casa:
`text({ enum })` più `CHECK`, non `pgEnum`); `CHECK` che `unit` sia valorizzata
solo quando `data_type = 'number'`; `UNIQUE (id, data_type)` a servizio della
chiave esterna composta descritta più sotto.

**`product_characteristic_options`** — valori ammessi delle liste chiuse.

| colonna | tipo | note |
|---|---|---|
| `id` | text PK | |
| `characteristic_id` | text NOT NULL FK → `product_characteristics.id` | `ON DELETE CASCADE` |
| `value` | text NOT NULL | |
| `sort_order` | integer NOT NULL | ordine di presentazione |

`UNIQUE (characteristic_id, value)`. Righe esistono solo per `data_type = 'enum'`.

**`product_category_characteristics`** — la matrice, 1952 righe all'import.
È il foglio `Mapping` uno a uno.

| colonna | tipo | note |
|---|---|---|
| `product_category_id` | text NOT NULL FK → `product_categories.id` | `ON DELETE CASCADE` |
| `characteristic_id` | text NOT NULL FK → `product_characteristics.id` | `ON DELETE CASCADE` |
| `required` | boolean NOT NULL DEFAULT false | |
| `sort_order` | integer NOT NULL | dall'ordine di riga del CSV |

PK `(product_category_id, characteristic_id)`, indice su `characteristic_id`
(la PK non lo copre: è la colonna di destra).

**`product_characteristic_values`** — i valori compilati dal seller.

| colonna | tipo | note |
|---|---|---|
| `product_id` | text NOT NULL FK → `products.id` | `ON DELETE CASCADE` |
| `characteristic_id` | text NOT NULL FK → `product_characteristics.id` | `ON DELETE RESTRICT` |
| `data_type` | text NOT NULL | copia denormalizzata dal dizionario |
| `value_text` | text | |
| `value_number` | numeric(14,4) | |
| `value_boolean` | boolean | |
| `option_id` | text FK → `product_characteristic_options.id` | `ON DELETE RESTRICT` |

PK `(product_id, characteristic_id)`, indice su `characteristic_id`.

Due vincoli sorreggono la copia di `data_type`:

1. **chiave esterna composta** `(characteristic_id, data_type)` →
   `product_characteristics (id, data_type)`: la copia non può divergere
   dall'originale, e cambiare il tipo di una caratteristica che ha già valori
   viene rifiutato dal database invece di corrompere le righe;
2. **`CHECK`** che impone valorizzata la colonna corrispondente al tipo **e solo
   quella**. Un numero non può finire nella colonna di testo nemmeno per un bug
   nel service.

È lo stesso stile dei vincoli già in uso su IVA e giacenze
(`apps/api/src/db/schemas/product.ts:74`, `:158`).

### Modifica a `products`

Sparisce `product_category_assignments` (`apps/api/src/db/schemas/product.ts:102`).
Arriva `products.product_category_id`, **nullable**, FK verso
`product_categories.id` con `ON DELETE RESTRICT`, più il suo indice.

Nullable perché oggi un prodotto può esistere senza categoria e i test lo
verificano (`apps/api/tests/integration/seller-products.test.ts:232`).

La macro-categoria **non** diventa una colonna: già oggi non lo è, si ricava
dalla sotto-categoria attraverso `product_categories.macro_category_id`. Nessun
prodotto ha oggi una macro senza sotto-categoria, quindi non si perde nulla.

`RESTRICT` richiede una guardia applicativa: il gestore errori globale riconosce
solo le violazioni di unicità (`apps/api/src/lib/errors.ts:75`), quindi una
violazione di chiave esterna cadrebbe in un 500. Il service di cancellazione
categoria conta prima i prodotti e solleva `ServiceError(409, …)` con il numero
dentro — «non eliminabile: 412 prodotti la usano» è un messaggio utile,
«violazione di vincolo» no.

### Invariante centrale (D10)

> I valori di un prodotto sono esattamente quelli previsti dalla matrice della
> sua sotto-categoria. Non esistono valori fuori matrice.

Quattro atti possono romperla, e tutti la ripristinano cancellando, nella stessa
transazione dell'atto, dietro conferma dimensionata al danno:

| Atto | Chi | Conferma |
|---|---|---|
| cambio di sotto-categoria di un prodotto | seller | «Cambiando categoria perderai 6 valori già compilati», con i nomi |
| rimozione di una caratteristica dalla matrice | admin | «questa caratteristica ha valori su 412 prodotti: verranno eliminati definitivamente» |
| cancellazione di una caratteristica dal dizionario | admin | come sopra |
| rimozione di un valore dalla lista di una caratteristica | admin | «37 prodotti hanno questo valore: verrà eliminato dalle loro schede» |

**Come convivono le conferme e i `RESTRICT`.** Le due chiavi esterne uscenti da
`product_characteristic_values` (`characteristic_id` e `option_id`) sono a
`RESTRICT`: non sono in contraddizione con la cancellazione dietro conferma, ne
sono la rete di sicurezza. Il service, dentro la transazione, cancella **prima**
i valori e **poi** la definizione; il `RESTRICT` esiste perché un percorso che si
dimenticasse quel primo passo fallisca rumorosamente invece di lasciare righe
orfane.

L'invariante vive nel **service, dentro la transazione**, non in un vincolo del
database: per imporla in SQL servirebbe duplicare la categoria del prodotto sulla
riga del valore e una chiave esterna composta, e l'effetto sarebbe che il cambio
di categoria *fallisce* invece di ripulire. La conferma vive comunque nel
service, quindi è lì che va anche la pulizia.

Conseguenza sulla lettura: non serve filtrare i valori sulla matrice corrente,
perché valori fuori matrice non possono esistere. Il join sulla matrice resta
comunque il modo naturale di ottenere etichette, tipo e ordine.

## Dizionario tipizzato

### I due CSV

Accanto a quelli esistenti in `apps/api/src/db/seed/data/`:

**`product_characteristics.csv`** → `name, data_type, unit, options`
(opzioni separate da `|` nella stessa cella). ~195 righe: le 200 del foglio,
meno `Marca`, più le voci nate dagli sdoppiamenti.

**`product_category_characteristics.csv`** → `macro_category, subcategory,
characteristic, required`. Il foglio `Mapping` con una colonna in più, 1952 righe.
La colonna `required` esiste ed è letta dall'import, ma il file redatto esce con
tutte le righe a `false` (D8): l'obbligatorietà si accende dall'admin, mirata,
quando serve.

### Come viene redatta la tipizzazione

Le 200 voci ricadono in quattro famiglie:

- **sì/no** — `5G`, `Dual SIM`, `Impermeabile`, `No Frost`, `Fronte-retro`,
  `Montaggio richiesto`, `Runflat`, `Dimmerabile`, …
- **numero con unità** — `Peso` (g), `Potenza` (W), `Capacità batteria` (mAh),
  `Dimensione display` (pollici), `Rumorosità` (dB), `Autonomia` (h), … più i
  conteggi interi senza unità (`Numero porte`, `Numero pezzi`)
- **lista chiusa** — `Colore`, `Genere`, `Stagione`, `Classe energetica`,
  `Grado IP`, `Tipo chiusura`, `Materiale`, …
- **testo** — solo ciò che è davvero prosa: `Modello`, `Ingredienti`,
  `Avvertenze`, `Valori nutrizionali`, `Compatibilità`

### Sdoppiamenti

Il caso peggiore è `Taglia`, presente su 17 sotto-categorie con **cinque sistemi
di valori incompatibili**:

| Sotto-categorie | Valori |
|---|---|
| Abbigliamento uomo/donna/bambino, Intimo, Pigiami, Costumi da bagno | XS–XXL |
| Scarpe uomo, Scarpe donna, Sneakers | 35–48 |
| Borse, Zaini, Valigie | piccola/media/grande, o litri |
| Occhiali da sole, Cinture, Cappelli, Gioielli | calibro, cm di vita, cm di testa, misura anello |
| Pannolini | 1–6, per fasce di peso |

`Taglia/Misura` è invece una voce distinta già nel foglio, su 9 sotto-categorie
sportive. `Materiale`, presente su tutte e 179, e i tre generici `Tipologia` (66),
`Uso previsto` (60) e `Compatibilità` (75) attraversano domini troppo lontani
perché una lista chiusa unica abbia senso: sono i candidati naturali a restare
testo libero, o a essere sdoppiati.

Insieme ai file va scritta una **nota di revisione** che elenca le sole decisioni
non ovvie — circa quaranta: gli sdoppiamenti (D4), le liste di valori inventate
che vanno confermate (`Colore`: quante tonalità? `Materiale`: quale
granularità?), e le applicabilità sospette già citate. Serve a far correggere in
una passata sola, senza leggere 200 righe di CSV.

## Import

Due endpoint ricalcati su `apps/api/src/modules/admin/routes/category-imports.ts`,
stessa forma di risposta (`CsvImportResultSchema`: creati / saltati / falliti più
gli errori con numero di riga), stessa idempotenza:

- `POST /admin/product-characteristics/import` — **in aggiornamento** (D7): una
  riga il cui `name` esiste già aggiorna tipo, unità e opzioni.

  Un caso va gestito esplicitamente, perché il database lo rifiuterà comunque:
  cambiare il `data_type` di una caratteristica che ha già valori viola la chiave
  esterna composta. L'import non deve provarci e schiantarsi: rileva la
  situazione e la riporta fra gli errori di riga con il conto — «`Peso`: tipo da
  `text` a `number` rifiutato, 1 240 prodotti hanno già un valore» — lasciando
  passare tutte le altre righe. Cambiare il tipo di una caratteristica in uso è
  un atto deliberato e passa dall'interfaccia admin, con la conferma di D10 che
  cancella i valori esistenti.
- `POST /admin/product-category-characteristics/import` — **solo additivo** (D6),
  con in più nel risultato l'elenco delle **righe presenti nel database e assenti
  dal file**, raggruppate per sotto-categoria. Il confronto si calcola comunque
  per decidere cosa inserire, quindi riportarlo non costa nulla.

Il seed riusa i service di import come già fa `seedProductCategories()`
(`apps/api/src/db/seed/base/categories.ts:33`), e popola valori veri su una fetta
dei prodotti finti: senza, la scheda prodotto e i futuri filtri si collaudano sul
vuoto. Attenzione ai passi coprimi nella distribuzione dei valori, e verifica a
secco con istogramma.

## Admin

**Dizionario** — quinta configurazione di `CategoryCrudPanel`, che è già
config-driven e la cui forma di entità (`id`, `name`, `createdAt`) combacia:

- colonne extra **Tipo** e **Unità**, con anteprima dei primi valori per le liste
  chiuse;
- filtro di barra per tipo (al posto del filtro per macro);
- form adattivo: `unit` solo con *numero*, editor delle opzioni solo con *lista
  chiusa*;
- import CSV agganciato al nuovo endpoint, finestra già esistente.

**Matrice** — attaccata alla pagina delle sotto-categorie, che è dove uno la
cerca. Il pannello condiviso **non** ha un punto di estensione per le azioni di
riga (modifica ed eliminazione sono fisse), ma `extraColumns` accetta celle
arbitrarie: la colonna del conteggio diventa essa stessa il comando — una
pastiglia `17 caratteristiche` cliccabile che fa da indicatore e da affordance,
lasciando intatto `CategoryCrudPanel`.

Il pannello che si apre è **una sola tabella** con tutte le ~195 caratteristiche
e lo stato sulla riga, schede **Tutte / Incluse** e ricerca — non due riquadri
affiancati. Ogni riga porta l'interruttore di inclusione e, quando è inclusa,
quello di obbligatorietà. Togliere l'inclusione passa dalla conferma di D10.

Due trappole note:

- il conteggio per categoria è una **sottoquery correlata** sulla lista delle
  sotto-categorie: le colonne nude dentro un template `sql` usato come campo
  SELECT escono senza qualificazione e la correlazione si rompe in silenzio. Va
  scritta con alias interno e riferimento letterale;
- il pannello possiede lo stato di una tabella TanStack, quindi porta
  `"use no memo"` come prima istruzione, come già fa `CategoryCrudPanel`
  (`apps/admin/src/features/crud/category-crud-panel.tsx:145`).

## Seller e scheda prodotto

**Form prodotto.** `ProductCategoriesPicker`
(`apps/seller/src/features/products/components/product-categories-picker.tsx:34`)
si semplifica: macro-categoria e poi **una** sotto-categoria, non più la
multiselezione a pastiglie con popover.

Sotto compare una sezione *Caratteristiche* che si popola alla scelta della
sotto-categoria, con il controllo giusto per tipo: casella per i sì/no, campo
numerico con l'unità in coda, menu a tendina per le liste chiuse, testo per il
resto.

Due scelte decidono se la sezione è usabile o odiosa:

- **non è un muro di dieci campi**: nasce chiusa con un riepilogo
  (`0 di 10 compilate`) e si apre su richiesta. Il prodotto si salva e si pubblica
  anche vuota (D8);
- **cambiare sotto-categoria chiede conferma** prima di cancellare (D10), con
  l'elenco dei valori che si perdono.

**Scheda prodotto customer.** Tabella *Caratteristiche* con le sole voci
valorizzate — mai righe vuote, mai etichette senza valore. I numeri con l'unità,
i sì/no come *Sì* / *No*. Senza valori, la sezione non compare.

## Migrazione

Drizzle genera l'aggiunta della colonna e la rimozione della tabella, ma **non**
il travaso in mezzo: va scritto a mano nel file generato, prima di eseguirlo.

Prima della migrazione, un conteggio di controllo:

```sql
SELECT count(*) FROM (
  SELECT product_id FROM product_category_assignments
  GROUP BY product_id HAVING count(*) > 1
) t;
```

Atteso **zero** — il seed assegna esattamente una sotto-categoria per prodotto
(`apps/api/src/db/seed/fixtures/products.ts:258`). Un valore diverso significa
che il travaso perde dati, e va saputo prima.

Poi, nell'ordine:

1. `ALTER TABLE products ADD COLUMN product_category_id text REFERENCES product_categories(id) ON DELETE RESTRICT` (nullable, quindi nessun backfill obbligato);
2. travaso deterministico da `product_category_assignments` (una assegnazione per
   prodotto, ordinata per `product_category_id`);
3. `DROP TABLE product_category_assignments`;
4. indice su `products(product_category_id)`.

Raggio d'azione, 12 file: i filtri seller
(`apps/api/src/modules/seller/services/products.ts:181`), i facet customer
(`apps/api/src/modules/customer/services/product-facets.ts:118`), le condizioni
di ricerca (`apps/api/src/modules/customer/services/product-search-conditions.ts:66`),
lo schema composto (`apps/api/src/lib/schemas/composed.ts:104`), il seed, le
fixture di test e le tre schermate seller.

## Collaudo

**Logica di dominio pura**, in un modulo accanto a `lib/vat.ts`: la validazione
di un valore contro la sua caratteristica — il tipo corrisponde, il valore di una
lista chiusa è fra le opzioni, la caratteristica è nella matrice della categoria
del prodotto. Test unitari scritti prima (TDD).

**Import**: idempotenza, errori con numero di riga, aggiornamento del dizionario,
rapporto di divergenza della matrice.

**Integrazione**: creazione e modifica prodotto con caratteristiche; CRUD admin;
409 alla cancellazione di una categoria in uso; le tre cancellazioni a cascata di
D10 e le rispettive conferme.

**Vincoli del database**: un test che inserisce a mano una riga malformata e
dimostra che il `CHECK` la rifiuta. Un vincolo mai messo alla prova è un commento.

Niente test di concorrenza: l'harness serializza le transazioni e produrrebbe un
rosso falso.

## Consegna

Cinque PR, ciascuna verificabile da sola:

| # | Contenuto |
|---|---|
| 1 | Schema e migrazione: sotto-categoria unica sul prodotto. Nessuna caratteristica: isola il cambio più rischioso |
| 2 | Dizionario e matrice: tabelle, import, seed, i due CSV redatti e la nota di revisione |
| 3 | Admin: CRUD dizionario e pannello di assegnazione |
| 4 | Seller: form prodotto e salvataggio valori |
| 5 | Customer: tabella caratteristiche sulla scheda prodotto |

**Il punto di controllo è fra la 2 e la 3**: le correzioni alla tipizzazione
rientrano come nuovo CSV e reimport, senza toccare codice.

Il piano di implementazione si scrive **per PR**, non per l'intero documento:
cinque piani brevi e verificabili invece di uno lungo che invecchia mentre lo si
esegue.

Verifica prima di dichiarare conclusa ciascuna: `bun run lint`, typecheck
**workspace per workspace** (l'aggregato può inghiottire un fallimento singolo),
`bun run test`, `bun run --cwd apps/api build`, e `bun run db:generate` che deve
rispondere «No schema changes». Le PR con interfaccia passano dal browser su
utente autenticato vero, non dal solo typecheck; se aggiungono route va committato
anche `routeTree.gen.ts`.
