import type { CharacteristicDataType } from "@/db/schemas/product-characteristic";

/**
 * Validazione dei valori delle caratteristiche di prodotto. Logica pura, come
 * lib/vat.ts: le definizioni (la matrice della sotto-categoria, con tipo e
 * opzioni) arrivano già caricate, e il risultato dice cosa scrivere, cosa
 * cancellare e cosa rifiutare. Il database ha comunque il suo CHECK sulla
 * colonna giusta: qui si produce il messaggio che il venditore legge.
 */

export const MAX_TEXT_LENGTH = 2000;
// numeric(14,4): dieci cifre intere e quattro decimali.
const MAX_NUMBER_ABS = 1e10;
const MAX_DECIMALS = 4;

export interface CharacteristicDefinition {
	id: string;
	name: string;
	dataType: CharacteristicDataType;
	required: boolean;
	options: { id: string; value: string }[];
}

export type CharacteristicInputValue = string | number | boolean | null;

export interface CharacteristicValueInput {
	characteristicId: string;
	value: CharacteristicInputValue;
}

export interface CharacteristicValueRow {
	characteristicId: string;
	dataType: CharacteristicDataType;
	valueText: string | null;
	valueNumber: string | null;
	valueBoolean: boolean | null;
	optionId: string | null;
}

export interface ValidatedCharacteristicValues {
	upserts: CharacteristicValueRow[];
	clears: string[];
	errors: string[];
}

export type StoredCharacteristicValue = Omit<
	CharacteristicValueRow,
	"characteristicId"
>;

const EXPECTED: Record<CharacteristicDataType, string> = {
	text: "un testo",
	number: "un numero",
	boolean: "sì o no",
	enum: "una delle opzioni",
};

function row(
	def: CharacteristicDefinition,
	column: Partial<StoredCharacteristicValue>,
): CharacteristicValueRow {
	return {
		characteristicId: def.id,
		dataType: def.dataType,
		valueText: null,
		valueNumber: null,
		valueBoolean: null,
		optionId: null,
		...column,
	};
}

function hasTooManyDecimals(n: number): boolean {
	const scale = 10 ** MAX_DECIMALS;
	return Math.round(n * scale) / scale !== n;
}

/** Un valore non vuoto: la riga da scrivere, oppure il messaggio d'errore. */
function toRow(
	def: CharacteristicDefinition,
	value: string | number | boolean,
): CharacteristicValueRow | string {
	const mismatch = `${def.name}: atteso ${EXPECTED[def.dataType]}`;
	switch (def.dataType) {
		case "text": {
			if (typeof value !== "string") return mismatch;
			const text = value.trim();
			if (text.length > MAX_TEXT_LENGTH) {
				return `${def.name}: massimo ${MAX_TEXT_LENGTH} caratteri`;
			}
			return row(def, { valueText: text });
		}
		case "number": {
			if (typeof value !== "number" || !Number.isFinite(value)) return mismatch;
			if (Math.abs(value) >= MAX_NUMBER_ABS) {
				return `${def.name}: numero troppo grande`;
			}
			if (hasTooManyDecimals(value)) {
				return `${def.name}: al massimo ${MAX_DECIMALS} decimali`;
			}
			return row(def, { valueNumber: String(value) });
		}
		case "boolean":
			if (typeof value !== "boolean") return mismatch;
			return row(def, { valueBoolean: value });
		case "enum": {
			if (typeof value !== "string") return mismatch;
			if (!def.options.some((o) => o.id === value)) {
				return `${def.name}: valore non ammesso`;
			}
			return row(def, { optionId: value });
		}
	}
}

function isEmpty(value: CharacteristicInputValue): value is null | string {
	return value === null || (typeof value === "string" && value.trim() === "");
}

/**
 * Tutti gli errori, non solo il primo: il venditore corregge il form in una
 * passata sola. Chi chiama non scrive nulla se `errors` non è vuoto.
 */
export function validateCharacteristicValues(
	definitions: CharacteristicDefinition[],
	inputs: CharacteristicValueInput[],
): ValidatedCharacteristicValues {
	const byId = new Map(definitions.map((d) => [d.id, d]));
	const seen = new Set<string>();
	const result: ValidatedCharacteristicValues = {
		upserts: [],
		clears: [],
		errors: [],
	};

	for (const input of inputs) {
		const def = byId.get(input.characteristicId);
		if (!def) {
			result.errors.push(
				`Caratteristica non prevista per la sotto-categoria del prodotto (${input.characteristicId})`,
			);
			continue;
		}
		if (seen.has(def.id)) {
			result.errors.push(`${def.name}: indicata più di una volta`);
			continue;
		}
		seen.add(def.id);

		// Il testo vuoto di un tipo diverso da text è comunque un «non indicato»:
		// un campo numerico svuotato arriva così da certi client.
		if (isEmpty(input.value)) {
			result.clears.push(def.id);
			continue;
		}
		const outcome = toRow(def, input.value);
		if (typeof outcome === "string") result.errors.push(outcome);
		else result.upserts.push(outcome);
	}

	return result;
}

export function filledAfter(
	before: ReadonlySet<string>,
	validated: ValidatedCharacteristicValues,
): Set<string> {
	const after = new Set(before);
	for (const id of validated.clears) after.delete(id);
	for (const r of validated.upserts) after.add(r.characteristicId);
	return after;
}

/**
 * La regola sulle obbligatorie (decisione P1 del piano PR 4). `entering`: il
 * prodotto nasce o cambia sotto-categoria, quindi ogni obbligatoria va
 * compilata. Altrimenti il prodotto resta dov'è: le obbligatorie mai compilate
 * sono tollerate, ma una già compilata non si può svuotare.
 */
export function missingRequired(params: {
	definitions: CharacteristicDefinition[];
	before: ReadonlySet<string>;
	after: ReadonlySet<string>;
	entering: boolean;
}): string[] {
	const { definitions, before, after, entering } = params;
	return definitions
		.filter(
			(d) => d.required && !after.has(d.id) && (entering || before.has(d.id)),
		)
		.map((d) => d.name);
}

/** Il valore come lo vede il client: per le liste chiuse, l'id dell'opzione. */
export function toCharacteristicOutputValue(
	stored: StoredCharacteristicValue,
): string | number | boolean {
	switch (stored.dataType) {
		case "text":
			return stored.valueText as string;
		case "number":
			return Number(stored.valueNumber);
		case "boolean":
			return stored.valueBoolean as boolean;
		case "enum":
			return stored.optionId as string;
	}
}

/**
 * Il valore come lo legge il cliente sulla scheda prodotto. A differenza di
 * toCharacteristicOutputValue (il seller rimanda l'id), una lista chiusa
 * diventa l'etichetta dell'opzione. `null` vuol dire «niente da mostrare»: la
 * riga non esce. Un `false` invece è un valore («No»), non un vuoto.
 */
export function toCharacteristicDisplayValue(
	stored: StoredCharacteristicValue,
	optionValue: string | null,
): string | number | boolean | null {
	switch (stored.dataType) {
		case "enum":
			return optionValue?.trim() ? optionValue : null;
		case "text":
			return stored.valueText?.trim() ? stored.valueText : null;
		case "number": {
			// Number(null) è 0: senza questo controllo un numero assente
			// diventerebbe una riga «0 g».
			if (stored.valueNumber === null) return null;
			const n = Number(stored.valueNumber);
			return Number.isFinite(n) ? n : null;
		}
		case "boolean":
			return stored.valueBoolean;
	}
}
