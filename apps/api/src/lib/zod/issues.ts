import type { z } from "zod";
import type { ValidationRule } from "@/lib/validation-rule";

// Dalle issue di Zod alla regola di `validation-rule.ts` e all'errore che
// TypeBox (quindi Elysia) avrebbe dato per primo: i 422 restano identici al
// byte (D6 del piano Hono). Zod raccoglie tutte le issue; TypeBox ne dà una
// sola, nel suo ordine di visita, che qui si ricostruisce.

export type Issue = z.core.$ZodIssue;

/** Parametri delle issue `custom` dei costruttori di `t.ts`: regola già decisa. */
export interface RuleParams {
	rule: ValidationRule;
	/** Errore della decodifica (coercizione di Elysia): il campo si perde. */
	decode?: boolean;
}

export function ruleParams(issue: Issue): RuleParams | undefined {
	return issue.code === "custom"
		? (issue.params as RuleParams | undefined)
		: undefined;
}

const isMissing = (issue: Issue) =>
	issue.input === undefined && !ruleParams(issue)?.decode;

/** La regola violata, come `validationRule` sull'errore TypeBox equivalente. */
export function issueRule(issue: Issue): ValidationRule {
	const custom = ruleParams(issue);
	if (custom) return custom.rule;
	if (issue.input === undefined) return { kind: "required" };
	switch (issue.code) {
		case "invalid_type":
			switch (issue.expected) {
				case "string":
					return { kind: "string" };
				case "number":
					return { kind: "number" };
				case "int":
					return { kind: "integer" };
				case "boolean":
					return { kind: "boolean" };
				case "array":
					return { kind: "array" };
				default:
					return { kind: "invalid" };
			}
		case "invalid_value":
			return { kind: "notAllowed" };
		case "too_small": {
			const limit = Number(issue.minimum);
			if (issue.origin === "string")
				return limit <= 1 ? { kind: "required" } : { kind: "minLength", limit };
			if (issue.origin === "array") return { kind: "minItems", limit };
			return issue.inclusive === false
				? { kind: "exclusiveMinimum", limit }
				: { kind: "minimum", limit };
		}
		case "too_big": {
			const limit = Number(issue.maximum);
			if (issue.origin === "string") return { kind: "maxLength", limit };
			if (issue.origin === "array") return { kind: "maxItems", limit };
			return issue.inclusive === false
				? { kind: "exclusiveMaximum", limit }
				: { kind: "maximum", limit };
		}
		case "invalid_format":
			return issue.format === "regex"
				? { kind: "pattern" }
				: { kind: "format", format: issue.format };
		case "invalid_union":
			return unionRule(issue);
		default:
			return { kind: "invalid" };
	}
}

// Come `unionRule` di validation-rule.ts: un'unione di soli letterali è «valore
// non ammesso»; si scarta il ramo null e, se resta un ramo solo, vale la sua
// regola. Nullable, t.Integer e t.Date non arrivano qui (vedi t.ts).
function unionRule(issue: Extract<Issue, { code: "invalid_union" }>) {
	const branches = issue.errors.map((errors) => errors[0]).filter(Boolean);
	if (
		branches.length > 0 &&
		branches.every((first) => first.code === "invalid_value")
	)
		return { kind: "notAllowed" } as const;
	const nonNull = branches.filter(
		(first) => !(first.code === "invalid_type" && first.expected === "null"),
	);
	return nonNull.length === 1
		? issueRule({ ...nonNull[0], input: issue.input } as Issue)
		: ({ kind: "invalid" } as const);
}

// Ordine dei controlli di TypeBox sullo stesso valore (ValueErrors 0.34):
// tipo, poi minLength < maxLength < pattern < format sulle stringhe,
// exclusiveMaximum < exclusiveMinimum < maximum < minimum < multipleOf sui
// numeri, minItems < maxItems sugli array (uniqueItems dopo gli elementi).
function checkRank(issue: Issue): number {
	switch (issue.code) {
		case "invalid_type":
		case "invalid_value":
		case "invalid_union":
			return 0;
		case "too_small":
			if (issue.origin === "string" || issue.origin === "array") return 1;
			return issue.inclusive === false ? 2 : 4;
		case "too_big":
			if (issue.origin === "string" || issue.origin === "array") return 2;
			return issue.inclusive === false ? 1 : 3;
		case "invalid_format":
			return issue.format === "regex" ? 3 : 4;
		case "not_multiple_of":
			return 5;
		default:
			return ruleParams(issue)?.rule.kind === "uniqueItems" ? 9 : 0;
	}
}

const byRank = (issues: Issue[]) =>
	issues.reduce((best, issue) =>
		checkRank(issue) < checkRank(best) ? issue : best,
	);

/**
 * L'issue che TypeBox avrebbe dato per prima (`Errors(value).First()`): prima
 * i controlli, poi la decodifica (Elysia decodifica solo un valore valido);
 * in un oggetto, prima le chiavi obbligatorie mancanti, poi i campi
 * nell'ordine dello schema; sullo stesso valore, l'ordine dei controlli.
 */
export function firstIssue(issues: Issue[]): Issue {
	const checks = issues.filter((issue) => !ruleParams(issue)?.decode);
	return checks.length > 0 ? pick(checks, 0) : issues[0];
}

function pick(issues: Issue[], depth: number): Issue {
	const here = issues.filter((issue) => issue.path.length === depth);
	const below = issues.filter((issue) => issue.path.length > depth);
	const ownChecks = here.filter((issue) => checkRank(issue) < 9);
	if (ownChecks.length > 0) return byRank(ownChecks);
	if (below.length === 0) return byRank(here);
	const missing = below.find(
		(issue) => issue.path.length === depth + 1 && isMissing(issue),
	);
	if (missing) return missing;
	const key = below[0].path[depth];
	return pick(
		below.filter((issue) => issue.path[depth] === key),
		depth + 1,
	);
}
