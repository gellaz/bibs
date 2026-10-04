import { intlLocaleFor, setIntlLocaleResolver } from "@bibs/ui/lib/intl-locale";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { ProductPriceCell } from "./product-price-cell";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
	setIntlLocaleResolver(() => "it-IT");
});

function useLocale(locale: "it" | "en") {
	overwriteGetLocale(() => locale);
	setIntlLocaleResolver(() => intlLocaleFor(locale));
}

function text() {
	const html = renderToStaticMarkup(
		<ProductPriceCell price="12.20" vatRate="22" appliedDiscount={null} />,
	);
	return html
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

describe("ProductPriceCell", () => {
	it("shows the net price in Italian", () => {
		useLocale("it");
		expect(text()).toContain("netto 10,00 €");
	});

	it("follows the current language", () => {
		useLocale("en");
		expect(text()).toContain("net €10.00");
	});
});
