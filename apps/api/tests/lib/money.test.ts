import { describe, expect, it } from "bun:test";
import { fromCents, toCents } from "@/lib/money";

describe("toCents", () => {
	it("converts a standard price", () => {
		expect(toCents("9.99")).toBe(999);
	});

	it("converts a whole number price", () => {
		expect(toCents("10.00")).toBe(1000);
	});

	it("converts zero", () => {
		expect(toCents("0.00")).toBe(0);
	});

	it("converts one cent", () => {
		expect(toCents("0.01")).toBe(1);
	});

	it("handles a single decimal digit", () => {
		expect(toCents("0.1")).toBe(10);
	});

	it("converts a large price", () => {
		expect(toCents("999.99")).toBe(99999);
	});

	it("converts without decimal part", () => {
		expect(toCents("5")).toBe(500);
	});

	it("truncates extra decimal digits (3rd digit ignored)", () => {
		// API schema enforces exactly 2 decimals; toCents silently truncates
		expect(toCents("9.999")).toBe(999);
		expect(toCents("0.019")).toBe(1);
	});
});

describe("fromCents", () => {
	it("converts a standard amount", () => {
		expect(fromCents(999)).toBe("9.99");
	});

	it("converts a whole number amount", () => {
		expect(fromCents(1000)).toBe("10.00");
	});

	it("converts zero", () => {
		expect(fromCents(0)).toBe("0.00");
	});

	it("converts one cent", () => {
		expect(fromCents(1)).toBe("0.01");
	});

	it("converts a negative amount", () => {
		expect(fromCents(-999)).toBe("-9.99");
	});

	it("pads single-digit cents", () => {
		expect(fromCents(101)).toBe("1.01");
	});

	it("converts a large amount", () => {
		expect(fromCents(99999)).toBe("999.99");
	});
});

describe("toCents / fromCents round-trip", () => {
	it.each(["0.00", "0.01", "1.00", "9.99", "100.00", "999.99"])(
		"round-trips %s",
		(price) => {
			expect(fromCents(toCents(price))).toBe(price);
		},
	);
});
