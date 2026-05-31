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
