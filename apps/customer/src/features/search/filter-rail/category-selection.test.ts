import { describe, expect, it } from "bun:test";
import {
	expandedMacroId,
	isMacroActive,
	selectAllCategories,
	toggleCategory,
	toggleMacro,
} from "./category-selection";

const macros = [
	{ id: "food", categories: [{ id: "bakery" }, { id: "butcher" }] },
	{ id: "home", categories: [{ id: "kitchen" }] },
];

describe("expandedMacroId", () => {
	it("opens the selected macro", () => {
		expect(expandedMacroId(macros, { macroCategoryId: "home" })).toBe("home");
	});

	it("derives the macro from a category-only selection (deep link)", () => {
		expect(expandedMacroId(macros, { categoryId: "butcher" })).toBe("food");
	});

	it("keeps everything closed without a selection", () => {
		expect(expandedMacroId(macros, {})).toBeUndefined();
	});

	it("keeps everything closed for a category no macro contains", () => {
		expect(expandedMacroId(macros, { categoryId: "gone" })).toBeUndefined();
	});
});

describe("isMacroActive", () => {
	it("is active only while no category inside it is chosen", () => {
		expect(isMacroActive({ macroCategoryId: "food" }, "food")).toBe(true);
		expect(
			isMacroActive({ macroCategoryId: "food", categoryId: "bakery" }, "food"),
		).toBe(false);
		expect(isMacroActive({ macroCategoryId: "home" }, "food")).toBe(false);
	});
});

describe("selectAllCategories", () => {
	it("clears both levels", () => {
		expect(selectAllCategories()).toEqual({
			macroCategoryId: undefined,
			categoryId: undefined,
		});
	});
});

describe("toggleMacro", () => {
	it("selects a macro and drops the category", () => {
		expect(
			toggleMacro({ macroCategoryId: "home", categoryId: "kitchen" }, "food"),
		).toEqual({ macroCategoryId: "food", categoryId: undefined });
	});

	it("re-clicking the active macro goes back to «Tutte»", () => {
		expect(toggleMacro({ macroCategoryId: "food" }, "food")).toEqual({
			macroCategoryId: undefined,
			categoryId: undefined,
		});
	});

	it("clicking the macro above a chosen category selects the macro", () => {
		expect(
			toggleMacro({ macroCategoryId: "food", categoryId: "bakery" }, "food"),
		).toEqual({ macroCategoryId: "food", categoryId: undefined });
	});
});

describe("toggleCategory", () => {
	it("selects the category together with its macro", () => {
		expect(toggleCategory({}, "food", "bakery")).toEqual({
			macroCategoryId: "food",
			categoryId: "bakery",
		});
	});

	it("re-clicking the chosen category falls back to its macro", () => {
		expect(
			toggleCategory(
				{ macroCategoryId: "food", categoryId: "bakery" },
				"food",
				"bakery",
			),
		).toEqual({ macroCategoryId: "food", categoryId: undefined });
	});
});
