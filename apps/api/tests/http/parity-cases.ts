import { Type } from "@sinclair/typebox";
import { Elysia, type TSchema, t } from "elysia";
import { z } from "zod";
import "@/lib/schemas/forms/formats";
import { moduleApp } from "@/http/app";
import { type Target, v } from "@/http/validator";
import { PaginationQuery as TbPaginationQuery } from "@/lib/pagination";
import { ProductSearchQuery as TbProductSearchQuery } from "@/lib/queries";
import {
	DiscountCreateBody as TbDiscountCreateBody,
	DiscountListQuery as TbDiscountListQuery,
} from "@/lib/schemas";
import { OpeningHoursSchema as TbOpeningHours } from "@/lib/schemas/forms/opening-hours";
import { CreateHolidayDefinitionBody as TbCreateHolidayDefinitionBody } from "@/lib/schemas/holidays";
import { StockBulkAdjustBody as TbStockBulkAdjustBody } from "@/lib/schemas/stock";
import { PaginationQuery } from "@/lib/zod/pagination";
import { zDate, zFile, zFiles, zFormat, zInteger } from "@/lib/zod/t";
import { errorHandler } from "@/plugins/error-handler";
import { normalize } from "@/plugins/normalize";

// Il validatore Hono (`v()`, schemi Zod) contro Elysia (schemi TypeBox): per
// ogni caso stesso status e stesso corpo, al byte per gli errori (D2, D5, D6
// del piano Hono). Ogni riga porta lo schema TypeBox, il gemello Zod e il
// risultato atteso scritto per esteso: i casi di
// `tests/lib/validation-message.test.ts` con le stesse stringhe, il corpus
// della sonda (`notes/prototypes/validation/before.json`) sugli schemi veri, la
// coercizione di query e multipart, il trim, i campi sconosciuti, i file.
// In U11 (via Elysia) la colonna TypeBox e il confronto dal vivo spariscono e
// restano gemello e atteso.

export const noopPino = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	trace: () => {},
} as any;

export interface Req {
	search?: string;
	json?: unknown;
	raw?: string;
	contentType?: string;
	form?: Record<string, string | Blob | (string | Blob)[]>;
	headers?: Record<string, string>;
}

export interface Case {
	name: string;
	target: Target;
	tb: TSchema;
	zod: z.ZodType;
	req: Req;
	status: number;
	/** Corpo atteso: `{ ok: … }` (echo dell'input validato) o l'inviluppo. */
	body: unknown;
}

export const fail = (message: string) => ({
	success: false,
	error: "VALIDATION_ERROR",
	message,
});

export const PNG = Uint8Array.from(
	atob(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
	),
	(ch) => ch.charCodeAt(0),
);

export function request(target: Target, r: Req): Request {
	const headers = new Headers(r.headers);
	let body: BodyInit | undefined;
	if (r.json !== undefined) {
		headers.set("content-type", "application/json");
		body = JSON.stringify(r.json);
	} else if (r.raw !== undefined) {
		if (r.contentType) headers.set("content-type", r.contentType);
		body = r.raw;
	} else if (r.form) {
		const form = new FormData();
		for (const [key, value] of Object.entries(r.form))
			for (const item of [value].flat()) form.append(key, item);
		body = form;
	}
	return new Request(`http://localhost/${r.search ?? ""}`, {
		method: target === "query" ? "GET" : "POST",
		headers,
		body,
	});
}

export function elysiaApp(c: Case) {
	const app = new Elysia()
		.state("pino", noopPino)
		.use(errorHandler)
		.use(normalize);
	return c.target === "query"
		? app.get("/", ({ query }) => ({ ok: query }), { query: c.tb })
		: app.post("/", ({ body }) => ({ ok: body }), { body: c.tb });
}

export function honoApp(c: Case) {
	const app = moduleApp();
	return c.target === "query"
		? app.get("/", v("query", c.zod), (ctx) =>
				ctx.json({ ok: ctx.req.valid("query") }),
			)
		: app.post("/", v(c.target, c.zod), (ctx) =>
				ctx.json({ ok: ctx.req.valid(c.target as "json") }),
			);
}

// ── schemi veri e loro gemelli ──────────────────────────────────────────────

// POST /register/customer
const TbRegister = t.Object({
	email: t.String({ format: "email", description: "Indirizzo email" }),
	password: t.String({
		minLength: 8,
		maxLength: 128,
		description: "Password (minimo 8, massimo 128 caratteri)",
	}),
});
const Register = z.object({
	email: zFormat("email").meta({ description: "Indirizzo email" }),
	password: z.string().min(8).max(128).meta({
		description: "Password (minimo 8, massimo 128 caratteri)",
	}),
});

const DiscountCreateBody = z.object({
	title: z
		.string()
		.min(1)
		.max(80)
		.meta({ description: "Titolo della promozione" }),
	percent: zInteger({ minimum: 1, maximum: 99 }),
	startsAt: zDate(),
	endsAt: zDate().nullable().optional(),
	initialProductIds: z
		.array(z.string())
		.max(100)
		.meta({ description: "Prodotti da includere subito" })
		.optional(),
});

const DiscountListQuery = PaginationQuery.extend({
	state: z
		.enum(["assignable", "concluded"])
		.meta({
			description:
				"Filtro lista: 'assignable' = in corso/programmate/in pausa; 'concluded' = scadute/archiviate",
		})
		.optional(),
	search: z.string().max(80).optional(),
});

// Gemello di `ProductSearchQuery` (`lib/queries.ts`), descrizioni comprese.
const d = (description: string) => ({ description });
const ProductSearchQuery = PaginationQuery.extend({
	q: z.string().meta(d("Testo di ricerca (full-text italiano)")).optional(),
	categoryId: z.string().meta(d("Filtra per ID categoria prodotto")).optional(),
	macroCategoryId: z
		.string()
		.meta(
			d(
				"Filtra per ID macro categoria prodotto. Ignorato se `categoryId` è presente: la categoria è già dentro la sua macro.",
			),
		)
		.optional(),
	lat: z
		.number()
		.min(-90)
		.max(90)
		.meta(d("Latitudine del punto di ricerca"))
		.optional(),
	lng: z
		.number()
		.min(-180)
		.max(180)
		.meta(d("Longitudine del punto di ricerca"))
		.optional(),
	radius: z
		.number()
		.gt(0)
		.max(100)
		.meta(d("Raggio in km (opzionale, nessun limite di default; max 100)"))
		.optional(),
	openNow: z
		.boolean()
		.meta(
			d(
				"Solo i prodotti disponibili in un negozio aperto in questo momento (fuso Europe/Rome). Restringe anche quale negozio viene agganciato al risultato.",
			),
		)
		.optional(),
	onSale: z
		.boolean()
		.meta(d("Solo i prodotti con uno sconto attivo in questo momento"))
		.optional(),
	minPrice: z
		.number()
		.min(0)
		.meta(d("Prezzo minimo in €, sul prezzo scontato"))
		.optional(),
	maxPrice: z
		.number()
		.min(0)
		.meta(d("Prezzo massimo in €, sul prezzo scontato"))
		.optional(),
});

// ── i casi ──────────────────────────────────────────────────────────────────

// Gemello di `OpeningHoursSchema` (`lib/schemas/forms/opening-hours.ts`):
// `Type.Integer` di TypeBox è `z.int()`, il `t.Integer` di Elysia è `zInteger`.
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const slotTime = (description: string) =>
	z
		.string()
		.regex(HHMM)
		.meta({ description, error: "Formato orario non valido (HH:mm)" });
const OpeningHours = z
	.array(
		z.object({
			dayOfWeek: z.int().min(0).max(6).meta({
				description: "Giorno della settimana (0=Lunedì, 6=Domenica)",
			}),
			slots: z
				.array(
					z.object({
						open: slotTime("Orario di apertura (HH:mm)"),
						close: slotTime("Orario di chiusura (HH:mm)"),
					}),
				)
				.min(1)
				.max(4)
				.meta({ description: "Fasce orarie del giorno" }),
		}),
	)
	.max(7)
	.meta({ description: "Orari di apertura del negozio" });

// Gemelli delle unioni alla radice: `z.union`, non `z.discriminatedUnion`
// (che sceglie il ramo dal discriminante e dà errori che TypeBox non dà).
const bulkStoreId = z
	.string()
	.meta({ description: "ID negozio attivo del chiamante" });
const bulkProductIds = z
	.array(z.string())
	.min(1)
	.max(100)
	.meta({ description: "ID dei prodotti su cui applicare l'operazione" });
const StockBulkAdjustBody = z.union([
	z.object({
		storeId: bulkStoreId,
		mode: z
			.literal("delta")
			.meta({ description: "Somma algebrica di `value` allo stock corrente" }),
		value: zInteger({
			minimum: -1000,
			maximum: 1000,
			description: "Variazione (segno + per aumentare, - per diminuire).",
		}),
		productIds: bulkProductIds,
	}),
	z.object({
		storeId: bulkStoreId,
		mode: z
			.literal("set")
			.meta({ description: "Imposta lo stock a `value` per ogni prodotto" }),
		value: zInteger({
			minimum: 0,
			maximum: 100000,
			description: "Valore assoluto da impostare.",
		}),
		productIds: bulkProductIds,
	}),
]);

const holidayName = z
	.string()
	.min(1)
	.max(100)
	.meta({ description: "Nome festività" });
const CreateHolidayDefinitionBody = z.union([
	z.object({
		type: z.literal("fixed"),
		name: holidayName,
		month: zInteger({ minimum: 1, maximum: 12, description: "Mese (1-12)" }),
		day: zInteger({ minimum: 1, maximum: 31, description: "Giorno (1-31)" }),
	}),
	z.object({
		type: z.literal("easter_relative"),
		name: holidayName,
		easterOffsetDays: zInteger({
			minimum: -60,
			maximum: 60,
			description: "Offset dalla Pasqua (Pasqua=0, Pasquetta=1)",
		}),
	}),
	z.object({
		type: z.literal("one_off"),
		name: holidayName,
		oneOffDate: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/)
			.meta({ description: "Data YYYY-MM-DD" }),
	}),
]);

const body = (
	name: string,
	tb: TSchema,
	zod: z.ZodType,
	json: unknown,
	status: number,
	expected: unknown,
): Case => ({
	name,
	target: "json",
	tb,
	zod,
	req: { json },
	status,
	body: expected,
});

const query = (
	name: string,
	tb: TSchema,
	zod: z.ZodType,
	search: string,
	status: number,
	expected: unknown,
): Case => ({
	name,
	target: "query",
	tb,
	zod,
	req: { search },
	status,
	body: expected,
});

const fmt = (format: string, zod: z.ZodType) =>
	[t.Object({ x: t.String({ format }) }), z.object({ x: zod })] as const;

const nameMin25 = [
	t.Object({ name: t.String({ minLength: 2, maxLength: 5 }) }),
	z.object({ name: z.string().min(2).max(5) }),
] as const;
const quantity199 = [
	t.Object({ quantity: t.Integer({ minimum: 1, maximum: 99 }) }),
	z.object({ quantity: zInteger({ minimum: 1, maximum: 99 }) }),
] as const;
const storeIds = [
	t.Object({
		storeIds: t.Array(t.String(), {
			minItems: 1,
			maxItems: 2,
			uniqueItems: true,
		}),
	}),
	z.object({
		storeIds: z
			.array(z.string())
			.min(1)
			.max(2)
			.refine((ids) => new Set(ids).size === ids.length, {
				params: { rule: { kind: "uniqueItems" } },
			})
			.meta({ uniqueItems: true }),
	}),
] as const;
const literalType = [
	t.Object({ type: t.Union([t.Literal("a"), t.Literal("b")]) }),
	z.object({ type: z.enum(["a", "b"]) }),
] as const;
const file = [
	t.Object({ file: t.File({ type: "image", maxSize: "1k" }) }),
	z.object({ file: zFile({ type: "image", maxSize: "1k" }) }),
] as const;
const enumAfterString = [
	t.Object({
		name: t.String(),
		state: t.Union([t.Literal("a"), t.Literal("b")]),
	}),
	z.object({ name: z.string(), state: z.enum(["a", "b"]) }),
] as const;
const nullableAfterString = [
	t.Object({ name: t.String(), note: t.Nullable(t.String()) }),
	z.object({ name: z.string(), note: z.string().nullable() }),
] as const;
const plainOrder = [
	t.Object({ a: t.String({ minLength: 3 }), b: t.String() }),
	z.object({ a: z.string().min(3), b: z.string() }),
] as const;
const openingHours = [
	t.Object({ openingHours: t.Optional(t.Nullable(TbOpeningHours)) }),
	z.object({ openingHours: OpeningHours.nullable().optional() }),
] as const;
const formWithFile = [
	t.Object({
		name: t.String(),
		meta: t.Object({ a: t.String() }),
		tags: t.Array(t.String()),
		file: t.File(),
	}),
	z.object({
		name: z.string(),
		meta: z.object({ a: z.string() }),
		tags: z.array(z.string()),
		file: zFile(),
	}),
] as const;
const png = () => new File([PNG], "a.png", { type: "image/png" });

export const cases: Case[] = [
	// tests/lib/validation-message.test.ts, stesse stringhe
	body(
		"vm: campo mancante nel body",
		t.Object({ name: t.String() }),
		z.object({ name: z.string() }),
		{},
		422,
		fail("Nome: campo obbligatorio"),
	),
	query(
		"vm: campo mancante in query",
		t.Object({ storeId: t.String() }),
		z.object({ storeId: z.string() }),
		"?other=1",
		422,
		fail("Negozio: campo obbligatorio"),
	),
	body(
		"vm: testo",
		t.Object({ name: t.String() }),
		z.object({ name: z.string() }),
		{ name: 3 },
		422,
		fail("Nome: deve essere un testo"),
	),
	body(
		"vm: numero",
		t.Object({ price: t.Number() }),
		z.object({ price: z.number() }),
		{ price: "x" },
		422,
		fail("Prezzo: deve essere un numero"),
	),
	body(
		"vm: vero/falso",
		t.Object({ isActive: t.Boolean() }),
		z.object({ isActive: z.boolean() }),
		{ isActive: "x" },
		422,
		fail("Attivo: deve essere vero o falso"),
	),
	body(
		"vm: t.Integer con un decimale",
		t.Object({ quantity: t.Integer() }),
		z.object({ quantity: zInteger() }),
		{ quantity: 1.5 },
		422,
		fail("Quantità: deve essere un numero intero"),
	),
	body(
		"vm: t.Integer sotto il minimo",
		...quantity199,
		{ quantity: 0 },
		422,
		fail("Quantità: deve essere almeno 1"),
	),
	body(
		"vm: t.Integer sopra il massimo",
		...quantity199,
		{ quantity: 100 },
		422,
		fail("Quantità: deve essere al massimo 99"),
	),
	body(
		"vm: exclusiveMinimum",
		t.Object({ price: t.Number({ exclusiveMinimum: 0 }) }),
		z.object({ price: z.number().gt(0) }),
		{ price: 0 },
		422,
		fail("Prezzo: deve essere maggiore di 0"),
	),
	body(
		"vm: minLength",
		...nameMin25,
		{ name: "a" },
		422,
		fail("Nome: almeno 2 caratteri"),
	),
	body(
		"vm: maxLength",
		...nameMin25,
		{ name: "abcdef" },
		422,
		fail("Nome: al massimo 5 caratteri"),
	),
	body(
		"vm: minLength 1 su testo vuoto",
		t.Object({ name: t.String({ minLength: 1 }) }),
		z.object({ name: z.string().min(1) }),
		{ name: "" },
		422,
		fail("Nome: campo obbligatorio"),
	),
	body(
		"vm: pattern",
		t.Object({ zipCode: t.String({ pattern: "^\\d{5}$" }) }),
		z.object({ zipCode: z.string().regex(/^\d{5}$/) }),
		{ zipCode: "ab" },
		422,
		fail("CAP: formato non valido"),
	),
	body(
		"vm: email",
		...fmt("email", zFormat("email")),
		{ x: "no" },
		422,
		fail("x: indirizzo email non valido"),
	),
	body(
		"vm: uuid",
		...fmt("uuid", zFormat("uuid")),
		{ x: "no" },
		422,
		fail("x: identificativo non valido"),
	),
	body(
		"vm: calendar-date",
		...fmt("calendar-date", zFormat("calendar-date")),
		{ x: "2024-02-31" },
		422,
		fail("x: data non valida (AAAA-MM-GG)"),
	),
	body(
		"vm: uri",
		...fmt("uri", zFormat("uri")),
		{ x: "no" },
		422,
		fail("x: indirizzo web non valido"),
	),
	body(
		"vm: date-time",
		...fmt("date-time", zFormat("date-time")),
		{ x: "no" },
		422,
		fail("x: data e ora non valide"),
	),
	body(
		"vm: union di letterali",
		...literalType,
		{ type: "c" },
		422,
		fail("Tipo: valore non ammesso"),
	),
	body(
		"vm: letterale singolo",
		t.Object({ type: t.Literal("a") }),
		z.object({ type: z.literal("a") }),
		{ type: "c" },
		422,
		fail("Tipo: valore non ammesso"),
	),
	body(
		"vm: t.Nullable, regola del ramo non nullo",
		t.Object({ note: t.Nullable(t.String({ maxLength: 3 })) }),
		z.object({ note: z.string().max(3).nullable() }),
		{ note: "abcd" },
		422,
		fail("Note: al massimo 3 caratteri"),
	),
	body(
		"vm: t.Date non valida",
		t.Object({ startsAt: t.Date() }),
		z.object({ startsAt: zDate() }),
		{ startsAt: "nope" },
		422,
		fail("Inizio: data non valida"),
	),
	body(
		"vm: array minItems",
		...storeIds,
		{ storeIds: [] },
		422,
		fail("Negozi: almeno 1 elemento"),
	),
	body(
		"vm: array maxItems",
		...storeIds,
		{ storeIds: ["a", "b", "c"] },
		422,
		fail("Negozi: al massimo 2 elementi"),
	),
	body(
		"vm: array uniqueItems",
		...storeIds,
		{ storeIds: ["a", "a"] },
		422,
		fail("Negozi: elementi duplicati"),
	),
	body(
		"vm: riga dell'array",
		t.Object({
			items: t.Array(t.Object({ quantity: t.Integer({ minimum: 1 }) })),
		}),
		z.object({
			items: z.array(z.object({ quantity: zInteger({ minimum: 1 }) })),
		}),
		{ items: [{ quantity: 1 }, { quantity: 0 }] },
		422,
		fail("Quantità (riga 2): deve essere almeno 1"),
	),
	body(
		"vm: path tecnico",
		t.Object({ location: t.Object({ zz: t.Number({ maximum: 90 }) }) }),
		z.object({ location: z.object({ zz: z.number().max(90) }) }),
		{ location: { zz: 91 } },
		422,
		fail("location.zz: deve essere al massimo 90"),
	),
	query(
		"vm: il title vince",
		t.Object({
			limit: t.Integer({ maximum: 10, title: "Numero di suggerimenti" }),
		}),
		z.object({
			limit: zInteger({ maximum: 10, title: "Numero di suggerimenti" }),
		}),
		"?limit=2.5",
		422,
		fail("Numero di suggerimenti: deve essere un numero intero"),
	),
	query(
		"vm: coercizione senza path",
		t.Object({ page: t.Integer({ minimum: 1 }) }),
		z.object({ page: zInteger({ minimum: 1 }) }),
		"?page=0",
		422,
		fail("Valore non valido: deve essere almeno 1"),
	),
	body(
		"vm: error: dello schema",
		t.Object({
			name: t.String({ minLength: 1, error: "Il nome è obbligatorio" }),
		}),
		z.object({
			name: z.string().min(1).meta({ error: "Il nome è obbligatorio" }),
		}),
		{ name: "" },
		422,
		"Il nome è obbligatorio",
	),
	body(
		"vm: body che non è un oggetto",
		t.Array(t.String()),
		z.array(z.string()),
		{ a: 1 },
		422,
		fail("Richiesta non valida"),
	),
	body(
		"vm: regola non mappata",
		t.Object({ step: t.Integer({ multipleOf: 5 }) }),
		z.object({ step: zInteger({ multipleOf: 5 }) }),
		{ step: 3 },
		422,
		fail("step: valore non valido"),
	),

	// corpus della sonda (before.json), sugli schemi veri
	body(
		"reg-empty",
		TbRegister,
		Register,
		{},
		422,
		fail("Email: campo obbligatorio"),
	),
	body(
		"reg-bad-email",
		TbRegister,
		Register,
		{ email: "nope", password: "12345678" },
		422,
		fail("Email: indirizzo email non valido"),
	),
	body(
		"reg-short-pw",
		TbRegister,
		Register,
		{ email: "a@b.it", password: "123" },
		422,
		fail("Password: almeno 8 caratteri"),
	),
	{
		name: "reg-short-pw-en (cookie di lingua ignorato)",
		target: "json",
		tb: TbRegister,
		zod: Register,
		req: {
			json: { email: "a@b.it", password: "123" },
			headers: { cookie: "PARAGLIDE_LOCALE=en" },
		},
		status: 422,
		body: fail("Password: almeno 8 caratteri"),
	},
	body(
		"reg-pw-number",
		TbRegister,
		Register,
		{ email: "a@b.it", password: 12345678 },
		422,
		fail("Password: deve essere un testo"),
	),
	{
		name: "reg-malformed-json → 500",
		target: "json",
		tb: TbRegister,
		zod: Register,
		req: { raw: "{bad", contentType: "application/json" },
		status: 500,
		body: {
			success: false,
			error: "INTERNAL_ERROR",
			message: "Errore interno del server",
		},
	},
	{
		name: "reg-no-content-type",
		target: "json",
		tb: TbRegister,
		zod: Register,
		req: { raw: '{"email":"nope","password":"12345678"}' },
		status: 422,
		body: fail("Richiesta non valida"),
	},
	{
		name: "reg-text-plain",
		target: "json",
		tb: TbRegister,
		zod: Register,
		req: {
			raw: '{"email":"nope","password":"12345678"}',
			contentType: "text/plain",
		},
		status: 422,
		body: fail("Email: campo obbligatorio"),
	},
	body(
		"disc-empty-title (trim)",
		TbDiscountCreateBody,
		DiscountCreateBody,
		{ title: "   ", percent: 5, startsAt: "2026-01-01" },
		422,
		fail("Titolo: campo obbligatorio"),
	),
	body(
		"disc-percent-150",
		TbDiscountCreateBody,
		DiscountCreateBody,
		{ title: "x", percent: 150, startsAt: "2026-01-01" },
		422,
		fail("Percentuale: deve essere al massimo 99"),
	),
	body(
		"disc-percent-float",
		TbDiscountCreateBody,
		DiscountCreateBody,
		{ title: "x", percent: 5.5, startsAt: "2026-01-01" },
		422,
		fail("Percentuale: deve essere un numero intero"),
	),
	body(
		"disc-percent-str",
		TbDiscountCreateBody,
		DiscountCreateBody,
		{ title: "x", percent: "abc", startsAt: "2026-01-01" },
		422,
		fail("Percentuale: deve essere un numero intero"),
	),
	body(
		"disc-percent-numstr: intero come stringa accettato nel JSON",
		TbDiscountCreateBody,
		DiscountCreateBody,
		{ title: " x ", percent: "5", startsAt: "2026-01-01", extra: 1 },
		200,
		{
			ok: { title: "x", percent: 5, startsAt: "2026-01-01T00:00:00.000Z" },
		},
	),
	body(
		"disc-percent-numstr fuori limite: campo perso",
		TbDiscountCreateBody,
		DiscountCreateBody,
		{ title: "x", percent: "150", startsAt: "2026-01-01" },
		422,
		fail("Valore non valido: deve essere al massimo 99"),
	),
	body(
		"disc-bad-date",
		TbDiscountCreateBody,
		DiscountCreateBody,
		{ title: "x", percent: 5, startsAt: "not-a-date" },
		422,
		fail("Inizio: data non valida"),
	),
	body(
		"disc-bad-endsAt (nullable)",
		TbDiscountCreateBody,
		DiscountCreateBody,
		{ title: "x", percent: 5, startsAt: "2026-01-01", endsAt: "bad" },
		422,
		fail("Fine: data non valida"),
	),
	body(
		"disc-missing-startsAt",
		TbDiscountCreateBody,
		DiscountCreateBody,
		{ title: "x", percent: 5 },
		422,
		fail("Inizio: campo obbligatorio"),
	),
	body(
		"disc: mancante prima del tipo sbagliato (ordine di TypeBox)",
		TbDiscountCreateBody,
		DiscountCreateBody,
		{ title: 3, percent: 5 },
		422,
		fail("Inizio: campo obbligatorio"),
	),
	body(
		"disc: date larghe di Elysia, null e epoch",
		TbDiscountCreateBody,
		DiscountCreateBody,
		{
			title: "x",
			percent: 5,
			startsAt: 1767225600000,
			endsAt: null,
			initialProductIds: [" a ", "b"],
		},
		200,
		{
			ok: {
				title: "x",
				percent: 5,
				startsAt: "2026-01-01T00:00:00.000Z",
				endsAt: null,
				initialProductIds: ["a", "b"],
			},
		},
	),
	body(
		"disc: data gg/mm/aaaa",
		TbDiscountCreateBody,
		DiscountCreateBody,
		{ title: "x", percent: 5, startsAt: "05/03/2027" },
		200,
		{ ok: { title: "x", percent: 5, startsAt: "2027-05-03T00:00:00.000Z" } },
	),
	query(
		"q-page-0",
		TbDiscountListQuery,
		DiscountListQuery,
		"?page=0",
		422,
		fail("Valore non valido: deve essere almeno 1"),
	),
	query(
		"q-page-abc",
		TbDiscountListQuery,
		DiscountListQuery,
		"?page=abc",
		422,
		fail("Pagina: deve essere un numero intero"),
	),
	query(
		"q-limit-1000",
		TbDiscountListQuery,
		DiscountListQuery,
		"?limit=1000",
		422,
		fail("Valore non valido: deve essere al massimo 100"),
	),
	query(
		"q-state-bad",
		TbDiscountListQuery,
		DiscountListQuery,
		"?state=foo",
		422,
		fail("state: valore non ammesso"),
	),
	query(
		"q-valid",
		TbDiscountListQuery,
		DiscountListQuery,
		"?page=2&limit=10&state=concluded",
		200,
		{ ok: { page: 2, limit: 10, state: "concluded" } },
	),
	query(
		"q-search-lat-bad",
		TbProductSearchQuery,
		ProductSearchQuery,
		"?lat=abc",
		422,
		fail("Latitudine: valore non valido"),
	),
	query(
		"q-search-lat-200",
		TbProductSearchQuery,
		ProductSearchQuery,
		"?lat=200",
		422,
		fail("Valore non valido: deve essere al massimo 90"),
	),
	query(
		"q-search-openNow-bad",
		TbProductSearchQuery,
		ProductSearchQuery,
		"?openNow=maybe",
		422,
		fail("openNow: valore non valido"),
	),
	query(
		"q-search-openNow-1",
		TbProductSearchQuery,
		ProductSearchQuery,
		"?openNow=1",
		422,
		fail("openNow: valore non valido"),
	),
	query(
		"q-search-radius-0",
		TbProductSearchQuery,
		ProductSearchQuery,
		"?radius=0",
		422,
		fail("Valore non valido: deve essere maggiore di 0"),
	),
	query(
		"q-search: numeri, booleani, default, chiave ignota tolta, nessun trim",
		TbProductSearchQuery,
		ProductSearchQuery,
		"?lat=45.5&lng=9&openNow=true&onSale=false&q=%20pane%20&zzz=1",
		200,
		{
			ok: {
				page: 1,
				limit: 20,
				q: " pane ",
				lat: 45.5,
				lng: 9,
				openNow: true,
				onSale: false,
			},
		},
	),

	// D5: query
	query(
		"query: array da virgole e da chiavi ripetute",
		t.Object({ ids: t.Array(t.String()) }),
		z.object({ ids: z.array(z.string()) }),
		"?ids=a,b&ids=c",
		200,
		{ ok: { ids: ["a", "b", "c"] } },
	),
	query(
		"query: chiave ripetuta, vince l'ultima",
		t.Object({ q: t.String() }),
		z.object({ q: z.string() }),
		"?q=a&q=b",
		200,
		{ ok: { q: "b" } },
	),
	query("query: solo default", TbPaginationQuery, PaginationQuery, "", 200, {
		ok: { page: 1, limit: 20 },
	}),

	// body: trim, campi sconosciuti, forme strane
	body(
		"body: trim profondo tranne le password, campi ignoti tolti a ogni livello",
		t.Object({
			name: t.String(),
			password: t.String(),
			nested: t.Object({ b: t.String() }),
			list: t.Array(t.Object({ c: t.String() })),
		}),
		z.object({
			name: z.string(),
			password: z.string(),
			nested: z.object({ b: z.string() }),
			list: z.array(z.object({ c: z.string() })),
		}),
		{
			name: "  x ",
			password: " p ",
			extra: 2,
			nested: { b: " 2 ", deep: 3 },
			list: [{ c: "y", internal: 1 }],
		},
		200,
		{
			ok: {
				name: "x",
				password: " p ",
				nested: { b: "2" },
				list: [{ c: "y" }],
			},
		},
	),
	body(
		"body: JSON array su schema oggetto",
		TbRegister,
		Register,
		[1],
		422,
		fail("Email: campo obbligatorio"),
	),
	body(
		"body: JSON null su schema oggetto",
		TbRegister,
		Register,
		null,
		422,
		fail("Richiesta non valida"),
	),
	body(
		"body: JSON numero su schema oggetto",
		TbRegister,
		Register,
		5,
		422,
		fail("Email: campo obbligatorio"),
	),
	{
		name: "urlencoded: chiave ripetuta diventa un array",
		target: "form",
		tb: t.Object({ name: t.String() }),
		zod: z.object({ name: z.string() }),
		req: {
			raw: "name=x&name=y",
			contentType: "application/x-www-form-urlencoded",
		},
		status: 422,
		body: fail("Nome: deve essere un testo"),
	},

	// multipart e file
	{
		name: "multipart: oggetto come JSON, intero come stringa",
		target: "form",
		tb: t.Object({ meta: t.Object({ a: t.String() }), n: t.Integer() }),
		zod: z.object({ meta: z.object({ a: z.string() }), n: zInteger() }),
		req: { form: { meta: '{"a":" 1 ","x":2}', n: "3" } },
		status: 200,
		body: { ok: { meta: { a: "1" }, n: 3 } },
	},
	{
		name: "file: mancante",
		target: "form",
		tb: file[0],
		zod: file[1],
		req: { form: { other: "x" } },
		status: 422,
		body: fail("File: campo obbligatorio"),
	},
	{
		name: "file: tipo dichiarato sbagliato",
		target: "form",
		tb: file[0],
		zod: file[1],
		req: {
			form: { file: new File(["hello"], "a.txt", { type: "text/plain" }) },
		},
		status: 422,
		body: fail("File: tipo di file non ammesso"),
	},
	{
		name: "file: contenuto diverso dal tipo (magic byte)",
		target: "form",
		tb: file[0],
		zod: file[1],
		req: {
			form: { file: new File(["hello"], "a.png", { type: "image/png" }) },
		},
		status: 422,
		body: fail("File: tipo di file non ammesso"),
	},
	{
		name: "file: troppo grande",
		target: "form",
		tb: file[0],
		zod: file[1],
		req: {
			form: {
				file: new File([new Uint8Array(2048)], "a.png", { type: "image/png" }),
			},
		},
		status: 422,
		body: fail("File: tipo di file non ammesso"),
	},
	{
		name: "file: PNG valido",
		target: "form",
		tb: file[0],
		zod: file[1],
		req: { form: { file: new File([PNG], "a.png", { type: "image/png" }) } },
		status: 200,
		body: { ok: { file: {} } },
	},
	{
		name: "file: stringa nel JSON",
		target: "form",
		tb: file[0],
		zod: file[1],
		req: { json: { file: "x" } },
		status: 422,
		body: fail("File: tipo di file non ammesso"),
	},
	{
		name: "files: un file solo diventa un array",
		target: "form",
		tb: t.Object({ files: t.Files({ type: "image", maxItems: 2 }) }),
		zod: z.object({ files: zFiles({ type: "image", maxItems: 2 }) }),
		req: { form: { files: new File([PNG], "a.png", { type: "image/png" }) } },
		status: 200,
		body: { ok: { files: [{}] } },
	},
	{
		name: "files: troppi file",
		target: "form",
		tb: t.Object({ files: t.Files({ type: "image", maxItems: 1 }) }),
		zod: z.object({ files: zFiles({ type: "image", maxItems: 1 }) }),
		req: {
			form: {
				files: [
					new File([PNG], "a.png", { type: "image/png" }),
					new File([PNG], "b.png", { type: "image/png" }),
				],
			},
		},
		status: 422,
		body: fail("File: tipo di file non ammesso"),
	},

	// altri tipi e combinazioni
	body(
		"body: nessuna coercizione per number e boolean",
		t.Object({ price: t.Number(), isActive: t.Boolean() }),
		z.object({ price: z.number(), isActive: z.boolean() }),
		{ price: "5", isActive: "true" },
		422,
		fail("Prezzo: deve essere un numero"),
	),
	body(
		"body: maxLength prima del formato",
		t.Object({ email: t.String({ format: "email", maxLength: 5 }) }),
		z.object({ email: zFormat("email").max(5) }),
		{ email: "not-an-email" },
		422,
		fail("Email: al massimo 5 caratteri"),
	),
	body(
		"body: Nullable(Integer) e Optional",
		t.Object({
			a: t.Nullable(t.Integer()),
			b: t.Optional(t.String({ format: "email" })),
		}),
		z.object({ a: zInteger().nullable(), b: zFormat("email").optional() }),
		{ a: null, b: "" },
		422,
		fail("b: indirizzo email non valido"),
	),
	body(
		"body: Nullable(Integer) con testo",
		t.Object({ a: t.Nullable(t.Integer()) }),
		z.object({ a: zInteger().nullable() }),
		{ a: "x" },
		422,
		fail("a: deve essere un numero intero"),
	),
	body(
		"body: oggetto annidato mancante",
		t.Object({ location: t.Object({ lat: t.Number() }), name: t.String() }),
		z.object({ location: z.object({ lat: z.number() }), name: z.string() }),
		{ name: 3 },
		422,
		fail("location: campo obbligatorio"),
	),
	body(
		"body: unione di letterali numerici e stringhe",
		t.Object({ v: t.Union([t.Literal(1), t.Literal("x")]) }),
		z.object({ v: z.union([z.literal(1), z.literal("x")]) }),
		{ v: 2 },
		422,
		fail("v: valore non ammesso"),
	),
	query(
		"query: t.Date",
		t.Object({ from: t.Date() }),
		z.object({ from: zDate() }),
		"?from=2026-01-01",
		200,
		{ ok: { from: "2026-01-01T00:00:00.000Z" } },
	),
	query(
		"query: t.Number senza vincoli e notazione esponenziale",
		t.Object({ n: t.Number() }),
		z.object({ n: z.number() }),
		"?n=1e3",
		200,
		{ ok: { n: 1000 } },
	),
	query(
		"query: stringa vuota per un numero",
		t.Object({ n: t.Optional(t.Number()) }),
		z.object({ n: z.number().optional() }),
		"?n=",
		422,
		fail("n: valore non valido"),
	),

	// Ordine del primo errore con la pulizia di Elysia (`lib/zod/mirror.ts`):
	// le chiavi anyOf mancanti prima, poi i campi nell'ordine dello schema.
	body(
		"ordine: t.Integer e t.Date mancanti prima del titolo (DiscountCreateBody)",
		TbDiscountCreateBody,
		DiscountCreateBody,
		{},
		422,
		fail("Percentuale: campo obbligatorio"),
	),
	body(
		"ordine: JSON null su uno schema con default (DiscountCreateBody)",
		TbDiscountCreateBody,
		DiscountCreateBody,
		null,
		422,
		fail("Percentuale: campo obbligatorio"),
	),
	body(
		"ordine: JSON numero su uno schema con default (DiscountCreateBody)",
		TbDiscountCreateBody,
		DiscountCreateBody,
		5,
		422,
		fail("Percentuale: campo obbligatorio"),
	),
	{
		name: "ordine: senza Content-Type su uno schema con default",
		target: "json",
		tb: TbDiscountCreateBody,
		zod: DiscountCreateBody,
		req: { raw: "x" },
		status: 422,
		body: fail("Percentuale: campo obbligatorio"),
	},
	body(
		"ordine: solo il titolo manca (DiscountCreateBody)",
		TbDiscountCreateBody,
		DiscountCreateBody,
		{ percent: 5, startsAt: "2026-01-01" },
		422,
		fail("Titolo: campo obbligatorio"),
	),
	body(
		"ordine: unione di letterali mancante prima di una stringa",
		...enumAfterString,
		{},
		422,
		fail("state: campo obbligatorio"),
	),
	body(
		"ordine: t.Nullable mancante prima di una stringa",
		...nullableAfterString,
		{},
		422,
		fail("Note: campo obbligatorio"),
	),
	body(
		"ordine: stringa obbligatoria mancante dopo un campo non valido",
		...plainOrder,
		{ a: "x" },
		422,
		fail("a: almeno 3 caratteri"),
	),
	body(
		"ordine: oggetto Optional null diventa un oggetto vuoto",
		t.Object({ o: t.Optional(t.Object({ p: t.String() })) }),
		z.object({ o: z.object({ p: z.string() }).optional() }),
		{ o: null },
		422,
		fail("o.p: campo obbligatorio"),
	),
	body(
		"ordine: numero su uno schema con oggetto annidato obbligatorio",
		t.Object({ a: t.String(), o: t.Object({ p: t.String() }) }),
		z.object({ a: z.string(), o: z.object({ p: z.string() }) }),
		5,
		422,
		fail("Richiesta non valida"),
	),
	body(
		"ordine: JSON null con soli default di file",
		t.Object({ name: t.String(), n: t.Integer(), file: t.File() }),
		z.object({ name: z.string(), n: zInteger(), file: zFile() }),
		null,
		422,
		fail("Richiesta non valida"),
	),
	body(
		"ordine: JSON null con un default oltre al file",
		t.Object({
			name: t.String({ default: "a" }),
			n: t.Integer(),
			file: t.File(),
		}),
		z.object({ name: z.string().default("a"), n: zInteger(), file: zFile() }),
		null,
		422,
		fail("n: campo obbligatorio"),
	),
	query(
		"ordine: in query un numero mancante prima di una stringa",
		t.Object({ s: t.String(), n: t.Number() }),
		z.object({ s: z.string(), n: z.number() }),
		"?",
		422,
		fail("n: campo obbligatorio"),
	),

	// t.Nullable di un array: l'errore sta sul campo, con la regola del primo
	// errore dentro e senza il messaggio custom annidato.
	body(
		"nullable: orario annidato non valido (openingHours)",
		...openingHours,
		{
			openingHours: [
				{ dayOfWeek: 0, slots: [{ open: "25:00", close: "10:00" }] },
			],
		},
		422,
		fail("openingHours: formato non valido"),
	),
	body(
		"nullable: fasce mancanti (openingHours)",
		...openingHours,
		{ openingHours: [{ dayOfWeek: 0 }] },
		422,
		fail("openingHours: campo obbligatorio"),
	),
	body(
		"nullable: giorno fuori intervallo (openingHours)",
		...openingHours,
		{
			openingHours: [
				{ dayOfWeek: 9, slots: [{ open: "09:00", close: "10:00" }] },
			],
		},
		422,
		fail("openingHours: deve essere al massimo 6"),
	),
	body(
		"nullable: Type.Integer come stringa (openingHours)",
		...openingHours,
		{
			openingHours: [
				{ dayOfWeek: "1", slots: [{ open: "09:00", close: "10:00" }] },
			],
		},
		422,
		fail("openingHours: deve essere un numero intero"),
	),
	body(
		"nullable: orari validi, campi in più tolti (openingHours)",
		...openingHours,
		{
			openingHours: [
				{
					dayOfWeek: 1,
					x: 1,
					slots: [{ open: "09:00", close: "10:00", y: 2 }],
				},
			],
		},
		200,
		{
			ok: {
				openingHours: [
					{ dayOfWeek: 1, slots: [{ open: "09:00", close: "10:00" }] },
				],
			},
		},
	),
	body(
		"Type.Integer: una stringa è «deve essere un numero intero»",
		t.Object({ n: Type.Integer({ minimum: 0 }) }),
		z.object({ n: z.int().min(0) }),
		{ n: "1" },
		422,
		fail("n: deve essere un numero intero"),
	),

	// Unioni alla radice: un ramo che passa il controllo e fallisce la
	// decodifica dà l'errore di decodifica.
	body(
		"unione: t.Integer come stringa oltre il massimo (StockBulkAdjustBody)",
		TbStockBulkAdjustBody,
		StockBulkAdjustBody,
		{ storeId: "s", mode: "delta", value: "5000", productIds: ["a"] },
		422,
		fail("Valore non valido: deve essere al massimo 1000"),
	),
	body(
		"unione: nessun ramo valido (StockBulkAdjustBody)",
		TbStockBulkAdjustBody,
		StockBulkAdjustBody,
		{ storeId: "s", mode: "set", value: -1, productIds: ["a"] },
		422,
		fail("Richiesta non valida"),
	),
	body(
		"unione: oggetto vuoto (StockBulkAdjustBody)",
		TbStockBulkAdjustBody,
		StockBulkAdjustBody,
		{},
		422,
		fail("Richiesta non valida"),
	),
	body(
		"unione: intero come stringa valido (StockBulkAdjustBody)",
		TbStockBulkAdjustBody,
		StockBulkAdjustBody,
		{ storeId: "s", mode: "set", value: "7", productIds: ["a"], extra: 1 },
		200,
		{ ok: { storeId: "s", mode: "set", value: 7, productIds: ["a"] } },
	),
	body(
		"unione: mese come stringa oltre il massimo (CreateHolidayDefinitionBody)",
		TbCreateHolidayDefinitionBody,
		CreateHolidayDefinitionBody,
		{ type: "fixed", name: "x", month: "13", day: 1 },
		422,
		fail("Valore non valido: deve essere al massimo 12"),
	),

	// Body con un file: oggetti e array di primo livello sono unioni per
	// Elysia (ObjectString, ArrayString).
	{
		name: "multipart con file: oggetto JSON non valido",
		target: "form",
		tb: formWithFile[0],
		zod: formWithFile[1],
		req: { form: { name: "n", meta: "{abc", tags: '["a"]', file: png() } },
		status: 422,
		body: fail("meta: valore non valido"),
	},
	{
		name: "multipart con file: oggetto JSON con un campo sbagliato",
		target: "form",
		tb: formWithFile[0],
		zod: formWithFile[1],
		req: { form: { name: "n", meta: '{"a":5}', tags: '["a"]', file: png() } },
		status: 422,
		body: fail("meta: valore non valido"),
	},
	{
		name: "multipart con file: array come testo semplice",
		target: "form",
		tb: formWithFile[0],
		zod: formWithFile[1],
		req: { form: { name: "n", meta: '{"a":"x"}', tags: "a,b", file: png() } },
		status: 422,
		body: fail("tags: valore non valido"),
	},
	{
		name: "multipart con file: oggetto e array mancanti prima del nome",
		target: "form",
		tb: formWithFile[0],
		zod: formWithFile[1],
		req: { form: { file: png() } },
		status: 422,
		body: fail("meta: campo obbligatorio"),
	},
	body(
		"ordine: in un oggetto annidato t.Date mancante prima della stringa",
		t.Object({ o: t.Object({ s: t.String({ minLength: 3 }), d: t.Date() }) }),
		z.object({ o: z.object({ s: z.string().min(3), d: zDate() }) }),
		{ o: { s: "x" } },
		422,
		fail("o.d: campo obbligatorio"),
	),
	body(
		"ordine: array Optional di oggetti null (la pulizia lancia)",
		t.Object({
			a: t.String({ minLength: 3 }),
			l: t.Optional(t.Array(t.Object({ x: t.String() }))),
		}),
		z.object({
			a: z.string().min(3),
			l: z.array(z.object({ x: z.string() })).optional(),
		}),
		{ a: "x", l: null },
		422,
		fail("a: almeno 3 caratteri"),
	),
	body(
		"nullable: maxItems prima degli elementi",
		t.Object({
			l: t.Nullable(t.Array(t.Object({ a: t.String() }), { maxItems: 1 })),
		}),
		z.object({
			l: z
				.array(z.object({ a: z.string() }))
				.max(1)
				.nullable(),
		}),
		{ l: [{}, {}] },
		422,
		fail("l: al massimo 1 elemento"),
	),
];
