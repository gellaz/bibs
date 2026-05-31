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
		const s = getOpenStatus({
			openingHours: hours,
			closedDates: new Set(),
			now: romeSummer(10),
		});
		expect(s.isOpen).toBe(true);
		expect(s.status).toBe("open");
		expect(s.closesAt).toBe("13:00");
	});

	it("closed during lunch break → opensAt the afternoon slot", () => {
		const s = getOpenStatus({
			openingHours: hours,
			closedDates: new Set(),
			now: romeSummer(13, 30),
		});
		expect(s.isOpen).toBe(false);
		expect(s.status).toBe("closed");
		expect(s.opensAt).toEqual({ date: "2026-05-25", time: "14:30" });
	});

	it("before opening → opensAt today's first slot", () => {
		const s = getOpenStatus({
			openingHours: hours,
			closedDates: new Set(),
			now: romeSummer(8),
		});
		expect(s.opensAt).toEqual({ date: "2026-05-25", time: "09:00" });
	});

	it("after closing on Friday → opensAt Monday (weekend closed)", () => {
		// 2026-05-29 is a Friday; +2 days = Sunday closed, Monday 2026-06-01 opens.
		const friNight = new Date(Date.UTC(2026, 4, 29, 20 - 2));
		const s = getOpenStatus({
			openingHours: hours,
			closedDates: new Set(),
			now: friNight,
		});
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
		const s = getOpenStatus({
			openingHours: null,
			closedDates: new Set(),
			now: romeSummer(10),
		});
		expect(s).toEqual({ isOpen: false, status: "closed" });
	});
});
