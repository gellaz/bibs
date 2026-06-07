import { describe, expect, it } from "bun:test";
import { validateOpeningHours } from "@/lib/opening-hours";

describe("validateOpeningHours", () => {
	it("accepts a valid week (sorted and unsorted slots)", () => {
		expect(
			validateOpeningHours([
				{
					dayOfWeek: 0,
					slots: [
						{ open: "09:00", close: "13:00" },
						{ open: "14:30", close: "19:00" },
					],
				},
				{
					dayOfWeek: 5,
					slots: [
						{ open: "14:30", close: "19:00" },
						{ open: "09:00", close: "13:00" },
					],
				},
			]),
		).toBeNull();
	});

	it("accepts an empty array (all days closed)", () => {
		expect(validateOpeningHours([])).toBeNull();
	});

	it("accepts touching slots (close == next open)", () => {
		expect(
			validateOpeningHours([
				{
					dayOfWeek: 2,
					slots: [
						{ open: "09:00", close: "13:00" },
						{ open: "13:00", close: "19:00" },
					],
				},
			]),
		).toBeNull();
	});

	it("rejects an inverted slot (close <= open)", () => {
		expect(
			validateOpeningHours([
				{ dayOfWeek: 1, slots: [{ open: "19:00", close: "09:00" }] },
			]),
		).toContain("chiusura");
	});

	it("rejects a zero-length slot", () => {
		expect(
			validateOpeningHours([
				{ dayOfWeek: 1, slots: [{ open: "09:00", close: "09:00" }] },
			]),
		).toContain("chiusura");
	});

	it("rejects overlapping slots", () => {
		expect(
			validateOpeningHours([
				{
					dayOfWeek: 3,
					slots: [
						{ open: "09:00", close: "13:00" },
						{ open: "12:00", close: "18:00" },
					],
				},
			]),
		).toContain("sovrappongono");
	});

	it("rejects duplicate dayOfWeek entries", () => {
		expect(
			validateOpeningHours([
				{ dayOfWeek: 4, slots: [{ open: "09:00", close: "13:00" }] },
				{ dayOfWeek: 4, slots: [{ open: "15:00", close: "19:00" }] },
			]),
		).toContain("duplicato");
	});
});
