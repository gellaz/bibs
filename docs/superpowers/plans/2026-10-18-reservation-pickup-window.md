# Tempo massimo di ritiro per negozio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ogni negozio imposta da 1 a 72 ore di apertura (default 24) entro cui ritirare un ordine «Prenota e paga in negozio», con 15 minuti di tolleranza lato seller e spiegazioni chiare a seller e customer.

**Architecture:** una funzione pura (`reservationDeadline`) accanto a `getOpenStatus` calcola la scadenza contando le fasce di apertura. Un resolver a lotti in `store-open-status.ts` le passa orari e chiusure dal DB. La usano `insertOrder` (scadenza vera), un endpoint seller (esempio con valore non salvato) e un endpoint customer (scadenze «se confermi adesso»). La scadenza resta salvata in `orders.reservation_expires_at`; cron e controllo di completamento aggiungono 15 minuti di tolleranza.

**Tech Stack:** Bun, Elysia + TypeBox, Drizzle/Postgres, TanStack Start/Query, Eden Treaty, Paraglide, bun test (api), Vitest (FE).

**Spec:** `docs/superpowers/specs/2026-10-18-reservation-pickup-window-design.md`

## Global Constraints

- Range ore: intero da **1** a **72**; default **24**; tolleranza **15** minuti. Le costanti vivono solo in `apps/api/src/lib/config.ts`.
- Le ore contano solo nelle fasce di apertura (orari settimanali, chiusure personalizzate, festività con opt-out), ora di Roma, chiusura della fascia esclusiva.
- Negozio senza orari dichiarati (stesso predicato del ramo `unknown` di `getOpenStatus`) → ore di calendario. Nessuna apertura sufficiente entro 60 giorni → ore di calendario.
- La scadenza si calcola una volta, alla conferma; cambi successivi (valore, orari, chiusure) non toccano le scadenze salvate.
- Il cliente vede sempre la scadenza vera; la tolleranza non compare in nessun testo customer.
- Mai «ore di apertura» nei testi per un negozio senza orari.
- Valore letto e scritto solo dal titolare (`requireOwner`).
- Testi utente solo in `messages/it.json` + `messages/en.json` (Paraglide); toast da `@bibs/ui/components/sonner`.
- Date customer nel formato di `pickupDeadline` (`apps/customer/src/features/orders/order-display.ts`): `mer 21 ott, 17:00`.
- Commit Conventional Commits con scope della whitelist (`api`, `seller`, `customer`, `db`, `orders`, `stores`); mai su `main`, mai `--no-verify`.
- Eden idrata in `Date` anche le stringhe data (`opensAt.date`): convertire con `toYMD` come in `apps/customer/src/features/stores/use-store-detail.ts`.

## Review Focus

1. **`opensAt.date` idratato da Eden in `Date`** nel dettaglio ordine: senza `toYMD` la riga «il negozio ora è chiuso…» mostrerebbe una data sbagliata o andrebbe in errore → test del helper con `opensAt.date` passato come `Date` (Task 7).
2. **Ordine fatto in pausa pranzo o un minuto prima della chiusura**: la scadenza deve partire dalla fascia successiva, non da «adesso» → test «partenza tra due fasce» e «1 minuto prima della chiusura» (Task 1).
3. **Completamento 30 secondi dopo la scadenza, con il cron che ha già girato**: deve riuscire, perché il cron non deve aver spazzato l'ordine → test cron a 14 minuti (Task 3).
4. **Seller che digita un valore non valido o lascia il campo vuoto**: nessuna chiamata all'anteprima, niente crash, «Salva» disattivato → test di `parseReservationHours` con `""`, `"0"`, `"73"`, `"1.5"` (Task 6).
5. **Riepilogo con un negozio con orari e uno senza**: niente frase «ore di apertura» generica → test di `reserveNoteKind` sul caso misto (Task 7).

---

### Task 0: Branch e documenti

**Files:**
- Add: `docs/superpowers/specs/2026-10-18-reservation-pickup-window-design.md`, `docs/superpowers/plans/2026-10-18-reservation-pickup-window.md`

- [ ] **Step 1:** `git checkout -b feat/reservation-pickup-window` da `main` aggiornato (`git pull --ff-only` prima).
- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-10-18-reservation-pickup-window-design.md docs/superpowers/plans/2026-10-18-reservation-pickup-window.md
git commit -m "docs(orders): spec e piano del tempo massimo di ritiro per negozio"
```

---

### Task 1: Funzione pura `reservationDeadline` (TDD)

**Files:**
- Modify: `apps/api/src/lib/holidays/open-status.ts` (esporta `nowInRome`, `toMinutes`, `slotsFor`, `MAX_LOOKAHEAD_DAYS`; estrae ed esporta `hasDeclaredHours`, usato anche da `getOpenStatus` al posto della condizione inline)
- Create: `apps/api/src/lib/holidays/reservation-deadline.ts`
- Modify: `apps/api/src/lib/holidays/index.ts` (re-export `reservationDeadline`, `hasDeclaredHours`, tipo `ReservationClock`)
- Test: `apps/api/tests/lib/holidays/reservation-deadline.test.ts`

**Interfaces:**
- Produces:
  - `export type ReservationClock = "opening" | "calendar";`
  - `export function hasDeclaredHours(openingHours: OpeningHoursDay[] | null): boolean`
  - `export function reservationDeadline(input: { openingHours: OpeningHoursDay[] | null; closedDates: Set<string>; from: Date; hours: number }): { expiresAt: Date; clock: ReservationClock }`

- [ ] **Step 1: Write the failing tests** in stile `open-status.test.ts` (convenzione `dayOfWeek` 0 = lunedì … 6 = domenica). Fixture: lun–sab `08:00–13:00` e `16:00–19:30`, domenica assente. Helper `rome(y, mo, d, h, mi)` che costruisce l'istante UTC con l'offset giusto (+2 estate, +1 inverno), come `romeSummer` nel test esistente. Casi, con il valore atteso in ora di Roma:

| Nome del test | from (Roma) | hours | closedDates | expiresAt atteso (Roma) | clock |
|---|---|---|---|---|---|
| `inside a slot` | sab 17/10/2026 10:00 | 2 | — | sab 17/10 12:00 | opening |
| `between slots starts at the next slot` | sab 17/10 14:00 | 1 | — | sab 17/10 17:00 | opening |
| `one minute before closing` | sab 17/10 19:29 | 1 | — | lun 19/10 08:59 | opening |
| `night skips closed sunday (spec example)` | sab 17/10 18:30 | 24 | — | mer 21/10 17:00 | opening |
| `ends exactly at closing time` | lun 19/10 21:00 | 5 | — | mar 20/10 13:00 | opening |
| `holiday date is skipped` | sab 17/10 18:30 | 2 | `{"2026-10-19"}` | mar 20/10 09:00 | opening |
| `multi-day custom closure is skipped` | sab 17/10 18:30 | 2 | `{"2026-10-19","2026-10-20"}` | mer 21/10 09:00 | opening |
| `72 hours` | lun 19/10 08:00 | 72 | — | mer 28/10 12:00, UTC 11:00 (8 giorni aperti × 8,5 h = 68 h, lun 19 → mar 27 saltando dom 25; + 4 h mer 28: lasciare il conto in un commento) | opening |
| `DST end (25 Oct 2026)` | sab 24/10 19:00 | 2 | — | lun 26/10 09:30 (UTC 08:30) | opening |
| `DST start (28 Mar 2027)` | sab 27/03/2027 19:00 | 2 | — | lun 29/03 09:30 (UTC 07:30) | opening |
| `no declared hours → calendar` | qualsiasi | 24 | — | from + 24 h | calendar |
| `slots: [] everywhere → calendar` | qualsiasi | 24 | — | from + 24 h | calendar |
| `no opening within 60 days → calendar` | sab 17/10 18:30 | 24 | tutte le date da oggi a +61 giorni | from + 24 h | calendar |

Asserzioni: `expect(r.expiresAt.toISOString()).toBe(<ISO atteso>)` e `expect(r.clock).toBe(...)`.

- [ ] **Step 2:** `cd apps/api && bun test tests/lib/holidays/reservation-deadline.test.ts` → FAIL (modulo inesistente).
- [ ] **Step 3: Implement.** In `reservation-deadline.ts`: senza orari dichiarati → calendario; altrimenti `nowInRome(from)` → per `offset` da 0 a `MAX_LOOKAHEAD_DAYS` salta i giorni in `closedDates`, per ogni fascia di `slotsFor(openingHours, dowFromYMD(date))` consuma `[offset === 0 ? max(open, nowMin) : open, close)`; quando la fascia copre i minuti rimasti restituisci `romeWallToUtc(date, start + left)` con `clock: "opening"`; finito il ciclo → calendario, con commento `// ponytail: chiusure oltre 60 giorni → ore di calendario; allargare la finestra se capita davvero.` La conversione dall'ora di Roma a UTC (non determinata dai test, quindi eccola):

```ts
/** Ora di Roma (data + minuti dalla mezzanotte) → istante UTC, giusto anche al cambio d'ora. */
function romeWallToUtc(ymd: string, minutes: number): Date {
	const [y, mo, d] = ymd.split("-").map(Number);
	const wall = Date.UTC(y, mo - 1, d, 0, minutes);
	const offsetAt = (t: number) => {
		const { date, minutes: m } = nowInRome(new Date(t));
		const [yy, mm, dd] = date.split("-").map(Number);
		return Date.UTC(yy, mm - 1, dd, 0, m) - t;
	};
	const guess = wall - offsetAt(wall);
	return new Date(wall - offsetAt(guess));
}
```

- [ ] **Step 4:** stesso comando + `bun test tests/lib/holidays` → PASS (anche `open-status.test.ts` dopo l'estrazione di `hasDeclaredHours`).
- [ ] **Step 5: Commit** `feat(api): calcolo della scadenza di ritiro sulle ore di apertura`

---

### Task 2: Colonna, config, resolver a lotti e scadenza vera in `insertOrder`

**Files:**
- Modify: `apps/api/src/lib/config.ts` (rimuove `reservationHours: 48`; aggiunge `reservationHours: { min: 1, max: 72, default: 24 }` e `reservationGraceMinutes: 15`)
- Modify: `apps/api/src/db/schemas/store.ts` (colonna + CHECK)
- Create: migrazione con `cd apps/api && bun run db:generate` (in `src/db/migrations/`), poi `bun run db:migrate` sul DB locale
- Modify: `apps/api/src/lib/store-open-status.ts` (estrae `loadClosedDates`; aggiunge `resolveReservationDeadlines`)
- Modify: `apps/api/src/modules/customer/services/orders.ts:496-499` (`insertOrder`)
- Modify: `apps/api/tests/helpers/fixtures.ts` (`createTestStore` accetta `reservationHours?: number`)
- Test: `apps/api/tests/integration/customer-orders.test.ts:239-256`, `apps/api/tests/integration/customer-checkout.test.ts`

**Interfaces:**
- Consumes: `reservationDeadline`, `ReservationClock` (Task 1).
- Produces:
  - colonna `store.reservationHours: integer("reservation_hours").notNull().default(config.reservationHours.default)` + `check("store_reservation_hours_range", sql\`${t.reservationHours} BETWEEN ${sql.raw(String(config.reservationHours.min))} AND ${sql.raw(String(config.reservationHours.max))}\`)`
  - `export async function loadClosedDates(stores: Array<{ id: string; closures: CustomClosure[] | null }>, now: Date): Promise<Map<string, Set<string>>>`. Finestra `[oggi Roma, +60 giorni]`, la stessa query di definizioni e opt-out oggi dentro `resolveOpenStatuses`, che ora la usa.
  - `export async function resolveReservationDeadlines(stores: Array<{ id: string; openingHours: OpeningHoursDay[] | null; closures: CustomClosure[] | null; reservationHours: number }>, now: Date): Promise<Map<string, { hours: number; expiresAt: Date; clock: ReservationClock }>>`

- [ ] **Step 1: Write the failing tests.**
  - `customer-orders.test.ts`: rinomina `sets reservationExpiresAt 48h in the future` in `store without hours: reservation expires 24 calendar hours later`; asserzioni su `24 * 3600 * 1000 ± 5000`.
  - Nuovo `store with hours: reservation expires after the store's opening hours`: negozio con orari lun–dom `08:00–20:00` e `reservationHours: 3`; `before = new Date()` prima della chiamata e `after` dopo; atteso `deadline(before) ≤ expiresAt ≤ deadline(after)`, con `deadline(t) = reservationDeadline({ openingHours, closedDates: new Set(), from: t, hours: 3 }).expiresAt` (il DB di test non ha festività).
  - `customer-checkout.test.ts`: stesso schema con bounds per un checkout `reserve_pickup` su negozio con `reservationHours: 2`.
- [ ] **Step 2:** `cd apps/api && bun test tests/integration/customer-orders.test.ts tests/integration/customer-checkout.test.ts --isolate` → FAIL.
- [ ] **Step 3: Implement.** Colonna e CHECK, generazione e applicazione della migrazione. In `insertOrder`, solo per `type === "reserve_pickup"`, rileggi con `tx.query.store.findFirst({ where: eq(store.id, storeId), columns: { id, openingHours, closures, reservationHours } })` e prendi `expiresAt` da `resolveReservationDeadlines([s], new Date())`.
- [ ] **Step 4:** stessi test → PASS; `bun run typecheck` in `apps/api` → 0 errori.
- [ ] **Step 5: Commit** `feat(api): ore di ritiro per negozio, la prenotazione scade sulle ore di apertura`

---

### Task 3: Tolleranza di 15 minuti

**Files:**
- Modify: `apps/api/src/modules/seller/services/orders.ts:69-76`
- Modify: `apps/api/src/lib/jobs/expire-reservations.ts:61-70`
- Test: `apps/api/tests/integration/seller-orders.test.ts`

**Interfaces:**
- Consumes: `config.reservationGraceMinutes` (Task 2).

- [ ] **Step 1: Write the failing tests.** Aggiorna le fixture con `reservationExpiresAt: new Date(Date.now() - 60_000)` (righe ~118, ~239, ~530), che oggi si aspettano il rifiuto per scadenza, a `- 16 * 60_000`. Nuovi test:
  - `completes 1 minute after the deadline (grace)`, con scadenza a `-60_000`: atteso status `completed`.
  - `completes 14 minutes after the deadline (grace)`: atteso `completed`.
  - `rejects 16 minutes after the deadline`: atteso 400 «La prenotazione è scaduta» e status `expired`.
  - `cron leaves a reservation 14 minutes past its deadline`: dopo `expireReservations()` resta `confirmed`, ritorna 0.
  - `cron expires a reservation 16 minutes past its deadline`: diventa `expired`, ritorna 1.
- [ ] **Step 2:** `bun test tests/integration/seller-orders.test.ts --isolate` → FAIL sui nuovi casi.
- [ ] **Step 3: Implement.** Un solo confronto in entrambi i punti: `expiresAt < now - config.reservationGraceMinutes * 60_000`. Nel cron: `lt(order.reservationExpiresAt, new Date(now.getTime() - grace))`. Commento di una riga: perché esiste la tolleranza (molte scadenze cadono all'ora di chiusura).
- [ ] **Step 4:** stesso comando → PASS.
- [ ] **Step 5: Commit** `feat(orders): 15 minuti di tolleranza sul ritiro delle prenotazioni`

---

### Task 4: API seller — valore e anteprima

**Files:**
- Modify: `apps/api/src/modules/seller/routes/stores.ts` (body PATCH `/stores/:storeId`; nuova GET `/stores/:storeId/reservation-preview`)
- Modify: `apps/api/src/modules/seller/services/stores.ts` (`UpdateStoreParams.reservationHours?: number`)
- Modify: `apps/api/src/modules/seller/services/order-types.ts` (`ownStore` legge anche `openingHours`, `closures`; nuova `previewReservationDeadline`)
- Modify: `apps/api/src/lib/schemas/composed.ts` (`StoreWithPhonesSchema.reservationHours`), `apps/api/src/lib/schemas/entities.ts` (`ReservationDeadlineSchema`)
- Test: `apps/api/tests/integration/seller-stores.test.ts` (o il file che già testa il PATCH del negozio: cercare `lowStockThreshold` in `tests/integration`)

**Interfaces:**
- Consumes: `resolveReservationDeadlines` (Task 2).
- Produces:
  - Body PATCH: `reservationHours: t.Optional(t.Integer({ minimum: config.reservationHours.min, maximum: config.reservationHours.max, description: "Ore di apertura entro cui ritirare una prenotazione" }))`; risposta `StoreWithPhonesSchema` con `reservationHours: t.Integer(...)`.
  - `export const ReservationDeadlineSchema = t.Object({ hours: t.Integer(), expiresAt: t.Date(), clock: t.Union([t.Literal("opening"), t.Literal("calendar")], { description: "opening = contate le ore di apertura; calendar = negozio senza orari, ore di calendario" }) })`
  - `GET /seller/stores/:storeId/reservation-preview?hours=<int 1–72>` → `okRes(ReservationDeadlineSchema)`, `requireOwner`, sola lettura, descrizione OpenAPI in italiano («Scadenza che avrebbe una prenotazione fatta adesso con queste ore, senza salvare nulla…»).
  - `export async function previewReservationDeadline(ref: StoreRef & { hours: number }): Promise<{ hours: number; expiresAt: Date; clock: ReservationClock }>`

- [ ] **Step 1: Write the failing tests:**
  - `PATCH reservationHours accepts 1 and 72`: persistito, ritornato nella risposta;
  - `PATCH reservationHours rejects 0, 73 and 1.5`: 422;
  - `new store defaults to 24`;
  - `reservation-preview uses the unsaved value`: con `hours=3` su un negozio con orari, `expiresAt` dentro i bounds `reservationDeadline(before/after)` e `reservationHours` nel DB invariato;
  - `reservation-preview on a store without hours → clock calendar`;
  - `reservation-preview rejects employees`: 403;
  - `reservation-preview rejects hours=0`: 422.
- [ ] **Step 2:** run del file → FAIL.
- [ ] **Step 3: Implement** secondo le Interfaces.
- [ ] **Step 4:** run → PASS; `bun run typecheck` in `apps/api`.
- [ ] **Step 5: Commit** `feat(api): ore di ritiro nel PATCH del negozio e anteprima della scadenza per il seller`

---

### Task 5: API customer — scadenze nel checkout e stato del negozio negli ordini

**Files:**
- Modify: `apps/api/src/modules/customer/routes/checkout.ts` (nuova GET `/checkout/reservation-deadlines`)
- Modify: `apps/api/src/modules/customer/services/checkout.ts` (`reservationDeadlinesForStores`; `getCheckout` aggiunge `store.openStatus`)
- Modify: `apps/api/src/modules/customer/services/orders.ts` (`getCustomerOrder` aggiunge `store.openStatus`)
- Modify: `apps/api/src/lib/schemas/composed.ts` (`CustomerOrderWithRelationsSchema.store` = `t.Object({ ...t.Omit(StoreSchema, ["location"]).properties, openStatus: t.Optional(t.Nullable(OpenStatusSchema)) })`)
- Test: `apps/api/tests/integration/customer-checkout.test.ts`, `apps/api/tests/integration/customer-orders.test.ts`

**Interfaces:**
- Consumes: `resolveReservationDeadlines` (Task 2), `resolveOpenStatuses`, `ReservationDeadlineSchema` (Task 4), `publiclyVisibleStore`.
- Produces:
  - `GET /customer/checkout/reservation-deadlines?storeIds=<id,id,…>` (`t.String({ maxLength: 2000 })`, al massimo 50 id) → `okRes(t.Array(t.Object({ storeId: t.String(), ...ReservationDeadlineSchema.properties })))`. Solo negozi visibili (`publiclyVisibleStore`); gli id sconosciuti o nascosti sono omessi; descrizione OpenAPI in italiano.
  - `export async function reservationDeadlinesForStores(storeIds: string[], now = new Date()): Promise<Array<{ storeId: string; hours: number; expiresAt: Date; clock: ReservationClock }>>`
  - `store.openStatus` presente in `GET /customer/orders/:orderId` e in ogni ordine di `GET /customer/checkouts/:checkoutId`; assente nella lista ordini.

- [ ] **Step 1: Write the failing tests:**
  - `reservation-deadlines returns hours, deadline and clock per store`: due negozi, uno con orari e `reservationHours: 2` (`clock: "opening"`, bounds come al Task 2) e uno senza orari (`clock: "calendar"`, `hours: 24`);
  - `reservation-deadlines omits hidden stores`: negozio soft-deleted omesso;
  - `order detail carries store.openStatus`: negozio con orari tutti i giorni e chiusura personalizzata da oggi (data di Roma, `Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" })`) a domani → `openStatus.status === "closed_holiday"` e `opensAt` definito; negozio senza orari → `"unknown"`;
  - `checkout detail carries store.openStatus on each order`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** `openStatus` con una sola chiamata a `resolveOpenStatuses` per gli store distinti degli ordini.
- [ ] **Step 4:** run → PASS; `bun run typecheck` in `apps/api`.
- [ ] **Step 5: Commit** `feat(api): scadenze delle prenotazioni nel checkout e stato del negozio negli ordini`

---

### Task 6: Seller — campo «Tempo per ritirare» (variante A)

**Files:**
- Create: `apps/seller/src/features/stores/components/reservation-hours-field.tsx`
- Create: `apps/seller/src/features/stores/lib/reservation-hours.ts` + test `reservation-hours.test.ts`
- Modify: `apps/seller/src/features/stores/components/order-types-section.tsx` (nuove props; il campo va come `children` della riga reserve, solo se `on("reserve_pickup")`, dentro `div.border-l-2.border-warm-line.pl-3.space-y-3`)
- Modify: `apps/seller/src/routes/_authenticated/store/index.tsx` (passa `reservationHours={store.reservationHours}` e `hasOpeningHours={store.openingHours?.some((d) => d.slots.length > 0) ?? false}`)
- Modify: `apps/seller/src/components/form-section.tsx` (prop `id?: string` su `<section>`), `apps/seller/src/features/stores/components/store-form.tsx:411` (`id="store-opening-hours"` sulla sezione orari)
- Modify: `apps/seller/messages/it.json`, `apps/seller/messages/en.json`

**Interfaces:**
- Consumes: PATCH `reservationHours` e GET `reservation-preview` (Task 4) via Eden.
- Produces:
  - `export function parseReservationHours(raw: string): number | null`: intero 1–72, altrimenti `null`.
  - `export function ReservationHoursField(props: { storeId: string; value: number; hasOpeningHours: boolean })`
  - `OrderTypesSection` props: `{ storeId: string; reservationHours: number; hasOpeningHours: boolean }`

- [ ] **Step 1: Write the failing test** `reservation-hours.test.ts` (Vitest): `"1" → 1`, `"72" → 72`, `" 24 " → 24`, e `""`, `"0"`, `"73"`, `"1.5"`, `"abc"` → `null`.
- [ ] **Step 2:** `cd apps/seller && bun run test -- reservation-hours` → FAIL.
- [ ] **Step 3: Implement.**
  - Il campo segue il pattern di `LowStockThresholdSection`: `Input` `w-20` numerico, `Salva` outline disattivato se non valido o invariato; il successo invalida `["store", storeId]` e `["stores"]` e mostra un toast.
  - Anteprima: `useQuery({ queryKey: ["store", storeId, "reservation-preview", hours], enabled: hours !== null && hasOpeningHours })` sul valore passato da `useDebouncedValue(draft, 300)` (`@bibs/ui/hooks/use-debounced-value`). La chiave inizia con `["store", storeId]`, così il salvataggio del form negozio la rinfresca.
  - Data nel riquadro formattata come `pickupDeadline` del customer (`weekday short, day numeric, month short, hour, minute`, `intlLocale()`).
  - Copy (it), chiavi nuove:
    - `store_order_types_reserve_hint`: «Il cliente prenota online, poi paga e ritira in negozio.»
    - `store_reservation_hours_label`: «Tempo per ritirare»
    - `store_reservation_hours_unit`: «ore di apertura»
    - `store_reservation_hours_unit_calendar`: «ore»
    - `store_reservation_hours_save`: «Salva»
    - `store_reservation_hours_saved`: «Tempo per ritirare aggiornato»
    - `store_reservation_hours_error`: «Errore nel salvataggio del tempo per ritirare»
    - `store_reservation_hours_invalid`: «Inserisci un numero intero da 1 a 72.»
    - `store_reservation_hours_help`: «Da 1 a 72 ore. Contano solo le ore in cui il negozio è aperto, secondo gli orari, le chiusure e le festività che hai impostato: notti e giorni di chiusura non consumano tempo.»
    - `store_reservation_hours_help_calendar`: «Da 1 a 72 ore.»
    - `store_reservation_hours_example`: «Con i tuoi orari, una prenotazione fatta adesso scadrebbe {date}.» (data in `<strong>`)
    - `store_reservation_hours_existing`: «Le prenotazioni già fatte tengono la loro scadenza.»
    - `store_reservation_hours_no_hours`: «Il negozio non ha orari di apertura: il tempo scorre sempre, anche di notte e nei giorni di chiusura.»
    - `store_reservation_hours_add_hours`: «Aggiungi gli orari», link `href="#store-opening-hours"`.
  - Traduzioni `en` equivalenti.
  - Con `hasOpeningHours === false`: unità `_calendar`, aiuto `_calendar`, riquadro `_no_hours` + link, nessuna query di anteprima.
- [ ] **Step 4:** test → PASS; `bun run typecheck` e `bun run lint` (root) → 0 errori.
- [ ] **Step 5: Commit** `feat(seller): tempo per ritirare nelle tipologie d'acquisto, con esempio sugli orari`

---

### Task 7: Customer — spiegazioni nel checkout e nel dettaglio ordine (1B, 2A, 3B)

**Files:**
- Create: `apps/customer/src/features/checkout/reservation-copy.ts` + test `reservation-copy.test.ts`
- Modify: `apps/customer/src/features/checkout/use-checkout.ts` (`useReservationDeadlines`)
- Modify: `apps/customer/src/features/checkout/store-choice.tsx` (via `RESERVATION_HOURS`; nuova prop `reservation`)
- Modify: `apps/customer/src/routes/_authenticated/checkout/index.tsx` (query per gli store del carrello con `reserve_pickup`)
- Modify: `apps/customer/src/routes/_authenticated/checkout/review.tsx:47,342-346` (via `RESERVATION_HOURS`; riquadro 2A)
- Modify: `apps/customer/src/features/orders/order-display.ts` (estrae `formatPickupDate(expiresAt: Date | string): string`, usato da `pickupDeadline`)
- Modify: `apps/customer/src/routes/_authenticated/orders/$orderId.tsx:99-101`, `apps/customer/src/routes/_authenticated/checkout/$checkoutId/index.tsx:171-173` (riga 3B sotto `PickupCountdown`)
- Modify: `apps/customer/messages/it.json`, `apps/customer/messages/en.json`

**Interfaces:**
- Consumes: `GET /customer/checkout/reservation-deadlines` e `store.openStatus` (Task 5); `describeOpensAt` (`apps/customer/src/features/stores/open-status.ts`); `toYMD`.
- Produces:
  - `export type ReservationInfo = { hours: number; expiresAt: Date | string; clock: "opening" | "calendar" }`
  - `export function useReservationDeadlines(storeIds: string[]): UseQueryResult<Map<string, ReservationInfo>>`: `enabled` solo con id; chiave `["checkout", "reservation-deadlines", ids ordinati]`.
  - `export function reserveNoteKind(clocks: ReservationInfo["clock"][]): "opening" | "mixed" | "calendar"`
  - `export function closedNoteOpensAt(input: { open: boolean; expiresAt: Date | string; openStatus?: { status: string; opensAt?: { date: Date | string; time: string } } | null }): { date: string; time: string } | null`: ritorna `opensAt` normalizzato (`date` come `YYYY-MM-DD`) solo se la prenotazione è aperta, lo stato è `closed` o `closed_holiday`, e la riapertura (`"YYYY-MM-DD HH:mm"`) è prima della scadenza formattata in ora di Roma nello stesso formato.

- [ ] **Step 1: Write the failing tests** `reservation-copy.test.ts` (Vitest):
  - `reserveNoteKind(["opening","opening"]) → "opening"`, `["opening","calendar"] → "mixed"`, `["calendar"] → "calendar"`;
  - `closedNoteOpensAt`:
    - chiuso con riapertura prima della scadenza → `{ date: "2026-10-19", time: "08:00" }`;
    - stesso caso con `opensAt.date` passato come `new Date("2026-10-19T00:00:00.000Z")` → stesso risultato (Review Focus 1);
    - riapertura alla scadenza o dopo → `null`;
    - `status: "open"` → `null`;
    - `status: "unknown"` → `null`;
    - `open: false` → `null`;
    - `openStatus` assente → `null`.
- [ ] **Step 2:** `cd apps/customer && bun run test -- reservation-copy` → FAIL.
- [ ] **Step 3: Implement.** Copy (it), chiavi:
  - **1B**, al posto di `checkout_type_reserve_pickup_hint`:
    - `checkout_type_reserve_pickup_hint_opening`: «Prenoti ora e paghi al ritiro. Il negozio tiene i prodotti per {hours} ore di apertura: se confermi adesso, entro {date}.» (data in `<strong className="font-medium text-foreground">`, come in anteprima)
    - `checkout_type_reserve_pickup_hint_calendar`: «Prenoti ora e paghi al ritiro. Il negozio tiene i prodotti per {hours} ore: se confermi adesso, entro {date}.»
    - `checkout_type_reserve_pickup_hint_short`: «Prenoti ora e paghi al ritiro.» (durante il caricamento o in caso di errore della query)
  - **2A**, al posto di `checkout_reserve_note`; riquadro `rounded-lg bg-muted p-3 text-sm`, una riga per negozio in `reserve_pickup` (nome a sinistra, `formatPickupDate` a destra, `tabular-nums`):
    - `checkout_reserve_deadlines_title`: «Se confermi adesso, ritira entro:»
    - `checkout_reserve_note_opening`: «Contano solo le ore di apertura di ogni negozio. Dopo, la prenotazione scade e i prodotti tornano disponibili.»
    - `checkout_reserve_note_mixed`: «Per i negozi con orari indicati contano solo le ore di apertura. Dopo, la prenotazione scade e i prodotti tornano disponibili.»
    - `checkout_reserve_note_calendar`: «Dopo, la prenotazione scade e i prodotti tornano disponibili.»
  - **3B**: `orders_store_closed_note`: «Il negozio ora è chiuso e {opens}. Per il ritiro contano solo le ore di apertura.» con `opens = describeOpensAt(closedNoteOpensAt(...))` («apre domani alle 08:00»). Paragrafo `text-muted-foreground text-sm` sotto `PickupCountdown`.
  - Traduzioni `en` equivalenti; rimuovi le chiavi orfane (`checkout_type_reserve_pickup_hint`, `checkout_reserve_note`).
- [ ] **Step 4:** test → PASS; `bun run typecheck` e `bun run lint` → 0 errori.
- [ ] **Step 5: Commit** `feat(customer): scadenza del ritiro spiegata nel checkout e nel dettaglio ordine`

---

### Task 8: Documentazione, verifica completa, smoke e PR

**Files:**
- Modify: `apps/api/AGENTS.md:112` (`reservationHours` ora `{ min: 1, max: 72, default: 24 }` + `reservationGraceMinutes` 15), `apps/api/AGENTS.md:157-167` («Reservation Expiry»: scadenza per negozio sulle ore di apertura, calcolata in `insertOrder` con `reservationDeadline`; tolleranza di 15 minuti nel cron e nel completamento)
- Modify: `docs/pagamenti.md`, solo se cita le 48 ore (`grep -n "48" docs/pagamenti.md`)

- [ ] **Step 1:** aggiorna i documenti.
- [ ] **Step 2:** dalla root, `bun run typecheck`, `bun run lint` e `bun run test`. Controlla l'esito **per workspace**, perché l'aggregato di `bun --filter` può nascondere un fallimento → tutto verde.
- [ ] **Step 3:** `bun run build` nel customer e nel seller → ok.
- [ ] **Step 4: Commit** `docs(api): scadenza delle prenotazioni per negozio e tolleranza`
- [ ] **Step 5: Smoke manuale di Marco** (regola delle PR con UI), con `bun run db:migrate` già fatto:
  - seller, pagina Negozio: imposta 2, poi 72, poi un valore non valido; controlla che il riquadro d'esempio si aggiorni; togli tutti gli orari e verifica il riquadro «non ha orari» e il link;
  - customer, checkout con due negozi (uno a 2 ore, uno a 24, uno dei due senza orari): testi 1B e 2A, caso misto;
  - dettaglio ordine con il negozio chiuso adesso: riga 3B;
  - completamento dal seller entro i 15 minuti dalla scadenza (forzando `reservation_expires_at` in psql su un ordine di prova, mai sul seed: `docker exec -i bibs-postgis psql -U pgadmin -d bibs-db`).
- [ ] **Step 6:** dopo l'ok di Marco, push e PR (`gh pr create`, descrizione in italiano con link a spec e piano, chiusa da `🤖 Generated with [Claude Code](https://claude.com/claude-code)`); push e merge li lancia Marco.
