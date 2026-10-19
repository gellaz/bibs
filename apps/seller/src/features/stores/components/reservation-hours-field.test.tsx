import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { ReservationHoursField } from "./reservation-hours-field";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

function unit(value: number, hasOpeningHours: boolean, locale: "it" | "en") {
	overwriteGetLocale(() => locale);
	const html = renderToStaticMarkup(
		<QueryClientProvider client={new QueryClient()}>
			<ReservationHoursField
				storeId="s1"
				value={value}
				hasOpeningHours={hasOpeningHours}
			/>
		</QueryClientProvider>,
	);
	// Il suffisso è lo span subito dopo il campo.
	return html.match(/<input[^>]*\/?><span[^>]*>([^<]*)<\/span>/)?.[1];
}

describe("ReservationHoursField", () => {
	it.each([
		[1, true, "it", "ora di apertura"],
		[1, false, "it", "ora"],
		[2, true, "it", "ore di apertura"],
		[2, false, "it", "ore"],
		[1, true, "en", "opening hour"],
		[1, false, "en", "hour"],
		[24, true, "en", "opening hours"],
	] as const)(
		"%i ore (orari: %s, %s) → «%s»",
		(value, hasHours, locale, expected) => {
			expect(unit(value, hasHours, locale)).toBe(expected);
		},
	);
});
