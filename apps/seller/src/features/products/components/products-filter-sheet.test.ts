import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import {
	activeFiltersLabel,
	selectedCategoriesLabel,
} from "./products-filter-sheet";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

describe("selectedCategoriesLabel", () => {
	it("niente sommario senza selezione, poi singolare e plurale", () => {
		overwriteGetLocale(() => "it");
		expect(selectedCategoriesLabel(0)).toBeUndefined();
		expect(selectedCategoriesLabel(1)).toBe("1 selezionata");
		expect(selectedCategoriesLabel(3)).toBe("3 selezionate");
	});

	it("follows the current language", () => {
		overwriteGetLocale(() => "en");
		expect(selectedCategoriesLabel(1)).toBe("1 selected");
		expect(selectedCategoriesLabel(3)).toBe("3 selected");
	});
});

describe("activeFiltersLabel", () => {
	it("zero, singolare e plurale in italiano", () => {
		overwriteGetLocale(() => "it");
		expect(activeFiltersLabel(0)).toBe("Nessun filtro attivo");
		expect(activeFiltersLabel(1)).toBe("1 filtro attivo");
		expect(activeFiltersLabel(3)).toBe("3 filtri attivi");
	});

	it("follows the current language", () => {
		overwriteGetLocale(() => "en");
		expect(activeFiltersLabel(0)).toBe("No active filters");
		expect(activeFiltersLabel(1)).toBe("1 active filter");
		expect(activeFiltersLabel(3)).toBe("3 active filters");
	});
});
