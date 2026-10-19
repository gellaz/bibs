import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import type { HolidayRow } from "../lib/closure-rows";
import { ClosuresList } from "./closures-list";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

const holidays: HolidayRow[] = [
	"2026-11-01",
	"2026-12-08",
	"2026-12-25",
	"2026-12-26",
	"2027-01-01",
	"2027-01-06",
	"2027-04-25",
].map((nextDate, i) => ({
	definitionId: `h${i}`,
	name: `Festa ${i}`,
	type: "fixed",
	nextDate,
	observed: true,
}));

function render() {
	overwriteGetLocale(() => "it");
	return renderToStaticMarkup(
		<ClosuresList
			holidays={holidays}
			value={{
				optOutIds: ["h1"],
				customClosures: [
					{ startDate: "2027-08-09", endDate: "2027-08-23", note: "Ferie" },
				],
			}}
			onChange={() => {}}
		/>,
	);
}

describe("ClosuresList", () => {
	it("mostra tutte le chiusure, senza «Mostra tutte»", () => {
		const html = render();
		for (const h of holidays) expect(html).toContain(h.name);
		expect(html).toContain("Ferie");
		expect(html).not.toContain("Mostra tutte");
	});

	it("festività aperte e chiusure tue si leggono nella riga", () => {
		const html = render();
		expect(html).toContain("Festività · resti aperto");
		expect(html).toContain("Chiusura tua · 15 giorni");
		expect(html).toContain('aria-label="Festa 0: chiuso o aperto"');
	});

	it("in ordine di data: la chiusura d'agosto dopo l'ultima festività", () => {
		const html = render();
		expect(html.indexOf("Festa 6")).toBeLessThan(html.indexOf("Ferie"));
		expect(html.indexOf("Festa 0")).toBeLessThan(html.indexOf("Festa 1"));
	});
});
