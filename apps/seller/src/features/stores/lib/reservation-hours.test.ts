import { describe, expect, it } from "vitest";
import { parseReservationHours } from "./reservation-hours";

describe("parseReservationHours", () => {
	it.each([
		["1", 1],
		["72", 72],
		[" 24 ", 24],
	])("accetta %j", (raw, expected) => {
		expect(parseReservationHours(raw)).toBe(expected);
	});

	it.each(["", "0", "73", "1.5", "abc"])("rifiuta %j", (raw) => {
		expect(parseReservationHours(raw)).toBeNull();
	});
});
