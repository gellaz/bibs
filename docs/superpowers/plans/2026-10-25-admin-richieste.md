# Pagina «Richieste» dell'admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gli admin vedono e decidono in una pagina «Richieste» candidature, cambi partita IVA e cambi documento, ricevono un'email a ogni nuova richiesta, e durante un cambio partita IVA il venditore non riceve davvero nuovi ordini (può annullare la richiesta).

**Architecture:** Il blocco ordini entra nella regola unica `offeredOrderTypes` (carrello, checkout, seller), con il carrello che segna «non disponibili» le righe dei negozi senza modalità (chiude anche il n. 19 dell'audit). L'admin ottiene un nuovo gruppo di route `/admin/requests` (lista unificata in memoria, conteggi, dettaglio di una richiesta di modifica); approvazione e rifiuto restano le route `seller-changes` esistenti. Le email sono best-effort, sul modello di `onboarding-notifications.ts`.

**Tech Stack:** Elysia + Drizzle (Bun, Postgres), react-email (`@bibs/emails`), TanStack Start/Router/Query + Base UI (`@bibs/ui`), Paraglide, bun test (api), Vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-10-25-admin-richieste-design.md`

## Global Constraints

- Testi nuovi in `messages/it.json` **e** `messages/en.json` dell'app che li usa (Paraglide `m.*`), sia lato admin sia lato seller.
- Badge di stato al singolare, schede e filtri al plurale («Candidature», «Partita IVA», «Documento» come schede; «In attesa» come badge).
- Errori di servizio: `new ServiceError(status, "messaggio in italiano")`, mai codici custom.
- Schemi di route con union esplicite di `t.Literal(...)`, mai union costruite con `.map()` (Eden le tipizza `never`).
- Toast da `@bibs/ui/components/sonner`, mai da `sonner`.
- Stati come `varchar({ enum })` + CHECK, non `pgEnum`; migrazione con `bun run db:generate` (mai `db:push`).
- `routeTree.gen.ts` delle app si committa insieme alle route nuove.
- Pagine con TanStack Table: colonne definite fuori dal componente o in `useMemo`, e `"use no memo"` dove vive lo stato della tabella, come in `apps/admin/src/routes/_authenticated/sellers/index.tsx`.
- `ADMIN_APP_URL` opzionale, default `http://localhost:3003`.
- Motivo del rifiuto: obbligatorio nella UI admin, massimo 500 caratteri (lo stesso limite dell'API).
- Test di integrazione dell'API: servono Docker e `bun run test` da `apps/api` (`bun test` da solo salta `--isolate`).

## Review Focus

1. Link vecchio: un admin apre dall'email una richiesta già decisa o annullata → la pagina mostra «non più in attesa», senza bottoni (Task 6: test sul dettaglio di una richiesta `cancelled`; Task 8: rendering senza azioni).
2. Due admin decidono la stessa richiesta → il secondo riceve 400 «La richiesta di modifica non è più in attesa», vede il messaggio e la pagina si ricarica (Task 8).
3. Il titolare annulla mentre un admin approva → vince chi arriva primo; l'altro riceve «non più in attesa», e il flag di blocco resta coerente con l'esito (Task 3: test di annullamento su una richiesta già approvata).
4. Carrello con un negozio bloccato e un altro no → il cliente ordina dall'altro senza errori (Task 1: test di checkout).
5. Richiesta approvata → gli ordini ripartono subito: le righe del carrello tornano «ok» (Task 3: test dopo `approveChange`).

---

### Task 1: Blocco ordini nella regola unica e righe non disponibili nel carrello

**Files:**
- Modify: `apps/api/src/lib/order-types.ts`
- Modify: `apps/api/src/modules/customer/services/cart.ts` (select ~riga 165, `issue` ~riga 218, `offeredOrderTypes` ~riga 235)
- Modify: `apps/api/src/modules/customer/services/checkout.ts` (select ~riga 69, controllo ~riga 99)
- Modify: `apps/api/src/modules/seller/services/order-types.ts`
- Modify: `apps/api/src/lib/schemas/entities.ts` (`StoreOrderTypesSchema` ~riga 1374)
- Test: `apps/api/tests/lib/order-types.test.ts`, `apps/api/tests/integration/customer-cart.test.ts`, `apps/api/tests/integration/customer-checkout.test.ts`, `apps/api/tests/integration/seller-store-order-types.test.ts`

**Interfaces:**
- Produces: `offeredOrderTypes(configured: readonly string[], opts: { chargesEnabled: boolean; vatChangeBlocked: boolean }): StoreOrderType[]`; il flag è **obbligatorio**, così il typecheck trova ogni chiamante.
- Produces: `sellerVatChangeBlockedSql`: campo SELECT `sql<boolean>` alias `seller_vat_change_blocked`, letto da `seller_profiles.vat_change_blocked` via `stores.seller_profile_id`, con nomi letterali qualificati come `sellerChargesEnabledSql`.
- Produces: `StoreOrderTypesSchema` acquista `vatChangeBlocked: t.Boolean()`; `getStoreOrderTypes`/`updateStoreOrderTypes` lo restituiscono.

- [ ] **Step 1: Test unitari della regola** in `tests/lib/order-types.test.ts`: aggiorna le chiamate esistenti con `vatChangeBlocked: false` e aggiungi
  `it("con un cambio partita IVA in attesa non offre niente")`: `offeredOrderTypes(both, { chargesEnabled: true, vatChangeBlocked: true })` → `[]`.
- [ ] **Step 2: Test del carrello** in `customer-cart.test.ts`:
  - `it("segna non disponibili le righe di un venditore con cambio partita IVA in attesa")`: venditore con `vatChangeBlocked = true` (update diretto su `sellerProfile`) → il gruppo ha `store.orderTypes` `[]` e ogni riga `issue: "unavailable"`; le righe di un secondo negozio restano `"ok"`.
  - `it("segna non disponibili le righe di un negozio senza modalità d'acquisto")`: negozio con solo `pay_pickup` e venditore senza incassi abilitati → righe `"unavailable"` (è il n. 19).
- [ ] **Step 3: Test del checkout** in `customer-checkout.test.ts`:
  - `it("rifiuta un ordine per un venditore con cambio partita IVA in attesa")` → `ServiceError` 400 «… non offre questa modalità d'acquisto», nessun ordine scritto;
  - `it("ordina dagli altri negozi del carrello quando uno è bloccato")` → checkout del solo negozio non bloccato riesce.
- [ ] **Step 4: Test seller** in `seller-store-order-types.test.ts`: con il flag acceso `getStoreOrderTypes` restituisce `vatChangeBlocked: true` e `offeredOrderTypes: []`; `updateStoreOrderTypes` salva lo stesso un cambio di tipologie.
- [ ] **Step 5: Verifica RED** — `cd apps/api && bun test tests/lib/order-types.test.ts` → FAIL; integrazione (`bun run test`) → FAIL sui test nuovi.
- [ ] **Step 6: Implementa.**
  - `offeredOrderTypes` restituisce `[]` se `vatChangeBlocked`.
  - Carrello: aggiungi `sellerVatChangeBlocked: sellerVatChangeBlockedSql` al select, calcola le modalità offerte **prima** di `issue` e aggiungi la condizione «nessuna modalità → `"unavailable"`».
  - Checkout: stesso campo nel select, passato alla regola.
  - Seller: `view(orderTypes, chargesEnabled, vatChangeBlocked)` legge il flag di `sellerProfile`. Il controllo di salvataggio «Deve restare almeno una tipologia…» chiama la regola con `vatChangeBlocked: false`, con un commento di una riga sul perché (spec §3, lato seller).
- [ ] **Step 7: Verifica GREEN** — `bun run typecheck` e `bun run test` da `apps/api` → tutto verde.
- [ ] **Step 8: Commit** — `fix(api): blocco ordini durante il cambio partita IVA e righe non disponibili nel carrello`

### Task 2: Via `POST /customer/orders`

**Files:**
- Modify: `apps/api/src/modules/customer/routes/orders.ts` (route `.post("/orders", …)` righe ~22-86 e import non più usati)
- Modify: `apps/api/tests/integration/customer-orders-pay-types.test.ts` (togli i casi che chiamano la route via `app.handle`; restano i test di `createOrder`)
- Modify: le righe di README, `apps/api/AGENTS.md` e `docs/architecture.md` che citano l'endpoint (grep `POST /customer/orders` e `"/orders"`)

**Interfaces:**
- Consumes: niente. `createOrder` resta: lo usano seed e test.

- [ ] **Step 1:** cancella la route e i test che la chiamano. Nessuna app la usa (n. 14 dell'audit), e non legge le modalità del negozio, quindi aggirerebbe il blocco del Task 1.
- [ ] **Step 2:** `bun run typecheck` e `bun run test` da `apps/api` → verdi; `grep -rn "customer.orders.post" apps/*/src` → nessun risultato.
- [ ] **Step 3: Commit** — `fix(api): via POST /customer/orders, senza chiamanti e senza controllo sulle modalità`

### Task 3: Ciclo di vita della richiesta: annullamento e partita IVA già presa

**Files:**
- Modify: `apps/api/src/db/schemas/seller-profile-change.ts` (`changeStatuses` aggiunge `"cancelled"`; CHECK `seller_profile_change_status_valid`)
- Create: migrazione generata in `apps/api/src/db/migrations/`
- Modify: `apps/api/src/modules/seller/services/settings.ts` (nuova `cancelSellerChange`)
- Modify: `apps/api/src/modules/seller/routes/settings.ts` (nuova route)
- Modify: `apps/api/src/modules/admin/services/sellers.ts` (`approveChange`, ramo `vat`)
- Modify: `apps/api/src/lib/schemas/entities.ts` (lo status di `SellerProfileChangeSchema` accetta `cancelled`)
- Test: `apps/api/tests/integration/seller-settings-change-requests.test.ts`, `apps/api/tests/integration/admin-sellers.test.ts`

**Interfaces:**
- Produces: `cancelSellerChange(params: { sellerProfileId: string; changeId: string }): Promise<SellerProfileChange>`: update `pending → cancelled` con `WHERE id AND seller_profile_id AND status = 'pending'` e `.returning()`. Nessuna riga → `ServiceError(400, "La richiesta di modifica non è più in attesa")`. Se il tipo è `vat`, azzera `vatChangeBlocked` nella stessa transazione.
- Produces: route `PATCH /seller/settings/changes/:changeId/cancel` (solo titolare, `requireOwner` come la route `/vat`) → `okRes(SellerProfileChangeSchema)`.

- [ ] **Step 1: Test annullamento** in `seller-settings-change-requests.test.ts`:
  - `it("annulla una richiesta di partita IVA e toglie il blocco")` → status `cancelled`, `vatChangeBlocked` false, partita IVA invariata;
  - `it("dopo l'annullamento accetta una nuova richiesta")`;
  - `it("non annulla una richiesta già approvata")` → 400, status resta `approved`;
  - `it("non annulla la richiesta di un altro venditore")` → 400.
- [ ] **Step 2: Test approvazione** in `admin-sellers.test.ts`:
  - `it("approveChange risponde 409 se la partita IVA è stata presa nel frattempo")` → `ServiceError` 409 «Questa partita IVA è già registrata da un altro venditore», richiesta ancora `pending`;
  - `it("dopo l'approvazione il carrello torna ordinabile")` → righe del venditore `issue: "ok"` (Review Focus 5).
- [ ] **Step 3: RED** — `bun run test` da `apps/api` → FAIL sui nuovi.
- [ ] **Step 4: Implementa.** Aggiungi `"cancelled"` a `changeStatuses` e al CHECK, poi `bun run db:generate` e controlla che lo SQL generato sostituisca solo il CHECK. In `approveChange`, ramo `vat`: prima dell'update di `organization`, cerca un'altra organization con la stessa `vatNumber` e, se c'è, lancia il 409 (stesso messaggio di `requestVatChange`).
- [ ] **Step 5: GREEN** — `bun run db:migrate` sul DB locale, poi `bun run typecheck` e `bun run test` da `apps/api`.
- [ ] **Step 6: Commit** — `feat(api): il titolare annulla una richiesta di modifica in attesa`

### Task 4: Template email

**Files:**
- Create: `packages/emails/emails/admin-new-request-email.tsx`, `packages/emails/emails/seller-change-outcome-email.tsx`
- Modify: `packages/emails/src/index.tsx` (render + export dei tipi)
- Test: `packages/emails/tests/request-emails.test.tsx`

**Interfaces:**
- Produces: `renderAdminNewRequestEmail(props: { kind: "candidature" | "vat" | "document"; sellerName: string; requestUrl: string }): Promise<RenderedEmail>`. Oggetto, testo esatto: candidature «Nuova candidatura venditore su bibs», vat «Nuova richiesta di cambio partita IVA», document «Nuova richiesta di cambio documento».
- Produces: `renderSellerChangeOutcomeEmail(props: { firstName: string | null; changeType: "vat" | "document"; approved: boolean; reason: string | null }): Promise<RenderedEmail>`. Oggetto: approvata «La tua richiesta di modifica su bibs è stata approvata», rifiutata «La tua richiesta di modifica su bibs non è stata approvata». Nel rifiuto mostra «Motivo: …» come `seller-rejected-email.tsx`.

- [ ] **Step 1: Test** (stile `seller-onboarding-emails.test.tsx`, con `normalize()` per i commenti `<!-- -->`): oggetto per ogni `kind`; il link `requestUrl` nell'HTML; esito approvato senza «Motivo»; esito rifiutato con «Motivo: Numero non valido»; saluto neutro con `firstName: null`.
- [ ] **Step 2: RED** — `cd packages/emails && bun test` → FAIL.
- [ ] **Step 3: Implementa** i due template (con `PreviewProps`, `greeting()`, `lang="it"`) e i due render.
- [ ] **Step 4: GREEN** — `bun test` e `bun run typecheck` in `packages/emails`.
- [ ] **Step 5: Commit** — `feat(emails): email per nuove richieste agli admin ed esito al venditore`

### Task 5: Invio delle email (admin e venditore)

**Files:**
- Modify: `apps/api/src/lib/env.ts` (`ADMIN_APP_URL` opzionale nello schema, default `http://localhost:3003`)
- Create: `apps/api/src/lib/admin-notifications.ts`
- Modify: `apps/api/src/modules/seller/services/onboarding.ts` (i due punti che chiamano `notifyApplicationReceived`, righe ~163 e ~213)
- Modify: `apps/api/src/modules/seller/services/settings.ts` (`requestVatChange`, `requestDocumentChange`, dopo il commit)
- Modify: `apps/api/src/modules/seller/services/onboarding-notifications.ts` (nuova `notifySellerChangeDecided`)
- Modify: `apps/api/src/modules/admin/services/sellers.ts` (`approveChange`, `rejectChange`, dopo il commit)
- Modify: `apps/api/AGENTS.md` (elenco delle variabili d'ambiente: `ADMIN_APP_URL`)
- Test: `apps/api/tests/integration/request-notifications.test.ts`

**Interfaces:**
- Consumes: i render del Task 4.
- Produces: `notifyAdminsNewRequest(params: { kind: "candidature" | "vat" | "document"; sellerProfileId: string; changeId?: string }): Promise<void>`. Destinatari: `user.role = 'admin'` e non bannati, un `sendEmail` per admin. Link: candidature → `${ADMIN_APP_URL}/sellers/${sellerProfileId}`, altrimenti `${ADMIN_APP_URL}/requests/${changeId}`. Non lancia mai: un errore finisce nel log, come `notifySeller`.
- Produces: `notifySellerChangeDecided(params: { sellerProfileId: string; changeType: "vat" | "document"; approved: boolean; reason: string | null }): Promise<void>`, con lo stesso contratto di `notifySeller`.

- [ ] **Step 1: Test** con `@/lib/email` mockato (`sendEmail` finto che registra le chiamate) e due admin, di cui uno bannato:
  - `requestVatChange` → una sola email, all'admin non bannato, con il link `/requests/<id>`;
  - fine onboarding (`pending_review`) → email agli admin con link `/sellers/<id>`;
  - nessun admin → nessun errore;
  - `sendEmail` che lancia → la richiesta resta creata;
  - `rejectChange` con motivo → email al titolare con «Motivo»; `approveChange` → email «approvata».
- [ ] **Step 2: RED** — `bun run test` da `apps/api` → FAIL.
- [ ] **Step 3: Implementa** e collega le chiamate dopo il commit.
- [ ] **Step 4: GREEN** — `bun run typecheck` e `bun run test` da `apps/api`.
- [ ] **Step 5: Commit** — `feat(api): email agli admin per ogni nuova richiesta e al venditore per l'esito`

### Task 6: Route admin `/admin/requests`

**Files:**
- Create: `apps/api/src/modules/admin/services/requests.ts`, `apps/api/src/modules/admin/routes/requests.ts`
- Modify: `apps/api/src/modules/admin/index.ts` (`.use(requestsRoutes)`)
- Modify: `apps/api/src/lib/schemas/composed.ts` (schemi nuovi)
- Test: `apps/api/tests/integration/admin-requests.test.ts`

**Interfaces:**
- Produces: `GET /admin/requests?type=all|candidature|vat|document&page&limit` → `okPageRes(AdminRequestRowSchema)`:
  ```ts
  AdminRequestRowSchema = t.Object({
    kind: t.Union([t.Literal("candidature"), t.Literal("vat"), t.Literal("document")]),
    id: t.String(),                    // changeId; per le candidature il sellerProfileId
    sellerProfileId: t.String(),
    seller: t.Object({ name: t.Nullable(t.String()), email: t.String() }),
    businessName: t.Nullable(t.String()),
    currentValue: t.Nullable(t.String()),   // vat: P.IVA attuale; document: numero attuale
    requestedValue: t.Nullable(t.String()), // vat: P.IVA richiesta; document: numero richiesto
    submittedAt: t.Date(),             // change.createdAt; candidature: sellerProfile.updatedAt
  })
  ```
  Ordine `submittedAt` crescente. La lista unisce le due fonti in memoria e pagina dopo l'ordinamento, con un commento `ponytail:` (carica tutte le richieste in attesa: va bene fino a qualche centinaio; oltre, serve una UNION in SQL).
- Produces: `GET /admin/requests/counts` → `okRes(t.Object({ total, candidature, vat, document }))`, tutti `t.Number()`.
- Produces: `GET /admin/requests/changes/:changeId` → `okRes(AdminChangeDetailSchema)`:
  ```ts
  DocumentSnapshot = t.Object({
    documentType: <il literal union dei tipi documento già usato in entities.ts:224>,
    documentNumber: t.Nullable(t.String()),
    documentExpiry: t.Nullable(t.String()),
    issuedMunicipality: t.Nullable(t.Object({ name: t.String(), provinceAcronym: t.String() })),
    imageUrl: t.Nullable(t.String()),
  })
  AdminChangeDetailSchema = t.Object({
    id: t.String(),
    changeType: t.Union([t.Literal("vat"), t.Literal("document")]),
    status: t.Union([t.Literal("pending"), t.Literal("approved"), t.Literal("rejected"), t.Literal("cancelled")]),
    createdAt: t.Date(),
    seller: t.Object({ id: t.String(), name: t.Nullable(t.String()), email: t.String(), businessName: t.Nullable(t.String()) }),
    vat: t.Nullable(t.Object({ current: t.Nullable(t.String()), requested: t.String() })),
    document: t.Nullable(t.Object({ current: DocumentSnapshot, requested: DocumentSnapshot })),
  })
  ```
  Per il documento richiesto senza foto nuova, `requested.imageUrl` è quella attuale (l'approvazione non la cambia). Richiesta inesistente → 404 «Richiesta di modifica non trovata».

- [ ] **Step 1: Test dei servizi:**
  - lista con un candidato, una richiesta vat e una document, in ordine di `submittedAt`;
  - filtro `type=vat`;
  - una richiesta `rejected` o `cancelled` non compare;
  - conteggi coerenti con la lista;
  - dettaglio vat (attuale e richiesta), dettaglio document con il comune risolto;
  - dettaglio di una richiesta `cancelled` → `status: "cancelled"` (Review Focus 1);
  - 404.
- [ ] **Step 2: Test delle route** (montando `requestsRoutes` come fanno i test `*-routes`): 200 con le forme dello schema; `type=foo` → 422.
- [ ] **Step 3: RED** — `bun run test` da `apps/api` → FAIL.
- [ ] **Step 4: Implementa.** Riusa le `with` di `listPendingChanges` per comuni e organization; per le candidature usa la stessa condizione di `countSellersByStatus` (`pending_review`).
- [ ] **Step 5: GREEN** — `bun run typecheck` e `bun run test` da `apps/api`; poi `bun run typecheck` in `apps/admin` (i tipi Eden si aggiornano).
- [ ] **Step 6: Commit** — `feat(api): route admin per la lista, i conteggi e il dettaglio delle richieste`

### Task 7: Admin: pagina «Richieste», numero nel menu e card in dashboard

**Files:**
- Create: `apps/admin/src/routes/_authenticated/requests/index.tsx`
- Create: `apps/admin/src/features/requests/use-request-counts.ts`
- Modify: `apps/admin/src/components/app-sidebar.tsx`
- Modify: `apps/admin/src/routes/_authenticated/index.tsx`
- Modify: `apps/admin/src/components/seller-moderation-dialog.tsx` (invalidazione)
- Modify: `apps/admin/messages/it.json`, `apps/admin/messages/en.json`, `apps/admin/src/routeTree.gen.ts`
- Test: `apps/admin/src/features/requests/use-request-counts.test.ts`

**Interfaces:**
- Consumes: le route del Task 6 via `api().admin.requests…`.
- Produces: `requestCountsQuery = queryOptions({ queryKey: ["admin-requests", "counts"], queryFn })`. Tutte le query della pagina stanno sotto il prefisso `["admin-requests"]`, che approvazione, rifiuto e moderazione invalidano.

- [ ] **Step 1: Test** `use-request-counts.test.ts`: `requestCountsQuery.queryKey` inizia con `"admin-requests"`. È la chiave che invalidano dialog e dettaglio; con una chiave diversa il badge resterebbe vecchio.
- [ ] **Step 2: RED → implementa → GREEN** (`bun run test` in `apps/admin`).
- [ ] **Step 3: Menu.** Voce «Richieste» (icona `InboxIcon`) subito dopo «Venditori», con `SidebarMenuBadge` che mostra `counts.total` solo se > 0.
- [ ] **Step 4: Pagina `/requests`.**
  - Search param `type` (default `all`), con `TabNav` e badge per scheda dai conteggi.
  - `DataTable` con le colonne: venditore (`displayName(seller)`, `businessName` sotto), tipo, cosa cambia (`currentValue → requestedValue`; per le candidature «Nuovo venditore»), in attesa da (data relativa).
  - Click sulla riga: candidature → `/sellers/$sellerId`, altrimenti `/requests/$changeId`.
  - `DataTableFooter` per la paginazione, `EmptyState` per scheda (per «Documento»: nessuna richiesta, perché il form arriva dopo).
- [ ] **Step 5: Dashboard.** Card «Richieste in attesa» con `counts.total` e link a `/requests`.
- [ ] **Step 6: Moderazione.** In `useSellerModeration` aggiungi `invalidateQueries({ queryKey: ["admin-requests"] })` accanto a quelle esistenti.
- [ ] **Step 7: Verifica** — `bun run typecheck`, `bun run test`, `bunx biome check` in `apps/admin`. Prova nel browser (`:3003`) con mouse e tastiera: schede, click sulle righe, badge.
- [ ] **Step 8: Commit** — `feat(admin): pagina Richieste con numero nel menu e card in dashboard`

### Task 8: Admin: dettaglio di una richiesta di modifica

**Files:**
- Create: `apps/admin/src/routes/_authenticated/requests/$changeId.tsx`
- Create: `apps/admin/src/features/requests/reject-change-dialog.tsx`
- Modify: `apps/admin/messages/it.json`, `apps/admin/messages/en.json`, `apps/admin/src/routeTree.gen.ts`

**Interfaces:**
- Consumes: `GET /admin/requests/changes/:changeId` (Task 6); le `PATCH /admin/sellers/changes/:changeId/approve|reject` esistenti.

- [ ] **Step 1: Pagina.**
  - Intestazione con venditore, tipo e data, più il link «Scheda venditore» → `/sellers/$sellerId`.
  - Due colonne «Attuale» e «Richiesto». Per vat: i due numeri. Per document: tipo, numero, scadenza, comune di rilascio, foto (immagine cliccabile).
  - `status !== "pending"` → avviso «Questa richiesta non è più in attesa» e nessun bottone (Review Focus 1).
- [ ] **Step 2: Azioni.**
  - «Approva» con conferma; «Rifiuta» apre `RejectChangeDialog` (textarea obbligatoria, `maxLength` 500, bottone disabilitato se vuota).
  - Successo: toast, invalida `["admin-requests"]` e `["admin-sellers"]`, torna a `/requests`.
  - Errore 400 «non più in attesa»: mostra il messaggio dell'API, chiudi la finestra e ricarica il dettaglio (Review Focus 2).
  - Errore 409 «partita IVA già registrata»: mostra il messaggio, la richiesta resta aperta, l'admin può rifiutarla.
- [ ] **Step 3: Verifica** — `bun run typecheck`, `bun run test`, `bunx biome check` in `apps/admin`. Nel browser, con mouse e tastiera: approva, rifiuta senza motivo (bottone spento), rifiuta con motivo, link di una richiesta già decisa.
- [ ] **Step 4: Commit** — `feat(admin): dettaglio di una richiesta con approva e rifiuta`

### Task 9: Seller: richiesta in attesa, annullamento e testi veri

**Files:**
- Modify: `apps/seller/src/features/profile/components/business-info-card.tsx`
- Modify: `apps/seller/src/features/profile/components/vat-change-dialog.tsx`
- Create: `apps/seller/src/features/profile/components/pending-vat-change.tsx`
- Modify: `apps/seller/src/components/order-types-sidebar-card.tsx`, `apps/seller/src/features/stores/lib/order-types.ts`
- Modify: `apps/seller/messages/it.json`, `apps/seller/messages/en.json`
- Test: `apps/seller/src/features/stores/lib/order-types.test.ts` (crea o estendi)

**Interfaces:**
- Consumes: `pendingChanges` di `GET /seller/settings` (via `useSellerSettings`); `PATCH /seller/settings/changes/:changeId/cancel` (Task 3); `vatChangeBlocked` di `StoreOrderTypesSchema` (Task 1).
- Produces: `offeredTypes(draft: OrderType[], chargesEnabled: boolean, vatChangeBlocked: boolean): OrderType[]` nella copia frontend; restituisce `[]` se bloccato. `isToggleLocked` resta senza flag, perché il salvataggio non lo considera.

- [ ] **Step 1: Test** `offeredTypes(["reserve_pickup","pay_pickup"], true, true)` → `[]`; senza blocco, risultati invariati.
- [ ] **Step 2: RED → implementa → GREEN** (`bun run test` in `apps/seller`).
- [ ] **Step 3: Profilo.** Con una `pendingChanges` di tipo `vat`, al posto del bottone «Richiedi cambio» compare `PendingVatChange`:
  - la partita IVA richiesta;
  - il badge «In attesa»;
  - il testo «Cambio partita IVA in attesa di approvazione: i tuoi negozi non ricevono nuovi ordini finché non viene approvato.»;
  - il bottone «Annulla richiesta», con conferma, che invalida `["seller","settings"]` e mostra un toast;
  - con un errore 400 «non più in attesa», mostra il messaggio e ricarica.
- [ ] **Step 4: Testi della finestra.** `profile_vat_description` diventa «La modifica richiede l'approvazione di un amministratore. Finché non viene decisa, i tuoi negozi non ricevono nuovi ordini.»; `profile_vat_request_sent` diventa «Richiesta inviata. Ti scriveremo appena un amministratore l'avrà decisa.». Aggiorna anche l'inglese.
- [ ] **Step 5: Card tipologie.** Con `vatChangeBlocked`, la card «cosa vede il cliente» mostra l'avviso «Nuovi ordini bloccati finché il cambio partita IVA non è approvato» e passa il flag a `offeredTypes`.
- [ ] **Step 6: Verifica** — `bun run typecheck`, `bun run test`, `bunx biome check` in `apps/seller`. Nel browser (`:3002`): richiesta, stato in attesa, annullamento, card tipologie, con mouse e tastiera.
- [ ] **Step 7: Commit** — `feat(seller): cambio partita IVA in attesa, annullamento e blocco ordini visibile`

### Task 10: Chiusura

- [ ] **Step 1:** dalla root `bun run typecheck`, `bun run lint`, `bun run test` (controlla l'exit code di ogni workspace: l'aggregato di `bun --filter` può nasconderli).
- [ ] **Step 2:** prova completa di Marco nel browser: il venditore chiede il cambio → arriva l'email agli admin (Mailpit `:8025`) → il badge sale → il carrello del cliente segna «non disponibile» → l'admin approva → arriva l'email al venditore → il carrello torna ordinabile. Poi la stessa cosa con un rifiuto e con un annullamento.
- [ ] **Step 3:** in `docs/audit/2026-10-11-ponytail-audit.md` nessuna modifica (resta la foto del 2026-10-11); nella PR cita i n. 6, 19 e la parte di 14 chiusa (`POST /customer/orders`).
