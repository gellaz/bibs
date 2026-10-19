import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { ReservationHoursField } from "./reservation-hours-field";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

function render(
	value: number,
	hasOpeningHours: boolean,
	locale: "it" | "en",
	client = new QueryClient(),
) {
	overwriteGetLocale(() => locale);
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<ReservationHoursField
				storeId="s1"
				value={value}
				hasOpeningHours={hasOpeningHours}
			/>
		</QueryClientProvider>,
	);
}

function unit(value: number, hasOpeningHours: boolean, locale: "it" | "en") {
	const html = render(value, hasOpeningHours, locale);
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

describe("esempio di scadenza", () => {
	const tz = process.env.TZ;
	beforeAll(() => {
		process.env.TZ = "America/New_York";
	});
	afterAll(() => {
		if (tz === undefined) delete process.env.TZ;
		else process.env.TZ = tz;
	});
	it("in ora di Roma anche con il browser in un altro fuso", () => {
		const client = new QueryClient();
		// 17:00 a Roma sono le 11:00 a New York.
		client.setQueryData(["store", "s1", "reservation-preview", 24], {
			hours: 24,
			expiresAt: new Date("2026-10-21T17:00:00+02:00"),
			clock: "opening",
		});
		const html = render(24, true, "it", client);
		expect(html.match(/<strong[^>]*>([^<]*)<\/strong>/)?.[1]).toBe(
			"mer 21 ott, 17:00",
		);
	});
});
