import { describe, expect, it } from "bun:test";
import {
	resolveOccurrences,
	resolveStoreClosedDates,
} from "@/lib/holidays/resolve";
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
		expect(resolveOccurrences(easter("p", 1), 2026, 2026)).toEqual([
			"2026-04-06",
		]);
		// Easter 2027 = 2027-03-28 → Pasquetta = 2027-03-29
		expect(resolveOccurrences(easter("p", 1), 2027, 2027)).toEqual([
			"2027-03-29",
		]);
	});

	it("one_off: only when within range", () => {
		expect(resolveOccurrences(oneOff("o", "2026-10-12"), 2026, 2026)).toEqual([
			"2026-10-12",
		]);
		expect(resolveOccurrences(oneOff("o", "2026-10-12"), 2027, 2028)).toEqual(
			[],
		);
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
