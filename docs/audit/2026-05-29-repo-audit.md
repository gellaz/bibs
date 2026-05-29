# Audit repository `bibs` — 2026-05-29

> Generato da un audit multi-agente (120 agent: 3 architettura + 23 reviewer per sottosistema + verifica adversariale di ogni finding di correttezza/sicurezza/integrità-dati).
> Baseline al momento dell'audit: `bun run typecheck` ✅ e `bun run lint` ✅ (1 sola warning Biome).

> **Stato follow-up (aggiornato 2026-05-29):** i finding HIGH sono stati affrontati in tre PR —
> #65 (gap di autorizzazione seller/customer), #66 (mappatura 4xx per violazioni pg FK/CHECK e
> coordinate fuori range), #67 (race sui punti fedeltà: indice unico + compare-and-swap).
> Restano aperti i follow-up MEDIUM/architetturali (TanStack pin a `latest`, authz in
> `images.ts`/`discounts.ts`, estrazione `@bibs/app-kit`, schemi risposta OpenAPI `withConflictErrors`).
> Questo documento è uno snapshot: le `location:line` riflettono il codice al momento dell'audit.

## Sintesi

- **Sottosistemi analizzati:** 23
- **Finding totali:** 160 (150 confermati/qualità · 10 confutati come falsi positivi)
- **Confermati per severità:** high: 15 · medium: 36 · low: 99

### Indice per severità (finding confermati/qualità)

| Severità | # | Categorie principali |
|---|---|---|
| 🔴 high | 15 | bug, security, reliability |
| 🟠 medium | 36 | reliability, security, consistency, bug |
| 🟡 low | 99 | dead-code, bug, consistency, type-safety, reliability, improvement, performance, security, test-gap |

---

## Architettura

### Monorepo architecture & configuration health (Bun workspaces)

The bibs monorepo is in good structural health for a 4-app + 1-package Bun-workspace marketplace. Workspace boundaries are clean (apps/api backend, three TanStack Start frontends, packages/ui shared library), the Bun catalog is applied with real discipline (every hardcoded version I audited is genuinely single-workspace, so there is no cross-workspace version drift), tooling is centralized (single Biome + Lefthook + Renovate at root, one tsconfig.base.json), and CI runs lint + typecheck + integration tests with testcontainers (no external service deps). The weak spots are not correctness bugs but accumulated config debt and documentation drift: (1) the deliberate `latest` pinning of all 10 TanStack packages is the single biggest structural risk — it makes installs non-reproducible and lets sub-package versions skew (the lockfile already shows react-start@1.168.14 bundling react-router@1.170.8 while the catalog `latest` resolves react-router independently); (2) the test gate is effectively API-only — the three frontends ship zero tests, and admin even carries a full but dead vitest/testing-library/jsdom setup with a `test` script that runs nothing and is wired into neither the root `test` script nor CI; (3) three byte-identical vite.config.ts files (differing only by a devtools port) and near-identical frontend tsconfigs are copy-paste duplication that will drift; (4) several docs claims no longer match reality (endpoint counts, undocumented billing/webhooks modules, a stale `app.config.ts` tsconfig include, fonts). None of these block development, but they raise the cost of every dependency bump and every new frontend feature, and they erode trust in the AGENTS.md/CLAUDE.md as a source of truth. The cross-workspace `@/* → ../api/src/*` tsconfig alias (used by seller to borrow the OnboardingStatus type from the API's internal db schema) is load-bearing but undocumented and fragile.

**Punti di forza:**

- Catalog discipline is genuinely consistent: every dependency shared by 2+ workspaces (react, tanstack-*, better-auth, zod, tailwind, vite, etc.) is referenced via `catalog:`, and every hardcoded version I audited is truly single-workspace (api-only @elysiajs/*, drizzle, pino; ui-only radix/cmdk/recharts; seller-only @dnd-kit). No real cross-workspace version drift.
- Clean, conventional workspace layout (apps/* + packages/*) with @bibs/<name> scoping, workspace:* links from frontends to @bibs/api and @bibs/ui, and a proper package `exports`/`imports` setup including the Eden Treaty type bridge via `@bibs/api`.
- Single source of truth for tooling at root: one biome.json (with sensible per-path overrides for generated files, migrations, routeTree.gen.ts), one Lefthook config (Biome pre-commit + Conventional Commits validation), one Renovate config with a working custom catalog manager, one tsconfig.base.json that all packages extend.
- CI is well-designed for the stack: three parallel jobs (lint / typecheck / api-test), frozen-lockfile installs, integration tests via testcontainers (no GitHub Actions `services:` needed), pretypecheck hooks compile Paraglide so a fresh clone typechecks without a dev server, and PR concurrency cancels stale runs while main runs complete.
- Renovate config is mature: grouped ecosystem bumps (drizzle/better-auth/elysia/radix/vite), auto-merge scoped to patches + curated dev-tooling minors, major bumps held for manual review, rangeStrategy:bump to keep caret floors synced, and TanStack deliberately excluded via ignoreDeps with the manual-SSR-check rationale documented.
- Strong agent-facing documentation surface: root AGENTS.md + apps/api/AGENTS.md + CLAUDE.md give detailed, mostly-accurate architecture, an endpoint-authoring rubric, and hard-rule safety guards (deny-list for .env, db:push, infra:reset, --no-verify).

**Problemi / raccomandazioni:**

- **[high/effort low] All TanStack packages pinned to `latest` — non-reproducible installs and sub-package version skew**
  - *Problema:* The catalog pins 10 @tanstack/* packages to the literal tag `latest` (react-start, react-router, react-query, react-table, router-plugin, devtools, etc.). A `latest` tag means `bun install` on a fresh clone or in CI can resolve a different version than what produced bun.lock until the lock is regenerated, and intra-ecosystem skew is already visible in the lockfile: react-start@1.168.14 bundles react-router@1.170.8 as a dependency while the catalog `latest` for @tanstack/react-router resolves on its own track. This is the exact failure mode MEMORY.md already records (1.167.48 shipped a broken SSR). It is the single largest reproducibility risk in the repo and undermines the otherwise-strict catalog discipline.
  - *Raccomandazione:* Pin each TanStack catalog entry to the exact version currently in bun.lock (e.g. `@tanstack/react-start: 1.168.14`, `@tanstack/react-router: 1.170.8`). Keep them in Renovate `ignoreDeps` so bumps stay manual + SSR-verified per the existing playbook, but make the pinned version the source of truth instead of `latest`. This preserves the deliberate manual-bump workflow while making installs deterministic and eliminating the skew. Document in AGENTS.md that the TanStack block is exact-pinned on purpose.
- **[high/effort medium] No frontend test gate; admin carries dead vitest/testing-library infrastructure**
  - *Problema:* The root `test` script and the CI `api-test` job run only @bibs/api tests. The three frontends (admin, customer, seller) ship zero test files. Worse, apps/admin declares a full test stack — vitest, @testing-library/dom, @testing-library/react, jsdom in devDependencies plus a `test: vitest run` script — but has no vitest.config and no *.test files, so the script is a no-op and the deps are dead weight. customer/seller have neither script nor deps. The result: `lint + typecheck + test` is the *full* CI gate in name only for everything outside the API, and the admin setup misleads agents into thinking a frontend test harness exists.
  - *Raccomandazione:* Decide one direction and make it real. Either (a) remove the dead admin test deps + script until there's a frontend testing strategy (smallest change, removes the lie), or (b) stand up a shared vitest config (e.g. a packages/vitest-config or root vitest.workspace.ts), add a smoke test per frontend, add `test` scripts to customer/seller, and extend the root `test` script + a CI job to run them. At minimum, document the current reality (frontends untested) in AGENTS.md so the claim 'lint + typecheck + test is the gate' isn't misread.
- **[medium/effort medium] Three byte-identical vite.config.ts and near-identical frontend tsconfigs (copy-paste duplication)**
  - *Problema:* apps/{admin,customer,seller}/vite.config.ts are identical except for the devtools eventBus port (42070/42071/42072) — same plugins, same ssr.noExternal, same `~/` alias, same Paraglide/Tailwind/TanStack/babel setup. The three frontend tsconfig.json files are likewise near-identical (the full bundler+linting compilerOptions block is duplicated verbatim; admin differs only by a stale `app.config.ts` include). Any future change (a new plugin, a moduleResolution tweak, an SSR option) must be hand-applied three times, which is exactly how configs silently drift.
  - *Raccomandazione:* Extract a shared vite factory in packages/ (e.g. `@bibs/vite-config` exporting `createFrontendConfig({ devtoolsPort })`) and have each app call it with just its port. For tsconfig, lift the shared frontend compilerOptions (target, jsx, module, lib, bundler flags, the noUnusedLocals/noUnusedParameters block, the `~/` path) into a `tsconfig.frontend.json` that extends tsconfig.base.json, leaving each app's tsconfig with only its `paths` and `include`. Reduces three files to thin shims.
- **[medium/effort low] Documentation drift: stale endpoint counts, undocumented modules, dead tsconfig include**
  - *Problema:* Several doc claims no longer match the code. apps/api/AGENTS.md says '~60 endpoints across 7 modules' and 'seller: 39 endpoints', but the modules directory now contains billing/ and webhooks/ modules that AGENTS.md never mentions (grep: 0 references to billing/webhooks), and there are ~160 route definitions across 30 route files. admin/tsconfig.json includes `app.config.ts` which does not exist (TanStack Start legacy artifact — Start moved to vite.config). Root AGENTS.md describes design fonts as 'Geist + Bricolage Grotesque' while MEMORY/brand-tokens-v2 say the current display font is Satoshi. The apps/api/AGENTS.md header still says 'provides guidance to WARP (warp.dev)'.
  - *Raccomandazione:* Run a doc-truth pass: regenerate the endpoint/module inventory in apps/api/AGENTS.md (or replace hard counts with 'see /openapi' to avoid future drift), add the billing + webhooks modules to the module list, remove the non-existent `app.config.ts` from admin/tsconfig include, reconcile the font claim with DESIGN.md/brand-tokens-v2, and fix the WARP header. Consider a lightweight CI check that fails if a module dir has no AGENTS.md mention, to keep counts honest.
- **[medium/effort medium] Undocumented, fragile cross-workspace alias: frontends reach into apps/api/src via `@/*`**
  - *Problema:* Each frontend tsconfig maps `@/*` to BOTH `./src/*` and `../api/src/*`. This is load-bearing: apps/seller imports `OnboardingStatus` from `@/db/schemas/seller` (the API's internal Drizzle schema, not the published `@bibs/api` type surface). This reaches across a workspace boundary into another package's internal source by relative tsconfig path, bypassing the package `exports`. It works in tsc/vite-tsconfig-paths but is invisible to the dependency graph, will break if api's internal layout moves, and is not the documented Eden-Treaty type-sharing path. AGENTS.md documents `@/* → ./src/*` only and omits the `../api/src/*` fallback entirely.
  - *Raccomandazione:* Make the shared types a first-class export of @bibs/api (e.g. re-export OnboardingStatus and any other borrowed types from the package `exports`, then import via `@bibs/api` like the App type already is) and drop the `../api/src/*` entry from the frontend `@/*` path mappings. If the alias must stay short-term, at minimum document it in AGENTS.md as an intentional internal coupling and note which types are borrowed.
- **[low/effort low] Dead dependency: @tanstack/match-sorter-utils in admin**
  - *Problema:* apps/admin declares `@tanstack/match-sorter-utils` (via catalog), but grep finds zero imports of `match-sorter` anywhere in apps/admin/src. It is an unused dependency carried in the catalog and the admin manifest, adding install weight and Renovate noise for nothing.
  - *Raccomandazione:* Remove `@tanstack/match-sorter-utils` from apps/admin/package.json and from the root catalog (no other workspace references it). Verify with `bun run typecheck` after removal.
- **[low/effort low] No runtime/toolchain version pin at root (Bun version not enforced)**
  - *Problema:* README says 'Bun ≥ 1.3' but the root package.json has no `packageManager` field and no `engines` constraint, and there is no .bun-version/.tool-versions. CI uses `oven-sh/setup-bun@v2` without a pinned version, so CI and local devs can silently run different Bun versions — relevant because Bun's workspace catalog + lockfile format and the Bun test runner behavior are version-sensitive, and the app relies on Bun-native APIs (Bun.S3Client, bun-types).
  - *Raccomandazione:* Add `"packageManager": "bun@<exact current version>"` (and/or an `engines.bun` floor) to root package.json, and pass `bun-version` to setup-bun in ci.yml so CI matches. Optionally add a .bun-version file for local consistency. Low effort, removes a class of 'works on my machine' issues around lockfile/test behavior.
- **[low/effort medium] packages/ui is excluded from Biome linting and from CI typecheck coverage**
  - *Problema:* biome.json disables the linter entirely for `packages/ui/**` (formatter still applies). Combined with the root `typecheck` running `--filter '*'` (which does include @bibs/ui's `tsc --noEmit`, so typecheck is covered), the lint gate has a blind spot: the largest hand-edited shared surface (all shadcn-derived components consumed by all three apps) gets no lint rules. This is a deliberate choice for vendored shadcn code, but it means bibs-authored components in packages/ui (combobox, municipality-combobox, data-table, etc.) also escape linting, and a regression there ships unlinted to every frontend.
  - *Raccomandazione:* Narrow the Biome ignore from all of `packages/ui/**` to just the vendored/generated shadcn primitives (e.g. an override on the specific shadcn component files), and re-enable linting for bibs-authored components and lib helpers in packages/ui. If full re-enable is too noisy, at least enable a minimal critical ruleset (correctness/suspicious) on packages/ui/src/lib and the non-vendored components.

**Struttura proposta:**

```
Target structure to reduce duplication and drift: (1) Add `packages/vite-config` (exports `createFrontendConfig({ devtoolsPort })`) and `packages/tsconfig` (or a root `tsconfig.frontend.json` extending tsconfig.base.json) so the three frontends shrink to thin shims that only declare their port + paths. (2) Pin the TanStack block in the root catalog to exact lockfile versions (keep in Renovate ignoreDeps). (3) Promote API types the frontends need (OnboardingStatus, etc.) into the `@bibs/api` package `exports` and drop the `../api/src/*` fallback from each frontend's `@/*` mapping, so cross-workspace coupling goes through the package boundary. (4) Either remove admin's dead vitest stack or stand up a shared `vitest.workspace.ts` + per-frontend smoke tests wired into the root `test` script and a new CI job, making `lint + typecheck + test` a true full gate. (5) Add `packageManager`/`engines` Bun pin at root and match it in setup-bun. (6) Refresh apps/api/AGENTS.md to list billing/webhooks modules and replace hard endpoint counts with a pointer to /openapi, and remove the stale `app.config.ts` include from admin/tsconfig.json.
```

### apps/api folder & module architecture

The apps/api backend has a sound core convention — guard-based domain modules (admin/, seller/, customer/) consistently follow the documented context.ts + routes/ + services/ pattern, and the seller module in particular (14 route files, 18 service files) shows the pattern scales well. However, the convention is applied unevenly across the rest of the tree, and lib/ has accreted genuine domain logic alongside infrastructure. The four concrete problem areas the task calls out are all real:

(a) Module structure is inconsistent in THREE distinct ways. First, the public catalog read modules live as bare files at src/modules/product-categories.ts, product-macro-categories.ts, store-categories.ts — flat siblings of folder-modules — and they reach DOWN into ./admin/services/* for their logic (a dependency inversion: the public, unauthenticated catalog now depends on the admin module). Second, AGENTS.md still documents these as a single categories.ts module and never mentions billing/, webhooks/, me/, or the split category files, so the docs are stale. Third, the sub-structure of registration/ (services.ts, no routes/ — routes inline in index.ts), billing/ (services/ only, NO routes, NO context.ts — it is a pure service library, not an HTTP module), and webhooks/ (routes/ + services/, no context.ts) all diverge from the canonical shape. The context.ts absence in locations/me/webhooks is actually defensible (no guard = no resolved context), but it is not documented as an intentional rule.

(b) lib/ IS becoming a junk drawer. It mixes true cross-cutting infrastructure (env, logger, errors, responses, pagination, s3, stripe, email, auth, config, money, countries) with domain logic that belongs to specific bounded contexts: order-helpers.ts and order-state-machine.ts are order-domain logic (imported only by seller/customer order services + the reservation job), and queries.ts is a grab-bag of four unrelated TypeBox query schemas (OrderListQuery, SellerListQuery, ProductSearchQuery, CategoryListQuery) that each belong to a different module. There is no lib/AGENTS.md rule distinguishing infra from domain, so the drawer will keep filling.

(c) Jobs genuinely live in three places with no rationale: src/jobs/ (auto-cancel-suspended-stores.ts, expire-pending-store-creations.ts), src/lib/jobs/ (expire-reservations.ts), and src/plugins/cron.ts (the scheduler wiring that imports from BOTH job dirs). The src/jobs vs src/lib/jobs split is purely historical — both are identical in kind (async functions invoked by cron).

(d) The schema split is correct in PRINCIPLE (db/schemas = Drizzle tables, lib/schemas = TypeBox API contracts) and should be kept — but it is undocumented as a deliberate two-layer design, and naming collisions (discount.ts exists in both) make it look accidental. The forms/ subfolder under lib/schemas is misplaced: 8 of its 9 importers are the seller module (the 9th is registration's AcceptInviteBody), so it is really seller request-body schemas, not a generic forms concept.

None of this is blocking — the app is pre-production (per project memory, schema changes are libere) and type-safety holds across the 3 Eden Treaty clients. These are cohesion/discoverability debts, best paid down incrementally.

**Punti di forza:**

- Guard-based domain modules (admin/, seller/, customer/) consistently follow the documented context.ts + routes/ + services/ triad, and the pattern demonstrably scales (seller/ has 14 route files and 18 service files cleanly separated).
- Genuine separation of concerns within the seller module: ownership/guard logic in context.ts, business logic in services/ using db.transaction() and atomic SQL, thin route handlers.
- The db/schemas (Drizzle tables) vs lib/schemas (TypeBox API contracts) two-layer split is architecturally correct — it keeps persistence and wire contracts independent, which is exactly right.
- webhooks/services/handlers/ is well-decomposed: one file per Stripe event type behind a dispatcher, with raw-body handling correctly isolated in the route.
- Cross-module shared order logic (order-helpers, order-state-machine) is correctly factored OUT of both seller and customer so it is not duplicated — the location is debatable but the de-duplication instinct is right.
- Infrastructure singletons (db, env, logger, s3, stripe, auth) are cleanly centralized and imported via the @/ alias everywhere, with env validated at startup.

**Problemi / raccomandazioni:**

- **[high/effort medium] Public catalog modules invert the dependency by importing from admin/services/**
  - *Problema:* src/modules/product-categories.ts, product-macro-categories.ts and store-categories.ts are flat files at the modules root that import listProductCategories / listProductMacroCategories / listStoreCategories from ./admin/services/*. The public, unauthenticated catalog now depends on the admin module — the wrong direction. It also breaks the folder-module convention (they are bare files alongside folder-modules) and makes the category domain physically split across three locations (public file, admin/routes, admin/services).
  - *Raccomandazione:* Create a single catalog/ folder-module that owns BOTH the public read routes and the admin write routes for all three category types, with the shared service logic in catalog/services/. Mount the public routes unguarded and the write routes behind the admin guard inside catalog/index.ts. This collapses the inversion and the 3-way split into one bounded context. Update src/index.ts and admin/index.ts mounts accordingly.
- **[medium/effort low] jobs/ logic split across three directories**
  - *Problema:* Background jobs live in src/jobs/ (auto-cancel-suspended-stores, expire-pending-store-creations), src/lib/jobs/ (expire-reservations), and the scheduler in src/plugins/cron.ts imports from both job dirs. The src/jobs vs src/lib/jobs split is purely historical — both contain the same kind of artifact (an async function run by cron).
  - *Raccomandazione:* Consolidate all job functions under src/jobs/ and delete src/lib/jobs/. Keep src/plugins/cron.ts as the scheduler-only wiring, importing every job uniformly from @/jobs. Move expire-reservations.ts to src/jobs/expire-reservations.ts and fix the one import in cron.ts.
- **[medium/effort low] lib/ mixes cross-cutting infra with order-domain logic**
  - *Problema:* src/lib/order-helpers.ts and src/lib/order-state-machine.ts are order bounded-context logic, not infrastructure. They are imported only by seller/services/orders.ts, customer/services/orders.ts and the reservation job — i.e. genuinely shared order logic, but parked in the infra drawer. This blurs the line between 'infra everyone uses' and 'domain a few modules share', encouraging more domain code to leak into lib/.
  - *Raccomandazione:* Move both into a small shared order home: either src/modules/orders/{state-machine.ts,helpers.ts} or src/lib/orders/. Then add an explicit rule (in AGENTS.md / a new lib/AGENTS.md) that lib/ is stateless infrastructure only and bounded-context logic shared by 2+ modules gets its own shared module folder.
- **[medium/effort medium] lib/queries.ts is a grab-bag of unrelated query schemas**
  - *Problema:* queries.ts bundles four TypeBox schemas that belong to four different modules: OrderListQuery (seller+customer orders), SellerListQuery (admin), ProductSearchQuery (customer search), CategoryListQuery (catalog). Co-locating them by accident of 'they are all query schemas' hides ownership and forces seven files across five modules to depend on one shared file.
  - *Raccomandazione:* Dissolve queries.ts: move each schema next to the module that owns it (OrderListQuery -> a shared orders schema or duplicated minimally per consumer, SellerListQuery -> admin, ProductSearchQuery -> customer, CategoryListQuery -> catalog). Keep only truly generic pagination primitives in lib/pagination.ts.
- **[low/effort medium] lib/schemas/forms/ is effectively seller-owned, not generic**
  - *Problema:* 8 of the 9 importers of lib/schemas/forms/* are the seller module (onboarding, settings, stores, products, checkout); only AcceptInviteBody is used by registration. Treating these as a generic 'forms' concept in lib/ misrepresents them as shared API contracts when they are seller request bodies.
  - *Raccomandazione:* Move the form schemas into modules/seller/schemas/ (onboarding/settings/stores/products/opening-hours) and relocate AcceptInviteBody to modules/registration. Reserve lib/schemas/ for genuinely cross-module contracts (entities, composed, responses, stock, discount).
- **[low/effort medium] Module sub-structure (registration/billing/webhooks) diverges without documented rationale**
  - *Problema:* registration/ keeps routes inline in index.ts with a flat services.ts (no routes/ split); billing/ has services/ but no routes and no context.ts (it is a pure service library mounted nowhere — only imported by seller checkout); webhooks/ has routes/+services/ but no context.ts. The context.ts-absence is defensible for no-guard modules, but none of these deviations are documented, so they read as inconsistency rather than intent.
  - *Raccomandazione:* Two-part fix. (1) Make small folder-modules conform: give registration/ a routes/ file so index.ts only composes. (2) Document the rules explicitly in apps/api/AGENTS.md: context.ts is required only for guard-based modules; 'modules' that expose no HTTP routes (billing) should be named/placed as shared service libs (e.g. under a _shared/ or lib/ namespace) so they are not mistaken for HTTP modules. Also refresh AGENTS.md which still references a single categories.ts module and omits billing/webhooks/me entirely.
- **[low/effort low] db/schemas vs lib/schemas split is correct but undocumented and name-colliding**
  - *Problema:* The two-layer schema design (Drizzle tables in db/schemas, TypeBox wire contracts in lib/schemas) is the right call, but it is not documented as deliberate, and identical filenames (discount.ts exists in both) make the split look accidental and risk confusing imports.
  - *Raccomandazione:* Keep the split. Document it in AGENTS.md as an intentional two-layer contract (persistence vs wire). Optionally disambiguate collisions by suffix or path clarity (e.g. lib/schemas/discount.ts is unambiguous via the @/lib/schemas barrel already, so this is mostly a documentation fix).

**Struttura proposta:**

```
Proposed target layout (concrete moves):

src/modules/
  catalog/                         # NEW — public read + admin write of categories, one bounded context
    context.ts                     #   (admin-write guard helper)
    routes/
      product-categories.ts        # <- move src/modules/product-categories.ts (public GET)
      product-macro-categories.ts  # <- move src/modules/product-macro-categories.ts (public GET)
      store-categories.ts          # <- move src/modules/store-categories.ts (public GET)
      product-categories.write.ts  # <- move admin/routes/product-categories.ts
      product-macro-categories.write.ts
      store-categories.write.ts
      category-imports.ts          # <- move admin/routes/category-imports.ts
    services/                      # <- move admin/services/{product-categories,product-macro-categories,store-categories,category-import}.ts
    index.ts                       # mounts public routes unguarded + write routes behind admin guard
  admin/                           # keeps sellers, seller-changes, configurations, billing (category routes leave)
  seller/  customer/  me/  locations/   # unchanged
  registration/
    routes/registration.ts         # <- extract route defs out of index.ts (match the convention)
    services.ts (or services/)
    index.ts                       # just composes routes/
  billing/                         # KEEP as a shared service lib, but RENAME the folder to make intent explicit
    services/customer.ts           # (consider moving under src/lib/stripe/ OR naming it _shared/billing)
  webhooks/                        # unchanged (routes/ + services/handlers/), document the no-context.ts rule

src/modules/orders/  (or src/lib/orders/)   # NEW home for shared order domain
  state-machine.ts                 # <- move src/lib/order-state-machine.ts
  helpers.ts                       # <- move src/lib/order-helpers.ts

src/jobs/                          # SINGLE jobs home — collapse the three locations
  auto-cancel-suspended-stores.ts  # (stays)
  expire-pending-store-creations.ts# (stays)
  expire-reservations.ts           # <- move from src/lib/jobs/expire-reservations.ts (delete src/lib/jobs/)
src/plugins/cron.ts                # scheduler only — keep, but it now imports every job from @/jobs uniformly

src/lib/                           # PURE infra after the moves
  env, logger, errors, responses, pagination, s3, stripe, email, auth, config, money, countries, permissions
  schemas/                         # API contracts (keep)
    entities.ts composed.ts responses.ts stock.ts discount.ts
    # queries.ts is DISSOLVED: OrderListQuery -> modules/{seller,customer}, SellerListQuery -> modules/admin,
    #   ProductSearchQuery -> modules/customer, CategoryListQuery -> modules/catalog
    # forms/ -> moved to modules/seller/schemas/ (AcceptInviteBody -> modules/registration), since 8/9 importers are seller

Document the layered rule in apps/api/AGENTS.md + a new src/lib/AGENTS.md: lib/ = stateless infra only, no bounded-context logic; module-owned schemas live with the module; db/schemas = tables, lib/schemas = wire contracts.
```

### Frontend apps (admin/customer/seller) and packages/ui architecture

The three TanStack Start apps share a real but unfactored "app shell": api.ts, env.ts, auth-client.ts, the TanStack Query integration, router.tsx, devtools, and the _authenticated guard skeleton are near-identical copy-paste across all three. By line count this is roughly 110-130 LOC of effectively-frozen boilerplate duplicated x3 (api.ts is byte-identical x3; env.ts is byte-identical x3; root-provider 34 LOC x3 and devtools 6 LOC x3 are byte-identical x3; auth-client differs only by adminClient(); router.tsx differs only by import alias; the _authenticated guard shares a session/redirect/spinner skeleton then diverges on role logic). None of it lives in a shared package — the only shared workspace package is @bibs/ui. This is the single biggest opportunity: a thin @bibs/app-kit (or @bibs/api-client + @bibs/app-shell) would absorb api.ts, env.ts, auth-client factory, the TanStack Query provider/devtools, and an AuthGuard primitive, leaving each app to supply only its role check and chrome.

packages/ui is in better shape than the question implies. The "app-specific" components flagged (personal-info-card, pending-verification-banner, avatar-upload-dialog, brand-mark, municipality-combobox, discounted-price) are actually written headless: they take labels-as-props (no Paraglide/i18n inside), import only ~/components/* primitives, and have zero api/auth/router imports. The real app coupling is correctly isolated in app-side *-connected.tsx wrappers (e.g. apps/seller/.../pending-verification-banner-connected.tsx wires authClient + m.* messages around the pure @bibs/ui banner). So the library hasn't "absorbed" business logic. Two genuine problems remain: (1) discounted-price.tsx is dead code — zero consumers anywhere; (2) municipality-combobox is consumed by seller only (5 call sites, all seller) — it is a single-app component sitting in the shared library. personal-info-card, pending-verification-banner and brand-mark are legitimately multi-app and belong where they are.

The features/components organization is incoherent across apps because there is no documented convention and the seller app is the only one with a mature pattern. seller uses features/<domain>/{components,hooks,schemas} AND a separate top-level src/hooks/ for cross-domain hooks (use-municipalities, use-stores, use-active-store) — a reasonable two-tier split. admin uses features/<domain>/{components,schemas} but has NO top-level hooks dir, no per-feature hooks dir. customer is a near-empty skeleton (features/auth has a single connected component, no schemas). The pattern that should be canonical (seller's) is undocumented, so admin and customer drift.

Two architectural smells worth flagging beyond the question's scope: (1) the integrations/better-auth/header-user.tsx file (BetterAuthHeader) exists in admin and seller, is byte-identical between them, and is DEAD CODE in both — it has no consumers; the real signed-in user UI is nav-user.tsx. It is leftover TanStack Start starter scaffolding. (2) All three tsconfigs alias @/* to BOTH ./src/* and ../api/src/* as a fallback; only seller exploits this to import a backend Drizzle type (import type { OnboardingStatus } from "@/db/schemas/seller" in _authenticated.tsx and onboarding-stepper.tsx). This is type-only (tree-shaken) but it (a) couples the seller frontend to the backend's DB file layout and (b) makes @/ ambiguous — the same prefix resolves to two roots, a maintenance footgun. That enum should be exported from the @bibs/api public type surface, not reached for via a filesystem path.

**Punti di forza:**

- packages/ui components are genuinely headless: personal-info-card, pending-verification-banner and avatar-upload-dialog take labels-as-props with no embedded i18n, import only ~/components/* primitives, and have no api/auth/router dependencies — so they are reusable and the library is not polluted with business logic
- App-specific coupling is correctly isolated in app-side *-connected.tsx wrappers (e.g. seller's pending-verification-banner-connected.tsx), a clean container/presentational split between @bibs/ui and the apps
- seller's features/<domain>/{components,hooks,schemas} layout plus a top-level src/hooks/ for cross-domain hooks is a sound, scalable convention — it just needs to be documented and adopted by the other two apps
- The Eden Treaty + createIsomorphicFn pattern in api.ts is identical and correct across all three, giving end-to-end types from @bibs/api with zero hand-written DTOs
- Shared multi-app components that DO live in @bibs/ui (brand-mark used by all 3, personal-info-card used by all 3, pending-verification-banner used by seller+customer) are placed correctly

**Problemi / raccomandazioni:**

- **[high/effort medium] App-shell boilerplate (api.ts, env.ts, auth-client, query integration, AuthGuard) copy-pasted across all 3 apps with no shared package**
  - *Problema:* apps/{admin,customer,seller}/src/lib/api.ts are byte-for-byte identical (25 LOC x3). src/env.ts is byte-identical (40 LOC x3). src/integrations/tanstack-query/root-provider.tsx (34 LOC) and devtools.tsx (6 LOC) are byte-identical x3. auth-client.ts differs only by the presence of adminClient(). router.tsx differs only by import alias. The _authenticated.tsx guards share a session-check/redirect/spinner skeleton. Roughly 110-130 LOC of frozen boilerplate is maintained in triplicate; any change (e.g. a fetch option, a QueryClient default, a new auth plugin) must be hand-applied three times and silently drifts otherwise.
  - *Raccomandazione:* Create a thin @bibs/app-kit workspace package exporting: the isomorphic Eden Treaty client (api.ts), the env schema (env.ts), a createBibsAuthClient({plugins}) factory, the TanStack Query provider + devtools, and an <AuthGuard allowedRoles onboarding?> component encapsulating the session/redirect/spinner skeleton. Each app imports these and supplies only its role list and chrome. Keep router.tsx per-app (it references the app's own routeTree.gen).
- **[medium/effort low] municipality-combobox lives in @bibs/ui but is consumed only by the seller app**
  - *Problema:* packages/ui/src/components/municipality-combobox.tsx has 5 consumers and all 5 are in apps/seller (store-form, business-info-card, and 3 onboarding routes). It is a single-app component occupying the shared primitives library, blurring the line between 'generic primitive' and 'app feature'. (It is at least correctly headless — it takes municipalities as a prop, no data fetching.)
  - *Raccomandazione:* Move it to apps/seller/src/features/stores/components/municipality-combobox.tsx (it is domain UI, not a primitive). If a customer-side municipality picker is on the roadmap, instead promote it into a small @bibs/geo domain package rather than leaving it in @bibs/ui.
- **[medium/effort medium] features/components/hooks organization is inconsistent across apps with no documented convention**
  - *Problema:* seller uses features/<domain>/{components,hooks,schemas} plus a top-level src/hooks/ for cross-domain hooks (a sound two-tier split). admin uses features/<domain>/{components,schemas} with no hooks dir at any level. customer is a near-empty skeleton (features/auth holds a single connected component, no schemas, no per-feature structure). Because the good pattern (seller's) is undocumented, admin and customer have drifted and new code has no canonical home.
  - *Raccomandazione:* Document seller's layout as the standard in each app's AGENTS.md (or root AGENTS.md): features/<domain>/{components,hooks,schemas} for domain code, src/hooks/ for cross-domain hooks, src/components/ for app chrome. Backfill admin (move query hooks into features/<domain>/hooks or src/hooks) opportunistically; leave customer thin until it grows but apply the convention as routes are added.
- **[medium/effort low] tsconfig @/* aliases to both ./src/* and ../api/src/*, and seller reaches across into the backend Drizzle schema**
  - *Problema:* All three apps' tsconfig.json alias @/* to ["./src/*", "../api/src/*"], so the same @/ prefix non-deterministically resolves against two roots. Only seller exploits it: apps/seller/src/routes/_authenticated.tsx and features/onboarding/components/onboarding-stepper.tsx do `import type { OnboardingStatus } from "@/db/schemas/seller"`, reaching directly into apps/api/src/db/schemas/seller.ts. It is type-only (erased at build) but it couples the seller frontend to the backend's internal DB file layout and makes @/ ambiguous for every reader and tool.
  - *Raccomandazione:* Re-export OnboardingStatus from the @bibs/api public type surface and change seller's imports to `from "@bibs/api"`. Then tighten all three tsconfigs to alias @/* -> ./src/* only, removing the ../api/src/* fallback so the prefix is unambiguous.
- **[low/effort low] discounted-price.tsx in @bibs/ui is dead code**
  - *Problema:* packages/ui/src/components/discounted-price.tsx (DiscountedPrice) has zero consumers anywhere in apps/ or packages/ (grep for both the file import and the symbol returns nothing; price.tsx is the one actually used, in seller).
  - *Raccomandazione:* Delete discounted-price.tsx. Re-introduce from git history if/when a discounted-price display is actually needed.
- **[low/effort low] BetterAuthHeader (integrations/better-auth/header-user.tsx) is identical dead scaffolding in admin and seller**
  - *Problema:* apps/admin and apps/seller both contain integrations/better-auth/header-user.tsx (byte-identical, 40 LOC). It exports BetterAuthHeader but has zero consumers — the real signed-in user UI is nav-user.tsx. It is leftover TanStack Start starter scaffolding that was never wired up, and customer doesn't even have the folder, creating a phantom inconsistency.
  - *Raccomandazione:* Delete both apps/{admin,seller}/src/integrations/better-auth/ directories. If a header user widget is ever wanted, build it as a real component in src/components/.
- **[low/effort medium] verify-email and register auth routes are largely duplicated between customer and seller**
  - *Problema:* apps/customer/src/routes/verify-email.tsx and apps/seller/src/routes/verify-email.tsx differ by only 3 lines (one descriptive sentence). The login routes share the same Card+BrandMark+LoginForm scaffold differing mainly in title text and the email-not-verified branch. This is lower-volume duplication than the app-shell but still drifts (admin's login lacks the verify-email branch that seller has).
  - *Raccomandazione:* After @bibs/app-kit exists, extract a shared AuthCardShell (BrandMark + Card + title/description slots) and a useVerifyEmailResend hook (cooldown + sendVerificationEmail + toast) into app-kit or @bibs/ui; keep per-app copy in Paraglide messages. Lower priority than the core shell extraction.

**Struttura proposta:**

```
Introduce one thin shared package, @bibs/app-kit (workspace:*, depended on by all three apps alongside @bibs/api and @bibs/ui), holding the frozen app-shell boilerplate:

packages/app-kit/src/
  api.ts                      # the isomorphic Eden Treaty factory (currently x3 identical)
  env.ts                      # t3 createEnv block (currently x3 identical)
  auth-client.ts             # createBibsAuthClient({ plugins }) factory; admin/seller pass adminClient(), customer passes none
  query/root-provider.tsx     # TanStackQueryProvider + getContext (currently x3 identical)
  query/devtools.tsx          # (currently x3 identical)
  auth/auth-guard.tsx         # <AuthGuard allowedRoles={[...]} onboarding={...}> wrapping the session/redirect/spinner skeleton; apps pass role list + optional onboarding redirect map

Each app keeps router.tsx (uses its own routeTree.gen) but imports getContext from @bibs/app-kit. _authenticated.tsx in each app shrinks to <AuthGuard allowedRoles={["admin"]}>…app chrome…</AuthGuard>; seller's onboarding-redirect logic stays in seller (or becomes an AuthGuard prop).

Within @bibs/ui:
  - DELETE discounted-price.tsx (dead code)
  - MOVE municipality-combobox.tsx out to apps/seller/src/features/stores/components/ (or a future @bibs/geo) since it is seller-only
  - KEEP brand-mark, personal-info-card, pending-verification-banner, avatar-upload-dialog (legitimately multi-app, already headless)

App internals — adopt seller's convention everywhere and document it in apps/<app>/AGENTS.md:
  src/features/<domain>/{components,hooks,schemas}/   # domain-scoped
  src/hooks/                                          # cross-domain hooks only
  src/components/                                     # app chrome (sidebar, nav-user, breadcrumb, badges)

Cleanup: DELETE apps/{admin,seller}/src/integrations/better-auth/header-user.tsx (dead starter scaffolding). Tighten each tsconfig @/* to ./src/* ONLY; export OnboardingStatus from @bibs/api's public type surface and have seller import it from "@bibs/api" instead of "@/db/schemas/seller".
```

---

## Finding per sottosistema

### `api-auth` — 9 finding

> The subsystem is structured cleanly and follows the repo conventions (ServiceError + global handler, ok() envelopes, TypeBox schemas). The most consequential issues stem from wrapping better-auth's server-side `auth.api.*` calls in custom Elysia routes: those calls bypass better-auth's built-in rate limiting and throw APIError on auth failure, which the global error handler does not recognize and downgrades to a 500 (turning unverified-login and bad-credential cases into opaque server errors). There are also a couple of non-atomic multi-step writes (signUpEmail followed by a separate transaction) that can leave orphaned users with no profile/role, and a CORS rule that accepts any localhost origin with credentials regardless of environment. None are catastrophic for a dev-stage app, but the 500-on-auth-failure and missing rate limiting are worth fixing before any deployment.

#### 🔴 [high/bug] Unverified login and bad-credential errors from better-auth become 500s · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/registration/services.ts:266`
- **Confidence:** high
- **Descrizione:** The custom /sign-in endpoint calls auth.api.signInEmail server-side. With emailAndPassword.requireEmailVerification:true (auth.ts:52), better-auth throws an APIError (HTTP 403) when the email is not verified, and an APIError (401) on invalid credentials. APIError is not a ServiceError and has no pg `cause`/`code`, so the global error handler (error-handler.ts) falls through all branches to the catch-all 500 handler. Users with a correct-but-unverified account, or wrong passwords, receive a 500 'Internal server error' instead of a 401/403 with an actionable message, and the real reason is logged as an 'Unhandled error'.
- **Evidenza:** const result = await auth.api.signInEmail({ body: { email, password } });
// auth.ts: requireEmailVerification: true  -> signInEmail throws APIError(403) when unverified
// error-handler.ts: only handles ServiceError / 23505 / VALIDATION / NOT_FOUND, else 500
- **Fix proposto:** Catch better-auth's APIError in signIn (or add an APIError branch in the global error handler that maps err.status/err.statusCode to the matching ServiceError envelope) so unverified (403) and invalid-credential (401) cases return correct status codes and messages instead of 500.
- **Verifica (confirmed):** All four pieces of evidence in the claim hold:

1. `/apps/api/src/lib/auth.ts:52` — `requireEmailVerification: true` is set in the emailAndPassword config.

2. `/node_modules/.bun/better-auth@1.6.11.../dist/api/routes/sign-in.mjs` lines 203–241 — For invalid credentials, better-auth throws `APIError.from("UNAUTHORIZED", ...)` (HTTP 401). For an unverified email, it throws `APIError.from("FORBIDDEN", BASE_ERROR_CODES.EMAIL_NOT_VERIFIED)` (HTTP 403). These are instances of `APIError` from `better-call`, NOT of `ServiceError`.

3. `/node_modules/.bun/better-auth@1.6.11.../dist/api/to-auth-endpoints.mjs` lines 68 and 152–170 — When `auth.api.signInEmail` is called with only `{ body: ... }` (no `request` object, no `asResponse: true`), `shouldReturnResponse` evaluates to `false`. The code at line 152 checks `isAPIError(result.response) && !shouldReturnResponse` and re-throws the raw `APIError` to the caller. The APIError is not silently swallowed into a response object.

4. `/apps/api/src/plugins/error-handler.ts` lines 31–112 — The global Elysia error handler has four branches: `instanceof ServiceError`, pg `23505` unique violation (checked via `error.cause.code`), Elysia code `VALIDATION`, and Elysia code `NOT_FOUND`. `APIError` from better-call/better-auth is none of these: it is not a `ServiceError`, has no `cause.code === "23505"`, and Elysia's internal `code` field is not set to `VALIDATION` or `NOT_FOUND`. It falls through to the catch-all at line 101 which logs "Unhandled error" and returns `status(500, ...)`.

5. `/apps/api/src/modules/registration/services.ts:266` and `/apps/api/src/modules/registration/index.ts:121` — Neither the service function nor the route handler wraps `auth.api.signInEmail` in a try/catch.

The bug is real and triggerable: any user with an unverified email who attempts to sign in, or any user who enters wrong credentials, will receive a 500 "Internal server error" instead of a meaningful 401/403 response. Severity high is appropriate.

#### 🔴 [high/security] Custom auth endpoints bypass better-auth rate limiting (brute-force / signup spam) · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/registration/services.ts:111`
- **Confidence:** high
- **Descrizione:** Per better-auth docs, rate limiting only applies to client-initiated requests; server-side auth.api.* calls are NOT rate limited. The custom /register/customer, /register/seller, /accept-invite and /sign-in routes all reach better-auth exclusively via auth.api.signUpEmail / signInEmail, so they are exempt from better-auth's rate limiter. There is no other throttling in the Elysia stack (index.ts has no rate-limit plugin). This exposes unbounded password brute-force on /sign-in, account-enumeration on /register, and unbounded verification-email sends (each signup and each pending-resend triggers sendEmail).
- **Evidenza:** // better-auth docs: 'Server-side requests made using auth.api aren't affected by rate limiting.'
const { user: newUser, token } = await auth.api.signUpEmail({ body: { name, email, password } });
const result = await auth.api.signInEmail({ body: { email, password } });
- **Fix proposto:** Add an IP/email-keyed rate limiter (e.g. an Elysia rate-limit plugin or a small in-DB/Redis counter) in front of the /register/*, /accept-invite and /sign-in routes, since better-auth's own limiter does not cover these server-side calls.
- **Verifica (confirmed):** All cited evidence independently verified:

1. apps/api/src/lib/auth.ts (lines 17-88): The betterAuth() config has no rateLimit option and the plugins array contains only openAPI() and admin(...). better-auth's built-in rate limiter is not enabled at all, let alone for server-side calls.

2. apps/api/src/modules/registration/services.ts line 111: auth.api.signUpEmail() is called directly (server-side). Line 266: auth.api.signInEmail() is called directly. Both are server-side auth.api.* invocations that bypass whatever client-facing rate limiting better-auth would otherwise apply.

3. apps/api/src/index.ts: The Elysia app mounts errorHandler, requestId, normalize, cors, and domain modules — no rate-limit plugin at any level.

4. apps/api/src/modules/registration/index.ts: The four routes (/register/customer, /register/seller, /register/accept-invite, /register/sign-in) have no throttle, IP-keyed guard, or per-route middleware.

5. A grep across the entire repo for rateLimit, rate_limit, rateLimiter, throttle returns zero results.

The issue is real and triggerable as described: an attacker can send unbounded POST requests to /register/sign-in for brute-force, or spam /register/customer and /register/seller triggering unbounded sendVerificationEmail calls. No existing guard, transaction, or constraint prevents this. The house rules do not apply — they cover migration cost, money storage, enum conventions, ServiceError signature, and similar design decisions, none of which bear on the absence of rate limiting. Severity high is correct.

#### 🟠 [medium/reliability] Non-atomic signup: signUpEmail outside the profile/role transaction can orphan users · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/registration/services.ts:111`
- **Confidence:** high
- **Descrizione:** registerUser creates the user+account via auth.api.signUpEmail, then in a SEPARATE db.transaction sets role and inserts the customer/seller profile. If the transaction fails (e.g., profile insert error, transient DB error), the user and account rows already committed by signUpEmail remain, leaving an account with role=null and no profile. Because emailVerified is false, decideExistingUser would later treat it as 'pending-resend' (within 7 days) and refuse a clean re-register, blocking the email for up to a week even though no usable account exists. acceptInvite has the same shape (signUpEmail at :210, then a separate transaction at :215).
- **Evidenza:** const { user: newUser, token } = await auth.api.signUpEmail({ body: { name, email, password } });
const profile = await db.transaction(async (tx) => {
  await tx.update(user).set({ role }).where(eq(user.id, newUser.id));
  return createProfile(tx, newUser.id);
});
- **Fix proposto:** Wrap the role update + profile creation in a try/catch that deletes the just-created user (FK cascade cleans account/session) on failure, or restructure so the profile/role write cannot leave a half-provisioned account. At minimum, delete the orphaned user if the post-signup transaction throws.
- **Verifica (confirmed):** The code at /Users/marcogelli/repos/jelaz/bibs/apps/api/src/modules/registration/services.ts confirms the issue exactly as described.

Lines 111-119: `auth.api.signUpEmail` commits the user+account row (emailVerified=false, role=null), then a separate `db.transaction` at line 115 sets the role and inserts the profile. There is no try/catch around the transaction that would delete the just-created user on failure.

Recovery path analysis for `registerUser`: On a subsequent signup attempt with the same email within 7 days, `decideExistingUser` returns `pending-resend` (line 43-44) because `emailVerified` is false and age < PENDING_TTL_MS. The `pending-resend` branch (lines 81-97) sends another verification email to the orphaned account and throws `PendingVerificationError` — blocking the email for up to 7 days. After 7 days, `pending-expired` (lines 99-105) deletes the orphaned user and allows a fresh signup, so there is eventual recovery, but the 7-day block is real.

For `acceptInvite` (lines 210-215): the shape is identical — `signUpEmail` at line 210 commits the user, then a separate transaction at line 215 handles role/employee/invitation updates. However, the existing-user guard at lines 201-206 throws a hard 409 ("already registered") for any existing user regardless of verification status, with no TTL or cleanup path. So an orphaned user from a failed `acceptInvite` transaction permanently blocks that email from reusing the invite flow (no 7-day expiry recovery).

No existing guard, constraint, or transaction boundary prevents this split-commit orphan scenario. The issue is real and triggerable by any transient DB error or constraint violation in the profile-insert step. The severity medium is appropriate.

#### 🟠 [medium/security] CORS accepts any localhost origin with credentials regardless of environment · verifica: **confirmed**

- **Dove:** `apps/api/src/index.ts:46`
- **Confidence:** high
- **Descrizione:** The CORS origin callback returns true for any origin matching /^http:\/\/localhost(:\d+)?$/ with no NODE_ENV guard, while credentials:true is enabled. The comment says 'In sviluppo' but nothing restricts this branch to development, so a production deployment would also reflect-allow http://localhost (any port) with credentials. A malicious page served on the victim's localhost (e.g., a local dev tool, or a compromised localhost app) could make credentialed cross-origin requests.
- **Evidenza:** if (origin?.match(/^http:\/\/localhost(:\d+)?$/)) {
  return true;
}
...
credentials: true,
- **Fix proposto:** Gate the localhost allowance behind `env.NODE_ENV !== 'production'` so production relies solely on the ALLOWED_ORIGINS allow-list.
- **Verifica (confirmed):** The code at /Users/marcogelli/repos/jelaz/bibs/apps/api/src/index.ts lines 43-58 confirms the finding exactly as described. The origin callback at line 46 matches any `http://localhost(:\d+)?` origin and returns `true` unconditionally — there is no `process.env.NODE_ENV` check or any other environment guard. The comment "In sviluppo" on line 45 is purely cosmetic. `credentials: true` is set at line 54. House Rule #1 exempts only "this requires a migration" / schema-design penalties, not CORS security misconfigurations. The technical claim is accurate: in a production deployment the API would reflect-allow any http://localhost origin with credentials. The attack surface is real (any service running on the victim's localhost could make credentialed requests to the bibs API), though it requires the attacker to control a local service. Severity "medium" is appropriate given the precondition. The proposed fix (gating behind `env.NODE_ENV !== 'production'`) is correct.

#### 🟠 [medium/security] Custom duplicate-email check defeats better-auth email-enumeration protection

- **Dove:** `apps/api/src/modules/registration/services.ts:71`
- **Confidence:** medium
- **Descrizione:** With requireEmailVerification:true, better-auth normally returns a generic synthetic response on duplicate sign-up to prevent email enumeration. registerUser instead does its own db.query.user.findFirst on the email and throws distinct EMAIL_ALREADY_REGISTERED vs EMAIL_PENDING_VERIFICATION (with a resentAt timestamp) BEFORE calling signUpEmail, which lets an unauthenticated caller positively enumerate which emails are registered and whether they are verified. The OpenAPI descriptions document this as intentional (banner UX), so this may be an accepted product tradeoff, but it is a deliberate weakening of the platform's enumeration protection and combined with the missing rate limiting it is cheaply exploitable.
- **Evidenza:** const existing = await db.query.user.findFirst({ where: eq(user.email, email) });
const decision = decideExistingUser(existing, Date.now());
... throw new EmailAlreadyRegisteredError(); / throw new PendingVerificationError(resentAt);
- **Fix proposto:** If enumeration resistance matters, return a uniform response for both the duplicate and new cases (and rely on the verification email to disambiguate). If the distinct responses are an intentional UX requirement, pair them with the rate limiter above to bound enumeration.

#### 🟡 [low/dead-code] Dead-code guard: signInEmail throws on failure, so `if (!result.user)` never runs · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/registration/services.ts:270`
- **Confidence:** medium
- **Descrizione:** auth.api.signInEmail throws an APIError on invalid credentials / unverified email rather than returning a result with a falsy user. Therefore the `if (!result.user) throw new ServiceError(401, 'Invalid credentials')` branch is unreachable. This is misleading because it implies bad credentials are surfaced as a clean 401 here, when in reality the thrown APIError escapes to the global handler (see the 500 finding).
- **Evidenza:** const result = await auth.api.signInEmail({ body: { email, password } });
if (!result.user) {
  throw new ServiceError(401, "Invalid credentials");
}
- **Fix proposto:** Replace the dead guard with an actual try/catch around signInEmail that translates APIError into the intended ServiceError(401)/ServiceError(403), and drop the unreachable check.
- **Verifica (confirmed):** The claim is verified. At apps/api/src/modules/registration/services.ts:270, the guard `if (!result.user) throw new ServiceError(401, "Invalid credentials")` is dead code.

Evidence from the installed better-auth@1.6.11 package:

1. Return type of signInEmail (dist/api/routes/sign-in.d.mts, lines 176-180): the resolved type is `{ redirect: boolean; token: string; url?: string | undefined; user: User<...> }` — `user` is NOT optional. On a successful return, user is always present.

2. Implementation (dist/api/routes/sign-in.mjs): on all failure paths (user not found, credential account not found, no password hash, wrong password, email not verified, failed session creation), the function throws `APIError.from(...)` rather than returning a result with a null/falsy user.

3. Execution path for `auth.api.*` calls (dist/api/to-auth-endpoints.mjs, lines 152-170): when an APIError is encountered on the non-response path (i.e., when calling `auth.api.signInEmail` directly from service code), the framework re-throws the raw APIError: `throw result.response`. The comment explicitly states: "Non-response path: we re-throw the raw APIError to callers of `auth.api.*`."

Therefore: when invalid credentials or unverified email are supplied, `auth.api.signInEmail` throws an APIError before ever returning. The `if (!result.user)` check at line 270 can never be reached on the error path. The guard is unreachable dead code, exactly as the reviewer described.

The severity of "low" is appropriate — this is misleading dead code but not a security issue, since the APIError still propagates to the global handler.

#### 🟡 [low/bug] afterEmailVerification unconditionally resets seller onboardingStatus to pending_personal · verifica: **confirmed**

- **Dove:** `apps/api/src/lib/auth.ts:69`
- **Confidence:** medium
- **Descrizione:** afterEmailVerification advances any seller's onboardingStatus to 'pending_personal' whenever an email is verified, with no check of the current status. If email verification can be re-triggered after a seller has progressed (e.g., a future email-change flow, or a re-verification), this would silently roll the seller's onboarding back to pending_personal from a later state (pending_company / pending_review / active). Today the only path here is initial signup, so the blast radius is small, but the unconditional set is fragile.
- **Evidenza:** if (userRecord?.role === "seller") {
  await db.update(sellerProfile)
    .set({ onboardingStatus: "pending_personal" })
    .where(eq(sellerProfile.userId, user.id));
}
- **Fix proposto:** Only advance when currently 'pending_email' (e.g., add `and(eq(sellerProfile.userId, user.id), eq(sellerProfile.onboardingStatus, 'pending_email'))` to the WHERE), so re-verification can never move onboarding backward.
- **Verifica (confirmed):** The cited code at apps/api/src/lib/auth.ts lines 69-81 is exactly as described. The afterEmailVerification callback unconditionally sets onboardingStatus to "pending_personal" with only `eq(sellerProfile.userId, user.id)` in the WHERE clause — no guard on the current status value.

The sellerProfile schema (apps/api/src/db/schemas/seller.ts) confirms the onboardingStatuses array: ["pending_email", "pending_personal", "pending_document", "pending_company", "pending_review", "active", "rejected"]. The default is "pending_email". So the intended transition is pending_email → pending_personal on verification, but the unconditional write would also roll back any later status to pending_personal if triggered again.

Triggerable today? The auth.ts config enables only openAPI and admin plugins — there is no changeEmail plugin, no sendOnEmailChange option, and no email-change route anywhere in the codebase (grep for changeEmail/emailChange returned nothing). The only path to afterEmailVerification today is the initial signup verification triggered by registerSeller in registration/services.ts. So the regression is not currently triggerable.

The claim correctly characterizes this as a latent fragility ("today the only path here is initial signup, so the blast radius is small") — the code is unconditional and would silently regress onboarding if a future email-change feature is added without updating this callback. The bug is real and the evidence is accurate. Severity low is appropriate given the current non-deployability (bibs is in active development, not in production) and the fact that the risk is only realized if a new feature is added.

#### 🟡 [low/consistency] Best-effort resend email failure is logged via console.error instead of pino

- **Dove:** `apps/api/src/modules/registration/services.ts:91`
- **Confidence:** high
- **Descrizione:** The pending-resend branch swallows sendVerificationEmail failures with console.error, while the rest of the subsystem uses the structured pino logger (getLogger(store)) for observability and request correlation. This log line will not carry the request id and will not match the file/transport configuration used everywhere else, making resend failures hard to trace.
- **Evidenza:** } catch (err) {
  console.error("sendVerificationEmail failed on pending re-signup", { err, email });
}
- **Fix proposto:** Pass the logger (or store) into registerUser and log the failure via pino.warn/error with the request context, consistent with the rest of the codebase.

#### 🟡 [low/type-safety] Two registration endpoints respond with okRes(t.Any()), losing response type safety

- **Dove:** `apps/api/src/modules/registration/index.ts:44`
- **Confidence:** medium
- **Descrizione:** Both /register/customer and /register/seller declare `response: withConflictErrors({ 200: okRes(t.Any()) })`. The 200 data shape (user, profile, token) is therefore untyped in the OpenAPI spec and in the Eden Treaty types consumed by the three frontends, so FE callers get `any` for the registration response and lose the compile-time guarantees the rest of the API relies on. /sign-in similarly has no response schema at all.
- **Evidenza:** response: withConflictErrors({ 200: okRes(t.Any()) }),
- **Fix proposto:** Define a concrete TypeBox schema for the registration/sign-in success payload (user fields, profile, token) and use it instead of t.Any(), and add a response schema to /sign-in, so Eden Treaty types are accurate.

### `api-errors` — 6 finding

> This subsystem is small, well-factored, and largely correct: the error envelope/code derivation, pg unique-violation mapping (with correct one-level DrizzleQueryError.cause unwrapping), pagination math, and response helpers are all sound and covered by tests. The 500 path correctly hides internal messages while logging them. The notable gaps are cross-cutting: routes that can produce a 409 (pg unique violation) declare only withErrors (no 409) so the OpenAPI spec and Eden Treaty error union under-document a reachable status; the readiness probe has no timeout around the S3 check; and there is some dead/undeclared surface (ErrorResponse export, the 503 status code that no schema declares and nothing throws).

#### 🟠 [medium/consistency] Routes that can hit a pg unique violation declare withErrors (no 409), so the reachable 409 is undocumented and untyped · verifica: **confirmed**

- **Dove:** `apps/api/src/lib/schemas/responses.ts:111`
- **Confidence:** high
- **Descrizione:** The global error-handler maps any pg unique_violation (23505) to a 409 CONFLICT, and even special-cases the product_seller_ean_unique constraint with a bespoke message. But withErrors() (the default error-schema helper, used by e.g. POST /products) does NOT include 409. So routes whose service can throw a unique violation return a 409 at runtime that is absent from their declared response schema. Consequences: the OpenAPI spec for those endpoints omits the 409, and Eden Treaty's typed error union for the frontend lacks 409, so the FE cannot type-narrow on it. The error-handler authors clearly knew 409 is reachable on the product route (they hardcode that constraint name), yet POST /products uses withErrors not withConflictErrors.
- **Evidenza:** withErrors returns 400/401/403/404/422/500 only (responses.ts:113-129); POST /products uses `response: withErrors({ 200: okRes(ProductSchema) })` (products.ts:321) yet createProduct can throw the product_seller_ean_unique 409 handled at error-handler.ts:67.
- **Fix proposto:** Either make withErrors always include 409 (since any insert/update can hit a unique constraint mapped to 409 by the global handler), or switch every route whose service writes to a uniquely-constrained table (POST /products, employees invite, etc.) to withConflictErrors. Audit callers of withErrors against tables with unique constraints.
- **Verifica (confirmed):** All cited evidence holds:

1. `withErrors()` at responses.ts:111-130 returns only 400/401/403/404/422/500 — no 409. Verified by reading the file.

2. The global error handler at error-handler.ts:54-71 intercepts pg error code "23505" (unique_violation) and returns `status(409, errorBody("CONFLICT", message))`, with a hardcoded special-case message for the `product_seller_ean_unique` constraint ("Hai già un prodotto con questo EAN"). This proves the 409 from this constraint path is reachable and was explicitly anticipated by the author.

3. db/schemas/product.ts:59-61 confirms `product_seller_ean_unique` is a partial unique index on `(sellerProfileId, ean)` where `ean IS NOT NULL AND status != 'trashed'`. So inserting or updating a product with a duplicate EAN for the same seller will trigger this constraint.

4. POST /products (products.ts:321) uses `response: withErrors({ 200: okRes(ProductSchema) })` — no 409 declared. The `createProduct` service (services/products.ts:519-527) performs a bare `tx.insert(product).values(...)` with an EAN value. There is no pre-check or explicit unique-violation guard before the insert; if the constraint fires, the pg error propagates to the global handler and returns 409.

5. PATCH /products/:productId (line 401) also uses `withErrors(...)` yet the service similarly sets EAN and can trigger the same constraint.

6. The only route that uses `withConflictErrors` is DELETE /products/:productId (line 614), which protects against a ServiceError(409) thrown for non-trashed products — an entirely different 409 path, not the pg unique violation case.

The consequence is real: the OpenAPI spec emitted by Elysia will not include a 409 response object for POST/PATCH /products, and Eden Treaty's typed error union on the frontends will lack 409, preventing type-safe FE error narrowing on EAN duplicate conflicts. No house rule applies here.

#### 🟡 [low/reliability] Readiness probe S3 check has no timeout; can hang the /ready endpoint · verifica: **confirmed**

- **Dove:** `apps/api/src/plugins/health.ts:18`
- **Confidence:** medium
- **Descrizione:** Promise.allSettled awaits db.execute(SELECT 1) and checkBucket() with no overall timeout. The DB check is bounded by the pg pool's connectionTimeoutMillis, but checkBucket() uses the AWS SDK HeadBucketCommand on an S3Client constructed with no requestTimeout/connectionTimeout. If MinIO/S3 is network-blackholed (connection accepted but never responds, or DNS/socket stall), the AWS SDK can wait for its long default socket timeout, leaving /ready pending well past the point a readiness probe should have failed. A readiness probe that hangs defeats its purpose (orchestrators keep routing traffic until the probe finally times out at the LB layer).
- **Evidenza:** health.ts:18-21 `await Promise.allSettled([db.execute(sql`SELECT 1`)..., checkBucket()])`; checkBucket() (s3.ts:73-80) calls awsS3.send(new HeadBucketCommand) and awsS3 (s3.ts:21-29) sets no requestHandler timeouts.
- **Fix proposto:** Wrap each readiness check in a Promise.race against a short timeout (e.g. 2-3s) so an unresponsive dependency yields `false` quickly, or configure the AWS S3Client requestHandler with connectionTimeout/requestTimeout.
- **Verifica (confirmed):** Both cited files match the claim exactly. In /apps/api/src/plugins/health.ts lines 18-21, Promise.allSettled wraps db.execute and checkBucket() with no timeout guard. In /apps/api/src/lib/s3.ts lines 21-29, the AwsS3Client (awsS3) is constructed with only endpoint, region, credentials, and forcePathStyle — no requestHandler, connectionTimeout, or requestTimeout. checkBucket() at lines 73-80 calls awsS3.send(new HeadBucketCommand) using that unconfigured client. The AWS SDK v3 in Node.js (or Bun) falls back to OS-level socket timeouts when no explicit timeout is set, which can be several minutes. A network-blackhole scenario (TCP connected but silent) would leave the /ready endpoint pending for that entire duration. No existing guard, race wrapper, or timeout in the code path prevents this. None of the house rules cover this scenario. The issue is real and triggerable as described. Severity low is appropriate given the project is in active development and not yet deployed to production.

#### 🟡 [low/dead-code] ErrorResponse schema is exported but never used anywhere in the monorepo

- **Dove:** `apps/api/src/lib/schemas/responses.ts:97`
- **Confidence:** high
- **Descrizione:** ErrorResponse is a union of all error schemas annotated 'for backward compatibility', but a repo-wide search finds zero references outside its own definition (not used by routes, withErrors/withConflictErrors, tests, or any frontend). It is dead surface area that suggests a richer error contract than the code actually wires up.
- **Evidenza:** Only hit for `\bErrorResponse\b` across apps/ is its definition at responses.ts:97; withErrors/withConflictErrors build their own per-status maps instead of referencing it.
- **Fix proposto:** Remove ErrorResponse, or actually consume it (e.g. as the default error schema) so the comment matches reality.

#### 🟡 [low/consistency] Status 503/SERVICE_UNAVAILABLE is in ERROR_CODES and ErrorStatus but no response schema declares it and nothing throws it

- **Dove:** `apps/api/src/lib/errors.ts:13`
- **Confidence:** high
- **Descrizione:** ERROR_CODES includes 503 -> SERVICE_UNAVAILABLE and ErrorStatus permits it, so a service could legally `throw new ServiceError(503, ...)`. But there is no ServiceUnavailableError TypeBox schema, neither withErrors nor withConflictErrors includes 503, and no service currently throws it. If a 503 ServiceError were ever thrown, the global handler would return a 503 body that no route's declared response schema covers (mirroring the 409 gap), and the OpenAPI spec would not document it. Today it is purely latent/unused config.
- **Evidenza:** errors.ts:13 `503: "SERVICE_UNAVAILABLE"`; grep for SERVICE_UNAVAILABLE/503 in src/lib/schemas and src/modules returns no schema or thrower.
- **Fix proposto:** If 503 is intended to be usable, add a ServiceUnavailableError schema and include it in the error-schema helpers; otherwise drop 503 from ERROR_CODES/ErrorStatus to keep the type surface honest.

#### 🟡 [low/improvement] request-id ignores any client-supplied X-Request-Id, always minting a new one

- **Dove:** `apps/api/src/plugins/request-id.ts:6`
- **Confidence:** medium
- **Descrizione:** The request-id plugin always generates a fresh UUID and sets it on the response, never reading an incoming X-Request-Id/traceparent header. In a multi-frontend setup (admin/customer/seller) this prevents end-to-end correlation when a client (or an upstream proxy) already assigned a trace id, since the server discards it. Logs and the response header will not share the caller's id.
- **Evidenza:** request-id.ts:6-8 `const id = crypto.randomUUID(); set.headers["x-request-id"] = id; return { requestId: id };` with no read of request.headers.
- **Fix proposto:** Reuse an inbound `x-request-id` header when present and valid, falling back to crypto.randomUUID(); echo that same value back in the response and into the logger context.

#### 🟡 [low/type-safety] withErrors/withConflictErrors use Record<number, any>, weakening response-schema type-safety

- **Dove:** `apps/api/src/lib/schemas/responses.ts:111`
- **Confidence:** medium
- **Descrizione:** Both helpers are generic over `T extends Record<number, any>`, so the success-response map passed in is typed as `any` per status. A caller could pass a non-TSchema value (e.g. a plain object) for the 200 entry and TypeScript would not catch it; it would only fail at Elysia runtime. Constraining to TSchema values would surface such mistakes at compile time across the ~60 routes that use these helpers.
- **Evidenza:** responses.ts:111 `export function withErrors<T extends Record<number, any>>(...)` and the same `Record<number, any>` bound at responses.ts:133.
- **Fix proposto:** Constrain the generic to `Record<number, TSchema>` so each success response entry is type-checked as a TypeBox schema.

### `api-core` — 5 finding

> The subsystem is generally well-structured: money is consistently handled in integer cents, mutations run inside transactions, stock decrement uses an atomic compare-and-swap (`stock >= qty`), and reservation expiry re-validates eligibility per order so the cron is idempotent. Two correctness issues stand out: `toCents` produces wrong results for negative decimal strings (latent, currently masked by `>= 0` CHECK constraints), and loyalty-point awarding has no idempotency/compare-and-swap guard, so concurrent or repeated completions can double-award points. The remaining items are quality/robustness improvements (silent NaN on malformed money input, a stale comment about non-existent setTimeout timers, idempotency pre-check returning 409 instead of the existing order).

#### 🔴 [high/reliability] Loyalty points can be double-awarded: completion has no idempotency / compare-and-swap on status · verifica: **confirmed**

- **Dove:** `apps/api/src/lib/order-helpers.ts:56`
- **Confidence:** high
- **Descrizione:** awardPoints unconditionally increments customerProfile.points and inserts an 'earned' point_transaction; it has no guard that the order has not already been awarded. Every caller reads the order status, calls assertTransition against that read value, then updates with `.where(eq(order.id, ...))` WITHOUT including the expected current status in the WHERE clause. Under Postgres' default READ COMMITTED isolation two concurrent completion requests (seller transitionOrder, or customer pickupOrder) can both read status='confirmed', both pass assertTransition, and both run awardPoints — awarding points twice and writing two 'earned' transactions for the same order. The seller transitionOrder even reads the order entirely outside the transaction (findSellerOrder uses the non-tx db handle), widening the window.
- **Evidenza:** // seller/services/orders.ts: const existing = await findSellerOrder(...) [outside tx]; assertTransition(existing.status,...); then .update(order).set({status:'completed', pointsEarned}).where(eq(order.id, orderId))  — no status in WHERE; awardPoints has no "already awarded" check.
- **Fix proposto:** Make completion a compare-and-swap: add the expected current status to the UPDATE WHERE (e.g. and(eq(order.id,id), eq(order.status, fromStatus))) and `.returning()`; if no row comes back, the status changed concurrently — abort without awarding. Alternatively gate awardPoints on the row still being in a non-completed state (or check order.pointsEarned === 0 / absence of an existing 'earned' point_transaction for the orderId) inside the same transaction so a repeat is a no-op.
- **Verifica (confirmed):** The claim is accurate. Both code paths lack compare-and-swap protection:

1. seller/services/orders.ts transitionOrder (lines 33-80): `findSellerOrder` reads the order using the bare `db` handle (non-transactional, line 18 of that file). Only after that read does the code enter `db.transaction(...)`. Two concurrent requests can both read `status='confirmed'`, both pass `assertTransition`, and then both enter the transaction where `awardPoints` runs and the UPDATE is `.where(eq(order.id, orderId))` with no `eq(order.status, 'confirmed')` guard. Under READ COMMITTED both transactions will commit independently, awarding points twice and inserting two `type='earned'` rows for the same orderId.

2. customer/services/orders.ts pickupOrder (lines 362-416): The read is inside the transaction (`tx.query.order.findFirst`), which is better, but under READ COMMITTED two concurrent transactions can still both see `status='confirmed'`, pass `assertTransition`, call `awardPoints`, and update — because the UPDATE `.where(eq(order.id, existing.id))` does not include the current status. Both UPDATEs will match the row and return it, so both transactions commit successfully with points awarded twice.

The `point_transactions` schema (points.ts) has no unique constraint on `(order_id, type)`, so there is no DB-level guard preventing two `type='earned'` rows for the same order. The `order.pointsEarned` field is an integer column with no constraint that would block a second write. 

The proposed fix (adding `eq(order.status, fromStatus)` to the UPDATE WHERE clause and checking `.returning()` length to detect a lost race) is the correct compare-and-swap approach. Alternatively, a unique constraint on `(order_id, type)` in `point_transactions` would catch the duplicate insert.

#### 🟠 [medium/bug] toCents mishandles negative decimal strings (sign dropped on fractional part) · verifica: **confirmed**

- **Dove:** `apps/api/src/lib/money.ts:5`
- **Confidence:** high
- **Descrizione:** toCents splits on '.' and computes parseInt(whole)*100 + parseInt(frac). For a negative value the sign only lives on the whole part, so the fractional cents are ADDED instead of subtracted. toCents("-5.50") returns -450 (should be -550), and the round-trip fromCents(toCents("-5.50")) yields "-4.50". fromCents() is sign-aware, so the two helpers disagree on negatives. Currently the stored money columns (total, unit_price, price) all carry CHECK >= 0, so negatives should not reach toCents today — this is a latent defect in a shared money primitive rather than an active money-loss bug, but any future use on a delta/refund/adjustment string would silently corrupt the amount.
- **Evidenza:** return parseInt(whole, 10) * 100 + parseInt(paddedFrac, 10);  // toCents("-5.50") === -450
- **Fix proposto:** Detect the sign once and apply it to the whole result: e.g. const neg = price.trim().startsWith('-'); compute the magnitude from the unsigned parts, then return neg ? -cents : cents. Mirror fromCents's sign handling so the two are exact inverses.
- **Verifica (confirmed):** The bug is real and the cited evidence is exact. In toCents (apps/api/src/lib/money.ts:8), the expression `parseInt(whole, 10) * 100 + parseInt(paddedFrac, 10)` breaks for negative decimal strings: for "-5.50", whole="-5" gives parseInt * 100 = -500, and parseInt("50") = 50, so the result is -450 instead of -550. The sign is only on the whole part; the fractional cents are incorrectly added rather than subtracted. fromCents (lines 14-20) handles sign by extracting it first and operating on Math.abs(cents), so the two helpers are asymmetric — fromCents(toCents("-5.50")) yields "-4.50" rather than "-5.50". Verified with a Node.js run that reproduces the exact computed value -450 the reviewer cited. The claim is also correct about the current guard: product.price has CHECK >= 0 (product.ts:58), order.total has CHECK >= 0 (order.ts:88), and order_item.unit_price has CHECK >= 0 (order.ts:144), so all current callers pass non-negative values from DB reads and the defect is latent/unreachable today. Nevertheless the bug is real, the evidence holds exactly as cited, and any future use on a negative delta/refund/adjustment string would silently corrupt the amount. Severity medium is appropriate: real defect, currently unreachable due to schema guards, but no active money loss.

#### 🟡 [low/reliability] toCents returns NaN silently for malformed/empty money strings · verifica: **refuted**

- **Dove:** `apps/api/src/lib/money.ts:8`
- **Confidence:** high
- **Descrizione:** parseInt on a non-numeric or leading-dot string yields NaN, and NaN propagates: toCents(".5") and toCents("abc") both return NaN, and toCents("5.5e2") returns 505 (the exponent fraction is mis-parsed). A NaN total would then flow into fromCents and into the numeric column write. Inputs today come from DB numeric columns (well-formed), so this is defensive hardening rather than a live bug, but a money primitive returning NaN with no signal is a footgun.
- **Evidenza:** toCents(".5") === NaN; toCents("abc") === NaN; toCents("5.5e2") === 505
- **Fix proposto:** Validate input shape (e.g. /^-?\d+(\.\d+)?$/) and throw on malformed strings, or assert Number.isInteger(result) before returning, so a bad value fails loudly instead of silently corrupting an amount.
- **Verifica (refuted):** The NaN propagation behavior described is mathematically correct for the function in isolation (parseInt("", 10) === NaN for ".5", etc.), but the claim is refuted as a real/triggerable issue because two existing guards prevent any malformed string from ever reaching toCents:

1. API input validation: The CreateProductBody schema at apps/api/src/lib/schemas/forms/products.ts:16 applies pattern "^\d+\.\d{2}$" to the price field. This strict regex rejects leading-dot strings (".5"), alphabetic strings ("abc"), and scientific notation ("5.5e2") at the Elysia route layer before they can be written to the DB.

2. DB column constraint: price and total are declared as numeric("price", { precision: 10, scale: 2 }) in the Drizzle schemas (apps/api/src/db/schemas/product.ts:37 and apps/api/src/db/schemas/order.ts:52). PostgreSQL's numeric type would reject non-numeric input at the DB level even if somehow the validation were bypassed. Drizzle returns these columns as well-formed decimal strings (e.g. "9.99") — never as ".5", "abc", or "5.5e2".

The callers of toCents (customer/services/orders.ts:237 and seller/services/orders.ts:58) receive the price/total values directly from DB query results, which are always properly formatted numeric strings. The reviewer's own description acknowledges this is "defensive hardening rather than a live bug" — and the hardening at the input boundary is already present. There is no code path where a malformed string can reach toCents.

#### 🟡 [low/reliability] Idempotency pre-check race returns 409 instead of the existing order · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/customer/services/orders.ts:176`
- **Confidence:** medium
- **Descrizione:** createOrder reads any existing order with the same idempotencyKey before the transaction and returns it if found. The real guard is the partial unique index order_idempotency_key_idx. For two near-simultaneous requests with the same key, both pass the pre-check (no row yet), both proceed, and the second INSERT hits the unique violation -> global handler maps 23505 to 409. Idempotent retries are supposed to be safe replays; here the duplicate gets a 409 conflict instead of the already-created order, so a client retrying after a timeout may see an error for an order that actually succeeded.
- **Evidenza:** if (existing) return existing;  // pre-tx read; the concurrent winner's row isn't visible yet, so the loser's INSERT throws 23505 -> 409 rather than returning the existing order.
- **Fix proposto:** Catch the unique-violation on idempotencyKey inside createOrder (or in the route) and, on conflict, re-fetch and return the existing order with that key, turning the duplicate into a successful idempotent replay instead of a 409.
- **Verifica (confirmed):** The code at orders.ts:176-181 performs the idempotency pre-check (db.query.order.findFirst) outside the transaction, before db.transaction() at line 193. The uniqueIndex("order_idempotency_key_idx") in the schema (order.ts:85-87) is the only real enforcement.

For two near-simultaneous requests with the same idempotencyKey: both execute findFirst outside the transaction, both see no row, both enter db.transaction(), both attempt INSERT. The winner commits; the loser's INSERT hits the 23505 unique violation. The global error handler (error-handler.ts:54-72) maps any 23505 to a generic 409 Conflict — there is no special case for order_idempotency_key_idx, so no re-fetch and return of the existing order is attempted.

A client that sends a request, times out waiting for a response, and retries with the same idempotencyKey after the first request actually succeeded will receive a 409 Conflict on the retry, which is the opposite of idempotent behavior. The described race is real and triggerable. No existing guard (transaction isolation, a SELECT FOR UPDATE, an ON CONFLICT DO NOTHING RETURNING, or a specific catch block) prevents it.

#### 🟡 [low/consistency] Stale docstring references per-order setTimeout timers that do not exist

- **Dove:** `apps/api/src/lib/jobs/expire-reservations.ts:40`
- **Confidence:** high
- **Descrizione:** The expireReservations docstring describes itself as a 'safety-net' that catches orders 'missed by the per-order setTimeout timers (e.g. after a restart)'. A repo-wide grep finds no setTimeout-based reservation scheduling anywhere; the every-minute cron is the only expiry mechanism. The comment implies a primary timer path that isn't implemented, which is misleading for maintainers and overstates expiry responsiveness (worst case an expired reservation lingers up to ~1 minute, which is fine but should be the documented behavior).
- **Evidenza:** // comment: "to catch any orders that were missed by the per-order setTimeout timers (e.g. after a restart)."  — grep for setTimeout/scheduleReservation in apps/api/src returns no matches.
- **Fix proposto:** Update the docstring to describe the cron as the sole expiry mechanism (runs every minute), or implement the per-order timer if the lower-latency path was intended. Either way the comment should match reality.

### `api-seller-products` — 8 finding

> The subsystem is generally well-built: ownership scoping is consistent on single-item mutations, stock adjustments use atomic non-negative guards, bulk operations are best-effort with per-item failure reasons, and the CSV import uses savepoints so a duplicate-EAN row aborts only itself. The most material issues are an authorization gap where employees can list/inspect seller-wide products outside their assigned stores (inconsistent with getProduct/updateProduct/deleteProduct), an inStock filter that is not store-scoped, a store re-assignment path that silently zeroes existing stock, and a bulk status-restore path that aborts the whole batch on a single EAN unique-violation, defeating its best-effort contract.

#### 🔴 [high/security] Employees can list seller-wide products outside their assigned stores · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/routes/products.ts:44`
- **Confidence:** high
- **Descrizione:** GET /products only enforces store access when query.storeId is present (lines 46-52). When called without storeId, listProducts filters by sellerProfileId only and never consults accessibleStoreIds. Employees reach this route (index.ts employee path) but are only authorized for their assigned stores. So an employee assigned to store A can omit storeId and receive every product of the seller, including products that exist only in store B. This is inconsistent with getProduct/updateProduct/deleteProduct/updateProductStatus, which all enforce accessibleStoreIds. GET /products/categories-in-use (line 188) has the same gap.
- **Evidenza:** if (query.storeId) { await ensureStoreAccess(query.storeId, {...}); } const result = await listProducts({ sellerProfileId: sp.id, storeId: query.storeId, ... }) // no accessibleStoreIds passed; listProducts filters only by sellerProfileId
- **Fix proposto:** For non-owners, restrict the seller-wide listing to accessibleStoreIds: when query.storeId is absent and isOwner is false, pass the employee's accessible store IDs to listProducts and add an EXISTS/IN (storeProduct.storeId) condition scoping results to those stores (or require storeId for employees). Apply the same scoping to listCategoriesInUse.
- **Verifica (confirmed):** The code confirms the claim in every detail.

GET /products (products.ts lines 44-71): `ensureStoreAccess` is called only when `query.storeId` is truthy (lines 46-52). When `storeId` is absent, `listProducts` is called with only `sellerProfileId` (line 54) — `accessibleStoreIds` is never obtained or passed. `listProducts` (services/products.ts lines 94-313) confirms this: without a `storeId` argument, the WHERE clause is `[eq(product.sellerProfileId, sellerProfileId), eq(product.status, statusFilter), ...]` with no store-membership restriction.

Employees do reach this route: index.ts lines 87-115 set `isOwner: false` for the employee path and wire `productsRoutes` at line 123 for both owners and employees. The `getAccessibleStoreIds` lazy getter is available in context and returns only the employee's assigned stores via `getAccessibleStoreIdsFor({…, isOwner: false})`, but the GET /products handler never invokes it.

The inconsistency with mutation endpoints is real: `getProduct`, `updateProduct`, `deleteProduct`, `updateProductStatus`, `bulkUpdateProductStatus`, and `bulkDeletePermanent` all call `sellerCtx.getAccessibleStoreIds()` and enforce the result. The listing endpoint skips this entirely.

GET /products/categories-in-use (lines 188-234) has the identical gap: only guards when `storeId` is present; `listCategoriesInUse` receives no `accessibleStoreIds`.

No house rule applies: this is not a migration concern, money handling issue, enum convention, ServiceError signature, or any of the other house-rule categories. The severity rating of high is appropriate — it is an authorization bypass that exposes product data across store boundaries to employees, though it is read-only (no data mutation).

#### 🟠 [medium/bug] inStock filter is not store-scoped, leaking out-of-stock products in store view · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/services/products.ts:125`
- **Confidence:** high
- **Descrizione:** The inStock=true condition uses EXISTS over store_products with only sp.stock > 0 and no sp.store_id filter, even when storeId is supplied. A product that is out of stock in the requested store but in stock in a different store of the seller will incorrectly pass the inStock filter and appear in the store-scoped list. The count query and the JOIN both restrict to the store, but the inStock EXISTS subquery does not, so the result set is wrong for the store-scoped + inStock combination.
- **Evidenza:** if (inStock) { conditions.push(sql`EXISTS (SELECT 1 FROM store_products sp WHERE sp.product_id = ${product.id} AND sp.stock > 0)`); }
- **Fix proposto:** When storeId is set, add AND sp.store_id = ${storeId} to the inStock EXISTS subquery (or reference the already-joined storeProduct row's stock directly, i.e. storeProduct.stock > 0, since the storeId branch innerJoins store_products filtered to the store).
- **Verifica (confirmed):** The bug is real and directly verifiable in the code at lines 125-129 of /Users/marcogelli/repos/jelaz/bibs/apps/api/src/modules/seller/services/products.ts.

The inStock EXISTS subquery is:
  sql`EXISTS (SELECT 1 FROM store_products sp WHERE sp.product_id = ${product.id} AND sp.stock > 0)`

There is no `AND sp.store_id = ${storeId}` guard. When storeId is provided (lines 121-123), the outer query restricts via innerJoin + eq(storeProduct.storeId, storeId), but that restriction only applies to the joined row used for filtering/ordering/counting. The EXISTS is a correlated subquery that independently scans the store_products table across ALL stores for the product.

The scenario is reachable: a product linked to StoreA (stock=0) and StoreB (stock=5), queried with storeId=StoreA and inStock=true, will pass the EXISTS check because StoreB's row satisfies sp.stock > 0 — even though the product has zero stock in the requested store.

No guard, constraint, or intentional house rule prevents this. The proposed fix (add AND sp.store_id = ${storeId} inside the EXISTS, or use the already-joined storeProduct.stock > 0) is correct. Severity medium is appropriate — it is a data-correctness defect in a filtered list view but not a security issue.

#### 🟠 [medium/reliability] Re-assigning a product to a store silently resets existing stock to 0 · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/services/stock.ts:39`
- **Confidence:** high
- **Descrizione:** assignProductToStores uses onConflictDoUpdate with set: { stock: excluded.stock }. stock defaults to 0 (route schema makes it optional, service default 0). If a product is already assigned to a store with stock N and the seller calls this endpoint again for that store without an explicit stock, the conflict path overwrites the existing stock with 0, silently destroying inventory data. The endpoint is documented as 'assign with initial stock', so callers will not expect it to clobber current stock of already-linked stores.
- **Evidenza:** .onConflictDoUpdate({ target: [storeProduct.productId, storeProduct.storeId], set: { stock: sql`excluded.stock` } })  // stock = 0 default
- **Fix proposto:** Either use onConflictDoNothing for already-linked stores (so existing stock is preserved), or only overwrite stock when an explicit stock value was provided by the caller. Alternatively split 'assign new' vs 'set stock' so assignment never lowers existing inventory.
- **Verifica (confirmed):** The evidence is exactly as cited. In apps/api/src/modules/seller/services/stock.ts line 18, stock defaults to 0: `const { ..., stock = 0 } = params`. Lines 39-42 use `.onConflictDoUpdate({ target: [storeProduct.productId, storeProduct.storeId], set: { stock: sql\`excluded.stock\` } })`, which unconditionally overwrites the existing stock with the INSERT value (0 by default) when a (productId, storeId) conflict occurs. In apps/api/src/modules/seller/routes/stock.ts lines 53-58, the route body schema marks `stock` as `t.Optional(...)`. There is no guard that detects the conflict case and skips the update or preserves existing stock. The scenario is directly triggerable: call POST /products/:productId/stores with a storeId that already has a link and omit the stock field — the onConflictDoUpdate path fires and sets stock to 0. The OpenAPI description ("stock iniziale") frames this as an initial-assignment endpoint, making it even more likely callers will call it again without realizing it clobbers existing stock. No house rule applies: this is not a migration concern, not an enum/money/ServiceError pattern issue. The severity "medium" is appropriate given this is a dev-stage app (not deployed), but the silent data destruction makes it a real reliability bug.

#### 🟠 [medium/reliability] Bulk status restore aborts the entire batch on a single EAN unique violation · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/services/products.ts:940`
- **Confidence:** medium
- **Descrizione:** The partial unique index product_seller_ean_unique excludes status='trashed', so a trashed product and an active product can share the same EAN. Restoring the trashed one (status -> active/disabled) collides with the active one (23505). bulkUpdateProductStatus performs a single UPDATE ... WHERE id IN (toUpdate) inside one transaction; one conflicting row aborts the whole transaction, so every product in the batch fails (handler returns 409 globally) instead of just the offending one. This defeats the documented best-effort/'failed[]' contract of the bulk endpoint. updateProductStatus (single) has the same collision but only affects one product, which is acceptable.
- **Evidenza:** await tx.update(product).set({ status, updatedAt: new Date() }).where(inArray(product.id, toUpdate));  // single statement; one 23505 aborts the whole tx
- **Fix proposto:** When restoring out of 'trashed' (next !== 'trashed'), update per-product inside a savepoint (tx.transaction) so a 23505 only fails that id (push to failed[] with a reason like 'ean_conflict'), mirroring the savepoint approach already used in product-import.ts.
- **Verifica (confirmed):** The claim is accurate. Evidence verified:

1. The partial unique index `product_seller_ean_unique` at apps/api/src/db/schemas/product.ts lines 59-61 excludes `status = 'trashed'`, confirming that a trashed product and an active/disabled product from the same seller can share the same EAN.

2. `bulkUpdateProductStatus` at lines 940-944 performs a single `UPDATE ... WHERE id IN (toUpdate)` inside one transaction (`db.transaction` at line 896). There is no per-row savepoint, no pre-flight EAN collision check, and no per-product try/catch.

3. The global error handler at apps/api/src/plugins/error-handler.ts lines 54-72 converts any 23505 (including `product_seller_ean_unique`) into an HTTP 409 response at the route boundary. This unwinds the entire transaction before the route can return any partial result.

4. The `BulkStatusResult` schema at apps/api/src/lib/schemas/entities.ts lines 300-310 only enumerates `"not_found"` and `"no_access"` as failure reasons — there is no `"ean_conflict"` reason — further confirming the implementation has no mechanism to isolate the conflicting row and report it in `failed[]`.

5. The route's OpenAPI description (line 538) explicitly advertises best-effort semantics ("Best-effort: gli ID inaccessibili o non trovati finiscono in 'failed'"), but the actual implementation breaks this contract when a restore-from-trashed causes a 23505: the entire batch returns 409 instead of partial success.

The triggerable scenario: seller has product A (active, EAN=1234) and product B (trashed, EAN=1234). A bulk-status call restoring product B → "active" hits the partial index, throws 23505, the global handler catches it and returns HTTP 409 for the whole request. Products that had no EAN conflict also fail. Severity medium is correct.

#### 🟡 [low/bug] CSV parser splits on raw newlines before field parsing, breaking quoted multi-line fields · verifica: **confirmed**

- **Dove:** `apps/api/src/lib/utils/csv.ts:38`
- **Confidence:** high
- **Descrizione:** parseCsv splits the whole text on \n first and then parses each line independently. A standards-compliant CSV value containing a newline inside double quotes (e.g. a multi-line product description exported from Excel/Sheets) will be split across multiple 'lines', corrupting field alignment for that row and likely every subsequent row in that record. parseCsvLine handles quotes within a single line but never sees the embedded newline.
- **Evidenza:** const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(...); const rows = lines.slice(1).map(parseCsvLine);
- **Fix proposto:** Parse the document with a single state machine that tracks inQuotes across newlines (only treat \n as a record terminator when not inside quotes), or use a vetted CSV library. At minimum document that embedded newlines are unsupported.
- **Verifica (confirmed):** The code at /Users/marcogelli/repos/jelaz/bibs/apps/api/src/lib/utils/csv.ts lines 38-42 does exactly what the reviewer described. `parseCsv` normalizes all line endings to `\n` then calls `.split("\n")` on the entire text before any per-line parsing. The `parseCsvLine` function (lines 3-32) correctly tracks `inQuotes` state within a single line, but it never sees embedded newlines because they are consumed by the `split` call in `parseCsv`. A quoted field containing a literal newline (e.g., a product description with a line break from Excel or Google Sheets) would be split into two separate "lines" at line 41, corrupting field alignment for that row and all subsequent rows in the record. The `.filter((l) => l.trim() !== "")` guard only removes blank lines and provides no protection. The function is called in `apps/api/src/modules/seller/services/product-import.ts:49` and in `apps/api/src/modules/admin/services/category-import.ts:41` and `:186`, making it reachable in real import flows. No existing guard prevents the corruption. The severity "low" is reasonable given the app is in active development and not deployed, but real-world CSV exports (Excel, Google Sheets) frequently produce multi-line quoted fields, so impact in practice could be medium.

#### 🟡 [low/improvement] lookupProductByEan can prefill from a trashed/deleted product cross-seller · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/services/products.ts:769`
- **Confidence:** medium
- **Descrizione:** lookupProductByEan does findFirst on product by ean ordered by createdAt desc with no status filter. The most recently created match may be a 'trashed' product (potentially from another seller). The seller-facing prefill would then surface name/description/brand/categories from a product that has been moved to trash, which may be stale or intentionally removed data.
- **Evidenza:** const row = await db.query.product.findFirst({ where: eq(product.ean, ean), orderBy: [desc(product.createdAt)], with: {...} });  // no status filter
- **Fix proposto:** Add a status filter to prefer non-trashed products (e.g. where ean = ? AND status != 'trashed'), so prefill uses live catalog data.
- **Verifica (confirmed):** The code at apps/api/src/modules/seller/services/products.ts:769-778 exactly matches the cited evidence: `db.query.product.findFirst({ where: eq(product.ean, ean), orderBy: [desc(product.createdAt)], ... })` with no status filter and no seller filter.

The schema (apps/api/src/db/schemas/product.ts) confirms:
- "trashed" is a valid product status (line 19).
- The EAN uniqueness constraint (`product_seller_ean_unique`, lines 59-61) is a PARTIAL index scoped to `(sellerProfileId, ean) WHERE ean IS NOT NULL AND status != 'trashed'`. Trashed products are deliberately excluded from the uniqueness guarantee, meaning they persist in the DB with their EAN intact.
- The uniqueness is also per-seller, not global, so multiple sellers can hold products with the same EAN.

Triggering scenario: Seller A creates a product with EAN "1234567890123", later trashes it. Seller B queries `lookupProductByEan` with the same EAN. The query will find Seller A's trashed product (or the most recently created trashed product across all sellers) and return its name/description/brand/categories as prefill data — stale or intentionally removed content. No existing guard prevents this; there is no status filter and no seller scoping in the lookup.

The issue is real and reachable. Severity low is appropriate since it only affects a prefill UX path (no security or data integrity impact), and the fix is a straightforward filter addition.

#### 🟡 [low/consistency] Category/image-only updates skip updatedAt bump · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/services/products.ts:638`
- **Confidence:** medium
- **Descrizione:** When only categoryIds and/or imageOrder are provided (no plain product columns), hasProductData is false so no UPDATE on products is issued and the row is re-selected instead. As a result product.updatedAt is not bumped even though the product's classification or image ordering changed. Any sort=updatedAt view or cache invalidation keyed on updatedAt will not reflect these changes.
- **Evidenza:** const hasProductData = Object.keys(productUpdates).length > 0; const [updated] = hasProductData ? await tx.update(product)... : await tx.select().from(product)...; // categoryIds/imageOrder applied after, updatedAt untouched
- **Fix proposto:** If categoryIds or imageOrder are present, force an updatedAt bump (e.g. set updatedAt: new Date() in the update, or run a lightweight UPDATE products SET updated_at = now() when only relations changed).
- **Verifica (confirmed):** The code at apps/api/src/modules/seller/services/products.ts:638 is exactly as described. When updateProduct is called with only categoryIds and/or imageOrder (no plain product columns like name/description/price), the destructuring at line 565-576 leaves productData empty. hasProductData = Object.keys(productUpdates).length > 0 evaluates to false (unless ean or brandId/brandName are also provided), so the code branches to a SELECT rather than an UPDATE on the products table.

The product schema (apps/api/src/db/schemas/product.ts:44-47) uses Drizzle's $onUpdate hook: updatedAt: timestamp(...).defaultNow().$onUpdate(() => new Date()).notNull(). This hook fires only when Drizzle issues an UPDATE statement. With the SELECT path, no UPDATE is issued, so $onUpdate never fires and updatedAt remains at its previous value.

The category assignments and image position updates happen after the SELECT (lines 663-690), but these modify the productCategoryAssignment and productImage tables — the products table row is never touched. The result is that product.updatedAt is stale after a categories-only or image-order-only update, exactly as claimed. The bug is real and reachable via any PATCH call that omits all plain product fields.

#### 🟡 [low/reliability] createProduct/updateProduct macro-category validation is non-atomic and silent on missing category IDs · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/services/products.ts:484`
- **Confidence:** medium
- **Descrizione:** The 'all categories share one macro' check selects distinct macroCategoryId for the given categoryIds outside the transaction. If a categoryId does not exist, it simply contributes no row to the macro check (so a single non-existent id passes), and the failure only surfaces later as an FK violation on the assignment insert, which the global handler turns into a 500 instead of a clean 400/404. Categories are global/stable so impact is small, but invalid input yields a 500.
- **Evidenza:** const macros = await db.selectDistinct({ macroId: productCategory.macroCategoryId }).from(productCategory).where(inArray(productCategory.id, categoryIds)); if (macros.length > 1) throw new ServiceError(400, ...)  // missing ids silently ignored
- **Fix proposto:** Fetch the categories by id and assert the returned count equals categoryIds.length; throw ServiceError(400/404) for unknown categories before inserting assignments, so invalid IDs produce a clean validation error rather than an FK 500.
- **Verifica (confirmed):** The claim holds up on all counts.

1. The macro-category validation at lines 484-495 (createProduct) and 593-604 (updateProduct) queries `productCategory` with `inArray(productCategory.id, categoryIds)`. If a categoryId does not exist in the table, it contributes no row — the query silently returns fewer rows than expected. When only 0 or 1 distinct macro is found (which is the case when some IDs are bogus), `macros.length <= 1` and no ServiceError is thrown.

2. The actual FK enforcement happens later inside the transaction at lines 536-542 (createProduct) and the equivalent in updateProduct: `tx.insert(productCategoryAssignment).values(categoryIds.map(id => ({ productId, productCategoryId: id })))`. The schema in `apps/api/src/db/schemas/product.ts` defines `productCategoryId` as `.references(() => productCategory.id, { onDelete: "cascade" })`, so an invalid ID causes a pg `23503` foreign-key violation.

3. The global error handler in `apps/api/src/plugins/error-handler.ts` explicitly handles `23505` (unique violation → 409) but has NO branch for `23503` (foreign-key violation). The violation falls through to the generic catch-all at line 101-113, which returns 500 with "Internal server error".

4. The check is also not inside the transaction (it runs on `db` not `tx`), so it is non-atomic as stated.

The claim is accurate: invalid categoryIds silently pass the macro check, then trigger an unhandled FK violation that surfaces as a 500. The severity is correctly characterised as low (categories are stable/global data, so invalid IDs are an uncommon edge case), but the failure mode is real and triggerable.

### `api-seller-orders` — 5 finding

> The subsystem is generally well-structured: authorization is layered correctly (seller-profile ownership check plus accessible-store-ID gating for employees), input is validated via TypeBox literal unions, the state machine is centralized, and the checkout idempotency/orphan-reuse logic is thoughtfully designed around the partial unique index. The main weaknesses are concurrency-related: order completion reads and validates state entirely outside the transaction and updates keyed only on order id with no status guard or row lock, so concurrent completion requests can double-award loyalty points (no unique constraint on point_transactions.orderId). Two narrower issues: the seller completion path does not enforce reservation expiry for reserve_pickup orders (the customer pickup path does), and the checkout-resume path can mark a freshly-paid session as expired and spin up a second subscription in a small webhook-race window.

#### 🔴 [high/reliability] Order completion is not atomic: concurrent /complete requests double-award loyalty points · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/services/orders.ts:39`
- **Confidence:** high
- **Descrizione:** transitionOrder reads the order via findSellerOrder and runs assertTransition OUTSIDE any transaction. The completion branch then opens a transaction that calls awardPoints and updates status, but the UPDATE is keyed only on order.id with no status guard and no row lock (SELECT ... FOR UPDATE). Two concurrent POST /orders/:id/complete requests both read status='confirmed', both pass assertTransition, both enter independent transactions, both run awardPoints, and both insert an 'earned' point_transaction and increment customerProfile.points. point_transactions has no unique constraint on orderId (only a plain index), so nothing at the DB level prevents the double credit. The customer pickup path has the same shape but at least re-reads inside the tx; the seller path reads fully outside it.
- **Evidenza:** const existing = await findSellerOrder(orderId, sellerProfileId); ... assertTransition(existing.status as OrderStatus, ...); if (toStatus === "completed") { const [updated] = await db.transaction(async (tx) => { const pointsEarned = await awardPoints(tx, {...}); const [upd] = await tx.update(order).set({ status: "completed", pointsEarned }).where(eq(order.id, orderId)).returning();
- **Fix proposto:** Re-read the order inside the transaction with row locking and guard the UPDATE on the current status, so only the first writer transitions. E.g. select the order FOR UPDATE inside tx, re-run assertTransition there, and use .where(and(eq(order.id, orderId), eq(order.status, existing.status))) on the update; if returning() is empty, the transition already happened — throw/no-op. This makes both completion and points-award single-shot under concurrency.
- **Verifica (confirmed):** The code at apps/api/src/modules/seller/services/orders.ts confirms the race condition exactly as described.

Line 39: `const existing = await findSellerOrder(orderId, sellerProfileId)` — reads the order outside any transaction.
Lines 46-50: `assertTransition(existing.status, toStatus, existing.type)` — the state-machine guard runs on the stale read, also outside the transaction.
Lines 54-68: The `db.transaction` block calls `awardPoints` (which does `UPDATE customerProfile SET points = points + N` and `INSERT INTO point_transactions`) and then `UPDATE order SET status='completed', pointsEarned=N WHERE id = orderId` — the WHERE clause has NO status guard.

In apps/api/src/lib/order-helpers.ts lines 56-88, `awardPoints` unconditionally increments `customerProfile.points` via a SQL expression and inserts a `point_transaction` row with type `"earned"`.

In apps/api/src/db/schemas/points.ts lines 40-46, `point_transactions` has only:
- `index("point_transaction_customer_profile_id_idx")` on customerProfileId
- `index("point_transaction_order_id_idx")` on orderId
- a `check` that amount > 0

There is NO unique constraint on `(orderId, type)` or any other combination that would prevent two "earned" rows for the same order. There is no SELECT FOR UPDATE anywhere in the path.

Two concurrent POST /orders/:id/complete requests will both read status='confirmed', both pass assertTransition, both open independent transactions, both call awardPoints (double-incrementing customerProfile.points and inserting two "earned" point_transaction rows), and both successfully update the order status. Nothing at the application or DB level prevents this. The severity rating of "high" is correct.

#### 🟠 [medium/bug] Seller completion of reserve_pickup ignores reservation expiry · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/services/orders.ts:53`
- **Confidence:** medium
- **Descrizione:** The customer pickupOrder path explicitly checks reservationExpiresAt and, if past, marks the order 'expired', refunds points and restocks, then refuses completion. The seller transitionOrder completion path performs no such check: a seller can mark a reserve_pickup order whose reservationExpiresAt has already passed as 'completed', awarding loyalty points on an order that the rest of the system considers expired/refundable. The order schema even has a dedicated partial index for active reservations, confirming expiry is a tracked concept. This is an inconsistency between the two completion entry points for the same order type.
- **Evidenza:** Seller path: if (toStatus === "completed") { const pointsEarned = await awardPoints(...); ...set status completed } — no reservationExpiresAt check. Customer path (customer/services/orders.ts:386): if (existing.type === "reserve_pickup" && existing.reservationExpiresAt && existing.reservationExpiresAt < new Date()) { ...set expired; refundStockAndPoints; throw 400 }
- **Fix proposto:** Before awarding points on completion of a reserve_pickup order, apply the same expiry guard used in customer pickupOrder (compare reservationExpiresAt to now; if expired, transition to 'expired' + refundStockAndPoints + throw 400), or extract a shared completeReservation helper used by both the seller and customer paths so the rule cannot drift.
- **Verifica (confirmed):** The claim is real and fully supported by the code.

Seller path (`apps/api/src/modules/seller/services/orders.ts`, lines 52-71): when `toStatus === "completed"`, the code immediately awards loyalty points and sets status to "completed" inside a transaction. There is no check on `reservationExpiresAt`. The function has no type-specific branching whatsoever — it treats `reserve_pickup` completion identically to any other order type.

Customer path (`apps/api/src/modules/customer/services/orders.ts`, lines 385-399): explicitly checks `existing.type === "reserve_pickup" && existing.reservationExpiresAt && existing.reservationExpiresAt < new Date()`, and if true, sets status to "expired", calls `refundStockAndPoints`, and throws a 400 ServiceError.

The state machine (`apps/api/src/lib/order-state-machine.ts`, lines 17 and 22) confirms `reserve_pickup` is a valid type for the `completed` target status from both `confirmed` and `ready_for_pickup` statuses — so the seller path is reachable for `reserve_pickup` orders.

The order schema has a partial index on `reservationExpiresAt` scoped to `type = 'reserve_pickup' AND status IN ('confirmed', 'ready_for_pickup')`, confirming expiry is a tracked and intentional concept in the domain.

The inconsistency is genuine: a seller can call `transitionOrder` with `toStatus="completed"` on an expired `reserve_pickup` order, awarding loyalty points on what the customer-facing path would have rejected as an expired reservation. No existing guard, constraint, or DB check prevents this. Severity is medium (not critical) because it requires a specific timing window — the reservation must have expired but the order must still be in a pre-completed state, and a seller must deliberately choose to complete it.

#### 🟠 [medium/bug] Checkout resume can expire a paid session and create a second subscription · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/services/checkout.ts:50`
- **Confidence:** medium
- **Descrizione:** When an existing open pending has a Stripe session, the code only treats session.status === 'open' as reusable; for any other status it marks the pending 'expired' and falls through to create a brand-new checkout session. Stripe session status can be 'complete' (payment succeeded) in the window after payment but before handleCheckoutCompleted flips the pending to 'consumed'. In that window this branch marks the just-paid pending 'expired' and creates a second checkout/subscription. The webhook then finds the pending no longer status='open' (it is 'expired') and skips it (idempotent no-op), orphaning the first paid subscription while the seller proceeds to pay again on the new session — a potential double-charge / orphaned subscription.
- **Evidenza:** if (session.status === "open") { return {...}; } // Session is expired or otherwise unusable — expire the pending and fall through await db.update(pendingStoreCreation).set({ status: "expired" })... — but Stripe 'complete' is paid, not unusable. Webhook only consumes pendings where status='open' (checkout-completed.ts:42).
- **Fix proposto:** Branch explicitly on Stripe session.status: only recreate when status === 'expired'. If status === 'complete', do not expire the pending — return a 'processing/ready' signal (or surface checkoutUrl=null) and let the webhook consume it; the status endpoint already polls for 'consumed'/'ready'. Treat unknown statuses conservatively rather than expiring.
- **Verifica (confirmed):** The bug is real and the evidence cited in the claim holds exactly.

**checkout.ts lines 50-64**: When an existing `'open'` pending has a Stripe session, the code retrieves the Stripe session and checks `session.status === 'open'`. If the session is `'complete'` (payment succeeded but webhook not yet delivered), it falls into the else branch at line 60-64, marks the pending `'expired'`, and falls through to create a new checkout session + subscription.

**checkout-completed.ts line 43**: The webhook handler queries `where status = 'open'`. Once the pending has been flipped to `'expired'` by the checkout resume flow, this condition fails and the handler logs "Pending already consumed or missing, skipping (idempotent)" — the first paid subscription is orphaned.

**Schema (pending-store-creation.ts line 46-48)**: The partial unique index `pending_store_creation_one_open_idx` only prevents two simultaneously `'open'` rows for the same seller. It does NOT prevent the scenario here: the original pending is set to `'expired'` (removing it from the partial index), so the subsequent INSERT of a new `status='open'` pending succeeds without constraint violation.

The race window is: Stripe marks the session `'complete'` → seller calls create-checkout again (e.g., via a browser refresh) → pending is marked `'expired'` → second subscription created → webhook arrives but skips. The window is narrow but real in production flows where webhook delivery can be seconds to minutes late.

The severity `medium` is appropriate: it requires a specific timing window and a user action (retrying the checkout page) during that window, but the consequence is a double charge / orphaned subscription which is financially significant.

#### 🟡 [low/reliability] getCheckoutStatus can return status 'ready' with an undefined storeId · verifica: **refuted**

- **Dove:** `apps/api/src/modules/seller/services/checkout.ts:151`
- **Confidence:** medium
- **Descrizione:** For a consumed pending, the function looks up the storeSubscription by stripeSubscriptionId and returns { status: 'ready', storeId: sub?.storeId }. If pending.stripeSubscriptionId is null, or the storeSubscription row is not (yet) found, the caller receives status:'ready' with storeId undefined. The response schema marks storeId optional, so this passes validation, but the seller UI polling /status will get a 'ready' signal it can't act on (no store to navigate to). Since the webhook sets pending.status='consumed' and stripeSubscriptionId and inserts storeSubscription in the same transaction, a consumed pending should always have both — so an undefined storeId here indicates an inconsistency that is silently swallowed instead of surfaced.
- **Evidenza:** if (pending.status === "consumed") { const sub = pending.stripeSubscriptionId ? await db.query.storeSubscription.findFirst({...}) : null; return { status: "ready", storeId: sub?.storeId }; }
- **Fix proposto:** If pending.status === 'consumed' but the subscription/store cannot be resolved, either keep returning a non-terminal status (so the client keeps polling) or throw a 500/log a warning rather than emitting a terminal 'ready' with no storeId. At minimum, log when a consumed pending resolves to a missing store.
- **Verifica (refuted):** The cited code path at checkout.ts:151-160 is real, but the scenario that would trigger storeId=undefined is blocked by the transaction in checkout-completed.ts (lines 39-117).

The webhook handler performs all three writes atomically inside a single db.transaction():
1. INSERT into store (creates createdStore.id)
2. INSERT into storeSubscription with storeId=createdStore.id and stripeSubscriptionId=sub.id
3. UPDATE pendingStoreCreation SET status='consumed', stripeSubscriptionId=sub.id

Before entering the transaction, session.subscription is validated as a non-null string (lines 32-35); if it is absent the handler returns early and never writes 'consumed'. This means that by the time any row exists with status='consumed', it is guaranteed that (a) pending.stripeSubscriptionId is non-null (it equals sub.id from the same transaction) and (b) the storeSubscription row referencing that sub.id already exists in the DB.

Therefore the two paths that could yield storeId=undefined in getCheckoutStatus are both unreachable under normal execution:
- pending.stripeSubscriptionId null while status=consumed: impossible, the UPDATE that sets consumed also sets stripeSubscriptionId=sub.id atomically.
- storeSubscription row not found while status=consumed: impossible, the INSERT of storeSubscription precedes the UPDATE of pending in the same transaction; if either fails, both roll back and pending.status stays 'open'.

The reviewer themselves acknowledges the transaction guarantee in the description ("Since the webhook sets pending.status='consumed' and stripeSubscriptionId and inserts storeSubscription in the same transaction, a consumed pending should always have both"). The claim then characterises the return of storeId=undefined as a silent swallow of an inconsistency — but an inconsistency that cannot arise from correct operation. This is a defensive-coding suggestion, not a reachable bug. The claim is refuted.

#### 🟡 [low/consistency] Redundant double ownership check in transitionOrder

- **Dove:** `apps/api/src/modules/seller/services/orders.ts:39`
- **Confidence:** high
- **Descrizione:** transitionOrder authorizes the same order twice with different mechanisms: findSellerOrder verifies the order's store belongs to sellerProfileId, then it separately checks accessibleStoreIds.includes(existing.storeId). For an owner, accessibleStoreIds already equals all of the seller's non-deleted stores, so the findSellerOrder sellerProfile check is fully subsumed by the accessibleStoreIds check (and the accessible list additionally enforces employee scoping). The first check adds an extra query and a subtly different semantic (it ignores soft-delete and employee assignment), making the real authorization boundary harder to reason about. The detail/list endpoints rely solely on storeIds membership, so this is also inconsistent with the rest of the module.
- **Evidenza:** const existing = await findSellerOrder(orderId, sellerProfileId); if (!accessibleStoreIds.includes(existing.storeId)) { throw new ServiceError(404, "Order not found"); }
- **Fix proposto:** Authorize transitions the same way as getSellerOrder: fetch the order once, then gate purely on accessibleStoreIds membership. Drop the separate findSellerOrder sellerProfile check (or make findSellerOrder accept the accessible store IDs) so there is a single, consistent authorization rule across list/detail/transition.

### `api-seller-onboarding` — 6 finding

> The subsystem is generally well-structured: status transitions are explicitly asserted, multi-table writes are wrapped in transactions, and a partial unique index backstops concurrent duplicate change-requests at the DB level. The main weakness is authorization granularity on the settings GET endpoint, which returns the owner's full identity-document PII to any employee of the seller. There are also two smaller correctness/consistency gaps: the rejected-seller VAT resubmit route can surface a 409 it doesn't declare, and one change-request path writes to S3 without compensating cleanup on failure. Nothing is catastrophic, but the PII exposure is worth fixing before launch.

#### 🔴 [high/security] Settings GET returns owner identity-document PII to employees · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/routes/settings.ts:31`
- **Confidence:** high
- **Descrizione:** The GET /seller/settings/ handler uses withSeller(ctx) and does NOT call requireOwner(isOwner) (unlike every mutating handler in the same file, which all call requireOwner). The second guard in index.ts admits role 'employee' as well as 'seller'. getSellerSettings returns the full profile via SellerProfileSchema, which includes documentNumber, documentImageUrl, birthDate, citizenship, residence address/zip — the OWNER's personal identity-document data. The function even computes assignedStoreIds specifically for employees, confirming employees reach this endpoint. The frontend PersonalInfoCard happens to render the session user's own data, but the API is the security boundary: any authenticated employee can call this endpoint directly and read the owner's ID document number, document photo URL and birth date.
- **Evidenza:** settings.ts:34 `const { sellerProfile, store, isOwner, user } = withSeller(ctx);` — no requireOwner. SellerProfileSchema (entities.ts:170-176) exposes documentNumber, documentImageUrl. index.ts admits `u.role === 'employee'` into the guard that mounts settingsRoutes.
- **Fix proposto:** Either gate the document/personal-identity fields behind isOwner in getSellerSettings (return them only when isOwner === true, redacting documentNumber/documentImageUrl/birthDate/residence for employees), or split the response so employees receive only org + assignedStoreIds. Employees legitimately need assignedStoreIds and org info, not the owner's ID document.
- **Verifica (confirmed):** All three pillars of the claim hold up under code inspection:

1. **No requireOwner guard on GET**: settings.ts:31-58 — the GET / handler calls `withSeller(ctx)` and passes `isOwner` to `getSellerSettings`, but never calls `requireOwner(isOwner)`. Every mutating handler in the same file (PATCH /personal, /company, /vat, /document, /payment) calls `requireOwner(isOwner)` as its first action; the read path does not.

2. **Employees admitted by the guard**: index.ts:86-115 — the second `.guard()` block (which mounts `settingsRoutes` at line 130) resolves both `u.role === 'seller'` (owner path, `isOwner: true`) and `u.role === 'employee'` (employee path, `isOwner: false`). An active employee reaches `settingsRoutes` with `isOwner: false`.

3. **Full PII returned regardless of role**: services/settings.ts:82-172 — `getSellerSettings` fetches the complete `sellerProfile` row (including `documentNumber`, `documentImageUrl`, `documentExpiry`, `birthDate`, `residenceAddress`, `residenceZipCode`, `citizenship`) and returns it in `profile` unconditionally. The `isOwner` flag is used only at line 147 to decide whether to compute `assignedStoreIds`; no fields are redacted for employees. The response schema `SellerSettingsSchema` (composed.ts:109-118) wraps the full `SellerProfileSchema` (entities.ts:143-182), which explicitly includes `documentNumber` (line 170), `documentImageUrl` (line 176), `birthDate` (line 162), `citizenship` (line 160), `residenceAddress` (line 168), `residenceZipCode` (line 169).

The vulnerability is directly reachable: an authenticated employee can HTTP GET /seller/settings/ and receive the owner's identity document number, document photo URL, birth date, citizenship, and home address. The severity "high" is appropriate for exposure of identity-document PII.

#### 🟠 [medium/bug] VAT resubmit route can return 409 it does not declare (Elysia response validation risk) · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/routes/profile.ts:65`
- **Confidence:** high
- **Descrizione:** PATCH /profile/vat -> updateSellerVat updates organization.vatNumber, which has a global UNIQUE constraint (organization.ts:20). If the resubmitted VAT collides with another seller's org, Postgres raises 23505 and the global handler maps it to 409 CONFLICT. But the route declares only withErrors({...}) (no 409). The onboarding /company step, which has the same unique-VAT risk, correctly uses withConflictErrors. Because the declared response map lacks a 409 schema, the OpenAPI spec is wrong and Elysia's response validation may reject/garble the 409 envelope it cannot match, potentially turning a clean 409 into a 500.
- **Evidenza:** profile.ts:65 `response: withErrors({ 200: okRes(SellerProfileSchema) })` vs onboarding.ts:124 `response: withConflictErrors({...})` for the analogous VAT-insert. organization.ts:20 `vatNumber: text("vat_number").notNull().unique()`.
- **Fix proposto:** Change profile.ts /profile/vat to `response: withConflictErrors({ 200: okRes(SellerProfileSchema) })`, matching the onboarding /company step.
- **Verifica (confirmed):** The core factual claim is correct, but the stated runtime consequence (Elysia may "reject/garble" the 409 into a 500) is overstated. Here is what the code actually shows:

1. UNIQUE constraint exists: organization.ts:20 — `vatNumber: text("vat_number").notNull().unique()`. Confirmed.

2. Route uses withErrors, not withConflictErrors: profile.ts:65 — `response: withErrors({ 200: okRes(SellerProfileSchema) })`. Confirmed. withErrors (responses.ts:111-130) does not include a 409 key. withConflictErrors (responses.ts:133-154) does include 409.

3. Analogous onboarding /company step: onboarding.ts:124 — uses `withConflictErrors`. Confirmed asymmetry.

4. The service can trigger 23505: services/profile.ts:106-116 performs a raw `db.transaction` that UPDATEs vatNumber on the organizations table with no pre-check for duplicate VAT. A second seller submitting the same VAT as an existing seller would hit the unique constraint.

5. The global error handler correctly handles this (error-handler.ts:54-71): isUniqueViolation returns true for code 23505 and the handler returns `status(409, errorBody("CONFLICT", message))`.

6. Runtime impact of missing 409 in schema: In Elysia 1.4.x, response schema validation is applied ONLY to responses returned directly from the route handler (not from onError). The global error handler returns via `status(409, ...)` which bypasses route-level response validation entirely. Therefore the 409 is NOT garbled or converted to a 500 at runtime — the claim's specific assertion about "Elysia's response validation may reject/garble the 409 envelope … potentially turning a clean 409 into a 500" is incorrect.

7. Actual consequences: (a) OpenAPI spec omits 409 for PATCH /profile/vat — clients reading the spec won't know to handle it. (b) Eden Treaty types in the 3 frontends won't have a 409 branch for this route — any frontend code checking the response type for conflict handling won't have the type. These are real documentation/type-safety gaps, not a runtime failure.

The bug is real and reachable (confirmed), but the severity is lower than claimed because there is no runtime garbling or 500 conversion — only an OpenAPI/type-safety gap. Correcting to low severity.

#### 🟡 [low/reliability] requestDocumentChange writes to S3 before insert with no compensating cleanup · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/services/settings.ts:354`
- **Confidence:** high
- **Descrizione:** The document image is uploaded to S3 (s3.write) before the sellerProfileChange row is inserted, and the two operations are not in a transaction. If the insert fails — e.g. the partial unique index seller_profile_change_pending_unique_idx (status='pending') trips on a concurrent duplicate, yielding 23505/409 — the just-written S3 object is orphaned with no row referencing it. Rejected document changes are also never cleaned from S3 (rejectChange in admin/services/sellers.ts does not delete the image). Storage leak, low impact in dev but it accumulates.
- **Evidenza:** settings.ts:357-358 `const key = ...; await s3.write(key, documentImage);` then settings.ts:365 `await db.insert(sellerProfileChange)...` with no try/cleanup; assertNoPendingChange is a read-then-act before the unique-index-protected insert.
- **Fix proposto:** Check assertNoPendingChange and insert the row first (or insert a placeholder), then upload to S3 and update the row — or wrap with a try/catch that deletes the S3 object if the insert throws. Optionally delete the orphaned image when a document change is rejected.
- **Verifica (confirmed):** The code at settings.ts lines 354-374 confirms the issue exactly as described. S3 write (`await s3.write(key, documentImage)`) happens at line 358, followed by the DB insert at line 365. There is no try/catch, no transaction, and no compensating cleanup.

The TOCTOU gap is real: `assertNoPendingChange` (lines 59-72) checks a pre-loaded `profile.changes` list loaded at line 344-347 with `findFirst`. Two concurrent requests for the same `(sellerProfileId, changeType='document')` pair can both pass this in-memory check, both upload their file to S3, and then the second DB insert hits the partial unique index `seller_profile_change_pending_unique_idx` (confirmed in migrations/0000_init.sql:401 and schemas/seller-profile-change.ts:46), which fires 23505 → global handler converts to 409. The first request's S3 object is now orphaned with no DB row referencing it.

Additionally, `rejectChange` in admin/services/sellers.ts (lines 503-537) only updates the row status to 'rejected' and never deletes any S3 object — so even non-concurrent rejected document changes accumulate orphaned files.

No existing guard prevents this: the unique index is the correct enforcement mechanism but it fires after the S3 upload. The check is pre-loaded memory, not a DB-level lock.

The "low" severity is appropriate: this is a storage leak with no data integrity or functional correctness impact, narrow concurrency window, and no production deployment yet.

#### 🟡 [low/reliability] requestVatChange does not detect collision with another seller's VAT until admin approval · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/services/settings.ts:306`
- **Confidence:** medium
- **Descrizione:** requestVatChange only verifies the new VAT differs from the requester's own current VAT. It does not check whether the new VAT is already used by another organization (organization.vatNumber is globally unique). The seller can submit, vatChangeBlocked is set true, the admin reviews, and only then approveChange hits 23505 on the organization update — at which point the change cannot be applied and the seller stays blocked from orders until someone rejects it. This wastes the seller's order-taking window on an unsatisfiable request.
- **Evidenza:** settings.ts:306 `if (profile.organization?.vatNumber === vatNumber)` is the only uniqueness-related check; no query against other orgs. approveChange (admin/services/sellers.ts:427) is where the unique violation would actually surface.
- **Fix proposto:** In requestVatChange, query organization for any row with this vatNumber belonging to a different sellerProfile and throw ServiceError(409, ...) before creating the change and setting vatChangeBlocked.
- **Verifica (confirmed):** All cited evidence holds:

1. `apps/api/src/db/schemas/organization.ts` line 20: `vatNumber: text("vat_number").notNull().unique()` — the column has a DB-level unique constraint spanning all organizations.

2. `requestVatChange` at line 306: the only uniqueness-related check is `if (profile.organization?.vatNumber === vatNumber)` — same-seller check only. No query is made against other organizations to detect cross-seller collisions. The function then sets `vatChangeBlocked: true` on the seller profile in its own committed transaction.

3. `approveChange` at lines 426-433: directly executes `tx.update(organization).set({ vatNumber: ... })` with no pre-check. If another org already holds that VAT number, the pg `unique_violation` (23505) fires inside the transaction.

4. The global error handler (`plugins/error-handler.ts` line 54-71) catches the 23505 and returns a 409 to the admin caller, but this happens AFTER `requestVatChange`'s transaction has already committed `vatChangeBlocked: true` and the pending change record. The `approveChange` transaction rolls back entirely, so `vatChangeBlocked` is NOT reset to false, and the change stays in `"pending"` status.

5. The only path to unblock is an admin calling `rejectChange` (lines 503-537), which explicitly resets `vatChangeBlocked: false`. This requires manual admin intervention after a confusing 409 on the approve call.

The described failure scenario is real and triggerable: a seller can submit a VAT that collides with another seller's VAT, the request succeeds and blocks the seller's orders, then the admin's approval attempt silently fails with a 409, leaving the seller stuck in a blocked state until an admin notices and manually rejects the unsatisfiable request. The severity is accurately characterized as low (it requires the coincidence of two sellers attempting the same VAT number, and an admin can resolve it), so correctedSeverity is left as low.

#### 🟡 [low/improvement] getSellerSettings loads and spreads all change rows but only pending are intended

- **Dove:** `apps/api/src/modules/seller/services/settings.ts:107`
- **Confidence:** medium
- **Descrizione:** The query loads `changes: true` (all change rows: pending, approved, rejected). The full array is spread into the returned `profile` object via `...profileRest`, while pendingChanges is computed separately. SellerProfileSchema does not declare `changes`, so Elysia strips it on serialization, but the code still loads every historical change row into memory and relies on response-stripping to avoid leaking approved/rejected change history (which can contain prior VAT numbers / document data in changeData). Tightening the load avoids the dependency on response validation for data hygiene.
- **Evidenza:** settings.ts:88 `changes: true`; settings.ts:107 `const profile = { ...profileRest, ... }` (profileRest still carries `changes`); pendingChanges derived at settings.ts:143 by filtering status==='pending'.
- **Fix proposto:** Either scope the relation load to pending changes (e.g. `with: { changes: { where: eq(sellerProfileChange.status, 'pending') } }`) or explicitly omit `changes` from the spread before returning `profile`.

#### 🟡 [low/performance] Settings GET issues 4 sequential round-trips that could be reduced

- **Dove:** `apps/api/src/modules/seller/services/settings.ts:85`
- **Confidence:** medium
- **Descrizione:** getSellerSettings runs the profile-with-relations query, then a Promise.all of org + payment method, then (for employees) getEmployeeAssignedStoreIds — the assignedStoreIds query runs strictly after the first profile query rather than being folded into the existing Promise.all. Minor, but the employee branch adds an extra serial round-trip on a hot read endpoint.
- **Evidenza:** settings.ts:85 first await; settings.ts:125 Promise.all([org, payment]); settings.ts:147 `await getEmployeeAssignedStoreIds(...)` runs after, not inside, the Promise.all.
- **Fix proposto:** Move the employee assignedStoreIds fetch into the Promise.all (it does not depend on the profile result beyond sellerProfileId/userId, both available up front), reducing one serial DB round-trip for employees.

### `api-seller-stores` — 11 finding

> The subsystem is generally well-structured: ownership scoping is consistently applied at the seller-profile level, services throw ServiceError and let the global handler shape envelopes, pagination and transactions are used correctly in most places, and the brand upsert and discount-pricing raw SQL follow the documented conventions safely. The most material issues are (1) a silent image-ordering bug where product image positions default to the file index instead of appending after existing images (the store-images path does this correctly, so it is also an inconsistency), (2) employee authorization for product/store image mutations and for the entire discounts module bypasses the store-assignment scoping that the rest of the products/stock/orders routes enforce, and (3) the subscription cancel flow writes cancelReason to the DB before the Stripe call, leaving the DB inconsistent if Stripe fails. Several smaller correctness gaps (missing endsAt > startsAt validation, image-count TOCTOU) and one dead export (deleteStore) round out the findings.

#### 🟠 [medium/bug] Product image upload uses file index as position, colliding with existing images · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/services/images.ts:41`
- **Confidence:** high
- **Descrizione:** When uploading additional images to a product that already has images, position defaults to the file index `i` (0,1,2...), which collides with positions already in the table. There is no unique constraint on position, so the collision is silent and yields non-deterministic image ordering. The analogous store-images service handles this correctly by offsetting with the existing count.
- **Evidenza:** uploaded.push({ key, url: publicUrl(key), position: position ?? i });  // images.ts
// vs store-images.ts line 44: position: position ?? current + i,
- **Fix proposto:** Mirror store-images.ts: read the current image count before the upload loop and use `position: position ?? current + i` so new images append after existing ones instead of restarting from 0.
- **Verifica (confirmed):** Reading /apps/api/src/modules/seller/services/images.ts confirms the exact evidence cited. Line 41 uses `position: position ?? i`, where `i` is the per-upload loop index (0, 1, 2...). The service does query the current image count on lines 21-24, but that value (`current`) is only used for the max-images cap check on line 26 — it is never used in the position assignment. When a product already has N images and new ones are uploaded without an explicit `position`, the new rows receive positions 0, 1, 2... which collide with the existing rows' positions.

The schema at /apps/api/src/db/schemas/product-image.ts confirms there is no unique constraint on `position` (only a non-unique index on `product_id` and a unique constraint on `key`), so the collision is silent — the insert succeeds and yields non-deterministic ordering.

The store-images counterpart at /apps/api/src/modules/seller/services/store-images.ts line 44 uses `position: position ?? current + i`, correctly appending after existing images. The divergence is a clear copy-omit bug.

The bug is real, reachable on any second upload to a product with existing images, and no guard prevents it. Severity medium is appropriate — it does not cause data loss but silently corrupts image ordering.

#### 🟠 [medium/security] Image upload/delete authz checks seller ownership but skips employee store-assignment scoping · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/services/images.ts:18`
- **Confidence:** medium
- **Descrizione:** uploadProductImages/deleteProductImage call ensureProductOwnership (seller-profile scope only) and uploadStoreImages/deleteStoreImage call ensureStoreOwnership (seller-profile scope only). Neither uses ensureStoreAccess, unlike the products, stock and orders routes which deliberately store-scope employees via ensureStoreAccess. As a result an employee assigned only to store A can upload or delete images for any product or store belonging to the same seller (including stores/products they are not assigned to). This is an IDOR relative to the module's own employee-scoping model.
- **Evidenza:** images.ts: await ensureProductOwnership(productId, sellerProfileId);
store-images.ts: await ensureStoreOwnership(storeId, sellerProfileId);
// products.ts/stock.ts use ensureStoreAccess(storeId, { userId, sellerProfileId, isOwner })
- **Fix proposto:** For store images, replace ensureStoreOwnership with ensureStoreAccess(storeId, {userId, sellerProfileId, isOwner}). For product images, resolve the product's store(s) and gate via ensureStoreAccess, or require owner if image management is owner-only. Pass userId/isOwner from the route context into the image services.
- **Verifica (confirmed):** The claim is accurate and verified by reading the actual code.

Evidence confirmed:

1. `/apps/api/src/modules/seller/services/images.ts` lines 18 and 71: both `uploadProductImages` and `deleteProductImage` call `ensureProductOwnership(productId, sellerProfileId)`, which is defined in `context.ts` lines 55-67 as a simple query checking `product.sellerProfileId === sellerProfileId`. It does not involve `isOwner`, `userId`, or any employee store-assignment check.

2. `/apps/api/src/modules/seller/services/store-images.ts` lines 18 and 75: both `uploadStoreImages` and `deleteStoreImage` call `ensureStoreOwnership(storeId, sellerProfileId)`, defined in `context.ts` lines 73-86 as a simple query checking `store.sellerProfileId === sellerProfileId`. Same issue.

3. The route handlers in `routes/images.ts` and `routes/store-images.ts` extract `sellerProfile` (sp) from context but do NOT extract or pass `isOwner` or `user.id` into the service calls, making it structurally impossible for the services to perform employee-scope checks.

4. `apps/api/src/modules/seller/index.ts` lines 87-115 confirms employees (`role === "employee"`, active status) are admitted through the SAME guard block that mounts `imagesRoutes` (line 125) and `storeImagesRoutes` (line 126). The `isOwner: false` flag is set in context but never consulted by either image route/service.

5. Contrast with `routes/products.ts`: it consistently calls `ensureStoreAccess(storeId, {userId, sellerProfileId, isOwner})` for create/import, and `getAccessibleStoreIds()` for get/update/delete/status operations — deliberately scoping employees to their assigned stores.

6. The attack path is directly triggerable: an employee authenticated with `role="employee"` assigned only to Store A can call `POST /seller/products/:productId/images` where `productId` belongs to Store B (same seller), or `POST /seller/stores/:storeId/images` for Store B, and `ensureProductOwnership` / `ensureStoreOwnership` will pass because it only checks seller ownership, not the employee's store assignment.

Severity: The reviewer's "medium" is appropriate. This is a same-seller IDOR (intra-seller privilege escalation for employees), not a cross-seller data leak. An attacker must already be an active employee of the seller to exploit it.

#### 🟠 [medium/security] Entire discounts module is accessible to employees (no requireOwner guard) · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/routes/discounts.ts:111`
- **Confidence:** medium
- **Descrizione:** None of the discount routes (create, update, pause, archive, add/remove products) call requireOwner. Discounts are scoped to sellerProfileId, not to a specific store, so an employee assigned to a single store can create or modify promotions and product pricing across the seller's entire catalog. Compare with employees/stores routes which call requireOwner for owner-only mutations. If discount management is meant to be owner-only this is a privilege gap; if employees are allowed, the lack of store-scoping is still broader than the rest of the module's model.
- **Evidenza:** POST /discounts handler: const { sellerProfile: sp, body, user, store } = withSeller(ctx);  // no requireOwner(isOwner)
- **Fix proposto:** Add requireOwner(isOwner) to the discount mutation routes (create/update/pause/archive/add/remove), or explicitly document and confirm that employees may manage seller-wide promotions.
- **Verifica (confirmed):** The claim is accurate. Reading /apps/api/src/modules/seller/routes/discounts.ts confirms that none of the mutation routes (POST /discounts, PATCH /discounts/:id, POST .../pause, POST .../archive, POST .../products, DELETE .../products, DELETE .../products/:productId) call requireOwner(isOwner). The requireOwner helper exists at context.ts:131 and is imported/used in stores.ts (lines 69, 101, 193, 225) and employees.ts/settings.ts, but discounts.ts never imports or calls it. The withSeller context does include isOwner (context.ts line 17) so the value is available to the handlers — it is simply never checked. An employee (isOwner=false) assigned to one store can therefore call all discount mutation endpoints, which operate at sellerProfileId scope and affect all stores in the seller's catalog. The cited evidence (line 111 POST handler with no requireOwner call) is correct. The severity "medium" is appropriate: it is a real privilege escalation within a seller account, but limited to users who are already authenticated as employees of that same seller — it does not cross tenant boundaries.

#### 🟠 [medium/reliability] Subscription cancel writes cancelReason to DB before the Stripe call (inconsistent state on Stripe failure) · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/services/stores.ts:291`
- **Confidence:** high
- **Descrizione:** In cancelStoreSubscription (both the active/past_due and suspended branches) the DB row's cancelReason is updated first, then stripe.subscriptions.update/cancel is called. If the Stripe call throws, the error propagates but the DB now has cancelReason='seller_canceled' while the subscription is still active in Stripe and no webhook will fire to move status to 'canceling'/'canceled'. The local state is then permanently misleading.
- **Evidenza:** await db.update(storeSubscription).set({ cancelReason: "seller_canceled" })... 
await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: true });
- **Fix proposto:** Call Stripe first, and only persist cancelReason after the Stripe mutation succeeds; or perform the DB write and Stripe call so a Stripe failure rolls back the cancelReason write. Reactivate already does Stripe-only and relies on the webhook, so the cancel path should follow the same ordering.
- **Verifica (confirmed):** The code at apps/api/src/modules/seller/services/stores.ts lines 291-297 (active/past_due branch) and lines 301-305 (suspended branch) confirms the exact ordering described in the claim. In both branches, `db.update(storeSubscription).set({ cancelReason: "seller_canceled" })` is awaited first, then `stripe.subscriptions.update/cancel` is called. There is no transaction wrapping these two operations, no try/catch for rollback, and no compensating write on failure. If Stripe throws (network error, API error, invalid sub ID, etc.), the error propagates to the global error handler, leaving the DB row with `cancelReason='seller_canceled'` while the Stripe subscription remains active/uncanceled. The reactivate function (lines 328-331) correctly does Stripe-first and relies on the webhook to update DB state, confirming the inconsistency is unintentional. The route handler (routes/stores.ts line 195-199) adds no transaction boundary either. The issue is real and triggerable by any transient Stripe API failure.

#### 🟡 [low/bug] createDiscount and updateDiscount do not validate endsAt > startsAt · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/services/discounts.ts:29`
- **Confidence:** high
- **Descrizione:** Neither the create body schema nor the service validates that endsAt is after startsAt. A discount can be created (or updated) with endsAt earlier than startsAt. updateDiscount only checks that endsAt is in the future relative to now, not relative to startsAt. Such a discount is never 'running' and silently confuses the operational-state filters.
- **Evidenza:** createDiscount: values({ ..., startsAt: params.startsAt, endsAt: params.endsAt }) // no ordering check
updateDiscount: if (patch.endsAt ... <= Date.now()) throw 409 // only vs now, not vs startsAt
- **Fix proposto:** In createDiscount and updateDiscount, throw ServiceError(400/409) when the effective endsAt (patch or existing) is non-null and <= the effective startsAt.
- **Verifica (confirmed):** The code confirms the claim exactly. In /apps/api/src/lib/schemas/discount.ts (lines 46-61 for DiscountCreateBody, lines 63-68 for DiscountUpdateBody), both schemas declare startsAt and endsAt as independent Date fields with no cross-field ordering constraint. In the service (discounts.ts lines 29-41), createDiscount inserts both values verbatim with zero ordering check. In updateDiscount (lines 86-90), the only guard is `patch.endsAt.getTime() <= Date.now()` — a future-only check against the current timestamp, not against the effective startsAt. No DB-level CHECK constraint was found in the schema file or migration. The listDiscounts "running" filter (lines 304-305) uses `lte(discount.startsAt, now)` AND (`endsAt IS NULL` OR `endsAt >= now`), so a discount with endsAt < startsAt will never match "running" — it transitions directly to "expired" once startsAt passes, silently corrupting the operational-state view. The bug is real, directly reachable through the POST /discounts and PATCH /discounts/:id routes, and no existing guard prevents it. Severity "low" is appropriate for a dev-stage app with no production deployment.

#### 🟡 [low/reliability] Image-count limit check is a TOCTOU race (cap can be exceeded under concurrency) · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/services/images.ts:26`
- **Confidence:** medium
- **Descrizione:** uploadProductImages (and uploadStoreImages) count existing images, then check current + files.length against the max, then upload and insert. Two concurrent uploads can each pass the check and together exceed maxImagesPerProduct/maxImagesPerStore, since there is no DB constraint enforcing the cap. Low impact (just exceeds a soft limit) but the limit is not actually guaranteed.
- **Evidenza:** const [{ current }] = await db.select({ current: count() })...; if (current + files.length > config.maxImagesPerProduct) throw ...
- **Fix proposto:** If the cap must be hard, enforce it inside a transaction with row locking (SELECT ... FOR UPDATE on the parent product/store) or via a DB-level constraint/trigger; otherwise document it as best-effort.
- **Verifica (confirmed):** The TOCTOU race is real and unguarded. In both uploadProductImages (/apps/api/src/modules/seller/services/images.ts:21-31) and uploadStoreImages (/apps/api/src/modules/seller/services/store-images.ts:21-31), the pattern is: (1) SELECT count() for the productId/storeId, (2) check current + files.length > cap, (3) upload to S3, (4) INSERT rows — all outside any transaction with row locking. Two concurrent requests for the same productId can both read current=9 (with cap=10), both pass the check (9+1 > 10 is false), and together insert 2 rows reaching 11 total, exceeding the cap. The product_images and store_images schemas (product-image.ts and store-image.ts) have no DB-level CHECK constraint, trigger, or any mechanism that enforces the count cap — only a key UNIQUE constraint exists. There is no SELECT FOR UPDATE on the parent product/store row, no advisory lock, and no transaction wrapping the count-check-and-insert. The cited evidence (lines 21-26 of images.ts) is accurate. Severity "low" is correct given the soft-limit nature of the cap (no financial or security impact, just slightly exceeding an image count threshold).

#### 🟡 [low/dead-code] Exported deleteStore service is dead code · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/services/stores.ts:234`
- **Confidence:** high
- **Descrizione:** deleteStore performs a soft-delete (sets deletedAt) but is never imported anywhere; the DELETE /stores/:storeId route calls cancelStoreSubscription instead. The unused function is misleading because it suggests a delete path that does not exist in the API.
- **Evidenza:** grep of `deleteStore` in apps/api/src returns only its definition at services/stores.ts:234.
- **Fix proposto:** Remove deleteStore, or wire it into an actual route if a hard store soft-delete (independent of subscription cancellation) is intended.
- **Verifica (confirmed):** Verified by reading /apps/api/src/modules/seller/services/stores.ts lines 229-251 and /apps/api/src/modules/seller/routes/stores.ts import block (lines 15-22). The `deleteStore` function is defined and exported at line 234 but is absent from the import list in routes/stores.ts. The DELETE /stores/:storeId route (lines 189-219) calls `cancelStoreSubscription`, not `deleteStore`. The broader grep of apps/api/src confirms no other file imports or references `deleteStore` — only the definition itself appears. The claim's evidence holds exactly as described.

#### 🟡 [low/consistency] Employee store assignment and invitation accept any store id without excluding soft-deleted stores · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/services/employees.ts:85`
- **Confidence:** medium
- **Descrizione:** inviteEmployee and setEmployeeStores validate that storeIds belong to the seller but do not filter out soft-deleted stores (isNull(deletedAt)). An owner can therefore invite or assign an employee to an archived/deleted store. Throughout the rest of the module, store queries consistently add isNull(storeTable.deletedAt).
- **Evidenza:** select({ id: storeTable.id }).from(storeTable).where(and(inArray(storeTable.id, storeIds), eq(storeTable.sellerProfileId, sellerProfileId)))  // no isNull(deletedAt)
- **Fix proposto:** Add isNull(storeTable.deletedAt) to the validation queries in inviteEmployee and setEmployeeStores so deleted stores cannot be assigned.
- **Verifica (confirmed):** The issue is real and precisely described. The store schema at /Users/marcogelli/repos/jelaz/bibs/apps/api/src/db/schemas/store.ts line 49 confirms `deletedAt: timestamp("deleted_at", { withTimezone: true })` exists. Throughout the seller module, other store queries consistently guard against soft-deleted stores with `isNull(storeTable.deletedAt)` — seen in context.ts (lines 44, 81), stores.ts (lines 39, 168, 179, 244), and billing.ts (lines 51, 93). In employees.ts, both validation queries omit this guard: inviteEmployee (lines 85-93) and setEmployeeStores (lines 318-326) check only `inArray(storeTable.id, storeIds)` and `eq(storeTable.sellerProfileId, sellerProfileId)`. A soft-deleted store row still has the correct sellerProfileId and would pass validation, allowing assignment of employees to archived/deleted stores. No existing guard, transaction constraint, or FK prevents this. The fix (adding `isNull(storeTable.deletedAt)`) is straightforward. Severity low is appropriate — it is a consistency bug rather than a security issue, and the app is not yet deployed to production.

#### 🟡 [low/reliability] Invitation email sent after commit; failure leaves an un-resendable pending invitation · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/services/employees.ts:142`
- **Confidence:** medium
- **Descrizione:** The invitation row is committed, then sendEmail is awaited. If the email send throws, the request errors but the pending invitation persists. Because of the partial unique index on (sellerProfileId, email) WHERE status='pending', a retry returns 409 'gia invitato' until the invite is canceled or expires, even though the employee never received an email.
- **Evidenza:** const invitation = await db.transaction(...); ... await sendEmail({ to: email, ... });
- **Fix proposto:** On sendEmail failure, mark the just-created invitation as expired/cancelled (or delete it) before rethrowing, so the seller can immediately re-invite; or make the invite endpoint idempotent on the pending row and (re)send the email each call.
- **Verifica (confirmed):** The claim is accurate in all its details.

1. Transaction commit before sendEmail (lines 127-136 vs 142-153): The `db.transaction()` at line 127 commits the `employeeInvitation` row and its associated `employeeInvitationStores` rows fully before `sendEmail` is called at line 142. There is no wrapping try/catch around `sendEmail` that would roll back or clean up the row on failure.

2. Partial unique index confirmed: The schema at lines 44-46 of employee-invitation.ts defines `uniqueIndex("employee_invitation_pending_unique_idx").on(table.sellerProfileId, table.email).where(sql\`${table.status} = 'pending'\`)` — exactly as described.

3. Retry returns 409: The duplicate check at lines 102-111 queries for a pending invitation with the same (sellerProfileId, email) and throws `ServiceError(409, "Questo indirizzo email è già stato invitato")`. If sendEmail throws after the commit, this guard fires on every retry until the seller explicitly calls `cancelInvitation()` (which sets status to 'expired', removing it from the partial index scope).

4. No house rule covers this: None of the 13 house rules protect this pattern. The issue is real and triggerable by any transient email-provider failure.

The severity "low" is correct — it's an edge case requiring a real but rare infrastructure failure, with a manual workaround available (cancel the pending invite). Not a security or data-integrity issue.

#### 🟡 [low/improvement] Search/list ILIKE filters do not escape LIKE wildcards in user input

- **Dove:** `apps/api/src/modules/seller/services/discounts.ts:317`
- **Confidence:** high
- **Descrizione:** listDiscounts search (sql ILIKE) and listBrands q (ilike(brand.name, %q%)) interpolate user input via parameter binding (no SQL injection), but `%` and `_` in the input are treated as wildcards. A user searching for a literal '%' or '_' gets surprising matches. Cosmetic only.
- **Evidenza:** whereParts.push(sql`${discount.title} ILIKE ${`%${params.search}%`}`);
// brands.ts: ilike(brand.name, `%${q}%`)
- **Fix proposto:** Escape %, _ and backslash in the user term before wrapping in %...%, or use a dedicated helper for contains-search.

#### 🟡 [low/type-safety] discount-pricing raw query results typed as any[] via double cast

- **Dove:** `apps/api/src/modules/seller/services/discount-pricing.ts:49`
- **Confidence:** medium
- **Descrizione:** The db.execute generic declares the row shape, but the code then does `(result as unknown as { rows: any[] }).rows[0]`, discarding the declared typing and using any[]. node-postgres returns a QueryResult with a typed rows field, so the double cast to any is unnecessary and loses type checking on the row mapping.
- **Evidenza:** const row = (result as unknown as { rows: any[] }).rows[0];
- **Fix proposto:** Type as `(result as { rows: RowShape[] }).rows` (reusing the generic row interface already passed to db.execute) instead of `any[]`, or destructure result.rows with the declared generic so field access stays type-checked.

### `api-seller-billing` — 5 finding

> The SQL queries are correctly ownership-scoped (joins filter on store.sellerProfileId and isNull(deletedAt)), invoices are scoped to the seller's unique stripeCustomerId, money stays in integer cents, and the Stripe v22 field relocation for the subscription ID is handled correctly. The one serious problem is an authorization gap: these routes are mounted in the shared seller/employee guard with no requireOwner check, so employees can read all of the owner's billing data and, worse, open a write-capable Stripe Customer Portal session. There is also a semantic correctness bug in the summary's nextRenewal, plus a couple of minor type-safety smells.

#### 🔴 [high/security] Employees can read all billing data and open a write-capable Stripe Customer Portal session (missing requireOwner) · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/routes/billing.ts:91`
- **Confidence:** high
- **Descrizione:** All four billing routes (/summary, /subscriptions, /portal, /invoices) are mounted inside the shared seller guard in apps/api/src/modules/seller/index.ts:120, which resolves a sellerProfile for BOTH owners (role==='seller') and employees (role==='employee'). For an employee, emp.sellerProfile is the OWNER's profile, so withSeller(ctx).sellerProfile.id is the owner's sellerProfileId and sp.stripeCustomerId is the owner's customer. None of the billing handlers call requireOwner(isOwner). Consequently any active employee can view the owner's full billing summary, all subscriptions and all invoices, and — most dangerously — POST /seller/billing/portal returns a Stripe Customer Portal URL for the owner's customer, which lets the employee cancel subscriptions, change/remove payment methods, and download every invoice. Sibling owner-only operations in settings.ts gate with requireOwner(isOwner) (e.g. settings.ts:63,93,122), and the frontend hides other owner-only nav (Team) behind isOwner — billing has no equivalent backend guard.
- **Evidenza:** billing.ts:94 `const { sellerProfile: sp } = withSeller(ctx);` then `createPortalSession({ sellerProfileId: sp.id, stripeCustomerId: sp.stripeCustomerId ?? null })` with NO requireOwner; index.ts:87-114 resolves emp.sellerProfile (the owner's profile) for role==='employee'.
- **Fix proposto:** Add requireOwner(isOwner) at the top of each billing handler (destructure isOwner from withSeller(ctx)), or wrap billingRoutes in an owner-only guard. At minimum the /portal route MUST be owner-only since it grants write access to the Stripe customer. Mirror the requireOwner pattern already used in settings.ts.
- **Verifica (confirmed):** All cited evidence holds. In index.ts lines 87-114, an employee (role==='employee') resolves with isOwner: false and sellerProfile set to emp.sellerProfile — the owner's profile. billingRoutes is mounted at line 120 inside this same guard with no additional filtering. In billing.ts, all four handlers (lines 58-135) call withSeller(ctx) but never destructure isOwner and never call requireOwner(isOwner). The POST /portal handler at line 91-109 calls createPortalSession({ sellerProfileId: sp.id, stripeCustomerId: sp.stripeCustomerId ?? null }) where sp is the owner's sellerProfile — returning a write-capable Stripe Customer Portal URL. The requireOwner function is defined in context.ts lines 131-134, is exported, and is actively used in settings.ts at lines 63, 93, 122, 157, and 199 for write operations. The billing module has no equivalent guard anywhere. The vulnerability is real and directly triggerable by any active employee: they can POST /seller/billing/portal and obtain a Stripe Customer Portal session for the owner's customer, enabling subscription cancellation, payment method modification, and invoice download. The severity high is appropriate given the write access to payment infrastructure.

#### 🟠 [medium/bug] nextRenewal can report a canceling or already-expired (past_due) subscription as the next renewal · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/services/billing.ts:61`
- **Confidence:** high
- **Descrizione:** getBillingSummary selects rows whose status is in BILLABLE_STATUSES = ['active','past_due','canceling'], orders by currentPeriodEnd ASC, and takes rows[0] as nextRenewal (surfaced to the UI as 'prossimo rinnovo'). But a 'canceling' subscription (cancel_at_period_end=true, per subscription-updated.ts:16) will NOT renew at currentPeriodEnd — that date is the cancellation date. If the soonest currentPeriodEnd belongs to a canceling sub, the summary advertises a renewal (date + amount) for a store that is actually about to be cancelled. Similarly, a 'past_due' sub may have a currentPeriodEnd already in the past, so nextRenewal.date can be a date in the past. The amount and storeName would then be misleading. (Note: including 'canceling' in totalMonthlyCents is consistent with the admin MRR convention in admin/services/billing.ts:37-39 and is NOT flagged.)
- **Evidenza:** billing.ts:25 `const BILLABLE_STATUSES = ["active", "past_due", "canceling"]`; billing.ts:57 `.orderBy(asc(storeSubscription.currentPeriodEnd))`; billing.ts:62-68 takes rows[0] as nextRenewal.
- **Fix proposto:** Compute nextRenewal from the subset that will actually renew — filter rows to status==='active' (and arguably exclude cancelAtPeriodEnd) and/or require currentPeriodEnd > now() before picking the earliest. Keep totalMonthlyCents over the full billable set if that matches intent, but derive nextRenewal from genuinely-renewing subscriptions.
- **Verifica (confirmed):** The bug is real and the cited evidence holds exactly as described.

From /apps/api/src/modules/seller/services/billing.ts:
- Line 25: BILLABLE_STATUSES = ["active", "past_due", "canceling"].
- Lines 38-57: getBillingSummary queries all three statuses, orders by currentPeriodEnd ASC, and does NOT select or filter on cancelAtPeriodEnd.
- Lines 61-69: nextRenewal is unconditionally taken from rows[0] (the row with the soonest currentPeriodEnd), regardless of status.

From /apps/api/src/modules/webhooks/services/handlers/subscription-updated.ts line 16: a subscription is stored as "canceling" precisely when cancel_at_period_end === true. In that case, currentPeriodEnd is the cancellation date — the subscription will NOT renew then.

Triggerable scenario: a seller has two stores — one "canceling" with currentPeriodEnd in 3 days and one "active" with currentPeriodEnd in 15 days. The query returns the canceling row first (ASC order), and nextRenewal.date is 3 days from now with the canceling sub's feeAmountCents and storeName. The UI then surfaces this as "prossimo rinnovo" when the store is actually about to be cancelled.

The past_due scenario (currentPeriodEnd already in the past) is also real for the same reason.

No existing guard prevents this: the query has no status==='active' filter on the nextRenewal pick, no cancelAtPeriodEnd exclusion, and no currentPeriodEnd > now() floor. The reviewer's observation that totalMonthlyCents over the full BILLABLE_STATUSES set is intentional (matching admin/services/billing.ts:37-39) is correct and is not flagged.

Severity medium is appropriate: it is a data accuracy / UX bug (misleading "prossimo rinnovo" display) but not a financial or security issue, and bibs is not yet in production.

#### 🟡 [low/type-safety] `return ok(data) as any` defeats response-schema type checking on the subscriptions route

- **Dove:** `apps/api/src/modules/seller/routes/billing.ts:80`
- **Confidence:** high
- **Descrizione:** The /subscriptions handler casts its response to `any`, bypassing Elysia's response-schema type validation that every other handler in this file relies on. BillingSubscriptionRow.status is typed StoreSubscriptionStatus (includes 'canceled'), while at runtime listBillingSubscriptions only returns BACKOFFICE_STATUSES, so it is runtime-safe, but the `as any` hides any future structural drift between the service return type and SubscriptionRowSchema (e.g. Date fields). The other three handlers return ok(data) with no cast.
- **Evidenza:** billing.ts:80 `return ok(data) as any;` vs billing.ts:63/99/120 `return ok(data);`
- **Fix proposto:** Remove the `as any`. If the type mismatch is the StoreSubscriptionStatus union vs the schema, narrow the service return type to BillingSubscriptionRow (it already is) and ensure the route StatusUnion matches; if Date serialization is the issue, fix the schema rather than casting.

#### 🟡 [low/dead-code] createPortalSession accepts sellerProfileId but never uses it (dead parameter)

- **Dove:** `apps/api/src/modules/seller/services/billing.ts:144`
- **Confidence:** high
- **Descrizione:** createPortalSession's params include sellerProfileId, but the function only reads stripeCustomerId. The unused field is harmless but misleading — it suggests the function re-derives or validates the customer from the profile, when in fact it trusts the caller-supplied stripeCustomerId verbatim. (Functionally fine because the route passes sp.stripeCustomerId from the resolved profile.)
- **Evidenza:** billing.ts:144-147 signature `{ sellerProfileId: string; stripeCustomerId: string | null }` — sellerProfileId is referenced nowhere in the body.
- **Fix proposto:** Either drop sellerProfileId from the params type, or use it to re-fetch/validate the stripeCustomerId from sellerProfile (consistent with listInvoices, which loads the profile and reads profile.stripeCustomerId itself rather than trusting a passed-in value).

#### 🟡 [low/type-safety] inArray status filter uses an `as unknown as` double cast

- **Dove:** `apps/api/src/modules/seller/services/billing.ts:52`
- **Confidence:** high
- **Descrizione:** Both getBillingSummary and listBillingSubscriptions widen their readonly status tuples with `[...X] as unknown as (typeof X)[number][]` to satisfy inArray. The double cast through `unknown` strips all type checking on the array contents; a typo'd status string would not be caught by the compiler. The values happen to be valid StoreSubscriptionStatus members, so it is currently correct.
- **Evidenza:** billing.ts:52-54 `inArray(storeSubscription.status, [...BILLABLE_STATUSES] as unknown as (typeof BILLABLE_STATUSES)[number][])` (also billing.ts:94-96).
- **Fix proposto:** Declare the constants as plain string[] of StoreSubscriptionStatus (e.g. `const BILLABLE_STATUSES: StoreSubscriptionStatus[] = [...]`) so `inArray(col, BILLABLE_STATUSES)` type-checks without any cast, preserving compile-time validation of the membership values.

### `api-customer-search` — 5 finding

> The subsystem is well-structured: SQL is fully parameterized (no injection), the FTS expression matches the GIN index defined on the products table, pagination goes through the shared helper, and the public/authenticated split is correct. The main issues are correctness/reliability gaps around the store join: soft-deleted stores are not excluded (so dead listings leak into search results and distance), out-of-range lat/lng coordinates pass validation and cause a PostGIS 500 instead of a clean 400, and the no-query/no-geo ordering has no stable tiebreaker, making offset pagination non-deterministic. None are catastrophic but the soft-delete leak and the 500-on-bad-coords are worth fixing.

#### 🔴 [high/bug] Search includes products only stocked in soft-deleted stores · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/customer/services/search.ts:54`
- **Confidence:** high
- **Descrizione:** The stock-availability EXISTS filter and the distance subquery both join store_products to stores but never filter out soft-deleted stores (deletedAt IS NULL). Everywhere else in the codebase (seller/services/stores.ts, billing.ts, seller/context.ts, store-images seed) store visibility is consistently scoped with isNull(store.deletedAt). As a result, a product whose only stock lives in an archived/soft-deleted store will still appear in customer search, and the distance returned can be computed against a deleted store.
- **Evidenza:** sql`EXISTS ( SELECT 1 FROM ${storeProduct} INNER JOIN ${store} ON ${store.id} = ${storeProduct.storeId} WHERE ${storeProduct.productId} = ${product.id} AND ${storeProduct.stock} > 0 ...` — no `AND ${store.deletedAt} IS NULL`. Same omission in distanceExpr (lines 81-84).
- **Fix proposto:** Add `AND ${store.deletedAt} IS NULL` to both the EXISTS stock-availability subquery (line 57-58 region) and the distanceExpr MIN subquery (line 83-84 region), matching the soft-delete convention used across the rest of the store queries.
- **Verifica (confirmed):** The claim holds exactly as described. In /apps/api/src/modules/customer/services/search.ts:
- Lines 53-68: the EXISTS stock-availability subquery joins storeProduct to store but has no `AND ${store.deletedAt} IS NULL` filter.
- Lines 75-86: the distanceExpr MIN subquery joins storeProduct to store with the same omission.

The store schema (/apps/api/src/db/schemas/store.ts line 49) confirms `deletedAt: timestamp("deleted_at", { withTimezone: true })` exists as a nullable column — soft-delete is done by setting it to a non-null timestamp. There is no DB constraint that clears storeProduct.stock or otherwise prevents a soft-deleted store's products from matching the query.

The seller stores service (/apps/api/src/modules/seller/services/stores.ts) consistently filters with `isNull(storeTable.deletedAt)` at lines 39, 168, 179, 244 — confirming the codebase convention. The search service is the single place where the convention is missing.

A product whose only active stock lives in a soft-deleted store will pass the EXISTS subquery and appear in customer search results. The distance returned for that product can also be computed against the deleted store's location. The bug is real and triggerable. Severity high is appropriate.

#### 🟠 [medium/reliability] Out-of-range lat/lng coordinates cause a PostGIS 500 instead of a 400 · verifica: **confirmed**

- **Dove:** `apps/api/src/lib/queries.ts:104`
- **Confidence:** high
- **Descrizione:** ProductSearchQuery declares lat/lng as plain t.Number with no minimum/maximum. The service casts ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography. Casting a point with latitude outside [-90, 90] (or longitude outside [-180, 180]) to geography raises a PostGIS error ('latitude ... is out of range'), which escapes as an unhandled DB error -> 500 rather than a clean 400 VALIDATION_ERROR. A malformed client request (or a transposed lat/lng) therefore yields a server error.
- **Evidenza:** lat: t.Optional(t.Number({ description: ... })), lng: t.Optional(t.Number({ ... }))  — no bounds; consumed at search.ts:62-63 `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`.
- **Fix proposto:** Constrain the schema: lat with { minimum: -90, maximum: 90 } and lng with { minimum: -180, maximum: 180 } so invalid coordinates are rejected as 400 by TypeBox before reaching PostGIS.
- **Verifica (confirmed):** Verified all three components of the claim:

1. Schema (queries.ts:104-107): lat and lng are declared as t.Optional(t.Number({ description: ... })) with no minimum/maximum constraints. TypeBox will accept any numeric value, including out-of-range coordinates like lat=91 or lat=-200.

2. PostGIS usage (search.ts:61-63): Both lat and lng flow without any intermediate bounds check into ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography. PostGIS raises an error when casting a point with latitude outside [-90, 90] to geography type.

3. Error handler (error-handler.ts): The global handler only has specific cases for ServiceError, pg code 23505 (unique violation), Elysia VALIDATION code, and NOT_FOUND. A PostGIS range error is a generic DB error (not a ServiceError, not a 23505, not an Elysia VALIDATION code) — it falls through to the final catch-all on line 101-112 which returns status 500. There is no handler for pg error code 22003 (numeric_value_out_of_range) or similar PostGIS-specific codes.

The bug is real and triggerable: a GET /search?lat=91&lng=0 request would pass TypeBox validation, reach PostGIS, trigger a geography cast error, and return a 500 instead of a 400. The fix proposed (adding minimum/maximum bounds to the TypeBox schema) is correct and sufficient. Severity medium is appropriate.

#### 🟠 [medium/bug] Non-deterministic pagination when no text query and no geo filter · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/customer/services/search.ts:97`
- **Confidence:** high
- **Descrizione:** When q is absent and geo is absent, distanceExpr is the constant sql`0` and orderExpr is `distance ASC`, so every row sorts on the same constant with no tiebreaker. With OFFSET/LIMIT pagination this makes row ordering arbitrary and unstable across page requests, which can produce duplicated or skipped products between page 1 and page 2. Even the geo path (distance ASC) lacks a tiebreaker for equal distances.
- **Evidenza:** const distanceExpr = hasGeo ? (...) : sql`0`; ... const orderExpr = q ? sql`rank DESC, distance ASC` : sql`distance ASC`; ... .orderBy(orderExpr).limit(limit).offset(offset)
- **Fix proposto:** Append a stable, unique tiebreaker to every order branch, e.g. `... , ${product.id} ASC` (or createdAt DESC then id), so OFFSET pagination is deterministic across pages.
- **Verifica (confirmed):** The code at /Users/marcogelli/repos/jelaz/bibs/apps/api/src/modules/customer/services/search.ts confirms the claim precisely.

Line 86: `distanceExpr = sql\`0\`` when `hasGeo` is false (lat/lng absent).
Line 97: `orderExpr = sql\`distance ASC\`` when `q` is absent.
Lines 120-122: `.orderBy(orderExpr).limit(limit).offset(offset)` — no tiebreaker anywhere.

In the no-q, no-geo path (a plain product browse with no search text and no coordinates), every row gets `distance = 0`, so the entire ORDER BY resolves to the constant `0 ASC`. All rows tie; PostgreSQL may return them in any order it chooses (heap scan order, index scan order, parallel worker order, etc.), and that order is not guaranteed to be stable across separate OFFSET/LIMIT page requests. This produces the classic OFFSET-pagination anomaly: rows can appear on multiple pages or be skipped entirely between page 1 and page 2.

The geo path (hasGeo=true, no q) also lacks a tiebreaker — two products equidistant from the query point will tie on `distance ASC` — but this is less severe because true ties are rarer.

The no-q, no-geo path is the most common real-world case (user opens the product listing without typing anything and without sharing location). There are no guards, fallback sorts, or compensating constraints anywhere in the function. The fix described (append `${product.id} ASC` or similar stable unique column) is correct.

Severity is accurate at medium: it causes data integrity issues in pagination (duplicates/skips between pages) but does not corrupt stored data or expose unauthorized information.

#### 🟡 [low/improvement] radius lacks lower/upper bounds

- **Dove:** `apps/api/src/lib/queries.ts:108`
- **Confidence:** medium
- **Descrizione:** radius is t.Number with only a default of 50 and no minimum/maximum. A negative radius silently yields zero results (ST_DWithin with a negative distance), and an arbitrarily large radius defeats the geo filter entirely. Neither crashes, but validating the input keeps behavior predictable and self-documenting.
- **Evidenza:** radius: t.Optional(t.Number({ default: 50, description: "Raggio di ricerca in km (default: 50)" }))
- **Fix proposto:** Add sane bounds, e.g. { minimum: 0, maximum: 200, default: 50 }, so out-of-range radii are rejected as 400 rather than producing surprising empty/unfiltered results.

#### 🟡 [low/consistency] Log field hasGeoFilter uses truthy check that misclassifies coordinate 0

- **Dove:** `apps/api/src/modules/customer/routes/search.ts:18`
- **Confidence:** high
- **Descrizione:** The route logs `hasGeoFilter: !!(query.lat && query.lng)`, but lat=0 (equator) or lng=0 (prime meridian) are valid coordinates that are falsy in JS, so a legitimate geo search at those coordinates is logged as hasGeoFilter:false. The service itself correctly uses `lat !== undefined && lng !== undefined`, so this is only a logging inconsistency, not a query bug.
- **Evidenza:** hasGeoFilter: !!(query.lat && query.lng),
- **Fix proposto:** Mirror the service check: `hasGeoFilter: query.lat !== undefined && query.lng !== undefined`.

### `api-customer-orders` — 6 finding

> The subsystem is generally well-structured: ownership is consistently scoped by customerProfileId, money is handled in integer cents, stock decrement is guarded with a conditional WHERE + RETURNING for atomicity, and order mutations run in transactions. However there are two real data-integrity/security issues: a concurrent points double-spend that escapes the validation and surfaces as a 500 (CHECK violation is unhandled), and an IDOR where createOrder never verifies the shipping address belongs to the caller. A few smaller correctness/reliability gaps exist around FK-violation status mapping, the idempotency race window, and the pickup endpoint accepting pay_deliver completion contrary to its documentation.

#### 🔴 [high/security] IDOR: createOrder does not verify shippingAddressId belongs to the customer · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/customer/services/orders.ts:281`
- **Confidence:** high
- **Descrizione:** For pay_deliver orders the caller-supplied shippingAddressId is written straight into the order with no check that the address row belongs to the authenticated customerProfileId. The only constraint is the FK to customer_addresses (existence, not ownership). A customer can pass another customer's address id; it is then echoed back in full (with municipality/recipient/phone) by the order list/detail endpoints, leaking another user's address and binding the shipment to it.
- **Evidenza:** shippingAddressId: type === "pay_deliver" ? shippingAddressId : null,  // no ownership check; only validated for presence earlier
- **Fix proposto:** Inside the transaction (or before it), load the address with tx.query.customerAddress.findFirst({ where: and(eq(customerAddress.id, shippingAddressId), eq(customerAddress.customerProfileId, customerProfileId)) }) and throw ServiceError(404, 'Address not found') if missing, before inserting the order.
- **Verifica (confirmed):** The code at apps/api/src/modules/customer/services/orders.ts confirms the IDOR. Line 186-191 only checks for presence of shippingAddressId ("Shipping address is required for delivery orders") but performs no ownership check. Line 281 writes the caller-supplied shippingAddressId directly into the order insert. The FK on order.shippingAddressId references customer_addresses(id) (existence only). The customerAddress schema (address.ts line 33-35) has a customerProfileId column available for an ownership check, but it is never used in createOrder. The listCustomerOrders and getCustomerOrder functions both join and return the full shippingAddress object including recipientName, phone, addressLine1, municipality, etc., so a successful exploit leaks another customer's PII. The attack path is straightforward: any authenticated customer calls createOrder with type="pay_deliver" and a valid shippingAddressId belonging to a different customer; the order is created and the foreign address data is returned in the response. No existing guard, transaction constraint, or house rule prevents this.

#### 🔴 [high/reliability] Concurrent points spend can over-draw balance and returns 500 instead of 409 · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/customer/services/orders.ts:252`
- **Confidence:** high
- **Descrizione:** pointsToSpend is validated against customerPoints, a value read OUTSIDE the transaction (route passes cp.points). The deduction UPDATE customer_profiles SET points = points - actualPointsSpent has no `points >= actualPointsSpent` guard in its WHERE, unlike the stock decrement which is guarded. Two concurrent createOrder calls (or a stale-balance client) both pass the check and both decrement. The customer_points_non_negative CHECK (pg 23514, NOT 23505) is the last line of defense, but the global error handler only special-cases 23505; a 23514 falls through to an unhandled 500 INTERNAL_ERROR rather than a clean 4xx, and the user has no actionable response.
- **Evidenza:** if (pointsToSpend > customerPoints) throw new ServiceError(400, "Insufficient points"); ... .set({ points: sql`${customerProfile.points} - ${actualPointsSpent}` }).where(eq(customerProfile.id, customerProfileId)); // no balance guard
- **Fix proposto:** Make the deduction conditional and atomic: add `sql`${customerProfile.points} >= ${actualPointsSpent}`` to the WHERE, use .returning(), and if no row comes back throw new ServiceError(409, 'Insufficient points'). Optionally SELECT ... FOR UPDATE the profile at the start of the transaction to serialize concurrent redemptions.
- **Verifica (confirmed):** All three components of the claim are verified in the actual code:

1. `customerPoints` is read outside the transaction: In `/apps/api/src/modules/customer/routes/orders.ts` line 30, `customerPoints: cp.points` is passed from the Better Auth customer context before any transaction begins. This value can be stale in concurrent scenarios.

2. The points deduction UPDATE at lines 323-329 of `/apps/api/src/modules/customer/services/orders.ts` uses only `eq(customerProfile.id, customerProfileId)` in its WHERE clause — no `points >= actualPointsSpent` guard. This is asymmetric with the stock decrement (lines 307-319) which explicitly includes `sql\`${storeProduct.stock} >= ${item.quantity}\`` in the WHERE, checks `.returning()`, and throws a 409 ServiceError if no row is returned.

3. The schema at `/apps/api/src/db/schemas/customer.ts` line 25 confirms `check("customer_points_non_negative", sql\`${table.points} >= 0\`)` exists as the last line of defense.

4. The global error handler at `/apps/api/src/plugins/error-handler.ts` only special-cases pg error code `23505` (unique_violation) via `isUniqueViolation()`. A CHECK constraint violation (pg code `23514`) is not handled and falls through to the generic catch-all at lines 101-112, which returns a 500 INTERNAL_ERROR with no actionable user message.

The concurrency race condition is real and triggerable: two concurrent createOrder calls both read the same stale `cp.points` value, both pass the application-level check at line 253, both enter the transaction, the first UPDATE succeeds decrementing points to 0, the second UPDATE attempts to set points to -actualPointsSpent which violates the CHECK constraint — resulting in a 500 response instead of a clean 409.

#### 🟠 [medium/reliability] Idempotency check runs outside the transaction, leaving a duplicate-creation race · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/customer/services/orders.ts:176`
- **Confidence:** high
- **Descrizione:** The idempotency guard does a findFirst BEFORE db.transaction. Two concurrent requests with the same idempotencyKey both find nothing, both proceed, and both attempt the insert. The unique index order_idempotency_key_idx then makes the second insert fail with 23505 -> 409 'A record with the same value already exists' instead of returning the already-created order. So the idempotency contract (return the existing order) is not honored under concurrency; the duplicate caller gets a 409 conflict.
- **Evidenza:** if (idempotencyKey) { const existing = await db.query.order.findFirst({ where: eq(order.idempotencyKey, idempotencyKey) }); if (existing) return existing; }  // then a separate db.transaction(...) inserts
- **Fix proposto:** Catch the unique-violation on insert (or re-query for the existing order on 23505) and return that order instead of surfacing 409, or move the existence check inside the transaction with appropriate locking. At minimum, on insert conflict re-fetch by idempotencyKey and return it.
- **Verifica (confirmed):** The code at lines 176-181 of apps/api/src/modules/customer/services/orders.ts performs the idempotency check (db.query.order.findFirst) outside and before the db.transaction() call at line 193. Two concurrent requests with the same idempotencyKey can both read nothing at line 177, both proceed past the guard, and both enter the transaction. The second insert at line 273 hits the uniqueIndex("order_idempotency_key_idx") defined in the schema (order.ts line 85-87), triggering a pg 23505 error. The global error-handler (error-handler.ts lines 54-72) converts any 23505 to a generic 409 CONFLICT with "A record with the same value already exists" — it does NOT re-fetch by idempotencyKey and return the existing order. So the idempotency contract (return the already-created order to a duplicate caller) is broken under concurrency: the second caller gets 409 instead of the previously created order. House Rule #5 (23505 -> 409 is intentional) does not cover this case because the developer explicitly intended to return the existing order (shown by the if (existing) return existing pattern), and the idempotency semantic requires returning the existing resource, not a conflict error. The severity medium is correct: it only triggers under concurrent duplicate requests, and the app is pre-production.

#### 🟠 [medium/reliability] FK violations (invalid municipalityId / shippingAddressId) surface as 500 instead of 4xx · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/customer/services/addresses.ts:91`
- **Confidence:** high
- **Descrizione:** createAddress/updateAddress write a caller-supplied municipalityId that is only validated for non-emptiness by the schema. municipality has onDelete restrict and is a required FK; a non-existent municipalityId produces a pg foreign_key_violation (23503). The global error handler only maps 23505 -> 409; 23503 falls through to an unhandled 500 INTERNAL_ERROR. Same class of problem for an invalid shippingAddressId in createOrder if the IDOR fix above is not applied.
- **Evidenza:** error-handler.ts only special-cases isUniqueViolation (23505); addresses.ts inserts municipalityId with no existence check, FK is restrict.
- **Fix proposto:** Either validate municipality existence in the service (throw ServiceError(400, 'Invalid municipality')) or extend the error handler to map 23503 to a 400/409 with a friendly message. Validating in-service is cleaner since FE discriminates by status.
- **Verifica (confirmed):** The claim holds. Three facts verify it:

1. `/apps/api/src/db/schemas/address.ts` line 26-28: `municipalityId` has a real FK constraint with `references(() => municipality.id, { onDelete: "restrict" })`. There is no soft/nullable fallback.

2. `/apps/api/src/modules/customer/services/addresses.ts` lines 80-110: `createAddress` inserts `municipalityId` directly from caller-supplied params (spread via `...addressData`) with no existence pre-check. Same pattern in `updateAddress`. The schema-level validation (TypeBox) only checks non-emptiness for a string field — it cannot validate FK existence.

3. `/apps/api/src/plugins/error-handler.ts` lines 19-22 and 54-72: `isUniqueViolation` checks only for pg code `23505`. There is no `isForeignKeyViolation` (23503) check anywhere in the codebase (confirmed via grep). A bad `municipalityId` would cause Drizzle to throw a DatabaseError with `.cause.code === "23503"`, which falls through all the guards to the final `status(500, errorBody("INTERNAL_ERROR", ...))` at line 112.

The bug is real and triggerable: any client that supplies a well-formed UUID that does not correspond to an existing municipality row will receive a 500 instead of a 400/422. The house rules do not cover this case — house rule #5 only describes the 23505→409 mapping as an intentional convention, which implicitly shows 23503 was not similarly considered. Severity "medium" is appropriate given it requires a caller to supply an invalid ID (not a crash-on-valid-input).

#### 🟡 [low/consistency] Customer pickup endpoint can complete a pay_deliver order, contradicting its documentation · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/customer/services/orders.ts:379`
- **Confidence:** medium
- **Descrizione:** pickupOrder calls assertTransition(status, 'completed', type). The state machine allows shipped -> completed for pay_deliver. So a customer can POST /orders/:id/pickup on a pay_deliver order in 'shipped' state and mark it completed (earning points). The route summary/description say this is for pickup-type orders and that 'L'ordine deve essere in stato ready_for_pickup', which is inaccurate. Either this is intended as a 'confirm delivery' action (then the naming/docs are wrong) or pay_deliver should not be completable through this endpoint.
- **Evidenza:** assertTransition(existing.status, "completed", existing.type); // state-machine: shipped -> completed: ['pay_deliver']; route doc: "deve essere in stato 'ready_for_pickup'"
- **Fix proposto:** Clarify intent: if customers should confirm delivery, rename/redocument the endpoint accordingly; otherwise restrict pickupOrder to pickup types (e.g. reject pay_deliver) and fix the OpenAPI description.
- **Verifica (confirmed):** The claim is verified by reading the actual code.

1. `/apps/api/src/lib/order-state-machine.ts` lines 26-27 explicitly define `shipped -> completed: ["pay_deliver"]` as a valid transition.

2. `pickupOrder` in `/apps/api/src/modules/customer/services/orders.ts` line 379 calls `assertTransition(existing.status as OrderStatus, "completed", existing.type as OrderType)` with no prior guard that restricts the order type to pickup variants (`pay_pickup`, `reserve_pickup`). There is a check for `reserve_pickup` reservation expiry below (lines 387-399), but nothing that rejects `pay_deliver` orders up front.

3. The route definition in `/apps/api/src/modules/customer/routes/orders.ts` lines 178-180 documents: summary "Ritira ordine", description "Conferma il ritiro di un ordine di tipo pickup. L'ordine deve essere in stato 'ready_for_pickup'." — both claims are inaccurate for `pay_deliver`. The state is not constrained to `ready_for_pickup` (the code accepts any state the machine allows, including `shipped`), and `pay_deliver` is not a pickup-type order.

A `pay_deliver` order that has been moved to `shipped` status by the seller can be sent to `POST /orders/:id/pickup` by the customer and will successfully transition to `completed` while earning loyalty points. The endpoint has no guard excluding `pay_deliver`, and the state machine explicitly permits this transition. The documentation mismatch and the unintended reachability are real and triggerable as described.

#### 🟡 [low/improvement] Order list/detail reshape logic is duplicated and should reuse reshapeAddress

- **Dove:** `apps/api/src/modules/customer/services/orders.ts:62`
- **Confidence:** high
- **Descrizione:** The store-municipality and shippingAddress-municipality flattening is hand-inlined twice in orders.ts (listCustomerOrders and getCustomerOrder) via an IIFE, while addresses.ts already exports a generic reshapeAddress helper plus a municipalityWith fragment doing exactly this. The store reshape and address reshape are near-identical and could share a small 'flattenMunicipality' helper, reducing the four copies of the same destructure-and-rebuild block.
- **Evidenza:** shippingAddress ? (() => { const { municipality, ...addrRest } = shippingAddress; return { ...addrRest, municipality: { id, name, provinceAcronym: municipality.province.acronym } }; })() : null  // repeated in both functions and mirrored in addresses.ts:reshapeAddress
- **Fix proposto:** Extract a shared flattenMunicipality<T>() helper (and reuse the municipalityWith relation fragment) in a common module, then call it from orders.ts and addresses.ts.

### `api-admin` — 10 finding

> The admin subsystem is generally well-structured and follows the repo conventions consistently (ServiceError, ok/okPage envelopes, withErrors, transactions for multi-table writes, structured audit logging). The most material issues are non-atomic check-then-act in the change-approval flow (TOCTOU allowing double-application of side effects), an uncompensated external Stripe side effect in updatePricing that can orphan a Price if the DB transaction fails, and missing state-machine guards on seller verify/reject. There are also a few smaller correctness limitations (CSV parser cannot handle quoted newlines, MRR aggregation includes past_due/canceling) and quality items (duplicated municipality-flattening logic, an `as any` body cast).

#### 🟠 [medium/reliability] approveChange / rejectChange use non-atomic check-then-act (TOCTOU) allowing double application of side effects · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/admin/services/sellers.ts:412`
- **Confidence:** medium
- **Descrizione:** approveChange reads the change row and validates status === 'pending' OUTSIDE the transaction, then opens a separate transaction that applies side effects and flips status to 'approved'. Two concurrent approve calls for the same changeId both pass the pending check, then both run the side-effect writes and both set status=approved. For changeType 'vat' the org update re-applies (idempotent-ish, but vatChangeBlocked gets unblocked twice) and for 'payment' with no existing default both branches attempt an insert; the second is only stopped by the partial unique index (23505→409) rather than by an explicit guard. The pending-unique index only constrains duplicate pending requests, not double-approval of one request.
- **Evidenza:** const change = await db.query.sellerProfileChange.findFirst({ where: eq(sellerProfileChange.id, changeId) });
if (change.status !== "pending") { throw new ServiceError(400, ...); }
return db.transaction(async (tx) => { /* applies side effects, then sets status approved */ })
- **Fix proposto:** Move the read + status guard inside the transaction and re-read the row with a row lock (e.g. SELECT ... FOR UPDATE via tx.query or a guarded UPDATE ... WHERE id = ? AND status = 'pending' RETURNING that throws 400 if no row was updated). Apply side effects only when the guarded status flip succeeds.
- **Verifica (confirmed):** The code at /Users/marcogelli/repos/jelaz/bibs/apps/api/src/modules/admin/services/sellers.ts lines 412-494 exactly matches the cited pattern: `db.query.sellerProfileChange.findFirst` + `status !== 'pending'` guard both execute OUTSIDE the transaction, then a separate `db.transaction(...)` applies side effects and sets status to 'approved'. Two concurrent approve calls for the same changeId can both read status='pending' before either transaction commits, both pass the guard, and both enter the transaction.

The schema (seller-profile-change.ts line 46-48) has only a partial unique index `seller_profile_change_pending_unique_idx` on `(sellerProfileId, changeType) WHERE status = 'pending'`. This prevents duplicate pending requests but offers zero protection against double-approval of the same row — once the first transaction flips the row to 'approved', the partial index no longer applies to that row, so the second transaction's UPDATE also succeeds.

For changeType 'vat': both transactions would UPDATE organization (last-write-wins, effectively idempotent) and both would set vatChangeBlocked=false (also idempotent). For changeType 'payment' with no existing default: the first transaction inserts a new paymentMethod row; the second transaction's `findFirst` inside the transaction would find the now-inserted row (since it reads within the same transaction after the first committed), but this depends on transaction isolation — under READ COMMITTED (Postgres default), the second transaction's inner `findFirst` would see the first transaction's committed insert and take the UPDATE branch, making it partly self-correcting only if the first transaction committed before the second reaches the inner check. Under concurrent execution where both outer transactions start before either commits, both could see no existing default and both attempt INSERT. The 23505→409 global handler would catch the second INSERT as a conflict, but that is an unintended error path rather than a controlled guard. The review's description is accurate: the protection for 'payment' relies on the partial unique index (23505 error) rather than an explicit guard.

The severity 'medium' is appropriate for an admin-only endpoint where concurrent approvals of the same change are unlikely but not impossible.

#### 🟠 [medium/reliability] updatePricing creates a Stripe Price before the DB transaction, orphaning the Price if the transaction fails · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/admin/services/billing.ts:85`
- **Confidence:** high
- **Descrizione:** stripe.prices.create() runs before db.transaction(). If the transaction (deactivate old config + insert new config) throws (DB error, unique-active-index violation, etc.), the function rejects but the newly created Stripe Price already exists and is never deactivated/cleaned up, leaving an orphan Price in Stripe with no corresponding pricing_config row. There is no try/catch compensation.
- **Evidenza:** const newPrice = await stripe.prices.create({ product: params.productId, ... });
await db.transaction(async (tx) => { await tx.update(pricingConfig).set({ isActive: false })...; await tx.insert(pricingConfig).values({ ... stripePriceId: newPrice.id ... }); });
- **Fix proposto:** Wrap the post-create DB work in try/catch and, on failure, call stripe.prices.update(newPrice.id, { active: false }) to deactivate the orphaned Price before rethrowing; or persist the config first and create the Stripe Price as a reconciled step.
- **Verifica (confirmed):** The file at apps/api/src/modules/admin/services/billing.ts:85 matches the cited evidence exactly. stripe.prices.create() runs unconditionally at line 85, then db.transaction() runs at line 92. There is no try/catch around the transaction, no compensating call to stripe.prices.update(..., { active: false }) on failure, and no other guard. If the transaction throws for any reason (DB error, unique constraint on isActive, connection drop), the function rejects but the newly created Stripe Price already exists in Stripe and is never cleaned up. The claim is real, accurately described, and triggerable by any DB error inside the transaction block. Severity medium is appropriate — this is an operational/reliability issue with real money consequences (orphaned Stripe prices can cause confusion and billing mistakes) but not an immediate security or data-loss issue.

#### 🟡 [low/bug] verifySeller / rejectSeller have no state-machine guard on current onboarding status · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/admin/services/sellers.ts:179`
- **Confidence:** medium
- **Descrizione:** verifySeller unconditionally sets onboardingStatus='active' (and vatStatus='verified') and rejectSeller sets 'rejected', with no check that the seller is currently in 'pending_review'. An admin can verify a seller that is still mid-onboarding (e.g. pending_document) or re-verify an already-rejected seller, bypassing the intended review gate. listSellers/counts deliberately scope to pending_review/active/rejected, implying verify/reject should only act on pending_review.
- **Evidenza:** export async function verifySeller(sellerId: string) {
  await db.transaction(async (tx) => {
    await tx.update(organization).set({ vatStatus: "verified" })...;
    await tx.update(sellerProfile).set({ onboardingStatus: "active" })...;
  });
- **Fix proposto:** Read the profile first (or use a guarded UPDATE ... WHERE onboarding_status = 'pending_review') and throw ServiceError(400/409) if the seller is not in pending_review, so the transition only fires from the intended state.
- **Verifica (confirmed):** Reading lines 179-213 in apps/api/src/modules/admin/services/sellers.ts confirms the claim exactly. verifySeller (line 179) opens a transaction and unconditionally executes both UPDATE statements (vatStatus="verified", onboardingStatus="active") with no prior read of the seller's current onboardingStatus. rejectSeller (line 197) is identical — it unconditionally sets both columns to "rejected" without any guard. Neither function checks that the seller is currently in "pending_review" before acting. The bug is real and trivially triggerable via the admin route. The fix pattern already exists in the same file: approveChange (line 412) and rejectChange (line 503) both read the record first and throw ServiceError(400, ...) if the status is not "pending" before proceeding. The absence of the analogous guard in verifySeller/rejectSeller is the gap. Severity low is appropriate: this is an admin-only surface, the app is not in production, and misuse is accidental rather than a security vector.

#### 🟡 [low/bug] CSV parser cannot handle quoted fields containing newlines · verifica: **confirmed**

- **Dove:** `apps/api/src/lib/utils/csv.ts:38`
- **Confidence:** high
- **Descrizione:** parseCsv splits the whole text on newlines first and then parses each line independently, so the quote state never spans lines. A valid RFC-4180 CSV field containing an embedded newline (e.g. "line1\nline2") is split across two physical lines, corrupting that row and all subsequent column alignment. This affects both admin category imports that route through this parser.
- **Evidenza:** const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(...);
const rows = lines.slice(1).map(parseCsvLine);  // parseCsvLine resets inQuotes per line
- **Fix proposto:** Tokenize over the full text honoring quote state across newlines (track inQuotes globally and only break a record on an unquoted newline), or adopt a battle-tested CSV parser. Category names are usually single-line, so impact is limited, but the parser is shared.
- **Verifica (confirmed):** The code at /Users/marcogelli/repos/jelaz/bibs/apps/api/src/lib/utils/csv.ts confirms the claim exactly. Lines 38-42 split the entire text on newlines unconditionally before any quote-state tracking. `parseCsvLine` (line 6) declares `let inQuotes = false` as a local variable, so it resets on every call. There is no global quote-state that spans lines. A valid RFC-4180 field containing an embedded newline — e.g. `"line1\nline2"` — would be split by `.split("\n")` into two entries: `"line1` and `line2"`. The first is parsed as an unterminated quoted field (inQuotes stays true through end-of-string, so the final push at line 30 adds just `line1` without the closing quote being consumed), and `line2"` becomes a new row starting with a stray `"`, misaligning all subsequent columns. The `.filter((l) => l.trim() !== "")` guard (line 42) does not help since neither fragment is empty. The parser is called from three places: `category-import.ts` (lines 41 and 186) and `product-import.ts` (line 49). The bug is real and reachable. Severity "low" is correct — category/product names almost never contain embedded newlines in practice, so while the defect is genuine, practical impact is minimal.

#### 🟡 [low/bug] Billing MRR includes past_due and canceling subscription fees

- **Dove:** `apps/api/src/modules/admin/services/billing.ts:24`
- **Confidence:** low
- **Descrizione:** getBillingOverview adds feeAmountCents into mrrCents for 'active', 'past_due', AND 'canceling' statuses. past_due subscriptions are not currently collecting revenue, and 'canceling' subscriptions will stop at period end; counting both inflates reported Monthly Recurring Revenue. Whether to include them is a business decision, but as written MRR mixes collected and at-risk/ending revenue without distinction.
- **Evidenza:** } else if (r.status === "past_due") { pastDueCount = r.count; mrrCents += r.sumCents; }
else if (r.status === "canceling") { cancelingCount = r.count; mrrCents += r.sumCents; }
- **Fix proposto:** Confirm the intended MRR definition. If MRR should reflect committed recurring revenue, count only 'active' (and perhaps 'canceling' until period end) and surface past_due as separate at-risk revenue rather than folding it into MRR.

#### 🟡 [low/type-safety] reject-change route reads body via `(ctx as any).body?.reason` instead of typed context

- **Dove:** `apps/api/src/modules/admin/routes/seller-changes.ts:82`
- **Confidence:** high
- **Descrizione:** The reject route validates the body with TypeBox (reason: t.Optional(t.String)) but extracts it with `(ctx as any).body?.reason`, discarding all type safety and bypassing the withAdmin() typed-context pattern used everywhere else in the module. If the validated body shape changes, this cast hides the breakage from the type checker.
- **Evidenza:** reason: (ctx as any).body?.reason,
- **Fix proposto:** Destructure body from the typed context like the other admin routes, e.g. `const { params, body, store, user } = withAdmin(ctx);` and pass `reason: body.reason`. The body schema is already declared on the route.

#### 🟡 [low/improvement] Duplicated municipality/organization flattening logic across listSellers, getSellerDetail, fetchProfileWithMunicipalities and listPendingChanges

- **Dove:** `apps/api/src/modules/admin/services/sellers.ts:100`
- **Confidence:** high
- **Descrizione:** The exact same transform that flattens residenceMunicipality / documentIssuedMunicipality / organization.municipality into { id, name, provinceAcronym } is hand-written four times (listSellers map, getSellerDetail, fetchProfileWithMunicipalities, and listPendingChanges map). This is error-prone duplication; a change to the projected shape must be made in four places.
- **Evidenza:** residenceMunicipality: residenceMunicipality ? { id, name, provinceAcronym: residenceMunicipality.province.acronym } : null  // repeated 4x
- **Fix proposto:** Extract a single helper (e.g. flattenMunicipality(m) and flattenSellerProfile(raw)) and reuse it in all four code paths.

#### 🟡 [low/security] updatePricing trusts admin-supplied Stripe productId without validation

- **Dove:** `apps/api/src/modules/admin/services/billing.ts:85`
- **Confidence:** medium
- **Descrizione:** params.productId comes straight from the request body (t.String(), no pattern/allowlist) and is passed to stripe.prices.create({ product: params.productId }). A malformed or wrong product id creates a Price attached to an unintended/foreign product. Admin is trusted, but there is no validation that the product is the platform's expected subscription product, so a typo silently produces a Price under the wrong product.
- **Evidenza:** productId: t.String(),  // route schema
const newPrice = await stripe.prices.create({ product: params.productId, ... });
- **Fix proposto:** Validate productId against a configured/expected platform product id (env or a stored config), or at minimum constrain the format (prod_ prefix) and verify the product exists/belongs to the platform before creating the Price.

#### 🟡 [low/improvement] approveChange applies stored changeData via blind `as string` casts (mass-assignment surface)

- **Dove:** `apps/api/src/modules/admin/services/sellers.ts:422`
- **Confidence:** medium
- **Descrizione:** changeData is typed as `{ [key: string]: unknown }` and individual fields are written into the DB via unchecked `as string` casts (vatNumber, documentNumber, documentExpiry, documentIssuedMunicipalityId, stripeAccountId). The values were presumably validated when the seller created the change request, but approveChange re-trusts them without re-validation; if a request was ever created with malformed/missing data, undefined/wrong-typed values are written silently. There is no per-changeType schema enforcement at apply time.
- **Evidenza:** const changeData = change.changeData as ApplyChangeData; ...
vatNumber: changeData.vatNumber as string, ... documentExpiry: changeData.documentExpiry as string,
- **Fix proposto:** Parse change.changeData with a per-changeType TypeBox/Zod schema at the start of approveChange and throw ServiceError(400) on mismatch, so apply-time always sees well-typed data instead of unchecked casts.

#### 🟡 [low/improvement] verifySeller/rejectSeller run UPDATEs before confirming the seller exists

- **Dove:** `apps/api/src/modules/admin/services/sellers.ts:180`
- **Confidence:** medium
- **Descrizione:** Both functions open a transaction and issue UPDATEs scoped by id, then fetch the profile afterward and throw 404 if null. For a non-existent sellerId the UPDATEs no-op (so no data corruption), but a transaction is opened and committed pointlessly and the 404 is determined only after the writes. It also means a missing organization row (seller without org) silently still flips the profile to active.
- **Evidenza:** await db.transaction(async (tx) => { await tx.update(organization)...; await tx.update(sellerProfile)...; });
const updated = await fetchProfileWithMunicipalities(sellerId);
if (!updated) throw new ServiceError(404, "Seller profile not found");
- **Fix proposto:** Fetch/guard existence (and the expected onboarding state) before mutating, or use a guarded UPDATE ... RETURNING and throw 404 when zero rows are returned, so the transaction only runs for valid targets.

### `api-billing-webhooks` — 6 finding

> The billing/webhook subsystem is generally well-structured: raw-body signature verification is correct for Bun's async crypto, events are deduped via an insert-with-onConflictDoNothing ledger, handlers re-read DB state and use transactions for multi-table writes, and Stripe v22 field relocations (current_period_end on items, invoice subscription on parent.subscription_details) are handled consistently. The main risk is a data-integrity gap where a paid checkout completing after the hourly expire-pending cron has expired its pending row results in an orphaned, billing Stripe subscription with no store and no local subscription record, with no reconciliation path. Secondary concerns are missing null guards in checkout-completed (which the sibling handler does guard) and the auto-cancel job not advancing local status, which can cause repeated cancel attempts if the deletion webhook is delayed or dropped.

#### 🔴 [high/reliability] Paid checkout completing after pending expiry creates an orphaned billing subscription with no store · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/webhooks/services/handlers/checkout-completed.ts:40`
- **Confidence:** high
- **Descrizione:** handleCheckoutCompleted only consumes a pending whose status is still 'open' (the findFirst filters on status='open'). Meanwhile runExpirePending (cron hourly) flips any 'open' pending whose expiresAt < now to 'expired'. The checkout session is created with payment_method_collection:'if_required', which permits a session to complete without an immediately collected payment (e.g. zero first invoice / trial), and Stripe sessions can also complete asynchronously. If checkout.session.completed lands after the pending has been expired by the cron, the handler hits the !pending branch, logs 'idempotent skip', and returns — but the Stripe subscription (sub) created for that session is now live and will bill the seller, with NO store and NO storeSubscription row in bibs. The system has no reconciliation that cancels such an orphaned Stripe subscription.
- **Evidenza:** where: and(eq(pendingStoreCreation.id, pendingId), eq(pendingStoreCreation.status, 'open')) ... if (!pending) { logger.info(..., 'Pending already consumed or missing, skipping (idempotent)'); return; }
- **Fix proposto:** In the !pending branch, distinguish 'consumed' (truly idempotent) from 'expired'/'canceled'/missing while a paid subscription exists: if the session is paid and the pending is not 'open', either revive the pending and create the store anyway, or cancel the orphaned Stripe subscription (stripe.subscriptions.cancel(session.subscription)) and log. Also make the pending expiry window safely longer than the Stripe checkout session expiry so an expired pending never corresponds to a still-completable session.
- **Verifica (confirmed):** The bug is real and the evidence cited by the reviewer holds up under inspection.

**What I verified:**

1. `/apps/api/src/modules/webhooks/services/handlers/checkout-completed.ts` lines 40-53: The `findFirst` query filters on both `id = pendingId` AND `status = 'open'`. If the pending is in any other status, `pending` is null and the handler returns early with the "idempotent skip" log — without canceling the Stripe subscription.

2. `/apps/api/src/jobs/expire-pending-store-creations.ts`: `runExpirePending()` does a bulk UPDATE setting `status = 'expired'` for all rows where `status = 'open'` AND `expiresAt < now`. There is no check for whether a Stripe subscription was already created for the session.

3. `/apps/api/src/plugins/cron.ts` line 54: The expire job runs on pattern `"0 * * * *"` — every hour on the hour.

4. `/apps/api/src/modules/seller/services/checkout.ts` lines 71-73 and line 112: The pending's `expiresAt` is set to `now + pendingCreationExpiryHours * 3600s` (default 24 hours from the seed fixture). The Stripe checkout session is created with `payment_method_collection: "if_required"` and no explicit `expires_after` — Stripe defaults checkout sessions to 24 hours. This means a pending and its checkout session can expire at roughly the same time.

**The race condition:**
- User creates checkout near hour 23. Pending `expiresAt` = T+24h.
- At hour 24, the cron fires and flips the pending to `expired` (because `expiresAt < now`).
- Within that same window (or moments later), Stripe delivers `checkout.session.completed` with `payment_status = "paid"`.
- `handleCheckoutCompleted` retrieves the real live Stripe subscription (line 37: `stripe.subscriptions.retrieve(session.subscription)`) — it exists and is active.
- The `findFirst` at line 40-44 returns null because status is now `'expired'`, not `'open'`.
- The `!pending` branch (line 47) logs the skip and returns — no store row, no `storeSubscription` row, no cancellation of the Stripe subscription.
- The seller is billed monthly for a subscription that has no corresponding store in the bibs database.

**No existing guard prevents this.** The code has no reconciliation job, no cleanup in the `!pending` branch that inspects whether a paid subscription exists, and no mechanism to cancel orphaned subscriptions. The `payment_status !== 'paid'` guard (line 15) is necessary but not sufficient — it prevents acting on unpaid sessions, but it doesn't help when the pending is expired and the session IS paid.

The reviewer's severity rating of "high" is appropriate: a live Stripe subscription billing a real user with no corresponding store is a billing correctness failure.

#### 🟠 [medium/reliability] checkout-completed reads sub.items.data[0] and price/period fields without the null guards used elsewhere · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/webhooks/services/handlers/checkout-completed.ts:80`
- **Confidence:** high
- **Descrizione:** firstItem = sub.items.data[0] is dereferenced for firstItem.price.id and firstItem.current_period_end with no check that items.data is non-empty. The sibling handler subscription-updated.ts deliberately guards sub.items.data[0]?.current_period_end and logs/keeps existing on absence. If a retrieved subscription unexpectedly has an empty items array (or current_period_end at a different location), this throws a TypeError inside the transaction. The route then returns HTTP 200 with internalError:true and processedAt stays null, so the store is silently never created and the event must be reprocessed manually — for a paid subscription this is a lost store.
- **Evidenza:** const firstItem = sub.items.data[0];
await tx.insert(storeSubscription).values({ ... stripePriceId: firstItem.price.id, ... currentPeriodEnd: new Date(firstItem.current_period_end * 1000), ...
- **Fix proposto:** Guard firstItem: if (!firstItem) throw a descriptive ServiceError (or log + return). Mirror the optional-chaining pattern from subscription-updated.ts for current_period_end and validate firstItem.price?.id before insert.
- **Verifica (confirmed):** The evidence cited is accurate. In checkout-completed.ts line 80, `const firstItem = sub.items.data[0]` is used unguarded at lines 85 (`firstItem.price.id`) and 89 (`firstItem.current_period_end`). If `firstItem` is undefined (empty items array), both accesses throw TypeError inside the transaction. The sibling handler subscription-updated.ts line 43 uses `sub.items.data[0]?.current_period_end` with an explicit guard (lines 44-49) and keeps the existing value on absence — the defensive asymmetry is real and intentional in the sibling. In practice, a subscription retrieved via stripe.subscriptions.retrieve() immediately after a checkout.session.completed event will always have at least one item, making the real-world trigger probability low. However, Stripe's TypeScript types do not guarantee a non-empty items.data array, and `price` can be null on a subscription item (deleted price). A TypeError thrown inside the db.transaction would bubble up to the webhook handler, result in HTTP 200 with internalError:true (per the global error handler pattern), leave processedAt null, and silently fail store creation for a paid subscription. The severity "medium" is appropriate given the low-but-nonzero trigger probability and the high impact when triggered (lost store for a paid subscription).

#### 🟠 [medium/reliability] Auto-cancel job never advances local status, so a delayed/missing subscription.deleted webhook causes repeated cancel attempts on already-canceled subscriptions · verifica: **confirmed**

- **Dove:** `apps/api/src/jobs/auto-cancel-suspended-stores.ts:31`
- **Confidence:** medium
- **Descrizione:** runAutoCancelSuspended selects subscriptions with status='suspended', sets only cancelReason, then calls stripe.subscriptions.cancel(). It relies entirely on the resulting customer.subscription.deleted webhook to flip the local row to 'canceled'. The local status is NOT changed by the job. If that webhook is delayed beyond the next daily run, or is dropped (the route returns 200 + processedAt=null on handler failure, meaning a failed delete handler never marks the event processed and the row stays 'suspended'), the job re-selects the same row and re-calls stripe.subscriptions.cancel() on an already-canceled subscription, throwing a Stripe error that is caught and logged every single day indefinitely.
- **Evidenza:** await db.update(storeSubscription).set({ cancelReason: 'payment_failed_auto' }).where(eq(storeSubscription.id, sub.id));
await stripe.subscriptions.cancel(sub.stripeSubscriptionId);  // status left as 'suspended'
- **Fix proposto:** Optimistically set status to 'canceling' (or 'canceled' with canceledAt) in the same pre-update so the next run won't re-select the row; let the webhook reconcile the final state. Alternatively guard against re-cancel by checking the Stripe subscription status before calling cancel, and treat an already-canceled sub as success.
- **Verifica (confirmed):** The claim is verified as accurate by reading the relevant code:

1. `/apps/api/src/jobs/auto-cancel-suspended-stores.ts` lines 19-52: The job queries `WHERE status='suspended' AND suspendedAt <= cutoff`, updates only `cancelReason='payment_failed_auto'`, then calls `stripe.subscriptions.cancel()`. The local `status` column is never changed by the job — it remains `'suspended'`.

2. `/apps/api/src/modules/webhooks/services/handlers/subscription-deleted.ts`: The handler that flips `status` to `'canceled'` only fires when a `customer.subscription.deleted` webhook arrives and is processed successfully.

3. `/apps/api/src/modules/webhooks/services/dispatcher.ts` lines 44-70: The dispatcher uses `onConflictDoNothing` on `stripeEvent.eventId` as an idempotency guard — this only prevents duplicate deliveries of the same event. If the webhook is never delivered (or delivered but handler fails and Stripe gets a 200), no row exists to block the next run.

4. `/apps/api/src/modules/webhooks/routes/stripe.ts` lines 30-33: On handler error the route returns HTTP 200, which tells Stripe the event was received — Stripe will NOT retry it. So a failed handler leaves `processedAt=null` and Stripe never re-sends, meaning the local status is permanently stuck at `'suspended'` until a manual intervention.

5. The job's catch block (lines 46-51) catches the Stripe error from canceling an already-canceled subscription and logs it, so it doesn't crash — but the job will re-attempt every daily run indefinitely.

The re-selection mechanism is real: the query at line 22-27 will keep returning the same rows because nothing in the job path changes `status` away from `'suspended'`. The two failure scenarios that trigger the loop are: (a) webhook never delivered due to network/Stripe issue, (b) webhook delivered but handler throws — in case (b) Stripe got a 200 so won't retry. The severity of medium is appropriate: it causes repeated noisy Stripe API errors and redundant calls, but the catch block prevents crashes and the functional outcome (store canceled) is achieved by the first successful call.

#### 🟡 [low/bug] invoice-paid derives currentPeriodEnd from lines.data[0], which is not guaranteed to be the subscription line on multi-line invoices · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/webhooks/services/handlers/invoice-paid.ts:30`
- **Confidence:** medium
- **Descrizione:** currentPeriodEnd is taken from invoice.lines.data[0]?.period?.end. On an invoice that contains more than one line (e.g. a proration line + the recurring subscription line, or multiple subscription items), line[0] may be the proration adjustment rather than the recurring subscription period, so the stored currentPeriodEnd can be wrong (or the proration line's narrow period). The canonical period end for this subscription comes from the subscription item, not an arbitrary invoice line ordering.
- **Evidenza:** const periodEnd = invoice.lines.data[0]?.period?.end;
- **Fix proposto:** Prefer the period from the subscription line item: find the line whose parent/subscription_item matches, or retrieve the subscription and use sub.items.data[0].current_period_end (same source used by checkout-completed and subscription-updated). At minimum, select the line with the latest period.end rather than index 0.
- **Verifica (confirmed):** The evidence is real and confirmed at invoice-paid.ts line 30: `const periodEnd = invoice.lines.data[0]?.period?.end;`. On multi-line invoices (e.g., proration adjustments generated during mid-cycle upgrades/downgrades), `lines.data[0]` may be a proration line with a narrow partial period rather than the recurring subscription line, causing a wrong `currentPeriodEnd` to be stored.

The other handlers confirm the inconsistency: `checkout-completed.ts` line 89 uses `firstItem.current_period_end` from `sub.items.data[0]` (after a `stripe.subscriptions.retrieve()` call), and `subscription-updated.ts` line 43 uses `sub.items.data[0]?.current_period_end` from the subscription object directly — both are the canonical source.

Practical severity mitigation: `invoice.payment_succeeded` and `customer.subscription.updated` typically fire together on a renewal cycle. The `subscription-updated` handler will subsequently (or concurrently) write the correct `currentPeriodEnd` from `sub.items.data[0]`, overwriting any bad value set by `invoice-paid`. This means the incorrect value is transient rather than persistent in most scenarios. However, if event ordering puts `invoice.paid` last (Stripe does not guarantee ordering), the wrong value could persist until the next subscription change.

The bug is real and triggerable on proration invoices; severity "low" is appropriate given the mitigating `subscription.updated` handler that corrects the value. The corrected fix is exactly as described: use `sub.items.data[0].current_period_end` from a retrieved subscription, or find the recurring subscription line rather than blindly taking index 0.

#### 🟡 [low/reliability] Webhook signature-vs-handler error disambiguation relies on substring match of the error message

- **Dove:** `apps/api/src/modules/webhooks/routes/stripe.ts:25`
- **Confidence:** medium
- **Descrizione:** The route decides between returning 400 (invalid signature -> Stripe should NOT retry) and 200 (handler error -> processedAt stays null for manual reprocess) by lowercasing the error message and checking message.includes('signature'). This is brittle: it depends on the exact wording thrown by the dispatcher (currently ServiceError(400,'Invalid Stripe signature')). If a downstream handler ever throws an unrelated error whose message happens to contain 'signature', it would be misclassified as a signature failure and returned as 400, and a genuine signature-verification error whose message wording changes would be misrouted to 200. The intent (signature failures = 400) is better keyed off the thrown ServiceError's status.
- **Evidenza:** const message = err instanceof Error ? err.message.toLowerCase() : '';
if (message.includes('signature')) { ctx.set.status = 400; return { error: 'invalid signature' }; }
- **Fix proposto:** Have the dispatcher's signature failure carry status 400 (it already throws ServiceError(400, ...)). In the route, branch on err instanceof ServiceError && err.status === 400 instead of substring-matching the message.

#### 🟡 [low/reliability] processedAt update is outside the handler transaction; a crash between handler success and the update leaves a processed event reprocessable

- **Dove:** `apps/api/src/modules/webhooks/services/dispatcher.ts:58`
- **Confidence:** medium
- **Descrizione:** The event-dedup insert (onConflictDoNothing) and the later 'set processedAt' update are separate statements, and dispatch() runs its own internal transaction (e.g. checkout-completed). If the process crashes after dispatch() commits but before the processedAt update, the stripe_events row exists with processedAt=null. On Stripe retry the dedup insert hits onConflictDoNothing -> insertedRows.length===0 -> the event is skipped as 'already processed', so processedAt is never set, but more importantly the handler already ran once so this is fine for idempotent handlers — however non-idempotent side effects elsewhere (the auto-cancel reasoning, store soft-delete) depend on the handlers being idempotent. The dedup-by-insert pattern means a partially-processed event (handler threw) and a fully-processed-but-unmarked event are indistinguishable by the processedAt column.
- **Evidenza:** const insertedRows = await db.insert(stripeEvent)...onConflictDoNothing(...);
if (insertedRows.length === 0) { ... return; }
try { await dispatch(event); await db.update(stripeEvent).set({ processedAt: new Date() })... }
- **Fix proposto:** Either mark processedAt inside the same transaction as the handler's DB writes, or accept the documented at-least-once model but ensure every handler is fully idempotent (most are because they re-read state). Document that processedAt is best-effort and dedup is enforced by the insert, not by processedAt.

### `api-db-schemas` — 5 finding

> The schema subsystem is well-structured and unusually disciplined: consistent text-UUID PKs, thorough FK onDelete policies, partial/unique indexes that match the access patterns (single-default address/payment, one-open pending creation, pending-only invitation uniqueness, single-active pricing config), GiST indexes on geometry, GIN tsvector/trigram search indexes, and CHECK constraints mirroring the enum text columns per the house convention. Cross-checking against the services that mutate these tables (orders, points, addresses, employees, subscriptions) the multi-table writes are wrapped in transactions and the partial-unique invariants are upheld in code. The findings below are minor consistency/robustness items rather than live correctness bugs; the most notable is the asymmetric lack of a DB-level default on session/account updatedAt (covered today only by Drizzle's onUpdateFn at insert time).

#### 🟡 [low/consistency] session.updatedAt and account.updatedAt are NOT NULL with no DB-level default (asymmetric with every other table) · verifica: **confirmed**

- **Dove:** `apps/api/src/db/schemas/auth.ts:31`
- **Confidence:** high
- **Descrizione:** session.updatedAt (line 31-33) and account.updatedAt (line 61-63) are declared notNull() with $onUpdate but WITHOUT .defaultNow(). Every other updatedAt in the codebase (user.updatedAt at line 11-14, verification.updatedAt at line 76-79, and all domain tables) pairs $onUpdate with .defaultNow(). Inserts through Drizzle's query builder are safe because Drizzle applies onUpdateFn() on INSERT when the column has no default (verified in pg-core/dialect.cjs: `} else if (!col.default && col.onUpdateFn !== void 0) {`), and better-auth uses the Drizzle adapter. However there is no DB-level DEFAULT, so any raw-SQL insert, seed, or external writer that omits updated_at would hit a NOT NULL violation, unlike every other table.
- **Evidenza:** session: updatedAt: timestamp("updated_at").$onUpdate(() => new Date()).notNull(),  // no .defaultNow()
account: updatedAt: timestamp("updated_at").$onUpdate(() => new Date()).notNull(),  // no .defaultNow()
vs user/verification which have .defaultNow().$onUpdate(...).notNull()
- **Fix proposto:** Add .defaultNow() to session.updatedAt and account.updatedAt to match user/verification and guarantee a DB-level default for any non-Drizzle insert path.
- **Verifica (confirmed):** The code at /Users/marcogelli/repos/jelaz/bibs/apps/api/src/db/schemas/auth.ts confirms the asymmetry exactly as described:

- session.updatedAt (lines 31-33): `timestamp("updated_at").$onUpdate(() => new Date()).notNull()` — no .defaultNow()
- account.updatedAt (lines 61-63): `timestamp("updated_at").$onUpdate(() => new Date()).notNull()` — no .defaultNow()
- user.updatedAt (lines 11-14): `timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull()` — has .defaultNow()
- verification.updatedAt (lines 76-79): `timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull()` — has .defaultNow()

The asymmetry is real: session and account lack a DB-level DEFAULT for updated_at, while user and verification both have one. This means the NOT NULL constraint on session.updated_at and account.updated_at has no DB-level fallback, so any insert not routed through Drizzle's query builder (raw SQL, seed scripts, external tools) would fail with a NOT NULL violation. Drizzle's dialect does synthesize the value on INSERT when onUpdateFn is set and no default exists, so normal better-auth/Drizzle-adapter inserts are safe — but the vulnerability for non-Drizzle paths is genuine.

No house rule covers this: it is not a migration-cost issue (dev-stage, schema changes are free per house rule 1), not a money/enum/error/alias/pagination/toast/i18n/generated-file concern. The severity "low" is appropriate because all current insert paths go through Drizzle, but the risk is real for raw-SQL seeds or external writers.

#### 🟡 [low/consistency] store_product unique (productId,storeId) is unconditional, so a trashed product still blocks re-listing in the same store · verifica: **refuted**

- **Dove:** `apps/api/src/db/schemas/product.ts:141`
- **Confidence:** low
- **Descrizione:** store_product_product_store_idx is an unconditional uniqueIndex on (productId, storeId). Product soft-deletion uses product.status='trashed' (not removal of the product row), and the product EAN uniqueness index deliberately excludes trashed (product_seller_ean_unique WHERE ... status != 'trashed' at line 59-61). The store_product link does not apply the same status carve-out, so a product set to 'trashed' that retains a store_products row prevents re-creating that link until the row is removed. This is an inconsistency with the trashed-aware EAN uniqueness; whether it bites depends on whether trashing also deletes store_products rows (stock.ts deletes store_product rows on delisting, so the path may be covered, but the asymmetry with the EAN index is worth noting).
- **Evidenza:** uniqueIndex("store_product_product_store_idx").on(table.productId, table.storeId)  // no status carve-out
vs uniqueIndex("product_seller_ean_unique")...where(sql`${table.ean} IS NOT NULL AND ${table.status} != 'trashed'`)
- **Fix proposto:** Confirm trashing a product also removes its store_products rows; if not, document the intent or align the uniqueness semantics so a trashed product does not permanently reserve a (productId, storeId) slot.
- **Verifica (refuted):** The schema asymmetry at product.ts:141 is real (unconditional uniqueIndex vs. the trashed-aware EAN index), but the claimed blocking scenario does not hold in practice for two reasons:

1. The only code path that inserts into store_products is `assignProductToStores` in stock.ts (lines 30-46), which uses `.onConflictDoUpdate(...)` targeting the same (productId, storeId) unique index. This means re-assigning a trashed product to its existing store silently upserts the stock value rather than raising a unique-constraint violation. There is no raw INSERT path that would trigger a 409.

2. The claim's framing of "re-listing in the same store" is ambiguous. If it means taking a trashed product and re-adding it to the same store, that path goes through `assignProductToStores` which handles the conflict gracefully. If it means creating a brand-new product with the same EAN and assigning it to the same store, that produces a new productId, so the new (newProductId, storeId) pair does not conflict with the old (trashedProductId, storeId) pair — the unique index is on productId+storeId, not EAN+storeId.

The `updateProductStatus` (trash) path (products.ts:843-865) only updates `product.status` and does not remove store_products rows, so trashed products do retain their store_products rows. But `deleteProduct` (the permanent-delete step) issues a hard DELETE on the product row, and the FK cascade (`onDelete: "cascade"` on store_products.product_id) removes the store_products rows automatically. The lifecycle is intact.

The only genuine inconsistency is cosmetic: a trashed product shows in `getProductStatusCounts` results (products.ts:365-394) because that function joins store_products regardless of product status. That is a design choice, not a blocking bug. The unique-index asymmetry does not cause any reachable constraint violation in the current codebase.

#### 🟡 [low/reliability] payment_method.isDefault defaults to true and collides with the single-default partial unique index on multi-insert

- **Dove:** `apps/api/src/db/schemas/payment-method.ts:22`
- **Confidence:** medium
- **Descrizione:** isDefault defaults to true (line 22) while a partial unique index enforces at most one isDefault=true per seller (lines 29-31). The only insert path (admin/services/sellers.ts:475) is guarded: it inserts a new row only when no default exists, and otherwise updates the existing default in place. So today this works. But the default-true + partial-unique combination is fragile: any future code that inserts a second payment method for a seller without first clearing the prior default (or without supplying isDefault:false) will hit a 23505 unique violation rather than silently demoting the old default, the way the address flow explicitly does (addresses.ts:84-89 sets prior defaults to false inside the txn before inserting).
- **Evidenza:** isDefault: boolean("is_default").default(true).notNull(),
...
uniqueIndex("payment_method_single_default_idx").on(table.sellerProfileId).where(sql`${table.isDefault} = true`)
- **Fix proposto:** Either default isDefault to false (and let the service promote explicitly, mirroring the address flow), or keep default true but clear prior defaults inside the same transaction at every insert site to avoid the 23505 collision.

#### 🟡 [low/reliability] point_transactions has no per-order/per-type idempotency constraint; double-award relies entirely on application guards

- **Dove:** `apps/api/src/db/schemas/points.ts:21`
- **Confidence:** medium
- **Descrizione:** point_transactions records earned/redeemed/refunded amounts and the customerProfile.points balance is mutated via read-modify-write SQL increments (order-helpers.ts awardPoints/refundStockAndPoints). There is no unique constraint preventing two 'earned' rows for the same orderId or two 'refunded' rows for the same orderId. Double-crediting is currently prevented only by the order state machine (assertTransition blocks completing/cancelling an order twice). That is sound today, but the points ledger has no DB-level idempotency backstop, so any future code path that awards/refunds without going through the state-machine guard could double-credit a customer's balance.
- **Evidenza:** amount: integer("amount").notNull(),
type: varchar("type", { enum: pointTransactionTypes }).notNull(),
orderId: text("order_id").references(() => order.id, { onDelete: "set null" }),
// no unique(orderId, type)
- **Fix proposto:** Consider a partial unique index on (orderId, type) where orderId IS NOT NULL (or a generated ledger key) so the points ledger is idempotent at the DB level, independent of the order state machine.

#### 🟡 [low/consistency] seller_profile.documentImageKey lacks the unique constraint applied to all other image storage keys

- **Dove:** `apps/api/src/db/schemas/seller.ts:65`
- **Confidence:** low
- **Descrizione:** documentImageKey is a plain nullable text column. Every other S3-style storage key in the schema is declared .unique() (store_images.key at store-image.ts:15 and product_images.key at product-image.ts:15). If keys are meant to be globally unique object keys, the seller document key is the one place that omits the guarantee, allowing two seller profiles to point at the same object key.
- **Evidenza:** documentImageKey: text("document_image_key"),   // not .unique()
vs key: text("key").notNull().unique()  in store-image.ts and product-image.ts
- **Fix proposto:** If document image keys are unique object keys, add .unique() to documentImageKey for parity with store/product image keys; otherwise document why this key namespace is exempt.

### `api-db-seed` — 7 finding

> The seed subsystem is well-structured, heavily commented, and mostly idempotent via per-table canary checks; deterministic generators (pick/stride/offset) and globally-unique EANs/VAT numbers avoid constraint collisions. The two most material issues are (1) a non-deterministic plan-to-store assignment in billing-subscriptions (no ORDER BY) that also soft-deletes an arbitrary store, and (2) downstream seeds (products, team) querying stores without a deletedAt filter, so they can attach inventory/employees to that soft-deleted store while store-images correctly excludes it. Beyond those, the canary idempotency is coarse-grained: a failure between the two phases of seedCustomers/seedSellers leaves user rows without their profiles and is not self-healing on re-run. None of these are production-blocking (dev-only fixtures), but the determinism and cross-seed consistency issues undermine the subsystem's stated goals.

#### 🟠 [medium/reliability] billing-subscriptions assigns plan states (and a soft-delete) by row order with no ORDER BY — non-deterministic · verifica: **confirmed**

- **Dove:** `apps/api/src/db/seed/fixtures/billing-subscriptions.ts:93`
- **Confidence:** high
- **Descrizione:** The store query that feeds the plan assignment has no ORDER BY. The first plans.length targets get the mixed states (past_due/canceling/suspended/canceled), and targets[6] (the canceled plan) gets its store soft-deleted. Because targets is filtered from an unordered SELECT, which concrete stores receive each non-active state — and crucially which store is soft-deleted — depends on Postgres physical row order, not a deterministic rule. This contradicts the subsystem's determinism goal and makes runs non-reproducible across machines/reseeds.
- **Evidenza:** const stores = await db.select({...}).from(store).innerJoin(sellerProfile, ...).where(isNull(store.deletedAt));  // no .orderBy(...)
...
const plan: Plan = plans[idx] ?? {status: "active", ...};
- **Fix proposto:** Add a stable ordering to the store query (e.g. .orderBy(asc(store.createdAt), asc(store.id))) before filtering and assigning plans, so the mixed states and the soft-delete always land on the same stores.
- **Verifica (confirmed):** The store query at lines 93-101 of /Users/marcogelli/repos/jelaz/bibs/apps/api/src/db/seed/fixtures/billing-subscriptions.ts has no .orderBy() clause. The subsequent targets.map at line 133 assigns plan states by array index position (plans[idx]), so the first 7 stores in the unordered result set receive non-active states (3×past_due, 2×canceling, 1×suspended, 1×canceled). The store at index 6 (plans[6].softDeleteStore=true) is soft-deleted via UPDATE at lines 174-178. The comment at line 131 explicitly claims "deterministically" but this is incorrect — without ORDER BY, Postgres returns rows in heap scan order which varies by vacuum state and storage layout. The idempotency guard at lines 109-118 only filters already-subscribed stores but imposes no ordering on the remaining targets. No other guard or constraint compensates for the missing ORDER BY. The issue is real, reachable (any re-seed or fresh seed on a different machine), and correctly described by the reviewer. This is a seed file concern (not production code), which slightly lowers impact, but the non-determinism is genuine. The medium severity rating is appropriate for a seed fixture — it affects developer experience and test reproducibility but not production data.

#### 🟠 [medium/consistency] products and team seed stores without filtering soft-deleted ones — attach inventory/employees to an archived store · verifica: **confirmed**

- **Dove:** `apps/api/src/db/seed/fixtures/products.ts:121`
- **Confidence:** high
- **Descrizione:** seedBillingSubscriptions runs before seedTeam and seedProducts and soft-deletes one active seller's store (deletedAt set). Both products.ts and team.ts then SELECT stores with only an inArray(sellerProfileId) filter and NO isNull(store.deletedAt), so the soft-deleted store is included and receives storeProduct inventory rows and possibly storeEmployeeStores/invitation assignments. seedStoreImages, by contrast, correctly excludes deleted stores (isNull(store.deletedAt)), so the result is an internally inconsistent fixture: an archived store with products/employees but no cover image.
- **Evidenza:** products.ts: const storeRows = await db.select({...}).from(store).where(inArray(store.sellerProfileId, sellerProfileIds)).orderBy(...);  // no deletedAt filter
team.ts: .from(store).where(inArray(store.sellerProfileId, sellerProfileIds))  // no deletedAt filter
vs store-images.ts: .where(isNull(store.deletedAt))
- **Fix proposto:** Add and(inArray(...), isNull(store.deletedAt)) to the store queries in products.ts:121 and team.ts:130 so downstream fixtures never attach data to soft-deleted stores.
- **Verifica (confirmed):** All cited evidence holds:

1. Execution order confirmed in apps/api/src/db/seed/fixtures/index.ts: seedBillingSubscriptions (line 25) runs before seedStoreImages (26), seedTeam (27), and seedProducts (29).

2. seedBillingSubscriptions (billing-subscriptions.ts lines 69-78, 172-179) explicitly soft-deletes exactly one store by setting deletedAt. The `buildPlans` function includes one plan with `softDeleteStore: true` (the canceled plan), and lines 171-179 apply the update.

3. products.ts line 121-128: the store SELECT uses only `inArray(store.sellerProfileId, sellerProfileIds)` — no `isNull(store.deletedAt)`. The soft-deleted store gets included in `storesBySeller` and then receives storeProduct inventory rows (lines 285-289).

4. team.ts lines 130-137: identical pattern — `inArray(store.sellerProfileId, sellerProfileIds)` with no deletedAt filter. The soft-deleted store ends up in `storesBySeller` and receives storeEmployeeStores assignments (line 239) and employeeInvitationStores assignments (line 289).

5. store-images.ts line 30: correctly uses `isNull(store.deletedAt)`, so the archived store gets no cover image.

The result is exactly the inconsistency described: an archived store with product inventory rows and employee/invitation assignments but no store image. The fix is straightforward — add `and(inArray(...), isNull(store.deletedAt))` at products.ts:127 and team.ts:136. Severity medium is appropriate for seed-only inconsistency in a non-deployed app.

#### 🟠 [medium/reliability] Coarse canary idempotency leaves users without profiles when a run fails between phases · verifica: **refuted**

- **Dove:** `apps/api/src/db/seed/fixtures/customers.ts:38`
- **Confidence:** medium
- **Descrizione:** seedCustomers gates the whole function on whether customer1@test.com exists (Phase 1 creates auth users, Phase 2 batch-inserts customerProfile). If Phase 1 succeeds and the Phase 2 profile insert throws (or the process dies in between), a re-run sees customer1 already present and skips entirely — leaving up to 300 user rows with role=customer but no customerProfile, with no self-healing path. seedSellers has the same shape gated on seller1@test.com (Phase 2/3/4 insert profile/org/store after Phase 1 users), so a mid-run failure leaves orphaned seller users without profiles/orgs/stores and a re-run will not repair them.
- **Evidenza:** const existing = await db.query.user.findFirst({ where: eq(user.email, "customer1@test.com") });
if (existing) { console.log("  ⏭ Bulk customers already seeded, skipping"); return; }
... // Phase 2: await db.insert(customerProfile)...
- **Fix proposto:** Either wrap each user's auth.api.signUpEmail + profile insert in a per-row unit and use a canary that reflects profile presence (e.g. count customerProfile / sellerProfile), or detect users-without-profiles and backfill them on re-run, rather than gating solely on the existence of the first user.
- **Verifica (refuted):** The failure mode described is technically real — Phase 1 (auth user creation) and Phase 2+ (profile/org/store inserts) are not wrapped in a transaction, and the canary check gates solely on user presence. However, the claim is refuted on house-rule grounds:

1. The project's documented and enforced workflow explicitly states db:seed "assumes a clean schema" and should only be run after a db:reset (which runs `docker compose down -v` to wipe all volumes before re-migrating and re-seeding). The MEMORY.md entry [infra:reset vs db:reset] confirms: "per wipe+migrate+seed end-to-end usa db:reset". The self-healing path for any partial seed is db:reset, not a smarter idempotent seed.

2. Both seeds are dev-only fixture scripts with a comment "Not for production." The seed/index.ts has no retry/recovery logic, and db:seed is invoked as the final step of db:reset — the expected re-run mechanism is always a full volume wipe, not a bare re-seed.

3. No transaction is missing relative to the project's design intent — the seed is a one-shot dev fixture loader, not an idempotent reconciler. The canary pattern is appropriate for a clean-slate assumption.

The claim describes a real structural fragility but flags it as a bug in a context where the project convention (db:reset) already handles it. Flagging it as a reliability issue implies the seed should be re-runnable in isolation, which contradicts the stated house rule ("db:seed on a DB you haven't just infra:reset'd" is explicitly deny-listed).

#### 🟡 [low/reliability] Within-seller store ordering is effectively random for same-batch stores (shared createdAt + UUID tiebreaker) · verifica: **confirmed**

- **Dove:** `apps/api/src/db/seed/fixtures/team.ts:137`
- **Confidence:** medium
- **Descrizione:** team.ts and products.ts order stores by asc(store.createdAt), asc(store.id) and then index by position (storeIdx / idxInSeller % stores.length). Stores inserted in a single db.insert(...).values([...]) batch (e.g. seedDevSeller's two stores, or a seller's extra stores from one seedExtraStores batch) share the same statement timestamp for createdAt, so the tiebreaker is the random UUID id. The positional semantics ('storeIdx 0/1/2') therefore do not reliably map to insertion order; assignments are stable within one seeded DB but not meaningfully or reproducibly ordered across reseeds.
- **Evidenza:** team.ts: .orderBy(asc(store.createdAt), asc(store.id));
products.ts: .orderBy(asc(store.createdAt), asc(store.id));
// extra stores inserted in one batch share createdAt; tiebreak is crypto.randomUUID() id
- **Fix proposto:** If positional store assignment must be reproducible, add a deterministic ordering column (e.g. a seeded position/sequence on store) or sort the in-memory list by a deterministic field (name) rather than relying on createdAt/id, which is non-deterministic for same-batch rows.
- **Verifica (confirmed):** The evidence holds as described. In team.ts line 137 and products.ts line 128, stores are fetched with `.orderBy(asc(store.createdAt), asc(store.id))`. The store schema (store.ts lines 50-52) uses `.defaultNow()` for `createdAt`, which resolves to `NOW()` at the database level — a single statement's rows all receive the same timestamp. In extra-stores.ts line 171, all extra stores for all designated sellers are inserted in one `db.insert(store).values(extraStoreRows)` call, so stores belonging to the same seller that were added in that batch share an identical `createdAt`. The tiebreaker falls to `store.id`, which is `crypto.randomUUID()` (store.ts line 24) — non-deterministic across reseeds. For MULTI_4_EMP_IDXS sellers (indices 0, 14, 28, 42), two extra stores are inserted per seller in that batch; the assignment code in team.ts lines 65-66 uses `storeIdx: 0`, `storeIdx: 1`, `storeIdx: 2`, meaning storeIdx 1 and 2 can silently swap between reseeds. The first store (original, seeded individually before extra-stores runs) will reliably sort to position 0 due to its earlier `createdAt`, but positions 1 and 2 among the two extras are UUID-ordered. This is real and triggerable: any fresh `db:reset + db:seed` cycle may produce a different employee-to-extra-store mapping. That said, the practical consequence is limited to dev seed data — no production deployment exists, all assignments are internally valid (employees do get assigned to real stores of the correct seller), and no test asserts on which specific extra store an employee lands on. Severity low is correct.

#### 🟡 [low/reliability] Empty catch blocks swallow signup errors, only logging the email

- **Dove:** `apps/api/src/db/seed/fixtures/sellers.ts:323`
- **Confidence:** high
- **Descrizione:** The auth.api.signUpEmail loops in sellers.ts, customers.ts, and team.ts catch all errors with an empty `catch {}` and log only the email. A systematic failure (schema mismatch, constraint, auth misconfig) is indistinguishable from a one-off duplicate and is silently dropped, so the seed can report success while having created far fewer rows than intended. The downstream batch inserts then operate on the partial `created` set, masking the root cause.
- **Evidenza:** } catch {
  console.error(`     ✗ Failed: ${s.email}`);
}
- **Fix proposto:** Capture the error and log its message (console.error(`✗ Failed: ${email}`, err instanceof Error ? err.message : err)) so genuine failures are visible; optionally track a failure count and abort/warn loudly if it exceeds a small threshold.

#### 🟡 [low/improvement] seedProducts requires macro categories but silently emits no category assignments if subcategories are missing

- **Dove:** `apps/api/src/db/seed/fixtures/products.ts:88`
- **Confidence:** medium
- **Descrizione:** The precondition only counts productMacroCategory and throws if zero, but it does not verify that any productCategory (subcategories) exist. If macros are present but the sub-category load returns empty (subsByMacro empty), the per-product loop hits `if (!subs || subs.length === 0) continue;` and products are created with zero category assignments, with no warning. This is an easy-to-miss data-completeness gap given the seed's stated intent to produce realistic fixtures.
- **Evidenza:** const [{ value: macroCount }] = await db.select({ value: count() }).from(productMacroCategory);
if (macroCount === 0) { throw new Error("seedProducts: no product_macro_categories found — run seedBase first"); }
... for (const p of productMeta) { const subs = subsByMacro.get(p.macro); if (!subs || subs.length === 0) continue; ... }
- **Fix proposto:** Also assert productCategory count > 0 (or warn when subsByMacro is empty for a macro that has products), so a missing subcategory load surfaces instead of producing uncategorized products silently.

#### 🟡 [low/reliability] Locations seed assumes JSON FK references always resolve (non-null assertions)

- **Dove:** `apps/api/src/db/seed/base/locations.ts:66`
- **Confidence:** medium
- **Descrizione:** Province and municipality inserts resolve their parent FK via regionMap.get(...)! and provinceMap.get(...)! with non-null assertions. If a province references a regionIstatCode (or a municipality a provinceIstatCode) that is missing or mistyped in the JSON, the lookup returns undefined, the `!` masks it, and the insert fails with a NOT NULL violation that does not point at the offending source row. Given this is the base reference data shared across all environments, a clearer pre-validation would make data errors actionable.
- **Evidenza:** regionId: regionMap.get(p.regionIstatCode)!,
...
provinceId: provinceMap.get(m.provinceIstatCode)!,
- **Fix proposto:** Validate the FK lookup explicitly and throw a descriptive error (e.g. `Province ${p.istatCode} references unknown region ${p.regionIstatCode}`) instead of using a non-null assertion, so malformed JSON is reported at the row level.

### `api-schemas` — 5 finding

> The schema layer is well-organized, consistent, and mostly clean: entity/composed/discount/stock schemas are coherent, Italian OpenAPI descriptions are thorough, money is correctly modeled as decimal strings, percent/range constraints match across discount and search, and cross-field business rules (endsAt>startsAt, password confirmation) are correctly enforced in services rather than schemas. The most material issue is that the PATCH /stores/:storeId route re-declares its openingHours (and phoneNumbers) body inline with looser validation than the canonical OpeningHoursSchema used by the POST path, opening an input-validation gap and a type-vs-runtime divergence. The remaining findings are low-severity consistency/looseness items: integer-typed DB columns validated as t.Number on input, calendar-impossible date strings passing the YYYY-MM-DD regex, and a non-standard (but internally consistent) dayOfWeek convention.

#### 🔴 [high/bug] PATCH /stores openingHours bypasses the canonical validated OpeningHoursSchema · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/seller/routes/stores.ts:129`
- **Confidence:** high
- **Descrizione:** The POST /stores route validates openingHours via the canonical OpeningHoursSchema (apps/api/src/lib/schemas/forms/opening-hours.ts), which enforces a time-of-day regex on open/close (^([01]\d|2[0-3]):[0-5]\d$), slots minItems:1/maxItems:4, and the outer array maxItems:7. The PATCH /stores/:storeId route re-declares openingHours inline as t.Array(t.Object({ dayOfWeek, slots: t.Array(t.Object({ open: t.String(), close: t.String() })) })) with NO time pattern, NO minItems/maxItems on slots, and NO maxItems on the day array. So an update can persist malformed times (e.g. open:'99:99', close:'abc'), empty slot arrays, or an unbounded number of days straight into the store.opening_hours jsonb column. The service signature even types this as OpeningHours = Static<typeof OpeningHoursSchema>, so the route accepts data the type claims is impossible — a runtime/type mismatch.
- **Evidenza:** stores.ts:129-147 inline: `openingHours: t.Optional(t.Nullable(t.Array(t.Object({ dayOfWeek: t.Integer({minimum:0,maximum:6}), slots: t.Array(t.Object({ open: t.String(), close: t.String() })) })))))` vs forms/opening-hours.ts TimeSlotSchema uses pattern ^([01]\d|2[0-3]):[0-5]\d$ and slots minItems:1/maxItems:4; services/stores.ts:146 `openingHours?: OpeningHours | null` (OpeningHours = Static<typeof OpeningHoursSchema>).
- **Fix proposto:** Import and reuse OpeningHoursSchema (and the PhoneNumber form schema) in the PATCH body instead of the inline t.Array. Use t.Optional(t.Nullable(OpeningHoursSchema)) so create and update enforce identical time-format, slot-count, and day-count constraints.
- **Verifica (confirmed):** The claim is verified by direct code inspection:

1. `/apps/api/src/lib/schemas/forms/opening-hours.ts` defines `OpeningHoursSchema` with: `TimeSlotSchema` enforcing pattern `^([01]\d|2[0-3]):[0-5]\d$` on both `open` and `close`; `DayScheduleSchema` with `slots: Type.Array(TimeSlotSchema, { minItems: 1, maxItems: 4 })`; and `OpeningHoursSchema = Type.Array(DayScheduleSchema, { maxItems: 7 })`.

2. `/apps/api/src/lib/schemas/forms/stores.ts` line 74 shows `CreateStoreBody` (used by POST /stores) correctly references `openingHours: Type.Optional(OpeningHoursSchema)`.

3. `/apps/api/src/modules/seller/routes/stores.ts` lines 129-147 show the PATCH /stores/:storeId route declares `openingHours` inline as `t.Optional(t.Nullable(t.Array(t.Object({ dayOfWeek: t.Integer({minimum:0,maximum:6}), slots: t.Array(t.Object({ open: t.String(), close: t.String() })) }))))` — no time pattern, no minItems/maxItems on slots, no maxItems on the outer array.

4. `/apps/api/src/modules/seller/services/stores.ts` line 18 confirms `type OpeningHours = Static<typeof OpeningHoursSchema>` and line 146 confirms `openingHours?: OpeningHours | null` in the update signature — the service types the field as the validated type but accepts the unvalidated inline schema from the PATCH route.

No guard in the service re-validates time format, slot count, or day count before writing to the `opening_hours` jsonb column. The bug is real and directly triggerable: a PATCH request with `open: '99:99'`, empty slots array, or more than 7 days will pass Elysia's validation and be persisted. The severity is correctly assessed as high.

#### 🟡 [low/type-safety] PhoneNumber.position validated as t.Number but column is integer · verifica: **confirmed**

- **Dove:** `apps/api/src/lib/schemas/forms/stores.ts:17`
- **Confidence:** high
- **Descrizione:** The PhoneNumber input position is declared Type.Number({ minimum: 0 }) (and identically as t.Number in the inline PATCH body at stores.ts:169). The backing column store_phone_numbers.position is `integer(...).notNull().default(0)`. A fractional value such as 1.5 passes schema validation and reaches an integer column, producing a Postgres insert error (ugly 500 path) rather than a clean 400. The same loose t.Number appears on response-only fields (StoreImageSchema.position, ProductImageSchema.position, StorePhoneNumberSchema.position, StoreProductSchema.stock) which is harmless on output but inconsistent with the integer DB type.
- **Evidenza:** forms/stores.ts:17-22 `position: Type.Optional(Type.Number({ minimum: 0, ... }))`; db/schemas/store.ts:79 `position: integer("position").notNull().default(0)`.
- **Fix proposto:** Use Type.Integer({ minimum: 0 }) for position on inputs (forms/stores.ts and the inline PATCH body), and prefer t.Integer for the integer-backed response fields (position, stock) for accuracy of the OpenAPI/Eden types.
- **Verifica (confirmed):** Both input locations use t.Number/Type.Number (accepts floats) for a field that maps to an integer DB column:

1. /apps/api/src/lib/schemas/forms/stores.ts lines 17-22: `Type.Number({ minimum: 0 })` for PhoneNumber.position, used in CreateStoreBody.

2. /apps/api/src/modules/seller/routes/stores.ts lines 169-174: `t.Number({ minimum: 0 })` in the inline PATCH body's phoneNumbers[].position.

3. /apps/api/src/db/schemas/store.ts line 79: `integer("position").notNull().default(0)` — the backing column is a strict integer.

4. /apps/api/src/modules/seller/services/stores.ts lines 98-103 and 191-195: The position value flows as `p.position ?? idx` directly into `tx.insert(storePhoneNumberTable).values(phoneValues)` with no rounding or integer coercion. A fractional value like 1.5 passes schema validation, reaches Drizzle, and Postgres rejects it with an integer constraint error — producing an unhandled 500 rather than a clean 400.

No guard, rounding, or Math.floor exists in the path. The reviewer's evidence is correct (the inline PATCH body location is in routes/stores.ts, not forms/stores.ts:169 as stated, but that is a minor location error and does not change the validity of the finding). Severity low is appropriate — it is a type-safety gap but unlikely to be hit accidentally since most callers will pass integers.

#### 🟡 [low/reliability] Date fields accept calendar-impossible values (regex-only validation) · verifica: **confirmed**

- **Dove:** `apps/api/src/lib/schemas/forms/onboarding.ts:30`
- **Confidence:** medium
- **Descrizione:** birthDate, documentExpiry (onboarding.ts and settings.ts) validate only the format ^\d{4}-\d{2}-\d{2}$. Values like '2026-13-45' or '0000-00-00' pass schema validation. They are stored in Postgres `date(..., { mode: 'string' })` columns, so Postgres rejects them at INSERT time — but that surfaces as a generic DB error (500-style) rather than a clean 400 VALIDATION_ERROR through the normal handler path. The format-only check gives a false sense of validation.
- **Evidenza:** onboarding.ts:30-34 `birthDate: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })`; db/schemas/seller.ts:50 `birthDate: date("birth_date", { mode: "string" })`. The regex matches month 13 / day 45.
- **Fix proposto:** Use TypeBox format: 'date' (or 'date-time' as appropriate) so the validator enforces real calendar dates, or add a service-level Date parse + ServiceError(400) before insert. Keeps the rejection on the validation path with a clean envelope.
- **Verifica (confirmed):** All cited evidence holds. At onboarding.ts:30-34 and settings.ts:30-34/114-118, both `birthDate` and `documentExpiry` are validated only with the pattern `^\d{4}-\d{2}-\d{2}$` — values like `2026-13-45` match this regex and pass TypeBox validation. The DB columns are `date(..., { mode: "string" })` (seller.ts:50, 61), which means Postgres will enforce real calendar dates and reject `2026-13-45` with error code `22007` (invalid_datetime_format). The global error handler in `error-handler.ts` explicitly handles only: `ServiceError` (returns its own status), Postgres `23505` unique violations (→ 409), Elysia `VALIDATION` code (→ 422), and `NOT_FOUND` (→ 404). There is no branch for pg code `22007` or any other date-related Postgres error. Any such error falls through to the final catch-all which returns `status(500, errorBody("INTERNAL_ERROR", "Internal server error"))`. No service-level guard in `onboarding.ts` or `settings.ts` performs a Date parse before the DB update. The issue is real and triggerable as described. Severity "low" is appropriate: the input is still rejected (just with an unclean 500 envelope rather than a 400/422), there is no data corruption, and the app is pre-production.

#### 🟡 [low/improvement] dayOfWeek convention (0=Monday) diverges from JS getDay() (0=Sunday)

- **Dove:** `apps/api/src/lib/schemas/entities.ts:245`
- **Confidence:** medium
- **Descrizione:** openingHours.dayOfWeek is documented as 0=Lunedì..6=Domenica across StoreSchema (entities.ts:245), DayScheduleSchema (forms/opening-hours.ts:17), and the inline PATCH schema. The seller frontend DAY_LABELS array is consistent with this (index 0 = 'Lunedì'). However the convention is the opposite of JavaScript Date.getDay() (0=Sunday). No 'open now' computation exists yet, so this is a latent foot-gun: any future server- or client-side availability logic that maps a real Date via getDay() into this array would be off-by-one (it would treat Sunday as Monday). It is internally consistent today, so this is a forward-looking note, not a live bug.
- **Evidenza:** entities.ts:245-249 `dayOfWeek: t.Integer({ minimum: 0, maximum: 6, description: "Giorno della settimana (0=Lunedì, 6=Domenica)" })`; apps/seller/.../opening-hours-editor.tsx DAY_LABELS = ['Lunedì', ...].
- **Fix proposto:** Either adopt the ISO/JS-friendly 0=Sunday (or 1=Monday) convention, or add a single shared helper to convert getDay() -> bibs dayOfWeek and document that any availability logic MUST go through it, to prevent a future off-by-one.

#### 🟡 [low/consistency] Store openingHours/phoneNumbers schema duplicated inline between POST and PATCH

- **Dove:** `apps/api/src/modules/seller/routes/stores.ts:155`
- **Confidence:** high
- **Descrizione:** POST /stores reuses the shared CreateStoreBody (which composes OpeningHoursSchema and the PhoneNumber form schema), while PATCH /stores re-declares both openingHours and phoneNumbers inline. Beyond the validation gap noted separately, this duplication means future constraint changes must be made in two places and can silently drift (as they already have for openingHours). The address block, by contrast, correctly shares AddressFieldsOptional.
- **Evidenza:** stores.ts:129-178 inline openingHours + phoneNumbers objects duplicating forms/opening-hours.ts and forms/stores.ts:4 PhoneNumber.
- **Fix proposto:** Extract the PhoneNumber input object and reuse it plus OpeningHoursSchema in both POST and PATCH bodies (PATCH wrapping them in Optional/Nullable as needed), mirroring how AddressFieldsRequired/AddressFieldsOptional are shared.

### `api-infra` — 6 finding

> The subsystem is generally well-structured and follows the repo's documented conventions (ok/okPage envelopes, ServiceError, withErrors, parsePagination, named auth plugin reuse). Read paths (locations, categories) are simple and correct, pagination math is sound, and the avatar upload has a thoughtful S3 rollback and best-effort old-image cleanup. The main issues are around bucket-policy security (anonymous list/policy exposure depends on MinIO config), concurrent-upload S3 orphaning, an env validation path-parsing weakness for nested keys, and S3_ENDPOINT trailing-slash robustness. No critical authz/IDOR or SQL-injection bugs were found.

#### 🟠 [medium/security] ensureBucket sets a permanent public-read bucket policy on every startup

- **Dove:** `apps/api/src/lib/s3.ts:48`
- **Confidence:** high
- **Descrizione:** ensureBucket unconditionally applies a bucket policy allowing anonymous s3:GetObject on the entire bucket (arn:aws:s3:::${bucket}/*) on every startup, not only when the bucket is created. This means ALL objects in the bucket are world-readable by guessable/leaked key, including any future non-public uploads placed in the same bucket (invoices, exports, documents, etc.). Avatar keys use random UUIDs so they are hard to enumerate, but the policy grants blanket public read to anything ever stored here.
- **Evidenza:** Effect: "Allow", Principal: "*", Action: ["s3:GetObject"], Resource: [`arn:aws:s3:::${bucket}/*`] ... await awsS3.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: policy }));
- **Fix proposto:** Scope public read to a public/ prefix (Resource: arn:aws:s3:::${bucket}/public/*) and store avatars/product images under that prefix, keeping private artifacts out of the public namespace. At minimum, only apply the policy when `created` is true and document that this bucket is intentionally fully public.

#### 🟡 [low/reliability] Concurrent avatar uploads orphan S3 objects (non-atomic read-modify-write) · verifica: **confirmed**

- **Dove:** `apps/api/src/modules/me/services/avatar.ts:30`
- **Confidence:** high
- **Descrizione:** uploadUserAvatar reads the current image, writes a new S3 object, then updates user.image, with no row lock or transaction spanning the read and the write. Two concurrent uploads for the same user each capture the same `current.image`, each write a new key (A and B), each set user.image (last writer wins), and each delete only the OLD key they read. The losing upload's freshly-written object (e.g. key_A) is never referenced and never deleted, leaking storage. No broken DB reference results, so impact is limited to orphaned files.
- **Evidenza:** const current = await db.query.user.findFirst({ where: eq(userTable.id, userId), columns: { image: true } }); ... const key = `users/${userId}/${crypto.randomUUID()}.jpg`; ... await s3.write(key, processed); ... await db.update(userTable).set({ image: url })
- **Fix proposto:** Wrap the read of current.image and the user.image update in a transaction with a row lock (SELECT ... FOR UPDATE on the user row), or accept the orphaning and add a periodic S3 GC for unreferenced users/<id>/* keys. For a single-user avatar this is low risk; document it as accepted if intentional.
- **Verifica (confirmed):** The code at apps/api/src/modules/me/services/avatar.ts exactly matches the cited evidence. The race condition is real and triggerable:

1. Line 30-33: `db.query.user.findFirst` reads `current.image` with no row lock or transaction boundary.
2. Line 46-48: A new UUID S3 key is written unconditionally.
3. Lines 50-54: `user.image` is updated with the new URL (last writer wins in a race).
4. Lines 62-77: Only the OLD key read at step 1 is deleted (fire-and-forget).

In a concurrent scenario: both requests read the same `current.image` (e.g., `old_key`), both write new S3 objects (`key_A`, `key_B`), the last DB update wins (say `key_B`), and both delete `old_key`. The losing upload's freshly-written object (`key_A`) is now orphaned — it is not referenced in the DB and nothing will ever delete it.

The route at apps/api/src/modules/me/routes/avatar.ts adds no serialization guard, mutex, or rate-limiting. There is no transaction wrapping the read + write + update sequence anywhere in the call chain.

The described impact (orphaned S3 object, no broken DB reference) is correct. Severity "low" is appropriate: the app is not yet deployed, concurrent avatar uploads for the same user are rare, and the consequence is only wasted storage rather than data loss or a security issue.

#### 🟡 [low/bug] Env validation reports wrong key name for nested/array paths · verifica: **refuted**

- **Dove:** `apps/api/src/lib/env.ts:29`
- **Confidence:** high
- **Descrizione:** The missing-var message uses e.path.replace("/", "") which only removes the FIRST slash. For the current flat EnvSchema all paths are top-level (e.g. /DATABASE_URL) so it works, but it is fragile: any future nested env structure, or a leading-empty path, would produce a misleading variable name in the fatal startup error. String.replace with a string argument replaces only the first occurrence.
- **Evidenza:** const missing = errors.map((e) => e.path.replace("/", "")).join(", ");
- **Fix proposto:** Use e.path.replaceAll("/", ".") or e.path.split("/").filter(Boolean).join(".") so multi-segment paths are rendered correctly; or strip only a single leading slash with e.path.replace(/^\//, "").
- **Verifica (refuted):** The cited code at line 29 is real and the JavaScript behavior described is accurate: `String.prototype.replace` with a string argument does replace only the first occurrence. However, the claim itself admits this works correctly for the current schema ("for the current flat EnvSchema all paths are top-level so it works"). The EnvSchema (lines 4-25) is a completely flat `t.Object` with 19 top-level string keys — no nested objects, no arrays, no sub-schemas. Every TypeBox error path will be of the form `/KEY_NAME` (single leading slash, no further slashes). Removing that one slash with `.replace("/", "")` produces the correct key name in every currently possible case. The bug is not triggerable today and there is no indication the schema will be nested — env var schemas are almost universally flat. This is a hypothetical future-fragility observation, not an actual bug. Severity "low" is even generous for something that cannot be triggered by the existing code. The claim should be rated as a style/defensive-coding note, not a bug.

#### 🟡 [low/reliability] publicUrl / extractOurKey break if S3_ENDPOINT has a trailing slash · verifica: **confirmed**

- **Dove:** `apps/api/src/lib/s3.ts:83`
- **Confidence:** medium
- **Descrizione:** publicUrl builds `${endpoint}/${bucket}/${key}` with no normalization. If S3_ENDPOINT is configured with a trailing slash (a common .env mistake), stored URLs contain a double slash (endpoint//bucket/key). extractOurKey in avatar.ts builds the same prefix the same way, so round-trips remain internally consistent, but the externally served URL is malformed and some S3-compatible gateways will 404 on the doubled slash.
- **Evidenza:** export function publicUrl(key: string) { return `${endpoint}/${bucket}/${key}`; }  // avatar.ts: const expectedPrefix = `${env.S3_ENDPOINT}/${env.S3_BUCKET}/`;
- **Fix proposto:** Normalize the endpoint once at module load: const endpoint = env.S3_ENDPOINT.replace(/\/+$/, ""); and reuse it in both s3.ts and the key-extraction logic, or validate the env value rejects trailing slashes.
- **Verifica (confirmed):** The code at s3.ts:11 reads `const endpoint = env.S3_ENDPOINT` with no normalization, and line 84 builds `${endpoint}/${bucket}/${key}`. The env schema (env.ts:11) validates S3_ENDPOINT only as `t.String()` — no pattern or trailing-slash rejection. So if `.env` contains `S3_ENDPOINT=http://minio:9000/`, `publicUrl` emits `http://minio:9000//bibs/users/...`.

avatar.ts:20 builds `const expectedPrefix = \`${env.S3_ENDPOINT}/${env.S3_BUCKET}/\`` directly from env, not from `publicUrl`. Because both paths read the raw env value, they remain internally consistent: a stored URL with `//` matches the prefix with `//`, so `extractOurKey` still recovers the key correctly — the reviewer is right that round-trips are consistent.

The actual defect is the externally served URL containing a double slash (`endpoint//bucket/key`), which is sent to the browser and stored in the DB. Whether this causes a 404 depends on the gateway (MinIO is permissive; other S3-compatible servers may not be). There is no existing guard — no env validation, no normalization at module load, no runtime check.

The memory note about `extractOurKey` ("non aggiungere branch difensivi all'impl per accomodare un mock irrealistico") addresses test-mock realism, not the trailing-slash issue, so it does not constitute a house rule that refutes this claim.

Severity low is appropriate: the bug requires a misconfiguration to trigger and has no impact unless someone puts a trailing slash in S3_ENDPOINT. The proposed fix (strip trailing slash once at module load in s3.ts and ensure avatar.ts uses the normalized value via `publicUrl`'s `endpoint` constant rather than re-reading `env.S3_ENDPOINT` directly) would fully address it.

#### 🟡 [low/consistency] Stripe secret required at startup even in environments that don't use billing

- **Dove:** `apps/api/src/lib/env.ts:22`
- **Confidence:** medium
- **Descrizione:** STRIPE_SECRET_KEY is marked required (t.String) while STRIPE_WEBHOOK_SECRET and STRIPE_DEV_PRICE_ID are optional. The process exits at startup if STRIPE_SECRET_KEY is absent, which forces every developer/CI run (including ones touching only locations or categories) to provision a Stripe key. Given the rest of the Stripe config is optional, this hard requirement is inconsistent and raises the barrier for non-billing work.
- **Evidenza:** STRIPE_SECRET_KEY: t.String(), ... STRIPE_WEBHOOK_SECRET: t.Optional(t.String()), STRIPE_DEV_PRICE_ID: t.Optional(t.String()),
- **Fix proposto:** Either make STRIPE_SECRET_KEY optional and fail lazily when the billing module is actually exercised, or document that a (test-mode) Stripe key is a hard prerequisite for booting the API.

#### 🟡 [low/security] pino redact only matches top-level keys, not nested log payloads

- **Dove:** `apps/api/src/lib/logger.ts:21`
- **Confidence:** medium
- **Descrizione:** The redact list uses bare key names (password, token, apiKey, secret, authorization). pino redaction is path-based: bare names match only top-level properties of the logged object. Secrets nested inside structured log objects (e.g. logger.info({ req: { headers: { authorization } } })) or inside arrays are NOT redacted. Current call sites in this subsystem only log userId/key, so there's no active leak, but the redaction is weaker than it appears and won't protect future structured logging.
- **Evidenza:** redact: ["password", "token", "apiKey", "secret", "authorization"],
- **Fix proposto:** Use wildcard paths to also catch nested occurrences, e.g. redact: ["*.password", "*.token", "*.authorization", "req.headers.authorization", "password", "token", "authorization", "secret", "apiKey"] (or pino's "*" depth syntax), matching the actual shapes you log.

### `api-migrations` — 3 finding

> The migration set is generally well-constructed: the 13 migrations are correctly ordered with a consistent journal, FK on-delete behavior is deliberate (cascade for ownership, restrict for orders/subscriptions, set null for soft references), partial unique indexes for single-default/idempotency/pending-state are correct and match the runtime queries, the GIN tsvector and pg_trgm search indexes are sound, and the 0004 snapshot backfill follows a safe nullable-then-SET-NOT-NULL pattern. The one substantive issue is a real schema/migration drift on the PostGIS geometry columns: the live schema declares srid 4326 but every migration (and the latest snapshot) still produces SRID-0 `geometry(point)`, leaving the `::geography` geo-search casts unprotected against non-SRID inserts and leaving a pending un-generated migration. Two minor items (NOT NULL column adds without backfill in 0011, and a couple of unindexed set-null FKs) round out the findings.

#### 🟠 [medium/bug] Geometry columns drift from schema: migrations create geometry(point) with no SRID, schema declares srid 4326 · verifica: **refuted**

- **Dove:** `apps/api/src/db/migrations/0000_init.sql:12`
- **Confidence:** high
- **Descrizione:** Migration 0000 creates `location geometry(point)` (an unconstrained geometry with SRID 0) for both customer_addresses (line 12) and stores (line 296). The current Drizzle schema, however, declares these columns as `geometry("location", { type: "point", mode: "xy", srid: 4326 })` (store.ts:37, address.ts:31). No later migration ever applies the SRID. The drizzle snapshot confirms the drift: even the latest meta/0012_snapshot.json still records `type: "geometry(point)"` for both columns, meaning the schema was edited to add `srid: 4326` AFTER snapshots were generated and `db:generate` was never re-run. Consequences: (1) running `bun run db:generate` will produce an unreviewed pending migration `ALTER COLUMN location TYPE geometry(Point,4326)`; (2) the migrated column type does NOT constrain SRID, so any insert that does not explicitly set SRID 4326 stores an SRID-0 point, and the geo-search query in customer/services/search.ts casts `store.location::geography` (search.ts:62,78) which raises a PostGIS error for SRID-0 geometries (geography requires 4326). Seeded rows happen to work because Drizzle's xy/4326 insert expression embeds SRID 4326, but the column itself provides no guarantee.
- **Evidenza:** 0000_init.sql:12 `"location" geometry(point),` and 0000_init.sql:296 same; vs store.ts:37 `geometry("location", { type: "point", mode: "xy", srid: 4326 })`. meta/0012_snapshot.json still records `geometry(point)` for stores.location and customer_addresses.location.
- **Fix proposto:** Run `bun run db:generate` to produce the pending `ALTER COLUMN ... TYPE geometry(Point,4326)` migration, review the generated SQL, and apply it via `db:migrate` so the column type matches the schema and constrains SRID 4326. This makes the `::geography` casts in search.ts safe for all inserts, not just seeded ones.
- **Verifica (refuted):** The factual evidence is accurate: 0000_init.sql lines 12 and 296 create `geometry(point)` without SRID; store.ts:37 and address.ts:31 declare `srid: 4326`; no migration between 0001 and 0012 alters these columns; and 0012_snapshot.json still records `"type": "geometry(point)"` for both columns. The ::geography casts in search.ts lines 62 and 78 are also present as cited.

However, the claim is refuted under House Rule #1: bibs is in active development and not deployed to production. The entire proposed fix is "run db:generate + db:migrate to produce an ALTER COLUMN migration" — which is precisely the class of finding House Rule #1 explicitly excludes ("do NOT flag 'this requires a migration'").

Moreover, the runtime consequence described is not an actual present bug: the reviewer themselves acknowledges that "seeded rows happen to work because Drizzle's xy/4326 insert expression embeds SRID 4326." Drizzle's geometry column with `srid: 4326` and `mode: 'xy'` always injects `ST_SetSRID(ST_MakePoint(...), 4326)` on insert, meaning all application-layer writes via Drizzle are correct. The ::geography cast in search.ts only fails for geometries stored with SRID 0, which cannot happen through the ORM. There is no code path in the codebase that performs raw SQL geometry inserts bypassing Drizzle's SRID injection. The drift between DB column type and schema declaration is a Drizzle-snapshot hygiene issue (db:generate not re-run after adding srid:4326 to the schema), not a triggerable runtime error in the current application code.

#### 🟡 [low/reliability] 0011 adds NOT NULL municipality_id columns with no DEFAULT and no backfill · verifica: **refuted**

- **Dove:** `apps/api/src/db/migrations/0011_cute_slyde.sql:12`
- **Confidence:** high
- **Descrizione:** Migration 0011 drops `city`/`province` and adds `municipality_id text NOT NULL` to organizations (line 12), stores (line 13) and customer_addresses (line 14) with no DEFAULT and no backfill UPDATE. `ALTER TABLE ... ADD COLUMN ... NOT NULL` with no default fails if the table contains any rows. This is inconsistent with the careful pattern used in migration 0004 (add column nullable -> backfill -> SET NOT NULL, see 0004 lines 16-42). Under house rule 1 (dev, not deployed, schema changes free) the practical impact is limited to a non-empty local DB, but the migration is not safely re-runnable against existing data and diverges from the established backfill convention.
- **Evidenza:** 0011_cute_slyde.sql:12 `ALTER TABLE "organizations" ADD COLUMN "municipality_id" text NOT NULL;` (no DEFAULT, no preceding backfill). Contrast 0004 lines 15-42 which add nullable, backfill, then SET NOT NULL.
- **Fix proposto:** If these tables can ever hold data when the migration runs, follow the 0004 pattern: add the column nullable, backfill municipality_id (e.g. map old city/province strings to municipalities.id), then `ALTER COLUMN ... SET NOT NULL`. Otherwise document that 0011 is intended for an empty dataset.
- **Verifica (refuted):** The cited evidence is factually wrong. `0011_cute_slyde.sql` is only 6 lines long and contains nothing about `municipality_id` — it only handles an onboarding_status UPDATE and adds a `stripe_customer_id` column. There is no line 12 in that file.

The actual migration with `ALTER TABLE "organizations" ADD COLUMN "municipality_id" text NOT NULL` (no DEFAULT, no backfill) is `0012_municipality_fk.sql` (lines 12-14), not `0011_cute_slyde.sql`.

Beyond the wrong file citation, the substantive pattern concern is covered by house rule 1: bibs is in active development and not deployed to production; DB schema changes are explicitly free. The reviewer themselves acknowledges this ("Under house rule 1 the practical impact is limited to a non-empty local DB") yet still files the claim as confirmed. Per the instructions, a claim that merely flags something covered by a house rule is refuted. The "backfill convention" observed in `0004` is a best-effort dev-time comment, not a hard project rule, and the house rules explicitly preclude penalizing migration patterns in a non-deployed codebase.

#### 🟡 [low/performance] orders.shipping_address_id FK (ON DELETE set null) has no supporting index

- **Dove:** `apps/api/src/db/migrations/0000_init.sql:343`
- **Confidence:** high
- **Descrizione:** The FK `orders_shipping_address_id_customer_addresses_id_fk` is declared ON DELETE set null but `orders.shipping_address_id` is not indexed (orders has composite indexes on customer_profile_id/created_at, store_id/created_at, status, type/status, but none leading with shipping_address_id). When a customer_address row is deleted, Postgres must seq-scan orders to find referencing rows to null out. Most other FK columns in this schema do get a dedicated btree index (e.g. order_item_order_id_idx, payment_method_seller_profile_id_idx), so this is an inconsistency as well as a potential slow path on address deletion.
- **Evidenza:** 0000_init.sql:343 declares the set-null FK; no `CREATE INDEX ... shipping_address_id` exists anywhere in the migrations (grep confirms only the column + FK definitions reference shipping_address_id).
- **Fix proposto:** Add `index("order_shipping_address_id_idx").on(table.shippingAddressId)` to the order schema and generate the migration. Same consideration applies to seller_profile_changes.reviewed_by and pricing_config.created_by_user_id (both set-null FKs without an index), though those are lower-traffic.

### `fe-seller-products` — 8 finding

> The subsystem is well-structured and largely correct: authorization is enforced server-side (ownership scoping via sellerProfileId + accessibleStoreIds on every route), optimistic cache patching is consistent, and the stock stepper's debounce/unmount-flush handling is thoughtful. The main concrete defects are a memory leak from un-revoked object URLs in the image dropzone, dead/ineffective price-coercion logic in the form that is actually shadowed by a strict validator (breaking integer/single-decimal price entry UX), and a couple of unvalidated-input edge cases (NaN page param, negative initial stock). The remaining items are consistency/quality improvements. Nothing rises to critical/security.

#### 🟠 [medium/reliability] Object URL created on every render without revoke (memory leak) · verifica: **confirmed**

- **Dove:** `apps/seller/src/features/products/components/product-image-dropzone.tsx:247`
- **Confidence:** high
- **Descrizione:** SortableImageItem computes its image src inline as `URL.createObjectURL(item.file)` for every new (local) file. This runs on every render of the component (drag, hover, reorder, parent re-render all trigger it), allocating a fresh blob URL each time and never calling URL.revokeObjectURL. The object URLs accumulate for the lifetime of the document, leaking memory — worse while dragging, where re-renders are frequent. With up to 10 images each up to 5 MB, this can pin significant memory.
- **Evidenza:** const src =
	item.type === "existing" ? item.url : URL.createObjectURL(item.file);
- **Fix proposto:** Create the object URL once per File and revoke it on cleanup, e.g. in a useEffect (or useMemo keyed on item.file) that returns `() => URL.revokeObjectURL(url)`, or build a stable map of File->url at the dropzone level with revocation when a file is removed/unmounted.
- **Verifica (confirmed):** Line 247 of /Users/marcogelli/repos/jelaz/bibs/apps/seller/src/features/products/components/product-image-dropzone.tsx contains exactly the cited code: `const src = item.type === "existing" ? item.url : URL.createObjectURL(item.file);` executing unconditionally in the render body of the `SortableImageItem` function component. There are no hooks (useMemo, useRef, useEffect) wrapping this call, and no `URL.revokeObjectURL` anywhere in the file. Every render of `SortableImageItem` allocates a fresh blob URL that is never freed. The parent uses `@dnd-kit/core` DnD which triggers re-renders during drag interactions (the `isDragging` and `transform` values from `useSortable` change on pointer move), making the leak especially active during drags. The parent's WeakMap-based file ID stabilization (lines 61-70) correctly prevents new `ImageItem` objects from being created unnecessarily, but `SortableImageItem` does not use that stability — it calls `URL.createObjectURL` on every render regardless. The issue is real and triggerable as described. Severity medium is appropriate (memory leak, not a crash or data loss).

#### 🟠 [medium/bug] Price normalization logic is dead code; strict validator blocks integer/single-decimal prices · verifica: **confirmed**

- **Dove:** `apps/seller/src/features/products/components/product-form.tsx:211`
- **Confidence:** high
- **Descrizione:** onFormSubmit runs only after typeboxResolver(compiledSchema) passes. The price field is validated against CreateProductBody.price pattern `^\d+\.\d{2}$` (exactly two decimals). So by the time onFormSubmit executes, data.price already matches `\d+\.\d{2}`, making the includes('.')/replace/padEnd coercion a no-op. The code clearly intends to accept inputs like `9` or `9.9` and pad them to `9.00`/`9.90`, but the resolver rejects those values first, so a seller who types `9` or `9.9` in the number input gets a validation error and cannot submit — the padding never helps. The input is type=number step=0.01, which commonly yields strings without two decimals.
- **Evidenza:** const price = data.price.includes(".")
	? data.price
			.replace(/^(\d+\.\d{0,2}).*$/, "$1")
			.padEnd(data.price.indexOf(".") + 3, "0")
	: `${data.price}.00`;
- **Fix proposto:** Either relax the form-level price schema to accept 0-2 decimals (e.g. `^\d+(\.\d{1,2})?$`) and keep the padding to normalize to 2 decimals before submit, or do the normalization in onChange/onBlur so the value matching the strict pattern is produced before validation. Remove the unused branch once decided.
- **Verifica (confirmed):** The claim is accurate. At /Users/marcogelli/repos/jelaz/bibs/apps/api/src/lib/schemas/forms/products.ts line 17, the price field has pattern `"^\\d+\\.\\d{2}$"` — exactly two decimal places required. The form at product-form.tsx line 80 uses `typeboxResolver(compiledSchema)` where `compiledSchema = TypeCompiler.Compile(CreateProductFormBody)` and `CreateProductFormBody = Type.Omit(CreateProductBody, ["storeId"])` — the price pattern is fully inherited. Since react-hook-form's resolver runs before the `SubmitHandler` is invoked, any input that does not already match `^\d+\.\d{2}$` causes a validation error and `onFormSubmit` is never called. The padding/normalization code at lines 212-216 (which handles `9` → `9.00` and `9.9` → `9.90`) is therefore dead code — the resolver rejects those values before the code can execute. The `type="number" step="0.01"` input commonly produces values without trailing zeros (browser-dependent), so sellers typing `9` or `9.9` will get a validation error and be unable to submit. The bug is real and triggerable as described. Severity medium is appropriate — it is a usability/UX defect that blocks valid price inputs but does not cause data corruption or security issues.

#### 🟡 [low/bug] validateSearch produces NaN for non-numeric page/limit · verifica: **confirmed**

- **Dove:** `apps/seller/src/routes/_authenticated/products/index.tsx:100`
- **Confidence:** high
- **Descrizione:** page/limit are coerced with `Number(search.page ?? 1)` / `Number(search.limit ?? 20)` with no NaN or range guard. A hand-crafted/stale URL like `?page=abc` yields NaN, which then flows into the API query and into the pagination display math (`(page - 1) * limit + 1`, `Math.ceil(total / limit)`), rendering `NaN–NaN di N` and sending an invalid page to the backend. Unlike the other search params (q, sort, order, categoryIds, prices) which are all defensively normalized, page/limit are not.
- **Evidenza:** page: Number(search.page ?? 1),
limit: Number(search.limit ?? 20),
- **Fix proposto:** Guard with a clamp helper, e.g. `const page = Math.max(1, Math.trunc(Number(search.page)) || 1)` and `const limit = Math.min(100, Math.max(1, Math.trunc(Number(search.limit)) || 20))` so malformed values fall back to defaults and respect the 100 cap.
- **Verifica (confirmed):** The bug is real and the cited evidence is accurate. Lines 100-101 of /apps/seller/src/routes/_authenticated/products/index.tsx use `Number(search.page ?? 1)` and `Number(search.limit ?? 20)` with no NaN guard. A URL like `?page=abc` passes the `?? 1` check (since "abc" is truthy/not nullish), then `Number("abc")` yields NaN. This NaN flows into: (a) the API query at lines 200-201 where `page` and `limit` are sent directly to `api().seller.products.get()`; and (b) the pagination display math at lines 664-666 (`Math.ceil(total / limit)`, `(page - 1) * limit + 1`, `Math.min(page * limit, total)`) which all produce NaN, rendering `NaN–NaN di N prodotti`. All other search params — statusFilter, sort, order, categoryIds, minPrice, maxPrice — have explicit defensive guards (whitelist checks, regex tests, type checks), making the omission in page/limit the only unguarded path. TanStack Router's `validateSearch` receives raw `Record<string, unknown>` so no upstream coercion occurs. The severity is correctly assessed as low — it requires a deliberately malformed URL and is not a security issue, but the problem is genuine.

#### 🟡 [low/reliability] Store assignment initial-stock allows negative values that fail server-side · verifica: **confirmed**

- **Dove:** `apps/seller/src/features/products/components/store-assignment-dialog.tsx:46`
- **Confidence:** high
- **Descrizione:** The initial-stock input only has the HTML `min={0}` attribute (not enforced for typed/pasted values). On submit it does `Number.parseInt(initialStock, 10)` and sends it as-is (only NaN is coerced to 0). A negative value like -5 is sent to POST /products/:id/stores whose body schema is `stock: Number({ minimum: 0 })`, so the request fails validation and the user just sees a generic error toast instead of being prevented client-side. BulkStockAdjustDialog by contrast has an explicit valueValid guard.
- **Evidenza:** const stock = Number.parseInt(initialStock, 10);
...
stock: Number.isNaN(stock) ? 0 : stock,
- **Fix proposto:** Clamp to >= 0 client-side (e.g. `Math.max(0, Number.parseInt(...) || 0)`) and/or disable the confirm button when the parsed value is negative, mirroring the BulkStockAdjustDialog validation.
- **Verifica (confirmed):** The claim is accurate and verified against the actual code.

Frontend (apps/seller/src/features/products/components/store-assignment-dialog.tsx, lines 46-51): The mutation uses `Number.parseInt(initialStock, 10)` and only guards against NaN (`Number.isNaN(stock) ? 0 : stock`). There is no negative-value guard. The confirm button (line 138-143) is only disabled when `selected.size === 0 || assignMutation.isPending` — it remains enabled for any numeric value including negatives.

The input has `type="number"` and `min={0}` (line 125), but as the reviewer correctly notes, this HTML attribute does not prevent typed or pasted negative values from being sent.

API schema (apps/api/src/modules/seller/routes/stock.ts, lines 53-58): `stock: t.Optional(t.Number({ minimum: 0, ... }))`. Elysia/TypeBox enforces the minimum server-side, so a negative value results in a validation error (HTTP 422), which the frontend catches generically at line 53 (`if (response.error) throw new Error("Errore assegnazione")`) and shows only a generic error toast.

BulkStockAdjustDialog comparison (apps/seller/src/features/products/components/bulk-stock-adjust-dialog.tsx, lines 42-52): Confirmed — it defines `valueValid` checking `parsed >= 0 && parsed <= 100000` for "set" mode, and disables the confirm button with `disabled={!valueValid || mutation.isPending}`.

The issue is real and triggerable: a user can type -5 in the initial-stock field, the button stays enabled, the request is sent, and the server rejects it with a validation error that maps to a generic error toast. Severity "low" is correct — no data corruption, no security issue, just degraded UX.

#### 🟡 [low/reliability] set-stock commit can race with an in-flight adjust on stale stock prop · verifica: **confirmed**

- **Dove:** `apps/seller/src/features/products/components/stock-editor-cell.tsx:98`
- **Confidence:** medium
- **Descrizione:** commitSet computes the absolute value the user typed against `optimistic = stock + pendingDelta`. If a debounced adjust mutation is already in flight (so the server stock has not yet been reflected into the `stock` prop) and the user immediately types a number and blurs, the typed value is treated as absolute and sent via set.mutate while pendingDelta is reset to 0 and the timer cleared. The two mutations (in-flight delta adjust + absolute set) can land in an indeterminate order; the optimistic value the user compared against may be based on a stale `stock`. The window is narrow (requires interaction within the 500ms debounce while a request is in flight) and the server is the source of truth, so impact is limited to a brief incorrect optimistic display.
- **Evidenza:** const parsed = Number.parseInt(editValue, 10);
...
if (parsed === optimistic) { setEditValue(String(optimistic)); return; }
...
set.mutate({ productId, storeId, stock: parsed }, ...)
- **Fix proposto:** Disable input/commit while adjust.isPending (the input is already disabled via `busy`, but blur can still fire commitSet on a focused field before disable applies); alternatively flush any pending delta synchronously before issuing the set, or gate commitSet on !adjust.isPending.
- **Verifica (confirmed):** The race condition is real and reachable. Key evidence from the file:

1. `busy = adjust.isPending || set.isPending` (line 132), and the input is `disabled={busy}` (line 174).
2. When `busy` transitions from false to true (the adjust request fires after the 500ms debounce), browsers will fire a `blur` event on a currently-focused input element that becomes `disabled`. This triggers the `onBlur` handler at line 161-164 which calls `commitSet()`.
3. `commitSet()` (line 98) does NOT check `adjust.isPending`. It reads `editValue`, computes `parsed`, compares against `optimistic = stock + pendingDelta`, then clears the timer, resets `pendingDelta` to 0, and calls `set.mutate` with the absolute value — all without gating on whether an adjust mutation is already in flight.
4. The scenario requires: user focuses input → types a value → debounce timer fires in background → `adjust.mutate` starts → input gets disabled → blur fires → `commitSet` fires with the typed value alongside the in-flight adjust. Both mutations are now in-flight simultaneously with indeterminate server-side ordering.
5. The early-return guard at lines 107-110 (`parsed === optimistic`) would only save the case where the user typed the same value they see — it does not guard against `adjust.isPending`.
6. The claim's characterization is accurate: the window is narrow (requires the debounce to fire while the input is focused with a modified value), impact is limited to a brief incorrect optimistic display since the server is source of truth. Severity low is appropriate.

#### 🟡 [low/consistency] Bulk status / delete mutations don't invalidate categories-in-use

- **Dove:** `apps/seller/src/features/products/hooks/use-product-mutations.ts:33`
- **Confidence:** medium
- **Descrizione:** invalidateAll() invalidates ["products"] and ["product-status-counts"] but not ["seller-categories-in-use"]. After trashing/deleting the last products in a category (or restoring products in a previously-empty category), the category filter sheet (fed by useSellerCategoriesInUse) shows stale options until its 60s staleTime elapses or a manual refetch. Single-row setStatus has the same gap.
- **Evidenza:** function invalidateAll() {
	void queryClient.invalidateQueries({ queryKey: ["products"] });
	void queryClient.invalidateQueries({ queryKey: ["product-status-counts"] });
}
- **Fix proposto:** Add `void queryClient.invalidateQueries({ queryKey: ["seller-categories-in-use"] })` to invalidateAll() so the category filter reflects catalog changes.

#### 🟡 [low/dead-code] Unused activeStoreId parameter in useProductMutations

- **Dove:** `apps/seller/src/features/products/hooks/use-product-mutations.ts:124`
- **Confidence:** high
- **Descrizione:** useProductMutations accepts activeStoreId but never uses it; the body ends with `void activeStoreId;` purely to silence the unused-parameter lint. Every caller (ProductBulkToolbar, ProductRowActions, ConfirmPermanentDeleteDialog) threads activeStoreId down only to feed this no-op hook param. This is dead parameter plumbing that adds noise and a false impression that store scoping happens here (it does not — the API scopes by accessible stores server-side).
- **Evidenza:** export function useProductMutations(activeStoreId: string | undefined) {
...
	void activeStoreId;
	return { setStatus, bulkSetStatus, bulkDeletePermanent };
- **Fix proposto:** Drop the activeStoreId parameter from useProductMutations and remove the corresponding props threaded through ProductBulkToolbar/ProductRowActions/ConfirmPermanentDeleteDialog where they exist only for this purpose.

#### 🟡 [low/improvement] Reorder of new files also re-emits existing-image order unnecessarily

- **Dove:** `apps/seller/src/features/products/components/product-image-dropzone.tsx:164`
- **Confidence:** medium
- **Descrizione:** handleDragEnd always calls both onReorderExisting and onReorderFiles after any drag, even when only new local files were rearranged and the existing-image order is unchanged. In the edit route onReorderExisting={setImageOrder}, so dragging two new files toggles imageOrder from undefined to a populated array, which flips the submit button's enabled state and causes the PATCH to send an imageOrder payload that re-asserts the same order. Functionally harmless but causes a needless server write and dirty-state churn.
- **Evidenza:** onReorderExisting?.(newExisting.map((img) => img.id));
onReorderFiles(newFiles.map((f) => f.file));
- **Fix proposto:** Only invoke onReorderExisting when the existing subsequence actually changed (e.g. compare newExisting ids to the previous existing order) and likewise gate onReorderFiles, so each callback fires only for the list that moved.

### `fe-seller-promo-stores-team` — 12 finding

> The subsystem is generally well-structured: clear separation of routes/components/hooks, consistent Eden+TanStack Query usage, optimistic updates with rollback in the product selector, and good i18n/convention adherence. The main weaknesses are stale local state on store switch (the store settings page does not reset when the active store changes), opening-hours edits not marking the form dirty (so they can't be saved alone), the team table re-rendering the owner row and all invitations on every page, and a couple of robustness gaps (NaN search params, unhandled promise rejection on invite cancel, 100-product cap in the selector). No security/authorization holes were found on the FE; ownership scoping lives server-side and is respected.

#### 🔴 [high/bug] Store settings page shows stale data after switching the active store · verifica: **confirmed**

- **Dove:** `apps/seller/src/routes/_authenticated/store/index.tsx:65`
- **Confidence:** high
- **Descrizione:** The page initializes existingImages once via a one-shot `imagesInitialized` flag and feeds StoreForm via `defaultValues`. Switching the active store through StoreSwitcher calls setActiveStoreId() which only mutates context state — it does NOT navigate, so StoreSettingsPage and StoreForm stay mounted. The `['store', storeId]` query refetches the new store, but `imagesInitialized` is never reset and StoreForm has no `key`, so RHF keeps the previous store's name/address/opening-hours and the dropzone keeps the previous store's images. The seller can then submit edits against the new storeId using the old store's data.
- **Evidenza:** if (store && !imagesInitialized) {
		setExistingImages((store.images ?? []).map((img) => ({ id: img.id, url: img.url })));
		setImagesInitialized(true);
	}  // never re-runs when storeId changes; StoreForm has no key
- **Fix proposto:** Key the form/dropzone subtree on storeId (e.g. `<StoreForm key={storeId} ... />` and reset existingImages/newFiles when storeId changes), or reset imagesInitialized in a useEffect keyed on storeId so all local state re-derives for the newly selected store.
- **Verifica (confirmed):** The bug is real and triggerable exactly as described.

1. **imagesInitialized never resets on storeId change**: In `/apps/seller/src/routes/_authenticated/store/index.tsx` lines 65-70, the pattern `if (store && !imagesInitialized) { setExistingImages(...); setImagesInitialized(true); }` runs inline during render. When `storeId` changes (via `setActiveStoreId`), a new query fires for `["store", newStoreId]`, but `imagesInitialized` remains `true` from the previous store. So the new store's images never populate `existingImages`. The dropzone keeps showing the old store's images.

2. **No key on StoreForm**: At line 198, `<StoreForm defaultValues={{...}} ... />` has no `key` prop. React-Hook-Form initializes its internal state once from `defaultValues` at mount time (line 100-110 of store-form.tsx: `useForm({ defaultValues: { ...defaultValues } })`). Since the component is never unmounted/remounted when `storeId` changes (it's on the same route that stays mounted — `setActiveStoreId` only mutates context state, no navigation occurs per `store-switcher.tsx` line 110 which calls `setActiveStoreId(store.id)` with no router navigation), RHF's fields (name, description, address, openingHours, phoneNumbers) retain the previous store's values.

3. **openingHours local state also stale**: `StoreForm` also has its own `useState` for `openingHours` (store-form.tsx line 83-90) initialized once from `defaultValues?.openingHours`. This also will not reset without a remount.

4. **StoreSwitcher confirms no navigation**: In `store-switcher.tsx` line 110, clicking a store calls `setActiveStoreId(store.id)` — a pure context mutation with no `useNavigate()` or `<Link>` navigation. The route `/store/` stays mounted.

5. **Submit would use wrong storeId with old form data**: The `updateMutation` at line 89-108 uses `storeId` from the current context (which IS correctly updated), but the form data submitted is the stale RHF state from the previously-loaded store. This means edits from store A could be submitted as if they were edits for store B.

The severity is correctly classified as high — a seller with multiple stores can silently overwrite one store's data with another store's values.

#### 🔴 [high/bug] Opening-hours-only edits cannot be saved (submit stays disabled) · verifica: **confirmed**

- **Dove:** `apps/seller/src/features/stores/components/store-form.tsx:348`
- **Confidence:** high
- **Descrizione:** openingHours is held in a separate useState and passed to OpeningHoursEditor; it is NOT a react-hook-form field. The submit button is disabled with `disabled={isPending || !isDirty}`, where isDirty only tracks RHF-registered fields (name, address, phoneNumbers, etc.). If a seller edits only opening hours (toggle a day, change a slot, add/remove a slot) and touches no RHF field, isDirty stays false and the Save button remains disabled — the change cannot be persisted.
- **Evidenza:** const [openingHours, setOpeningHours] = useState<DaySchedule[]>(...)
...
<Button type="submit" disabled={isPending || !isDirty}>
- **Fix proposto:** Track opening-hours dirtiness explicitly (compare against the initial value) and OR it into the submit-disabled condition, or move openingHours into RHF via a Controller so isDirty reflects it.
- **Verifica (confirmed):** The file at apps/seller/src/features/stores/components/store-form.tsx confirms the bug exactly as described.

Line 83-90: openingHours is held in a separate useState initialized from defaultValues, not registered with react-hook-form.

Line 97: isDirty comes exclusively from RHF's formState, which only tracks the RHF-registered fields (name, description, addressLine1, addressLine2, municipalityId, zipCode, websiteUrl, phoneNumbers).

Lines 254-258: OpeningHoursEditor receives the useState value and setter directly — there is no Controller, no register, no RHF connection at all.

Line 348: The submit button is disabled={isPending || !isDirty}. There is no compensating openingHoursDirty flag, no comparison of openingHours against the initial value, and no OR condition that would account for opening-hours-only edits.

Result: if a seller edits only the opening hours (toggles a day, changes a slot, adds/removes a slot) without touching any RHF-registered field, isDirty stays false and the Save button remains permanently disabled, making the opening-hours-only edit impossible to persist. The bug is real and directly triggerable.

#### 🟠 [medium/bug] Team table repeats the owner row and all pending invitations on every page · verifica: **confirmed**

- **Dove:** `apps/seller/src/routes/_authenticated/team/index.tsx:549`
- **Confidence:** high
- **Descrizione:** The employees endpoint returns `owner` and a paginated `data` plus `pagination.total` that counts employees only. The rows builder always prepends the owner row and appends ALL pending invitations regardless of page. On page 2+ the owner and every pending invitation re-appear at the top, and the appended rows can exceed `limit`. totalPages is derived from employee total only, so the displayed counts and the visible row set are inconsistent across pages.
- **Evidenza:** if (owner) { out.push({ kind: 'owner', ... }); }
for (const e of data?.data ?? []) { out.push({ kind: 'employee', ... }); }
if (isOwner) { for (const inv of pendingInvitations) out.push({ kind: 'invitation', ... }); }
- **Fix proposto:** Only inject the owner row and invitations on page 1 (e.g. `if (page === 1 && owner)` / `if (page === 1 && isOwner)`), or fold them into the server pagination total. Given small teams, gating on page === 1 is the simplest correct fix.
- **Verifica (confirmed):** The bug is real and directly verified. At lines 549-577 of /Users/marcogelli/repos/jelaz/bibs/apps/seller/src/routes/_authenticated/team/index.tsx, the `rows` useMemo unconditionally prepends the owner row (`if (owner) { out.push(...) }`) and appends all pending invitations (`if (isOwner) { for (const inv of pendingInvitations) out.push(...) }`) with no check on the current page number. The `page` variable (line 528) is not in the dependency array (line 577) and is not referenced inside the memo at all. On page 2+, this causes both the owner row and every pending invitation to re-appear at the top/bottom of the table. Meanwhile, `totalPages` (lines 543-545) is computed purely from `data.pagination.total`, which the API returns as an employee-only count, so the displayed page count and the actual visible row set are inconsistent. The cited evidence (`if (owner)`, `for (const e of data?.data ?? [])`, `if (isOwner) { for (const inv of pendingInvitations)`) matches exactly what is in the file. No existing guard prevents this. The severity "medium" is appropriate since this is a display-only inconsistency in a non-deployed app (no data loss), but it's a real functional bug on any team with more employees than the page limit.

#### 🟠 [medium/reliability] Unhandled promise rejection (and no error toast) when cancelling an invitation · verifica: **confirmed**

- **Dove:** `apps/seller/src/routes/_authenticated/team/index.tsx:744`
- **Confidence:** high
- **Descrizione:** The invitation-cancel action calls `void cancelMutation.mutateAsync(...)`. useCancelInvitation has no onError handler, and mutationFn throws on API error. The returned promise is discarded with `void`, so a failure surfaces as an unhandled promise rejection with no user feedback (no toast). Every other destructive action in this file either uses .mutate (errors handled internally) or wraps mutateAsync in try/catch.
- **Evidenza:** onClick={() => void cancelMutation.mutateAsync(r.invitation.id)}
- **Fix proposto:** Switch to `cancelMutation.mutate(r.invitation.id)` and add an onError toast in useCancelInvitation, or wrap the mutateAsync call in try/catch with toast.error.
- **Verifica (confirmed):** Line 744 of /Users/marcogelli/repos/jelaz/bibs/apps/seller/src/routes/_authenticated/team/index.tsx confirms the exact cited code: `onClick={() => void cancelMutation.mutateAsync(r.invitation.id)}`. The `useCancelInvitation` hook (lines 123-144) has a `mutationFn` that explicitly throws `new Error(...)` when `response.error` is truthy, and it has only an `onSuccess` handler — no `onError` handler and no toast call anywhere. The `void` operator discards the rejected promise, so any API failure on invitation cancellation will produce an unhandled promise rejection with zero user feedback. This is real and triggerable whenever the DELETE invitations API call fails (network error, 4xx/5xx). The contrast with `inviteMutation.mutateAsync` (line 226, wrapped in try/catch) confirms this is inconsistent with the file's own patterns. The `handleConfirm` pattern (lines 377-383) also lacks a try/catch around the other mutateAsync calls, but those at least have an enclosing async function that surfaces the error as an unhandled rejection at a higher level — the cancel case is uniquely silent because it is fired directly from an inline onClick with void. Severity medium is accurate.

#### 🟠 [medium/bug] Product selector only ever sees the first 100 active products; server search/exclude unused · verifica: **confirmed**

- **Dove:** `apps/seller/src/features/promotions/components/product-selector.tsx:75`
- **Confidence:** high
- **Descrizione:** The library query hard-codes page 1 / limit 100 and filters by name purely client-side over the fetched rows. The products endpoint supports server-side text search (`q`) and `excludeDiscountId`, but neither is used. A seller with more than 100 active products cannot see, search, or add any product beyond the first 100 page — they are invisible in the 'Tutti' tab and unreachable by the search box.
- **Evidenza:** const res = await api().seller.products.get({ query: { page: 1, limit: 100, statusFilter: 'active', minPrice, maxPrice, inStock } });
... matchesQ = (row) => !q || row.name.toLowerCase().includes(q) // client-side only
- **Fix proposto:** Pass the debounced search as the server `q` param and paginate (or use the cap-100 loop pattern), so products beyond the first 100 are reachable. Optionally pass excludeDiscountId in mutate mode to avoid showing already-included rows in the 'all' view.
- **Verifica (confirmed):** The code at lines 75-91 confirms the claim exactly. The libraryQuery fetches with page: 1, limit: 100, statusFilter: 'active' and does NOT include debouncedSearch in either the query parameters or the queryKey (line 76: queryKey is ["product-selector", "library", minPrice, maxPrice, inStock]). The search is applied entirely client-side in the visibleRows memo (lines 170-208) over the at-most 100 rows already fetched. A seller with more than 100 active products will never see products 101+, and the search box only filters within those 100. Line 210 additionally reveals a UX inconsistency: totalAll reads from pagination.total (the real server count, e.g. 150) and is shown in the "Tutti" tab badge, making it appear more products exist than are actually reachable. The API does support a q parameter for server-side search but it is never passed. This is a real and triggerable bug for any seller with more than 100 active products. House rule 8 is not implicated — the claim does not flag the 100-item cap as the bug, but rather the absence of pagination looping and server-side search. Severity medium is appropriate: it only affects sellers with large catalogs (>100 active products), which may be uncommon in early dev, but is a correctness issue not a cosmetic one.

#### 🟡 [low/reliability] Non-numeric search params produce a 400 instead of defaulting · verifica: **confirmed**

- **Dove:** `apps/seller/src/routes/_authenticated/promotions/index.tsx:47`
- **Confidence:** high
- **Descrizione:** validateSearch coerces page/limit with `Number(search.page ?? 1)`. A malformed URL like `?page=abc` yields NaN, which Eden serializes to `page=NaN`; the API's TypeBox `t.Number` rejects it → 400 VALIDATION_ERROR and an error screen rather than a graceful default. Same pattern in the team route. Also limit is not clamped to the 100 cap, so `?limit=500` errors out.
- **Evidenza:** page: Number(search.page ?? 1),
limit: Number(search.limit ?? 20),
- **Fix proposto:** Guard with Number.isFinite and clamp, e.g. `const page = Number.isFinite(p = Number(search.page)) && p >= 1 ? p : 1;` and `limit = Math.min(100, Math.max(1, ...))`.
- **Verifica (confirmed):** The NaN path is real and triggerable as described.

Evidence:

1. `/apps/seller/src/routes/_authenticated/promotions/index.tsx` lines 47-48: `page: Number(search.page ?? 1)` and `limit: Number(search.limit ?? 20)`. The `??` only guards against `null`/`undefined`; `search.page = "abc"` passes the nullish check and `Number("abc")` = `NaN`.

2. `/apps/seller/src/routes/_authenticated/team/index.tsx` lines 63-65: identical pattern.

3. When `page: NaN` is passed to the Eden Treaty hook (`useDiscountsList` → `api().seller.discounts.get({ query: { page: NaN, ... } })`), Node.js URLSearchParams serializes NaN as the string `"NaN"` (verified with node -e). The request arrives at the API as `?page=NaN`.

4. `/apps/api/src/lib/schemas/discount.ts` line 75: `page: t.Optional(t.Number({ minimum: 1, default: 1 }))`. Elysia's TypeBox coercion does `Number("NaN")` = `NaN`, which then fails the TypeBox `minimum: 1` check (NaN fails all comparisons). Same in `/apps/api/src/lib/pagination.ts` for `PaginationQuery`. This produces a 422/400 VALIDATION_ERROR.

5. The `limit > 100 → 400` sub-claim is covered by House Rule 8 (the cap is intentional by design), so that part of the complaint is refuted. However, the title's core claim — non-numeric params produce a 400 instead of a graceful default — is confirmed for the NaN case.

Severity "low" is appropriate: the defect only triggers on manually-crafted or externally-provided malformed URLs, never through normal UI navigation (pagination controls always write integer values).

#### 🟡 [low/bug] Discount detail form/products do not reset when navigating between discounts · verifica: **confirmed**

- **Dove:** `apps/seller/src/routes/_authenticated/promotions/$discountId.tsx:120`
- **Confidence:** medium
- **Descrizione:** DiscountForm and ProductSelector receive discount-specific defaultValues/mode but have no `key={discountId}`. TanStack Router reuses the same component instance when only the route param changes, so navigating directly from one $discountId to another (e.g. browser history, or a same-route link) can leave RHF showing the previous discount's title/percent/dates until remount. The typical list->detail flow remounts, masking it.
- **Evidenza:** <DiscountForm defaultValues={{ title: d.title, percent: d.percent, ... }} ... />  // no key on param change
- **Fix proposto:** Add `key={discountId}` to the detail content (or to DiscountForm/ProductSelector) so the form state re-derives when the param changes.
- **Verifica (confirmed):** The bug is real. In `/apps/seller/src/features/promotions/components/discount-form.tsx` (lines 66-76), `useForm` is initialized with `defaultValues` from props but there is no `form.reset()` call or `useEffect` that reacts to prop changes. React Hook Form's `defaultValues` option is consumed only on component mount. In `$discountId.tsx` at line 120, `<DiscountForm defaultValues={{...}} />` has no `key` prop. TanStack Router reuses the same component instance when only `$discountId` changes in the URL, so the RHF internal state (title, percent, startsAt, endsAt, noEndDate) would remain from the previously-visited discount. The `useDiscount(discountId)` hook would correctly refetch for the new ID, and new `defaultValues` props would arrive, but RHF ignores them after mount. The same stale-state issue applies to `ProductSelector`'s local `useState` hooks (search, view, minPrice, maxPrice, inStock, productCache). The reviewer's note that list→detail flow masks it is accurate — that navigation unmounts/remounts the component. The severity "low" is appropriate: the bug requires direct same-route navigation between two discount detail pages (e.g., back/forward in browser history or a direct link), which is an uncommon path; it is a UX issue (stale displayed values) not a data-corruption risk, since the submit handler uses `discountId` from `Route.useParams()` not from the form.

#### 🟡 [low/reliability] Price filter inputs can produce server 400 with no inline feedback · verifica: **confirmed**

- **Dove:** `apps/seller/src/features/promotions/components/product-selector.tsx:389`
- **Confidence:** medium
- **Descrizione:** minPrice/maxPrice are raw <input type=number> strings passed straight to the API, which validates against `^\d+(\.\d{1,2})?$`. Values like '10.999', '-5', or scientific notation '1e3' fail the pattern and make the whole library query throw, breaking the selector with no targeted message (the catch just surfaces the generic error).
- **Evidenza:** minPrice: minPrice || undefined, maxPrice: maxPrice || undefined  // unsanitised; server pattern ^\d+(\.\d{1,2})?$
- **Fix proposto:** Sanitize/normalize the price inputs (strip invalid chars, enforce >= 0 and 2 decimals) before sending, or skip sending when they don't match the expected pattern.
- **Verifica (confirmed):** The claim holds on all three sub-points.

1. INPUTS ARE RAW STRINGS: Lines 67-68 in product-selector.tsx declare `minPrice`/`maxPrice` as plain `useState("")`. Lines 393/400 set them directly from `e.target.value` with no sanitization. Lines 83-84 pass `minPrice || undefined` and `maxPrice || undefined` verbatim to the API.

2. SERVER VALIDATES WITH THE CITED PATTERN: Lines 104-115 of apps/api/src/modules/seller/routes/products.ts confirm `pattern: "^\\d+(\\.\\d{1,2})?$"` for both `minPrice` and `maxPrice`. Values like '10.999' (3 decimal digits), '-5' (negative sign), or '1e3' (scientific notation — which browsers do allow in `<input type="number">`) all fail this pattern and produce a 400.

3. NO INLINE ERROR FEEDBACK: `libraryQuery.isError` is never checked (grep confirms only `libraryLoading` and `showEmpty` drive the render branches at lines 422 and 426). When the query throws, `libraryQuery.data` is undefined so `visibleRows` is empty, causing `showEmpty = true`. This silently shows the empty-state UI (PackageIcon + generic message) with no error indication. Unlike the add/remove mutations, there is no `toast.error` wired to the library query error path.

4. SEARCH IS DEBOUNCED; PRICE IS NOT: `debouncedSearch` exists for the text search (line 66) but there is no debounced counterpart for `minPrice`/`maxPrice` — the query key at line 76 uses the raw state values, so the API call fires on every keypress.

The bug is real and reachable by a seller typing e.g. "10.999" or pressing the step buttons past certain values.

#### 🟡 [low/reliability] Processing page can hang on spinner if status is ready but storeId is missing · verifica: **refuted**

- **Dove:** `apps/seller/src/routes/_authenticated/store/new.processing.tsx:44`
- **Confidence:** medium
- **Descrizione:** refetchInterval stops polling once `status === 'ready'`. The success effect only navigates when `data.status === 'ready' && data.storeId`. If the backend returns ready without a storeId, polling stops and the navigation never fires, leaving the user on the spinner until the 60s timeout. Edge case dependent on backend invariants.
- **Evidenza:** refetchInterval: (q) => q.state.data?.status === 'ready' || timedOut ? false : POLL_INTERVAL_MS
... if (data?.status === 'ready' && data.storeId) { ... navigate }
- **Fix proposto:** Treat 'ready' without storeId as an error state (show a message / retry) rather than silently relying on the timeout.
- **Verifica (refuted):** The claim identifies a real code pattern — `refetchInterval` stops when `status === 'ready'`, but navigation only fires when `data.status === 'ready' && data.storeId` — and correctly notes that if `storeId` is absent, the user is stuck until the 60s timeout. However, the backend makes this scenario impossible by construction.

In `handleCheckoutCompleted` (apps/api/src/modules/webhooks/services/handlers/checkout-completed.ts lines 39-117), all three writes execute inside a single DB transaction: (1) `store` insert, (2) `storeSubscription` insert, and (3) `pendingStoreCreation` update to `status='consumed'` with `stripeSubscriptionId` populated. These commit atomically or not at all.

In `getCheckoutStatus` (apps/api/src/modules/seller/services/checkout.ts lines 151-161), `status: 'ready'` is returned only when `pending.status === 'consumed'`. At that point, `pending.stripeSubscriptionId` is guaranteed to be non-null (set in the same transaction), and the `storeSubscription` row is guaranteed to exist (inserted in the same transaction). Therefore `sub?.storeId` resolves to a valid store UUID — never `undefined` — whenever the polling endpoint returns `status: 'ready'`.

The defensive `sub?.storeId` optional chaining in the service is a TypeScript safety measure (the field is nullable at the type level), not evidence of a reachable null path. There is no window between `consumed` being visible and `storeSubscription` existing because the transaction prevents partial visibility.

#### 🟡 [low/test-gap] Opening-hours editor allows close <= open and overlapping slots

- **Dove:** `apps/seller/src/features/stores/components/opening-hours-editor.tsx:75`
- **Confidence:** high
- **Descrizione:** updateSlot/addSlot only enforce the HH:mm format (also enforced by TimeSlotSchema server-side). Neither the editor nor the schema validates that close > open, or that slots within a day do not overlap. A seller can save e.g. open 19:00 / close 09:00 or two overlapping bands; the customer-facing 'open now' logic could then misbehave.
- **Evidenza:** slots: d.slots.map((s, i) => i === slotIndex ? { ...s, [field]: val } : s)  // no close>open / overlap check
- **Fix proposto:** Add client-side validation (per-slot close > open and non-overlapping bands) with inline errors before allowing submit; optionally mirror in the TypeBox schema.

#### 🟡 [low/reliability] Checkout prefill fetch ignores API errors

- **Dove:** `apps/seller/src/routes/_authenticated/store/new.tsx:43`
- **Confidence:** medium
- **Descrizione:** The prefill effect calls the checkout endpoint and only reads res.data?.data?.formData, never checking res.error. On error it silently proceeds with an empty form (no toast), and the only error path is the .finally clearing the loading flag. Minor, but a failed prefill is invisible to the user.
- **Evidenza:** .then((res) => { if (res.data?.data?.formData) { setPrefillData(...); } }).finally(() => setPrefillLoading(false));
- **Fix proposto:** Check res.error and surface a toast (or fall back explicitly) so a failed prefill isn't silently swallowed.

#### 🟡 [low/type-safety] Loose `as any` cast on subscription query error

- **Dove:** `apps/seller/src/hooks/use-active-store.tsx:69`
- **Confidence:** high
- **Descrizione:** The subscriptions query casts the error envelope with `(r.error.value as any)?.message` and the data with `as Subscription[]`, bypassing the Eden Treaty types that the rest of the codebase relies on. This loses type safety on the subscription shape (e.g. currentPeriodEnd date handling) and the error message access.
- **Evidenza:** if (r.error) throw new Error((r.error.value as any)?.message);
return (r.data?.data ?? []) as Subscription[];
- **Fix proposto:** Use `r.error.value?.message` like the other hooks and rely on the inferred Eden type for the subscription array instead of casting to a hand-written Subscription[].

### `fe-seller-core` — 6 finding

> The subsystem is generally well-structured and consistent: the onboarding state machine on the FE (route order, stepper, go-back navigation) matches the backend transitions exactly, auth/env/api isomorphic clients are correctly wired, and ownership/role gating is enforced server-side. The main issue is a repeated error-extraction anti-pattern: several hooks/routes test `typeof response.error.value === "string"` even though the API error envelope is always an object `{ success, error, message }`, so those branches are dead and the server's actual message is discarded. The most user-visible instance is the invite-accept page, where all server errors collapse to one generic message. Secondary nits: an onboarding-status query fires (and retries) for non-seller roles, and a couple of redirect-during-render patterns. No security, authorization, or data-integrity defects were found in the reviewed FE code.

#### 🟠 [medium/bug] Invite-accept page discards the server error message (dead string-type check) · verifica: **confirmed**

- **Dove:** `apps/seller/src/routes/invite.$token.tsx:53`
- **Confidence:** high
- **Descrizione:** On accept-invite failure the code does `typeof response.error.value === "string" ? response.error.value : "Errore durante la creazione dell'account"`. The API error envelope is always an object `{ success:false, error, message }` (see errorBody in apps/api/src/lib/responses.ts and the global error-handler), never a string. So the string branch is dead and the user always sees the generic message instead of the real cause (e.g. expired/invalid token, password mismatch returned as 400 'Le password non coincidono', 409 conflicts).
- **Evidenza:** const errorMsg = typeof response.error.value === "string" ? response.error.value : "Errore durante la creazione dell'account";
- **Fix proposto:** Read the message from the object envelope, e.g. `const v = response.error.value as { message?: string }; setApiError(v?.message ?? "Errore durante la creazione dell'account");` — matching the `(r.error.value as any)?.message` pattern already used in billing.tsx and the profile cards.
- **Verifica (confirmed):** The bug is real and exactly as described. At apps/seller/src/routes/invite.$token.tsx lines 53-56, the code checks `typeof response.error.value === "string"` which is always false. The API error handler (apps/api/src/plugins/error-handler.ts) always returns an object via `errorBody(error.code, error.message)` — shape `{ success: false, error: string, message: string }` — never a plain string. The accept-invite endpoint (apps/api/src/modules/registration/index.ts line 92) throws `new ServiceError(400, "Le password non coincidono")` for server-side password mismatch, which the global handler serializes to that object envelope. So `response.error.value` is always an object, the string branch is always dead, and the user always sees the generic fallback message. All other error-handling code in the seller app uses `response.error.value?.message` (e.g., use-stock-adjust-mutation.ts, use-product-mutations.ts, product-selector.tsx) — confirming the correct pattern is well-established and this file is the outlier. The severity is accurate: the feature is broken for all error cases, which is a real user-facing bug, but it is not a security or data-loss issue.

#### 🟡 [low/reliability] Onboarding-status query fires and retries for non-seller roles (employee/admin) · verifica: **confirmed**

- **Dove:** `apps/seller/src/routes/_authenticated.tsx:40`
- **Confidence:** high
- **Descrizione:** useOnboardingStatus() is called unconditionally for every authenticated user. The /seller/onboarding/status endpoint resolves via getOnboardingStatus(user.id), which throws 404 'Seller profile not found' for employees (and admins) who have no seller profile. The component's loading gate and error UI both only apply when role==='seller', so the failed query is invisible — but it still issues an HTTP request plus React Query's default 3 retries on every authenticated page load for employee sessions.
- **Evidenza:** const { data: onboarding, isPending: onboardingPending, isError: onboardingError } = useOnboardingStatus();  // called for all roles; employees get a 404 from getOnboardingStatus
- **Fix proposto:** Gate the query: accept an `enabled` option in useOnboardingStatus (or pass it) so it only runs when `session?.user.role === 'seller'`, e.g. `useQuery({ ..., enabled: role === 'seller' })`. This mirrors how ActiveStoreProvider/use-stores already use `enabled`.
- **Verifica (confirmed):** The core problem is real, but the cited error code is wrong. 

**What is confirmed:**
- `useOnboardingStatus()` is called unconditionally at `_authenticated.tsx:40-44` for every authenticated user, with no `enabled` guard.
- The hook (`apps/seller/src/hooks/use-onboarding.ts:7-24`) has no `enabled` option — it always fires.
- The error UI (line 105) and the loading gate (line 91) are both gated on `role === 'seller'`, so failures for employees are silent from the user's perspective.
- React Query's default retry behavior (3 retries) applies to any failed query, so employee sessions will repeatedly retry this request on every authenticated page load.

**Where the reviewer is wrong about the mechanism:**
- The reviewer claims employees get a **404** from `getOnboardingStatus`. That is incorrect. The seller module's first guard (`apps/api/src/modules/seller/index.ts:36-40`) contains a `.resolve()` that throws `ServiceError(403, "Only sellers can access profile")` if `u.role !== "seller"`. Employees never reach `getOnboardingStatus` — the 403 is returned before the service function is called.

**Net verdict:** The reliability issue (unconditional HTTP request + 3 retries for employee sessions) is genuine and triggerable. The fix proposed (adding `enabled: role === 'seller'`) is correct. The error code discrepancy (403 vs 404) does not change the outcome — both are non-2xx and trigger React Query retries. Severity "low" is appropriate since this is an in-dev app with no production deployment, and the impact is wasted network requests rather than data corruption or UX breakage.

#### 🟡 [low/consistency] Onboarding/profile/settings/countries hooks have dead string-type error checks, swallowing server messages

- **Dove:** `apps/seller/src/hooks/use-onboarding.ts:14`
- **Confidence:** high
- **Descrizione:** The same `typeof response.error.value === "string"` pattern is repeated in useOnboardingStatus, useUpdatePersonalInfo, useUpdateDocument, useUpdateCompany, useGoBack (use-onboarding.ts), useSellerProfile/useUpdateVat (use-seller-profile.ts:14,38), useSellerSettings (use-seller-settings.ts:14) and useCountries (use-countries.ts:15). Because the envelope is always an object, the server's `message` is never surfaced and a hardcoded Italian fallback is always shown. Unlike the invite page these fallbacks are reasonably specific, so the practical impact is limited to losing precise backend messages (e.g. assertStatus / 'pending change already exists' / VAT-equal errors).
- **Evidenza:** const errorMsg = typeof response.error.value === "string" ? response.error.value : "Errore durante il caricamento dello stato onboarding";
- **Fix proposto:** Centralize an `extractApiError(error)` helper that reads `error.value?.message` (falling back to a provided default) and use it across these hooks, matching the object-aware extraction already used in billing.tsx and business-info-card.tsx.

#### 🟡 [low/improvement] Redirect performed during render in login/register pages

- **Dove:** `apps/seller/src/routes/login.tsx:26`
- **Confidence:** medium
- **Descrizione:** Both LoginPage and RegisterPage (register.tsx:31) call `void navigate({ to: "/" })` directly in the component render body when a session exists, then `return null`. Triggering navigation as a side effect during render is an anti-pattern (state update during render of the router) and can cause an extra render/transition warning; it also runs on every render until the redirect commits.
- **Evidenza:** if (session?.user) {
	void navigate({ to: "/" });
	return null;
}
- **Fix proposto:** Move the redirect into a useEffect keyed on the session, or use a route-level beforeLoad/loader guard with `throw redirect({ to: '/' })` so the redirect is handled before render.

#### 🟡 [low/dead-code] Unused VAT/profile hook module (dead code)

- **Dove:** `apps/seller/src/hooks/use-seller-profile.ts:7`
- **Confidence:** high
- **Descrizione:** useSellerProfile and useUpdateVat (the whole use-seller-profile.ts file) are not referenced anywhere in apps/seller/src. The active VAT-change UI (vat-change-dialog.tsx) uses seller.settings.vat.patch, while this hook targets the separate seller.profile.vat.patch endpoint (the rejected-state onboarding path). The endpoint exists, but the hook is currently orphaned.
- **Evidenza:** grep for useSellerProfile / useUpdateVat / seller.profile.vat across apps/seller/src returns only the hook file itself.
- **Fix proposto:** Either wire useUpdateVat into the rejected-onboarding flow that needs seller.profile.vat.patch, or delete use-seller-profile.ts to avoid confusion with the settings-based VAT change.

#### 🟡 [low/reliability] Error toasts can show empty/undefined when API message is absent

- **Dove:** `apps/seller/src/routes/_authenticated/billing.tsx:89`
- **Confidence:** medium
- **Descrizione:** Billing queries/mutations and the cancel/vat dialogs throw `new Error((r.error.value as any)?.message)`. If the envelope's message is ever missing/undefined, this constructs `new Error(undefined)` whose `.message` is the empty string, so onError surfaces an empty (or 'undefined') toast with no actionable text. Same pattern in cancel-store-dialog.tsx:37 and use-active-store.tsx subscriptions query.
- **Evidenza:** if (r.error) throw new Error((r.error.value as any)?.message);
- **Fix proposto:** Provide a fallback string, e.g. `throw new Error((r.error.value as { message?: string })?.message ?? "Si è verificato un errore")`.

### `fe-admin` — 9 finding

> The admin frontend is consistent, well-structured, and follows the repo conventions (Eden Treaty + TanStack Query, "use no memo" table opt-out, @bibs/ui primitives, Paraglide-bound copy, ServiceError-by-status error handling). Data fetching is entirely client-side via useQuery (no loaders), so the server-side credentials:"include" treaty path is never exercised for these reads and the SSR-cookie concern is moot. The findings are concentrated in input/search-param validation gaps that surface as confusing failures rather than security holes, plus one process-wide QueryClient singleton that is a latent SSR cross-request leak but is a deliberate repo-wide pattern and currently unreachable. No authorization, IDOR, injection, or money-rounding bugs were found in this layer (authz is enforced by the API and the _authenticated role gate).

#### 🟠 [medium/bug] users.tsx validateSearch yields NaN for non-numeric page/limit, breaking pagination · verifica: **confirmed**

- **Dove:** `apps/admin/src/routes/_authenticated/users.tsx:16`
- **Confidence:** high
- **Descrizione:** validateSearch coerces with Number(search.page ?? 1). The ?? only fires for null/undefined; any non-numeric string (e.g. ?page=abc, a stale bookmark, or a manual URL edit) passes the nullish check and Number('abc') returns NaN. NaN then flows into offset = (page-1)*limit = NaN (sent to authClient.admin.listUsers query), and totalPages = Math.ceil(total/limit) = NaN, so the page silently breaks (empty list / broken pager) with no error surfaced.
- **Evidenza:** validateSearch: (search) => ({ page: Number(search.page ?? 1), limit: Number(search.limit ?? 20) })  // Number('abc') === NaN; offset=(NaN-1)*NaN; Math.ceil(total/NaN)===NaN
- **Fix proposto:** Validate with a coercion that falls back on NaN, e.g. const page = Number(search.page); return { page: Number.isFinite(page) && page >= 1 ? page : 1, ... } (or use a zod number().int().min(1).catch(1) schema). Apply the same to limit and clamp to the API cap of 100.
- **Verifica (confirmed):** The code at /Users/marcogelli/repos/jelaz/bibs/apps/admin/src/routes/_authenticated/users.tsx lines 16-21 exactly matches the claimed evidence. validateSearch returns `{ page: Number(search.page ?? 1), limit: Number(search.limit ?? 20) }`. The nullish-coalescing operator (`??`) only fires for null/undefined, so a non-numeric string like 'abc' passes through and `Number('abc')` returns NaN. NaN then flows directly to: (1) line 43 `offset = (page - 1) * limit` → NaN; (2) line 73 `totalPages = Math.ceil(total / limit)` → NaN; (3) line 156 the count label renders NaN. There is no downstream guard — no `Number.isFinite` check, no zod validation with `.catch()`, nothing. TanStack Router accepts whatever validateSearch returns without further validation. The bug is real and triggerable via any non-numeric value in the URL query params (e.g. `?page=abc`). Severity medium is appropriate: it silently breaks the page but does not expose data or cause a server error.

#### 🟡 [low/reliability] Pricing dialog sends NaN/empty values to the API on cleared or non-integer inputs · verifica: **confirmed**

- **Dove:** `apps/admin/src/routes/_authenticated/billing/pricing.tsx:118`
- **Confidence:** high
- **Descrizione:** The number inputs use Number.parseFloat/Number.parseInt with no guards. Clearing the fee field makes setFee(NaN); then mutationFn does Math.round(fee*100) -> NaN which JSON-serializes to null, failing the server schema (storeMonthlyFeeCents: t.Integer({minimum:100})) with an opaque 400. Same for days/hours via Number.parseInt(''). Additionally productId is required server-side (t.String()) but the form starts at '' with no client validation, so an empty productId is submittable. The result is a confusing server error instead of inline form validation.
- **Evidenza:** onChange={(e) => setFee(Number.parseFloat(e.target.value))} ... storeMonthlyFeeCents: Math.round(fee * 100) ... productId  // server: storeMonthlyFeeCents t.Integer({minimum:100}), productId t.String()
- **Fix proposto:** Guard each parse (fallback to previous/0 on NaN) and disable the Conferma button when fee/days/hours are not finite or productId.trim() is empty; ideally drive the dialog with react-hook-form + zod like the category forms for consistent inline validation.
- **Verifica (confirmed):** The code at the cited location confirms the issue is real and triggerable.

1. Line 118: `onChange={(e) => setFee(Number.parseFloat(e.target.value))}` — clearing the input produces `NaN` in state.
2. Line 50: `storeMonthlyFeeCents: Math.round(fee * 100)` — `Math.round(NaN)` is `NaN`, which JSON.stringify serializes to `null`. The server schema at apps/api/src/modules/admin/routes/billing.ts line 129 declares `storeMonthlyFeeCents: t.Integer({ minimum: 100 })`, so `null` will fail TypeBox validation with an opaque 400.
3. Lines 124, 129: `Number.parseInt(e.target.value, 10)` on cleared inputs for `days`/`hours` likewise produces `NaN`, which becomes `null` in JSON and fails `t.Integer({ minimum: 7, maximum: 365 })` / `t.Integer({ minimum: 1, maximum: 168 })`.
4. Line 45: `productId` starts as `""`. The server schema uses `t.String()` with no `minLength`, so an empty productId passes TypeBox validation but will fail downstream at the Stripe API call — the failure is slightly different from the claim's framing (claim says "required server-side fails schema") but the practical effect (confusing error instead of inline validation) is the same.
5. The "Conferma" button (line 140-145) is only disabled when `mutation.isPending`, not when any of the four fields are invalid.

No existing guard, fallback, or client-side validation prevents submitting NaN values. The issue is real and directly triggerable by clearing any numeric input. Severity "low" is appropriate given this is an admin-only internal tool (not user-facing), the error is caught by the server schema, and the app is in active development.

#### 🟡 [low/reliability] Process-wide singleton QueryClient is shared across SSR requests · verifica: **confirmed**

- **Dove:** `apps/admin/src/integrations/tanstack-query/root-provider.tsx:4`
- **Confidence:** medium
- **Descrizione:** getContext() memoizes a single QueryClient in a module-level `let context` and returns it on the server too. On a long-lived SSR server this is one cache shared by all concurrent users/requests, which would leak one user's cached query data into another's render. It is currently unreachable because every screen fetches client-side via useQuery (no route loaders prefetch on the server), and this exact pattern is duplicated across all three apps (intentional convention). Flagging as latent: the moment a server loader prefetches into this client, it becomes a cross-request data leak.
- **Evidenza:** let context: { queryClient: QueryClient } | undefined; export function getContext() { if (context) return context; const queryClient = new QueryClient(); context = { queryClient }; return context; }
- **Fix proposto:** On the server, create a fresh QueryClient per request (e.g. isomorphic: reuse the singleton only in the browser; return a new QueryClient() each call when running server-side / no window) before any server-side prefetching is introduced.
- **Verifica (confirmed):** The cited evidence is verbatim correct. All three apps (admin, seller, customer) share the identical module-level singleton pattern in their `root-provider.tsx` files: `let context: { queryClient: QueryClient } | undefined` is initialized once and reused for every call to `getContext()`, including server-side calls made during SSR.

The claim is accurate in every detail:
1. The singleton code exists exactly as quoted at `apps/admin/src/integrations/tanstack-query/root-provider.tsx:4-22`.
2. The pattern is identically duplicated in `apps/seller/src/integrations/tanstack-query/root-provider.tsx` and `apps/customer/src/integrations/tanstack-query/root-provider.tsx`.
3. `getRouter()` in `apps/admin/src/router.tsx:8` passes `context: getContext()` — the singleton — as router context on every call, including server-side calls.

The "currently unreachable" characterization is also verified: a grep across all admin route files (`src/routes/**`) found zero `loader` definitions, zero `prefetchQuery`/`ensureQueryData` calls, and zero `context.queryClient` accesses from route context. The only `beforeLoad` in `__root.tsx:25-29` is guarded by `typeof document !== "undefined"` making it browser-only. All data fetching is purely client-side via `useQuery`.

The risk is real but latent: the cross-request data leak only materializes if a developer adds a route `loader` that calls `context.queryClient.prefetchQuery(...)` — at that point the same QueryClient instance would be shared across all concurrent SSR requests. The low severity rating is appropriate given the current unreachability. The proposed fix (create a fresh QueryClient per request when `typeof window === "undefined"`) is also correct.

#### 🟡 [low/bug] Macro-category filter dropdown silently caps at 100 options · verifica: **refuted**

- **Dove:** `apps/admin/src/features/product-categories/components/product-categories-panel.tsx:152`
- **Confidence:** medium
- **Descrizione:** The macro-category filter select fetches with limit:100 (the API cap) and renders only data.data. If the platform ever has more than 100 macro categories, the extra ones are silently absent from the filter, so categories under those macros become unfilterable. Per repo convention, fetching 'all' of a paginated endpoint should loop to pagination.total rather than rely on a single capped page.
- **Evidenza:** api()["product-macro-categories"].get({ query: { limit: 100, sortBy: "name", sortOrder: "asc" } }); ... const macros = macrosData?.data ?? [];
- **Fix proposto:** Either page through until pagination.total is reached when building the filter list, or convert the filter to a server-side searchable combobox so it never depends on having every macro client-side.
- **Verifica (refuted):** The cited evidence is accurate — lines 151-152 do fetch `limit: 100` and line 163 uses only `macrosData?.data ?? []`. However, the claim is refuted by house rule #8: "Pagination cap is 100 by design (limit > 100 → 400 VALIDATION_ERROR). Do not flag the cap as a bug." The reviewer's own proposed fix ("loop to pagination.total") is precisely the pattern house rule #8 prohibits flagging as needed. The claim is fundamentally about the architectural 100-item pagination cap — arguing that the code should paginate past it to build a complete filter list. Since 100 is the intentional hard limit per request and the app is a local-commerce marketplace where having more than 100 macro-categories is implausible in practice, this is not a triggerable real-world bug. The claim correctly identifies the code pattern but mischaracterizes it as a defect when it is consistent with the repo's deliberate pagination convention.

#### 🟡 [low/bug] login.tsx performs navigation as a render-phase side effect

- **Dove:** `apps/admin/src/routes/login.tsx:26`
- **Confidence:** high
- **Descrizione:** The already-authenticated redirect calls void navigate({ to: '/' }) directly in the render body (not in an effect) and then returns null. Triggering navigation during render is a React anti-pattern that can warn/double-fire under StrictMode or concurrent rendering. The sibling _authenticated.tsx correctly does the equivalent redirect inside a useEffect.
- **Evidenza:** if (session?.user?.role === "admin") { void navigate({ to: "/" }); return null; }
- **Fix proposto:** Move the redirect into a useEffect keyed on session, mirroring _authenticated.tsx (useEffect(() => { if (session?.user?.role === 'admin') void navigate({ to: '/' }); }, [session, navigate])).

#### 🟡 [low/improvement] Non-admin successful login lands on an 'Accesso negato' dead-end

- **Dove:** `apps/admin/src/routes/login.tsx:35`
- **Confidence:** medium
- **Descrizione:** handleSubmit signs in via authClient.signIn.email and on success always navigate({ to: '/' }), regardless of role. A non-admin who enters valid credentials is signed in (a real session cookie is set) and then sees the _authenticated.tsx 'Accesso negato' screen. There is no role check on the login result, so non-admins are silently authenticated into a dead-end rather than being told they lack access or being kept signed out.
- **Evidenza:** const { error: signInError } = await authClient.signIn.email({...}); if (signInError) {...} void navigate({ to: "/" });  // no role check on success
- **Fix proposto:** After a successful signIn, inspect the returned/refetched session role; if it is not 'admin', sign out and set an 'account non autorizzato' error instead of navigating to '/'.

#### 🟡 [low/improvement] Subscriptions page is unbounded at limit:50 with no pagination controls

- **Dove:** `apps/admin/src/routes/_authenticated/billing/subscriptions.tsx:36`
- **Confidence:** high
- **Descrizione:** The subscriptions list hardcodes page:1, limit:50 and renders no pager — it only prints 'X di Y risultati'. Once there are more than 50 subscriptions, the admin can never see beyond the first 50 (and the email/store filters are the only way to narrow), so older or unfiltered subscriptions become inaccessible from this screen.
- **Evidenza:** query: { page: 1, limit: 50, ... } ... <p>{data.data.length} di {data.pagination.total} risultati</p>  // no DataPagination / PageSizeSelector
- **Fix proposto:** Add page state + DataPagination/PageSizeSelector like the other admin tables, deriving totalPages from data.pagination.total.

#### 🟡 [low/improvement] Avatar upload/remove discards the server error message

- **Dove:** `apps/admin/src/routes/_authenticated/profile.tsx:62`
- **Confidence:** medium
- **Descrizione:** onUploadAvatar throws new Error('Errore upload') and onRemoveAvatar throws new Error('Errore'), discarding res.error.value?.message from the API. The user gets a generic failure with no indication of the real cause (e.g. file too large, unsupported type) even though the API returns a specific message. This is inconsistent with every other mutation in the subsystem, which surfaces response.error.value?.message.
- **Evidenza:** const res = await api().me.avatar.post({ file }); if (res.error) throw new Error("Errore upload");
- **Fix proposto:** Surface the server message: throw new Error(res.error.value?.message || 'Errore upload') (and likewise for delete), so the SharedPersonalInfoCard error path shows the real reason.

#### 🟡 [low/improvement] Five near-identical CRUD panels duplicate ~450 lines of table/search/pagination/dialog wiring

- **Dove:** `apps/admin/src/features/product-categories/components/product-categories-panel.tsx:75`
- **Confidence:** medium
- **Descrizione:** ProductCategoriesPanel, ProductMacroCategoriesPanel, and StoreCategoriesPanel (and the sellers list) repeat the same debounced-search effect, handleSort, page/limit state, DataTable+DataPagination block, invalidateAll, and create/update/delete mutation scaffolding almost verbatim. This triples the surface for divergence bugs (the macro-filter cap and the NaN search issues are examples of per-copy drift) and conflicts with the documented preference for sharing duplicated logic.
- **Evidenza:** Identical blocks across the three panels: const debounceRef = useRef(...); useEffect(() => { debounceRef.current = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300); ... }, [search]); const handleSort = (field) => { ... };
- **Fix proposto:** Extract a useCrudTable/usePaginatedSearch hook (search debounce, sort, page/limit, query+mutations, invalidation) and a generic CategoryPanel shell, parameterized by endpoint + columns + form, so the three panels become thin configs.

### `fe-customer` — 7 finding

> The Customer FE subsystem is small, conventional, and largely clean: it follows the repo's TanStack Start + Eden Treaty + better-auth + Paraglide patterns, uses shared @bibs/ui primitives, and keeps copy in messages. The most material issue is a Rules-of-Hooks violation in register.tsx (useForm called after a conditional early return), which can throw if the session resolves while mounted; closely related is the render-phase navigate() call in both login and register, inconsistent with the correct useEffect guard in _authenticated.tsx. The remaining findings are low-severity quality/reliability items (bypassed validated env, mount-time resend cooldown on verify-email, discarded API error specificity on avatar ops, and an unguarded Date.parse on the pending-verification timestamp).

#### 🔴 [high/bug] Rules of Hooks violation: useForm called after a conditional early return in register · verifica: **confirmed**

- **Dove:** `apps/customer/src/routes/register.tsx:61`
- **Confidence:** high
- **Descrizione:** RegisterPage calls authClient.useSession() (line 55), then conditionally returns null when a session exists (lines 56-59), and only afterwards calls useForm() (lines 61-67). useForm internally calls multiple React hooks. Because it sits after a conditional return, the number/order of hooks differs between the 'session present' render and the 'no session' render. If the session transitions from absent to present while this component is mounted (e.g. useSession resolves a cached session a tick later, or sign-in completes in another tab), React will throw 'Rendered fewer hooks than expected' / 'change in the order of Hooks'.
- **Evidenza:** const { data: session } = authClient.useSession();
if (session?.user) {
	void navigate({ to: "/" });
	return null;
}
... 
const { register, handleSubmit, formState } = useForm<RegisterFormData>({ ... });
- **Fix proposto:** Move the useForm() call (and any other hooks) above the early return, so all hooks run unconditionally on every render. Compare with login.tsx, which correctly places all hooks before its session early-return.
- **Verifica (confirmed):** The code at /Users/marcogelli/repos/jelaz/bibs/apps/customer/src/routes/register.tsx confirms the violation exactly as described. Lines 48-55 call hooks unconditionally (useNavigate, useState x3, authClient.useSession). Lines 56-59 conditionally return null when session?.user is truthy. Lines 61-67 call useForm() after that conditional return. useForm internally calls React hooks, so its call count varies depending on whether the early return fires. This is a textbook Rules of Hooks violation. The trigger is realistic: authClient.useSession() typically starts with data=undefined (loading state) so useForm runs on the first render, but when the session resolves (data.user becomes defined), the component returns early before calling useForm — React throws "Rendered fewer hooks than expected". The reviewer's comparison to login.tsx is slightly imprecise (login.tsx avoids the issue by not using useForm at all, not by hoisting it), but this does not undermine the finding. The fix is straightforward: move the useForm call above the session check.

#### 🟠 [medium/bug] navigate() called during render phase in login and register (side effect during render) · verifica: **confirmed**

- **Dove:** `apps/customer/src/routes/register.tsx:57`
- **Confidence:** high
- **Descrizione:** Both login.tsx (lines 31-34) and register.tsx (lines 56-59) call navigate({ to: "/" }) directly in the component body during render, then return null. Triggering a router navigation (a state update) during render is a React anti-pattern that can produce 'Cannot update a component while rendering a different component' warnings and is order-fragile. The _authenticated.tsx layout does this correctly via useEffect. Either an effect-based redirect or a route beforeLoad/loader redirect would be idiomatic and consistent.
- **Evidenza:** const { data: session } = authClient.useSession();
if (session?.user) {
	void navigate({ to: "/" });
	return null;
}
- **Fix proposto:** Perform the authenticated->home redirect in a useEffect (matching _authenticated.tsx) or, preferably, in the route's beforeLoad using throw redirect({ to: '/' }) so the guard runs before render.
- **Verifica (confirmed):** The code at register.tsx lines 55-59 and login.tsx lines 29-34 is exactly as described: `navigate({ to: "/" })` is called synchronously in the component render body (not inside useEffect, event handler, or async callback) when `session?.user` is truthy. This is a real React anti-pattern — calling a function that triggers router state updates during the render phase can produce "Cannot update a component while rendering a different component" warnings. The `void` prefix only suppresses the Promise; it does not defer execution or move the call out of the render phase. The contrast with `_authenticated.tsx` (lines 14-18) is accurate: that file correctly wraps the navigate call in a useEffect with a dependency array. The issue is reachable by any authenticated user navigating directly to `/login` or `/register`. No house rule covers or permits this pattern. Severity "medium" is appropriate — it's a real anti-pattern that produces React warnings and is order-fragile, but it is not a security or data-integrity issue.

#### 🟡 [low/reliability] register parses errVal.resentAt with Date.parse without validating the result · verifica: **refuted**

- **Dove:** `apps/customer/src/routes/register.tsx:88`
- **Confidence:** medium
- **Descrizione:** On EMAIL_PENDING_VERIFICATION the code does resentAt: Date.parse(errVal.resentAt). If the server ever sends a malformed timestamp, Date.parse returns NaN, which flows into PendingVerificationBannerConnected -> useCooldown(NaN, 60000). useCooldown computes Date.now() - NaN = NaN, remaining = Math.max(0, 60000 - NaN) = NaN, and ready = (NaN === 0) = false, leaving the resend button permanently disabled with a NaN-driven countdown. The cast (regError.value as {...}) also bypasses type-checking of this contract.
- **Evidenza:** setPending({ email: data.email, resentAt: Date.parse(errVal.resentAt) });
- **Fix proposto:** Guard the parse: const t = Date.parse(errVal.resentAt); set resentAt to Number.isNaN(t) ? Date.now() : t. Optionally validate the error envelope with the shared schema instead of an as-cast.
- **Verifica (refuted):** The NaN path requires the server to send a malformed timestamp in `resentAt`. Tracing the full contract:

1. `apps/api/src/modules/registration/services.ts` line 85 constructs `resentAt` exclusively as `new Date().toISOString()`, which always produces a valid ISO 8601 string.
2. `PendingVerificationError` stores this string and the error handler (`error-handler.ts` line 48) serializes it as-is: `{ ...body, resentAt: error.resentAt }`.
3. There is no other code path that can produce an `EMAIL_PENDING_VERIFICATION` response with a different `resentAt` value.

Since `Date.parse` on a `new Date().toISOString()` result never returns NaN, the NaN propagation path through `useCooldown` described in the claim cannot be triggered. The `as` cast on the client side is a type-safety concern but does not create a runtime bug given the server-side contract is hardcoded to produce valid ISO timestamps. The claim describes a theoretical vulnerability that has no real trigger in this codebase.

#### 🟡 [low/consistency] Validated env module (env.ts) is bypassed; API URL read directly from import.meta.env

- **Dove:** `apps/customer/src/lib/api.ts:5`
- **Confidence:** high
- **Descrizione:** env.ts defines a t3-oss validated env (VITE_API_URL with a url() schema and default). However both lib/api.ts and lib/auth-client.ts read import.meta.env.VITE_API_URL || "http://localhost:3000" directly, bypassing the validated/typed env entirely. This duplicates the default and the validation never runs for the only client var that matters, defeating the purpose of env.ts. If env.ts is meant to be the source of truth, these two modules should import { env } from "@/env".
- **Evidenza:** const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";  // api.ts
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";  // auth-client.ts
- **Fix proposto:** Import the validated env (import { env } from "@/env") and use env.VITE_API_URL in both api.ts and auth-client.ts, removing the inline fallback so the default lives in one place.

#### 🟡 [low/improvement] verify-email starts a 60s resend cooldown on every mount, regardless of whether an email was just sent

- **Dove:** `apps/customer/src/routes/verify-email.tsx:29`
- **Confidence:** medium
- **Descrizione:** lastSentAt is initialized to Date.now() on mount, immediately arming a 60s cooldown. This is fine right after registration, but the page is also reachable from the login screen's 'Reinvia email di verifica' link (login.tsx:77-83) and via /verify-email?email=... bookmarks. In those flows the user has not just triggered a send, yet the resend button is disabled for 60s with a countdown that misrepresents server state. The cooldown should reflect an actual send event, not page mount.
- **Evidenza:** const [lastSentAt, setLastSentAt] = useState<number>(() => Date.now());
const { secondsRemaining, ready } = useCooldown(lastSentAt, 60_000);
- **Fix proposto:** Initialize lastSentAt to null (useCooldown already treats null as ready:true) and set it to Date.now() only inside handleResend after a successful send; or pass an initial timestamp via search params when navigation originates from a real send.

#### 🟡 [low/reliability] Avatar upload/delete error path discards the API error message and refetch errors are unhandled

- **Dove:** `apps/customer/src/routes/profile.tsx:62`
- **Confidence:** medium
- **Descrizione:** onUploadAvatar/onRemoveAvatar throw a generic hard-coded Error('Errore upload')/'Errore' when res.error is set, discarding the structured error returned by the API (e.g. invalid type / too large, which the API enforces). The PersonalInfoCard/AvatarUploadDialog only see a generic message. Additionally refetch() is awaited but any rejection from it is not caught here; while the dialog wraps onUpload in try/catch, the lost specificity degrades the UX for the validated 5MB / type limits the LABELS already describe.
- **Evidenza:** const res = await api().me.avatar.post({ file });
if (res.error) throw new Error("Errore upload");
- **Fix proposto:** Throw with the server-provided message when available, e.g. throw new Error(res.error.value?.message ?? labels.avatar.errorGeneric), so the dialog can surface the real validation reason (invalid type / too large).

#### 🟡 [low/improvement] profile onSubmit always sends birthDate even when cleared, and derives name from possibly-empty fields

- **Dove:** `apps/customer/src/routes/profile.tsx:53`
- **Confidence:** low
- **Descrizione:** onSubmit forwards data.birthDate straight to authClient.updateUser; the shared card passes undefined when the date is blank, but there is no normalization of an empty-string case here, and name is set to `${firstName} ${lastName}` unconditionally. This is generally fine given the card trims inputs, but the route trusts the additional-field shape implicitly (updateUser with firstName/lastName/birthDate relies on inferAdditionalFields typing). Worth a typed wrapper to avoid silent drift if the better-auth additionalFields schema changes.
- **Evidenza:** const { error } = await authClient.updateUser({
	firstName: data.firstName,
	lastName: data.lastName,
	birthDate: data.birthDate,
	name: `${data.firstName} ${data.lastName}`,
});
- **Fix proposto:** Normalize birthDate (send null/undefined explicitly when cleared) and consider a small typed helper for the additional-fields payload so a schema change surfaces as a type error rather than a runtime no-op.

### `ui-package` — 10 finding

> The subsystem is generally solid and well-documented, with careful attention to React-Compiler opt-outs, SSR-safe hydration, and sticky-column painting subtleties. Most issues are quality/consistency rather than correctness: a real money-formatting duplication where the newer guarded helper is not reused, a discount-detection condition that silently hides discounts, and a few a11y gaps (tablist keyboard nav, autoFocus). No security or data-integrity defects were found — these are presentational components with no server-side authority. Findings are mostly low/medium severity.

#### 🟠 [medium/bug] DiscountedPrice requires both discountedPrice AND percent to show a discount, silently hiding it otherwise · verifica: **confirmed**

- **Dove:** `packages/ui/src/components/discounted-price.tsx:29`
- **Confidence:** high
- **Descrizione:** hasDiscount is true only when discountedPrice AND percent are both non-null. A caller that passes a valid discountedPrice but omits/null percent (a very plausible API shape — the percent may be derivable) gets the full-price branch with no strikethrough and no badge, silently masking the discount. The component can derive percent from the two prices, or treat the presence of a lower discountedPrice as sufficient.
- **Evidenza:** const hasDiscount =
  discountedPrice !== null && discountedPrice !== undefined &&
  percent !== null && percent !== undefined;
- **Fix proposto:** Drive hasDiscount off a meaningful discountedPrice (e.g. discountedPrice != null && Number(discountedPrice) < Number(originalPrice)) and compute the percent when not supplied: percent ?? Math.round((1 - discounted/original) * 100). Only render the badge when a percent is available.
- **Verifica (confirmed):** The code at /packages/ui/src/components/discounted-price.tsx lines 29-33 exactly matches the cited evidence. `hasDiscount` requires both `discountedPrice !== null/undefined` AND `percent !== null/undefined`. If either is absent, the component silently renders the full-price branch with no strikethrough and no badge.

The API entity schema (apps/api/src/lib/schemas/entities.ts:635-638) confirms both `discountedPrice` and `discountPercent` are independently nullable fields. A response where `discountedPrice` is populated but `discountPercent` is null is a valid API shape.

Additionally, `DiscountProductRowSchema` (apps/api/src/lib/schemas/discount.ts:81-87) defines a response shape where `discountedPrice` is non-nullable (always present) but there is no `percent` field at all — any caller using that schema and passing percent as undefined would silently get the full-price rendering.

The component currently has zero callers (only the definition file references it), so no live breakage exists today. But the flaw is real and will trigger silently as soon as the component is wired up to any of the existing API shapes. The proposed fix (drive hasDiscount off `discountedPrice != null && Number(discountedPrice) < Number(originalPrice)`, compute percent when not supplied) is sound.

#### 🟡 [low/reliability] DataPagination does not clamp/guard an out-of-range current page · verifica: **confirmed**

- **Dove:** `packages/ui/src/components/data-pagination.tsx:79`
- **Confidence:** medium
- **Descrizione:** generatePageRange and the render assume page is within [1, totalPages]. If a caller passes page > totalPages (common after shrinking the result set or changing page size without resetting page), no item matches isActive so nothing is highlighted, and the user sees a paginator with no current-page indicator. The prev/next disabled guards prevent navigation errors, but the missing active state is a confusing edge state the component could defend against.
- **Evidenza:** const pages = generatePageRange(page, totalPages, siblingCount);
...
const isActive = item === page;
- **Fix proposto:** Clamp internally: const current = Math.min(Math.max(page, 1), totalPages); and use it for both generatePageRange and isActive, so a stale page still renders a sensible highlighted state.
- **Verifica (confirmed):** Reading /Users/marcogelli/repos/jelaz/bibs/packages/ui/src/components/data-pagination.tsx confirms the issue is real:

1. Line 77 only guards `totalPages <= 1` — there is no guard for `page > totalPages`.
2. Line 79: `const pages = generatePageRange(page, totalPages, siblingCount)` passes the raw `page` value.
3. When `page > totalPages` (e.g., page=5, totalPages=3), `generatePageRange` enters the `showLeftEllipsis && !showRightEllipsis` branch and returns only the last few pages (1, 2, 3). The out-of-range page value (5) never appears in the returned array.
4. Line 105: `const isActive = item === page` — since page=5 is not in the array, no item is ever active, and no page button gets the highlighted style. The paginator renders with no current-page indicator.
5. The prev/next `disabled` guards at lines 88 and 130 prevent navigation errors, but the missing active state is a real confusing edge case.

All existing callers (e.g., seller products route at line 678) reset `page: 1` when changing `limit` or filters, which means this edge state is rarely triggered in practice. However the component itself provides no defensive clamping, and a caller that changes `totalPages` without resetting `page` (e.g., fast filter changes, stale URL state) would hit this exactly as described. The claim's evidence and description are accurate. Severity "low" is appropriate given current callers always reset page on filter/size change.

#### 🟡 [low/consistency] Duplicate EUR formatter in DiscountedPrice instead of reusing Price's guarded formatPriceEur

- **Dove:** `packages/ui/src/components/discounted-price.tsx:13`
- **Confidence:** high
- **Descrizione:** discounted-price.tsx defines its own formatPrice (it-IT EUR via Intl.NumberFormat) while price.tsx already exports formatPriceEur with the same locale/currency. The local copy lacks the Number.isFinite guard, so invalid input (e.g. NaN from Number.parseFloat('abc') or an empty API string) renders as 'NaN €' instead of the '—' fallback the shared helper produces. It also re-creates the Intl.NumberFormat on every call rather than using the module-level cached instance.
- **Evidenza:** function formatPrice(value: string | number, currency = "EUR") {
  const num = typeof value === "string" ? Number.parseFloat(value) : value;
  return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(num);
}
- **Fix proposto:** Import and reuse formatPriceEur from ~/components/price for the EUR case (its non-finite guard and cached formatter), keeping a local path only if a non-EUR currency override is genuinely needed.

#### 🟡 [low/improvement] TabNav implements ARIA tablist/tab roles but has no keyboard navigation or focus management

- **Dove:** `packages/ui/src/components/tab-nav.tsx:73`
- **Confidence:** medium
- **Descrizione:** The container uses role="tablist" and each button role="tab" with aria-selected, but there is no roving tabindex, no Arrow/Home/End key handling, and no aria-controls/tabpanel association. Per the WAI-ARIA tabs pattern, all tabs being individually Tab-focusable and lacking arrow navigation makes the announced role contract incomplete for screen-reader/keyboard users. The tabs change content elsewhere via onTabChange, so the tabpanel link is also absent.
- **Evidenza:** <div role="tablist" className="-mb-px flex items-center gap-0.5">
  ...
  <button ... role="tab" aria-selected={isActive} onClick={() => onTabChange(tab.value)}>
- **Fix proposto:** Either implement the full tabs pattern (roving tabindex, ArrowLeft/Right/Home/End to move selection, aria-controls pointing at the panel) or drop the tablist/tab roles and present it as a simple nav with aria-current, matching what the keyboard behavior actually supports.

#### 🟡 [low/reliability] TabNav indicator can mis-measure on first paint before web fonts load

- **Dove:** `packages/ui/src/components/tab-nav.tsx:52`
- **Confidence:** medium
- **Descrizione:** The sliding indicator is measured in a useEffect keyed on [activeTab, tabs] and on window resize, reading offsetLeft/offsetWidth of the active tab. When the bibs display font (Satoshi via Fontshare) finishes loading after first paint, tab label widths change but no remeasure is triggered, leaving the indicator misaligned until a resize or tab change. There is also no remeasure when the children slot (right-aligned controls) reflows.
- **Evidenza:** useEffect(() => {
  const measure = () => { ... activeEl.offsetLeft ... activeEl.offsetWidth };
  measure();
  window.addEventListener("resize", measure);
}, [activeTab, tabs]);
- **Fix proposto:** Add a ResizeObserver on the tablist container (like data-table does) and/or await document.fonts.ready to re-run measure, so the indicator tracks font-load and content reflow, not just activeTab/tabs/resize.

#### 🟡 [low/improvement] PersonalInfoCard autoFocuses firstName on every mount, stealing focus on navigation

- **Dove:** `packages/ui/src/components/personal-info-card.tsx:171`
- **Confidence:** medium
- **Descrizione:** The firstName Input has autoFocus. This card is a standard profile-page card (not a modal), so on route navigation the browser will jump focus and scroll to this field, overriding the user's expected top-of-page focus and hurting keyboard/screen-reader users who land mid-form. autoFocus is appropriate inside a dialog, not a persistent settings card.
- **Evidenza:** <Input id="firstName" placeholder={labels.firstNamePlaceholder} autoFocus ... />
- **Fix proposto:** Remove autoFocus from the persistent card form (or gate it behind an explicit edit-mode entry), reserving autofocus for modal/dialog contexts.

#### 🟡 [low/consistency] AvatarUploadDialog uses literal '...' instead of localized labels for in-flight save/remove buttons

- **Dove:** `packages/ui/src/components/avatar-upload-dialog.tsx:200`
- **Confidence:** high
- **Descrizione:** The dialog accepts a fully localized labels object (save/cancel/back/remove/errors) but the loading states render a hard-coded '...' string instead of a localized 'Salvataggio…'/'Rimozione…' label. This is inconsistent with the project's Paraglide i18n convention used for every other string here, and gives an untranslated, low-information busy state. The labels interface has no field for these.
- **Evidenza:** <Button ... onClick={handleSave} disabled={isSaving}>
  {isSaving ? "..." : labels.save}
</Button>
...
{isRemoving ? "..." : labels.remove}
- **Fix proposto:** Add saving/removing fields to AvatarUploadDialogLabels and render those (or a Spinner) during the in-flight state instead of the literal '...'.

#### 🟡 [low/consistency] Dropzone empty/content captions are hard-coded English, bypassing the i18n convention

- **Dove:** `packages/ui/src/components/dropzone.tsx:171`
- **Confidence:** medium
- **Descrizione:** DropzoneEmptyState and DropzoneContent emit user-facing English copy ('Upload a file', 'Drag and drop or click to upload', 'Accepts …', 'and N more') and format with Intl.ListFormat('en'), while the rest of @bibs/ui passes Italian/localized labels in via props. In an Italian-first product this default text is shipped untranslated whenever a consumer relies on the default (no children) rendering.
- **Evidenza:** <p ...>Upload {maxFiles === 1 ? "a file" : "files"}</p>
<p ...>Drag and drop or click to upload</p>
caption += "Accepts "; caption += new Intl.ListFormat("en").format(...)
- **Fix proposto:** Accept a labels prop (or render-children only) for the default empty/content states and use the active locale for Intl.ListFormat, consistent with AvatarUploadDialog/PendingVerificationBanner.

#### 🟡 [low/improvement] useCooldown interval ticks on a fixed 1000ms cadence, causing visible second-skips due to drift

- **Dove:** `packages/ui/src/hooks/use-cooldown.ts:46`
- **Confidence:** medium
- **Descrizione:** secondsRemaining = ceil(remaining/1000) is recomputed on a setInterval(…, 1000) that starts at an arbitrary phase relative to startedAt. Because the tick boundary and the ceil boundary are not aligned, the displayed countdown can occasionally hold a value for ~2s or skip a number, and the final tick may show 1 slightly longer than the true cooldown. For a resend countdown this is cosmetic but noticeable.
- **Evidenza:** const id = setInterval(() => { const next = compute(); setState(next); if (next.ready) clearInterval(id); }, 1000);
- **Fix proposto:** Align ticks to the second boundary by scheduling the next tick at remaining % 1000 (or use requestAnimationFrame / a self-correcting setTimeout) so the displayed seconds decrement crisply.

#### 🟡 [low/improvement] MunicipalityCombobox dev-only warning effect omits a referenced dependency it reads conditionally

- **Dove:** `packages/ui/src/components/municipality-combobox.tsx:107`
- **Confidence:** medium
- **Descrizione:** The selected municipality is computed via municipalities.find(...) in render, and the warning effect re-implements the same find. This is duplicated linear work (also done in the `selected` memo-less computation and the filter) over the full municipalities list on every relevant render. With the list being the full national comune set (thousands), three independent O(n) scans per render (selected lookup, warning find, plus indexing) is avoidable. Functionally correct, but the lookups could share the indexed map.
- **Evidenza:** const selected = value && municipalities ? (municipalities.find((m) => m.id === value) ?? null) : null;
...
if (value && municipalities && !municipalities.find((m) => m.id === value) && DEV) console.warn(...)
- **Fix proposto:** Build a Map<id, MunicipalityOption> once in the indexed useMemo and reuse it for the selected lookup and the dev warning, removing the repeated .find scans over the full list.

---

## Falsi positivi confutati

Questi finding sono stati scartati dal verificatore adversariale (già coperti da validazione, transazioni, o house-rule):

- **[low/reliability]** toCents returns NaN silently for malformed/empty money strings — *The NaN propagation behavior described is mathematically correct for the function in isolation (parseInt("", 10) === NaN for ".5", etc.), but the claim is refuted as a real/triggerable issue because two existing guards prevent any malformed string from ever reaching toCents:*
- **[low/reliability]** getCheckoutStatus can return status 'ready' with an undefined storeId — *The cited code path at checkout.ts:151-160 is real, but the scenario that would trigger storeId=undefined is blocked by the transaction in checkout-completed.ts (lines 39-117).*
- **[low/consistency]** store_product unique (productId,storeId) is unconditional, so a trashed product still blocks re-listing in the same store — *The schema asymmetry at product.ts:141 is real (unconditional uniqueIndex vs. the trashed-aware EAN index), but the claimed blocking scenario does not hold in practice for two reasons:*
- **[medium/reliability]** Coarse canary idempotency leaves users without profiles when a run fails between phases — *The failure mode described is technically real — Phase 1 (auth user creation) and Phase 2+ (profile/org/store inserts) are not wrapped in a transaction, and the canary check gates solely on user presence. However, the claim is refuted on house-rule grounds:*
- **[low/bug]** Env validation reports wrong key name for nested/array paths — *The cited code at line 29 is real and the JavaScript behavior described is accurate: `String.prototype.replace` with a string argument does replace only the first occurrence. However, the claim itself admits this works correctly for the current schema ("for the current flat EnvSchema all paths are top-level so it works"). The EnvSchema (lines 4-25) is a completely flat `t.Object` with 19 top-level string keys — no nested objects, no arrays, no sub-schemas. Every TypeBox error path will be of the form `/KEY_NAME` (single leading slash, no further slashes). Removing that one slash with `.replace("/", "")` produces the correct key name in every currently possible case. The bug is not triggerable today and there is no indication the schema will be nested — env var schemas are almost universally flat. This is a hypothetical future-fragility observation, not an actual bug. Severity "low" is even generous for something that cannot be triggered by the existing code. The claim should be rated as a style/defensive-coding note, not a bug.*
- **[medium/bug]** Geometry columns drift from schema: migrations create geometry(point) with no SRID, schema declares srid 4326 — *The factual evidence is accurate: 0000_init.sql lines 12 and 296 create `geometry(point)` without SRID; store.ts:37 and address.ts:31 declare `srid: 4326`; no migration between 0001 and 0012 alters these columns; and 0012_snapshot.json still records `"type": "geometry(point)"` for both columns. The ::geography casts in search.ts lines 62 and 78 are also present as cited.*
- **[low/reliability]** 0011 adds NOT NULL municipality_id columns with no DEFAULT and no backfill — *The cited evidence is factually wrong. `0011_cute_slyde.sql` is only 6 lines long and contains nothing about `municipality_id` — it only handles an onboarding_status UPDATE and adds a `stripe_customer_id` column. There is no line 12 in that file.*
- **[low/reliability]** Processing page can hang on spinner if status is ready but storeId is missing — *The claim identifies a real code pattern — `refetchInterval` stops when `status === 'ready'`, but navigation only fires when `data.status === 'ready' && data.storeId` — and correctly notes that if `storeId` is absent, the user is stuck until the 60s timeout. However, the backend makes this scenario impossible by construction.*
- **[low/bug]** Macro-category filter dropdown silently caps at 100 options — *The cited evidence is accurate — lines 151-152 do fetch `limit: 100` and line 163 uses only `macrosData?.data ?? []`. However, the claim is refuted by house rule #8: "Pagination cap is 100 by design (limit > 100 → 400 VALIDATION_ERROR). Do not flag the cap as a bug." The reviewer's own proposed fix ("loop to pagination.total") is precisely the pattern house rule #8 prohibits flagging as needed. The claim is fundamentally about the architectural 100-item pagination cap — arguing that the code should paginate past it to build a complete filter list. Since 100 is the intentional hard limit per request and the app is a local-commerce marketplace where having more than 100 macro-categories is implausible in practice, this is not a triggerable real-world bug. The claim correctly identifies the code pattern but mischaracterizes it as a defect when it is consistent with the repo's deliberate pagination convention.*
- **[low/reliability]** register parses errVal.resentAt with Date.parse without validating the result — *The NaN path requires the server to send a malformed timestamp in `resentAt`. Tracing the full contract:*
