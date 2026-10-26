import { z } from "zod";
import { typeboxJson } from "./t";

// Il valore che l'API di prima controllava davvero, per avere da Zod lo
// stesso primo errore di TypeBox (D6 del piano Hono). Prima del controllo il
// framework di prima (1.4.30, `compose`; vedi `THIRD_PARTY_NOTICES.md`) faceva
// due passi:
// 1. body con un `default` da qualche parte nello schema (`hasProperty`):
//    `Object.assign(defaults, body)`, quindi null, un primitivo o un array
//    diventano un oggetto;
// 2. la pulizia di exact-mirror 0.2.7 (`normalize`), che ricostruisce
//    l'oggetto campo per campo: un campo obbligatorio «semplice» diventa una
//    chiave propria anche se manca (TypeBox lo segnala al suo posto
//    nell'ordine dello schema), uno Optional o anyOf (t.Integer, t.Date,
//    t.Nullable, unioni; vedi anche `coercedKeys`) sparisce se
//    manca (TypeBox lo segnala per primo); un'unione (anche t.Nullable) si
//    pulisce col primo ramo che accetta il valore, o col primo ramo che
//    accetta il valore pulito (`openingHours: ""` diventa `[]`). Se legge un
//    campo di un valore nullo lancia, e si controlla il body com'era.

type Def = z.core.$ZodTypeDef & Record<string, any>;
type Json = Record<string, any>;
const defOf = (schema: z.ZodType) => schema._zod.def as Def;
const isZod = (node: unknown): node is z.ZodType =>
	!!node && typeof node === "object" && "_zod" in node;

/** Optional e default sono modificatori dello stesso nodo TypeBox. */
export function unwrap(schema: z.ZodType) {
	let node = schema;
	let optional = false;
	let hasDefault = false;
	for (;;) {
		const def = defOf(node);
		if (def.type === "default") hasDefault = true;
		if (typeboxJson.has(def)) break;
		if (def.type === "optional") optional = true;
		else if (def.type !== "default") break;
		node = def.innerType;
	}
	return { node, optional, hasDefault };
}

/** Il nodo è un anyOf nel JSON di TypeBox: t.Integer, t.Date, t.Nullable, unioni. */
export function isAnyOf(node: z.ZodType) {
	const def = defOf(node);
	return (
		def.type === "nullable" ||
		def.type === "union" ||
		def.type === "enum" ||
		Array.isArray(typeboxJson.get(def)?.anyOf)
	);
}

// Per scendere in un campo si attraversano anche nullable e pipe.
function container(schema: z.ZodType): z.ZodType {
	const def = defOf(schema);
	switch (def.type) {
		case "optional":
		case "default":
		case "nullable":
			return container(def.innerType);
		case "pipe":
			return container(def.in);
		default:
			return schema;
	}
}

/** Il nodo dello schema a quel path, o undefined (es. dentro un'unione). */
export function nodeAt(root: z.ZodType, path: PropertyKey[]) {
	let node: z.ZodType | undefined = root;
	for (const key of path) {
		if (!node) return;
		const def = defOf(container(node));
		node =
			def.type === "object"
				? def.shape[key as string]
				: def.type === "array"
					? def.element
					: def.type === "record"
						? def.valueType
						: undefined;
	}
	return node;
}

// ── 1. default della radice ─────────────────────────────────────────────────

/** La vista TypeBox di un nodo per `hasProperty("default")` (framework di prima). */
function view(node: z.ZodType | Json): {
	hasDefault: boolean;
	anyOf?: (z.ZodType | Json)[];
	shape?: Record<string, z.ZodType | Json>;
} {
	if (!isZod(node))
		return {
			hasDefault: "default" in node,
			anyOf: node.anyOf,
			shape: node.type === "object" ? node.properties : undefined,
		};
	const { node: inner, hasDefault } = unwrap(node);
	const json = typeboxJson.get(defOf(inner));
	if (json) {
		const v = view(json);
		return { ...v, hasDefault: hasDefault || v.hasDefault };
	}
	const def = defOf(inner);
	return {
		hasDefault,
		anyOf:
			def.type === "nullable"
				? [def.innerType, { type: "null" }]
				: def.type === "union"
					? def.options
					: def.type === "enum"
						? []
						: undefined,
		shape: def.type === "object" ? def.shape : undefined,
	};
}

/** `hasProperty("default", schema)` del framework di prima (`schema.mjs`). */
function hasDefaultDeep(node: z.ZodType | Json): boolean {
	const v = view(node);
	if (v.anyOf) return v.anyOf.some(hasDefaultDeep);
	if (v.shape)
		return Object.values(v.shape).some((prop) => {
			const p = view(prop);
			return (
				p.hasDefault ||
				(p.shape ? hasDefaultDeep(prop) : !!p.anyOf?.some(hasDefaultDeep))
			);
		});
	return v.hasDefault;
}

const isFile = (node: z.ZodType) => {
	const json = typeboxJson.get(defOf(unwrap(node).node));
	return json?.default === "File" || json?.default === "Files";
};

/** `hasType("File" | "Files", schema)` del framework di prima. */
function hasFile(node: z.ZodType): boolean {
	const def = defOf(unwrap(node).node);
	if (isFile(node)) return true;
	if (def.type === "object")
		return Object.values(def.shape as Record<string, z.ZodType>).some(hasFile);
	if (def.type === "nullable" || def.type === "array")
		return hasFile(def.innerType ?? def.element);
	return def.type === "union" && (def.options as z.ZodType[]).some(hasFile);
}

/**
 * I campi di primo livello che diventano unioni prima del controllo, come prima:
 * in query t.Number, t.Boolean e t.Array (Numeric, BooleanString,
 * ArrayQuery); nei body con un file t.Object e t.Array (ObjectString,
 * ArrayString, `coerceFormData`). Per TypeBox sono anyOf.
 */
export function coercedKeys(schema: z.ZodType, target: "body" | "query") {
	const def = defOf(unwrap(schema).node);
	const types =
		target === "query"
			? ["number", "boolean", "array"]
			: hasFile(schema)
				? ["object", "array"]
				: [];
	const keys = new Set<string>();
	if (def.type === "object")
		for (const [key, prop] of Object.entries(
			def.shape as Record<string, z.ZodType>,
		))
			if (types.includes(defOf(unwrap(prop).node).type)) keys.add(key);
	return keys;
}

// I default "File"/"Files" non contano: se restano solo quelli, niente assign.
function assignsDefaults(root: z.ZodType) {
	const shape = defOf(root).shape as Record<string, z.ZodType>;
	return (
		hasDefaultDeep(root) &&
		(!hasFile(root) ||
			Object.values(shape).some((p) => !isFile(p) && unwrap(p).hasDefault))
	);
}

// ── 2. pulizia di exact-mirror ──────────────────────────────────────────────

/** `a?.b` su un `a` nullo: tutta la catena vale undefined, senza lanciare. */
const SHORT = Symbol("short");
const plain = (value: unknown) => (value === SHORT ? undefined : value);

function read(value: unknown, key: string, soft: boolean) {
	if (value === SHORT) return SHORT;
	if (value == null) {
		if (soft) return SHORT;
		throw new TypeError(`clean: ${key}`);
	}
	return (value as Record<string, unknown>)[key];
}

const NULL = z.null();

/**
 * `handleUnion` di exact-mirror: il primo ramo che accetta il valore lo
 * pulisce; se nessuno lo accetta, vince il primo ramo che accetta il valore
 * pulito da lui; se no il valore com'è. t.Integer, t.Date e le unioni di
 * letterali hanno solo rami primitivi: il valore resta com'è.
 * ponytail: «accetta» è il safeParse di Zod, non il Check di TypeBox; si
 * scostano solo coi default annidati in un ramo (gap noto, Trappole del piano).
 */
function union(node: z.ZodType, value: unknown) {
	const def = defOf(node);
	const raw = plain(value);
	const branches: z.ZodType[] | undefined = typeboxJson.has(def)
		? undefined
		: def.type === "nullable"
			? [def.innerType, NULL]
			: def.type === "union"
				? def.options
				: undefined;
	if (!branches) return raw;
	const hit = branches.find((b) => b.safeParse(raw).success);
	if (hit) return mirror(hit, value, true, true);
	for (const branch of branches) {
		const cleaned = mirror(branch, value, true, true);
		if (branch.safeParse(cleaned).success) return cleaned;
	}
	return raw;
}

// `soft`: i campi di questo nodo si leggono con `?.` (nodo Optional, o
// elementi di un array Optional), come nel codice generato da exact-mirror;
// `inUnion`: dentro un ramo di un'unione si legge tutto con `?.`.
function mirror(
	schema: z.ZodType,
	value: unknown,
	soft: boolean,
	inUnion = false,
	anyOfKeys?: Set<string>,
): unknown {
	const { node } = unwrap(schema);
	const def = defOf(node);
	if (isAnyOf(node)) return union(node, value);
	if (def.type === "object") {
		const loose = def.catchall && defOf(def.catchall).type !== "never";
		const out: Record<string, unknown> =
			loose && value && typeof value === "object" ? { ...value } : {};
		for (const [key, prop] of Object.entries(
			def.shape as Record<string, z.ZodType>,
		)) {
			const inner = unwrap(prop);
			const optional =
				inner.optional || isAnyOf(inner.node) || !!anyOfKeys?.has(key);
			const child = read(value, key, soft || inUnion);
			if (optional && plain(child) === undefined) continue;
			out[key] = mirror(prop, child, optional, inUnion);
		}
		return out;
	}
	if (def.type === "array") {
		const items = unwrap(def.element).node;
		const type = defOf(items).type;
		if (type !== "object" && type !== "array" && !isAnyOf(items))
			return plain(value);
		const list = plain(value) as unknown[];
		// Come exact-mirror: `.length` di un nullo lancia, di un numero è undefined.
		const out = new Array(list.length);
		for (let i = 0; i < list.length; i++)
			out[i] = mirror(def.element, list[i], soft, inUnion);
		return out;
	}
	if (def.type === "record") Object.keys(plain(value) as object);
	return plain(value);
}

/**
 * Il body (o la query) come lo controllava l'API di prima: default della radice e
 * pulizia; se la pulizia lancia, il valore com'era.
 */
export function mirrorValue(
	schema: z.ZodType,
	value: unknown,
	target: "body" | "query",
): unknown {
	const root = unwrap(schema).node;
	if (
		target === "body" &&
		defOf(root).type === "object" &&
		assignsDefaults(root)
	)
		value = Object.assign({}, value);
	try {
		return mirror(schema, value, false, false, coercedKeys(schema, target));
	} catch {
		return value;
	}
}
