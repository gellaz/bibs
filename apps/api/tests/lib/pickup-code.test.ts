import { describe, expect, it } from "bun:test";
import {
	generatePickupCode,
	normalizePickupCode,
	PICKUP_CODE_ALPHABET,
} from "@/lib/pickup-code";

describe("generatePickupCode", () => {
	it("6 caratteri dall'alfabeto senza ambigui", () => {
		for (let i = 0; i < 500; i++) {
			const code = generatePickupCode();
			expect(code).toHaveLength(6);
			for (const ch of code) expect(PICKUP_CODE_ALPHABET).toContain(ch);
		}
		expect(PICKUP_CODE_ALPHABET).not.toMatch(/[01ILO]/);
	});

	it("scarta i byte che introdurrebbero bias (rejection sampling)", () => {
		// 31 simboli: si accettano solo byte < 248 (8 × 31). 255 va scartato.
		const bytes = [255, 0, 255, 30, 1, 2, 3, 4];
		let i = 0;
		const random = (n: number) =>
			Uint8Array.from({ length: n }, () => bytes[i++ % bytes.length]);
		expect(generatePickupCode(random)).toBe("A9BCDE");
	});
});

describe("normalizePickupCode", () => {
	it("maiuscolo, senza spazi e trattini", () => {
		expect(normalizePickupCode(" k7x m4p ")).toBe("K7XM4P");
		expect(normalizePickupCode("K7X-M4P")).toBe("K7XM4P");
	});
});
