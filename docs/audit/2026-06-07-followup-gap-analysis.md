# Analisi dei follow-up non implementati — 2026-06-07

> Analisi multi-agente di **tutti i follow-up, deferral e "sviluppi futuri" dichiarati nelle PR #1–#90** (più audit report, plan doc, doc di repo e TODO nel codice), verificati uno a uno contro `main` (post-#90, `245141b`) per stabilire cosa è stato davvero implementato nel frattempo e cosa resta scoperto. Output ordinato per priorità, pensato come input per i prossimi piani di implementazione.

## Metodologia

| Fase | Dettaglio |
|---|---|
| **Estrazione** | 17 agenti paralleli: 12 batch sulle 84 PR merged, 1 su `docs/audit/2026-05-29-repo-audit.md`, 1 sui 15 plan doc in `docs/superpowers/plans/`, 1 su CLAUDE.md/AGENTS.md/README, 1 sui TODO nel codice, 1 sulle 6 PR chiuse senza merge → **283 menzioni grezze** |
| **Clustering** | Dedup semantico → **141 cluster distinti** di lavoro deferito |
| **Verifica** | 1 agente per cluster: ricerca su codebase + `git log -S` + PR successive, con evidenze (file:riga, commit) → **19 già implementati/obsoleti, 122 ancora aperti** |
| **Critic** | Spot-check di 8 verdetti "implemented" (8/8 corretti), riscontro completo dei 150 finding confermati dell'audit (tutti rappresentati), verifica delle sezioni deferred di #80–#90 (tutte coperte), +1 gap strutturale aggiunto (build frontend in CI) |

**Contesto per la prioritizzazione**: bibs è in dev, non deployato → l'hardening production-only (Redis, probe, CD) pesa meno; i bug che toccano correttezza dati/denaro e le superfici prodotto mancanti pesano di più.

---

## Sintesi executive

1. **Esiste un bug di correttezza ad alto impatto**: le promozioni seller sono *solo cosmetiche* — il customer vede il prezzo barrato ma al checkout paga il prezzo pieno (`apps/api/src/modules/customer/services/orders.ts:259`). È il singolo fix più importante dell'intera analisi.
2. **Il gap strategico è il customer storefront**: non esiste alcuna UI customer di catalogo/ricerca/dettaglio prodotto/negozio. Almeno 8 cluster deferiti ("customer UI" da #32, #80, #82, brand/EAN search, VAT display, open-now, DiscountedPrice…) sono tutti bloccati da questa stessa assenza.
3. **Il seller non ha una pagina ordini** (deferita da #82) e la **Home seller mostra dati finti** ("3 ordini da preparare" hardcoded) — attivamente fuorviante.
4. **Manca la rete di sicurezza CI per i frontend**: zero test FE, nessun job `vite build`, TanStack pinnato a `latest` — la classe di rottura SSR già vissuta (1.167.48) non verrebbe intercettata da nulla.
5. Una coda lunga di **~70 fix piccoli e ben delimitati** (API correctness, FE reliability, a11y, hygiene) è clusterizzabile in 4–5 PR-sweep tematiche a basso rischio.
6. **Fiscale (SDI/XML, scontrino, Stripe Tax) e hardening security** (enumeration, Redis limiter, S3 policy) sono deferral *consapevoli* legati al go-live: vanno in checklist pre-produzione, non nel prossimo sprint.

---

## P0 — Bug di correttezza attivi (fix subito, PR piccole)

| # | Item | Evidenza | Impatto | Effort |
|---|---|---|---|---|
| **P0.1** | **Applicare gli sconti al checkout** (+ snapshot prezzo su `order_item`) — oggi le promo percentuali sono display-only: il customer paga prezzo pieno | `customer/services/orders.ts:259` addebita `toCents(sp.product.price)`; solo lo sconto punti viene applicato (286-299). Confermato dal critic | **Correttezza/fiducia HIGH** — ordini "scontati" fatturati a prezzo pieno | M |
| **P0.2** | **Flusso forgot-password** — il link "Hai dimenticato la password?" naviga su `/forgot-password` che **404** (cast `as any` bypassa il router tipato) | `pending-verification-banner-connected.tsx:49-52`; endpoint better-auth `/forget-password` già esistente e rate-limited (`lib/auth.ts:68`); infra `@bibs/emails` pronta (PR #90, era già follow-up dichiarato) | Utenti customer+seller senza recovery path; link rotto in produzione UI | S–M |
| **P0.3** | **Bug orari di apertura** (da #73/#78): (a) all-days-off collassa a `undefined` e il PATCH lo scarta in silenzio; (b) store con hours null mostra orari DEFAULT e li persiste a ogni save; (c) nessuna validazione overlap/close>open; (d) Save resta enabled post-save; (e) phantom isDirty su websiteUrl | 4 dei 5 sub-bug di #73 ancora aperti; overlap validation mai fatta | Orari errati alimentano l'`openStatus` customer-facing (#80) — il cliente può vedere aperto/chiuso sbagliato | M |
| **P0.4** | **Double-subscription su resume checkout**: re-POST di `/stores/checkout` dopo pagamento ma prima del webhook → expire della session pagata + seconda subscription | `checkout.ts` ~riga 65: manca il branch `session.status === 'complete'`; il fall-through expire-and-recreate va ristretto a `status === 'expired'` | Denaro: doppio addebito potenziale. Il caso orfano-sub è chiuso (#72), questo è il residuo | S |
| **P0.5** | **Accuratezza billing summary**: `nextRenewal` seller mostra la data di *cancellazione* di una sub canceling come "prossimo rinnovo"; MRR admin include past_due/canceling | `seller/routes/billing.ts:58-75`; `getBillingOverview` admin | Dashboard fuorvianti per seller e admin (era nel MEDIUM "billing accuracy" dell'audit) | S |
| **P0.6** | **Parser CSV rompe su campi quotati multi-riga** → corruzione silenziosa import prodotti/categorie da Excel/Sheets | `lib/utils/csv.ts` splitta su `\n` prima di `parseCsvLine` — confermato dal critic | Corruzione dati silenziosa su un flusso seller/admin reale | S |
| **P0.7** | **birthDate cancellata non persiste**: "" → `undefined` → campo omesso → il vecchio valore resta in DB | `PersonalInfoCard` (packages/ui) + `customer/routes/_authenticated/profile.tsx` | Bug dati profilo (customer; pattern identico in admin/seller) | S |
| **P0.8** | **QueryClient singleton in SSR** — cache condivisa tra richieste concorrenti sul server (3 app). Oggi innocuo (solo municipalities prefetchate), ma il primo loader che prefetcha dati per-utente diventa un leak cross-utente | `apps/{admin,seller,customer}/src/integrations/tanstack-query/root-provider.tsx` — guard `typeof window === "undefined"` → fresh client | Hazard latente di data-isolation; fix banale, da fare *prima* che morda | S |

**Suggerimento di taglio**: P0.1 PR dedicata (tocca pricing+ordini+test); P0.2 PR dedicata; P0.3 PR dedicata (store hours); P0.4+P0.5 insieme (billing correctness); P0.6+P0.7+P0.8 insieme (sweep correctness misti) — ~5 PR.

---

## P1 — Superfici prodotto mancanti (strategiche, plan-level)

| # | Item | Cosa serve | Note | Effort |
|---|---|---|---|---|
| **P1.1** | **Customer storefront** (l'ombrello che sblocca ~8 cluster deferiti) | Route ricerca/lista con product card (sconti via `DiscountedPrice` *dopo* fix dei suoi 2 bug latenti), dettaglio prodotto, pagina negozio con **open-now/orari/chiusure** (#80), ricerca per **brand/EAN** lato API customer (`search.ts` non li cerca), **VAT display** (serve esporre `vatRate` nello schema search), wiring Eden + Paraglide | Il backend è pronto: prezzi scontati calcolati, openStatus, VAT snapshot. È lavoro additivo FE+schema. **Prerequisito logico: P0.1** (prezzi onesti) | XL |
| **P1.2** | **Pagina ordini seller + castelletto IVA** (deferita da #82) | Route `/orders` + `/orders/$orderId`, feature dir, nav entry, render di `order.vatBreakdown` (imponibile/imposta per aliquota) + `vatRate` per riga, azioni di transizione (PATCH già esistente) | I dati sono già tutti restituiti dagli endpoint seller. Sblocca anche P1.3 | M–L |
| **P1.3** | **Home seller con dati veri** (oggi: "3 ordini da preparare", "Venerdì 22 maggio" hardcoded) | Aggregazioni reali: conteggio ordini pending, stock-zero/low (serve concetto di soglia), promo in scadenza, stats strip; data reale | **Attivamente fuorviante** oggi; alto valore prodotto. Dipende in parte da P1.2 | M |

---

## P2 — Rete di sicurezza CI/test (leva alta, una tantum)

| # | Item | Dettaglio | Effort |
|---|---|---|---|
| **P2.1** | **Pin TanStack a versioni esatte** (drop `latest`) + **job CI `vite build` per i 3 frontend** *(gap aggiunto dal critic — nessun cluster lo copriva)* | `latest` nel catalog = install non riproducibili + la rottura SSR 1.167.48 non verrebbe intercettata: typecheck non esercita bundler/SSR. Lockfile già skewed (react-start 1.168.24 vs router 1.170.15). Aggiornare AGENTS.md:210 | S |
| **P2.2** | **Gate test frontend**: oggi 0 test FE; admin ha vitest infra *morta* (script `test` senza config né file) | Decidere: (a) rimuovere l'infra morta, oppure (b) vitest condiviso + ≥1 smoke test per app + job CI. Più: smoke browser ripetibile (Playwright) agganciato al flusso deps-upgrade | M |
| **P2.3** | **Harness HTTP-auth per route-guard**: il macro auth/`requireOwner` non è testato end-to-end; 3 dei 6 route file owner-only scoperti (employees, settings, billing) + 2 test acceptInvite skippati + test integrazione pending-email-resend (cascade FK, mail failure, TTL DELETE) | Regression-safety su security/authz — un guard sbagliato passerebbe i test attuali | M |
| **P2.4** | **Job CI docker build** (deferito da #3 "by design") | Build-only su PR contro `apps/api/Dockerfile`; rischio rotture scoperte solo al deploy | S |

---

## P3 — Hardening pre-go-live (checklist deploy, non sprint corrente)

Deferral *consapevoli e corretti* finché bibs non va in produzione — ma vanno tracciati come gate di go-live:

- **P3.1 Fiscale** *(gate assoluto per vendite reali)*: SDI/XML e-fattura, scontrino telematico/RT, Stripe Tax + P.IVA su Customer Stripe (`tax_id_data`/`automatic_tax` assenti), codici natura esenzione (oggi solo aliquota "0"); **apportionment sconto-punti sul castelletto** (oggi il castelletto somma più del totale addebitato su ordini misti con punti — da fare insieme al layer fatturazione).
- **P3.2 Security**: uniformare le risposte di enumeration email su `/register/*` (oggi 3 stati distinguibili); rate-limiter Redis-backed prima dello scale-out; **policy S3 bucket** non world-readable (critico dal momento in cui esisteranno fatture/export privati); pino redact path-based per payload annidati; timeout sul check S3 della readiness probe; logout forzato per non-admin che fa login sull'app admin (session cookie vivo + dead-end).
- **P3.3 Operatività Stripe**: cron di riconciliazione periodica (sub orfane, eventi `processedAt=null` stuck) + endpoint admin di replay/recovery; robustezza webhook (currentPeriodEnd dalla line item giusta su invoice multi-riga, disambiguazione signature via `ServiceError`, tx su processedAt); validazione `productId` in updatePricing admin.
- **P3.4 CD/deploy**: nessuna pipeline di deploy/secrets esiste — *omissione consapevole* (flag del critic), diventa P0 il giorno che si decide di deployare.

---

## P4 — Sweep di fix minori (1 PR tematica ciascuno, basso rischio)

### P4.1 — API correctness sweep (~10 item)
- **Guard di stato su verifySeller/rejectSeller** (admin può ri-verificare un rejected o ri-rejectare un active — il più significativo del gruppo)
- EAN prefill scope (esclude trashed + altri seller), updatedAt bump su update categorie-only, validazione FK macro-categorie in create/update product
- 409 su collisione VAT in `requestVatChange` (oggi il seller resta bloccato in silenzio); insert-then-upload su requestDocumentChange; scoping query settings a `status=pending`
- `isNull(deletedAt)` su invito/assegnazione employee a store soft-deleted; resend idempotente su invito con mail fallita
- Schema tightening: `t.Integer` su position/stock (oggi frazionario → 500), `format:'date'` su birthDate/documentExpiry, dedup PhoneNumber POST/PATCH
- Bounds su `radius` ricerca (oggi 1e9/negativo passano a ST_DWithin) + fix log `hasGeoFilter` su coord 0
- Escape wildcard LIKE (`%`/`_`) sui ~10 call site ILIKE
- Semantica pickup customer su ordini pay_deliver (oggi il customer può auto-completare una consegna)
- Dedup doppio ownership-check in `transitionOrder`; TOCTOU cap immagini (documentare best-effort o tx)

### P4.2 — Seller FE reliability sweep (~8 item)
- Guard NaN/clamp su search param `page`/`limit` (4 route seller+admin → oggi 400 screen con `?page=abc`)
- Sanitizzazione input prezzo/stock (store-assignment, product-selector: debounce + regex)
- Race stock-editor: gate del commitSet su adjust in-flight
- Helper centralizzato `extractApiError` (oggi toast vuoti/generici in ~14 siti)
- Invalidate `seller-categories-in-use` nelle mutation; drop `activeStoreId` inutilizzato; reorder dropzone ridondante; reset form discount su navigazione diretta; errore prefill checkout su `/store/new?cancel=`; gating query onboarding a role seller

### P4.3 — Admin FE sweep (~4 item)
- Paginazione pagina subscriptions (oggi hardcoded 1/50 — righe 51+ irraggiungibili)
- Pricing dialog: guard NaN/empty + disable Conferma (+ migrazione RHF+zod)
- Body tipato in reject-change + validazione per-changeType di `changeData` (via gli `as string` cast)

### P4.4 — Shared UI / a11y sweep (~8 item)
- **A11y form seller** (da #84): `htmlFor`/`id` su Brand/Macrocategoria/Categorie (WCAG 1.3.1/4.1.2), touch target ≥24px sui chip-remove
- TabNav: contratto ARIA tabs completo (roving tabindex, frecce) o downgrade a `nav`+`aria-current`; re-measure indicator su font load
- Clamp pagina out-of-range in DataPagination; rimozione `autoFocus` PersonalInfoCard; label localizzate AvatarUploadDialog; default Dropzone localizzabili (prop `labels`); cooldown verify-email armato solo dopo invio reale; tick useCooldown allineati al secondo
- Polish layout: FormSection su /profile, sticky save bar su /store, logout/profilo nel sidebar foot, blue→cobalt residui (3 siti promo), PageSizeSelector su /team

---

## P5 — Refactor architetturali/DX (opportunistici)

- **`@bibs/app-kit`** (raccomandazione audit): dedup di api.ts/env.ts/root-provider/devtools/auth-client triplicati + AuthGuard + AuthCardShell condivisi (~110-130 LOC congelate ×3). Buon veicolo anche per P0.8 (QueryClient per-request) e per `customer-env-bypass`.
- **Riorganizzazione interna API**: modulo `catalog/` (i read pubblici oggi importano da admin/services), consolidamento `jobs/`, relocate order-domain fuori da `lib/`, dissolve `lib/queries.ts`, relocate `lib/schemas/forms` nel modulo seller (con `VatRateSchema` che resta cross-module), documentare le convenzioni di sub-struttura moduli.
- **Helper condivisi**: flatten municipality (~12 copie inline), `reshapeWithMunicipality`.
- **Hygiene**: rimozione dead code (DiscountedPrice — o fix dei 2 bug se si tiene per P1.1 —, BetterAuthHeader ×2, use-seller-profile stale, deleteStore export), dep morta `@tanstack/match-sorter-utils`, riattivare Biome sui componenti bibs-authored in packages/ui (21 errori mascherati, incluso un useExhaustiveDependencies reale), pin versione Bun (packageManager + CI), determinismo seed (store soft-deleted con prodotti/staff, catch vuoti), preload Satoshi su customer/admin (oggi scaricano Bricolage *e non lo usano*), riconciliazione doc drift (endpoint count ~60 vs ~175 reali, moduli non documentati, /health descritto male), alias `@/*` cross-workspace (export `OnboardingStatus` da @bibs/api), convenzione `features/` documentata, migrazione stringhe seller a Paraglide, brand token docs (README "radix-nova/zinc" stale).
- **Deps major residue**: react-day-picker 9→10 (shadcn Calendar), @types/node 22→25 (legato al runtime Node), recharts 2→3 (dead code finché non nasce un chart — rinviabile a oltranza).

---

## P6 — Backlog di prodotto (by design, da pianificare quando servono)

- **Billing future work** (da #60): i 2 a maggior valore sono **email branded di dunning/cancellazione** (infra @bibs/emails pronta, 3 template) e **riattivazione self-service di store canceled** (oggi serve intervento manuale admin/Stripe). Poi: dispute handler, multi-currency, Connect payouts, analytics, up/downgrade piano.
- **Catalogo brand admin-curato** + bulk edit brand + delete brand (oggi free-text find-or-create → "Nike"/"nike" proliferano).
- **Permessi granulari employee** (oggi binario owner/employee; scaffolding better-auth `permissions.ts` con statements vuoti) + edit storeIds su invito pending.
- **UI audit-log prodotti** (+ cron purge) — il trail è già scritto, manca la lettura.
- Push real-time de-assign/ban employee; preferenza `activeStoreId` server-side (modulo `me/`); filtri brand/macro in ProductPickerSheet; GC S3 orfani (avatar + store cancellati — il leak più grosso); tooling partner civici (Comuni — MVP pill inclusa); deliverable logo/brand; agent tooling (.claude/agents reviewer, skill new-api-endpoint); adozione blocchi shadcnblocks (gated su landing customer); item micro (combobox relocate+Map lookup, docstring stale expire-reservations, nota token-invalidation better-auth, greeting local-part nelle email #90).

---

## Già chiusi nel frattempo (19 cluster — nessuna azione)

La verifica ha confermato già implementati/obsoleti, tra gli altri: promotions module (#32), authz employee su images/discounts (#70), signup atomico + CORS guard + cleanups registration (#71), guard reservation-expiry su completion seller (#75), collision position immagini (#75), validazione date discount (CHECK in schema), stale store-form su switch (#73), navigate render-phase (#74), allineamento OpenAPI/Eden 409 (#79), migrazione DataTable completa, "duplicate product to another store" (obsoleto), prerequisiti operator Stripe (obsoleti).

---

## Raccomandazione di sequenza

1. **Subito (1–2 settimane di PR piccole)**: P0 completo (~5 PR) + P2.1 (pin TanStack + build job, mezz'ora ben spesa).
2. **Primo piano grosso**: P1.1 customer storefront (con P0.1 come prerequisito già chiuso) — è il gap che tiene bloccati più cluster e definisce il prodotto.
3. **In parallelo/alternanza**: P1.2+P1.3 (ordini seller + home vera), P2.2–P2.4 (test gate), e una P4 sweep ogni tanto come "palate" a basso rischio.
4. **Al primo segnale di go-live**: P3 diventa la checklist bloccante (fiscale in testa, poi security e riconciliazione Stripe).

---

*Fonte: workflow multi-agente `pr-followup-audit` (run `wf_0a906c73-336`, 160 agenti). Evidenze complete per ciascuno dei 122 cluster (file:riga, commit, ricerche di assenza) nell'output del run.*
