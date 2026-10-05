import type { core } from "zod";

/**
 * La regola violata da un'issue di zod, senza testo: ogni app la traduce con i
 * propri messaggi Paraglide (`packages/ui` non può importarli). Stessi `kind`
 * e stessi nomi di formato della `ValidationRule` dell'API, così il seller
 * riusa la traduzione dei form TypeBox.
 */
export type ZodIssueRule =
	| { kind: "required" }
	| { kind: "string" }
	| { kind: "number" }
	| { kind: "integer" }
	| { kind: "boolean" }
	| { kind: "array" }
	| { kind: "date" }
	| { kind: "notAllowed" }
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
	| { kind: "invalid" };

/** Formati di zod → nomi dei formati TypeBox; gli altri restano col nome di zod. */
const FORMATS: Record<string, string> = {
	email: "email",
	url: "uri",
	datetime: "date-time",
	date: "calendar-date",
	uuid: "uuid",
	guid: "uuid",
};

/** Formati che sono un pattern sulla stringa, non un tipo di dato. */
const PATTERN_FORMATS = new Set([
	"regex",
	"starts_with",
	"ends_with",
	"includes",
]);

const TYPES: Record<string, ZodIssueRule> = {
	string: { kind: "string" },
	number: { kind: "number" },
	int: { kind: "integer" },
	boolean: { kind: "boolean" },
	array: { kind: "array" },
	date: { kind: "date" },
};

function size(
	origin: string,
	limit: number,
	inclusive: boolean,
	side: "min" | "max",
): ZodIssueRule {
	switch (origin) {
		case "string":
			// `min(1)` è il modo di zod di dire «obbligatorio»: come per TypeBox.
			if (side === "min" && limit === 1 && inclusive)
				return { kind: "required" };
			return side === "min"
				? { kind: "minLength", limit: inclusive ? limit : limit + 1 }
				: { kind: "maxLength", limit: inclusive ? limit : limit - 1 };
		case "number":
		case "int":
		case "bigint":
			if (side === "min")
				return inclusive
					? { kind: "minimum", limit }
					: { kind: "exclusiveMinimum", limit };
			return inclusive
				? { kind: "maximum", limit }
				: { kind: "exclusiveMaximum", limit };
		case "array":
		case "set":
			return side === "min"
				? { kind: "minItems", limit: inclusive ? limit : limit + 1 }
				: { kind: "maxItems", limit: inclusive ? limit : limit - 1 };
		case "date":
			return { kind: "date" };
		default:
			return { kind: "invalid" };
	}
}

/** La regola di un'issue di zod 4, per l'error map di un'app (`z.config`). */
export function zodIssueRule(issue: core.$ZodRawIssue): ZodIssueRule {
	switch (issue.code) {
		case "invalid_type":
			// Campo assente: per chi compila il form è un campo obbligatorio.
			if (issue.input === undefined || issue.input === null)
				return { kind: "required" };
			return TYPES[issue.expected] ?? { kind: "invalid" };
		case "too_small":
			return size(
				issue.origin,
				Number(issue.minimum),
				issue.inclusive !== false,
				"min",
			);
		case "too_big":
			return size(
				issue.origin,
				Number(issue.maximum),
				issue.inclusive !== false,
				"max",
			);
		case "invalid_format":
			if (PATTERN_FORMATS.has(issue.format)) return { kind: "pattern" };
			return { kind: "format", format: FORMATS[issue.format] ?? issue.format };
		case "invalid_value":
			return { kind: "notAllowed" };
		default:
			return { kind: "invalid" };
	}
}
