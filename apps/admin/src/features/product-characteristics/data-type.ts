import { m } from "@/paraglide/messages";

export const CHARACTERISTIC_DATA_TYPES = [
	"text",
	"number",
	"boolean",
	"enum",
] as const;
export type CharacteristicDataType = (typeof CHARACTERISTIC_DATA_TYPES)[number];

/** Etichetta del tipo nella lingua corrente: letta a ogni render. */
export function dataTypeLabel(dataType: CharacteristicDataType): string {
	switch (dataType) {
		case "text":
			return m.characteristics_type_text();
		case "number":
			return m.characteristics_type_number();
		case "boolean":
			return m.characteristics_type_boolean();
		case "enum":
			return m.characteristics_type_enum();
	}
}
