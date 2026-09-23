import type { CategoryCharacteristic } from "../hooks/use-category-characteristics";

/**
 * Stato del form per le caratteristiche. I numeri restano stringhe mentre il
 * venditore scrive (un campo numerico svuotato vale ""); si convertono solo
 * all'invio. `null` è «non indicato», per ogni tipo.
 */
export type CharacteristicFormValue = string | boolean | null;
export type CharacteristicFormValues = Record<string, CharacteristicFormValue>;

export interface SavedCharacteristicValue {
	characteristicId: string;
	name: string;
	value: string | number | boolean;
}

export function toFormValues(
	saved: SavedCharacteristicValue[],
): CharacteristicFormValues {
	return Object.fromEntries(
		saved.map((v) => [
			v.characteristicId,
			typeof v.value === "number" ? String(v.value) : v.value,
		]),
	);
}

export function isFilled(v: CharacteristicFormValue | undefined): boolean {
	if (v === null || v === undefined) return false;
	if (typeof v === "string") return v.trim().length > 0;
	return true;
}

/**
 * Tutte le caratteristiche della matrice corrente, le vuote a null: il server
 * cancella le vuote e ignora quelle che non riceve. Le caratteristiche di una
 * categoria scelta e poi abbandonata restano nello stato ma non partono.
 */
export function buildCharacteristicPayload(
	defs: CategoryCharacteristic[],
	values: CharacteristicFormValues,
) {
	return defs.map((d) => {
		const v = values[d.id];
		if (!isFilled(v)) return { characteristicId: d.id, value: null };
		if (d.dataType === "number") {
			const n = Number(v);
			return { characteristicId: d.id, value: Number.isNaN(n) ? null : n };
		}
		return { characteristicId: d.id, value: v as string | boolean };
	});
}

/**
 * La regola P1, lato client (il server la ripete). `entering`: prodotto nuovo o
 * sotto-categoria cambiata, ogni obbligatoria va compilata. Altrimenti solo
 * quelle già salvate non si possono svuotare.
 */
export function requiredToFill(params: {
	defs: CategoryCharacteristic[];
	values: CharacteristicFormValues;
	savedIds: ReadonlySet<string>;
	entering: boolean;
}) {
	const { defs, values, savedIds, entering } = params;
	return defs.filter(
		(d) =>
			d.required && !isFilled(values[d.id]) && (entering || savedIds.has(d.id)),
	);
}

/** I valori salvati che la nuova sotto-categoria non prevede (D10). */
export function lostOnSave(
	saved: SavedCharacteristicValue[],
	defs: CategoryCharacteristic[],
) {
	const keep = new Set(defs.map((d) => d.id));
	return saved.filter((v) => !keep.has(v.characteristicId));
}

export function valuesPhrase(n: number) {
	return `${n} valor${n === 1 ? "e" : "i"}`;
}

export function filledPhrase(n: number) {
	return `${valuesPhrase(n)} già compilat${n === 1 ? "o" : "i"}`;
}
