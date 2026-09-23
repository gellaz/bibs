export const CHARACTERISTIC_DATA_TYPES = [
	"text",
	"number",
	"boolean",
	"enum",
] as const;
export type CharacteristicDataType = (typeof CHARACTERISTIC_DATA_TYPES)[number];

export const DATA_TYPE_LABELS: Record<CharacteristicDataType, string> = {
	text: "Testo",
	number: "Numero",
	boolean: "Sì/No",
	enum: "Lista chiusa",
};

export function productsPhrase(n: number): string {
	return `${n} prodott${n === 1 ? "o" : "i"}`;
}
