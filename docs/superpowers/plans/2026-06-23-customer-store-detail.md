# Store Detail Page (#2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the customer-facing store detail page (vetrina/identità) reachable from the discovery grid — cover hero, opening hours, interactive map, contacts — backed by a new public `GET /customer/stores/:id` endpoint.

**Architecture:** A new public API endpoint returns a `StoreDetail` DTO (reusing the `publiclyVisibleStore()` visibility predicate → 404 for hidden stores). The customer app adds a `/_authenticated/stores/$storeId` route composing presentational sections; the Leaflet map is loaded client-only via `lazy()` + a mount gate so it never touches `window` during SSR. The open-status formatting is extracted from the existing tile into a shared module.

**Tech Stack:** ElysiaJS + Drizzle (PostGIS) on the API; TanStack Start/Router/Query + React 19 + Tailwind on the customer app; Leaflet + react-leaflet for the map; Bun test runner (API integration harness + a new pure FE unit test).

## Global Constraints

- **Visibility:** the detail endpoint uses `publiclyVisibleStore()` — a store that is soft-deleted, suspended, canceled, or has no live subscription must return **404**, identical to the discovery list. No deep-link to hidden stores.
- **No `closures` in the DTO:** the computed `openStatus` already incorporates closures/holidays; do not expose `closures` to the client.
- **Eden date hydration:** Eden Treaty rehydrates date-only strings to `Date`. Coerce `openStatus.opensAt.date` through `toYMD()` (`apps/customer/src/lib/date.ts`) at the use site, exactly as `use-store-search.ts:86` does.
- **`dayOfWeek` convention:** `0=Lunedì … 6=Domenica` (repo-wide — `apps/api/src/lib/holidays/types.ts:20`).
- **Italian copy**, theme-aware tokens for surfaces, fixed tokens (`cream`/`ink`) only for text-on-photo. Toast/imports follow repo conventions.
- **Dependencies use the Bun catalog:** every customer dep is `catalog:`; new deps go into the root `package.json` `catalog` block first.
- **Route placement:** under `_authenticated` (page requires login); the API endpoint itself is public.

---

## File Structure

**API (`apps/api`)**
- `src/lib/schemas/entities.ts` — add `StoreDetailSchema` (+ local `StoreOpeningHoursSchema`).
- `src/modules/customer/services/store-detail.ts` — **new** `getStoreDetail(id)` service + `StoreDetail` type.
- `src/modules/customer/routes/stores.ts` — add `GET /stores/:id` handler.
- `tests/helpers/fixtures.ts` — add `createTestStorePhoneNumber`.
- `tests/integration/customer-store-detail.test.ts` — **new** service tests.

**Customer (`apps/customer`)**
- `src/features/stores/open-status.ts` — **new** shared open-status label helpers (extracted from the tile).
- `src/features/stores/format-opening-hours.ts` — **new** pure weekly-hours formatter.
- `src/features/stores/format-opening-hours.test.ts` — **new** bun unit test.
- `src/features/stores/store-cover.tsx` — **new** cover hero.
- `src/features/stores/opening-hours.tsx` — **new** weekly-hours section.
- `src/features/stores/store-map.tsx` — **new** client-only Leaflet map (default export).
- `src/features/stores/use-store-detail.ts` — **new** data hook.
- `src/features/stores/store-tile.tsx` — refactor to use shared open-status; wrap in `<Link>`.
- `src/routes/_authenticated/stores/$storeId.tsx` — **new** route assembling everything.
- `package.json` (+ root `package.json`) — add Leaflet deps; add a `test` script.

---

## Task 1: API — `StoreDetail` schema, service, fixture, and tests

**Files:**
- Modify: `apps/api/src/lib/schemas/entities.ts` (after `StoreCardSchema`, ~line 688)
- Create: `apps/api/src/modules/customer/services/store-detail.ts`
- Modify: `apps/api/tests/helpers/fixtures.ts` (add import + helper)
- Test: `apps/api/tests/integration/customer-store-detail.test.ts`

**Interfaces:**
- Consumes: `publiclyVisibleStore()` (`@/lib/store-visibility`), `resolveOpenStatuses()` (`@/lib/store-open-status`), `ServiceError` (`@/lib/errors`), `MunicipalityCompactSchema` + `OpenStatusSchema` (already in `entities.ts` scope).
- Produces: `getStoreDetail(id: string): Promise<StoreDetail>` and `StoreDetailSchema`. The `StoreDetail` shape (consumed by Task 2's route and, via Eden, by Task 6's hook):
  ```
  { id, name, description: string|null, category: {id,name}|null,
    municipality: {id,name,provinceAcronym}, addressLine1, addressLine2: string|null,
    zipCode, coordinates: {lat,lng}|null, images: {id,url}[],
    phoneNumbers: {id,label:string|null,number}[], websiteUrl: string|null,
    openingHours: {dayOfWeek,slots:{open,close}[]}[]|null, openStatus: OpenStatus }
  ```

- [ ] **Step 1: Add the phone-number test fixture**

In `apps/api/tests/helpers/fixtures.ts`, ensure `storePhoneNumber` is imported from the store schema (the file already imports `store`; extend that import) and add the helper:

```typescript
// add `storePhoneNumber` to the existing `@/db/schemas/store` import, e.g.:
// import { store, storePhoneNumber } from "@/db/schemas/store";

export async function createTestStorePhoneNumber(
	db: DrizzleTestDb,
	storeId: string,
	params: { label?: string | null; number?: string; position?: number } = {},
) {
	const [phone] = await db
		.insert(storePhoneNumber)
		.values({
			storeId,
			label: params.label ?? null,
			number: params.number ?? "0123456789",
			position: params.position ?? 0,
		})
		.returning();
	return phone;
}
```

- [ ] **Step 2: Add `StoreDetailSchema` to `entities.ts`**

Immediately after `StoreCardSchema` (which ends ~line 688). `MunicipalityCompactSchema` and `OpenStatusSchema` are already imported/defined in this file (used by `StoreCardSchema`).

```typescript
// Weekly opening hours (response shape), dayOfWeek 0=Lun..6=Dom
const StoreOpeningHoursSchema = t.Array(
	t.Object({
		dayOfWeek: t.Integer({ minimum: 0, maximum: 6, description: "0=Lun..6=Dom" }),
		slots: t.Array(
			t.Object({
				open: t.String({ description: "Apertura HH:mm" }),
				close: t.String({ description: "Chiusura HH:mm" }),
			}),
		),
	}),
);

// Store detail (customer public store page — #2a)
export const StoreDetailSchema = t.Object({
	id: t.String(),
	name: t.String({ description: "Nome del negozio" }),
	description: t.Nullable(t.String({ description: "Descrizione del negozio" })),
	category: t.Nullable(t.Object({ id: t.String(), name: t.String() })),
	municipality: MunicipalityCompactSchema,
	addressLine1: t.String({ description: "Indirizzo (riga 1)" }),
	addressLine2: t.Nullable(t.String({ description: "Indirizzo (riga 2)" })),
	zipCode: t.String({ description: "CAP" }),
	coordinates: t.Nullable(
		t.Object({
			lat: t.Number({ description: "Latitudine" }),
			lng: t.Number({ description: "Longitudine" }),
		}),
	),
	images: t.Array(
		t.Object({ id: t.String(), url: t.String({ description: "URL immagine" }) }),
		{ description: "Immagini del negozio ordinate per posizione" },
	),
	phoneNumbers: t.Array(
		t.Object({
			id: t.String(),
			label: t.Nullable(t.String({ description: "Etichetta (es. Negozio)" })),
			number: t.String({ description: "Numero di telefono" }),
		}),
		{ description: "Telefoni ordinati per posizione" },
	),
	websiteUrl: t.Nullable(t.String({ description: "Sito web" })),
	openingHours: t.Nullable(StoreOpeningHoursSchema),
	openStatus: OpenStatusSchema,
});
```

- [ ] **Step 3: Write the failing service tests**

Create `apps/api/tests/integration/customer-store-detail.test.ts`:

```typescript
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

import { eq } from "drizzle-orm";
import { store } from "@/db/schemas/store";
import { getStoreDetail } from "@/modules/customer/services/store-detail";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestSeller,
	createTestStore,
	createTestStoreCategory,
	createTestStoreImage,
	createTestStorePhoneNumber,
	createTestStoreSubscription,
} from "../helpers/fixtures";

const ROME = { lat: 41.9028, lng: 12.4964 };

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

async function visibleStore(
	sellerProfileId: string,
	params: Parameters<typeof createTestStore>[2] = {},
) {
	const db = getTestDb();
	const s = await createTestStore(db, sellerProfileId, params);
	await createTestStoreSubscription(db, s.id, { status: "active" });
	return s;
}

describe("getStoreDetail — visible store", () => {
	it("returns the full detail DTO", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const cat = await createTestStoreCategory(db, "Libreria");
		const s = await visibleStore(profile.id, {
			name: "La Libreria",
			categoryId: cat.id,
			...ROME,
			openingHours: [
				{ dayOfWeek: 0, slots: [{ open: "09:00", close: "13:00" }] },
			],
		});
		await createTestStoreImage(db, s.id, { url: "https://img.test/b.jpg", position: 2 });
		await createTestStoreImage(db, s.id, { url: "https://img.test/a.jpg", position: 0 });
		await createTestStorePhoneNumber(db, s.id, { label: "Negozio", number: "065551234", position: 1 });
		await createTestStorePhoneNumber(db, s.id, { label: null, number: "060000000", position: 0 });

		const detail = await getStoreDetail(s.id);

		expect(detail.name).toBe("La Libreria");
		expect(detail.category).toEqual({ id: cat.id, name: "Libreria" });
		expect(detail.municipality.provinceAcronym).toHaveLength(2);
		expect(detail.addressLine1).toBe("Via Roma 1");
		// images ordered by position
		expect(detail.images.map((i) => i.url)).toEqual([
			"https://img.test/a.jpg",
			"https://img.test/b.jpg",
		]);
		// phones ordered by position
		expect(detail.phoneNumbers.map((p) => p.number)).toEqual(["060000000", "065551234"]);
		// coordinates: lat=y, lng=x
		expect(detail.coordinates).not.toBeNull();
		expect(detail.coordinates?.lat).toBeCloseTo(ROME.lat, 3);
		expect(detail.coordinates?.lng).toBeCloseTo(ROME.lng, 3);
		expect(detail.openStatus).toBeDefined();
		expect(detail.openingHours).toEqual([
			{ dayOfWeek: 0, slots: [{ open: "09:00", close: "13:00" }] },
		]);
	});

	it("returns null coordinates when the store has no location", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id, { name: "SenzaPosizione", noLocation: true });
		const detail = await getStoreDetail(s.id);
		expect(detail.coordinates).toBeNull();
	});
});

describe("getStoreDetail — visibility (404)", () => {
	it("404 for a non-existent id", async () => {
		await expect(getStoreDetail("does-not-exist")).rejects.toThrow("Negozio non trovato");
	});

	it("404 for a store with no subscription", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await createTestStore(db, profile.id, { name: "SenzaAbbonamento" });
		await expect(getStoreDetail(s.id)).rejects.toThrow("Negozio non trovato");
	});

	it("404 for suspended and canceled subscriptions", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const suspended = await createTestStore(db, profile.id, { name: "Sospeso" });
		await createTestStoreSubscription(db, suspended.id, { status: "suspended" });
		const canceled = await createTestStore(db, profile.id, { name: "Cancellato" });
		await createTestStoreSubscription(db, canceled.id, { status: "canceled" });
		await expect(getStoreDetail(suspended.id)).rejects.toThrow("Negozio non trovato");
		await expect(getStoreDetail(canceled.id)).rejects.toThrow("Negozio non trovato");
	});

	it("404 for a soft-deleted store", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id, { name: "Eliminato" });
		await db.update(store).set({ deletedAt: new Date() }).where(eq(store.id, s.id));
		await expect(getStoreDetail(s.id)).rejects.toThrow("Negozio non trovato");
	});
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd apps/api && bun test tests/integration/customer-store-detail.test.ts --timeout 180000`
Expected: FAIL — `Cannot find module ".../store-detail"` (service not created yet).

- [ ] **Step 5: Implement `getStoreDetail`**

Create `apps/api/src/modules/customer/services/store-detail.ts`:

```typescript
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { municipality, province } from "@/db/schemas/location";
import { store, storePhoneNumber } from "@/db/schemas/store";
import { storeCategory } from "@/db/schemas/store-category";
import { storeImage } from "@/db/schemas/store-image";
import { ServiceError } from "@/lib/errors";
import type { CustomClosure, OpeningHoursDay, OpenStatus } from "@/lib/holidays";
import { resolveOpenStatuses } from "@/lib/store-open-status";
import { publiclyVisibleStore } from "@/lib/store-visibility";

export interface StoreDetail {
	id: string;
	name: string;
	description: string | null;
	category: { id: string; name: string } | null;
	municipality: { id: string; name: string; provinceAcronym: string };
	addressLine1: string;
	addressLine2: string | null;
	zipCode: string;
	coordinates: { lat: number; lng: number } | null;
	images: { id: string; url: string }[];
	phoneNumbers: { id: string; label: string | null; number: string }[];
	websiteUrl: string | null;
	openingHours: OpeningHoursDay[] | null;
	openStatus: OpenStatus;
}

export async function getStoreDetail(id: string): Promise<StoreDetail> {
	const [row] = await db
		.select({
			id: store.id,
			name: store.name,
			description: store.description,
			addressLine1: store.addressLine1,
			addressLine2: store.addressLine2,
			zipCode: store.zipCode,
			websiteUrl: store.websiteUrl,
			location: store.location,
			openingHours: store.openingHours,
			closures: store.closures,
			categoryId: store.categoryId,
			categoryName: storeCategory.name,
			municipalityId: municipality.id,
			municipalityName: municipality.name,
			provinceAcronym: province.acronym,
		})
		.from(store)
		.innerJoin(municipality, eq(municipality.id, store.municipalityId))
		.innerJoin(province, eq(province.id, municipality.provinceId))
		.leftJoin(storeCategory, eq(storeCategory.id, store.categoryId))
		.where(and(eq(store.id, id), publiclyVisibleStore()))
		.limit(1);

	if (!row) throw new ServiceError(404, "Negozio non trovato");

	const [images, phoneNumbers] = await Promise.all([
		db
			.select({ id: storeImage.id, url: storeImage.url })
			.from(storeImage)
			.where(eq(storeImage.storeId, id))
			.orderBy(asc(storeImage.position)),
		db
			.select({
				id: storePhoneNumber.id,
				label: storePhoneNumber.label,
				number: storePhoneNumber.number,
			})
			.from(storePhoneNumber)
			.where(eq(storePhoneNumber.storeId, id))
			.orderBy(asc(storePhoneNumber.position)),
	]);

	const statusMap = await resolveOpenStatuses(
		[
			{
				id: row.id,
				openingHours: row.openingHours as OpeningHoursDay[] | null,
				closures: row.closures as CustomClosure[] | null,
			},
		],
		new Date(),
	);

	return {
		id: row.id,
		name: row.name,
		description: row.description,
		category:
			row.categoryId && row.categoryName
				? { id: row.categoryId, name: row.categoryName }
				: null,
		municipality: {
			id: row.municipalityId,
			name: row.municipalityName,
			provinceAcronym: row.provinceAcronym,
		},
		addressLine1: row.addressLine1,
		addressLine2: row.addressLine2,
		zipCode: row.zipCode,
		coordinates: row.location
			? { lat: row.location.y, lng: row.location.x }
			: null,
		images,
		phoneNumbers,
		websiteUrl: row.websiteUrl,
		openingHours: row.openingHours as OpeningHoursDay[] | null,
		openStatus: statusMap.get(row.id) ?? { isOpen: false, status: "closed" },
	};
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/api && bun test tests/integration/customer-store-detail.test.ts --timeout 180000`
Expected: PASS (all 6 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/schemas/entities.ts apps/api/src/modules/customer/services/store-detail.ts apps/api/tests/helpers/fixtures.ts apps/api/tests/integration/customer-store-detail.test.ts
git commit -m "feat(api): getStoreDetail service + StoreDetail schema (#2a)"
```

---

## Task 2: API — wire `GET /customer/stores/:id`

**Files:**
- Modify: `apps/api/src/modules/customer/routes/stores.ts`

**Interfaces:**
- Consumes: `getStoreDetail` + `StoreDetailSchema` (Task 1), `ok` (`@/lib/responses`), `okRes` + `withErrors` (`@/lib/schemas`).
- Produces: the public route `GET /customer/stores/:id` → Eden treaty path `api().customer.stores({ id }).get()` returning `{ success, data: StoreDetail }` (consumed by Task 6).

- [ ] **Step 1: Add the route handler**

Edit `apps/api/src/modules/customer/routes/stores.ts`. Update the imports and chain a second `.get` onto `storesRoutes`:

```typescript
import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { StoreSearchQuery } from "@/lib/queries";
import { ok, okPage } from "@/lib/responses";
import { okPageRes, okRes, StoreCardSchema, StoreDetailSchema, withErrors } from "@/lib/schemas";
import { getStoreDetail } from "../services/store-detail";
import { searchStores } from "../services/store-discovery";

export const storesRoutes = new Elysia()
	.get(
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
	)
	.get(
		"/stores/:id",
		async ({ params, store }) => {
			const pino = getLogger(store);
			const detail = await getStoreDetail(params.id);
			pino.info(
				{ storeId: params.id, action: "store_detail" },
				"Dettaglio negozio richiesto",
			);
			return ok(detail);
		},
		{
			params: t.Object({ id: t.String({ description: "ID del negozio" }) }),
			response: withErrors({ 200: okRes(StoreDetailSchema) }),
			detail: {
				summary: "Dettaglio negozio",
				description:
					"Scheda pubblica di un negozio visibile. Restituisce 404 se il negozio non esiste o non è pubblicamente visibile (sospeso/cancellato/senza abbonamento). Non richiede autenticazione.",
				tags: ["Customer - Search"],
			},
		},
	);
```

- [ ] **Step 2: Typecheck the API**

Run: `cd apps/api && bun run typecheck`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/customer/routes/stores.ts
git commit -m "feat(api): public GET /customer/stores/:id route (#2a)"
```

---

## Task 3: Customer — extract shared open-status helpers

**Files:**
- Create: `apps/customer/src/features/stores/open-status.ts`
- Modify: `apps/customer/src/features/stores/store-tile.tsx`

**Interfaces:**
- Produces: `OpenStatusView` type, `describeOpensAt(opensAt)`, `openStatusLabel(status)` — consumed by Task 6 (cover) and the refactored tile.

- [ ] **Step 1: Create the shared module**

`apps/customer/src/features/stores/open-status.ts` — move the logic verbatim from `store-tile.tsx:38-69`:

```typescript
export interface OpenStatusView {
	isOpen: boolean;
	status: "open" | "closed" | "closed_holiday";
	closesAt?: string;
	opensAt?: { date: string; time: string };
}

/** "apre alle 09:00" / "apre domani alle 09:00" / "apre mar 24 giu alle 09:00". */
export function describeOpensAt(opensAt: { date: string; time: string }): string {
	const todayRome = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Europe/Rome",
	}).format(new Date());
	const base = new Date(`${todayRome}T00:00:00`);
	const tomorrow = new Date(base);
	tomorrow.setDate(base.getDate() + 1);
	const fmt = (d: Date) =>
		`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
	if (opensAt.date === todayRome) return `apre alle ${opensAt.time}`;
	if (opensAt.date === fmt(tomorrow)) return `apre domani alle ${opensAt.time}`;
	const d = new Date(`${opensAt.date}T00:00:00`);
	const label = new Intl.DateTimeFormat("it-IT", {
		weekday: "short",
		day: "numeric",
		month: "short",
	}).format(d);
	return `apre ${label} alle ${opensAt.time}`;
}

/** "Aperto · chiude alle 19:30" / "Chiuso · apre …" / "Aperto" / "Chiuso". */
export function openStatusLabel(status: OpenStatusView): string {
	if (status.isOpen) {
		return status.closesAt ? `Aperto · chiude alle ${status.closesAt}` : "Aperto";
	}
	if (status.opensAt) return `Chiuso · ${describeOpensAt(status.opensAt)}`;
	return "Chiuso";
}
```

- [ ] **Step 2: Refactor the tile to use it**

In `apps/customer/src/features/stores/store-tile.tsx`: delete the local `describeOpensAt` (lines 38-56) and replace the `OpenStatusLine` body to call the shared label. Add the import `import { openStatusLabel } from "./open-status";` (alongside the existing lucide import). New `OpenStatusLine`:

```tsx
/** Riga di stato apertura. */
function OpenStatusLine({ status }: { status: StoreCardView["openStatus"] }) {
	return (
		<span
			className={`inline-flex items-center gap-1 text-xs ${
				status.isOpen ? "text-primary" : "text-muted-foreground"
			}`}
		>
			<Clock className="size-3" aria-hidden />
			{openStatusLabel(status)}
		</span>
	);
}
```

(`StoreCardView["openStatus"]` is structurally compatible with `OpenStatusView`, so no signature change is needed.)

- [ ] **Step 3: Typecheck**

Run: `cd apps/customer && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/customer/src/features/stores/open-status.ts apps/customer/src/features/stores/store-tile.tsx
git commit -m "refactor(customer): extract shared store open-status helpers (#2a)"
```

---

## Task 4: Customer — weekly opening-hours formatter (TDD)

**Files:**
- Create: `apps/customer/src/features/stores/format-opening-hours.ts`
- Test: `apps/customer/src/features/stores/format-opening-hours.test.ts`
- Modify: `apps/customer/package.json` (add `test` script)

**Interfaces:**
- Produces: `OpeningHoursDayInput` type, `WeekRow` type, `formatWeeklyHours(openingHours, todayDow): WeekRow[]`, `romeDayOfWeek(now): number` — consumed by Task 6's `opening-hours.tsx`.

- [ ] **Step 1: Add a `test` script to the customer app**

In `apps/customer/package.json`, add to `scripts`:

```json
		"test": "bun test",
```

- [ ] **Step 2: Write the failing tests**

Create `apps/customer/src/features/stores/format-opening-hours.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { formatWeeklyHours, romeDayOfWeek } from "./format-opening-hours";

describe("formatWeeklyHours", () => {
	it("returns 7 rows Lun→Dom, all closed when openingHours is null", () => {
		const rows = formatWeeklyHours(null, 0);
		expect(rows).toHaveLength(7);
		expect(rows[0].label).toBe("Lunedì");
		expect(rows[6].label).toBe("Domenica");
		expect(rows.every((r) => r.hours === null)).toBe(true);
	});

	it("joins multiple slots with ' · '", () => {
		const rows = formatWeeklyHours(
			[{ dayOfWeek: 0, slots: [{ open: "09:00", close: "13:00" }, { open: "16:00", close: "19:00" }] }],
			3,
		);
		expect(rows[0].hours).toBe("09:00–13:00 · 16:00–19:00");
	});

	it("marks days with no slots as closed (null hours)", () => {
		const rows = formatWeeklyHours([{ dayOfWeek: 2, slots: [] }], 0);
		expect(rows[2].hours).toBeNull();
	});

	it("flags only today", () => {
		const rows = formatWeeklyHours(null, 5);
		expect(rows.filter((r) => r.isToday).map((r) => r.dayOfWeek)).toEqual([5]);
	});
});

describe("romeDayOfWeek", () => {
	it("maps a Monday to 0 and a Sunday to 6", () => {
		expect(romeDayOfWeek(new Date("2026-06-22T12:00:00Z"))).toBe(0); // Monday
		expect(romeDayOfWeek(new Date("2026-06-21T12:00:00Z"))).toBe(6); // Sunday
	});
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/customer && bun test src/features/stores/format-opening-hours.test.ts`
Expected: FAIL — `Cannot find module "./format-opening-hours"`.

- [ ] **Step 4: Implement the formatter**

Create `apps/customer/src/features/stores/format-opening-hours.ts`:

```typescript
const DAY_LABELS = [
	"Lunedì",
	"Martedì",
	"Mercoledì",
	"Giovedì",
	"Venerdì",
	"Sabato",
	"Domenica",
] as const;

export interface OpeningHoursDayInput {
	dayOfWeek: number; // 0=Lun..6=Dom
	slots: { open: string; close: string }[];
}

export interface WeekRow {
	dayOfWeek: number;
	label: string;
	/** "09:00–13:00 · 16:00–19:00", or null when closed. */
	hours: string | null;
	isToday: boolean;
}

export function formatWeeklyHours(
	openingHours: OpeningHoursDayInput[] | null,
	todayDow: number,
): WeekRow[] {
	return DAY_LABELS.map((label, dow) => {
		const day = openingHours?.find((d) => d.dayOfWeek === dow);
		const hours =
			day && day.slots.length > 0
				? day.slots.map((s) => `${s.open}–${s.close}`).join(" · ")
				: null;
		return { dayOfWeek: dow, label, hours, isToday: dow === todayDow };
	});
}

/** Day of week 0=Lun..6=Dom in Europe/Rome for the given instant. */
export function romeDayOfWeek(now: Date): number {
	const weekday = new Intl.DateTimeFormat("en-US", {
		timeZone: "Europe/Rome",
		weekday: "short",
	}).format(now);
	const map: Record<string, number> = {
		Mon: 0,
		Tue: 1,
		Wed: 2,
		Thu: 3,
		Fri: 4,
		Sat: 5,
		Sun: 6,
	};
	return map[weekday] ?? 0;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/customer && bun test src/features/stores/format-opening-hours.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/customer/package.json apps/customer/src/features/stores/format-opening-hours.ts apps/customer/src/features/stores/format-opening-hours.test.ts
git commit -m "feat(customer): weekly opening-hours formatter (#2a)"
```

---

## Task 5: Customer — Leaflet dependency + client-only map

**Files:**
- Modify: root `package.json` (`catalog` block) and `apps/customer/package.json` (deps)
- Create: `apps/customer/src/features/stores/store-map.tsx`

**Interfaces:**
- Produces: default export `StoreMap({ lat, lng, name })` — a Leaflet map. **Top-level imports `leaflet`/`react-leaflet`**, so it must only ever be loaded client-side (Task 7 uses `lazy()` + a mount gate; never statically import it from an SSR-rendered module).

- [ ] **Step 1: Add the deps to the catalog and the customer app**

In root `package.json` `catalog` block, add (keep the block alphabetised):

```json
		"@types/leaflet": "^1.9.12",
		"leaflet": "^1.9.4",
		"react-leaflet": "^5.0.0",
```

In `apps/customer/package.json`, add `"leaflet": "catalog:"` and `"react-leaflet": "catalog:"` to `dependencies`, and `"@types/leaflet": "catalog:"` to `devDependencies`.

- [ ] **Step 2: Install**

Run: `bun install`
Expected: lockfile updates; `leaflet`, `react-leaflet`, `@types/leaflet` resolved. (If the `^5.0.0`/`^1.9.x` floors don't resolve, bump to the latest published majors that support React 19 and re-run.)

- [ ] **Step 3: Implement the map component**

Create `apps/customer/src/features/stores/store-map.tsx`:

```tsx
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, Marker, TileLayer } from "react-leaflet";

// divIcon HTML lives in the document, so brand CSS vars resolve and stay theme-aware.
const pinIcon = L.divIcon({
	className: "",
	html: `<svg width="32" height="40" viewBox="0 0 24 30" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C6.48 0 2 4.48 2 10c0 6.5 10 20 10 20s10-13.5 10-20C22 4.48 17.52 0 12 0z" fill="var(--saffron)" stroke="var(--ink)" stroke-width="1.5"/><circle cx="12" cy="10" r="3.2" fill="var(--ink)"/></svg>`,
	iconSize: [32, 40],
	iconAnchor: [16, 40],
});

export default function StoreMap({
	lat,
	lng,
	name,
}: {
	lat: number;
	lng: number;
	name: string;
}) {
	return (
		<MapContainer
			center={[lat, lng]}
			zoom={15}
			scrollWheelZoom={false}
			className="h-56 w-full"
			style={{ zIndex: 0 }}
		>
			<TileLayer
				attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
				url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
			/>
			<Marker position={[lat, lng]} icon={pinIcon} title={name} />
		</MapContainer>
	);
}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/customer && bun run typecheck`
Expected: PASS. (Full render is verified in Task 7; this component is only loaded client-side there.)

- [ ] **Step 5: Commit**

```bash
git add package.json apps/customer/package.json bun.lock apps/customer/src/features/stores/store-map.tsx
git commit -m "feat(customer): client-only Leaflet store map (#2a)"
```

---

## Task 6: Customer — cover + opening-hours sections + data hook

**Files:**
- Create: `apps/customer/src/features/stores/store-cover.tsx`
- Create: `apps/customer/src/features/stores/opening-hours.tsx`
- Create: `apps/customer/src/features/stores/use-store-detail.ts`

**Interfaces:**
- Consumes: `openStatusLabel`/`OpenStatusView` (Task 3), `formatWeeklyHours`/`romeDayOfWeek`/`OpeningHoursDayInput` (Task 4), `api()` (`@/lib/api`), `toYMD` (`@/lib/date`).
- Produces: `StoreCover`, `OpeningHours` components and `useStoreDetail(storeId)` → `{ data: StoreDetailView | null, isPending, isError }` (consumed by Task 7).

- [ ] **Step 1: Implement the data hook**

Create `apps/customer/src/features/stores/use-store-detail.ts`:

```typescript
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toYMD } from "@/lib/date";
import type { OpeningHoursDayInput } from "./format-opening-hours";
import type { OpenStatusView } from "./open-status";

export interface StoreDetailView {
	id: string;
	name: string;
	description: string | null;
	category: { id: string; name: string } | null;
	city: string;
	province: string;
	addressLine1: string;
	addressLine2: string | null;
	zipCode: string;
	coordinates: { lat: number; lng: number } | null;
	images: { id: string; url: string }[];
	phoneNumbers: { id: string; label: string | null; number: string }[];
	websiteUrl: string | null;
	openingHours: OpeningHoursDayInput[] | null;
	openStatus: OpenStatusView;
}

/** Fetches a store's public detail. Returns `null` (not an error) on 404. */
export function useStoreDetail(storeId: string) {
	return useQuery({
		queryKey: ["store-detail", storeId],
		staleTime: 60_000,
		queryFn: async (): Promise<StoreDetailView | null> => {
			const { data, error } = await api().customer.stores({ id: storeId }).get();
			if (error) {
				if (error.status === 404) return null;
				throw new Error(`Caricamento negozio non riuscito (${error.status})`);
			}
			const s = data.data;
			return {
				id: s.id,
				name: s.name,
				description: s.description,
				category: s.category,
				city: s.municipality.name,
				province: s.municipality.provinceAcronym,
				addressLine1: s.addressLine1,
				addressLine2: s.addressLine2,
				zipCode: s.zipCode,
				coordinates: s.coordinates,
				images: s.images.map((i) => ({ id: i.id, url: i.url })),
				phoneNumbers: s.phoneNumbers.map((p) => ({
					id: p.id,
					label: p.label,
					number: p.number,
				})),
				websiteUrl: s.websiteUrl,
				openingHours: s.openingHours,
				openStatus: {
					isOpen: s.openStatus.isOpen,
					status: s.openStatus.status,
					closesAt: s.openStatus.closesAt ?? undefined,
					opensAt: s.openStatus.opensAt
						? { date: toYMD(s.openStatus.opensAt.date), time: s.openStatus.opensAt.time }
						: undefined,
				},
			};
		},
	});
}
```

> If `api().customer.stores({ id }).get()` does not type-resolve, inspect the generated Eden treaty type for the `:id` segment and adjust the call accordingly (it is the only line that depends on the treaty shape). `bun run typecheck` (Step 4) confirms it.

- [ ] **Step 2: Implement the cover hero**

Create `apps/customer/src/features/stores/store-cover.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Clock } from "lucide-react";
import { useState } from "react";
import { openStatusLabel, type OpenStatusView } from "./open-status";

interface StoreCoverProps {
	name: string;
	imageUrl: string | null;
	categoryName: string | null;
	city: string;
	province: string;
	openStatus: OpenStatusView;
}

export function StoreCover({
	name,
	imageUrl,
	categoryName,
	city,
	province,
	openStatus,
}: StoreCoverProps) {
	const [failed, setFailed] = useState(false);
	const showImage = imageUrl && !failed;
	const initial = name.trim().charAt(0).toUpperCase() || "?";

	return (
		<div className="relative h-64 w-full overflow-hidden sm:h-80">
			{showImage ? (
				<>
					<img
						src={imageUrl}
						alt={name}
						decoding="async"
						onError={() => setFailed(true)}
						className="absolute inset-0 size-full object-cover"
					/>
					<div
						className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/25 to-transparent"
						aria-hidden
					/>
				</>
			) : (
				<div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-saffron to-saffron-deep">
					<span aria-hidden className="font-display font-semibold text-7xl text-cream/90">
						{initial}
					</span>
				</div>
			)}

			<Link
				to="/stores"
				className="absolute top-4 left-4 inline-flex items-center gap-1 rounded-full bg-ink/40 px-3 py-1.5 font-medium text-cream text-sm backdrop-blur-sm transition-colors hover:bg-ink/60"
			>
				<ChevronLeft className="size-4" aria-hidden />
				Negozi
			</Link>

			<div className="absolute inset-x-0 bottom-0 mx-auto max-w-3xl px-4 pb-5">
				<h1 className="font-bold font-display text-3xl text-cream leading-tight tracking-[-0.015em] drop-shadow-sm sm:text-4xl">
					{name}
				</h1>
				<p className="mt-1 text-cream/85 text-sm">
					{categoryName ? `${categoryName} · ` : ""}
					{city} ({province})
				</p>
				<span
					className={`mt-2 inline-flex items-center gap-1.5 rounded-full bg-cream px-2.5 py-1 font-medium text-xs ${
						openStatus.isOpen ? "text-saffron-deep" : "text-ink/70"
					}`}
				>
					<Clock className="size-3.5" aria-hidden />
					{openStatusLabel(openStatus)}
				</span>
			</div>
		</div>
	);
}
```

- [ ] **Step 3: Implement the opening-hours section**

Create `apps/customer/src/features/stores/opening-hours.tsx`:

```tsx
import { formatWeeklyHours, type OpeningHoursDayInput, romeDayOfWeek } from "./format-opening-hours";

export function OpeningHours({
	openingHours,
}: {
	openingHours: OpeningHoursDayInput[] | null;
}) {
	const rows = formatWeeklyHours(openingHours, romeDayOfWeek(new Date()));
	return (
		<dl className="divide-y divide-border overflow-hidden rounded-xl border border-border">
			{rows.map((r) => (
				<div
					key={r.dayOfWeek}
					className={`flex items-center justify-between px-4 py-2.5 text-sm ${
						r.isToday ? "bg-muted/60 font-medium" : ""
					}`}
				>
					<dt className="text-foreground">{r.label}</dt>
					<dd
						className={`tabular-nums ${r.hours ? "text-foreground" : "text-muted-foreground"}`}
					>
						{r.hours ?? "Chiuso"}
					</dd>
				</div>
			))}
		</dl>
	);
}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/customer && bun run typecheck`
Expected: PASS (this confirms the Eden treaty path in Step 1 and all the imports line up).

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/features/stores/use-store-detail.ts apps/customer/src/features/stores/store-cover.tsx apps/customer/src/features/stores/opening-hours.tsx
git commit -m "feat(customer): store cover, opening-hours section, detail hook (#2a)"
```

---

## Task 7: Customer — detail route + tile navigation (end-to-end)

**Files:**
- Create: `apps/customer/src/routes/_authenticated/stores/$storeId.tsx`
- Modify: `apps/customer/src/features/stores/store-tile.tsx` (wrap in `<Link>`)

**Interfaces:**
- Consumes: `useStoreDetail`/`StoreDetailView` (Task 6), `StoreCover`, `OpeningHours`, `StoreMap` (lazy), `Button` (`@bibs/ui`).

- [ ] **Step 1: Make the tile navigate**

In `apps/customer/src/features/stores/store-tile.tsx`, import `Link` and wrap the `<article>` so the whole tile links to the detail route. Add `import { Link } from "@tanstack/react-router";` and change the returned root element:

```tsx
	return (
		<Link
			to="/stores/$storeId"
			params={{ storeId: store.id }}
			className="group flex flex-col gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-saffron"
		>
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
				<h3 className="line-clamp-2 font-medium text-[0.9375rem] text-foreground leading-snug group-hover:text-primary">
					{store.name}
				</h3>
				<p className="text-muted-foreground text-sm">
					{store.category ? `${store.category.name} · ` : ""}
					{store.city} ({store.province})
				</p>
				<OpenStatusLine status={store.openStatus} />
			</div>
		</Link>
	);
```

(Keep the `article`'s former classes folded into the `Link`. Remove the now-unused `<article>` wrapper.)

- [ ] **Step 2: Implement the route**

Create `apps/customer/src/routes/_authenticated/stores/$storeId.tsx`:

```tsx
import { Button } from "@bibs/ui/components/button";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Compass, Globe, MapPin, Phone, RotateCw } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { OpeningHours } from "@/features/stores/opening-hours";
import { StoreCover } from "@/features/stores/store-cover";
import { useStoreDetail } from "@/features/stores/use-store-detail";

const LazyStoreMap = lazy(() => import("@/features/stores/store-map"));

export const Route = createFileRoute("/_authenticated/stores/$storeId")({
	component: StoreDetailPage,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="space-y-3">
			<h2 className="font-display font-semibold text-foreground text-lg">{title}</h2>
			{children}
		</section>
	);
}

function MapSkeleton() {
	return <div className="h-56 w-full animate-pulse rounded-xl bg-muted" aria-hidden />;
}

function MapSection({
	coordinates,
	name,
	address,
}: {
	coordinates: { lat: number; lng: number };
	name: string;
	address: string;
}) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	const mapsHref = `https://www.google.com/maps/search/?api=1&query=${coordinates.lat},${coordinates.lng}`;
	return (
		<Section title="Dove siamo">
			<div className="relative isolate overflow-hidden rounded-xl border border-border">
				{mounted ? (
					<Suspense fallback={<MapSkeleton />}>
						<LazyStoreMap lat={coordinates.lat} lng={coordinates.lng} name={name} />
					</Suspense>
				) : (
					<MapSkeleton />
				)}
			</div>
			<p className="text-muted-foreground text-sm">{address}</p>
			<Button asChild variant="secondary" size="sm">
				<a href={mapsHref} target="_blank" rel="noopener noreferrer">
					<MapPin className="size-4" aria-hidden />
					Apri in Mappe
				</a>
			</Button>
		</Section>
	);
}

function StoreDetailPage() {
	const { storeId } = Route.useParams();
	const { data: store, isPending, isError, refetch } = useStoreDetail(storeId);

	if (isPending) {
		return (
			<div>
				<Skeleton className="h-64 w-full sm:h-80" />
				<div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
					<Skeleton className="h-24 w-full" />
					<Skeleton className="h-56 w-full" />
				</div>
			</div>
		);
	}

	if (isError) {
		return (
			<NoticePage
				icon={RotateCw}
				title="Non siamo riusciti a caricare il negozio"
				description="Qualcosa è andato storto. Riprova tra un momento."
				action={
					<Button variant="secondary" size="sm" onClick={() => refetch()}>
						<RotateCw className="size-4" aria-hidden />
						Riprova
					</Button>
				}
			/>
		);
	}

	if (!store) {
		return (
			<NoticePage
				icon={Compass}
				title="Negozio non trovato"
				description="Questo negozio non esiste o non è più disponibile."
				action={
					<Button asChild variant="secondary" size="sm">
						<Link to="/stores">Torna ai negozi</Link>
					</Button>
				}
			/>
		);
	}

	const cover = store.images[0]?.url ?? null;
	const address = `${store.addressLine1}${store.addressLine2 ? `, ${store.addressLine2}` : ""} · ${store.zipCode} ${store.city} (${store.province})`;
	const hasContacts = store.phoneNumbers.length > 0 || Boolean(store.websiteUrl);

	return (
		<div>
			<StoreCover
				name={store.name}
				imageUrl={cover}
				categoryName={store.category?.name ?? null}
				city={store.city}
				province={store.province}
				openStatus={store.openStatus}
			/>

			<div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
				{store.images.length > 1 && (
					<ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
						{store.images.slice(1).map((img) => (
							<li key={img.id} className="shrink-0">
								<img
									src={img.url}
									alt={store.name}
									loading="lazy"
									decoding="async"
									className="h-28 w-40 rounded-lg border border-border object-cover"
								/>
							</li>
						))}
					</ul>
				)}

				{store.description && (
					<Section title="Descrizione">
						<p className="whitespace-pre-line text-muted-foreground text-sm leading-relaxed">
							{store.description}
						</p>
					</Section>
				)}

				<Section title="Orari">
					<OpeningHours openingHours={store.openingHours} />
				</Section>

				{store.coordinates && (
					<MapSection coordinates={store.coordinates} name={store.name} address={address} />
				)}

				{hasContacts && (
					<Section title="Contatti">
						<ul className="space-y-2">
							{store.phoneNumbers.map((p) => (
								<li key={p.id}>
									<a
										href={`tel:${p.number}`}
										className="inline-flex items-center gap-2 text-foreground text-sm hover:text-primary"
									>
										<Phone className="size-4 text-muted-foreground" aria-hidden />
										{p.label ? `${p.label}: ${p.number}` : p.number}
									</a>
								</li>
							))}
							{store.websiteUrl && (
								<li>
									<a
										href={store.websiteUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex items-center gap-2 text-foreground text-sm hover:text-primary"
									>
										<Globe className="size-4 text-muted-foreground" aria-hidden />
										Sito web
									</a>
								</li>
							)}
						</ul>
					</Section>
				)}
			</div>
		</div>
	);
}

function NoticePage({
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
		<div className="mx-auto w-full max-w-3xl px-4 py-16">
			<div className="flex flex-col items-center gap-4 rounded-xl border border-border border-dashed px-6 py-14 text-center">
				<div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
					<Icon className="size-6" aria-hidden />
				</div>
				<div className="space-y-1">
					<h1 className="font-display font-semibold text-foreground text-lg">{title}</h1>
					<p className="mx-auto max-w-sm text-muted-foreground text-sm leading-relaxed">
						{description}
					</p>
				</div>
				{action}
			</div>
		</div>
	);
}
```

- [ ] **Step 3: Typecheck (regenerates the route tree)**

Run: `cd apps/customer && bun run typecheck`
Expected: PASS. The router plugin generates the `/_authenticated/stores/$storeId` route so the tile's `<Link to="/stores/$storeId">` type-checks. (If the generated route tree is stale, run `bun run dev` once to regenerate, then re-run typecheck.)

- [ ] **Step 4: Browser verification**

Run: `cd apps/customer && bun run dev` (port 3001). Log in with a customer dev account, then:
- Go to `/stores`, click a tile → lands on `/stores/<id>`.
- **Cover**: store with photos shows the image + scrim + readable name/badge; a store **without** photos shows the saffron gradient + initial.
- **Orari**: weekly list Lun→Dom, today's row highlighted, closed days show "Chiuso".
- **Mappa**: Leaflet map renders with the OSM tiles + saffron pin; "Apri in Mappe" opens Google Maps at the right point. Confirm no SSR error in the terminal (no "window is not defined").
- **Contatti**: `tel:` links and website link present when set; section absent when the store has neither.
- **404**: visit `/stores/nonexistent-id` → "Negozio non trovato" notice.
- **Dark mode**: set `localStorage.theme = 'dark'` and reload — cover text stays readable, surfaces flip correctly, no invisible text.
- Confirm the open-status badge shows real text (no `[object Date]`).

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/routes/_authenticated/stores/$storeId.tsx apps/customer/src/features/stores/store-tile.tsx
git commit -m "feat(customer): store detail page + tile navigation (#2a)"
```

---

## Verification (end-to-end)

1. **API tests:** `cd apps/api && bun test tests/integration/customer-store-detail.test.ts --timeout 180000` → all green.
2. **API typecheck:** `cd apps/api && bun run typecheck` → clean.
3. **FE formatter test:** `cd apps/customer && bun test src/features/stores/format-opening-hours.test.ts` → all green.
4. **FE typecheck:** `cd apps/customer && bun run typecheck` → clean (proves the Eden treaty path + route tree).
5. **Browser smoke** (Task 7, Step 4) on a real authenticated customer session, including dark mode and the no-photo / 404 edge cases.
6. **Biome:** the Edit/Write hook auto-fixes; if running manually, `bun run check` at root.

## Out of scope (→ #2b and later)

Product catalog of the store (#2b: needs a products-by-store endpoint), public/shareable (logged-out) pages + SEO, reviews/favorites, explicit upcoming-closures list.
