import { describe, expect, it } from "bun:test";
import { formatPickupCode } from "./pickup-code";

describe("formatPickupCode", () => {
	it("raggruppa il codice 3-3 per leggerlo a voce", () => {
		expect(formatPickupCode("K7XM4P")).toBe("K7X M4P");
	});

	it("senza codice non mostra nulla", () => {
		expect(formatPickupCode(null)).toBe("");
	});
});
