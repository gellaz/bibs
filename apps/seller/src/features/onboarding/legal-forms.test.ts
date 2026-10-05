import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { LEGAL_FORMS } from "./legal-forms";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

describe("LEGAL_FORMS", () => {
	it("salva sempre il valore italiano, in qualunque lingua", () => {
		overwriteGetLocale(() => "en");
		expect(LEGAL_FORMS.map((f) => f.value)).toEqual([
			"Ditta individuale",
			"SRL",
			"SRLS",
			"SAS",
			"SNC",
			"SPA",
			"Cooperativa",
			"Associazione",
			"Altro",
		]);
	});

	it("in italiano l'etichetta coincide col valore", () => {
		overwriteGetLocale(() => "it");
		for (const f of LEGAL_FORMS) expect(f.label()).toBe(f.value);
	});

	it("follows the current language", () => {
		overwriteGetLocale(() => "en");
		expect(LEGAL_FORMS.map((f) => f.label())).toEqual([
			"Sole proprietorship",
			"SRL",
			"SRLS",
			"SAS",
			"SNC",
			"SPA",
			"Cooperative",
			"Association",
			"Other",
		]);
	});
});
