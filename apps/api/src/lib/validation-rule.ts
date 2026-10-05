import { Kind, type TSchema } from "@sinclair/typebox";
import { ValueErrorType } from "@sinclair/typebox/errors";
import { Value } from "@sinclair/typebox/value";

// Quale regola un errore di TypeBox viola, senza testo: l'API la scrive in
// italiano (`validation-message.ts`), il seller con Paraglide nella lingua
// corrente. Solo TypeBox e import relativi: il seller lo importa via
// `@bibs/api/validation-rule` e lo mette nel suo bundle.

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

/** I campi comuni a `ValueError` e al parametro della funzione d'errore. */
export interface RuleInput {
	type: ValueErrorType;
	schema: TSchema;
	value: unknown;
}

export function validationRule({
	type,
	schema,
	value,
}: RuleInput): ValidationRule {
	if (value === undefined) return { kind: "required" };

	switch (type) {
		case ValueErrorType.Union:
			return unionRule(schema, value);
		case ValueErrorType.Kind:
			return schema[Kind] === "File" || schema[Kind] === "Files"
				? { kind: "fileType" }
				: { kind: "invalid" };
		case ValueErrorType.Literal:
			return { kind: "notAllowed" };
		case ValueErrorType.String:
			return { kind: "string" };
		case ValueErrorType.Number:
			return { kind: "number" };
		case ValueErrorType.Integer:
			return { kind: "integer" };
		case ValueErrorType.Boolean:
			return { kind: "boolean" };
		case ValueErrorType.Array:
			return { kind: "array" };
		case ValueErrorType.StringMinLength:
			// normalize (API) toglie gli spazi prima della validazione, nei form il
			// campo vuoto è "": minLength 1 = vuoto.
			return schema.minLength <= 1
				? { kind: "required" }
				: { kind: "minLength", limit: schema.minLength };
		case ValueErrorType.StringMaxLength:
			return { kind: "maxLength", limit: schema.maxLength };
		case ValueErrorType.StringPattern:
			return { kind: "pattern" };
		case ValueErrorType.StringFormat:
		case ValueErrorType.StringFormatUnknown:
			return { kind: "format", format: schema.format };
		case ValueErrorType.IntegerMinimum:
		case ValueErrorType.NumberMinimum:
			return { kind: "minimum", limit: schema.minimum };
		case ValueErrorType.IntegerMaximum:
		case ValueErrorType.NumberMaximum:
			return { kind: "maximum", limit: schema.maximum };
		case ValueErrorType.IntegerExclusiveMinimum:
		case ValueErrorType.NumberExclusiveMinimum:
			return { kind: "exclusiveMinimum", limit: schema.exclusiveMinimum };
		case ValueErrorType.IntegerExclusiveMaximum:
		case ValueErrorType.NumberExclusiveMaximum:
			return { kind: "exclusiveMaximum", limit: schema.exclusiveMaximum };
		case ValueErrorType.ArrayMinItems:
			return { kind: "minItems", limit: schema.minItems };
		case ValueErrorType.ArrayMaxItems:
			return { kind: "maxItems", limit: schema.maxItems };
		case ValueErrorType.ArrayUniqueItems:
			return { kind: "uniqueItems" };
		default:
			return { kind: "invalid" };
	}
}

// t.Integer, t.Nullable e t.Date sono Union: TypeBox dice solo «Expected union
// value». Si scartano il ramo null e quello di coercizione da stringa e si
// rivalida il valore sul ramo che resta, per avere la regola vera.
function unionRule(schema: TSchema, value: unknown): ValidationRule {
	const anyOf: TSchema[] = schema.anyOf ?? [];
	if (anyOf.length > 0 && anyOf.every((branch) => "const" in branch)) {
		return { kind: "notAllowed" };
	}
	if (anyOf.some((branch) => branch.type === "Date")) {
		return { kind: "date" };
	}
	const branches = anyOf.filter(
		(branch) =>
			branch.type !== "null" &&
			!(branch.type === "string" && branch.format === "integer"),
	);
	const only = branches.length === 1 ? branches[0] : undefined;
	const inner = only && Value.Errors(only, value).First();
	return inner ? validationRule(inner) : { kind: "invalid" };
}
