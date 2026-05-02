# Seller — Store switcher, ruoli (titolare/impiegato), refactor sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trasformare l'app seller da multi-store con assegnazione esplicita prodotto→negozio a un'esperienza store-scoped guidata da uno store-switcher in cima alla sidebar, introducendo la distinzione di ruolo titolare/impiegato con assegnazione per-negozio dei dipendenti.

**Architecture:** Due nuove tabelle di join (`store_employee_stores`, `employee_invitation_stores`) — niente cambi a `products`. Helper `ensureStoreAccess` e `getAccessibleStoreIds` nel context seller, applicati a tutti gli endpoint store-scoped. Frontend: store-switcher in sidebar header, "Profilo"/"Team" dentro il dropdown utente, voce "Negozi" sostituita da "Impostazioni negozio" scoped allo store attivo. Pagina Profilo con due card (info aziendali read-only per impiegato). Trasporto dell'`activeStoreId` via localStorage + query param `?storeId`.

**Tech Stack:** Drizzle ORM (Postgres), Elysia (TypeBox + Eden Treaty), TanStack Start/Router/Query, Better Auth, react-hook-form + Zod, shadcn/ui (`@bibs/ui`), Paraglide (i18n), Bun runtime, `bun:test` con Testcontainers (PostGIS).

**Spec di riferimento:** `docs/superpowers/specs/2026-05-02-store-switcher-roles-design.md` (commit `af3f2a8`)

---

## Pre-flight

- [ ] **Step P.1: Crea branch dedicato**

```bash
git checkout -b feat/seller-store-switcher-roles
```

Expected: switched to a new branch.

- [ ] **Step P.2: Verifica baseline pulita**

```bash
bun run typecheck && bun run lint
```

Expected: exit 0 entrambi. Se baseline rotta, fixarla prima di procedere o chiedere all'utente.

- [ ] **Step P.3: Avvia infrastruttura locale (DB, mailcatcher, ecc.)**

```bash
bun run infra:up
```

Expected: container Postgres attivi (`docker ps` contiene `bibs-postgres`).

---

## Phase 1 — Schema DB

### Task 1: Nuova tabella `store_employee_stores`

**Files:**
- Modify: `apps/api/src/db/schemas/employee.ts`

- [ ] **Step 1.1: Aggiungi import e tabella**

In testa al file aggiungi import per `primaryKey` (se mancante) e l'import di `store`. Poi appendi alla fine del file:

```ts
// Add to imports at top:
import { primaryKey } from "drizzle-orm/pg-core";
import { store } from "./store";

// Append at the end of the file:
export const storeEmployeeStores = pgTable(
  "store_employee_stores",
  {
    storeEmployeeId: text("store_employee_id")
      .notNull()
      .references(() => storeEmployee.id, { onDelete: "cascade" }),
    storeId: text("store_id")
      .notNull()
      .references(() => store.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.storeEmployeeId, t.storeId] }),
    index("store_employee_stores_store_id_idx").on(t.storeId),
  ],
);

export const storeEmployeeStoresRelations = relations(
  storeEmployeeStores,
  ({ one }) => ({
    storeEmployee: one(storeEmployee, {
      fields: [storeEmployeeStores.storeEmployeeId],
      references: [storeEmployee.id],
    }),
    store: one(store, {
      fields: [storeEmployeeStores.storeId],
      references: [store.id],
    }),
  }),
);
```

- [ ] **Step 1.2: Estendi `storeEmployeeRelations` per esporre la collezione**

Trova il blocco `export const storeEmployeeRelations = relations(...)` e aggiungi `storeAssignments`:

```ts
export const storeEmployeeRelations = relations(storeEmployee, ({ one, many }) => ({
  sellerProfile: one(sellerProfile, {
    fields: [storeEmployee.sellerProfileId],
    references: [sellerProfile.id],
  }),
  user: one(user, {
    fields: [storeEmployee.userId],
    references: [user.id],
  }),
  storeAssignments: many(storeEmployeeStores),
}));
```

- [ ] **Step 1.3: Aggiungi re-export**

In `apps/api/src/db/schemas/index.ts`, controlla che sia presente `export * from "./employee";` (probabilmente già c'è — `storeEmployeeStores` viene esportato a cascata).

```bash
grep "from \"./employee\"" apps/api/src/db/schemas/index.ts
```

Expected: una linea `export * from "./employee";`. Se non c'è, aggiungerla.

- [ ] **Step 1.4: Verifica typecheck**

```bash
cd apps/api && bun run typecheck
```

Expected: exit 0.

- [ ] **Step 1.5: Commit**

```bash
git add apps/api/src/db/schemas/employee.ts apps/api/src/db/schemas/index.ts
git commit -m "feat(api): add store_employee_stores join table"
```

### Task 2: Nuova tabella `employee_invitation_stores`

**Files:**
- Modify: `apps/api/src/db/schemas/employee-invitation.ts`

- [ ] **Step 2.1: Aggiungi import e tabella**

Aggiungi gli import necessari e la tabella in fondo al file:

```ts
// Add to imports:
import { primaryKey } from "drizzle-orm/pg-core";
import { store } from "./store";

// Append at end:
export const employeeInvitationStores = pgTable(
  "employee_invitation_stores",
  {
    invitationId: text("invitation_id")
      .notNull()
      .references(() => employeeInvitation.id, { onDelete: "cascade" }),
    storeId: text("store_id")
      .notNull()
      .references(() => store.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.invitationId, t.storeId] }),
    index("employee_invitation_stores_store_id_idx").on(t.storeId),
  ],
);

export const employeeInvitationStoresRelations = relations(
  employeeInvitationStores,
  ({ one }) => ({
    invitation: one(employeeInvitation, {
      fields: [employeeInvitationStores.invitationId],
      references: [employeeInvitation.id],
    }),
    store: one(store, {
      fields: [employeeInvitationStores.storeId],
      references: [store.id],
    }),
  }),
);
```

- [ ] **Step 2.2: Estendi `employeeInvitationRelations`**

```ts
export const employeeInvitationRelations = relations(
  employeeInvitation,
  ({ one, many }) => ({
    sellerProfile: one(sellerProfile, {
      fields: [employeeInvitation.sellerProfileId],
      references: [sellerProfile.id],
    }),
    storeAssignments: many(employeeInvitationStores),
  }),
);
```

- [ ] **Step 2.3: Genera la migration**

```bash
cd apps/api && bun run db:generate
```

Expected: nuova migration sotto `apps/api/src/db/migrations/`. Rivedere il file SQL generato:
- Deve contenere `CREATE TABLE "store_employee_stores"` con PK composto e FK CASCADE.
- Deve contenere `CREATE TABLE "employee_invitation_stores"` analoga.
- Deve contenere i due index `..._store_id_idx`.
- **Non** deve toccare nessun'altra tabella.

Se il diff include cambiamenti inattesi, ferma e indaga.

- [ ] **Step 2.4: Applica la migration**

```bash
cd apps/api && bun run db:migrate
```

Expected: `Applied N migrations` (N = numero migrations da applicare). Verifica `\dt` in psql che le due nuove tabelle siano presenti.

- [ ] **Step 2.5: Typecheck**

```bash
cd apps/api && bun run typecheck
```

Expected: exit 0.

- [ ] **Step 2.6: Commit**

```bash
git add apps/api/src/db/schemas/employee-invitation.ts apps/api/src/db/migrations/
git commit -m "feat(api): add employee_invitation_stores + migration"
```

---

## Phase 2 — API context helpers

### Task 3: `getEmployeeAssignedStoreIds` service helper

**Files:**
- Create: `apps/api/src/modules/seller/services/access.ts`
- Test: `apps/api/tests/integration/seller-access.test.ts`

- [ ] **Step 3.1: Scrivi il test failing**

```ts
// apps/api/tests/integration/seller-access.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { getTestDb, setupTestContainer, teardownTestContainer } from "../helpers/test-db";

mock.module("@/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) { return (getTestDb() as any)[prop]; },
  }),
}));

import { storeEmployee } from "@/db/schemas/employee";
import { storeEmployeeStores } from "@/db/schemas/employee";
import { getEmployeeAssignedStoreIds } from "@/modules/seller/services/access";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller, createTestStore } from "../helpers/fixtures";
import { user as userTable } from "@/db/schemas/auth";
import { sellerProfile } from "@/db/schemas/seller";

beforeAll(async () => { await setupTestContainer(); }, 120_000);
afterAll(async () => { await teardownTestContainer(); });
beforeEach(async () => { await truncateAll(getTestDb()); });

describe("getEmployeeAssignedStoreIds", () => {
  it("returns the store ids the employee is assigned to", async () => {
    const db = getTestDb();
    const { profile } = await createTestSeller(db);
    const storeA = await createTestStore(db, profile.id, { name: "A" });
    const storeB = await createTestStore(db, profile.id, { name: "B" });

    // Create employee user + storeEmployee row
    const empUserId = crypto.randomUUID();
    await db.insert(userTable).values({
      id: empUserId,
      name: "Emp",
      email: `emp-${empUserId.slice(0, 6)}@test.com`,
      emailVerified: true,
      role: "employee",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const [emp] = await db.insert(storeEmployee).values({
      sellerProfileId: profile.id, userId: empUserId, status: "active",
    }).returning();
    await db.insert(storeEmployeeStores).values([
      { storeEmployeeId: emp.id, storeId: storeA.id },
      { storeEmployeeId: emp.id, storeId: storeB.id },
    ]);

    const ids = await getEmployeeAssignedStoreIds(empUserId, profile.id);
    expect(ids.sort()).toEqual([storeA.id, storeB.id].sort());
  });

  it("returns empty array if employee has no assignments", async () => {
    const db = getTestDb();
    const { profile } = await createTestSeller(db);
    const empUserId = crypto.randomUUID();
    await db.insert(userTable).values({
      id: empUserId, name: "Emp",
      email: `emp-${empUserId.slice(0, 6)}@test.com`,
      emailVerified: true, role: "employee",
      createdAt: new Date(), updatedAt: new Date(),
    });
    await db.insert(storeEmployee).values({
      sellerProfileId: profile.id, userId: empUserId, status: "active",
    });
    const ids = await getEmployeeAssignedStoreIds(empUserId, profile.id);
    expect(ids).toEqual([]);
  });

  it("excludes assignments where employee status is not active", async () => {
    const db = getTestDb();
    const { profile } = await createTestSeller(db);
    const storeA = await createTestStore(db, profile.id);
    const empUserId = crypto.randomUUID();
    await db.insert(userTable).values({
      id: empUserId, name: "Emp", email: `e-${empUserId.slice(0,6)}@test.com`,
      emailVerified: true, role: "employee",
      createdAt: new Date(), updatedAt: new Date(),
    });
    const [emp] = await db.insert(storeEmployee).values({
      sellerProfileId: profile.id, userId: empUserId, status: "banned",
    }).returning();
    await db.insert(storeEmployeeStores).values({
      storeEmployeeId: emp.id, storeId: storeA.id,
    });
    const ids = await getEmployeeAssignedStoreIds(empUserId, profile.id);
    expect(ids).toEqual([]);
  });
});
```

- [ ] **Step 3.2: Verifica fail**

```bash
cd apps/api && bun test tests/integration/seller-access.test.ts
```

Expected: FAIL — `Cannot find module '@/modules/seller/services/access'`.

- [ ] **Step 3.3: Implementa il service**

```ts
// apps/api/src/modules/seller/services/access.ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { storeEmployee, storeEmployeeStores } from "@/db/schemas/employee";

/**
 * Returns the store IDs an active employee is assigned to.
 * Returns [] if the user has no active employee record for this seller,
 * or if they have no assignments.
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
    .where(
      and(
        eq(storeEmployee.userId, userId),
        eq(storeEmployee.sellerProfileId, sellerProfileId),
        eq(storeEmployee.status, "active"),
      ),
    );
  return rows.map((r) => r.storeId);
}
```

- [ ] **Step 3.4: Verifica pass**

```bash
cd apps/api && bun test tests/integration/seller-access.test.ts
```

Expected: 3/3 PASS.

- [ ] **Step 3.5: Commit**

```bash
git add apps/api/src/modules/seller/services/access.ts apps/api/tests/integration/seller-access.test.ts
git commit -m "feat(api): add getEmployeeAssignedStoreIds service"
```

### Task 4: `ensureStoreAccess` + `getAccessibleStoreIds` nel context

**Files:**
- Modify: `apps/api/src/modules/seller/context.ts`
- Modify: `apps/api/tests/integration/seller-access.test.ts` (estensione)

- [ ] **Step 4.1: Estendi i test**

Aggiungi alla fine del file di test:

```ts
import {
  ensureStoreAccess,
  getAccessibleStoreIdsFor,
} from "@/modules/seller/context";

describe("getAccessibleStoreIdsFor", () => {
  it("owner: returns all non-deleted seller stores", async () => {
    const db = getTestDb();
    const { user, profile } = await createTestSeller(db);
    const s1 = await createTestStore(db, profile.id, { name: "Roma" });
    const s2 = await createTestStore(db, profile.id, { name: "Milano" });

    const ids = await getAccessibleStoreIdsFor({
      userId: user.id, sellerProfileId: profile.id, isOwner: true,
    });
    expect(ids.sort()).toEqual([s1.id, s2.id].sort());
  });

  it("employee: returns only assigned stores", async () => {
    const db = getTestDb();
    const { profile } = await createTestSeller(db);
    const sA = await createTestStore(db, profile.id, { name: "A" });
    await createTestStore(db, profile.id, { name: "B-not-assigned" });

    const empUserId = crypto.randomUUID();
    await db.insert(userTable).values({
      id: empUserId, name: "Emp", email: `e-${empUserId.slice(0,6)}@test.com`,
      emailVerified: true, role: "employee",
      createdAt: new Date(), updatedAt: new Date(),
    });
    const [emp] = await db.insert(storeEmployee).values({
      sellerProfileId: profile.id, userId: empUserId, status: "active",
    }).returning();
    await db.insert(storeEmployeeStores).values({
      storeEmployeeId: emp.id, storeId: sA.id,
    });

    const ids = await getAccessibleStoreIdsFor({
      userId: empUserId, sellerProfileId: profile.id, isOwner: false,
    });
    expect(ids).toEqual([sA.id]);
  });
});

describe("ensureStoreAccess", () => {
  it("owner: no-throw when store belongs to seller", async () => {
    const db = getTestDb();
    const { user, profile } = await createTestSeller(db);
    const s = await createTestStore(db, profile.id);
    await expect(
      ensureStoreAccess(s.id, {
        userId: user.id, sellerProfileId: profile.id, isOwner: true,
      })
    ).resolves.toBeUndefined();
  });

  it("owner: throws 404 when store belongs to a different seller", async () => {
    const db = getTestDb();
    const a = await createTestSeller(db);
    const b = await createTestSeller(db, { email: "other@test.com" });
    const sB = await createTestStore(db, b.profile.id);
    await expect(
      ensureStoreAccess(sB.id, {
        userId: a.user.id, sellerProfileId: a.profile.id, isOwner: true,
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("employee: throws 403 when store not assigned", async () => {
    const db = getTestDb();
    const { profile } = await createTestSeller(db);
    const sNotAssigned = await createTestStore(db, profile.id);
    const empUserId = crypto.randomUUID();
    await db.insert(userTable).values({
      id: empUserId, name: "Emp", email: `e-${empUserId.slice(0,6)}@test.com`,
      emailVerified: true, role: "employee",
      createdAt: new Date(), updatedAt: new Date(),
    });
    await db.insert(storeEmployee).values({
      sellerProfileId: profile.id, userId: empUserId, status: "active",
    });
    await expect(
      ensureStoreAccess(sNotAssigned.id, {
        userId: empUserId, sellerProfileId: profile.id, isOwner: false,
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
```

- [ ] **Step 4.2: Run — expect FAIL**

```bash
cd apps/api && bun test tests/integration/seller-access.test.ts
```

Expected: i 3 nuovi test FAIL con import errors.

- [ ] **Step 4.3: Estendi `apps/api/src/modules/seller/context.ts`**

Aggiungi DOPO la function `ensureStoreOwnership` esistente:

```ts
import { getEmployeeAssignedStoreIds } from "./services/access";

export interface AccessCtx {
  userId: string;
  sellerProfileId: string;
  isOwner: boolean;
}

/**
 * Owner: tutti gli store non-deleted del sellerProfile.
 * Employee: solo gli storeId presenti in store_employee_stores per il chiamante.
 */
export async function getAccessibleStoreIdsFor(ctx: AccessCtx): Promise<string[]> {
  if (ctx.isOwner) return getSellerStoreIds(ctx.sellerProfileId);
  return getEmployeeAssignedStoreIds(ctx.userId, ctx.sellerProfileId);
}

/**
 * Throws 404 (owner) o 403 (employee) se il chiamante non può operare sullo store.
 * Owner: verifica via ensureStoreOwnership (404 se non appartiene al seller o cancellato).
 * Employee: 403 se storeId non in assignedStoreIds, anche se lo store esiste e appartiene al seller.
 */
export async function ensureStoreAccess(storeId: string, ctx: AccessCtx): Promise<void> {
  if (ctx.isOwner) {
    await ensureStoreOwnership(storeId, ctx.sellerProfileId);
    return;
  }
  const assigned = await getEmployeeAssignedStoreIds(
    ctx.userId,
    ctx.sellerProfileId,
  );
  if (!assigned.includes(storeId)) {
    throw new ServiceError(403, "Accesso negato a questo negozio");
  }
}
```

Aggiungi anche al `SellerResolvedContext` interface, accanto a `getStoreIds`:

```ts
export interface SellerResolvedContext {
  sellerProfile: InferSelectModel<typeof sellerProfile>;
  isOwner: boolean;
  /** Lazy getter — only queries DB on first call, caches the result. */
  getStoreIds: () => Promise<string[]>;
  /** Lazy: tutti gli store accessibili al chiamante (owner: tutti; employee: solo assegnati). */
  getAccessibleStoreIds: () => Promise<string[]>;
  user: { /* ...existing... */ };
}
```

- [ ] **Step 4.4: Wire `getAccessibleStoreIds` nel seller guard `.resolve()`**

Trova il file dove `.resolve()` popola il context seller. Cercalo:

```bash
grep -rn "getStoreIds:\|isOwner:" apps/api/src/modules/seller/ --include="*.ts" | head
```

Probabilmente è in `apps/api/src/modules/seller/index.ts` o in un plugin auth. Apri il file e accanto a:

```ts
getStoreIds: () => getSellerStoreIds(profile.id),
```

aggiungi:

```ts
getAccessibleStoreIds: () => getAccessibleStoreIdsFor({
  userId: user.id,
  sellerProfileId: profile.id,
  isOwner,
}),
```

(Adatta i nomi delle variabili `user`, `profile`, `isOwner` al codice locale del file trovato.)

- [ ] **Step 4.5: Run — expect PASS**

```bash
cd apps/api && bun test tests/integration/seller-access.test.ts
```

Expected: 6/6 PASS.

- [ ] **Step 4.6: Typecheck**

```bash
cd apps/api && bun run typecheck
```

Expected: exit 0.

- [ ] **Step 4.7: Commit**

```bash
git add apps/api/src/modules/seller/context.ts apps/api/src/modules/seller/index.ts apps/api/tests/integration/seller-access.test.ts
git commit -m "feat(api): add ensureStoreAccess + getAccessibleStoreIds helpers"
```

---

## Phase 3 — API: assegnazione employee↔store

### Task 5: Schema `EmployeeWithUserSchema` con `storeIds`

**Files:**
- Modify: `apps/api/src/lib/schemas/employee.ts` (o ovunque sia definito `EmployeeWithUserSchema`)

- [ ] **Step 5.1: Trova lo schema**

```bash
grep -rn "EmployeeWithUserSchema\|EmployeeSchema =\|EmployeeInvitationSchema =" apps/api/src/lib/schemas/ --include="*.ts"
```

Identifica i file che definiscono questi 3 schemi. Tipicamente `apps/api/src/lib/schemas/employee.ts` e `employee-invitation.ts` (o un singolo file).

- [ ] **Step 5.2: Aggiungi `storeIds` a `EmployeeWithUserSchema`**

Nella TypeBox object, aggiungi il campo:

```ts
export const EmployeeWithUserSchema = t.Object({
  // ...existing fields...
  storeIds: t.Array(t.String(), {
    description: "ID dei negozi a cui il dipendente è assegnato",
  }),
});
```

- [ ] **Step 5.3: Aggiungi `storeIds` a `EmployeeInvitationSchema`**

```ts
export const EmployeeInvitationSchema = t.Object({
  // ...existing fields...
  storeIds: t.Array(t.String(), {
    description: "ID dei negozi preselezionati per l'invito",
  }),
});
```

- [ ] **Step 5.4: Aggiorna `TeamInviteBody`**

In `apps/api/src/lib/schemas/forms/`:

```bash
grep -rn "TeamInviteBody" apps/api/src/lib/schemas/
```

Modifica:

```ts
export const TeamInviteBody = t.Object({
  email: t.String({ format: "email", description: "Email del collaboratore" }),
  storeIds: t.Array(t.String(), {
    minItems: 1,
    description: "ID dei negozi a cui assegnare il collaboratore (almeno 1)",
  }),
});
```

- [ ] **Step 5.5: Typecheck**

```bash
cd apps/api && bun run typecheck
```

Expected: il typecheck fallisce nei service che ritornano questi schemi (mancano i campi `storeIds`). **Atteso:** li sistemiamo nelle prossime task.

- [ ] **Step 5.6: Commit (allow type errors temp)**

Non commettere finché Task 6 non è completata. Salta lo step di commit qui — lo facciamo cumulativo.

### Task 6: Service `listEmployees` denormalizza `storeIds`

**Files:**
- Modify: `apps/api/src/modules/seller/services/employees.ts`

- [ ] **Step 6.1: Test failing**

Aggiungi a `apps/api/tests/integration/seller-employees.test.ts` (o crea il file se non esiste):

```ts
// (boilerplate import + setup analogo ai file esistenti)
import { listEmployees } from "@/modules/seller/services/employees";
import { storeEmployee, storeEmployeeStores } from "@/db/schemas/employee";

describe("listEmployees", () => {
  it("returns employees with denormalized storeIds", async () => {
    const db = getTestDb();
    const { profile } = await createTestSeller(db);
    const sA = await createTestStore(db, profile.id);
    const sB = await createTestStore(db, profile.id);
    const empUserId = crypto.randomUUID();
    await db.insert(userTable).values({
      id: empUserId, name: "Emp", email: `e-${empUserId.slice(0,6)}@test.com`,
      emailVerified: true, role: "employee",
      createdAt: new Date(), updatedAt: new Date(),
    });
    const [emp] = await db.insert(storeEmployee).values({
      sellerProfileId: profile.id, userId: empUserId, status: "active",
    }).returning();
    await db.insert(storeEmployeeStores).values([
      { storeEmployeeId: emp.id, storeId: sA.id },
      { storeEmployeeId: emp.id, storeId: sB.id },
    ]);

    const result = await listEmployees({ sellerProfileId: profile.id });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].storeIds.sort()).toEqual([sA.id, sB.id].sort());
  });
});
```

- [ ] **Step 6.2: Run — expect FAIL**

```bash
cd apps/api && bun test tests/integration/seller-employees.test.ts -t "denormalized storeIds"
```

Expected: FAIL (proprietà `storeIds` non c'è).

- [ ] **Step 6.3: Implementa**

In `apps/api/src/modules/seller/services/employees.ts`, modifica `listEmployees`:

```ts
export async function listEmployees(params: ListEmployeesParams) {
  const { sellerProfileId } = params;
  const { page, limit, offset } = parsePagination(params);

  const [employees, [{ total }], profile] = await Promise.all([
    db.query.storeEmployee.findMany({
      where: eq(storeEmployee.sellerProfileId, sellerProfileId),
      with: { user: true, storeAssignments: { columns: { storeId: true } } },
      limit,
      offset,
    }),
    db.select({ total: count() })
      .from(storeEmployee)
      .where(eq(storeEmployee.sellerProfileId, sellerProfileId)),
    db.query.sellerProfile.findFirst({
      where: eq(sellerProfile.id, sellerProfileId),
      with: { user: { columns: { id: true, name: true, email: true } } },
    }),
  ]);

  const data = employees.map((e) => ({
    ...e,
    storeIds: e.storeAssignments.map((a) => a.storeId),
  }));

  const owner = profile?.user
    ? { id: profile.user.id, name: profile.user.name, email: profile.user.email }
    : null;

  return { data, pagination: { page, limit, total }, owner };
}
```

- [ ] **Step 6.4: Run test**

```bash
cd apps/api && bun test tests/integration/seller-employees.test.ts -t "denormalized storeIds"
```

Expected: PASS.

- [ ] **Step 6.5: Estendi `listEmployeeInvitations` analogamente**

```ts
export async function listEmployeeInvitations(sellerProfileId: string) {
  const invitations = await db.query.employeeInvitation.findMany({
    where: eq(employeeInvitation.sellerProfileId, sellerProfileId),
    with: { storeAssignments: { columns: { storeId: true } } },
    orderBy: (inv, { desc }) => [desc(inv.createdAt)],
  });
  return invitations.map((i) => ({
    ...i,
    storeIds: i.storeAssignments.map((a) => a.storeId),
  }));
}
```

- [ ] **Step 6.6: Typecheck full**

```bash
cd apps/api && bun run typecheck
```

Expected: exit 0 (lo schema ora ha `storeIds`, il servizio lo ritorna).

- [ ] **Step 6.7: Commit**

```bash
git add apps/api/src/lib/schemas/ apps/api/src/modules/seller/services/employees.ts apps/api/tests/integration/seller-employees.test.ts
git commit -m "feat(api): denormalize storeIds in employee list responses"
```

### Task 7: Endpoint `GET/PUT /employees/:id/stores`

**Files:**
- Modify: `apps/api/src/modules/seller/routes/employees.ts`
- Modify: `apps/api/src/modules/seller/services/employees.ts`
- Modify: `apps/api/tests/integration/seller-employees.test.ts`

- [ ] **Step 7.1: Test failing per `setEmployeeStores`**

```ts
import { setEmployeeStores, getEmployeeStores } from "@/modules/seller/services/employees";

describe("setEmployeeStores", () => {
  it("replaces the assignment set idempotently", async () => {
    const db = getTestDb();
    const { profile } = await createTestSeller(db);
    const sA = await createTestStore(db, profile.id);
    const sB = await createTestStore(db, profile.id);
    const sC = await createTestStore(db, profile.id);
    const empUserId = crypto.randomUUID();
    await db.insert(userTable).values({
      id: empUserId, name: "Emp", email: `e-${empUserId.slice(0,6)}@test.com`,
      emailVerified: true, role: "employee",
      createdAt: new Date(), updatedAt: new Date(),
    });
    const [emp] = await db.insert(storeEmployee).values({
      sellerProfileId: profile.id, userId: empUserId, status: "active",
    }).returning();

    await setEmployeeStores({ sellerProfileId: profile.id, employeeId: emp.id, storeIds: [sA.id, sB.id] });
    const after1 = await getEmployeeStores({ sellerProfileId: profile.id, employeeId: emp.id });
    expect(after1.map((s) => s.id).sort()).toEqual([sA.id, sB.id].sort());

    await setEmployeeStores({ sellerProfileId: profile.id, employeeId: emp.id, storeIds: [sB.id, sC.id] });
    const after2 = await getEmployeeStores({ sellerProfileId: profile.id, employeeId: emp.id });
    expect(after2.map((s) => s.id).sort()).toEqual([sB.id, sC.id].sort());
  });

  it("rejects storeIds not belonging to the seller (404)", async () => {
    const db = getTestDb();
    const a = await createTestSeller(db);
    const b = await createTestSeller(db, { email: "other@test.com" });
    const sB = await createTestStore(db, b.profile.id);
    const empUserId = crypto.randomUUID();
    await db.insert(userTable).values({
      id: empUserId, name: "Emp", email: `e-${empUserId.slice(0,6)}@test.com`,
      emailVerified: true, role: "employee",
      createdAt: new Date(), updatedAt: new Date(),
    });
    const [emp] = await db.insert(storeEmployee).values({
      sellerProfileId: a.profile.id, userId: empUserId, status: "active",
    }).returning();

    await expect(
      setEmployeeStores({ sellerProfileId: a.profile.id, employeeId: emp.id, storeIds: [sB.id] })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
```

- [ ] **Step 7.2: Run — FAIL**

```bash
cd apps/api && bun test tests/integration/seller-employees.test.ts -t "setEmployeeStores"
```

Expected: FAIL (import error).

- [ ] **Step 7.3: Implementa i service**

In `apps/api/src/modules/seller/services/employees.ts` aggiungi:

```ts
import { storeEmployeeStores } from "@/db/schemas/employee";
import { store as storeTable } from "@/db/schemas/store";
import { inArray } from "drizzle-orm";

interface EmployeeStoresParams {
  sellerProfileId: string;
  employeeId: string;
}

export async function getEmployeeStores(params: EmployeeStoresParams) {
  // Verify employee belongs to this seller (404 otherwise)
  const emp = await db.query.storeEmployee.findFirst({
    where: and(
      eq(storeEmployee.id, params.employeeId),
      eq(storeEmployee.sellerProfileId, params.sellerProfileId),
    ),
  });
  if (!emp) throw new ServiceError(404, "Employee not found");

  return db
    .select({
      id: storeTable.id,
      name: storeTable.name,
      city: storeTable.city,
      province: storeTable.province,
    })
    .from(storeEmployeeStores)
    .innerJoin(storeTable, eq(storeEmployeeStores.storeId, storeTable.id))
    .where(eq(storeEmployeeStores.storeEmployeeId, params.employeeId));
}

interface SetEmployeeStoresParams extends EmployeeStoresParams {
  storeIds: string[];
}

export async function setEmployeeStores(params: SetEmployeeStoresParams) {
  // Verify employee belongs to seller
  const emp = await db.query.storeEmployee.findFirst({
    where: and(
      eq(storeEmployee.id, params.employeeId),
      eq(storeEmployee.sellerProfileId, params.sellerProfileId),
    ),
  });
  if (!emp) throw new ServiceError(404, "Employee not found");

  // Validate every storeId belongs to this seller
  if (params.storeIds.length > 0) {
    const valid = await db
      .select({ id: storeTable.id })
      .from(storeTable)
      .where(
        and(
          inArray(storeTable.id, params.storeIds),
          eq(storeTable.sellerProfileId, params.sellerProfileId),
        ),
      );
    if (valid.length !== params.storeIds.length) {
      throw new ServiceError(404, "Uno o più negozi non appartengono al tuo profilo");
    }
  }

  return db.transaction(async (tx) => {
    await tx
      .delete(storeEmployeeStores)
      .where(eq(storeEmployeeStores.storeEmployeeId, params.employeeId));
    if (params.storeIds.length > 0) {
      await tx.insert(storeEmployeeStores).values(
        params.storeIds.map((storeId) => ({
          storeEmployeeId: params.employeeId,
          storeId,
        })),
      );
    }
    return getEmployeeStores(params);
  });
}
```

- [ ] **Step 7.4: Run service tests — PASS**

```bash
cd apps/api && bun test tests/integration/seller-employees.test.ts -t "setEmployeeStores"
```

Expected: 2/2 PASS.

- [ ] **Step 7.5: Aggiungi gli endpoint Elysia**

In `apps/api/src/modules/seller/routes/employees.ts`, aggiungi prima dell'export finale `;`, accanto agli altri endpoint:

```ts
// Add to imports:
import { getEmployeeStores, setEmployeeStores } from "../services/employees";

// Storeschema response (minimal fields)
const StoreMinimalSchema = t.Object({
  id: t.String(),
  name: t.String(),
  city: t.String(),
  province: t.Nullable(t.String()),
});

// ...inside the chained .get/.post/etc:

.get(
  "/employees/:employeeId/stores",
  async (ctx) => {
    const { sellerProfile: sp, isOwner, params } = withSeller(ctx);
    requireOwner(isOwner);
    const data = await getEmployeeStores({
      sellerProfileId: sp.id,
      employeeId: params.employeeId,
    });
    return ok(data);
  },
  {
    params: t.Object({ employeeId: t.String({ description: "ID del dipendente" }) }),
    response: withErrors({ 200: okRes(t.Array(StoreMinimalSchema)) }),
    detail: {
      summary: "Negozi assegnati al dipendente",
      description: "Restituisce la lista dei negozi a cui il dipendente è assegnato. Solo titolare.",
      tags: ["Seller - Employees"],
    },
  },
)
.put(
  "/employees/:employeeId/stores",
  async (ctx) => {
    const { sellerProfile: sp, isOwner, params, body } = withSeller(ctx);
    requireOwner(isOwner);
    const data = await setEmployeeStores({
      sellerProfileId: sp.id,
      employeeId: params.employeeId,
      storeIds: body.storeIds,
    });
    return ok(data);
  },
  {
    params: t.Object({ employeeId: t.String({ description: "ID del dipendente" }) }),
    body: t.Object({
      storeIds: t.Array(t.String(), {
        description: "ID dei negozi (replace idempotente)",
      }),
    }),
    response: withErrors({ 200: okRes(t.Array(StoreMinimalSchema)) }),
    detail: {
      summary: "Aggiorna assegnazione negozi",
      description: "Sostituisce l'insieme di negozi assegnati al dipendente (idempotente). Solo titolare.",
      tags: ["Seller - Employees"],
    },
  },
)
```

- [ ] **Step 7.6: Typecheck + lint**

```bash
cd apps/api && bun run typecheck && bun run lint
```

Expected: exit 0.

- [ ] **Step 7.7: Commit**

```bash
git add apps/api/src/modules/seller/services/employees.ts apps/api/src/modules/seller/routes/employees.ts apps/api/tests/integration/seller-employees.test.ts
git commit -m "feat(api): add GET/PUT /seller/employees/:id/stores endpoints"
```

### Task 8: Invito con preselezione store + propagazione all'accept

**Files:**
- Modify: `apps/api/src/modules/seller/services/employees.ts` (function `inviteEmployee`)
- Modify: `apps/api/src/modules/seller/routes/employees.ts` (already uses `TeamInviteBody`, just need to pass through)
- Modify: `apps/api/src/modules/registration/services.ts`
- Modify: tests

- [ ] **Step 8.1: Aggiorna firma di `inviteEmployee`**

```ts
export async function inviteEmployee(
  sellerProfileId: string,
  email: string,
  storeIds: string[],
) {
  // ...existing checks (profile exists, not already invited, email not registered)

  // NEW: validate storeIds belong to seller
  if (storeIds.length === 0) {
    throw new ServiceError(400, "Almeno un negozio deve essere selezionato");
  }
  const valid = await db
    .select({ id: storeTable.id })
    .from(storeTable)
    .where(
      and(
        inArray(storeTable.id, storeIds),
        eq(storeTable.sellerProfileId, sellerProfileId),
      ),
    );
  if (valid.length !== storeIds.length) {
    throw new ServiceError(404, "Uno o più negozi non appartengono al tuo profilo");
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

  const invitation = await db.transaction(async (tx) => {
    const [inv] = await tx
      .insert(employeeInvitation)
      .values({ sellerProfileId, email, expiresAt })
      .returning();
    await tx.insert(employeeInvitationStores).values(
      storeIds.map((storeId) => ({ invitationId: inv.id, storeId })),
    );
    return inv;
  });

  // ...existing email send

  return { ...invitation, storeIds };
}
```

Aggiungi gli import necessari (`employeeInvitationStores`, `inArray`).

- [ ] **Step 8.2: Aggiorna il route handler**

In `apps/api/src/modules/seller/routes/employees.ts`, modifica:

```ts
.post(
  "/employees/invite",
  async (ctx) => {
    const { sellerProfile: sp, isOwner, body } = withSeller(ctx);
    requireOwner(isOwner);
    const data = await inviteEmployee(sp.id, body.email, body.storeIds);
    return ok(data);
  },
  // ...rest unchanged (TeamInviteBody now has storeIds)
)
```

- [ ] **Step 8.3: Test invito**

Aggiungi test:

```ts
import { inviteEmployee } from "@/modules/seller/services/employees";
import { employeeInvitationStores } from "@/db/schemas/employee-invitation";

describe("inviteEmployee with storeIds", () => {
  it("creates invitation rows in employee_invitation_stores", async () => {
    const db = getTestDb();
    const { profile } = await createTestSeller(db);
    const sA = await createTestStore(db, profile.id);
    const sB = await createTestStore(db, profile.id);

    const inv = await inviteEmployee(profile.id, "new@test.com", [sA.id, sB.id]);
    expect(inv.storeIds.sort()).toEqual([sA.id, sB.id].sort());

    const rows = await db
      .select()
      .from(employeeInvitationStores)
      .where(eq(employeeInvitationStores.invitationId, inv.id));
    expect(rows.map((r) => r.storeId).sort()).toEqual([sA.id, sB.id].sort());
  });

  it("rejects storeIds not belonging to seller (404)", async () => {
    const db = getTestDb();
    const a = await createTestSeller(db);
    const b = await createTestSeller(db, { email: "x@test.com" });
    const sB = await createTestStore(db, b.profile.id);
    await expect(
      inviteEmployee(a.profile.id, "n@test.com", [sB.id])
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
```

- [ ] **Step 8.4: Run — PASS (after impl)**

```bash
cd apps/api && bun test tests/integration/seller-employees.test.ts -t "inviteEmployee with storeIds"
```

Expected: 2/2 PASS.

- [ ] **Step 8.5: Acceptance flow propaga `storeIds`**

Apri `apps/api/src/modules/registration/services.ts` riga ~107. Trova la transazione che crea `storeEmployee`. Aggiungi DOPO l'insert in `storeEmployee`:

```ts
// Find current import block, add:
import { employeeInvitationStores } from "@/db/schemas/employee-invitation";
import { storeEmployeeStores } from "@/db/schemas/employee";

// Inside the existing tx after storeEmployee insert:
const [createdEmployee] = await tx.insert(storeEmployee).values({
  sellerProfileId: invitation.sellerProfileId,
  userId: newUserId,
  status: "active",
}).returning();

// NEW: propagate store assignments from the invitation
const invitedStores = await tx
  .select({ storeId: employeeInvitationStores.storeId })
  .from(employeeInvitationStores)
  .innerJoin(
    storeTable, // import from "@/db/schemas/store"
    eq(employeeInvitationStores.storeId, storeTable.id),
  )
  .where(eq(employeeInvitationStores.invitationId, invitation.id));

if (invitedStores.length > 0) {
  await tx.insert(storeEmployeeStores).values(
    invitedStores.map((s) => ({
      storeEmployeeId: createdEmployee.id,
      storeId: s.storeId,
    })),
  );
}
```

(Nota: la INNER JOIN con `storeTable` filtra automaticamente eventuali store eliminati nel frattempo. Aggiungi gli import necessari in cima.)

- [ ] **Step 8.6: Test acceptance**

Aggiungi a `apps/api/tests/modules/registration.test.ts`. Prima ispeziona il file esistente per identificare la funzione di acceptance (probabilmente `acceptEmployeeInvitation` o simile in `registration/services.ts`). Poi:

```ts
import { storeEmployee, storeEmployeeStores } from "@/db/schemas/employee";
import { employeeInvitation, employeeInvitationStores } from "@/db/schemas/employee-invitation";
import { acceptEmployeeInvitation } from "@/modules/registration/services";
import { store as storeTable } from "@/db/schemas/store";
import { isNotNull, eq } from "drizzle-orm";

describe("invitation acceptance propagates storeIds", () => {
  it("inserts store_employee_stores rows for assigned stores", async () => {
    const db = getTestDb();
    const { profile } = await createTestSeller(db);
    const sA = await createTestStore(db, profile.id);
    const sB = await createTestStore(db, profile.id);
    const [inv] = await db.insert(employeeInvitation).values({
      sellerProfileId: profile.id,
      email: "new@test.com",
      expiresAt: new Date(Date.now() + 86_400_000),
    }).returning();
    await db.insert(employeeInvitationStores).values([
      { invitationId: inv.id, storeId: sA.id },
      { invitationId: inv.id, storeId: sB.id },
    ]);

    await acceptEmployeeInvitation({
      token: inv.invitationToken,
      password: "Test1234!",
      firstName: "X",
      lastName: "Y",
    });

    const emp = await db.query.storeEmployee.findFirst({
      where: eq(storeEmployee.sellerProfileId, profile.id),
    });
    expect(emp).toBeDefined();
    const rows = await db
      .select({ storeId: storeEmployeeStores.storeId })
      .from(storeEmployeeStores)
      .where(eq(storeEmployeeStores.storeEmployeeId, emp!.id));
    expect(rows.map((r) => r.storeId).sort()).toEqual([sA.id, sB.id].sort());
  });

  it("skips stores deleted between invite and accept", async () => {
    const db = getTestDb();
    const { profile } = await createTestSeller(db);
    const sA = await createTestStore(db, profile.id);
    const sB = await createTestStore(db, profile.id);
    const [inv] = await db.insert(employeeInvitation).values({
      sellerProfileId: profile.id, email: "x@test.com",
      expiresAt: new Date(Date.now() + 86_400_000),
    }).returning();
    await db.insert(employeeInvitationStores).values([
      { invitationId: inv.id, storeId: sA.id },
      { invitationId: inv.id, storeId: sB.id },
    ]);
    // Soft-delete sB BEFORE accept (FK cascade will remove the invitation_stores row).
    // Note: depending on whether `deletedAt` triggers cascade — if not, hard-delete via raw SQL for the test.
    await db.delete(storeTable).where(eq(storeTable.id, sB.id));

    await acceptEmployeeInvitation({
      token: inv.invitationToken,
      password: "Test1234!",
      firstName: "X", lastName: "Y",
    });

    const emp = await db.query.storeEmployee.findFirst({
      where: eq(storeEmployee.sellerProfileId, profile.id),
    });
    const rows = await db
      .select({ storeId: storeEmployeeStores.storeId })
      .from(storeEmployeeStores)
      .where(eq(storeEmployeeStores.storeEmployeeId, emp!.id));
    expect(rows.map((r) => r.storeId)).toEqual([sA.id]);
  });
});
```

Se la firma di `acceptEmployeeInvitation` differisce da quella mostrata, adattala alla realtà del file (i parametri richiesti per creare l'utente).

- [ ] **Step 8.7: Run — PASS**

```bash
cd apps/api && bun test tests/modules/registration.test.ts
```

Expected: nuovi test PASS, regressioni 0.

- [ ] **Step 8.8: Commit**

```bash
git add apps/api/src/modules/seller/services/employees.ts apps/api/src/modules/seller/routes/employees.ts apps/api/src/modules/registration/services.ts apps/api/tests/
git commit -m "feat(api): preselect stores at employee invite + propagate on accept"
```

---

## Phase 4 — API: filtro store-scoped sui dati

### Task 9: `GET /products` accetta query `storeId`

**Files:**
- Modify: `apps/api/src/modules/seller/routes/products.ts`
- Modify: `apps/api/src/modules/seller/services/products.ts`
- Modify: `apps/api/tests/integration/seller-products.test.ts`

- [ ] **Step 9.1: Test failing**

Aggiungi:

```ts
describe("GET /seller/products?storeId", () => {
  it("returns only products available in the requested store", async () => {
    const db = getTestDb();
    const { profile } = await createTestSeller(db);
    const sA = await createTestStore(db, profile.id);
    const sB = await createTestStore(db, profile.id);
    const pA = await createTestProduct(db, profile.id, { name: "InA" });
    const pB = await createTestProduct(db, profile.id, { name: "InB" });
    await createTestStoreProduct(db, pA.id, sA.id, 5);
    await createTestStoreProduct(db, pB.id, sB.id, 3);

    const result = await listProducts({ sellerProfileId: profile.id, storeId: sA.id });
    expect(result.data.map((p) => p.name)).toEqual(["InA"]);
  });
});
```

- [ ] **Step 9.2: Run — FAIL**

```bash
cd apps/api && bun test tests/integration/seller-products.test.ts -t "storeId"
```

Expected: FAIL (parametro `storeId` ignorato o errore di tipo).

- [ ] **Step 9.3: Modifica il service**

In `apps/api/src/modules/seller/services/products.ts`, in `listProducts`:

```ts
interface ListProductsParams {
  sellerProfileId: string;
  storeId: string;  // NEW: required
  page?: number;
  limit?: number;
}

export async function listProducts(params: ListProductsParams) {
  const { sellerProfileId, storeId } = params;
  const { page, limit, offset } = parsePagination(params);

  // Existing query — add INNER JOIN on storeProduct filtered by storeId
  // Use the existing `with: { storeProducts: ... }` relation but filter to one store.

  const data = await db.query.product.findMany({
    where: eq(product.sellerProfileId, sellerProfileId),
    with: {
      brand: true,
      productCategoryAssignments: { with: { category: true } },
      storeProducts: {
        where: eq(storeProduct.storeId, storeId),
      },
      images: true,
    },
    limit,
    offset,
  });

  // Filter out products that have no storeProduct row for this store
  const filtered = data.filter((p) => p.storeProducts.length > 0);

  // Count: derive from filtered length OR run a separate count query
  // For correctness with pagination, run a dedicated count:
  const [{ total }] = await db
    .select({ total: count() })
    .from(product)
    .innerJoin(storeProduct, eq(storeProduct.productId, product.id))
    .where(
      and(
        eq(product.sellerProfileId, sellerProfileId),
        eq(storeProduct.storeId, storeId),
      ),
    );

  return { data: filtered, pagination: { page, limit, total } };
}
```

(Verifica gli import — `storeProduct` deve venire da `@/db/schemas/product`.)

- [ ] **Step 9.4: Modifica route handler**

```ts
.get(
  "/products",
  async (ctx) => {
    const sellerCtx = withSeller(ctx);
    const { sellerProfile: sp, query } = sellerCtx;
    await ensureStoreAccess(query.storeId, {
      userId: sellerCtx.user.id,
      sellerProfileId: sp.id,
      isOwner: sellerCtx.isOwner,
    });
    const result = await listProducts({
      sellerProfileId: sp.id,
      storeId: query.storeId,
      page: query.page,
      limit: query.limit,
    });
    return okPage(result.data, result.pagination);
  },
  {
    query: t.Composite([
      PaginationQuery,
      t.Object({
        storeId: t.String({ description: "ID del negozio attivo" }),
      }),
    ]),
    response: withErrors({ 200: okPageRes(ProductWithRelationsSchema) }),
    detail: {
      summary: "Lista prodotti del negozio",
      description: "Restituisce i prodotti disponibili nel negozio specificato (filtrati via store_products).",
      tags: ["Seller - Products"],
    },
  },
)
```

Aggiungi import `ensureStoreAccess` da `../context`.

- [ ] **Step 9.5: Run service test — PASS**

```bash
cd apps/api && bun test tests/integration/seller-products.test.ts -t "storeId"
```

Expected: PASS.

- [ ] **Step 9.6: Commit**

```bash
git add apps/api/src/modules/seller/routes/products.ts apps/api/src/modules/seller/services/products.ts apps/api/tests/integration/seller-products.test.ts
git commit -m "feat(api): filter GET /seller/products by storeId"
```

### Task 10: `POST /products` accetta `storeId` e crea store_product

**Files:**
- Modify: `apps/api/src/modules/seller/routes/products.ts`
- Modify: `apps/api/src/modules/seller/services/products.ts`
- Modify: `apps/api/src/lib/schemas/forms/` (CreateProductBody)

- [ ] **Step 10.1: Aggiungi `storeId` a `CreateProductBody`**

```bash
grep -rn "CreateProductBody" apps/api/src/lib/schemas/
```

Apri il file e aggiungi:

```ts
export const CreateProductBody = t.Object({
  // ...existing fields
  storeId: t.String({
    description: "ID del negozio in cui creare il prodotto (autoassegnazione store_products)",
  }),
});
```

- [ ] **Step 10.2: Test failing**

```ts
describe("createProduct with storeId", () => {
  it("creates the product and a store_products row with stock=0", async () => {
    const db = getTestDb();
    const { profile } = await createTestSeller(db);
    const s = await createTestStore(db, profile.id);

    const created = await createProduct({
      sellerProfileId: profile.id,
      storeId: s.id,
      name: "P", price: "9.99",
    });

    const sp = await db.query.storeProduct.findFirst({
      where: and(eq(storeProduct.productId, created.id), eq(storeProduct.storeId, s.id)),
    });
    expect(sp).toBeDefined();
    expect(sp!.stock).toBe(0);
  });
});
```

- [ ] **Step 10.3: Run — FAIL**

```bash
cd apps/api && bun test tests/integration/seller-products.test.ts -t "createProduct with storeId"
```

Expected: FAIL.

- [ ] **Step 10.4: Estendi `createProduct` service**

```ts
interface CreateProductParams {
  sellerProfileId: string;
  storeId: string;
  // ...existing: name, description, price, ean, brandId, brandName, categoryIds, etc.
}

export async function createProduct(params: CreateProductParams) {
  return db.transaction(async (tx) => {
    // ...existing logic that creates the `product` row, brand, categories...
    const [newProduct] = await tx.insert(product).values({...}).returning();

    // NEW: insert store_products row for the active store
    await tx.insert(storeProduct).values({
      productId: newProduct.id,
      storeId: params.storeId,
      stock: 0,
    });

    // ...existing categories assignments, images, etc.
    return newProduct;
  });
}
```

- [ ] **Step 10.5: Modifica route handler**

```ts
.post(
  "/products",
  async (ctx) => {
    const sellerCtx = withSeller(ctx);
    const { sellerProfile: sp, body } = sellerCtx;
    await ensureStoreAccess(body.storeId, {
      userId: sellerCtx.user.id,
      sellerProfileId: sp.id,
      isOwner: sellerCtx.isOwner,
    });
    const data = await createProduct({ sellerProfileId: sp.id, ...body });
    return ok(data);
  },
  // ...rest unchanged (CreateProductBody has storeId now)
)
```

- [ ] **Step 10.6: Run — PASS**

```bash
cd apps/api && bun test tests/integration/seller-products.test.ts -t "createProduct with storeId"
```

Expected: PASS.

- [ ] **Step 10.7: Commit**

```bash
git add apps/api/src/modules/seller/routes/products.ts apps/api/src/modules/seller/services/products.ts apps/api/src/lib/schemas/ apps/api/tests/integration/seller-products.test.ts
git commit -m "feat(api): POST /seller/products auto-creates store_products row"
```

### Task 11: Restanti endpoint store-scoped (stock, orders, get/patch/delete product)

**Files:**
- Modify: `apps/api/src/modules/seller/routes/{products,stock,orders}.ts`
- Modify: `apps/api/src/modules/seller/services/{products,stock,orders}.ts`

- [ ] **Step 11.1: GET/PATCH/DELETE singolo prodotto — verifica accesso**

In `apps/api/src/modules/seller/routes/products.ts`, per ognuno dei 3 endpoint `/products/:productId` (GET, PATCH, DELETE):

```ts
// Inside handler, before calling the service:
const sellerCtx = withSeller(ctx);
const accessibleStoreIds = await sellerCtx.getAccessibleStoreIds();
// Service must verify that the product has at least one store_products row in accessibleStoreIds.
// Otherwise: 404.
```

In `services/products.ts`, modifica `getProduct`, `updateProduct`, `deleteProduct` per accettare un nuovo parametro `accessibleStoreIds: string[]` e aggiungere il check:

```ts
const productData = await db.query.product.findFirst({
  where: and(
    eq(product.id, params.productId),
    eq(product.sellerProfileId, params.sellerProfileId),
  ),
  with: { storeProducts: { columns: { storeId: true } } },
});
if (!productData) throw new ServiceError(404, "Product not found");

const isAccessible = productData.storeProducts.some((sp) =>
  params.accessibleStoreIds.includes(sp.storeId)
);
if (!isAccessible) throw new ServiceError(404, "Product not found");
```

- [ ] **Step 11.2: Test 404 su prodotto non accessibile**

```ts
it("getProduct: returns 404 when product not in any accessible store", async () => {
  const db = getTestDb();
  const { profile } = await createTestSeller(db);
  const sA = await createTestStore(db, profile.id);
  const sB = await createTestStore(db, profile.id);
  const p = await createTestProduct(db, profile.id);
  await createTestStoreProduct(db, p.id, sB.id, 0); // p only in sB

  await expect(
    getProduct({
      productId: p.id,
      sellerProfileId: profile.id,
      accessibleStoreIds: [sA.id], // employee assigned only to sA
    }),
  ).rejects.toMatchObject({ statusCode: 404 });
});
```

Run + verify FAIL → implement → PASS.

- [ ] **Step 11.3: Stock endpoints `ensureStoreAccess`**

In `apps/api/src/modules/seller/routes/stock.ts`, per ogni handler che riceve `storeId` (o `productId` da cui derivare lo storeId):

```ts
await ensureStoreAccess(query.storeId /* o body.storeId */, {
  userId: sellerCtx.user.id,
  sellerProfileId: sp.id,
  isOwner: sellerCtx.isOwner,
});
```

- [ ] **Step 11.4: Orders endpoint accetta `storeId`**

In `apps/api/src/modules/seller/routes/orders.ts`, modifica `GET /orders`:

```ts
.get(
  "/orders",
  async (ctx) => {
    const sellerCtx = withSeller(ctx);
    await ensureStoreAccess(ctx.query.storeId, {
      userId: sellerCtx.user.id,
      sellerProfileId: sellerCtx.sellerProfile.id,
      isOwner: sellerCtx.isOwner,
    });
    const result = await listOrders({
      sellerProfileId: sellerCtx.sellerProfile.id,
      storeId: ctx.query.storeId,
      page: ctx.query.page,
      limit: ctx.query.limit,
    });
    return okPage(result.data, result.pagination);
  },
  {
    query: t.Composite([
      PaginationQuery,
      t.Object({ storeId: t.String({ description: "ID del negozio attivo" }) }),
    ]),
    // ...response/detail unchanged
  },
)
```

In `services/orders.ts`, `listOrders` accetta `storeId: string` e aggiunge `eq(orderTable.storeId, storeId)` al WHERE. Aggiorna i test esistenti per passare `storeId`.

- [ ] **Step 11.5: GET /stores filtra per accessibili**

In `apps/api/src/modules/seller/routes/stores.ts`, modifica `GET /stores`:

```ts
.get(
  "/stores",
  async (ctx) => {
    const sellerCtx = withSeller(ctx);
    const accessibleStoreIds = await sellerCtx.getAccessibleStoreIds();
    const result = await listStores({
      sellerProfileId: sellerCtx.sellerProfile.id,
      filterStoreIds: accessibleStoreIds, // owner: nessun filtro effettivo se contiene tutti gli id
      ...sellerCtx.query,
    });
    return okPage(result.data, result.pagination);
  },
  // ...
)
```

In `services/stores.ts`, `listStores` accetta `filterStoreIds?: string[]`:

```ts
const where = and(
  eq(store.sellerProfileId, sellerProfileId),
  isNull(store.deletedAt),
  filterStoreIds ? inArray(store.id, filterStoreIds) : undefined,
);
```

- [ ] **Step 11.6: Aggiorna i test esistenti che chiamano `listProducts` senza `storeId`**

Cerca tutti gli usi e passa uno `storeId` (creato nei fixture):

```bash
grep -rn "listProducts(" apps/api/tests/ --include="*.ts"
```

Aggiorna ognuno per includere `storeId`.

- [ ] **Step 11.7: Run full test suite api**

```bash
cd apps/api && bun test
```

Expected: tutto verde. Sistema regressioni residue.

- [ ] **Step 11.8: Commit**

```bash
git add apps/api/
git commit -m "feat(api): apply ensureStoreAccess + storeId filter to products/stock/orders/stores"
```

### Task 12: `GET /seller/settings` ritorna `assignedStoreIds`

**Files:**
- Modify: `apps/api/src/modules/seller/routes/settings.ts`
- Modify: `apps/api/src/modules/seller/services/settings.ts`
- Modify: `apps/api/src/lib/schemas/` (SellerSettingsSchema)

- [ ] **Step 12.1: Estendi schema response**

```ts
export const SellerSettingsSchema = t.Object({
  // ...existing fields (sellerProfile, organization, paymentMethod, pendingChanges)
  assignedStoreIds: t.Union([t.Array(t.String()), t.Null()], {
    description: "Lista storeId assegnati all'employee, o null se owner (= tutti)",
  }),
});
```

- [ ] **Step 12.2: Estendi service `getSellerSettings`**

Trova il service che alimenta `GET /settings`. Modifica per ritornare:

```ts
const assignedStoreIds = isOwner
  ? null
  : await getEmployeeAssignedStoreIds(userId, sellerProfileId);
return { ...existing, assignedStoreIds };
```

Adatta la firma per ricevere `userId` e `isOwner`.

- [ ] **Step 12.3: Aggiorna handler**

```ts
.get(
  "/settings",
  async (ctx) => {
    const { sellerProfile: sp, isOwner, user } = withSeller(ctx);
    const data = await getSellerSettings({
      sellerProfileId: sp.id,
      userId: user.id,
      isOwner,
    });
    return ok(data);
  },
  // ...
)
```

- [ ] **Step 12.4: Test**

In `apps/api/tests/integration/seller-settings.test.ts` (crea il file se manca, seguendo il pattern di `seller-stores.test.ts`):

```ts
import { getSellerSettings } from "@/modules/seller/services/settings";
import { storeEmployee, storeEmployeeStores } from "@/db/schemas/employee";

describe("getSellerSettings", () => {
  it("owner: returns assignedStoreIds = null", async () => {
    const db = getTestDb();
    const { user, profile } = await createTestSeller(db);
    const result = await getSellerSettings({
      sellerProfileId: profile.id, userId: user.id, isOwner: true,
    });
    expect(result.assignedStoreIds).toBeNull();
  });

  it("employee: returns the list of assigned store ids", async () => {
    const db = getTestDb();
    const { profile } = await createTestSeller(db);
    const sA = await createTestStore(db, profile.id);
    const empUserId = crypto.randomUUID();
    await db.insert(userTable).values({
      id: empUserId, name: "Emp", email: `e-${empUserId.slice(0,6)}@test.com`,
      emailVerified: true, role: "employee",
      createdAt: new Date(), updatedAt: new Date(),
    });
    const [emp] = await db.insert(storeEmployee).values({
      sellerProfileId: profile.id, userId: empUserId, status: "active",
    }).returning();
    await db.insert(storeEmployeeStores).values({
      storeEmployeeId: emp.id, storeId: sA.id,
    });

    const result = await getSellerSettings({
      sellerProfileId: profile.id, userId: empUserId, isOwner: false,
    });
    expect(result.assignedStoreIds).toEqual([sA.id]);
  });
});
```

- [ ] **Step 12.5: Run + commit**

```bash
cd apps/api && bun test
git add apps/api/
git commit -m "feat(api): include assignedStoreIds in GET /seller/settings"
```

---

## Phase 5 — Frontend hooks

### Task 13: Hooks `useIsOwner`, `useProducts`, `useEmployeeStores`

**Files:**
- Create: `apps/seller/src/hooks/use-is-owner.ts`
- Create: `apps/seller/src/hooks/use-products.ts`
- Create: `apps/seller/src/hooks/use-employee-stores.ts`

- [ ] **Step 13.1: `useIsOwner`**

```ts
// apps/seller/src/hooks/use-is-owner.ts
import { authClient } from "@/lib/auth-client";

/**
 * True se l'utente loggato è il titolare (owner) del seller profile.
 * Owner: role === "seller" (legacy convention). Employee: role === "employee".
 */
export function useIsOwner(): boolean {
  const { data: session } = authClient.useSession();
  return session?.user.role === "seller";
}
```

- [ ] **Step 13.2: `useProducts`**

```ts
// apps/seller/src/hooks/use-products.ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useProducts(storeId: string | null, page = 1, limit = 50) {
  return useQuery({
    queryKey: ["products", storeId, page, limit],
    queryFn: async () => {
      if (!storeId) throw new Error("storeId required");
      const response = await api().seller.products.get({
        query: { storeId, page, limit },
      });
      if (response.error) {
        throw new Error(
          response.error.value?.message || "Errore nel caricamento prodotti",
        );
      }
      return response.data;
    },
    enabled: storeId !== null,
  });
}
```

- [ ] **Step 13.3: `useEmployeeStores`**

```ts
// apps/seller/src/hooks/use-employee-stores.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useEmployeeStores(employeeId: string | null) {
  return useQuery({
    queryKey: ["employees", employeeId, "stores"],
    queryFn: async () => {
      if (!employeeId) return [];
      const r = await api().seller.employees({ employeeId }).stores.get();
      if (r.error) throw new Error(r.error.value?.message || "Errore");
      return r.data.data;
    },
    enabled: employeeId !== null,
  });
}

export function useUpdateEmployeeStores(employeeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (storeIds: string[]) => {
      const r = await api().seller.employees({ employeeId }).stores.put({ storeIds });
      if (r.error) throw new Error(r.error.value?.message || "Errore");
      return r.data.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["employees"] });
    },
  });
}
```

- [ ] **Step 13.4: Typecheck**

```bash
bun run typecheck
```

Expected: exit 0 (l'API client Eden Treaty è già rigenerato dal backend e include i nuovi endpoint).

- [ ] **Step 13.5: Commit**

```bash
git add apps/seller/src/hooks/use-is-owner.ts apps/seller/src/hooks/use-products.ts apps/seller/src/hooks/use-employee-stores.ts
git commit -m "feat(seller): add useIsOwner, useProducts, useEmployeeStores hooks"
```

---

## Phase 6 — Frontend sidebar refactor

### Task 14: Riscrivi `NavUser` con Profilo + Team

**Files:**
- Modify: `apps/seller/src/components/nav-user.tsx`

- [ ] **Step 14.1: Aggiungi import e link**

```tsx
import { Link } from "@tanstack/react-router";
import { UserIcon, UsersIcon } from "lucide-react";
import { useIsOwner } from "@/hooks/use-is-owner";
```

- [ ] **Step 14.2: Inserisci voci Profilo + Team nel dropdown**

Modifica il `<DropdownMenuContent>` esistente. Tra `<DropdownMenuLabel>` (con avatar+nome+email) e il group con `ThemeToggle/LocaleSwitcher`, aggiungi:

```tsx
<DropdownMenuSeparator />
<DropdownMenuGroup>
  <DropdownMenuItem asChild>
    <Link to="/profile">
      <UserIcon />
      <span>Profilo</span>
    </Link>
  </DropdownMenuItem>
  {isOwner && (
    <DropdownMenuItem asChild>
      <Link to="/team">
        <UsersIcon />
        <span>Team</span>
      </Link>
    </DropdownMenuItem>
  )}
</DropdownMenuGroup>
```

(`isOwner` arriva da `const isOwner = useIsOwner();` in cima al componente.)

- [ ] **Step 14.3: Verifica**

Avvia il dev server seller e apri http://localhost:3003 — clicca sull'avatar in fondo alla sidebar. Devi vedere "Profilo" e (se owner) "Team".

```bash
bun run dev:seller
```

- [ ] **Step 14.4: Commit**

```bash
git add apps/seller/src/components/nav-user.tsx
git commit -m "feat(seller): add Profilo + Team links to NavUser dropdown"
```

### Task 15: Riscrivi `StoreSwitcher` con dropdown sempre apribile

**Files:**
- Modify: `apps/seller/src/components/store-switcher.tsx`

- [ ] **Step 15.1: Sostituisci il file**

```tsx
// apps/seller/src/components/store-switcher.tsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bibs/ui/components/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@bibs/ui/components/sidebar";
import { Link } from "@tanstack/react-router";
import {
  ChevronsUpDownIcon,
  CheckIcon,
  PlusIcon,
  SettingsIcon,
  StoreIcon,
} from "lucide-react";
import { useActiveStore } from "@/hooks/use-active-store";
import { useIsOwner } from "@/hooks/use-is-owner";

export function StoreSwitcher() {
  const { isMobile } = useSidebar();
  const { activeStore, stores, isLoading, setActiveStoreId } = useActiveStore();
  const isOwner = useIsOwner();

  if (isLoading || stores.length === 0) {
    return null;
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <StoreIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {activeStore?.name ?? "Seleziona negozio"}
                </span>
                <span className="truncate text-xs">
                  {activeStore?.city}
                  {activeStore?.province ? ` (${activeStore.province})` : ""}
                </span>
              </div>
              <ChevronsUpDownIcon className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Negozi
            </DropdownMenuLabel>
            {stores.map((store) => {
              const isActive = store.id === activeStore?.id;
              return (
                <DropdownMenuItem
                  key={store.id}
                  onClick={() => setActiveStoreId(store.id)}
                  className="gap-2 p-2"
                >
                  <div className="flex size-6 items-center justify-center rounded-md border">
                    <StoreIcon className="size-3.5 shrink-0" />
                  </div>
                  <div className="flex flex-1 flex-col">
                    <span>{store.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {store.city}
                      {store.province ? ` (${store.province})` : ""}
                    </span>
                  </div>
                  {isActive && <CheckIcon className="size-4" />}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/store">
                <SettingsIcon />
                <span>Modifica negozio attivo</span>
              </Link>
            </DropdownMenuItem>
            {isOwner && (
              <DropdownMenuItem asChild>
                <Link to="/store/new">
                  <PlusIcon />
                  <span>Aggiungi negozio</span>
                </Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
```

- [ ] **Step 15.2: Verifica nel browser**

Riavvia il dev server. Lo switcher deve essere sempre apribile, mostrare check sul negozio corrente, e per owner avere la voce "+ Aggiungi negozio".

- [ ] **Step 15.3: Commit**

```bash
git add apps/seller/src/components/store-switcher.tsx
git commit -m "feat(seller): redesign StoreSwitcher with always-open dropdown"
```

### Task 16: Riscrivi `AppSidebar`

**Files:**
- Modify: `apps/seller/src/components/app-sidebar.tsx`
- Delete: `apps/seller/src/components/company-header.tsx`

- [ ] **Step 16.1: Sostituisci `app-sidebar.tsx`**

```tsx
// apps/seller/src/components/app-sidebar.tsx
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@bibs/ui/components/sidebar";
import { Link, useRouterState } from "@tanstack/react-router";
import { HomeIcon, PackageIcon, SettingsIcon } from "lucide-react";
import { NavUser } from "@/components/nav-user";
import { StoreSwitcher } from "@/components/store-switcher";

const navItems = [
  { title: "Home", to: "/" as const, icon: HomeIcon, match: (p: string) => p === "/" },
  { title: "Prodotti", to: "/products" as const, icon: PackageIcon, match: (p: string) => p.startsWith("/products") },
  { title: "Impostazioni negozio", to: "/store" as const, icon: SettingsIcon, match: (p: string) => p.startsWith("/store") },
];

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <StoreSwitcher />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigazione</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = item.match(pathname);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      isActive={isActive}
                      className="data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
                    >
                      <Link to={item.to}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
```

- [ ] **Step 16.2: Elimina `company-header.tsx`**

```bash
rm apps/seller/src/components/company-header.tsx
```

- [ ] **Step 16.3: Typecheck (le route /store non esistono ancora — typecheck fallirà sui Link)**

Atteso: TS errors sui `<Link to="/store">` e `<Link to="/store/new">`. **Lasciamoli così**: la prossima task crea le route e li risolve. Continua senza commit.

```bash
bun run typecheck 2>&1 | head -10
```

Expected: errori del tipo `Type '"/store"' is not assignable to type ...`. Procedi.

- [ ] **Step 16.4: Commit (verrà finalizzato in Task 17 dopo creazione delle route)**

Salta. Procedi a Task 17.

---

## Phase 7 — Frontend nuove route `/store`

### Task 17: Crea `/store` (info dello store attivo)

**Files:**
- Create: `apps/seller/src/routes/_authenticated/store.tsx` (layout)
- Create: `apps/seller/src/routes/_authenticated/store/index.tsx` (info store attivo)

- [ ] **Step 17.1: Layout pathless**

```tsx
// apps/seller/src/routes/_authenticated/store.tsx
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/store")({
  component: () => <Outlet />,
});
```

- [ ] **Step 17.2: Index `/store` — info dello store attivo**

```tsx
// apps/seller/src/routes/_authenticated/store/index.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@bibs/ui/components/card";
import { createFileRoute } from "@tanstack/react-router";
import { useActiveStore } from "@/hooks/use-active-store";
import { useIsOwner } from "@/hooks/use-is-owner";
import { StoreForm } from "@/features/stores/components/store-form";

export const Route = createFileRoute("/_authenticated/store/")({
  component: StoreSettingsPage,
});

function StoreSettingsPage() {
  const { activeStore } = useActiveStore();
  const isOwner = useIsOwner();

  if (!activeStore) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Nessun negozio selezionato</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Impostazioni — {activeStore.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <StoreForm storeId={activeStore.id} readOnly={!isOwner} />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 17.3: Verifica `StoreForm` accetta prop `readOnly`**

Apri `apps/seller/src/features/stores/components/store-form.tsx`. Se `readOnly` non esiste, aggiungilo:

```tsx
interface StoreFormProps {
  storeId?: string; // se omesso = nuovo store
  readOnly?: boolean;
}

export function StoreForm({ storeId, readOnly = false }: StoreFormProps) {
  // ... existing logic
  // Wrap submit in: if (readOnly) return;
  // For each Input/Textarea: add disabled={readOnly}
  // Hide submit button: {!readOnly && <Button type="submit">Salva</Button>}
}
```

- [ ] **Step 17.4: Re-genera routeTree**

I file route auto-generano `routeTree.gen.ts` quando il dev server gira. Riavvia se necessario:

```bash
bun run dev:seller
```

Expected: `/store` raggiungibile e mostra il form.

- [ ] **Step 17.5: Commit**

```bash
git add apps/seller/src/routes/_authenticated/store.tsx apps/seller/src/routes/_authenticated/store/index.tsx apps/seller/src/features/stores/components/store-form.tsx apps/seller/src/routeTree.gen.ts
git commit -m "feat(seller): add /store route for active-store settings"
```

### Task 18: Crea `/store/new` (owner-only)

**Files:**
- Create: `apps/seller/src/routes/_authenticated/store/new.tsx`

- [ ] **Step 18.1: Route con beforeLoad guard**

```tsx
// apps/seller/src/routes/_authenticated/store/new.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@bibs/ui/components/card";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { StoreForm } from "@/features/stores/components/store-form";

export const Route = createFileRoute("/_authenticated/store/new")({
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (session.data?.user.role !== "seller") {
      throw redirect({ to: "/store" });
    }
  },
  component: NewStorePage,
});

function NewStorePage() {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Nuovo negozio</CardTitle>
      </CardHeader>
      <CardContent>
        <StoreForm /> {/* no storeId = create mode */}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 18.2: `StoreForm` redirect su `setActiveStoreId(newId)` post-creazione**

Apri `store-form.tsx` e nel callback `onSuccess` della mutation di creazione:

```tsx
const { setActiveStoreId } = useActiveStore();
const navigate = useNavigate();
// ...inside mutation onSuccess:
onSuccess: (created) => {
  if (!storeId) {
    setActiveStoreId(created.id);
    navigate({ to: "/" });
  }
}
```

- [ ] **Step 18.3: Verifica typecheck**

```bash
bun run typecheck
```

Expected: exit 0 (gli errori della Task 16 sui `<Link to="/store">` ora si risolvono).

- [ ] **Step 18.4: Commit unificato Task 16+18**

```bash
git add apps/seller/src/components/app-sidebar.tsx apps/seller/src/routes/_authenticated/store/new.tsx apps/seller/src/features/stores/components/store-form.tsx apps/seller/src/routeTree.gen.ts
# (company-header.tsx già rimosso)
git rm apps/seller/src/components/company-header.tsx
git commit -m "feat(seller): rewrite AppSidebar with StoreSwitcher header + scoped /store nav"
```

---

## Phase 8 — Frontend cleanup `/stores` route

### Task 19: Elimina la route plurale `/stores`

**Files:**
- Delete: `apps/seller/src/routes/_authenticated/stores.tsx`
- Delete: `apps/seller/src/routes/_authenticated/stores/` (directory)

- [ ] **Step 19.1: Verifica nessun riferimento residuo**

```bash
grep -rn "to=\"/stores" apps/seller/src/ --include="*.tsx" --include="*.ts"
```

Expected: nessun match. Se ci sono, sostituisci con `to="/store"`.

- [ ] **Step 19.2: Rimuovi i file**

```bash
git rm apps/seller/src/routes/_authenticated/stores.tsx
git rm -r apps/seller/src/routes/_authenticated/stores
```

- [ ] **Step 19.3: Re-genera routeTree (riavvia dev server o vite-build)**

```bash
bun run dev:seller
```

Verifica che `routeTree.gen.ts` non contenga più riferimenti a `/stores/...`.

- [ ] **Step 19.4: Typecheck**

```bash
bun run typecheck
```

Expected: exit 0.

- [ ] **Step 19.5: Commit**

```bash
git add apps/seller/src/routeTree.gen.ts
git commit -m "feat(seller): remove obsolete /stores routes (replaced by /store)"
```

---

## Phase 9 — Pagina Profilo

### Task 20: Aggiungi `<BusinessInfoCard>`

**Files:**
- Create: `apps/seller/src/features/profile/components/business-info-card.tsx`
- Create: `apps/seller/src/features/profile/components/vat-change-dialog.tsx`
- Modify: `apps/seller/src/routes/_authenticated/profile.tsx`

- [ ] **Step 20.1: `BusinessInfoCard`**

```tsx
// apps/seller/src/features/profile/components/business-info-card.tsx
import { Button } from "@bibs/ui/components/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@bibs/ui/components/card";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { z } from "zod";
import { api } from "@/lib/api";
import { useSellerSettings } from "@/hooks/use-seller-settings";
import { VatChangeDialog } from "./vat-change-dialog";

const schema = z.object({
  businessName: z.string().min(1, "Ragione sociale obbligatoria"),
  legalForm: z.string().min(1, "Forma giuridica obbligatoria"),
  addressLine1: z.string().min(1, "Indirizzo obbligatorio"),
  zipCode: z.string().min(1, "CAP obbligatorio"),
  city: z.string().min(1, "Città obbligatoria"),
  province: z.string().nullable().optional(),
  country: z.string().length(2),
});
type Form = z.infer<typeof schema>;

interface Props { readOnly: boolean }

export function BusinessInfoCard({ readOnly }: Props) {
  const { data } = useSellerSettings();
  const org = data?.organization;
  const qc = useQueryClient();
  const [success, setSuccess] = useState(false);
  const [apiError, setApiError] = useState("");

  const { register, handleSubmit, reset, formState } = useForm<Form>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    if (org) reset({
      businessName: org.businessName,
      legalForm: org.legalForm,
      addressLine1: org.addressLine1,
      zipCode: org.zipCode,
      city: org.city,
      province: org.province,
      country: org.country,
    });
  }, [org, reset]);

  const mut = useMutation({
    mutationFn: async (form: Form) => {
      const r = await api().seller.settings.company.patch(form);
      if (r.error) throw new Error(r.error.value?.message || "Errore");
      return r.data;
    },
    onSuccess: () => {
      setSuccess(true);
      void qc.invalidateQueries({ queryKey: ["seller", "settings"] });
    },
    onError: (e: Error) => setApiError(e.message),
  });

  const onSubmit: SubmitHandler<Form> = (form) => {
    setApiError(""); setSuccess(false);
    mut.mutate(form);
  };

  if (!org) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Informazioni aziendali</CardTitle>
        <CardDescription>
          Dati dell'azienda registrata{readOnly ? " (sola lettura)" : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {apiError && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{apiError}</div>
          )}
          {success && (
            <div className="rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
              Informazioni aziendali aggiornate
            </div>
          )}

          <Field data-invalid={!!formState.errors.businessName}>
            <FieldLabel htmlFor="businessName">Ragione sociale</FieldLabel>
            <Input id="businessName" disabled={readOnly} {...register("businessName")} />
            <FieldError errors={[formState.errors.businessName]} />
          </Field>

          <Field data-invalid={!!formState.errors.legalForm}>
            <FieldLabel htmlFor="legalForm">Forma giuridica</FieldLabel>
            <Input id="legalForm" disabled={readOnly} {...register("legalForm")} />
            <FieldError errors={[formState.errors.legalForm]} />
          </Field>

          <Field>
            <FieldLabel htmlFor="vatNumber">Partita IVA</FieldLabel>
            <div className="flex gap-2">
              <Input id="vatNumber" disabled value={org.vatNumber} className="flex-1" />
              {!readOnly && <VatChangeDialog currentVat={org.vatNumber} />}
            </div>
          </Field>

          <Field data-invalid={!!formState.errors.addressLine1}>
            <FieldLabel htmlFor="addressLine1">Indirizzo</FieldLabel>
            <Input id="addressLine1" disabled={readOnly} {...register("addressLine1")} />
            <FieldError errors={[formState.errors.addressLine1]} />
          </Field>

          <div className="grid grid-cols-3 gap-4">
            <Field><FieldLabel htmlFor="zipCode">CAP</FieldLabel>
              <Input id="zipCode" disabled={readOnly} {...register("zipCode")} />
            </Field>
            <Field><FieldLabel htmlFor="city">Città</FieldLabel>
              <Input id="city" disabled={readOnly} {...register("city")} />
            </Field>
            <Field><FieldLabel htmlFor="province">Provincia</FieldLabel>
              <Input id="province" disabled={readOnly} {...register("province")} />
            </Field>
          </div>

          <Field><FieldLabel htmlFor="country">Paese</FieldLabel>
            <Input id="country" disabled={readOnly} {...register("country")} />
          </Field>

          {!readOnly && (
            <Button type="submit" disabled={!formState.isDirty || mut.isPending} className="w-full mt-2">
              {mut.isPending ? "Salvataggio..." : "Salva modifiche"}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 20.2: `VatChangeDialog`**

```tsx
// apps/seller/src/features/profile/components/vat-change-dialog.tsx
import { Button } from "@bibs/ui/components/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@bibs/ui/components/dialog";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";

export function VatChangeDialog({ currentVat }: { currentVat: string }) {
  const [open, setOpen] = useState(false);
  const [vat, setVat] = useState("");
  const [error, setError] = useState("");
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: async () => {
      const r = await api().seller.settings.vat.patch({ vatNumber: vat });
      if (r.error) throw new Error(r.error.value?.message || "Errore");
      return r.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["seller", "settings"] });
      setOpen(false);
      setVat("");
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Richiedi cambio P.IVA</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Richiedi cambio Partita IVA</DialogTitle>
          <DialogDescription>
            La modifica richiede l'approvazione di un amministratore. Durante la review non potrai ricevere nuovi ordini.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label>P.IVA attuale</Label>
          <Input disabled value={currentVat} />
          <Label htmlFor="newVat">Nuova P.IVA</Label>
          <Input id="newVat" value={vat} onChange={(e) => setVat(e.target.value)} placeholder="11 cifre" />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Annulla</Button>
          </DialogClose>
          <Button onClick={() => { setError(""); mut.mutate(); }} disabled={!vat || mut.isPending}>
            {mut.isPending ? "Invio…" : "Richiedi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 20.3: Refactor `profile.tsx` per due card**

```tsx
// apps/seller/src/routes/_authenticated/profile.tsx (rewrite)
import { createFileRoute } from "@tanstack/react-router";
import { BusinessInfoCard } from "@/features/profile/components/business-info-card";
import { PersonalInfoCard } from "@/features/profile/components/personal-info-card";
import { useIsOwner } from "@/hooks/use-is-owner";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const isOwner = useIsOwner();
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <PersonalInfoCard />
      <BusinessInfoCard readOnly={!isOwner} />
    </div>
  );
}
```

Estrai il form esistente di `profile.tsx` in `personal-info-card.tsx` (sposta il blocco JSX così com'è in un componente nuovo). Il file esistente diventa un thin wrapper.

- [ ] **Step 20.4: Verifica nel browser**

Login come owner: vedi entrambe le card, info aziendali editabili. Login come employee (testa con un account employee): info aziendali read-only, no bottone Salva, no bottone Richiedi cambio P.IVA.

- [ ] **Step 20.5: Commit**

```bash
git add apps/seller/src/features/profile/ apps/seller/src/routes/_authenticated/profile.tsx
git commit -m "feat(seller): add BusinessInfoCard to profile page"
```

---

## Phase 10 — Pagina Team

### Task 21: Colonna Negozi + dialog assegnazione

**Files:**
- Create: `apps/seller/src/features/team/components/employee-stores-dialog.tsx`
- Create: `apps/seller/src/features/team/components/store-chips.tsx`
- Modify: `apps/seller/src/routes/_authenticated/team/index.tsx`

- [ ] **Step 21.1: `StoreChips` componente**

```tsx
// apps/seller/src/features/team/components/store-chips.tsx
import { Badge } from "@bibs/ui/components/badge";
import { useStores } from "@/hooks/use-stores";

export function StoreChips({ storeIds }: { storeIds: string[] }) {
  const { data: stores } = useStores();
  const lookup = new Map((stores ?? []).map((s) => [s.id, s.name]));

  if (storeIds.length === 0) {
    return <span className="text-xs text-muted-foreground">Nessun negozio</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {storeIds.map((id) => (
        <Badge key={id} variant="secondary">{lookup.get(id) ?? "?"}</Badge>
      ))}
    </div>
  );
}
```

- [ ] **Step 21.2: `EmployeeStoresDialog`**

```tsx
// apps/seller/src/features/team/components/employee-stores-dialog.tsx
import { Button } from "@bibs/ui/components/button";
import { Checkbox } from "@bibs/ui/components/checkbox";
import {
  Dialog, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@bibs/ui/components/dialog";
import { Label } from "@bibs/ui/components/label";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { useEffect, useState } from "react";
import { useStores } from "@/hooks/use-stores";
import { useEmployeeStores, useUpdateEmployeeStores } from "@/hooks/use-employee-stores";

interface Props {
  employeeId: string;
  employeeName: string;
  trigger: React.ReactNode;
}

export function EmployeeStoresDialog({ employeeId, employeeName, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const { data: allStores } = useStores();
  const { data: assigned, isLoading } = useEmployeeStores(open ? employeeId : null);
  const update = useUpdateEmployeeStores(employeeId);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (assigned) setSelected(new Set(assigned.map((s) => s.id)));
  }, [assigned]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    try {
      await update.mutateAsync(Array.from(selected));
      toast.success("Assegnazioni aggiornate");
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assegna negozi a {employeeName}</DialogTitle>
          <DialogDescription>
            Seleziona i negozi a cui {employeeName} ha accesso.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-4"><Spinner /></div>
        ) : (
          <div className="flex flex-col gap-2 py-2">
            {(allStores ?? []).map((s) => (
              <Label key={s.id} className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} />
                <span>{s.name} <span className="text-xs text-muted-foreground">({s.city}{s.province ? `, ${s.province}` : ""})</span></span>
              </Label>
            ))}
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Annulla</Button>
          </DialogClose>
          <Button onClick={submit} disabled={update.isPending}>
            {update.isPending ? "Salvataggio…" : "Salva"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 21.3: Estendi tabella in `team/index.tsx`**

Trova la `<TableHeader>` e aggiungi una `<TableHead>Negozi</TableHead>` prima di "Azioni". Trova la `<TableRow>` per ogni dipendente e aggiungi una `<TableCell>` con:

```tsx
<TableCell>
  <div className="flex items-center gap-2">
    <StoreChips storeIds={emp.storeIds} />
    <EmployeeStoresDialog
      employeeId={emp.id}
      employeeName={emp.user.name}
      trigger={
        <Button size="icon" variant="ghost" className="h-6 w-6">
          <PencilIcon className="size-3" />
        </Button>
      }
    />
  </div>
</TableCell>
```

(Aggiungi import di `StoreChips`, `EmployeeStoresDialog`, `PencilIcon`.)

- [ ] **Step 21.4: Riga titolare in cima**

Sopra il `<TableBody>` mappato, aggiungi una riga statica per il titolare usando il campo `owner` ritornato da `GET /employees`:

```tsx
{owner && (
  <TableRow>
    <TableCell>{owner.name}</TableCell>
    <TableCell>{owner.email}</TableCell>
    <TableCell><Badge>Titolare</Badge></TableCell>
    <TableCell><span className="text-xs text-muted-foreground">Tutti i negozi</span></TableCell>
    <TableCell></TableCell>
  </TableRow>
)}
```

- [ ] **Step 21.5: Verifica browser + commit**

```bash
bun run dev:seller
# verifica: tabella mostra colonna Negozi, dialog si apre, check di un altro negozio + Salva → toast e refresh.
git add apps/seller/src/features/team/ apps/seller/src/routes/_authenticated/team/index.tsx
git commit -m "feat(seller): add stores column + assignment dialog to Team page"
```

### Task 22: Invito con preselezione store

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/team/index.tsx`

- [ ] **Step 22.1: Estendi il dialog "Invita collaboratore"**

Trova il dialog di invito esistente. Aggiungi una `useState<Set<string>>` per gli storeIds selezionati. Inserisci la lista di checkbox sopra il bottone "Invia":

```tsx
const [inviteStores, setInviteStores] = useState<Set<string>>(new Set());
const { data: allStores } = useStores();

// In the dialog body, after email input:
<Label>Negozi a cui assegnare *</Label>
<div className="flex flex-col gap-1">
  {(allStores ?? []).map((s) => (
    <Label key={s.id} className="flex items-center gap-2 cursor-pointer">
      <Checkbox
        checked={inviteStores.has(s.id)}
        onCheckedChange={() => setInviteStores((prev) => {
          const n = new Set(prev);
          if (n.has(s.id)) n.delete(s.id); else n.add(s.id);
          return n;
        })}
      />
      <span>{s.name}</span>
    </Label>
  ))}
</div>
{inviteStores.size === 0 && (
  <p className="text-xs text-muted-foreground">Almeno 1 negozio richiesto</p>
)}
```

Nel submit handler:

```ts
const r = await api().seller.employees.invite.post({
  email,
  storeIds: Array.from(inviteStores),
});
```

Disabilita il bottone Invia se `email` invalida o `inviteStores.size === 0`.

- [ ] **Step 22.2: Mostra chip degli store sull'invito pendente**

Nella sezione "Inviti pendenti" della tabella, aggiungi una colonna/cell con `<StoreChips storeIds={invitation.storeIds} />`.

- [ ] **Step 22.3: Reset state al chiudere il dialog**

Nel handler `onOpenChange={setInviteOpen}`, quando si chiude resetta email e `inviteStores`.

- [ ] **Step 22.4: Browser test + commit**

```bash
bun run dev:seller
# verifica: invita un nuovo dipendente con preselezione di 2 store → invito appare nella tabella inviti con chip → simula accept (creando un user via il token) → l'employee appare con i 2 store assegnati.
git add apps/seller/src/routes/_authenticated/team/index.tsx
git commit -m "feat(seller): preselect stores in employee invite dialog"
```

---

## Phase 11 — Pagina Prodotti store-scoped

### Task 23: Filtra prodotti per store attivo

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/products/index.tsx`
- Modify: `apps/seller/src/routes/_authenticated/products/new.tsx`
- Modify: `apps/seller/src/features/products/components/product-form.tsx`

- [ ] **Step 23.1: Lista prodotti usa `useProducts(activeStoreId)`**

```tsx
// In products/index.tsx, sostituisci l'attuale useQuery con:
const { activeStore } = useActiveStore();
const { data, isLoading, error } = useProducts(activeStore?.id ?? null);

// Nel header h1:
<h1>Prodotti — {activeStore?.name ?? ""}</h1>
```

- [ ] **Step 23.2: Empty state**

Quando `data?.data.length === 0` e non `isLoading`:

```tsx
<div className="text-center py-12">
  <PackageIcon className="size-12 mx-auto text-muted-foreground" />
  <h2 className="mt-4 text-lg font-medium">Nessun prodotto in {activeStore?.name}</h2>
  <p className="text-sm text-muted-foreground">Inizia ad aggiungere prodotti al catalogo di questo negozio.</p>
  <Button asChild className="mt-4">
    <Link to="/products/new"><PlusIcon /> Crea il primo prodotto</Link>
  </Button>
</div>
```

- [ ] **Step 23.3: `ProductForm` passa `storeId` in submit**

Apri `product-form.tsx`. Nell'`onSubmit` della mutation di creazione, includi `storeId: activeStore.id` nel payload. Importa `useActiveStore`.

- [ ] **Step 23.4: Toast post-creazione include nome store**

```tsx
toast.success(`Prodotto creato in ${activeStore?.name}`);
```

- [ ] **Step 23.5: Verifica browser**

```bash
bun run dev:seller
```

- Crea prodotto in store A → vedi solo in A.
- Switch su store B → empty state.
- Empty state CTA "Crea il primo prodotto" funziona.

- [ ] **Step 23.6: Elimina `store-inventory.tsx`**

```bash
git rm apps/seller/src/features/stores/components/store-inventory.tsx
```

Verifica nessun import residuo:

```bash
grep -rn "store-inventory" apps/seller/src/
```

- [ ] **Step 23.7: Commit**

```bash
git add apps/seller/src/
git commit -m "feat(seller): filter products by active store + remove store-inventory"
```

---

## Phase 12 — Empty state employee senza negozi

### Task 24: Dead-end UI per employee non assegnato

**Files:**
- Modify: `apps/seller/src/routes/_authenticated.tsx`

- [ ] **Step 24.1: Inserisci check + render dedicato**

Apri `_authenticated.tsx`. Tra il check `if (role !== "seller" && role !== "employee")` e il return della sidebar, aggiungi:

```tsx
// After the role check:
const { data: stores, isLoading: storesLoading } = useStores();

if (role === "employee") {
  if (storesLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }
  if ((stores?.length ?? 0) === 0) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-bold">Nessun negozio assegnato</h1>
        <p className="text-muted-foreground max-w-md">
          Non sei ancora assegnato a nessun negozio. Contatta il titolare per ottenere l'accesso.
        </p>
        <Button
          variant="outline"
          onClick={() => void authClient.signOut().then(() => navigate({ to: "/login" }))}
        >
          Esci
        </Button>
      </div>
    );
  }
}
```

Aggiungi import: `useStores`, `Button`.

- [ ] **Step 24.2: Verifica browser**

Crea un employee senza assegnazione (via DB diretta o via "invita poi de-assegna"). Login come quel employee → deve vedere lo schermo dead-end.

- [ ] **Step 24.3: Commit**

```bash
git add apps/seller/src/routes/_authenticated.tsx
git commit -m "feat(seller): dead-end empty state for employee with no stores"
```

---

## Phase 13 — i18n + smoke test + finalizzazione

### Task 25: i18n + smoke test full + PR

**Files:**
- Modify: `apps/seller/messages/it.json` (e altre locali presenti)

- [ ] **Step 25.1: Audit hard-coded copy**

```bash
grep -rn "Nessun negozio\|Modifica negozio\|Aggiungi negozio\|Impostazioni negozio\|Informazioni aziendali\|Richiedi cambio\|Assegna negozi" apps/seller/src/ --include="*.tsx" --include="*.ts"
```

Per ogni stringa user-facing, sposta in `messages/it.json` con chiave coerente (es. `team.assignStores`, `profile.businessInfo`, ecc.) e riferiscila via Paraglide. Esempio:

```ts
// messages/it.json
{
  "team": {
    "assignStores": "Assegna negozi a {name}",
    "noStores": "Nessun negozio",
    "allStores": "Tutti i negozi"
  },
  "profile": {
    "businessInfo": "Informazioni aziendali",
    "vatChange": "Richiedi cambio P.IVA"
  },
  "products": {
    "createdIn": "Prodotto creato in {storeName}"
  },
  "store": {
    "active": "Modifica negozio attivo",
    "addNew": "Aggiungi negozio",
    "settings": "Impostazioni negozio"
  },
  "employee": {
    "noStoresTitle": "Nessun negozio assegnato",
    "noStoresBody": "Non sei ancora assegnato a nessun negozio. Contatta il titolare per ottenere l'accesso."
  }
}
```

Replica le stesse chiavi nelle altre locale (en.json, ecc.) — verifica `apps/seller/messages/`.

- [ ] **Step 25.2: Run paraglide build**

Probabilmente non serve (è on-the-fly), ma verifica typecheck:

```bash
bun run typecheck
```

- [ ] **Step 25.3: Smoke test browser completo**

Avvia tutti i dev server:

```bash
bun run dev
```

Testa nello specifico:

1. Owner login, 1 store: switcher dropdown apribile, "+ Aggiungi negozio" visibile.
2. Owner crea secondo negozio: switch automatico al nuovo, redirect a `/`.
3. Owner crea prodotto in store A: appare in lista A, switch su B → empty state.
4. Owner pagina Team: invita un nuovo collaboratore con 1 store preselezionato. Verifica email arriva (mailcatcher).
5. Apri token invito → registra password → login → employee vede solo lo store preselezionato.
6. Owner pagina Team: edita assegnazioni dell'employee → aggiungi un altro store. Refresh employee → vede 2 store nello switcher.
7. Owner pagina Team: rimuovi entrambe le assegnazioni dell'employee. Refresh employee → empty state dead-end.
8. Profilo come owner: edita ragione sociale + Salva → toast successo. Click "Richiedi cambio P.IVA" → dialog si apre.
9. Profilo come employee (assegnato di nuovo): vedi 2 card, info aziendali read-only, no bottoni di edit.
10. Verifica `/openapi` mostra i 2 nuovi endpoint `/seller/employees/:id/stores` con descrizione italiana.

- [ ] **Step 25.4: Run full test + lint**

```bash
bun run typecheck
bun run lint
bun run test  # solo apps/api
```

Expected: tutto verde. Sistema regressioni residue.

- [ ] **Step 25.5: Commit i18n**

```bash
git add apps/seller/messages/ apps/seller/src/
git commit -m "feat(seller): externalize copy to i18n messages"
```

- [ ] **Step 25.6: Push e crea PR**

```bash
git push -u origin feat/seller-store-switcher-roles
gh pr create --title "feat(seller): store switcher, owner/employee roles, sidebar refactor" --body "$(cat <<'EOF'
## Summary
Implements the spec at `docs/superpowers/specs/2026-05-02-store-switcher-roles-design.md`:
- Store switcher in sidebar header drives the active-store context for products/stock/orders.
- Owner vs Employee role distinction. Employees are assigned to one or more stores by the owner; their sidebar/data is filtered to those stores.
- "Profilo" and "Team" moved into the user dropdown footer. "Negozi" list page replaced by `/store` (active-store settings) + "+ Aggiungi negozio" inside the switcher.
- Profile page now shows a "Personal info" card (always) + "Business info" card (visible to all, editable only by owner; VAT change goes through existing approval flow).
- Invite flow: owner preselects stores at invite time; assignments propagate automatically when the invite is accepted.

## Test plan
- [ ] `bun run typecheck` (root)
- [ ] `bun run lint` (root)
- [ ] `bun run test` (apps/api)
- [ ] Browser smoke (steps 1–10 in plan Phase 13 Task 25.3)
- [ ] OpenAPI spec at `/openapi` documents new endpoints with Italian descriptions

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes & links

- **Spec** (single source of truth): `docs/superpowers/specs/2026-05-02-store-switcher-roles-design.md`
- **Out of scope** (esplicito nello spec): promozioni, real-time push, ruoli granulari per employee, modifica `storeIds` su invito pending, refactor admin/customer.
- **Non bypassare i pre-commit hook** (Lefthook + Biome). Se un hook fallisce, fixa l'issue, non `--no-verify`.
- **DB non condiviso**: lavora su DB locale. Mai `db:push` su branch condivisi — sempre `db:generate` + review SQL + `db:migrate`.
