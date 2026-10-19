import { describe, expect, it } from "bun:test";
import { addDaysYMD } from "@/lib/holidays";
import { reservationDeadline } from "@/lib/holidays/reservation-deadline";
import type { OpeningHoursDay } from "@/lib/holidays/types";

// Lun–sab 08:00–13:00 / 16:00–19:30 (dayOfWeek 0..5); domenica chiuso.
const hours: OpeningHoursDay[] = Array.from({ length: 6 }, (_, i) => ({
	dayOfWeek: i,
	slots: [
		{ open: "08:00", close: "13:00" },
		{ open: "16:00", close: "19:30" },
	],
}));

// Istante UTC dell'ora di Roma indicata; `offset` = +2 in estate, +1 in inverno.
const rome = (
	y: number,
	mo: number,
	d: number,
	h: number,
	mi: number,
	offset: number,
) => new Date(Date.UTC(y, mo - 1, d, h - offset, mi));

// Ottobre 2026 fino al 24 è ora legale (+2); dal 25 ora solare (+1).
const oct = (d: number, h: number, mi = 0) =>
	rome(2026, 10, d, h, mi, d < 25 ? 2 : 1);

const deadline = (
	from: Date,
	h: number,
	closedDates: Set<string> = new Set(),
	openingHours: OpeningHoursDay[] | null = hours,
) => reservationDeadline({ openingHours, closedDates, from, hours: h });

describe("reservationDeadline", () => {
	it("inside a slot", () => {
		const r = deadline(oct(17, 10), 2);
		expect(r.expiresAt.toISOString()).toBe(oct(17, 12).toISOString());
		expect(r.clock).toBe("opening");
	});

	it("between slots starts at the next slot", () => {
		const r = deadline(oct(17, 14), 1);
		expect(r.expiresAt.toISOString()).toBe(oct(17, 17).toISOString());
		expect(r.clock).toBe("opening");
	});

	it("one minute before closing", () => {
		// 1 minuto sabato, domenica chiuso, 59 minuti lunedì.
		const r = deadline(oct(17, 19, 29), 1);
		expect(r.expiresAt.toISOString()).toBe(oct(19, 8, 59).toISOString());
	});

	it("night skips closed sunday (spec example)", () => {
		// sab 1 h + lun 8,5 + mar 8,5 + mer 5 (mattina) + 1 → mer 17:00.
		const r = deadline(oct(17, 18, 30), 24);
		expect(r.expiresAt.toISOString()).toBe(oct(21, 17).toISOString());
		expect(r.clock).toBe("opening");
	});

	it("ends exactly at closing time", () => {
		const r = deadline(oct(19, 21), 5);
		expect(r.expiresAt.toISOString()).toBe(oct(20, 13).toISOString());
	});

	it("holiday date is skipped", () => {
		const r = deadline(oct(17, 18, 30), 2, new Set(["2026-10-19"]));
		expect(r.expiresAt.toISOString()).toBe(oct(20, 9).toISOString());
	});

	it("multi-day custom closure is skipped", () => {
		const r = deadline(
			oct(17, 18, 30),
			2,
			new Set(["2026-10-19", "2026-10-20"]),
		);
		expect(r.expiresAt.toISOString()).toBe(oct(21, 9).toISOString());
	});

	it("72 hours", () => {
		// lun 19 → mar 27 (dom 25 chiuso) = 8 giorni aperti × 8,5 h = 68 h;
		// le ultime 4 h mercoledì 28 dalle 08:00 → 12:00 (ora solare, UTC 11:00).
		const r = deadline(oct(19, 8), 72);
		expect(r.expiresAt.toISOString()).toBe("2026-10-28T11:00:00.000Z");
	});

	it("DST end (25 Oct 2026)", () => {
		// sab 24 19:00 (+2) → 30 min; dom 25 chiuso; lun 26 08:00 + 1:30 (+1).
		const r = deadline(oct(24, 19), 2);
		expect(r.expiresAt.toISOString()).toBe("2026-10-26T08:30:00.000Z");
	});

	it("DST start (28 Mar 2027)", () => {
		// sab 27 19:00 (+1) → 30 min; dom 28 chiuso; lun 29 08:00 + 1:30 (+2).
		const r = deadline(rome(2027, 3, 27, 19, 0, 1), 2);
		expect(r.expiresAt.toISOString()).toBe("2027-03-29T07:30:00.000Z");
	});

	it("no declared hours → calendar", () => {
		const from = oct(17, 18, 30);
		const r = deadline(from, 24, new Set(), null);
		expect(r.expiresAt.getTime()).toBe(from.getTime() + 24 * 3_600_000);
		expect(r.clock).toBe("calendar");
	});

	it("slots: [] everywhere → calendar", () => {
		const from = oct(17, 18, 30);
		const empty = hours.map((d) => ({ ...d, slots: [] }));
		const r = deadline(from, 24, new Set(), empty);
		expect(r.expiresAt.getTime()).toBe(from.getTime() + 24 * 3_600_000);
		expect(r.clock).toBe("calendar");
	});

	it("no opening within 60 days → calendar", () => {
		const from = oct(17, 18, 30);
		const closed = new Set(
			Array.from({ length: 62 }, (_, i) => addDaysYMD("2026-10-17", i)),
		);
		const r = deadline(from, 24, closed);
		expect(r.expiresAt.getTime()).toBe(from.getTime() + 24 * 3_600_000);
		expect(r.clock).toBe("calendar");
	});
});
