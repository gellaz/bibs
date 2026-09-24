import { describe, expect, it } from "bun:test";
import {
	characteristicRows,
	formatCharacteristicValue,
} from "./format-characteristic";
import type { ProductCharacteristicView } from "./product-detail-api";

const labels = { yes: "Sì", no: "No" };
const NBSP = " ";

function c(
	partial: Partial<ProductCharacteristicView> &
		Pick<ProductCharacteristicView, "dataType" | "value">,
): ProductCharacteristicView {
	return {
		characteristicId: "c1",
		name: "Voce",
		unit: null,
		...partial,
	} as ProductCharacteristicView;
}

describe("formatCharacteristicValue", () => {
	it("shows Sì for true and No for false", () => {
		expect(
			formatCharacteristicValue(
				c({ dataType: "boolean", value: true }),
				labels,
			),
		).toBe("Sì");
		expect(
			formatCharacteristicValue(
				c({ dataType: "boolean", value: false }),
				labels,
			),
		).toBe("No");
	});

	it("formats numbers the Italian way, with the unit after a no-break space", () => {
		expect(
			formatCharacteristicValue(
				c({ dataType: "number", value: 6.1, unit: "pollici" }),
				labels,
			),
		).toBe(`6,1${NBSP}pollici`);
		expect(
			formatCharacteristicValue(
				c({ dataType: "number", value: 12345678.1234, unit: "g" }),
				labels,
			),
		).toBe(`12.345.678,1234${NBSP}g`);
		expect(
			formatCharacteristicValue(
				c({ dataType: "number", value: 6500, unit: "K" }),
				labels,
			),
		).toBe(`6500${NBSP}K`);
	});

	it("formats integers without decimals", () => {
		expect(
			formatCharacteristicValue(
				c({ dataType: "number", value: 12, unit: "mesi" }),
				labels,
			),
		).toBe(`12${NBSP}mesi`);
	});

	it("writes percent without a space", () => {
		expect(
			formatCharacteristicValue(
				c({ dataType: "number", value: 55, unit: "%" }),
				labels,
			),
		).toBe("55%");
	});

	it("shows a number without unit alone", () => {
		expect(
			formatCharacteristicValue(c({ dataType: "number", value: 4 }), labels),
		).toBe("4");
	});

	it("shows texts and option labels as they are", () => {
		expect(
			formatCharacteristicValue(
				c({ dataType: "text", value: "05/03/2027" }),
				labels,
			),
		).toBe("05/03/2027");
		expect(
			formatCharacteristicValue(c({ dataType: "enum", value: "Nero" }), labels),
		).toBe("Nero");
	});

	it("never shows a value revived into a Date", () => {
		const revived = c({
			dataType: "text",
			value: new Date(2027, 4, 3) as unknown as string,
		});
		expect(formatCharacteristicValue(revived, labels)).toBeNull();
	});

	it("never shows an empty text or a mistyped value", () => {
		expect(
			formatCharacteristicValue(c({ dataType: "text", value: "  " }), labels),
		).toBeNull();
		expect(
			formatCharacteristicValue(c({ dataType: "number", value: "12" }), labels),
		).toBeNull();
		expect(
			formatCharacteristicValue(
				c({ dataType: "boolean", value: "true" }),
				labels,
			),
		).toBeNull();
	});
});

describe("characteristicRows", () => {
	it("keeps the order and drops what cannot be shown", () => {
		const rows = characteristicRows(
			[
				c({
					characteristicId: "a",
					name: "Peso",
					dataType: "number",
					value: 250,
					unit: "g",
				}),
				c({
					characteristicId: "b",
					name: "Vuoto",
					dataType: "text",
					value: " ",
				}),
				c({
					characteristicId: "c",
					name: "5G",
					dataType: "boolean",
					value: false,
				}),
			],
			labels,
		);
		expect(rows).toEqual([
			{ id: "a", name: "Peso", value: `250${NBSP}g` },
			{ id: "c", name: "5G", value: "No" },
		]);
	});

	it("returns nothing for an empty list", () => {
		expect(characteristicRows([], labels)).toEqual([]);
	});
});
