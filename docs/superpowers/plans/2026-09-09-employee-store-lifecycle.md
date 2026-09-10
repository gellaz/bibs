# Employee↔Store Assignment Lifecycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere l'accesso di un employee a un negozio derivato (`assegnazione AND negozio vivo`) invece che coincidente con la riga in `store_employee_stores`, senza che il ciclo di vita del negozio scriva mai su quella tabella.

**Architecture:** Un solo filtro nella funzione che è l'unica fonte dello scoping employee (`getEmployeeAssignedStoreIds`) copre gate di route, liste ordini/prodotti e settings. Tre letture owner-facing filtrano per la visualizzazione, due validazioni in scrittura rifiutano i negozi non vivi, e il `delete`-all di `setEmployeeStores` viene restretto ai negozi vivi per non distruggere le righe dormienti. `acceptInvite` perde un INNER JOIN che non protegge nulla.

**Tech Stack:** Bun, Elysia, Drizzle ORM, Postgres/PostGIS, `bun:test` con testcontainers.

**Spec:** `docs/superpowers/specs/2026-09-09-employee-store-assignment-lifecycle-design.md`

## Global Constraints

- **Branch:** `fix/employee-store-lifecycle` (già creato, la spec è il primo commit). Mai commit su `main`.
- **Zero cambi di contratto.** `assignedStoreIds` resta `string[] | null`, `storeIds` resta `string[]`, la forma di ritorno di `getEmployeeStores` è invariata. Nessuna route nuova → nessun `routeTree.gen.ts` da rigenerare, nessun lavoro nei tre frontend.
- **Nessuna migrazione**, nessuna colonna, nessuna tabella nuova.
- **Filtro solo su `deletedAt`**, mai sullo stato dell'abbonamento: l'owner oggi è gated solo da `deletedAt` e la parità è quella.
- **Stile:** Biome, indentazione a tab, doppi apici. L'hook `Edit`/`Write` auto-fixa; non combattere con l'import order.
- **`noUnusedLocals` è attivo:** rimuovendo l'ultimo uso di un import va rimosso anche l'import, o typecheck va rosso (vale nel Task 4).
- **I test di integrazione chiamano i service direttamente**, non via HTTP, e girano su un container Postgres reale (`setupTestContainer`). Ogni file di test rimonta i mock: il blocco `mock.module("@/db", …)` in testa al file è obbligatorio e va lasciato dov'è.
- **Commit:** Conventional Commits, scope `employees`. Descrizione in minuscolo, imperativa, prima riga < 72 caratteri. Chiudi ogni commit con:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Come si soft-cancella un negozio nei test:** `createTestStore` non ha un parametro `deletedAt`. Si fa a mano, come già fa il test dell'hard delete:
  ```ts
  await db
      .update(storeTable)
      .set({ deletedAt: new Date() })
      .where(eq(storeTable.id, sB.id));
  ```

---

### Task 1: `getEmployeeAssignedStoreIds` filtra i negozi non vivi

Il cuore. Da qui discendono il gate `ensureStoreAccess`, `getAccessibleStoreIdsFor` (~14 route orders/products), `ensureProductAccess` e `settings.assignedStoreIds`: le assert di questo task sono la prova che l'asimmetria owner/employee è chiusa.

**Files:**
- Modify: `apps/api/src/modules/seller/services/access.ts:1-29`
- Test: `apps/api/tests/integration/seller-access.test.ts` (aggiungi ai `describe` esistenti)

**Interfaces:**
- Consumes: niente (primo task).
- Produces: `getEmployeeAssignedStoreIds(userId: string, sellerProfileId: string): Promise<string[]>` — firma invariata, semantica ristretta ai soli negozi con `deleted_at IS NULL`.

- [ ] **Step 1: Write the failing tests**

In `apps/api/tests/integration/seller-access.test.ts`, aggiungi due import al blocco già presente (dopo il `mock.module`, non prima): `storeTable`, per soft-cancellare i negozi, e `eq`, che il file non importa ancora.

```ts
import { eq } from "drizzle-orm";
import { store as storeTable } from "@/db/schemas/store";
```

Poi aggiungi un caso al `describe("getEmployeeAssignedStoreIds")`:

```ts
	it("excludes assignments whose store is soft-deleted", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const live = await createTestStore(db, profile.id, { name: "Live" });
		const dead = await createTestStore(db, profile.id, { name: "Dead" });

		const empUserId = crypto.randomUUID();
		await db.insert(userTable).values({
			id: empUserId,
			name: "Emp",
			email: `e-${empUserId.slice(0, 8)}@test.com`,
			emailVerified: true,
			role: "employee",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const [emp] = await db
			.insert(storeEmployee)
			.values({
				sellerProfileId: profile.id,
				userId: empUserId,
				status: "active",
			})
			.returning();
		await db.insert(storeEmployeeStores).values([
			{ storeEmployeeId: emp.id, storeId: live.id },
			{ storeEmployeeId: emp.id, storeId: dead.id },
		]);
		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, dead.id));

		const ids = await getEmployeeAssignedStoreIds(empUserId, profile.id);
		expect(ids).toEqual([live.id]);
	});
```

un caso al `describe("getAccessibleStoreIdsFor")`:

```ts
	it("employee: excludes soft-deleted stores, like the owner path does", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const live = await createTestStore(db, profile.id, { name: "Live" });
		const dead = await createTestStore(db, profile.id, { name: "Dead" });

		const empUserId = crypto.randomUUID();
		await db.insert(userTable).values({
			id: empUserId,
			name: "Emp",
			email: `e-${empUserId.slice(0, 8)}@test.com`,
			emailVerified: true,
			role: "employee",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const [emp] = await db
			.insert(storeEmployee)
			.values({
				sellerProfileId: profile.id,
				userId: empUserId,
				status: "active",
			})
			.returning();
		await db.insert(storeEmployeeStores).values([
			{ storeEmployeeId: emp.id, storeId: live.id },
			{ storeEmployeeId: emp.id, storeId: dead.id },
		]);
		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, dead.id));

		const ids = await getAccessibleStoreIdsFor({
			userId: empUserId,
			sellerProfileId: profile.id,
			isOwner: false,
		});
		expect(ids).toEqual([live.id]);
	});
```

e due casi al `describe("ensureStoreAccess")` — il secondo è la prova dell'asimmetria chiusa, e richiede `ensureProductAccess` nell'import da `@/modules/seller/context` e i fixture prodotto:

```ts
	it("employee: throws 403 on an assigned store that is soft-deleted", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const dead = await createTestStore(db, profile.id);
		const empUserId = crypto.randomUUID();
		await db.insert(userTable).values({
			id: empUserId,
			name: "Emp",
			email: `e-${empUserId.slice(0, 8)}@test.com`,
			emailVerified: true,
			role: "employee",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const [emp] = await db
			.insert(storeEmployee)
			.values({
				sellerProfileId: profile.id,
				userId: empUserId,
				status: "active",
			})
			.returning();
		await db.insert(storeEmployeeStores).values({
			storeEmployeeId: emp.id,
			storeId: dead.id,
		});
		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, dead.id));

		// The owner already gets a 404 here (ensureStoreOwnership filters
		// deletedAt); the employee must not keep write access the owner lost.
		await expect(
			ensureStoreAccess(dead.id, {
				userId: empUserId,
				sellerProfileId: profile.id,
				isOwner: false,
			}),
		).rejects.toMatchObject({ status: 403 });
	});
```

```ts
	it("employee: throws 403 on a product stocked only in a soft-deleted store", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const dead = await createTestStore(db, profile.id);
		const prod = await createTestProduct(db, profile.id);
		await createTestStoreProduct(db, dead.id, prod.id);

		const empUserId = crypto.randomUUID();
		await db.insert(userTable).values({
			id: empUserId,
			name: "Emp",
			email: `e-${empUserId.slice(0, 8)}@test.com`,
			emailVerified: true,
			role: "employee",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const [emp] = await db
			.insert(storeEmployee)
			.values({
				sellerProfileId: profile.id,
				userId: empUserId,
				status: "active",
			})
			.returning();
		await db.insert(storeEmployeeStores).values({
			storeEmployeeId: emp.id,
			storeId: dead.id,
		});
		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, dead.id));

		await expect(
			ensureProductAccess(prod.id, {
				userId: empUserId,
				sellerProfileId: profile.id,
				isOwner: false,
			}),
		).rejects.toMatchObject({ status: 403 });
	});
```

Aggiorna i due import esistenti del file:

```ts
import {
	ensureProductAccess,
	ensureStoreAccess,
	getAccessibleStoreIdsFor,
} from "@/modules/seller/context";
```

```ts
import {
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
} from "../helpers/fixtures";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test tests/integration/seller-access.test.ts`
Expected: i 4 casi nuovi FAIL (il negozio soft-deleted viene restituito / non lancia); i casi preesistenti PASS.

- [ ] **Step 3: Write the implementation**

`apps/api/src/modules/seller/services/access.ts` — sostituisci il file per intero:

```ts
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { storeEmployee, storeEmployeeStores } from "@/db/schemas/employee";
import { store as storeTable } from "@/db/schemas/store";

/**
 * Returns the store IDs an active employee is assigned to AND that are still
 * live (not soft-deleted).
 *
 * An assignment is durable intent, independent of the store's lifecycle: rows
 * survive a soft delete (and come back with a future restore), so liveness is
 * derived here, at the read boundary, rather than by deleting rows. This is the
 * single source of employee scoping — the route gate (`ensureStoreAccess`),
 * `getAccessibleStoreIdsFor` and `settings.assignedStoreIds` all flow from it.
 * See docs/superpowers/specs/2026-09-09-employee-store-assignment-lifecycle-design.md
 *
 * Returns [] if the user has no active employee record for this seller, or if
 * they have no assignments to live stores.
 */
export async function getEmployeeAssignedStoreIds(
	userId: string,
	sellerProfileId: string,
): Promise<string[]> {
	const rows = await db
		.select({ storeId: storeEmployeeStores.storeId })
		.from(storeEmployeeStores)
		.innerJoin(
			storeEmployee,
			eq(storeEmployeeStores.storeEmployeeId, storeEmployee.id),
		)
		.innerJoin(storeTable, eq(storeEmployeeStores.storeId, storeTable.id))
		.where(
			and(
				eq(storeEmployee.userId, userId),
				eq(storeEmployee.sellerProfileId, sellerProfileId),
				eq(storeEmployee.status, "active"),
				isNull(storeTable.deletedAt),
			),
		);
	return rows.map((r) => r.storeId);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && bun test tests/integration/seller-access.test.ts`
Expected: PASS su tutti i casi del file.

- [ ] **Step 5: Run the neighbouring suites that consume the gate**

Run: `cd apps/api && bun test tests/integration/seller-image-access.test.ts tests/integration/seller-settings.test.ts tests/integration/seller-settings-employee-redaction.test.ts`
Expected: PASS. Se un test qui diventa rosso, è perché assumeva accesso employee a un negozio soft-deleted: leggilo prima di cambiarlo, non adattarlo per far passare la suite.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/seller/services/access.ts apps/api/tests/integration/seller-access.test.ts
git commit -m "$(cat <<'EOF'
fix(employees): gate employee store access on store liveness

getEmployeeAssignedStoreIds is the single source of employee scoping and did
not filter stores.deleted_at, so an employee kept read/write access to a
soft-deleted store that its own owner had already lost (404 from
ensureStoreOwnership). Derive liveness at the read boundary instead of
deleting assignment rows.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: le tre letture owner-facing mostrano solo negozi vivi

Senza questo task il dialog assegnazioni offre negozi archiviati e `StoreChips` stampa `"?"` (non trova il nome, perché `useStores()` filtra i cancellati).

**Files:**
- Modify: `apps/api/src/modules/seller/services/employees.ts` — `listEmployees:31`, `listEmployeeInvitations:169`, `getEmployeeStores:269`
- Test: `apps/api/tests/integration/seller-employees.test.ts`

**Interfaces:**
- Consumes: `getSellerStoreIds(sellerProfileId: string): Promise<string[]>` da `apps/api/src/modules/seller/context.ts:40` — restituisce gli id dei negozi **vivi** del seller. Direzione di import `services/employees.ts` → `../context` verificata senza cicli (`context.ts` importa `./services/access`, non `employees.ts`).
- Produces: nessun cambio di firma. `listEmployees(...).data[].storeIds`, `listEmployeeInvitations(...)[].storeIds` e `getEmployeeStores(...)` contengono d'ora in poi solo negozi vivi.

- [ ] **Step 1: Write the failing tests**

In `apps/api/tests/integration/seller-employees.test.ts` aggiungi l'import di `storeTable`:

```ts
import { store as storeTable } from "@/db/schemas/store";
```

Un caso nel `describe("listEmployees")`:

```ts
	it("omits soft-deleted stores from storeIds", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const live = await createTestStore(db, profile.id);
		const dead = await createTestStore(db, profile.id);
		const empUserId = crypto.randomUUID();
		await db.insert(userTable).values({
			id: empUserId,
			name: "Emp",
			email: `e-${empUserId.slice(0, 8)}@test.com`,
			emailVerified: true,
			role: "employee",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const [emp] = await db
			.insert(storeEmployee)
			.values({
				sellerProfileId: profile.id,
				userId: empUserId,
				status: "active",
			})
			.returning();
		await db.insert(storeEmployeeStores).values([
			{ storeEmployeeId: emp.id, storeId: live.id },
			{ storeEmployeeId: emp.id, storeId: dead.id },
		]);
		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, dead.id));

		const result = await listEmployees({ sellerProfileId: profile.id });
		expect(result.data[0].storeIds).toEqual([live.id]);
	});
```

Uno nel `describe("listEmployeeInvitations")`:

```ts
	it("omits soft-deleted stores from a pending invitation's storeIds", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const live = await createTestStore(db, profile.id);
		const dead = await createTestStore(db, profile.id);

		const inv = await inviteEmployee(profile.id, "pending@test.com", [
			live.id,
			dead.id,
		]);
		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, dead.id));

		const result = await listEmployeeInvitations(profile.id);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe(inv.id);
		expect(result[0]?.storeIds).toEqual([live.id]);
	});
```

E uno nel `describe("setEmployeeStores")` (dove vivono già le assert su `getEmployeeStores`):

```ts
	it("getEmployeeStores: omits a soft-deleted assigned store", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const live = await createTestStore(db, profile.id);
		const dead = await createTestStore(db, profile.id);
		const empUserId = crypto.randomUUID();
		await db.insert(userTable).values({
			id: empUserId,
			name: "Emp",
			email: `e-${empUserId.slice(0, 8)}@test.com`,
			emailVerified: true,
			role: "employee",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const [emp] = await db
			.insert(storeEmployee)
			.values({
				sellerProfileId: profile.id,
				userId: empUserId,
				status: "active",
			})
			.returning();
		await db.insert(storeEmployeeStores).values([
			{ storeEmployeeId: emp.id, storeId: live.id },
			{ storeEmployeeId: emp.id, storeId: dead.id },
		]);
		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, dead.id));

		const rows = await getEmployeeStores({
			sellerProfileId: profile.id,
			employeeId: emp.id,
		});
		expect(rows.map((s) => s.id)).toEqual([live.id]);
	});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test tests/integration/seller-employees.test.ts`
Expected: i 3 casi nuovi FAIL (il negozio cancellato è ancora nell'array / nelle righe).

- [ ] **Step 3: Implement — `getEmployeeStores`**

In `apps/api/src/modules/seller/services/employees.ts`, aggiungi `isNull` all'import di drizzle:

```ts
import { and, count, eq, inArray, isNull } from "drizzle-orm";
```

e importa l'helper dei negozi vivi:

```ts
import { getSellerStoreIds } from "../context";
```

Poi, in `getEmployeeStores`, sostituisci la `.where(...)` finale della select (era `.where(eq(storeEmployeeStores.storeEmployeeId, params.employeeId));`):

```ts
		.where(
			and(
				eq(storeEmployeeStores.storeEmployeeId, params.employeeId),
				isNull(storeTable.deletedAt),
			),
		);
```

- [ ] **Step 4: Implement — `listEmployees`**

Aggiungi `getSellerStoreIds(sellerProfileId)` come quarto elemento del `Promise.all` già presente (nessun round-trip in più) e filtra:

```ts
	const [employees, [{ total }], profile, liveStoreIds] = await Promise.all([
		db.query.storeEmployee.findMany({
			where: eq(storeEmployee.sellerProfileId, sellerProfileId),
			with: {
				user: true,
				storeAssignments: { columns: { storeId: true } },
			},
			limit,
			offset,
		}),
		db
			.select({ total: count() })
			.from(storeEmployee)
			.where(eq(storeEmployee.sellerProfileId, sellerProfileId)),
		db.query.sellerProfile.findFirst({
			where: eq(sellerProfile.id, sellerProfileId),
			with: { user: { columns: { id: true, name: true, email: true } } },
		}),
		getSellerStoreIds(sellerProfileId),
	]);

	// An assignment can only point at a store of this same seller (enforced on
	// write), so filtering against the seller's live store ids is equivalent to
	// `deleted_at IS NULL` — and the relational query above cannot reach `store`.
	const liveStores = new Set(liveStoreIds);

	const data = employees.map((e) => ({
		...e,
		storeIds: e.storeAssignments
			.map((a) => a.storeId)
			.filter((id) => liveStores.has(id)),
	}));
```

- [ ] **Step 5: Implement — `listEmployeeInvitations`**

Stessa forma, con la `findMany` esistente (commento in testa incluso, non riscriverlo):

```ts
	const [invitations, liveStoreIds] = await Promise.all([
		db.query.employeeInvitation.findMany({
			where: and(
				eq(employeeInvitation.sellerProfileId, sellerProfileId),
				eq(employeeInvitation.status, "pending"),
			),
			with: { storeAssignments: { columns: { storeId: true } } },
			orderBy: (inv, { desc }) => [desc(inv.createdAt)],
		}),
		getSellerStoreIds(sellerProfileId),
	]);
	const liveStores = new Set(liveStoreIds);
	return invitations.map((i) => ({
		...i,
		storeIds: i.storeAssignments
			.map((a) => a.storeId)
			.filter((id) => liveStores.has(id)),
	}));
```

`cancelInvitation` (`employees.ts:188`) **non** si tocca: è l'eco di un'azione terminale che il frontend non rende. È una scelta della spec, non una dimenticanza.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/api && bun test tests/integration/seller-employees.test.ts`
Expected: PASS su tutto il file.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/seller/services/employees.ts apps/api/tests/integration/seller-employees.test.ts
git commit -m "$(cat <<'EOF'
fix(employees): hide non-live stores from owner-facing reads

listEmployees, listEmployeeInvitations and getEmployeeStores returned
assignments pointing at soft-deleted stores, so the assignment dialog offered
archived stores and StoreChips rendered "?" (useStores() filters them, so the
name lookup missed). Filter all three for display; the rows stay.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: le scritture rifiutano i negozi morti e non distruggono le righe dormienti

Due validazioni e un `delete` da restringere. Il terzo test è quello che rende affidabile un futuro ripristino: senza il `delete` restretto, il primo salvataggio dell'owner cancella l'intento verso il negozio archiviato — e la validazione appena aggiunta impedisce di reinserirlo.

**Files:**
- Modify: `apps/api/src/modules/seller/services/employees.ts` — `inviteEmployee:92`, `setEmployeeStores:331` e il `delete` in transazione a `:345`
- Test: `apps/api/tests/integration/seller-employees.test.ts`

**Interfaces:**
- Consumes: `isNull` e `storeTable`, già importati nel Task 2.
- Produces: `inviteEmployee` e `setEmployeeStores` lanciano `ServiceError(404, "Uno o più negozi non appartengono al tuo profilo")` anche quando il negozio esiste ma è soft-deleted. Messaggio invariato — è un percorso raggiungibile solo da una UI stale.

- [ ] **Step 1: Write the failing tests**

Nel `describe("inviteEmployee with storeIds")`:

```ts
	it("rejects a soft-deleted store (404)", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const dead = await createTestStore(db, profile.id);
		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, dead.id));

		await expect(
			inviteEmployee(profile.id, "n@test.com", [dead.id]),
		).rejects.toMatchObject({ status: 404 });
	});
```

Nel `describe("setEmployeeStores")`:

```ts
	it("rejects a soft-deleted store (404)", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const dead = await createTestStore(db, profile.id);
		const empUserId = crypto.randomUUID();
		await db.insert(userTable).values({
			id: empUserId,
			name: "Emp",
			email: `e-${empUserId.slice(0, 8)}@test.com`,
			emailVerified: true,
			role: "employee",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const [emp] = await db
			.insert(storeEmployee)
			.values({
				sellerProfileId: profile.id,
				userId: empUserId,
				status: "active",
			})
			.returning();
		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, dead.id));

		await expect(
			setEmployeeStores({
				sellerProfileId: profile.id,
				employeeId: emp.id,
				storeIds: [dead.id],
			}),
		).rejects.toMatchObject({ status: 404 });
	});

	it("preserves the dormant assignment of a soft-deleted store", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const live = await createTestStore(db, profile.id);
		const other = await createTestStore(db, profile.id);
		const dead = await createTestStore(db, profile.id);
		const empUserId = crypto.randomUUID();
		await db.insert(userTable).values({
			id: empUserId,
			name: "Emp",
			email: `e-${empUserId.slice(0, 8)}@test.com`,
			emailVerified: true,
			role: "employee",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const [emp] = await db
			.insert(storeEmployee)
			.values({
				sellerProfileId: profile.id,
				userId: empUserId,
				status: "active",
			})
			.returning();
		await db.insert(storeEmployeeStores).values([
			{ storeEmployeeId: emp.id, storeId: live.id },
			{ storeEmployeeId: emp.id, storeId: dead.id },
		]);
		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, dead.id));

		// The owner re-assigns among live stores only (the dialog cannot even
		// show the archived one). The dormant row must survive, so a future
		// store restore brings the assignment back.
		await setEmployeeStores({
			sellerProfileId: profile.id,
			employeeId: emp.id,
			storeIds: [other.id],
		});

		const rows = await db
			.select()
			.from(storeEmployeeStores)
			.where(eq(storeEmployeeStores.storeEmployeeId, emp.id));
		expect(rows.map((r) => r.storeId).sort()).toEqual(
			[other.id, dead.id].sort(),
		);
	});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test tests/integration/seller-employees.test.ts`
Expected: i 3 casi nuovi FAIL — i due 404 risolvono invece di lanciare, e la riga dormiente viene cancellata (`rows` contiene solo `other.id`).

- [ ] **Step 3: Implement — le due validazioni**

In `inviteEmployee`, la `where` della select di validazione (era `and(inArray(storeTable.id, storeIds), eq(storeTable.sellerProfileId, sellerProfileId))`):

```ts
		.where(
			and(
				inArray(storeTable.id, storeIds),
				eq(storeTable.sellerProfileId, sellerProfileId),
				isNull(storeTable.deletedAt),
			),
		);
```

In `setEmployeeStores`, l'analoga su `uniqueStoreIds`:

```ts
			.where(
				and(
					inArray(storeTable.id, uniqueStoreIds),
					eq(storeTable.sellerProfileId, params.sellerProfileId),
					isNull(storeTable.deletedAt),
				),
			);
```

- [ ] **Step 4: Implement — il `delete` restretto**

Sostituisci il corpo della transazione in `setEmployeeStores`:

```ts
	await db.transaction(async (tx) => {
		// Replace only the assignments the owner can actually see and manage:
		// the live ones. Rows pointing at soft-deleted stores are dormant intent
		// (and cannot be re-inserted, the validation above rejects them), so a
		// save must not destroy them.
		await tx.delete(storeEmployeeStores).where(
			and(
				eq(storeEmployeeStores.storeEmployeeId, params.employeeId),
				inArray(
					storeEmployeeStores.storeId,
					tx
						.select({ id: storeTable.id })
						.from(storeTable)
						.where(
							and(
								eq(storeTable.sellerProfileId, params.sellerProfileId),
								isNull(storeTable.deletedAt),
							),
						),
				),
			),
		);
		if (uniqueStoreIds.length > 0) {
			await tx.insert(storeEmployeeStores).values(
				uniqueStoreIds.map((storeId) => ({
					storeEmployeeId: params.employeeId,
					storeId,
				})),
			);
		}
	});
```

Nel percorso normale non c'è conflitto di PK sull'insert: tutte le righe vive sono state cancellate e `uniqueStoreIds` è già validato come vivo. Ma la validazione gira fuori dalla transazione, quindi un negozio può essere soft-deleted nella finestra tra il controllo e la transazione, lasciando una riga preesistente dormiente che il delete ristretto non tocca più — da qui `onConflictDoNothing()`, che risolve la race lasciando la riga dormiente.

`inArray()` accetta una subquery (è un `SQLWrapper`), quindi la forma sopra è quella da usare. Se il typecheck dovesse comunque protestare, **non** ripiegare su due query separate fuori transazione: usa un `exists` in raw SQL dentro la stessa `where`, mantenendo un solo statement.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/api && bun test tests/integration/seller-employees.test.ts`
Expected: PASS su tutto il file, incluso il caso preesistente "replaces the assignment set idempotently".

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/seller/services/employees.ts apps/api/tests/integration/seller-employees.test.ts
git commit -m "$(cat <<'EOF'
fix(employees): reject dead stores on assign, keep dormant rows

inviteEmployee and setEmployeeStores validated ownership but not liveness, so
an owner could create fresh intent toward a soft-deleted store. Restrict the
replace-all delete to live stores too: dormant rows can no longer be
re-inserted, so a save must not destroy them.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `acceptInvite` — via il guardiano falso, dentro la decisione

L'INNER JOIN contro `store` non protegge nulla (l'hard delete è coperto dalla FK `employee_invitation_stores.store_id ON DELETE CASCADE`, verificato nella PR #150) e il suo commento afferma il falso sui soft-deleted. Questo task lo rimuove e trasforma il caso "deliberatamente non asserito" nell'asserzione della decisione.

**Files:**
- Modify: `apps/api/src/modules/registration/services.ts:14` (import) e `:305-315` (la select)
- Test: `apps/api/tests/integration/registration-accept-invite.test.ts:117-155` (commento) + nuovo caso

**Interfaces:**
- Consumes: `getEmployeeAssignedStoreIds` con la semantica del Task 1 — è la ragione per cui propagare una riga verso un negozio morto è inerte e non un buco di accesso.
- Produces: nessun cambio di firma. `acceptInvite` propaga **tutte** le righe di `employee_invitation_stores`.

- [ ] **Step 1: Write the failing test**

In `apps/api/tests/integration/registration-accept-invite.test.ts`, **sostituisci** il commento che precede `it("does not assign a store hard-deleted between invite and accept")` (righe 117-124, quello che parla della verifica del 2026-09-09 e della decisione di prodotto) con:

```ts
	// The guard here is the `employee_invitation_stores.store_id` FK
	// (ON DELETE CASCADE), not an INNER JOIN in the service: a hard-deleted
	// store is already gone from the invitation rows. A SOFT-deleted store is a
	// different case on purpose — see the next test.
```

e aggiungi dopo di esso il caso che chiude la decisione:

```ts
	// An assignment is durable intent, independent of the store's lifecycle: the
	// row is propagated even for a soft-deleted store, exactly as it survives on
	// an employee whose store dies later. Access is gated at read time by
	// getEmployeeAssignedStoreIds, so the row is inert until a restore.
	// docs/superpowers/specs/2026-09-09-employee-store-assignment-lifecycle-design.md
	it("still assigns a store soft-deleted between invite and accept", async () => {
		const { acceptInvite } = await import("@/modules/registration/services");
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const sA = await createTestStore(db, profile.id);
		const sB = await createTestStore(db, profile.id);

		const inv = await inviteEmployee(profile.id, "employee@test.com", [
			sA.id,
			sB.id,
		]);

		await db
			.update(storeTable)
			.set({ deletedAt: new Date() })
			.where(eq(storeTable.id, sB.id));

		await acceptInvite({
			token: inv.invitationToken,
			password: "password123",
		});

		const [employeeUser] = await db
			.select()
			.from(userTable)
			.where(eq(userTable.email, "employee@test.com"));
		const [employee] = await db
			.select()
			.from(storeEmployee)
			.where(eq(storeEmployee.userId, employeeUser.id));

		const assigned = await db
			.select()
			.from(storeEmployeeStores)
			.where(eq(storeEmployeeStores.storeEmployeeId, employee.id));
		expect(assigned.map((r) => r.storeId).sort()).toEqual(
			[sA.id, sB.id].sort(),
		);

		// …and the dormant row grants nothing: only the live store is accessible.
		const { getEmployeeAssignedStoreIds } = await import(
			"@/modules/seller/services/access"
		);
		const accessible = await getEmployeeAssignedStoreIds(
			employeeUser.id,
			profile.id,
		);
		expect(accessible).toEqual([sA.id]);
	});
```

- [ ] **Step 2: Run the test to verify it passes for the wrong reason, then confirm the join is dead weight**

Run: `cd apps/api && bun test tests/integration/registration-accept-invite.test.ts`
Expected: PASS. **Questo è atteso e non è un errore del piano**: la propagazione dei soft-deleted è già il comportamento attuale (misurato nella PR #150), e il test la mette sotto contratto perché nessuno la "aggiusti" per intuito. La parte che fallirebbe senza il Task 1 è l'ultima assert (`accessible`): se il Task 1 non è stato applicato, torna `[sA.id, sB.id]` e il test è rosso.

- [ ] **Step 3: Remove the misleading join**

In `apps/api/src/modules/registration/services.ts`, sostituisci il blocco commento + select (righe ~305-315):

```ts
				// Propagate the invitation's store assignments as-is. Hard-deleted
				// stores are already gone from employee_invitation_stores via the
				// FK's ON DELETE CASCADE; soft-deleted ones are propagated on
				// purpose — an assignment is durable intent, and access is derived
				// at read time by getEmployeeAssignedStoreIds.
				// docs/superpowers/specs/2026-09-09-employee-store-assignment-lifecycle-design.md
				const invitedStores = await tx
					.select({ storeId: employeeInvitationStores.storeId })
					.from(employeeInvitationStores)
					.where(eq(employeeInvitationStores.invitationId, invitation.id));
```

Poi **rimuovi l'import ora inutilizzato** alla riga 14 — era l'ultimo uso di `storeTable` nel file:

```ts
import { store as storeTable } from "@/db/schemas/store";
```

`noUnusedLocals` è attivo: lasciarlo manda `tsc --noEmit` in rosso.

- [ ] **Step 4: Run the test and the typecheck**

Run: `cd apps/api && bun test tests/integration/registration-accept-invite.test.ts && bun run typecheck`
Expected: PASS su entrambi i test del file (soft-deleted propagato, hard-deleted no) e typecheck pulito.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/registration/services.ts apps/api/tests/integration/registration-accept-invite.test.ts
git commit -m "$(cat <<'EOF'
refactor(employees): drop acceptInvite's misleading store join

The INNER JOIN against store guarded nothing — the FK on
employee_invitation_stores.store_id (ON DELETE CASCADE) already removes
hard-deleted stores — while its comment claimed soft-deleted ones were
dropped. They were not, and now that is deliberate: assert it instead of
leaving it documented as an open question.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: verifica completa e chiusura della spec

**Files:**
- Modify: `docs/superpowers/specs/2026-09-09-employee-store-assignment-lifecycle-design.md:4` (riga `**Status:**`)

**Interfaces:**
- Consumes: i quattro task precedenti, tutti committati.
- Produces: niente in codice.

- [ ] **Step 1: Typecheck dell'API**

Run: `bun run --filter @bibs/api typecheck`
Expected: nessun output di errore, exit 0. (Verifica l'exit code: `bun run --filter` aggregato può nascondere fallimenti di un singolo workspace.)

- [ ] **Step 2: Suite API completa (unit + integration)**

Run: `bun run --filter @bibs/api test`
Expected: tutto verde. L'integration gira con l'isolamento per-file di `apps/api/scripts/test-integration.sh` (un processo per file), quindi un fallimento qui non è un leak di `mock.module` tra file.

- [ ] **Step 3: Lint**

Run: `bun run lint`
Expected: nessun finding. Se Biome segnala import order o `let`→`const`, applica `bun run lint:fix` e rileggi il diff prima di committare.

- [ ] **Step 4: Nessun typecheck frontend necessario — verificalo**

Run: `git diff --stat main -- apps/admin apps/customer apps/seller packages`
Expected: **output vuoto**. La spec promette zero cambi di contratto: se qui compare un file, qualcosa è andato oltre il piano e va discusso prima di proseguire.

- [ ] **Step 5: Aggiorna lo stato della spec**

Nella riga 4 di `docs/superpowers/specs/2026-09-09-employee-store-assignment-lifecycle-design.md`, sostituisci

```markdown
**Status:** approved, pending implementation plan
```

con

```markdown
**Status:** implemented
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-09-09-employee-store-assignment-lifecycle-design.md
git commit -m "$(cat <<'EOF'
docs(employees): mark the assignment-lifecycle spec implemented

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Riporta i comandi eseguiti e il loro output**

Non dichiarare il lavoro completo senza aver incollato l'output di Step 1-4. La PR è una decisione di Marco: non aprirla senza che l'abbia chiesta.
