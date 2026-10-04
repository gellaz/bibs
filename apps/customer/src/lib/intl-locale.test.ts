import { formatPriceEur } from "@bibs/ui/custom/price";
import { formatDate } from "@bibs/ui/lib/date";
import {
	intlLocale,
	intlLocaleFor,
	setIntlLocaleResolver,
} from "@bibs/ui/lib/intl-locale";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => setIntlLocaleResolver(() => "it-IT"));

describe("intlLocaleFor", () => {
	it("maps en to en-GB and everything else to it-IT", () => {
		expect(intlLocaleFor("en")).toBe("en-GB");
		expect(intlLocaleFor("it")).toBe("it-IT");
		expect(intlLocaleFor("fr")).toBe("it-IT");
	});
});

describe("intlLocale", () => {
	it("reads the resolver on every call, never once at load", () => {
		let current = "it-IT";
		setIntlLocaleResolver(() => current);
		expect(intlLocale()).toBe("it-IT");
		current = "en-GB";
		expect(intlLocale()).toBe("en-GB");
	});
});

describe("formatPriceEur", () => {
	it("follows the locale and never reuses the other language's formatter", () => {
		setIntlLocaleResolver(() => "it-IT");
		expect(formatPriceEur(1234.5)).toBe("1234,50 €");
		setIntlLocaleResolver(() => "en-GB");
		expect(formatPriceEur("1234.5")).toBe("€1,234.50");
		setIntlLocaleResolver(() => "it-IT");
		expect(formatPriceEur(9.99)).toBe("9,99 €");
	});

	it("still renders a dash for non-finite values", () => {
		expect(formatPriceEur("abc")).toBe("—");
	});
});

describe("formatDate", () => {
	it("follows the locale", () => {
		setIntlLocaleResolver(() => "it-IT");
		expect(formatDate("2026-10-04T12:00:00Z", { long: true })).toBe(
			"4 ottobre 2026",
		);
		setIntlLocaleResolver(() => "en-GB");
		expect(formatDate("2026-10-04T12:00:00Z", { long: true })).toBe(
			"4 October 2026",
		);
	});
});
