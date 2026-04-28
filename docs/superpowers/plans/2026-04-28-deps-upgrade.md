# Deps Upgrade (TanStack Start demo alignment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allineare lo stack del monorepo `bibs` (3 frontend + api) alle versioni del progetto demo TanStack Start: TS 6, Vite 8, Vitest 4, plugin-react 6, jsdom 28, ecosistema TanStack `latest`, più adozione di React Compiler e Nitro esplicito.

**Architecture:** Single PR su `main`-derived branch, 7 commit ordinati e bisectabili (uno per stage del design spec). Ogni commit ha gate di verifica obbligatorio prima del successivo. Catalog Bun centralizzato in `package.json` root come single source of truth per le versioni.

**Tech Stack:** TypeScript 6, Vite 8, Vitest 4, React 19.2, TanStack Start/Router/Query latest, Nitro, @rolldown/plugin-babel + babel-plugin-react-compiler, Bun 1.x, Biome, Lefthook.

**Riferimento spec:** `docs/superpowers/specs/2026-04-28-deps-upgrade-design.md`

---

## File Map

**Modify:**
- `package.json` (root): catalog versions + `devDependencies.typescript`
- `apps/admin/package.json`: rimuovere `vite-tsconfig-paths`, aggiungere 3 nuove devDeps
- `apps/customer/package.json`: rimuovere `vite-tsconfig-paths`, aggiungere 3 nuove devDeps
- `apps/seller/package.json`: rimuovere `vite-tsconfig-paths`, aggiungere 3 nuove devDeps
- `apps/admin/vite.config.ts`: drop `tsconfigPaths` plugin, add `nitro()`, add babel/React Compiler
- `apps/customer/vite.config.ts`: stesso refactor
- `apps/seller/vite.config.ts`: stesso refactor
- (reattivamente, se TS 6 lo richiede): file in `apps/api/src/**` o `apps/{admin,customer,seller}/src/**`

**Aggiornare se serve:** memoria `~/.claude/projects/-Users-marcogelli-repos-jelaz-bibs/memory/project_tanstack_react_start_pin.md` (Task 4.5).

**Non toccare:**
- `tsconfig.base.json` (root) — già OK per TS 6.
- `apps/*/tsconfig.json` — già OK.
- `packages/ui/package.json` — niente nello scope.
- `apps/api/package.json` — niente nello scope (TS è root).

---

## Pre-flight: branch + scope refresh

### Task 0: Setup branch e baseline verde

**Files:** nessuno (operazioni git/verifica ambiente)

- [ ] **Step 0.1: Verifica baseline pulita**

```bash
cd /Users/marcogelli/repos/jelaz/bibs
git status
git fetch origin
git log -1 --oneline
```

Expected: working tree clean, branch `main` allineato con `origin/main`.

- [ ] **Step 0.2: Crea branch dedicato**

```bash
git checkout -b chore/deps-upgrade-tanstack-demo-alignment
```

Expected: passaggio al nuovo branch, no errori.

- [ ] **Step 0.3: Baseline verde su typecheck/lint/test**

```bash
bun install
bun run typecheck
bun run lint
bun run test
```

Expected: tutti e 4 i comandi passano. Se uno fallisce, **fermati e segnala** — non si può attribuire un fallimento successivo all'upgrade se la baseline è già rotta.

- [ ] **Step 0.4: Smoke baseline browser (opzionale ma consigliato)**

In tre terminali separati:
```bash
bun run dev:admin     # localhost:3003
bun run dev:customer  # localhost:3001
bun run dev:seller    # localhost:3002
```

Aprire ognuno in browser, verificare che la home renderizzi senza errori console. Annotare qualsiasi warning preesistente per non confonderlo dopo. Chiudere i 3 dev server prima di proseguire.

---

## Stage 1 — TypeScript 6

### Task 1: Bump TypeScript al root

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1.1: Aggiorna la versione di TypeScript**

In `/Users/marcogelli/repos/jelaz/bibs/package.json`, sostituire:
```diff
   "devDependencies": {
     "@biomejs/biome": "^2.4.13",
     "concurrently": "^9.2.1",
     "lefthook": "^2.1.6",
-    "typescript": "^5.9.3"
+    "typescript": "^6.0.2"
   }
```

- [ ] **Step 1.2: Installa**

```bash
bun install
```

Expected: install succeeds. `bun.lock` updated.

- [ ] **Step 1.3: Verifica versione installata**

```bash
bun pm ls typescript
```

Expected: `typescript@^6.0.2` (o la patch più recente nella major 6).

- [ ] **Step 1.4: Run typecheck**

```bash
bun run typecheck
```

Expected: o passa direttamente, oppure produce errori da TS 6. Se passa: salta a Step 1.6. Se fallisce: vai a 1.5.

- [ ] **Step 1.5: Fix errori typecheck (loop)**

Per ogni errore:
1. Leggi il file e l'errore esatto.
2. Decidi una delle 3 strategie nell'ordine:
   - **a.** Fix nel codice locale se il fix è triviale e il TS6 ha solo reso esplicito un type-mismatch reale.
   - **b.** Bump della libreria upstream se il problema è in un type-import da una libreria con un fix già pubblicato (verifica con `npm view <pkg> versions --json`).
   - **c.** `// @ts-expect-error TS 6 X — issue: <link>` con commento + apri issue upstream se il fix è non triviale e bloccare il PR è peggio del workaround.
3. Re-run `bun run typecheck` dopo ogni fix.
4. Quando il run è clean, vai a 1.6.

**Sospetti principali (per priorità):**
- `apps/api/src/**` con tipi Drizzle/Elysia/TypeBox.
- `apps/admin/src/lib/api.ts` (Eden Treaty types).
- `packages/ui/src/**` con peer types.

- [ ] **Step 1.6: Verifica lint non rotto da fix**

```bash
bun run lint
```

Expected: pass. Se ci sono fix di lint banali (es. import order), `bun run lint:fix`.

- [ ] **Step 1.7: Test verde**

```bash
bun run test
```

Expected: pass.

- [ ] **Step 1.8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(deps): bump typescript to ^6.0.2

Bumps the root devDependency from ^5.9.3 to ^6.0.2 (major). Cascades
to all workspaces. Includes any reactive type fixes needed in source.

Stage 1/7 of TanStack Start demo deps alignment
(see docs/superpowers/specs/2026-04-28-deps-upgrade-design.md).
EOF
)"
```

Expected: commit creato, lefthook (Biome + commit-msg) passa.

---

## Stage 2 — Vitest 4 + jsdom 28

### Task 2: Bump Vitest e jsdom in catalog

**Files:**
- Modify: `package.json` (root catalog)

- [ ] **Step 2.1: Aggiorna catalog**

In `/Users/marcogelli/repos/jelaz/bibs/package.json` catalog:
```diff
-    "jsdom": "^27.0.0",
+    "jsdom": "^28.1.0",
```
e
```diff
-    "vitest": "^3.0.5",
+    "vitest": "^4.1.5",
```

- [ ] **Step 2.2: Installa**

```bash
bun install
```

Expected: install succeeds. `bun.lock` updated.

- [ ] **Step 2.3: Verifica versioni**

```bash
bun pm ls vitest
bun pm ls jsdom
```

Expected: `vitest@^4.1.5`, `jsdom@^28.1.0`.

- [ ] **Step 2.4: Typecheck (gate per type-mismatch su `@testing-library/*`)**

```bash
bun run typecheck
```

Expected: pass. Se fallisce su tipi `@testing-library/dom`/`@testing-library/react` × jsdom 28 / vitest 4, applica lo stesso loop del Step 1.5 limitatamente ai pacchetti coinvolti.

- [ ] **Step 2.5: Test verde (api usa `bun test`, non vitest)**

```bash
bun run test
```

Expected: pass. Solo `apps/api` ha test attivi via `bun test`; vitest non è eseguito perché nessun frontend ha test attivi (verificato durante la stesura del piano).

- [ ] **Step 2.6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(deps): bump vitest to ^4.1.5 and jsdom to ^28.1.0

Both bumps are major. No frontend test currently runs vitest, so the
gate is install + typecheck clean. apps/api uses bun test and is
unaffected.

Stage 2/7 of TanStack Start demo deps alignment.
EOF
)"
```

Expected: commit creato.

---

## Stage 3 — Vite 8 + plugin-react 6 + tsconfigPaths nativo

### Task 3.A: Bump catalog e rimozione `vite-tsconfig-paths`

**Files:**
- Modify: `package.json` (root catalog)

- [ ] **Step 3.A.1: Aggiorna catalog**

In `/Users/marcogelli/repos/jelaz/bibs/package.json` catalog:
```diff
-    "@vitejs/plugin-react": "^5.2.0",
+    "@vitejs/plugin-react": "^6.0.1",
```
```diff
-    "vite": "^7.3.2",
+    "vite": "^8.0.0",
```
```diff
-    "vite-tsconfig-paths": "^5.1.4",
```
(riga rimossa completamente).

- [ ] **Step 3.A.2: Verifica diff**

```bash
git diff package.json
```

Expected: tre righe modificate per vite/plugin-react, una riga `vite-tsconfig-paths` rimossa.

### Task 3.B: Aggiorna i 3 `package.json` dei frontend

**Files:**
- Modify: `apps/admin/package.json`
- Modify: `apps/customer/package.json`
- Modify: `apps/seller/package.json`

- [ ] **Step 3.B.1: Rimuovi `vite-tsconfig-paths` da admin**

In `/Users/marcogelli/repos/jelaz/bibs/apps/admin/package.json`, sezione `devDependencies`, rimuovi la riga:
```diff
-    "vite-tsconfig-paths": "catalog:",
```

- [ ] **Step 3.B.2: Rimuovi `vite-tsconfig-paths` da customer**

In `/Users/marcogelli/repos/jelaz/bibs/apps/customer/package.json`:
```diff
-    "vite-tsconfig-paths": "catalog:"
```
(notare che potrebbe essere l'ultima entry — la virgola precedente va rimossa per mantenere JSON valido).

- [ ] **Step 3.B.3: Rimuovi `vite-tsconfig-paths` da seller**

In `/Users/marcogelli/repos/jelaz/bibs/apps/seller/package.json`, stesso del Step 3.B.2.

### Task 3.C: Aggiorna i 3 `vite.config.ts`

**Files:**
- Modify: `apps/admin/vite.config.ts`
- Modify: `apps/customer/vite.config.ts`
- Modify: `apps/seller/vite.config.ts`

- [ ] **Step 3.C.1: Aggiorna `apps/admin/vite.config.ts`**

Contenuto finale (gli unici diff sono: rimozione `import tsconfigPaths`, rimozione plugin `tsconfigPaths`, aggiunta `resolve.tsconfigPaths: true`):

```ts
import path from "node:path";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = defineConfig({
	resolve: {
		tsconfigPaths: true,
		alias: {
			"~/": `${path.resolve(__dirname, "../../packages/ui/src")}/`,
		},
	},
	ssr: {
		noExternal: ["@bibs/ui"],
	},
	plugins: [
		devtools({ eventBusConfig: { port: 42070 } }),
		paraglideVitePlugin({
			project: "./project.inlang",
			outdir: "./src/paraglide",
			strategy: ["url", "baseLocale"],
		}),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
});

export default config;
```

- [ ] **Step 3.C.2: Aggiorna `apps/customer/vite.config.ts`**

Identico all'admin ma con `eventBusConfig: { port: 42071 }`:

```ts
import path from "node:path";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = defineConfig({
	resolve: {
		tsconfigPaths: true,
		alias: {
			"~/": `${path.resolve(__dirname, "../../packages/ui/src")}/`,
		},
	},
	ssr: {
		noExternal: ["@bibs/ui"],
	},
	plugins: [
		devtools({ eventBusConfig: { port: 42071 } }),
		paraglideVitePlugin({
			project: "./project.inlang",
			outdir: "./src/paraglide",
			strategy: ["url", "baseLocale"],
		}),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
});

export default config;
```

- [ ] **Step 3.C.3: Aggiorna `apps/seller/vite.config.ts`**

Identico ma con `eventBusConfig: { port: 42072 }` — copia esatta del Step 3.C.2 con il solo cambio di porta.

### Task 3.D: Install + verifica gate Stage 3

- [ ] **Step 3.D.1: Installa**

```bash
bun install
```

Expected: install succeeds. `vite-tsconfig-paths` non più presente in `node_modules`.

- [ ] **Step 3.D.2: Verifica versioni**

```bash
bun pm ls vite
bun pm ls @vitejs/plugin-react
```

Expected: `vite@^8.0.0`, `@vitejs/plugin-react@^6.0.1`.

- [ ] **Step 3.D.3: Typecheck**

```bash
bun run typecheck
```

Expected: pass. Se fallisce: applica loop di fix (vedi 1.5).

- [ ] **Step 3.D.4: Build admin (gate critico Vite 8)**

```bash
bun run --cwd apps/admin build
```

Expected: build succeeds. Errori probabili: cambi alle option `build.*` di Vite 8 (rare ma possibili). In caso, leggere il messaggio e correggere il `vite.config.ts`.

- [ ] **Step 3.D.5: Build customer e seller**

```bash
bun run --cwd apps/customer build
bun run --cwd apps/seller build
```

Expected: entrambi pass.

- [ ] **Step 3.D.6: Smoke dev:admin**

```bash
bun run dev:admin &
DEV_PID=$!
sleep 8
curl -sI http://localhost:3003/ | head -1
kill $DEV_PID
```

Expected: `HTTP/1.1 200 OK` (o simile, comunque 2xx).

- [ ] **Step 3.D.7: Smoke browser dei 3 frontend**

In 3 terminali distinti:
```bash
bun run dev:admin
bun run dev:customer
bun run dev:seller
```

Per ognuno: aprire in browser su `localhost:3003` / `:3001` / `:3002`, verificare:
- la home si carica senza errori in console
- alias `~/` (per `@bibs/ui`) funziona — qualsiasi pagina che importa un componente UI deve renderizzare i bottoni/input.

Chiudere i dev server.

### Task 3.E: Commit Stage 3

- [ ] **Step 3.E.1: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(deps): bump vite to ^8.0.0, plugin-react to ^6.0.1, drop vite-tsconfig-paths

Vite 8 ships native tsconfig paths support via resolve.tsconfigPaths,
so the vite-tsconfig-paths plugin is removed from catalog and from
admin/customer/seller devDependencies. The 3 vite.config.ts files
adopt resolve.tsconfigPaths: true and drop the import.

Stage 3/7 of TanStack Start demo deps alignment.
EOF
)"
```

---

## Stage 4 — TanStack ecosystem `latest` (incluso `react-start`)

⚠️ **Stage critico**: regola memoria documenta una regressione SSR su `@tanstack/react-start@1.167.48`. Il gate include la verifica browser obbligatoria.

### Task 4.A: Bump catalog @tanstack/*

**Files:**
- Modify: `package.json` (root catalog)

- [ ] **Step 4.A.1: Aggiorna catalog**

In `/Users/marcogelli/repos/jelaz/bibs/package.json` catalog, sostituire le seguenti chiavi con `"latest"` (semver-loose intenzionale per allinearsi al demo; lockate dal `bun.lock`):

```diff
-    "@tanstack/devtools-vite": "^0.3.11",
+    "@tanstack/devtools-vite": "latest",
-    "@tanstack/react-devtools": "^0.7.0",
+    "@tanstack/react-devtools": "latest",
-    "@tanstack/react-query": "^5.100.5",
+    "@tanstack/react-query": "latest",
-    "@tanstack/react-query-devtools": "^5.100.5",
+    "@tanstack/react-query-devtools": "latest",
-    "@tanstack/react-router": "^1.168.25",
+    "@tanstack/react-router": "latest",
-    "@tanstack/react-router-devtools": "^1.166.13",
+    "@tanstack/react-router-devtools": "latest",
-    "@tanstack/react-router-ssr-query": "^1.166.12",
+    "@tanstack/react-router-ssr-query": "latest",
-    "@tanstack/react-start": "1.167.42",
+    "@tanstack/react-start": "latest",
-    "@tanstack/react-table": "^8.21.2",
+    "@tanstack/react-table": "latest",
-    "@tanstack/router-plugin": "^1.167.28",
+    "@tanstack/router-plugin": "latest",
```

`@tanstack/match-sorter-utils` resta com'è (`^8.19.4`) — è una utility separata.

- [ ] **Step 4.A.2: Installa**

```bash
bun install
```

Expected: install succeeds. `bun.lock` aggiornato con le versioni effettive risolte.

- [ ] **Step 4.A.3: Annota la versione effettiva di `@tanstack/react-start`**

```bash
bun pm ls @tanstack/react-start
```

Expected output: una versione specifica (es. `@tanstack/react-start@1.180.x`). **Annotala** — ti serve per il commit message e per l'aggiornamento eventuale della memoria.

### Task 4.B: Typecheck e gate browser

- [ ] **Step 4.B.1: Typecheck**

```bash
bun run typecheck
```

Expected: pass. Se fallisce su breaking changes API (es. `createFileRoute` signature, devtools API): applica fix iterativi finché clean. Sospetti principali:
- `apps/{admin,customer,seller}/src/router.ts` (root router setup)
- `apps/{admin,customer,seller}/src/routes/__root.tsx`
- `apps/{admin,customer,seller}/src/lib/api.ts` (Eden Treaty + TanStack Query integration)
- File sotto `apps/*/src/routes/**` con `loader` o `beforeLoad`.

- [ ] **Step 4.B.2: Build dei 3 frontend**

```bash
bun run --cwd apps/admin build
bun run --cwd apps/customer build
bun run --cwd apps/seller build
```

Expected: tutti pass.

- [ ] **Step 4.B.3: Browser SSR check — admin**

```bash
bun run dev:admin
```

In browser, `localhost:3003`:
1. Verifica che la home renderizzi (no schermo bianco, no "Cannot GET /").
2. Apri DevTools → Network → ricarica → verifica che la prima request restituisca **HTML SSR'd** (cioè `<html>...<body>` con contenuto già presente, non solo `<div id="root">`). View source (`Ctrl+U`) deve mostrare contenuto reale.
3. Naviga client-side a una route diversa (es. login, dashboard).
4. Verifica console pulita.

Se ognuno di questi check fallisce: vedi Task 4.D (fallback).

Chiudi il dev server.

- [ ] **Step 4.B.4: Browser SSR check — customer**

Stesso flusso del 4.B.3 con `bun run dev:customer` su `localhost:3001`.

- [ ] **Step 4.B.5: Browser SSR check — seller**

Stesso flusso del 4.B.3 con `bun run dev:seller` su `localhost:3002`.

### Task 4.C: Commit Stage 4 (path felice)

- [ ] **Step 4.C.1: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(deps): bump @tanstack/* ecosystem to latest

Bumps react-start, react-router, react-query, devtools, ssr-query,
router-plugin, react-table, react-devtools, devtools-vite all to
latest. SSR verified in browser on admin, customer, seller (memory
note: 1.167.48 had broken SSR — current latest version verified safe).

Stage 4/7 of TanStack Start demo deps alignment.
EOF
)"
```

### Task 4.D: Fallback se SSR si rompe (NON eseguire se Stage 4 passa)

- [ ] **Step 4.D.1: Identifica la versione corrente broken**

Annota la versione di `@tanstack/react-start` che ha rotto (es. `1.180.x`).

- [ ] **Step 4.D.2: Trova l'ultima versione stable safe**

```bash
npm view @tanstack/react-start versions --json | tail -50
```

Expected: lista di versioni recenti. Identifica la minor precedente al break.

- [ ] **Step 4.D.3: Pin alla versione safe**

In `package.json` catalog:
```diff
-    "@tanstack/react-start": "latest",
+    "@tanstack/react-start": "<versione-safe-esatta>",
```

(usa la versione esatta senza `^` per pinning).

- [ ] **Step 4.D.4: Re-install e re-verify**

```bash
bun install
bun run typecheck
```

Then ripeti tutti gli step 4.B.3 / 4.B.4 / 4.B.5.

- [ ] **Step 4.D.5: Aggiorna la memoria**

Aggiorna il file `~/.claude/projects/-Users-marcogelli-repos-jelaz-bibs/memory/project_tanstack_react_start_pin.md` con:
- Nuova versione safe trovata.
- Versione che ha causato la rottura.
- Sintomo osservato.

- [ ] **Step 4.D.6: Commit (versione fallback)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(deps): bump @tanstack/* ecosystem (react-start pinned to <ver>)

Most @tanstack/* packages bumped to latest. @tanstack/react-start
pinned to <ver> because <newer-ver> regresses SSR (Cannot GET /).
Memory note updated. SSR verified in browser on all 3 frontends.

Stage 4/7 of TanStack Start demo deps alignment.
EOF
)"
```

---

## Stage 5 — Nitro esplicito nei `vite.config.ts`

### Task 5.A: Determina la versione di Nitro

- [ ] **Step 5.A.1: Verifica peer/optional di TanStack Start**

```bash
npm view @tanstack/react-start@$(bun pm ls @tanstack/react-start --json | grep -oE '"version":"[^"]+"' | head -1 | cut -d'"' -f4) peerDependencies devDependencies dependencies
```

Expected output: lista di deps. Cerca menzioni di `nitro` o `nitropack`. Se Start dichiara una versione specifica, usa quella.

- [ ] **Step 5.A.2: Verifica disponibilità di una stable di Nitro**

```bash
npm view nitro versions --json 2>/dev/null | tail -10 || echo "no stable nitro"
npm view nitro-nightly version 2>/dev/null
```

Expected: se `nitro` (stable, non nightly) esiste e ha una versione compatibile con TanStack Start → preferiscila. Altrimenti fallback su `nitro: npm:nitro-nightly@latest` come il demo.

**Decisione:**
- Se stable disponibile → catalog: `"nitro": "^X.Y.Z"`.
- Altrimenti → catalog: `"nitro": "npm:nitro-nightly@latest"`.

### Task 5.B: Aggiungi Nitro al catalog e ai 3 frontend

**Files:**
- Modify: `package.json` (root catalog)
- Modify: `apps/admin/package.json`
- Modify: `apps/customer/package.json`
- Modify: `apps/seller/package.json`

- [ ] **Step 5.B.1: Aggiungi al catalog**

In `/Users/marcogelli/repos/jelaz/bibs/package.json`, dentro `catalog` (mantenendo l'ordine alfabetico esistente):

```diff
     "lucide-react": "^1.11.0",
+    "nitro": "<scelta-da-Step-5.A.2>",
     "pg": "^8.20.0",
```

- [ ] **Step 5.B.2: Aggiungi `nitro: catalog:` a admin devDeps**

In `/Users/marcogelli/repos/jelaz/bibs/apps/admin/package.json`, sezione `devDependencies` (mantieni l'ordine alfabetico):

```diff
     "jsdom": "catalog:",
+    "nitro": "catalog:",
     "vite": "catalog:",
```

- [ ] **Step 5.B.3: Aggiungi a customer devDeps**

In `/Users/marcogelli/repos/jelaz/bibs/apps/customer/package.json` `devDependencies`, posizione alfabetica:

```diff
     "@vitejs/plugin-react": "catalog:",
+    "nitro": "catalog:",
     "vite": "catalog:"
```

- [ ] **Step 5.B.4: Aggiungi a seller devDeps**

In `/Users/marcogelli/repos/jelaz/bibs/apps/seller/package.json` `devDependencies`, stesso del 5.B.3.

### Task 5.C: Aggiorna i 3 `vite.config.ts` con `nitro()`

**Files:**
- Modify: `apps/admin/vite.config.ts`
- Modify: `apps/customer/vite.config.ts`
- Modify: `apps/seller/vite.config.ts`

- [ ] **Step 5.C.1: Update admin**

Aggiungi import e plugin. Stato finale di `apps/admin/vite.config.ts`:

```ts
import path from "node:path";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const config = defineConfig({
	resolve: {
		tsconfigPaths: true,
		alias: {
			"~/": `${path.resolve(__dirname, "../../packages/ui/src")}/`,
		},
	},
	ssr: {
		noExternal: ["@bibs/ui"],
	},
	plugins: [
		devtools({ eventBusConfig: { port: 42070 } }),
		paraglideVitePlugin({
			project: "./project.inlang",
			outdir: "./src/paraglide",
			strategy: ["url", "baseLocale"],
		}),
		nitro(),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
});

export default config;
```

- [ ] **Step 5.C.2: Update customer**

Identico al 5.C.1 ma con `port: 42071`.

- [ ] **Step 5.C.3: Update seller**

Identico al 5.C.1 ma con `port: 42072`.

### Task 5.D: Install + verifica gate Stage 5

- [ ] **Step 5.D.1: Installa**

```bash
bun install
```

Expected: install succeeds.

- [ ] **Step 5.D.2: Typecheck**

```bash
bun run typecheck
```

Expected: pass.

- [ ] **Step 5.D.3: Build dei 3 frontend**

```bash
bun run --cwd apps/admin build
bun run --cwd apps/customer build
bun run --cwd apps/seller build
```

Expected: tutti pass.

- [ ] **Step 5.D.4: Browser SSR smoke 3 frontend**

Ripeti gli step 4.B.3 / 4.B.4 / 4.B.5 (admin/customer/seller). Stesso check di SSR, console, navigazione client-side.

### Task 5.E: Commit Stage 5

- [ ] **Step 5.E.1: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(deps): adopt explicit Nitro plugin in frontend vite configs

TanStack Start latest expects Nitro to be composed explicitly in the
Vite plugin chain. Adds nitro to catalog (<stable|nightly>) and to
admin/customer/seller devDependencies. The 3 vite.config.ts files
import { nitro } from "nitro/vite" and add nitro() to plugins.

Stage 5/7 of TanStack Start demo deps alignment.
EOF
)"
```

---

## Stage 6 — React Compiler

### Task 6.A: Aggiungi deps React Compiler

**Files:**
- Modify: `package.json` (root catalog)
- Modify: `apps/admin/package.json`
- Modify: `apps/customer/package.json`
- Modify: `apps/seller/package.json`

- [ ] **Step 6.A.1: Aggiungi al catalog**

In `/Users/marcogelli/repos/jelaz/bibs/package.json` catalog (ordine alfabetico):

```diff
+    "@rolldown/plugin-babel": "^0.2.3",
     "@sinclair/typebox": "^0.34.49",
```
e
```diff
     "@vitejs/plugin-react": "^6.0.1",
+    "babel-plugin-react-compiler": "^1.0.0",
     "better-auth": "1.6.9",
```

(le posizioni esatte dipendono dall'ordine alfabetico finale del catalog).

- [ ] **Step 6.A.2: Aggiungi devDeps a admin/customer/seller**

In ognuno dei 3 `apps/{admin,customer,seller}/package.json` aggiungere a `devDependencies` (in posizione alfabetica):

```diff
+    "@rolldown/plugin-babel": "catalog:",
     "@tanstack/devtools-vite": "catalog:",
```
e
```diff
+    "babel-plugin-react-compiler": "catalog:",
     "jsdom": "catalog:",  // su admin; su customer/seller dopo l'ultima @-prefix
```

(per customer e seller, `jsdom` non c'è — basta inserire `babel-plugin-react-compiler` dopo l'ultimo `@vitejs/...` o dove l'ordine alfabetico lo mette).

### Task 6.B: Aggiorna i 3 `vite.config.ts` con il preset Compiler

**Files:**
- Modify: `apps/admin/vite.config.ts`
- Modify: `apps/customer/vite.config.ts`
- Modify: `apps/seller/vite.config.ts`

- [ ] **Step 6.B.1: Update admin**

Stato finale di `apps/admin/vite.config.ts`:

```ts
import path from "node:path";
import babel from "@rolldown/plugin-babel";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const config = defineConfig({
	resolve: {
		tsconfigPaths: true,
		alias: {
			"~/": `${path.resolve(__dirname, "../../packages/ui/src")}/`,
		},
	},
	ssr: {
		noExternal: ["@bibs/ui"],
	},
	plugins: [
		devtools({ eventBusConfig: { port: 42070 } }),
		paraglideVitePlugin({
			project: "./project.inlang",
			outdir: "./src/paraglide",
			strategy: ["url", "baseLocale"],
		}),
		nitro(),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
		babel({ presets: [reactCompilerPreset()] }),
	],
});

export default config;
```

- [ ] **Step 6.B.2: Update customer**

Identico al 6.B.1 con `port: 42071`.

- [ ] **Step 6.B.3: Update seller**

Identico al 6.B.1 con `port: 42072`.

### Task 6.C: Install + verifica gate Stage 6

- [ ] **Step 6.C.1: Installa**

```bash
bun install
```

Expected: install succeeds.

- [ ] **Step 6.C.2: Typecheck**

```bash
bun run typecheck
```

Expected: pass.

- [ ] **Step 6.C.3: Build dei 3 frontend**

```bash
bun run --cwd apps/admin build
bun run --cwd apps/customer build
bun run --cwd apps/seller build
```

Expected: build success. Tempo di build aumenterà (Compiler aggiunge passaggio babel). Eventuali warning del Compiler appariranno qui (es. componenti non-conformi).

- [ ] **Step 6.C.4: Browser smoke + Compiler warning audit**

Per ognuno dei 3 frontend (`bun run dev:admin/customer/seller`):
1. Aprire in browser, esercitare il "golden path" (login, una pagina principale, una mutazione/form).
2. Tenere DevTools aperto, schedare ogni warning del Compiler in console.
3. Per ogni warning:
   - **a.** Se è un fix banale (mutazione di una prop, side-effect rimovibile), correggi nel componente.
   - **b.** Se è invasivo o richiede un refactor non triviale, aggiungi `"use no memo";` come prima riga del componente, con un commento:
     ```tsx
     "use no memo";
     // React Compiler opt-out: <motivo breve>
     export function MyComponent() { ... }
     ```
4. Re-build e ri-esercitare finché console pulita.

### Task 6.D: Commit Stage 6

- [ ] **Step 6.D.1: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(deps,admin,customer,seller): adopt React Compiler

Adds @rolldown/plugin-babel and babel-plugin-react-compiler to catalog
and to admin/customer/seller devDependencies. The 3 vite.config.ts
files compose the babel plugin with reactCompilerPreset(). Components
flagged by the compiler that needed an opt-out use "use no memo".

Stage 6/7 of TanStack Start demo deps alignment.
EOF
)"
```

---

## Stage 7 — Allineamenti finali

### Task 7.A: Bump `@types/node` a LTS

**Files:**
- Modify: `package.json` (root catalog)

- [ ] **Step 7.A.1: Aggiorna catalog**

```diff
-    "@types/node": "25.6.0",
+    "@types/node": "^22.10.2",
```

- [ ] **Step 7.A.2: Installa**

```bash
bun install
```

Expected: install succeeds.

- [ ] **Step 7.A.3: Typecheck**

```bash
bun run typecheck
```

Expected: pass. Il bump è a una versione *minore* (25 → 22 LTS) — possibile che alcuni tipi `node:*` referenziati siano cambiati. Fix se necessario.

### Task 7.B: Verifica finale completa

- [ ] **Step 7.B.1: Catena completa**

```bash
bun run typecheck
bun run lint
bun run test
```

Expected: tutti pass. Se lint segnala fix automatici: `bun run lint:fix`, ricommit gli auto-fix come piccolo follow-up nel commit di Stage 7.

- [ ] **Step 7.B.2: Build di tutti e 3 i frontend**

```bash
bun run --cwd apps/admin build
bun run --cwd apps/customer build
bun run --cwd apps/seller build
```

Expected: success.

- [ ] **Step 7.B.3: Browser smoke finale completo**

Per ognuno dei 3 frontend (`bun run dev:admin/customer/seller`):
1. Home renderizzata via SSR (view-source mostra contenuto).
2. Almeno una navigazione client-side funziona.
3. Almeno una route autenticata + chiamata API via Eden Treaty risponde correttamente.
4. Console pulita: no errori, no warning Compiler.

### Task 7.C: Commit Stage 7

- [ ] **Step 7.C.1: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(deps): align @types/node to LTS (^22.10.2)

Final alignment with TanStack Start demo. Brings @types/node from
25.6.0 down to LTS 22, matching Node LTS runtime targeted in deploy.
Full verification chain (typecheck, lint, test, build, browser smoke)
green across all workspaces.

Stage 7/7 of TanStack Start demo deps alignment.
EOF
)"
```

### Task 7.D: PR

- [ ] **Step 7.D.1: Push e crea PR**

```bash
git push -u origin chore/deps-upgrade-tanstack-demo-alignment
gh pr create --title "chore(deps): align stack with TanStack Start demo (TS6, Vite8, Vitest4, TanStack latest, React Compiler)" --body "$(cat <<'EOF'
## Summary

Aligns the monorepo build/typing/test stack with the latest TanStack Start CLI demo:

- **TypeScript** 5.9 → 6.0
- **Vite** 7 → 8 (drops `vite-tsconfig-paths`, uses native `resolve.tsconfigPaths`)
- **Vitest** 3 → 4 + **jsdom** 27 → 28
- **@vitejs/plugin-react** 5 → 6
- **@tanstack/\*** ecosystem → latest (router, react-start, query, devtools, ssr-query, table, router-plugin, devtools-vite)
- **Nitro** explicit plugin in the 3 frontend `vite.config.ts`
- **React Compiler** via `@rolldown/plugin-babel` + `babel-plugin-react-compiler` + `reactCompilerPreset()`
- **@types/node** 25 → ^22 (LTS)

Spec: `docs/superpowers/specs/2026-04-28-deps-upgrade-design.md`.
Plan: `docs/superpowers/plans/2026-04-28-deps-upgrade.md`.

Commits are bisectable per stage (1=TS6, 2=Vitest4/jsdom28, 3=Vite8/plugin-react6, 4=Tanstack latest, 5=Nitro, 6=React Compiler, 7=@types/node).

## Test plan

- [x] `bun run typecheck` clean across all workspaces
- [x] `bun run lint` clean
- [x] `bun run test` (apps/api) clean
- [x] `bun run --cwd apps/{admin,customer,seller} build` succeeds
- [x] Browser SSR verified on `localhost:3001/3002/3003`: HTML SSR'd, navigation works, authenticated route + Eden Treaty API call responds, console clean
- [x] React Compiler warnings reviewed; opt-outs (`"use no memo"`) documented in code where applied

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR creato. Annota l'URL e segnalalo all'utente.

---

## Self-review effettuato

- ✅ Spec coverage: ogni sezione §3-§9 dello spec mappa a uno o più task del piano (catalog → Task 1/2/3.A/4.A/5.B/6.A/7.A; vite.config.ts → 3.C/5.C/6.B; package.json frontend → 3.B/5.B/6.A; SSR fallback → 4.D; memoria → 4.D.5).
- ✅ Nessun placeholder "TBD/TODO/implement later/etc." nel piano (le decisioni runtime su Nitro nightly/stable e versione safe di react-start sono concretamente decidibili da comandi `npm view` previsti nei task 5.A.1-5.A.2 e 4.A.3).
- ✅ Type/name consistency: `tsconfigPaths` (camelCase) usato come opzione Vite, `vite-tsconfig-paths` come pacchetto rimosso. `reactCompilerPreset()` chiamato come funzione ovunque. Nomi dei port `42070/42071/42072` consistenti tra Stage 3 e Stage 5/6.
- ✅ Commit messages tutti rispettano Conventional Commits con scope `deps` (whitelistato dal lefthook commit-msg validator del repo).
