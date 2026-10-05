import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { characteristicUpdateImpact, confirmDescription } from "./impact";
import type {
	CharacteristicBaseline,
	ProductCharacteristicFormData,
} from "./schemas/product-characteristic";

const baseline: CharacteristicBaseline = {
	dataType: "enum",
	valueCount: 10,
	options: [
		{ id: "opt-rosso", valueCount: 4 },
		{ id: "opt-blu", valueCount: 6 },
	],
};

function form(
	overrides: Partial<ProductCharacteristicFormData> = {},
): ProductCharacteristicFormData {
	return {
		name: "Colore",
		dataType: "enum",
		unit: "",
		options: [
			{ optionId: "opt-rosso", value: "Rosso" },
			{ optionId: "opt-blu", value: "Blu" },
		],
		...overrides,
	};
}

describe("characteristicUpdateImpact", () => {
	it("un cambio di tipo tocca tutti i prodotti con un valore", () => {
		expect(
			characteristicUpdateImpact(baseline, form({ dataType: "text" })),
		).toBe(10);
	});

	it("senza cambio di tipo, un tipo non enum non tocca nessuno", () => {
		const textBaseline = {
			...baseline,
			dataType: "text" as const,
			options: [],
		};
		expect(
			characteristicUpdateImpact(
				textBaseline,
				form({ dataType: "text", options: [] }),
			),
		).toBe(0);
	});

	it("enum invariato: nessun prodotto perde il valore", () => {
		expect(characteristicUpdateImpact(baseline, form())).toBe(0);
	});

	it("conta i prodotti delle opzioni rimosse", () => {
		expect(
			characteristicUpdateImpact(
				baseline,
				form({ options: [{ optionId: "opt-blu", value: "Blu" }] }),
			),
		).toBe(4);
	});

	it("un'opzione nuova senza id non salva quelle rimosse", () => {
		expect(
			characteristicUpdateImpact(
				baseline,
				form({
					options: [
						{ optionId: "opt-rosso", value: "Rosso" },
						{ value: "Verde" },
					],
				}),
			),
		).toBe(6);
	});

	it("un'opzione con id ma valore svuotato conta come rimossa, come sul server", () => {
		expect(
			characteristicUpdateImpact(
				baseline,
				form({
					options: [
						{ optionId: "opt-rosso", value: "   " },
						{ optionId: "opt-blu", value: "Blu" },
					],
				}),
			),
		).toBe(4);
	});
});

describe("confirmDescription", () => {
	const originalGetLocale = getLocale;
	afterEach(() => overwriteGetLocale(originalGetLocale));

	it("cambio di tipo e opzioni rimosse, singolare e plurale", () => {
		overwriteGetLocale(() => "it");
		expect(confirmDescription(true, 2)).toBe(
			"Cambiando tipo, i valori già compilati su 2 prodotti verranno eliminati definitivamente.",
		);
		expect(confirmDescription(true, 1)).toBe(
			"Cambiando tipo, i valori già compilati su 1 prodotto verranno eliminati definitivamente.",
		);
		expect(confirmDescription(false, 3)).toBe(
			"Le opzioni rimosse sono in uso: 3 prodotti perderanno il valore, che verrà eliminato definitivamente.",
		);
	});

	it("follows the current language", () => {
		overwriteGetLocale(() => "en");
		expect(confirmDescription(true, 1)).toBe(
			"Changing the type will permanently delete the values already filled in on 1 product.",
		);
		expect(confirmDescription(false, 4)).toBe(
			"The removed options are in use: 4 products will lose their value, which will be permanently deleted.",
		);
		expect(confirmDescription(false, 1)).toBe(
			"The removed options are in use: 1 product will lose its value, which will be permanently deleted.",
		);
	});
});
