import type { ProductCharacteristicView } from "./product-detail-api";

export interface CharacteristicLabels {
	yes: string;
	no: string;
}

export interface CharacteristicRow {
	id: string;
	name: string;
	value: string;
}

// Quattro decimali: la precisione di numeric(14,4) lato database.
const NUMBER = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 4 });

/**
 * Il testo di una cella della tabella Caratteristiche, o `null` se la riga non
 * deve esistere. Le etichette «Sì» / «No» arrivano da Paraglide tramite il
 * chiamante, così la funzione resta pura e testabile.
 */
export function formatCharacteristicValue(
	c: ProductCharacteristicView,
	labels: CharacteristicLabels,
): string | null {
	const value: unknown = c.value;
	// Difesa, non il fix: se un fetch avesse revivificato una data, il testo
	// originale è perso. Meglio nessuna riga che una data sbagliata. Il fix è
	// apiNoDates in fetchProductDetail.
	if (value instanceof Date) return null;

	switch (c.dataType) {
		case "boolean":
			if (typeof value !== "boolean") return null;
			return value ? labels.yes : labels.no;
		case "number": {
			if (typeof value !== "number" || !Number.isFinite(value)) return null;
			const n = NUMBER.format(value);
			if (!c.unit) return n;
			return c.unit === "%" ? `${n}%` : `${n}\u00a0${c.unit}`;
		}
		case "text":
		case "enum":
			return typeof value === "string" && value.trim() !== "" ? value : null;
	}
}

export function characteristicRows(
	list: ProductCharacteristicView[],
	labels: CharacteristicLabels,
): CharacteristicRow[] {
	return list.flatMap((c) => {
		const value = formatCharacteristicValue(c, labels);
		return value === null
			? []
			: [{ id: c.characteristicId, name: c.name, value }];
	});
}
