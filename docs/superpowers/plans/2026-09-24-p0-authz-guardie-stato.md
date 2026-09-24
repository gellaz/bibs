# P0 gruppo A: authz e guardie di stato. Piano di implementazione

> **Per gli agenti:** SUB-SKILL RICHIESTA: superpowers:executing-plans (esecuzione nativa, scelta da Marco). Gli step usano checkbox (`- [ ]`).

**Obiettivo:** chiudere P0.1, P0.2 e P0.7 del backlog e coprire con test HTTP i guard owner-only (P2.4), in una sola PR.

**Architettura:** tutte le correzioni stanno nel server (`apps/api`). P0.1 aggiunge `requireOwner` alle route dove manca e porta il controllo `onboardingStatus` nel ramo employee del guard seller. Il guard viene estratto in `resolveSellerAccess()` dentro `context.ts`, così lo si può testare contro il DB. P0.2 restringe il lookup EAN a ciò che è già pubblico sul sito customer. P0.7 trasforma verify/reject in una CAS su `pending_review`, con 404 o 409.

**Stack:** Elysia + TypeBox, Drizzle, bun test + testcontainers (PostGIS).

**Spec:** `docs/audit/2026-09-24-followup-gap-analysis.md`, righe P0.1, P0.2, P0.7 e P2.4. Riverificati sul main a 274dcb6: tutti e tre ancora aperti, con le evidenze file:riga invariate.

## Vincoli globali

- Branch `fix/p0-authz-state-guards` da `main` aggiornato; mai commit su main.
- TDD: il test RED viene prima del fix. Mai indebolire produzione o asserzioni per ottenere un RED. Gate: `git diff --stat` solo sui path del task.
- `ServiceError(status, message)` con due soli argomenti.
- Route con 409 → `withConflictErrors()` al posto di `withErrors()`.
- Test di integrazione: `@/db` mockato col Proxy su `getTestDb()`, `truncateAll` in `beforeEach`.
- Verifica finale: `bun run lint` dalla root, `bun run typecheck` per workspace (api, admin, seller, customer) con `$?` controllato uno per uno, `bun run test` in `apps/api` (lo script usa già `--parallel=4 --isolate`).
- Commit Conventional con scope della whitelist (`api`, `stores`, `products`, `onboarding`, …) e descrizione in italiano.
- PR con auto-merge squash. Chiudendo un P0, spostalo in «Chiusi» con il numero di PR, dentro la stessa PR.

## Decisione presa (P0.2)

Marco ha scelto: il prefill EAN resta **tra seller**, ma solo per prodotti `status = 'active'` presenti in almeno un negozio che soddisfa `publiclyVisibleStore()`. Nome e descrizione di quei prodotti sono già pubblici sul sito customer, quindi non c'è leak. Esclusi: cestinati, disabilitati, prodotti senza negozio, negozi archiviati o senza abbonamento valido. La regola alla lettera («solo miei, non cestinati») è scartata: ogni risultato violerebbe `product_seller_ean_unique` al salvataggio.

## Focus di revisione

1. **Employee di un seller tornato `rejected` dopo essere stato attivo**: il guard nega (403) anche se lo `storeEmployee` è `active`. Test nel Task 2.
2. **Stesso EAN, un prodotto pubblico vecchio e uno non pubblico più recente**: il lookup restituisce quello pubblico, non `null`. Il filtro sta nella WHERE, non in un post-filtro sul primo risultato. Test nel Task 3.
3. **Negozio `canceling` / `past_due`**: resta pubblico, quindi il suo prodotto resta nel lookup. È la stessa regola di `publiclyVisibleStore()`, e il test lo fissa. Task 3.
4. **verify/reject rifiutati con 409**: né `organization.vatStatus` né `onboardingStatus` cambiano. La CAS deve toccare l'organization solo dopo che l'update del profilo ha preso una riga. Test nel Task 4.
5. **Route owner-only con body**: la validazione Elysia gira prima del handler, quindi un body invalido dà 422 e il test del guard passerebbe per il motivo sbagliato. Ogni test con body usa un body valido e asserisce esattamente `403`. Task 1.

---

### Task 1: `requireOwner` su `/stores/archived` e `/checkout` + test HTTP dei guard owner-only (P0.1a, P2.4)

**File:**
- Modifica: `apps/api/src/modules/seller/routes/stores.ts:233-242` (handler di `/stores/archived`)
- Modifica: `apps/api/src/modules/seller/routes/checkout.ts` (tre handler)
- Crea: `apps/api/tests/modules/seller-stores-owner-only.test.ts`
- Crea: `apps/api/tests/modules/seller-checkout-owner-only.test.ts`
- Crea: `apps/api/tests/modules/seller-billing-owner-only.test.ts`
- Crea: `apps/api/tests/modules/seller-employees-owner-only.test.ts`
- Crea: `apps/api/tests/modules/seller-settings-owner-only.test.ts`

**Interfacce:** consuma `requireOwner(isOwner: boolean)` da `../context`. Non produce nulla per gli altri task.

Pattern (identico a `tests/modules/seller-closures-owner-only.test.ts`): route montate nude, senza guard seller, quindi `withSeller(ctx).isOwner` è `undefined` e `requireOwner` deve rispondere 403 prima di qualunque accesso al DB. Helper `call(method, path, body?)` copiato da quel file.

- [ ] **Step 1: test RED per le route toccate**

`seller-stores-owner-only.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { storesRoutes } from "@/modules/seller/routes/stores";
import { errorHandler } from "@/plugins/error-handler";

const noopPino = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	trace: () => {},
} as any;

// Mounted bare (no seller guard) → withSeller(ctx).isOwner is undefined,
// so requireOwner must produce a 403 before the handler runs.
const app = new Elysia()
	.state("pino", noopPino)
	.use(errorHandler)
	.use(storesRoutes);

async function call(method: string, path: string, body?: unknown) {
	return app.handle(
		new Request(`http://localhost${path}`, {
			method,
			...(body
				? {
						body: JSON.stringify(body),
						headers: { "content-type": "application/json" },
					}
				: {}),
		}),
	);
}

describe("seller stores routes are owner-only", () => {
	it("GET /stores/archived → 403 for a non-owner", async () => {
		const res = await call("GET", "/stores/archived");
		expect(res.status).toBe(403);
	});

	it("DELETE /stores/:id → 403 for a non-owner", async () => {
		const res = await call("DELETE", "/stores/some-id", { reason: "x" });
		expect(res.status).toBe(403);
	});

	it("POST /stores/:id/reactivate → 403 for a non-owner", async () => {
		const res = await call("POST", "/stores/some-id/reactivate");
		expect(res.status).toBe(403);
	});
});
```

Prima di scriverlo, leggi `stores.ts` e allinea path e body di DELETE, reactivate e PATCH ai loro schemi (e aggiungi PATCH `/stores/:id` con un body valido minimo, es. `{ name: "X" }`). Se un test dà 422, il body è sbagliato: correggi il body, non l'asserzione.

`seller-checkout-owner-only.test.ts`: stesso scheletro con `checkoutRoutes` e tre casi:

```ts
const VALID_BODY = {
	name: "Pasticceria Test",
	addressLine1: "Via Roma 1",
	municipalityId: "00000000-0000-0000-0000-000000000001",
	zipCode: "20100",
};

it("POST /stores/checkout → 403 for a non-owner", async () => {
	const res = await call("POST", "/stores/checkout", VALID_BODY);
	expect(res.status).toBe(403);
});
it("GET /checkout-sessions/:id/status → 403 for a non-owner", async () => {
	const res = await call("GET", "/checkout-sessions/cs_test/status");
	expect(res.status).toBe(403);
});
it("GET /stores/checkout/:pendingId → 403 for a non-owner", async () => {
	const res = await call("GET", "/stores/checkout/some-id");
	expect(res.status).toBe(403);
});
```

- [ ] **Step 2: esegui e verifica il RED**

`cd apps/api && bun test tests/modules/seller-stores-owner-only.test.ts tests/modules/seller-checkout-owner-only.test.ts`
Atteso: FAIL su `/stores/archived` e sui 3 checkout. Montate nude, crasheranno su `sp.id` di undefined (500) o arriveranno al DB: comunque ≠ 403. Gli altri casi di stores passano già.

- [ ] **Step 3: fix minimo**

In `stores.ts`, handler di `/stores/archived`:

```ts
		async (ctx) => {
			const { sellerProfile: sp, isOwner, query } = withSeller(ctx);
			requireOwner(isOwner);
```

In `checkout.ts`: `import { requireOwner, withSeller } from "../context";`, e in ognuno dei tre handler destruttura `isOwner` e chiama `requireOwner(isOwner);` come prima istruzione dopo `withSeller`. Nel POST la chiamata va **prima** del controllo `onboardingStatus`.

Aggiorna le `description` OpenAPI delle quattro route aggiungendo «Solo titolare.», come fanno le altre route owner-only (controlla la formulazione esatta in `billing.ts`, se c'è, e allineati).

- [ ] **Step 4: verifica il GREEN**

Stesso comando dello Step 2. Atteso: PASS.

- [ ] **Step 5: test di copertura dei guard già presenti (P2.4: billing, employees, settings)**

Questi passano subito, perché i guard esistono già: fissano il comportamento e non sono TDD. Scrivili con lo stesso scheletro:

- `seller-billing-owner-only.test.ts` con `billingRoutes` (prefisso `/billing`): GET `/billing/summary`, GET `/billing/subscriptions`, POST `/billing/portal`, GET `/billing/invoices`. Verifica metodi e body in `billing.ts`.
- `seller-employees-owner-only.test.ts` con `employeesRoutes`: POST `/employees/invite` (body valido da `TeamInviteBody`), GET `/employees/invitations`, DELETE `/employees/invitations/some-id`, POST `/employees/some-id/ban`, POST `/employees/some-id/unban`, DELETE `/employees/some-id`, GET `/employees/some-id/stores`, PUT `/employees/some-id/stores` (body valido dallo schema a `employees.ts:250`). GET `/employees` è escluso di proposito, perché non è owner-only.
- `seller-settings-owner-only.test.ts` con `settingsRoutes` (prefisso `/settings`): PATCH `/personal`, `/company`, `/vat`, `/document`, `/payment` con body validi da `PersonalSettingsBody`, `CompanySettingsBody`, `VatChangeBody`, lo schema inline a `settings.ts:175` e `PaymentChangeBody`. GET `/settings` è escluso di proposito: è accessibile all'employee con redazione, già testato in `seller-settings-employee-redaction.test.ts`.

Controlla i metodi HTTP reali in ogni file prima di scriverli. Ogni caso asserisce `toBe(403)`.

Run: `cd apps/api && bun test tests/modules/seller-*-owner-only.test.ts`
Atteso: PASS su tutti. Se un caso dà 422, correggi il body.

- [ ] **Step 6: commit**

```bash
git add apps/api/src/modules/seller/routes/stores.ts apps/api/src/modules/seller/routes/checkout.ts apps/api/tests/modules/seller-*-owner-only.test.ts
git commit -m "fix(stores): archiviati e checkout solo per il titolare"
```

(Poi un commit separato `test(api): guard owner-only su billing, dipendenti e impostazioni` per i file dello Step 5, se preferisci tenerli distinti.)

---

### Task 2: ramo employee del guard seller controlla `onboardingStatus` (P0.1b)

**File:**
- Modifica: `apps/api/src/modules/seller/context.ts` (nuova `resolveSellerAccess`)
- Modifica: `apps/api/src/modules/seller/index.ts:59-128` (il `.resolve` delega)
- Crea: `apps/api/tests/integration/seller-guard-resolve.test.ts`

**Interfacce:**
- Produce: `export async function resolveSellerAccess(u: { id: string; role?: string | null }): Promise<{ sellerProfile: SellerProfileRow; isOwner: boolean; accessCtx: AccessCtx; getStoreIds: () => Promise<string[]>; getAccessibleStoreIds: () => Promise<string[]> }>`. I literal `isOwner: true as const` / `false as const` restano nei due rami, così il tipo inferito del resolve non cambia per le route.

- [ ] **Step 1: refactor puro, comportamento invariato**

Sposta il corpo del `.resolve(async ({ user: u }) => { … })` del secondo guard (`index.ts:59-127`) in `context.ts` come `resolveSellerAccess(u)`, identico riga per riga. Serviranno gli import `sellerProfile` (valore, non solo tipo: oggi è `import type`, va reso valore), `storeEmployee` da `@/db/schemas/employee`, e `and`/`eq` (già presenti). In `index.ts`: `.resolve(({ user: u }) => resolveSellerAccess(u))`, e rimuovi gli import rimasti inutilizzati (`db`, `storeEmployee`, `sellerProfile`, `and`, `eq`, `getAccessibleStoreIdsFor`, `getSellerStoreIds`, `AccessCtx` se non più usati; con `noUnusedLocals` il typecheck lo segnala).

Run: `cd apps/api && bun run typecheck && bun test tests/integration/seller-access.test.ts`
Atteso: verde. Se il typecheck delle route peggiora (tipi del resolve collassati), annota il return type in modo esplicito invece di fidarti dell'inferenza.

- [ ] **Step 2: test RED**

`tests/integration/seller-guard-resolve.test.ts`, con lo stesso preambolo di `seller-access.test.ts` (mock `@/db` via Proxy, `setupTestContainer`/`teardownTestContainer`, `truncateAll` in `beforeEach`), poi:

```ts
import { eq } from "drizzle-orm";
import { user as userTable } from "@/db/schemas/auth";
import { storeEmployee } from "@/db/schemas/employee";
import { sellerProfile, type OnboardingStatus } from "@/db/schemas/seller";
import { ServiceError } from "@/lib/errors";
import { resolveSellerAccess } from "@/modules/seller/context";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller } from "../helpers/fixtures";

async function sellerWithEmployee(status: OnboardingStatus) {
	const db = getTestDb();
	const { profile } = await createTestSeller(db);
	await db
		.update(sellerProfile)
		.set({ onboardingStatus: status })
		.where(eq(sellerProfile.id, profile.id));
	const empUserId = crypto.randomUUID();
	await db.insert(userTable).values({
		id: empUserId,
		name: "Emp",
		email: `emp-${empUserId.slice(0, 8)}@test.com`,
		emailVerified: true,
		role: "employee",
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(storeEmployee).values({
		sellerProfileId: profile.id,
		userId: empUserId,
		status: "active",
	});
	return { profile, empUserId };
}

async function expectStatus(p: Promise<unknown>, status: number) {
	const err = await p.then(
		() => null,
		(e) => e,
	);
	expect(err).toBeInstanceOf(ServiceError);
	expect((err as ServiceError).status).toBe(status);
}

describe("resolveSellerAccess — employee branch", () => {
	it("grants access when the employer seller is active", async () => {
		const { profile, empUserId } = await sellerWithEmployee("active");
		const ctx = await resolveSellerAccess({ id: empUserId, role: "employee" });
		expect(ctx.isOwner).toBe(false);
		expect(ctx.sellerProfile.id).toBe(profile.id);
	});

	for (const status of ["pending_review", "rejected"] as const) {
		it(`denies an active employee when the employer is ${status}`, async () => {
			const { empUserId } = await sellerWithEmployee(status);
			await expectStatus(
				resolveSellerAccess({ id: empUserId, role: "employee" }),
				403,
			);
		});
	}
});

describe("resolveSellerAccess — owner branch (parity)", () => {
	it("denies an owner whose onboarding is not active", async () => {
		const db = getTestDb();
		const { user, profile } = await createTestSeller(db);
		await db
			.update(sellerProfile)
			.set({ onboardingStatus: "rejected" })
			.where(eq(sellerProfile.id, profile.id));
		await expectStatus(resolveSellerAccess({ id: user.id, role: "seller" }), 403);
	});
});
```

Verifica il nome del campo status su `ServiceError` (`status` o `statusCode`) in `src/lib/errors.ts` e allinea `expectStatus`.

Run: `cd apps/api && bun test tests/integration/seller-guard-resolve.test.ts --timeout 180000`
Atteso: i due casi `denies an active employee…` FAIL (risolve invece di lanciare); gli altri PASS.

- [ ] **Step 3: fix minimo**

Nel ramo employee di `resolveSellerAccess`, subito dopo `if (!emp) throw …`:

```ts
		if (emp.sellerProfile.onboardingStatus !== "active")
			throw new ServiceError(403, "Seller onboarding not completed");
```

- [ ] **Step 4: verifica il GREEN**

Stesso comando dello Step 2, più `bun test tests/integration/seller-access.test.ts tests/integration/seller-employees.test.ts --timeout 180000`. Atteso: PASS.

- [ ] **Step 5: commit**

```bash
git add apps/api/src/modules/seller/context.ts apps/api/src/modules/seller/index.ts apps/api/tests/integration/seller-guard-resolve.test.ts
git commit -m "fix(employees): accesso negato se il titolare non è attivo"
```

---

### Task 3: lookup EAN limitato ai prodotti pubblici (P0.2)

**File:**
- Modifica: `apps/api/src/modules/seller/services/products.ts:858-887` (`lookupProductByEan`)
- Modifica: `apps/api/src/modules/seller/routes/products.ts:193-195` (`description` OpenAPI)
- Test: `apps/api/tests/integration/seller-products.test.ts:674-723` (`describe("lookupProductByEan")`)

**Interfacce:** firma invariata, `lookupProductByEan({ ean }): Promise<EanLookupResult | null>`. Il frontend seller non cambia.

- [ ] **Step 1: rendi pubblico il fixture del test esistente (verde prima e dopo)**

Nel test `returns the latest product across sellers…`, dopo `createTestStore` per `sA` e `sB`, aggiungi `await createTestStoreSubscription(db, sA.id); await createTestStoreSubscription(db, sB.id);` e importa `createTestStoreSubscription` da `../helpers/fixtures`. `createProduct` collega già il prodotto a `storeId` (verificalo in `services/products.ts:~600`; se non crea lo `store_product`, aggiungi `createTestStoreProduct`).

- [ ] **Step 2: test RED**

Nello stesso `describe`, un helper e i casi:

```ts
	async function publicProduct(opts: {
		ean: string;
		name: string;
		status?: "active" | "disabled" | "trashed";
		subscription?: StoreSubscriptionStatus | null; // null = nessun abbonamento
		archivedStore?: boolean;
		inStore?: boolean;
	}) {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await createTestStore(db, profile.id);
		if (opts.subscription !== null)
			await createTestStoreSubscription(db, s.id, {
				status: opts.subscription ?? "active",
			});
		if (opts.archivedStore)
			await db.update(store).set({ deletedAt: new Date() }).where(eq(store.id, s.id));
		const p = await createTestProduct(db, profile.id, {
			name: opts.name,
			status: opts.status ?? "active",
		});
		await db.update(product).set({ ean: opts.ean }).where(eq(product.id, p.id));
		if (opts.inStore !== false) await createTestStoreProduct(db, s.id, p.id);
		return p;
	}

	for (const [label, opts] of [
		["trashed", { status: "trashed" }],
		["disabled", { status: "disabled" }],
		["in no store", { inStore: false }],
		["in a store without subscription", { subscription: null }],
		["in a suspended store", { subscription: "suspended" }],
		["in an archived store", { archivedStore: true }],
	] as const) {
		it(`ignores a product ${label}`, async () => {
			await publicProduct({ ean: "87654321", name: "Hidden", ...opts });
			expect(await lookupProductByEan({ ean: "87654321" })).toBeNull();
		});
	}

	it("keeps a product in a canceling store (still public)", async () => {
		await publicProduct({ ean: "87654321", name: "Canceling", subscription: "canceling" });
		expect((await lookupProductByEan({ ean: "87654321" }))?.name).toBe("Canceling");
	});

	it("falls back to an older public product when the newest one is hidden", async () => {
		await publicProduct({ ean: "87654321", name: "Public old" });
		await new Promise((r) => setTimeout(r, 10));
		await publicProduct({ ean: "87654321", name: "Trashed new", status: "trashed" });
		expect((await lookupProductByEan({ ean: "87654321" }))?.name).toBe("Public old");
	});
```

Controlla i valori reali di `StoreSubscriptionStatus` (import del tipo dallo schema `store-subscription`) e che `suspended` esista. Se il nome è diverso usa quello vero, **non** `past_due`, che è pubblico. Import aggiuntivi: `product` e `store` dagli schemi, `eq`, `createTestProduct`, `createTestStoreProduct`, `createTestStoreSubscription`.

Run: `cd apps/api && bun test tests/integration/seller-products.test.ts -t lookupProductByEan --timeout 180000`
Atteso: FAIL sui 6 casi `ignores…` e su `falls back…`; PASS su `canceling` e sul test esistente.

- [ ] **Step 3: fix minimo**

```ts
import { publiclyVisibleStore } from "@/lib/store-visibility";
// (store già importato? se no: import { store } from "@/db/schemas/store";)

	const row = await db.query.product.findFirst({
		// Only data already public on the customer site: an active product
		// stocked in at least one publicly visible store. Anything else
		// (trashed, disabled, hidden stores) would leak another seller's draft.
		where: and(
			eq(product.ean, ean),
			eq(product.status, "active"),
			exists(
				db
					.select({ one: sql`1` })
					.from(storeProduct)
					.innerJoin(store, eq(store.id, storeProduct.storeId))
					.where(
						and(eq(storeProduct.productId, product.id), publiclyVisibleStore()),
					),
			),
		),
		orderBy: [desc(product.createdAt)],
		with: { brand: true, productCategory: true },
	});
```

Il predicato sta nella WHERE, non in un post-filtro (memoria: filtro su stato calcolato → SQL). Attenzione alla correlazione: nella query relazionale Drizzle può aliasare la tabella esterna, e `product.id` dentro la subquery non correlerebbe più. Se i test lo mostrano (tutto `null`, o risultati di altri prodotti), passa a `db.select(...).from(product).where(...).orderBy(...).limit(1)` con join su brand e categoria, oppure alla ref letterale `products.id` come in `offerConditions`.

- [ ] **Step 4: verifica il GREEN**

Stesso comando dello Step 2. Atteso: PASS su tutto il `describe`.

- [ ] **Step 5: aggiorna l'OpenAPI**

In `routes/products.ts` la `description` del lookup diventa: «Restituisce i dati pre-compilabili dell'ultimo prodotto attivo con questo EAN presente in un negozio visibile al pubblico (tra venditori: solo dati già pubblici). Esclude prezzo e immagini. Ritorna null se nessun prodotto matcha.»

- [ ] **Step 6: commit**

```bash
git add apps/api/src/modules/seller/services/products.ts apps/api/src/modules/seller/routes/products.ts apps/api/tests/integration/seller-products.test.ts
git commit -m "fix(products): prefill EAN solo da prodotti già pubblici"
```

---

### Task 4: verify/reject del seller solo da `pending_review`, 409 altrimenti (P0.7)

**File:**
- Modifica: `apps/api/src/modules/admin/services/sellers.ts:179-213`
- Modifica: `apps/api/src/modules/admin/routes/sellers.ts` (response di `/verify` e `/reject` → `withConflictErrors`)
- Test: `apps/api/tests/integration/admin-sellers.test.ts:168-226`

**Interfacce:** firme invariate, `verifySeller(sellerId)` / `rejectSeller(sellerId)`. Nuovo esito: `ServiceError(409)` sulle transizioni illegali. L'admin mostra già i bottoni solo su `pending_review` (`sellers/index.tsx:280`, `$sellerId.tsx:73`), quindi il 409 arriva solo con doppio click o tab stantio, e il toast d'errore esistente lo mostra.

- [ ] **Step 1: test RED**

In `admin-sellers.test.ts`, dentro i `describe` esistenti:

```ts
async function expectConflictUnchanged(
	fn: (id: string) => Promise<unknown>,
	status: OnboardingStatus,
	vatStatus: "pending" | "verified" | "rejected",
) {
	const db = getTestDb();
	const seller = await createSellerAtStatus(`${status}-${fn.name}@test.com`, status, vatStatus);
	const err = await fn(seller.profile.id).then(() => null, (e) => e);
	expect(err).toBeInstanceOf(ServiceError);
	expect((err as ServiceError).status).toBe(409);

	const [profile] = await db.select().from(sellerProfile).where(eq(sellerProfile.id, seller.profile.id));
	expect(profile.onboardingStatus).toBe(status);
	const [org] = await db.select().from(organization).where(eq(organization.sellerProfileId, seller.profile.id));
	expect(org.vatStatus).toBe(vatStatus);
}
```

Casi per `verifySeller`: `rejected`/`rejected`, `active`/`verified`, `pending_document`/`pending` → tutti 409, stato invariato.
Casi per `rejectSeller`: `active`/`verified`, `rejected`/`rejected`, `pending_company`/`pending` → 409.
Per `rejectSeller` aggiungi anche: `throws 404 when seller does not exist`, speculare a quello di verify, con asserzione su `status === 404`. Rafforza quello di verify: oggi controlla solo `toBeInstanceOf(ServiceError)`, aggiungi `status === 404`.

Allinea il nome del campo `status` di `ServiceError` come nel Task 2.

Run: `cd apps/api && bun test tests/integration/admin-sellers.test.ts --timeout 180000`
Atteso: FAIL sui 6 casi 409 (oggi risolvono e cambiano stato). Il 404 di reject passa già, perché `fetchProfileWithMunicipalities` lancia 404.

- [ ] **Step 2: fix minimo (CAS)**

```ts
type ReviewOutcome = { onboardingStatus: "active" | "rejected"; vatStatus: "verified" | "rejected" };

// Moderation only decides pending_review applications. The status predicate in
// the UPDATE makes it a CAS: a second click or a stale tab can't re-verify a
// rejected seller or reject an active one.
async function decideReview(sellerId: string, outcome: ReviewOutcome) {
	await db.transaction(async (tx) => {
		const [moved] = await tx
			.update(sellerProfile)
			.set({ onboardingStatus: outcome.onboardingStatus })
			.where(
				and(
					eq(sellerProfile.id, sellerId),
					eq(sellerProfile.onboardingStatus, "pending_review"),
				),
			)
			.returning({ id: sellerProfile.id });

		if (!moved) {
			const exists = await tx.query.sellerProfile.findFirst({
				where: eq(sellerProfile.id, sellerId),
				columns: { id: true },
			});
			if (!exists) throw new ServiceError(404, "Seller profile not found");
			throw new ServiceError(409, "Seller is not awaiting review");
		}

		await tx
			.update(organization)
			.set({ vatStatus: outcome.vatStatus })
			.where(eq(organization.sellerProfileId, sellerId));
	});

	const updated = await fetchProfileWithMunicipalities(sellerId);
	if (!updated) throw new ServiceError(404, "Seller profile not found");
	return updated;
}

export function verifySeller(sellerId: string) {
	return decideReview(sellerId, { onboardingStatus: "active", vatStatus: "verified" });
}

export function rejectSeller(sellerId: string) {
	return decideReview(sellerId, { onboardingStatus: "rejected", vatStatus: "rejected" });
}
```

Verifica che `and` sia importato da `drizzle-orm` nel file e che i literal dei tipi coincidano con gli enum degli schemi. Se esistono, usa i tipi esportati (`OnboardingStatus`, lo status di `organization`) al posto dei literal.

In `routes/sellers.ts`: per `/verify` e `/reject`, `response: withConflictErrors({ 200: okRes(SellerProfileSchema) })` (import da `@/lib/schemas`). Aggiungi alle description: «Solo da pending_review; 409 altrimenti.»

- [ ] **Step 3: verifica il GREEN**

Stesso comando dello Step 1. Atteso: PASS su tutto il file.

- [ ] **Step 4: commit**

```bash
git add apps/api/src/modules/admin/services/sellers.ts apps/api/src/modules/admin/routes/sellers.ts apps/api/tests/integration/admin-sellers.test.ts
git commit -m "fix(onboarding): verifica e rifiuto seller solo da pending_review"
```

---

### Task 5: verifica completa, PR, backlog

- [ ] **Step 1: verifica**

```bash
bun run lint; echo "lint=$?"
for w in api admin seller customer; do (cd apps/$w && bun run typecheck); echo "$w typecheck=$?"; done
(cd apps/api && bun run test); echo "api test=$?"
git diff --stat main...HEAD   # solo i path dei task 1-4
```

Atteso: tutti gli exit a 0 e nessun path estraneo. Controlla `/openapi` (o lo schema generato) per la 409 su verify/reject.

- [ ] **Step 2: push e PR**

```bash
git push -u origin fix/p0-authz-state-guards
gh pr create --title "fix(api): guardie owner e di stato per seller, prefill EAN e moderazione" --body "…"
gh pr merge --auto --squash
```

Body: un paragrafo per P0.1 / P0.2 / P0.7 / P2.4 parziale, la decisione EAN, cosa non è coperto (resto di P2.4: rollback `acceptInvite`, resend pending-email), e la riga di attribuzione.

- [ ] **Step 3: backlog nella stessa PR**

In `docs/audit/2026-09-24-followup-gap-analysis.md`: togli P0.1, P0.2 e P0.7 dalla tabella P0. Aggiungi una sezione «## Chiusi» (dopo la P0, o rinomina/estendi quella esistente dei chiusi, allineandoti al testo del paragrafo introduttivo a riga 10) con una riga per ciascuno e `(#NN)`. Aggiorna P2.4: «guard owner-only su billing/employees/settings/stores/checkout coperti (#NN); restano rollback `acceptInvite` e resend pending-email». Aggiorna il «Taglio suggerito» (PR A fatta).

```bash
git add docs/audit/2026-09-24-followup-gap-analysis.md docs/superpowers/plans/2026-09-24-p0-authz-guardie-stato.md
git commit -m "docs(audit): P0.1, P0.2 e P0.7 chiusi in #NN"
git push
```

- [ ] **Step 4: dopo il merge**

`git checkout main && git pull && git fetch --prune`, poi cancella i branch `[gone]`. Aggiorna la memoria `project_soft_deleted_store_employee_assignment` (i 3 buchi di parità sono chiusi).
