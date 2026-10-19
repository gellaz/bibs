# Impostazioni negozio a schede Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/store` del seller diventa tre schede (Profilo negozio · Orari e chiusure · Vendita), ognuna con un solo Salva; le chiusure entrano nella scheda orari come lista unica.

**Architecture:** La pagina tiene la scheda in `?sezione=` e monta ogni pannello alla prima visita, poi lo nasconde e basta. Profilo = `StoreForm` senza orari + vetrina in testa. Orari = nuovo `HoursClosuresPanel` (orari + `ClosuresList`), Vendita = nuovo `SalesSettingsPanel` che coordina i campi resi controllati. Barra di salvataggio estratta da `StoreForm` in `SaveBar`.

**Tech Stack:** TanStack Start/Router/Query, react-hook-form, Paraglide (`apps/seller/messages/{it,en}.json`), Vitest (`renderToStaticMarkup`), Biome.

**Spec:** `docs/superpowers/specs/2026-10-19-store-settings-tabs-design.md`

## Global Constraints

- Copy in italiano e inglese: ogni chiave nuova va in `it.json` **e** `en.json`.
- Toast solo da `@bibs/ui/components/sonner`.
- Token semantici (DESIGN.md), niente nomi di palette nei componenti.
- Eden: `openingHours` vuoto viaggia come `null`, `websiteUrl` vuoto come `null` (regole già in `StoreForm`).
- Le chiusure sono owner-only (API 403 al dipendente): nessuna query chiusure né order-types per il dipendente.
- `routeTree.gen.ts` si committa.
- Branch `feat/seller-store-settings-tabs`; commit Conventional con scope `seller`.

## Review Focus

- **Cambio scheda con modifiche in sospeso** → al ritorno le modifiche ci sono ancora (pannelli montati, nascosti con `hidden`). Verifica a mano nello smoke.
- **Salvataggio orari ok, chiusure ko** → toast d'errore, orari non più «da salvare», chiusure sì (baseline aggiornata per parte). È flusso di mutation, non logica pura: si verifica nello smoke del Task 8 mettendo la rete offline dopo il primo PATCH.
- **Chiusure del negozio già finite** → non in lista ma rimandate nel PUT. Test in Task 2 (`splitCustomClosures`).
- **Festività senza prossima data (`nextDate: null`)** → in fondo alla lista con «—». Test in Task 2.
- **Ultima tipologia offerta** → non si spegne; «Paga e ritira» non si accende senza pagamenti abilitati. Test in Task 3.

---

### Task 1: `SaveBar` condivisa e `StoreForm` per le schede

**Files:**
- Create: `apps/seller/src/components/save-bar.tsx`
- Create: `apps/seller/src/components/save-bar.test.tsx`
- Modify: `apps/seller/src/features/stores/components/store-form.tsx` (barra a fine form ~516-548, sezione orari ~409-427, `onFormSubmit`)
- Modify: `apps/seller/src/components/entity-form-header.tsx`

**Interfaces:**
- Produces: `SaveBar(props: { dirty: boolean; pending: boolean; disabled?: boolean; submitLabel: string; pendingLabel: string; onSave?: () => void; onCancel?: () => void }): JSX.Element` — senza `onSave` il bottone è `type="submit"`; con `onSave` è `type="button"`. Markup e classi identiche alla barra attuale di `StoreForm` (sticky + «Modifiche non salvate» `role="status"` solo quando `dirty`; Salva disabilitato se `pending || !dirty || disabled`).
- Produces: `StoreForm` props nuove `hideHours?: boolean` (non rende la sezione orari né il suo `Separator`, e `onFormSubmit` **non** mette `openingHours` nel payload), `leading?: ReactNode` (reso dentro il `<form>` prima di Identità, seguito da `Separator`), `extraDirty?: boolean` (OR in `hasChanges`).
- Produces: `EntityFormHeader` prop `bordered?: boolean` (default `true`; `false` toglie `border-b pb-6`).

- [ ] **Step 1: test di `SaveBar`** — `save-bar.test.tsx`: con `dirty: false` l'HTML non contiene «Modifiche non salvate» e il bottone ha `disabled`; con `dirty: true` contiene «Modifiche non salvate» e il wrapper ha `sticky`; con `onSave` il bottone è `type="button"`. Locale `it` via `overwriteGetLocale` come in `reservation-hours-field.test.tsx`.
- [ ] **Step 2:** `bun run --filter @bibs/seller test -- save-bar` → FAIL (modulo mancante).
- [ ] **Step 3:** crea `SaveBar` spostando la barra da `StoreForm`; `StoreForm` la usa (`submitLabel/pendingLabel/onCancel` passati invariati, `disabled={hoursInvalid}`). Aggiungi `hideHours`, `leading`, `extraDirty`, e `bordered` a `EntityFormHeader`.
- [ ] **Step 4:** test verde; `bunx tsc --noEmit -p apps/seller` pulito.
- [ ] **Step 5:** commit `refactor(seller): barra di salvataggio condivisa e StoreForm componibile`.

### Task 2: righe della lista chiusure (logica pura)

**Files:**
- Create: `apps/seller/src/features/stores/lib/closure-rows.ts`
- Create: `apps/seller/src/features/stores/lib/closure-rows.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface HolidayRow { definitionId: string; name: string; type: "fixed" | "easter_relative" | "one_off"; nextDate: string | null; observed: boolean }
  export interface CustomClosure { startDate: string; endDate?: string; note?: string }
  export interface ClosuresDraft { optOutIds: string[]; customClosures: CustomClosure[] }
  export type ClosureRow =
    | { kind: "holiday"; key: string; definitionId: string; name: string; start: string | null; closed: boolean }
    | { kind: "custom"; key: string; index: number; name: string | null; start: string; end?: string };
  export function romeToday(): string; // YYYY-MM-DD Europe/Rome (stesso Intl en-CA di closures-manager)
  export function splitCustomClosures(all: CustomClosure[], today: string): { past: CustomClosure[]; upcoming: CustomClosure[] };
  export function closureRows(holidays: HolidayRow[], draft: ClosuresDraft, today: string): ClosureRow[];
  export function closureDays(start: string, end?: string): number; // inclusivo, 1 senza end
  export function serializeClosures(draft: ClosuresDraft): string; // per il dirty, come serialize() di closures-manager
  ```
  `closureRows` usa `draft.customClosures` come «upcoming» (il chiamante ha già tolto le passate), `index` = posizione in `draft.customClosures`; ordina per `start` crescente, `null` in fondo; a parità di data festività prima. `name` custom = `note?.trim() || null`.

- [ ] **Step 1: test** (`closure-rows.test.ts`):
  - `splitCustomClosures` con today `2026-10-19`: `{startDate:"2026-10-10"}` → past; `{startDate:"2026-10-15", endDate:"2026-10-19"}` → upcoming (finisce oggi); `{startDate:"2026-12-24"}` → upcoming.
  - `closureRows`: festività `2026-12-25` + custom `2026-11-02` + festività `nextDate:null` → ordine `["2026-11-02","2026-12-25",null]`.
  - festività in `optOutIds` → `closed: false`; le altre `closed: true`.
  - `closureDays("2027-08-09","2027-08-23") === 15`, `closureDays("2026-11-02") === 1`, a cavallo di mese `closureDays("2026-12-30","2027-01-02") === 4`.
  - `serializeClosures` ignora l'ordine di `optOutIds` e di `customClosures`.
- [ ] **Step 2:** `bun run --filter @bibs/seller test -- closure-rows` → FAIL.
- [ ] **Step 3:** implementa (date come stringhe YYYY-MM-DD, confronto lessicografico; `closureDays` con `Date.UTC`).
- [ ] **Step 4:** verde.
- [ ] **Step 5:** commit `feat(seller): righe della lista unica delle chiusure`.

### Task 3: regole delle tipologie d'acquisto (logica pura)

**Files:**
- Create: `apps/seller/src/features/stores/lib/order-types.ts`
- Create: `apps/seller/src/features/stores/lib/order-types.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type OrderType = "reserve_pickup" | "pay_pickup";
  /** Cosa vede il cliente: pay_pickup solo con i pagamenti abilitati (stessa regola dell'API). */
  export function offeredTypes(draft: OrderType[], chargesEnabled: boolean): OrderType[];
  /** Lo switch di `type` è bloccato? Spegnere l'ultima offerta no; accendere pay_pickup senza pagamenti no. */
  export function isToggleLocked(type: OrderType, draft: OrderType[], chargesEnabled: boolean): boolean;
  ```
- [ ] **Step 1: test**: `offeredTypes(["reserve_pickup","pay_pickup"], false)` → `["reserve_pickup"]`; `isToggleLocked("reserve_pickup", ["reserve_pickup","pay_pickup"], false) === true` (unica offerta); `isToggleLocked("reserve_pickup", ["reserve_pickup","pay_pickup"], true) === false`; `isToggleLocked("pay_pickup", ["reserve_pickup"], false) === true` (accensione senza pagamenti); `isToggleLocked("pay_pickup", ["reserve_pickup","pay_pickup"], false) === false` (spegnerla è sempre permesso).
- [ ] **Step 2:** FAIL. **Step 3:** implementa. **Step 4:** verde.
- [ ] **Step 5:** commit `feat(seller): regole delle tipologie d'acquisto in una funzione`.

### Task 4: scheda «Orari e chiusure»

**Files:**
- Create: `apps/seller/src/features/stores/components/closures-list.tsx`
- Create: `apps/seller/src/features/stores/components/hours-closures-panel.tsx`
- Delete: `apps/seller/src/features/stores/components/closures-manager.tsx`, `apps/seller/src/routes/_authenticated/store/closures.tsx`
- Modify: `apps/seller/messages/it.json`, `apps/seller/messages/en.json`

**Interfaces:**
- Consumes: Task 1 `SaveBar`; Task 2 tutto.
- Produces: `ClosuresList(props: { holidays: HolidayRow[]; value: ClosuresDraft; onChange: (next: ClosuresDraft) => void; today: string }): JSX.Element`
- Produces: `HoursClosuresPanel(props: { storeId: string; openingHours: DaySchedule[]; readOnly: boolean }): JSX.Element`

Copy nuova (it / en):
| chiave | it | en |
|---|---|---|
| `store_hours_week_title` | Orari settimanali | Weekly hours |
| `store_hours_week_description` | Le fasce di ogni giorno. Valgono tutte le settimane, salvo le chiusure. | Each day's time slots. They apply every week, except on closures. |
| `store_closures_list_description` | Festività e giorni in cui chiudi, in ordine di data. | Holidays and days you close, by date. |
| `store_closures_kind_holiday` | Festività | Holiday |
| `store_closures_kind_holiday_open` | Festività · resti aperto | Holiday · you stay open |
| `store_closures_kind_custom` | Chiusura tua | Your closure |
| `store_closures_kind_custom_days` | Chiusura tua · {count} giorni | Your closure · {count} days |
| `store_closures_unnamed` | Chiusura | Closure |
| `store_closures_toggle_label` | {name}: chiuso o aperto | {name}: closed or open |
| `store_hours_closures_saved` | Orari e chiusure aggiornati | Hours and closures updated |

Riusa: `store_closures_title` (titolo sezione), `store_closures_closed/open/start/end/note_ph/remove/add/no_next/error`, `common_add`, `common_cancel`, `store_form_hours_missing`, `store_form_hours_*` di validazione, `store_settings_save/saving`.

- [ ] **Step 1: `ClosuresList`** — markup della preview (`store/preview.tsx`, `ClosuresTimeline` + `DateChip` + `SEGMENT`): bottone «Aggiungi chiusura» che apre sul posto Dal / Al (`min` = Dal) / Nota con Aggiungi (disabilitato senza Dal o con Al < Dal) e Annulla; `ul` con una riga per `closureRows(...)`, **tutte** (niente «Mostra tutte»); colonna data = «1 nov» in grassetto + giorno della settimana sotto (`intlLocale()`, `new Date(y, m-1, d)` come `formatDate` di closures-manager), intervallo stesso mese «7–9 gen», mesi diversi «24 dic» + «→ 6 gen», `null` → `store_closures_no_next`; festività: `ToggleGroup type="single" variant="outline" size="sm"` Chiuso/Aperto con classi `SEGMENT` della preview, `aria-label` = `store_closures_toggle_label`; custom: bottone icona `Trash2Icon` con `aria-label` `store_closures_remove`. Righe festività aperte e loro data a `opacity-60`/`text-muted-foreground`. Una chiusura aggiunta senza Al ha `endDate` assente; con Al uguale a Dal salva senza `endDate`.
- [ ] **Step 2: `HoursClosuresPanel`** — stato: `hours` + `hoursBaseline` (init da prop, confronto con la `serializeOpeningHours` di `StoreForm`: esportala da `store-form.tsx` e riusala), `draft: ClosuresDraft | null` + `closuresBaseline`; query chiusure `["store-closures", storeId]` spostata dalla route (stessa normalizzazione `toYMD`), `enabled: !readOnly`; al primo dato: `splitCustomClosures(..., romeToday())`, `past` tenuto in un ref/stato e rimandato. Layout `@container` → `grid gap-x-10 gap-y-12 @5xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]`; a sinistra `FormSection` `store_hours_week_title` con l'avviso `store_form_hours_missing` se nessun giorno ha fasce + `OpeningHoursEditor` (`dayErrors = validateOpeningHours(hours)`, `readOnly`); a destra (solo `!readOnly`) `FormSection` `store_closures_title` / `store_closures_list_description` + `ClosuresList` (spinner finché carica, errore in riga come la route vecchia). Sotto la griglia `SaveBar` (solo `!readOnly`) con `onSave`, `disabled` se orari non validi. Salvataggio in sequenza: se orari cambiati `PATCH stores({storeId}) { openingHours: hours.length > 0 ? hours : null }` → `setHoursBaseline(hours)`; se chiusure cambiate `PUT closures { optOutIds, customClosures: [...past, ...draft.customClosures] }` → nuova baseline; poi invalida `["stores"]`, `["store", storeId]`, `["store-closures", storeId]`, toast `store_hours_closures_saved`; errore → toast col messaggio, le parti già salvate restano salvate.
- [ ] **Step 3:** elimina `closures-manager.tsx` e la route `store/closures.tsx`; `grep -rn "closures-manager\|/store/closures" apps/seller/src` → solo i riferimenti che il Task 7 sistema (`dashboard-actions*`, `app-breadcrumb.test.ts`).
- [ ] **Step 4:** `bunx tsc --noEmit -p apps/seller` (i soli errori ammessi sono `"/store/closures"` in `dashboard-actions.ts`, sistemati nel Task 7) e `bun run --filter @bibs/seller test`.
- [ ] **Step 5:** commit `feat(seller): orari e chiusure in un pannello con lista unica`.

### Task 5: scheda «Vendita»

**Files:**
- Create: `apps/seller/src/features/stores/components/sales-settings-panel.tsx`
- Modify: `order-types-section.tsx`, `reservation-hours-field.tsx`, `reservation-hours-field.test.tsx`, `low-stock-threshold-section.tsx` (tutti in `apps/seller/src/features/stores/components/`)
- Modify: messaggi it/en

**Interfaces:**
- Consumes: Task 1 `SaveBar`; Task 3 `OrderType`, `offeredTypes`, `isToggleLocked`.
- Produces (tutti controllati, nessuna mutation dentro):
  - `OrderTypesSection(props: { value: OrderType[]; onChange: (next: OrderType[]) => void; chargesEnabled: boolean; disabled: boolean; reservationField: ReactNode })` — righe in un riquadro `divide-y rounded-lg border` come in preview; il campo tempo annidato nella riga «Prenota» quando accesa; sotto «Paga e ritira» `StatusBadge` `success`/`CircleCheckIcon` «Pagamenti online attivi» (nuova chiave) + link «Gestisci nel profilo» a `/profile` se `chargesEnabled`, altrimenti il testo e il link di oggi (`store_order_types_pay_needs_payments` / `..._go_to_profile`); se pay acceso ma non offerto, `store_order_types_pay_account_disabled`.
  - `ReservationHoursField(props: { storeId: string; value: string; onChange: (v: string) => void; hasOpeningHours: boolean })` — via il `<form>`, il bottone e la mutation; resta l'anteprima di scadenza; il link `store_reservation_hours_add_hours` diventa `<Link to="/store" search={{ sezione: "orari" }}>`.
  - `LowStockThresholdSection(props: { value: string; onChange: (v: string) => void })` + `export function parseThreshold(raw: string): number | null` (esistente, esportato).
  - `SalesSettingsPanel(props: { storeId: string; reservationHours: number; lowStockThreshold: number; hasOpeningHours: boolean })`.

Copy nuova: `store_order_types_payments_on` «Pagamenti online attivi» / «Online payments active»; `store_order_types_manage_payments` «Gestisci nel profilo» / «Manage in your profile»; `store_sales_saved` «Impostazioni di vendita aggiornate» / «Selling settings updated».

- [ ] **Step 1: aggiorna `reservation-hours-field.test.tsx`** al nuovo contratto (`value: String(n)`, `onChange: () => {}`) senza cambiare le attese; aggiungi un caso: nessun `<button>` nell'HTML.
- [ ] **Step 2:** FAIL (props vecchie). **Step 3:** rendi controllati i tre componenti.
- [ ] **Step 4: `SalesSettingsPanel`** — query order-types `["store", storeId, "order-types"]` (come oggi); `typesDraft: OrderType[] | null` (valore mostrato `typesDraft ?? data.orderTypes`, dirty = insiemi diversi); `saved` = `{ reservationHours, lowStockThreshold }` (init da props, aggiornato dalla risposta del PATCH), `reservationDraft`/`lowStockDraft` stringhe; Salva disabilitato se `parseReservationHours` o `parseThreshold` danno `null` (con «Prenota» spenta il tempo non conta). Salvataggio: se tipologie cambiate `PATCH order-types { orderTypes }` → `setQueryData` + `setTypesDraft(null)`; se tempo o soglia cambiati un solo `PATCH stores({storeId})` con i campi cambiati; poi invalida `["stores"]`, `["store", storeId]`, `["seller", "dashboard", storeId]`; toast `store_sales_saved`. Layout: `max-w-3xl space-y-12`, `FormSection` Tipologie + `FormSection` Scorta bassa, poi `SaveBar`. Finché order-types carica: `FormSection` col solo titolo (come oggi).
- [ ] **Step 5:** test verdi, tsc pulito (salvo Task 7). Commit `feat(seller): vendita con un solo salvataggio`.

### Task 6: la pagina a schede

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/store/index.tsx`
- Modify: messaggi it/en

**Interfaces:**
- Consumes: Task 1 (`StoreForm` `hideHours/leading/extraDirty`, `EntityFormHeader bordered`), Task 4 `HoursClosuresPanel`, Task 5 `SalesSettingsPanel`.
- Produces: `Route.validateSearch` → `{ sezione?: "profilo" | "orari" | "vendita" }` (valori ignoti → assente), esportato `type StoreSection`.

Copy nuova: `store_tabs_label` «Sezioni delle impostazioni» / «Settings sections»; `store_tab_profile` «Profilo negozio» / «Store profile»; `store_tab_hours` «Orari e chiusure» / «Hours and closures»; `store_tab_sales` «Vendita» / «Selling».

- [ ] **Step 1:** `EntityFormHeader bordered={false}`, sotto un `div.overflow-x-auto` con `TabNav` (`label` `store_tabs_label`, `panelId`), schede: owner tutte e tre, dipendente `profilo` + `orari`; `sezione` assente o non permessa → `profilo`. Cambio scheda = `navigate({ search: (s) => ({ ...s, sezione }) , replace: true })`.
- [ ] **Step 2:** pannelli: `visited` = insieme delle schede già aperte (init con quella corrente); ogni pannello visitato è reso con `hidden={tab !== attivo}` e `role="tabpanel"`; chiave `activeStore.id` su ogni pannello (cambio negozio = rimonta, come oggi).
- [ ] **Step 3: Profilo** — `max-w-3xl`: `StoreForm` con `hideHours`, `readOnly={!isOwner}`, `extraDirty={newFiles.length > 0}`, `leading` = la `FormSection` Vetrina di oggi (solo owner). Togli la griglia con la colonna laterale, il link «Giorni di chiusura», la Zona di pericolo e ciò che resta inutilizzato (`Separator`, `CancelStoreDialog`, `formatPeriodEnd`, `useActiveStore().activeSubscription` se non serve più). Contenitore pagina sempre `max-w-7xl`.
- [ ] **Step 4: Orari** — `HoursClosuresPanel storeId openingHours={(store.openingHours as never) ?? []} readOnly={!isOwner}`. **Vendita** — `SalesSettingsPanel` con `store.reservationHours`, `store.lowStockThreshold`, `hasOpeningHours` (stessa espressione di oggi).
- [ ] **Step 5:** `bun run --filter @bibs/seller build` (rigenera `routeTree.gen.ts`, conferma Leaflet ok), tsc (salvo Task 7). Commit `feat(seller): impostazioni negozio in tre schede`.

### Task 7: link della home e briciole

**Files:**
- Modify: `apps/seller/src/features/dashboard/dashboard-actions.ts`, `dashboard-actions.test.ts`
- Modify: `apps/seller/src/routes/_authenticated/index.tsx` (Link delle azioni ~244)
- Modify: `apps/seller/src/components/app-breadcrumb.tsx`, `app-breadcrumb.test.ts`

**Interfaces:**
- Produces: `ActionItem.search?: { sezione: "orari" }`; `ActionHref` senza `"/store/closures"`; `hoursAction(openStatus)` senza il parametro `isOwner` (titolare e dipendente vanno entrambi alla scheda orari: il dipendente la vede in sola lettura).

- [ ] **Step 1: test** in `dashboard-actions.test.ts`: le tre azioni orari (`unknown`, `closed_holiday`, `closed`) hanno `href: "/store"` e `search: { sezione: "orari" }`; il test «dipendente → scheda negozio» si riduce a questo (niente secondo argomento). In `app-breadcrumb.test.ts` togli `"closures"` e il caso `/store/closures`.
- [ ] **Step 2:** FAIL. **Step 3:** implementa; in `index.tsx` passa `search={a.search}` al `Link` (se i tipi dell'unione `to` lo rifiutano, rendi un `Link to="/store" search={a.search}` quando `a.search` c'è). Togli `closures` da `SEGMENT_LABEL`; `input.isOwner` resta solo se usato da altre azioni.
- [ ] **Step 4:** verde; tsc **pulito**. Commit `feat(seller): la home porta alla scheda orari`.

### Task 8: pulizia e verifica

**Files:**
- Delete: `apps/seller/src/routes/_authenticated/store/preview.tsx`
- Modify: messaggi it/en

- [ ] **Step 1:** cancella la preview; per ogni chiave candidata `grep -rn "m\.<chiave>\b" apps/seller/src` e togli da it/en solo quelle a zero riferimenti: `store_closures_link`, `store_closures_subtitle`, `store_closures_holidays_title`, `store_closures_holidays_hint`, `store_closures_custom_title`, `store_closures_custom_hint`, `store_closures_empty_custom`, `store_closures_save`, `store_closures_saving`, `store_closures_saved`, `store_danger_*`, `store_delete_*`, `store_order_types_saved`, `store_reservation_hours_save`, `store_reservation_hours_saved`, `store_low_stock_save`, `store_low_stock_saved`, `shell_crumb_closures`, `store_form_hours_description` (se la creazione non la usa più).
- [ ] **Step 2:** `bun run typecheck`, `bunx biome check apps/seller`, `bun run --filter @bibs/seller test`, `bun run --filter @bibs/seller build`: tutti a exit 0 (controlla l'exit del workspace, non l'aggregato).
- [ ] **Step 3: smoke nel browser** (api :3000, seller :3002, `seller@dev.bibs`), chiaro e scuro, 1440 e 390 px: tre schede e deep link `?sezione=orari`; modifica orari → vai in Vendita → torna: modifica ancora lì; salva orari+chiusure (aggiungi «Ferie» con Dal/Al, apri una festività) e ricarica; Vendita: spegni/accendi tipologie, cambia tempo e soglia, un solo Salva; Profilo: aggiungi solo una foto → Salva abilitato e caricata; home → azione orari porta alla scheda; nessun link porta più a `/store/closures`.
- [ ] **Step 4:** commit `chore(seller): via l'anteprima e le chiavi non più usate`.
