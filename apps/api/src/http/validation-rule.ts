// Quale regola un'issue di Zod viola, senza testo: l'API la scrive in
// italiano (`validation-message.ts`), il seller con Paraglide nella lingua
// corrente. Il seller lo importa via `@bibs/api/validation-rule` e lo mette
// nel suo bundle: solo import relativi.

export type ValidationRule =
	| { kind: "required" }
	| { kind: "string" }
	| { kind: "number" }
	| { kind: "integer" }
	| { kind: "boolean" }
	| { kind: "array" }
	| { kind: "date" }
	| { kind: "notAllowed" }
	| { kind: "fileType" }
	| { kind: "minLength"; limit: number }
	| { kind: "maxLength"; limit: number }
	| { kind: "pattern" }
	| { kind: "format"; format: string }
	| { kind: "minimum"; limit: number }
	| { kind: "maximum"; limit: number }
	| { kind: "exclusiveMinimum"; limit: number }
	| { kind: "exclusiveMaximum"; limit: number }
	| { kind: "minItems"; limit: number }
	| { kind: "maxItems"; limit: number }
	| { kind: "uniqueItems" }
	| { kind: "invalid" };

/**
 * Se l'`error` scritto nei metadati dello schema vale per la regola violata.
 * Non sulla lunghezza massima: gli `error` sono scritti per il campo vuoto o il
 * formato («Il nome è obbligatorio»), su un testo troppo lungo direbbero il
 * falso. La usano i 422 dell'API e i form del seller.
 */
export const schemaErrorApplies = (rule: ValidationRule) =>
	rule.kind !== "maxLength";

export { issueRule } from "../schemas/issues";
