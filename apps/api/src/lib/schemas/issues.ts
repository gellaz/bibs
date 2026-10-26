import type { z } from "zod";
import type { ValidationRule } from "@/lib/validation-rule";
import { isAnyOf, nodeAt, unwrap } from "./mirror";
import { integerCheck } from "./t";

// Dalle issue di Zod alla regola di `validation-rule.ts` e all'errore che
// l'API di prima avrebbe dato per primo: i 422 restano identici al
// byte (D6 del piano Hono). Zod raccoglie tutte le issue; prima ce n'era una
// sola, nel suo ordine di visita, che qui si ricostruisce.

export type Issue = z.core.$ZodIssue;

/** Parametri delle issue `custom` dei costruttori di `t.ts`: regola già decisa. */
export interface RuleParams {
	rule: ValidationRule;
	/** Errore della decodifica (coercizione): il campo si perde, come prima. */
	decode?: boolean;
}

export function ruleParams(issue: Issue): RuleParams | undefined {
	return issue.code === "custom"
		? (issue.params as RuleParams | undefined)
		: undefined;
}

const isDecode = (issue: Issue) => !!ruleParams(issue)?.decode;

// `Type.Integer` (gemello `zInt()`): un non numero è «deve essere un numero
// intero», ma Zod dice solo `expected: "number"`.
function isInt(node: z.ZodType | undefined) {
	if (!node) return false;
	const def = unwrap(node).node._zod.def as Record<string, any>;
	return def.type === "number" && !!def.checks?.includes(integerCheck);
}

/**
 * La regola violata, come la dava l'API di prima sull'errore equivalente;
 * `node` è lo schema che ha prodotto l'issue (per `zInt()`).
 */
export function issueRule(issue: Issue, node?: z.ZodType): ValidationRule {
	const custom = ruleParams(issue);
	if (custom) return custom.rule;
	if (issue.input === undefined) return { kind: "required" };
	switch (issue.code) {
		case "invalid_type":
			switch (issue.expected) {
				case "string":
					return { kind: "string" };
				case "number":
					return isInt(node) ? { kind: "integer" } : { kind: "number" };
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
// regola. t.Integer e t.Date non arrivano qui (vedi t.ts); t.Nullable passa da
// `collapse`.
function unionRule(issue: Extract<Issue, { code: "invalid_union" }>) {
	const branches = issue.errors.map((errors) => errors[0]).filter(Boolean);
	if (
		branches.length > 0 &&
		branches.every((first) => first.code === "invalid_value")
	)
		return { kind: "notAllowed" } as const;
	if (
		branches.some(
			(first) => first.code === "invalid_type" && first.expected === "date",
		)
	)
		return { kind: "date" } as const;
	const nonNull = branches.filter(
		(first) => !(first.code === "invalid_type" && first.expected === "null"),
	);
	return nonNull.length === 1
		? issueRule({
				...nonNull[0],
				input: valueAt(issue.input, nonNull[0].path),
			} as Issue)
		: ({ kind: "invalid" } as const);
}

// Ordine dei controlli di prima sullo stesso valore:
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

function valueAt(value: unknown, path: PropertyKey[]) {
	let v = value;
	for (const key of path)
		v =
			v && typeof v === "object"
				? (v as Record<PropertyKey, unknown>)[key]
				: undefined;
	return v;
}

// ── unioni ──────────────────────────────────────────────────────────────────

// Un'unione che prima passava il controllo (un ramo ha solo errori di
// decodifica: «5000» per un t.Integer con massimo 1000) fallisce nella
// decodifica del primo ramo che passa il controllo: l'errore è il suo.
function decodeOnly(issues: Issue[]): Issue[] | undefined {
	const out: Issue[] = [];
	for (const issue of issues) {
		const inner = isDecode(issue)
			? [issue]
			: issue.code === "invalid_union"
				? unionDecode(issue)
				: undefined;
		if (!inner) return undefined;
		out.push(...inner);
	}
	return out;
}

function unionDecode(issue: Extract<Issue, { code: "invalid_union" }>) {
	for (const branch of issue.errors) {
		const decode = decodeOnly(branch);
		if (decode)
			return decode.map((i) => ({ ...i, path: [...issue.path, ...i.path] }));
	}
	return undefined;
}

/** Il path del primo nodo anyOf (t.Nullable, unione) sopra o sull'issue. */
function anyOfAt(checked: Checked, path: PropertyKey[]) {
	for (let i = 0; i <= path.length; i++) {
		if (i === 1 && checked.anyOfKeys?.has(String(path[0]))) return i;
		const node = nodeAt(checked.schema, path.slice(0, i));
		if (!node) return undefined;
		if (isAnyOf(unwrap(node).node)) return i;
	}
	return undefined;
}

// Prima un errore dentro un anyOf (t.Nullable di un oggetto o di un
// array) stava sul nodo dell'unione, con la regola del primo errore del ramo non
// nullo e senza i metadati annidati; Zod lo passa col path completo.
function collapse(issues: Issue[], checked: Checked) {
	const { schema, value } = checked;
	const groups = new Map<string, { at: PropertyKey[]; issues: Issue[] }>();
	const out: (Issue | { at: PropertyKey[]; issues: Issue[] })[] = [];
	for (const issue of issues) {
		const depth = isDecode(issue) ? undefined : anyOfAt(checked, issue.path);
		if (depth === undefined) {
			out.push(issue);
			continue;
		}
		const at = issue.path.slice(0, depth);
		const key = JSON.stringify(at);
		const group = groups.get(key);
		if (group) group.issues.push(issue);
		else {
			const created = { at, issues: [issue] };
			groups.set(key, created);
			out.push(created);
		}
	}
	return out.map((item): Issue => {
		if (!("at" in item)) return item;
		const { at } = item;
		let inner = item.issues;
		// ObjectString/ArrayString dei body con file: due rami non nulli.
		const coerced = at.length === 1 && checked.anyOfKeys?.has(String(at[0]));
		const node = unwrap(nodeAt(schema, at) as z.ZodType).node;
		const def = node._zod.def as Record<string, any>;
		// t.Nullable o `Type.Union([X, Type.Null()])` dei form condivisi: per
		// prima erano lo stesso anyOf, la regola è quella del ramo non nullo.
		const nonNull =
			def.type === "union"
				? def.options.filter((o: z.ZodType) => o._zod.def.type !== "null")
				: [];
		const branch: z.ZodType | undefined =
			def.type === "nullable"
				? def.innerType
				: nonNull.length === 1
					? nonNull[0]
					: undefined;
		// Un errore di tipo nel ramo X di `Type.Union([X, Type.Null()])` fa
		// fallire entrambi i rami: Zod dà un solo `invalid_union` sul campo, con
		// le issue di X in `errors`. Si prendono quelle, come per t.Nullable
		// (`dayOfWeek: "1"` è «numero intero» solo guardando lo schema di X).
		const union = inner[0];
		const expanded =
			!coerced &&
			def.type === "union" &&
			!!branch &&
			inner.length === 1 &&
			union.code === "invalid_union" &&
			union.path.length === at.length;
		if (expanded)
			inner = (union as Extract<Issue, { code: "invalid_union" }>).errors[
				def.options.indexOf(branch)
			].map((i) => ({ ...i, path: [...at, ...i.path] }) as Issue);
		// Zod dà l'errore dell'unico ramo che combacia col tipo (stringa troppo
		// lunga); prima, con più rami non nulli, «valore non valido».
		const manyBranches = nonNull.length > 1;
		if (
			!coerced &&
			!expanded &&
			inner.length === 1 &&
			inner[0].path.length === at.length &&
			!(manyBranches && inner[0].code !== "invalid_union")
		)
			return inner[0];
		const input = valueAt(value, at);
		let rule: ValidationRule =
			input === undefined ? { kind: "required" } : { kind: "invalid" };
		if (!coerced && branch) {
			const relative = inner.map((i) => ({
				...i,
				path: i.path.slice(at.length),
			}));
			const first = firstIssue(relative, { schema: branch, value: input });
			rule = issueRule(
				{ ...first, input: valueAt(input, first.path) } as Issue,
				nodeAt(branch, first.path),
			);
		}
		const params: RuleParams = { rule };
		return { code: "custom", path: at, input, message: "", params } as Issue;
	});
}

// ── ordine di prima ─────────────────────────────────────────────────────────

const NO_VALUE = Symbol("no-value");

/** Lo schema e il valore che si controlla davvero (`lib/schemas/mirror.ts`). */
export interface Checked {
	schema: z.ZodType;
	value: unknown;
	/** Body con file: campi oggetto e array resi unioni, come prima (`coercedKeys`). */
	anyOfKeys?: Set<string>;
}

/**
 * L'issue che l'API di prima avrebbe dato per prima: prima
 * i controlli, poi la decodifica (si decodifica solo un valore valido);
 * in un oggetto, prima le chiavi obbligatorie che non ci sono (nel valore
 * ripulito come prima, `mirror.ts`), poi i campi nell'ordine dello schema;
 * sullo stesso valore, l'ordine dei controlli. Senza `checked` (schema e
 * valore controllato) una chiave manca se il suo input è undefined.
 */
export function firstIssue(issues: Issue[], checked?: Checked): Issue {
	let all = issues.flatMap((issue) =>
		issue.code === "invalid_union" ? (unionDecode(issue) ?? [issue]) : [issue],
	);
	if (checked) all = collapse(all, checked);
	const checks = all.filter((issue) => !isDecode(issue));
	return checks.length > 0
		? pick(checks, 0, checked ? checked.value : NO_VALUE)
		: all[0];
}

function isMissing(issue: Issue, parent: unknown) {
	if (isDecode(issue)) return false;
	if (parent === NO_VALUE) return issue.input === undefined;
	// Come prima: `Object.getOwnPropertyNames(value).includes(key)`.
	return (
		!!parent &&
		typeof parent === "object" &&
		!Array.isArray(parent) &&
		!Object.getOwnPropertyNames(parent).includes(String(issue.path.at(-1)))
	);
}

function pick(issues: Issue[], depth: number, value: unknown): Issue {
	const here = issues.filter((issue) => issue.path.length === depth);
	const below = issues.filter((issue) => issue.path.length > depth);
	const ownChecks = here.filter((issue) => checkRank(issue) < 9);
	if (ownChecks.length > 0) return byRank(ownChecks);
	if (below.length === 0) return byRank(here);
	const missing = below.find(
		(issue) => issue.path.length === depth + 1 && isMissing(issue, value),
	);
	if (missing) return missing;
	const key = below[0].path[depth];
	return pick(
		below.filter((issue) => issue.path[depth] === key),
		depth + 1,
		value === NO_VALUE ? NO_VALUE : valueAt(value, [key]),
	);
}
