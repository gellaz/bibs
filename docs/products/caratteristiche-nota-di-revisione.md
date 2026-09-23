# Caratteristiche prodotto — nota di revisione

**Data:** 2026-09-23
**Fonte:** foglio `Mapping` (1952 righe `macro, sotto, caratteristica, Sì`) e foglio
`Dizionario` (200 caratteristiche distinte), da `Categorie_caratteristiche.xlsx`.
**Prodotto:** `apps/api/src/db/seed/data/product_characteristics.csv` (207 voci) e
`apps/api/src/db/seed/data/product_category_characteristics.csv` (1773 righe).

Questo documento **non elenca le caratteristiche** — quelle stanno nei due CSV.
Contiene soltanto le decisioni che ho preso io e su cui si può non essere d'accordo.

Il foglio dice **quali** caratteristiche si applicano **dove**. Non dice che cosa
siano: niente tipo, niente unità, niente valori ammessi. Tutto quello strato l'ho
scritto io, e tutto quello strato è discutibile.

## La regola che governa gli sdoppiamenti

Prima di entrare nel dettaglio, la regola che ho applicato, perché ricorre in
quattro decisioni:

> Due occorrenze dello stesso nome restano **una voce sola** quando la domanda è
> la stessa, anche se il valore tipico cambia. Si **sdoppiano** quando la domanda
> cambia: quando una risposta corretta in un dominio sarebbe una risposta
> *sbagliata* nell'altro, o quando cambia il tipo di dato.

Il test non è «compare sotto macro-categorie diverse». `Sistema operativo` sta
in Elettronica e in Abbigliamento solo perché gli smartwatch stanno in
Abbigliamento, e vuol dire esattamente la stessa cosa: resta una voce sola.

## 1. Sdoppiamenti

Cinque in totale. Uno era già deciso (`Taglia`), quattro li ho aggiunti io.
Il conteggio della matrice non cambia mai: uno sdoppiamento redistribuisce le
righe fra le nuove voci.

### 1.1 `Taglia` → cinque voci (17 sotto-categorie)

| Nuova voce | Tipo | Sotto-categorie | Valori |
|---|---|---|---|
| `Taglia abbigliamento` | enum | Abbigliamento uomo, donna, bambino, Intimo, Pigiami, Costumi da bagno | `XS…XXXL` |
| `Taglia calzature` | enum | Scarpe uomo, Scarpe donna, Sneakers | `35…48` |
| `Taglia bagagli` | enum | Borse, Zaini, Valigie | `Piccola\|Media\|Grande` |
| `Taglia accessori` | text | Cinture, Cappelli, Gioielli, **Occhiali da sole** | libero |
| `Taglia pannolini` | enum | Pannolini | `1…6` |

**Due cose da guardare.**

1. **`Occhiali da sole` non era nell'elenco che mi è stato dato.** L'elenco copriva
   16 sotto-categorie su 17; la diciassettesima è `Abbigliamento / Occhiali da sole`.
   L'ho messa in `Taglia accessori` (testo libero): la misura di un occhiale è il
   calibro (`52-18-140`) oppure una etichetta `S/M/L` a seconda della marca, cioè
   esattamente il caso eterogeneo per cui `Taglia accessori` esiste.
   *Se è sbagliato:* cambiare la riga `Abbigliamento,Occhiali da sole,Taglia accessori,false`
   nella matrice.
2. **`Abbigliamento bambino` con `XS…XXXL` è una forzatura.** In Italia le taglie
   bambino si esprimono in anni (`2 anni`, `4 anni`) o in centimetri (`104 cm`),
   non in `S/M/L`. L'ho lasciata dov'era perché l'assegnazione era prescritta, ma
   un negozio di abbigliamento per bambini non troverà la sua taglia nella lista.
   *Se va corretto:* aggiungere al dizionario `Taglia bambino,enum,,3-6 mesi|6-12 mesi|12-18 mesi|18-24 mesi|2 anni|3 anni|…|14 anni`
   e spostarci la riga di `Abbigliamento bambino`.

### 1.2 `Formato` → `Formato` + `Formato schermo`

Nel foglio `Formato` vale 18 volte: 17 sotto-categorie di Bellezza e cura
personale, più `Elettronica / Monitor`. Su un monitor `Formato` è il rapporto
d'aspetto (`16:9`, `21:9`); su un siero è la forma galenica (`Crema`, `Gel`,
`Spray`). Nessun valore dell'una lista è accettabile nell'altra: sdoppiamento
obbligato.

- `Formato` (enum, 17 sotto-categorie di Bellezza) — 16 forme: `Crema|Gel|Siero|Olio|Lozione|Latte|Spray|Mousse|Stick|Matita|Polvere|Liquido|Salviette|Capsule|Compresse|Fiale`
- `Formato schermo` (enum, Monitor) — `16:9|16:10|21:9|32:9|4:3`

### 1.3 `Risoluzione` → `Risoluzione` + `Risoluzione sensore`

Quattro occorrenze: Monitor, TV, Smart TV e `Fotocamere reflex`. Sui primi tre è
la risoluzione dello schermo (`Full HD`, `4K UHD`): un enum. Su una reflex è la
risoluzione del sensore in megapixel: **un numero con un'unità**. Non è solo una
lista di valori diversa, è un tipo di dato diverso — non c'è modo di tenerle
insieme.

- `Risoluzione` (enum) — `HD|Full HD|Quad HD|4K UHD|8K UHD`
- `Risoluzione sensore` (number, `MP`) — Fotocamere reflex

### 1.4 `Tipo chiusura` → `Tipo chiusura` + `Tipo chiusura passeggino`

Cinque occorrenze: `Custodie smartphone`, le tre calzature e `Passeggini`. Sulle
prime quattro significa *come si allaccia* (lacci, strappo, zip, magnetica). Su un
passeggino significa *come si ripiega* (a libro, a ombrello). Stessa parola, due
domande diverse: il seller di passeggini che trovasse «Lacci» nella tendina
capirebbe di aver sbagliato campo.

- `Tipo chiusura` (enum) — `Lacci|Strappo|Zip|Elastico|Fibbia|Magnetica|Senza chiusura`
- `Tipo chiusura passeggino` (enum) — `A libro|A ombrello|A trolley|Non pieghevole`

*Se è troppo:* lo sdoppiamento costa **una riga** di dizionario e **una riga** di
matrice. Per annullarlo basta togliere `Tipo chiusura passeggino` dal dizionario e
riportare la riga `Infanzia,Passeggini` su `Tipo chiusura` — a patto di
aggiungere `A libro` e `A ombrello` alla lista comune.

### 1.5 `Stagione` → `Stagione` + `Stagione pneumatici`

Quattordici occorrenze: 13 di Abbigliamento e `Auto e moto / Pneumatici`. Sui capi
è la collezione (`Primavera/Estate`, `Autunno/Inverno`); sugli pneumatici è una
classe di omologazione (`Estive`, `Invernali`, `Quattro stagioni`), con obblighi
di legge attaccati. Un gommista che selezionasse `Primavera/Estate` starebbe
dichiarando una cosa che non esiste.

- `Stagione` (enum) — `Primavera/Estate|Autunno/Inverno|Tutto l'anno`
- `Stagione pneumatici` (enum) — `Estive|Invernali|Quattro stagioni`

Sulla granularità di `Stagione`: ho usato le coppie che le collezioni italiane
usano davvero (P/E e A/I) invece delle quattro stagioni singole. Un costume da
bagno è `Primavera/Estate`, non «Estate».

### 1.6 Quello che ho deciso di **non** sdoppiare

Sono i casi in cui la tentazione c'era e ho detto di no. Se uno di questi va
sdoppiato, il costo è lo stesso: una riga di dizionario più le righe di matrice
interessate.

| Voce | Perché resta una sola |
|---|---|
| `Sistema operativo` (11) | Telefoni, laptop, TV e orologi: la domanda è sempre «quale OS». Lista unione di 14 valori più `Altro`. |
| `Alimentazione` (15) | 14 elettroniche più `Barbecue`. La domanda è sempre «da cosa è alimentato», e l'unione è **sensata in entrambe le direzioni**: i barbecue elettrici esistono davvero. Lista: `Rete elettrica\|Batteria integrata\|Pile sostituibili\|USB\|Gas\|Carbonella\|Pellet\|Legna`. È il contrario del caso `Stagione`, dove l'unione produceva risposte impossibili. |
| `Tipo pelle/capelli` (14) | Le due liste sono disgiunte, ma prefissare i valori (`Pelle secca`, `Capelli secchi`) le rende leggibili in un'unica tendina senza ambiguità. |
| `Potenza` (16) | Dal frullatore al barbecue: sempre watt. Vedi §5 per il problema dei kW. |
| `Formato carta` / `Formato massimo` | Stessa lista (`A4\|A3\|…`), due voci distinte nel foglio: le ho tenute separate per fedeltà alla fonte. Sono unificabili senza perdere nulla. |
| `Tipo pelle` (3, make-up) / `Tipo pelle/capelli` (14) | Quasi-duplicati nel foglio. Nessuna sotto-categoria ha entrambe, quindi si potrebbero fondere. Le ho lasciate separate perché la fonte le distingue. |

## 2. Liste di valori inventate

**Tutte le liste enum sono inventate**: il foglio non contiene un solo valore
ammesso. Sono 69 voci `enum` su 207. Le riporto qui solo dove la granularità è
opinabile; le restanti sono nomenclature standard che non lasciano margine
(`Grado IP`, `Attacco lampadina`, `Classe energetica`, `Formato carta`,
`Indice di velocità`, `Tipologia sensore`, `Layout` tastiera, e simili).

### 2.1 `Colore` — 17 famiglie, su tutte e 179 le sotto-categorie

`Nero|Bianco|Grigio|Argento|Oro|Beige|Marrone|Rosso|Rosa|Arancione|Giallo|Verde|Blu|Azzurro|Viola|Multicolore|Trasparente`

**Perché enum e non testo.** `Colore` è il filtro più usato del commercio al
dettaglio, e un filtro su testo libero non filtra: «blu navy», «blu notte»,
«bluette» e «Blu» diventano quattro faccette diverse. La scommessa è che un
negoziante che vende un maglione bordeaux accetti di classificarlo come `Rosso`.

**Perché questa granularità.** 17 famiglie sono il compromesso standard: abbastanza
da distinguere `Beige` da `Marrone` e `Blu` da `Azzurro` (distinzione che in
italiano è percepita come reale), abbastanza poche da stare in una tendina senza
scroll. Ho incluso `Argento` e `Oro` perché su gioielli, orologi ed elettronica
sono le risposte vere; `Trasparente` perché su custodie e contenitori è la
risposta vera; `Multicolore` perché senza di esso un libro o una scatola di
costruzioni non ha risposta.

*Se la risposta è no:* portare `Colore` a `text` è una riga del dizionario, e
costa il filtro colore su tutto il catalogo. La via di mezzo — `Colore` enum
per la famiglia più un campo libero per la sfumatura — richiede una voce in più
nel dizionario e una riga di matrice per ogni sotto-categoria, cioè 179 righe.

### 2.2 `Materiale` — lasciata `text`, vedi §3

### 2.3 Le altre liste su cui si può discutere

| Voce | Lista | La scelta discutibile |
|---|---|---|
| `Wi-Fi` (9) | `Wi-Fi 4…Wi-Fi 7` | Ho letto il campo come **generazione**, non come presenza. Su un laptop è l'unica lettura utile (tutti hanno il Wi-Fi); su una stampante la scatola spesso scrive solo «Wi-Fi» e il negoziante lascerà il campo vuoto. L'alternativa è `boolean`, sempre compilabile e quasi sempre inutile. |
| `HDMI` (2) | `HDMI 1.4\|2.0\|2.1` | Il nome nudo è ambiguo: può voler dire «quante porte». Ho scelto la versione perché il conteggio, dove serve, ha già la sua voce (`Numero porte`). |
| `Bluetooth` (7) | `Bluetooth 4.0…5.4` | Sette versioni sono molte per una tendina, ma sono quelle che compaiono davvero sulle confezioni e la scelta è meccanica (si copia dalla scatola). |
| `Sistema operativo` (11) | 14 valori + `Altro` | `Altro` è una valvola di sfogo: senza, un OS di nicchia costringe a sbagliare. Con, il filtro ha una categoria-rifiuto. |
| `Formato` (17, Bellezza) | 16 forme | 16 voci sono al limite dell'usabile in una tendina. Le ho tenute perché accorpare (`Crema` e `Lozione` insieme) cancella una distinzione che in profumeria è reale. |
| `Tipo pelle/capelli` (14) | 12 valori prefissati | La prefissazione (`Pelle…` / `Capelli…`) raddoppia la lunghezza ma elimina l'ambiguità di `Secca`. |
| `Resistenza acqua` (3) | IP **e** ATM mescolati | Le confezioni degli orologi usano l'una o l'altra scala, mai entrambe. Mescolarle in un enum è brutto ma onesto; convertirle a una scala sola richiederebbe una tabella di equivalenza che non è esatta. |
| `Stile` (14, arredo) | `Moderno\|Classico\|Industriale\|Scandinavo\|Vintage\|Rustico\|Minimal` | Sette stili d'arredo sono una convenzione commerciale, non una tassonomia. Sono quelli che usano i cataloghi italiani, ma il confine fra `Moderno` e `Minimal` è opinione. |
| `Posizione montaggio` (9, auto/moto) | `Anteriore\|Posteriore\|Laterale\|Interno\|Esterno\|Tetto` | Mescola due assi (dove sul veicolo / dentro o fuori). Non ho trovato un asse solo che copra accessori interni, esterni e ricambi meccanici insieme. |
| `Materiale tomaia` / `Materiale suola` / `Materiale telaio` / `Materiale struttura` / `Materiale griglia` | liste chiuse di 4-7 materiali | Qui l'enum regge solo perché il dominio è strettissimo. È la stessa scommessa di `Materiale` generico, vinta perché la sotto-categoria è una sola famiglia di prodotti. |
| `Specie` (2) | `Cane\|Gatto` | Degenerato: si applica solo a `Cibo cani` e `Cibo gatti`, dove la risposta è predeterminata dalla sotto-categoria. Ha senso solo se un giorno le due sotto-categorie si fondono. |
| `Età consigliata` (2) | fasce `0-6 mesi…12+ anni` | Fasce, non età esatte. Un giocattolo «da 3 anni in su» diventa `3-6 anni`, perdendo l'«in su». |
| `Effetto` (3, make-up) | 8 valori | Unione di effetti per labbra, occhi e viso. Un mascara non è mai `Coprente`, ma vedrà la voce nella tendina. |

### 2.4 Gli `enum` che ho **rifiutato** di scrivere

Un enum con una lista sbagliata è peggio di un campo libero: il testo libero non
filtra, la lista chiusa **costringe a rispondere il falso** e corrompe il dato in
modo permanente. Queste voci sono `text` non per pigrizia ma perché non so
scrivere una lista che un negoziante riconoscerebbe come completa:

- **`Tonalità`** (3, make-up) — **contraddice l'indicazione ricevuta**, che la
  dava fra gli esempi di enum. Le tonalità dei cosmetici sono nomi di marca
  («Rossetto Rouge Allure 176»), a centinaia per prodotto: nessuna lista chiusa le
  copre. Per di più `Colore` c'è già su tutti i 179, ed è lì che vive la famiglia
  cromatica — `Tonalità` è il nome commerciale della sfumatura, che è prosa.
  *Se va riportata a enum:* servono le famiglie `Nude|Rosa|Rosso|Bordeaux|Corallo|Pesca|Marrone|Beige|Bronzo|Oro|Argento|Nero`,
  accettando che duplichino `Colore`.
- **`Attacco`** e **`Obiettivo/Attacco`** (obiettivi fotografici) — gli innesti
  sono una lista lunga e in crescita (EF, RF, F, Z, E, A, L-Mount, X, K, m4/3,
  M42, Leica M…). Sbagliarne uno rende l'obiettivo incompatibile per il cliente.
- **`Sport/Disciplina`** (9) — la lista degli sport non ha fondo.
- **`Taglia/Misura`** (9, sport) — nove sotto-categorie sportive che usano
  sistemi diversi: `S/M/L` per l'abbigliamento tecnico, chili per i pesi,
  centimetri per gli sci, litri per gli zaini.
- **`Taglia accessori`** (4) — stesso problema: centimetri per le cinture,
  circonferenza per i cappelli, diametro per gli anelli, calibro per gli occhiali.
- **`Allergeni`** (4) — qui la lista chiusa *esiste* (i 14 allergeni
  dell'allegato II del reg. UE 1169/2011) ma un prodotto ne contiene più d'uno, e
  il modello dati assegna un valore solo per caratteristica. Un enum
  costringerebbe a dichiararne uno e tacere gli altri: su un allergene questo non
  è un dato impreciso, è un dato pericoloso.
- **`Composizione`** (13) — «65% cotone, 35% poliestere»: fibre più percentuali.
- **`Protezione`** (1, custodie), **`Misura telaio`** (2, bici),
  **`Indice di carico`** (1), **`Omologazione`** (9),
  **`Compatibilità veicolo`** (9), **`Anno compatibilità`** (9) — codici,
  intervalli o nomenclature che cambiano per marca.
- **`Formato/Peso netto`** (6), **`Diametro/Capacità`** (1),
  **`Peso bambino`** (1) — nomi composti nella fonte, che chiedono due cose
  insieme o un intervallo (`4-9 kg`). Un numero con un'unità sola mentirebbe.

## 3. I quattro casi limite

Tutti e quattro finiscono a `text`. Il motivo è lo stesso: la caratteristica
attraversa domini che non hanno un vocabolario comune.

### 3.1 `Materiale` — su tutte e 179 le sotto-categorie

Una lista chiusa dovrebbe contenere insieme `Cotone`, `Acciaio inox`, `Carta`,
`Ceramica`, `Silicone`, `Vetro`, `Legno`, `Poliestere`, `Pelle`, `Alluminio`,
`Policarbonato`, `Gomma`, `Lino`, `Terracotta`, `Cartone`… e comunque non
saprebbe cosa fare della pasta, dei semi e dei libri.

Sarebbe o enorme (e allora la tendina è inusabile e il filtro è polverizzato) o
corta (e allora metà catalogo è costretto a mentire).

**La via d'uscita che ho preso** è già nel foglio: dove il dominio è stretto
abbastanza da avere una lista vera, la fonte ha già una voce dedicata —
`Materiale tomaia`, `Materiale suola`, `Materiale telaio`, `Materiale struttura`,
`Materiale griglia`. Quelle sono `enum`. Il `Materiale` generico resta `text`.

*Se la risposta è no:* il punto di intervento non è il dizionario, è la matrice.
Aggiungere voci `Materiale <dominio>` enum e spostarci le righe delle
sotto-categorie interessate, come già fatto per tomaia e suola.

### 3.2 `Tipologia` (66) — `text`

Su 66 sotto-categorie `Tipologia` è il campo «di che cosa si tratta»: su
`Ferramenta` vuol dire viti-bulloni-chiodi, su `Romanzi` vuol dire giallo-rosa-
fantascienza, su `Vernici` vuol dire smalto-acrilico-impregnante, su `Biciclette`
city-mtb-corsa. Non c'è nessuna lista che le copra tutte, e 66 liste separate
vorrebbero dire 66 sdoppiamenti — cioè trasformare `Tipologia` in una
caratteristica per sotto-categoria, che è il contrario di un dizionario.

### 3.3 `Uso previsto` (60) — `text`

Stesso problema in forma più acuta: è sempre e solo sulle 60 sotto-categorie che
non hanno nient'altro (vedi §4.1). È il campo di ripiego del foglio.

### 3.4 `Compatibilità` (75) — `text`

«Con che cosa funziona»: modelli di telefono per le custodie, sistemi operativi
per i mouse, marche di macchina del caffè per le cialde. È intrinsecamente una
lista di nomi di terze parti, che nessuna tassonomia nostra può chiudere.

**Nota comune ai tre generici.** `Tipologia`, `Uso previsto` e `Compatibilità`
insieme occupano 201 delle 1773 righe di matrice (l'11%) e sono il solo contenuto
specifico di 60 sotto-categorie su 179. Sono il punto debole della fonte, non
della classificazione: vedi §4.1.

## 4. Applicabilità sospette

Righe che il foglio marca `Sì` e che sembrano prive di senso. **Non le ho
corrette nei CSV**: sono elencate perché la decisione è di Marco. Tutte si
correggono togliendo righe da `product_category_characteristics.csv`, mai dal
dizionario.

### 4.1 Le 60 sotto-categorie che hanno solo le universali più il terzetto generico

Cinque universali (`Modello`, `Colore`, `Materiale`, `Dimensioni`, `Peso`) più
`Tipologia`, `Uso previsto`, `Compatibilità`. Otto righe, nessuna specifica:

| Macro | Sotto-categorie |
|---|---|
| Alimentari e bevande | Bevande analcoliche, Conserve, Dolci, Prodotti bio, Senza glutine, Snack, Succhi, Tè |
| Animali domestici | Collari, Cucce, Giochi animali, Guinzagli, Prodotti igiene, Snack animali, Trasportini |
| Fai da te e industria | Avvitatori, Ferramenta, Materiali edilizia, Pennelli, Seghe, Sicurezza lavoro, Trapani, Vernici |
| Giardino e outdoor | Arredo giardino, Attrezzi giardino, Fiori, Irrigazione, Piante, Semi |
| Hobby e creatività | Colori, Cucito, Kit fai da te, Maglia, Modellismo, Pennelli |
| Infanzia | Abbigliamento neonati, Costruzioni, Culle, Lettini, Peluche, Prodotti allattamento, Seggiolini auto |
| Libri e media | Audiolibri, Blu-ray, DVD, Ebook, Fumetti, Libri scolastici, Manuali, Romanzi, Saggistica, Vinili |
| Ufficio e scuola | Agende, Cartucce, Matite, Organizer, Penne, Quaderni, Sedie ufficio, Zaini scuola |

Tre buchi che valgono più degli altri:

- **`Alimentari e bevande`**: otto sotto-categorie alimentari su undici **non hanno
  `Allergeni`, né `Ingredienti`, né `Scadenza/TMC`**. Le hanno solo `Pasta`, `Riso`
  e `Caffè`. Un barattolo di conserva venduto senza allergeni è un problema di
  conformità, non di completezza della scheda.
- **`Infanzia / Seggiolini auto`**: niente `Omologazione` (ECE R129/i-Size), niente
  `Peso bambino`, niente `Età consigliata`. È l'unico prodotto del catalogo il cui
  dato più importante è una omologazione di sicurezza, e non c'è.
- **`Libri e media`**: dieci sotto-categorie di libri, dischi e film senza autore,
  editore, ISBN, anno o lingua. Hanno invece `Colore`, `Materiale` e `Peso`.

*Dove intervenire:* aggiungere voci al dizionario e righe alla matrice. Ogni
nuova caratteristica su una sotto-categoria è una riga.

### 4.2 Le universali sui prodotti dove non significano nulla

Segnalate esplicitamente nel brief e confermate:

- `Colore`, `Materiale`, `Peso` su `Pasta` e `Riso`. `Materiale` di una confezione
  di spaghetti: la pasta? il cartone? `Peso` in grammi coincide con
  `Formato/Peso netto`, che c'è già sulle stesse righe.
- Lo stesso vale, allargando, per `Materiale` su `Ebook`, `Audiolibri`, `Semi`,
  `Fiori`, `Piante`.

### 4.3 Blocchi di caratteristiche incollati sulla sotto-categoria sbagliata

Questi sembrano errori di copia-incolla nel foglio, non scelte:

| Sotto-categoria | Ha ricevuto | Perché non torna |
|---|---|---|
| `Elettronica / Custodie smartphone` | **tutto** il blocco Smartphone: `Sistema operativo`, `RAM`, `Memoria interna`, `Dimensione display`, `Risoluzione display`, `Fotocamera`, `5G`, `Dual SIM`, `Capacità batteria` | È la sotto-categoria con **20 caratteristiche, il massimo di tutto il catalogo**, e sono le caratteristiche del telefono, non della custodia. Le uniche pertinenti sono `Compatibilità`, `Dimensione compatibile`, `Tipo chiusura`, `Protezione`. |
| `Casa e cucina / Macchine caffè` | il blocco alimentare: `Formato/Peso netto`, `Ingredienti`, `Allergeni`, `Valori nutrizionali`, `Paese di origine`, `Conservazione`, `Scadenza/TMC` | Una macchina da caffè non ha allergeni né scadenza. Le manca invece tutto il blocco elettrodomestico (`Potenza`, `Pressione`, `Capacità serbatoio`). |
| `Hobby e creatività / Tele pittura` | il blocco vernici: `Finitura`, `Resa`, `Volume`, `Superficie applicabile`, `Tempo asciugatura` | Sono le caratteristiche della pittura, non della tela. Una tela non ha resa in m² né tempo di asciugatura. |
| `Sport e tempo libero / Accessori bici` | tutto il blocco bicicletta: `Misura telaio`, `Materiale telaio`, `Diametro ruote`, `Numero velocità`, `Tipo freni`, `Sospensioni`, `Peso massimo supportato` | Un campanello non ha un telaio. |
| `Abbigliamento / Orologi` | il blocco smartwatch: `Sistema operativo`, `GPS`, `Sensori`, `Compatibilità smartphone`, `Autonomia` | Giusto per uno smartwatch, vuoto per un orologio meccanico. È anche la ragione per cui `Sistema operativo` risulta sotto Abbigliamento. |
| `Casa e cucina / Forni`, `Robot cucina`, `Piccoli elettrodomestici` | il blocco arredo: `Larghezza`, `Altezza`, `Profondità`, `Stile`, `Montaggio richiesto` | Sono elettrodomestici trattati come mobili: niente `Potenza` (che dentro Casa e cucina va solo a `Illuminazione`, `Lampade` e `Utensili cucina`), niente `Classe energetica` né `Consumo annuo` (solo `Frigoriferi`). |
| `Casa e cucina / Padelle`, `Pentole`, `Tappeti`, `Tende`, `Quadri`, `Candele`, `Biancheria letto` | `Montaggio richiesto` | Su una padella. |
| `Abbigliamento / Borse`, `Zaini`, `Valigie`, `Cinture`, `Cappelli`, `Gioielli`, `Occhiali da sole` | `Vestibilità`, `Composizione`, `Stagione` | `Vestibilità` (`Aderente`/`Oversize`) su un anello o su un paio di occhiali. |
| `Bellezza / Rasoi elettrici`, `Epilatori`, `Massaggiatori`, `Dispositivi estetici`, `Styling capelli` | `Formato`, `Ingredienti principali`, `Tipo pelle/capelli` | Sono apparecchi elettrici: non hanno ingredienti né forma galenica. Manca invece `Potenza` e `Autonomia`. |
| `Auto e moto / Oli motore` | `Posizione montaggio`, `Omologazione`, `Colore`, `Materiale` | Un olio motore non si monta in una posizione e non ha un materiale. Mancano viscosità (`5W-30`), specifica ACEA/API e litri. Lo stesso blocco identico va a `Batterie auto`, che invece avrebbe bisogno di ampere-ora e voltaggio. |

### 4.4 Duplicati di sotto-categoria

`Stampanti` compare in `Elettronica` e in `Ufficio e scuola` con lo stesso identico
blocco di 15 caratteristiche; `Pennelli` in `Fai da te e industria` e in
`Hobby e creatività`. È nella fonte delle categorie, non in questa matrice, e non
crea problemi: le coppie `(macro, sotto)` restano distinte.

## 5. Unità scelte

Dove c'era più di un'unità plausibile.

| Voce | Unità scelta | Il dubbio |
|---|---|---|
| `Peso` (179) | **`g`** | Grammi vanno bene per alimentari, cosmetica e cartoleria, cioè per la maggior parte delle sotto-categorie. Su un divano diventano `45000`, che nessuno scrive e nessuno legge. L'alternativa `kg` ribalta il problema: 200 g di pasta diventano `0,2`. Non esiste un'unità giusta per un campo che sta su tutte e 179 le sotto-categorie; ho tenuto quella prescritta. *Se va cambiata:* una riga del dizionario. La vera soluzione sarebbe sdoppiare `Peso` in `Peso` (g, consumo) e `Peso spedizione` (kg), ma è una decisione di prodotto. |
| `Peso massimo`, `Peso prodotto`, `Peso massimo supportato`, `Portata massima` | `kg` | Qui il dominio è stretto (passeggini, bici, scrivanie) e i chili sono l'unità che si legge sulle etichette. Coesistono con `Peso` in grammi sulla stessa scheda: **la disomogeneità è visibile** e potrebbe confondere. |
| `Larghezza`, `Altezza`, `Profondità`, `Altezza tacco` | `cm` | Millimetri sarebbero più precisi per il tacco, ma nessuno vende scarpe con un tacco da `85 mm`. |
| `Lunghezza focale`, `Diametro filtro`, `Larghezza pneumatico` | `mm` | Qui è il contrario: sono nomenclature tecniche che esistono solo in millimetri (`50 mm`, `205`). |
| `Memoria/Storage` (2, laptop) | `GB` | I tagli veri arrivano a `1 TB`, che qui va scritto `1024`. L'alternativa (testo libero) perde il filtro «almeno 512 GB». |
| `Potenza` (16) | `W` | Corretto su elettrodomestici e altoparlanti. Su `Giardino e outdoor / Barbecue` la potenza dei bruciatori si dichiara in **kW**: `9 kW` diventa `9000`. |
| `Garanzia` (10) | `mesi` | Anni sarebbero più naturali a dirsi («due anni di garanzia») ma non reggono i 18 o i 30 mesi. |
| `Superficie cottura` | `cm²` | La misura commerciale dei barbecue è spesso `cm × cm`. Un numero solo perde la forma della griglia. |
| `Campo visivo` | `gradi` | Scritto per esteso invece del simbolo `°`, per non affidare un dato a un carattere che si perde nei copia-incolla. |
| `Velocità` (1, utensili da cucina) | **nessuna** | Il nome nudo è ambiguo: numero di velocità selezionabili (`5`) o giri al minuto (`20000`)? Ho scelto il conteggio, perché è quello che le confezioni italiane dichiarano («5 velocità + turbo») e perché esiste già `Numero velocità` per le bici con lo stesso significato. *Se vuol dire rpm:* aggiungere l'unità `rpm` alla riga del dizionario. |
| `Luminosità` | `cd/m²` | Le schede tecniche usano anche «nit», che è la stessa cosa. `cd/m²` è la forma ufficiale. |
| `Rapporto d'aspetto` (pneumatici) | `%` | È un rapporto adimensionale espresso in percentuale (`55` sta per 55%). |

Le otto voci `number` **senza unità** sono conteggi, e sono tutte e sole:
`Numero porte`, `Numero tasti`, `Numero giocatori`, `Numero pezzi`,
`Numero velocità`, `Numero ripiani/cassetti`, `Numero bruciatori`, `Velocità`.

## 6. Come rileggere questi file

```bash
bun run apps/api/src/db/seed/data/validate-characteristics.ts
```

Verifica nomi unici, coerenza di tipo/unità/opzioni, che ogni caratteristica
della matrice esista nel dizionario e ogni coppia `(macro, sotto)` esista in
`product_categories.csv`, le 1773 righe, `required` sempre `false`, l'assenza di
`Marca`, e stampa i due istogrammi. Non tocca il database.

Stato attuale: 207 voci — 69 `enum` (33,3%), 59 `number` (28,5%), 53 `text`
(25,6%), 26 `boolean` (12,6%); 1773 righe di matrice, mediana 9 caratteristiche
per sotto-categoria, minimo 8 (69 sotto-categorie), massimo 20
(`Custodie smartphone`, vedi §4.3).
