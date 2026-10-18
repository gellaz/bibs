# StatusBadge unico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un solo `StatusBadge` in `packages/ui`, con cinque toni sui token semantici (gli esistenti `success`/`destructive` più `action`/`waiting`), uguali nelle tre app, sostituisce i badge di stato fatti a mano in admin, seller e customer.

**Architecture:** Token semantici in `globals.css`: `--success`, `--destructive`, `--warning` esistenti, scuriti per reggere AA come testo; nuovi `--action` e `--waiting`; il tono «chiuso» usa `--muted-foreground` e `--border`. Fondo e bordo del badge derivano dal colore del tono (`/12`, `/40`); un componente `StatusBadge` (pillola tinta + bordo + icona per stato, passo n/N facoltativo); ogni dominio tiene la sua mappa stato → `{ tone, icon }` vicino a dove già vive, e il tono dipende da chi guarda. `TabNav` usa gli stessi token per i contatori.

**Tech Stack:** React 19 + React Compiler, TanStack Start/Router/Table, Tailwind 4, Paraglide, lucide-react 1.58, Vitest + Testing Library (FE).

**Spec:** [`docs/superpowers/specs/2026-10-18-status-badge-design.md`](../specs/2026-10-18-status-badge-design.md) — contiene la mappa completa stato → tono → icona e la tabella dei token: i valori si copiano da lì.

## Global Constraints

- Branch `feat/ui-status-badge` nel worktree `.claude/worktrees/status-badge`, impilato su `fix/admin-config-ritocchi`. Dopo lo squash-merge di quella PR: `git rebase --onto origin/main fix/admin-config-ritocchi feat/ui-status-badge`.
- Prima di tutto, nel worktree: `bun install` (fallisce solo il postinstall `lefthook install`: innocuo).
- Dev server del worktree su porte proprie, da ciascuna app: `bunx vite dev --port 3013 --strictPort` (admin), `3012` (seller), `3011` (customer). Il login si fa sulla porta standard (3003/3002/3001), poi si naviga su quella del worktree: il cookie è condiviso.
- Conventional Commits; ogni commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Niente `--no-verify`, niente modifiche a mano a `bun.lock`.
- Testi utente solo in `messages/{it,en}.json`; i componenti di `@bibs/ui` ricevono i testi via props.
- Etichette lette a ogni render (funzioni, non costanti): il cambio lingua non ricarica la pagina.
- Contrasto: testo ≥ 4,5:1 in chiaro e in scuro, su background e su card; misura col canvas (memoria `feedback-measure-contrast-oklch-canvas`), cambiando tema con `localStorage.theme` + reload.
- Gate di chiusura: per ogni workspace toccato `bun run typecheck`, `bun run lint` (in `packages/ui`, che non ha lo script: `bunx biome check packages/ui`), `bun run test` (lanciati per workspace, non con l'aggregato), browser via Chrome DevTools MCP a 1280 e 390 px in chiaro e scuro, poi smoke di Marco prima della PR.

## Review Focus

- **Etichette lunghe in colonne strette** («In attesa di pagamento», «Dati aziendali mancanti» + «4/6») a 390 px: il badge non va a capo, scorre la tabella. → test `whitespace-nowrap` in Task 1, verifica in Task 6.
- **Stato sconosciuto dall'API** (Stripe aggiunge uno stato): si vede il valore grezzo, tono `closed`, icona `CircleHelpIcon`; niente crash. → test in Task 3, 4, 5.
- **Cambio lingua**: etichette in inglese senza ricaricare. → i test «follows the current language» esistenti restano verdi.
- **Riga selezionata** (`bg-cobalt-soft` nelle DataTable con selezione): il badge `action` ha lo stesso fondo e resta leggibile grazie a bordo e testo `cobalt-deep`. → verifica in Task 6 su Venditori admin.
- **Pulsanti soft e testi d'errore**: scurire `--success`/`--destructive`/`--warning` cambia anche `Button variant="success|warning|destructive"` e tutti i `text-destructive` (79 file): devono restare leggibili e coerenti, e l'unico fondo pieno (`bg-destructive text-white`, rimozione immagine nella dropzone prodotti) deve tenere 3:1 come icona. → verifica in Task 6.

---

### Task 1: Token di stato, `StatusBadge` e DESIGN.md

**Files:**
- Modify: `packages/ui/src/styles/globals.css` (`:root` riga ~29, `.dark` riga ~142, `@theme inline` riga ~192)
- Create: `packages/ui/src/custom/status-badge.tsx`
- Create: `packages/ui/src/custom/status-badge.test.tsx`
- Modify: `DESIGN.md` (frontmatter `colors`, §2 State, §2 Named Rules «Cross-Register Ban», §5 Chips and Pills, §6 Don't)
- Add: questa spec e questo piano (`docs/superpowers/...`)

**Interfaces:**
- Produces:
  ```ts
  export type StatusTone = "action" | "waiting" | "success" | "closed" | "destructive";
  export interface StatusBadgeProps {
    tone: StatusTone;
    icon: LucideIcon;
    children: React.ReactNode;
    /** Passo raggiunto in un flusso: «current/total» accanto, `label` per i lettori di schermo. */
    step?: { current: number; total: number; label: string };
    className?: string;
  }
  export function StatusBadge(props: StatusBadgeProps): React.JSX.Element;
  ```
  Classi per tono: `text-<token> bg-<token>/12 border-<token>/40` con token `action`, `waiting`, `success`, `destructive`; `closed` = `text-muted-foreground border-border` senza fondo.

- [ ] **Step 0: Committa spec e piano**

```bash
git add docs/superpowers
git commit -m "docs: spec e piano dello StatusBadge unico"
```

- [ ] **Step 1: Scrivi il test che fallisce** — `status-badge.test.tsx` (jsdom, `cleanup` in `afterEach` come `search-input.test.tsx`):
  - `it("mostra etichetta e tono")`: `render(<StatusBadge tone="action" icon={PackageIcon}>Da preparare</StatusBadge>)`; `screen.getByText("Da preparare").closest("[data-tone]")` ha `data-tone="action"`, classi `text-action`, `bg-action/12`, `border-action/40`, `whitespace-nowrap`.
  - `it("il tono chiuso non ha fondo")`: `tone="closed"` → classi `text-muted-foreground` e `border-border`, nessuna classe `bg-`.
  - `it("l'icona è decorativa")`: la `svg` ha `aria-hidden="true"`.
  - `it("mostra il passo")`: con `step={{ current: 3, total: 6, label: "Passo 3 di 6" }}` c'è un elemento con testo `3/6` e `aria-hidden="true"`, e un elemento `.sr-only` con testo `Passo 3 di 6`.
  - `it("unisce la classe passata")`: `className="ml-2"` finisce sul badge.

- [ ] **Step 2: Verifica che fallisca** — `bun run --cwd packages/ui test status-badge` → FAIL, modulo non trovato.

- [ ] **Step 3: Token in `globals.css`** (valori dalla tabella «Token» della spec)
  - `:root`, palette: `--olive-deep`, `--brick-deep`, `--petrol` accanto a `--olive`/`--brick`; `--warning` al nuovo valore.
  - `:root`, semantici: `--success: var(--olive-deep)`, `--destructive: var(--brick-deep)`, nuovi `--action: var(--cobalt-deep)` e `--waiting: var(--petrol)`.
  - `.dark`: `--destructive` al nuovo valore; nuovi `--action` e `--waiting` scuri. `--success` e `--warning` scuri invariati.
  - `@theme inline`: `--color-action: var(--action)`, `--color-waiting: var(--waiting)` (gli altri ci sono già).
  - Commento di una riga sui semantici: valori scuriti perché reggano AA come testo su fondo tinto (badge e pulsanti soft).

- [ ] **Step 4: Implementa `StatusBadge`** in `status-badge.tsx`. Pillola: `inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border pr-2.5 pl-1.5 text-xs font-medium` + le tre classi del tono da una `Record<StatusTone, string>`; `data-slot="status-badge"`, `data-tone={tone}`; icona `size-3.5 shrink-0`, `strokeWidth={2.25}`, `aria-hidden`. Con `step`: avvolgi in `inline-flex items-center gap-2` e aggiungi `<span aria-hidden className="text-xs tabular-nums text-muted-foreground">{current}/{total}</span>` + `<span className="sr-only">{label}</span>`. `className` va sul badge (via `cn`).

- [ ] **Step 5: Verifica che passi** — `bun run --cwd packages/ui test status-badge` → PASS (5 test).

- [ ] **Step 6: DESIGN.md**
  - frontmatter `colors` (primitivi): `olive-deep`, `brick-deep`, `petrol` coi valori della spec; `warning` al nuovo valore.
  - frontmatter `components` (semantici, referenziano i primitivi): `status-action`, `status-waiting`, `status-success`, `status-closed`, `status-destructive`, ciascuno con `textColor` (`{colors.cobalt-deep}`, `{colors.petrol}`, `{colors.olive-deep}`, `{colors.warm-shadow}`, `{colors.brick-deep}`), `typography: "{typography.label}"`, `rounded: "{rounded.pill}"`, `padding: "0 0.625rem 0 0.375rem"`.
  - §2: Named Rule nuova **The Semantic Token Rule** — nei componenti solo token semantici (`success`, `destructive`, `warning`, `action`, `waiting`, `primary`, `muted-foreground`…), mai nomi di colore; la palette compare solo in `globals.css`.
  - §2 State: il token `success` punta a Olive Deep, `destructive` a Brick Deep (testo AA su fondo tinto); bullet **Petrolio** — «aspetti qualcun altro», blu-verde spento lontano da cobalt, olive e saffron; nuovo valore di Warning.
  - §2 Cross-Register Ban: «Eccezione: i toni dello Status Badge sono stato, non registro, e valgono nelle tre app (come warning): il cobalt compare nel customer solo come tono `action` di un badge di stato.» Stessa eccezione in §2 «Accent (product register): Cobalt» e nel Don't «mix the two accents».
  - §5 Chips and Pills: nuovo bullet **Status Badge** con la tabella dei cinque toni (significato, token), «il tono lo decide chi guarda», «icona per stato, non per tono», «n/N solo per l'onboarding», «warning non è un tono di stato».

- [ ] **Step 7: Lint e commit**

```bash
bunx biome check packages/ui && bun run --cwd packages/ui typecheck
git add packages/ui DESIGN.md
git commit -m "feat(ui): StatusBadge sui token semantici, success e destructive leggibili su fondo tinto"
```

### Task 2: Contatori di `TabNav` sui toni di stato

**Files:**
- Modify: `packages/ui/src/custom/tab-nav.tsx:12-35` (`BADGE_COLORS`, `TabNavItem.badgeColor`)
- Modify: `apps/seller/src/features/products/components/product-status-tabs.tsx:33,39,45`
- Modify: `apps/admin/src/routes/_authenticated/stores.tsx:41-50`
- Modify: `apps/admin/src/routes/_authenticated/sellers/index.tsx:34-44`
- Test: `apps/admin/src/components/tab-nav.test.tsx`

**Interfaces:**
- Consumes: `StatusTone` da Task 1.
- Produces: `TabNavItem.badgeColor?: "default" | StatusTone`.

- [ ] **Step 1: Test che fallisce** in `tab-nav.test.tsx`: `it("colora il contatore col tono di stato")` — tabs con `{ value: "rejected", label: "Rifiutati", count: 4, badgeColor: "destructive" }`; lo span con testo `4` ha classe `text-destructive`.
- [ ] **Step 2: Verifica FAIL** — `bun run --cwd apps/admin test tab-nav`.
- [ ] **Step 3: Implementa** — `BADGE_COLORS` diventa `Record<"default" | StatusTone, string>`: `default` invariato; per i toni colorati `bg-<token>/12 text-<token> ring-1 ring-inset ring-<token>/40`; `closed` = `text-muted-foreground ring-1 ring-inset ring-border`. Via `success`/`warning`/`destructive`/`amber`/`emerald`/`red`/`cobalt` e il commento sulle «escape hatches». Chiamanti (valori dalla spec, §Contatori): prodotti `success`/`closed`/`destructive`; negozi `success`, `past_due` → `destructive`, `suspended` → `destructive`; venditori `pending_review` → `action`, `active` → `success`, `rejected` → `destructive`.
- [ ] **Step 4: Verifica PASS** + typecheck di `packages/ui`, `apps/admin`, `apps/seller`.
- [ ] **Step 5: Commit** — `feat(ui,admin,seller): contatori delle tab sui toni di stato`.

### Task 3: Admin

**Files:**
- Modify: `apps/admin/src/features/holidays/components/holidays-panel.tsx` (colonna `status`)
- Modify: `apps/admin/src/components/onboarding-status-badge.tsx` (riscrittura)
- Modify: `apps/admin/src/components/onboarding-status-badge.test.tsx`
- Modify: `apps/admin/src/features/billing/subscription-status.ts` + `subscription-status.test.ts`
- Modify: `apps/admin/src/routes/_authenticated/stores.tsx:~217`, `apps/admin/src/routes/_authenticated/billing/subscriptions.tsx:~87`
- Modify: `apps/admin/src/routes/_authenticated/users.tsx:~146`
- Modify: `apps/admin/messages/{it,en}.json`

**Interfaces:**
- Consumes: `StatusBadge`, `StatusTone` da Task 1.
- Produces: `subscriptionStatusBadge(status: string): { label: string; tone: StatusTone; icon: LucideIcon }`; `OnboardingStatusBadge({ status: string; className?: string })` (firma invariata).

- [ ] **Step 1: Test che falliscono**
  - `onboarding-status-badge.test.tsx`: sostituisci l'asserzione `text-olive` con `data-tone="success"` su «Attivo»; nuovo `it("mostra il passo negli stati in corso")`: `pending_document` → testo `3/6` e sr-only `Passo 3 di 6`; `active` e `rejected` senza `/6`; `it("uno stato sconosciuto...")` resta e controlla anche `data-tone="closed"`.
  - `subscription-status.test.ts`: le attese diventano `{ label, tone }` (mappa i risultati togliendo `icon`): `Attivo/success`, `Rinnovo fallito/destructive`, `In cancellazione/closed`, `Sospeso/destructive`, `Cancellato/closed`; sconosciuto → `{ label: "pending", tone: "closed" }`.
- [ ] **Step 2: Verifica FAIL** — `bun run --cwd apps/admin test onboarding-status subscription-status`.
- [ ] **Step 3: Implementa**
  - messaggi: `sellers_onboarding_step` = `"Passo {current} di {total}"` / `"Step {current} of {total}"`; elimina `sellers_status_pending_store` e `sellers_status_pending_payment` (in it e en).
  - `OnboardingStatusBadge`: mappa `Record<OnboardingStatus, { label: () => string; tone: StatusTone; icon: LucideIcon; step?: number }>` con i 7 stati reali della spec; `step` presente solo per i cinque `pending_*`; totale 6. Sconosciuto → valore grezzo, `closed`, `CircleHelpIcon`.
  - `subscriptionStatusBadge`: tono e icona dalla spec (admin); sconosciuto → `closed` + `CircleHelpIcon`. In `stores.tsx` e `subscriptions.tsx`: `<StatusBadge tone={b.tone} icon={b.icon}>{b.label}</StatusBadge>` al posto di `<Badge variant>`.
  - `holidays-panel.tsx`: `<StatusBadge tone={isActive ? "success" : "closed"} icon={isActive ? CircleCheckIcon : CircleMinusIcon}>`; togli il `Badge` outline col pallino e il suo commento.
  - `users.tsx`: «Bannato» → `<StatusBadge tone="destructive" icon={BanIcon}>`.
  - Rimuovi gli import di `Badge` rimasti inutilizzati.
- [ ] **Step 4: Verifica PASS** — `bun run --cwd apps/admin test` (tutta la suite) + `typecheck` + `lint`.
- [ ] **Step 5: Commit** — `feat(admin): badge di stato sullo StatusBadge, onboarding con il passo`.

### Task 4: Seller

**Files:**
- Modify: `apps/seller/src/features/orders/components/order-status-badge.tsx`; Create: `order-status-badge.test.tsx` accanto
- Modify: `apps/seller/src/features/promotions/components/promotion-state-badge.tsx`; Create: `promotion-state-badge.test.tsx` accanto
- Modify: `apps/seller/src/components/membership-status-badge.tsx` + `membership-status-badge.test.tsx`
- Create: `apps/seller/src/features/billing/subscription-status.ts` + `subscription-status.test.ts` (sposta `statusBadge` da `routes/_authenticated/billing.tsx:57-74`)
- Modify: `apps/seller/src/features/billing/invoice-status.ts` + `invoice-status.test.ts`
- Modify: `apps/seller/src/routes/_authenticated/billing.tsx` (abbonamenti ~288, fatture ~406)
- Modify: `apps/seller/src/features/profile/components/online-payments-card.tsx:24-29,62-71`

**Interfaces:**
- Consumes: `StatusBadge`, `StatusTone` da Task 1.
- Produces: `subscriptionStatusBadge(status: string): { label; tone; icon }` (seller: `past_due` → `destructive`, `canceling` → `waiting`); `invoiceStatusBadge(status: string | null): { label: string; tone: StatusTone; icon: LucideIcon }` costruita su `invoiceStatusLabel`.

- [ ] **Step 1: Test che falliscono** (stile `membership-status-badge.test.tsx`, `renderToStaticMarkup`, leggendo `data-tone`):
  - `order-status-badge.test.tsx`: tabella degli 8 stati → toni della spec (seller): `pending→waiting`, `confirmed→action`, `ready_for_pickup→success`, `shipped→success`, `delivered→closed`, `completed→closed`, `cancelled→destructive`, `expired→destructive`.
  - `promotion-state-badge.test.tsx`: `status:"active"` con `startsAt` passato e `endsAt:null` → `success`; `startsAt` futuro → `waiting`; `status:"paused"` → `closed`; `status:"archived"` → `closed`.
  - `membership-status-badge.test.tsx`: aggiungi i toni `active→success`, `pending→waiting`, `banned→destructive`, `removed→closed`; sconosciuto → `closed`.
  - `subscription-status.test.ts` (seller): `active→success`, `past_due→destructive`, `canceling→waiting`, `suspended→destructive`; sconosciuto → raw + `closed`.
  - `invoice-status.test.ts`: `invoiceStatusBadge`: `open→action`, `paid→success`, `draft→waiting`, `void→closed`, `uncollectible→destructive`, `null→{ label:"—", tone:"closed" }`.
- [ ] **Step 2: Verifica FAIL** — `bun run --cwd apps/seller test order-status promotion-state membership-status subscription-status invoice-status`.
- [ ] **Step 3: Implementa** — ogni componente/helper sostituisce classi e varianti con `{ tone, icon }` dalla spec (seller), poi `<StatusBadge>`. In `PromotionStateBadge` resta `operationalState`, via `STATE_CLASSES`. In `MembershipStatusBadge` via `STATUS_STYLES` e il pallino. In `online-payments-card.tsx` `STATUS_VARIANT` diventa `STATUS_BADGE: Record<OnlinePaymentsStatus, { tone; icon }>` (`none→action Plug`, `incomplete→action ListTodo`, `in_review→waiting SearchCheck`, `enabled→success CircleCheck`). Niente più `emerald`, `amber`, `red`, `olive` nei badge del seller.
- [ ] **Step 4: Verifica PASS** — `bun run --cwd apps/seller test` (suite intera; serve `paraglide:compile`, già nel `pretest`) + `typecheck` + `lint`; `grep -rn "emerald-\|amber-\|red-[0-9]" apps/seller/src/features/{orders,promotions} apps/seller/src/components` → nessun risultato.
- [ ] **Step 5: Commit** — `feat(seller): badge di stato sullo StatusBadge`.

### Task 5: Customer

**Files:**
- Modify: `apps/customer/src/features/orders/order-status-badge.tsx`; Create: `order-status-badge.test.tsx` accanto

**Interfaces:**
- Consumes: `StatusBadge`, `StatusTone` da Task 1. Firma di `OrderStatusBadge` invariata (usata in `orders/index.tsx:127`, `orders/$orderId.tsx:94`, `checkout/$checkoutId/index.tsx:135`).

- [ ] **Step 1: Test che fallisce** — tabella degli 8 stati → toni della spec (customer): `pending→action`, `confirmed→waiting`, `ready_for_pickup→action`, `shipped→waiting`, `delivered→closed`, `completed→closed`, `cancelled→destructive`, `expired→destructive`; etichetta di `completed` = «Ritirato».
- [ ] **Step 2: Verifica FAIL** — `bun run --cwd apps/customer test order-status-badge`.
- [ ] **Step 3: Implementa** — `CLASSES` diventa `Record<OrderStatus, { tone; icon }>` (icone dalla spec, `pending` = `CreditCardIcon`); via il pallino saffron e il commento relativo.
- [ ] **Step 4: Verifica PASS** — `bun run --cwd apps/customer test` + `typecheck` + `lint`.
- [ ] **Step 5: Commit** — `feat(customer): stato degli ordini sullo StatusBadge`.

### Task 6: Verifica nel browser e pulizia

**Files:**
- Delete (checkout principale, non committata): `apps/admin/src/routes/status-badge-preview.tsx`; `git checkout apps/admin/src/routeTree.gen.ts` nel checkout principale.

- [ ] **Step 1: Avvia i dev server del worktree** (Global Constraints) e fai login sulle porte standard: admin, poi seller, poi customer (credenziali del seed in `apps/api/src/db/seed/`).
- [ ] **Step 2: Giro pagine, 1280 e 390 px, chiaro e scuro** — admin :3013 `/configurations/holidays`, `/sellers` (tab + lista con 3/6, una riga selezionata), `/sellers/<id>`, `/stores`, `/billing/subscriptions`, `/users`; seller :3012 `/orders`, `/orders/<id>`, `/pickup`, `/promotions`, `/promotions/<id>`, `/team`, `/billing`, `/profile`, `/products` (tab); customer :3011 `/orders`, `/orders/<id>`. Atteso: nessun badge a capo, nessuno scroll orizzontale della pagina a 390 px (`document.documentElement.scrollWidth ≤ innerWidth`).
- [ ] **Step 3: Contrasto** — su ogni pagina, script canvas su tutti i `[data-slot="status-badge"]`: minimo ≥ 4,5:1 in entrambi i temi. Atteso ~5,3:1.
- [ ] **Step 4: Tastiera** — Tab e frecce sulle `TabNav` di prodotti seller e venditori admin: focus visibile, contatori leggibili.
- [ ] **Step 5: Pulizia** — cancella la preview e ripristina `routeTree.gen.ts` nel checkout principale; ferma i vite del worktree.
- [ ] **Step 6: Niente nomi di colore nei badge** — `grep -rnE "(text|bg|border|ring|fill|stroke|outline)-(olive|brick|petrol)\b" apps packages/ui/src --include='*.tsx' --include='*.ts'` → solo `apps/seller/src/routes/_authenticated/index.tsx` (pallini di urgenza della home, fuori scope: non sono stati).
- [ ] **Step 7: Gate finali** — `typecheck`, `lint`, `test` per `packages/ui`, `apps/admin`, `apps/seller`, `apps/customer`; poi URL e porte a Marco per lo smoke, prima della PR.
