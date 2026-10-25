# Migrazione dell'API da Elysia a Hono — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apps/api` passa da Elysia a Hono e i tre frontend da Eden a `hc`, un modulo per PR, con lo stesso comportamento HTTP di oggi (path, metodi, status, corpi, messaggi 422 in italiano, CORS, `X-Request-Id`, `/openapi`).

**Architecture:** Strangler. Ogni modulo diventa una sub-app Hono con route relative, montata nell'app Elysia con `.mount("/<prefisso>", app.fetch)`; nella stessa PR spariscono le sue route Elysia e i frontend passano a un client `hc` tipizzato solo su quel sotto-albero. Un kit condiviso in `apps/api/src/http/` (validatore, risposte, errori, auth, OpenAPI) rifà quello che Elysia dà gratis. A fine corsa (U11) Hono diventa l'app principale ed Elysia, Eden e i plugin `@elysiajs/*` escono; poi (U11b) esce anche TypeBox.

**Tech Stack:** Bun 1.4.4, Hono 5.0.0-rc.1 (da U1; ultima 5.x in U12), Zod 4 (catalog `^4.6.7`, 4.6.7), better-auth 1.7.12, Drizzle, TanStack Start/Query, bun test (api), Vitest (frontend), `@hono/cli` 1.0 rc.

**Spec:** nessuna spec separata. Le decisioni di Marco del 2026-10-25 sono riassunte in [Decisioni chiuse](#decisioni-chiuse-marco-2026-10-25); le prove stanno in [`2026-10-25-hono-migration/notes/`](2026-10-25-hono-migration/notes/) e la baseline in [`2026-10-25-hono-migration/baseline/`](2026-10-25-hono-migration/baseline/).

---

## Come riprendere

Questo file è lo stato durevole della migrazione: chi riprende legge la tabella, poi la sezione dell'unità aperta, poi [Verifica di ogni PR](#verifica-di-ogni-pr) e [Trappole note](#trappole-note). Ogni PR aggiorna nella stessa PR la riga della tabella, il campo **PR** della sua unità, le decisioni che conferma o cambia e il [registro dei delta](#registro-dei-delta-accettati).

| Unità | Contenuto | Dipende da | Stato | PR |
|---|---|---|---|---|
| U0 | Piano + baseline | — | fatto | #300 |
| U1 | `me/` + fondamenta (kit `src/http/`, client `hc`, sezione in `docs/architecture.md`) | U0 | fatto | #301 |
| U2 | `locations/` (+ rate limit) | U1 | da fare | — |
| U3 | `customer/` | U1 | da fare | — |
| U4 | `registration/` | U2 (rate limit) | da fare | — |
| U5 | seller 1: contesto seller + products, brands, images, product-characteristics, stock | U1 | da fare | — |
| U6 | seller 2: stores, store-images, settings, closures, employees, onboarding, profile, dashboard | U5 | da fare | — |
| U7 | seller 3: orders, discounts, checkout, billing | U5 | da fare | — |
| U8 | catalogo pubblico + admin 1: configurations, categorie, macro-categorie, caratteristiche, category-characteristics, holiday-definitions, import | U1 | fatto, PR da aprire (`feat/hono-u8-catalog-admin-1`) | — |
| U9 | admin 2: sellers, seller-changes, stores, requests, billing | U8 | da fare | — |
| U10 | `webhooks/` (Stripe) | U1 | da fare | — |
| U11 | Cambio finale: Hono app principale, via Elysia/Eden/logixlysia/`@elysiajs/*` | U2–U10 | da fare | — |
| U11b | Uscita da TypeBox: form condivisi e resolver seller su Zod, `env.ts`, catalog | U11 | da fare | — |
| U12 | Hono 5: bump all'ultima 5.x (GA se uscita, altrimenti l'ultima rc); ultima PR di codice prima di U13/U14 | U11b | da fare | — |
| U13 | Documentazione e rimozione della skill `elysiajs` | U12 | da fare | — |
| U14 | PR finale `feat/hono-migration` → `main` (la mergia Marco) | U13 | da fare | — |

Parallelismo: al massimo 3 unità insieme, ognuna nel suo worktree; collaudo nel browser e merge uno alla volta. Dopo U1 possono partire insieme U2, U3, U5, U8, U10 (tre per volta); U4 aspetta U2, U6 e U7 aspettano U5, U9 aspetta U8. I file toccati da tutti (`apps/api/src/index.ts`, `apps/api/src/types.ts`, `apps/*/src/lib/api.ts`, `apps/api/src/lib/zod/*`) danno conflitti piccoli: si risolvono con `git merge origin/feat/hono-migration` nel branch, mai con rebase.

### Perché questa divisione (differenze rispetto alla lista di partenza)

1. **Il catalogo pubblico va con l'admin (U8), non con `locations` (U2).** 5 delle 7 chiamate FE al catalogo sono il `list` delle config CRUD admin (`category-crud-panel.tsx`, contratto `EdenRes<T>`), le cui create/update/remove stanno in U8: insieme si tocca quel contratto una volta sola.
2. **Il rate limit si porta in U2**, perché `/locations/geocode` è la prima route limitata; U4 (registrazione) lo riusa.
3. **U11b nuova: uscita da TypeBox.** Per decisione di Marco TypeBox esce dal repo, ma i form condivisi (`@bibs/api/schemas`) li usano la registrazione (U4), il seller (U5–U7), l'admin (U9) e i form del seller FE: si possono girare su Zod solo quando tutte le route che li validano stanno su Hono. Fuori da U11 per tenere il cambio finale piccolo da rivedere.
4. **`billing/` non ha route** (`modules/billing/index.ts` riesporta solo servizi): U10 sposta solo i webhook.
5. **U6 è la più grossa** (38 endpoint, ~42 chiamate FE). Se il diff supera ~2000 righe, dividerla in U6a (stores, store-images, closures, settings) e U6b (employees, onboarding, profile, dashboard), entrambe dopo U5, e aggiornare la tabella.

---

## Global Constraints

- **Refactor puro del livello HTTP.** Stessi path, metodi, status, corpi di risposta e di errore (anche i 422 in italiano), header CORS, `X-Request-Id`, `/openapi`. Niente feature nuove, niente bump di dipendenze non legati alla migrazione. Ogni differenza osservabile va nel [registro dei delta](#registro-dei-delta-accettati) con il motivo, o si corregge.
- **I test sono il contratto.** In un test cambia solo il meccanismo con cui si manda la richiesta (`elysiaApp.handle(req)` → `honoApp.request(req)` o l'helper di test), mai le asserzioni. Se un'asserzione non regge, l'unità si ferma e la cosa va in [Domande aperte](#domande-aperte). Unica eccezione ammessa: un test che verifica il meccanismo rimosso (es. il reviver di date di Eden) si cancella insieme al meccanismo, e la PR lo dice.
- **API sempre in italiano.** L'API non legge cookie di lingua (`PARAGLIDE_LOCALE` è solo dei FE): i 422 e i `ServiceError` restano italiani per ogni cookie.
- **Errori di servizio:** `new ServiceError(status, "messaggio in italiano")`, mai codici custom.
- **Branch e PR.** Ogni unità: branch `refactor/hono-<unità>` da `origin/feat/hono-migration`, in un worktree; PR con base `feat/hono-migration`; merge squash (senza `--subject`) solo con CI verde, dalla cartella del checkout principale. Mai commit o push su `main`, mai `--admin`, mai rebase o force-push di un branch pubblicato, mai `--no-verify`. La PR finale verso `main` (U14) la mergia Marco.
- **Checkout principale condiviso.** In `/Users/marcogelli/repos/jelaz/bibs` mai `git checkout/switch/reset/stash`; si lavora solo nei worktree. I file `.env`/`.env.local` di `apps/*` non sono nei worktree: si copiano con `cp` dal checkout principale, senza stamparli.
- **Comandi vietati:** `bun run db:push`, `db:seed`, `db:reset`, `infra:reset`. Si può usare `bun run infra:up` e `bun run db:migrate`.
- **Commit:** Conventional Commits in italiano, scope dalla lista di `AGENTS.md` (`api`, `admin`, `customer`, `seller`, `ui`, `auth`, `locations`, `onboarding`, …; più scope separati da virgola), con il trailer `Co-Authored-By` della sessione. Descrizione PR in italiano, chiusa da `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Dipendenze condivise nel catalog della root.** `hono` è nel catalog con il pin esatto `5.0.0-rc.1` (U1: è una prerelease, niente range) e la stessa versione la usano API, `packages/ui` e i tre FE (requisito di `hc`); `zod` usa la voce `catalog:` già presente. Nessun `latest`.
- **Schemi congelati.** Durante la migrazione non si cambiano le regole di validazione: se serve, si cambiano insieme lo schema TypeBox e il suo gemello Zod.
- **Budget di typecheck:** tempo `tsc --noEmit` di ogni workspace ≤ baseline × 1,25 (api 8,3 s, admin 11,9 s, customer 10,8 s, seller 12,5 s; media di due run). Oltre: si ferma l'unità e si applica il ripiego della decisione D10.

## Decisioni chiuse (Marco, 2026-10-25)

Non si rimettono in discussione.

- Hono al posto di Elysia, su TypeScript + Bun. Motivo: Elysia dipende di fatto da una persona; Hono ha lo stesso modello Web Request, client RPC `hc`, integrazione ufficiale di better-auth.
- Strangler modulo per modulo con `elysia.mount(prefisso, hono.fetch)`; i FE passano da Eden a `hc` nello stesso modulo; a fine corsa via Elysia ed Eden. Non deve mai bloccare il lancio.
- **Validazione con Zod.** TypeBox esce del tutto dal repo: schemi delle route, `@bibs/api/schemas` dei form seller (resolver Zod), `env.ts`, `@sinclair/typebox` nel catalog. Restano obbligatori il 422 identico (corpo e messaggi italiani) e `/openapi` senza differenze non documentate. La libreria OpenAPI la sceglie la PR di `me/` (U1).
- Primo passo: `me/`, che misura anche il costo di typecheck di `hc`; ripiego se è lento: client generato da OpenAPI.
- Esecuzione: workflow con sessione che orchestra, stato durevole in questo piano, max 3 moduli in parallelo in worktree, collaudo browser e merge in sequenza, tutto su `feat/hono-migration`.

## Baseline (U0)

Misurata il 2026-10-25 su `e4be2926` (`feat/hono-migration` = `main`), prima di qualunque codice Hono. File in [`2026-10-25-hono-migration/baseline/`](2026-10-25-hono-migration/baseline/), strumenti in [`2026-10-25-hono-migration/tools/`](2026-10-25-hono-migration/tools/) (si lanciano da `apps/api`: `bun ../../docs/superpowers/plans/2026-10-25-hono-migration/tools/<tool>.ts`).

| Cosa | Valore | File |
|---|---|---|
| Inventario route | 246 righe: 185 route Elysia (con OPTIONS `/` e `/*` del CORS, `/openapi`, `/openapi/json`), 49 endpoint better-auth sotto `/auth/api`, 12 righe di mount (`/auth` + 5 copie morte `/<modulo>/auth`). `app.routes` ha 197 voci | [`routes.json`](2026-10-25-hono-migration/baseline/routes.json), [`route-inventory.ts`](2026-10-25-hono-migration/tools/route-inventory.ts) |
| OpenAPI | 198 path, 228 operazioni; spec «a freddo» (presa prima di qualunque richiesta: Elysia aggiunge `additionalProperties:false` man mano che compila i validatori) | [`openapi.json`](2026-10-25-hono-migration/baseline/openapi.json), [`openapi-snapshot.ts`](2026-10-25-hono-migration/tools/openapi-snapshot.ts) |
| Typecheck (media di 2 run) | api 6,65 s · admin 9,51 s · customer 8,61 s · seller 9,96 s | [`typecheck.md`](2026-10-25-hono-migration/baseline/typecheck.md) |
| Test (`bun run test` dalla root) | exit 0, 350 s; 2.039 pass in 266 file, 0 fail, 0 skip: emails 26, ui 37, api unit 520, api integration 969, admin 112, customer 169, seller 206 | [`tests.md`](2026-10-25-hono-migration/baseline/tests.md) |
| Hono CLI | carica l'app solo con la CLI su Bun e l'entry [`hono-entry.ts`](2026-10-25-hono-migration/tools/hono-entry.ts); snapshot di 198 righe (66 con `expect`), replay 66/66 | [`hono-cli.md`](2026-10-25-hono-migration/baseline/hono-cli.md), [`hono-snapshot.jsonl`](2026-10-25-hono-migration/baseline/hono-snapshot.jsonl) |
| Fallimenti preesistenti | nessuno | — |

Le tre righe dello snapshot con UUID (`/customer/products/<id>`, `/customer/stores/<id>`, `/customer/stores/<id>/products`) vengono dal DB di dev e cambiano dopo un reseed.

## Decisioni tecniche (confermate o cambiate in U1)

Vengono dalle due sonde del 2026-10-25 ([`probe-validation.md`](2026-10-25-hono-migration/notes/probe-validation.md), [`probe-mount.md`](2026-10-25-hono-migration/notes/probe-mount.md)) e dalle mappe ([`map-backend.md`](2026-10-25-hono-migration/notes/map-backend.md), [`map-frontend.md`](2026-10-25-hono-migration/notes/map-frontend.md)). La sonda di validazione ha lavorato con TypeBox; dove la decisione Zod cambia il come, è scritto. U1 (2026-10-25) ha segnato ognuna «confermata» o «cambiata» con le prove; i test citati stanno in `apps/api/tests/http/` e in `apps/api/tests/integration/me-avatar-route.test.ts`.

**D1 — Versione di Hono.** *Cambiata in U1: Hono 5 (`5.0.0-rc.1`, pin esatto nel catalog) da subito; U12 porta all'ultima 5.x prima di U13.*
Regola di Marco: la v5 (anche rc) se validatore, OpenAPI e better-auth funzionano. Provato con codice vero su `5.0.0-rc.1`: kit `src/http/` e `me/` su Hono 5; verdi i 89 casi di parità del validatore, i 54 confronti OpenAPI, i 16 test della rete del mount e i 6 della route con sessioni better-auth vere su testcontainer; `requireAuth` con `auth.api.getSession`; `hono/mount` con `auth.handler` (`/auth/api/ok` → 200, la strada di U11); `hc<WithErrors<MeApp>>` tipizzato nei tre FE; Hono CLI 1.0.0-rc.8 (batch e snapshot) col nuovo `tools/hono-entry.ts`. Codice specifico della v5: solo `onError((c) => c.error)` in `moduleApp()` e `hono/mount` al posto di `app.mount()` (tolto in v5) in `tools/hono-entry.ts`. L'unico pezzo che non regge la v5 è `@hono/zod-openapi` 1.6.3 (`OpenAPIHono` non è assegnabile a `Hono` 5 per `onError`/`notFound`: `hc<typeof app>` non compila), scartato comunque in D11.
Prima (sonda): il prototipo dava gli stessi risultati su 4.13.14 e 5.0.0-rc.1; `hono-openapi` (`^4.11.2`) esclude la v5 anche alla GA.

**D2 — Validatore: nostro `v(target, schema)`, con schemi Zod.** *Confermata in U1, con una correzione: middleware nostro su `c.req.addValidatedData`, non `hono/validator`.* `hono/validator` legge il body secondo il target (un JSON su una route `form` diventa `{}`), Elysia secondo il Content-Type. `v()` (`src/http/validator.ts`) legge come Elysia (`application/json` → JSON, malformato → 500; urlencoded e multipart: chiave ripetuta → array, valore che inizia con `{`/`[` → JSON; `text/*` → testo; senza Content-Type → assente), poi trim (`lib/deep-trim.ts`, condiviso col plugin `normalize`), default della radice e pulizia di exact-mirror riprodotti da `lib/zod/mirror.ts` (vedi D6: decidono il primo errore e cosa diventa un body null, primitivo o array), coercizione di query e params, `safeParseAsync` (default, campi sconosciuti tolti, controlli, decodifica), magic byte. Prova: `tests/http/validator.test.ts`.

`v` fa, in ordine: trim profondo di body JSON e form (come `plugins/normalize.ts`: stringhe a ogni profondità, salta le chiavi che corrispondono a `/password/i`, lascia stare File/Blob/Date) → default della radice e pulizia come Elysia (`elysiaValue`) → coercizione di query e params con le regole di D5 → `safeParse` (che toglie i campi sconosciuti) → controllo dei magic byte dei file (`file-type`) → valore decodificato in `c.req.valid(target)`. Primo errore → 422 con il messaggio di D6. Tipi per `hc`: input = `z.input`, output = `z.output`.
Prove: `@hono/typebox-validator` non sa coercizzare né decodificare (`?page=2` → 400) e il suo hook gira dopo il check; lo stesso limite vale per un validatore pronto con Zod, perché trim e coercizione stile Elysia vanno fatti prima del parse. Il prototipo `notes/prototypes/validation/validate.ts` (~240 righe, TypeBox) è il riferimento per l'ordine dei passi.

**D3 — Schemi durante lo strangler: gemelli Zod in `apps/api/src/lib/zod/`.** *Confermata in U1.* Ci sono `t.ts` (costruttori con la semantica di Elysia: `zInteger`, `zDate`, `zFile`, `zFiles`, `zFormat`, più `zNumeric`/`zBooleanString` che usa `v()`), `formats.ts` (le funzioni di formato di Elysia), `issues.ts` (issue Zod → regola), `responses.ts`, `pagination.ts`. Per il resto Zod normale, con `title`, `error` e `description` in `.meta()`; i costruttori di `t.ts` li prendono nelle opzioni, come TypeBox (finiscono anche nel JSON Schema). I gemelli di registrazione, sconti e ricerca prodotti del test di parità stanno in `tests/http/parity-cases.ts`: l'unità che migra quelle route li sposta in `lib/zod/`.

Stessi nomi di file e di export di `lib/schemas/` (`responses.ts`, `entities.ts`, `composed.ts`, …, `forms/*`), scritti modulo per modulo quando servono, nell'ordine del file sorgente. I file TypeBox non si toccano finché li usa una route Elysia. U11 sposta `lib/zod/*` (tranne `forms/`) in `lib/schemas/`; U11b mette i form Zod al posto di `lib/schemas/forms/*` (il percorso esportato come `@bibs/api/schemas`). I servizi che importano tipi `Static<…>` li tengono fino a U11b: i tipi sono strutturalmente uguali.
Prove: TypeBox 1 e 0.34 non si mescolano (il `TypeCompiler` 0.34 lancia sugli schemi `~kind`), e uno schema Zod in una route Elysia perderebbe i messaggi 422 (che leggono gli errori TypeBox): due copie per un tempo limitato sono il prezzo dello strangler.

**D4 — Campi fuori schema tolti in ingresso e in uscita.** *Confermata in U1* (`tests/http/validator.test.ts` «campi ignoti tolti a ogni livello», `tests/http/send.test.ts`, strip di `me/` in `tests/integration/me-avatar-route.test.ts`).

Ingresso: `z.object` (non `strictObject`/`looseObject`) toglie le chiavi sconosciute a ogni profondità, come la `normalize` di Elysia. Uscita: ogni handler risponde con `send(c, Schema, data)`, che fa `Schema.parse(data)` (toglie i campi in più, `Date` → stringa ISO al `JSON.stringify`) e, se il dato non rispetta lo schema, risponde 500 `INTERNAL_ERROR` «Errore interno del server» e logga un errore, come oggi. Un solo schema di successo per route basta: tutte le 176 route con `response` hanno un solo 200.
Prove: echo test del prototipo, campi annidati (`passwordHash`, `nested.internal`, `list[].internal`) tolti come in Elysia, 10/11 identici (l'undicesimo differisce solo nell'ordine delle chiavi dell'oggetto query interno). Oggi lo copre un solo test (`tests/modules/registration-response-schema.test.ts`), per questo ogni modulo aggiunge il suo test (vedi [Verifica](#verifica-di-ogni-pr)).

**D5 — Coercizione identica a Elysia, non `z.coerce`.** *Confermata in U1.* I formati sono le funzioni di Elysia 1.4.30 copiate in `src/lib/zod/formats.ts` (`email`, `uuid`, `uri`, `date` e `date-time` larghi) più il nostro `calendar-date`; i formati di Zod non si usano. Provati dal vivo contro Elysia: numeri e booleani in query (`"1"` → 422), array da virgole e chiavi ripetute, ultima chiave, default, stringa vuota, `1e3`, `t.Date` in query, intero come stringa nel JSON e nel multipart, oggetti JSON nel multipart, gg/mm/aaaa ed epoch per `t.Date`.

Regole (da `map-backend.md` §3 e `probe-validation.md` §4):
- solo query e params, solo al primo livello; le stringhe della query non si trimmano;
- numero: accettato se `!!v && !isNaN(+v)`, poi ricontrollato con i vincoli dello schema;
- booleano: solo `"true"`/`"false"` (`"1"` → 422);
- intero: stringa o intero, decodificato con `+v` e ricontrollato; vale anche nei body JSON (`{"percent":"5"}` passa, come oggi con `t.Integer`) e nei campi multipart;
- array in query: chiavi ripetute **e** valori separati da virgola (`?ids=a,b` → `["a","b"]`); per un campo non array una chiave ripetuta tiene l'ultimo valore;
- default iniettati (`page: 1`, `limit`, `sortBy`, `sortOrder`, `status: "active"` dei prodotti, `limit: 5` di geocode);
- date in ingresso: `Date`, `date-time`, `date` e numero epoch → `Date`;
- multipart: oggetti come stringa JSON, array come stringa JSON (`ObjectString`/`ArrayString` di Elysia);
- formati: le regex di Elysia per `email`, `uuid`, `uri`, `date`, `date-time` più `calendar-date` (`lib/schemas/forms/formats.ts`): le versioni Zod accettano cose diverse (la sonda ha trovato 10 differenze su 32 campioni tra TypeBox 1 ed Elysia; con Zod va rimisurato).
Prove: `z.coerce.boolean("false")` è `true` e `z.coerce.number("")` è `0`, quindi `z.coerce` romperebbe la parità; la sonda ha riprodotto le regole con una riscrittura dello schema di ~25 righe.

**D6 — 422 identici al byte.** *Confermata in U1 e corretta nel giro di revisione: 120/120 casi con status e corpo uguali a Elysia, al byte per gli errori* (`tests/http/validator.test.ts`, confronto dal vivo con un'app Elysia per caso): i 21 test di `tests/lib/validation-message.test.ts` (31 asserzioni) con le stesse stringhe, il corpus della sonda sugli schemi veri (registrazione, `DiscountCreateBody`, `DiscountListQuery`, `ProductSearchQuery`; anche JSON malformato → 500, senza Content-Type, `text/plain`, cookie `PARAGLIDE_LOCALE=en`), file e multipart, e i 31 casi del giro di revisione (ordine del primo errore, t.Nullable di oggetti e array con `OpeningHoursSchema`, unioni alla radice con `StockBulkAdjustBody` e `CreateHolidayDefinitionBody`, `Type.Integer`, body multipart con file). La prima versione (89 casi) dava un altro primo errore quando nel body mancava un campo anyOf (`POST {}` su `DiscountCreateBody`: «Titolo» invece di «Percentuale»), sugli errori dentro un t.Nullable e sulle unioni alla radice con un t.Integer: i casi non li coprivano, la revisione avversaria sì.

Come: `elysiaValue` (`lib/zod/mirror.ts`) ricostruisce il valore che Elysia controlla davvero: se lo schema ha un `default` da qualche parte (`hasProperty` di Elysia, anche quelli dentro t.Integer e t.Date; non se restano solo quelli di t.File) `Object.assign(defaults, body)`, quindi null, primitivi e array diventano un oggetto; poi la pulizia di exact-mirror 0.2.7: un campo obbligatorio «semplice» diventa una chiave propria anche se manca, uno Optional o anyOf (t.Integer, t.Date, t.Nullable, unioni; in query anche numeri, booleani e array; nei body con un file anche oggetti e array di primo livello, ObjectString/ArrayString) sparisce se manca; un'unione (t.Nullable compreso) si pulisce come `handleUnion`: col primo ramo che accetta il valore, se no col primo ramo che accetta il valore pulito da lui (`openingHours: ""` diventa `[]` e passa), se no resta com'è; dentro un ramo ogni lettura è `?.`; se la pulizia legge un campo di un valore nullo (anche `.length` di un array mancante dentro un ramo) lancia, ed Elysia controlla il body com'era. Su quel valore `firstIssue` (`lib/zod/issues.ts`) ricostruisce il primo errore di TypeBox: prima i controlli e poi la decodifica; nell'oggetto prima le chiavi obbligatorie che nel valore ripulito non ci sono, poi i campi nell'ordine dello schema; sullo stesso valore l'ordine dei controlli; un errore dentro un anyOf (t.Nullable di un oggetto o di un array) sta sul campo, con la regola del primo errore del ramo non nullo e senza i metadati annidati; un'unione con un ramo che passa il controllo e fallisce la decodifica dà quell'errore di decodifica («Valore non valido: deve essere al massimo 1000»). `src/http/validation-message.ts` scrive il messaggio con `ruleText` e `fieldLabel` esportati da `lib/validation-message.ts`.

Corpo `{"success":false,"error":"VALIDATION_ERROR","message":"<italiano>"}`. Il messaggio si costruisce dal primo errore con le regole di `lib/validation-message.ts` (vedi `map-backend.md` §1.2): messaggio custom dello schema (le 38 opzioni `error: "…"`), poi «Richiesta non valida» se non c'è dettaglio, poi «<etichetta>: <regola>» con etichetta da `title`, da `FIELD_LABELS` o dal path tecnico, «(riga N)» negli array. Le etichette e le regole si riusano esportandole dal file TypeBox, non si copiano. Stranezze da tenere:
- un vincolo violato dopo la decodifica perde l'etichetta: `?page=0` → «Valore non valido: deve essere almeno 1» (asserito in `tests/lib/validation-message.test.ts:225`);
- JSON malformato → **500** `INTERNAL_ERROR` (Hono lancia `HTTPException` 400: va mappata);
- body senza `Content-Type` → 422 «Richiesta non valida»; body `text/plain` su una route JSON → 422;
- **422 prima di 401/403**: i validatori di una route girano prima dell'auth (vedi D9);
- file del tipo sbagliato → 422 «<etichetta>: tipo di file non ammesso» (`invalidFileTypeMessage`).
Prove: la sonda ha ottenuto 27/27 casi identici al byte (registrazione, sconti seller body e query, query prodotti customer, 404, JSON malformato, senza Content-Type, `text/plain`, cookie `PARAGLIDE_LOCALE=en`) sia con TypeBox 1 sia con TypeBox 0.34; corpus e risultati attesi in `notes/prototypes/validation/cases.ts` e `before.json`. **Con Zod va dimostrato in U1** (`firstError` va riscritto sulle issue Zod: per gli union tiene il ramo non nullo e non di coercizione, come `unionRule` di `validation-rule.ts`). Se un caso non è riproducibile con Zod, U1 si ferma e lo scrive in [Domande aperte](#domande-aperte).

**D7 — Errori: una sola mappatura, `toErrorResponse`.** *Confermata in U1* (`src/http/errors.ts`; `tests/plugins/error-handler.test.ts` invariato e verde, 26/26). Il plugin Elysia traduce i suoi errori nelle classi del kit guardando la classe (`ValidationError`, `InvalidFileType`, `NotFoundError`), non `code`: Elysia dà un `code` anche ai nostri errori (`ServiceError(404).code` è `NOT_FOUND`). Il logger si passa (`getLogger(store)` da Elysia, standalone da Hono).

Si estrae il corpo di `plugins/error-handler.ts` (APIError better-auth, `ServiceError` e sottoclassi con `resentAt`, pg 23505/23503/23514, 422, file, 404, 500; log warn sotto 500, error da 500) in una funzione senza framework `toErrorResponse(error: unknown, req: { method: string; path: string }): { status: number; body: ErrorBody }` che logga con il logger standalone. La usano sia il plugin Elysia (finché esiste) sia l'`onError` Hono. Ogni sub-app Hono ha `onError` e `notFound` propri (404 `{"success":false,"error":"NOT_FOUND","message":"Risorsa non trovata"}`), così funziona uguale montata e da sola nei test.
Prove: senza, Hono risponde `500 text/plain "Internal Server Error"` e `404 text/plain "404 Not Found"`. La sonda ha verificato l'alternativa (sub-app che rilancia l'errore a Elysia, corpo e log identici), che resta il ripiego.

**D8 — Cosa Elysia continua a dare alle route montate, cosa fa Hono.** *Confermata in U1* (`tests/http/mount.test.ts`, 16 test: prefisso tolto, precedenza Elysia, preflight e header CORS, `x-request-id`, Set-Cookie multipli, riga di logixlysia con lo status di Hono, XFF sovrascritto su un socket vero, body JSON/multipart/testo intatti, errori in `text/plain` senza la fabbrica e in JSON con `moduleApp()`). In più: le risposte JSON del kit portano `Content-Type: application/json;charset=utf-8` come Elysia (`json()` in `src/http/send.ts`); un 404 sotto un prefisso montato ora ha `x-request-id` (delta 4).

Gratis finché c'è Elysia: preflight e header CORS, `X-Request-Id`, riga di log di logixlysia (con lo status vero di Hono), sovrascrittura di `x-forwarded-for` con l'IP del socket. Tocca a Hono: inviluppo errori e 404 (D7), trim, campi fuori schema, coercizione e 422 (D2–D6), auth (D9), rate limit (D12), `/openapi` (D11). Ogni sub-app nasce da `moduleApp()`, che instrada come Elysia: path grezzo (`getPath` nostro: Hono di suo decodifica il path prima del routing, quindi `/me/%61vatar` arrivava a `/avatar`; Elysia risponde 404, i parametri li decodifica `c.req.param()`) e uno slash finale tolto (Elysia tollera `/health/` → 200; due route sono definite con lo slash, `GET /admin/requests/` e `GET /seller/settings/`, ma chiamate senza: si registrano senza slash).
Prove: tabella in `probe-mount.md` §1 (24 test verdi su app vera, DB testcontainer, sessioni better-auth vere). Il mount toglie il prefisso (Hono vede `/avatar`, non `/me/avatar`), non legge mai il body (`parse: "none"`: JSON, multipart e testo arrivano intatti) e una route Elysia vince sempre sul mount, quindi un modulo si può migrare anche in parte.

**D9 — Auth come middleware, dopo i validatori.** *Confermata in U1* (`src/http/auth.ts`; 422 prima del 401 per l'anonimo nel batch `baseline/hono-batch-me.jsonl` e in `me-avatar-route.test.ts`).

`apps/api/src/http/auth.ts`: `type AuthEnv = { Variables: { user: AuthUser; session: AuthSession } }` (da `auth.$Infer.Session`), `requireAuth` = `createMiddleware<AuthEnv>` che chiama `auth.api.getSession({ headers: c.req.raw.headers })` e, senza sessione, lancia `ServiceError(401, "Devi accedere per continuare")`. I middleware di ruolo arrivano con il primo modulo che li usa: `requireCustomer` (U3, 403 «Profilo cliente non trovato», `c.var.customerProfile`), `requireSeller` (U5, `c.var.seller` = `resolveSellerAccess(user)`), `requireSellerRole` (U6, 403 «Accesso riservato ai venditori»), `requireAdmin` (U8, 403 «Accesso riservato agli amministratori»). Si mettono **in ogni route dopo i suoi `v(...)`**, mai come `app.use` di modulo, perché oggi la validazione precede l'auth (anonimo + query mancante su `/seller/orders` → 422 «Negozio: campo obbligatorio», già nello snapshot).

*Aggiunto nei giri di revisione di U1: chiusa per default, anche per il ruolo.* Con l'auth per route una guardia dimenticata compila e rende pubblica la route, e una guardia di ruolo dimenticata (solo `requireAuth` su una route admin) la apre a ogni utente con login (oggi l'admin è protetto dal `.guard` di modulo). Per questo `src/http/routes.ts`: ogni middleware di auth si crea con `guard(m, tag)` (`requireAuth` = `"auth"`; dalle unità seguenti `requireCustomer` = `"customer"`, `requireSeller` = `"seller"`, `requireSellerRole` = `"sellerRole"`, `requireAdmin` = `"admin"`), una route volutamente pubblica porta `publicRoute`, e il mount dichiara le guardie del modulo nel terzo argomento di `honoPaths()` in `src/index.ts` (obbligatorio: `me` `["auth"]`, poi customer `["customer", "publicRoute"]`, seller `["seller", "sellerRole"]`, admin `["admin"]`, catalogo `["publicRoute"]`; `publicRoute` vale solo nei moduli che la dichiarano). `assertRoutes(app, guards)` (chiamato da `honoPaths()`, quindi a ogni avvio e da `openapi-snapshot.ts`) ferma l'API se prima del primo handler vero di una route (tutto ciò che non è `doc()`, `v()`, guardia o `publicRoute`) non c'è una delle voci del modulo (una guardia, o `publicRoute` se il modulo la dichiara), se un `v()` sta dopo l'auth o se i `v()` non sono nell'ordine di Elysia (params → query → body). «Prima del primo handler» copre anche due registrazioni dello stesso metodo e path (risponde la prima); un `.all("/x")` senza `*` è una route come le altre (si saltano solo `use()` e i mount, ALL su un path con `*`). `requireAuth` non rilegge la sessione se un middleware a monte ha già messo `c.var.user` (solo il codice può farlo: è l'aggancio dei test, D13); i middleware di ruolo faranno lo stesso. `guard()` rifiuta un middleware già marcato (`guard(requireAuth, "admin")` lancia). Test: `tests/http/routes.test.ts`.
*U8:* `requireAdmin` (`src/http/auth.ts`) legge la sessione da sola (`readSession`, condivisa con `requireAuth`; stesso disegno di `requireSeller` in U5): 401 senza sessione, poi 403 «Accesso riservato agli amministratori». In una route basta lei, dopo i `v()`, e l'ordine fra guardie non conta più: il rimando «ordine auth → ruolo» di U1 è chiuso così per l'admin, senza controlli nuovi in `assertRoutes`.
Prove: prototipo `notes/prototypes/mount/hono-auth.ts`, 401 e quattro 403 con status e corpo uguali a Elysia. La sonda di mount proponeva di accettare il 401 prima del 422; il piano tiene la parità (vedi [Domande aperte](#domande-aperte)). `Authorization: Bearer` dà 401 oggi e domani (nessun plugin bearer, anche se `/openapi` lo dichiara).

**D10 — Client: `hc` per sotto-albero, in ogni app.** *Confermata in U1.* `packages/ui/src/lib/api-client.ts`: `ErrorBody`, `WithErrors<App>` (= `ApplyGlobalResponse` con `ErrorBody` su 400/401/403/404/409/422/429/500) e `unwrapJson` (test in `api-client.test.ts`); in ogni app `meApi = hc<WithErrors<MeApp>>(`${API_URL}/me`, { init: { credentials: "include" } })`. Typecheck dopo `me/` (media di 2 run): api 6,63 s, admin 8,35 s, customer 8,04 s, seller 9,95 s, tutti sotto la baseline: nessun ripiego.

L'API esporta un tipo per sub-app da `apps/api/src/types.ts` (`MeApp`, `LocationsApp`, `CustomerApp`, `RegistrationApp`, `SellerApp`, `AdminApp`, `CatalogApps`…); ogni app crea in `src/lib/api.ts` i client che usa, es. `hc<MeApp>(`${API_URL}/me`, { init: { credentials: "include" } })`. In `packages/ui/src/lib/api-client.ts`: `unwrapJson<T>(res: ClientResponse<T>, fallback: string): Promise<T>` che, se `!res.ok`, legge `message` dal corpo e lancia `ApiError(message, res.status)` (stessa classe di oggi, così `shouldRetryQuery` e i rami su `status` non cambiano), e il tipo `ErrorBody` applicato con `ApplyGlobalResponse` (da `hono/client`) per tipizzare i corpi 401/403/404/409/422/500. Le chiamate passano da `unwrap(await api()…, m)` a `await unwrapJson(await client….$verb(…), m)`. Le risposte arrivano con le date come stringhe (vedi [Trappole](#trappole-note)).
Ripiego se il budget di typecheck salta: prima tipi del client precompilati (`hcWithType` con un passo di build dei `.d.ts`), poi client generato da OpenAPI.
Prove: `probe-mount.md` §5 (`hc<MeApp>` attraverso il mount, `ApplyGlobalResponse` tipizza il 401), `probe-validation.md` §7 (json, query, param e risposta tipizzati su v4 e v5). Non misurato: il costo su tutti i 179 endpoint, per questo il budget si misura a ogni unità.

**D11 — OpenAPI: generatore nel repo dai metadati delle route.** *Confermata in U1.* Misure su `me/`: generatore nel repo → 0 differenze (l'intero `/openapi/json` è identico a `baseline/openapi.json` a chiavi ordinate, come lo confronta `openapi-snapshot.ts`: 198 path, 228 operazioni; nel documento grezzo cambiano solo l'ordine dei path e quello di `required`, delta 9) e 69 confronti schema per schema identici all'output di `@elysiajs/openapi` (`tests/http/openapi.test.ts`, 53 in U1 più 16 del giro di revisione); `@hono/zod-openapi` 1.6.3 → 74 foglie diverse su 184 di `/me/avatar` (48 mancanti, 26 in più: letterali come `enum`, niente `operationId`, solo `multipart/form-data`, metadati del file persi), definizione delle route lunga il doppio (`createRoute` + `.openapi()` al posto di `doc()` + `v()`; prototipo in `notes/prototypes/openapi/zod-openapi-me.ts`) e, con Hono 5, `hc<typeof app>` non compila. Come: `toJsonSchema` = `z.toJSONSchema` (lato input) con un `override` che scrive il JSON di TypeBox (costruttori di `t.ts`, `required` anche coi default, `nullable: true`, letterali in `anyOf` di `const`, niente limiti safe-int), poi le trasformazioni di `@elysiajs/openapi` (`src/http/openapi.ts`). Nessuna differenza di forma dovuta a Zod (riga 3 del registro dei delta).

Ogni route Hono porta `doc({ summary, description, tags, security, response })` (middleware no-op che conserva i metadati, come `detail`/`response` di Elysia) e gli schemi di `v(...)`; un generatore legge `app.routes`, converte gli schemi con `z.toJSONSchema` e produce i `paths`. Durante lo strangler i path delle sub-app si uniscono a `documentation.paths` del plugin Elysia (oggi solo i path better-auth), così `/openapi` resta completo; in U11 lo stesso generatore produce l'intero documento (info, tag, componenti e path better-auth, pagina Scalar).
U1 confronta questa strada con `@hono/zod-openapi` (`createRoute` per ogni operazione, accetta la v5 alla GA) sul modulo `me/` e sceglie quella con meno differenze rispetto a `baseline/openapi.json`; `hono-openapi` è escluso (peer `^4.11.2` esclude la v5, ogni operazione esce diversa). Le differenze di forma dovute a Zod (es. nullable, formati) vanno elencate nel registro dei delta.
Prove: con schemi TypeBox il port del generatore di `@elysiajs/openapi` 1.4.16 (`notes/prototypes/validation/openapi-gen.ts`) dà 181/181 operazioni identiche alla spec a freddo; i metadati letti da `app.routes` tramite `v()` e `doc()` sono identici (`probe-hono-routes.ts`). Con Zod la parità piena non è dimostrata: è il punto principale da misurare in U1.

**D12 — Rate limit: middleware Hono che riusa `consume` e `clientIp`.** *Da confermare in U2.*
`plugins/rate-limit.ts` diventa un middleware (stesse chiavi `${name}:${by}:${identity}`, stesso 429 con `retry-after` e corpo «Troppe richieste. Riprova più tardi.»), dopo validatori e auth come oggi (i body invalidi non consumano budget). Sotto il mount Hono non riceve il `server` di Bun: l'identità `ip` va letta da `x-forwarded-for`, che l'hook globale di better-auth ha già sovrascritto con l'IP del socket; con `TRUST_PROXY=true` resta il primo hop come oggi. Senza questo tutti i client finirebbero nel bucket `"unknown"`.

**D13 — Harness di test condiviso.** *Cambiata in U1:* `tests/helpers/hono-app.ts` dà `testRequest(app, path, init)`, `signIn(email, role)` (utente e sessione better-auth veri sul DB di test, cookie da mandare) e `withVars(app, { user, … })` (aggiunto nel giro di revisione): la sub-app dentro un'app che mette le variabili prima delle route, e `requireAuth` (come faranno i middleware di ruolo con `c.var.seller` & co.) non rilegge la sessione se l'utente c'è già. Così i 36 test senza DB che oggi montano le route nude e asseriscono 403 (`tests/modules/seller-*-owner-only.test.ts`, U5–U7) restano unit test: cambia come si costruisce l'app e si manda la richiesta, non le asserzioni. Niente utente finto da header.

`apps/api/tests/helpers/hono-app.ts`: `testRequest(app: Hono<any>, req: Request, opts?: { user?: … })` al posto dei ~20 harness copiati (`noopPino` + `errorHandler` + `.resolve` con `x-test-user`). Il finto utente si inietta come oggi dall'header `x-test-user` (lookup sul DB di test) con un middleware di test che fa `c.set("user", …)` e, per il seller, `resolveSellerAccess`. I test cambiano solo la riga che manda la richiesta.

**D14 — File: `file-type` diventa dipendenza diretta.** *Confermata in U1* (`file-type` `^22.1.1`, nel lock la stessa 22.1.1 di prima; controllo dei magic byte in `v()` dopo la validazione).

Oggi c'è solo come peer di Elysia (`file-type@22.1.1` nel lock): `apps/api` la aggiunge alla stessa versione (`^22.1.1`) per il controllo dei magic byte di `t.File({ type })`; `maxSize` resta un errore «tipo di file non ammesso» come oggi. `POST /seller/products/import` (`t.File({ type: "text/csv" })`) oggi risponde sempre 422 perché `file-type` non riconosce il testo: la parità lo lascia così (vedi [Domande aperte](#domande-aperte)).

**D15 — Log.** *Confermata in U1.* Differenza solo di log, nessuna HTTP: gli errori gestiti da una sub-app Hono si loggano col path visto dalla sub-app (`/avatar`, prefisso tolto dal mount) fino a U11.

Negli handler Hono si usa il `logger` standalone (`getLogger(undefined)` ci ricade già). La riga per richiesta resta quella di logixlysia fino a U11; in U11 un middleware Hono riscrive lo stesso formato (`{now} {level} {duration} {method} {pathname} {status} {ip}`, stdout + `logs/app.log`).

## Registro dei delta accettati

Differenze osservabili rispetto alla baseline, una riga per ciascuna, con l'unità che la introduce. Tutto ciò che non è qui deve risultare identico.

| # | Delta | Perché | Unità |
|---|---|---|---|
| 1 | `/<modulo>/auth` e `/<modulo>/auth/*` (copie morte del mount better-auth in admin, customer, locations, me, seller) rispondono col 404 JSON invece del 404 vuoto | nessuno le usa; sparite col modulo Elysia | U1, U2, U3, U5–U7, U8–U9 |
| 2 | Le righe dei moduli migrati in `routes.json` diventano `ALL /<prefisso>` + `ALL /<prefisso>/*` con `mount: "hono"` (le route tornano elencate passando `--hono` a `route-inventory.ts`) | effetto del mount | ogni modulo |
| 3 | Nessuna differenza di forma della spec OpenAPI dovuta a Zod: `/openapi/json` dopo U1 è uguale a `baseline/openapi.json` a chiavi ordinate (`openapi-snapshot.ts`; 198 path, 228 operazioni) | il generatore scrive il JSON di TypeBox (D11) | U1 |
| 4 | Ogni risposta sotto il prefisso di una sub-app montata porta `x-request-id`, anche dove prima non c'era: i 404 (`GET /me/nope`, `GET /me/avatar`) e i 500 degli errori di parse (`POST /me/avatar` con JSON malformato, `Content-Type: application/json` e body vuoto, multipart con boundary rotto o vuoto). Prima no: Elysia lo mette solo sulle route trovate e dopo il parse. Corpo e status uguali. Da U8 anche sotto `/admin` e i quattro path del catalogo (`GET /admin/nope`, `GET /product-categories/nope`) | effetto del mount; in U11 l'header andrà comunque su ogni risposta (Domanda aperta 6) | U1, U8 |
| 5 | `HEAD` su un path di una sub-app montata (`HEAD /me/avatar`, `HEAD /me/nope`): stesso status 404, ma `content-length: 0` invece di 69 su un server vero. Da U8 anche sulle route GET (`HEAD /product-categories?limit=1`, `HEAD /admin/configurations/counts`): stesso status e header, corpo vuoto come prima, ma `content-length: 0` invece della lunghezza del corpo del GET (su `:3108` una GET ancora Elysia, `HEAD /locations/countries`, dà 6558) | Hono toglie il corpo dell'HEAD prima che Bun calcoli la lunghezza; nessun client usa HEAD | U1, U8 |
| 6 | Un body illeggibile (JSON malformato o vuoto con `application/json`, multipart rotto) dà 500 solo se la route ha un `v()` del body, e dopo i `v()` di params e query. Prima: 500 su ogni route non GET (es. `DELETE /me/avatar` con body `{` → ora 401 anonimo, 200 con sessione) e prima di ogni validazione (param non valido + JSON malformato: prima 500, ora 422). In U8: `DELETE /admin/product-categories/x` con body `{` → ora 401 anonimo | Elysia legge il body di ogni richiesta non GET (il plugin `normalize` lo tocca in `onTransform`); Hono lo legge solo in `v()`. Riprodurlo vorrebbe un middleware che legge sempre il body, che romperebbe il body grezzo dei webhook (U10) | U1, ogni modulo |
| 7 | Multipart con chiavi `a.b` o `a[0]` (es. `file[0]`, `file.name`): Elysia le espande in oggetti e array, `v()` no (422 con un altro messaggio; `file` + `file[0]` → prima 422, ora la richiesta passa e con sessione carica `file`) | nessuna route né client manda chiavi così (`hc` ed Eden mandano `file`); si porta il parser di Elysia (`adapter/web-standard`, ~20 righe) col primo modulo che le usa | U1 |
| 8 | Un parametro di path con una codifica percentuale non valida (`/x/%E0%A4%A`): Elysia 422 «id: deve essere un testo», Hono passa il testo grezzo all'handler | `c.req.param()` di Hono restituisce il testo se non lo sa decodificare; solo URL costruite a mano | U1, ogni modulo con parametri |
| 9 | Nel documento grezzo `/openapi/json` i path di una sub-app montata vengono dopo quelli di Elysia (`/me/avatar` dalla posizione 150 all'ultima di 198) e dentro i loro schemi `required` viene dopo `properties`. A chiavi ordinate identico (riga 3) | i path si uniscono con `honoPaths(...)` in fondo a `documentation.paths`; `z.toJSONSchema` scrive le chiavi in un altro ordine. Scalar mostra lo stesso | U1, ogni modulo |
| 10 | Admin: cinque chiamate che lanciavano `new Error(res.error.value?.message \|\| …)` (`store-categories.config.tsx`: `useMacros` e l'import; `use-category-characteristics.ts`: la lista, `include`, `remove`) ora lanciano l'`ApiError` di `unwrapJson`, con lo stesso messaggio. Cambia solo il retry delle due query (`useMacros` e la lista delle caratteristiche): un 401/403/404 non si riprova più (prima 3 tentativi); l'import e le due mutation non passano dal retry | è la policy comune di `shouldRetryQuery` (`packages/ui/src/lib/query-retry.ts`: un 4xx è definitivo), la stessa di ogni chiamata che passava da `unwrap`; tenere `Error` vorrebbe un ramo a mano per sito | U8 |

## Review Focus

Cinque cose che i test di oggi non coprono e che morderebbero chi usa l'app; ognuna ha il suo controllo nelle unità.

1. **Colonne interne nelle risposte** (`documentImageKey`, `stripeCustomerId`, campi di ban, `updatedAt`) se un handler risponde senza `send()`: test di strip per modulo (ingresso e uscita) in ogni unità, più la revisione avversaria.
2. **Date come stringhe dove il FE chiama metodi di `Date`** (`dashboard-actions.ts` `.getTime()`, cast `as Date` negli ordini seller, `Subscription` del billing seller): elenco HARD per unità, typecheck senza cast, collaudo nel browser delle schermate (U6, U7, U9).
3. **Anonimo con input non valido riceve 401 invece di 422** se un middleware di auth finisce prima dei validatori, **o route pubblica per una guardia dimenticata**: `assertRoutes` a ogni avvio (D9), righe `expect` con corpo nel batch della CLI per ogni modulo con guard (U3, U5–U9) e test sul primo endpoint guardato di ogni modulo.
4. **Rate limit in un solo bucket** sotto il mount (`clientIp` → `"unknown"`): test in U2 e U4 con due `x-forwarded-for` diversi che finiscono in bucket diversi.
5. **Upload multipart serializzati male da `hc`** (array `files` delle immagini, campi + file del documento di onboarding, CSV admin): test della route con il `FormData` che costruisce il client e upload vero nel browser (U1 avatar, U5 immagini prodotto, U6 immagini negozio e documento, U8 import CSV).

---

## Verifica di ogni PR

Da copiare nella descrizione della PR e spuntare con l'output alla mano. Un punto che non si può fare (es. il modulo non ha FE) si scrive «n/a: motivo».

- [ ] **Typecheck:** `bun run typecheck` dalla root; ogni workspace stampa `Exited with code 0` (l'exit aggregato di `bun --filter` può nascondere un fallimento). Tempi `tsc` dei 4 workspace (media di 2 run) annotati nella tabella del budget dell'unità.
- [ ] **Lint:** `bun run lint` → 0 errori.
- [ ] **Test:** `bun run test` dalla root con Docker acceso; tutti e sei i workspace con `Exited with code 0`, nessun skip, nessun `Unhandled error between tests`; numeri confrontati con [`tests.md`](2026-10-25-hono-migration/baseline/tests.md) (un test in meno solo se cancellato per il meccanismo rimosso, scritto nella PR). Mai `bun test` nudo per la suite intera.
- [ ] **Build e avvio veri:** `bun run --filter @bibs/api build`, poi da `apps/api` con infra su (`bun run infra:up`) `PORT=3100 bun dist/index.js` e `curl -s -w '%{http_code}' localhost:3100/ready` → `200` con `{"status":"ok","services":{"database":"ok","s3":"ok"}}`; poi fermarlo.
- [ ] **Inventario route:** da `apps/api`, `bun ../../docs/superpowers/plans/2026-10-25-hono-migration/tools/route-inventory.ts --hono /me=src/modules/me/index.ts#meApp … --out /tmp/routes.json` (un `--hono` per ogni modulo già migrato) e `diff` con `baseline/routes.json`: solo le righe previste dal registro dei delta.
- [ ] **OpenAPI:** `bun ../../docs/superpowers/plans/2026-10-25-hono-migration/tools/openapi-snapshot.ts --out /tmp/openapi.json` (chiavi ordinate) e confronto con `baseline/openapi.json`: stesso insieme di path e metodi; ogni altra differenza è nel registro dei delta. Lo strumento passa anche da `assertRoutes` (D9): se fallisce, una route non ha auth né `publicRoute` o ha i `v()` fuori ordine.
- [ ] **Hono CLI:** i comandi `batch` e `diff` di [`hono-cli.md`](2026-10-25-hono-migration/baseline/hono-cli.md#parity-net-for-each-pr) → `summary.failed == 0`. In più, prima di toccare il modulo, catturare sul commit base le risposte con corpo e header delle sue route (`$HONO request …`, con un passo di login `POST /auth/api/sign-in/email` per le route con auth: 200, 401, 403, 404, 422) in `baseline/hono-batch-<modulo>.jsonl`, committarlo nella PR e rigiocarlo dopo: 0 fallimenti.
- [ ] **Strip:** un test del modulo dimostra che un campo sconosciuto annidato nel body o nella query non arriva al servizio e che un campo in più restituito dal servizio non esce nella risposta.
- [ ] **Revisione avversaria della parità:** un revisore (subagent) riceve il diff, `notes/map-backend.md` §1–4 e questo elenco: path, metodi, status, corpi, header (CORS, `x-request-id`, `cache-control`, `retry-after`), ordine 422/401/403, coercizione, default, array in query, trim tranne password, multipart, codifica delle date, slash finale, HEAD. Ogni rilievo si corregge o va nel registro dei delta.
- [ ] **Browser:** Chrome DevTools MCP, una scheda `new_page` con `isolatedContext` per ruolo (login con `seller@dev.bibs`, `employee1@test.com`, `admin1@test.com`, `customer1@test.com`, password `password123`; mai la pagina 1). Per ogni schermata toccata: `outerHTML` della schermata prima (commit base) e dopo, con `data-tsd-source` tolto, identici; console senza errori; rete senza 4xx/5xx inattesi e con le stesse URL e metodi di prima. Le azioni di scrittura solo su entità di prova create per il collaudo. Se i dev server di Marco sono accesi, il worktree usa altre porte (vite su `:3013`, API con `PORT`).
- [ ] **Budget di typecheck** rispettato (vedi Global Constraints).
- [ ] **Piano aggiornato** nella stessa PR: riga della tabella, campo **PR** dell'unità, decisioni confermate o cambiate, registro dei delta.

## Trappole note

- **`normalize` di Elysia.** Toglie i campi fuori schema da body, query e risposte a ogni profondità; Hono no. Senza `v()` e `send()` si accettano campi in più e si espongono colonne interne. Copre D4 + il test di strip per modulo.
- **Date idratate da Eden.** Eden (`parseDate: true`) trasforma in `Date` ogni stringa che sembra una data, anche il testo libero `dd/mm/yyyy` (per questo esiste `apiNoDates`); `hc` mai. Dove il FE tipizza `Date` il typecheck segnala; dove c'è un cast o `any` no: per questo ogni unità elenca i siti HARD. `apiNoDates` sparisce quando migra il suo ultimo utente (customer in U3, seller in U5) e le difese `instanceof Date` (`format-characteristic.ts:28`, `characteristic-form.ts:28`) diventano codice morto da togliere.
- **`hc`, route concatenate e `app.route`.** I tipi passano solo con le chiamate concatenate (`new Hono().get(…).post(…)`) e con `.route("/x", sub)` nella stessa catena; route aggiunte con istruzioni separate spariscono dal tipo. Esportare `type XApp = typeof xApp`. Stessa versione di `hono` in API e FE (catalog), `strict: true` da entrambe le parti (già così).
- **Query e param in `hc`** sono tipizzati come stringhe: i numeri vanno convertiti (`String(page)`); `null` diventa `"null"` (Eden lo saltava) e `Date` diventa `String(date)`: togliere i null e passare ISO.
- **Multipart in `hc`** vuole `form:` esplicito; un oggetto diventa `"[object Object]"`, un array diventa una voce per elemento. Il server (D5) si aspetta oggetti e array come JSON nei campi multipart: verificare in ogni upload.
- **Body grezzo per Stripe.** I webhook leggono `await c.req.text()` prima di chiunque altro; nessun middleware deve leggere il body prima. Durante lo strangler mai un `onParse` globale in Elysia: rende 400 i POST montati.
- **Formato errori nel FE.** `ApiError(message, status)` e `shouldRetryQuery` (niente retry sui 4xx) restano uguali; le pagine di registrazione leggono `error === "EMAIL_PENDING_VERIFICATION"` e `resentAt` dal corpo 409.
- **Inviluppo sotto il mount.** Senza `onError`/`notFound` la sub-app risponde in `text/plain`. Sempre la fabbrica del kit.
- **422 prima di 401.** Un `app.use(requireX)` di modulo inverte l'ordine: auth dentro ogni route, dopo i validatori.
- **Auth chiusa per default.** Ogni middleware di auth nuovo si crea con `guard(m, tag)` (`src/http/routes.ts`), ogni route pubblica porta `publicRoute`, e il mount in `src/index.ts` dichiara le guardie del modulo (`honoPaths(adminApp, "/admin", ["admin"])`): `assertRoutes` ferma l'avvio se prima del primo handler di una route non c'è una guardia del modulo, o `publicRoute` in un modulo che la dichiara (D9). Un modulo misto (customer: prodotti e negozi pubblici, il resto con `requireCustomer`) dichiara `["customer", "publicRoute"]` e mette l'una o l'altra route per route. Nessun middleware che non sia `doc()`/`v()` prima della guardia (un rate limit va dopo, D12).
- **Ordine dei `v()`.** In una route `v("param")` → `v("query")` → `v("json" | "form")`, come Elysia (params, query, body); `assertRoutes` lo controlla.
- **Gemelli.** `t.Integer` di Elysia → `zInteger`; `Type.Integer` di `@sinclair/typebox` (form condivisi: `dayOfWeek` degli orari, `position` dei telefoni) → `z.int()`, che non accetta stringhe ma, a differenza di `Type.Integer`, rifiuta gli interi oltre i safe-int (2^53: `zInteger` non li limita più, U2 e U8; un `z.int()` senza `maximum`, come `position`, va fatto con lo stesso controllo `Number.isInteger` o il caso va nel registro dei delta); `t.Union` di oggetti → `z.union`, mai `z.discriminatedUnion` (sceglie il ramo dal discriminante e dà errori che TypeBox non dà: `{}` → «mode: valore non valido» invece di «Richiesta non valida»). Ogni gemello nuovo va in `tests/http/parity-cases.ts`.
- **Gap noti del validatore** (nessuna route di oggi li tocca, `ponytail:` in `validator.ts`): la coercizione di query e params è solo al primo livello (Elysia scende anche negli anyOf e negli array: `?from=<epoch>` su `t.Optional(t.Date())` è 200 in Elysia, 422 nel kit); i default annidati li mette Zod e non Elysia (`items: [{}]` con un default nell'elemento; per lo stesso motivo nella pulizia di un'unione un ramo con un default annidato può accettare un valore che il Check di TypeBox rifiuta); chiavi multipart `a.b`/`a[0]` (delta 7); la pulizia di un `t.Record` (exact-mirror pulisce i valori oggetto del record, `lib/zod/mirror.ts` lascia il record com'è: può cambiare il primo errore, non il valore validato; l'unico `t.Record` in ingresso di oggi, in `seller/routes/orders.ts`, ha valori `t.Integer`); il messaggio 422 di un'unione di oggetti annidata in un campo (non alla radice né `t.Nullable`, che sono coperti): `firstIssue` non riproduce il primo errore di TypeBox. Chi aggiunge uno schema così estende `coerce()`/`readFormData()`/`mirror.ts`/`issues.ts` e aggiunge i casi di parità.
- **Slash finale e path grezzo.** Li dà `moduleApp()` (`getPath` nostro, D8): non creare app Hono con `new Hono()` per un modulo montato.
- **`code` di Elysia sui nostri errori.** Nell'`onError` di Elysia un `ServiceError(404)` arriva con `code: "NOT_FOUND"` come il 404 di routing: si distingue per classe (`plugins/error-handler.ts`), mai per `code`.
- **Body letto per Content-Type, non per target.** Non usare `hono/validator`: con il target `form` un body JSON diventa `{}`, Elysia lo legge come JSON. Si usa `v()`.
- **Default dentro un `t.Optional`.** Elysia mette il default anche quando il campo opzionale manca, anche in PATCH: `PATCH /admin/product-macro-categories/:id` con solo `name` riporta `suggestedVatRate` a «22» (`VatRateSchema` ha `default: "22"`). Il gemello tiene il default (`VatRateSchema.optional()`, Zod 4 lo applica dentro l'optional): caso in `parity-cases.ts`, riga del batch `hono-batch-admin-1.jsonl` e test in `admin-catalog-routes.test.ts`.
- **Costruttori di `lib/zod/t.ts`.** `title`/`description`/`error` nelle opzioni (finiscono nel JSON Schema come in TypeBox), `default` nelle opzioni (il campo diventa facoltativo in ingresso). Un gemello nuovo si prova aggiungendo un caso a `tests/http/parity-cases.ts`: il test confronta 422 e OpenAPI con Elysia. In risposta (`send()`) t.Integer e t.Date codificano senza decodificare, come la `response` di Elysia: «5» resta «5», un numero per un t.Date è un 500.
- **`app.mount()` non esiste in Hono 5.** Per montare un handler fetch su Hono: `app.all("/x/*", mount(handler))` da `hono/mount` (`tools/hono-entry.ts`, better-auth in U11).
- **Prefisso tolto dal mount** con la lunghezza del prefisso dell'istanza che monta: montare sempre sull'app radice in `src/index.ts`, mai dentro un plugin con prefisso. Il catalogo ha 4 path radice → 4 mount.
- **Precedenza:** una route Elysia vince sul mount; migrando in parte si cancella la route Elysia nella stessa PR, o resterà lei a rispondere.
- **bun test.** Sempre `bun run test` (`--parallel=4 --isolate`); `mock.module` è globale e passa tra file; better-auth si importa dentro il test dopo `mock.module("@/db")`; un mock di env rompe Stripe (singleton lazy).
- **`routeTree.gen.ts`.** Se cambia un file di route FE, si committa il generato (la CI `web-build` fallisce altrimenti).
- **Biome.** Controlla anche `docs/**/*.ts` e `.json` (i prototipi in `notes/` hanno 5 warning, nessun errore: non aggiungerne); ignora i generati e `.agents`/`.claude/skills`; l'hook corregge da solo a ogni Edit/Write.
- **Alias `@/` dei FE.** Nei tre FE `@/*` punta prima a `./src/*` e poi a `../api/src/*`: mai creare in `apps/api/src` un file con un percorso che esiste già in un FE (es. `src/lib/api.ts`, `src/lib/auth-client.ts`). `src/http/` e `src/lib/zod/` oggi sono liberi.
- **Formati.** Con TypeBox `format: "email"` funziona solo perché Elysia registra i suoi formati; i gemelli Zod devono usare le stesse regex (D5).
- **Logger.** `getLogger(store)` non ha `store` in Hono: usare `logger`.
- **`noUnusedLocals`** nei FE: togliere gli import di Eden rimasti a ogni cambio di client.

---

## Unità di lavoro

Per ogni unità: backend, test (cambia solo l'invio della richiesta), call site FE (righe da `notes/frontend-calls/calls.json`, rigenerabile con `node notes/frontend-calls/eden-calls.mjs <repo>`), siti con date, checklist. La checklist finisce sempre con la [Verifica di ogni PR](#verifica-di-ogni-pr).

### U0 — Piano e baseline

**Stato:** fatto · **PR:** #300 · **Branch:** `docs/hono-migration-plan`

- [x] Baseline e strumenti (`baseline/`, `tools/`), commit `4a37d2ab`.
- [x] Mappe e note delle sonde spostate in `notes/` (anche prototipi e inventario delle chiamate FE).
- [x] Piano scritto.
- [x] `bun run lint` verde.
- [x] PR #300 aperta verso `feat/hono-migration`.
- [x] CI verde, merge squash (`6fb928d9` su `feat/hono-migration`).

### U1 — `me/` e fondamenta

**Stato:** fatto · **PR:** #301 · **Branch:** `feat/hono-u1-me` (nome dato dall'orchestratore al posto di `refactor/hono-me`)

Primo modulo: 2 endpoint (`POST /me/avatar` multipart con `t.File({ type: "image", maxSize: "5m" })`, `DELETE /me/avatar`), entrambi con auth per route. Costruisce il kit, conferma D1–D11 e D13–D15 e misura il costo di `hc`.

**Backend**
- Root `package.json`: catalog `"hono": "5.0.0-rc.1"` (D1 cambiata; era `^4.13.14`). `apps/api/package.json`: `hono` e `zod` (`catalog:`), `file-type` `^22.1.1`. `packages/ui/package.json` (e le app, se importano `hono/client`): `hono` `catalog:`.
- Create `apps/api/src/http/validator.ts`: `v(target: "json" | "form" | "query" | "param", schema: z.ZodType)` (D2, D5).
- Create `apps/api/src/http/validation-message.ts`: messaggio italiano dalla prima issue Zod (D6), riusando `FIELD_LABELS` e le regole esportate da `src/lib/validation-message.ts` e `src/lib/validation-rule.ts`.
- Create `apps/api/src/http/send.ts`: `send(c, schema, data)` (D4).
- Create `apps/api/src/http/errors.ts`: `toErrorResponse` (D7); Modify `apps/api/src/plugins/error-handler.ts` per usarla.
- Create `apps/api/src/http/auth.ts`: `AuthEnv`, `requireAuth` (D9).
- Create `apps/api/src/http/app.ts`: `moduleApp()` = `new Hono({ strict: false })` con `onError` e `notFound` (D7, D8); le variabili di `AuthEnv` le porta `requireAuth` nella catena della route.
- Create `apps/api/src/http/openapi.ts`: `doc(…)`, generatore e unione in `documentation.paths` (D11).
- Create `apps/api/src/lib/zod/responses.ts`: gemelli di `ok`/`okRes`/`OkMessage`/`withErrors`/`ErrorBody` (D3); `lib/zod/{t,formats,issues,pagination}.ts` (D3, D5, D6); `lib/deep-trim.ts` (trim condiviso col plugin `normalize`).
- Modify `apps/api/src/modules/me/index.ts`, `apps/api/src/modules/me/routes/avatar.ts`: `meApp` Hono (route relative `/avatar`), `export type MeApp`.
- Modify `apps/api/src/index.ts`: `.use(meModule)` → `.mount("/me", meApp.fetch)`; path OpenAPI di `meApp` uniti al documento.
- Modify `apps/api/src/types.ts`: `export type { MeApp }`.

**Test**
- Create `apps/api/tests/helpers/hono-app.ts` (D13).
- Create `apps/api/tests/http/validator.test.ts`: i 21 casi di `tests/lib/validation-message.test.ts` con un gemello Zod di ogni schema in linea e **le stesse stringhe attese**; più i casi del corpus (`notes/prototypes/validation/cases.ts` + `before.json`) che non chiedono route di modulo: JSON malformato → 500 `INTERNAL_ERROR`, senza `Content-Type` → «Richiesta non valida», `text/plain` → 422, intero `"5"` accettato nel JSON e `5.5` → «… deve essere un numero intero», regole di D5 su query (numero, booleano, array con virgola e chiavi ripetute, default, ultima chiave vince), trim tranne `/password/i`, campi sconosciuti annidati tolti, cookie `PARAGLIDE_LOCALE=en` → messaggio italiano.
- Create `apps/api/tests/http/send.test.ts`: campi annidati in più tolti, `Date` → ISO, dato fuori schema → 500 «Errore interno del server».
- Create `apps/api/tests/http/mount.test.ts`: rete dello strangler dai 24 test della sonda (`notes/prototypes/mount/mount.test.ts`): prefisso tolto, route Elysia che vince sul mount, CORS e `x-request-id` sulle risposte montate, body grezzo intatto (JSON, multipart, testo), status e `Set-Cookie` multipli conservati.
- Create `apps/api/tests/integration/me-avatar-route.test.ts` (in `integration/` e non in `modules/`: serve il DB per le sessioni better-auth vere): senza sessione → 401 «Devi accedere per continuare»; file non immagine → lo stesso 422 di oggi (catturato prima della modifica); upload valido → 200 `{ success: true, data: { image } }`; strip (campo in più nel form e nella risposta).
- Invariati e verdi: `tests/plugins/error-handler.test.ts`, `tests/lib/validation-message.test.ts`, `tests/integration/me-avatar.test.ts`.
- Fatto in più: `tests/http/parity-cases.ts` (120 casi dopo il giro di revisione, 89 prima; schema TypeBox + gemello Zod + atteso) usato da `validator.test.ts` e `openapi.test.ts` (D11); `tests/http/routes.test.ts` (`assertRoutes`, `withVars`); `tests/http` aggiunto a `test:unit`; `packages/ui/src/lib/api-client.test.ts` (`unwrapJson`).

**Frontend** (6 chiamate, tutte avatar: POST multipart, DELETE)
- `packages/ui/src/lib/api-client.ts`: `unwrapJson`, `ErrorBody` / `ApplyGlobalResponse` (D10). `unwrap`, `edenMessage`, `createApiClient` restano finché c'è Eden.
- `apps/{admin,customer,seller}/src/lib/api.ts`: client `me`.
- admin `src/routes/_authenticated/profile.tsx:78,85`; customer `src/features/profile/profile-identity.tsx:56,63`; seller `src/features/profile/components/personal-info-card.tsx:73,80`.

**Date:** nessuna.

**Checklist**
- [x] Prima di toccare il codice: catturato `baseline/hono-batch-me.jsonl` (16 passi: 422 da anonimo per body assente/urlencoded/JSON, 401, slash finale, 404, preflight 204, login `customer1@test.com`, 422 e 200 con sessione; DELETE è un no-op per l'utente del seed senza immagine). Header di `/me/avatar` catturati con `hono request` e asseriti in `tests/http/mount.test.ts`. Il 200 dell'upload è nel test di route (testcontainer): sul DB di dev avrebbe scritto sull'utente del seed.
- [x] Kit `src/http/` e test di `validator` (89), `send` (2), `mount` (16), `openapi` (54) verdi.
- [x] `me/` su Hono, route Elysia e `meModule` tolti, mount in `src/index.ts`.
- [x] Tre FE su `hc` per `/me` (typecheck e test verdi); upload e rimozione avatar provati nel browser nella spedizione (sotto), con un cliente di prova creato dalla registrazione.
- [x] D11: confronto generatore nel repo vs `@hono/zod-openapi` su `me/` (0 contro 74 foglie diverse), scelta scritta in D11; righe 3 e 4 del registro dei delta compilate.
- [x] Typecheck dei 4 workspace (wall time, media di 2 run; baseline tra parentesi): api 6,63 s (6,65) · admin 8,35 s (9,51) · customer 8,04 s (8,61) · seller 9,95 s (9,96). Istanziazioni (`--extendedDiagnostics`): api 2,12 M (1,77 M), admin 2,45 M (2,23 M), customer 2,31 M (2,10 M), seller 2,59 M (2,37 M): +9–20 %, senza effetto sul tempo.
- [x] D1–D11, D13–D15 marcate «confermata» o «cambiata».
- [x] Nuova sezione in `docs/architecture.md` («Migrazione Elysia → Hono (in corso)»); la sezione Eden dice che è in transizione.
- [x] [Verifica di ogni PR](#verifica-di-ogni-pr), con i numeri:
  - typecheck: `bun run typecheck` → exit 0, i 6 workspace (emails, ui, api, admin, customer, seller) e i 3 `pretypecheck` con `Exited with code 0`;
  - lint: `bun run lint` → exit 0, 0 errori (6 avvisi tutti preesistenti: i 5 dei prototipi in `notes/` e la dimensione di `baseline/openapi.json`);
  - test: `bun run test` → exit 0; emails 26, ui 40 (+3), api unit 681 (+161), api integration 975 in 102 file (+6, +1), admin 112, customer 169, seller 206; totale 2.209 (baseline 2.039), 0 fail, 0 skip, nessun `Unhandled error between tests`;
  - build e avvio: `bun run --filter @bibs/api build` (7,47 MB), `PORT=3100 bun dist/index.js` → `/ready` 200 `{"status":"ok","services":{"database":"ok","s3":"ok"}}`, `DELETE /me/avatar` 401 con CORS e `x-request-id`, `/openapi/json` con `/me/avatar`; fermato;
  - inventario route: 246 righe; diff con la baseline solo `/me/auth`, `/me/auth/*` (better-auth) → `/me`, `/me/*` (hono) (delta 1 e 2);
  - OpenAPI: uguale alla baseline a chiavi ordinate (198 path, 228 operazioni; delta 3 e 9);
  - Hono CLI: batch della baseline 66/66; snapshot rigenerato: solo le 4 righe di `/me` previste (delta 2); `baseline/hono-batch-me.jsonl` 16/16;
  - strip: `tests/integration/me-avatar-route.test.ts` (form e risposta) più `send.test.ts` e i casi di `validator.test.ts`;
  - revisione avversaria e browser: non fatti in U1 (li fa l'orchestratore prima della PR).

**Giro di revisione 1** (revisione avversaria dell'orchestratore, lenti «parity» e «foundations»). Corretto: primo errore del 422 con i campi anyOf mancanti, body null/primitivi, errori dentro t.Nullable di oggetti e array, unioni alla radice con decodifica, body multipart con file (`lib/zod/mirror.ts`, `lib/zod/issues.ts`, D6); `Type.Integer` → `z.int()`; `send()` codifica t.Integer e t.Date come la `response` di Elysia; path instradato grezzo in `moduleApp()` (`/me/%61vatar` → 404, D8); auth chiusa per default e ordine dei `v()` controllati a ogni avvio (`src/http/routes.ts`, D9); `withVars` nell'harness (D13). Registrati come delta: 4 (allargato), 5–9. Annotati nelle Trappole i gap che nessuna route tocca. Rifiutato: niente. Verifica dopo il giro:
  - typecheck: `bun run typecheck` → exit 0, 6 workspace e 3 `pretypecheck` con `Exited with code 0`; lint → exit 0, 0 errori (gli stessi 6 avvisi);
  - test: `bun run test` → exit 0; emails 26, ui 40, api unit 747 (+66: validator 120, openapi 70, mount 24, send 7, routes 6), api integration 975 in 102 file, admin 112, customer 169, seller 206; totale 2.275, 0 fail, 0 skip, nessun `Unhandled error between tests`;
  - build e avvio: 7,48 MB; `PORT=3100` → `/ready` 200 con database e s3 ok, `DELETE /me/avatar` 401 con CORS e `x-request-id`, `DELETE /me/%61vatar` 404; fermato;
  - inventario route: diff con la baseline solo le righe dei delta 1 e 2; OpenAPI: `openapi-snapshot.ts` identico a `baseline/openapi.json` (198 path, 228 operazioni), `assertRoutes` passato;
  - Hono CLI: batch della baseline 66/66; snapshot rigenerato: solo le 4 righe di `/me` (delta 2); `baseline/hono-batch-me.jsonl` 18/18 (+2: `DELETE /me/%61vatar` anonimo e `/me/av%61tar` con sessione → 404, il comportamento di Elysia);
  - typecheck, wall time medio di 2 run (baseline tra parentesi): api 6,94 s (6,65) · admin 8,30 s (9,51) · customer 7,94 s (8,61) · seller 9,84 s (9,96), sotto il budget.

**Giro di revisione 2** (stesse lenti, sul commit `fa4832ef`). Corretto:
  - *major, foundations:* `assertRoutes` accettava qualunque guardia, quindi una route admin con solo `requireAuth` passava il controllo e rispondeva a ogni utente con login. Ora `guard(m, tag)` e le guardie del modulo nel terzo argomento (obbligatorio) di `honoPaths()` in `src/index.ts` (`me`: `["auth"]`); prima del primo handler vero ci vuole `publicRoute` o una guardia del modulo (D9, Trappole, `docs/architecture.md`);
  - *minor, foundations:* due registrazioni dello stesso metodo e path (la prima, senza guardia, risponde) e `.all("/x")` senza `*` (saltata come un `use()`) passavano il controllo: stessa regola «prima del primo handler», ALL saltato solo su un path con `*`, `doc()` marcato (simbolo `DOC` in `routes.ts`). Sei test nuovi in `tests/http/routes.test.ts` (12 in tutto);
  - *minor, foundations:* `lib/zod/mirror.ts` non rifaceva `handleUnion` di exact-mirror: `openingHours: ""` è 200 con `[]` in Elysia e 422 nel kit, e se la pulizia di un ramo lancia Elysia controlla il body com'era (primo errore diverso). Ora un'unione o un t.Nullable si pulisce col primo ramo che accetta il valore, se no col primo che accetta il valore pulito, con letture `?.` dentro il ramo (D6). Tre casi nuovi in `parity-cases.ts` (falliscono sul `mirror.ts` di prima); i fuzzer della revisione (`union-throw`, `fuzz-patch`, `fuzz-random-store`, `fuzz-random`, `fuzz-body`, `fuzz-body2`, `fuzz-form`, `fuzz-query`) ora tutti a 0 differenze con Elysia.
Rifiutati, con le prove: i cinque rilievi della lente «parity» sono stati misurati su `7266be02` e sono già chiusi in `fa4832ef`: `DELETE /me/avatar` con un body illeggibile è il delta 6; `/me/%61vatar` è 404 (`rawPath` in `moduleApp()`, D8; righe 11 e 18 di `baseline/hono-batch-me.jsonl`, e `DELETE /me/%61vatar` → 404 sul server vero su `:3100`); le chiavi multipart `a.b`/`a[0]` sono il delta 7; `x-request-id` sui 500 di parse è nel delta 4 allargato e il `content-length` dell'HEAD è il delta 5; D11 e la riga 3 dicono «a chiavi ordinate» e l'ordine grezzo è il delta 9. Verifica dopo il giro:
  - typecheck: `bun run typecheck` → exit 0, 6 workspace e 3 `pretypecheck` con `Exited with code 0`; lint → exit 0, 0 errori (gli stessi 6 avvisi);
  - test: `bun run test` → exit 0, ogni workspace `Exited with code 0`; emails 26, ui 40, api unit 758 in 70 file (+11: validator 123, openapi 72, routes 12, mount 24, send 7), api integration 975 in 102 file, admin 112, customer 169, seller 206; totale 2.286, 0 fail, 0 skip, nessun `Unhandled error between tests`;
  - build e avvio: 7,49 MB; `PORT=3100 bun dist/index.js` → `/ready` 200 `{"status":"ok","services":{"database":"ok","s3":"ok"}}`, `DELETE /me/avatar` 401 con `access-control-allow-origin` e `x-request-id`, `DELETE /me/%61vatar` 404, `DELETE /me/avatar` con body `{` 401 (delta 6), `/openapi/json` con `/me/avatar` (delete, post); fermato;
  - inventario route: 246 righe, diff con la baseline solo `/me/auth`, `/me/auth/*` → `/me`, `/me/*` (delta 1 e 2); OpenAPI: l'output a chiavi ordinate di `openapi-snapshot.ts` identico al byte a `baseline/openapi.json` (198 path, 228 operazioni; il documento grezzo servito differisce solo nell'ordine, delta 9), `assertRoutes` passato con `["auth"]`;
  - Hono CLI: batch della baseline 66/66; `baseline/hono-batch-me.jsonl` 18/18 (corpi attesi; `batch` confronta solo status e corpo, gli header di `/me/avatar` li asserisce `tests/http/mount.test.ts`); snapshot rigenerato (196 righe): solo le 4 righe di `/me` (delta 2);
  - typecheck, wall time medio di 2 run (baseline tra parentesi): api 6,96 s (6,65) · admin 8,32 s (9,51) · customer 9,35 s (8,61; run 10,69 e 8,00, carico 4,4) · seller 9,96 s (9,96), sotto il budget.

**Spedizione** (orchestratore, sul commit `862112ba`). Rilievi della verifica finale: la lente «parity» ripeteva i cinque rilievi già chiusi nel giro 2 (rimisurati: `DELETE /me/avatar` con body illeggibile = delta 6; 32 richieste con segmenti codificati sotto `/me` — `%61vatar`, `%2F`, `%20`, `/%6De/avatar`, `//`, `/./`, maiuscole — status e corpo identici a `origin/feat/hono-migration`; chiavi multipart = delta 7; header = delta 4 e 5; OpenAPI: corretta la frase «identico al byte», vale per l'output a chiavi ordinate, l'ordine grezzo è il delta 9). Lente «foundations», corretti i due banali: `publicRoute` vale solo nei moduli che la dichiarano (`"publicRoute"` tra le voci di `honoPaths()`; prima una route admin marcata pubblica passava `assertRoutes`) e `guard()` rifiuta un middleware già marcato (prima `guard(requireAuth, "admin")` cambiava la guardia di `requireAuth`), due test in `tests/http/routes.test.ts` (14); annotati tra i gap noti la pulizia dei `t.Record` e il primo errore di un'unione di oggetti annidata. Rimandati (nessuna route di U1 li tocca): guardie seller in una sola lista (U5/U6), ordine auth → ruolo (U3, U5, U8), ALL e `use()` su un path con `*` (al primo modulo che li usa). Verifica:
  - typecheck: `bun run typecheck` → exit 0, 6 workspace e 3 `pretypecheck` con `Exited with code 0`; lint → exit 0, 0 errori (gli stessi 6 avvisi);
  - test: `bun run test` → exit 0 in 339 s, ogni workspace `Exited with code 0`; emails 26, ui 40, api unit 760 in 70 file (+2), api integration 975 in 102 file (298,6 s), admin 112, customer 169, seller 206; totale 2.288, 0 fail, 0 skip, nessun `Unhandled error between tests`;
  - build e avvio: 7,49 MB; `PORT=3100 bun dist/index.js` → `/ready` 200 `{"status":"ok","services":{"database":"ok","s3":"ok"}}`, `DELETE /me/avatar` 401 con `access-control-allow-origin` e `x-request-id`, `DELETE /me/%61vatar` 404, `/openapi/json` con `/me/avatar` (delete, post); fermato;
  - inventario route: 246 righe, diff solo `/me/auth`, `/me/auth/*` → `/me`, `/me/*` (delta 1 e 2); OpenAPI: output di `openapi-snapshot.ts` uguale al byte (`cmp`) a `baseline/openapi.json` (198 path, 228 operazioni), `assertRoutes` passato;
  - Hono CLI: batch della baseline 66/66; `baseline/hono-batch-me.jsonl` 18/18; snapshot 196 righe, diff solo le 4 righe di `/me` (delta 2). Header: i 18 passi più 3 (DELETE e preflight da un'origine non ammessa, multipart rotto) rigiocati con `app.handle` sul commit base e sul branch: 21/21 con status, corpo e header uguali, tranne `x-request-id` sui cinque 404 (delta 4);
  - typecheck, wall time medio di 2 run (baseline tra parentesi): api 6,98 s (6,65) · admin 8,32 s (9,51) · customer 8,16 s (8,61) · seller 9,92 s (9,96), sotto il budget;
  - browser (Chrome DevTools MCP, un contesto isolato per ruolo, server sulle porte standard, prima da un worktree di `origin/feat/hono-migration` e poi dal branch, stesso copione): profilo e dialogo dell'avatar per `customer1@test.com`, `seller@dev.bibs`, `employee1@test.com`, `admin1@test.com`; upload e rimozione veri con `collaudo.hono.u1@test.com` (cliente creato dalla registrazione e verificato da Mailpit; resta nel DB di dev, senza immagine); per seller e admin upload con `fetch` intercettato (nessuna scrittura sul seed): stessa richiesta prima e dopo (`POST /me/avatar`, multipart, campo `file` `avatar.jpg` `image/jpeg`, `credentials: include`). 15 stati: `outerHTML` di `main` e dei dialoghi (senza `data-tsd-source`) identici, a parte la chiave S3 casuale dell'avatar caricato; console senza errori (solo l'avviso del preload del font Geist, uguale prima e dopo); rete con le stesse URL, metodi e status, nessun 4xx/5xx;
  - CI: il primo giro sulla PR ha trovato 94 casi rossi in `tests/http/openapi.test.ts`, mai visti in locale: su Linux Bun fa girare `validator.test.ts` prima di `openapi.test.ts` (su macOS dopo) e, compilando gli schemi TypeBox dei casi di parità, Elysia ci scriveva `additionalProperties: false`, così la spec di confronto non era più «a freddo». Ora `elysiaApp()` (`parity-cases.ts`) compila una copia (`CloneType`): `tests/http` verde anche nell'ordine della CI. Resta un `ponytail:` in `openapi.test.ts`: gli schemi di risposta veri sono condivisi col resto di `test:unit`, e se un file che li compila girasse prima servirebbe `--isolate`.

### U2 — `locations/`

**Stato:** da fare · **PR:** — · **Branch:** `refactor/hono-locations`

6 endpoint, `GET /locations/geocode` con auth e poi rate limit (`ip` 30/min; risposte 429 e 503), query con `title` («Numero di suggerimenti»), `limit` intero 1–10 default 5, `lat`/`lng` numeri; `/municipalities/all` con `cache-control` (prod `public, max-age=86400, stale-while-revalidate=604800`, altrimenti `no-store`); `/municipalities` con query composta (paginazione + filtri).

**Backend:** `apps/api/src/modules/locations/{index.ts,routes/locations.ts}`; Modify `apps/api/src/plugins/rate-limit.ts` (middleware Hono, D12; resta anche il wrapper Elysia finché lo usa la registrazione); gemelli in `src/lib/zod/` (paginazione, query di `lib/queries.ts` usate qui, schemi di `entities.ts` usati qui); mount `/locations`; `LocationsApp` in `types.ts`.
**Test:** `tests/integration/locations-geocode-route.test.ts` (modulo vero, 401 senza sessione), la parte locations di `tests/modules/integer-inputs.test.ts`, `tests/plugins/rate-limit.test.ts` (per il middleware Hono; il test del wrapper Elysia resta finché esiste), `tests/unit/rate-limit.test.ts` invariato. Nuovo: due `x-forwarded-for` diversi → bucket diversi; strip.
**Frontend:** customer `src/features/addresses/use-geocode.ts:8`, `src/features/addresses/use-municipalities.ts:29`; seller `src/features/stores/hooks/use-geocode.ts:7`, `src/hooks/use-countries.ts:13`, `src/hooks/use-municipalities.ts:10` (loader SSR con `ensureQueryData` in 6 route: pubblico, nessun cookie da inoltrare). Tipi `Awaited<ReturnType<…>>` in customer `use-geocode.ts:17`, seller `use-geocode.ts:11` → `InferResponseType`.
**Date:** nessuna.

- [ ] `baseline/hono-batch-locations.jsonl` catturato prima (401 geocode anonimo, 422 `limit=2.5` con «Numero di suggerimenti: deve essere un numero intero», 200 e header `cache-control`).
- [ ] Modulo su Hono, rate limit come middleware, D12 confermata.
- [ ] Ricerca indirizzo (customer rubrica, seller negozio) e select comuni provati nel browser; la pagina SSR del seller con i comuni si carica senza errori.
- [ ] [Verifica di ogni PR](#verifica-di-ogni-pr).

### U3 — `customer/`

**Stato:** da fare · **PR:** — · **Branch:** `refactor/hono-customer`

25 endpoint: products (3) e stores (5) pubblici; profile (1), addresses (4), points (1), orders (3), cart (4), checkout (4) con `requireCustomer` per route. Query con molta coercizione (`ProductSearchQuery`/`StoreSearchQuery` in `lib/queries.ts:79-170`: `lat`, `lng`, `radius`, `minPrice`, `maxPrice` numeri; `openNow`, `onSale` booleani; default), `Omit` per le facet.

**Backend:** `apps/api/src/modules/customer/{index.ts,context.ts,routes/*.ts}`; `requireCustomer` in `src/http/auth.ts`; gemelli in `src/lib/zod/`; mount `/customer`; `CustomerApp` in `types.ts`.
**Test:** `tests/integration/customer-checkout.test.ts` (resolve finto del `customerProfile` → middleware di test), parte customer orders di `tests/modules/integer-inputs.test.ts`; casi `q-search-*` del corpus (`notes/prototypes/validation/cases.ts`) sulle route vere, attesi da `before.json`; strip.
**Frontend** (27 chiamate, tutte in `apps/customer/src/features/`): `products/product-detail-api.ts:29` (oggi `apiNoDates`), `catalog/use-product-search.ts:66`, `catalog/use-product-facets.ts:56`, `discovery/use-nearby-products.ts:44`; `stores/use-store-detail.ts:31`, `stores/use-store-search.ts:60`, `stores/use-store-facets.ts:47`, `stores/use-store-products.ts:25`, `stores/use-store-map.ts:67`; `checkout/use-checkout.ts:47,67,88,121`; `orders/use-orders.ts:18,31,41`; `cart/use-cart.ts:14,52,64,75`; `addresses/use-addresses.ts:11`, `addresses/use-address-mutations.ts:22,34,48`; `points/use-points.ts:15`; `profile/use-customer-profile.ts:6`. Rami su `status`: `product-detail-api.ts:33` (404 → null), `use-store-detail.ts:35` (404 → null), `use-orders.ts:44` (400/409). Tipi da Eden: `product-detail-api.ts:4-9` (`typeof api`), `Awaited<ReturnType>` in `use-customer-profile.ts:11`, `use-addresses.ts:16`, `use-cart.ts:19`, `review.tsx:56`. Via `apiNoDates` da `apps/customer/src/lib/api.ts`.
Test FE: `src/features/products/product-detail-api.test.ts`: il test 1 verifica che Eden trasformi `05/03/2027` in `Date` (meccanismo rimosso: si cancella, scritto nella PR); i test 2 e 3 cambiano solo lo stub di `fetch`.
**Date (tutte tolleranti):** `orders/index.tsx:131`, `orders/$orderId.tsx:101`, `order-display.ts:37-50`, `pickup-countdown.tsx:16-17`; `checkout/$checkoutId/pay.tsx:111`, `checkout/reservation-copy.ts:6,20,38-48`, `orders/store-closed-note.tsx:11`; `use-store-detail.ts:64`, `use-store-map.ts:102`, `use-store-search.ts:100`; `points/point-display.ts:43-58`, `points.tsx:146`; `profile/profile-identity.tsx:17-18,128`. Difesa ora morta: `products/format-characteristic.ts:28`.

- [ ] `baseline/hono-batch-customer.jsonl` catturato prima (pubblici 200/404, guardati 401/403 e 422 da anonimo con input non valido, 200 con `customer1@test.com`).
- [ ] Modulo su Hono, `requireCustomer` dopo i validatori in ogni route guardata.
- [ ] Nel browser: ricerca prodotti e negozi con filtri, mappa, scheda prodotto con caratteristiche testuali tipo data, carrello, checkout fino al pagamento di prova, ordini, punti, profilo, rubrica.
- [ ] [Verifica di ogni PR](#verifica-di-ogni-pr).

### U4 — `registration/`

**Stato:** da fare · **PR:** — · **Branch:** `refactor/hono-registration`

4 POST pubblici con rate limit: `/register/customer` e `/register/seller` (ip 10/h, email 3/h), `/register/accept-invite` (ip 20/h; password diverse → 400 «Le password non coincidono»), `/register/sign-in` (ip 30/15 min, email 10/15 min; restituisce il token nel corpo e **non** imposta cookie). Risposte `withConflictErrors({200, 429})`; 409 `EMAIL_ALREADY_REGISTERED` e `EMAIL_PENDING_VERIFICATION` con `resentAt`.

**Backend:** `apps/api/src/modules/registration/{index.ts,services.ts}`; gemello Zod di `AcceptInviteBody` in `src/lib/zod/forms/onboarding.ts`; mount `/register`; `RegistrationApp` in `types.ts`; il wrapper Elysia del rate limit si toglie se non ha più utenti.
**Test:** `tests/modules/registration.test.ts` (22: rate limit, request-id, error handler sul plugin di registrazione), `tests/modules/registration-response-schema.test.ts` (oggi una mini app Elysia: diventa una mini app Hono con `send()`, stessa asserzione su `documentImageKey`); casi `reg-*` del corpus; rate limit con due IP.
**Frontend:** customer `src/routes/register.tsx:83` (legge `error` e `resentAt` a `:88-98`); seller `src/routes/register.tsx:44` (`:49-59`), `src/routes/invite.$token.tsx:48` (`error.value?.message` a `:58-59`).
**Date:** `resentAt` oggi arriva come `Date` (Eden) e passa da `Date.parse` (`customer register.tsx:92-98`, `seller register.tsx:56-59`): con `hc` è la stringa ISO, e `Date.parse` la legge meglio. Tollerante.

- [ ] `baseline/hono-batch-registration.jsonl` catturato prima (422 dei casi `reg-*`, 409 con `resentAt`, 429 con `retry-after`).
- [ ] Nel browser: registrazione customer e seller (email nuova e email in attesa di verifica, con il messaggio di reinvio), invito dipendente con password diverse e uguali. Email in Mailpit (`:8025`).
- [ ] [Verifica di ogni PR](#verifica-di-ogni-pr).

### U5 — seller 1: contesto seller e prodotti

**Stato:** da fare · **PR:** — · **Branch:** `refactor/hono-seller-products`

Monta `/seller` su Hono; le route seller ancora Elysia (U6, U7) continuano a vincere sul mount. 22 endpoint: products (12, con `GET /products/lookup` che risponde `okRes(Union[EanLookupResult, Null])` e `POST /products/import` CSV, vedi D14), brands (2), images (2: `t.Files({ type: "image", maxSize: "5m" })` + `position` intero come stringa multipart), product-characteristics (1), stock (5). Query prodotti: `productCategoryIds` array (virgola e chiavi ripetute), `inStock` booleano.

**Backend:** `apps/api/src/modules/seller/{index.ts,context.ts}` (`requireSeller` in `src/http/auth.ts`: `c.var.seller` = `resolveSellerAccess(user)`, al posto dei cast `withSeller(ctx)` nelle route migrate), `routes/{products,brands,images,product-characteristics,stock}.ts`; gemello di `CreateProductBody`/`CharacteristicValuesField`/`VatRateSchema` in `src/lib/zod/forms/products.ts`; `SellerApp` in `types.ts`.
**Test:** parte seller (brands, images, stock) di `tests/modules/integer-inputs.test.ts`; `tests/integration/seller-guard-resolve.test.ts` invariato; `requireSeller` e `requireOwner` non rileggono `c.var.seller` se c'è già, così i test `*-owner-only` (U6, U7) montano le route con `withVars(routes, { user, seller })` (D13) e tengono le asserzioni 403; test di precedenza: `/seller/products/:id` arriva a Hono, `/seller/stores/:id` (ancora Elysia) no; strip.
**Frontend** (seller, ~21 chiamate in `apps/seller/src/`): `features/products/components/product-status-tabs.tsx:18`, `product-stock-manager.tsx:56,73`, `product-form.tsx:188`, `store-assignment-dialog.tsx:47`; `features/products/hooks/use-seller-categories-in-use.ts:18`, `use-stock-adjust-mutation.ts:69,80`, `use-bulk-stock-adjust-mutation.ts:35`, `use-product-mutations.ts:44,76,98`; `routes/_authenticated/products/index.tsx:178`, `products/$productId.tsx:47` (oggi `apiNoDates`), `:62`, `:82`, `:101` (multipart), `products/new.tsx:35`, `:51` (multipart); `brand-combobox.tsx:57`; `hooks/use-category-characteristics.ts:6` (tipo a `:12`). Rami: `stock-editor-cell.tsx:59-62` (`ApiError` 409/403), 409 in `products/$productId.tsx:123`; tipo `NonNullable<…>` in `products/index.tsx:213`. Via `apiNoDates` da `apps/seller/src/lib/api.ts`.
**Date:** tolleranti `products/index.tsx:130-135` (`DateCell`); difesa ora morta `features/products/lib/characteristic-form.ts:28`.

- [ ] `baseline/hono-batch-seller-products.jsonl` catturato prima (403 dei quattro casi di `resolveSellerAccess`, 422 da anonimo, 200 con `seller@dev.bibs` e `employee1@test.com`).
- [ ] Precedenza Elysia/mount verificata da test, anche per route parametriche.
- [ ] Nel browser: lista prodotti con filtri e tab, nuovo prodotto con immagini, modifica con caratteristiche tipo data, stock singolo e massivo, lookup EAN; come titolare e come dipendente.
- [ ] [Verifica di ogni PR](#verifica-di-ogni-pr).

### U6 — seller 2: negozi, impostazioni, team, onboarding

**Stato:** da fare · **PR:** — · **Branch:** `refactor/hono-seller-stores`

38 endpoint: stores (9, con la cancellazione che risponde `status: canceling | canceled`), store-images (2, `t.Files`), settings (8, indice `/settings/` con slash, cambio documento con `t.File` opzionale), closures (2), employees (10), onboarding (5, documento `t.File({ type: "image" })` senza `maxSize`, guard A), profile (1, guard A), dashboard (1). Guard A = `requireSellerRole`.

**Backend:** `apps/api/src/modules/seller/routes/{stores,store-images,settings,closures,employees,onboarding,profile,dashboard}.ts`; `requireSellerRole` in `src/http/auth.ts`; gemelli di `CreateStoreBody`, `OpeningHoursSchema`, `PersonalInfoBody`, `CompanyBody`, `DocumentBody`, `TeamInviteBody`, `CompanySettingsBody`, `DocumentChangeBody`, `PersonalSettingsBody`, `VatChangeBody` in `src/lib/zod/forms/`; schemi di `lib/schemas/dashboard.ts`.
**Test:** `tests/integration/seller-dashboard.test.ts`, `seller-store-order-types-routes.test.ts`, `seller-store-reservation-hours.test.ts`; `tests/modules/seller-{closures,employees,settings,stores}-owner-only.test.ts`, `store-update-validation.test.ts`, parte stores/store-images di `integer-inputs.test.ts`; strip.
**Frontend** (seller, ~42 chiamate in `apps/seller/src/`): stores `features/stores/components/reservation-hours-field.tsx:54`, `sales-settings-panel.tsx:69,85`, `hours-closures-panel.tsx:87,112,121`, `features/stores/hooks/use-store-order-types.ts:14`, `features/billing/components/cancel-store-dialog.tsx:40`, `components/store-billing-banner.tsx:30`, `hooks/use-first-store-onboarding.ts:25`, `hooks/use-stores.ts:13`, `routes/_authenticated/billing.tsx:157`, `store/index.tsx:85,114,133,137` (multipart immagini), `store/archived.tsx:70,82`, `store/new.tsx:75,93`; employees `hooks/use-employee-stores.ts:15,32`, `routes/_authenticated/team/index.tsx:86,98,109,124,145,167,180,195` (tipo `typeof api` a `:513-528`); settings `features/online-payments/hooks/use-online-payments.ts:9,20`, `features/profile/components/business-info-card.tsx:83`, `pending-vat-change.tsx:32`, `vat-change-dialog.tsx:28`, `hooks/use-seller-settings.ts:20`; onboarding `hooks/use-onboarding.ts:19,63,75` (multipart campi + file),`:95,106` (tipo `Static<typeof DocumentBody>` a `:1-2,74` resta fino a U11b); dashboard `routes/_authenticated/index.tsx:56`.
Test FE con il finto client Eden da riscrivere nella forma `hc` (stesse asserzioni): `features/stores/components/sales-settings-panel.test.tsx:24-40`, `hours-closures-panel.test.tsx:20-31`, `components/order-types-sidebar-card.test.tsx:26-45`.
**Date:** HARD dashboard `features/dashboard/dashboard-actions.ts:38,43` (`oldestCreatedAt: Date | null`, `endsAt: Date`), `:123-124` (`target.getTime()`), usati a `:145,:207`, alimentati da `routes/_authenticated/index.tsx:75` → `new Date(…)`. Tolleranti: `hours-closures-panel.tsx:44,48,49`, `dashboard-actions.ts:33,106`, `reservation-hours-field.tsx:107`, `store/archived.tsx:48`, `team/index.tsx:721`.

- [ ] `baseline/hono-batch-seller-stores.jsonl` catturato prima (403 ruolo per guard A, 422 da anonimo, 200 titolare/dipendente).
- [ ] Nel browser: negozio nuovo e modifica (orari, chiusure, tipologie, finestra di ritiro, immagini), archivio, impostazioni a schede (anche cambio partita IVA e documento), team (invito, incarichi), onboarding completo con documento, dashboard con le sue azioni; come titolare e come dipendente.
- [ ] [Verifica di ogni PR](#verifica-di-ogni-pr).

### U7 — seller 3: ordini, promozioni, checkout, billing

**Stato:** da fare · **PR:** — · **Branch:** `refactor/hono-seller-orders`

27 endpoint: orders (9), discounts (10, body con date in ingresso `lib/schemas/discount.ts:50-64`), checkout (4), billing (4, oggi `ok(data) as any` a `seller/routes/billing.ts:85`: con `send()` il tipo arriva al FE). Toglie il modulo seller Elysia (e le sue copie `/seller/auth`).

**Backend:** `apps/api/src/modules/seller/routes/{orders,discounts,checkout,billing}.ts`, `apps/api/src/modules/seller/index.ts` Elysia rimosso; gemelli di `lib/schemas/{discount,stock}.ts` e del form usato da checkout.
**Test:** `tests/integration/seller-orders-routes.test.ts`, `tests/modules/seller-{billing,checkout,discounts}-owner-only.test.ts`; casi `disc-*` e `q-*` del corpus sulle route vere; strip.
**Frontend** (seller, ~24 chiamate): `features/orders/hooks/use-orders.ts:20,35,48,69,77,85`, `use-pickup.ts:12,27` (404 a `:15,28`); `features/promotions/hooks/use-discounts.ts:25,37,48,62,81,95,116,133`, `routes/_authenticated/promotions/new.tsx:24`; `components/store-billing-banner.tsx:18`, `hooks/use-active-store.tsx:71`, `routes/_authenticated/billing.tsx:119,128,137,146`; `routes/_authenticated/store/new_.processing.tsx:47` (`checkout-progress.ts:28`, `ApiError` 404). Tipo `NonNullable<…>` in `orders/index.tsx:103`.
**Date:** HARD `routes/_authenticated/orders/$orderId.tsx:84,118` (`order.reservationExpiresAt as Date`: togliere il cast); `hooks/use-active-store.tsx:30,32,73` (cast a `Subscription[]` con `currentPeriodEnd: Date`, `suspendedAt: Date | null`). Body: `promotions/new.tsx:24-28` (`startsAt: new Date(…)`) e `use-discounts.ts:78-81` → stringhe ISO (stesso filo). Tolleranti: `store-billing-banner.tsx:65`, `cancel-store-dialog.tsx:25,60`, `billing.tsx:70,82`, `promotions/index.tsx:113-122,171-177`, `promotions/$discountId.tsx:50`, `promotion-state-badge.tsx:16-26,50-51`, `apply-promotion-dialog.tsx:32-37`, `orders/index.tsx:138`, `orders/$orderId.tsx:98`, `order-labels.ts:62-65,118`.

- [ ] `baseline/hono-batch-seller-orders.jsonl` catturato prima.
- [ ] Nel browser: lista e dettaglio ordini (scadenza prenotazione), ritiro con QR, promozioni (nuova, modifica date, applica ai prodotti), billing (banner, cancellazione negozio, portale Stripe di prova), checkout negozio nuovo fino a «processing».
- [ ] [Verifica di ogni PR](#verifica-di-ogni-pr).

### U8 — catalogo pubblico e admin 1

**Stato:** fatto, PR da aprire · **PR:** — · **Branch:** `feat/hono-u8-catalog-admin-1` (nome dato dall'orchestratore al posto di `refactor/hono-admin-catalog`)

Catalogo pubblico: 4 GET a path radice (`/product-macro-categories`, `/product-categories`, `/store-macro-categories`, `/store-categories`) → 4 mount, una sub-app per path. Admin (monta `/admin`, le route di U9 restano Elysia e vincono): configurations (1), product-categories (3), store-categories (3), product-macro-categories (3), store-macro-categories (3), product-characteristics (4), category-characteristics (4), holiday-definitions (5), category-imports (2), characteristic-imports (2): import CSV con `t.File()` senza `type` (niente controllo dei magic byte, `body.file.text()`).

**Backend:** `apps/api/src/modules/catalog/{index.ts,routes/*.ts}`; `apps/api/src/modules/admin/{index.ts,context.ts}` (`requireAdmin`), `routes/{configurations,product-categories,store-categories,product-macro-categories,store-macro-categories,product-characteristics,category-characteristics,holiday-definitions,category-imports,characteristic-imports}.ts`; gemelli di `lib/schemas/holidays.ts` e del form usato da `product-macro-categories.ts`; `CatalogApps`, `AdminApp` in `types.ts`.
**Test:** nessun `.handle()` oggi su queste route; strip; batch della CLI con corpi.
**Frontend:** admin (`apps/admin/src/`): `features/crud/category-crud-panel.tsx` (contratto `EdenRes<T>` a `:57-66,99-102` → funzioni che restituiscono i dati con `unwrapJson`; 409 a `:260,306`), `features/product-categories/product-categories.config.tsx:36` (catalogo), `:106,119,124,128,139` (import multipart), `features/category-characteristics/hooks/use-category-characteristics.ts:13` (`error.value?.message` a `:22,49,66`, 409 a `:69`), `features/holidays/components/holidays-panel.tsx:128,136,151,169,185,221`, `features/product-characteristics/product-characteristics.config.tsx:125,138,140,144,170` (import), `features/store-categories/store-categories.config.tsx:34,97` (catalogo), `:110,115,118,129` (import; `error.value?.message` a `:39,131`), `features/product-macro-categories/product-macro-categories.config.tsx:34` (catalogo), `:44,49,53`, `features/store-macro-categories/store-macro-categories.config.tsx:22` (catalogo), `:32,34,38`, `routes/_authenticated/configurations/index.tsx:21`. Seller: `product-category-picker.tsx:24,46` (catalogo).
**Date (tolleranti):** righe locali `createdAt: Date | string` delle 5 config e di `category-crud-panel.tsx:72`; `holidays-panel.tsx:70-71,95,446,449`.

**Fatto** (decisioni prese in autonomia, Marco assente):
- *Catalogo:* quattro sub-app con la route `/` (`productMacroCategoriesApp`, `productCategoriesApp`, `storeMacroCategoriesApp`, `storeCategoriesApp` in `modules/catalog/index.ts`), quattro mount e quattro `honoPaths(…, ["publicRoute"])` in `src/index.ts`; `catalogModule` Elysia tolto. Per i FE un solo tipo, `CatalogApp` (le quattro route in un'app usata solo per il tipo), e un client `catalogApi = hc<WithErrors<CatalogApp>>(API_URL)`: `catalogApi["product-categories"].$get({ query })`. Il piano diceva `CatalogApps`: un tipo solo basta.
- *Admin:* `adminApp` Hono (le 10 famiglie di route, `.route("/", …)` nell'ordine di Elysia) montato su `/admin` con `honoPaths(adminApp, "/admin", ["admin"])`; `adminModule` Elysia resta con le sole route di U9 (sellers, stores, seller-changes, requests, billing), che vincono sul mount; `/admin/auth` resta finché c'è lui (delta 1, U9). `requireAdmin` in `src/http/auth.ts` (D9); `adminDetail(summary, description)` in `admin/context.ts` mette il tag `Admin` e la `security` che le route Elysia prendevano dal modulo. Log col `logger` standalone (D15).
- *Gemelli Zod:* `lib/zod/entities.ts` (macro e categorie prodotto e negozio, `AdminProductCategorySchema`, i tre risultati CSV, caratteristiche e matrice), `lib/zod/holidays.ts` (definizioni, anteprima, `CreateHolidayDefinitionBody` spostato da `tests/http/parity-cases.ts`, `UpdateHolidayDefinitionBody`), `lib/zod/queries.ts` (`CategoryListQuery`, `CharacteristicListQuery`, `ProductCategoryListQuery`), `lib/zod/forms/products.ts` (`VatRateSchema`); i body locali delle route sono esportati dai file di route. Aliquote IVA come `z.union` di `z.literal` (con `z.enum` le chiavi numeriche cambiano ordine in /openapi): stessa scelta e stesso testo di U5, per un merge senza attriti. Nessuna estensione del kit oltre `requireAdmin`: nessuno schema di U8 tocca i gap noti del validatore.
- *Rimandi di U1:* (1) ordine auth → ruolo: chiuso per l'admin con la guardia che legge la sessione (D9); (2) guardie seller per route: non riguarda U8; (3) route `*`: U8 non ne ha.
- *Frontend:* `CategoryCrudPanel` non usa più `EdenRes<T>`: le config restituiscono la risposta `hc` (`HcRes<T>`: `ClientResponse` di successo col corpo `T`, o d'errore con `ErrorBody`) e il pannello la apre con `unwrapJson` e il suo messaggio di ripiego, come prima. Le sedi che lanciavano `new Error(res.error.value?.message || …)` (`store-categories.config.tsx` ×2, `use-category-characteristics.ts` ×3) ora lanciano l'`ApiError` di `unwrapJson`: stesso messaggio, niente retry sui 4xx (la policy comune; delta 10). Tolti i cast `as string`, `as CharacteristicDataType`, `as HolidayDefinition[]` (narrowing o tipo di `hc`) e il messaggio `csv_invalid_response` (ramo irraggiungibile: un 200 ha sempre `data`). Date: nessun sito HARD; i tolleranti restano (`formatDate` e `toYMD` leggono anche le stringhe; `toYMD` dava lo stesso giorno con la `Date` UTC di Eden).
- *Test:* `tests/modules/admin-catalog-strip.test.ts` (5, servizi finti e `withVars`): campi ignoti annidati tolti da body e query prima del servizio, colonne in più tolte dalla risposta, anche nella macro annidata del catalogo. `tests/integration/admin-catalog-routes.test.ts` (9, sessioni vere): 422 prima di 401 e 403, 403 al cliente, 200 all'admin, i quattro import CSV col `FormData` di `hc` (`testClient`), PATCH della macro senza aliquota → «22», DELETE con corpo JSON e poi 404, catalogo pubblico 200/422/404. 22 casi nuovi in `tests/http/parity-cases.ts` (TypeBox copiato dalle route Elysia tolte, gemello vero; 11 schemi nuovi nel confronto OpenAPI). Nessun test esistente cambiato nelle asserzioni (nessuno chiamava queste route).

- [x] `baseline/hono-batch-admin-1.jsonl` catturato prima sul commit base (145 passi: catalogo 200/422/404/HEAD/slash finale/preflight; anonimo 401 e 422 su ogni route admin; `customer1@test.com` 403 e 422; `admin1@test.com` 200 sulle letture e 404 su ogni scrittura con id inesistente; ciclo completo su entità di prova «Collaudo Hono U8» create e cancellate nel batch: create, 409 per nome doppio e per macro con figli, PATCH con trim, assegnazione e rimozione della caratteristica, festività una tantum e fissa). Rigiocato sul commit base 145/145, sul branch 145/145. Il seed non viene mai scritto; le entità di prova non restano (verificato con `?search=Collaudo`).
- [x] Header (CORS, `content-type`, `x-request-id`) di 5 richieste catturati prima e dopo con `hono request`: uguali, tranne `x-request-id` sui due 404 (delta 4).
- [ ] Nel browser: ogni pannello di Configurazioni (lista, crea, modifica, elimina con 409 «in uso», import CSV), caratteristiche per categoria, festività con anteprima; picker categorie nel seller. Non fatto dall'unità (lo fa l'orchestratore prima della PR).
- [x] [Verifica di ogni PR](#verifica-di-ogni-pr), con i numeri:
  - typecheck: `bun run typecheck` → exit 0, i 6 workspace e i 3 `pretypecheck` con `Exited with code 0`;
  - lint: `bun run lint` → exit 0, 0 errori (6 avvisi preesistenti: 5 prototipi in `notes/` e la dimensione di `baseline/openapi.json`);
  - test: `bun run test` → exit 0, ogni workspace `Exited with code 0`; emails 26, ui 40, api unit 798 in 71 file (+38: 22 casi di parità in `validator.test.ts`, 11 confronti OpenAPI, 5 di strip), api integration 984 in 103 file (+9, +1 file), admin 112, customer 169, seller 206; totale 2.335, 0 fail, 0 skip, nessun `Unhandled error between tests`;
  - build e avvio: `bun run --filter @bibs/api build` (7,50 MB), `PORT=3108 bun dist/index.js` → `/ready` 200 `{"status":"ok","services":{"database":"ok","s3":"ok"}}`; `GET /admin/configurations/counts` 401 con CORS e `x-request-id`, `GET /admin/sellers` 401 (Elysia), `GET /admin/nope` 404, `PATCH /admin/product-categories/x` con nome vuoto 422, `GET /product-categories?limit=1` 200; fermato;
  - inventario route: 256 righe; diff con la baseline solo le righe di mount `ALL /admin`, `ALL /admin/*` e `ALL` + `ALL /*` dei quattro path del catalogo (delta 2), più quelle di `/me` (U1); le route di U8 restano elencate passando i sei `--hono` (`/me`, `/admin`, i quattro del catalogo);
  - OpenAPI: output di `openapi-snapshot.ts` uguale al byte (`cmp`) a `baseline/openapi.json` (198 path, 228 operazioni), `assertRoutes` passato con `["admin"]` e `["publicRoute"]`;
  - Hono CLI: batch della baseline 66/66, `hono-batch-me.jsonl` 18/18, `hono-batch-admin-1.jsonl` 145/145; snapshot rigenerato (172 righe): spariscono le 34 righe delle route di U8 (dietro i mount, delta 2), compaiono le righe di mount; le tre righe del customer con UUID cambiano id (la CLI prende il primo id che trova in una risposta: prima era una macro del catalogo) con lo stesso 404;
  - strip: `tests/modules/admin-catalog-strip.test.ts` (body, query e risposta, anche annidati) più i casi «campi ignoti» di `parity-cases.ts`;
  - revisione avversaria e browser: non fatti dall'unità (li fa l'orchestratore prima della PR);
  - typecheck, wall time medio di 2 run (baseline tra parentesi), carico 3,4–4,1: api 7,10 s (6,65) · admin 9,31 s (9,51) · customer 8,81 s (8,61) · seller 10,79 s (9,96), sotto il budget (×1,25). Un primo giro col carico a 4–5 (altre unità in parallelo) dava api 9,00 · admin 8,92 · customer 8,48 · seller 13,74 (16,61 + 10,86): rumore. Le istanziazioni (`--extendedDiagnostics`) crescono poco rispetto a U1: api 2,22 M (2,12), admin 2,54 M (2,45), customer 2,33 M (2,31), seller 2,62 M (2,59).

**Giro di revisione 1** (2026-10-26, revisione avversaria dell'orchestratore sull'app radice, commit base contro branch su DB testcontainer). Corretto:
- *Interi oltre i safe-int.* `zInteger` (`lib/zod/t.ts`) partiva da `z.number().int()`, che in Zod 4 rifiuta gli interi oltre 2^53; `t.Integer` controlla solo `Number.isInteger`. Effetto su ogni lista paginata di U8 (`?page=9007199254740992` e `?page=1e16` → 422 invece di 200; `?page=1e20` → 422 invece del 500 del DB; sotto `/admin` 422 anche per anonimo e cliente invece di 401/403) e sui tre corpi con `confirmAffected` (1e20 → 422 invece di 200 per l'admin e di 403 per il cliente). Ora `Number.isInteger` e poi i vincoli dello schema: lo stesso codice, al byte, della correzione di U2 già su `feat/hono-migration` (#302), così il merge non litiga. Era un difetto del kit di U1; `/openapi` non cambia (lo schema registrato non passava da `.int()`). Trappola «Gemelli» aggiornata per `z.int()` (stesso limite, `position` dei telefoni in U6).
- *`//` sulle radici del catalogo.* `GET /product-categories//` (e gli altri tre path) dava 200 con la lista invece del 404: il mount passa `//` alla sub-app, `rawPath` di `moduleApp()` toglieva uno slash e restava `/`, la route radice. Ora `//` resta com'è (`src/http/app.ts`); sotto `/admin` era già 404 (nessuna route `/`).
- *Frontend:* le cinque sedi che ora lanciano l'`ApiError` di `unwrapJson` restano così (policy comune di retry) e vanno nel registro (delta 10).
- *Test nuovi:* 3 casi in `tests/http/parity-cases.ts` (`?page=9007199254740992` su `CategoryListQuery`, `confirmAffected` 1e20 e `"9007199254740993"`), confrontati dal vivo con Elysia; in `tests/http/mount.test.ts` una route Elysia e una sub-app montata con `""`, `/`, `//` (stessi status); 26 passi in coda a `baseline/hono-batch-admin-1.jsonl` (ora 171) catturati sul commit base `e5e0d76d`: liste del catalogo e admin con `page` oltre i safe-int (200 e 500), `//` sulle quattro radici e sotto `/admin`, anonimo 401 e cliente 403 con gli stessi input, PATCH e DELETE con `confirmAffected` 1e16/1e20 su una caratteristica di prova «Collaudo Hono U8 safe-int» creata e cancellata nel batch. Senza le correzioni falliscono tutti e quattro i test nuovi e 21 passi del batch.
- Verifica:
  - typecheck: `bun run typecheck` → exit 0, 6 workspace e 3 `pretypecheck` con `Exited with code 0`; lint → exit 0, 0 errori (gli stessi 6 avvisi);
  - test: `bun run test` → exit 0 in 1427 s (carico 8–19, altre tre unità con i loro testcontainer), ogni workspace `Exited with code 0`; emails 26, ui 40, api unit 802 in 71 file (+4), api integration 984 in 103 file, admin 112, customer 169, seller 206; totale 2.339, 0 fail, 0 skip, nessun `Unhandled error between tests`;
  - build e avvio: 7,50 MB; `PORT=3108 bun dist/index.js` → `/ready` 200 `{"status":"ok","services":{"database":"ok","s3":"ok"}}`; `GET /product-categories//` 404, `/product-categories/` 200, `?page=9007199254740992&limit=1` 200, `/product-macro-categories?page=1e20` 500, `/admin/product-categories?page=1e16` 401, `/admin/configurations/counts//` 404, `?search=Collaudo` 0 risultati; fermato;
  - inventario route (256 righe) e OpenAPI (`cmp` uguale a `baseline/openapi.json`, 198 path, 228 operazioni): come prima;
  - Hono CLI: batch della baseline 66/66, `hono-batch-me.jsonl` 18/18, `hono-batch-admin-1.jsonl` 171/171 sul branch e 171/171 sul commit base; snapshot rigenerato 172 righe, stesso diff di prima;
  - typecheck, wall time medio di 2 run (baseline tra parentesi), carico 5–7: api 7,01 s (6,65) · admin 8,39 s (9,51) · customer 9,10 s (8,61) · seller 10,29 s (9,96). Un primo giro col carico a 10–17 dava api 14,87 · admin 14,23 · customer 10,92 · seller 11,47: rumore (istanziazioni uguali a prima: api 2,23 M, admin 2,54 M, customer 2,33 M, seller 2,62 M).

### U9 — admin 2

**Stato:** da fare · **PR:** — · **Branch:** `refactor/hono-admin-sellers`

18 endpoint: sellers (5; `PATCH /sellers/:id/{verify,reject}` con `expectedUpdatedAt` data in ingresso, 409 ottimistico; `RejectSellerBody`), seller-changes (3), stores (2), requests (3, indice `/requests/` con slash), billing (5, `PUT /billing/pricing`). Toglie il modulo admin Elysia.

*Da U8:* `adminApp` (Hono, montato su `/admin`), `requireAdmin` e `adminDetail` ci sono già: U9 aggiunge le sue route ad `adminApp` con `.route("/", …)`, toglie `adminModule` (e con lui `/admin/auth`, delta 1) e `withAdmin` da `admin/context.ts`. Il client FE è `adminApi` in `apps/admin/src/lib/api.ts`.

**Backend:** `apps/api/src/modules/admin/routes/{sellers,seller-changes,stores,requests,billing}.ts`, `apps/api/src/modules/admin/index.ts` Elysia rimosso; gemello di `RejectSellerBody`/`SELLER_REJECTION_REASONS` in `src/lib/zod/forms/seller-rejection.ts`.
**Test:** `tests/integration/admin-requests.test.ts` (oggi `new Elysia({ prefix: "/admin" })`), `tests/modules/admin-pricing-validation.test.ts`; strip.
**Frontend** (`apps/admin/src/`): `components/seller-moderation-dialog.tsx:85,117` (`error.value?.message` a `:90,122`), `routes/_authenticated/requests/$changeId.tsx:55,62` (409 a `:83`), `requests/use-request-counts.ts:10`, `routes/_authenticated/requests/index.tsx:96`, `sellers/index.tsx:122,131` (`:144`), `sellers/$sellerId.tsx:36` (`:39`), `billing/index.tsx:23`, `billing/pricing.tsx:49,74` (`:78`), `billing/subscriptions.tsx:46`, `stores.tsx:109,117` (`:128`; tipo `NonNullable<…>` a `:133`).
**Date:** HARD (solo tipi, filo identico) `seller-moderation-dialog.tsx:35` (`updatedAt: Date`) e `sellers/index.tsx:68` (ritorna come `expectedUpdatedAt`). Tolleranti: `requests/index.tsx:57,67-68`, `requests/$changeId.tsx:35-37`, `sellers/$sellerId.tsx:355`, `sellers/index.tsx:67`, `billing/subscriptions.tsx:27`.

- [ ] `baseline/hono-batch-admin-2.jsonl` catturato prima (anche il 409 di `verify` con `expectedUpdatedAt` vecchio).
- [ ] Nel browser: pagina Richieste (candidature, partita IVA, documento; approva e rifiuta su entità di prova), venditori, negozi, billing e prezzi.
- [ ] [Verifica di ogni PR](#verifica-di-ogni-pr).

### U10 — `webhooks/`

**Stato:** da fare · **PR:** — · **Branch:** `refactor/hono-webhooks`

3 `POST` (platform, connect, thin) con body grezzo per la firma Stripe; corpi **fuori inviluppo**: firma mancante → 400 `{"error":"missing signature"}`, messaggio con «signature» → 400 `{"error":"invalid signature"}`, altro → 500 `{"error":"internal error"}`, ok → `{"received":true}`. Nessuno schema di risposta. `billing/` non ha route: niente da spostare.

**Backend:** `apps/api/src/modules/webhooks/{index.ts,routes/stripe.ts}` (`await c.req.text()`), mount `/webhooks`.
**Test:** `tests/modules/stripe-webhook-route.test.ts` (oggi `stripeWebhookRoutes.handle`).
**Frontend:** nessuno.

- [ ] `baseline/hono-batch-webhooks.jsonl` catturato prima (400 senza firma, 400 firma non valida).
- [ ] Smoke con Stripe CLI (`bun run dev:stripe`): un pagamento di prova e un evento Connect arrivano con `{"received":true}` e aggiornano il DB come prima.
- [ ] [Verifica di ogni PR](#verifica-di-ogni-pr) (browser: n/a, al suo posto lo smoke Stripe).

### U11 — Cambio finale

**Stato:** da fare · **PR:** — · **Branch:** `refactor/hono-root`

Hono diventa l'app principale; Elysia, Eden e i plugin escono.

**Backend**
- `apps/api/src/app.ts` (nuovo): costruisce l'app Hono radice **senza effetti all'import**, in quest'ordine: log per richiesta (D15), CORS con `hono/cors` e la stessa config (`isOriginAllowed`, metodi GET/POST/PUT/PATCH/DELETE/OPTIONS, `credentials`, `allowHeaders` `Content-Type, Authorization`, `exposeHeaders` `Content-Length, X-Request-Id`, `maxAge` 86400), `X-Request-Id` con la nostra regex `^[A-Za-z0-9._:-]{1,128}$` (non `hono/request-id`, che ammette altro), `socketIpAsForwardedFor` globale (sovrascrive `x-forwarded-for` con `server.requestIP`, toglie `x-real-ip`), `root.all("/auth/*", mount(auth.handler))` da `hono/mount` (`lib/auth.ts` resta con `basePath: "/api"`), `.route()` di tutte le sub-app con gli stessi prefissi, `/health` e `/ready`, `/openapi` (pagina Scalar come quella di oggi) e `/openapi/json` (generatore di D11 con info, tag, componenti e path better-auth da `src/index.ts` di oggi), `onError(toErrorResponse)`, `notFound`.
- `apps/api/src/index.ts`: solo server (`ensureBucket()`, `Bun.serve({ port, fetch: app.fetch })` che passa il server come `env`, chiusura su SIGTERM/SIGINT con `server.stop()` e `db.$client.end()`); `src/cron.ts` con i 5 job su `croner` diretto (`^6.0.7`, la versione di oggi; stessi pattern e nomi, avviati solo dall'entry server).
- Via: `elysia`, `@elysiajs/cors`, `@elysiajs/cron`, `@elysiajs/openapi`, `logixlysia`, `src/plugins/*.ts` Elysia, `src/types/logixlysia.d.ts`, `export type App`, gli schemi TypeBox con `t` di Elysia (`lib/schemas/*.ts` tranne `forms/`, `lib/queries.ts`, `lib/pagination.ts`: i gemelli `lib/zod/*` prendono il loro posto in `lib/schemas/`), `elysia` dal catalog; `@elysiajs/eden` da catalog, `packages/ui` e app; in `packages/ui/src/lib/api-client.ts` via `createApiClient`, `unwrap`, `edenMessage`.
- `tools/load-app.ts` cattura l'app Hono (`src/app.ts`), così `route-inventory.ts` e `openapi-snapshot.ts` continuano a funzionare; `hono-entry.ts` diventa superfluo se la CLI carica `src/app.ts` (vedi «Before relying on the CLI's own entry» in `hono-cli.md`).
**Test:** `tests/http/parity-cases.ts` perde la colonna TypeBox e il confronto dal vivo con Elysia (`validator.test.ts` resta sugli attesi scritti; `openapi.test.ts` passa a confrontare con `baseline/openapi.json`); `tests/plugins/{error-handler,normalize,request-id,rate-limit}.test.ts` passano al meccanismo Hono con le stesse asserzioni; `tests/lib/validation-message.test.ts` (oggi passa da Elysia) e `tests/lib/logger.test.ts` (logixlysia vero) idem; `tests/unit/cors-origin.test.ts` invariato. Nuovi: header CORS di preflight e di risposta uguali alla baseline (origine ammessa e non ammessa, `vary: Origin`, `access-control-allow-methods/headers` anche fuori preflight); `x-forwarded-for` falsificato sostituito dall'IP del socket su un `Bun.serve` vero, con il controllo negativo della sonda (rate limit di better-auth: 5×200 poi 429).
**Frontend:** nessuna chiamata (già tutte su `hc`); `grep -rn "@elysiajs/eden\|apiNoDates\|edenMessage" apps packages` → nessun risultato.

- [ ] Header CORS, `X-Request-Id`, 404 e corpo del JSON malformato confrontati con la baseline; differenze (es. `x-request-id` anche sui 404, che oggi non lo hanno) corrette o nel registro dei delta.
- [ ] La CI «Production build (no localhost CORS)» resta verde.
- [ ] I 5 cron partono una volta sola (log all'avvio) e non partono nei test né negli strumenti.
- [ ] Login, logout, reset password e verifica email attraverso il nuovo mount better-auth, nel browser e in Mailpit.
- [ ] [Verifica di ogni PR](#verifica-di-ogni-pr), su tutte e tre le app.

### U11b — Uscita da TypeBox

**Stato:** da fare · **PR:** — · **Branch:** `refactor/zod-forms`

- `apps/api/src/lib/schemas/forms/*`: i gemelli Zod di `lib/zod/forms/*` prendono il posto dei file TypeBox (stesso percorso, esportato come `@bibs/api/schemas`); `forms/formats.ts` e il side effect `import "./formats"` spariscono (formati nelle regex Zod).
- `apps/api/src/lib/validation-rule.ts` e `validation-message.ts`: restano solo le versioni sulle issue Zod; l'export `@bibs/api/validation-rule` (tipo `ValidationRule`, usato da `apps/seller/src/lib/rule-message.ts:1`) resta.
- `apps/api/src/lib/env.ts` su Zod (stessi nomi, default e messaggi); `apps/api/src/modules/admin/services/sellers.ts` (oggi `TypeCompiler` sul JSON salvato) e i 4 servizi con `Static<…>` su `z.infer`.
- Seller FE: form di `features/stores/components/store-form.tsx`, `features/products/components/product-form.tsx` + `features/products/lib/product-form-schema.ts`, `routes/_authenticated/onboarding/{personal-info,company,document}.tsx` su `zodResolver` (`src/lib/zod-resolver.ts` esistente); la traduzione `SCHEMA_ERRORS` di `src/lib/typebox-errors.ts` va rifatta per Zod (la `localeError` globale di Zod 4 vale solo dove lo schema non ha un messaggio proprio, e i messaggi italiani portati da `error:` vincerebbero sempre); `src/lib/typebox-errors.test.ts` passa alla versione Zod con le stesse asserzioni (ogni messaggio di schema ha la sua traduzione); via `src/lib/typebox-{errors,formats,resolver}.ts`. Admin: `components/seller-moderation-dialog.tsx:1-4` importa solo dati e tipi, invariato.
- Via `@sinclair/typebox` da catalog e package (`grep -rn "@sinclair/typebox\|@hookform/resolvers/typebox" apps packages` → nessun risultato).

- [ ] Nel browser, seller: tutti i form toccati con errori in italiano e in inglese (cookie `PARAGLIDE_LOCALE=en`) uguali a prima (diff dell'`outerHTML` con i messaggi di errore visibili).
- [ ] [Verifica di ogni PR](#verifica-di-ogni-pr).

### U12 — Hono 5: ultima 5.x

**Stato:** da fare · **PR:** — · **Branch:** `chore/hono-v5`

Da U1 il repo è già su Hono 5 (`5.0.0-rc.1`, D1). U12 è l'**ultima PR di codice prima di U13/U14**, non si rimanda: porta il catalog all'ultima 5.x (la GA `5.0.x` se è uscita, altrimenti l'ultima rc), con il pin esatto se è ancora una prerelease e `^5.x.y` alla GA.

- [ ] Catalog `hono` all'ultima 5.x; changelog dalla rc.1 letto e applicato (oggi del codice specifico della v5 ci sono solo `onError((c) => c.error)` in `src/http/app.ts`, `hono/mount` e `c.req.query()`/`c.req.json()` tipizzati `string | undefined`/`unknown`); adapter Bun da `@hono/bun` se serve `getConnInfo`; peer di `@hono/cli` verificati.
- [ ] [Verifica di ogni PR](#verifica-di-ogni-pr).

### U13 — Documentazione e skill

**Stato:** da fare · **PR:** — · **Branch:** `docs/hono-docs`

- [ ] `AGENTS.md`: riga dello stack (`Elysia + Bun` → `Hono + Bun`), «Eden Treaty» → `hc`, sezione «Writing New API Endpoints (Elysia)» riscritta per Hono (sub-app, `v()`, `send()`, `doc()`, auth per route dopo i validatori, `ServiceError`), nota di verifica sui client, form con Zod.
- [ ] `apps/api/AGENTS.md` (anche «Three jobs» → cinque), `apps/api/README.md` (`/openapi`), `CLAUDE.md` (tabella skill: via `elysiajs`, `hono` non più «per la migrazione»), `docs/architecture.md` (ciclo della richiesta, integrazione FE ↔ API con `hc`; la sezione di U1 diventa storia breve), `docs/ai-tooling.md`.
- [ ] Via `.agents/skills/elysiajs` e il link `.claude/skills/elysiajs` (fuori da `skills-lock.json`).
- [ ] `grep -rni "elysia\|eden\|typebox" AGENTS.md CLAUDE.md apps/api/AGENTS.md apps/api/README.md docs/architecture.md docs/ai-tooling.md` → solo menzioni storiche volute.
- [ ] `bun run lint`, `bun run typecheck`.

### U14 — PR finale verso `main`

**Stato:** da fare · **PR:** — · **Branch:** `feat/hono-migration`

- [ ] [Verifica di ogni PR](#verifica-di-ogni-pr) completa sull'ultimo commit di `feat/hono-migration`, con i numeri finali di test e typecheck confrontati con la baseline.
- [ ] PR `feat/hono-migration` → `main` con: unità e PR, registro dei delta, budget di typecheck, comandi per lo smoke manuale di Marco (mouse e tastiera nelle tre app).
- [ ] **Non la mergia un agente:** la mergia Marco dopo il suo smoke.

---

## Note e prototipi

Tutto in [`2026-10-25-hono-migration/notes/`](2026-10-25-hono-migration/notes/), copiato dallo scratchpad della sessione di pianificazione senza tagli.

| File | Contenuto |
|---|---|
| `map-backend.md` | Livello HTTP di Elysia: ordine dei plugin, comportamento osservato (404, HEAD, slash, JSON malformato), costruzione dei 422, mappatura errori, X-Request-Id, CORS, better-auth e XFF, rate limit, health, OpenAPI, cron, guard, `normalize`, coercizioni, moduli, test con `.handle()`, punti caldi dello strangler |
| `map-frontend.md` | Client Eden e `unwrap`, `apiNoDates`, letture degli errori, chiamate per prefisso e per app, dipendenze dalle date (HARD e tolleranti), form condivisi, test FE accoppiati a Eden, costo di typecheck, livello TanStack Query |
| `probe-validation.md` | Versioni e peer, TypeBox 1 per import, parità 422 (27/27), coercizione, normalize, OpenAPI (181/181 con TypeBox), `hc`, costo di Zod |
| `probe-mount.md` | Semantica del mount, tabella di cosa vale per le route montate, body, middleware di auth, better-auth su Hono con XFF, `hc` su un sotto-albero |
| `frontend-calls/calls.json`, `grouped.txt`, `eden-calls.mjs` | Le 178 chiamate `api()`/`apiNoDates()` (file, riga, path, metodo) raggruppate per prefisso, e lo script che le rigenera (`node eden-calls.mjs <radice del repo>`): a U11 deve dare zero |
| `prototypes/validation/` | Prototipo della sonda (TypeBox): `validate.ts` (ordine dei passi del validatore), `validation-message.ts`/`validation-rule.ts` (`firstError`), `openapi-gen.ts` (port del generatore di `@elysiajs/openapi`), `probe-hono-routes.ts` (metadati da `app.routes`), `probe-client.ts` (tipi `hc`), corpus `cases.ts`/`echo-cases.ts` con i risultati Elysia `before.json`/`before-echo.json` e gli script `before*.ts`/`after-034.ts`/`probe-after.ts`/`diff.ts`; `formats-diff.ts`, `order-check.ts` |
| `prototypes/mount/` | `hono-auth.ts` (middleware di auth), `mount.test.ts` (24 test su app vera), `overlap.test.ts` (precedenza Elysia/mount). Si lanciano copiandoli in `apps/api/tests/probe/` con `hono` installato |
| `prototypes/openapi/` | U1: `zod-openapi-me.ts`, il modulo `me/` scritto con `@hono/zod-openapi` 1.6.3 per il confronto di D11 (diff a foglie con la baseline, tipi di `hc` su Hono 5). Non si lancia senza installare il pacchetto (`bun add --no-save`) |
| `prototypes/elysia/` | Sonde della mappa backend: `routes.ts` (tabella route), `compose.ts` (composizione offline), `xff.ts` (sovrascrittura globale di XFF), `csvfile.ts` (import CSV sempre 422) |

I prototipi non fanno parte del build né del typecheck; Biome li controlla (5 warning, nessun errore).

## Domande aperte

1. **Zod contro la raccomandazione della sonda.** La sonda di validazione raccomandava TypeBox 0.34 durante lo strangler e TypeBox 1 alla fine (27/27 dimostrato, 181/181 su OpenAPI, nessuno schema da riscrivere), e stimava per Zod 2156 chiamate da riscrivere, differenze di forma in `/openapi` e un trucco per i messaggi senza etichetta. Il piano segue la decisione di Marco (Zod, da non rivalutare). Si torna da Marco solo se U1 dimostra che un criterio obbligatorio (422 identico al byte) non si raggiunge con Zod.
2. **422 prima di 401.** Il piano tiene la parità (validatori prima dell'auth). La sonda di mount suggeriva di accettare il 401 per primo, per non mostrare dettagli di validazione a chi non ha fatto login. È una scelta di prodotto/sicurezza: se Marco la vuole, diventa una riga del registro dei delta e i test che la toccano vanno discussi.
3. **`POST /seller/products/import`** (CSV) oggi risponde sempre 422 e nessuna app lo usa. Il piano tiene il comportamento; correggerlo o toglierlo va fatto fuori dalla migrazione.
4. ~~**`/openapi` durante lo strangler**~~ Chiusa in U1: i path delle sub-app si uniscono a `documentation.paths` (`honoPaths(meApp, "/me")` in `src/index.ts`) e `/openapi/json` resta identico alla baseline.
5. ~~**Hono 5**~~ Chiusa in U1: il repo è su `5.0.0-rc.1` (D1); U12 porta all'ultima 5.x prima di U13, GA o rc.
6. **`X-Request-Id` su 404 ed errori di parse:** oggi mancano (Elysia lo mette solo sulle route trovate). Dopo U11 un middleware globale lo metterebbe ovunque: riprodurre la differenza o registrarla come delta, si decide in U11.
