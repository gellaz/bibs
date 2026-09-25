import { describe, expect, it } from "bun:test";
import {
	formatPickupCode,
	isCompletePickupCode,
	normalizePickupCode,
} from "./pickup-code";

describe("normalizePickupCode", () => {
	it("maiuscolo, senza spazi e trattini", () => {
		expect(normalizePickupCode(" k7x-m4p ")).toBe("K7XM4P");
	});
});

describe("isCompletePickupCode", () => {
	it("6 caratteri dell'alfabeto", () => {
		expect(isCompletePickupCode("K7XM4P")).toBe(true);
	});
	it("troppo corto o con caratteri fuori alfabeto", () => {
		expect(isCompletePickupCode("K7X")).toBe(false);
		expect(isCompletePickupCode("K7XM40")).toBe(false);
	});
});

describe("formatPickupCode", () => {
	it("raggruppa 3-3", () => {
		expect(formatPickupCode("K7XM4P")).toBe("K7X M4P");
	});
});
