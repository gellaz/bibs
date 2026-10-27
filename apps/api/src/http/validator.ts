import { fileTypeFromBlob } from "file-type";
import type { Context, MiddlewareHandler } from "hono";
import { getQueryParams } from "hono/utils/url";
import { z } from "zod";
import { deepTrim } from "@/http/deep-trim";
import { firstIssue } from "@/lib/schemas/issues";
import { coercedKeys, mirrorValue } from "@/lib/schemas/mirror";
import {
	fileExtensions,
	matchesFileType,
	zBooleanString,
	zNumeric,
} from "@/lib/schemas/t";
import { InvalidFileTypeError, RequestValidationError } from "./errors";
import { zodValidationMessage } from "./validation-message";

// `v(target, schema)`: il validatore delle route Hono, con le regole dell'API
// di prima (D2, D4, D5 del piano Hono). In ordine: lettura del body come
// prima (per Content-Type, non per target), trim profondo tranne le chiavi
// password (`deep-trim.ts`), default della radice e pulizia di prima
// (`lib/schemas/mirror.ts`), coercizione di query e params, default
// dello schema, campi sconosciuti tolti a ogni profondità (`z.object`),
// controllo, decodifica, magic byte dei file. Primo errore → 422 italiano.
// In una route i v() vanno params → query → body e prima dell'auth
// (`routes.ts` lo controlla a ogni avvio).
// ponytail: differenze note che nessuna route di oggi tocca (piano Hono,
// Trappole): coercizione di query e params solo al primo livello (prima
// scendeva anche negli anyOf e negli array: `?from=<epoch>` su un t.Date
// opzionale), default annidati (Zod li mette, prima no), chiavi multipart
// `a.b`/`a[0]` e fusione JSON + file non portate, pulizia dei valori oggetto di
// un t.Record e primo errore di un'unione di oggetti annidata (mirror.ts,
// issues.ts). Chi aggiunge uno schema così estende `coerce()`/`readFormData()`/
// mirror.ts/issues.ts e mette i casi in tests/http/parity-cases.ts.

export type Target = "json" | "form" | "query" | "param";

/** Schema e target di un `v()`, letti da `src/http/openapi.ts`. */
export const VALIDATES = Symbol("validates");
export interface Validates {
	target: Target;
	schema: z.ZodType;
}

type Def = z.core.$ZodTypeDef & Record<string, any>;
const defOf = (schema: z.ZodType) => schema._zod.def as Def;

/** Schema senza optional/default/nullable, per sapere che tipo c'è sotto. */
function core(schema: z.ZodType): z.ZodType {
	const def = defOf(schema);
	return def.type === "optional" ||
		def.type === "default" ||
		def.type === "nullable"
		? core(def.innerType)
		: schema;
}

const shapeOf = (schema: z.ZodType): Record<string, z.ZodType> | undefined => {
	const def = defOf(core(schema));
	return def.type === "object" ? def.shape : undefined;
};

// ── lettura dell'input ──────────────────────────────────────────────────────

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Il parser multipart di prima: una chiave ripetuta diventa un array, un
// valore testuale che inizia con { o [ e contiene un oggetto JSON diventa
// quell'oggetto (così i campi oggetto e array viaggiano come JSON).
// ponytail: non porta le chiavi `a.b` / `a[0]` né la fusione JSON + file di
// prima (`adapter/web-standard`, ~20 righe): nessuna route né client le usa,
// la differenza è nel registro dei delta; si portano col primo modulo che le usa.
async function readFormData(c: Context) {
	const form = await c.req.formData();
	const body: Record<string, unknown> = {};
	const grouped = new Map<string, FormDataEntryValue[]>();
	form.forEach((value, key) => {
		grouped.set(key, [...(grouped.get(key) ?? []), value]);
	});
	for (const [key, values] of grouped) {
		if (DANGEROUS_KEYS.has(key)) continue;
		if (values.length > 1) {
			body[key] = values;
			continue;
		}
		const value = values[0];
		body[key] = value;
		if (typeof value === "string" && /^[{[]/.test(value)) {
			try {
				const parsed = JSON.parse(value);
				if (parsed && typeof parsed === "object") body[key] = parsed;
			} catch {}
		}
	}
	return body;
}

// Il parser urlencoded di prima (`parseQuery`): chiave ripetuta → array.
function parseUrlEncoded(text: string) {
	const body: Record<string, unknown> = {};
	for (const [key, value] of new URLSearchParams(text)) {
		if (DANGEROUS_KEYS.has(key)) continue;
		const current = body[key];
		body[key] =
			current === undefined
				? value
				: Array.isArray(current)
					? [...current, value]
					: [current, value];
	}
	return body;
}

/**
 * Il body letto come prima: dal Content-Type, qualunque sia il target.
 * Senza Content-Type resta undefined («Richiesta non valida»); JSON
 * malformato lancia (→ 500, come prima).
 */
async function readBody(c: Context): Promise<unknown> {
	const header = c.req.header("content-type");
	if (!c.req.raw.body || !header) return undefined;
	const type = header.split(";")[0];
	switch (type.charCodeAt(12)) {
		case 106: // application/json
			return c.req.json();
		case 120: // application/x-www-form-urlencoded
			return parseUrlEncoded(await c.req.text());
		case 111: // application/octet-stream
			return c.req.arrayBuffer();
		case 114: // multipart/form-data
			return readFormData(c);
		default:
			return type.charCodeAt(0) === 116 ? c.req.text() : undefined;
	}
}

/** Query come prima: array da chiavi ripetute e da virgole, altrimenti l'ultima. */
function readQuery(c: Context, schema: z.ZodType) {
	const shape = shapeOf(schema) ?? {};
	const query: Record<string, unknown> = {};
	// Prima il frammento restava (`?q=a#b` → «a#b»), `c.req.queries()` lo taglia.
	const all = getQueryParams(c.req.url.replaceAll("#", "%23")) as Record<
		string,
		string[]
	>;
	for (const [key, values] of Object.entries(all)) {
		if (!values?.length) continue;
		const prop = shape[key];
		query[key] =
			prop && defOf(core(prop)).type === "array"
				? values.flatMap((value) => value.split(","))
				: values.at(-1);
	}
	return query;
}

// ── coercizione di query e params ───────────────────────────────────────────

const coerced = new WeakMap<object, z.ZodType>();

function coerceProp(prop: z.ZodType): z.ZodType {
	const def = defOf(prop);
	switch (def.type) {
		case "optional":
			return coerceProp(def.innerType).optional();
		case "default":
			return coerceProp(def.innerType).default(def.defaultValue);
		case "number":
			return zNumeric(prop);
		case "boolean":
			return zBooleanString(prop);
		default:
			return prop;
	}
}

/** Come prima: in query e params `t.Number`/`t.Boolean` al primo livello accettano stringhe. */
function coerce(schema: z.ZodType): z.ZodType {
	const hit = coerced.get(defOf(schema));
	if (hit) return hit;
	const shape = shapeOf(schema);
	const out = shape
		? z.object(
				Object.fromEntries(
					Object.entries(shape).map(([key, prop]) => [key, coerceProp(prop)]),
				),
			)
		: schema;
	coerced.set(defOf(schema), out);
	return out;
}

// ── validazione ─────────────────────────────────────────────────────────────

const ERROR_ON: Record<Target, string> = {
	json: "body",
	form: "body",
	query: "query",
	param: "params",
};

async function checkFileTypes(schema: z.ZodType, value: unknown) {
	const shape = shapeOf(schema);
	if (!shape || !value || typeof value !== "object") return;
	for (const [key, prop] of Object.entries(shape)) {
		const type = fileExtensions.get(defOf(core(prop)));
		const files = (value as Record<string, unknown>)[key];
		if (!type || files === undefined) continue;
		for (const file of [files].flat() as Blob[]) {
			const mime = (await fileTypeFromBlob(file))?.mime;
			if (!mime || !matchesFileType(mime, type))
				throw new InvalidFileTypeError(`body.${key}`);
		}
	}
}

/** Valida un input già letto; usato da `v()` e dai test. */
export async function validate<S extends z.ZodType>(
	target: Target,
	schema: S,
	raw: unknown,
): Promise<z.output<S>> {
	const isBody = target === "json" || target === "form";
	// Il valore che si controlla, come prima: body trimmato, default della radice e
	// pulizia di exact-mirror (`lib/schemas/mirror.ts`); i params li controlla com'è.
	const on = isBody ? "body" : "query";
	const value =
		target === "param"
			? raw
			: mirrorValue(schema, isBody ? deepTrim(raw) : raw, on);
	const checked = isBody ? schema : coerce(schema);
	const result = await checked.safeParseAsync(value, { reportInput: true });
	if (!result.success) {
		const issue = firstIssue(result.error.issues, {
			schema: checked,
			value,
			anyOfKeys: isBody ? coercedKeys(schema, "body") : undefined,
		});
		const decode = issue.code === "custom" && issue.params?.decode;
		throw new RequestValidationError(
			decode ? "property" : ERROR_ON[target],
			zodValidationMessage(issue, schema),
			issue.path.length ? `/${issue.path.join("/")}` : "",
			issue.code,
		);
	}
	if (isBody) await checkFileTypes(schema, result.data);
	return result.data as z.output<S>;
}

async function readInput(target: Target, schema: z.ZodType, c: Context) {
	switch (target) {
		case "query":
			return readQuery(c, schema);
		case "param":
			return c.req.param();
		default:
			return readBody(c);
	}
}

/**
 * Middleware di validazione. Tipi per `hc`: in ingresso `z.input`, in
 * `c.req.valid(target)` `z.output`. Va messo prima dei middleware di auth
 * (422 prima di 401, D9).
 */
export function v<T extends Target, S extends z.ZodType>(target: T, schema: S) {
	const middleware: MiddlewareHandler = async (c, next) => {
		const value = await validate(
			target,
			schema,
			await readInput(target, schema, c),
		);
		c.req.addValidatedData(target, value as never);
		await next();
	};
	const validates: Validates = { target, schema };
	return Object.assign(middleware, {
		[VALIDATES]: validates,
	}) as unknown as MiddlewareHandler<
		any,
		string,
		{
			in: { [K in T]: z.input<S> };
			out: { [K in T]: z.output<S> };
		}
	>;
}
