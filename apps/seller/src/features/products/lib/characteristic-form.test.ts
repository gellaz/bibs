import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { lossConfirmation, lossWarning } from "./characteristic-form";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

const colore = { characteristicId: "c1", name: "Colore", value: "Rosso" };
const peso = { characteristicId: "c2", name: "Peso", value: "500" };

describe("lossWarning", () => {
	it("singolare e plurale in italiano", () => {
		overwriteGetLocale(() => "it");
		expect(lossWarning([colore])).toBe(
			"Al salvataggio verrà eliminato 1 valore già compilato della categoria precedente: Colore.",
		);
		expect(lossWarning([colore, peso])).toBe(
			"Al salvataggio verranno eliminati 2 valori già compilati della categoria precedente: Colore, Peso.",
		);
	});

	it("follows the current language", () => {
		overwriteGetLocale(() => "en");
		expect(lossWarning([colore, peso])).toBe(
			"Saving will delete 2 values already filled in for the previous category: Colore, Peso.",
		);
	});
});

describe("lossConfirmation", () => {
	it("singolare e plurale in italiano", () => {
		overwriteGetLocale(() => "it");
		expect(lossConfirmation([colore])).toBe(
			"Cambiando categoria perderai 1 valore già compilato: Colore. Non si potrà recuperare.",
		);
		expect(lossConfirmation([colore, peso])).toBe(
			"Cambiando categoria perderai 2 valori già compilati: Colore, Peso. Non si potranno recuperare.",
		);
	});

	it("follows the current language", () => {
		overwriteGetLocale(() => "en");
		expect(lossConfirmation([colore])).toBe(
			"Changing the category will lose 1 value already filled in: Colore. It can't be recovered.",
		);
	});
});
