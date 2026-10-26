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

export { issueRule } from "./schemas/issues";
