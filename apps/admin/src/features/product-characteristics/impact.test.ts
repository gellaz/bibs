import { describe, expect, it } from "vitest";
import { characteristicUpdateImpact } from "./impact";
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
