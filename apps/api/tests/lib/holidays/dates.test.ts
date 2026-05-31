import { describe, expect, it } from "bun:test";
import {
	addDaysYMD,
	dowFromYMD,
	expandRange,
	ymdToYear,
} from "@/lib/holidays/dates";

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
