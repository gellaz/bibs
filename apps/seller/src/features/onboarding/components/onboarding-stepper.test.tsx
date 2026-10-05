import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { OnboardingStepper } from "./onboarding-stepper";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

function titles(html: string) {
	return [...html.matchAll(/data-slot="stepper-title"[^>]*>([^<]*)</g)].map(
		(match) => match[1],
	);
}

describe("OnboardingStepper", () => {
	it("etichette degli step e della navigazione in italiano", () => {
		overwriteGetLocale(() => "it");
		const html = renderToStaticMarkup(
			<OnboardingStepper currentStatus="pending_document" />,
		);
		expect(html).toContain('aria-label="Avanzamento"');
		expect(titles(html)).toEqual([
			"Anagrafica",
			"Documento",
			"Azienda",
			"In revisione",
			"Negozio",
		]);
	});

	it("follows the current language", () => {
		overwriteGetLocale(() => "en");
		const html = renderToStaticMarkup(
			<OnboardingStepper currentStatus="first_store" />,
		);
		expect(html).toContain('aria-label="Progress"');
		expect(titles(html)).toEqual([
			"Personal details",
			"ID document",
			"Business",
			"Under review",
			"Store",
		]);
	});
});
