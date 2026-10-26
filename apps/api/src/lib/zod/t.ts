import { z } from "zod";
import type { ValidationRule } from "@/lib/validation-rule";
import {
	FORMATS,
	type FormatName,
	isBooleanString,
	isIntegerString,
	isNumericString,
	parseDateTimeEmptySpace,
} from "./formats";
import { firstIssue, type Issue, issueRule, type RuleParams } from "./issues";

// Costruttori Zod con la semantica dei tipi propri di Elysia (`t.Integer`,
// `t.Date`, `t.File`, `t.Files`, la coercizione di query e params, i formati):
// accettano e rifiutano gli stessi valori, danno la stessa regola nel 422 e lo
// stesso JSON Schema in /openapi. Per tutto il resto i gemelli usano Zod
// normale (`z.string().regex()`, `z.object`, `z.enum`, `.nullable()`, …) e i
// metadati con `.meta({ title, description, error })`. Corrispondenze da
// tenere: `t.Integer` di Elysia → `zInteger` (accetta "5"), `Type.Integer` di
// TypeBox → `zInt()` (non accetta stringhe; mai `z.int()`: vedi
// `integerCheck`); `t.String({ minLength, maxLength })` → `zString` (mai
// `z.string().min/max`: contano i code point); `t.Union` di oggetti →
// `z.union`, mai `z.discriminatedUnion` (dà errori che TypeBox non dà).

type Json = Record<string, unknown>;

/**
 * JSON Schema identico a quello che TypeBox scrive per il tipo di Elysia, per
 * `/openapi` (vedi `src/http/openapi.ts`). Chiave: la `def`, che `.meta()` e i
 * cloni di Zod conservano.
 */
export const elysiaJson = new WeakMap<object, Json>();

/** Tipo di file ammesso (controllo dei magic byte dopo la validazione). */
export const fileExtensions = new WeakMap<object, string | string[]>();

const defOf = (schema: z.ZodType) => schema._zod.def as object;

function register<S extends z.ZodType>(schema: S, json: Json): S {
	elysiaJson.set(defOf(schema), json);
	return schema;
}

/** Metadati che TypeBox tiene nello schema: `title` e `error` arrivano al 422. */
export interface Meta {
	title?: string;
	description?: string;
	error?: string;
}

const metaOf = ({ title, description, error }: Meta) =>
	Object.fromEntries(
		Object.entries({ title, description, error }).filter(
			([, v]) => v !== undefined,
		),
	);

type Ctx = { issues: z.core.$ZodRawIssue[] };

function fail(ctx: Ctx, input: unknown, rule: ValidationRule, decode = false) {
	const params: RuleParams = decode ? { rule, decode } : { rule };
	ctx.issues.push({ code: "custom", input, message: "", params });
	return z.NEVER;
}

const ruleOf = (issues: Issue[]) => issueRule(firstIssue(issues));

// Le risposte (`send()`) Elysia le controlla e poi le codifica, senza
// decodificarle: «5» per un t.Integer esce com'è, un numero per un t.Date è
// un 500 (l'Encode di t.Date vuole una data o una stringa).
let encoding = false;

/** Esegue `fn` (un parse sincrono) con la semantica di risposta di Elysia. */
export function asResponse<T>(fn: () => T): T {
	encoding = true;
	try {
		return fn();
	} finally {
		encoding = false;
	}
}

// Con `default` nelle opzioni (come in TypeBox) il campo diventa facoltativo in
// ingresso; senza, il tipo resta quello del costruttore.
type WithDefault<S extends z.ZodType, O> = O extends { default: unknown }
	? z.ZodDefault<S>
	: S;

function withDefault<S extends z.ZodType, O>(
	schema: S,
	value: unknown,
	json: Json,
): WithDefault<S, O> {
	const out =
		value === undefined
			? schema
			: register(schema.default(value as never) as z.ZodType, json);
	return out as WithDefault<S, O>;
}

// ── formati ─────────────────────────────────────────────────────────────────

/** `t.String({ format })` con il formato di Elysia (o il nostro calendar-date). */
export const zFormat = (format: FormatName) =>
	z.stringFormat(format, FORMATS[format]);

// ── testi ───────────────────────────────────────────────────────────────────

export interface StringOptions extends Meta {
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	/** Formato di Elysia (`t.String({ format, maxLength })`): issue di `zFormat`. */
	format?: FormatName;
}

/**
 * `minLength`/`maxLength` di TypeBox: conta le unità UTF-16 (`value.length`),
 * `z.string().min/max` di Zod 4.6 i code point («😀» è lungo 2 per TypeBox, 1
 * per Zod). Le issue sono le `too_small` e `too_big` di Zod: stessa regola e
 * stesso ordine nel 422 (`issues.ts`).
 */
export const utf16Length = ({
	minLength,
	maxLength,
}: Pick<StringOptions, "minLength" | "maxLength">) =>
	z.check<string>((ctx) => {
		const input = ctx.value;
		if (minLength !== undefined && input.length < minLength)
			ctx.issues.push({
				code: "too_small",
				origin: "string",
				minimum: minLength,
				inclusive: true,
				input,
			});
		if (maxLength !== undefined && input.length > maxLength)
			ctx.issues.push({
				code: "too_big",
				origin: "string",
				maximum: maxLength,
				inclusive: true,
				input,
			});
	});

/**
 * `t.String` con `minLength`/`maxLength` (vedi `utf16Length`), `pattern` e
 * `format`, controllati nell'ordine di TypeBox: lunghezze, pattern, formato.
 */
export function zString(options: StringOptions = {}) {
	const { pattern, format } = options;
	let schema = z.string().check(utf16Length(options));
	if (pattern !== undefined) schema = schema.regex(new RegExp(pattern));
	if (format !== undefined)
		schema = schema.check((ctx) => {
			if (!FORMATS[format](ctx.value))
				ctx.issues.push({ code: "invalid_format", format, input: ctx.value });
		});
	return register(schema.meta(metaOf(options)), {
		...options,
		type: "string",
	});
}

// ── numeri ──────────────────────────────────────────────────────────────────

export interface NumberOptions extends Meta {
	minimum?: number;
	maximum?: number;
	exclusiveMinimum?: number;
	exclusiveMaximum?: number;
	multipleOf?: number;
}

/**
 * Intero come per TypeBox (`Number.isInteger`). `z.int()` e
 * `z.number().int()` di Zod 4.6 controllano anche i limiti dei safe integer:
 * `page=9007199254740993` o `1e20` sarebbero 422, e con un massimo il primo
 * errore diventerebbe «al massimo 9007199254740991».
 */
export const integerCheck = z.check<number>((ctx) => {
	if (!Number.isInteger(ctx.value))
		ctx.issues.push({
			code: "invalid_type",
			expected: "int",
			input: ctx.value,
		});
});

/** `Type.Integer` di TypeBox (form condivisi): intero, niente stringhe. */
export const zInt = () => z.number().check(integerCheck);

function numberChecks<S extends z.ZodNumber>(schema: S, o: NumberOptions) {
	let s: z.ZodNumber = schema;
	if (o.exclusiveMaximum !== undefined) s = s.lt(o.exclusiveMaximum);
	if (o.exclusiveMinimum !== undefined) s = s.gt(o.exclusiveMinimum);
	if (o.maximum !== undefined) s = s.lte(o.maximum);
	if (o.minimum !== undefined) s = s.gte(o.minimum);
	if (o.multipleOf !== undefined) s = s.multipleOf(o.multipleOf);
	return s;
}

const parseRule = (schema: z.ZodType, value: unknown) => {
	const r = schema.safeParse(value, { reportInput: true });
	return r.success ? undefined : ruleOf(r.error.issues);
};

/**
 * `t.Integer` di Elysia: intero, o stringa che rappresenta un intero (anche nel
 * body JSON e nel multipart). La stringa passa il controllo e si decodifica
 * dopo: se il numero non rispetta i vincoli, l'errore perde il campo
 * («Valore non valido: deve essere almeno 1»), come in Elysia.
 */
export function zInteger<O extends NumberOptions & { default?: number }>(
	options: O = {} as O,
) {
	const { default: defaultValue, ...o } = options;
	const inner = numberChecks(zInt(), o);
	const schema = z
		.custom<number | string>(() => true)
		.transform((value, ctx) => {
			if (typeof value === "string" && isIntegerString(value)) {
				if (encoding) return value as unknown as number;
				const n = +value;
				const rule = parseRule(inner, n);
				return rule ? fail(ctx, n, rule, true) : n;
			}
			// TypeBox rivalida sul ramo Integer: tutto ciò che non è un numero
			// finito (anche `1e400` del JSON, Infinity) è «deve essere un numero
			// intero»; Zod direbbe «deve essere un numero».
			const rule =
				typeof value === "number" && Number.isFinite(value)
					? parseRule(inner, value)
					: value === undefined
						? ({ kind: "required" } as const)
						: ({ kind: "integer" } as const);
			return rule ? fail(ctx, value, rule) : (value as number);
		})
		.meta(metaOf(o));
	const all = { ...options } as Json;
	const json: Json = {
		anyOf: [
			{ type: "string", format: "integer", default: 0 },
			{ type: "integer", ...all },
		],
		...all,
	};
	register(schema, json);
	return withDefault<typeof schema, O>(schema, defaultValue, json);
}

/** Query e params: `t.Number` diventa il `Numeric` di Elysia. */
export function zNumeric(inner: z.ZodType) {
	return z
		.custom<number | string>(() => true)
		.transform((value, ctx) => {
			if (typeof value === "string" && isNumericString(value)) {
				const n = +value;
				const rule = parseRule(inner, n);
				return rule ? fail(ctx, n, rule, true) : n;
			}
			if (typeof value === "number" && !parseRule(inner, value)) return value;
			// Unione di due rami (stringa numerica, numero): TypeBox non sa quale.
			return fail(
				ctx,
				value,
				value === undefined ? { kind: "required" } : { kind: "invalid" },
			);
		});
}

/** Query e params: `t.Boolean` diventa il `BooleanString` di Elysia. */
export function zBooleanString(inner: z.ZodType) {
	return z
		.custom<boolean | string>(() => true)
		.transform((value, ctx) => {
			if (typeof value === "string" && isBooleanString(value))
				return value === "true";
			if (typeof value === "boolean" && !parseRule(inner, value)) return value;
			return fail(
				ctx,
				value,
				value === undefined ? { kind: "required" } : { kind: "invalid" },
			);
		});
}

// ── date ────────────────────────────────────────────────────────────────────

/**
 * `t.Date` di Elysia: `Date`, stringa `date-time` (largo, di Elysia) o `date`
 * (ISO stretto, vedi `formats.ts`) o timestamp numerico, decodificati in `Date`. In risposta il `Date`
 * esce come stringa ISO con `JSON.stringify`.
 */
export function zDate<O extends Meta & { default?: string | Date }>(
	options: O = {} as O,
) {
	const { default: defaultValue, ...o } = options;
	const schema = z
		.custom<Date | string | number>(() => true)
		.transform((value, ctx) => {
			if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
			let date: Date | undefined;
			if (typeof value === "number" && Number.isFinite(value) && !encoding)
				date = new Date(value);
			else if (
				typeof value === "string" &&
				(FORMATS["date-time"](value) || FORMATS.date(value))
			)
				date = new Date(parseDateTimeEmptySpace(value));
			if (!date)
				return fail(
					ctx,
					value,
					value === undefined ? { kind: "required" } : { kind: "date" },
				);
			return Number.isNaN(date.getTime())
				? fail(ctx, date, { kind: "invalid" }, true)
				: date;
		})
		.meta(metaOf(o));
	const fallback =
		defaultValue === undefined ? undefined : new Date(defaultValue);
	const all = { ...options } as Json;
	const json: Json = {
		anyOf: [
			{ type: "Date", ...all },
			{ type: "string", format: "date-time", default: fallback?.toISOString() },
			{ type: "string", format: "date", default: fallback?.toISOString() },
			{ type: "number", default: fallback?.getTime() },
		],
		...all,
	};
	register(schema, json);
	return withDefault<typeof schema, O>(schema, fallback, json);
}

// ── file ────────────────────────────────────────────────────────────────────

export interface FileOptions extends Meta {
	/** MIME ammesso: prefisso (`image`) o `tipo/*`; controllato anche sui byte. */
	type?: string | string[];
	minSize?: number | `${number}${"k" | "m"}`;
	maxSize?: number | `${number}${"k" | "m"}`;
}

const fileSize = (size: number | string) =>
	typeof size === "number"
		? size
		: size.endsWith("k")
			? +size.slice(0, -1) * 1024
			: size.endsWith("m")
				? +size.slice(0, -1) * 1048576
				: +size;

/** Il tipo dichiarato (o rilevato) rispetta `type`, come `checkFileExtension` di Elysia. */
export const matchesFileType = (mime: string, type: string | string[]) =>
	[type]
		.flat()
		.some(
			(t) =>
				mime.startsWith(t) ||
				(t.endsWith("/*") && mime.startsWith(t.slice(0, -1))),
		);

function validFile(o: FileOptions, value: unknown) {
	return (
		value instanceof Blob &&
		!(o.minSize && value.size < fileSize(o.minSize)) &&
		!(o.maxSize && value.size > fileSize(o.maxSize)) &&
		(!o.type || matchesFileType(value.type, o.type))
	);
}

/** `t.File` di Elysia. */
export function zFile(options: FileOptions = {}) {
	const schema = z
		.custom<File>(() => true)
		.transform((value, ctx) => {
			if (value === undefined) return fail(ctx, value, { kind: "required" });
			return validFile(options, value)
				? value
				: fail(ctx, value, { kind: "fileType" });
		})
		.meta(metaOf(options));
	if (options.type) fileExtensions.set(defOf(schema), options.type);
	return register(schema, {
		default: "File",
		...options,
		extension: options.type,
		type: "string",
		format: "binary",
	});
}

/** `t.Files` di Elysia: un file solo diventa un array di un elemento. */
export function zFiles(
	options: FileOptions & { minItems?: number; maxItems?: number } = {},
) {
	const schema = z
		.custom<File | File[]>(() => true)
		.transform((value, ctx) => {
			if (value === undefined) return fail(ctx, value, { kind: "required" });
			const { minItems, maxItems } = options;
			const files = Array.isArray(value) ? value : [value];
			const ok =
				!(minItems && minItems > 1 && !Array.isArray(value)) &&
				!(minItems && files.length < minItems) &&
				!(maxItems && files.length > maxItems) &&
				files.every((file) => validFile(options, file));
			return ok ? files : fail(ctx, value, { kind: "fileType" });
		})
		.meta(metaOf(options));
	if (options.type) fileExtensions.set(defOf(schema), options.type);
	return register(schema, {
		...options,
		elysiaMeta: "Files",
		default: "Files",
		extension: options.type,
		type: "array",
		items: { ...options, default: "Files", type: "string", format: "binary" },
	});
}
