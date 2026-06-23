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
