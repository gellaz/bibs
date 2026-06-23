# Customer Store Discovery — Implementation Plan (#1: endpoint + lista UI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public `GET /customer/stores` discovery endpoint (optional text search, proximity ordering, "all stores" fallback) and a customer `/stores` search page that consumes it.

**Architecture:** A new pure service `searchStores` builds a single PostGIS query (visibility predicate + optional ILIKE on name/comune + optional category + optional geo distance) and attaches per-page open-status via a helper extracted from the seller service. A thin public Elysia route wraps it. The customer app gets a `/stores` route with a store-tile grid, a shared geolocation hook, and a React Query infinite hook.

**Tech Stack:** Elysia + Drizzle + PostGIS (`::geography`, `ST_Distance`, `ST_DWithin`), Bun test + testcontainers, TanStack Start/Router/Query, Eden Treaty, Tailwind 4, `@bibs/ui`.

## Global Constraints

- **Commits:** Conventional Commits with repo scope whitelist (`customer`, `api`, …). Never commit to `main` (we are on branch `feat/customer-store-discovery`). Never `--no-verify`.
- **Copy:** all user-facing copy in **Italian**.
- **Tokens:** UI surfaces use **theme-aware** tokens (`background/foreground/muted/border/primary`); fixed tokens (`cream/ink/saffron-*`) only for accents/labels on photos. Verify dark via `localStorage.theme='dark'`.
- **Dates:** Eden Treaty rehydrates date strings to `Date`; coerce calendar dates with `toYMD` at the use site.
- **Pagination:** API cap = 100 (`config.pagination.maxLimit`); use `parsePagination`.
- **Enums in SQL:** subscription statuses are the literals `active|past_due|canceling|suspended|canceled`.
- **Lint:** Biome runs on commit (auto-fix hook). `noUnusedLocals` is enforced — remove dead imports in the same edit.
- **Italy/timezone:** open-status computed in `Europe/Rome`.

---

### Task 1: Extract shared `resolveOpenStatuses` helper

Pull the per-page open-status batch logic out of the seller service into a reusable lib so the new store-discovery service can use the identical computation. Guarded by the existing seller open-status integration test.

**Files:**
- Create: `apps/api/src/lib/store-open-status.ts`
- Modify: `apps/api/src/modules/seller/services/stores.ts:1-25` (imports) and `:80-131` (inline logic → helper call)
- Test (regression, existing): `apps/api/tests/integration/seller-store-open-status.test.ts`

**Interfaces:**
- Produces: `resolveOpenStatuses(stores: Array<{ id: string; openingHours: OpeningHoursDay[] | null; closures: CustomClosure[] | null }>, now: Date): Promise<Map<string, OpenStatus>>`

- [ ] **Step 1: Run the existing seller open-status test to confirm green baseline**

Run: `cd apps/api && bun test tests/integration/seller-store-open-status.test.ts --timeout 180000`
Expected: PASS (2 tests). (Requires Docker for testcontainers.)

- [ ] **Step 2: Create the helper**

Create `apps/api/src/lib/store-open-status.ts`:

```ts
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { holidayDefinition } from "@/db/schemas/holiday-definition";
import { storeHolidayOptout } from "@/db/schemas/store-holiday-optout";
import type {
	CustomClosure,
	HolidayDef,
	OpeningHoursDay,
	OpenStatus,
} from "@/lib/holidays";
import {
	addDaysYMD,
	getOpenStatus,
	resolveStoreClosedDates,
} from "@/lib/holidays";

interface StoreOpenStatusInput {
	id: string;
	openingHours: OpeningHoursDay[] | null;
	closures: CustomClosure[] | null;
}

/**
 * Computes the current open-status for a batch of stores (one DB round-trip for
 * holiday definitions + opt-outs, then pure in-memory resolution per store).
 * "Now" is evaluated in Europe/Rome. Returns a map keyed by store id.
 */
export async function resolveOpenStatuses(
	stores: StoreOpenStatusInput[],
	now: Date,
): Promise<Map<string, OpenStatus>> {
	const today = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Europe/Rome",
	}).format(now);
	const windowEnd = addDaysYMD(today, 60);
	const storeIds = stores.map((s) => s.id);

	const [activeDefs, optOutRows] = await Promise.all([
		db.query.holidayDefinition.findMany({
			where: eq(holidayDefinition.isActive, true),
		}),
		storeIds.length > 0
			? db
					.select({
						storeId: storeHolidayOptout.storeId,
						holidayDefinitionId: storeHolidayOptout.holidayDefinitionId,
					})
					.from(storeHolidayOptout)
					.where(inArray(storeHolidayOptout.storeId, storeIds))
			: Promise.resolve(
					[] as Array<{ storeId: string; holidayDefinitionId: string }>,
				),
	]);

	const optOutsByStore = new Map<string, string[]>();
	for (const row of optOutRows) {
		const list = optOutsByStore.get(row.storeId) ?? [];
		list.push(row.holidayDefinitionId);
		optOutsByStore.set(row.storeId, list);
	}

	const result = new Map<string, OpenStatus>();
	for (const s of stores) {
		const closedDates = resolveStoreClosedDates(
			{
				activeDefs: activeDefs as HolidayDef[],
				optOutIds: optOutsByStore.get(s.id) ?? [],
				customClosures: s.closures ?? [],
			},
			{ from: today, to: windowEnd },
		);
		result.set(
			s.id,
			getOpenStatus({ openingHours: s.openingHours ?? null, closedDates, now }),
		);
	}
	return result;
}
```

- [ ] **Step 3: Replace the inline logic in the seller service**

In `apps/api/src/modules/seller/services/stores.ts`, replace the block from `const now = new Date();` through the `return { data: dataWithStatus, ... }` of `listStores` (currently lines ~80-131) with:

```ts
	const statusMap = await resolveOpenStatuses(
		data.map((s) => ({
			id: s.id,
			openingHours: s.openingHours ?? null,
			closures: (s.closures as CustomClosure[] | null) ?? null,
		})),
		new Date(),
	);
	const dataWithStatus = data.map((s) => ({
		...s,
		openStatus: statusMap.get(s.id) ?? null,
	}));

	return { data: dataWithStatus, pagination: { page, limit, total } };
}
```

- [ ] **Step 4: Fix imports in the seller service (noUnusedLocals)**

In `apps/api/src/modules/seller/services/stores.ts` top imports:
- Remove `import { holidayDefinition } from "@/db/schemas/holiday-definition";`
- Remove `import { storeHolidayOptout } from "@/db/schemas/store-holiday-optout";`
- Change `import type { CustomClosure, HolidayDef } from "@/lib/holidays";` → `import type { CustomClosure } from "@/lib/holidays";`
- Remove the whole `import { addDaysYMD, getOpenStatus, resolveStoreClosedDates } from "@/lib/holidays";`
- Add `import { resolveOpenStatuses } from "@/lib/store-open-status";`
- Keep `inArray` (still used by `filterStoreIds`) and `eq`, `municipality`/`province`, etc.

- [ ] **Step 5: Typecheck + run the regression test**

Run: `cd apps/api && bun run typecheck && bun test tests/integration/seller-store-open-status.test.ts --timeout 180000`
Expected: typecheck clean; 2 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/store-open-status.ts apps/api/src/modules/seller/services/stores.ts
git commit -m "refactor(api): extract resolveOpenStatuses helper from seller stores"
```

---

### Task 2: `searchStores` service + visibility predicate (TDD)

The core discovery query. Add test fixtures it needs, write the full failing test suite, implement the service, go green.

**Files:**
- Create: `apps/api/src/lib/store-visibility.ts`
- Create: `apps/api/src/modules/customer/services/store-discovery.ts`
- Modify: `apps/api/tests/helpers/fixtures.ts` (add store subscription / category / image fixtures + extend `createTestStore`)
- Test: `apps/api/tests/integration/customer-store-discovery.test.ts`

**Interfaces:**
- Consumes: `resolveOpenStatuses` (Task 1); fixtures `createTestSeller`, `createTestStore`, `createTestMunicipality` (existing).
- Produces:
  - `publiclyVisibleStore(): SQL` — boolean predicate fragment for a WHERE clause.
  - `searchStores(params: { q?: string; categoryId?: string; lat?: number; lng?: number; radius?: number; page?: number; limit?: number }): Promise<{ data: StoreCard[]; pagination: { page: number; limit: number; total: number } }>`
  - `StoreCard = { id: string; name: string; category: { id: string; name: string } | null; municipality: { id: string; name: string; provinceAcronym: string }; addressLine1: string; distance: number | null; image: { url: string } | null; openStatus: OpenStatus }`
  - Fixtures: `createTestStoreSubscription(db, storeId, { status? })`, `createTestStoreCategory(db, name?)`, `createTestStoreImage(db, storeId, { url?, position? })`; `createTestStore` gains optional `categoryId`, `openingHours`, `closures`.

- [ ] **Step 1: Extend the test fixtures**

In `apps/api/tests/helpers/fixtures.ts`:

Add these imports near the existing schema imports:
```ts
import { storeCategory } from "@/db/schemas/store-category";
import { storeImage } from "@/db/schemas/store-image";
import {
	storeSubscription,
	type StoreSubscriptionStatus,
} from "@/db/schemas/store-subscription";
```

Extend `createTestStore`'s `params` type and insert values to accept opening hours / closures / category. Replace the existing `createTestStore` with:
```ts
export async function createTestStore(
	db: DrizzleTestDb,
	sellerProfileId: string,
	params: {
		name?: string;
		municipalityId?: string;
		/** longitude (x) */
		lng?: number;
		/** latitude (y) */
		lat?: number;
		/** null = leave location unset (for NULLS-LAST ordering tests) */
		noLocation?: boolean;
		categoryId?: string;
		openingHours?: Array<{
			dayOfWeek: number;
			slots: Array<{ open: string; close: string }>;
		}>;
		closures?: Array<{ startDate: string; endDate?: string; note?: string }>;
	} = {},
) {
	const lng = params.lng ?? 12.4964; // Rome
	const lat = params.lat ?? 41.9028;

	const municipalityId =
		params.municipalityId ?? (await createTestMunicipality(db)).id;

	const [newStore] = await db
		.insert(store)
		.values({
			sellerProfileId,
			name: params.name ?? "Test Store",
			addressLine1: "Via Roma 1",
			municipalityId,
			zipCode: "00100",
			country: "IT",
			categoryId: params.categoryId,
			openingHours: params.openingHours,
			closures: params.closures,
			// Raw SQL needed for PostGIS geometry column
			location: params.noLocation
				? null
				: sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`,
		} as any)
		.returning();

	return newStore;
}
```

Append these new fixtures at the end of the file:
```ts
// ── Store subscription / category / image ───────────────────────────────────

export async function createTestStoreSubscription(
	db: DrizzleTestDb,
	storeId: string,
	params: { status?: StoreSubscriptionStatus } = {},
) {
	const unique = crypto.randomUUID().slice(0, 8);
	const [sub] = await db
		.insert(storeSubscription)
		.values({
			storeId,
			stripeSubscriptionId: `sub_${unique}`,
			stripeCustomerId: `cus_${unique}`,
			stripePriceId: `price_${unique}`,
			feeAmountCents: 1000,
			status: params.status ?? "active",
			currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
		})
		.returning();
	return sub;
}

export async function createTestStoreCategory(
	db: DrizzleTestDb,
	name = "Test Store Category",
) {
	const [c] = await db.insert(storeCategory).values({ name }).returning();
	return c;
}

export async function createTestStoreImage(
	db: DrizzleTestDb,
	storeId: string,
	params: { url?: string; position?: number } = {},
) {
	const unique = crypto.randomUUID().slice(0, 8);
	const [img] = await db
		.insert(storeImage)
		.values({
			storeId,
			url: params.url ?? `https://img.test/${unique}.jpg`,
			key: `stores/${unique}.jpg`,
			position: params.position ?? 0,
		})
		.returning();
	return img;
}

/** Create a municipality with a specific name (region/province auto-created). */
export async function createTestMunicipalityNamed(
	db: DrizzleTestDb,
	name: string,
) {
	return createTestMunicipality(db, { municipalityName: name });
}
```

- [ ] **Step 2: Write the failing test suite**

Create `apps/api/tests/integration/customer-store-discovery.test.ts`:

```ts
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";

import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

import { searchStores } from "@/modules/customer/services/store-discovery";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestMunicipalityNamed,
	createTestSeller,
	createTestStore,
	createTestStoreCategory,
	createTestStoreImage,
	createTestStoreSubscription,
} from "../helpers/fixtures";

const ROME = { lat: 41.9028, lng: 12.4964 };
const MILAN = { lat: 45.4654, lng: 9.19 };

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

/** Creates a visible store (active subscription) for the given seller. */
async function visibleStore(
	sellerProfileId: string,
	params: Parameters<typeof createTestStore>[2] = {},
) {
	const db = getTestDb();
	const s = await createTestStore(db, sellerProfileId, params);
	await createTestStoreSubscription(db, s.id, { status: "active" });
	return s;
}

describe("searchStores — visibility", () => {
	it("excludes soft-deleted, suspended, canceled, and subscription-less stores", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);

		const live = await createTestStore(db, profile.id, { name: "Vivo" });
		await createTestStoreSubscription(db, live.id, { status: "active" });

		const pastDue = await createTestStore(db, profile.id, { name: "Scaduto" });
		await createTestStoreSubscription(db, pastDue.id, { status: "past_due" });

		const canceling = await createTestStore(db, profile.id, {
			name: "InCancellazione",
		});
		await createTestStoreSubscription(db, canceling.id, {
			status: "canceling",
		});

		const suspended = await createTestStore(db, profile.id, {
			name: "Sospeso",
		});
		await createTestStoreSubscription(db, suspended.id, {
			status: "suspended",
		});

		const canceled = await createTestStore(db, profile.id, {
			name: "Cancellato",
		});
		await createTestStoreSubscription(db, canceled.id, { status: "canceled" });

		// No subscription at all
		await createTestStore(db, profile.id, { name: "SenzaAbbonamento" });

		const result = await searchStores({});
		const names = result.data.map((s) => s.name).sort();
		expect(names).toEqual(["InCancellazione", "Scaduto", "Vivo"]);
		expect(result.pagination.total).toBe(3);
	});
});

describe("searchStores — default order + shape", () => {
	it("returns all visible stores alphabetically when no query/geo", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, { name: "Zeta" });
		await visibleStore(profile.id, { name: "Alfa" });
		await visibleStore(profile.id, { name: "Mike" });

		const result = await searchStores({});
		expect(result.data.map((s) => s.name)).toEqual(["Alfa", "Mike", "Zeta"]);
	});

	it("includes category, municipality, address, image, and a null distance", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const cat = await createTestStoreCategory(db, "Libreria");
		const s = await visibleStore(profile.id, {
			name: "La Libreria",
			categoryId: cat.id,
		});
		await createTestStoreImage(db, s.id, {
			url: "https://img.test/cover.jpg",
			position: 0,
		});

		const result = await searchStores({});
		const card = result.data[0];
		expect(card.category).toEqual({ id: cat.id, name: "Libreria" });
		expect(typeof card.municipality.name).toBe("string");
		expect(card.municipality.provinceAcronym).toHaveLength(2);
		expect(card.addressLine1).toBe("Via Roma 1");
		expect(card.image).toEqual({ url: "https://img.test/cover.jpg" });
		expect(card.distance).toBeNull();
	});

	it("picks the lowest-position image as the cover", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id, { name: "Negozio" });
		await createTestStoreImage(db, s.id, { url: "https://img.test/b.jpg", position: 2 });
		await createTestStoreImage(db, s.id, { url: "https://img.test/a.jpg", position: 0 });

		const result = await searchStores({});
		expect(result.data[0].image).toEqual({ url: "https://img.test/a.jpg" });
	});

	it("returns a null image when the store has none", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, { name: "SenzaFoto" });
		const result = await searchStores({});
		expect(result.data[0].image).toBeNull();
	});
});

describe("searchStores — text search (name + comune)", () => {
	it("matches by store name (contains)", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, { name: "La Libreria Centrale" });
		await visibleStore(profile.id, { name: "Panificio Rossi" });

		const result = await searchStores({ q: "libr" });
		expect(result.data.map((s) => s.name)).toEqual(["La Libreria Centrale"]);
	});

	it("ranks a name prefix match above a name contains match", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, { name: "Centro Libri" }); // contains "libr"
		await visibleStore(profile.id, { name: "Libreria Bianchi" }); // prefix "libr"

		const result = await searchStores({ q: "libr" });
		expect(result.data.map((s) => s.name)).toEqual([
			"Libreria Bianchi",
			"Centro Libri",
		]);
	});

	it("matches by municipality (comune) name", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const milano = await createTestMunicipalityNamed(db, "Milano");
		await visibleStore(profile.id, {
			name: "Negozio Nord",
			municipalityId: milano.id,
		});
		await visibleStore(profile.id, { name: "Negozio Sud" }); // default "Test City ..."

		const result = await searchStores({ q: "milano" });
		expect(result.data.map((s) => s.name)).toEqual(["Negozio Nord"]);
	});
});

describe("searchStores — category filter", () => {
	it("returns only stores in the given category", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const libreria = await createTestStoreCategory(db, "Libreria");
		const panificio = await createTestStoreCategory(db, "Panificio");
		await visibleStore(profile.id, { name: "Libri & Co", categoryId: libreria.id });
		await visibleStore(profile.id, { name: "Pane Caldo", categoryId: panificio.id });

		const result = await searchStores({ categoryId: libreria.id });
		expect(result.data.map((s) => s.name)).toEqual(["Libri & Co"]);
	});
});

describe("searchStores — geo", () => {
	it("orders by distance (nearest first) and returns distance in meters", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, { name: "Milano", ...MILAN });
		await visibleStore(profile.id, { name: "Roma", ...ROME });

		const result = await searchStores({ lat: ROME.lat, lng: ROME.lng });
		expect(result.data.map((s) => s.name)).toEqual(["Roma", "Milano"]);
		expect(result.data[0].distance ?? -1).toBeGreaterThanOrEqual(0);
		expect(result.data[1].distance ?? 0).toBeGreaterThan(
			result.data[0].distance ?? 0,
		);
	});

	it("places stores without a location last (NULLS LAST)", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, { name: "SenzaPosizione", noLocation: true });
		await visibleStore(profile.id, { name: "Roma", ...ROME });

		const result = await searchStores({ lat: ROME.lat, lng: ROME.lng });
		expect(result.data.map((s) => s.name)).toEqual(["Roma", "SenzaPosizione"]);
		expect(result.data[1].distance).toBeNull();
	});

	it("filters by radius when provided", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, { name: "Roma", ...ROME });
		await visibleStore(profile.id, { name: "Milano", ...MILAN });

		const result = await searchStores({
			lat: ROME.lat,
			lng: ROME.lng,
			radius: 50,
		});
		expect(result.data.map((s) => s.name)).toEqual(["Roma"]);
	});
});

describe("searchStores — open status", () => {
	it("reports open when the store is open now", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, {
			name: "SempreAperto",
			openingHours: Array.from({ length: 7 }, (_, i) => ({
				dayOfWeek: i,
				slots: [{ open: "00:00", close: "23:59" }],
			})),
		});

		const result = await searchStores({});
		expect(result.data[0].openStatus.isOpen).toBe(true);
		expect(result.data[0].openStatus.status).toBe("open");
	});

	it("reports closed when openingHours is unset", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await visibleStore(profile.id, { name: "Chiuso" });

		const result = await searchStores({});
		expect(result.data[0].openStatus.isOpen).toBe(false);
		expect(result.data[0].openStatus.status).toBe("closed");
	});
});

describe("searchStores — pagination", () => {
	it("respects limit and page with a stable order", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		for (const name of ["A", "B", "C", "D", "E"]) {
			await visibleStore(profile.id, { name });
		}

		const page1 = await searchStores({ page: 1, limit: 2 });
		const page2 = await searchStores({ page: 2, limit: 2 });
		const page3 = await searchStores({ page: 3, limit: 2 });

		expect(page1.data.map((s) => s.name)).toEqual(["A", "B"]);
		expect(page2.data.map((s) => s.name)).toEqual(["C", "D"]);
		expect(page3.data.map((s) => s.name)).toEqual(["E"]);
		expect(page1.pagination.total).toBe(5);
	});
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/api && bun test tests/integration/customer-store-discovery.test.ts --timeout 180000`
Expected: FAIL — `Cannot find module '@/modules/customer/services/store-discovery'`.

- [ ] **Step 4: Create the visibility predicate**

Create `apps/api/src/lib/store-visibility.ts`:

```ts
import { sql } from "drizzle-orm";
import { store } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";

/**
 * SQL boolean predicate (for a WHERE clause) selecting stores that are
 * publicly visible to customers: not soft-deleted AND backed by a subscription
 * in a "live" status (active / past_due / canceling). Suspended, canceled, and
 * subscription-less stores are hidden.
 */
export function publiclyVisibleStore() {
	return sql`(
		${store.deletedAt} IS NULL
		AND EXISTS (
			SELECT 1 FROM ${storeSubscription}
			WHERE ${storeSubscription.storeId} = ${store.id}
			AND ${storeSubscription.status} IN ('active', 'past_due', 'canceling')
		)
	)`;
}
```

- [ ] **Step 5: Create the discovery service**

Create `apps/api/src/modules/customer/services/store-discovery.ts`:

```ts
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { municipality, province } from "@/db/schemas/location";
import { store } from "@/db/schemas/store";
import { storeCategory } from "@/db/schemas/store-category";
import { storeImage } from "@/db/schemas/store-image";
import type {
	CustomClosure,
	OpeningHoursDay,
	OpenStatus,
} from "@/lib/holidays";
import { parsePagination } from "@/lib/pagination";
import { resolveOpenStatuses } from "@/lib/store-open-status";
import { publiclyVisibleStore } from "@/lib/store-visibility";

interface StoreSearchParams {
	q?: string;
	categoryId?: string;
	lat?: number;
	lng?: number;
	radius?: number;
	page?: number;
	limit?: number;
}

export interface StoreCard {
	id: string;
	name: string;
	category: { id: string; name: string } | null;
	municipality: { id: string; name: string; provinceAcronym: string };
	addressLine1: string;
	distance: number | null;
	image: { url: string } | null;
	openStatus: OpenStatus;
}

export async function searchStores(params: StoreSearchParams) {
	const { q, categoryId, lat, lng, radius } = params;
	const { page, limit, offset } = parsePagination(params);
	const hasGeo = lat !== undefined && lng !== undefined;

	const conditions: ReturnType<typeof sql>[] = [publiclyVisibleStore()];

	if (q) {
		conditions.push(
			sql`(${store.name} ILIKE ${`%${q}%`} OR ${municipality.name} ILIKE ${`%${q}%`})`,
		);
	}
	if (categoryId) {
		conditions.push(sql`${store.categoryId} = ${categoryId}`);
	}
	if (hasGeo && radius !== undefined) {
		conditions.push(
			sql`ST_DWithin(
				${store.location}::geography,
				ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
				${radius * 1000}
			)`,
		);
	}

	const whereClause = sql.join(conditions, sql` AND `);

	// Distance: stores.location is on the row directly (no correlated subquery),
	// but in a SELECT-field sql template Drizzle renders interpolated Columns
	// UNqualified, so reference the table literally (`stores.location`).
	const distanceExpr = hasGeo
		? sql`ST_Distance(
				stores.location::geography,
				ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
			)`
		: sql`NULL`;

	const relevanceExpr = q
		? sql`CASE
				WHEN ${store.name} ILIKE ${`${q}%`} THEN 2
				WHEN ${store.name} ILIKE ${`%${q}%`} THEN 1
				ELSE 0
			END`
		: sql`0`;

	// relevance DESC (if q) → distance ASC NULLS LAST (if geo) → name → id.
	const orderParts: ReturnType<typeof sql>[] = [];
	if (q) orderParts.push(sql`relevance DESC`);
	if (hasGeo) orderParts.push(sql`distance ASC NULLS LAST`);
	orderParts.push(sql`${store.name} ASC`);
	orderParts.push(sql`${store.id} ASC`);
	const orderExpr = sql.join(orderParts, sql`, `);

	const [rows, [{ total }]] = await Promise.all([
		db
			.select({
				id: store.id,
				name: store.name,
				addressLine1: store.addressLine1,
				openingHours: store.openingHours,
				closures: store.closures,
				categoryId: store.categoryId,
				categoryName: storeCategory.name,
				municipalityId: municipality.id,
				municipalityName: municipality.name,
				provinceAcronym: province.acronym,
				distance: sql<number | null>`${distanceExpr}`.as("distance"),
				relevance: sql<number>`${relevanceExpr}`.as("relevance"),
				imageUrl: sql<string | null>`(
					SELECT si.url FROM ${storeImage} si
					WHERE si.store_id = stores.id
					ORDER BY si.position ASC
					LIMIT 1
				)`.as("image_url"),
			})
			.from(store)
			.innerJoin(
				municipality,
				sql`${municipality.id} = ${store.municipalityId}`,
			)
			.innerJoin(province, sql`${province.id} = ${municipality.provinceId}`)
			.leftJoin(storeCategory, sql`${storeCategory.id} = ${store.categoryId}`)
			.where(whereClause)
			.orderBy(orderExpr)
			.limit(limit)
			.offset(offset),
		db
			.select({ total: sql<number>`count(*)::int` })
			.from(store)
			.innerJoin(
				municipality,
				sql`${municipality.id} = ${store.municipalityId}`,
			)
			.where(whereClause),
	]);

	const statusMap = await resolveOpenStatuses(
		rows.map((r) => ({
			id: r.id,
			openingHours: r.openingHours as OpeningHoursDay[] | null,
			closures: r.closures as CustomClosure[] | null,
		})),
		new Date(),
	);

	const data: StoreCard[] = rows.map((r) => ({
		id: r.id,
		name: r.name,
		category:
			r.categoryId && r.categoryName
				? { id: r.categoryId, name: r.categoryName }
				: null,
		municipality: {
			id: r.municipalityId,
			name: r.municipalityName,
			provinceAcronym: r.provinceAcronym,
		},
		addressLine1: r.addressLine1,
		distance: r.distance,
		image: r.imageUrl ? { url: r.imageUrl } : null,
		// statusMap always has the key (resolveOpenStatuses returns one per row);
		// the fallback keeps the type non-optional.
		openStatus: statusMap.get(r.id) ?? { isOpen: false, status: "closed" },
	}));

	return { data, pagination: { page, limit, total } };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/api && bun test tests/integration/customer-store-discovery.test.ts --timeout 180000`
Expected: PASS (all describe blocks).

- [ ] **Step 7: Typecheck + commit**

```bash
cd apps/api && bun run typecheck
git add apps/api/src/lib/store-visibility.ts apps/api/src/modules/customer/services/store-discovery.ts apps/api/tests/helpers/fixtures.ts apps/api/tests/integration/customer-store-discovery.test.ts
git commit -m "feat(api): customer store discovery service + visibility predicate"
```

---

### Task 3: Public `GET /customer/stores` route + schemas

Wrap the service in a thin public Elysia route and declare the query/response TypeBox schemas.

**Files:**
- Modify: `apps/api/src/lib/queries.ts` (add `StoreSearchQuery`)
- Modify: `apps/api/src/lib/schemas/entities.ts` (add `StoreCardSchema`)
- Create: `apps/api/src/modules/customer/routes/stores.ts`
- Modify: `apps/api/src/modules/customer/index.ts` (mount public, before the auth guard)

**Interfaces:**
- Consumes: `searchStores` (Task 2), `okPage`, `okPageRes`, `withErrors`, `MunicipalityCompactSchema`, `OpenStatusSchema`.
- Produces: route `GET /customer/stores` returning `okPageRes(StoreCardSchema)`.

- [ ] **Step 1: Add `StoreSearchQuery`**

In `apps/api/src/lib/queries.ts`, append after `ProductSearchQuery`:
```ts
/**
 * Pagination + optional text (name/comune) + category + geo for store discovery.
 * `radius` has NO default — geo without radius returns all stores nearest-first.
 */
export const StoreSearchQuery = t.Object({
	page: t.Optional(
		t.Number({ minimum: 1, default: 1, description: "Numero di pagina" }),
	),
	limit: t.Optional(
		t.Number({
			minimum: 1,
			maximum: maxLimit,
			default: defaultLimit,
			description: "Elementi per pagina",
		}),
	),
	q: t.Optional(
		t.String({ description: "Testo di ricerca su nome negozio o comune" }),
	),
	categoryId: t.Optional(
		t.String({ description: "Filtra per ID categoria negozio" }),
	),
	lat: t.Optional(
		t.Number({ minimum: -90, maximum: 90, description: "Latitudine utente" }),
	),
	lng: t.Optional(
		t.Number({ minimum: -180, maximum: 180, description: "Longitudine utente" }),
	),
	radius: t.Optional(
		t.Number({ description: "Raggio in km (opzionale, nessun limite di default)" }),
	),
});
```

- [ ] **Step 2: Add `StoreCardSchema`**

In `apps/api/src/lib/schemas/entities.ts`, add this import at the top (after the `import { t } from "elysia";` line):
```ts
import { OpenStatusSchema } from "./holidays";
```
Then append at the end of the file:
```ts
// Store discovery card (customer public search)
export const StoreCardSchema = t.Object({
	id: t.String(),
	name: t.String({ description: "Nome del negozio" }),
	category: t.Nullable(
		t.Object({ id: t.String(), name: t.String() }),
	),
	municipality: MunicipalityCompactSchema,
	addressLine1: t.String({ description: "Indirizzo (riga 1)" }),
	distance: t.Nullable(
		t.Number({
			minimum: 0,
			description:
				"Distanza in metri dalla posizione utente (null senza geo o senza posizione del negozio)",
		}),
	),
	image: t.Nullable(
		t.Object({ url: t.String({ description: "URL immagine principale" }) }),
	),
	openStatus: OpenStatusSchema,
});
```

- [ ] **Step 3: Create the route**

Create `apps/api/src/modules/customer/routes/stores.ts`:
```ts
import { Elysia } from "elysia";
import { getLogger } from "@/lib/logger";
import { StoreSearchQuery } from "@/lib/queries";
import { okPage } from "@/lib/responses";
import { okPageRes, StoreCardSchema, withErrors } from "@/lib/schemas";
import { searchStores } from "../services/store-discovery";

export const storesRoutes = new Elysia().get(
	"/stores",
	async ({ query, store }) => {
		const pino = getLogger(store);
		const result = await searchStores(query);

		pino.info(
			{
				searchQuery: query.q,
				categoryId: query.categoryId,
				hasGeoFilter: !!(query.lat && query.lng),
				resultCount: result.data.length,
				action: "store_search",
			},
			"Ricerca negozi eseguita",
		);

		return okPage(result.data, result.pagination);
	},
	{
		query: StoreSearchQuery,
		response: withErrors({ 200: okPageRes(StoreCardSchema) }),
		detail: {
			summary: "Ricerca negozi",
			description:
				"Ricerca pubblica di negozi per vicinanza (PostGIS) con ricerca testuale opzionale su nome e comune. Senza testo restituisce tutti i negozi visibili. Non richiede autenticazione.",
			tags: ["Customer - Search"],
		},
	},
);
```

- [ ] **Step 4: Mount the route (public)**

In `apps/api/src/modules/customer/index.ts`:
- add import: `import { storesRoutes } from "./routes/stores";`
- mount it right after `.use(searchRoutes)` (still before the `.guard(...)`):
```ts
		// Product search is public (no auth required)
		.use(searchRoutes)
		// Store discovery is public (no auth required)
		.use(storesRoutes)
```

- [ ] **Step 5: Typecheck the API**

Run: `cd apps/api && bun run typecheck`
Expected: clean. (Confirms the `searchStores` return type satisfies `StoreCardSchema`.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/queries.ts apps/api/src/lib/schemas/entities.ts apps/api/src/modules/customer/routes/stores.ts apps/api/src/modules/customer/index.ts
git commit -m "feat(api): expose public GET /customer/stores route"
```

---

### Task 4: Extract a shared `useGeolocation` hook (customer)

Pull the inline geolocation state/permission flow out of `NearbyProducts` into a reusable hook so the new store page reuses the exact same UX.

**Files:**
- Create: `apps/customer/src/features/discovery/use-geolocation.ts`
- Modify: `apps/customer/src/features/discovery/use-nearby-products.ts:4-7` (import `Coords` from the hook)
- Modify: `apps/customer/src/features/discovery/nearby-products.tsx` (use the hook)

**Interfaces:**
- Produces: `useGeolocation(): { coords: Coords | null; status: GeoStatus; request: () => void }`, plus exported types `Coords = { lat: number; lng: number }` and `GeoStatus = "idle" | "pending" | "granted" | "denied" | "unsupported"`.

- [ ] **Step 1: Create the hook**

Create `apps/customer/src/features/discovery/use-geolocation.ts`:
```ts
import { useCallback, useState } from "react";

export interface Coords {
	lat: number;
	lng: number;
}

export type GeoStatus =
	| "idle"
	| "pending"
	| "granted"
	| "denied"
	| "unsupported";

/**
 * Browser geolocation as a reusable permission flow. Mirrors the original
 * inline behavior of the discovery feed: one-shot low-accuracy request with an
 * 8s timeout and a 5-minute cache, surfacing the permission state to the UI.
 */
export function useGeolocation() {
	const [coords, setCoords] = useState<Coords | null>(null);
	const [status, setStatus] = useState<GeoStatus>("idle");

	const request = useCallback(() => {
		if (typeof navigator === "undefined" || !navigator.geolocation) {
			setStatus("unsupported");
			return;
		}
		setStatus("pending");
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
				setStatus("granted");
			},
			() => setStatus("denied"),
			{ enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
		);
	}, []);

	return { coords, status, request };
}
```

- [ ] **Step 2: Re-point `Coords` in `use-nearby-products.ts`**

In `apps/customer/src/features/discovery/use-nearby-products.ts`, delete the local `export interface Coords { ... }` block and instead re-export it from the hook. Replace lines 4-7 (`export interface Coords {...}`) with:
```ts
export type { Coords } from "./use-geolocation";
import type { Coords } from "./use-geolocation";
```
(Keep the rest of the file unchanged — `useNearbyProducts(coords: Coords | null, ...)` still works.)

- [ ] **Step 3: Use the hook in `nearby-products.tsx`**

In `apps/customer/src/features/discovery/nearby-products.tsx`:
- Remove the local `type GeoStatus = ...` (line 8) and the `useState`-based `coords`/`geoStatus` + `requestLocation` (lines 56-79).
- Replace the import on line 6 and the component head. The component body top becomes:
```ts
import { useGeolocation } from "./use-geolocation";
import { useNearbyProducts } from "./use-nearby-products";
```
```ts
export function NearbyProducts() {
	const { coords, status: geoStatus, request: requestLocation } =
		useGeolocation();
	const {
		data: products,
		isPending,
		isError,
		refetch,
	} = useNearbyProducts(coords);
```
- Remove the now-unused `useState` import. Leave the rest of the JSX (which already reads `geoStatus` / `requestLocation`) unchanged.

- [ ] **Step 4: Typecheck**

Run: `cd apps/customer && bun run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/features/discovery/use-geolocation.ts apps/customer/src/features/discovery/use-nearby-products.ts apps/customer/src/features/discovery/nearby-products.tsx
git commit -m "refactor(customer): extract useGeolocation hook from discovery feed"
```

---

### Task 5: Customer `toYMD` + `useStoreSearch` data hook

Add the date coercion helper and the React Query infinite hook that calls the new endpoint and maps results to a UI-stable shape.

**Files:**
- Create: `apps/customer/src/lib/date.ts`
- Create: `apps/customer/src/features/stores/use-store-search.ts`

**Interfaces:**
- Consumes: `api().customer.stores.get`, `useGeolocation`'s `Coords`, `toYMD`.
- Produces:
  - `toYMD(value: string | Date): string`
  - `StoreCardView = { id; name; category: { id; name } | null; city: string; province: string; addressLine1: string; distance: number | null; imageUrl: string | null; openStatus: { isOpen: boolean; status: "open" | "closed" | "closed_holiday"; closesAt?: string; opensAt?: { date: string; time: string } } }`
  - `useStoreSearch(args: { q?: string; categoryId?: string; coords: Coords | null; limit?: number }): UseInfiniteQueryResult` exposing flattened `stores: StoreCardView[]`, `total`, `hasNextPage`, `fetchNextPage`, `isPending`, `isError`, `refetch`.

- [ ] **Step 1: Create `toYMD`**

Create `apps/customer/src/lib/date.ts` (copied verbatim from the seller app for consistency):
```ts
/**
 * Coerce an API date field to a "YYYY-MM-DD" string.
 *
 * Eden Treaty rehydrates ISO-date-looking response strings into `Date` objects
 * (date-only values like "2026-01-01" become UTC-midnight `Date`s), even when
 * the TypeBox schema declares `t.String()`. Run every API calendar-date through
 * this at the use site. UTC parts recover the original calendar day regardless
 * of the viewer's timezone.
 */
export function toYMD(value: string | Date): string {
	if (value instanceof Date) {
		const y = value.getUTCFullYear();
		const m = String(value.getUTCMonth() + 1).padStart(2, "0");
		const d = String(value.getUTCDate()).padStart(2, "0");
		return `${y}-${m}-${d}`;
	}
	return value.slice(0, 10);
}
```

- [ ] **Step 2: Create the data hook**

Create `apps/customer/src/features/stores/use-store-search.ts`:
```ts
import { useInfiniteQuery } from "@tanstack/react-query";
import type { Coords } from "@/features/discovery/use-geolocation";
import { api } from "@/lib/api";
import { toYMD } from "@/lib/date";

export interface StoreCardView {
	id: string;
	name: string;
	category: { id: string; name: string } | null;
	city: string;
	province: string;
	addressLine1: string;
	/** meters, or null when no geo / store has no location */
	distance: number | null;
	imageUrl: string | null;
	openStatus: {
		isOpen: boolean;
		status: "open" | "closed" | "closed_holiday";
		closesAt?: string;
		opensAt?: { date: string; time: string };
	};
}

interface UseStoreSearchArgs {
	q?: string;
	categoryId?: string;
	coords: Coords | null;
	limit?: number;
}

export function useStoreSearch({
	q,
	categoryId,
	coords,
	limit = 20,
}: UseStoreSearchArgs) {
	const query = useInfiniteQuery({
		queryKey: [
			"store-search",
			q ?? "",
			categoryId ?? "",
			coords?.lat ?? null,
			coords?.lng ?? null,
			limit,
		],
		staleTime: 60_000,
		initialPageParam: 1,
		queryFn: async ({ pageParam }) => {
			const { data, error } = await api().customer.stores.get({
				query: {
					page: pageParam,
					limit,
					...(q ? { q } : {}),
					...(categoryId ? { categoryId } : {}),
					...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
				},
			});
			if (error) {
				throw new Error(`Ricerca negozi non riuscita (${error.status})`);
			}
			return data;
		},
		getNextPageParam: (lastPage) => {
			const { page, limit: lim, total } = lastPage.pagination;
			return page * lim < total ? page + 1 : undefined;
		},
	});

	const stores: StoreCardView[] =
		query.data?.pages.flatMap((p) =>
			p.data.map((s) => ({
				id: s.id,
				name: s.name,
				category: s.category,
				city: s.municipality.name,
				province: s.municipality.provinceAcronym,
				addressLine1: s.addressLine1,
				distance: s.distance,
				imageUrl: s.image?.url ?? null,
				openStatus: {
					isOpen: s.openStatus.isOpen,
					status: s.openStatus.status,
					closesAt: s.openStatus.closesAt ?? undefined,
					opensAt: s.openStatus.opensAt
						? {
								date: toYMD(s.openStatus.opensAt.date),
								time: s.openStatus.opensAt.time,
							}
						: undefined,
				},
			})),
		) ?? [];

	return {
		stores,
		total: query.data?.pages[0]?.pagination.total ?? 0,
		hasNextPage: query.hasNextPage,
		fetchNextPage: query.fetchNextPage,
		isFetchingNextPage: query.isFetchingNextPage,
		isPending: query.isPending,
		isError: query.isError,
		refetch: query.refetch,
	};
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/customer && bun run typecheck`
Expected: clean (this also verifies the Eden client now sees `customer.stores`).

- [ ] **Step 4: Commit**

```bash
git add apps/customer/src/lib/date.ts apps/customer/src/features/stores/use-store-search.ts
git commit -m "feat(customer): store-search data hook + toYMD"
```

---

### Task 6: `StoreTile` component

Presentational tile mirroring `ProductTile`: image+fallback, name, category, city, distance pill (geo), open-status badge + today's hours line.

**Files:**
- Create: `apps/customer/src/features/stores/store-tile.tsx`

**Interfaces:**
- Consumes: `StoreCardView` (Task 5).
- Produces: `StoreTile({ store: StoreCardView; showDistance: boolean })`.

- [ ] **Step 1: Create the component**

Create `apps/customer/src/features/stores/store-tile.tsx`:
```tsx
import { Clock, MapPin } from "lucide-react";
import { useState } from "react";
import type { StoreCardView } from "./use-store-search";

/** Metri → "240 m" / "1,2 km" (convenzione italiana, virgola decimale). */
function formatDistance(meters: number): string {
	if (meters < 1000) return `${Math.round(meters)} m`;
	return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}

function TileImage({ url, name }: { url: string | null; name: string }) {
	const [failed, setFailed] = useState(false);
	if (!url || failed) {
		const initial = name.trim().charAt(0).toUpperCase() || "?";
		return (
			<div className="flex size-full items-center justify-center bg-muted">
				<span
					aria-hidden
					className="font-display font-semibold text-4xl text-muted-foreground/70"
				>
					{initial}
				</span>
			</div>
		);
	}
	return (
		<img
			src={url}
			alt={name}
			loading="lazy"
			decoding="async"
			onError={() => setFailed(true)}
			className="size-full object-cover"
		/>
	);
}

/** Riga di stato apertura: "Aperto · chiude alle 19:30" / "Chiuso · apre ...". */
function OpenStatusLine({ status }: { status: StoreCardView["openStatus"] }) {
	let label: string;
	if (status.isOpen) {
		label = status.closesAt ? `Aperto · chiude ${status.closesAt}` : "Aperto";
	} else if (status.opensAt) {
		label = `Chiuso · apre ${status.opensAt.date} ${status.opensAt.time}`;
	} else {
		label = "Chiuso";
	}
	return (
		<span
			className={`inline-flex items-center gap-1 text-xs ${
				status.isOpen ? "text-primary" : "text-muted-foreground"
			}`}
		>
			<Clock className="size-3" aria-hidden />
			{label}
		</span>
	);
}

interface StoreTileProps {
	store: StoreCardView;
	/** Show the distance pill (only when we have a position). */
	showDistance: boolean;
}

/**
 * Store tile for the discovery grid. Theme-aware surfaces; the distance pill is
 * an accent ON the photo, so it keeps the fixed cream/ink tokens like the
 * product tile.
 */
export function StoreTile({ store, showDistance }: StoreTileProps) {
	const hasDistance = showDistance && store.distance !== null;
	return (
		<article className="flex flex-col gap-3">
			<div className="relative aspect-square overflow-hidden rounded-lg border border-border">
				<TileImage url={store.imageUrl} name={store.name} />
				{hasDistance && (
					<span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-cream px-2 py-1 font-medium font-mono text-ink text-xs tabular-nums shadow-sm">
						<MapPin className="size-3 text-saffron-deep" aria-hidden />
						{formatDistance(store.distance as number)}
					</span>
				)}
			</div>
			<div className="flex flex-col gap-1">
				<h3 className="line-clamp-2 font-medium text-[0.9375rem] text-foreground leading-snug">
					{store.name}
				</h3>
				<p className="text-muted-foreground text-sm">
					{store.category ? `${store.category.name} · ` : ""}
					{store.city} ({store.province})
				</p>
				<OpenStatusLine status={store.openStatus} />
			</div>
		</article>
	);
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `cd apps/customer && bun run typecheck && bunx biome lint src/features/stores`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/customer/src/features/stores/store-tile.tsx
git commit -m "feat(customer): store discovery tile"
```

---

### Task 7: `/stores` route page

The search page: text input (debounced → search param), category filter, geolocation button, results grid, loading/empty/error states, "Carica altri".

**Files:**
- Create: `apps/customer/src/routes/_authenticated/stores/index.tsx`
- Modify: `apps/customer/src/routeTree.gen.ts` (regenerated, committed)

**Interfaces:**
- Consumes: `useStoreSearch`, `StoreTile`, `useGeolocation`, `api().store-categories.get`.

- [ ] **Step 1: Create the route**

Create `apps/customer/src/routes/_authenticated/stores/index.tsx`:
```tsx
import { Button } from "@bibs/ui/components/button";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Compass, LocateFixed, MapPin, RotateCw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useGeolocation } from "@/features/discovery/use-geolocation";
import { StoreTile } from "@/features/stores/store-tile";
import { useStoreSearch } from "@/features/stores/use-store-search";
import { api } from "@/lib/api";

const SEARCH_SCHEMA = (search: Record<string, unknown>) => ({
	q: typeof search.q === "string" ? search.q : undefined,
	categoryId:
		typeof search.categoryId === "string" ? search.categoryId : undefined,
});

export const Route = createFileRoute("/_authenticated/stores/")({
	validateSearch: SEARCH_SCHEMA,
	component: StoresPage,
});

const GRID = "grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4";

function TileSkeleton() {
	return (
		<div className="flex flex-col gap-3">
			<Skeleton className="aspect-square rounded-lg" />
			<div className="flex flex-col gap-1.5">
				<Skeleton className="h-4 w-4/5" />
				<Skeleton className="h-4 w-1/3" />
			</div>
		</div>
	);
}

function Notice({
	icon: Icon,
	title,
	description,
	action,
}: {
	icon: typeof Compass;
	title: string;
	description: string;
	action?: React.ReactNode;
}) {
	return (
		<div className="flex flex-col items-center gap-4 rounded-xl border border-border border-dashed px-6 py-14 text-center">
			<div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
				<Icon className="size-6" aria-hidden />
			</div>
			<div className="space-y-1">
				<h3 className="font-display font-semibold text-foreground text-lg">
					{title}
				</h3>
				<p className="mx-auto max-w-sm text-muted-foreground text-sm leading-relaxed">
					{description}
				</p>
			</div>
			{action}
		</div>
	);
}

function useStoreCategories() {
	return useQuery({
		queryKey: ["store-categories"],
		staleTime: 5 * 60_000,
		queryFn: async () => {
			const { data, error } = await api()["store-categories"].get({
				query: { limit: 100 },
			});
			if (error) throw new Error("Categorie non disponibili");
			return data.data;
		},
	});
}

function StoresPage() {
	const navigate = Route.useNavigate();
	const { q, categoryId } = Route.useSearch();
	const [text, setText] = useState(q ?? "");
	const { coords, status: geoStatus, request: requestLocation } =
		useGeolocation();
	const { data: categories } = useStoreCategories();

	// Debounce the text input into the URL search param.
	useEffect(() => {
		const id = setTimeout(() => {
			void navigate({
				search: (prev) => ({ ...prev, q: text || undefined }),
				replace: true,
			});
		}, 300);
		return () => clearTimeout(id);
	}, [text, navigate]);

	const {
		stores,
		hasNextPage,
		fetchNextPage,
		isFetchingNextPage,
		isPending,
		isError,
		refetch,
	} = useStoreSearch({ q, categoryId, coords });

	const hasQuery = Boolean(q) || Boolean(categoryId);

	return (
		<div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
			<section className="space-y-1">
				<h1 className="font-bold font-display text-2xl text-primary tracking-[-0.015em]">
					Negozi
				</h1>
				<p className="text-muted-foreground text-sm">
					Trova i negozi vicino a te. Cerca per nome o città.
				</p>
			</section>

			<div className="mt-6 flex flex-wrap items-center gap-3">
				<div className="relative min-w-0 flex-1">
					<Search
						className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground"
						aria-hidden
					/>
					<input
						type="search"
						value={text}
						onChange={(e) => setText(e.target.value)}
						placeholder="Cerca un negozio o un comune…"
						aria-label="Cerca negozi"
						className="h-10 w-full rounded-md border border-border bg-background pr-3 pl-9 text-foreground text-sm outline-none focus-visible:ring-2 focus-visible:ring-saffron"
					/>
				</div>
				{geoStatus === "granted" ? (
					<span className="inline-flex items-center gap-1.5 text-saffron-deep text-sm dark:text-saffron">
						<LocateFixed className="size-4" aria-hidden />
						Ordinati per vicinanza
					</span>
				) : (
					<Button
						variant="secondary"
						size="sm"
						onClick={requestLocation}
						disabled={geoStatus === "pending"}
					>
						<MapPin className="size-4" aria-hidden />
						{geoStatus === "pending" ? "Rilevamento…" : "Vicino a me"}
					</Button>
				)}
			</div>

			{categories && categories.length > 0 && (
				<div className="mt-3 flex flex-wrap gap-2">
					<CategoryChip
						active={!categoryId}
						label="Tutte"
						onClick={() =>
							navigate({
								search: (prev) => ({ ...prev, categoryId: undefined }),
								replace: true,
							})
						}
					/>
					{categories.map((c) => (
						<CategoryChip
							key={c.id}
							active={categoryId === c.id}
							label={c.name}
							onClick={() =>
								navigate({
									search: (prev) => ({ ...prev, categoryId: c.id }),
									replace: true,
								})
							}
						/>
					))}
				</div>
			)}

			<div className="mt-6">
				{isPending ? (
					<div className={GRID} aria-hidden>
						{Array.from({ length: 8 }, (_, i) => (
							<TileSkeleton key={`tile-skeleton-${i}`} />
						))}
					</div>
				) : isError ? (
					<Notice
						icon={RotateCw}
						title="Non siamo riusciti a caricare i negozi"
						description="Qualcosa è andato storto. Riprova tra un momento."
						action={
							<Button variant="secondary" size="sm" onClick={() => refetch()}>
								<RotateCw className="size-4" aria-hidden />
								Riprova
							</Button>
						}
					/>
				) : stores.length === 0 ? (
					<Notice
						icon={Compass}
						title={hasQuery ? "Nessun risultato" : "Esplora i negozi"}
						description={
							hasQuery
								? "Nessun negozio corrisponde alla tua ricerca. Prova con un altro nome o comune."
								: "Non ci sono ancora negozi da mostrare. Torna a trovarci presto."
						}
					/>
				) : (
					<>
						<ul className={GRID}>
							{stores.map((store) => (
								<li key={store.id}>
									<StoreTile
										store={store}
										showDistance={geoStatus === "granted"}
									/>
								</li>
							))}
						</ul>
						{hasNextPage && (
							<div className="mt-8 flex justify-center">
								<Button
									variant="secondary"
									onClick={() => fetchNextPage()}
									disabled={isFetchingNextPage}
								>
									{isFetchingNextPage ? "Caricamento…" : "Carica altri"}
								</Button>
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}

function CategoryChip({
	active,
	label,
	onClick,
}: {
	active: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`rounded-full border px-3 py-1 text-sm transition-colors ${
				active
					? "border-primary bg-primary text-primary-foreground"
					: "border-border bg-background text-muted-foreground hover:text-foreground"
			}`}
		>
			{label}
		</button>
	);
}
```

- [ ] **Step 2: Regenerate the route tree**

The `@tanstack/router-plugin` writes `routeTree.gen.ts` during dev/build. Trigger it:

Run: `cd apps/customer && bun run build`
Expected: build succeeds and `src/routeTree.gen.ts` now references `/_authenticated/stores/`. (If build is too slow locally, instead run `bun run dev` for ~3s and stop it — the plugin regenerates the tree on startup.)

- [ ] **Step 3: Typecheck**

Run: `cd apps/customer && bun run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/customer/src/routes/_authenticated/stores/index.tsx apps/customer/src/routeTree.gen.ts
git commit -m "feat(customer): store discovery search page at /stores"
```

---

### Task 8: Entry point — "Negozi" nav link + home CTA

Make `/stores` reachable from the top app bar and the home page.

**Files:**
- Modify: `apps/customer/src/components/site-header.tsx`
- Modify: `apps/customer/src/routes/_authenticated/index.tsx`

- [ ] **Step 1: Add a nav link to the header**

In `apps/customer/src/components/site-header.tsx`, add a nav between the brand link and `<UserMenu />`. After the brand `</Link>` and before `<UserMenu />`, insert:
```tsx
					<nav className="ml-auto mr-2 flex items-center gap-1">
						<Link
							to="/stores"
							className="rounded-md px-3 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground data-[status=active]:text-foreground"
						>
							Negozi
						</Link>
					</nav>
```
(`Link` is already imported. The flex container already uses `justify-between`; `ml-auto` keeps the nav grouped to the right next to the menu.)

- [ ] **Step 2: Add a CTA on the home page**

In `apps/customer/src/routes/_authenticated/index.tsx`, add a link under the intro paragraph. Import `Link`:
```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
```
Then after the intro `</p>` inside the first `<section>`, add:
```tsx
					<Link
						to="/stores"
						className="mt-4 inline-flex items-center gap-1.5 font-medium text-primary text-sm hover:underline"
					>
						Esplora tutti i negozi →
					</Link>
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/customer && bun run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/customer/src/components/site-header.tsx apps/customer/src/routes/_authenticated/index.tsx
git commit -m "feat(customer): link to /stores from header and home"
```

---

## Final verification

- [ ] **API:** `cd apps/api && bun run typecheck && bun test tests/integration/customer-store-discovery.test.ts tests/integration/seller-store-open-status.test.ts --timeout 180000` → all green.
- [ ] **Customer:** `cd apps/customer && bun run typecheck && bun run build` → clean.
- [ ] **Lint:** `bunx biome check apps/api/src apps/customer/src` → clean.
- [ ] **Manual browser smoke (Marco):** run `bun run dev`; visit `http://localhost:3001/stores`; verify: alphabetical listing without geo, "Vicino a me" reorders by distance + shows distance pills, text search filters by name/comune, category chips filter, open/closed badge + today's hours render, "Carica altri" paginates, dark mode (`localStorage.theme='dark'`) keeps text legible.
- [ ] Open PR via `commit-push-pr` (or `/commit-commands:commit-push-pr`) with squash auto-merge; ensure the squash subject keeps the `(#NN)` convention.

## Spec coverage self-check

- Visibility (live subscription only) → Task 2 (`publiclyVisibleStore` + test).
- Text search name+comune (ILIKE) + relevance → Task 2.
- Category filter → Task 2 + Task 7 chips.
- Geo nearest-first, NULLS LAST, optional radius, no default cap → Task 2.
- Alphabetical fallback + deterministic pagination → Task 2.
- Open-status (badge + today's hours) → Task 1 helper + Task 2 + Task 6 tile.
- Response shape `StoreCardSchema` → Task 3.
- Public endpoint (no auth, mounted before guard) → Task 3.
- `/stores` page: input, category, geo, states, "Carica altri" → Task 7; theme-aware + `toYMD` → Tasks 5-7.
- Entry point → Task 8.
- Out of scope (store detail `/:id`, adopting predicate in product search, clickable tiles → detail) → deferred to sub-project #2.
