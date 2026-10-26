# Struttura delle cartelle dell'API — design

Nasce dall'analisi della struttura di `apps/api` del 2026-10-26, dopo la migrazione a Hono (#313, #314).

## Perché

Marco trova l'API poco strutturata e poco pronta per la produzione. L'esempio che fa sono i job, sparsi in più cartelle,
ma non è l'unico problema. Il nucleo funziona: moduli per ruolo, il kit HTTP in `http/`, `db/` in ordine. Attorno però
ci sono tre "cassetti" senza una regola, e chi apre il progetto non sa dove cercare né dove mettere un file nuovo.

1. **Job in tre posti.** 2 in `src/jobs/`, 3 in `src/lib/jobs/`, lo scheduler in `src/plugins/cron.ts`.
2. **`lib/` tiene di tutto**: 38 file in una sola cartella che mescolano infrastruttura (`env`, `logger`, `s3`,
   `stripe`, `email`, `auth`), regole di business (`order-state-machine`, `vat`, `platform-fee`,
   `store-open-status`…), helper HTTP (`responses`, `deep-trim`, `validation-message`) e gli schemi Zod.
3. **`plugins/` è un nome rimasto da Elysia.** Dentro ci sono middleware, due gruppi di route (`health`, `openapi`) e lo
   scheduler, e si sovrappone a `http/`: due `openapi.ts`, `http/errors.ts` accanto a `lib/errors.ts`, due
   `validation-message.ts`, quattro file "auth" in tre cartelle.
4. **La logica condivisa sta dentro un ruolo.**
   - `customer` importa `seller/services/discount-pricing` (6 file).
   - `seller` importa `customer/services/orders` (`assertCancellable`, `PAY_TYPES`).
   - `admin` importa `seller/services/onboarding-notifications` e `seller/services/settings` (`deleteDocumentImage`).
   - `http/auth.ts` importa `modules/seller/context` (`resolveSellerAccess`).
   - I job importano `modules/billing`.
   - `modules/billing` è un modulo senza route: è logica di business, non un modulo HTTP.
5. **`registration/` non segue lo schema degli altri moduli:** route dentro `index.ts`, un solo `services.ts`.
6. **I test non rispecchiano `src/`.** `tests/unit`, `lib`, `modules`, `plugins` e `http` si sovrappongono (rate-limit è
   testato in due cartelle). `tests/integration` contiene 112 file in un'unica cartella.

In più, dal lato produzione:

- **I cron girano nel processo API senza lock.** Con due repliche le due copie di un job partono nello stesso istante e
  si contendono le stesse righe. Oggi non fa danni (ogni job ricontrolla lo stato in transazione e le chiamate Stripe
  hanno l'idempotency key), ma nessuna regola dice che deve restare così.
- **I cron usano l'ora locale del server.** Nel container è UTC: il job "alle 03:00" gira alle 04:00 o alle 05:00 di Roma.
  Non c'è nemmeno protezione dalla sovrapposizione: un job da un minuto che dura più di un minuto parte due volte.
- **Lo shutdown chiude il pool del DB senza fermare i cron** e senza aspettare le richieste in corso: un job a metà
  transazione perde la connessione.
- **I log vanno anche in `logs/app.log`, senza rotazione.** Nel container il file cresce senza limite, e la riga JSON
  per richiesta finisce solo lì: la piattaforma, che legge stdout, non la vede.

## Obiettivi

- Ogni file dell'API ha un posto ovvio, deciso da poche regole scritte.
- Un modulo non dipende da un altro modulo: ciò che serve a due ruoli sta fuori dai moduli.
- Le regole sono controllate in automatico, così la struttura non si degrada di nuovo.
- I quattro problemi di produzione elencati sopra sono risolti.

## Non obiettivi

- Cambiare le API: route, payload, status, OpenAPI restano identici. Le fasi 1–5 sono solo spostamenti di file.
- Spezzare i file grandi (`seller/services/products.ts` 1178 righe, `schemas/entities.ts` 1310,
  `admin/services/sellers.ts` 741…). Diventerà più facile dopo, ma è un altro lavoro.
- Cambiare l'organizzazione dei moduli: restano per ruolo, non per entità.
- Rate limit condiviso tra istanze (resta in memoria; vedi "Lasciato fuori").
- Passare dall'alias `@/` agli import `#` di pacchetto: è una PR a sé, già rimandata il 2026-10-24.

## Anti-obiettivi

Questo lavoro fallisce, anche se compila, se:

- cambia una risposta dell'API o lo spec OpenAPI;
- un test continua a passare ma non mocka più quello che mockava prima (vedi "Vincoli": `mock.module`);
- rompe il typecheck di admin, customer o seller;
- tiene il repo in uno stato intermedio a lungo: ogni fase è una PR che si mergia da sola, verde.

## Vincoli

- **I frontend compilano i sorgenti dell'API.** In admin, customer e seller `@/*` punta prima a `./src/*` e poi a
  `../api/src/*`, quindi un file dell'API con lo stesso percorso di uno del frontend viene sostituito da quello del
  frontend. I frontend oggi hanno in `src/`: `components/`, `env.ts`, `features/`, `hooks/`, `lib/`, `paraglide/`,
  `router.tsx`, `routes/`, `routeTree.gen.ts`, `server.ts`, `styles.css`. Le nuove cartelle dell'API (`http/`,
  `infra/`, `domain/`, `jobs/`, `schemas/`) non collidono. Non creare file dell'API con quei percorsi né file in
  `src/lib/` con nomi già presenti nei `src/lib/` dei frontend.
- **Export di pacchetto usati dai frontend:** `@bibs/api` (`src/types.ts`), `@bibs/api/schemas`,
  `@bibs/api/validation-rule`. I nomi restano; cambiano solo i percorsi in `apps/api/package.json`. I file esportati
  (`schemas/forms/**`, `validation-rule.ts`) continuano a usare solo import relativi.
- **`mock.module` nei test usa percorsi stringa:** `@/lib/stripe` (23 volte), `@/lib/s3` (17), `@/lib/email` (17),
  `@/lib/env` (13), `@/lib/geocoding` (1), più alcuni `@/modules/...`. Un percorso non aggiornato non dà errore: il mock
  non si applica e il test usa il modulo vero. Ogni fase che sposta un file mockato aggiorna tutte le stringhe, e la
  verifica controlla che ogni percorso passato a `mock.module` esista.
- **Lavoro in parallelo:** altre sessioni toccano l'API. Ogni fase è piccola e si mergia presto, per ridurre i conflitti;
  gli spostamenti si fanno con `git mv`, così il diff mostra rinomine.
- Bun + Hono 5 rc, Drizzle, Zod restano. Niente dipendenze nuove.

## Struttura di arrivo

```
apps/api/src/
  index.ts        server: avvio, scheduler, shutdown
  app.ts          composizione: middleware globali, MODULES, assertRoutes
  types.ts        tipi per i client hc
  http/           kit HTTP (v, send, doc, guardie, errori, OpenAPI)
    middleware/   request-log, cors, rate-limit, better-auth (socket IP + handler)
  infra/          adattatori verso l'esterno: env, logger, s3, stripe, email, auth, geocoding
  domain/         regole di business usate da più di un modulo o dai job
    billing/  orders/  pricing/  stores/  holidays/  catalog/  sellers/
  jobs/           i cinque job + scheduler.ts
  schemas/        schemi Zod (ex lib/schemas), forms/ esportato come @bibs/api/schemas
  lib/            utility generiche senza significato di business
  modules/        solo HTTP per ruolo: index.ts, routes/, services/ propri del ruolo, context.ts
  db/  scripts/   invariati
apps/api/tests/
  helpers/  preload.ts
  unit/           stesso albero di src/ (http/, infra/, domain/, jobs/, lib/, schemas/, modules/<ruolo>/, db/)
  integration/    stesso albero di src/
```

### Regole

Dove va un file:

1. Usato da un solo modulo → dentro quel modulo.
2. Usato da più moduli o dai job, ed è una regola di business → `domain/<area>/`.
3. Usato da più moduli, ma generico (soldi, CSV, LIKE, paginazione, errori) → `lib/`.
4. Parla con un sistema esterno o col runtime (S3, Stripe, email, env, log, better-auth, geocoding) → `infra/`.
5. Riguarda solo la richiesta HTTP (validazione, risposte, guardie, middleware) → `http/`.

Chi può importare cosa (controllato in automatico):

- **A.** Un modulo non importa da un altro modulo.
- **B.** Fuori da `modules/` nessuno importa da `modules/`, tranne `app.ts`, `types.ts`, `db/seed/` e `scripts/`
  (strumenti, non codice servito).
- **C.** `lib/` importa solo da `lib/` e `db/`.

Le altre direzioni (`domain` → `infra`/`lib`/`db`, `http` → `domain` per la guardia del seller, `db/schemas` → costanti
di `domain`/`lib`/`infra` come oggi) sono permesse e non servono controlli.

### Dove va ogni file

| Oggi | Dopo |
|---|---|
| `plugins/cron.ts` | `jobs/scheduler.ts` |
| `jobs/*.ts`, `lib/jobs/*.ts` | `jobs/*.ts` |
| `plugins/request-log.ts`, `rate-limit.ts`, `better-auth.ts` | `http/middleware/` |
| `plugins/cors.ts` + `lib/cors.ts` | un file, `http/middleware/cors.ts` |
| `plugins/health.ts` | `http/health.ts` |
| `plugins/openapi.ts` | `http/openapi-routes.ts` (accanto a `openapi.ts`, il generatore) |
| `lib/responses.ts`, `auth-errors.ts`, `deep-trim.ts` | `http/` |
| `lib/validation-message.ts` + `http/validation-message.ts` | un file, `http/validation-message.ts` |
| `lib/validation-rule.ts` | `http/validation-rule.ts` (+ percorso dell'export) |
| `lib/env`, `logger`, `s3`, `stripe`, `email`, `auth`, `permissions`, `retry`, `geocoding/` | `infra/` |
| `modules/billing/services/*`, `lib/connect-status`, `platform-fee`, `online-charge` | `domain/billing/` (il modulo `billing` sparisce) |
| `lib/order-state-machine`, `order-helpers`, `order-types`, `pickup-code`; `assertCancellable` e `PAY_TYPES` da `customer/services/orders`; dai file dei job le funzioni usate anche da moduli e seed (`expireSingleReservation`, `reservationGraceCutoff`, `cancelUnpaidOrder`) | `domain/orders/` (fase 4; in fase 1 restano nei file dei job) |
| `seller/services/discount-pricing`, `lib/vat` | `domain/pricing/` |
| `lib/opening-hours`, `store-open-status`, `store-visibility` | `domain/stores/` |
| `lib/holidays/` | `domain/holidays/` |
| `lib/characteristic-values`, `characteristic-impact` | `domain/catalog/` |
| `resolveSellerAccess` e ciò che usa (da `seller/context.ts` e `seller/services/access.ts`); `seller/services/onboarding-notifications`; `deleteDocumentImage` da `seller/services/settings` | `domain/sellers/` |
| `lib/countries` | `modules/locations/` |
| `lib/municipality`, `user-summary`, `admin-notifications` | `modules/seller/` |
| `lib/points-allocation` | `modules/customer/` |
| `lib/schemas/` | `schemas/` |
| `lib/utils/csv.ts` | `lib/csv.ts` |
| `lib/config`, `errors`, `like`, `list-by-name-paged`, `money`, `pagination` | restano in `lib/` |
| `registration/index.ts` (route dentro) + `services.ts` | `registration/index.ts` + `routes/` + `services/`, come gli altri moduli |

## Fasi

Ogni fase è una PR a sé, verde da sola, mergiata prima di aprire la successiva. Le fasi 1–6 non cambiano comportamento.
Ogni PR aggiorna nello stesso commit la documentazione dei percorsi che sposta: `apps/api/AGENTS.md`,
`apps/api/README.md`, `AGENTS.md` di root, `docs/architecture.md`, `docs/pagamenti.md`, `docs/stripe-billing.md`, il
commento in `.github/workflows/ci.yml` su `@/lib/env`. Gli spec e i piani vecchi in `docs/superpowers/` e `docs/audit/`
sono storici e non si toccano.

1. **Job.** `jobs/` con i cinque job + `scheduler.ts`; `plugins/cron.ts` sparisce. È l'esempio di Marco e la fase più
   piccola: serve anche a provare il metodo di verifica.
2. **HTTP.** `plugins/` sparisce dentro `http/` e `http/middleware/`; gli helper HTTP di `lib/` passano in `http/`.
3. **Infra.** Gli adattatori passano da `lib/` a `infra/` (è la fase con più `mock.module` da aggiornare).
4. **Domain.** Regole condivise in `domain/`, `modules/billing` sparisce, file con un solo modulo che li usa dentro quel
   modulo. Alla fine valgono le regole A–C: in questa PR entra anche il controllo automatico.
5. **Schemas e moduli.** `lib/schemas` → `schemas/`, `lib/utils/csv.ts` → `lib/csv.ts`, `registration/` con `routes/` e
   `services/`. Aggiorna gli export in `package.json`.
6. **Test.** `tests/` con lo stesso albero di `src/`, divisi tra `unit/` e `integration/` (girano con opzioni diverse);
   gli script `test:unit` e `test:integration` puntano alle due cartelle intere.
7. **Produzione.** Unica fase che cambia comportamento; dettagli sotto.

## Fase 7: produzione

- **Mai due copie dello stesso job in contemporanea, su tutte le istanze.** Prima di eseguire un job lo scheduler
  prende un advisory lock di Postgres dedicato a quel job, tenuto solo mentre il job gira; se un'altra istanza lo
  tiene, salta il giro senza errori. Dentro lo stesso processo, croner non avvia un giro se il precedente è ancora in
  corso (`protect`). La garanzia è "niente sovrapposizioni", non "una sola esecuzione per orario": un'altra replica può
  rieseguire un job appena finito. Per questo i job restano idempotenti (ricontrollo dello stato in transazione,
  idempotency key su Stripe) e un job nuovo deve esserlo; la regola va scritta in `apps/api/AGENTS.md`.
- **Fuso orario.** Tutti i cron in `Europe/Rome`, come le scadenze delle prenotazioni.
- **Shutdown ordinato.** Su `SIGTERM`/`SIGINT`: smette di accettare richieste, ferma lo scheduler, aspetta le richieste
  e i job in corso, poi chiude il pool ed esce. L'attesa ha un tetto che sta dentro il periodo di grazia di
  `docker stop` (10 s di default); passato il tetto esce comunque.
- **Log.** In produzione niente `logs/app.log` e niente riga di testo per richiesta: su stdout va solo JSON di pino, una
  riga per richiesta (la stessa che oggi finisce nel file) più i log del `logger`, per tutti i livelli (anche 4xx/5xx,
  oggi su stderr). In sviluppo e nei test resta come oggi (i golden e `logger.test.ts` non cambiano). Il Dockerfile non
  crea più `logs/`. Un test nuovo copre il ramo di produzione.

## Verifica

Per ogni fase 1–6:

- `bun run typecheck` in api, admin, customer e seller, workspace per workspace (l'aggregato di `bun --filter`
  nasconde i fallimenti);
- `bun run test` in api (mai `bun test` da solo: salta `--isolate`), `bun run lint`;
- route e spec identici a prima: output di `hono routes` e di `hono request /openapi/json` (Hono CLI, vedi
  `apps/api/AGENTS.md`) uguale a quello di `main`;
- `bun run build` e avvio del bundle: `/health` 200, `/ready` 200 con l'infra accesa;
- ogni percorso passato a `mock.module` nei test corrisponde a un file esistente;
- `bun run db:generate` non produce migrazioni (`db/schemas` importa da file che si spostano);
- il diff della PR è fatto di rinomine e import aggiornati: niente cambi di logica. Fanno eccezione, come modifiche
  visibili, le due fusioni (`cors`, `validation-message`) e le funzioni estratte in fase 4: il corpo passa identico.

Per la fase 7: un test per il lock (due esecuzioni concorrenti dello stesso job: una salta) e uno smoke dello shutdown
(un `SIGTERM` durante un job lo lascia finire).

## Scelte mie (da controllare)

- Moduli per ruolo e non per entità: ognuno corrisponde a un client `hc` di un frontend, cambiarli tocca tre app.
- I nomi `infra/` e `domain/`, i sottogruppi di `domain/` e `http/openapi-routes.ts`.
- Unire le coppie con lo stesso nome (`cors`, `validation-message`) invece di rinominarle.
- `admin-notifications` in `modules/seller/` perché oggi lo usa solo il seller (regola 1), anche se avvisa gli admin.
- Il controllo automatico delle regole A–C dentro la fase 4, non come PR a parte.
- Advisory lock invece di un processo worker separato: funziona con qualunque numero di repliche e non cambia il deploy.
- Cron in `Europe/Rome`.
- Lock per "niente sovrapposizioni" e job idempotenti, invece di "una sola esecuzione per orario" (servirebbe una
  tabella delle esecuzioni e una migrazione, per un rischio che oggi i job già coprono).
- In produzione solo JSON su stdout, senza la riga di testo per richiesta.
- Fase dei test inclusa (198 file spostati) perché altrimenti `tests/` resta con la confusione di oggi.

## Lasciato al builder

- Come controllare le regole A–C: un test che legge gli import dei file in `src/` oppure `noRestrictedImports` di Biome.
- Quanto di `seller/context.ts` scende in `domain/sellers/`: il minimo perché `http/auth.ts` non importi più da
  `modules/`; gli helper che usano solo le route del seller restano in `context.ts`.
- I nomi dei file dentro `domain/<area>/` e dentro `tests/`.
- Il valore esatto del tetto di attesa dello shutdown e la chiave numerica degli advisory lock.

## Lasciato fuori

- Rate limit in memoria: vale per una sola istanza. Diventa un problema solo con più repliche; allora i contatori vanno
  in Postgres o Redis.
- Spezzare i file grandi; import `#` di pacchetto; tutto ciò che cambia le API.
