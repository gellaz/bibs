import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import { elysiaJson, integerCheck } from "@/lib/zod/t";
import { assertRoutes, DOC, type ModuleGuards } from "./routes";
import { VALIDATES, type Validates } from "./validator";

// OpenAPI delle route Hono (D11 del piano Hono): ogni route porta `doc(…)` e i
// suoi `v(…)`; il generatore legge `app.routes`, converte gli schemi Zod nel
// JSON Schema che TypeBox scriverebbe per il gemello e applica le stesse
// trasformazioni di `@elysiajs/openapi` 1.4.16 (MIT), così `/openapi` resta
// identico. Durante lo strangler i path si uniscono al documento di Elysia.

type Json = Record<string, any>;

export interface RouteDetail {
	summary?: string;
	description?: string;
	tags?: string[];
	security?: Record<string, string[]>[];
	operationId?: string;
	hide?: boolean;
}

export interface RouteDoc {
	detail?: RouteDetail;
	/** Risposte per status, come la `response` di Elysia. */
	response?: Record<number, z.ZodType>;
}

/** Metadati OpenAPI di una route: middleware che non fa niente. */
export function doc(meta: RouteDoc): MiddlewareHandler {
	const middleware: MiddlewareHandler = (_c, next) => next();
	return Object.assign(middleware, { [DOC]: meta });
}

// ── Zod → JSON Schema come lo scrive TypeBox ────────────────────────────────

const defOf = (schema: z.ZodType) => schema._zod.def as Json;

function overrideNode(ctx: { zodSchema: unknown; jsonSchema: Json }) {
	const schema = ctx.zodSchema as z.ZodType;
	const json = ctx.jsonSchema;
	const registered = elysiaJson.get(defOf(schema));
	if (registered) {
		for (const key of Object.keys(json)) delete json[key];
		Object.assign(json, JSON.parse(JSON.stringify(registered)));
		return;
	}
	const def = defOf(schema);
	// TypeBox mette in `required` ogni campo non Optional, anche con default.
	if (def.type === "object") {
		const required = Object.entries(def.shape as Record<string, z.ZodType>)
			.filter(([, prop]) => defOf(prop).type !== "optional")
			.map(([key]) => key);
		if (required.length) json.required = required;
		else delete json.required;
	}
	// t.Nullable: unione con null marcata `nullable: true`.
	if (def.type === "nullable") json.nullable = true;
	// t.Record(t.String(), X): TypeBox scrive `patternProperties` con la chiave
	// `^(.*)$`, Zod `propertyNames` + `additionalProperties` (U7).
	if (def.type === "record") {
		json.patternProperties = { "^(.*)$": json.additionalProperties };
		delete json.additionalProperties;
		delete json.propertyNames;
	}
	// Unione di letterali: TypeBox scrive un anyOf di `const`.
	if (def.type === "enum") {
		const values = json.enum as unknown[];
		delete json.enum;
		delete json.type;
		json.anyOf = values.map((value) => ({ const: value, type: typeof value }));
	}
	// zInt(): Zod lo vede come `number`, TypeBox scrive `integer`.
	if (def.type === "number" && def.checks?.includes(integerCheck))
		json.type = "integer";
}

// Dopo gli override Zod compatta `anyOf: [{type: a}, {type: b}]` in
// `type: [a, b]` (es. `z.union([z.string(), z.number(), z.boolean()])`);
// TypeBox scrive sempre l'anyOf. Un nullable torna `type: [X, "null"]` con
// `nullTo31`, come per Elysia.
function expandTypeArrays(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(expandTypeArrays);
	if (!node || typeof node !== "object") return node;
	const out: Json = {};
	for (const [key, value] of Object.entries(node))
		if (key === "type" && Array.isArray(value))
			out.anyOf = value.map((type) => ({ type }));
		else out[key] = expandTypeArrays(value);
	return out;
}

/** JSON Schema di uno schema Zod, come TypeBox lo scrive per il gemello. */
export function toJsonSchema(schema: z.ZodType): Json {
	const { $schema: _, ...json } = z.toJSONSchema(schema, {
		io: "input",
		unrepresentable: "any",
		reused: "inline",
		override: overrideNode,
	});
	return expandTypeArrays(json) as Json;
}

// ── trasformazioni di @elysiajs/openapi 1.4.16 ──────────────────────────────

const capitalize = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

function toOperationId(method: string, path: string) {
	let id = method.toLowerCase();
	if (!path || path === "/") return `${id}Index`;
	for (const segment of path.split("/"))
		id += segment.includes(":")
			? `By${capitalize(segment.replace(":", ""))}`
			: capitalize(segment);
	return id.replace(/\?/g, "Optional");
}

// enumToOpenApi + il ramo Date di t.Date (Type.Date si mostra come date-time).
function toOpenApiSchema(s: any): any {
	if (!s || typeof s !== "object") return s;
	if (
		Array.isArray(s.anyOf) &&
		s.anyOf.length > 0 &&
		s.anyOf.every(
			(i: any) => i && typeof i === "object" && i.const !== undefined,
		)
	)
		return { type: "string", enum: s.anyOf.map((i: any) => i.const) };
	if (s.type === "object" && s.properties)
		return {
			...s,
			properties: Object.fromEntries(
				Object.entries(s.properties).map(([k, v]) => [k, toOpenApiSchema(v)]),
			),
		};
	if (s.type === "array" && s.items)
		return { ...s, items: toOpenApiSchema(s.items) };
	if (Array.isArray(s.anyOf)) {
		const seen = new Set<string>();
		const asJson = (i: any) =>
			i?.type === "Date"
				? { type: "string", format: "date-time" }
				: toOpenApiSchema(i);
		const mapped = s.anyOf.map(asJson).filter((i: any) => {
			const key = JSON.stringify(
				Object.fromEntries(
					Object.entries(i).sort(([a], [b]) => (a < b ? -1 : 1)),
				),
			);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
		return mapped.length === 1 ? mapped[0] : { ...s, anyOf: mapped };
	}
	return s;
}

// nullToOpenApi, ramo OpenAPI 3.1: anyOf [X, null] con X a tipo singolo → type [X, "null"].
const MAP_KEYS = new Set([
	"properties",
	"patternProperties",
	"$defs",
	"definitions",
	"dependentSchemas",
]);
const ARRAY_KEYS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const VALUE_KEYS = new Set([
	"items",
	"additionalProperties",
	"unevaluatedProperties",
	"contains",
	"not",
	"if",
	"then",
	"else",
	"propertyNames",
]);
const isObj = (v: unknown): v is Json =>
	!!v && typeof v === "object" && !Array.isArray(v);

function nullTo31(value: any): any {
	if (Array.isArray(value)) return value.map(nullTo31);
	if (!isObj(value)) return value;
	const out: Json = { ...value };
	for (const key of ["anyOf", "oneOf"]) {
		const union = out[key];
		if (!Array.isArray(union)) continue;
		const nonNull = union.filter((i) => !isObj(i) || i.type !== "null");
		if (nonNull.length === union.length) continue;
		const nn = nonNull.map(nullTo31);
		if (nn.length === 1 && isObj(nn[0]) && typeof nn[0].type === "string") {
			delete out[key];
			Object.assign(out, nn[0]);
			out.type = [nn[0].type, "null"];
		} else out[key] = union.map(nullTo31);
	}
	for (const [k, v] of Object.entries(out)) {
		if (MAP_KEYS.has(k) && isObj(v))
			out[k] = Object.fromEntries(
				Object.entries(v).map(([n, c]) => [n, nullTo31(c)]),
			);
		else if (ARRAY_KEYS.has(k) && Array.isArray(v)) out[k] = v.map(nullTo31);
		else if (VALUE_KEYS.has(k) && isObj(v)) out[k] = nullTo31(v);
	}
	return out;
}

const openApiSchema = (schema?: z.ZodType) =>
	schema ? nullTo31(toOpenApiSchema(toJsonSchema(schema))) : undefined;

// ── route → paths ───────────────────────────────────────────────────────────

interface Operation extends RouteDoc {
	method: string;
	path: string;
	params?: z.ZodType;
	query?: z.ZodType;
	body?: z.ZodType;
}

/** Le operazioni di una sub-app, con i path sotto `prefix` (il mount). */
export function operations(app: Hono<any, any, any>, prefix = ""): Operation[] {
	const byRoute = new Map<string, Operation>();
	for (const route of app.routes) {
		if (route.method === "ALL") continue;
		const path = `${prefix}${route.path === "/" && prefix ? "" : route.path}`;
		const key = `${route.method} ${path}`;
		const op = byRoute.get(key) ?? { method: route.method, path };
		const handler = route.handler as {
			[DOC]?: RouteDoc;
			[VALIDATES]?: Validates;
		};
		const meta = handler[DOC];
		if (meta) Object.assign(op, meta);
		const validates = handler[VALIDATES];
		if (validates) {
			const slot =
				validates.target === "param"
					? "params"
					: validates.target === "query"
						? "query"
						: "body";
			op[slot] = validates.schema;
		}
		byRoute.set(key, op);
	}
	return [...byRoute.values()].filter((op) => op.detail || op.response);
}

/** I `paths` OpenAPI delle operazioni, come li scrive `@elysiajs/openapi`. */
export function generatePaths(ops: Operation[]) {
	const paths: Json = {};
	for (const r of ops) {
		const method = r.method.toLowerCase();
		if (r.detail?.hide || method === "options") continue;
		const op: Json = { ...r.detail };
		const parameters: Json[] = [];
		const params = openApiSchema(r.params);
		if (params?.properties)
			for (const [name, schema] of Object.entries(params.properties))
				parameters.push({ name, in: "path", required: true, schema });
		else
			for (const m of r.path.matchAll(/:([^/]+)/g))
				parameters.push({
					name: m[1].replace("?", ""),
					in: "path",
					required: true,
					schema: { type: "string" },
				});
		const query = openApiSchema(r.query);
		if (query?.properties)
			for (const [name, schema] of Object.entries(query.properties))
				parameters.push({
					name,
					in: "query",
					required: (query.required ?? []).includes(name),
					schema,
				});
		if (parameters.length) op.parameters = parameters;
		const body = openApiSchema(r.body);
		if (body && method !== "get" && method !== "head") {
			const { description } = body;
			op.requestBody = {
				description,
				required: true,
				content: ["string", "number", "integer", "boolean"].includes(body.type)
					? { "text/plain": { schema: body } }
					: {
							"application/json": { schema: body },
							"application/x-www-form-urlencoded": { schema: body },
							"multipart/form-data": { schema: body },
						},
			};
		}
		if (r.response) {
			op.responses = {};
			for (const [status, schema] of Object.entries(r.response)) {
				const res = openApiSchema(schema);
				op.responses[status] = {
					description: res.description ?? `Response for status ${status}`,
					content: { "application/json": { schema: res } },
				};
			}
		}
		const path = r.path.replace(/:([^/]+)/g, "{$1}");
		paths[path] ??= {};
		paths[path][method] = {
			...op,
			operationId: r.detail?.operationId ?? toOperationId(r.method, r.path),
		};
	}
	return paths;
}

/**
 * Path OpenAPI di una sub-app montata su `prefix`. Controlla anche le sue
 * route (`assertRoutes`): una route senza una delle `guards` del modulo (es.
 * `["admin"]` per /admin; `"publicRoute"` se il modulo ha route pubbliche;
 * una funzione del path se cambiano da route a route, come nel seller) ferma
 * l'avvio.
 */
export function honoPaths(
	app: Hono<any, any, any>,
	prefix: string,
	guards: ModuleGuards,
) {
	assertRoutes(app, guards);
	return generatePaths(operations(app, prefix));
}
