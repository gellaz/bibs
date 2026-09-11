import { describe, expect, it } from "bun:test";
import { formatWeeklyHours, romeDayOfWeek } from "./format-opening-hours";

const TEST_DAY_LABELS = [
	"Lun",
	"Mar",
	"Mer",
	"Gio",
	"Ven",
	"Sab",
	"Dom",
] as const;

describe("formatWeeklyHours", () => {
	it("returns 7 rows Lun→Dom, all closed when openingHours is null", () => {
		const rows = formatWeeklyHours(null, 0, TEST_DAY_LABELS);
		expect(rows).toHaveLength(7);
		expect(rows[0].label).toBe("Lun");
		expect(rows[6].label).toBe("Dom");
		expect(rows.every((r) => r.hours === null)).toBe(true);
	});

	it("joins multiple slots with ' · '", () => {
		const rows = formatWeeklyHours(
			[
				{
					dayOfWeek: 0,
					slots: [
						{ open: "09:00", close: "13:00" },
						{ open: "16:00", close: "19:00" },
					],
				},
			],
			3,
			TEST_DAY_LABELS,
		);
		expect(rows[0].hours).toBe("09:00–13:00 · 16:00–19:00");
	});

	it("also returns the slots unjoined, for layouts that stack them", () => {
		const rows = formatWeeklyHours(
			[
				{
					dayOfWeek: 0,
					slots: [
						{ open: "09:00", close: "13:00" },
						{ open: "16:00", close: "19:00" },
					],
				},
			],
			3,
			TEST_DAY_LABELS,
		);
		expect(rows[0].slots).toEqual(["09:00–13:00", "16:00–19:00"]);
		expect(rows[1].slots).toEqual([]);
	});

	it("marks days with no slots as closed (null hours)", () => {
		const rows = formatWeeklyHours(
			[{ dayOfWeek: 2, slots: [] }],
			0,
			TEST_DAY_LABELS,
		);
		expect(rows[2].hours).toBeNull();
	});

	it("flags only today", () => {
		const rows = formatWeeklyHours(null, 5, TEST_DAY_LABELS);
		expect(rows.filter((r) => r.isToday).map((r) => r.dayOfWeek)).toEqual([5]);
	});
});

describe("romeDayOfWeek", () => {
	it("maps a Monday to 0 and a Sunday to 6", () => {
		expect(romeDayOfWeek(new Date("2026-06-22T12:00:00Z"))).toBe(0); // Monday
		expect(romeDayOfWeek(new Date("2026-06-21T12:00:00Z"))).toBe(6); // Sunday
	});
});
