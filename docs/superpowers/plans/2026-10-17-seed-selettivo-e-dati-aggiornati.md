# Seed selettivo e dati del seed aggiornati — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `db:seed --only=<admin|customer|seller>`, procedura per svuotare Stripe, e un seed i cui dati
l'app accetta e mostra correttamente, con un catalogo coerente col tipo di negozio.

**Architecture:** Il seed resta una sequenza di fixture idempotenti in `apps/api/src/db/seed/`; la
selezione decide quali gruppi di fixture girano. Le correzioni stanno nei fixture e nei CSV del
dizionario; l'unica modifica all'app è in `modules/seller/services/stores.ts` (C4). Le logiche pure
nuove (selezione, generatore seller, catalogo, regole delle caratteristiche) hanno test unitari; i
fixture si verificano seminando un DB di prova e interrogandolo.

**Tech Stack:** Bun 1.4, TypeScript, Drizzle ORM, PostgreSQL/PostGIS, better-auth, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-10-17-seed-selettivo-e-dati-aggiornati-design.md` (le sigle
C1–C10, D1–D4 rimandano lì).

## Global Constraints

- Branch dedicato da `main` aggiornato, in un worktree (superpowers:using-git-worktrees). Mai commit
  su `main`. Una sola PR alla fine (Task 11).
- Commit Conventional Commits; scope: `db` (seed), `stores` (C4), `products` (dizionario), `docs`.
- Mai codice dell'app che riconosce i dati del seed (niente `startsWith("sub_seed_")` & co.).
- Il DB di sviluppo (`bibs-db`) non si tocca. Ogni verifica gira su `bibs_seedcheck` (sotto).
- Test API: `bun run test:unit` / `bun run test` dentro `apps/api` (mai `bun test` nudo).
- Prima di ogni commit: `bun run typecheck` e `bun run lint` dalla root verdi.
- Regola dei «due pool» e dei passi coprimi (`apps/api/AGENTS.md`, sezione `utils.ts`): non si
  riordinano né si allungano `businessPrefixes`, `bolognaPrefixes`, `SEED_MUNICIPALITIES`.
- Seller di riferimento per gli stati D4: `seller11@test.com` (idx 10) negozio senza posizione,
  `seller14@test.com` (idx 13) negozio senza foto, `seller18@test.com` (idx 17) negozio senza
  abbonamento. Nessuno dei tre è in team, extra-stores o ordini.
- Tutti i test user hanno password `password123`.

### DB di prova (`SEEDCHECK`)

Ricrea un DB vuoto e lancia il seed. I task lo citano come «`SEEDCHECK` [args]»:

```bash
docker exec bibs-postgis psql -U pgadmin -d bibs-db -c "DROP DATABASE IF EXISTS bibs_seedcheck" -c "CREATE DATABASE bibs_seedcheck"
docker exec bibs-postgis psql -U pgadmin -d bibs_seedcheck -c "CREATE EXTENSION postgis" -c "CREATE EXTENSION pg_trgm"
cd apps/api
export DATABASE_URL='postgres://pgadmin:P4ssword!@localhost:5432/bibs_seedcheck'
bunx drizzle-kit migrate
bun run src/scripts/seed.ts [args]   # exit 0 atteso
```

Le query di verifica: `docker exec bibs-postgis psql -U pgadmin -d bibs_seedcheck -c "<sql>"`.
`drizzle-kit migrate` può fallire muto: se `select count(*) from information_schema.tables where
table_schema='public'` non è ~50, applica `src/db/migrations/0000_init.sql` con psql per vedere
l'errore.

## Review Focus

1. **`--only=seller` senza customer** → il seed finisce con exit 0 e zero ordini, anche quelli del
   catalogo dev (Task 1, verifica dedicata).
2. **Opzione scritta male** (`--only=sellers`, `--onyl=seller`) → exit 1 con l'uso, prima di toccare
   il DB (Task 1, test `parseSeedArgs`).
3. **seller1 deve restare vendibile** dopo che C10 cambia l'ordine dei negozi e D4 toglie
   abbonamento/foto/posizione ad altri: se il suo negozio finisce `suspended`/`canceled`, gli ordini
   spariscono in silenzio (log «senza negozi»). Task 8 verifica che gli ordini siano 12 + 6.
4. **Annullamento di un abbonamento con errore Stripe diverso da `resource_missing`** → comportamento
   identico a oggi, nessuna finalizzazione locale (Task 4, test esistenti «stripe down» restano verdi).
5. **Nome di prodotto con una quantità** («Spaghetti 500 g») → nessun valore di peso/formato che la
   contraddica (Task 7, test `skippedCharacteristics`).

---

### Task 1: Seed selettivo e procedura «Ripartire puliti»

**Files:**
- Create: `apps/api/src/db/seed/groups.ts`
- Modify: `apps/api/src/scripts/seed.ts`, `apps/api/src/db/seed/index.ts`,
  `apps/api/src/db/seed/fixtures/index.ts`, `apps/api/src/db/seed/fixtures/dev-seller-catalog.ts`
- Modify (docs): `AGENTS.md` (riga comandi `db:seed`/`db:reset`), `docs/stripe-billing.md`
- Test: `apps/api/tests/unit/seed-groups.test.ts`

**Interfaces:**
- Produces:
  - `export const SEED_ONLY = ["admin", "customer", "seller"] as const;`
  - `export type SeedOnly = (typeof SEED_ONLY)[number];`
  - `export interface SeedGroups { customer: boolean; seller: boolean; orders: boolean }`
  - `export function seedGroups(only?: SeedOnly): SeedGroups`
  - `export function parseSeedArgs(argv: string[]): SeedOnly | undefined` — lancia `Error` il cui
    messaggio contiene `admin, customer, seller` su valore o opzione sconosciuti.
  - `seed(only?: SeedOnly): Promise<void>` (index.ts), `seedFixtures(groups: SeedGroups)`.
  - `export async function seedDevSellerOrders(): Promise<number>` in `dev-seller-catalog.ts`:
    risolve da sé `seller@dev.bibs` e «Bottega Dev», salta (ritorna 0) se il negozio ha già ordini o
    non ci sono customer.

- [ ] **Step 1: Test che fallisce** — `tests/unit/seed-groups.test.ts`:

```ts
expect(seedGroups()).toEqual({ customer: true, seller: true, orders: true });
expect(seedGroups("customer")).toEqual({ customer: true, seller: false, orders: false });
expect(seedGroups("seller")).toEqual({ customer: false, seller: true, orders: false });
expect(seedGroups("admin")).toEqual({ customer: false, seller: false, orders: false });
expect(parseSeedArgs([])).toBeUndefined();
expect(parseSeedArgs(["--only=customer"])).toBe("customer");
expect(parseSeedArgs(["--only", "seller"])).toBe("seller");
expect(() => parseSeedArgs(["--only=sellers"])).toThrow(/admin, customer, seller/);
expect(() => parseSeedArgs(["--onyl=seller"])).toThrow(/admin, customer, seller/);
```

- [ ] **Step 2:** `cd apps/api && bun test tests/unit/seed-groups.test.ts` → FAIL (modulo assente).
- [ ] **Step 3: Implementa `groups.ts`** con `parseArgs` di `node:util` (`strict: true`,
  `options: { only: { type: "string" } }`); intercetta l'errore di `parseArgs` e rilancia col
  messaggio d'uso. Nessun import da `@/db` in questo file.
- [ ] **Step 4:** stesso comando → PASS.
- [ ] **Step 5: Cabla la selezione.**
  - `seed.ts`: `parseSeedArgs(process.argv.slice(2))` dentro try; su errore `console.error` del
    messaggio + `process.exit(1)` **prima** di importare/usare il DB (import dinamico di `@/db/seed`
    e `@/db` dopo il parsing, così un argomento sbagliato non apre il pool).
  - `seed(only)`: logga la modalità («🌱 Seeding database (solo customer)…» / «(tutto)»), poi
    `seedBase()` e `seedFixtures(seedGroups(only))`.
  - `seedFixtures(groups)`: sempre `seedPricingConfig`, `seedAdmins`; se `groups.customer`:
    `seedCustomers`; se `groups.seller`: da `seedDevSeller` a `seedDiscounts` nell'ordine di oggi;
    se `groups.orders`: `seedOrders`, poi `seedDevSellerOrders`.
  - `dev-seller-catalog.ts`: togli la chiamata a `seedDevOrders` da `seedDevSellerCatalog` (e
    l'«N ordini» dal suo log); `seedDevOrders(storeId, sellerProfileId)` resta privata e la chiama
    `seedDevSellerOrders()`.
- [ ] **Step 6: `db:reset` con argomenti.** `bun run db:reset -- --only=customer` dalla root deve
  arrivare a `seed.ts`. Verifica senza distruggere niente: `bun run db:seed -- --only=foo` dalla
  root → exit 1 col messaggio d'uso (prova che l'argomento attraversa i due `bun run`). Se non
  arriva, modifica lo script `db:reset` nel modo più piccolo che funziona.
- [ ] **Step 7: Verifica sul DB di prova** — quattro giri, ognuno su DB ricreato:
  - `SEEDCHECK` → exit 0; `select count(*) from orders` = 18 (12 + 6).
  - `SEEDCHECK --only=customer` → exit 0; `seller_profiles`, `stores`, `orders` = 0; `"user"` con
    `role='customer'` = 300, `role='admin'` = 3.
  - `SEEDCHECK --only=seller` → exit 0; `orders` = 0; `customer_profiles` = 0; seller > 0.
  - `SEEDCHECK --only=admin` → exit 0; `"user"` = 3.
- [ ] **Step 8: Docs.**
  - `AGENTS.md`, riga `db:seed` / `db:reset`: aggiungi `-- --only=admin|customer|seller`.
  - `docs/stripe-billing.md`: nuova sezione «Ripartire puliti» con i tre passi della parte B della
    spec (dashboard: *Developers → Overview → Test data → Review test data → Delete test data*, su
    dashboard recenti dentro il pannello Workbench, tasto `~`; poi `stripe:bootstrap` +
    `STRIPE_DEV_PRICE_ID` in `apps/api/.env`; poi `bun run db:reset -- --only=customer`), col perché
    dell'ordine. Cita `stripe docs /testing-use-cases` come fonte.
- [ ] **Step 9: Commit** — `feat(db): seed selettivo con --only e procedura per ripartire puliti`.

---

### Task 2: Ordini e promozioni (C1, C3, C8, C9)

**Files:**
- Modify: `apps/api/src/db/seed/fixtures/discounts.ts:186-194`, `fixtures/orders.ts`,
  `fixtures/dev-seller-catalog.ts` (`seedDevOrders`)

**Interfaces:**
- Consumes: `seedDevSellerOrders()` (Task 1).
- Produces: `export const SEED_RESERVATION_DAYS = 30` in `fixtures/utils.ts`;
  `export function seedCustomerEmails(n: number): string[]` in `fixtures/utils.ts`
  → `["customer1@test.com", …, "customer<n>@test.com"]`.

- [ ] **Step 1: Stato attuale (deve fallire)** — `SEEDCHECK`, poi:
  - `select count(distinct seller_profile_id) from discounts` → oggi 1 (atteso ≥ 60 dopo).
  - `select count(*) from orders where type='pay_pickup'` → oggi 5 (atteso 0).
  - `select count(*) from orders o join customer_profiles cp on cp.id=o.customer_profile_id join "user" u on u.id=cp.user_id where u.email in ('customer1@test.com','customer2@test.com','customer3@test.com','customer4@test.com','customer5@test.com')` → oggi 0 (atteso > 0).
  - `select min(reservation_expires_at - now()) from orders where status in ('confirmed','ready_for_pickup')` → oggi ~48 h (atteso > 29 giorni).
- [ ] **Step 2: C1** — il canary di `seedDiscounts` conta solo gli sconti dei seller con email
  `seller%@test.com` (join `seller_profiles` → `user`); il seller dev (`seller@dev.bibs`) non lo fa
  più scattare.
- [ ] **Step 3: C3** — in `orders.ts` `Plan` perde `type`; i 5 piani `pay_pickup` diventano
  `reserve_pickup` con lo stesso `end` (12 ordini restano 12). Via il ramo `pay_pickup`, l'import di
  `cancelUnpaidOrder` e il commento relativo; `createOrder` riceve `type: "reserve_pickup"`.
- [ ] **Step 4: C9** — `orders.ts` e `seedDevOrders` scelgono i customer con
  `inArray(user.email, seedCustomerEmails(n))`, ordinati secondo quella lista (non per email
  alfabetica).
- [ ] **Step 5: C8** — a fine `seedOrders()` e a fine `seedDevOrders()` un solo UPDATE: per gli
  ordini del negozio con `type='reserve_pickup'` e `status in ('confirmed','ready_for_pickup')`,
  `reservationExpiresAt = now + SEED_RESERVATION_DAYS giorni`. Dopo il loop, così nessuna
  transizione lo ricalcola. Le scadute volute (`orders.ts:142`, `dev-seller-catalog.ts:562`)
  restano.
- [ ] **Step 6: Verifica** — `SEEDCHECK`, le quattro query dello Step 1 danno i valori attesi; in
  più `select count(*) from orders` = 18 e nessun «already seeded» nel log.
- [ ] **Step 7: Controllo pagine (C8)** — leggi come `reservationExpiresAt` è mostrato in
  `apps/seller/src/routes/_authenticated/orders/index.tsx`, `orders/$orderId.tsx`,
  `apps/customer/src/routes/_authenticated/orders/index.tsx`, `orders/$orderId.tsx`: con 30 giorni
  non deve uscire niente di rotto (testo, countdown negativo, formattazione). Annota l'esito per la
  PR; se una pagina va in errore, fermati e segnala.
- [ ] **Step 8: Commit** — `fix(db): promozioni, ordini e prenotazioni del seed di nuovo coerenti`.

---

### Task 3: Seller in onboarding e documenti (C2, C7, D1)

**Files:**
- Modify: `apps/api/src/db/seed/fixtures/sellers.ts`, `fixtures/dev-seller.ts`
- Test: `apps/api/tests/unit/seed-sellers.test.ts`

**Interfaces:**
- Produces (in `sellers.ts`):
  - `export function generateSellersSeedData(): SellerSeedData[]` (oggi non esportata).
  - `SellerSeedData` cambia: `emailVerified: boolean`; `org: {...} | null` con `vatNumber` e
    `vatStatus` spostati dentro `org`; `profileFields.documentImage: { key: string; url: string } | null`.

- [ ] **Step 1: Test che fallisce** — `tests/unit/seed-sellers.test.ts` su
  `generateSellersSeedData()`:

```ts
const data = generateSellersSeedData();
expect(data).toHaveLength(190);
const withOrg = new Set(["pending_review", "active", "rejected"]);
for (const s of data) {
  expect(s.org !== null).toBe(withOrg.has(s.onboardingStatus));
  expect(s.emailVerified).toBe(s.onboardingStatus !== "pending_email");
  if (s.onboardingStatus === "pending_email" || s.onboardingStatus === "pending_personal")
    expect(s.name).toBe(s.email.split("@")[0]);
  const { documentType, documentNumber, documentImage } = s.profileFields;
  expect(documentImage !== null).toBe(documentType !== null);
  if (documentType) expect(isValidDocumentNumber(documentType, documentNumber!)).toBe(true);
}
const types = new Set(data.map((s) => s.profileFields.documentType).filter(Boolean));
expect(types).toEqual(new Set(["identity_card", "driving_license", "passport"]));
// CIE elettronica presente, non solo la cartacea
expect(data.some((s) => s.profileFields.documentType === "identity_card"
  && /^[A-Z]{2}\d{5}[A-Z]{2}$/.test(s.profileFields.documentNumber!))).toBe(true);
```

- [ ] **Step 2:** `bun test tests/unit/seed-sellers.test.ts` → FAIL.
- [ ] **Step 3: Implementa.**
  - Riga azienda (e partita IVA) solo per `pending_review`/`active`/`rejected` (C2); Phase 3 di
    `seedSellers` inserisce solo le righe con `org !== null`.
  - `emailVerified: false` per `pending_email`; `name` = parte locale dell'email per
    `pending_email` e `pending_personal`, come `modules/registration/services.ts:107` (C7). Phase 1
    usa `data.emailVerified`.
  - Documenti per idx (D1), sempre unici: `idx % 6` in 0–2 → CIE `CA${idx 5 cifre}AB`; 3 → carta
    cartacea `AX${idx+1 7 cifre}`; 4 → patente `U1${idx 7 cifre}Z`; 5 → passaporto `YA${idx+1 7 cifre}`.
  - Foto segnaposto per chi ha il documento (`hasDocument`, cioè anche `pending_company`, che il
    documento l'ha già caricato): `url: https://picsum.photos/seed/doc-${idx}/800/500`,
    `key: picsum-doc-${idx}`; scritte in `documentImageUrl`/`documentImageKey`.
  - `dev-seller.ts`: documento `identity_card` `CA12345AB` + foto segnaposto `doc-dev`.
- [ ] **Step 4:** stesso comando → PASS.
- [ ] **Step 5: Verifica** — `SEEDCHECK`, poi
  `select sp.onboarding_status, count(o.id) orgs, bool_or(u.email_verified) any_verified, count(sp.document_image_url) imgs from seller_profiles sp join "user" u on u.id=sp.user_id left join organizations o on o.seller_profile_id=sp.id group by 1 order by 1`
  → `orgs` = 0 per `pending_company/document/personal/email`; `any_verified` = false solo per
  `pending_email`; `imgs` > 0 da `pending_company` in su. Apri il link della foto di un seller in
  revisione nell'admin (`/sellers/<id>`, «Vedi documento») — oppure, senza app accesa, verifica che
  `apps/admin/src/routes/_authenticated/sellers/$sellerId.tsx:208` usi l'URL così com'è.
- [ ] **Step 6: Commit** — `fix(db): seller in onboarding come il flusso vero, con foto e tipi di documento`.

---

### Task 4: Abbonamento sparito da Stripe (C4)

**Files:**
- Modify: `apps/api/src/modules/seller/services/stores.ts:275-360`,
  `apps/api/src/db/seed/fixtures/billing-subscriptions.ts:58` (commento)
- Test: `apps/api/tests/integration/seller-stores-cancel.test.ts`

**Interfaces:**
- Produces: nessuna API nuova; `cancelStoreSubscription` può ora ritornare
  `{ status: "canceled", effectiveAt: Date }` anche dai rami `active`/`past_due`.

- [ ] **Step 1: Test che falliscono** — nel file esistente, con
  `const missing = () => Object.assign(new Error("No such subscription"), { code: "resource_missing" });`:
  - `it.each(["active", "past_due"])("%s → Stripe resource_missing → chiuso in locale")`:
    `subUpdate.mockRejectedValueOnce(missing())`; risultato `status === "canceled"`; riga
    abbonamento `status === "canceled"`, `canceledAt` non null, `cancelReason === "seller_canceled"`;
    `store.deletedAt` non null.
  - `"suspended → Stripe resource_missing → chiuso in locale, cancelReason resta seller_canceled"`
    con `subCancel.mockRejectedValueOnce(missing())`: stesse asserzioni.
  - `"reactivate canceling → Stripe resource_missing → 409, riga invariata"`: rejects con
    `ServiceError` di status 409; `cancelAtPeriodEnd` ancora true, `status` ancora `canceling`.
- [ ] **Step 2:** `cd apps/api && bun run test:image && bun test tests/integration/seller-stores-cancel.test.ts --timeout 180000`
  → i nuovi FAIL, gli esistenti PASS.
- [ ] **Step 3: Implementa** in `stores.ts`, sul precedente di
  `jobs/auto-cancel-suspended-stores.ts:66-80`:
  - `function isStripeResourceMissing(err: unknown): boolean` → `(err as { code?: string }).code === "resource_missing"`.
  - `async function finalizeGoneSubscription(sub): Promise<CancelResult>`: abbonamento
    `status "canceled"`, `canceledAt now`, `cancelReason "seller_canceled"`; negozio `deletedAt now`
    con guardia `isNull(store.deletedAt)`; ritorna `{ status: "canceled", effectiveAt: new Date() }`.
  - Ramo `active`/`past_due`: try/catch attorno a `subscriptions.update`; se missing →
    `finalizeGoneSubscription`, altrimenti rilancia.
  - Ramo `suspended`: nel catch, se missing → `finalizeGoneSubscription` **senza** il revert del
    `cancelReason`; altrimenti revert + rilancia come oggi.
  - `reactivateStoreSubscription`: se missing → `ServiceError(409, "L'abbonamento di questo negozio non esiste più: crea un nuovo negozio")`.
  - Nessuna email (`notifyStoreCanceled` non si chiama: come il job).
  - Commento in `billing-subscriptions.ts:58`: togli «recoverable via portal», scrivi che le
    azioni di fatturazione su questi abbonamenti finti chiudono in locale (annulla) o rispondono
    409 (riattiva).
- [ ] **Step 4:** stesso comando dello Step 2 → tutto PASS.
- [ ] **Step 5: Commit** — `fix(stores): annullare un abbonamento che Stripe non ha più chiude il negozio in locale`.

---

### Task 5: Dizionario — sotto-categorie alimentari e «Macchine caffè» (C6, parte dati)

**Files:**
- Modify: `apps/api/src/db/seed/data/product_categories.csv`,
  `data/product_characteristics.csv`, `data/product_category_characteristics.csv`,
  `docs/products/caratteristiche-nota-di-revisione.md` (conteggi e nuove voci)

**Interfaces:**
- Produces: le 11 sotto-categorie e le caratteristiche nuove qui sotto, con questi nomi esatti
  (Task 6 e 7 li usano).

- [ ] **Step 1:** `bun run apps/api/src/db/seed/data/validate-characteristics.ts` (dalla root) → oggi PASS: è la rete.
- [ ] **Step 2: Sotto-categorie** — 11 righe `Alimentari e bevande,<nome>` in
  `product_categories.csv`: Pane e prodotti da forno, Carne, Salumi, Pesce, Formaggi e latticini,
  Vino, Birra, Liquori e distillati, Gelati, Piatti pronti, Olio e condimenti.
- [ ] **Step 3: Caratteristiche nuove** in `product_characteristics.csv`:

| name | data_type | unit | options |
|---|---|---|---|
| Tipo di farina | text | | |
| Tipo di carne | enum | | Bovino\|Suino\|Pollame\|Agnello\|Equino\|Selvaggina |
| Taglio | text | | |
| Fresco o surgelato | enum | | Fresco\|Surgelato\|Decongelato |
| Stagionatura | number | mesi | |
| Denominazione | enum | | DOC\|DOCG\|IGT\|DOP\|IGP\|STG\|Nessuna |
| Specie ittica | text | | |
| Pescato o allevato | enum | | Pescato\|Allevato |
| Latte | enum | | Vaccino\|Ovino\|Caprino\|Bufalino\|Misto |
| Tipo di vino | enum | | Rosso\|Bianco\|Rosato\|Spumante\|Passito |
| Vitigno | text | | |
| Annata | number | | |
| Gradazione alcolica | number | % vol | |
| Tipo di birra | enum | | Lager\|Pils\|IPA\|Weiss\|Stout\|Ambrata |
| Tipo di distillato | enum | | Grappa\|Amaro\|Limoncello\|Gin\|Whisky\|Rum\|Vodka\|Brandy |
| Gusto | text | | |
| Porzioni | number | | |

- [ ] **Step 4: Matrice** — per ognuna delle 11, le stesse 12 righe di `Alimentari e bevande,Pasta`
  (Modello, Colore, Materiale, Dimensioni, Peso, Formato/Peso netto, Ingredienti, Allergeni, Valori
  nutrizionali, Paese di origine, Conservazione, Scadenza/TMC) più le specifiche, tutte `false`:
  - Pane e prodotti da forno: Tipo di farina
  - Carne: Tipo di carne, Taglio, Fresco o surgelato
  - Salumi: Tipo di carne, Stagionatura, Denominazione
  - Pesce: Specie ittica, Pescato o allevato, Fresco o surgelato
  - Formaggi e latticini: Latte, Stagionatura, Denominazione
  - Vino: Tipo di vino, Vitigno, Annata, Gradazione alcolica, Denominazione, Capacità netta
  - Birra: Tipo di birra, Gradazione alcolica, Capacità netta
  - Liquori e distillati: Tipo di distillato, Gradazione alcolica, Capacità netta
  - Gelati: Gusto
  - Piatti pronti: Porzioni, Fresco o surgelato
  - Olio e condimenti: Denominazione, Capacità netta
- [ ] **Step 5: «Macchine caffè»** — in `product_category_characteristics.csv:710-721` togli
  Formato/Peso netto, Ingredienti, Allergeni, Valori nutrizionali, Paese di origine, Conservazione,
  Scadenza/TMC; aggiungi Potenza, Larghezza, Altezza, Profondità (voci già nel dizionario).
- [ ] **Step 6:** validatore dello Step 1 → PASS (niente orfani, enum ≥ 2 opzioni, unità solo sui
  number, LF finale).
- [ ] **Step 7: Import vero** — `SEEDCHECK --only=admin`: il log dice 204 product categories
  (14 macro + 190 sotto-categorie; oggi 193), 224 caratteristiche (oggi 207) e 1932 righe di matrice
  (oggi 1773: −7 +4 su «Macchine caffè», +11×12 universali/alimentari, +30 specifiche), tutte con
  `failed`/`fallite: 0`.
- [ ] **Step 8: Nota di revisione** — aggiorna in
  `docs/products/caratteristiche-nota-di-revisione.md` i conteggi delle sotto-categorie (179 → 190)
  e aggiungi un paragrafo breve sulle voci nuove e sulla correzione di «Macchine caffè».
- [ ] **Step 9: Commit** — `feat(products): sotto-categorie alimentari per tipo di negozio nel dizionario`.

---

### Task 6: Catalogo per tipo di negozio, IVA, marchi e scorte (C5, C6, D3)

**Files:**
- Create: `apps/api/src/db/seed/fixtures/catalog.ts` (dati e funzioni pure, nessun import da `@/db`)
- Modify: `fixtures/utils.ts` (togli `prefixToMacro`, `productNouns`, `productAdjectives`,
  `productDescriptions`, `brandPool`), `fixtures/products.ts`, `fixtures/brands.ts`
- Test: `apps/api/tests/unit/seed-catalog.test.ts`

**Interfaces:**
- Consumes: nomi delle sotto-categorie (Task 5); `businessPrefixes`, `bolognaPrefixes`,
  `prefixForSeller` da `utils.ts`.
- Produces (in `catalog.ts`):
  - `export interface CatalogEntry { name: string; macro: string; sub: string; skip?: readonly string[] }`
    — `name` è il nome completo del prodotto (niente aggettivi concatenati); `skip` elenca le
    caratteristiche che non si applicano a quell'oggetto (es. un tagliere in «Utensili cucina»:
    `["Potenza", "Alimentazione", "Tensione batteria", "Velocità"]`).
  - `export const catalogByPrefix: Record<string, readonly CatalogEntry[]>` — 41 chiavi.
  - `export const brandPoolByMacro: Record<string, readonly string[]>` — una chiave per ogni macro
    usata dal catalogo, ≥ 6 nomi **inventati** (niente marchi reali), unici tra le macro.
  - `export const descriptionsByMacro: Record<string, readonly string[]>` — ≥ 4 per macro, nessun
    riferimento a sapori/profumi fuori dagli alimentari.
  - `export const ALCOHOLIC_SUBS: ReadonlySet<string>` = Vino, Birra, Liquori e distillati.
  - `export function catalogEntryByName(name: string): CatalogEntry | undefined`.
- `seedBrands()` ritorna `Map<sellerProfileId, Array<{ id: string; name: string; macro: string }>>`.

- [ ] **Step 1: Test che fallisce** — `tests/unit/seed-catalog.test.ts` (legge
  `src/db/seed/data/product_categories.csv` con `readFileSync` e il parser di `@/lib/utils/csv`):
  - ogni prefisso di `businessPrefixes` e `bolognaPrefixes` ha 20–30 voci, nomi unici nel pool;
  - ogni coppia `(macro, sub)` esiste nel CSV;
  - un nome che compare in più pool ha ovunque la stessa `(macro, sub, skip)`;
  - sottoinsiemi ammessi (la tabella della spec): Macelleria ⊆ {Carne, Salumi, Piatti pronti};
    Pescheria ⊆ {Pesce, Piatti pronti, Conserve}; Enoteca ⊆ {Vino, Birra, Liquori e distillati,
    Olio e condimenti}; Gelateria ⊆ {Gelati, Dolci}; Panificio ⊆ {Pane e prodotti da forno, Dolci};
    Ristorante/Trattoria/Osteria/Pizzeria ⊆ {Piatti pronti, Vino, Pasta, Dolci, Conserve, Olio e condimenti};
  - ogni macro usata ha un pool marchi e un pool descrizioni; i marchi sono unici tra macro;
  - `ALCOHOLIC_SUBS` contiene esattamente Vino, Birra, Liquori e distillati.
- [ ] **Step 2:** `bun test tests/unit/seed-catalog.test.ts` → FAIL.
- [ ] **Step 3: Scrivi `catalog.ts`.** Nomi realistici e grammaticalmente coerenti (genere e
  numero); un tipo può vendere in più macro (Erboristeria: Tè e Bellezza; Bar: Caffè, Snack, Birra;
  Casalinghi: Casa e cucina). Mappa tipo → sotto-categorie che segue la spec (C6) per gli alimentari
  e il buon senso per gli altri (Ottica → Occhiali da sole; Fiorista → Fiori; Fumetteria → Fumetti;
  Biciclette → Biciclette, Accessori bici; …). Il pool di `Casalinghi` contiene la voce
  `{ name: "Tagliere in legno d'ulivo", macro: "Casa e cucina", sub: "Utensili cucina", skip: ["Potenza", "Alimentazione", "Tensione batteria", "Velocità"] }`
  (la usa il test del Task 7).
- [ ] **Step 4:** stesso comando → PASS.
- [ ] **Step 5: `products.ts`.**
  - Per seller: `entries = catalogByPrefix[prefixForSeller(idx)]`; un prodotto per voce (20–30 per
    seller, al posto dei 30–50 di oggi), nome = `entry.name`, sotto-categoria risolta per
    `(entry.macro, entry.sub)` (errore esplicito se manca); query delle sotto-categorie con
    `ORDER BY`.
  - Prezzo da `priceRangeByMacro[entry.macro]`; descrizione da `descriptionsByMacro[entry.macro]`.
  - IVA (C5): `ALCOHOLIC_SUBS.has(entry.sub) ? "22" : productMacroCategory.suggestedVatRate ?? "22"`
    (la colonna che il form seller già usa; caricala nella query delle sotto-categorie).
  - Marchio: solo tra i marchi del seller con `macro === entry.macro`, al 90% come oggi.
  - Scorte (D3): sulle righe d'inventario, `idxInSeller % 20 === 0` → stock 0;
    `idxInSeller % 20 === 1` → stock 2; il resto come oggi (5–54).
- [ ] **Step 6: `brands.ts`.** Per seller, le macro presenti in `catalogByPrefix[prefix]`; 4–8
  marchi presi dai loro `brandPoolByMacro` (deterministico per rank, come oggi); ritorna anche la
  macro di ogni marchio.
- [ ] **Step 7: Verifica** — `SEEDCHECK`, poi:
  - `select vat_rate, count(*) from products group by 1` → presenti 4/10/22 in proporzioni
    plausibili; `select count(*) from products p join product_categories c on c.id=p.product_category_id where c.name in ('Vino','Birra','Liquori e distillati') and p.vat_rate <> '22'` = 0.
  - campione: `select s.name negozio, p.name prodotto, c.name sotto, b.name marchio from products p join stores s on s.seller_profile_id=p.seller_profile_id join product_categories c on c.id=p.product_category_id left join brands b on b.id=p.brand_id where s.name ~ '^(Macelleria|Pescheria|Enoteca|Ferramenta|Elettronica|Erboristeria)' order by s.name, p.name limit 120`
    → da leggere: nessun prodotto fuori posto.
  - `select count(*) filter (where stock=0), count(*) filter (where stock between 1 and 4) from store_products` → entrambi > 0.
  - ordini ancora 18 (seller1 ha prodotti con stock > 5).
- [ ] **Step 8: Commit** — `fix(db): catalogo del seed coerente col tipo di negozio, IVA e scorte`.

---

### Task 7: Caratteristiche coerenti col prodotto (C6, parte valori)

**Files:**
- Modify: `apps/api/src/db/seed/fixtures/characteristic-values.ts`
- Test: `apps/api/tests/unit/seed-characteristic-rules.test.ts`

**Interfaces:**
- Consumes: `catalogEntryByName()` (Task 6), nomi delle caratteristiche (Task 5).
- Produces (esportata da `characteristic-values.ts`):
  `export function skippedCharacteristics(macro: string, sub: string, productName: string): ReadonlySet<string>`.

- [ ] **Step 1: Test che fallisce**:

```ts
const food = skippedCharacteristics("Alimentari e bevande", "Pasta", "Fusilli senza glutine");
for (const c of ["Modello", "Colore", "Materiale", "Dimensioni", "Peso"]) expect(food.has(c)).toBe(true);
const sized = skippedCharacteristics("Alimentari e bevande", "Pasta", "Spaghetti di grano duro 500 g");
expect(sized.has("Formato/Peso netto")).toBe(true);
expect(skippedCharacteristics("Alimentari e bevande", "Vino", "Chianti Classico 75 cl").has("Capacità netta")).toBe(true);
// skip dichiarato dalla voce di catalogo (Task 6)
expect(skippedCharacteristics("Casa e cucina", "Utensili cucina", "Tagliere in legno d'ulivo").has("Potenza")).toBe(true);
expect(skippedCharacteristics("Elettronica", "Smartphone", "Smartphone 128 GB").size).toBe(0);
```

- [ ] **Step 2:** `bun test tests/unit/seed-characteristic-rules.test.ts` → FAIL.
- [ ] **Step 3: Implementa.**
  - Regole di `skippedCharacteristics`: macro `Alimentari e bevande` → Modello, Colore, Materiale,
    Dimensioni, Peso; nome con una quantità (`/\b\d+(?:[.,]\d+)?\s?(g|kg|ml|cl|l)\b/i`) →
    Peso, Formato/Peso netto, Capacità netta; più `catalogEntryByName(productName)?.skip`.
  - Nel fixture: la query `eligible` porta anche `product.name` e il nome della macro; le
    caratteristiche saltate escono dalla lista **prima** di `pickCount`/`sampleCharacteristics`.
  - Intervalli (`numberRange`) per i number nuovi: Annata 2015–2024; Gradazione alcolica Vino 11–15,
    Birra 4–9, Liquori e distillati 20–45 (1 decimale); Stagionatura Salumi 2–24, Formaggi e
    latticini 1–36; Porzioni 1–4; Capacità netta Vino 0.375–1.5, Birra 0.33–0.75, Liquori e
    distillati 0.5–1, Olio e condimenti 0.25–1 (2 decimali).
  - `TEXT_POOLS` realistici (5–8 voci) per Tipo di farina, Taglio, Specie ittica, Vitigno, Gusto.
  - `WEIGHT_FOOD` include le 11 sotto-categorie nuove (per il ramo non saltato di Formato/Peso netto
    resta testo; per «Peso» vale la regola sopra).
- [ ] **Step 4:** stesso comando → PASS.
- [ ] **Step 5: Verifica** — `SEEDCHECK`, poi campione da leggere:
  `select p.name, c.name sotto, pc.name caratteristica, coalesce(v.value_text, v.value_number::text, v.value_boolean::text, o.value) valore from product_characteristic_values v join products p on p.id=v.product_id join product_categories c on c.id=p.product_category_id join product_characteristics pc on pc.id=v.characteristic_id left join product_characteristic_options o on o.id=v.option_id where c.name in ('Pasta','Vino','Carne','Utensili cucina','Smartphone','Macchine caffè') order by p.name limit 200`
  → nessuna contraddizione (niente Materiale/Colore su alimenti, niente peso diverso da quello nel
  nome, niente Potenza su oggetti non elettrici, niente Ingredienti su «Macchine caffè»). Nomi di
  colonne/tabelle: adattali allo schema se differiscono.
- [ ] **Step 6: Commit** — `fix(db): caratteristiche del seed coerenti con nome e categoria`.

---

### Task 8: Date coerenti e stati del negozio mai visti (C10, D4)

**Files:**
- Modify: `fixtures/utils.ts`, `fixtures/sellers.ts`, `fixtures/extra-stores.ts`,
  `fixtures/dev-seller.ts`, `fixtures/billing-subscriptions.ts`, `fixtures/store-images.ts`,
  `fixtures/store-profiles.ts`

**Interfaces:**
- Consumes: `generateSellersSeedData()` (Task 3).
- Produces (in `utils.ts`): `export function daysAgo(days: number): Date`;
  `export function sellerSignupDaysAgo(idx: number): number` → `400 - 2 * idx`;
  `export const STORE_WITHOUT_LOCATION_SELLER = "seller11@test.com"`,
  `STORE_WITHOUT_IMAGES_SELLER = "seller14@test.com"`,
  `STORE_WITHOUT_SUBSCRIPTION_SELLER = "seller18@test.com"`.

- [ ] **Step 1: Stato attuale (deve fallire)** — `SEEDCHECK`, poi
  `select count(distinct created_at), count(*) from stores` → oggi 2 su 119.
- [ ] **Step 2: Date (C10).**
  - seller idx: `user.createdAt` e `seller_profiles.createdAt` = `daysAgo(sellerSignupDaysAgo(idx))`.
  - negozio principale: `daysAgo(sellerSignupDaysAgo(idx) - 7)`.
  - extra-store del seller idx, n-esimo ramo (n = 0, 1): `daysAgo(sellerSignupDaysAgo(idx) - 30 - 20 * n)`.
  - seller dev: utente/profilo `daysAgo(420)`, negozi `daysAgo(410)` e `daysAgo(380)`; i suoi
    abbonamenti con `createdAt` del rispettivo negozio.
  - `billing-subscriptions.ts`: la query dei negozi porta `store.createdAt` e ordina
    `desc(store.createdAt), asc(store.id)` (gli stati misti vanno sui negozi più recenti, mai su
    seller1); `store_subscriptions.createdAt` = `createdAt` del negozio. Tutte le date di negozio
    stanno ≥ 196 giorni fa, quindi il negozio annullato è creato prima di `currentPeriodEnd`
    (−20 g), `canceledAt` (−15 g) e `deletedAt` (−14 g).
- [ ] **Step 3: Stati (D4).**
  - `sellers.ts`: per idx 10 il negozio nasce con `location: null`.
  - `billing-subscriptions.ts`: esclude i negozi di `STORE_WITHOUT_SUBSCRIPTION_SELLER`.
  - `store-images.ts` e `store-profiles.ts` (foto di galleria): escludono i negozi di
    `STORE_WITHOUT_IMAGES_SELLER`.
- [ ] **Step 4: Verifica** — `SEEDCHECK`, poi:
  - `select count(distinct created_at) = count(*) from stores` → true.
  - catena: `select count(*) from stores s join seller_profiles sp on sp.id=s.seller_profile_id join "user" u on u.id=sp.user_id left join store_subscriptions ss on ss.store_id=s.id where u.created_at > s.created_at or sp.created_at > s.created_at or ss.created_at < s.created_at` = 0.
  - `select count(*) from store_subscriptions where status='canceled' and created_at >= canceled_at` = 0.
  - D4: negozio di seller11 con `location is null`; nessuna riga in `store_images` per i negozi di
    seller14; nessuna riga in `store_subscriptions` per i negozi di seller18.
  - `select count(*) from orders` = 18 (Review Focus 3).
- [ ] **Step 5: Commit** — `fix(db): date del seed in ordine e negozi senza posizione, foto o abbonamento`.

---

### Task 9: Rubrica indirizzi dei customer (D2)

**Files:**
- Modify: `apps/api/src/db/seed/fixtures/customers.ts`

**Interfaces:**
- Consumes: `seedCustomerEmails()` (Task 2); ancore e comuni di `utils.ts` (`BOLOGNA_DISTRICTS`,
  `SEED_MUNICIPALITIES`, `streets`) e la risoluzione degli id comune già usata dai fixture.

- [ ] **Step 1: Implementa** — dopo i profili: `customer1…5` due indirizzi a Bologna (etichette
  «Casa» e «Lavoro», ancore di quartiere diverse, il primo `isDefault: true`), più un indirizzo
  `isDefault: true` per ogni customer con indice multiplo di 10 nei comuni vetrina. `location`
  `{ x: lng, y: lat }`, `municipalityId` e `zipCode` coerenti col comune. Idempotente col canary del
  fixture (gira solo alla prima semina).
- [ ] **Step 2: Verifica** — `SEEDCHECK --only=customer`, poi
  `select u.email, count(*), count(*) filter (where a.is_default) from customer_addresses a join customer_profiles cp on cp.id=a.customer_profile_id join "user" u on u.id=cp.user_id group by 1 order by 2 desc limit 8`
  → customer1…5 con 2 indirizzi e 1 predefinito; nessuno con più di un predefinito.
- [ ] **Step 3: Commit** — `feat(db): rubrica indirizzi per i customer del seed`.

---

### Task 10: Documentazione del seed

**Files:**
- Modify: `apps/api/AGENTS.md` (sezione `src/db/seed/`)

- [ ] **Step 1:** Aggiorna la sezione: modalità `--only` e gruppi (ordini solo in «tutto»);
  `orders.ts` solo prenotazioni, customer1…12, scadenza a 30 giorni; seller in onboarding senza
  azienda prima di `pending_review`, `pending_email` non verificati, foto e tipi di documento;
  catalogo per tipo di negozio (`catalog.ts`, 20–30 prodotti per seller, IVA da
  `suggested_vat_rate` con alcolici al 22%, marchi per macro, scorte 0 e basse); date per idx; i
  tre seller D4; stati misti degli abbonamenti sui negozi più recenti; rubrica di customer1…5.
  Togli i numeri non più veri (~3400 prodotti, «in practice seller1–seller7»).
- [ ] **Step 2: Commit** — `docs(db): sezione seed aggiornata`.

---

### Task 11: Verifica finale e PR

- [ ] **Step 1:** `SEEDCHECK` completo: exit 0, nessun «already seeded» e nessun «✗ Failed» nel log.
- [ ] **Step 2:** `cd apps/api && bun run test` → verde (unit + integration).
- [ ] **Step 3:** dalla root `bun run typecheck` e `bun run lint` → verdi, controllando l'esito per
  workspace (l'aggregato di `bun --filter` può nascondere un fallimento).
- [ ] **Step 4:** `docker exec bibs-postgis psql -U pgadmin -d bibs-db -c "DROP DATABASE bibs_seedcheck"`.
- [ ] **Step 5:** push del branch e PR verso `main`. Descrizione: cosa cambia per parte (A, B, C1–C10,
  D1–D4), la **tabella tipo di negozio → sotto-categorie** (da `catalog.ts`) perché Marco la rilegga,
  l'esito del controllo pagine di C8, e il passo manuale: Marco svuota Stripe, rilancia
  `stripe:bootstrap`, fa `bun run db:reset -- --only=customer` e prova il flusso seller a mano;
  poi `bun run db:reset` completo e un giro su admin/seller/customer. Niente merge prima del suo ok.
