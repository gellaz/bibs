import { intlLocaleFor, setIntlLocaleResolver } from "@bibs/ui/lib/intl-locale";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { DateRangePicker } from "@/components/date-range-picker";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";

// Solo il trigger: il calendario nel popover (locale di react-day-picker) è
// coperto da `dayPickerLocale` nei test dei componenti condivisi dell'admin.

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
	setIntlLocaleResolver(() => "it-IT");
});

function useLocale(locale: "it" | "en") {
	overwriteGetLocale(() => locale);
	setIntlLocaleResolver(() => intlLocaleFor(locale));
}

const from = new Date(2026, 9, 5);

function trigger(props: Partial<Parameters<typeof DateRangePicker>[0]>) {
	const html = renderToStaticMarkup(
		<DateRangePicker
			from={undefined}
			to={undefined}
			onChange={() => {}}
			{...props}
		/>,
	);
	// Testo del bottone senza l'icona.
	return html.replace(/<svg.*?<\/svg>/s, "").replace(/<[^>]+>/g, "");
}

describe("DateRangePicker trigger", () => {
	it("keeps the Italian placeholder and open end", () => {
		useLocale("it");
		expect(trigger({})).toBe("Seleziona periodo");
		expect(trigger({ from, openEnded: true })).toBe("5 ott → senza fine");
	});

	it("follows the current language", () => {
		useLocale("en");
		expect(trigger({})).toBe("Select period");
		expect(trigger({ from, openEnded: true })).toBe("5 Oct → no end");
		expect(trigger({ from, to: new Date(2026, 10, 2) })).toBe("5 Oct → 2 Nov");
	});
});
