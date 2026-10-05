import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { CHARACTERISTIC_DATA_TYPES, dataTypeLabel } from "./data-type";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

describe("dataTypeLabel", () => {
	it("etichette italiane dei quattro tipi", () => {
		overwriteGetLocale(() => "it");
		expect(CHARACTERISTIC_DATA_TYPES.map(dataTypeLabel)).toEqual([
			"Testo",
			"Numero",
			"Sì/No",
			"Lista chiusa",
		]);
	});

	it("follows the current language", () => {
		overwriteGetLocale(() => "en");
		expect(CHARACTERISTIC_DATA_TYPES.map(dataTypeLabel)).toEqual([
			"Text",
			"Number",
			"Yes/No",
			"Fixed list",
		]);
	});
});
