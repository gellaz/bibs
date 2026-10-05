import { afterEach, describe, expect, it } from "vitest";
import { productCategoriesConfig } from "@/features/product-categories/product-categories.config";
import { productMacroCategoriesConfig } from "@/features/product-macro-categories/product-macro-categories.config";
import { storeCategoriesConfig } from "@/features/store-categories/store-categories.config";
import { storeMacroCategoriesConfig } from "@/features/store-macro-categories/store-macro-categories.config";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";

const originalGetLocale = getLocale;
afterEach(() => overwriteGetLocale(originalGetLocale));

const configs = {
	productMacro: productMacroCategoriesConfig,
	product: productCategoriesConfig,
	storeMacro: storeMacroCategoriesConfig,
	store: storeCategoriesConfig,
};

describe("category CRUD configs", () => {
	it("count the total with the singular for one", () => {
		const totals = Object.values(configs).map((c) => [
			c.labels().total(1),
			c.labels().total(3),
		]);
		expect(totals).toEqual([
			["Totale: 1 macro categoria", "Totale: 3 macro categorie"],
			["Totale: 1 categoria prodotto", "Totale: 3 categorie prodotto"],
			["Totale: 1 macro categoria", "Totale: 3 macro categorie"],
			["Totale: 1 categoria", "Totale: 3 categorie"],
		]);
	});

	it("read the labels in the current language at every call", () => {
		expect(configs.store.labels().searchPlaceholder).toBe(
			"Cerca categoria negozio...",
		);
		overwriteGetLocale(() => "en");
		expect(configs.store.labels().searchPlaceholder).toBe(
			"Search store category...",
		);
		expect(configs.product.labels().total(1)).toBe("Total: 1 product category");
		expect(configs.product.extraColumns?.().map((c) => c.header)).toEqual([
			"Macro Category",
			"Characteristics",
		]);
	});

	it("put the entity name in the delete question", () => {
		const entity = { id: "1", name: "Panetteria", createdAt: "" };
		expect(
			configs.storeMacro.labels().deleteDescription("Panetteria", entity),
		).toBe(
			'Sei sicuro di voler eliminare la macro categoria "Panetteria"? L\'eliminazione fallirà se ci sono ancora categorie collegate.',
		);
	});

	it("keep the CSV headers the API expects in every language", () => {
		overwriteGetLocale(() => "en");
		expect(configs.product.csvImport?.labels().formatHint).toBe(
			"Expected headers: macro_category, subcategory. The import is idempotent: categories that already exist are skipped.",
		);
		expect(configs.store.csvImport?.labels().formatHint).toContain(
			"macro_category, name",
		);
	});
});
