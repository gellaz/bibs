import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { type DaySchedule, OpeningHoursEditor } from "./opening-hours-editor";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

// Lunedì aperto, sabato aperto, gli altri chiusi.
const HOURS: DaySchedule[] = [
	{ dayOfWeek: 0, slots: [{ open: "09:00", close: "13:00" }] },
	{ dayOfWeek: 5, slots: [{ open: "09:00", close: "12:00" }] },
];

function rows(locale: "it" | "en") {
	overwriteGetLocale(() => locale);
	const html = renderToStaticMarkup(
		<OpeningHoursEditor value={HOURS} onChange={() => {}} readOnly />,
	);
	// Una riga per giorno: stato + nome del giorno.
	return [
		...html.matchAll(
			/<button[^>]*>([^<]+)<\/button><span[^>]*>([^<]+)<\/span>/g,
		),
	].map(([, status, day]) => `${status} ${day}`);
}

describe("OpeningHoursEditor", () => {
	it("lists the days from Monday with their state in Italian", () => {
		expect(rows("it")).toEqual([
			"Aperto Lunedì",
			"Chiuso Martedì",
			"Chiuso Mercoledì",
			"Chiuso Giovedì",
			"Chiuso Venerdì",
			"Aperto Sabato",
			"Chiuso Domenica",
		]);
	});

	it("follows the current language", () => {
		expect(rows("en")).toEqual([
			"Open Monday",
			"Closed Tuesday",
			"Closed Wednesday",
			"Closed Thursday",
			"Closed Friday",
			"Open Saturday",
			"Closed Sunday",
		]);
	});
});
