import { describe, expect, it } from "bun:test";
import { platformFeeCents } from "@/lib/platform-fee";

describe("platformFeeCents", () => {
	it("è il 5% del totale, arrotondato al centesimo", () => {
		expect(platformFeeCents(1000)).toBe(50);
		expect(platformFeeCents(1999)).toBe(100); // 99,95 → 100
		expect(platformFeeCents(1990)).toBe(100); // 99,5 → 100 (half-up)
		expect(platformFeeCents(1)).toBe(0);
	});

	it("zero su totale zero", () => {
		expect(platformFeeCents(0)).toBe(0);
	});
});
