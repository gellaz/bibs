# Design: aggiornamento dipendenze critiche allineato a TanStack Start demo

**Data:** 2026-04-28
**Stato:** approved (in attesa di review utente del documento)
**Owner:** Marco Gelli
**Riferimento:** progetto demo `../demo-ts-start` generato dalla CLI ufficiale TanStack Start

---

## 1. Obiettivo

Allineare lo stack di build/typing/test del monorepo `bibs` allo stack del progetto demo TanStack Start più recente, in modo che i 3 frontend (`admin`, `customer`, `seller`) e l'API condividano le stesse versioni major di TypeScript, Vite, Vitest, plugin-react e dell'ecosistema TanStack. L'aggiornamento include l'adozione di React Compiler e dell'integrazione esplicita con Nitro come da demo.

## 2. Approccio scelto

**Single PR con commit strutturati per stage** (approccio 3 in fase di brainstorming): un solo branch e un solo PR, ma con commit ordinati e bisectabili, ognuno con il proprio gate di verifica. Questo bilancia la velocità di un big-bang con la rollback granularity di stage sequenziali.

## 3. Versioni target

### 3.1 Catalog (`package.json` root)

| Pacchetto | Da | A | Tipo |
|---|---|---|---|
| `@tanstack/devtools-vite` | `^0.3.11` | `latest` | minor |
| `@tanstack/react-devtools` | `^0.7.0` | `latest` | minor |
| `@tanstack/react-query` | `^5.100.5` | `latest` | patch/minor |
| `@tanstack/react-query-devtools` | `^5.100.5` | `latest` | patch/minor |
| `@tanstack/react-router` | `^1.168.25` | `latest` | minor |
| `@tanstack/react-router-devtools` | `^1.166.13` | `latest` | minor |
| `@tanstack/react-router-ssr-query` | `^1.166.12` | `latest` | minor |
| `@tanstack/react-start` | `1.167.42` (pinned) | `latest` con verifica SSR | minor |
| `@tanstack/react-table` | `^8.21.2` | `latest` | minor |
| `@tanstack/router-plugin` | `^1.167.28` | `latest` | minor |
| `@types/node` | `25.6.0` | `^22.10.2` (LTS) | downgrade conservativo |
| `@vitejs/plugin-react` | `^5.2.0` | `^6.0.1` | **major** |
| `jsdom` | `^27.0.0` | `^28.1.0` | **major** |
| `vite` | `^7.3.2` | `^8.0.0` | **major** |
| `vitest` | `^3.0.5` | `^4.1.5` | **major** |

### 3.2 Catalog: nuove entry

| Pacchetto | Versione | Scopo |
|---|---|---|
| `@rolldown/plugin-babel` | `^0.2.3` | host del preset React Compiler in Vite |
| `babel-plugin-react-compiler` | `^1.0.0` | React Compiler stable |
| `nitro` | `npm:nitro-nightly@latest` (o stable se disponibile compatibile) | SSR runtime esplicito per TanStack Start latest |

### 3.3 Root `devDependencies`

| Pacchetto | Da | A |
|---|---|---|
| `typescript` | `^5.9.3` | `^6.0.2` |

### 3.4 Esplicitamente invariati

- `tailwindcss`, `@tailwindcss/vite`, `@tailwindcss/postcss` — bibs è già più avanti del demo (`^4.2.4` vs `^4.1.18`).
- `better-auth` — bibs è più avanti (`1.6.9` vs `^1.5.3`).
- `drizzle-orm` / `drizzle-kit` — già allineati col demo.
- `lucide-react: ^1.11.0` — verificato durante brainstorming: bibs è corretto e più avanti del demo. Lucide è davvero passato da 0.x a 1.x.
- `react`, `react-dom` — bibs è già più avanti (`^19.2.5` vs `^19.2.0`).

## 4. Modifiche ai file di configurazione

### 4.1 `apps/{admin,customer,seller}/vite.config.ts` (3 file simili)

- **Rimuovere** import e plugin `tsconfigPaths` (`vite-tsconfig-paths`).
- **Aggiungere** `resolve.tsconfigPaths: true` (supporto nativo di Vite 8).
- **Aggiungere** `import { nitro } from "nitro/vite"` e plugin `nitro()`.
- **Aggiungere** `import { reactCompilerPreset } from "@vitejs/plugin-react"` e `import babel from "@rolldown/plugin-babel"`, plus plugin `babel({ presets: [reactCompilerPreset()] })`.
- **Mantenere** `resolve.alias` per `~/` (cross-workspace alias fisico, indipendente dai TS paths).
- **Mantenere** `ssr.noExternal: ["@bibs/ui"]`.
- **Mantenere** plugin esistenti: `devtools()`, `paraglideVitePlugin()`, `tailwindcss()`, `tanstackStart()`, `viteReact()`.

### 4.2 `apps/{admin,customer,seller}/package.json`

- **Aggiungere** a `devDependencies`: `@rolldown/plugin-babel: catalog:`, `babel-plugin-react-compiler: catalog:`, `nitro: catalog:`.
- **Rimuovere** `vite-tsconfig-paths` da `devDependencies` di tutti e 3 i frontend (admin/customer/seller — verificato: tutti e 3 lo importano nel `vite.config.ts` e lo elencano in `devDependencies`).

### 4.3 `package.json` (root)

- Aggiornare `catalog` come da §3.1, §3.2.
- Aggiornare `devDependencies.typescript` come da §3.3.

### 4.4 `tsconfig.base.json` e `apps/*/tsconfig.json`

- Nessun cambiamento pre-pianificato. Le flag `verbatimModuleSyntax`, `noUncheckedSideEffectImports`, `allowImportingTsExtensions`, `allowJs` sono già presenti dove servono.
- Eventuali fix in `apps/api/tsconfig.json` saranno reattivi a errori di TS 6 in Stage 1.

## 5. Piano in stage (commit-by-commit)

Ogni stage = un commit. Ogni stage ha gate di verifica obbligatori. Se un gate fallisce, lo stage va rifinito prima di passare al successivo.

### Stage 1 — TypeScript 6
- Bump `typescript` 5.9.3 → ^6.0.2 al root; `bun install`.
- Fix errori nuovi di `bun run typecheck` su tutti i workspace (Drizzle/Elysia/TypeBox sono i sospetti principali).
- **Gate:** `bun run typecheck` clean su tutti i workspace.

### Stage 2 — Vitest 4 + jsdom 28
- Bump `vitest` ^4.1.5 e `jsdom` ^28.1.0 in catalog; `bun install`.
- Fix breaking changes Vitest 4 (signature `vi.mock`, default `pool`, ecc.). **Verificato durante stesura del piano: nessun test vitest esiste sui 3 frontend** — gate Vitest 4 è effettivamente solo "il pacchetto si installa". `apps/api` usa `bun test`, quindi totalmente invariato.
- **Gate:** `bun install` completa pulito + `bun run typecheck` clean (per intercettare eventuali type-mismatch su `@testing-library/*` con jsdom 28 anche se non usati a runtime).

### Stage 3 — Vite 8 + plugin-react 6 + tsconfigPaths nativo
- Bump `vite` ^8.0.0 e `@vitejs/plugin-react` ^6.0.1 in catalog.
- Rimuovere `vite-tsconfig-paths` da catalog e da `devDependencies` di admin/customer/seller.
- Aggiornare i 3 `vite.config.ts` (sostituire plugin con `resolve.tsconfigPaths: true`).
- `bun install`.
- **Gate:** `bun run typecheck` + `bun run --cwd apps/admin build` + smoke `bun run dev:admin` con verifica HTTP 200 su `localhost:3003/`.

### Stage 4 — TanStack ecosystem latest (incluso `react-start`)
- Bump tutti i `@tanstack/*` come da §3.1; `bun install`.
- Fix breaking changes API (route loaders, devtools).
- **Gate critico (regola memoria SSR):**
  - `bun run typecheck`.
  - Per ognuno dei 3 frontend: `bun run dev:*`, aprire in browser, verificare home renderizzata via SSR (no "Cannot GET /"), navigare su almeno una route autenticata, verificare in network tab che la prima response sia HTML SSR'd.
  - In caso di rottura: scendere alla minor precedente, ripetere. Documentare la versione safe trovata e aggiornare la nota in memoria `project_tanstack_react_start_pin.md`.

### Stage 5 — Nitro esplicito
- Aggiungere `nitro` al catalog (verificare se esiste stable compatibile con la versione di TanStack Start scelta in Stage 4; in subordine, `nitro-nightly` come il demo).
- Aggiungere `nitro: catalog:` a devDependencies dei 3 frontend.
- Aggiornare i 3 `vite.config.ts`: `import { nitro } from "nitro/vite"` + `nitro()` nei plugin.
- `bun install`.
- **Gate:** ripetere browser smoke di Stage 4 (SSR check sui 3 frontend).

### Stage 6 — React Compiler
- Aggiungere `@rolldown/plugin-babel` e `babel-plugin-react-compiler` al catalog.
- Aggiungerli a devDependencies dei 3 frontend.
- Aggiornare i 3 `vite.config.ts` con `reactCompilerPreset` + `babel` plugin.
- `bun install`.
- **Gate:** `bun run typecheck` + browser smoke sui 3 frontend con attenzione alle warning Compiler in console. Componenti non-conformi: correggere o opt-out con `"use no memo"`.

### Stage 7 — Allineamenti finali
- `@types/node` 25.6.0 → `^22.10.2` in catalog.
- `bun install`.
- Verifica finale: `bun run typecheck && bun run lint && bun run test`.
- Smoke finale completo sui 3 frontend (vedi §7).

## 6. Rischi e mitigazioni

| # | Rischio | Probabilità | Mitigazione |
|---|---|---|---|
| 1 | TanStack Start `latest` rompe SSR di nuovo | alta | Gate browser obbligatorio Stage 4. Fallback a versione known-good con aggiornamento memoria. |
| 2 | TS 6 rompe inferenza Drizzle/Elysia/TypeBox | media | Bump della libreria upstream se fix triviale; altrimenti `@ts-expect-error` puntuali con commento + issue upstream. |
| 3 | React Compiler segnala mutazioni in render | media | Prima passata: accetta warning, correggi iterativamente. Componenti invasivi: opt-out via `"use no memo"`. |
| 4 | Vite 8 + alias `~/` + ssr.noExternal edge case | bassa-media | Gate Stage 3 include build oltre a dev. |
| 5 | Nitro nightly instabile | bassa | Verificare presenza di stable Nitro compatibile prima di committare nightly. |
| 6 | Vitest 4 breaking | bassa | Solo `apps/admin` usa vitest (api usa `bun test`). Surface ridotta. |

## 7. Verifica finale (prima del merge)

1. `bun run typecheck` — clean su tutti i workspace.
2. `bun run lint` — clean.
3. `bun run test` — clean.
4. `bun run --cwd apps/admin build`, `bun run --cwd apps/customer build`, `bun run --cwd apps/seller build` — successo.
5. Per ognuno dei 3 frontend: `bun run dev:*`, browser su `localhost:300X`:
   - Home renderizzata via SSR (view-source mostra contenuto, non shell JS).
   - Almeno una navigazione client-side funziona.
   - Almeno una route autenticata + chiamata API via Eden Treaty risponde correttamente.
   - Console pulita: no errori, no warning Compiler non risolti.

## 8. Out of scope

- Bump di pacchetti dove bibs è già più avanti del demo (tailwindcss, better-auth, react, lucide-react, drizzle-*).
- Refactor di file oltre quelli elencati in §4.
- Adozione di convenzioni del demo non legate alle dipendenze (es. `imports: { "#/*": "./src/*" }`).
- Aggiornamenti dell'app `apps/api` oltre al typecheck reattivo a TS 6.

## 9. Decisioni aperte risolvibili in esecuzione

- Versione esatta di Nitro (nightly vs stable) — risolta in Stage 5 leggendo `peerDependencies` di TanStack Start latest.
- Versione esatta di `@tanstack/react-start` safe per SSR — risolta in Stage 4 con browser test, eventuale fallback documentato.
