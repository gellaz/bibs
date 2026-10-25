// In-repo OpenAPI generator (PROBE): port of @elysiajs/openapi 1.4.16 toOpenAPISchema
// (MIT) for TypeBox 1 schemas, input = a plain route list. Reproduces Elysia's
// conventions: 3 body content types, "Response for status N", operationId, enum
// flattening of literal unions, Date anyOf, nullable, File as binary.
type S = Record<string, any>;
export interface RouteDoc {
	method: string;
	path: string; // Hono/Elysia style `/a/:id`
	params?: S;
	query?: S;
	body?: S;
	response?: Record<string | number, S>;
	detail?: S;
}

const capitalize = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const toOperationId = (method: string, path: string) => {
	let id = method.toLowerCase();
	if (!path || path === "/") return `${id}Index`;
	for (const seg of path.split("/"))
		id += seg.includes(":")
			? `By${capitalize(seg.replace(":", ""))}`
			: capitalize(seg);
	return id.replace(/\?/g, "Optional");
};

// JSON of a TypeBox 1 schema = plain JSON Schema (internals are non-enumerable).
const json = (s: S) => JSON.parse(JSON.stringify(s));

/** Elysia's enumToOpenApi + Date branch + our x-file expansion. */
function toOpenApiSchema(s: any): any {
	if (!s || typeof s !== "object") return s;
	// Elysia's t.File / t.Files JSON, rebuilt from the original options.
	if (s["x-file"]) {
		const { type, ...o } = s["x-file"].options;
		return {
			default: "File",
			type: "string",
			...o,
			...(type ? { extension: type } : {}),
			format: "binary",
		};
	}
	if (s.type === "array" && s.items?.["x-file"]?.kind === "Files") {
		const { type, ...o } = s.items["x-file"].options;
		return {
			type: "array",
			...o,
			elysiaMeta: "Files",
			default: "Files",
			...(type ? { extension: type } : {}),
			items: { type: "string", ...o, default: "Files", format: "binary" },
		};
	}
	// TypeBox 1 Record(String) key pattern is ^.*$, 0.34 wrote ^(.*)$.
	if (s.patternProperties?.["^.*$"]) {
		const { "^.*$": v, ...pp } = s.patternProperties;
		return { ...s, patternProperties: { ...pp, "^(.*)$": toOpenApiSchema(v) } };
	}
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
		// TypeBox 0.34 Type.Date (inside Elysia's t.Date) is shown as a date-time string.
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
			return seen.has(key) ? false : (seen.add(key), true);
		});
		return mapped.length === 1 ? mapped[0] : { ...s, anyOf: mapped };
	}
	return s;
}
// Elysia's nullToOpenApi, OpenAPI 3.1 branch: anyOf [X, null] with a single-typed X → type [X, "null"].
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
const isObj = (v: unknown): v is S =>
	!!v && typeof v === "object" && !Array.isArray(v);
function nullTo31(value: any): any {
	if (Array.isArray(value)) return value.map(nullTo31);
	if (!isObj(value)) return value;
	const out: S = { ...value };
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
const unwrap = (s?: S) => (s ? nullTo31(toOpenApiSchema(json(s))) : undefined);

export function generatePaths(routes: RouteDoc[]) {
	const paths: S = {};
	for (const r of routes) {
		const method = r.method.toLowerCase();
		if (r.detail?.hide || method === "options" || r.path.includes("."))
			continue;
		const op: S = { ...r.detail };
		const parameters: S[] = [];
		const params = unwrap(r.params);
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
		const query = unwrap(r.query);
		if (query?.properties)
			for (const [name, schema] of Object.entries(query.properties))
				parameters.push({
					name,
					in: "query",
					required: (query.required ?? []).includes(name),
					schema,
				});
		if (parameters.length) op.parameters = parameters;
		const body = unwrap(r.body);
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
				const res = unwrap(schema);
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
