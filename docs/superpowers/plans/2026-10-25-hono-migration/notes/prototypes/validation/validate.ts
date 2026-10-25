// Elysia-parity validation for Hono + TypeBox 1 (PROBE).
// Request: coerce (query/param, like Elysia) → Default → Clean (= normalize) →
// trim (json/form, = plugins/normalize.ts) → Check → file magic bytes → Decode.
// Response: Clean → Encode → Check; a response off-schema is a 500, like Elysia.
import type { Context, Env, MiddlewareHandler } from "hono";
import { validator } from "hono/validator";
import Type, {
	type StaticDecode,
	type StaticEncode,
	type TSchema,
} from "typebox";
import { Value } from "typebox/value";
import { DecodeConstraintError } from "@/lib/t";
import { firstError, type RuleInput } from "@/lib/validation-rule";

type AnySchema = TSchema & Record<string, any>;
type Target = "json" | "form" | "query" | "param";

export class RequestValidationError extends Error {
	constructor(
		/** Elysia's `error.type`: body | query | params | property (decode, path lost) */
		public type: string,
		public valueError?: RuleInput,
	) {
		super("Validation error");
	}
	get customError(): unknown {
		return this.valueError?.schema.error;
	}
}
export class ResponseValidationError extends Error {
	constructor(public valueError?: RuleInput) {
		super("Response validation error");
	}
}
export class InvalidFileTypeError extends Error {
	constructor(public property: string) {
		super("Invalid file type");
	}
}

// ── Elysia's query/param coercion: top-level number → Numeric, boolean → BooleanString ──
const recheck = (inner: TSchema) => (v: string | number) => {
	const n = +v;
	if (!Value.Check(inner, n)) throw new DecodeConstraintError(inner, n);
	return n;
};
// Union options = the field's options without `type` (Elysia passes the user options).
const opts = ({ type: _, ...o }: AnySchema) => o;
const Numeric = (s: AnySchema) =>
	Type.Codec(
		Type.Union([Type.String({ format: "numeric", default: 0 }), s], opts(s)),
	)
		.Decode((v) => recheck(s)(v as string | number))
		.Encode((n) => n);
const BooleanString = (s: AnySchema) =>
	Type.Codec(
		Type.Union(
			[s, Type.String({ format: "boolean", default: false })],
			opts(s),
		),
	)
		.Decode((v) => (typeof v === "string" ? v === "true" : v))
		.Encode((b) => b);
const coerced = new WeakMap<TSchema, TSchema>();
function coerceSchema(schema: AnySchema): TSchema {
	const hit = coerced.get(schema);
	if (hit) return hit;
	let out: TSchema = schema;
	if (schema.type === "object" && schema.properties) {
		const props = Object.fromEntries(
			Object.entries(schema.properties as Record<string, AnySchema>).map(
				([k, p]) => {
					const c =
						p.type === "number"
							? Numeric(p)
							: p.type === "boolean"
								? BooleanString(p)
								: p;
					return [k, c !== p && p["~optional"] ? Type.Optional(c) : c];
				},
			),
		);
		out = Type.Object(props);
	}
	coerced.set(schema, out);
	return out;
}

function deepTrim(value: unknown): unknown {
	if (typeof value === "string") return value.trim();
	if (
		value === null ||
		value === undefined ||
		value instanceof Blob ||
		value instanceof Date
	)
		return value;
	if (Array.isArray(value)) return value.map(deepTrim);
	if (typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [
				k,
				/password/i.test(k) ? v : deepTrim(v),
			]),
		);
	return value;
}

async function checkFileTypes(
	schema: AnySchema,
	value: Record<string, unknown>,
) {
	// ponytail: file-type is only Elysia's peer today; the real port adds it to apps/api deps.
	const { fileTypeFromBlob } = await import("file-type" as string);
	for (const [key, prop] of Object.entries(
		(schema.properties ?? {}) as Record<string, AnySchema>,
	)) {
		const ext = (prop["x-file"] ?? prop.items?.["x-file"])?.extension;
		if (!ext || value[key] === undefined) continue;
		for (const file of [value[key]].flat() as Blob[]) {
			const mime = (await fileTypeFromBlob(file))?.mime ?? "";
			const ok = [ext]
				.flat()
				.some(
					(e: string) =>
						mime.startsWith(e) ||
						(e.endsWith("/*") && mime.startsWith(e.slice(0, -1))),
				);
			if (!ok) throw new InvalidFileTypeError(`body.${key}`);
		}
	}
}

const ELYSIA_TYPE: Record<Target, string> = {
	json: "body",
	form: "body",
	query: "query",
	param: "params",
};

export function parse<T extends TSchema>(
	target: Target,
	schema: T,
	raw: unknown,
): StaticDecode<T> | Promise<StaticDecode<T>> {
	const s =
		target === "query" || target === "param"
			? coerceSchema(schema as AnySchema)
			: schema;
	let value = raw;
	if (target === "query" && value && typeof value === "object") {
		// Hono gives repeated keys as arrays; Elysia keeps the last one for non-array fields.
		const props = (s as AnySchema).properties ?? {};
		value = Object.fromEntries(
			Object.entries(value).map(([k, v]) => [
				k,
				Array.isArray(v) && props[k]?.type !== "array" ? v.at(-1) : v,
			]),
		);
	}
	value = Value.Default(s, target === "form" ? value : Value.Clone(value));
	value = Value.Clean(s, value);
	if (target === "json" || target === "form") value = deepTrim(value);
	if (!Value.Check(s, value))
		throw new RequestValidationError(ELYSIA_TYPE[target], firstError(s, value));
	const decode = () => {
		try {
			return Value.Decode(s, value) as StaticDecode<T>;
		} catch (e) {
			if (e instanceof DecodeConstraintError) {
				const inner = firstError(e.schema, e.value);
				throw new RequestValidationError(
					"property",
					inner && { ...inner, path: "" },
				);
			}
			throw e;
		}
	};
	return target === "form"
		? checkFileTypes(s as AnySchema, value as Record<string, unknown>).then(
				decode,
			)
		: decode();
}

/**
 * Validator middleware. `in` = wire type (hc input), `out` = decoded type (c.req.valid).
 * Works on hono 4 and 5 (only `hono/validator`).
 */
export function v<
	T extends TSchema,
	K extends Target,
	E extends Env = any,
	P extends string = any,
>(target: K, schema: T) {
	return validator(target, async (raw, c) => {
		// Elysia: no Content-Type at all → body undefined → "Richiesta non valida".
		const value =
			target === "json" && !c.req.header("content-type") ? undefined : raw;
		return parse(target, schema, value);
	}) as unknown as MiddlewareHandler<
		E,
		P,
		{ in: { [k in K]: StaticEncode<T> }; out: { [k in K]: StaticDecode<T> } }
	>;
}

/** Response normalize: strip fields off-schema, encode (Date → ISO), check. */
export function encode<T extends TSchema>(
	schema: T,
	data: StaticDecode<T>,
): StaticEncode<T> {
	const cleaned = Value.Clean(schema, Value.Clone(data));
	let encoded: unknown;
	try {
		encoded = Value.Encode(schema, cleaned);
	} catch {
		throw new ResponseValidationError(firstError(schema, cleaned));
	}
	if (!Value.Check(schema, encoded))
		throw new ResponseValidationError(firstError(schema, encoded));
	return encoded as StaticEncode<T>;
}

/** hono 4/5: `return send(c, Schema, data)` instead of `return c.json(data)`; hc sees the schema's wire type. */
export const send = <T extends TSchema>(
	c: Context,
	schema: T,
	data: StaticDecode<T>,
) => c.json(encode(schema, data) as StaticEncode<T>, 200);

/** hono 5 `defineHandler({ response: out(Schema) })`: the function form, no Standard Schema needed. */
export const out =
	<T extends TSchema>(schema: T) =>
	(value: StaticDecode<T>) =>
		encode(schema, value);
