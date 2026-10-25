import { afterAll, describe, expect, it } from "vitest";
import { toLocal } from "./discount-period-picker";

// La CI gira in UTC, dove ora locale e UTC coincidono e lo spostamento non si vede.
const originalTz = process.env.TZ;
process.env.TZ = "Europe/Rome";

afterAll(() => {
	process.env.TZ = originalTz;
});

describe("toLocal", () => {
	it("prefills the form with Italian wall-clock time, not UTC", () => {
		// 15/10 00:00 – 20/10 23:59 ora di Roma (CEST, UTC+2).
		expect(toLocal(new Date("2026-10-14T22:00:00.000Z"))).toBe(
			"2026-10-15T00:00",
		);
		expect(toLocal(new Date("2026-10-20T21:59:00.000Z"))).toBe(
			"2026-10-20T23:59",
		);
	});

	it("round-trips through the form without moving the instant", () => {
		const endsAt = "2026-10-20T21:59:00.000Z";
		// Il salvataggio rilegge la stringa del form come ora locale.
		expect(new Date(toLocal(new Date(endsAt))).toISOString()).toBe(endsAt);
	});
});
