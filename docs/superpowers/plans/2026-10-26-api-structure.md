# Struttura delle cartelle dell'API — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dare ad `apps/api/src` una struttura con regole scritte e controllate (`http/`, `infra/`, `domain/`, `jobs/`,
`schemas/`, `lib/`, `modules/`), test con lo stesso albero, e risolvere quattro problemi di produzione dei cron e dei
log.

**Architecture:** sette PR in serie, una per fase. Le fasi 1–6 spostano file con `git mv` e riscrivono gli import
`@/…` con `sed`: nessun cambio di comportamento, verificato con uno snapshot di route + spec OpenAPI uguale a `main`.
La fase 7 è l'unica che cambia comportamento (lock dei job, `Europe/Rome`, shutdown ordinato, log JSON su stdout in
produzione).

**Tech Stack:** Bun 1.4, Hono 5 rc, Drizzle 0.45 + `pg`, Zod, croner 6.0.7, pino 10, testcontainers.

**Spec:** `docs/superpowers/specs/2026-10-26-api-structure-design.md` (leggilo prima: tabella "Dove va ogni file",
regole A–C, fase 7).

## Global Constraints

- Fasi 1–6: route, payload, status e spec OpenAPI identici a `main` (snapshot `cmp` uguale).
- Nessuna dipendenza nuova.
- Non creare file dell'API con un percorso che esiste in `apps/{admin,customer,seller}/src/` (oggi: `components/`,
  `env.ts`, `features/`, `hooks/`, `lib/<nomi dei FE>`, `paraglide/`, `router.tsx`, `routes/`, `routeTree.gen.ts`,
  `server.ts`, `styles.css`): l'alias `@/` dei frontend lo ombreggerebbe.
- Export di pacchetto invariati nei nomi: `@bibs/api`, `@bibs/api/schemas`, `@bibs/api/validation-rule`; i file
  esportati (`schemas/forms/**`, `validation-rule.ts`) usano solo import relativi.
- Ogni percorso passato a `mock.module` nei test esiste in `src/`.
- Ogni fase è una PR verde da sola, branch nuovo da `origin/main` aggiornato; mai commit su `main`, mai force push.
- Commit Conventional con scope `api` (lefthook li controlla), chiusi da
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; body delle PR chiuso da
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Ogni PR aggiorna i percorsi che sposta in: `apps/api/AGENTS.md`, `apps/api/README.md`, `AGENTS.md` di root,
  `docs/architecture.md`, `docs/pagamenti.md`, `docs/stripe-billing.md`, `.github/workflows/ci.yml` (commento su
  `@/lib/env`), e nei commenti dei frontend che citano `apps/api/src/lib/…`. Mai gli spec/piani vecchi in
  `docs/superpowers/` né `docs/audit/`.

## Review Focus

- **Mock rimasto sul percorso vecchio:** il test non fallisce, usa Stripe/S3/email veri o passa per caso. Coperto da
  `check-mocks.sh` in `verify.sh` (Task 0), che gira in ogni fase.
- **File dell'API ombreggiato da un frontend:** il typecheck di un FE si rompe o, peggio, risolve un tipo sbagliato.
  Coperto da `check-shadow.sh` + typecheck dei tre FE in `verify.sh`.
- **Route o spec cambiati da uno spostamento** (ordine dei middleware, `registration/` spezzato, tag OpenAPI): coperto
  dallo snapshot in `verify.sh`.
- **Un test spostato fuori da `tests/unit` o `tests/integration` smette di girare in silenzio:** Task 10 confronta il
  numero di test eseguiti prima e dopo e controlla che nessun `*.test.ts` resti fuori dalle due cartelle.
- **Il controllo delle regole A–C dà verde perché la regex non vede gli import:** Task 6 testa il checker su sorgenti
  finti con una violazione per regola, oltre che sul codice vero.

---

### Task 0: Preparazione (worktree, script di verifica, baseline)

Niente commit in questo task. `W` = `/Users/marcogelli/repos/jelaz/bibs/.claude/worktrees/api-structure` (branch
`docs/api-structure-design`, contiene spec e piano). `S` = la cartella scratchpad della sessione (percorso assoluto).
Tutti i comandi partono da `W` salvo indicazione.

- [ ] **Step 1: Dipendenze nel worktree**

Run: `bun install --frozen-lockfile` (da `W`). Expected: exit 0.

- [ ] **Step 2: File env di sviluppo nello scratchpad**

Il `cp` dei `.env` è vietato: scrivi `$S/api.env` con i valori pubblici di sviluppo (stessi di `smoke.env` in CI, host
`localhost`):

```
DATABASE_URL=postgres://pgadmin:P4ssword!@localhost:5432/bibs-db
BETTER_AUTH_SECRET=dev-structure-secret-0123456789abcdef
BETTER_AUTH_URL=http://localhost:3000
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=seaweedadmin
S3_SECRET_KEY=P4ssword!
S3_BUCKET=bibs-images
STRIPE_SECRET_KEY=sk_test_placeholder
STRIPE_WEBHOOK_SECRET=whsec_placeholder
```

- [ ] **Step 3: Script nello scratchpad**

`$S/mv.sh` (da usare con `source`; le graffe servono a zsh):

```bash
rw() {
	local old=$1 new=$2
	grep -rlE "\"@/${old}[/\"]" apps/api/src apps/api/tests | while read -r f; do
		sed -i '' -E "s#\"@/${old}([/\"])#\"@/${new}\1#g" "$f"
	done
}
mvimp() {
	local src=apps/api/src old=$1 new=$2 from to
	if [ -d "$src/$old" ]; then from=$src/$old; to=$src/$new; else from=$src/$old.ts; to=$src/$new.ts; fi
	mkdir -p "$(dirname "$to")" && git mv "$from" "$to" && rw "$old" "$new"
}
```

`mvimp <vecchio> <nuovo>` sposta un file (senza `.ts`) o una cartella sotto `apps/api/src` e riscrive ogni
`"@/<vecchio>"` e `"@/<vecchio>/…"` in `src/` e `tests/` (import statici, dinamici e stringhe di `mock.module`). `rw`
fa solo la riscrittura: dopo un `git merge origin/main` va rilanciato sulle coppie della fase, perché un file arrivato
da `main` può importare il percorso vecchio. Salva le coppie di ogni fase in `$S/phase-N.pairs` (una coppia per riga)
e rilanciale con `while read -r o n; do rw "$o" "$n"; done < $S/phase-N.pairs`.

`$S/snapshot.ts` (route + spec OpenAPI; deterministico, verificato su `main` `e60c2ddc`: 183 route, 198 path):

```ts
// Uso (cwd apps/api): bun --env-file=<env> <questo file> <out.json>
const cwd = process.cwd();
const { app } = await import(`${cwd}/src/app.ts`);
const { inspectRoutes } = await import(Bun.resolveSync("hono/dev", cwd));
const routes = inspectRoutes(app)
	.filter((r: { isMiddleware: boolean }) => !r.isMiddleware)
	.map((r: { method: string; path: string }) => `${r.method} ${r.path}`);
const res = await app.request("http://localhost/openapi/json");
const spec = await res.json();
await Bun.write(process.argv[2], JSON.stringify({ routes, spec }, null, 1));
process.exit(0);
```

`$S/check-mocks.sh` (cwd `apps/api`):

```bash
missing=0
for p in $(perl -0777 -ne 'while(/mock\.module\(\s*"@\/([^"]+)"/g){print "$1\n"}' $(find tests -name '*.ts') | sort -u); do
	[ -e "src/$p.ts" ] || [ -e "src/$p/index.ts" ] || [ -e "src/$p.tsx" ] || { echo "MOCK SENZA FILE: @/$p"; missing=1; }
done
exit $missing
```

`$S/check-shadow.sh` (cwd root del worktree):

```bash
bad=0
while read -r f; do
	mod=${f%.ts}
	for a in admin customer seller; do
		for cand in "$mod.ts" "$mod.tsx" "$mod/index.ts" "$mod/index.tsx"; do
			if [ -e "apps/$a/src/$cand" ]; then echo "OMBRA: apps/$a/src/$cand copre apps/api/src/$f"; bad=1; fi
		done
	done
done < <(cd apps/api/src && find . -name '*.ts' -not -path './db/migrations/*' | sed 's|^\./||')
exit $bad
```

`$S/verify.sh` (cwd root del worktree; esce al primo errore):

```bash
set -euo pipefail
S=<percorso assoluto dello scratchpad>
bash "$S/check-shadow.sh"
cd apps/api
bash "$S/check-mocks.sh"
bun run typecheck
for a in admin customer seller; do (cd ../$a && bun run typecheck); done
bun --env-file="$S/api.env" "$S/snapshot.ts" "$S/snapshot.after.json" >/dev/null
cmp "$S/snapshot.base.json" "$S/snapshot.after.json"
bun --env-file="$S/api.env" run db:generate
test -z "$(git status --porcelain src/db/migrations)"
bun run test
(cd ../.. && bun run lint)
echo "VERIFY OK"
```

`bun run test` richiede Docker acceso (testcontainers). Mai `bun test` da solo: salta `--isolate`.

- [ ] **Step 4: Baseline da `origin/main`**

Run (cwd `W/apps/api`): `bun --env-file=$S/api.env $S/snapshot.ts $S/snapshot.base.json`
Expected: file scritto; un secondo giro su `$S/snapshot.rerun.json` è identico (`cmp` exit 0).

- [ ] **Step 5: La verifica passa sul codice di partenza**

Run: `bash $S/verify.sh`. Expected: `VERIFY OK`. Se fallisce qui, il problema è nell'ambiente, non nel lavoro: fermati
e risolvilo prima di spostare file.

---

## Fase 1 — Job (PR `refactor(api): job in src/jobs con lo scheduler`)

### Task 1: Tutti i job in `src/jobs/`

**Files:**
- Move: `src/lib/jobs/{expire-reservations,expire-unpaid-orders,retry-store-transfers}.ts` → `src/jobs/`
- Move: `src/plugins/cron.ts` → `src/jobs/scheduler.ts`
- Modify: gli import (via `mvimp`), `apps/api/AGENTS.md` (sezioni Middleware/cron, "Reservation Expiry"), docs con i
  percorsi vecchi

**Interfaces:**
- Produces: `@/jobs/scheduler` → `startCronJobs(): Cron[]`; `@/jobs/expire-reservations` →
  `expireReservations`, `expireSingleReservation`, `reservationGraceCutoff`; `@/jobs/expire-unpaid-orders` →
  `expireUnpaidOrders`, `cancelUnpaidOrder`; `@/jobs/retry-store-transfers` → `retryStoreTransfers` (nomi invariati).

- [ ] **Step 1: Branch** — `git switch -c refactor/api-jobs` (da `docs/api-structure-design`: la PR porta anche spec e
  piano).
- [ ] **Step 2: Sposta** — `source $S/mv.sh`, poi:
  `mvimp lib/jobs/expire-reservations jobs/expire-reservations`,
  `mvimp lib/jobs/expire-unpaid-orders jobs/expire-unpaid-orders`,
  `mvimp lib/jobs/retry-store-transfers jobs/retry-store-transfers`, `mvimp plugins/cron jobs/scheduler`.
  Salva le coppie in `$S/phase-1.pairs`. Expected: `src/lib/jobs/` non esiste più.
- [ ] **Step 3: Documentazione** — in `apps/api/AGENTS.md` togli `cron.ts` dall'elenco di `src/plugins/` e aggiungi una
  sezione `### Jobs — src/jobs/` con il testo che oggi descrive `cron.ts` (cinque job, orari, solo `src/index.ts` li
  avvia); correggi i percorsi in "Reservation Expiry" e "Server". Poi
  `grep -rn "lib/jobs\|plugins/cron" AGENTS.md apps/api/AGENTS.md apps/api/README.md docs/*.md apps/*/src` → vuoto.
- [ ] **Step 4: Verifica** — `bash $S/verify.sh` → `VERIFY OK`.
- [ ] **Step 5: Commit** — `git add -A apps/api AGENTS.md docs && git commit` con messaggio
  `refactor(api): job in src/jobs con lo scheduler`. Expected: `git show --stat -M HEAD` mostra rinomine (`R`).
- [ ] **Step 6: PR e merge** — `git push -u origin refactor/api-jobs`; PR con titolo uguale al commit, body: cosa
  sposta, "nessun cambio di comportamento", esito di `verify.sh`, link allo spec. Se il classificatore blocca
  `gh pr create`, scrivi il body in `$S/pr-1.md` e passa a Marco `! gh pr create --base main --title "…" --body-file $S/pr-1.md`.
  Aspetta tutti i check verdi (anche "Docker image (api)", che avvia l'immagine e chiama `/ready`). Il merge
  (`gh pr merge <n> --squash --delete-branch`, mai `--subject`) lo fa Marco o lo fai tu se lo ha chiesto
  esplicitamente. Poi `git fetch --prune`.

---

## Fase 2 — HTTP (PR `refactor(api): middleware e helper HTTP in src/http`)

### Task 2: `plugins/` dentro `http/`, helper HTTP fuori da `lib/`

**Files:**
- Move: `src/plugins/{request-log,rate-limit,better-auth}.ts` → `src/http/middleware/`
- Move: `src/plugins/health.ts` → `src/http/health.ts`; `src/plugins/openapi.ts` → `src/http/openapi-routes.ts`
- Move: `src/lib/{responses,auth-errors,deep-trim,validation-rule}.ts` → `src/http/`
- Merge: `src/plugins/cors.ts` + `src/lib/cors.ts` → `src/http/middleware/cors.ts`
- Merge: `src/lib/validation-message.ts` dentro `src/http/validation-message.ts`
- Modify: `apps/api/package.json` (`"./validation-rule": { "default": "./src/http/validation-rule.ts" }`), docs

**Interfaces:**
- Produces: `@/http/middleware/{request-log,rate-limit,better-auth,cors}`, `@/http/health`, `@/http/openapi-routes`,
  `@/http/{responses,auth-errors,deep-trim,validation-rule,validation-message}`; export invariati nei nomi.

- [ ] **Step 1: Branch** — `git switch -c refactor/api-http origin/main`.
- [ ] **Step 2: Spostamenti semplici** — `mvimp` per: `plugins/request-log http/middleware/request-log`,
  `plugins/rate-limit http/middleware/rate-limit`, `plugins/better-auth http/middleware/better-auth`,
  `plugins/cors http/middleware/cors`, `plugins/health http/health`, `plugins/openapi http/openapi-routes`,
  `lib/responses http/responses`, `lib/auth-errors http/auth-errors`, `lib/deep-trim http/deep-trim`,
  `lib/validation-rule http/validation-rule`. Coppie in `$S/phase-2.pairs`. Expected: `src/plugins/` vuota e rimossa.
- [ ] **Step 3: Fusione `cors`** — sposta gli export di `src/lib/cors.ts` in testa a `src/http/middleware/cors.ts`
  (corpo identico; l'import `@/lib/cors` del middleware sparisce), `git rm src/lib/cors.ts`,
  `rw lib/cors http/middleware/cors`.
- [ ] **Step 4: Fusione `validation-message`** — porta il contenuto di `src/lib/validation-message.ts` in
  `src/http/validation-message.ts` (corpo identico; il suo import `./validation-rule` resta valido nella stessa
  cartella; l'import `@/lib/validation-message` del file http sparisce), `git rm src/lib/validation-message.ts`,
  `rw lib/validation-message http/validation-message`. Se due nomi collidono, il typecheck lo dice: rinomina quello
  privato.
- [ ] **Step 5: Export** — in `apps/api/package.json` aggiorna il percorso di `./validation-rule`. Expected: i due import
  `@bibs/api/validation-rule` del seller compilano (lo dice il typecheck in `verify.sh`).
- [ ] **Step 6: Documentazione** — `apps/api/AGENTS.md`: la sezione "Middleware — `src/plugins/`" diventa
  "Middleware — `src/http/middleware/`" con `health.ts` e `openapi-routes.ts` in `src/http/`; aggiorna i rimandi a
  `lib/responses.ts`, `lib/cors.ts`, `lib/validation-message.ts`. `grep -rn "src/plugins\|plugins/\|lib/cors\|lib/responses\|lib/validation-" AGENTS.md apps/api/AGENTS.md apps/api/README.md docs/*.md apps/*/src`
  → solo occorrenze non legate all'API.
- [ ] **Step 7: Verifica** — `bash $S/verify.sh` → `VERIFY OK`.
- [ ] **Step 8: Commit** `refactor(api): middleware e helper HTTP in src/http`, poi PR e merge come Task 1 Step 6
  (body in `$S/pr-2.md`).

---

## Fase 3 — Infra (PR `refactor(api): adattatori esterni in src/infra`)

### Task 3: Adattatori da `lib/` a `infra/`

**Files:**
- Move: `src/lib/{env,logger,s3,stripe,email,auth,permissions,retry}.ts` → `src/infra/`; `src/lib/geocoding/` →
  `src/infra/geocoding/`
- Modify: `src/types.ts` (`./lib/auth` → `./infra/auth`), `tests/preload.ts` (commento), `.github/workflows/ci.yml`
  (commento riga ~56), `apps/api/AGENTS.md` (Environment, Email, Logging, Auth, Hono CLI: `src/lib/s3.ts` importa da
  `bun`), README

**Interfaces:**
- Produces: `@/infra/{env,logger,s3,stripe,email,auth,permissions,retry}`, `@/infra/geocoding/*`; export invariati.

- [ ] **Step 1: Branch** — `git switch -c refactor/api-infra origin/main`.
- [ ] **Step 2: Sposta** — `mvimp` per `lib/env infra/env`, `lib/logger infra/logger`, `lib/s3 infra/s3`,
  `lib/stripe infra/stripe`, `lib/email infra/email`, `lib/auth infra/auth`, `lib/permissions infra/permissions`,
  `lib/retry infra/retry`, `lib/geocoding infra/geocoding`. Coppie in `$S/phase-3.pairs`.
- [ ] **Step 3: Import relativi** — `src/types.ts`: `export type { auth } from "./infra/auth";`.
- [ ] **Step 4: Mock** — Run (cwd `apps/api`): `bash $S/check-mocks.sh` → exit 0, e
  `grep -rnE 'mock\.module\(\s*"@/lib/(env|s3|stripe|email|geocoding|logger|auth)' tests` → vuoto (erano 71 stringhe).
- [ ] **Step 5: Documentazione** — percorsi aggiornati nei file elencati sopra;
  `grep -rnE "lib/(env|logger|s3|stripe|email|auth|permissions|retry|geocoding)" AGENTS.md apps/api/AGENTS.md apps/api/README.md docs/*.md .github apps/api/tests/preload.ts`
  → vuoto.
- [ ] **Step 6: Verifica** — `bash $S/verify.sh` → `VERIFY OK`.
- [ ] **Step 7: Commit** `refactor(api): adattatori esterni in src/infra`, PR e merge come Task 1 Step 6.

---

## Fase 4 — Domain (PR `refactor(api): regole condivise in src/domain`)

### Task 4: Controllo automatico delle regole A–C (rosso)

**Files:**
- Create: `apps/api/tests/unit/architecture.test.ts`

**Interfaces:**
- Produces: nel file di test, `function violations(files: Map<string, string>): string[]` — chiavi = percorsi relativi
  a `src/` (`modules/seller/services/orders.ts`), valori = sorgente; restituisce righe `"<file> → <import>: regola X"`.

- [ ] **Step 1: Branch** — `git switch -c refactor/api-domain origin/main`.
- [ ] **Step 2: Scrivi il test**

`violations` estrae gli specificatori con `/(?:from\s+|import\s*\(\s*)"([^"]+)"/g` (import, export…from, import
dinamici), risolve i relativi (`./`, `../`) contro la cartella del file in un percorso `src/`-relativo, ignora i
pacchetti npm, e applica:
- **A**: file in `modules/X/` che importa `modules/Y/` con Y ≠ X;
- **B**: file fuori da `modules/` che importa `modules/`, esclusi `app.ts`, `types.ts`, `db/seed/**`, `scripts/**`;
- **C**: file in `lib/` che importa qualcosa fuori da `lib/` e `db/` (`@/db` compreso).

```ts
describe("violations (il checker)", () => {
	it("trova una violazione per regola", () => {
		const files = new Map([
			["modules/customer/services/a.ts", 'import { x } from "@/modules/seller/services/b";'],
			["jobs/j.ts", 'const m = await import("@/modules/billing/services/c");'],
			["lib/l.ts", 'export { y } from "@/infra/env";'],
			["modules/seller/routes/r.ts", 'import { z } from "../../customer/services/d";'],
			["modules/seller/routes/ok.ts", 'import { w } from "../services/e";'],
			["app.ts", 'import { sellerApp } from "@/modules/seller";'],
		]);
		expect(violations(files)).toEqual([
			"modules/customer/services/a.ts → modules/seller/services/b: regola A",
			"jobs/j.ts → modules/billing/services/c: regola B",
			"lib/l.ts → infra/env: regola C",
			"modules/seller/routes/r.ts → modules/customer/services/d: regola A",
		]);
	});
});

describe("struttura di src/", () => {
	it("rispetta le regole A–C", async () => {
		// legge ogni *.ts sotto src/ (escluse db/migrations) con Bun.Glob
		expect(violations(await readSrc())).toEqual([]);
	});
});
```

- [ ] **Step 3: Rosso** — Run (cwd `apps/api`): `bun test tests/unit/architecture.test.ts`.
  Expected: il primo test PASS; il secondo FAIL con almeno queste violazioni: `customer → seller/services/discount-pricing`
  (6), `seller/services/orders → customer/services/orders`, `admin/services/sellers → seller/services/…` (2),
  `seller/… → billing/…`, `http/auth.ts → modules/seller/context` (B), `jobs/… → modules/billing/…` (B), e la regola C
  per i file di `lib/` che oggi importano `infra/` (es. `admin-notifications`, `characteristic-impact`,
  `order-helpers`). Se il primo test fallisce, correggi il checker prima di andare avanti.
- [ ] **Step 4: Commit** `test(api): controllo degli import tra cartelle` (rosso fino al Task 6, nella stessa PR).

### Task 5: Spostamenti in `domain/` e nei moduli

**Files:** (tutti via `mvimp`; tabella completa nello spec)
- `lib/{connect-status,platform-fee,online-charge}` → `domain/billing/`
- `modules/billing/services/connect-account` → `domain/billing/connect-account`;
  `modules/billing/services/customer` → `domain/billing/stripe-customer`;
  `modules/billing/services/order-payments` → `domain/billing/order-payments`; poi `git rm src/modules/billing/index.ts`
- `lib/{order-state-machine,order-helpers,order-types,pickup-code}` → `domain/orders/`
- `modules/seller/services/discount-pricing` → `domain/pricing/discount-pricing`; `lib/vat` → `domain/pricing/vat`
- `lib/{opening-hours,store-open-status,store-visibility}` → `domain/stores/`; `lib/holidays` → `domain/holidays`
- `lib/{characteristic-values,characteristic-impact}` → `domain/catalog/`
- `modules/seller/services/onboarding-notifications` → `domain/sellers/onboarding-notifications`
- `lib/countries` → `modules/locations/services/countries`; `lib/{municipality,user-summary,admin-notifications}` →
  `modules/seller/services/`; `lib/points-allocation` → `modules/customer/services/points-allocation`

**Interfaces:**
- Produces: `@/domain/billing/{connect-status,platform-fee,online-charge,connect-account,stripe-customer,order-payments}`,
  `@/domain/orders/{order-state-machine,order-helpers,order-types,pickup-code}`,
  `@/domain/pricing/{discount-pricing,vat}`, `@/domain/stores/{opening-hours,store-open-status,store-visibility}`,
  `@/domain/holidays/*`, `@/domain/catalog/{characteristic-values,characteristic-impact}`,
  `@/domain/sellers/onboarding-notifications`; export invariati.

- [ ] **Step 1: Prima di togliere `modules/billing/index.ts`** — `grep -rn '"@/modules/billing"' apps/api` → vuoto
  (oggi i chiamanti importano già `services/customer` direttamente).
- [ ] **Step 2: Sposta** — i `mvimp` dell'elenco, coppie in `$S/phase-4.pairs`.
- [ ] **Step 3: Commenti dei FE** — aggiorna i percorsi in `apps/customer/src/features/stores/format-opening-hours.ts`,
  `apps/seller/src/features/stores/lib/validate-opening-hours.ts`, `apps/seller/src/features/orders/pickup-code.ts`.
- [ ] **Step 4: Typecheck** — Run (cwd `apps/api`): `bun run typecheck` → exit 0; `bash $S/check-mocks.sh` → exit 0.
- [ ] **Step 5: Commit** `refactor(api): regole condivise in src/domain` (stessa PR della fase).

### Task 6: Funzioni condivise estratte, regole A–C verdi

**Files:**
- Create: `src/domain/orders/reservation-expiry.ts` (← `expireSingleReservation`, `reservationGraceCutoff` da
  `src/jobs/expire-reservations.ts`)
- Create: `src/domain/orders/unpaid-orders.ts` (← `cancelUnpaidOrder` da `src/jobs/expire-unpaid-orders.ts`)
- Modify: `src/domain/orders/order-types.ts` (← `PAY_TYPES`), `src/domain/orders/order-state-machine.ts`
  (← `assertCancellable`), entrambi da `src/modules/customer/services/orders.ts`
- Create: `src/domain/sellers/documents.ts` (← `deleteDocumentImage` da `src/modules/seller/services/settings.ts`)
- Create: `src/domain/sellers/access.ts` (← `resolveSellerAccess`, `getSellerStoreIds`, `getAccessibleStoreIdsFor`,
  `AccessCtx` da `src/modules/seller/context.ts`, più tutto `src/modules/seller/services/access.ts`, che sparisce)
- Modify: tutti i chiamanti (job, `seller/services/orders.ts`, `webhooks/services/handlers/payment-intent.ts`,
  `admin/services/sellers.ts`, `seller/services/settings.ts`, `seller/context.ts`, `http/auth.ts`, `db/seed/fixtures/*`)

**Interfaces:**
- Consumes: Task 5.
- Produces: `@/domain/orders/reservation-expiry` → `expireSingleReservation`, `reservationGraceCutoff(now?: Date): Date`;
  `@/domain/orders/unpaid-orders` → `cancelUnpaidOrder(orderId: string): Promise<boolean>`;
  `@/domain/orders/order-types` → `PAY_TYPES`; `@/domain/orders/order-state-machine` → `assertCancellable`;
  `@/domain/sellers/documents` → `deleteDocumentImage(key, sellerProfileId, action)`; `@/domain/sellers/access` →
  `resolveSellerAccess`, `getSellerStoreIds`, `getAccessibleStoreIdsFor`, `AccessCtx` + gli export di
  `services/access.ts`. Firme e corpi identici.

- [ ] **Step 1: Estrai** — sposta le funzioni con corpo identico; nessun re-export dai file vecchi: ogni chiamante importa
  dal nuovo percorso. `seller/context.ts` tiene gli helper usati solo dalle route del seller (`ensure*`, `requireOwner`)
  e importa da `@/domain/sellers/access` ciò che gli serve.
- [ ] **Step 2: Verde** — Run (cwd `apps/api`): `bun test tests/unit/architecture.test.ts` → 2 pass. Se resta una
  violazione, applica le regole 1–5 dello spec al file che la causa.
- [ ] **Step 3: Documentazione** — `apps/api/AGENTS.md`: nuova sezione `### Struttura di src/` con le cinque regole
  "dove va un file" e le regole A–C dello spec (e il rimando a `tests/unit/architecture.test.ts`); aggiorna
  "Order State Machine", "Order Helpers", "Reservation Expiry", "Modules" (`billing/` non è più un modulo:
  `src/domain/billing/`), "Guards" (`resolveSellerAccess` in `src/domain/sellers/access.ts`). Stesso per
  `docs/pagamenti.md`, `docs/stripe-billing.md`, `docs/architecture.md`.
- [ ] **Step 4: Verifica** — `bash $S/verify.sh` → `VERIFY OK`.
- [ ] **Step 5: Commit** `refactor(api): funzioni condivise in src/domain e controllo degli import`, poi PR della fase e
  merge come Task 1 Step 6.

---

## Fase 5 — Schemi e moduli (PR `refactor(api): schemi in src/schemas e registration come gli altri moduli`)

### Task 7: `lib/schemas` → `schemas/`, `lib/utils/csv` → `lib/csv`

**Files:**
- Move: `src/lib/schemas/` → `src/schemas/`; `src/lib/utils/csv.ts` → `src/lib/csv.ts`
- Modify: `apps/api/package.json` (`"./schemas": { "default": "./src/schemas/forms/index.ts" }`), docs

- [ ] **Step 1: Branch** — `git switch -c refactor/api-schemas origin/main`.
- [ ] **Step 2: Sposta** — `mvimp lib/schemas schemas`, `mvimp lib/utils/csv lib/csv`; `src/lib/utils/` vuota e
  rimossa. Coppie in `$S/phase-5.pairs`. Aggiorna l'export `./schemas`.
- [ ] **Step 3: Solo import relativi negli export** — Run: `grep -rn '"@/' apps/api/src/schemas/forms apps/api/src/http/validation-rule.ts`
  → vuoto.
- [ ] **Step 4: Typecheck** — `bun run typecheck` in api e nei tre FE → exit 0.
- [ ] **Step 5: Commit** `refactor(api): schemi in src/schemas`.

### Task 8: `registration/` con `routes/` e `services/`

**Files:**
- Move: `src/modules/registration/services.ts` → `src/modules/registration/services/registration.ts`
- Create: `src/modules/registration/routes/registration.ts` — `export const registrationRoutes = new Hono()` con le
  quattro `.post(...)` di oggi, nello stesso ordine e identiche, più `MINUTE`, `HOUR` e gli export
  `RegisterCustomerResponse`, `RegisterSellerResponse`, `SignInResponse`
- Modify: `src/modules/registration/index.ts` →
  `export const registrationApp = moduleApp().route("/", registrationRoutes);` + `export type RegistrationApp`, come
  `src/modules/me/index.ts`

**Interfaces:**
- Produces: `@/modules/registration` → `registrationApp`, `RegistrationApp` (invariati);
  `@/modules/registration/services/registration` → `registerCustomer`, `registerSeller`, `signIn`, `acceptInvite`,
  `decideExistingUser` e gli altri export di oggi.

- [ ] **Step 1: Sposta i servizi** — `mvimp modules/registration/services modules/registration/services/registration`
  (aggiorna anche le 7 stringhe nei test, comprese quelle di `mock.module` e degli `await import`).
- [ ] **Step 2: Separa le route** — crea `routes/registration.ts` e riduci `index.ts`. Se un test o un FE importa
  `RegisterCustomerResponse` & co. da `@/modules/registration`, aggiorna l'import a `…/routes/registration`.
- [ ] **Step 3: Verifica** — `bash $S/verify.sh` → `VERIFY OK` (lo snapshot prova che route e spec non cambiano).
- [ ] **Step 4: Documentazione** — `apps/api/AGENTS.md` (sezione Schemas: `src/schemas/`; Modules: `registration/`
  come gli altri), README; `grep -rn "lib/schemas\|lib/utils" AGENTS.md apps/api/AGENTS.md apps/api/README.md docs/*.md`
  → vuoto.
- [ ] **Step 5: Commit** `refactor(api): registration con routes e services come gli altri moduli`, PR della fase
  (titolo: `refactor(api): schemi in src/schemas e registration come gli altri moduli`) e merge come Task 1 Step 6.

---

## Fase 6 — Test (PR `refactor(api): test con lo stesso albero di src`)

### Task 9: Mappa dei test

**Files:**
- Create: `$S/tests-map.txt` (righe `vecchio nuovo`, percorsi relativi a `apps/api/tests/`)

Regole (in ordine):
1. `tests/http/**` (con `golden/` e `parity-cases.ts`, come cartella) → `unit/http/`.
2. Ogni altro file di `tests/{unit,lib,modules,plugins}` → `unit/<cartella del file di src/ che testa>/`, cioè il primo
   import `@/…` non di `db/schemas`, `http/app` o `http/validator`. Esempi: `lib/vat.test.ts` →
   `unit/domain/pricing/`, `lib/holidays/*` → `unit/domain/holidays/`, `lib/logger.test.ts` → `unit/infra/`,
   `unit/geocoding-*.test.ts` → `unit/infra/geocoding/`, `modules/seller-*.test.ts` → `unit/modules/seller/`,
   `lib/queries.test.ts`, `lib/date-format.test.ts`, `lib/identity-document.test.ts`,
   `unit/seller-rejection-schema.test.ts` → `unit/schemas/`, `unit/*-schema.test.ts` sui `db/schemas` e
   `unit/seed-*.test.ts` → `unit/db/`, `plugins/normalize.test.ts`, `plugins/error-handler.test.ts`,
   `plugins/request-id.test.ts` → `unit/http/`, `modules/integer-inputs.test.ts` → `unit/http/`.
3. `unit/rate-limit.test.ts` → `unit/http/middleware/rate-limit.test.ts`; `plugins/rate-limit.test.ts` →
   `unit/http/middleware/rate-limit-routes.test.ts`; `unit/cors-origin.test.ts` → `unit/http/middleware/`.
4. `tests/integration/*` per prefisso: `admin-*` → `integration/modules/admin/`; `customer-*`, `loyalty-points-race` →
   `integration/modules/customer/`; `seller-*`, `request-notifications` → `integration/modules/seller/`;
   `stripe-webhook-*` → `integration/modules/webhooks/`; `registration-*` → `integration/modules/registration/`;
   `me-*` → `integration/modules/me/`; `locations-*`, `geocode-service` → `integration/modules/locations/`;
   `geocoding-*` → `integration/infra/geocoding/`; `auth-*` → `integration/infra/`; `job-*` → `integration/jobs/`;
   `billing-customer`, `connect-account` → `integration/domain/billing/`; `order-*` → `integration/domain/orders/`;
   `discount-pricing-parity` → `integration/domain/pricing/`; `characteristic-impact` → `integration/domain/catalog/`;
   `db-enum-check-constraints`, `product-characteristics-schema`, `seed-orders` → `integration/db/`;
   `isolation-guard-*` restano in `integration/`.
5. Nomi dei file invariati salvo collisioni (regola 3). `helpers/` e `preload.ts` non si spostano.

- [ ] **Step 1: Branch** — `git switch -c refactor/api-tests origin/main`.
- [ ] **Step 2: Conta prima** — Run (cwd `apps/api`): `bun run test:unit 2>&1 | tail -5` e
  `bun test tests/integration --parallel=4 --isolate --timeout 180000 2>&1 | tail -5`; annota i "N pass" in
  `$S/test-counts.before`. `find tests -name '*.test.ts' | wc -l` → annota.
- [ ] **Step 3: Scrivi la mappa** con le regole sopra. Expected: ogni `*.test.ts` fuori da `integration/` (radice) e
  dalle cartelle già finali compare una volta.

### Task 10: Sposta i test e correggi i percorsi relativi

**Files:**
- Create: `$S/mvtest.ts`
- Move: tutti i file della mappa
- Modify: `apps/api/package.json` (`"test:unit": "bun test tests/unit --isolate"`; `test:integration` invariato),
  `apps/api/AGENTS.md` (Commands: `tests/unit/`, `tests/integration/`), docs

**Interfaces:**
- Consumes: `$S/tests-map.txt` (Task 9).

- [ ] **Step 1: Script** — `$S/mvtest.ts` (cwd `apps/api`, `bun $S/mvtest.ts $S/tests-map.txt`). Due passate: prima
  calcola i testi nuovi con tutti i file ancora al loro posto, poi sposta e scrive. Le cartelle (es. `http/golden`) si
  spostano con `git mv` senza riscrittura.

```ts
import { existsSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
const pairs = (await Bun.file(process.argv[2]).text()).split("\n").filter((l) => l.trim())
	.map((l) => l.trim().split(/\s+/).map((p) => resolve("tests", p)) as [string, string]);
const moved = new Map(pairs);
const newPath = (abs: string) =>
	moved.get(abs) ?? moved.get(`${abs}.ts`)?.replace(/\.ts$/, "") ??
	[...moved].find(([o]) => abs.startsWith(`${o}/`))?.reduce((o, n) => abs.replace(o, n)) ?? abs;
const rewritten: [string, string, string | null][] = [];
for (const [from, to] of pairs) {
	if (statSync(from).isDirectory()) { rewritten.push([from, to, null]); continue; }
	const text = (await Bun.file(from).text()).replace(/(["'])(\.\.?\/[^"']*)\1/g, (m, q, spec) => {
		const target = resolve(dirname(from), spec);
		if (![target, `${target}.ts`, `${target}/index.ts`].some(existsSync)) return m;
		const rel = relative(dirname(to), newPath(target));
		return `${q}${rel.startsWith(".") ? rel : `./${rel}`}${q}`;
	});
	rewritten.push([from, to, text]);
}
for (const [from, to, text] of rewritten) {
	await Bun.$`mkdir -p ${dirname(to)} && git mv ${from} ${to}`;
	if (text !== null) await Bun.write(to, text);
}
```

- [ ] **Step 2: Sposta** — lancia lo script; rimuovi le cartelle vuote `tests/{lib,modules,plugins,http}`; aggiorna
  `test:unit`.
- [ ] **Step 3: Nessun test orfano** — Run (cwd `apps/api`):
  `find tests -name '*.test.ts' -not -path 'tests/unit/*' -not -path 'tests/integration/*'` → vuoto; il conteggio dei
  file `*.test.ts` è uguale a quello annotato.
- [ ] **Step 4: Stessi test** — rilancia i due comandi del Task 9 Step 2 (con `test:unit` nuovo). Expected: stessi "N
  pass" di `$S/test-counts.before`, 0 fail.
- [ ] **Step 5: Verifica** — `bash $S/verify.sh` → `VERIFY OK`.
- [ ] **Step 6: Commit** `refactor(api): test con lo stesso albero di src`, PR e merge come Task 1 Step 6.

---

## Fase 7 — Produzione (PR `fix(api): cron con lock e ora di Roma, shutdown ordinato, log su stdout in produzione`)

Unica fase che cambia comportamento: lo snapshot resta uguale (route e spec non cambiano), il resto lo provano i test
nuovi e il job Docker della CI.

### Task 11: Lock dei job, `Europe/Rome`, niente sovrapposizioni

**Files:**
- Create: `src/jobs/lock.ts`
- Modify: `src/jobs/scheduler.ts`
- Test: `tests/integration/jobs/lock.test.ts`, `tests/unit/jobs/scheduler.test.ts`

**Interfaces:**
- Produces: `runExclusive(lockKey: number, run: () => Promise<void>): Promise<boolean>` in `src/jobs/lock.ts` —
  `true` se ha eseguito, `false` se un'altra connessione tiene il lock; rilancia l'errore di `run` dopo aver liberato
  il lock. Nello scheduler ogni job ha `lockKey`: `expireReservations` 9101, `expireUnpaidOrders` 9102,
  `retryStoreTransfers` 9103, `autoCancelSuspendedStores` 9104, `expirePendingStoreCreations` 9105.

- [ ] **Step 1: Branch** — `git switch -c fix/api-production-jobs origin/main`.
- [ ] **Step 2: Test del lock (integration, DB di test come `tests/integration/jobs/job-expire-pending.test.ts`: mock
  di `@/db` con il Proxy su `getTestDb()`)**

```ts
it("un secondo runExclusive con la stessa chiave salta mentre il primo gira", async () => {
	const gate = Promise.withResolvers<void>();
	const first = runExclusive(9999, () => gate.promise);
	let secondRan = false;
	expect(await runExclusive(9999, async () => { secondRan = true; })).toBe(false);
	expect(secondRan).toBe(false);
	gate.resolve();
	expect(await first).toBe(true);
});
it("a job finito il lock è libero", async () => {
	expect(await runExclusive(9999, async () => {})).toBe(true);
});
it("un job che lancia libera il lock", async () => {
	await expect(runExclusive(9999, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
	expect(await runExclusive(9999, async () => {})).toBe(true);
});
```

- [ ] **Step 3: Rosso** — `bun test tests/integration/jobs/lock.test.ts` (dopo `bun run test:image`) → FAIL (modulo
  mancante).
- [ ] **Step 4: Implementa `runExclusive`** — una connessione dedicata dal pool (`db.$client.connect()`),
  `SELECT pg_try_advisory_lock($1)`; se `false` rilascia la connessione e restituisce `false`; altrimenti esegue `run`
  e in `finally` fa `SELECT pg_advisory_unlock($1)` e `release()`. Il lock è di sessione: va tenuta la stessa
  connessione per tutta la durata.
- [ ] **Step 5: Verde** — stesso comando → 3 pass.
- [ ] **Step 6: Test dello scheduler (unit)**

```ts
it("ogni job è in ora di Roma, con protect", () => {
	const crons = startCronJobs();
	try {
		const byName = new Map(crons.map((c) => [c.name, c]));
		const next = byName.get("autoCancelSuspendedStores")?.nextRun() as Date;
		const romeHour = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "numeric", hourCycle: "h23" }).format(next);
		expect(romeHour).toBe("3");
		expect([...byName.keys()].sort()).toEqual(["autoCancelSuspendedStores", "expirePendingStoreCreations", "expireReservations", "expireUnpaidOrders", "retryStoreTransfers"]);
		for (const c of crons) expect(c.options.protect).toBe(true);
	} finally {
		for (const c of crons) c.stop();
	}
});
```

  Se `c.options` non è pubblico in croner 6.0.7, sostituisci l'ultima asserzione con un controllo su `isBusy()` durante
  un `trigger()` (Task 12 Step 1 lo usa comunque).
- [ ] **Step 7: Rosso → implementa → verde** — in `scheduler.ts` ogni `Job` riceve `lockKey`; `new Cron(job.pattern,
  { name: job.name, timezone: "Europe/Rome", protect: true }, () => runExclusive(job.lockKey, job.run).then(() => {}))`;
  il `try/catch` con `logger.error` di ogni job resta dentro `run`. Run: `bun test tests/unit/jobs/scheduler.test.ts` →
  PASS.
- [ ] **Step 8: Commit** `fix(api): job con advisory lock, ora di Roma e senza sovrapposizioni`.

### Task 12: Shutdown ordinato

**Files:**
- Modify: `src/jobs/scheduler.ts` (+ `stopCronJobs`), `src/index.ts`
- Test: `tests/unit/jobs/scheduler.test.ts`; CI: `.github/workflows/ci.yml` (job "Docker image (api)")

**Interfaces:**
- Produces: `stopCronJobs(crons: Cron[], timeoutMs: number): Promise<void>` — ferma ogni Cron (nessun giro nuovo) e
  risolve quando nessuno è `isBusy()` o dopo `timeoutMs`.

- [ ] **Step 1: Test**

```ts
it("stopCronJobs aspetta il giro in corso", async () => {
	const gate = Promise.withResolvers<void>();
	const cron = new Cron("0 0 1 1 *", { protect: true }, () => gate.promise);
	cron.trigger();
	let done = false;
	const stopping = stopCronJobs([cron], 2_000).then(() => { done = true; });
	await Bun.sleep(50);
	expect(done).toBe(false);
	gate.resolve();
	await stopping;
	expect(done).toBe(true);
});
it("stopCronJobs non aspetta oltre il tetto", async () => {
	const cron = new Cron("0 0 1 1 *", { protect: true }, () => new Promise<void>(() => {}));
	cron.trigger();
	const t = performance.now();
	await stopCronJobs([cron], 100);
	expect(performance.now() - t).toBeLessThan(1_000);
});
```

- [ ] **Step 2: Rosso → implementa → verde** — `stopCronJobs`: `stop()` su tutti, poi poll di `isBusy()` ogni 50 ms
  fino al tetto. Se il test rivela che `isBusy()` non segue `trigger()` in croner 6.0.7, tieni un contatore dei giri
  attivi nel wrapper del job e usa quello (stessa firma).
- [ ] **Step 3: `src/index.ts`** — `const crons = startCronJobs();` e uno `shutdown` che: chiama `server.stop()` (non
  forzato: la Promise si risolve a richieste finite), poi aspetta insieme quella Promise e
  `stopCronJobs(crons, SHUTDOWN_TIMEOUT_MS)` con un tetto complessivo `SHUTDOWN_TIMEOUT_MS = 8_000` (sotto i 10 s di
  `docker stop`), poi `db.$client.end()` e `process.exit(0)`. Un secondo segnale durante lo shutdown non lo riavvia.
- [ ] **Step 4: CI** — nel job "Docker image (api)", dopo "Production build (no localhost CORS)", aggiungi lo step
  "Graceful stop": `docker stop -t 10 api` e `test "$(docker inspect -f '{{.State.ExitCode}}' api)" = 0`.
- [ ] **Step 5: Commit** `fix(api): shutdown che aspetta richieste e job prima di chiudere il pool`.

### Task 13: Log su stdout in produzione

**Files:**
- Modify: `src/infra/logger.ts`, `src/http/middleware/request-log.ts`, `apps/api/Dockerfile`, `.github/workflows/ci.yml`
- Test: `tests/unit/infra/logger-production.test.ts`

**Interfaces:**
- Produces: `logRequest(level: "info" | "warn" | "error", entry: RequestLogEntry): void` in `@/infra/logger` (rinomina di
  `logRequestToFile`): in produzione scrive la riga JSON (`type: "request"`, method, path, status, durationMs) con
  `logger` su stdout; altrove nel file come oggi.

- [ ] **Step 1: Test** — `mock.module("@/infra/env", () => ({ env: { ...process.env, NODE_ENV: "production" } }))` prima
  degli import dinamici di `@/infra/logger` e `@/http/middleware/request-log`; `spyOn(process.stdout, "write")` e
  `spyOn(console, "info")`; app `new Hono().use(requestLog).get("/x", (c) => c.text("ok"))`,
  `await app.request("http://localhost/x")`.

```ts
const lines = stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).filter((l) => l.includes('"type":"request"'));
expect(lines).toHaveLength(1);
expect(JSON.parse(lines[0])).toMatchObject({ type: "request", method: "GET", path: "/x", status: 200, level: "info" });
expect(consoleInfo).not.toHaveBeenCalled();
```

- [ ] **Step 2: Rosso** — `bun test tests/unit/infra/logger-production.test.ts` → FAIL.
- [ ] **Step 3: Implementa** — in `logger.ts` `mkdirSync`, `fileDest` e `fileLogger` solo se
  `env.NODE_ENV !== "production"`; in produzione `logger = pino(pinoOptions, process.stdout)`; `logRequest` sceglie
  `logger` o `fileLogger`. In `request-log.ts` la riga di testo (`console[SINK[level]](line)`) solo fuori produzione;
  `logRequest` sempre.
- [ ] **Step 4: Verde** — stesso comando → PASS; `bun run test:unit` → 0 fail (i golden e `logger.test.ts` girano con
  `NODE_ENV=test` e non cambiano).
- [ ] **Step 5: Dockerfile** — togli `&& mkdir -p logs && chown bibs:bibs logs` e il commento su `./logs`: se il codice
  provasse ancora a creare la cartella, l'avvio del container fallirebbe con `EACCES` e lo smoke della CI lo vedrebbe.
- [ ] **Step 6: CI** — nel job "Docker image (api)", dopo "Boot and /ready":
  `docker logs api | grep -q '"type":"request"'` (step "Request log on stdout").
- [ ] **Step 7: Documentazione** — `apps/api/AGENTS.md`: Logging (produzione: solo stdout JSON; sviluppo: come oggi),
  sezione Jobs (lock con chiavi 9101–9105, `Europe/Rome`, `protect`, **i job devono restare idempotenti: il lock evita
  le sovrapposizioni, non le riesecuzioni**), Server (sequenza di shutdown, tetto 8 s).
- [ ] **Step 8: Verifica** — `bash $S/verify.sh` → `VERIFY OK`.
- [ ] **Step 9: Commit** `fix(api): log JSON su stdout in produzione, niente logs/app.log`; PR della fase e merge come
  Task 1 Step 6. Prima del merge controlla che il job "Docker image (api)" sia verde con i due step nuovi.
