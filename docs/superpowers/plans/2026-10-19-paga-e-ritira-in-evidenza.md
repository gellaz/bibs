# «Paga e ritira» in evidenza — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il titolare scopre che deve attivare i pagamenti online (banner giallo su ogni pagina), li gestisce solo dalla scheda Vendita, e tutti vedono in sidebar come comprano i clienti nel negozio attivo; `warning` diventa giallo Segnale.

**Architecture:** Due PR in fila. PR1 (`feat/ui-warning-giallo`, da `main`): nuovi valori di `--warning` + `--warning-foreground` in `packages/ui` e migrazione dei componenti che scrivono testo `text-warning`. PR2 (`feat/paga-e-ritira-in-evidenza`, già creato, contiene spec e piano): una riga di API (`GET order-types` aperto ai dipendenti assegnati), una feature seller `online-payments` (banner + riquadro in Vendita, via la card dal Profilo) e un riquadro in sidebar che legge la stessa query della scheda Vendita.

**Tech Stack:** Bun, Elysia + Drizzle (`apps/api`, `bun test`), TanStack Start/Router/Query + paraglide (`apps/seller`, Vitest), Tailwind v4 + shadcn (`packages/ui`).

**Spec:** `docs/superpowers/specs/2026-10-19-paga-e-ritira-in-evidenza-design.md`

## Global Constraints

- Giallo Segnale: `--warning` = `oklch(0.92 0.14 100)` chiaro / `oklch(0.37 0.08 95)` scuro; `--warning-foreground` = `var(--dusk)` chiaro / `var(--cream)` scuro. Bordo, se serve, `border-warning-foreground/15`. Il testo su `warning` è sempre `text-warning-foreground`, mai `text-warning`.
- Componenti solo con token semantici (`warning`, `success`, `muted-foreground`…), mai nomi di palette (DESIGN.md, Semantic Token Rule).
- Toast solo da `@bibs/ui/components/sonner`, mai da `sonner`.
- Ogni testo visibile passa da paraglide `m.*`, con la chiave in `apps/seller/messages/it.json` **e** `en.json`. In inglese «Paga e ritira» è «Pay and pick up» (`orders_type_pay_pickup`).
- Banner: solo titolare; mai sulla scheda Vendita (`/store?sezione=vendita`); la X lo nasconde per **7 giorni** su quel computer (`localStorage`, ogni accesso in try/catch, se lo storage manca il banner si vede); se lo stato Stripe cambia, ricompare subito.
- Sidebar: mostra `offeredOrderTypes` (non `orderTypes`) del negozio attivo; la vedono tutti; è un link a Vendita solo per il titolare; nascosta con la sidebar a icone.
- Mai commit su `main`. Conventional Commits con scope (`ui`, `admin`, `seller`, `api`). `gh pr create` lo lancia Marco: prepara il body in un file nello scratchpad e passagli il comando `! gh pr create … --body-file <file>`.
- Seller alias `@/` → `apps/seller/src`. Seller dev su `:3002`.
- Test seller: `cd apps/seller && bun run test <file>` (il `pretest` compila paraglide). Test API: `cd apps/api && bun run test:unit` / `bun run test:integration`, mai `bun test` nudo.

## Review Focus

1. **Storage che lancia o è corrotto** (navigazione privata, JSON rotto): il banner si vede e niente si rompe. → test in Task 3.
2. **Dipendente**: niente banner, sidebar visibile ma non cliccabile, nessun 403 in console dalla sidebar. → test in Task 3 (stato assente → niente banner) e Task 5 (niente link).
3. **«Paga e ritira» configurato ma account non più abilitato**: la sidebar dice «spento», il riquadro in Vendita dice che i clienti non lo vedono. → test in Task 4 e Task 5.
4. **Stripe passa ad «abilitato» mentre il titolare è su Vendita** (polling): lo switch si sblocca senza ricaricare, perché la query delle tipologie si rilegge. → test in Task 4.
5. **Cambio negozio attivo**: la sidebar mostra le tipologie del nuovo negozio, non quelle vecchie. → test in Task 5.

---

## PR1 — `warning` giallo

### Task 1: `warning` giallo nel design system

**Files:**
- Modify: `packages/ui/src/styles/globals.css` (`:root` ~riga 64-69 commento + `--warning`; `.dark` ~riga 179; `@theme` ~riga 222)
- Modify: `packages/ui/src/components/button.tsx:26-27` (variante `warning`)
- Modify: `packages/ui/src/components/dropdown-menu.tsx:78` (voce `data-[variant=warning]`)
- Modify: `packages/ui/src/components/alert-dialog.tsx:20-23` (media `warning`)
- Modify: `apps/seller/src/features/products/components/bulk-stock-adjust-dialog.tsx:245-249` (avviso «zero»)
- Modify: `DESIGN.md` (frontmatter riga 24; voce **Warning** ~riga 296; nota ~riga 544)

**Interfaces:**
- Produces: utility Tailwind `bg-warning`, `text-warning-foreground`, `border-warning-foreground/15` usate da Task 3 e Task 4.

- [ ] **Step 1: Branch**

```bash
git switch -c feat/ui-warning-giallo main
```
(Le modifiche locali della preview, `routes/pagamenti-preview.tsx` e `routeTree.gen.ts`, restano nel working tree: non vanno mai aggiunte.)

- [ ] **Step 2: Token.** In `globals.css`: `--warning` ai valori dei Global Constraints in `:root` e `.dark`; nuovo `--warning-foreground` (`var(--dusk)` / `var(--cream)`) accanto, come `--destructive-foreground`; `--color-warning-foreground: var(--warning-foreground);` in `@theme` dopo `--color-warning`. Riscrivi il commento sopra `--warning`: giallo da fondo, ruolo «cautela / c'è da fare qualcosa, non è un errore», tonalità 95–100 distinta dal saffron (75), testo sempre `warning-foreground`. Aggiorna la riga 86 del commento (warning non regge più AA come testo).

- [ ] **Step 3: Componenti.**
  - `button.tsx` variante `warning`: `bg-warning text-warning-foreground hover:bg-warning/80 focus-visible:border-warning-foreground/40 focus-visible:ring-warning-foreground/20`; aggiorna il commento righe 21-22 (warning non è più soft).
  - `dropdown-menu.tsx`: a riposo la voce `warning` ha il testo normale (togli `data-[variant=warning]:text-warning` e `*:[svg]:text-warning`); evidenziata `data-[variant=warning]:focus:bg-warning data-[variant=warning]:focus:text-warning-foreground data-[variant=warning]:focus:*:[svg]:text-warning-foreground` (via le varianti `/10`, `/20`).
  - `alert-dialog.tsx` media `warning`: `className: "bg-warning text-warning-foreground"`.
  - `bulk-stock-adjust-dialog.tsx`: contenitore `border-warning-foreground/15 bg-warning text-warning-foreground`, icona senza `text-warning` (eredita).

- [ ] **Step 4: `DESIGN.md`.** Frontmatter: `warning: "oklch(0.92 0.14 100)"` e nuova riga `warning-foreground: "{colors.dusk}"` (stessa sintassi di riferimento usata da `textColor` più sotto). Voce **Warning**: nuovi valori chiaro/scuro, colore da fondo con testo `warning-foreground`, ruolo esteso ai banner «c'è da fare qualcosa», tonalità oltre il saffron. Riga ~544: «Warning is not a status tone (it stays on caution buttons and to-do banners)».

- [ ] **Step 5: Verifica statica**

Run: `bun run typecheck && bun run lint`
Expected: exit 0 per ogni workspace (controlla l'exit di ognuno: l'aggregato può nascondere fallimenti).

- [ ] **Step 6: Verifica visiva + contrasto.** Avvia admin (`bun run dev:admin`, :3003) e seller (:3002 già acceso). Con Chrome DevTools MCP in `isolatedContext`, guarda in chiaro **e** scuro ogni consumatore di `variant="warning"`: `grep -rn 'variant="warning"\|variant: "warning"' apps/ packages/ui/src` (azioni riga prodotto, barra azioni di massa prodotti, annulla abbonamento, team, festività admin, `apps/admin/src/lib/bulk.tsx`) + il dialogo «Adegua stock» con quantità zero. Misura il contrasto di `warning-foreground` su `warning` in chiaro e scuro (canvas 1×1 su oklch): serve ≥ 4.5.
Expected: tutti leggibili, contrasto ≥ 4.5 in entrambi i temi; screenshot aperti e guardati.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/styles/globals.css packages/ui/src/components/button.tsx packages/ui/src/components/dropdown-menu.tsx packages/ui/src/components/alert-dialog.tsx apps/seller/src/features/products/components/bulk-stock-adjust-dialog.tsx DESIGN.md
git commit -m "feat(ui,seller): warning diventa giallo Segnale con warning-foreground"
```

- [ ] **Step 8: PR1.** `git push -u origin feat/ui-warning-giallo`, body in scratchpad (cosa cambia, elenco consumatori guardati, contrasti misurati, screenshot), passa a Marco `! gh pr create --base main --head feat/ui-warning-giallo --title "feat(ui,seller): warning giallo Segnale" --body-file <file>`. Poi `git switch feat/paga-e-ritira-in-evidenza && git merge --no-edit feat/ui-warning-giallo` per avere il token in PR2 (dopo lo squash di PR1: `git merge origin/main`).

---

## PR2 — la funzione (branch `feat/paga-e-ritira-in-evidenza`)

### Task 2: API — tipologie leggibili dai dipendenti assegnati

**Files:**
- Modify: `apps/api/src/modules/seller/routes/stores.ts:239-261` (GET `/stores/:storeId/order-types`)
- Modify: `apps/api/tests/modules/seller-stores-owner-only.test.ts:77-80`

**Interfaces:**
- Produces: `GET /seller/stores/:storeId/order-types` → 200 per titolare e dipendente assegnato, 403 per dipendente non assegnato (o negozio cancellato), 404 per negozio di altri. Risposta invariata (`StoreOrderTypesSchema`). `PATCH` resta solo titolare.

- [ ] **Step 1: Test.** Togli il test `GET /stores/:id/order-types → 403 for a non-owner` (la GET non è più solo del titolare); il test PATCH resta. La regola d'accesso è `ensureStoreAccess`, già coperta da `tests/integration/seller-access.test.ts`.

- [ ] **Step 2: Implementa.** Nel handler GET: `const { sellerProfile: sp, accessCtx, params } = withSeller(ctx); await ensureStoreAccess(params.storeId, accessCtx);` al posto di `requireOwner(isOwner)` (stesso uso di `routes/dashboard.ts:11`). Aggiorna `detail.description`: «… Titolare e dipendenti assegnati al negozio.»

- [ ] **Step 3: Verifica**

Run: `cd apps/api && bun run typecheck && bun run test:unit && bun test tests/integration/seller-store-order-types.test.ts tests/integration/seller-access.test.ts --isolate --timeout 180000`
Expected: PASS, exit 0.

- [ ] **Step 4: Commit** — `git commit -m "feat(api): tipologie d'acquisto leggibili dai dipendenti del negozio"`

### Task 3: Banner pagamenti online su ogni pagina

**Files:**
- Create: `apps/seller/src/features/online-payments/hooks/use-online-payments.ts` (spostato da `features/profile/hooks/use-online-payments.ts`, contenuto invariato)
- Create: `apps/seller/src/features/online-payments/lib/payments-banner.ts`
- Test: `apps/seller/src/features/online-payments/lib/payments-banner.test.ts`
- Create: `apps/seller/src/features/online-payments/components/online-payments-banner.tsx`
- Modify: `apps/seller/src/routes/_authenticated.tsx` (contenitore di `StoreBillingBanner`)
- Modify: import degli hook in `features/profile/components/online-payments-card.tsx`, `routes/_authenticated/payments/return.tsx`, `routes/_authenticated/payments/refresh.tsx`
- Modify: `apps/seller/messages/it.json`, `apps/seller/messages/en.json`

**Interfaces:**
- Produces (`payments-banner.ts`):
  - `export type OnlinePaymentsStatus = "none" | "incomplete" | "in_review" | "enabled"`
  - `export type BannerStatus = Exclude<OnlinePaymentsStatus, "enabled">`
  - `export type Dismissed = { status: OnlinePaymentsStatus; at: number }`
  - `export const DISMISS_MS = 7 * 24 * 60 * 60 * 1000`
  - `export const DISMISS_KEY = "bibs:payments-banner-dismissed"`
  - `export function visibleBanner(input: { status: OnlinePaymentsStatus | undefined; dismissed: Dismissed | null; now: number; onSalesTab: boolean }): BannerStatus | null`
  - `export function readDismissed(): Dismissed | null` / `export function writeDismissed(d: Dismissed): void`
- Produces: hook `useStartOnboarding()`, `useSyncOnlinePayments()` da `@/features/online-payments/hooks/use-online-payments` (usati da Task 4).

- [ ] **Step 1: Test che falliscono** (`payments-banner.test.ts`, `// @vitest-environment jsdom`; `const NOW = Date.UTC(2026, 9, 19)`):
  - `visibleBanner({ status: undefined, dismissed: null, now: NOW, onSalesTab: false })` → `null` (dipendente o caricamento)
  - `status: "enabled"` → `null`
  - `status: "none"`, niente chiusura → `"none"`; idem `"incomplete"` → `"incomplete"`, `"in_review"` → `"in_review"`
  - `status: "none"`, `onSalesTab: true` → `null`
  - chiuso `{ status: "none", at: NOW - 6 * DAY }` → `null`
  - chiuso `{ status: "none", at: NOW - 7 * DAY }` → `"none"` (al settimo giorno torna)
  - chiuso `{ status: "none", at: NOW - 1 * DAY }`, stato ora `"incomplete"` → `"incomplete"`
  - `readDismissed()` con `localStorage.setItem(DISMISS_KEY, "{rotto")` → `null`
  - `readDismissed()` con `vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error() })` → `null`
  - `writeDismissed(...)` con `setItem` che lancia → non lancia
  - `writeDismissed({ status: "none", at: NOW })` poi `readDismissed()` → `{ status: "none", at: NOW }`

- [ ] **Step 2: Run** — `cd apps/seller && bun run test src/features/online-payments/lib/payments-banner.test.ts` → FAIL (modulo mancante).

- [ ] **Step 3: Implementa `payments-banner.ts`.** `readDismissed` valida la forma (`status` stringa tra i quattro, `at` numero), altrimenti `null`.

- [ ] **Step 4: Run** — stesso comando → PASS.

- [ ] **Step 5: Sposta gli hook** in `features/online-payments/hooks/use-online-payments.ts` e aggiorna i tre import. In `useSyncOnlinePayments.onSuccess` invalida anche le tipologie: `qc.invalidateQueries({ predicate: (q) => q.queryKey[2] === "order-types" })` (`offeredOrderTypes` dipende da `chargesEnabled`).

- [ ] **Step 6: Messaggi** (it; en con lo stesso senso):
  - `payments_banner_none_title` ««Paga e ritira» è spento.» · `payments_banner_none_body` «Attiva i pagamenti online: i clienti pagano dall'app e passano solo a ritirare.» · `payments_banner_none_cta` «Attiva»
  - `payments_banner_incomplete_title` «Attivazione a metà.» · `payments_banner_incomplete_body` «Mancano alcuni dati su Stripe per accendere «Paga e ritira».» · `payments_banner_incomplete_cta` «Completa»
  - `payments_banner_in_review_title` «Stripe sta verificando i tuoi dati.» · `payments_banner_in_review_body` «Quando ha finito potrai accendere «Paga e ritira» nelle impostazioni del negozio.»
  - `payments_banner_dismiss` «Nascondi per 7 giorni» (aria-label della X)

- [ ] **Step 7: `OnlinePaymentsBanner()`** — `status = useSellerSettings().data?.onlinePayments?.status` (niente polling qui); `onSalesTab` dalla location del router (`pathname === "/store"` e search `sezione === "vendita"`); `dismissed` in `useState(readDismissed)`; `visibleBanner({ …, now: Date.now() })`. Markup come la striscia della preview: `flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm`, stati `none`/`incomplete` con `border-warning-foreground/15 bg-warning text-warning-foreground`, `in_review` con `border-border bg-card text-muted-foreground`; icone `PlugIcon` / `ListTodoIcon` / `SearchCheckIcon`; titolo in `font-semibold` + corpo; CTA `Button size="sm"` che chiama `useStartOnboarding().mutate` (toast d'errore come nella card; disabilitata e con `m.payments_redirecting()` mentre va); X `button` con `aria-label={m.payments_banner_dismiss()}` che fa `writeDismissed({ status, at: Date.now() })` e aggiorna lo state.

- [ ] **Step 8: Layout.** In `_authenticated.tsx`: `<div className="mb-4 space-y-2 empty:hidden"><StoreBillingBanner /><OnlinePaymentsBanner /></div>`.

- [ ] **Step 9: Verifica** — `cd apps/seller && bun run typecheck && bun run lint && bun run test` → exit 0.

- [ ] **Step 10: Commit** — `git commit -m "feat(seller): banner pagamenti online su ogni pagina per il titolare"`

### Task 4: Pagamenti online nella scheda Vendita, via dal Profilo

**Files:**
- Create: `apps/seller/src/features/stores/hooks/use-store-order-types.ts`
- Create: `apps/seller/src/features/online-payments/status.ts` (le mappe `STATUS_BADGE` / `STATUS_LABEL` spostate da `online-payments-card.tsx`)
- Create: `apps/seller/src/features/online-payments/components/online-payments-box.tsx`
- Modify: `apps/seller/src/features/stores/components/order-types-section.tsx` (righe 65-92 → prop `paymentsBox`)
- Modify: `apps/seller/src/features/stores/components/sales-settings-panel.tsx` (query → hook; passa il riquadro)
- Test: `apps/seller/src/features/stores/components/sales-settings-panel.test.tsx`
- Modify: `apps/seller/src/routes/_authenticated/profile.tsx` (via `OnlinePaymentsCard`)
- Delete: `apps/seller/src/features/profile/components/online-payments-card.tsx`
- Modify: `apps/seller/src/routes/_authenticated/payments/return.tsx:24`, `payments/refresh.tsx:25`
- Modify: `apps/seller/messages/it.json`, `en.json`

**Interfaces:**
- Consumes: `useStartOnboarding`, `useSyncOnlinePayments` (Task 3); `bg-warning`, `text-warning-foreground` (Task 1).
- Produces:
  - `export const storeOrderTypesKey = (storeId: string) => ["store", storeId, "order-types"] as const`
  - `export function useStoreOrderTypes(storeId: string | undefined)` — `useQuery` su quella chiave, `enabled: !!storeId`, stessa `queryFn` di oggi in `sales-settings-panel.tsx:37-44` (usata anche da Task 5)
  - `export function OnlinePaymentsBox(props: { storeId: string; payOn: boolean }): JSX.Element | null`
  - `OrderTypesSection` riceve `paymentsBox: ReactNode` al posto dei rami sotto lo switch «Paga e ritira»; `chargesEnabled` resta per il blocco dello switch.

- [ ] **Step 1: Test che falliscono** in `sales-settings-panel.test.tsx`. Estendi il mock di `api()` con `seller.settings.get` (`calls.settingsGet`) e `seller.settings.payments.{onboarding,sync}.post`. Nuovi casi (locale `it`):
  - `onlinePayments: { status: "none", payoutsEnabled: false }` → c'è il testo di `m.payments_none_body()` e il pulsante «Attiva pagamenti online»; **non** c'è «Vai ai pagamenti online».
  - `status: "incomplete"` → pulsanti «Aggiorna stato» e «Completa l'attivazione».
  - `status: "enabled", payoutsEnabled: false` → «Pagamenti online attivi», «Vale per tutti i tuoi negozi.», «I versamenti sul tuo conto partono appena Stripe completa la verifica.»
  - `orderTypes: ["reserve_pickup","pay_pickup"]`, `chargesEnabled: false`, `status: "incomplete"` → c'è il testo di `m.store_order_types_pay_account_disabled()` (Review Focus 3).
  - partendo da `status: "incomplete"`, `queryClient.setQueryData(["seller","settings"], { …, onlinePayments: { status: "enabled", payoutsEnabled: true } })` → `calls.typesGet` chiamata una seconda volta (Review Focus 4).

- [ ] **Step 2: Run** — `cd apps/seller && bun run test src/features/stores/components/sales-settings-panel.test.tsx` → FAIL.

- [ ] **Step 3: Implementa.**
  - `use-store-order-types.ts` e `sales-settings-panel.tsx` che lo usa (tieni `qc.setQueryData(storeOrderTypesKey(storeId), next)` nel salvataggio).
  - `OnlinePaymentsBox`: `useSellerSettings({ pollOnlinePayments: true })`; `null` se `onlinePayments` manca. Riga `flex flex-wrap items-center gap-3 rounded-md border p-3`, con `border-warning-foreground/15 bg-warning text-warning-foreground` in `none`/`incomplete`, solo `border` negli altri. A sinistra `StatusBadge` da `status.ts` (in `enabled` l'etichetta è `m.store_order_types_payments_on()`), al centro testo (`none` → `payments_none_body`, `incomplete` → `payments_incomplete_body`, `in_review` → `payments_in_review_body`, `enabled` → `payments_enabled_body` + riga `text-xs` `payments_payouts_pending` se `!payoutsEnabled`; in più `store_order_types_pay_account_disabled` se `payOn && status !== "enabled"`), a destra i pulsanti come nella card di oggi (`payments_cta_start` in `none`; `payments_cta_refresh` outline + `payments_cta_continue` in `incomplete`; `payments_cta_refresh` in `in_review`). `useEffect` su `status`: dopo il primo render invalida `storeOrderTypesKey(storeId)`.
  - `OrderTypesSection`: sotto lo switch «Paga e ritira» rende `{paymentsBox}`; togli `Link`, `StatusBadge`, `CircleCheckIcon` se non servono più.
  - Profilo: togli `OnlinePaymentsCard`; cancella il file della card.
  - `return.tsx` e `refresh.tsx`: `navigate({ to: "/store", search: { sezione: "vendita" }, replace: true })`; aggiorna i commenti («si torna alla scheda Vendita»).
  - Messaggi: `payments_enabled_body` → «Vale per tutti i tuoi negozi.»; `payments_error_sync` → «Non è stato possibile aggiornare lo stato. Riprova.»; `profile_description` → «Dati personali e informazioni dell'azienda.»; rimuovi `store_order_types_pay_needs_payments`, `store_order_types_pay_go_to_profile`, `store_order_types_manage_payments`, `payments_title`, `payments_description` dopo un `grep -rn` che confermi che nessuno li usa più. Stesso in `en.json`.

- [ ] **Step 4: Run** — stesso comando → PASS; poi `bun run typecheck && bun run lint && bun run test` in `apps/seller` → exit 0.

- [ ] **Step 5: Commit** — `git commit -m "feat(seller): pagamenti online nella scheda Vendita, via la card dal Profilo"`

### Task 5: Tipologie del negozio in sidebar

**Files:**
- Create: `apps/seller/src/components/order-types-sidebar-card.tsx`
- Test: `apps/seller/src/components/order-types-sidebar-card.test.tsx`
- Modify: `apps/seller/src/components/app-sidebar.tsx` (in `SidebarFooter`, prima di `NavUser`)
- Modify: `apps/seller/messages/it.json`, `en.json`

**Interfaces:**
- Consumes: `useStoreOrderTypes(storeId)` (Task 4), `useActiveStore()`, `useIsOwner()`.
- Produces: `export function OrderTypesSidebarCard(): JSX.Element | null`.

- [ ] **Step 1: Test che falliscono** (`// @vitest-environment jsdom`; mock di `@/hooks/use-active-store`, `@/hooks/use-is-owner`, `@/lib/api`, e `Link` di `@tanstack/react-router` come ancora con `data-testid="vendita-link"`):
  - `offeredOrderTypes: ["reserve_pickup"]`, `orderTypes: ["reserve_pickup","pay_pickup"]` → riga «Paga e ritira» con «spento», riga «Prenota e paga in negozio» (`m.orders_type_reserve_pickup()`) con «attivo» (Review Focus 3).
  - titolare → c'è `vendita-link`; dipendente → non c'è, il testo c'è comunque (Review Focus 2).
  - rerender con negozio attivo `s2` (mock che restituisce tipologie diverse per `s2`) → mostra quelle di `s2` (Review Focus 5).
  - nessun negozio attivo → non rende nulla.

- [ ] **Step 2: Run** — `cd apps/seller && bun run test src/components/order-types-sidebar-card.test.tsx` → FAIL.

- [ ] **Step 3: Implementa.** Messaggi `sidebar_order_types_title` «Come comprano i clienti», `sidebar_order_types_on` «attivo», `sidebar_order_types_off` «spento» (+ en). Markup come S2 nella preview: riquadro `rounded-md border border-sidebar-border p-2.5 text-sm`, etichetta `text-xs text-muted-foreground`, una riga per `reserve_pickup` e `pay_pickup` (etichette `m.orders_type_reserve_pickup()` / `m.orders_type_pay_pickup()`), pallino `bg-success` pieno se in `offeredOrderTypes`, altrimenti `border border-muted-foreground` vuoto e testo `muted-foreground`. Titolare: tutto il riquadro è `Link to="/store" search={{ sezione: "vendita" }}` con hover `bg-sidebar-accent`. Classe `group-data-[collapsible=icon]:hidden`. `null` se manca il negozio o i dati (anche su errore).

- [ ] **Step 4: Run** — stesso comando → PASS; `bun run typecheck && bun run lint && bun run test` in `apps/seller` → exit 0.

- [ ] **Step 5: Commit** — `git commit -m "feat(seller): tipologie d'acquisto del negozio attivo in sidebar"`

### Task 6: Pulizia, smoke e PR2

**Files:**
- Delete: `apps/seller/src/routes/pagamenti-preview.tsx`
- Verify: `apps/seller/src/routeTree.gen.ts` torna identico a `main` (nessuna route nuova in PR2)

- [ ] **Step 1: Pulizia** — cancella la preview, lascia che vite rigeneri `routeTree.gen.ts`, poi `git diff main -- apps/seller/src/routeTree.gen.ts` → vuoto.

- [ ] **Step 2: Suite completa** — dalla root `bun run typecheck && bun run lint && bun run test` → exit 0 (controlla ogni workspace).

- [ ] **Step 3: Smoke nel browser** (Chrome DevTools MCP, `isolatedContext`, chiaro e scuro). Con `bun run dev` + `bun run dev:stripe`, crea titolari **di prova** (mai scrivere sul seed) e portali in `none`, `incomplete`, `in_review`, `enabled` con l'onboarding Stripe in test mode. Controlla per ognuno: banner giusto su dashboard e Prodotti, assente su Vendita; X → sparisce e resta via dopo il reload; riquadro in Vendita giusto; ritorno da Stripe su Vendita; sidebar che cambia col negozio. Con un dipendente assegnato: sidebar visibile, non cliccabile, niente banner, nessun 403 in console. Profilo senza card.
Expected: tutto come da spec; screenshot aperti e guardati.

- [ ] **Step 4: Prova di Marco** — passa a Marco i passi per provarla lui con mouse e tastiera (gate UI prima della PR).

- [ ] **Step 5: PR2** — `git push -u origin feat/paga-e-ritira-in-evidenza`; body in scratchpad (spec, cosa cambia, screenshot, dipende da PR1); passa a Marco `! gh pr create --base main --head feat/paga-e-ritira-in-evidenza --title "feat(api,seller): «Paga e ritira» in evidenza" --body-file <file>` (dopo il merge di PR1, `git merge origin/main` prima del push).
