# Store Closures & Italian Holidays — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each seller mark calendar closure days for their store — observing platform-managed Italian holidays by default (with per-holiday opt-out) plus custom full-day closures — and let admins manage the canonical holiday list; expose an "open now" status on the store payload.

**Architecture:** A pure, unit-tested domain module (`apps/api/src/lib/holidays/`) computes Easter (Computus), resolves holiday definitions + custom closures to concrete dates, and derives open/closed status. Persistence is hybrid: an admin-managed `holiday_definitions` table, a `store_holiday_optouts` join table (FK→definition, cascade), and a JSONB `closures` column on `stores` (twin of `openingHours`). Admin CRUD + a seller GET/PUT closures endpoint sit on top; the seller store-list payload is enriched with a computed `openStatus`. UI: a "Festività" tab in the admin `/configurations` page and a dedicated `/store/closures` page in the seller app.

**Tech Stack:** Bun + Elysia + Drizzle (Postgres/PostGIS) on the API; TanStack Start + React Query + Eden Treaty + Paraglide on the frontends; TypeBox (`t` from elysia) for API schemas, Zod for admin forms, `bun:test` + testcontainers for tests.

**Reference spec:** `docs/superpowers/specs/2026-05-30-store-closures-holidays-design.md`

**Conventions locked from the codebase (do not deviate):**
- IDs: `text("id").primaryKey().$defaultFn(() => crypto.randomUUID())`.
- Enums: `text("col", { enum: [...] as const })` + a `check("name", sql\`...\`)` constraint (never `pgEnum`).
- `relations()` live in the same schema file; `db/schemas/index.ts` is a pure barrel (`export * from "./x"`).
- `ServiceError(status, message)` is **two-arg only**; status restricted to `ERROR_CODES` keys.
- Routes: handler `async (ctx) => { const { ... } = withAdmin(ctx) /* or withSeller(ctx) */; ... return ok(data); }`. Response via `okRes()/okPageRes()/OkMessage` wrapped in `withErrors()/withConflictErrors()`; runtime envelope via `ok()/okPage()/okMessage()` from `@/lib/responses`. Italian `detail.summary`/`detail.description` + `tags`. No try/catch — let the global handler map pg `23505`→409.
- Seller: `withSeller(ctx)` gives `{ sellerProfile: sp, isOwner, ... }`; use **`sp.id`** (NOT `sp.p`). Owner-only routes call `requireOwner(isOwner)` first.
- `dayOfWeek` is **0=Monday … 6=Sunday** (NOT JS `getDay`).
- Admin FE panels: first line `"use no memo";`; toasts hardcoded Italian via `toast` from `@bibs/ui/components/sonner`; `api()` is invoked (`api().admin[...]`).
- Seller FE: i18n via Paraglide (`m["dotted.key"]()`), no hardcoded user copy.
- Commit messages: Conventional Commits; scope `api`/`seller`/`admin`. Lefthook runs Biome + commit-msg validation — never `--no-verify`.

---

## Phase 1 — Domain module, schema, migration, seed

Phase outcome: the Easter/resolution/open-status logic is fully unit-tested (no DB), the three persistence changes exist, the migration is applied, and the default Italian holiday set is seeded. Independently verifiable via `bun test tests/lib/holidays` and `bun run db:migrate` + `bun run db:seed`.

Work from `apps/api/`. Pure-domain tests live under `apps/api/tests/lib/holidays/` and run with `bun test tests/lib/holidays` (no testcontainer needed).

### Task 1: Computus (Easter date)

**Files:**
- Create: `apps/api/src/lib/holidays/easter.ts`
- Test: `apps/api/tests/lib/holidays/easter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/tests/lib/holidays/easter.test.ts
import { describe, expect, it } from "bun:test";
import { computeEaster } from "@/lib/holidays/easter";

describe("computeEaster (Gregorian Computus)", () => {
	const cases: Array<[number, number, number]> = [
		// [year, month (1-12), day]
		[2024, 3, 31],
		[2025, 4, 20],
		[2026, 4, 5],
		[2027, 3, 28],
		[2030, 4, 21],
		[2000, 4, 23],
	];

	for (const [year, month, day] of cases) {
		it(`Easter ${year} = ${year}-${month}-${day}`, () => {
			expect(computeEaster(year)).toEqual({ month, day });
		});
	}
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/lib/holidays/easter.test.ts`
Expected: FAIL — `Cannot find module "@/lib/holidays/easter"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/lib/holidays/easter.ts

/**
 * Gregorian Easter Sunday for a given year (Anonymous/Meeus algorithm).
 * Returns month (1-12) and day (1-31). Pure integer arithmetic — no Date.
 */
export function computeEaster(year: number): { month: number; day: number } {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31);
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return { month, day };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/lib/holidays/easter.test.ts`
Expected: PASS (6 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/holidays/easter.ts apps/api/tests/lib/holidays/easter.test.ts
git commit -m "feat(api): add Gregorian Computus for Easter dates"
```

### Task 2: Calendar date helpers

**Files:**
- Create: `apps/api/src/lib/holidays/dates.ts`
- Test: `apps/api/tests/lib/holidays/dates.test.ts`

These are pure string-calendar helpers (no timezone). `dowFromYMD` returns the repo convention **0=Mon … 6=Sun**.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/tests/lib/holidays/dates.test.ts
import { describe, expect, it } from "bun:test";
import { addDaysYMD, dowFromYMD, expandRange, ymdToYear } from "@/lib/holidays/dates";

describe("calendar date helpers", () => {
	it("dowFromYMD uses 0=Mon..6=Sun", () => {
		expect(dowFromYMD("2026-05-25")).toBe(0); // Monday
		expect(dowFromYMD("2026-05-31")).toBe(6); // Sunday
	});

	it("addDaysYMD rolls across month and year boundaries", () => {
		expect(addDaysYMD("2026-01-31", 1)).toBe("2026-02-01");
		expect(addDaysYMD("2026-12-31", 1)).toBe("2027-01-01");
		expect(addDaysYMD("2026-03-28", 1)).toBe("2026-03-29"); // DST day in IT, calendar unaffected
	});

	it("expandRange yields inclusive days; missing end = single day", () => {
		expect(expandRange("2026-08-01", "2026-08-03")).toEqual([
			"2026-08-01",
			"2026-08-02",
			"2026-08-03",
		]);
		expect(expandRange("2026-08-10")).toEqual(["2026-08-10"]);
	});

	it("expandRange ignores reversed ranges (end < start) → empty", () => {
		expect(expandRange("2026-08-05", "2026-08-01")).toEqual([]);
	});

	it("ymdToYear extracts the year", () => {
		expect(ymdToYear("2026-04-05")).toBe(2026);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/lib/holidays/dates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/lib/holidays/dates.ts

/** Parse "YYYY-MM-DD" into a UTC Date (calendar-only, no tz semantics). */
function parseUTC(ymd: string): Date {
	const [y, m, d] = ymd.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d));
}

/** Format a UTC Date back to "YYYY-MM-DD". */
function fmtUTC(date: Date): string {
	const y = date.getUTCFullYear();
	const m = String(date.getUTCMonth() + 1).padStart(2, "0");
	const d = String(date.getUTCDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

/** Build "YYYY-MM-DD" from numeric parts. */
export function makeYMD(year: number, month: number, day: number): string {
	return fmtUTC(new Date(Date.UTC(year, month - 1, day)));
}

/** Day of week, 0=Monday … 6=Sunday (repo convention). */
export function dowFromYMD(ymd: string): number {
	return (parseUTC(ymd).getUTCDay() + 6) % 7;
}

/** Add (or subtract) whole days to a calendar date. */
export function addDaysYMD(ymd: string, days: number): string {
	const d = parseUTC(ymd);
	d.setUTCDate(d.getUTCDate() + days);
	return fmtUTC(d);
}

/** Inclusive list of dates from start to end (end omitted = single day). */
export function expandRange(start: string, end?: string | null): string[] {
	const last = end ?? start;
	if (last < start) return [];
	const out: string[] = [];
	for (let cur = start; cur <= last; cur = addDaysYMD(cur, 1)) out.push(cur);
	return out;
}

/** Year component of "YYYY-MM-DD". */
export function ymdToYear(ymd: string): number {
	return Number(ymd.slice(0, 4));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/lib/holidays/dates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/holidays/dates.ts apps/api/tests/lib/holidays/dates.test.ts
git commit -m "feat(api): add calendar date helpers for holiday resolution"
```

### Task 3: Domain types + resolve holiday occurrences

**Files:**
- Create: `apps/api/src/lib/holidays/types.ts`
- Create: `apps/api/src/lib/holidays/resolve.ts`
- Test: `apps/api/tests/lib/holidays/resolve.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/tests/lib/holidays/resolve.test.ts
import { describe, expect, it } from "bun:test";
import { resolveOccurrences, resolveStoreClosedDates } from "@/lib/holidays/resolve";
import type { HolidayDef } from "@/lib/holidays/types";

const fixed = (id: string, month: number, day: number): HolidayDef => ({
	id,
	type: "fixed",
	month,
	day,
	easterOffsetDays: null,
	oneOffDate: null,
});
const easter = (id: string, offset: number): HolidayDef => ({
	id,
	type: "easter_relative",
	month: null,
	day: null,
	easterOffsetDays: offset,
	oneOffDate: null,
});
const oneOff = (id: string, date: string): HolidayDef => ({
	id,
	type: "one_off",
	month: null,
	day: null,
	easterOffsetDays: null,
	oneOffDate: date,
});

describe("resolveOccurrences", () => {
	it("fixed: one date per year in range", () => {
		expect(resolveOccurrences(fixed("x", 12, 25), 2025, 2027)).toEqual([
			"2025-12-25",
			"2026-12-25",
			"2027-12-25",
		]);
	});

	it("easter_relative: Pasquetta (offset 1) follows Easter each year", () => {
		// Easter 2026 = 2026-04-05 → Pasquetta = 2026-04-06
		expect(resolveOccurrences(easter("p", 1), 2026, 2026)).toEqual(["2026-04-06"]);
		// Easter 2027 = 2027-03-28 → Pasquetta = 2027-03-29
		expect(resolveOccurrences(easter("p", 1), 2027, 2027)).toEqual(["2027-03-29"]);
	});

	it("one_off: only when within range", () => {
		expect(resolveOccurrences(oneOff("o", "2026-10-12"), 2026, 2026)).toEqual([
			"2026-10-12",
		]);
		expect(resolveOccurrences(oneOff("o", "2026-10-12"), 2027, 2028)).toEqual([]);
	});
});

describe("resolveStoreClosedDates", () => {
	const defs: HolidayDef[] = [fixed("natale", 12, 25), easter("pasquetta", 1)];

	it("observes all active defs by default, within the window", () => {
		const closed = resolveStoreClosedDates(
			{ activeDefs: defs, optOutIds: [], customClosures: [] },
			{ from: "2026-01-01", to: "2026-12-31" },
		);
		expect(closed.has("2026-12-25")).toBe(true);
		expect(closed.has("2026-04-06")).toBe(true);
	});

	it("opt-out removes that holiday only", () => {
		const closed = resolveStoreClosedDates(
			{ activeDefs: defs, optOutIds: ["natale"], customClosures: [] },
			{ from: "2026-01-01", to: "2026-12-31" },
		);
		expect(closed.has("2026-12-25")).toBe(false);
		expect(closed.has("2026-04-06")).toBe(true);
	});

	it("custom closures (ranges) are unioned and clipped to the window", () => {
		const closed = resolveStoreClosedDates(
			{
				activeDefs: [],
				optOutIds: [],
				customClosures: [{ startDate: "2026-08-10", endDate: "2026-08-20" }],
			},
			{ from: "2026-08-15", to: "2026-08-31" },
		);
		expect(closed.has("2026-08-14")).toBe(false); // before window
		expect(closed.has("2026-08-15")).toBe(true);
		expect(closed.has("2026-08-20")).toBe(true);
		expect(closed.has("2026-08-21")).toBe(false); // after range
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/lib/holidays/resolve.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/lib/holidays/types.ts

export type HolidayType = "fixed" | "easter_relative" | "one_off";

/** Domain view of a holiday definition (decoupled from the DB row / TypeBox). */
export interface HolidayDef {
	id: string;
	type: HolidayType;
	month: number | null;
	day: number | null;
	easterOffsetDays: number | null;
	oneOffDate: string | null; // "YYYY-MM-DD"
}

export interface CustomClosure {
	startDate: string; // "YYYY-MM-DD"
	endDate?: string | null;
	note?: string | null;
}

export interface OpeningHoursDay {
	dayOfWeek: number; // 0=Mon..6=Sun
	slots: Array<{ open: string; close: string }>; // "HH:mm"
}

export interface OpenStatus {
	isOpen: boolean;
	status: "open" | "closed" | "closed_holiday";
	/** "HH:mm" the store closes today, when currently open. */
	closesAt?: string;
	/** Next opening when currently closed. */
	opensAt?: { date: string; time: string };
}
```

```ts
// apps/api/src/lib/holidays/resolve.ts
import { computeEaster } from "./easter";
import { addDaysYMD, expandRange, makeYMD, ymdToYear } from "./dates";
import type { CustomClosure, HolidayDef } from "./types";

/** All concrete dates a single definition falls on, across [fromYear, toYear]. */
export function resolveOccurrences(
	def: HolidayDef,
	fromYear: number,
	toYear: number,
): string[] {
	if (def.type === "one_off") {
		if (!def.oneOffDate) return [];
		const y = ymdToYear(def.oneOffDate);
		return y >= fromYear && y <= toYear ? [def.oneOffDate] : [];
	}

	const out: string[] = [];
	for (let year = fromYear; year <= toYear; year++) {
		if (def.type === "fixed") {
			if (def.month == null || def.day == null) continue;
			out.push(makeYMD(year, def.month, def.day));
		} else {
			// easter_relative
			if (def.easterOffsetDays == null) continue;
			const e = computeEaster(year);
			out.push(addDaysYMD(makeYMD(year, e.month, e.day), def.easterOffsetDays));
		}
	}
	return out;
}

/** Set of closed calendar dates for a store within [from, to]. */
export function resolveStoreClosedDates(
	input: {
		activeDefs: HolidayDef[];
		optOutIds: string[];
		customClosures: CustomClosure[];
	},
	window: { from: string; to: string },
): Set<string> {
	const optedOut = new Set(input.optOutIds);
	const fromYear = ymdToYear(window.from);
	const toYear = ymdToYear(window.to);
	const closed = new Set<string>();

	for (const def of input.activeDefs) {
		if (optedOut.has(def.id)) continue;
		for (const ymd of resolveOccurrences(def, fromYear, toYear)) {
			if (ymd >= window.from && ymd <= window.to) closed.add(ymd);
		}
	}

	for (const c of input.customClosures) {
		for (const ymd of expandRange(c.startDate, c.endDate)) {
			if (ymd >= window.from && ymd <= window.to) closed.add(ymd);
		}
	}

	return closed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/lib/holidays/resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/holidays/types.ts apps/api/src/lib/holidays/resolve.ts apps/api/tests/lib/holidays/resolve.test.ts
git commit -m "feat(api): resolve holiday definitions + custom closures to dates"
```

### Task 4: Open-now status

**Files:**
- Create: `apps/api/src/lib/holidays/open-status.ts`
- Test: `apps/api/tests/lib/holidays/open-status.test.ts`

`now` is injected so tests are deterministic. The only timezone touch-point is `nowInRome`, which derives the Europe/Rome wall-clock via `Intl`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/tests/lib/holidays/open-status.test.ts
import { describe, expect, it } from "bun:test";
import { getOpenStatus } from "@/lib/holidays/open-status";
import type { OpeningHoursDay } from "@/lib/holidays/types";

// Mon-Fri 09:00-13:00 / 14:30-19:00 (dayOfWeek 0..4); weekend closed.
const hours: OpeningHoursDay[] = Array.from({ length: 5 }, (_, i) => ({
	dayOfWeek: i,
	slots: [
		{ open: "09:00", close: "13:00" },
		{ open: "14:30", close: "19:00" },
	],
}));

// Helper: a UTC instant that maps to the given Rome wall-clock.
// Rome is UTC+2 in summer (CEST). 2026-05-25 is a Monday.
const romeSummer = (h: number, m = 0) =>
	new Date(Date.UTC(2026, 4, 25, h - 2, m)); // subtract +2 offset

describe("getOpenStatus", () => {
	it("open during a morning slot", () => {
		const s = getOpenStatus({ openingHours: hours, closedDates: new Set(), now: romeSummer(10) });
		expect(s.isOpen).toBe(true);
		expect(s.status).toBe("open");
		expect(s.closesAt).toBe("13:00");
	});

	it("closed during lunch break → opensAt the afternoon slot", () => {
		const s = getOpenStatus({ openingHours: hours, closedDates: new Set(), now: romeSummer(13, 30) });
		expect(s.isOpen).toBe(false);
		expect(s.status).toBe("closed");
		expect(s.opensAt).toEqual({ date: "2026-05-25", time: "14:30" });
	});

	it("before opening → opensAt today's first slot", () => {
		const s = getOpenStatus({ openingHours: hours, closedDates: new Set(), now: romeSummer(8) });
		expect(s.opensAt).toEqual({ date: "2026-05-25", time: "09:00" });
	});

	it("after closing on Friday → opensAt Monday (weekend closed)", () => {
		// 2026-05-29 is a Friday; +2 days = Sunday closed, Monday 2026-06-01 opens.
		const friNight = new Date(Date.UTC(2026, 4, 29, 20 - 2));
		const s = getOpenStatus({ openingHours: hours, closedDates: new Set(), now: friNight });
		expect(s.opensAt).toEqual({ date: "2026-06-01", time: "09:00" });
	});

	it("holiday today → closed_holiday, opensAt next non-closed open day", () => {
		// Monday 2026-05-25 is normally open but marked closed.
		const s = getOpenStatus({
			openingHours: hours,
			closedDates: new Set(["2026-05-25"]),
			now: romeSummer(10),
		});
		expect(s.isOpen).toBe(false);
		expect(s.status).toBe("closed_holiday");
		expect(s.opensAt).toEqual({ date: "2026-05-26", time: "09:00" });
	});

	it("null opening hours → closed, no opensAt", () => {
		const s = getOpenStatus({ openingHours: null, closedDates: new Set(), now: romeSummer(10) });
		expect(s).toEqual({ isOpen: false, status: "closed" });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/lib/holidays/open-status.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/lib/holidays/open-status.ts
import { addDaysYMD, dowFromYMD } from "./dates";
import type { OpenStatus, OpeningHoursDay } from "./types";

const MAX_LOOKAHEAD_DAYS = 60;

/** Current Europe/Rome calendar date + minutes-since-midnight. */
function nowInRome(now: Date): { date: string; minutes: number } {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: "Europe/Rome",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(now);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
	const date = `${get("year")}-${get("month")}-${get("day")}`;
	const minutes = Number(get("hour")) * 60 + Number(get("minute"));
	return { date, minutes };
}

const toMinutes = (hhmm: string): number => {
	const [h, m] = hhmm.split(":").map(Number);
	return h * 60 + m;
};

/** Slots for a weekday, sorted by opening time. */
function slotsFor(
	openingHours: OpeningHoursDay[] | null,
	dow: number,
): Array<{ open: string; close: string }> {
	const day = openingHours?.find((d) => d.dayOfWeek === dow);
	if (!day) return [];
	return [...day.slots].sort((a, b) => toMinutes(a.open) - toMinutes(b.open));
}

export function getOpenStatus(input: {
	openingHours: OpeningHoursDay[] | null;
	closedDates: Set<string>;
	now: Date;
}): OpenStatus {
	const { openingHours, closedDates } = input;
	const { date: today, minutes } = nowInRome(input.now);
	const closedToday = closedDates.has(today);

	// Currently open? (never when today is a closure date)
	if (!closedToday) {
		for (const s of slotsFor(openingHours, dowFromYMD(today))) {
			if (minutes >= toMinutes(s.open) && minutes < toMinutes(s.close)) {
				return { isOpen: true, status: "open", closesAt: s.close };
			}
		}
	}

	const status = closedToday ? "closed_holiday" : "closed";

	// Find the next opening.
	for (let offset = 0; offset <= MAX_LOOKAHEAD_DAYS; offset++) {
		const date = addDaysYMD(today, offset);
		if (closedDates.has(date)) continue;
		for (const s of slotsFor(openingHours, dowFromYMD(date))) {
			if (offset === 0 && toMinutes(s.open) <= minutes) continue; // already passed
			return { isOpen: false, status, opensAt: { date, time: s.open } };
		}
	}

	return { isOpen: false, status };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/lib/holidays/open-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/holidays/open-status.ts apps/api/tests/lib/holidays/open-status.test.ts
git commit -m "feat(api): compute store open-now status (Europe/Rome)"
```

### Task 5: Domain module barrel

**Files:**
- Create: `apps/api/src/lib/holidays/index.ts`

- [ ] **Step 1: Write the barrel**

```ts
// apps/api/src/lib/holidays/index.ts
export { computeEaster } from "./easter";
export {
	addDaysYMD,
	dowFromYMD,
	expandRange,
	makeYMD,
	ymdToYear,
} from "./dates";
export { resolveOccurrences, resolveStoreClosedDates } from "./resolve";
export { getOpenStatus } from "./open-status";
export type {
	CustomClosure,
	HolidayDef,
	HolidayType,
	OpeningHoursDay,
	OpenStatus,
} from "./types";
```

- [ ] **Step 2: Verify the whole domain suite passes**

Run: `bun test tests/lib/holidays`
Expected: PASS (all four files).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/holidays/index.ts
git commit -m "feat(api): export holidays domain module barrel"
```

### Task 6: Drizzle schema — holiday_definitions, store_holiday_optouts, stores.closures

**Files:**
- Create: `apps/api/src/db/schemas/holiday-definition.ts`
- Create: `apps/api/src/db/schemas/store-holiday-optout.ts`
- Modify: `apps/api/src/db/schemas/store.ts` (add `closures` column + relation)
- Modify: `apps/api/src/db/schemas/index.ts` (barrel exports)

- [ ] **Step 1: Create `holiday-definition.ts`**

```ts
// apps/api/src/db/schemas/holiday-definition.ts
import { relations, sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { storeHolidayOptout } from "./store-holiday-optout";

export const holidayDefinition = pgTable(
	"holiday_definitions",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: text("name").notNull(),
		type: text("type", {
			enum: ["fixed", "easter_relative", "one_off"] as const,
		}).notNull(),
		month: integer("month"),
		day: integer("day"),
		easterOffsetDays: integer("easter_offset_days"),
		oneOffDate: date("one_off_date"),
		isActive: boolean("is_active").notNull().default(true),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		createdByUserId: text("created_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(t) => [
		check(
			"holiday_definition_shape_valid",
			sql`(
				(${t.type} = 'fixed' AND ${t.month} IS NOT NULL AND ${t.day} IS NOT NULL AND ${t.easterOffsetDays} IS NULL AND ${t.oneOffDate} IS NULL) OR
				(${t.type} = 'easter_relative' AND ${t.easterOffsetDays} IS NOT NULL AND ${t.month} IS NULL AND ${t.day} IS NULL AND ${t.oneOffDate} IS NULL) OR
				(${t.type} = 'one_off' AND ${t.oneOffDate} IS NOT NULL AND ${t.month} IS NULL AND ${t.day} IS NULL AND ${t.easterOffsetDays} IS NULL)
			)`,
		),
		check(
			"holiday_definition_type_valid",
			sql`${t.type} IN ('fixed','easter_relative','one_off')`,
		),
		check(
			"holiday_definition_month_range",
			sql`${t.month} IS NULL OR (${t.month} BETWEEN 1 AND 12)`,
		),
		check(
			"holiday_definition_day_range",
			sql`${t.day} IS NULL OR (${t.day} BETWEEN 1 AND 31)`,
		),
		// Prevent duplicate definitions of the same shape.
		uniqueIndex("holiday_definition_unique_idx").on(
			t.type,
			t.month,
			t.day,
			t.easterOffsetDays,
			t.oneOffDate,
		),
	],
);

export const holidayDefinitionRelations = relations(
	holidayDefinition,
	({ many }) => ({
		optOuts: many(storeHolidayOptout),
	}),
);
```

- [ ] **Step 2: Create `store-holiday-optout.ts`**

```ts
// apps/api/src/db/schemas/store-holiday-optout.ts
import { relations } from "drizzle-orm";
import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { holidayDefinition } from "./holiday-definition";
import { store } from "./store";

export const storeHolidayOptout = pgTable(
	"store_holiday_optouts",
	{
		storeId: text("store_id")
			.notNull()
			.references(() => store.id, { onDelete: "cascade" }),
		holidayDefinitionId: text("holiday_definition_id")
			.notNull()
			.references(() => holidayDefinition.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.storeId, t.holidayDefinitionId] }),
		index("store_holiday_optout_definition_idx").on(t.holidayDefinitionId),
	],
);

export const storeHolidayOptoutRelations = relations(
	storeHolidayOptout,
	({ one }) => ({
		store: one(store, {
			fields: [storeHolidayOptout.storeId],
			references: [store.id],
		}),
		holidayDefinition: one(holidayDefinition, {
			fields: [storeHolidayOptout.holidayDefinitionId],
			references: [holidayDefinition.id],
		}),
	}),
);
```

- [ ] **Step 3: Add `closures` column + relation to `store.ts`**

In `apps/api/src/db/schemas/store.ts`, add the JSONB column to the `store` table definition immediately after the `openingHours` column (before `websiteUrl`):

```ts
		closures: jsonb("closures").$type<
			Array<{ startDate: string; endDate?: string; note?: string }>
		>(),
```

Then in `storeRelations` (the `relations(store, ({ one, many }) => ({ ... }))` block), add to the `many(...)` relations:

```ts
		holidayOptOuts: many(storeHolidayOptout),
```

And add the import at the top of `store.ts`:

```ts
import { storeHolidayOptout } from "./store-holiday-optout";
```

(`jsonb` is already imported in `store.ts`.)

- [ ] **Step 4: Add barrel exports**

In `apps/api/src/db/schemas/index.ts`, add (keep alphabetical-ish, matching the existing ordering):

```ts
export * from "./holiday-definition";
export * from "./store-holiday-optout";
```

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS (no type errors from the new schemas / circular imports).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schemas/holiday-definition.ts apps/api/src/db/schemas/store-holiday-optout.ts apps/api/src/db/schemas/store.ts apps/api/src/db/schemas/index.ts
git commit -m "feat(api): add holiday_definitions, store_holiday_optouts, stores.closures"
```

### Task 7: Generate & apply migration

**Files:**
- Create: migration SQL under `apps/api/drizzle/` (generated)

- [ ] **Step 1: Generate the migration**

Run: `bun run db:generate`
Expected: a new SQL file is created under the Drizzle migrations folder.

- [ ] **Step 2: Read the generated SQL**

Open the newly generated migration file and confirm it:
- creates `holiday_definitions` with the `type` text column, the four CHECK constraints, and the unique index;
- creates `store_holiday_optouts` with the composite PK, both FKs `ON DELETE CASCADE`, and the definition index;
- adds the `closures` jsonb column to `stores`.

Do NOT hand-edit unless a constraint is missing; if so, fix the schema file and re-run `db:generate`.

- [ ] **Step 3: Apply the migration**

Run: `bun run db:migrate`
Expected: migration applies cleanly (watch for the silent-exit-1 failure mode — if the spinner swallows output, see the project note on `__drizzle_migrations` desync).

- [ ] **Step 4: Commit**

```bash
git add apps/api/drizzle
git commit -m "feat(api): migration for holidays + store closures"
```

### Task 8: Seed the default Italian holiday set

**Files:**
- Create: `apps/api/src/db/seed/base/holidays.ts`
- Modify: `apps/api/src/db/seed/base/index.ts`

- [ ] **Step 1: Create the seed step**

```ts
// apps/api/src/db/seed/base/holidays.ts
import { count } from "drizzle-orm";
import { db } from "@/db";
import { holidayDefinition } from "@/db/schemas/holiday-definition";

type DefaultHoliday =
	| { name: string; type: "fixed"; month: number; day: number }
	| { name: string; type: "easter_relative"; easterOffsetDays: number };

const DEFAULT_HOLIDAYS: DefaultHoliday[] = [
	{ name: "Capodanno", type: "fixed", month: 1, day: 1 },
	{ name: "Epifania", type: "fixed", month: 1, day: 6 },
	{ name: "Pasqua", type: "easter_relative", easterOffsetDays: 0 },
	{ name: "Lunedì dell'Angelo", type: "easter_relative", easterOffsetDays: 1 },
	{ name: "Festa della Liberazione", type: "fixed", month: 4, day: 25 },
	{ name: "Festa del Lavoro", type: "fixed", month: 5, day: 1 },
	{ name: "Festa della Repubblica", type: "fixed", month: 6, day: 2 },
	{ name: "Ferragosto", type: "fixed", month: 8, day: 15 },
	{ name: "Tutti i Santi", type: "fixed", month: 11, day: 1 },
	{ name: "Immacolata Concezione", type: "fixed", month: 12, day: 8 },
	{ name: "Natale", type: "fixed", month: 12, day: 25 },
	{ name: "Santo Stefano", type: "fixed", month: 12, day: 26 },
];

export async function seedHolidayDefinitions() {
	const [{ total }] = await db
		.select({ total: count() })
		.from(holidayDefinition);
	if (total > 0) {
		console.log("  ⏭ Holiday definitions already seeded, skipping");
		return;
	}

	console.log("  📅 Seeding default Italian holidays...");
	await db.insert(holidayDefinition).values(
		DEFAULT_HOLIDAYS.map((h) => ({
			name: h.name,
			type: h.type,
			month: h.type === "fixed" ? h.month : null,
			day: h.type === "fixed" ? h.day : null,
			easterOffsetDays: h.type === "easter_relative" ? h.easterOffsetDays : null,
		})),
	);
	console.log(`     ✓ ${DEFAULT_HOLIDAYS.length} holiday definitions`);
}
```

- [ ] **Step 2: Wire into `seedBase`**

In `apps/api/src/db/seed/base/index.ts`, add the import and call (order is independent — append after categories):

```ts
import { seedProductCategories, seedStoreCategories } from "./categories";
import { seedHolidayDefinitions } from "./holidays";
import { seedLocations } from "./locations";

export async function seedBase() {
	await seedLocations();
	await seedStoreCategories();
	await seedProductCategories();
	await seedHolidayDefinitions();
}
```

- [ ] **Step 3: Run the seed and verify**

Run: `bun run db:seed`
Expected: log line `✓ 12 holiday definitions`. Re-running logs `⏭ ... skipping` (idempotent).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/seed/base/holidays.ts apps/api/src/db/seed/base/index.ts
git commit -m "feat(api): seed default Italian holiday definitions"
```

**Phase 1 gate:** `bun test tests/lib/holidays` green, migration applied, seed populated. The domain logic is fully covered without any DB dependency.

---

## Phase 2 — API: schemas, admin CRUD, seller closures, openStatus

Phase outcome: admins can CRUD holiday definitions; sellers can read/replace their store's opt-outs + custom closures; the seller store list returns a computed `openStatus`. Integration tests run against the testcontainer DB.

### Task 9: TypeBox schemas (`holidays.ts`) + barrel + openStatus on the store payload

**Files:**
- Create: `apps/api/src/lib/schemas/holidays.ts`
- Modify: `apps/api/src/lib/schemas/index.ts` (barrel)
- Modify: `apps/api/src/lib/schemas/composed.ts` (add `openStatus` to `StoreWithPhonesSchema`)

- [ ] **Step 1: Create `holidays.ts`** (elysia `t`, dates validated by pattern — no `format` registration needed)

```ts
// apps/api/src/lib/schemas/holidays.ts
import { t } from "elysia";

const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

const HolidayTypeSchema = t.Union(
	[t.Literal("fixed"), t.Literal("easter_relative"), t.Literal("one_off")],
	{ description: "Tipo di definizione festività" },
);

export const HolidayDefinitionSchema = t.Object({
	id: t.String(),
	name: t.String({ description: "Nome della festività" }),
	type: HolidayTypeSchema,
	month: t.Nullable(t.Integer({ description: "Mese (1-12), per tipo fixed" })),
	day: t.Nullable(t.Integer({ description: "Giorno (1-31), per tipo fixed" })),
	easterOffsetDays: t.Nullable(
		t.Integer({ description: "Offset dalla Pasqua, per easter_relative" }),
	),
	oneOffDate: t.Nullable(
		t.String({ description: "Data YYYY-MM-DD, per one_off" }),
	),
	isActive: t.Boolean({ description: "Se la festività è attiva" }),
	createdAt: t.Date(),
	updatedAt: t.Date(),
});

export const HolidayPreviewSchema = t.Object({
	definitionId: t.String(),
	name: t.String(),
	date: t.String({ description: "Data risolta YYYY-MM-DD" }),
});

export const CreateHolidayDefinitionBody = t.Union([
	t.Object({
		type: t.Literal("fixed"),
		name: t.String({ minLength: 1, maxLength: 100, description: "Nome festività" }),
		month: t.Integer({ minimum: 1, maximum: 12, description: "Mese (1-12)" }),
		day: t.Integer({ minimum: 1, maximum: 31, description: "Giorno (1-31)" }),
	}),
	t.Object({
		type: t.Literal("easter_relative"),
		name: t.String({ minLength: 1, maxLength: 100, description: "Nome festività" }),
		easterOffsetDays: t.Integer({
			minimum: -60,
			maximum: 60,
			description: "Offset dalla Pasqua (Pasqua=0, Pasquetta=1)",
		}),
	}),
	t.Object({
		type: t.Literal("one_off"),
		name: t.String({ minLength: 1, maxLength: 100, description: "Nome festività" }),
		oneOffDate: t.String({ pattern: DATE_PATTERN, description: "Data YYYY-MM-DD" }),
	}),
]);

export const UpdateHolidayDefinitionBody = t.Object({
	name: t.Optional(
		t.String({ minLength: 1, maxLength: 100, description: "Nuovo nome" }),
	),
	isActive: t.Optional(t.Boolean({ description: "Attiva/disattiva" })),
});

export const CustomClosureSchema = t.Object({
	startDate: t.String({ pattern: DATE_PATTERN, description: "Data inizio YYYY-MM-DD" }),
	endDate: t.Optional(
		t.String({ pattern: DATE_PATTERN, description: "Data fine (assente = giorno singolo)" }),
	),
	note: t.Optional(t.String({ maxLength: 200, description: "Nota (es. Ferie estive)" })),
});

export const OpenStatusSchema = t.Object({
	isOpen: t.Boolean(),
	status: t.Union([
		t.Literal("open"),
		t.Literal("closed"),
		t.Literal("closed_holiday"),
	]),
	closesAt: t.Optional(t.String({ description: "Orario chiusura odierno (HH:mm)" })),
	opensAt: t.Optional(t.Object({ date: t.String(), time: t.String() })),
});

export const SellerClosuresResponse = t.Object({
	holidays: t.Array(
		t.Object({
			definitionId: t.String(),
			name: t.String(),
			type: HolidayTypeSchema,
			nextDate: t.Nullable(t.String({ description: "Prossima occorrenza YYYY-MM-DD" })),
			observed: t.Boolean({ description: "Se il negozio osserva questa festività" }),
		}),
	),
	customClosures: t.Array(CustomClosureSchema),
});

export const PutClosuresBody = t.Object({
	optOutIds: t.Array(t.String(), {
		description: "ID festività NON osservate dal negozio",
	}),
	customClosures: t.Array(CustomClosureSchema, {
		description: "Chiusure custom del negozio",
	}),
});
```

- [ ] **Step 2: Barrel export**

In `apps/api/src/lib/schemas/index.ts`, add (after `export * from "./entities";`):

```ts
export * from "./holidays";
```

- [ ] **Step 3: Add `openStatus` to `StoreWithPhonesSchema`**

In `apps/api/src/lib/schemas/composed.ts`, add the import (alongside the existing `./entities` import) and the field:

```ts
import { OpenStatusSchema } from "./holidays";
```

```ts
export const StoreWithPhonesSchema = t.Object({
	...StoreSchema.properties,
	phoneNumbers: t.Array(StorePhoneNumberSchema),
	category: t.Nullable(StoreCategorySchema),
	images: t.Array(StoreImageSchema),
	openStatus: t.Optional(t.Nullable(OpenStatusSchema)),
});
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/schemas/holidays.ts apps/api/src/lib/schemas/index.ts apps/api/src/lib/schemas/composed.ts
git commit -m "feat(api): TypeBox schemas for holidays, closures, openStatus"
```

### Task 10: Admin holiday-definitions service + tests

**Files:**
- Create: `apps/api/src/modules/admin/services/holiday-definitions.ts`
- Test: `apps/api/tests/integration/admin-holiday-definitions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/tests/integration/admin-holiday-definitions.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { user } from "@/db/schemas/auth";
import { storeHolidayOptout } from "@/db/schemas/store-holiday-optout";
import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../helpers/test-db";

const { mock } = await import("bun:test");
mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

const {
	createHolidayDefinition,
	deleteHolidayDefinition,
	listHolidayDefinitions,
	previewHolidayYear,
	updateHolidayDefinition,
} = await import("@/modules/admin/services/holiday-definitions");
const { createTestSeller, createTestStore } = await import("../helpers/fixtures");
const { holidayDefinition } = await import("@/db/schemas/holiday-definition");
const { truncateAll } = await import("../helpers/cleanup");

async function seedAdmin(email: string): Promise<string> {
	const id = crypto.randomUUID();
	await getTestDb().insert(user).values({
		id,
		name: "Admin",
		email,
		emailVerified: true,
		role: "admin",
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	return id;
}

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

describe("admin holiday-definitions service", () => {
	it("creates a fixed holiday and lists it", async () => {
		const adminId = await seedAdmin("a1@test.com");
		const created = await createHolidayDefinition(
			{ type: "fixed", name: "Natale", month: 12, day: 25 },
			adminId,
		);
		expect(created.type).toBe("fixed");
		expect(created.month).toBe(12);
		expect(created.isActive).toBe(true);
		const all = await listHolidayDefinitions();
		expect(all).toHaveLength(1);
	});

	it("toggles isActive via update", async () => {
		const adminId = await seedAdmin("a2@test.com");
		const created = await createHolidayDefinition(
			{ type: "easter_relative", name: "Pasquetta", easterOffsetDays: 1 },
			adminId,
		);
		const updated = await updateHolidayDefinition({
			id: created.id,
			isActive: false,
		});
		expect(updated.isActive).toBe(false);
	});

	it("update on a missing id throws 404", async () => {
		await expect(
			updateHolidayDefinition({ id: "nope", name: "x" }),
		).rejects.toMatchObject({ status: 404 });
	});

	it("delete cascades to store opt-outs", async () => {
		const db = getTestDb();
		const adminId = await seedAdmin("a3@test.com");
		const { profile } = await createTestSeller(db);
		const store = await createTestStore(db, profile.id);
		const def = await createHolidayDefinition(
			{ type: "fixed", name: "Ferragosto", month: 8, day: 15 },
			adminId,
		);
		await db
			.insert(storeHolidayOptout)
			.values({ storeId: store.id, holidayDefinitionId: def.id });

		await deleteHolidayDefinition(def.id);

		const remaining = await db
			.select()
			.from(storeHolidayOptout)
			.where(eq(storeHolidayOptout.holidayDefinitionId, def.id));
		expect(remaining).toHaveLength(0);
	});

	it("preview resolves active defs to concrete dates for a year", async () => {
		const adminId = await seedAdmin("a4@test.com");
		await createHolidayDefinition(
			{ type: "easter_relative", name: "Pasquetta", easterOffsetDays: 1 },
			adminId,
		);
		await createHolidayDefinition(
			{ type: "fixed", name: "Natale", month: 12, day: 25 },
			adminId,
		);
		const preview = await previewHolidayYear(2026);
		const dates = preview.map((p) => p.date);
		expect(dates).toContain("2026-04-06"); // Pasquetta 2026
		expect(dates).toContain("2026-12-25");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/integration/admin-holiday-definitions.test.ts`
Expected: FAIL — service module not found.

- [ ] **Step 3: Write the service**

```ts
// apps/api/src/modules/admin/services/holiday-definitions.ts
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { holidayDefinition } from "@/db/schemas/holiday-definition";
import { ServiceError } from "@/lib/errors";
import { resolveOccurrences } from "@/lib/holidays";
import type { HolidayDef } from "@/lib/holidays";

export async function listHolidayDefinitions() {
	return db.query.holidayDefinition.findMany({
		orderBy: asc(holidayDefinition.name),
	});
}

type CreateHolidayInput =
	| { type: "fixed"; name: string; month: number; day: number }
	| { type: "easter_relative"; name: string; easterOffsetDays: number }
	| { type: "one_off"; name: string; oneOffDate: string };

export async function createHolidayDefinition(
	input: CreateHolidayInput,
	createdByUserId: string,
) {
	const [created] = await db
		.insert(holidayDefinition)
		.values({
			name: input.name,
			type: input.type,
			month: input.type === "fixed" ? input.month : null,
			day: input.type === "fixed" ? input.day : null,
			easterOffsetDays:
				input.type === "easter_relative" ? input.easterOffsetDays : null,
			oneOffDate: input.type === "one_off" ? input.oneOffDate : null,
			createdByUserId,
		})
		.returning();
	return created;
}

export async function updateHolidayDefinition(params: {
	id: string;
	name?: string;
	isActive?: boolean;
}) {
	const { id, name, isActive } = params;
	const data: { name?: string; isActive?: boolean } = {};
	if (name !== undefined) data.name = name;
	if (isActive !== undefined) data.isActive = isActive;

	if (Object.keys(data).length === 0) {
		const existing = await db.query.holidayDefinition.findFirst({
			where: eq(holidayDefinition.id, id),
		});
		if (!existing) throw new ServiceError(404, "Holiday definition not found");
		return existing;
	}

	const [updated] = await db
		.update(holidayDefinition)
		.set(data)
		.where(eq(holidayDefinition.id, id))
		.returning();
	if (!updated) throw new ServiceError(404, "Holiday definition not found");
	return updated;
}

export async function deleteHolidayDefinition(id: string) {
	const [deleted] = await db
		.delete(holidayDefinition)
		.where(eq(holidayDefinition.id, id))
		.returning();
	if (!deleted) throw new ServiceError(404, "Holiday definition not found");
	return deleted;
}

export async function previewHolidayYear(year: number) {
	const defs = await db.query.holidayDefinition.findMany({
		where: eq(holidayDefinition.isActive, true),
	});
	const items = defs.flatMap((d) =>
		resolveOccurrences(d as HolidayDef, year, year).map((date) => ({
			definitionId: d.id,
			name: d.name,
			date,
		})),
	);
	items.sort((a, b) => a.date.localeCompare(b.date));
	return items;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/integration/admin-holiday-definitions.test.ts`
Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin/services/holiday-definitions.ts apps/api/tests/integration/admin-holiday-definitions.test.ts
git commit -m "feat(api): admin holiday-definitions service + tests"
```

### Task 11: Admin holiday-definitions routes + registration

**Files:**
- Create: `apps/api/src/modules/admin/routes/holiday-definitions.ts`
- Modify: `apps/api/src/modules/admin/index.ts`

- [ ] **Step 1: Write the routes**

```ts
// apps/api/src/modules/admin/routes/holiday-definitions.ts
import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok, okMessage } from "@/lib/responses";
import {
	CreateHolidayDefinitionBody,
	HolidayDefinitionSchema,
	HolidayPreviewSchema,
	OkMessage,
	okRes,
	UpdateHolidayDefinitionBody,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { withAdmin } from "../context";
import {
	createHolidayDefinition,
	deleteHolidayDefinition,
	listHolidayDefinitions,
	previewHolidayYear,
	updateHolidayDefinition,
} from "../services/holiday-definitions";

export const holidayDefinitionsRoutes = new Elysia()
	.get(
		"/holiday-definitions",
		async () => {
			const data = await listHolidayDefinitions();
			return ok(data);
		},
		{
			response: withErrors({ 200: okRes(t.Array(HolidayDefinitionSchema)) }),
			detail: {
				summary: "Lista festività",
				description:
					"Restituisce tutte le definizioni di festività (attive e disattivate).",
				tags: ["Admin"],
			},
		},
	)
	.get(
		"/holiday-definitions/preview",
		async (ctx) => {
			const { query } = withAdmin(ctx);
			const data = await previewHolidayYear(query.year);
			return ok(data);
		},
		{
			query: t.Object({
				year: t.Integer({
					minimum: 2000,
					maximum: 2100,
					description: "Anno da risolvere",
				}),
			}),
			response: withErrors({ 200: okRes(t.Array(HolidayPreviewSchema)) }),
			detail: {
				summary: "Anteprima festività per anno",
				description:
					"Risolve le festività attive a date concrete per l'anno indicato (verifica della Pasqua).",
				tags: ["Admin"],
			},
		},
	)
	.post(
		"/holiday-definitions",
		async (ctx) => {
			const { body, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const data = await createHolidayDefinition(body, user.id);
			pino.info(
				{
					adminId: user.id,
					holidayId: data.id,
					holidayName: data.name,
					action: "holiday_definition_created",
				},
				"Festività creata",
			);
			return ok(data);
		},
		{
			body: CreateHolidayDefinitionBody,
			response: withConflictErrors({ 200: okRes(HolidayDefinitionSchema) }),
			detail: {
				summary: "Crea festività",
				description:
					"Crea una definizione di festività (fissa, relativa alla Pasqua, o data singola).",
				tags: ["Admin"],
			},
		},
	)
	.patch(
		"/holiday-definitions/:holidayId",
		async (ctx) => {
			const { params, body, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const data = await updateHolidayDefinition({
				id: params.holidayId,
				...body,
			});
			pino.info(
				{
					adminId: user.id,
					holidayId: data.id,
					action: "holiday_definition_updated",
				},
				"Festività aggiornata",
			);
			return ok(data);
		},
		{
			params: t.Object({
				holidayId: t.String({ description: "ID della festività" }),
			}),
			body: UpdateHolidayDefinitionBody,
			response: withConflictErrors({ 200: okRes(HolidayDefinitionSchema) }),
			detail: {
				summary: "Aggiorna festività",
				description: "Rinomina o attiva/disattiva una festività esistente.",
				tags: ["Admin"],
			},
		},
	)
	.delete(
		"/holiday-definitions/:holidayId",
		async (ctx) => {
			const { params, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const deleted = await deleteHolidayDefinition(params.holidayId);
			pino.info(
				{
					adminId: user.id,
					holidayId: deleted.id,
					holidayName: deleted.name,
					action: "holiday_definition_deleted",
				},
				"Festività eliminata",
			);
			return okMessage("Holiday definition deleted");
		},
		{
			params: t.Object({
				holidayId: t.String({ description: "ID della festività" }),
			}),
			response: withConflictErrors({ 200: OkMessage }),
			detail: {
				summary: "Elimina festività",
				description:
					"Elimina una definizione di festività. Gli opt-out collegati dei negozi vengono rimossi automaticamente.",
				tags: ["Admin"],
			},
		},
	);
```

- [ ] **Step 2: Register in the admin module**

In `apps/api/src/modules/admin/index.ts`, add the import and mount it inside the guard chain:

```ts
import { holidayDefinitionsRoutes } from "./routes/holiday-definitions";
```

Add `.use(holidayDefinitionsRoutes)` to the `.use(...)` chain (e.g. after `.use(storeCategoriesWriteRoutes)`).

- [ ] **Step 3: Typecheck + full test run**

Run: `bun run typecheck && bun test tests/integration/admin-holiday-definitions.test.ts`
Expected: PASS. Confirm the routes appear in the OpenAPI spec by starting the API (`bun run dev:api`) and checking `/openapi` for `/admin/holiday-definitions` (optional manual check).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/admin/routes/holiday-definitions.ts apps/api/src/modules/admin/index.ts
git commit -m "feat(api): admin holiday-definitions routes"
```

### Task 12: Seller closures service + tests

**Files:**
- Create: `apps/api/src/modules/seller/services/closures.ts`
- Test: `apps/api/tests/integration/seller-closures.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/tests/integration/seller-closures.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
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

const { getStoreClosures, putStoreClosures } = await import(
	"@/modules/seller/services/closures"
);
const { holidayDefinition } = await import("@/db/schemas/holiday-definition");
const { createTestSeller, createTestStore } = await import("../helpers/fixtures");
const { truncateAll } = await import("../helpers/cleanup");

async function seedDef(name: string, month: number, day: number): Promise<string> {
	const [d] = await getTestDb()
		.insert(holidayDefinition)
		.values({ name, type: "fixed", month, day })
		.returning({ id: holidayDefinition.id });
	return d.id;
}

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

describe("seller closures service", () => {
	it("observes all active holidays by default", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const store = await createTestStore(db, profile.id);
		await seedDef("Natale", 12, 25);

		const res = await getStoreClosures(store.id, profile.id);
		expect(res.holidays).toHaveLength(1);
		expect(res.holidays[0].observed).toBe(true);
		expect(res.customClosures).toEqual([]);
	});

	it("PUT replaces opt-outs and custom closures (wholesale)", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const store = await createTestStore(db, profile.id);
		const natale = await seedDef("Natale", 12, 25);

		const res = await putStoreClosures({
			storeId: store.id,
			sellerProfileId: profile.id,
			optOutIds: [natale],
			customClosures: [{ startDate: "2026-08-10", endDate: "2026-08-20", note: "Ferie" }],
		});

		expect(res.holidays[0].observed).toBe(false);
		expect(res.customClosures).toHaveLength(1);
		expect(res.customClosures[0].note).toBe("Ferie");

		// Re-PUT with empty sets clears everything.
		const cleared = await putStoreClosures({
			storeId: store.id,
			sellerProfileId: profile.id,
			optOutIds: [],
			customClosures: [],
		});
		expect(cleared.holidays[0].observed).toBe(true);
		expect(cleared.customClosures).toEqual([]);
	});

	it("rejects an invalid range with 400", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const store = await createTestStore(db, profile.id);
		await expect(
			putStoreClosures({
				storeId: store.id,
				sellerProfileId: profile.id,
				optOutIds: [],
				customClosures: [{ startDate: "2026-08-20", endDate: "2026-08-10" }],
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("rejects unknown optOut ids with 400", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const store = await createTestStore(db, profile.id);
		await expect(
			putStoreClosures({
				storeId: store.id,
				sellerProfileId: profile.id,
				optOutIds: ["does-not-exist"],
				customClosures: [],
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("404 when the store belongs to another seller", async () => {
		const db = getTestDb();
		const a = await createTestSeller(db);
		const b = await createTestSeller(db, { email: "b@test.com" });
		const storeB = await createTestStore(db, b.profile.id);
		await expect(
			getStoreClosures(storeB.id, a.profile.id),
		).rejects.toMatchObject({ status: 404 });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/integration/seller-closures.test.ts`
Expected: FAIL — service module not found.

- [ ] **Step 3: Write the service**

```ts
// apps/api/src/modules/seller/services/closures.ts
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { holidayDefinition } from "@/db/schemas/holiday-definition";
import { store as storeTable } from "@/db/schemas/store";
import { storeHolidayOptout } from "@/db/schemas/store-holiday-optout";
import { ServiceError } from "@/lib/errors";
import { resolveOccurrences } from "@/lib/holidays";
import type { CustomClosure, HolidayDef } from "@/lib/holidays";

async function loadOwnedStore(storeId: string, sellerProfileId: string) {
	const s = await db.query.store.findFirst({
		where: and(
			eq(storeTable.id, storeId),
			eq(storeTable.sellerProfileId, sellerProfileId),
			isNull(storeTable.deletedAt),
		),
	});
	if (!s) throw new ServiceError(404, "Store not found");
	return s;
}

/** First occurrence today-or-later (Europe/Rome), looking up to 3 years out. */
function nextOccurrence(def: HolidayDef): string | null {
	const today = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Europe/Rome",
	}).format(new Date());
	const year = Number(today.slice(0, 4));
	const dates = resolveOccurrences(def, year, year + 2)
		.filter((d) => d >= today)
		.sort();
	return dates[0] ?? null;
}

async function buildClosuresState(storeRow: { id: string; closures: unknown }) {
	const [defs, optOuts] = await Promise.all([
		db.query.holidayDefinition.findMany({
			where: eq(holidayDefinition.isActive, true),
		}),
		db
			.select({ id: storeHolidayOptout.holidayDefinitionId })
			.from(storeHolidayOptout)
			.where(eq(storeHolidayOptout.storeId, storeRow.id)),
	]);
	const optedOut = new Set(optOuts.map((o) => o.id));

	const holidays = defs
		.map((d) => ({
			definitionId: d.id,
			name: d.name,
			type: d.type,
			nextDate: nextOccurrence(d as HolidayDef),
			observed: !optedOut.has(d.id),
		}))
		.sort((a, b) =>
			(a.nextDate ?? "9999-99-99").localeCompare(b.nextDate ?? "9999-99-99"),
		);

	return {
		holidays,
		customClosures: ((storeRow.closures as CustomClosure[] | null) ?? []),
	};
}

export async function getStoreClosures(storeId: string, sellerProfileId: string) {
	const storeRow = await loadOwnedStore(storeId, sellerProfileId);
	return buildClosuresState(storeRow);
}

export async function putStoreClosures(params: {
	storeId: string;
	sellerProfileId: string;
	optOutIds: string[];
	customClosures: CustomClosure[];
}) {
	const { storeId, sellerProfileId, optOutIds, customClosures } = params;
	await loadOwnedStore(storeId, sellerProfileId);

	for (const c of customClosures) {
		if (c.endDate && c.endDate < c.startDate) {
			throw new ServiceError(
				400,
				"Intervallo chiusura non valido: la data di fine precede l'inizio",
			);
		}
	}

	const uniqueOptOuts = [...new Set(optOutIds)];
	if (uniqueOptOuts.length > 0) {
		const existing = await db
			.select({ id: holidayDefinition.id })
			.from(holidayDefinition)
			.where(inArray(holidayDefinition.id, uniqueOptOuts));
		if (existing.length !== uniqueOptOuts.length) {
			throw new ServiceError(400, "Uno o più ID festività non sono validi");
		}
	}

	await db.transaction(async (tx) => {
		await tx
			.delete(storeHolidayOptout)
			.where(eq(storeHolidayOptout.storeId, storeId));
		if (uniqueOptOuts.length > 0) {
			await tx.insert(storeHolidayOptout).values(
				uniqueOptOuts.map((holidayDefinitionId) => ({
					storeId,
					holidayDefinitionId,
				})),
			);
		}
		await tx
			.update(storeTable)
			.set({ closures: customClosures.length > 0 ? customClosures : null })
			.where(eq(storeTable.id, storeId));
	});

	return getStoreClosures(storeId, sellerProfileId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/integration/seller-closures.test.ts`
Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/seller/services/closures.ts apps/api/tests/integration/seller-closures.test.ts
git commit -m "feat(api): seller closures service (get/put) + tests"
```

### Task 13: Seller closures routes + registration + owner-guard test

**Files:**
- Create: `apps/api/src/modules/seller/routes/closures.ts`
- Modify: `apps/api/src/modules/seller/index.ts`
- Test: `apps/api/tests/modules/seller-closures-owner-only.test.ts`

- [ ] **Step 1: Write the routes**

```ts
// apps/api/src/modules/seller/routes/closures.ts
import { Elysia, t } from "elysia";
import { ok } from "@/lib/responses";
import {
	okRes,
	PutClosuresBody,
	SellerClosuresResponse,
	withErrors,
} from "@/lib/schemas";
import { requireOwner, withSeller } from "../context";
import { getStoreClosures, putStoreClosures } from "../services/closures";

export const closuresRoutes = new Elysia()
	.get(
		"/stores/:storeId/closures",
		async (ctx) => {
			const { sellerProfile: sp, isOwner, params } = withSeller(ctx);
			requireOwner(isOwner);
			const data = await getStoreClosures(params.storeId, sp.id);
			return ok(data);
		},
		{
			params: t.Object({ storeId: t.String({ description: "ID del negozio" }) }),
			response: withErrors({ 200: okRes(SellerClosuresResponse) }),
			detail: {
				summary: "Chiusure negozio",
				description:
					"Festività osservate (con flag observed) e chiusure custom del negozio.",
				tags: ["Seller - Stores"],
			},
		},
	)
	.put(
		"/stores/:storeId/closures",
		async (ctx) => {
			const { sellerProfile: sp, isOwner, params, body } = withSeller(ctx);
			requireOwner(isOwner);
			const data = await putStoreClosures({
				storeId: params.storeId,
				sellerProfileId: sp.id,
				...body,
			});
			return ok(data);
		},
		{
			params: t.Object({ storeId: t.String({ description: "ID del negozio" }) }),
			body: PutClosuresBody,
			response: withErrors({ 200: okRes(SellerClosuresResponse) }),
			detail: {
				summary: "Aggiorna chiusure negozio",
				description:
					"Sostituisce per intero gli opt-out festività e le chiusure custom del negozio.",
				tags: ["Seller - Stores"],
			},
		},
	);
```

- [ ] **Step 2: Register in the seller module**

In `apps/api/src/modules/seller/index.ts`, add the import and mount it in **Guard 2** (the VAT-verified chain, alongside `.use(storesRoutes)`):

```ts
import { closuresRoutes } from "./routes/closures";
```

Add `.use(closuresRoutes)` to the second guard's `.use(...)` chain.

- [ ] **Step 3: Write the owner-guard test**

```ts
// apps/api/tests/modules/seller-closures-owner-only.test.ts
import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { closuresRoutes } from "@/modules/seller/routes/closures";
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
	.use(closuresRoutes);

async function call(method: string, path: string, body?: unknown) {
	return app.handle(
		new Request(`http://localhost${path}`, {
			method,
			...(body
				? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
				: {}),
		}),
	);
}

describe("seller closures routes are owner-only", () => {
	it("GET /stores/:id/closures → 403 for a non-owner", async () => {
		const res = await call("GET", "/stores/some-id/closures");
		expect(res.status).toBe(403);
	});

	it("PUT /stores/:id/closures → 403 for a non-owner", async () => {
		const res = await call("PUT", "/stores/some-id/closures", {
			optOutIds: [],
			customClosures: [],
		});
		expect(res.status).toBe(403);
	});
});
```

- [ ] **Step 4: Run test + typecheck**

Run: `bun run typecheck && bun test tests/modules/seller-closures-owner-only.test.ts`
Expected: PASS (2 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/seller/routes/closures.ts apps/api/src/modules/seller/index.ts apps/api/tests/modules/seller-closures-owner-only.test.ts
git commit -m "feat(api): seller closures routes (owner-only)"
```

### Task 14: Enrich the seller store list with `openStatus`

**Files:**
- Modify: `apps/api/src/modules/seller/services/stores.ts` (`listStores`)
- Test: `apps/api/tests/integration/seller-store-open-status.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/tests/integration/seller-store-open-status.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";
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

const { listStores } = await import("@/modules/seller/services/stores");
const { store: storeTable } = await import("@/db/schemas/store");
const { createTestSeller, createTestStore } = await import("../helpers/fixtures");
const { truncateAll } = await import("../helpers/cleanup");

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

describe("listStores openStatus", () => {
	it("includes an openStatus object for each store", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const store = await createTestStore(db, profile.id);
		// Open every day 00:00-23:59 so the store is unambiguously open now.
		await db
			.update(storeTable)
			.set({
				openingHours: Array.from({ length: 7 }, (_, i) => ({
					dayOfWeek: i,
					slots: [{ open: "00:00", close: "23:59" }],
				})),
			})
			.where(eq(storeTable.id, store.id));

		const result = await listStores({ sellerProfileId: profile.id });
		expect(result.data).toHaveLength(1);
		expect(result.data[0].openStatus?.isOpen).toBe(true);
		expect(result.data[0].openStatus?.status).toBe("open");
	});

	it("openStatus.status is closed when openingHours is null", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await createTestStore(db, profile.id); // no openingHours set
		const result = await listStores({ sellerProfileId: profile.id });
		expect(result.data[0].openStatus?.isOpen).toBe(false);
		expect(result.data[0].openStatus?.status).toBe("closed");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/integration/seller-store-open-status.test.ts`
Expected: FAIL — `openStatus` is `undefined` on the returned rows.

- [ ] **Step 3: Add the enrichment to `listStores`**

In `apps/api/src/modules/seller/services/stores.ts`, add imports near the top (with the other `@/db/schemas` and `@/lib` imports):

```ts
import { holidayDefinition } from "@/db/schemas/holiday-definition";
import { storeHolidayOptout } from "@/db/schemas/store-holiday-optout";
import {
	addDaysYMD,
	getOpenStatus,
	resolveStoreClosedDates,
} from "@/lib/holidays";
import type { CustomClosure, HolidayDef } from "@/lib/holidays";
```

Then, in `listStores`, replace the final `return { data, pagination: { page, limit, total } };` with the enriched version (`data` is already mapped with the flattened municipality and carries `openingHours` + `closures` through `...rest`):

```ts
	const now = new Date();
	const today = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Europe/Rome",
	}).format(now);
	const windowEnd = addDaysYMD(today, 60);
	const storeIds = data.map((s) => s.id);

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

	const dataWithStatus = data.map((s) => {
		const closedDates = resolveStoreClosedDates(
			{
				activeDefs: activeDefs as HolidayDef[],
				optOutIds: optOutsByStore.get(s.id) ?? [],
				customClosures: (s.closures as CustomClosure[] | null) ?? [],
			},
			{ from: today, to: windowEnd },
		);
		return {
			...s,
			openStatus: getOpenStatus({
				openingHours: s.openingHours ?? null,
				closedDates,
				now,
			}),
		};
	});

	return { data: dataWithStatus, pagination: { page, limit, total } };
```

> Note: `createStore`/`updateStore` keep returning the store WITHOUT `openStatus` — the field is `t.Optional` on the schema, so omitting it is valid. Only the list path computes it.

- [ ] **Step 4: Run test + full API suite**

Run: `bun test tests/integration/seller-store-open-status.test.ts`
Expected: PASS.

Then the full suite: `bun run typecheck && bun run test`
Expected: PASS (all existing tests still green; the store-list response now carries `openStatus`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/seller/services/stores.ts apps/api/tests/integration/seller-store-open-status.test.ts
git commit -m "feat(api): enrich seller store list with openStatus"
```

**Phase 2 gate:** `bun run typecheck && bun run test` green. The API now exposes admin holiday CRUD, the seller closures GET/PUT, and `openStatus` on the store list — Eden Treaty types regenerate so all three frontends see the new shapes.

---

## Phase 3 — Admin UI: "Festività" tab in `/configurations`

Phase outcome: an admin can list/create/rename/activate-deactivate/delete holiday definitions and preview a year's resolved dates, via a new tab modelled on the existing `product-categories` panel. Verify in the browser at `localhost:3003/configurations?tab=holidays` (`bun run dev:admin`). Admin copy is hardcoded Italian, consistent with existing admin panels.

### Task 15: Holiday form + Zod schema

**Files:**
- Create: `apps/admin/src/features/holidays/schemas/holiday.ts`
- Create: `apps/admin/src/features/holidays/components/holiday-form.tsx`

The create form uses a flat string-field schema with a `superRefine` (avoids RHF discriminated-union friction); the panel converts it to the typed API body. Edit is name-only (PATCH supports name + isActive; active is toggled from the table row).

- [ ] **Step 1: Create the Zod schema**

```ts
// apps/admin/src/features/holidays/schemas/holiday.ts
import { z } from "zod";

export const holidayFormSchema = z
	.object({
		type: z.enum(["fixed", "easter_relative", "one_off"]),
		name: z.string().min(1, "Il nome è obbligatorio"),
		month: z.string().optional(),
		day: z.string().optional(),
		easterOffsetDays: z.string().optional(),
		oneOffDate: z.string().optional(),
	})
	.superRefine((v, ctx) => {
		if (v.type === "fixed") {
			const m = Number(v.month);
			const d = Number(v.day);
			if (!v.month || m < 1 || m > 12)
				ctx.addIssue({ code: "custom", path: ["month"], message: "Mese non valido" });
			if (!v.day || d < 1 || d > 31)
				ctx.addIssue({ code: "custom", path: ["day"], message: "Giorno non valido" });
		} else if (v.type === "easter_relative") {
			if (v.easterOffsetDays === undefined || v.easterOffsetDays === "")
				ctx.addIssue({
					code: "custom",
					path: ["easterOffsetDays"],
					message: "Offset obbligatorio",
				});
		} else if (v.type === "one_off") {
			if (!v.oneOffDate || !/^\d{4}-\d{2}-\d{2}$/.test(v.oneOffDate))
				ctx.addIssue({
					code: "custom",
					path: ["oneOffDate"],
					message: "Data obbligatoria",
				});
		}
	});

export type HolidayFormData = z.infer<typeof holidayFormSchema>;

export const MONTHS = [
	"Gennaio",
	"Febbraio",
	"Marzo",
	"Aprile",
	"Maggio",
	"Giugno",
	"Luglio",
	"Agosto",
	"Settembre",
	"Ottobre",
	"Novembre",
	"Dicembre",
] as const;
```

- [ ] **Step 2: Create the form component**

```tsx
// apps/admin/src/features/holidays/components/holiday-form.tsx
import { Button } from "@bibs/ui/components/button";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@bibs/ui/components/native-select";
import { zodResolver } from "@hookform/resolvers/zod";
import { type SubmitHandler, useForm } from "react-hook-form";
import {
	type HolidayFormData,
	holidayFormSchema,
	MONTHS,
} from "@/features/holidays/schemas/holiday";

interface HolidayFormProps {
	onSubmit: (data: HolidayFormData) => void;
	onCancel: () => void;
	isPending: boolean;
}

export function HolidayForm({ onSubmit, onCancel, isPending }: HolidayFormProps) {
	const {
		register,
		handleSubmit,
		watch,
		formState: { errors },
	} = useForm<HolidayFormData>({
		resolver: zodResolver(holidayFormSchema),
		defaultValues: {
			type: "fixed",
			name: "",
			month: "",
			day: "",
			easterOffsetDays: "0",
			oneOffDate: "",
		},
	});

	const type = watch("type");
	const onFormSubmit: SubmitHandler<HolidayFormData> = (data) => onSubmit(data);

	return (
		<form onSubmit={handleSubmit(onFormSubmit)}>
			<div className="space-y-4 py-4">
				<Field data-invalid={!!errors.name}>
					<FieldLabel htmlFor="holiday-name">Nome</FieldLabel>
					<Input id="holiday-name" placeholder="Es. Natale" {...register("name")} />
					<FieldError errors={[errors.name]} />
				</Field>

				<Field>
					<FieldLabel htmlFor="holiday-type">Tipo</FieldLabel>
					<NativeSelect id="holiday-type" className="w-full" {...register("type")}>
						<NativeSelectOption value="fixed">Data fissa (giorno/mese)</NativeSelectOption>
						<NativeSelectOption value="easter_relative">
							Relativa alla Pasqua
						</NativeSelectOption>
						<NativeSelectOption value="one_off">Data singola</NativeSelectOption>
					</NativeSelect>
				</Field>

				{type === "fixed" && (
					<div className="grid grid-cols-2 gap-4">
						<Field data-invalid={!!errors.month}>
							<FieldLabel htmlFor="holiday-month">Mese</FieldLabel>
							<NativeSelect id="holiday-month" className="w-full" {...register("month")}>
								<NativeSelectOption value="">Seleziona mese...</NativeSelectOption>
								{MONTHS.map((label, i) => (
									<NativeSelectOption key={label} value={String(i + 1)}>
										{label}
									</NativeSelectOption>
								))}
							</NativeSelect>
							<FieldError errors={[errors.month]} />
						</Field>
						<Field data-invalid={!!errors.day}>
							<FieldLabel htmlFor="holiday-day">Giorno</FieldLabel>
							<Input
								id="holiday-day"
								type="number"
								min={1}
								max={31}
								placeholder="1-31"
								{...register("day")}
							/>
							<FieldError errors={[errors.day]} />
						</Field>
					</div>
				)}

				{type === "easter_relative" && (
					<Field data-invalid={!!errors.easterOffsetDays}>
						<FieldLabel htmlFor="holiday-offset">Festività pasquale</FieldLabel>
						<NativeSelect
							id="holiday-offset"
							className="w-full"
							{...register("easterOffsetDays")}
						>
							<NativeSelectOption value="0">Domenica di Pasqua</NativeSelectOption>
							<NativeSelectOption value="1">Lunedì dell'Angelo (Pasquetta)</NativeSelectOption>
						</NativeSelect>
						<FieldError errors={[errors.easterOffsetDays]} />
					</Field>
				)}

				{type === "one_off" && (
					<Field data-invalid={!!errors.oneOffDate}>
						<FieldLabel htmlFor="holiday-date">Data</FieldLabel>
						<Input id="holiday-date" type="date" {...register("oneOffDate")} />
						<FieldError errors={[errors.oneOffDate]} />
					</Field>
				)}
			</div>

			<div className="flex justify-end gap-3">
				<Button type="button" variant="outline" onClick={onCancel}>
					Annulla
				</Button>
				<Button type="submit" disabled={isPending}>
					{isPending ? "Creazione..." : "Crea"}
				</Button>
			</div>
		</form>
	);
}
```

- [ ] **Step 3: Typecheck**

Run (from repo root): `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/features/holidays/schemas/holiday.ts apps/admin/src/features/holidays/components/holiday-form.tsx
git commit -m "feat(admin): holiday create form + schema"
```

### Task 16: Holidays panel

**Files:**
- Create: `apps/admin/src/features/holidays/components/holidays-panel.tsx`

The list is small (no pagination/search). Active is toggled from the row; rename via an edit dialog (name only); a year selector previews resolved dates.

- [ ] **Step 1: Create the panel**

```tsx
// apps/admin/src/features/holidays/components/holidays-panel.tsx
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@bibs/ui/components/alert-dialog";
import { Button } from "@bibs/ui/components/button";
import { DataTable } from "@bibs/ui/components/data-table";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@bibs/ui/components/dialog";
import { Field, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@bibs/ui/components/native-select";
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarDaysIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { HolidayForm } from "@/features/holidays/components/holiday-form";
import { MONTHS } from "@/features/holidays/schemas/holiday";
import { api } from "@/lib/api";

interface HolidayDefinition {
	id: string;
	name: string;
	type: "fixed" | "easter_relative" | "one_off";
	month: number | null;
	day: number | null;
	easterOffsetDays: number | null;
	oneOffDate: string | null;
	isActive: boolean;
	createdAt: Date | string;
	updatedAt: Date | string;
}

interface HolidaysPanelProps {
	createOpen: boolean;
	onCreateOpenChange: (open: boolean) => void;
}

/** Human-readable "quando" for a holiday definition. */
function describeHoliday(h: HolidayDefinition): string {
	if (h.type === "fixed" && h.month && h.day) {
		return `${h.day} ${MONTHS[h.month - 1].toLowerCase()}`;
	}
	if (h.type === "easter_relative") {
		if (h.easterOffsetDays === 0) return "Domenica di Pasqua";
		if (h.easterOffsetDays === 1) return "Lunedì dell'Angelo";
		return `Pasqua ${h.easterOffsetDays! > 0 ? "+" : ""}${h.easterOffsetDays} giorni`;
	}
	if (h.type === "one_off" && h.oneOffDate) {
		return new Date(h.oneOffDate).toLocaleDateString("it-IT", {
			day: "numeric",
			month: "short",
			year: "numeric",
		});
	}
	return "—";
}

const YEARS = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() + i);

export function HolidaysPanel({ createOpen, onCreateOpenChange }: HolidaysPanelProps) {
	"use no memo";

	const queryClient = useQueryClient();
	const [editOpen, setEditOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [selected, setSelected] = useState<HolidayDefinition | null>(null);
	const [editName, setEditName] = useState("");
	const [previewYear, setPreviewYear] = useState(YEARS[0]);

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: ["holiday-definitions"] });
	};

	const { data, isLoading, error } = useQuery({
		queryKey: ["holiday-definitions"],
		queryFn: async () => {
			const response = await api().admin["holiday-definitions"].get();
			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore nel caricamento festività",
				);
			}
			return response.data;
		},
	});

	const { data: previewData } = useQuery({
		queryKey: ["holiday-definitions", "preview", previewYear],
		queryFn: async () => {
			const response = await api().admin["holiday-definitions"].preview.get({
				query: { year: previewYear },
			});
			if (response.error) return null;
			return response.data?.data ?? null;
		},
	});

	const createMutation = useMutation({
		mutationFn: async (
			input:
				| { type: "fixed"; name: string; month: number; day: number }
				| { type: "easter_relative"; name: string; easterOffsetDays: number }
				| { type: "one_off"; name: string; oneOffDate: string },
		) => {
			const response = await api().admin["holiday-definitions"].post(input);
			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore durante la creazione",
				);
			}
			return response.data;
		},
		onSuccess: () => {
			invalidate();
			onCreateOpenChange(false);
			toast.success("Festività creata con successo");
		},
		onError: (e: Error) => toast.error(e.message || "Errore durante la creazione"),
	});

	const updateMutation = useMutation({
		mutationFn: async (input: { id: string; name?: string; isActive?: boolean }) => {
			const { id, ...patch } = input;
			const response = await api()
				.admin["holiday-definitions"]({ holidayId: id })
				.patch(patch);
			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore durante l'aggiornamento",
				);
			}
			return response.data;
		},
		onSuccess: () => {
			invalidate();
			setEditOpen(false);
			setSelected(null);
			toast.success("Festività aggiornata con successo");
		},
		onError: (e: Error) =>
			toast.error(e.message || "Errore durante l'aggiornamento"),
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			const response = await api()
				.admin["holiday-definitions"]({ holidayId: id })
				.delete();
			if (response.error) {
				throw new Error(
					response.error.value?.message || "Errore durante l'eliminazione",
				);
			}
			return response.data;
		},
		onSuccess: () => {
			invalidate();
			setDeleteOpen(false);
			setSelected(null);
			toast.success("Festività eliminata con successo");
		},
		onError: (e: Error) =>
			toast.error(e.message || "Errore durante l'eliminazione"),
	});

	const rows = useMemo<HolidayDefinition[]>(
		() => (data?.data as HolidayDefinition[]) ?? [],
		[data],
	);

	const columns = useMemo<ColumnDef<HolidayDefinition>[]>(
		() => [
			{
				id: "name",
				header: "Nome",
				enableHiding: false,
				meta: { headerClassName: "w-[30%] pl-4", cellClassName: "pl-6 font-semibold" },
				cell: ({ row }) => row.original.name,
			},
			{
				id: "when",
				header: "Quando",
				meta: { headerClassName: "w-[30%]", cellClassName: "text-muted-foreground" },
				cell: ({ row }) => describeHoliday(row.original),
			},
			{
				id: "status",
				header: "Stato",
				meta: { headerClassName: "w-[20%]" },
				cell: ({ row }) => (
					<span
						className={
							row.original.isActive
								? "text-emerald-600 text-sm font-medium"
								: "text-muted-foreground text-sm"
						}
					>
						{row.original.isActive ? "Attiva" : "Disattivata"}
					</span>
				),
			},
			{
				id: "actions",
				enableHiding: false,
				meta: { headerClassName: "w-[20%] pr-6 text-right", cellClassName: "pr-6 text-right" },
				header: "",
				cell: ({ row }) => (
					<div className="flex items-center justify-end gap-1">
						<Button
							variant="ghost"
							size="sm"
							onClick={() =>
								updateMutation.mutate({
									id: row.original.id,
									isActive: !row.original.isActive,
								})
							}
						>
							{row.original.isActive ? "Disattiva" : "Attiva"}
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Rinomina festività"
							onClick={() => {
								setSelected(row.original);
								setEditName(row.original.name);
								setEditOpen(true);
							}}
						>
							<PencilIcon className="size-4" />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Elimina festività"
							onClick={() => {
								setSelected(row.original);
								setDeleteOpen(true);
							}}
						>
							<Trash2Icon className="size-4" />
						</Button>
					</div>
				),
			},
		],
		[],
	);

	return (
		<div className="space-y-4">
			{error && (
				<div className="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-4">
					<p className="text-sm">Errore nel caricamento: {(error as Error).message}</p>
				</div>
			)}

			<DataTable
				data={rows}
				columns={columns}
				storageKey="admin.holidays.columns"
				getRowId={(row) => row.id}
				isLoading={isLoading}
				emptyState={
					<div className="flex flex-col items-center gap-2">
						<CalendarDaysIcon className="text-muted-foreground/40 size-8" />
						<div>
							<p className="text-muted-foreground font-medium">Nessuna festività</p>
							<p className="text-muted-foreground/60 text-sm">
								Crea la prima festività per iniziare
							</p>
						</div>
					</div>
				}
			/>

			<div className="rounded-lg border p-4 space-y-3">
				<div className="flex items-center gap-3">
					<span className="text-sm font-medium">Anteprima date risolte per anno</span>
					<NativeSelect
						className="w-32"
						value={String(previewYear)}
						onChange={(e) => setPreviewYear(Number(e.target.value))}
						aria-label="Anno anteprima"
					>
						{YEARS.map((y) => (
							<NativeSelectOption key={y} value={String(y)}>
								{y}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</div>
				<ul className="grid grid-cols-2 gap-x-6 gap-y-1 md:grid-cols-3">
					{(previewData ?? []).map((p) => (
						<li key={`${p.definitionId}-${p.date}`} className="text-sm text-muted-foreground">
							<span className="font-mono">{p.date}</span> — {p.name}
						</li>
					))}
				</ul>
			</div>

			<Dialog open={createOpen} onOpenChange={onCreateOpenChange}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Nuova Festività</DialogTitle>
						<DialogDescription>
							Definisci una festività fissa, relativa alla Pasqua o una data singola.
						</DialogDescription>
					</DialogHeader>
					<HolidayForm
						isPending={createMutation.isPending}
						onCancel={() => onCreateOpenChange(false)}
						onSubmit={(formData) => {
							if (formData.type === "fixed") {
								createMutation.mutate({
									type: "fixed",
									name: formData.name,
									month: Number(formData.month),
									day: Number(formData.day),
								});
							} else if (formData.type === "easter_relative") {
								createMutation.mutate({
									type: "easter_relative",
									name: formData.name,
									easterOffsetDays: Number(formData.easterOffsetDays),
								});
							} else {
								createMutation.mutate({
									type: "one_off",
									name: formData.name,
									oneOffDate: formData.oneOffDate as string,
								});
							}
						}}
					/>
				</DialogContent>
			</Dialog>

			<Dialog open={editOpen} onOpenChange={setEditOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Rinomina Festività</DialogTitle>
						<DialogDescription>Modifica il nome della festività.</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<Field>
							<FieldLabel htmlFor="edit-holiday-name">Nome</FieldLabel>
							<Input
								id="edit-holiday-name"
								value={editName}
								onChange={(e) => setEditName(e.target.value)}
							/>
						</Field>
					</div>
					<div className="flex justify-end gap-3">
						<Button variant="outline" onClick={() => setEditOpen(false)}>
							Annulla
						</Button>
						<Button
							disabled={updateMutation.isPending || editName.trim().length === 0}
							onClick={() => {
								if (selected)
									updateMutation.mutate({ id: selected.id, name: editName.trim() });
							}}
						>
							{updateMutation.isPending ? "Salvataggio..." : "Salva"}
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Conferma eliminazione</AlertDialogTitle>
						<AlertDialogDescription>
							Sei sicuro di voler eliminare "{selected?.name}"? Gli opt-out dei negozi
							collegati verranno rimossi. Questa azione non può essere annullata.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel
							onClick={() => {
								setDeleteOpen(false);
								setSelected(null);
							}}
						>
							Annulla
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={deleteMutation.isPending}
							onClick={() => {
								if (selected) deleteMutation.mutate(selected.id);
							}}
						>
							{deleteMutation.isPending ? "Eliminazione..." : "Elimina"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS. (If the Eden Treaty path access `api().admin["holiday-definitions"].preview.get` errors, confirm Phase 2 routes are committed so `@bibs/api` types include them.)

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/features/holidays/components/holidays-panel.tsx
git commit -m "feat(admin): holidays management panel"
```

### Task 17: Wire the "Festività" tab into `/configurations`

**Files:**
- Modify: `apps/admin/src/routes/_authenticated/configurations.tsx`

- [ ] **Step 1: Add the import**

```tsx
import { HolidaysPanel } from "@/features/holidays/components/holidays-panel";
```

- [ ] **Step 2: Add the tab to the `tabs` array** (after the `store-categories` entry; `count: null` — no counts endpoint needed)

```tsx
		{
			value: "holidays",
			label: "Festività",
			count: null,
		},
```

- [ ] **Step 3: Make the shared create button label tab-aware**

Replace the button inside `<TabNav>`:

```tsx
			<TabNav tabs={tabs} activeTab={tab} onTabChange={handleTabChange}>
				<Button onClick={() => setCreateOpen(true)}>
					<PlusIcon />
					<span>{tab === "holidays" ? "Nuova Festività" : "Nuova Categoria"}</span>
				</Button>
			</TabNav>
```

- [ ] **Step 4: Add the render guard** (after the `store-categories` block)

```tsx
			{tab === "holidays" && (
				<HolidaysPanel createOpen={createOpen} onCreateOpenChange={setCreateOpen} />
			)}
```

- [ ] **Step 5: Typecheck + browser verification**

Run: `bun run typecheck`
Then start the admin app: `bun run dev:admin` and open `http://localhost:3003/configurations?tab=holidays`. Verify: the list renders the 12 seeded holidays, "Quando" shows readable text (e.g. "25 dicembre", "Lunedì dell'Angelo"), the year preview lists resolved dates (Pasquetta correct), create/rename/toggle/delete all work and toast.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/routes/_authenticated/configurations.tsx
git commit -m "feat(admin): add Festività tab to configurations"
```

**Phase 3 gate:** `bun run typecheck` green; admin holiday management works end-to-end in the browser against the seeded data.

---

## Phase 4 — Seller UI: `/store/closures` page + dashboard status

Phase outcome: a seller can open a dedicated closures page, toggle which Italian holidays their store observes, add/remove custom full-day closures (single dates or ranges), and save; the dashboard surfaces the store's real open/closed status. Verify at `localhost:3002` (`bun run dev:seller`). All copy via Paraglide.

### Task 18: i18n message keys

**Files:**
- Modify: `apps/seller/messages/it.json`
- Modify: `apps/seller/messages/en.json`

Keys are flat dotted strings (matching the existing `store.*` block). Insert into the top-level object of each file (mind trailing commas).

- [ ] **Step 1: Add to `apps/seller/messages/it.json`**

```json
	"store.closures.link": "Giorni di chiusura",
	"store.closures.title": "Giorni di chiusura",
	"store.closures.subtitle": "Festività osservate e chiusure straordinarie del negozio.",
	"store.closures.holidays_title": "Festività",
	"store.closures.holidays_hint": "Di default il negozio è chiuso nelle festività italiane. Imposta «Aperto» quelle in cui resti aperto.",
	"store.closures.closed": "Chiuso",
	"store.closures.open": "Aperto",
	"store.closures.no_next": "—",
	"store.closures.custom_title": "Le tue chiusure",
	"store.closures.custom_hint": "Aggiungi singole date o periodi (es. ferie estive). Sempre a giornata intera.",
	"store.closures.add": "Aggiungi chiusura",
	"store.closures.start": "Dal",
	"store.closures.end": "Al (opzionale)",
	"store.closures.note_ph": "Nota (es. Ferie estive)",
	"store.closures.remove": "Rimuovi",
	"store.closures.empty_custom": "Nessuna chiusura straordinaria.",
	"store.closures.save": "Salva",
	"store.closures.saving": "Salvataggio…",
	"store.closures.saved": "Chiusure aggiornate",
	"store.closures.error": "Errore nel salvataggio delle chiusure",
	"store.closures.no_store": "Nessun negozio selezionato."
```

- [ ] **Step 2: Add the same keys to `apps/seller/messages/en.json`**

```json
	"store.closures.link": "Closure days",
	"store.closures.title": "Closure days",
	"store.closures.subtitle": "Holidays the store observes and one-off closures.",
	"store.closures.holidays_title": "Holidays",
	"store.closures.holidays_hint": "By default the store is closed on Italian holidays. Set the ones you stay open for to “Open”.",
	"store.closures.closed": "Closed",
	"store.closures.open": "Open",
	"store.closures.no_next": "—",
	"store.closures.custom_title": "Your closures",
	"store.closures.custom_hint": "Add single dates or ranges (e.g. summer break). Always full-day.",
	"store.closures.add": "Add closure",
	"store.closures.start": "From",
	"store.closures.end": "To (optional)",
	"store.closures.note_ph": "Note (e.g. Summer break)",
	"store.closures.remove": "Remove",
	"store.closures.empty_custom": "No one-off closures.",
	"store.closures.save": "Save",
	"store.closures.saving": "Saving…",
	"store.closures.saved": "Closures updated",
	"store.closures.error": "Failed to save closures",
	"store.closures.no_store": "No store selected."
```

- [ ] **Step 3: Verify Paraglide compiles**

Run: `bun run typecheck` (Paraglide message access is type-checked via the generated `m` accessor). If the seller app has a separate Paraglide compile step in its dev/build, it runs on `bun run dev:seller`; the keys appear as `m["store.closures.*"]()`.

- [ ] **Step 4: Commit**

```bash
git add apps/seller/messages/it.json apps/seller/messages/en.json
git commit -m "feat(seller): i18n strings for closures page"
```

### Task 19: Closures manager component

**Files:**
- Create: `apps/seller/src/features/stores/components/closures-manager.tsx`

Holds local opt-out + custom-closure state, dirty-tracked via a canonical serialize (same idea as `store-form`'s `serializeOpeningHours`).

- [ ] **Step 1: Create the component**

```tsx
// apps/seller/src/features/stores/components/closures-manager.tsx
import { Button } from "@bibs/ui/components/button";
import { Input } from "@bibs/ui/components/input";
import { Separator } from "@bibs/ui/components/separator";
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

interface CustomClosure {
	startDate: string;
	endDate?: string;
	note?: string;
}

interface HolidayRow {
	definitionId: string;
	name: string;
	type: "fixed" | "easter_relative" | "one_off";
	nextDate: string | null;
	observed: boolean;
}

export interface ClosuresState {
	holidays: HolidayRow[];
	customClosures: CustomClosure[];
}

function serialize(optOutIds: string[], custom: CustomClosure[]): string {
	return JSON.stringify({
		opt: [...optOutIds].sort(),
		custom: [...custom]
			.map((c) => ({ s: c.startDate, e: c.endDate ?? null, n: c.note ?? "" }))
			.sort((a, b) => a.s.localeCompare(b.s)),
	});
}

function formatDate(ymd: string): string {
	return new Date(ymd).toLocaleDateString("it-IT", {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

export function ClosuresManager({
	storeId,
	initial,
}: {
	storeId: string;
	initial: ClosuresState;
}) {
	const queryClient = useQueryClient();

	const [optOutIds, setOptOutIds] = useState<string[]>(() =>
		initial.holidays.filter((h) => !h.observed).map((h) => h.definitionId),
	);
	const [customClosures, setCustomClosures] = useState<CustomClosure[]>(
		() => initial.customClosures,
	);

	const initialSerialized = useMemo(
		() =>
			serialize(
				initial.holidays.filter((h) => !h.observed).map((h) => h.definitionId),
				initial.customClosures,
			),
		[initial],
	);
	const dirty = serialize(optOutIds, customClosures) !== initialSerialized;

	const toggleObserved = (id: string) =>
		setOptOutIds((prev) =>
			prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
		);

	const updateClosure = (
		index: number,
		patch: Partial<CustomClosure>,
	) =>
		setCustomClosures((prev) =>
			prev.map((c, i) => (i === index ? { ...c, ...patch } : c)),
		);

	const addClosure = () => {
		const today = new Intl.DateTimeFormat("en-CA", {
			timeZone: "Europe/Rome",
		}).format(new Date());
		setCustomClosures((prev) => [...prev, { startDate: today }]);
	};

	const removeClosure = (index: number) =>
		setCustomClosures((prev) => prev.filter((_, i) => i !== index));

	const mutation = useMutation({
		mutationFn: async () => {
			// Drop blank custom rows and empty end/note fields before sending.
			const cleaned = customClosures
				.filter((c) => c.startDate)
				.map((c) => ({
					startDate: c.startDate,
					endDate: c.endDate || undefined,
					note: c.note?.trim() ? c.note.trim() : undefined,
				}));
			const response = await api()
				.seller.stores({ storeId })
				.closures.put({ optOutIds, customClosures: cleaned });
			if (response.error) {
				throw new Error(response.error.value?.message || m["store.closures.error"]());
			}
			return response.data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["store-closures", storeId] });
			void queryClient.invalidateQueries({ queryKey: ["stores"] });
			toast.success(m["store.closures.saved"]());
		},
		onError: (e: Error) => toast.error(e.message || m["store.closures.error"]()),
	});

	return (
		<div className="space-y-10">
			<section className="space-y-4">
				<header className="space-y-1.5">
					<h2 className="font-display text-base font-semibold tracking-tight">
						{m["store.closures.holidays_title"]()}
					</h2>
					<p className="text-sm leading-relaxed text-muted-foreground">
						{m["store.closures.holidays_hint"]()}
					</p>
				</header>
				<div className="overflow-hidden rounded-lg border border-border">
					<table className="w-full text-sm">
						<tbody className="divide-y divide-border">
							{initial.holidays.map((h) => {
								const observed = !optOutIds.includes(h.definitionId);
								return (
									<tr key={h.definitionId} className="bg-card">
										<td className="px-4 py-3 font-medium">{h.name}</td>
										<td className="px-4 py-3 text-muted-foreground">
											{h.nextDate ? formatDate(h.nextDate) : m["store.closures.no_next"]()}
										</td>
										<td className="px-4 py-3 text-right">
											<Button
												type="button"
												variant={observed ? "secondary" : "outline"}
												size="sm"
												onClick={() => toggleObserved(h.definitionId)}
											>
												{observed
													? m["store.closures.closed"]()
													: m["store.closures.open"]()}
											</Button>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</section>

			<Separator />

			<section className="space-y-4">
				<header className="space-y-1.5">
					<h2 className="font-display text-base font-semibold tracking-tight">
						{m["store.closures.custom_title"]()}
					</h2>
					<p className="text-sm leading-relaxed text-muted-foreground">
						{m["store.closures.custom_hint"]()}
					</p>
				</header>

				{customClosures.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{m["store.closures.empty_custom"]()}
					</p>
				) : (
					<div className="space-y-3">
						{customClosures.map((c, i) => (
							<div
								key={`${i}-${c.startDate}`}
								className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3"
							>
								<label className="flex flex-col gap-1">
									<span className="text-xs text-muted-foreground">
										{m["store.closures.start"]()}
									</span>
									<Input
										type="date"
										value={c.startDate}
										onChange={(e) => updateClosure(i, { startDate: e.target.value })}
									/>
								</label>
								<label className="flex flex-col gap-1">
									<span className="text-xs text-muted-foreground">
										{m["store.closures.end"]()}
									</span>
									<Input
										type="date"
										value={c.endDate ?? ""}
										min={c.startDate}
										onChange={(e) =>
											updateClosure(i, { endDate: e.target.value || undefined })
										}
									/>
								</label>
								<Input
									className="min-w-[12rem] flex-1"
									placeholder={m["store.closures.note_ph"]()}
									value={c.note ?? ""}
									onChange={(e) => updateClosure(i, { note: e.target.value })}
								/>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label={m["store.closures.remove"]()}
									onClick={() => removeClosure(i)}
								>
									<Trash2Icon className="size-4" />
								</Button>
							</div>
						))}
					</div>
				)}

				<Button type="button" variant="outline" onClick={addClosure}>
					<PlusIcon />
					<span>{m["store.closures.add"]()}</span>
				</Button>
			</section>

			<Separator />

			<div className="flex justify-end">
				<Button
					disabled={mutation.isPending || !dirty}
					onClick={() => mutation.mutate()}
				>
					{mutation.isPending
						? m["store.closures.saving"]()
						: m["store.closures.save"]()}
				</Button>
			</div>
		</div>
	);
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS. (The Eden path `api().seller.stores({ storeId }).closures.put(...)` resolves from the Phase 2 routes.)

- [ ] **Step 3: Commit**

```bash
git add apps/seller/src/features/stores/components/closures-manager.tsx
git commit -m "feat(seller): closures manager component"
```

### Task 20: Closures route + link from store settings

**Files:**
- Create: `apps/seller/src/routes/_authenticated/store/closures.tsx`
- Modify: `apps/seller/src/routes/_authenticated/store/index.tsx` (add a link to the closures page)

- [ ] **Step 1: Create the route**

```tsx
// apps/seller/src/routes/_authenticated/store/closures.tsx
import { Spinner } from "@bibs/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	ClosuresManager,
	type ClosuresState,
} from "@/features/stores/components/closures-manager";
import { useActiveStore } from "@/hooks/use-active-store";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/store/closures")({
	component: ClosuresPage,
});

function ClosuresPage() {
	const { activeStore } = useActiveStore();
	const storeId = activeStore?.id;

	const { data, isLoading, error } = useQuery({
		queryKey: ["store-closures", storeId],
		queryFn: async (): Promise<ClosuresState> => {
			if (!storeId) throw new Error("No active store");
			const response = await api().seller.stores({ storeId }).closures.get();
			if (response.error) {
				throw new Error(
					response.error.value?.message || m["store.closures.error"](),
				);
			}
			return response.data.data as ClosuresState;
		},
		enabled: !!storeId,
	});

	return (
		<div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8">
			<header className="space-y-1.5">
				<h1 className="font-display text-2xl font-semibold tracking-tight">
					{m["store.closures.title"]()}
				</h1>
				<p className="text-muted-foreground">{m["store.closures.subtitle"]()}</p>
			</header>

			{!activeStore ? (
				<p className="text-muted-foreground">{m["store.closures.no_store"]()}</p>
			) : isLoading || !data ? (
				<div className="flex justify-center py-12">
					<Spinner />
				</div>
			) : error ? (
				<div className="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-4">
					<p className="text-sm">{(error as Error).message}</p>
				</div>
			) : (
				<ClosuresManager key={storeId} storeId={storeId as string} initial={data} />
			)}
		</div>
	);
}
```

- [ ] **Step 2: Add a link from the store settings page**

In `apps/seller/src/routes/_authenticated/store/index.tsx`, add the `Link` import (it imports from `@tanstack/react-router`; add `Link` to that import or add a new import line) and render a link near the opening-hours area. Add this import at the top:

```tsx
import { Link } from "@tanstack/react-router";
```

Then, inside the `StoreForm` mounting area (right after the `<StoreForm ... />` block, still within the owner-visible section), add a small navigational card:

```tsx
			<Link
				to="/store/closures"
				className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-foreground underline-offset-4 hover:underline"
			>
				{m["store.closures.link"]()} →
			</Link>
```

And add the Paraglide import to `store/index.tsx` if not already present:

```tsx
import { m } from "@/paraglide/messages";
```

> If `store/index.tsx` already imports `Link` or `m`, do not duplicate the import.

- [ ] **Step 3: Typecheck + browser verification**

Run: `bun run typecheck`
Then `bun run dev:seller`, open `http://localhost:3002/store`, click "Giorni di chiusura →" to reach `/store/closures`. Verify: the 12 holidays list with their next dates, toggling "Chiuso"/"Aperto" enables Save, adding a custom range works, Save persists (reload keeps state), and the Save button is disabled when there are no changes.

- [ ] **Step 4: Commit**

```bash
git add apps/seller/src/routes/_authenticated/store/closures.tsx apps/seller/src/routes/_authenticated/store/index.tsx
git commit -m "feat(seller): store closures page + link from settings"
```

### Task 21: Wire real open-status into the seller dashboard

**Files:**
- Modify: `apps/seller/src/routes/_authenticated/index.tsx`

Replace the hardcoded `id: "hours-holiday"` mock action with one computed from the active store's real `openStatus` (now on the store list payload). The other mock actions stay until their data sources exist.

- [ ] **Step 1: Remove the hardcoded hours mock from `ACTIONS`**

Delete the object literal with `id: "hours-holiday"` (title `"Domenica 25/05 — apertura non impostata"`) from the `ACTIONS` array. Keep the rest of the array.

- [ ] **Step 2: Add imports + a query + computed action, and pass actions into `ActionsList`**

At the top of the file, ensure these imports exist (add what's missing):

```tsx
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
```

Change the `ActionsList` component to accept the actions as a prop:

```tsx
function ActionsList({ actions }: { actions: ActionItem[] }) {
```

(Replace the internal references to the module-level `ACTIONS` with the `actions` prop — i.e. `actions.length` and `actions.map(...)`.)

In `Dashboard`, compute the open-status action and pass the composed list down. Add inside `Dashboard`, before the return:

```tsx
	const { activeStore } = useActiveStore();
	const { data: storeList } = useQuery({
		queryKey: ["stores"],
		queryFn: async () => {
			const res = await api().seller.stores.get({ query: { page: 1, limit: 100 } });
			if (res.error) return null;
			return res.data;
		},
	});
	const openStatus =
		storeList?.data.find((s) => s.id === activeStore?.id)?.openStatus ?? null;

	const hoursAction: ActionItem | null =
		openStatus && !openStatus.isOpen
			? {
					id: "hours-status",
					urgency: openStatus.status === "closed_holiday" ? "medium" : "low",
					title:
						openStatus.status === "closed_holiday"
							? "Oggi il negozio è chiuso"
							: "Negozio chiuso ora",
					subtitle:
						openStatus.status === "closed_holiday"
							? "Festività o chiusura programmata"
							: openStatus.opensAt
								? `Riapre il ${openStatus.opensAt.date} alle ${openStatus.opensAt.time}`
								: "Nessun orario impostato",
					href: "/store/closures",
					icon: Clock,
				}
			: null;

	const actions: ActionItem[] = hoursAction ? [...ACTIONS, hoursAction] : ACTIONS;
```

> `useActiveStore` is already imported in this file (the dashboard uses it). `Clock` is already imported (it was the icon of the removed mock). `ActionItem` is the existing type in the file.

Then render `<ActionsList actions={actions} />` (replace the prop-less `<ActionsList />`).

- [ ] **Step 3: Typecheck + browser verification**

Run: `bun run typecheck`
Then `bun run dev:seller`: on the dashboard, with a store whose hours/closures make it currently closed, the "Da gestire oggi" list shows a real status item linking to `/store/closures`; when the store is open, no hours item appears.

- [ ] **Step 4: Commit**

```bash
git add apps/seller/src/routes/_authenticated/index.tsx
git commit -m "feat(seller): dashboard shows real store open status"
```

**Phase 4 gate:** `bun run typecheck` green; the seller closures page and dashboard status work in the browser.

---

## Final verification (whole feature)

- [ ] Run the full API suite + typecheck + lint from repo root:

```bash
bun run typecheck && bun run lint && bun run test
```

Expected: all green. `test` covers the pure domain suite (`tests/lib/holidays`) + the new integration/module tests.

- [ ] Manual smoke (optional but recommended), per CLAUDE.md "verification before completion":
  - Admin (`:3003`): create a one-off holiday, see it in the year preview, deactivate it, delete it.
  - Seller (`:3002`): opt out of a holiday + add a summer-break range, save, reload (state persists); dashboard reflects status.

- [ ] Open a PR per the repo's PR-first workflow (branch `feat/store-closures-holidays`); squash-merge title must include the PR number `(#NN)`.

## Notes for the implementer

- **Live preview route (optional, per the team's UI preference):** for the seller closures layout, a temporary preview route with stacked variants beats ASCII mockups — build one under `apps/seller/src/routes/` only if the layout needs iteration, and remove it before the PR.
- **Single-table selection:** the holidays section is intentionally one table with per-row state (no split-pane / no "Library | Selected" layout).
- **`api()` is invoked** everywhere (`api().seller...`, `api().admin...`); never `api.`.
- **Toasts** import from `@bibs/ui/components/sonner` only.
- **Do not** add a maxItems cap on custom closures (product decision).
- **`dayOfWeek` 0=Mon..6=Sun** is the single source of off-by-one bugs here — the conversion lives only in `lib/holidays/dates.ts` / `open-status.ts`; never call `Date.getDay()` elsewhere.

