import { describe, expect, it } from "bun:test";
import {
	type CharacteristicDefinition,
	filledAfter,
	MAX_TEXT_LENGTH,
	missingRequired,
	toCharacteristicDisplayValue,
	toCharacteristicOutputValue,
	validateCharacteristicValues,
} from "@/lib/characteristic-values";

const peso: CharacteristicDefinition = {
	id: "c-peso",
	name: "Peso",
	dataType: "number",
	required: false,
	options: [],
};
const modello: CharacteristicDefinition = {
	id: "c-modello",
	name: "Modello",
	dataType: "text",
	required: true,
	options: [],
};
const g5: CharacteristicDefinition = {
	id: "c-5g",
	name: "5G",
	dataType: "boolean",
	required: false,
	options: [],
};
const colore: CharacteristicDefinition = {
	id: "c-colore",
	name: "Colore",
	dataType: "enum",
	required: true,
	options: [
		{ id: "o-nero", value: "Nero" },
		{ id: "o-bianco", value: "Bianco" },
	],
};
const defs = [peso, modello, g5, colore];

describe("validateCharacteristicValues", () => {
	it("puts each value in the column of its type and nowhere else", () => {
		const result = validateCharacteristicValues(defs, [
			{ characteristicId: "c-peso", value: 180.5 },
			{ characteristicId: "c-modello", value: "X1" },
			{ characteristicId: "c-5g", value: false },
			{ characteristicId: "c-colore", value: "o-nero" },
		]);

		expect(result.errors).toEqual([]);
		expect(result.clears).toEqual([]);
		expect(result.upserts).toEqual([
			{
				characteristicId: "c-peso",
				dataType: "number",
				valueText: null,
				valueNumber: "180.5",
				valueBoolean: null,
				optionId: null,
			},
			{
				characteristicId: "c-modello",
				dataType: "text",
				valueText: "X1",
				valueNumber: null,
				valueBoolean: null,
				optionId: null,
			},
			{
				characteristicId: "c-5g",
				dataType: "boolean",
				valueText: null,
				valueNumber: null,
				valueBoolean: false,
				optionId: null,
			},
			{
				characteristicId: "c-colore",
				dataType: "enum",
				valueText: null,
				valueNumber: null,
				valueBoolean: null,
				optionId: "o-nero",
			},
		]);
	});

	it("treats null and blank text as a request to clear", () => {
		const result = validateCharacteristicValues(defs, [
			{ characteristicId: "c-peso", value: null },
			{ characteristicId: "c-modello", value: "   " },
		]);

		expect(result.errors).toEqual([]);
		expect(result.upserts).toEqual([]);
		expect(result.clears).toEqual(["c-peso", "c-modello"]);
	});

	it("trims text before storing it", () => {
		const result = validateCharacteristicValues(defs, [
			{ characteristicId: "c-modello", value: "  X1 Pro  " },
		]);
		expect(result.upserts[0].valueText).toBe("X1 Pro");
	});

	it("rejects a characteristic that is not in the matrix", () => {
		const result = validateCharacteristicValues(
			[peso],
			[{ characteristicId: "c-modello", value: "X1" }],
		);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("non prevista");
	});

	it("rejects a value whose type does not match the characteristic", () => {
		const result = validateCharacteristicValues(defs, [
			{ characteristicId: "c-peso", value: "180" },
			{ characteristicId: "c-modello", value: 12 },
			{ characteristicId: "c-5g", value: "sì" },
			{ characteristicId: "c-colore", value: true },
		]);
		expect(result.errors).toEqual([
			"Peso: atteso un numero",
			"Modello: atteso un testo",
			"5G: atteso sì o no",
			"Colore: atteso una delle opzioni",
		]);
		expect(result.upserts).toEqual([]);
	});

	it("rejects an option that does not belong to the list", () => {
		const result = validateCharacteristicValues(defs, [
			{ characteristicId: "c-colore", value: "o-rosso" },
		]);
		expect(result.errors).toEqual(["Colore: valore non ammesso"]);
	});

	it("rejects numbers that do not fit numeric(14,4)", () => {
		const result = validateCharacteristicValues(
			[peso],
			[{ characteristicId: "c-peso", value: 1e10 }],
		);
		expect(result.errors[0]).toContain("Peso");

		const decimals = validateCharacteristicValues(
			[peso],
			[{ characteristicId: "c-peso", value: 1.23456 }],
		);
		expect(decimals.errors[0]).toContain("4 decimali");

		const infinite = validateCharacteristicValues(
			[peso],
			[{ characteristicId: "c-peso", value: Number.POSITIVE_INFINITY }],
		);
		expect(infinite.errors).toHaveLength(1);
	});

	it("accepts the largest number that fits, and negatives", () => {
		const result = validateCharacteristicValues(
			[peso],
			[{ characteristicId: "c-peso", value: 9999999999.9999 }],
		);
		expect(result.errors).toEqual([]);

		const negative = validateCharacteristicValues(
			[peso],
			[{ characteristicId: "c-peso", value: -20 }],
		);
		expect(negative.upserts[0].valueNumber).toBe("-20");
	});

	it("rejects text longer than the limit", () => {
		const result = validateCharacteristicValues(
			[modello],
			[
				{
					characteristicId: "c-modello",
					value: "x".repeat(MAX_TEXT_LENGTH + 1),
				},
			],
		);
		expect(result.errors[0]).toContain(`${MAX_TEXT_LENGTH} caratteri`);
	});

	it("rejects the same characteristic sent twice", () => {
		const result = validateCharacteristicValues(defs, [
			{ characteristicId: "c-peso", value: 1 },
			{ characteristicId: "c-peso", value: 2 },
		]);
		expect(result.errors).toEqual(["Peso: indicata più di una volta"]);
	});
});

describe("filledAfter", () => {
	it("removes the cleared ids and adds the written ones", () => {
		const validated = validateCharacteristicValues(defs, [
			{ characteristicId: "c-peso", value: null },
			{ characteristicId: "c-5g", value: true },
		]);
		const after = filledAfter(new Set(["c-peso", "c-modello"]), validated);
		expect([...after].sort()).toEqual(["c-5g", "c-modello"]);
	});
});

describe("missingRequired", () => {
	it("when entering, lists every required characteristic without a value", () => {
		expect(
			missingRequired({
				definitions: defs,
				before: new Set(),
				after: new Set(["c-peso"]),
				entering: true,
			}),
		).toEqual(["Modello", "Colore"]);
	});

	it("when entering, is satisfied once the required ones are filled", () => {
		expect(
			missingRequired({
				definitions: defs,
				before: new Set(),
				after: new Set(["c-modello", "c-colore"]),
				entering: true,
			}),
		).toEqual([]);
	});

	it("when staying, ignores required characteristics that were never filled", () => {
		expect(
			missingRequired({
				definitions: defs,
				before: new Set(["c-peso"]),
				after: new Set(["c-peso"]),
				entering: false,
			}),
		).toEqual([]);
	});

	it("when staying, reports a required characteristic that gets cleared", () => {
		expect(
			missingRequired({
				definitions: defs,
				before: new Set(["c-modello", "c-peso"]),
				after: new Set(["c-peso"]),
				entering: false,
			}),
		).toEqual(["Modello"]);
	});

	it("never reports an optional characteristic", () => {
		expect(
			missingRequired({
				definitions: defs,
				before: new Set(["c-peso", "c-modello", "c-colore"]),
				after: new Set(["c-modello", "c-colore"]),
				entering: false,
			}),
		).toEqual([]);
	});
});

describe("toCharacteristicOutputValue", () => {
	const empty = {
		valueText: null,
		valueNumber: null,
		valueBoolean: null,
		optionId: null,
	};

	it("returns the value of the column of its type", () => {
		expect(
			toCharacteristicOutputValue({
				...empty,
				dataType: "number",
				valueNumber: "180.5000",
			}),
		).toBe(180.5);
		expect(
			toCharacteristicOutputValue({
				...empty,
				dataType: "text",
				valueText: "X1",
			}),
		).toBe("X1");
		expect(
			toCharacteristicOutputValue({
				...empty,
				dataType: "boolean",
				valueBoolean: false,
			}),
		).toBe(false);
		expect(
			toCharacteristicOutputValue({
				...empty,
				dataType: "enum",
				optionId: "o-nero",
			}),
		).toBe("o-nero");
	});
});

describe("toCharacteristicDisplayValue", () => {
	const empty = {
		valueText: null,
		valueNumber: null,
		valueBoolean: null,
		optionId: null,
	};

	it("returns the option label for an enum, not the option id", () => {
		expect(
			toCharacteristicDisplayValue(
				{ ...empty, dataType: "enum", optionId: "opt-1" },
				"Nero",
			),
		).toBe("Nero");
	});

	it("returns null for an enum whose label is missing", () => {
		expect(
			toCharacteristicDisplayValue(
				{ ...empty, dataType: "enum", optionId: "opt-1" },
				null,
			),
		).toBeNull();
	});

	it("returns the text unchanged, date-like included", () => {
		expect(
			toCharacteristicDisplayValue(
				{ ...empty, dataType: "text", valueText: "05/03/2027" },
				null,
			),
		).toBe("05/03/2027");
	});

	it("returns null for a blank text", () => {
		expect(
			toCharacteristicDisplayValue(
				{ ...empty, dataType: "text", valueText: "   " },
				null,
			),
		).toBeNull();
	});

	it("drops the trailing zeros of numeric", () => {
		expect(
			toCharacteristicDisplayValue(
				{ ...empty, dataType: "number", valueNumber: "12.0000" },
				null,
			),
		).toBe(12);
		expect(
			toCharacteristicDisplayValue(
				{ ...empty, dataType: "number", valueNumber: "6.1000" },
				null,
			),
		).toBe(6.1);
	});

	it("returns null for a missing number instead of zero", () => {
		expect(
			toCharacteristicDisplayValue({ ...empty, dataType: "number" }, null),
		).toBeNull();
	});

	it("keeps a boolean false", () => {
		expect(
			toCharacteristicDisplayValue(
				{ ...empty, dataType: "boolean", valueBoolean: false },
				null,
			),
		).toBe(false);
		expect(
			toCharacteristicDisplayValue(
				{ ...empty, dataType: "boolean", valueBoolean: true },
				null,
			),
		).toBe(true);
	});

	it("returns null for a missing boolean", () => {
		expect(
			toCharacteristicDisplayValue({ ...empty, dataType: "boolean" }, null),
		).toBeNull();
	});
});
