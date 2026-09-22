# Negozio senza orari dichiarati — design

**Date:** 2026-09-22
**Status:** proposed
**Riferimenti:** i riferimenti `file:riga` puntano allo stato pre-implementazione (base `ef1ab21`)
**Branch:** `feat/store-hours-unknown-state`

## Problema

Un negozio che non ha mai dichiarato gli orari viene mostrato al cliente come
**«Chiuso»**. È un'affermazione che non possiamo sostenere: non sappiamo se è
chiuso, sappiamo che non ce l'ha detto.

L'informazione si perde alla fonte. In `getOpenStatus()`
(`apps/api/src/lib/holidays/open-status.ts:39`) con `openingHours: null` il
ciclo sugli slot non trova nulla e l'esecuzione cade sul `return { isOpen:
false, status }` finale (riga 69). Il tipo `OpenStatus.status`
(`apps/api/src/lib/holidays/types.ts:26`) ha tre valori — `"open" | "closed" |
"closed_holiday"` — e nessuno significa "non lo so": la mancanza di orari e la
chiusura reale collassano sullo stesso valore, e da lì in poi nessun
consumatore può più distinguerle.

Quanto pesa: nel seed, 23 degli 86 negozi dell'area bolognese (27%) non hanno
`openingHours`. È il livello `bare` di `seedStoreProfiles`
(`apps/api/src/db/seed/fixtures/store-profiles.ts:29`), che esiste apposta per
tenere vivo lo stato "profilo non ancora compilato". Il finding era emerso in
PR #166 e non è mai stato affrontato.

### Tre istanze della stessa bugia, non una

L'indagine ne ha trovate tre, in due app:

1. **Griglia e mappa customer** — `openStatusLabel()`
   (`apps/customer/src/features/stores/open-status.ts:39`) senza `opensAt`
   restituisce la stringa nuda «Chiuso». Usata da `store-tile.tsx:16` e
   `store-search-map.tsx:96`.
2. **Copertina della scheda negozio** — stesso helper, via
   `store-cover.tsx:83` ← `$storeId.tsx:358`.
3. **Rail orari della scheda negozio** — `formatWeeklyHours(null, …)`
   (`apps/customer/src/features/stores/format-opening-hours.ts:29`) produce
   sette righe con `slots: []`, e `OpeningHours`
   (`opening-hours.tsx:55`) rende `m.store_closed()` per ognuna: **«Chiuso»
   sette volte**. È il finding aperto di PR #166.

La terza entra in scope per necessità, non per ambizione: sta nella stessa
schermata della seconda. Correggere solo la copertina produrrebbe una pagina
che dice «Orari non indicati» in alto e «Chiuso» sette volte nel rail a destra.

### E una quarta nel seller

`apps/seller/src/routes/_authenticated/index.tsx:101` costruisce un action item
intitolato **«Negozio chiuso ora»** con sottotitolo **«Nessun orario
impostato»** (righe 106-115). Il codice *sa già* di non sapere — usa l'assenza
di `opensAt` come proxy — ma continua a intitolare l'avviso con l'affermazione
che non può sostenere, e manda il seller a `/store/closures`, dove gli orari
non si modificano.

### Perché non basta che il frontend deduca

L'ipotesi economica — nessun cambio di contratto, il FE deduce "non lo so"
dall'assenza di `opensAt` — è **scorretta**, e va scartata con motivo.

In `getOpenStatus` un negozio che *ha* gli orari esce senza `opensAt` in almeno
due casi reali:

- una chiusura personalizzata che copre tutti i 60 giorni di
  `MAX_LOOKAHEAD_DAYS` (righe 60-67: ogni data è in `closedDates` e viene
  saltata dal `continue`) — cioè ferie lunghe;
- `slots: []` su tutti i giorni dichiarati.

In entrambi il negozio è chiuso *davvero*, ma il FE lo etichetterebbe «orari
non indicati». Scambierebbe una bugia con un'altra, meno frequente e più
difficile da diagnosticare. L'unico posto dove l'informazione esiste davvero è
il dominio.

## Decisioni

| # | Domanda | Decisione |
|---|---|---|
| 1 | Cosa mostra il customer | Riga esplicita, **stesso tono di «Chiuso»**, icona diversa (`HelpCircle`, non `Clock`). Testo: **«Orari non indicati»** |
| 2 | Dominio o frontend | **Terzo stato nel dominio**: `status: "unknown"` |
| 3 | Il facet «Aperti ora» lo dichiara | **No.** Nessun conteggio aggiuntivo, nessuna riga: il rail resta com'è |
| 4 | Ricadute sul seller | **Riparare l'avviso esistente + sollecito nel profilo `/store`** |

### Nota sulla resa (decisione 1)

Una quinta variante è stata costruita e **scartata su misura**, non a
sensazione: «più leggera» ottenuta abbassando l'opacità del testo
(`text-muted-foreground/70`) misura **3,05** di contrasto in light e **3,49** in
dark, sotto la soglia AA di 4,5 per il testo piccolo. Le varianti superstiti
stanno tutte a 5,7–5,9, come il «Chiuso» attuale. **La differenza di peso passa
dall'icona, mai dal tono.**

Anche «niente» è stata scartata: a schermo il negozio diventa indistinguibile
da uno il cui stato non è stato caricato, le tile si accorciano in griglia e
sulla copertina resta un vuoto evidente sotto la città.

Le varianti sono state confrontate su una route temporanea
(`apps/customer/src/routes/preview-open-status.tsx`), **che va cancellata prima
della PR**.

## Il dominio

`OpenStatus.status` guadagna un quarto valore:

```ts
status: "open" | "closed" | "closed_holiday" | "unknown";
```

`getOpenStatus()` decide "non lo so" **prima di ogni altra valutazione**: senza
uno slot dichiarato non c'è nulla su cui decidere aperto o chiuso, nemmeno se
oggi è festivo.

```ts
const hasDeclaredHours =
	openingHours?.some((d) => d.slots.length > 0) ?? false;
if (!hasDeclaredHours) return { isOpen: false, status: "unknown" };
```

Due scelte da giustificare:

- **`some(d => d.slots.length > 0)`, non `openingHours === null`.** `[]` e
  `[{ dayOfWeek: 0, slots: [] }]` sono altrettanto "niente di dichiarato". La
  route del seller non può salvare `slots: []` (`minItems: 1`), ma il dato può
  esistere e il predicato non deve dipendere da quella garanzia.
- **`isOpen: false` anche per `unknown`.** È una verruca voluta:
  `isOpen` significa «possiamo affermare che è aperto», e per un negozio
  ignoto la risposta è no. Tenerlo `false` lascia intatto ogni uso esistente di
  `isOpen` per la colorazione, e nessun consumatore rischia di mostrare
  «Aperto» per errore.

### La gemella SQL non si tocca

`openNowCondition()` (`apps/api/src/lib/store-open-status.ts:119`) **resta
invariata**, e la parità con `getOpenStatus` resta dimostrata.

L'argomento: il SQL include un negozio solo se `EXISTS` trova uno slot del
giorno corrente che copre l'ora corrente (righe 132-139). Un negozio incluso
dal SQL *ha* quindi almeno uno slot, quindi `hasDeclaredHours` è vero, quindi
il ramo `unknown` non lo raggiunge mai. Il nuovo stato può comparire **solo**
su negozi che il SQL già escludeva. Nessun negozio cambia lato del filtro, e
`total`/paginazione non si muovono.

`apps/api/tests/integration/customer-store-discovery.test.ts` va comunque
eseguito: è il test che verifica quella parità (`store-open-status.ts:116`).

## Contratto API

`OpenStatusSchema` (`apps/api/src/lib/schemas/holidays.ts:94`) aggiunge
`t.Literal("unknown")` all'union. Le quattro incastonature ereditano da sole:
`entities.ts:726`, `entities.ts:747`, `entities.ts:814`, `composed.ts:35`.

I tre default che oggi fabbricano uno stato quando la mappa non ha la chiave
diventano `"unknown"` — che è il loro significato reale, «non abbiamo lo
stato»:

- `apps/api/src/modules/customer/services/store-discovery.ts:148`
- `apps/api/src/modules/customer/services/store-map.ts:160`
- `apps/api/src/modules/customer/services/store-detail.ts:112`

Sono rami morti (`resolveOpenStatuses` restituisce una voce per riga), ma
scrivono `"closed"` — cioè esattamente la bugia che questa PR rimuove.

## Customer

**`open-status.ts`** — `OpenStatusView.status` allinea l'union; `openStatusLabel`
gestisce `unknown` per primo:

```ts
if (status.status === "unknown") return "Orari non indicati";
```

Il file oggi ha le stringhe italiane inline (righe 21-40, nessun paraglide): la
nuova stringa segue la convenzione del file in cui vive.

**`store-tile.tsx:8`** e **`store-cover.tsx:77`** — l'icona diventa
`HelpCircle` quando `status.status === "unknown"`, `Clock` altrimenti. Tono
invariato (`text-muted-foreground` / `text-ink/60`): è la decisione 1.

**`store-search-map.tsx:94`** — il popup non ha icona, quindi non serve
distinguerla: l'etichetta nuova arriva da sola tramite `openStatusLabel`, e il
ramo `!isOpen` già applica `text-muted-foreground`. **Nessuna modifica.**

**`opening-hours.tsx`** — quando non c'è nessuno slot dichiarato, il componente
**non rende la tabella dei sette giorni**: rende una riga sola. **Decisione
presa in esecuzione:** questa riga NON riusa il testo del badge — usa una
stringa paraglide propria, più lunga (`store_hours_unknown`), perché un
pannello a piena larghezza non è un chip: lo spazio in più regge una frase
completa, e riusare l'etichetta compressa del badge ci avrebbe sprecato quello
spazio. Sette righe «Chiuso» non sono una formattazione sbagliata, sono
sette affermazioni sbagliate. Serve un messaggio paraglide nuovo
(`store_hours_unknown`) in `apps/customer/messages/it.json` e `en.json`, perché
questo componente è i18n'd (a differenza di `open-status.ts`).

**`use-store-search.ts:16-21`** duplica l'union inline invece di riusare
`OpenStatusView`. Va allineata comunque; l'occasione è buona per farle
importare il tipo condiviso, come già fanno `use-store-detail.ts` e
`use-store-map.ts`.

## Seller

**Dashboard** (`apps/seller/src/routes/_authenticated/index.tsx:100-117`) — il
ramo `unknown` si separa da quello chiuso:

| | oggi | dopo |
|---|---|---|
| titolo | «Negozio chiuso ora» | «Orari non ancora impostati» |
| sottotitolo | «Nessun orario impostato» | «Senza orari il negozio non compare nei risultati "Aperti ora"» |
| urgency | `low` | `medium` |
| href | `/store/closures` | `/store` |

L'`href` di oggi è sbagliato a prescindere dal titolo: gli orari si modificano
nel profilo (`store-form.tsx`), non nelle chiusure.

**Profilo negozio** (`/store`) — una riga nella `FormSection` «Orari di apertura»
(`store-form.tsx:281`, sopra `OpeningHoursEditor` a riga 285) che collega causa
ed effetto nel punto esatto in cui il seller può rimediare, con lo stesso testo
del sottotitolo. Compare solo quando non ci sono orari dichiarati.

Il seller riceve `openStatus` come `t.Optional(t.Nullable(...))`
(`composed.ts:35`, prodotto da `seller/services/stores.ts:82`): il ramo `null`
esistente resta, e `unknown` gli si affianca.

## Cosa non cambia

- **`openNowCondition()`** e quindi il filtro «Aperti ora» su `/stores` e
  `/products`: i negozi senza orari erano già esclusi e restano esclusi.
- **I facet.** Nessun `unknownTotal`, nessuna riga informativa (decisione 3).
  `openNowTotal` continua a rispondere a «quanti restano se lo attivo», che è
  già onesto. Il 27% si ripara dal lato seller, non con chrome sul customer.
- **Lo schema del database.** `openingHours` è già nullable; non serve
  migrazione.

## Test

**Unit, dominio** (`getOpenStatus`) — i casi che oggi non esistono:

- `openingHours: null` → `status: "unknown"`, `isOpen: false`, niente `opensAt`
- `openingHours: []` → `unknown`
- `[{ dayOfWeek: 0, slots: [] }]` → `unknown`
- **anti-regressione:** oggi festivo *e* nessun orario → `unknown`, non
  `closed_holiday` (il ramo nuovo precede)
- **anti-regressione:** orari dichiarati + chiusura che copre i 60 giorni →
  `closed` senza `opensAt`, **non** `unknown`. È il caso che smonta l'ipotesi
  "il FE deduce dall'assenza di `opensAt`", e va bloccato da un test.

**Integrazione** (`customer-store-discovery.test.ts`) — eseguire l'intero file
invariato (è il test di parità); aggiungere che un negozio senza orari esce con
`status: "unknown"` ed è assente da `openNow: true`.

**Unit, customer** — `openStatusLabel` su `unknown`; `OpeningHours` con
`openingHours: null` rende una riga sola e **zero** occorrenze di «Chiuso»
(`format-opening-hours.test.ts` esiste già come sede).

## File toccati

| Area | File |
|---|---|
| dominio | `holidays/types.ts`, `holidays/open-status.ts` |
| contratto | `schemas/holidays.ts`, `services/store-discovery.ts`, `services/store-map.ts`, `services/store-detail.ts` |
| customer | `stores/open-status.ts`, `store-tile.tsx`, `store-cover.tsx`, `opening-hours.tsx`, `use-store-search.ts`, `messages/{it,en}.json` |
| seller | `routes/_authenticated/index.tsx`, `features/stores/components/store-form.tsx` |
| test | `open-status` unit, `customer-store-discovery.test.ts`, `format-opening-hours.test.ts` |
| da cancellare | `routes/preview-open-status.tsx` (+ `routeTree.gen.ts` rigenerato) |

## Rischi

- **`routeTree.gen.ts`.** La route di anteprima ci è già entrata. Va cancellata
  la route *e* rigenerato il file, altrimenti la CI typecheck va rossa mentre in
  locale resta verde (il generato non committato).
- **Union esaustive.** Aggiungere un literal può far fallire `switch` senza
  default nei tre frontend: è il motivo per cui questa scelta è preferibile al
  `null`, ma va verificato con un typecheck per workspace, non aggregato
  (`bun run --filter '*'` può mascherare un fallimento singolo).
- **`isOpen: false` per `unknown`** resta un compromesso: un consumatore futuro
  che legga solo `isOpen` non distingue ignoto da chiuso. Accettato perché ogni
  consumatore attuale usa `isOpen` solo per il colore, e `status` per il testo.
