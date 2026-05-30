# Giorni di chiusura negozio & festività italiane — Design

- **Data**: 2026-05-30
- **Stato**: approvato (design), pronto per writing-plans
- **Branch**: `feat/store-closures-holidays`

## Sommario

Diamo al seller la possibilità di gestire i **giorni di chiusura** del proprio
negozio per data di calendario (in aggiunta agli orari settimanali, che già
esistono come `stores.openingHours`). Ogni negozio:

- **osserva di default** le festività italiane mantenute centralmente dalla
  piattaforma;
- può fare **opt-out** delle singole festività in cui resta aperto;
- può aggiungere **chiusure custom** (date singole o intervalli, es. ferie
  estive), sempre a giornata intera.

L'**admin** gestisce la lista canonica delle festività come *definizioni*
(fisse, relative-Pasqua, una-tantum), con un set di default precaricato.

Esponiamo un calcolo **"aperto adesso"** (`openStatus`) sui payload negozio del
seller, alimentato da orari settimanali + chiusure risolte. **Nessuna UI
customer** in questo progetto (oggi non esiste né la pagina negozio customer né
il calcolo open-now: sono un sottosistema a sé).

## Decisioni (bloccate in brainstorming)

| Tema | Scelta |
|---|---|
| Modello per-negozio | Reference: osserva festività di piattaforma + opt-out per festività + chiusure custom |
| Definizione festività (admin) | Definizioni tipizzate: `fixed` (giorno/mese), `easter_relative` (offset da Pasqua, Computus), `one_off` (data singola). CRUD + on/off |
| Persistenza per-negozio | **Ibrido**: join table per gli opt-out (FK→definizione, cascade) + colonna JSONB `closures` su `stores` per le custom (gemella di `openingHours`) |
| Scope | Backend + seller + admin + helper risoluzione date + calcolo `openStatus`. **Niente UI customer.** |
| Chiusure custom | Date singole **e** intervalli, sempre giornata intera |
| Placement seller | Route dedicata `/store/closures` |
| Placement admin | Tab "Festività" in `/configurations` |
| i18n admin | Italiano hardcoded, coerente con i panel admin attuali |

## Fuori scope (deliberatamente)

- UI customer / pagina dettaglio negozio / filtro "aperto adesso" nella ricerca.
- Santo patrono per-comune (feature a sé, legata a `municipalityId`).
- Orario ridotto / override parziale degli slot in una data (solo chiusure a
  giornata intera).
- Timezone per-store (la piattaforma è solo Italia → `Europe/Rome` fisso).

## 1. Data model

ID con il pattern del repo: `text("id").primaryKey().$defaultFn(() => crypto.randomUUID())`.
Convenzione enum: `text({ enum }) + CHECK`, **non** `pgEnum`.

### 1.1 `holiday_definitions` (piattaforma, admin)

Nuovo file `apps/api/src/db/schemas/holiday-definition.ts`.

| colonna | tipo | note |
|---|---|---|
| `id` | text pk | `crypto.randomUUID()` |
| `name` | text not null | es. "Natale", "Lunedì dell'Angelo" |
| `type` | text not null | `enum: ['fixed','easter_relative','one_off']` + CHECK |
| `month` | integer null | valorizzato se `fixed` (1–12) |
| `day` | integer null | valorizzato se `fixed` (1–31) |
| `easterOffsetDays` | integer null | valorizzato se `easter_relative` (Pasqua=0, Pasquetta=1) |
| `oneOffDate` | date null | valorizzato se `one_off` (`YYYY-MM-DD`) |
| `isActive` | boolean not null default true | on/off senza cancellare |
| `createdAt` | timestamptz default now not null | |
| `updatedAt` | timestamptz default now `$onUpdate` not null | |
| `createdByUserId` | text fk `user.id` on delete set null | come `pricing_config` |

CHECK di forma per tipo (backstop a livello DB):

```sql
CHECK (
  (type = 'fixed'          AND month IS NOT NULL AND day IS NOT NULL
                           AND easter_offset_days IS NULL AND one_off_date IS NULL) OR
  (type = 'easter_relative' AND easter_offset_days IS NOT NULL
                           AND month IS NULL AND day IS NULL AND one_off_date IS NULL) OR
  (type = 'one_off'        AND one_off_date IS NOT NULL
                           AND month IS NULL AND day IS NULL AND easter_offset_days IS NULL)
)
```

Unicità per evitare doppioni (→ 409 via handler globale 23505): unique index
parziale per tipo, es. `unique(type, month, day)` per `fixed`,
`unique(type, easter_offset_days)` per `easter_relative`,
`unique(type, one_off_date)` per `one_off`. In pratica un unico
`uniqueIndex` su `(type, month, day, easter_offset_days, one_off_date)` con i
NULL coerenti per tipo è sufficiente e semplice.

### 1.2 `store_holiday_optouts` (join)

Nuovo file `apps/api/src/db/schemas/store-holiday-optout.ts`.

| colonna | tipo | note |
|---|---|---|
| `storeId` | text not null fk `stores.id` on delete cascade | |
| `holidayDefinitionId` | text not null fk `holiday_definitions.id` on delete cascade | |
| `createdAt` | timestamptz default now not null | |

- **PK composita** `(storeId, holidayDefinitionId)` (dà unicità gratis).
- Index su `holidayDefinitionId` (per performance della cascade).
- Presenza riga = "questo negozio **resta aperto** in quella festività".

### 1.3 `stores.closures` (colonna JSONB, gemella di `openingHours`)

Aggiunta a `apps/api/src/db/schemas/store.ts`:

```ts
closures: jsonb("closures").$type<
  Array<{ startDate: string; endDate?: string; note?: string }>
>(),
```

- `startDate` / `endDate`: `YYYY-MM-DD`; `endDate` assente = giorno singolo;
  `endDate ≥ startDate`; sempre giornata intera.
- Default `null` (come `openingHours`). Sostituita **wholesale** al salvataggio.

### 1.4 Relations / index export

Aggiornare `apps/api/src/db/schemas/index.ts` con i nuovi schemi e le relations
(`store_holiday_optouts` → `store` e → `holiday_definition`; `store` → many
`store_holiday_optouts`).

## 2. Logica di dominio — `apps/api/src/lib/holidays/`

Modulo **puro** (nessun accesso DB, nessun `Date.now()` interno), interamente
unit-testato. File suggeriti: `easter.ts`, `resolve.ts`, `open-status.ts`,
`index.ts`. Tipi condivisi (`HolidayDefinition`, `CustomClosure`, `OpenStatus`).

### 2.1 Computus

```ts
export function computeEaster(year: number): { month: number; day: number }
```

Algoritmo gregoriano "Anonymous"/Meeus (solo aritmetica intera, nessuna dep).
Vettori di test noti: Pasqua 2024 = 31 mar, 2025 = 20 apr, 2026 = 5 apr,
2027 = 28 mar, 2030 = 21 apr.

### 2.2 Risoluzione occorrenze

```ts
export function resolveOccurrences(
  def: HolidayDefinition, fromYear: number, toYear: number,
): string[]  // date "YYYY-MM-DD" (calendario Europe/Rome)
```

- `fixed` → `{year}-{month}-{day}` per ogni anno nel range.
- `easter_relative` → `computeEaster(year)` + `easterOffsetDays` (somma sui
  giorni, gestendo i cambi di mese) per ogni anno.
- `one_off` → `[oneOffDate]` se nel range.

### 2.3 Date chiuse di un negozio

```ts
export function resolveStoreClosedDates(input: {
  activeDefs: HolidayDefinition[];
  optOutIds: string[];           // definizioni NON osservate
  customClosures: CustomClosure[];
}, window: { from: string; to: string }): Set<string>   // "YYYY-MM-DD"
```

= (festività attive non in `optOutIds`, risolte nel window) ∪ (range custom
espansi nel window).

### 2.4 Stato apertura

```ts
export function getOpenStatus(input: {
  openingHours: OpeningHours | null;
  closedDates: Set<string>;
  now: Date;                     // INIETTATO (test deterministici)
}): {
  isOpen: boolean;
  status: 'open' | 'closed' | 'closed_holiday';
  closesAt?: string;             // "HH:mm" se aperto
  opensAt?: { date: string; time: string };  // prossima apertura se chiuso
}
```

- Deriva il wall-clock `Europe/Rome` (data locale `YYYY-MM-DD`, `dayOfWeek`,
  `HH:mm`) da `now` via `Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Rome',
  hourCycle:'h23', ... })`. DST gestito da Intl, nessuna dipendenza nuova.
- Se la data locale ∈ `closedDates` → `closed_holiday`; calcola la prossima
  apertura scavalcando i giorni chiusi (scan in avanti, cap es. 60 giorni).
- Altrimenti usa gli slot del `dayOfWeek` odierno: dentro uno slot → `open` +
  `closesAt`; fuori → `closed` + `opensAt` (prossimo slot oggi o prossimo
  giorno aperto).

### 2.5 Trappole inchiodate

- **`dayOfWeek`**: repo = **0=Lun … 6=Dom**; `Date.getDay()` = 0=Dom. La
  conversione vive **solo** dentro questo modulo.
- **Timezone**: tutto `Europe/Rome`; nessuna colonna tz per-store.

## 3. API

### 3.1 Admin — `apps/api/src/modules/admin/routes/holiday-definitions.ts`

Role-guard già fornito dal wrapper `adminModule` (`user.role === 'admin'`).
Service in `apps/api/src/modules/admin/services/holiday-definitions.ts`.
Schemi in `apps/api/src/lib/schemas/` (descrizioni italiane), re-export da
`index.ts`. Risposte via `okRes()`, errori via `withErrors()` /
`withConflictErrors()`.

- `GET  /admin/holiday-definitions` → lista (attive + inattive), ordinata per
  prossima occorrenza / tipo.
- `POST /admin/holiday-definitions` → crea. Body = **union discriminata** per
  `type` (TypeBox), validazione di forma.
- `PATCH /admin/holiday-definitions/:id` → aggiorna campi + `isActive`.
- `DELETE /admin/holiday-definitions/:id` → elimina (cascade rimuove gli
  opt-out collegati).
- `GET  /admin/holiday-definitions/preview?year=YYYY` → risolve le definizioni
  attive a date concrete per l'anno (l'admin verifica la Pasqua). Read-only.

### 3.2 Seller — `apps/api/src/modules/seller/routes/closures.ts`

Owner-only (`withSeller` + `requireOwner`). Service in
`apps/api/src/modules/seller/services/closures.ts`.

- `GET /seller/stores/:storeId/closures` →
  ```ts
  {
    holidays: Array<{ definitionId: string; name: string;
                      type: string; nextDate: string; observed: boolean }>;
    customClosures: Array<{ startDate: string; endDate?: string; note?: string }>;
  }
  ```
  Festività attive risolte alla prossima occorrenza (window ~18 mesi) +
  `observed = !optOut`.
- `PUT /seller/stores/:storeId/closures` → body
  `{ optOutIds: string[]; customClosures: CustomClosure[] }`. Sostituzione
  **wholesale in transazione**: delete+insert degli opt-out, update del JSONB
  `closures`. Valida che gli `optOutIds` siano definizioni esistenti; valida i
  range custom (`endDate ≥ startDate`, formato). **Nessun cap** sul numero di
  chiusure custom per negozio (scelta di prodotto). Ritorna lo stato aggiornato.

### 3.3 Arricchimento payload negozio (`openStatus`)

Non esiste `GET /stores/:storeId` singolo: il FE legge il negozio attivo dalla
**lista** `GET /seller/stores` (`seller/routes/stores.ts:39`). Quindi
arricchiamo gli **item della lista** con:

```ts
openStatus: OpenStatus | null   // null se openingHours è null
```

Calcolo **efficiente**: caricare le definizioni festività attive **una sola
volta** per la richiesta, e gli opt-out di tutti gli store della lista in
**un'unica query batch**; poi `getOpenStatus` per ogni store con `now = new Date()`.
Aggiornare `StoreWithPhonesSchema` (o lo schema usato dalla lista) in
`apps/api/src/lib/schemas/entities.ts` con `openStatus` nullable.

> Planning: confermare che la risposta di `GET /seller/stores` includa
> `openingHours` (serve al calcolo); se non c'è, aggiungerlo.

## 4. Seed di default — `apps/api/src/db/seed/base/holidays.ts`

Idempotente (insert con `onConflictDoNothing` sull'indice di unicità).
Richiamato da `apps/api/src/db/seed/base/index.ts`.

| name | type | parametri |
|---|---|---|
| Capodanno | fixed | 1/1 |
| Epifania | fixed | 6/1 |
| Pasqua | easter_relative | 0 |
| Lunedì dell'Angelo | easter_relative | 1 |
| Festa della Liberazione | fixed | 25/4 |
| Festa del Lavoro | fixed | 1/5 |
| Festa della Repubblica | fixed | 2/6 |
| Ferragosto | fixed | 15/8 |
| Tutti i Santi | fixed | 1/11 |
| Immacolata Concezione | fixed | 8/12 |
| Natale | fixed | 25/12 |
| Santo Stefano | fixed | 26/12 |

## 5. UI Seller

Route dedicata `apps/seller/src/routes/_authenticated/store/closures.tsx`,
linkata dalle impostazioni negozio. Componenti in
`apps/seller/src/features/stores/components/`.

- `closures-manager.tsx` (corpo pagina): carica `GET`, due parti:
  - **Festività** — **una sola tabella** (preferenza single-table): riga per
    festività attiva con nome · prossima data · toggle "Osservata / Resto
    aperto". Il toggle costruisce `optOutIds`.
  - **Le tue chiusure** — lista custom con add (data singola *o* intervallo +
    nota) e remove; date-range picker.
  - Salva → `PUT`, con dirty-tracking come `openingHours`
    (`serialize` + confronto).
- Convenzioni: i18n Paraglide (`apps/seller/messages/{it,en}.json`, niente copy
  hardcoded), primitive da `@bibs/ui`, toast da
  `@bibs/ui/components/sonner`, `"use no memo"` se uso TanStack Table.
- **Dashboard seller** (`apps/seller/src/routes/_authenticated/index.tsx`):
  sostituire il mock hardcoded "apertura non impostata" con `openStatus` reale
  dal negozio attivo.
- Durante l'implementazione: **route di preview live** per le varianti UI (non
  mockup ASCII).

## 6. UI Admin

Tab "Festività" dentro `apps/admin/src/routes/_authenticated/configurations.tsx`,
modellata 1:1 sul panel `product-categories`. Feature folder
`apps/admin/src/features/holidays/`:

- `holidays-panel.tsx` — tabella definizioni: nome · "quando" leggibile
  (es. *"25 dicembre"* / *"lunedì dopo Pasqua"* / *"12 ott 2026"*) · toggle
  attiva · crea / modifica / elimina (dialog).
- `holiday-form.tsx` — RHF + Zod, campi **condizionali al tipo**:
  `fixed` → mese+giorno; `easter_relative` → preset Pasqua(0)/Pasquetta(1) o
  offset; `one_off` → data.
- Controllo **"Anteprima anno"** → chiama `/preview?year=` e mostra le date
  risolte (verifica Pasqua a colpo d'occhio).
- Stringhe italiane hardcoded coerenti con l'admin attuale (toast tipo
  "Festività creata con successo").

## 7. Test & verifica

- **TDD sul modulo dominio** (la sostanza):
  - `computeEaster` sui vettori noti (§2.1).
  - `resolveOccurrences` per i tre tipi, inclusi bordi anno.
  - `resolveStoreClosedDates` con opt-out + range + bordi window + giorni DST.
  - `getOpenStatus`: aperto / chiuso-per-orari / chiuso-per-festività /
    chiuso-per-custom / prossima apertura oltre la chiusura / domenica /
    fuso (now in UTC che cade in giorno diverso a Roma).
- **API test** (`apps/api/tests/`):
  - admin CRUD: 400 forma invalida, 409 doppione, cascade delete rimuove gli
    opt-out collegati.
  - seller GET/PUT: 403 non-owner, persistenza opt-out, validazione custom
    closures, round-trip stato.
  - Niente test di concorrenza (l'harness serializza le tx; qui non ci sono
    race da riprodurre).
- **Verifica finale** (CLAUDE.md): `bun run typecheck && bun run lint &&
  bun run test`; per lo schema `bun run db:generate` → leggere lo SQL →
  `bun run db:migrate`; UI provata sui dev server (seller :3002, admin :3003).

## 8. Elenco file (per il planning)

**API**
- `src/db/schemas/holiday-definition.ts` (nuovo)
- `src/db/schemas/store-holiday-optout.ts` (nuovo)
- `src/db/schemas/store.ts` (+ colonna `closures`)
- `src/db/schemas/index.ts` (+ export + relations)
- `src/lib/holidays/{easter,resolve,open-status,index}.ts` (nuovo)
- `src/lib/schemas/` (schemi festività + closures + `openStatus`; re-export)
- `src/modules/admin/routes/holiday-definitions.ts` + `services/holiday-definitions.ts` (nuovo) + registrazione in `modules/admin/index.ts`
- `src/modules/seller/routes/closures.ts` + `services/closures.ts` (nuovo) + registrazione modulo seller
- `src/modules/seller/routes/stores.ts` / relativo service (arricchimento lista con `openStatus`)
- `src/db/seed/base/holidays.ts` (nuovo) + `src/db/seed/base/index.ts`
- migration via `db:generate`

**Seller**
- `src/routes/_authenticated/store/closures.tsx` (nuovo)
- `src/features/stores/components/closures-manager.tsx` (nuovo)
- `src/routes/_authenticated/index.tsx` (dashboard: status reale)
- `messages/{it,en}.json` (+ stringhe)

**Admin**
- `src/routes/_authenticated/configurations.tsx` (+ tab)
- `src/features/holidays/{components,schemas}/...` (nuovo)

## 9. Assunzioni

- Piattaforma solo Italia → `Europe/Rome` fisso; multi-country = lavoro futuro
  (aggiunta colonna `timezone`).
- App in dev, nessun prod → cambi di schema liberi; per un futuro prod il seed
  delle festività diventerebbe una data-migration una-tantum.
- Pasqua è sempre domenica (e i negozi sono tipicamente già chiusi la
  domenica): la definizione "Pasqua" è inclusa per completezza/etichetta, è
  innocua se ridondante con la chiusura domenicale.
