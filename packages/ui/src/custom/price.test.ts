import { afterEach, describe, expect, it } from "vitest";
import { setIntlLocaleResolver } from "~/lib/intl-locale";
import { formatPriceEur } from "./price";

afterEach(() => setIntlLocaleResolver(() => "it-IT"));

describe("formatPriceEur", () => {
	it("euro all'italiana: virgola decimale e simbolo dopo", () => {
		setIntlLocaleResolver(() => "it-IT");
		expect(formatPriceEur(29)).toBe("29,00 €");
		expect(formatPriceEur("1234.56")).toBe("1234,56 €");
	});

	it("in inglese britannico: simbolo prima e punto decimale", () => {
		setIntlLocaleResolver(() => "en-GB");
		expect(formatPriceEur(29)).toBe("€29.00");
		expect(formatPriceEur(1234.56)).toBe("€1,234.56");
	});

	it("un valore non numerico è «—»", () => {
		expect(formatPriceEur("abc")).toBe("—");
	});
});
