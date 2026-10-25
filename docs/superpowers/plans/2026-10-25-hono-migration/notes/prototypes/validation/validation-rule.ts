import type { TSchema } from "typebox";
import { Value } from "typebox/value";

// Quale regola un errore di TypeBox viola, senza testo: l'API la scrive in
// italiano (`validation-message.ts`), il seller con Paraglide nella lingua
// corrente. Solo TypeBox e import relativi: il seller lo importa via
// `@bibs/api/validation-rule` e lo mette nel suo bundle.
// PROBE: port to TypeBox 1 (AJV-style errors: keyword/params/schemaPath/instancePath).

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

type AnySchema = TSchema & Record<string, any>;

/** Il primo errore, col nodo di schema e il valore a cui punta. */
export interface RuleInput {
	keyword: string;
	params: Record<string, any>;
	schema: AnySchema;
	value: unknown;
	/** JSON pointer del campo (`/items/1/quantity`). */
	path: string;
}

const LIMITS = new Set([
	"minimum",
	"maximum",
	"exclusiveMinimum",
	"exclusiveMaximum",
	"minItems",
	"maxItems",
]);
const TYPES: Record<string, ValidationRule> = {
	string: { kind: "string" },
	number: { kind: "number" },
	integer: { kind: "integer" },
	boolean: { kind: "boolean" },
	array: { kind: "array" },
};

function at(root: AnySchema, pointer: string): AnySchema {
	let node: any = root;
	for (const seg of pointer.replace(/^#\/?/, "").split("/").filter(Boolean))
		node = node?.[seg.replaceAll("~1", "/").replaceAll("~0", "~")];
	return node ?? root;
}

/**
 * Il primo errore come lo riporterebbe TypeBox 0.34 (quello che Elysia mostra):
 * gli errori dei rami di un anyOf non contano, conta l'anyOf; `required` sta
 * sull'oggetto e si sposta sul primo campo mancante.
 */
export function firstError(
	schema: TSchema,
	value: unknown,
): RuleInput | undefined {
	const errors = [...Value.Errors(schema, value)];
	const unions = errors
		.filter((e) => e.keyword === "anyOf")
		.map((e) => `${e.schemaPath}/anyOf/`);
	const e = errors.find((x) => !unions.some((u) => x.schemaPath.startsWith(u)));
	if (!e) return undefined;
	let path = e.instancePath;
	let schemaPath = e.schemaPath;
	if (e.keyword === "required") {
		const key = (e.params as { requiredProperties: string[] })
			.requiredProperties[0];
		path += `/${key}`;
		schemaPath += `/properties/${key}`;
	}
	return {
		keyword: e.keyword,
		params: e.params as Record<string, any>,
		schema: at(schema as AnySchema, schemaPath),
		value: path === "" ? value : Value.Pointer.Get(value as object, path),
		path,
	};
}

export function validationRule({
	keyword,
	params,
	schema,
	value,
}: Omit<RuleInput, "path">): ValidationRule {
	if (value === undefined || keyword === "required")
		return { kind: "required" };
	if (LIMITS.has(keyword))
		return { kind: keyword, limit: Number(params.limit) } as ValidationRule;
	switch (keyword) {
		case "anyOf":
			return unionRule(schema, value);
		case "~refine":
			return schema["x-file"] ? { kind: "fileType" } : { kind: "invalid" };
		case "const":
		case "enum":
			return { kind: "notAllowed" };
		case "type":
			return TYPES[params.type] ?? { kind: "invalid" };
		case "minLength":
			// normalize (API) toglie gli spazi prima della validazione, nei form il
			// campo vuoto è "": minLength 1 = vuoto.
			return params.limit <= 1
				? { kind: "required" }
				: { kind: "minLength", limit: params.limit };
		case "maxLength":
			return { kind: "maxLength", limit: params.limit };
		case "pattern":
			return { kind: "pattern" };
		case "format":
			return { kind: "format", format: params.format };
		case "uniqueItems":
			return { kind: "uniqueItems" };
		default:
			return { kind: "invalid" };
	}
}

// t.Integer, t.Nullable e t.Date sono anyOf: si scartano il ramo null e quello
// di coercizione da stringa e si rivalida il valore sul ramo che resta.
function unionRule(schema: AnySchema, value: unknown): ValidationRule {
	const anyOf: AnySchema[] = schema.anyOf ?? [];
	if (anyOf.length > 0 && anyOf.every((branch) => "const" in branch))
		return { kind: "notAllowed" };
	if (anyOf.some((branch) => branch.format === "date-time"))
		return { kind: "date" };
	const branches = anyOf.filter(
		(branch) =>
			branch.type !== "null" &&
			!(branch.type === "string" && branch.format === "integer"),
	);
	const inner =
		branches.length === 1 ? firstError(branches[0], value) : undefined;
	return inner ? validationRule(inner) : { kind: "invalid" };
}
