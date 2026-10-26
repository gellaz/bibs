import { intlLocale } from "@bibs/ui/lib/intl-locale";
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

/**
 * Il testo di una cella della tabella Caratteristiche, o `null` se la riga non
 * deve esistere. Le etichette «Sì» / «No» arrivano da Paraglide tramite il
 * chiamante, così la funzione resta pura e testabile.
 */
export function formatCharacteristicValue(
	c: ProductCharacteristicView,
	labels: CharacteristicLabels,
): string | null {
	// Ogni ramo controlla il tipo: un valore inatteso (anche un `Date`) non
	// diventa mai una riga.
	const value: unknown = c.value;
	switch (c.dataType) {
		case "boolean":
			if (typeof value !== "boolean") return null;
			return value ? labels.yes : labels.no;
		case "number": {
			if (typeof value !== "number" || !Number.isFinite(value)) return null;
			const n = new Intl.NumberFormat(intlLocale(), {
				// Quattro decimali: la precisione di numeric(14,4) lato database.
				maximumFractionDigits: 4,
			}).format(value);
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
