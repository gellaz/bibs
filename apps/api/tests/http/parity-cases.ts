import { z } from "zod";
import { moduleApp } from "@/http/app";
import { type Target, v } from "@/http/validator";
import {
	DiscountCreateBody,
	DiscountListQuery,
	DiscountProductsBody,
	DiscountUpdateBody,
} from "@/lib/schemas/discount";
import {
	BulkDeleteBody,
	BulkStatusBody,
	ProductStatusBody,
} from "@/lib/schemas/entities";
import {
	CreateHolidayDefinitionBody,
	PutClosuresBody,
	UpdateHolidayDefinitionBody,
} from "@/lib/schemas/holidays";
import { GeocodeQuery, MunicipalitiesQuery } from "@/lib/schemas/locations";
import { PaginationQuery } from "@/lib/schemas/pagination";
import {
	CategoryListQuery,
	CharacteristicListQuery,
	OrderListQuery,
	ProductCategoryListQuery,
	ProductSearchQuery,
	SellerListQuery,
	StoreListQuery,
} from "@/lib/schemas/queries";
import { RegisterBody, SignInBody } from "@/lib/schemas/registration";
import { StockAdjustBody, StockBulkAdjustBody } from "@/lib/schemas/stock";
import {
	zDate,
	zFile,
	zFiles,
	zFormat,
	zInt,
	zInteger,
	zString,
} from "@/lib/schemas/t";
import {
	AcceptInviteBody,
	CompanyBody,
	DocumentBody,
	PersonalInfoBody,
	TeamInviteBody,
} from "@/lib/zod/forms/onboarding";
import { OpeningHoursSchema } from "@/lib/zod/forms/opening-hours";
import {
	CharacteristicValuesField,
	CreateProductBody,
} from "@/lib/zod/forms/products";
import { CompanySettingsBody, VatChangeBody } from "@/lib/zod/forms/settings";
import { CreateStoreBody } from "@/lib/zod/forms/stores";
import {
	SubscriptionsQuery,
	UpdatePricingBody,
} from "@/modules/admin/routes/billing";
import {
	RemoveCategoryCharacteristicBody,
	SetCategoryCharacteristicBody,
} from "@/modules/admin/routes/category-characteristics";
import { HolidayPreviewQuery } from "@/modules/admin/routes/holiday-definitions";
import {
	CreateProductCharacteristicBody,
	DeleteProductCharacteristicBody,
	UpdateProductCharacteristicBody,
} from "@/modules/admin/routes/product-characteristics";
import { CreateProductMacroCategoryBody } from "@/modules/admin/routes/product-macro-categories";
import { RequestListQuery } from "@/modules/admin/routes/requests";
import { RejectChangeBody } from "@/modules/admin/routes/seller-changes";
import {
	RejectSellerRouteBody,
	VerifySellerBody,
} from "@/modules/admin/routes/sellers";

// I casi del validatore (`v()`, schemi Zod): per ogni caso lo status e il
// corpo attesi, scritti per esteso, e quelli che l'API dava prima di Hono
// (`golden/validator.json`, al byte per gli errori; D2, D5, D6 del piano
// Hono). Sono i casi di `tests/lib/validation-message.test.ts` con le stesse
// stringhe, il corpus della sonda (`notes/prototypes/validation/before.json`)
// sugli schemi veri, la coercizione di query e multipart, il trim, i campi
// sconosciuti, i file. Fino a U11 ogni riga portava anche lo schema TypeBox e
// il test lo confrontava dal vivo: gli esiti di allora sono nei file golden.

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

// ── schemi veri ─────────────────────────────────────────────────────────────

// POST /register/customer
const Register = RegisterBody;

// ── i casi ──────────────────────────────────────────────────────────────────

// `Type.Integer` di TypeBox (form condivisi) è `zInt`, il `t.Integer` di
// prima della migrazione è `zInteger` (`lib/schemas/t.ts`).
const OpeningHours = OpeningHoursSchema;

// Unioni alla radice: `z.union`, non `z.discriminatedUnion` (che sceglie il
// ramo dal discriminante e dà errori che la baseline non dà).

const pricing = {
	storeMonthlyFeeCents: 2900,
	currency: "EUR",
	suspendedAutoCancelDays: 60,
	pendingCreationExpiryHours: 24,
	productId: "prod_ABC123",
};
const stale = "2026-01-01T00:00:00.000Z";

const body = (
	name: string,
	zod: z.ZodType,
	json: unknown,
	status: number,
	expected: unknown,
): Case => ({
	name,
	target: "json",
	zod,
	req: { json },
	status,
	body: expected,
});

const query = (
	name: string,
	zod: z.ZodType,
	search: string,
	status: number,
	expected: unknown,
): Case => ({
	name,
	target: "query",
	zod,
	req: { search },
	status,
	body: expected,
});

const fmt = (_format: string, zod: z.ZodType) => z.object({ x: zod });

const nameMin25 = z.object({ name: z.string().min(2).max(5) });
const quantity199 = z.object({
	quantity: zInteger({ minimum: 1, maximum: 99 }),
});
const quantity1e20 = z.object({ quantity: zInteger() });
const storeIds = z.object({
	storeIds: z
		.array(z.string())
		.min(1)
		.max(2)
		.refine((ids) => new Set(ids).size === ids.length, {
			params: { rule: { kind: "uniqueItems" } },
		})
		.meta({ uniqueItems: true }),
});
const literalType = z.object({ type: z.enum(["a", "b"]) });
const file = z.object({ file: zFile({ type: "image", maxSize: "1k" }) });
const enumAfterString = z.object({
	name: z.string(),
	state: z.enum(["a", "b"]),
});
const nullableAfterString = z.object({
	name: z.string(),
	note: z.string().nullable(),
});
const plainOrder = z.object({ a: z.string().min(3), b: z.string() });
const openingHours = z.object({
	openingHours: OpeningHours.nullable().optional(),
});
const formWithFile = z.object({
	name: z.string(),
	meta: z.object({ a: z.string() }),
	tags: z.array(z.string()),
	file: zFile(),
});
const name200 = z.object({ name: zString({ maxLength: 200 }) });
const country2 = z.object({
	country: zString({ minLength: 2, maxLength: 2, title: "Codice" }),
});
const phone = z.object({
	phone: zString({
		maxLength: 5,
		pattern: "^(.{2,})?$",
		description: "Telefono",
	}),
});
const png = () => new File([PNG], "a.png", { type: "image/png" });
// Body validi dei form di U6, da cui i casi tolgono o rompono un campo.
const STORE = {
	name: "Bottega",
	addressLine1: "Via Roma 1",
	municipalityId: "m",
	zipCode: "40100",
	location: { x: 11.34, y: 44.49 },
};
const PERSONAL = {
	firstName: "Mario",
	lastName: "Rossi",
	citizenship: "IT",
	birthCountry: "IT",
	birthDate: "1990-05-01",
	residenceCountry: "IT",
	residenceMunicipalityId: "m",
	residenceAddress: "Via Roma 1",
	residenceZipCode: "40100",
};
const DOCUMENT = {
	documentType: "identity_card",
	documentNumber: "CA12345AB",
	documentExpiry: "2030-01-01",
	documentIssuedMunicipalityId: "m",
};
const COMPANY = {
	businessName: "Rossi SRL",
	legalForm: "SRL",
	addressLine1: "Via Roma 1",
	municipalityId: "m",
	zipCode: "40100",
};

export const cases: Case[] = [
	// tests/lib/validation-message.test.ts, stesse stringhe
	body(
		"vm: campo mancante nel body",
		z.object({ name: z.string() }),
		{},
		422,
		fail("Nome: campo obbligatorio"),
	),
	query(
		"vm: campo mancante in query",
		z.object({ storeId: z.string() }),
		"?other=1",
		422,
		fail("Negozio: campo obbligatorio"),
	),
	body(
		"vm: testo",
		z.object({ name: z.string() }),
		{ name: 3 },
		422,
		fail("Nome: deve essere un testo"),
	),
	body(
		"vm: numero",
		z.object({ price: z.number() }),
		{ price: "x" },
		422,
		fail("Prezzo: deve essere un numero"),
	),
	body(
		"vm: vero/falso",
		z.object({ isActive: z.boolean() }),
		{ isActive: "x" },
		422,
		fail("Attivo: deve essere vero o falso"),
	),
	body(
		"vm: t.Integer con un decimale",
		z.object({ quantity: zInteger() }),
		{ quantity: 1.5 },
		422,
		fail("Quantità: deve essere un numero intero"),
	),
	body(
		"vm: t.Integer sotto il minimo",
		quantity199,
		{ quantity: 0 },
		422,
		fail("Quantità: deve essere almeno 1"),
	),
	body(
		"vm: t.Integer sopra il massimo",
		quantity199,
		{ quantity: 100 },
		422,
		fail("Quantità: deve essere al massimo 99"),
	),
	body(
		"vm: exclusiveMinimum",
		z.object({ price: z.number().gt(0) }),
		{ price: 0 },
		422,
		fail("Prezzo: deve essere maggiore di 0"),
	),
	body(
		"vm: minLength",
		nameMin25,
		{ name: "a" },
		422,
		fail("Nome: almeno 2 caratteri"),
	),
	body(
		"vm: maxLength",
		nameMin25,
		{ name: "abcdef" },
		422,
		fail("Nome: al massimo 5 caratteri"),
	),
	body(
		"vm: minLength 1 su testo vuoto",
		z.object({ name: z.string().min(1) }),
		{ name: "" },
		422,
		fail("Nome: campo obbligatorio"),
	),
	body(
		"vm: pattern",
		z.object({ zipCode: z.string().regex(/^\d{5}$/) }),
		{ zipCode: "ab" },
		422,
		fail("CAP: formato non valido"),
	),
	body(
		"vm: email",
		fmt("email", zFormat("email")),
		{ x: "no" },
		422,
		fail("x: indirizzo email non valido"),
	),
	body(
		"vm: uuid",
		fmt("uuid", zFormat("uuid")),
		{ x: "no" },
		422,
		fail("x: identificativo non valido"),
	),
	body(
		"vm: email che solo il framework di prima, nudo, accettava (TLD di una lettera)",
		fmt("email", zFormat("email")),
		{ x: "a@b.c" },
		422,
		fail("x: indirizzo email non valido"),
	),
	body(
		"vm: uuid fuori da RFC 9562",
		fmt("uuid", zFormat("uuid")),
		{ x: "11111111-1111-1111-1111-111111111111" },
		422,
		fail("x: identificativo non valido"),
	),
	body(
		"vm: uuid v4 maiuscolo",
		fmt("uuid", zFormat("uuid")),
		{ x: "3F1C2A4E-8B5D-4C6E-9F7A-1B2C3D4E5F60" },
		200,
		{ ok: { x: "3F1C2A4E-8B5D-4C6E-9F7A-1B2C3D4E5F60" } },
	),
	body(
		"vm: calendar-date",
		fmt("calendar-date", zFormat("calendar-date")),
		{ x: "2024-02-31" },
		422,
		fail("x: data non valida (AAAA-MM-GG)"),
	),
	body(
		"vm: uri",
		fmt("uri", zFormat("uri")),
		{ x: "no" },
		422,
		fail("x: indirizzo web non valido"),
	),
	body(
		"vm: date-time",
		fmt("date-time", zFormat("date-time")),
		{ x: "no" },
		422,
		fail("x: data e ora non valide"),
	),
	body(
		"vm: union di letterali",
		literalType,
		{ type: "c" },
		422,
		fail("Tipo: valore non ammesso"),
	),
	body(
		"vm: letterale singolo",
		z.object({ type: z.literal("a") }),
		{ type: "c" },
		422,
		fail("Tipo: valore non ammesso"),
	),
	body(
		"vm: t.Nullable, regola del ramo non nullo",
		z.object({ note: z.string().max(3).nullable() }),
		{ note: "abcd" },
		422,
		fail("Note: al massimo 3 caratteri"),
	),
	body(
		"vm: t.Date non valida",
		z.object({ startsAt: zDate() }),
		{ startsAt: "nope" },
		422,
		fail("Inizio: data non valida"),
	),
	body(
		"vm: t.Date con l'offset senza segno (il «+» di una query)",
		z.object({ startsAt: zDate() }),
		{ startsAt: "2026-01-01T12:00:00 01:00" },
		422,
		fail("Inizio: data non valida"),
	),
	body(
		"vm: array minItems",
		storeIds,
		{ storeIds: [] },
		422,
		fail("Negozi: almeno 1 elemento"),
	),
	body(
		"vm: array maxItems",
		storeIds,
		{ storeIds: ["a", "b", "c"] },
		422,
		fail("Negozi: al massimo 2 elementi"),
	),
	body(
		"vm: array uniqueItems",
		storeIds,
		{ storeIds: ["a", "a"] },
		422,
		fail("Negozi: elementi duplicati"),
	),
	body(
		"vm: riga dell'array",
		z.object({
			items: z.array(z.object({ quantity: zInteger({ minimum: 1 }) })),
		}),
		{ items: [{ quantity: 1 }, { quantity: 0 }] },
		422,
		fail("Quantità (riga 2): deve essere almeno 1"),
	),
	body(
		"vm: path tecnico",
		z.object({ location: z.object({ zz: z.number().max(90) }) }),
		{ location: { zz: 91 } },
		422,
		fail("location.zz: deve essere al massimo 90"),
	),
	query(
		"vm: il title vince",
		z.object({
			limit: zInteger({ maximum: 10, title: "Numero di suggerimenti" }),
		}),
		"?limit=2.5",
		422,
		fail("Numero di suggerimenti: deve essere un numero intero"),
	),
	query(
		"vm: coercizione senza path",
		z.object({ page: zInteger({ minimum: 1 }) }),
		"?page=0",
		422,
		fail("Valore non valido: deve essere almeno 1"),
	),
	body(
		"vm: error: dello schema",
		z.object({
			name: z.string().min(1).meta({ error: "Il nome è obbligatorio" }),
		}),
		{ name: "" },
		422,
		"Il nome è obbligatorio",
	),
	body(
		"vm: body che non è un oggetto",
		z.array(z.string()),
		{ a: 1 },
		422,
		fail("Richiesta non valida"),
	),
	body(
		"vm: regola non mappata",
		z.object({ step: zInteger({ multipleOf: 5 }) }),
		{ step: 3 },
		422,
		fail("step: valore non valido"),
	),

	// corpus della sonda (before.json), sugli schemi veri
	body("reg-empty", Register, {}, 422, fail("Email: campo obbligatorio")),
	body(
		"reg-bad-email",
		Register,
		{ email: "nope", password: "12345678" },
		422,
		fail("Email: indirizzo email non valido"),
	),
	body(
		"reg: email che solo il framework di prima, nudo, accettava",
		Register,
		{ email: "mario#rossi@test.it", password: "12345678" },
		422,
		fail("Email: indirizzo email non valido"),
	),
	body(
		"reg-short-pw",
		Register,
		{ email: "a@b.it", password: "123" },
		422,
		fail("Password: almeno 8 caratteri"),
	),
	{
		name: "reg-short-pw-en (cookie di lingua ignorato)",
		target: "json",
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
		Register,
		{ email: "a@b.it", password: 12345678 },
		422,
		fail("Password: deve essere un testo"),
	),
	{
		name: "reg-malformed-json → 500",
		target: "json",
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
		zod: Register,
		req: { raw: '{"email":"nope","password":"12345678"}' },
		status: 422,
		body: fail("Richiesta non valida"),
	},
	{
		name: "reg-text-plain",
		target: "json",
		zod: Register,
		req: {
			raw: '{"email":"nope","password":"12345678"}',
			contentType: "text/plain",
		},
		status: 422,
		body: fail("Email: campo obbligatorio"),
	},
	body(
		"reg: email trimmata, campi ignoti tolti",
		Register,
		{
			email: " a@b.it ",
			password: " 12345678 ",
			role: "admin",
			nested: { x: 1 },
		},
		200,
		{ ok: { email: "a@b.it", password: " 12345678 " } },
	),
	// U4: sign-in e accept-invite
	body(
		"sign-in: password mancante",
		SignInBody,
		{ email: "mario@example.it" },
		422,
		fail("Password: campo obbligatorio"),
	),
	body(
		"sign-in: vuoto",
		SignInBody,
		{},
		422,
		fail("Email: campo obbligatorio"),
	),
	body(
		"accept-invite: vuoto → error dello schema",
		AcceptInviteBody,
		{},
		422,
		fail("Token mancante"),
	),
	body(
		"accept-invite: password corta",
		AcceptInviteBody,
		{ token: "x", password: "short", confirmPassword: "short" },
		422,
		fail("La password deve avere almeno 8 caratteri"),
	),
	body(
		"accept-invite: conferma corta",
		AcceptInviteBody,
		{ token: "x", password: "password123", confirmPassword: "short" },
		422,
		fail("La conferma password deve avere almeno 8 caratteri"),
	),
	body(
		"accept-invite: valido, campi ignoti tolti",
		AcceptInviteBody,
		{
			token: " t ",
			password: "password123",
			confirmPassword: "password456",
			extra: { a: 1 },
		},
		200,
		{
			ok: {
				token: "t",
				password: "password123",
				confirmPassword: "password456",
			},
		},
	),
	// U2: query di /locations
	query(
		"geocode: limit frazionario (title dello schema)",
		GeocodeQuery,
		"?q=Via%20Roma&limit=2.5",
		422,
		fail("Numero di suggerimenti: deve essere un numero intero"),
	),
	query(
		"geocode: q corta",
		GeocodeQuery,
		"?q=ab",
		422,
		fail("q: almeno 3 caratteri"),
	),
	query(
		"geocode: q mancante",
		GeocodeQuery,
		"",
		422,
		fail("q: campo obbligatorio"),
	),
	query(
		"geocode: lat non numerica",
		GeocodeQuery,
		"?q=Via%20Roma&lat=abc",
		422,
		fail("Latitudine: valore non valido"),
	),
	query(
		"geocode: lat fuori intervallo (decodifica, etichetta persa)",
		GeocodeQuery,
		"?q=Via%20Roma&lat=100",
		422,
		fail("Valore non valido: deve essere al massimo 90"),
	),
	query(
		"geocode: limit oltre il massimo",
		GeocodeQuery,
		"?q=Via%20Roma&limit=11",
		422,
		fail("Valore non valido: deve essere al massimo 10"),
	),
	query(
		"geocode: default, coercizione, campi ignoti tolti",
		GeocodeQuery,
		"?q=%20Via%20Roma&lat=45.4&lng=9.1&x=1",
		200,
		{ ok: { q: " Via Roma", lat: 45.4, lng: 9.1, limit: 5 } },
	),
	query(
		"municipalities: paginazione composta con provinceId",
		MunicipalitiesQuery,
		"?page=2&limit=3&page=1&provinceId=p&x=1",
		200,
		{ ok: { page: 1, limit: 3, provinceId: "p" } },
	),
	query(
		"municipalities: page=0",
		MunicipalitiesQuery,
		"?page=0",
		422,
		fail("Valore non valido: deve essere almeno 1"),
	),
	query(
		"municipalities: page oltre i safe-int (t.Integer non li limita)",
		MunicipalitiesQuery,
		"?page=9007199254740993",
		200,
		{ ok: { page: 9007199254740992, limit: 20 } },
	),
	query(
		"municipalities: limit oltre i safe-int → massimo 100",
		MunicipalitiesQuery,
		"?limit=9007199254740993",
		422,
		fail("Valore non valido: deve essere al massimo 100"),
	),
	body(
		"t.Integer: numero oltre i safe-int nel JSON",
		quantity1e20,
		{ quantity: 1e20 },
		200,
		{ ok: { quantity: 1e20 } },
	),
	body(
		"disc-empty-title (trim)",
		DiscountCreateBody,
		{ title: "   ", percent: 5, startsAt: "2026-01-01" },
		422,
		fail("Titolo: campo obbligatorio"),
	),
	body(
		"disc-percent-150",
		DiscountCreateBody,
		{ title: "x", percent: 150, startsAt: "2026-01-01" },
		422,
		fail("Percentuale: deve essere al massimo 99"),
	),
	body(
		"disc-percent-float",
		DiscountCreateBody,
		{ title: "x", percent: 5.5, startsAt: "2026-01-01" },
		422,
		fail("Percentuale: deve essere un numero intero"),
	),
	body(
		"disc-percent-str",
		DiscountCreateBody,
		{ title: "x", percent: "abc", startsAt: "2026-01-01" },
		422,
		fail("Percentuale: deve essere un numero intero"),
	),
	body(
		"disc-percent-numstr: intero come stringa accettato nel JSON",
		DiscountCreateBody,
		{ title: " x ", percent: "5", startsAt: "2026-01-01", extra: 1 },
		200,
		{
			ok: { title: "x", percent: 5, startsAt: "2026-01-01T00:00:00.000Z" },
		},
	),
	body(
		"disc-percent-numstr fuori limite: campo perso",
		DiscountCreateBody,
		{ title: "x", percent: "150", startsAt: "2026-01-01" },
		422,
		fail("Valore non valido: deve essere al massimo 99"),
	),
	body(
		"disc-bad-date",
		DiscountCreateBody,
		{ title: "x", percent: 5, startsAt: "not-a-date" },
		422,
		fail("Inizio: data non valida"),
	),
	body(
		"disc-bad-endsAt (nullable)",
		DiscountCreateBody,
		{ title: "x", percent: 5, startsAt: "2026-01-01", endsAt: "bad" },
		422,
		fail("Fine: data non valida"),
	),
	body(
		"disc-missing-startsAt",
		DiscountCreateBody,
		{ title: "x", percent: 5 },
		422,
		fail("Inizio: campo obbligatorio"),
	),
	body(
		"disc: mancante prima del tipo sbagliato (ordine di TypeBox)",
		DiscountCreateBody,
		{ title: 3, percent: 5 },
		422,
		fail("Inizio: campo obbligatorio"),
	),
	body(
		"disc: date larghe di prima, null e epoch",
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
		DiscountCreateBody,
		{ title: "x", percent: 5, startsAt: "05/03/2027" },
		200,
		{ ok: { title: "x", percent: 5, startsAt: "2027-05-03T00:00:00.000Z" } },
	),
	// Offset senza segno: il framework di prima, nudo, lo accettava come
	// `date`, l'app composta (formato `date` del suo plugin OpenAPI) no. Giro
	// di correzioni 2 di U7.
	...[
		"2026-01-01T12:00:00 01:00",
		"2026-01-01T12:00 01:00",
		"2026-01-01T12:00:00.000 01:00",
	].map((startsAt) =>
		body(
			`disc: inizio ${startsAt} (offset senza segno)`,
			DiscountCreateBody,
			{ title: "x", percent: 5, startsAt },
			422,
			fail("Inizio: data non valida"),
		),
	),
	body(
		"disc: fine con l'offset senza segno",
		DiscountCreateBody,
		{
			title: "x",
			percent: 5,
			startsAt: "2026-01-01",
			endsAt: "2026-01-01T12:00:00 01:00",
		},
		422,
		fail("Fine: data non valida"),
	),
	query(
		"q-page-0",
		DiscountListQuery,
		"?page=0",
		422,
		fail("Valore non valido: deve essere almeno 1"),
	),
	query(
		"q-page-abc",
		DiscountListQuery,
		"?page=abc",
		422,
		fail("Pagina: deve essere un numero intero"),
	),
	query(
		"q-limit-1000",
		DiscountListQuery,
		"?limit=1000",
		422,
		fail("Valore non valido: deve essere al massimo 100"),
	),
	query(
		"q-state-bad",
		DiscountListQuery,
		"?state=foo",
		422,
		fail("state: valore non ammesso"),
	),
	query("q-valid", DiscountListQuery, "?page=2&limit=10&state=concluded", 200, {
		ok: { page: 2, limit: 10, state: "concluded" },
	}),
	query(
		"q-search-lat-bad",
		ProductSearchQuery,
		"?lat=abc",
		422,
		fail("Latitudine: valore non valido"),
	),
	query(
		"q-search-lat-200",
		ProductSearchQuery,
		"?lat=200",
		422,
		fail("Valore non valido: deve essere al massimo 90"),
	),
	query(
		"q-search-openNow-bad",
		ProductSearchQuery,
		"?openNow=maybe",
		422,
		fail("openNow: valore non valido"),
	),
	query(
		"q-search-openNow-1",
		ProductSearchQuery,
		"?openNow=1",
		422,
		fail("openNow: valore non valido"),
	),
	query(
		"q-search-radius-0",
		ProductSearchQuery,
		"?radius=0",
		422,
		fail("Valore non valido: deve essere maggiore di 0"),
	),
	query(
		"q-search: numeri, booleani, default, chiave ignota tolta, nessun trim",
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
		z.object({ ids: z.array(z.string()) }),
		"?ids=a,b&ids=c",
		200,
		{ ok: { ids: ["a", "b", "c"] } },
	),
	query(
		"query: chiave ripetuta, vince l'ultima",
		z.object({ q: z.string() }),
		"?q=a&q=b",
		200,
		{ ok: { q: "b" } },
	),
	query("query: solo default", PaginationQuery, "", 200, {
		ok: { page: 1, limit: 20 },
	}),

	// body: trim, campi sconosciuti, forme strane
	body(
		"body: trim profondo tranne le password, campi ignoti tolti a ogni livello",
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
		Register,
		[1],
		422,
		fail("Email: campo obbligatorio"),
	),
	body(
		"body: JSON null su schema oggetto",
		Register,
		null,
		422,
		fail("Richiesta non valida"),
	),
	body(
		"body: JSON numero su schema oggetto",
		Register,
		5,
		422,
		fail("Email: campo obbligatorio"),
	),
	{
		name: "urlencoded: chiave ripetuta diventa un array",
		target: "form",
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
		zod: z.object({ meta: z.object({ a: z.string() }), n: zInteger() }),
		req: { form: { meta: '{"a":" 1 ","x":2}', n: "3" } },
		status: 200,
		body: { ok: { meta: { a: "1" }, n: 3 } },
	},
	{
		name: "file: mancante",
		target: "form",
		zod: file,
		req: { form: { other: "x" } },
		status: 422,
		body: fail("File: campo obbligatorio"),
	},
	{
		name: "file: tipo dichiarato sbagliato",
		target: "form",
		zod: file,
		req: {
			form: { file: new File(["hello"], "a.txt", { type: "text/plain" }) },
		},
		status: 422,
		body: fail("File: tipo di file non ammesso"),
	},
	{
		name: "file: contenuto diverso dal tipo (magic byte)",
		target: "form",
		zod: file,
		req: {
			form: { file: new File(["hello"], "a.png", { type: "image/png" }) },
		},
		status: 422,
		body: fail("File: tipo di file non ammesso"),
	},
	{
		name: "file: troppo grande",
		target: "form",
		zod: file,
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
		zod: file,
		req: { form: { file: new File([PNG], "a.png", { type: "image/png" }) } },
		status: 200,
		body: { ok: { file: {} } },
	},
	{
		name: "file: stringa nel JSON",
		target: "form",
		zod: file,
		req: { json: { file: "x" } },
		status: 422,
		body: fail("File: tipo di file non ammesso"),
	},
	{
		name: "files: un file solo diventa un array",
		target: "form",
		zod: z.object({ files: zFiles({ type: "image", maxItems: 2 }) }),
		req: { form: { files: new File([PNG], "a.png", { type: "image/png" }) } },
		status: 200,
		body: { ok: { files: [{}] } },
	},
	{
		name: "files: troppi file",
		target: "form",
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
		z.object({ price: z.number(), isActive: z.boolean() }),
		{ price: "5", isActive: "true" },
		422,
		fail("Prezzo: deve essere un numero"),
	),
	body(
		"body: maxLength prima del formato",
		z.object({ email: zFormat("email").max(5) }),
		{ email: "not-an-email" },
		422,
		fail("Email: al massimo 5 caratteri"),
	),
	body(
		"body: Nullable(Integer) e Optional",
		z.object({ a: zInteger().nullable(), b: zFormat("email").optional() }),
		{ a: null, b: "" },
		422,
		fail("b: indirizzo email non valido"),
	),
	body(
		"body: Nullable(Integer) con testo",
		z.object({ a: zInteger().nullable() }),
		{ a: "x" },
		422,
		fail("a: deve essere un numero intero"),
	),
	body(
		"body: oggetto annidato mancante",
		z.object({ location: z.object({ lat: z.number() }), name: z.string() }),
		{ name: 3 },
		422,
		fail("location: campo obbligatorio"),
	),
	body(
		"body: unione di letterali numerici e stringhe",
		z.object({ v: z.union([z.literal(1), z.literal("x")]) }),
		{ v: 2 },
		422,
		fail("v: valore non ammesso"),
	),
	query("query: t.Date", z.object({ from: zDate() }), "?from=2026-01-01", 200, {
		ok: { from: "2026-01-01T00:00:00.000Z" },
	}),
	query(
		"query: t.Number senza vincoli e notazione esponenziale",
		z.object({ n: z.number() }),
		"?n=1e3",
		200,
		{ ok: { n: 1000 } },
	),
	query(
		"query: stringa vuota per un numero",
		z.object({ n: z.number().optional() }),
		"?n=",
		422,
		fail("n: valore non valido"),
	),

	// Ordine del primo errore con la pulizia di prima (`lib/schemas/mirror.ts`):
	// le chiavi anyOf mancanti prima, poi i campi nell'ordine dello schema.
	body(
		"ordine: t.Integer e t.Date mancanti prima del titolo (DiscountCreateBody)",
		DiscountCreateBody,
		{},
		422,
		fail("Percentuale: campo obbligatorio"),
	),
	body(
		"ordine: JSON null su uno schema con default (DiscountCreateBody)",
		DiscountCreateBody,
		null,
		422,
		fail("Percentuale: campo obbligatorio"),
	),
	body(
		"ordine: JSON numero su uno schema con default (DiscountCreateBody)",
		DiscountCreateBody,
		5,
		422,
		fail("Percentuale: campo obbligatorio"),
	),
	{
		name: "ordine: senza Content-Type su uno schema con default",
		target: "json",
		zod: DiscountCreateBody,
		req: { raw: "x" },
		status: 422,
		body: fail("Percentuale: campo obbligatorio"),
	},
	body(
		"ordine: solo il titolo manca (DiscountCreateBody)",
		DiscountCreateBody,
		{ percent: 5, startsAt: "2026-01-01" },
		422,
		fail("Titolo: campo obbligatorio"),
	),
	body(
		"ordine: unione di letterali mancante prima di una stringa",
		enumAfterString,
		{},
		422,
		fail("state: campo obbligatorio"),
	),
	body(
		"ordine: t.Nullable mancante prima di una stringa",
		nullableAfterString,
		{},
		422,
		fail("Note: campo obbligatorio"),
	),
	body(
		"ordine: stringa obbligatoria mancante dopo un campo non valido",
		plainOrder,
		{ a: "x" },
		422,
		fail("a: almeno 3 caratteri"),
	),
	body(
		"ordine: oggetto Optional null diventa un oggetto vuoto",
		z.object({ o: z.object({ p: z.string() }).optional() }),
		{ o: null },
		422,
		fail("o.p: campo obbligatorio"),
	),
	body(
		"ordine: numero su uno schema con oggetto annidato obbligatorio",
		z.object({ a: z.string(), o: z.object({ p: z.string() }) }),
		5,
		422,
		fail("Richiesta non valida"),
	),
	body(
		"ordine: JSON null con soli default di file",
		z.object({ name: z.string(), n: zInteger(), file: zFile() }),
		null,
		422,
		fail("Richiesta non valida"),
	),
	body(
		"ordine: JSON null con un default oltre al file",
		z.object({ name: z.string().default("a"), n: zInteger(), file: zFile() }),
		null,
		422,
		fail("n: campo obbligatorio"),
	),
	query(
		"ordine: in query un numero mancante prima di una stringa",
		z.object({ s: z.string(), n: z.number() }),
		"?",
		422,
		fail("n: campo obbligatorio"),
	),

	// t.Nullable di un array: l'errore sta sul campo, con la regola del primo
	// errore dentro e senza il messaggio custom annidato.
	body(
		"nullable: orario annidato non valido (openingHours)",
		openingHours,
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
		openingHours,
		{ openingHours: [{ dayOfWeek: 0 }] },
		422,
		fail("openingHours: campo obbligatorio"),
	),
	body(
		"nullable: giorno fuori intervallo (openingHours)",
		openingHours,
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
		openingHours,
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
		openingHours,
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

	// Pulizia delle unioni (handleUnion di exact-mirror): se nessun ramo
	// accetta il valore, vince il primo ramo che accetta il valore pulito; se
	// la pulizia di un ramo lancia, si controlla il body com'era.
	body(
		"unione pulita: una stringa vuota diventa [] (openingHours)",
		openingHours,
		{ openingHours: "   " },
		200,
		{ ok: { openingHours: [] } },
	),
	body(
		"unione pulita: la pulizia lancia, primo errore sul body com'era",
		z.object({
			name: z.string().min(1).meta({ error: "Il nome è obbligatorio" }),
			address: z.string().min(1).meta({ error: "L'indirizzo è obbligatorio" }),
			openingHours: OpeningHours.nullable().optional(),
		}),
		{ name: "", openingHours: [{ dayOfWeek: 1 }] },
		422,
		fail("L'indirizzo è obbligatorio"),
	),
	body(
		"unione pulita: la pulizia lancia, un oggetto annidato resta com'era",
		z.object({
			location: z.object({ x: z.number(), y: z.number() }).optional(),
			openingHours: OpeningHours.nullable().optional(),
		}),
		{ location: [], openingHours: "x" },
		422,
		fail("location: valore non valido"),
	),
	body(
		"Type.Integer: una stringa è «deve essere un numero intero»",
		z.object({ n: zInt().min(0) }),
		{ n: "1" },
		422,
		fail("n: deve essere un numero intero"),
	),
	// `zInt()` non ha i limiti dei safe integer di `z.int()` (U3, U6).
	{
		name: "Type.Integer: oltre i safe integer cita il massimo dello schema",
		target: "json",
		zod: z.object({ n: zInt().min(0).max(6) }),
		req: { raw: '{"n":9007199254740993}', contentType: "application/json" },
		status: 422,
		body: fail("n: deve essere al massimo 6"),
	},
	body(
		"Type.Integer: 1e21 senza massimo passa, 2.5 no",
		z.object({ n: zInt().min(0) }),
		{ n: 1e21 },
		200,
		{ ok: { n: 1e21 } },
	),
	body(
		"Type.Integer: 2.5 è «deve essere un numero intero»",
		z.object({ n: zInt().min(0) }),
		{ n: 2.5 },
		422,
		fail("n: deve essere un numero intero"),
	),

	// Unioni alla radice: un ramo che passa il controllo e fallisce la
	// decodifica dà l'errore di decodifica.
	body(
		"unione: t.Integer come stringa oltre il massimo (StockBulkAdjustBody)",
		StockBulkAdjustBody,
		{ storeId: "s", mode: "delta", value: "5000", productIds: ["a"] },
		422,
		fail("Valore non valido: deve essere al massimo 1000"),
	),
	body(
		"unione: nessun ramo valido (StockBulkAdjustBody)",
		StockBulkAdjustBody,
		{ storeId: "s", mode: "set", value: -1, productIds: ["a"] },
		422,
		fail("Richiesta non valida"),
	),
	body(
		"unione: oggetto vuoto (StockBulkAdjustBody)",
		StockBulkAdjustBody,
		{},
		422,
		fail("Richiesta non valida"),
	),
	body(
		"unione: intero come stringa valido (StockBulkAdjustBody)",
		StockBulkAdjustBody,
		{ storeId: "s", mode: "set", value: "7", productIds: ["a"], extra: 1 },
		200,
		{ ok: { storeId: "s", mode: "set", value: 7, productIds: ["a"] } },
	),
	body(
		"unione: mese come stringa oltre il massimo (CreateHolidayDefinitionBody)",
		CreateHolidayDefinitionBody,
		{ type: "fixed", name: "x", month: "13", day: 1 },
		422,
		fail("Valore non valido: deve essere al massimo 12"),
	),

	// Body con un file: oggetti e array di primo livello sono unioni, come
	// prima (ObjectString, ArrayString).
	{
		name: "multipart con file: oggetto JSON non valido",
		target: "form",
		zod: formWithFile,
		req: { form: { name: "n", meta: "{abc", tags: '["a"]', file: png() } },
		status: 422,
		body: fail("meta: valore non valido"),
	},
	{
		name: "multipart con file: oggetto JSON con un campo sbagliato",
		target: "form",
		zod: formWithFile,
		req: { form: { name: "n", meta: '{"a":5}', tags: '["a"]', file: png() } },
		status: 422,
		body: fail("meta: valore non valido"),
	},
	{
		name: "multipart con file: array come testo semplice",
		target: "form",
		zod: formWithFile,
		req: { form: { name: "n", meta: '{"a":"x"}', tags: "a,b", file: png() } },
		status: 422,
		body: fail("tags: valore non valido"),
	},
	{
		name: "multipart con file: oggetto e array mancanti prima del nome",
		target: "form",
		zod: formWithFile,
		req: { form: { file: png() } },
		status: 422,
		body: fail("meta: campo obbligatorio"),
	},
	body(
		"ordine: in un oggetto annidato t.Date mancante prima della stringa",
		z.object({ o: z.object({ s: z.string().min(3), d: zDate() }) }),
		{ o: { s: "x" } },
		422,
		fail("o.d: campo obbligatorio"),
	),
	body(
		"ordine: array Optional di oggetti null (la pulizia lancia)",
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

	// t.String conta le unità UTF-16, `z.string().min/max` i code point:
	// `zString` (giro di correzione di U3).
	body(
		"zString: maxLength in unità UTF-16 (101 emoji = 202)",
		name200,
		{ name: "😀".repeat(101) },
		422,
		fail("Nome: al massimo 200 caratteri"),
	),
	body(
		"zString: 100 emoji = 200 unità, al limite",
		name200,
		{ name: "😀".repeat(100) },
		200,
		{ ok: { name: "😀".repeat(100) } },
	),
	body(
		"zString: un emoji rispetta minLength 2 e maxLength 2",
		country2,
		{ country: "😀" },
		200,
		{ ok: { country: "😀" } },
	),
	body(
		"zString: minLength con title",
		country2,
		{ country: "a" },
		422,
		fail("Codice: almeno 2 caratteri"),
	),
	body(
		"zString: maxLength prima di pattern",
		phone,
		{ phone: "😀😀😀" },
		422,
		fail("Telefono: al massimo 5 caratteri"),
	),
	body(
		"zString: pattern",
		phone,
		{ phone: "a" },
		422,
		fail("Telefono: formato non valido"),
	),
	body(
		"zString: nullable, regola del ramo non nullo",
		z.object({ note: zString({ maxLength: 3 }).nullable() }),
		{ note: "😀😀" },
		422,
		fail("Note: al massimo 3 caratteri"),
	),
	query(
		"zString in query: maxLength in unità UTF-16",
		z.object({ storeIds: zString({ maxLength: 4 }) }),
		`?storeIds=${encodeURIComponent("😀😀😀")}`,
		422,
		fail("Negozi: al massimo 4 caratteri"),
	),

	// Numeri non finiti (`1e400` nel JSON è Infinity).
	{
		name: "t.Integer: 1e400 è «numero intero»",
		target: "json",
		zod: quantity199,
		req: { raw: '{"quantity":1e400}', contentType: "application/json" },
		status: 422,
		body: fail("Quantità: deve essere un numero intero"),
	},
	{
		name: "t.Integer: -1e400 è «numero intero»",
		target: "json",
		zod: quantity199,
		req: { raw: '{"quantity":-1e400}', contentType: "application/json" },
		status: 422,
		body: fail("Quantità: deve essere un numero intero"),
	},
	{
		name: "t.Number: 1e400 nel body",
		target: "json",
		zod: z.object({ price: z.number() }),
		req: { raw: '{"price":1e400}', contentType: "application/json" },
		status: 422,
		body: fail("Prezzo: deve essere un numero"),
	},
	query(
		"t.Number in query: 1e400",
		z.object({ price: z.number() }),
		"?price=1e400",
		422,
		fail("Valore non valido: deve essere un numero"),
	),

	// Interi oltre ±2^53: TypeBox controlla `Number.isInteger`, `z.int()` di
	// Zod anche i limiti dei safe integer (422 «al massimo 9007199254740991»).
	...bigIntegers(),
	// U5: gemelli dei form e dei body seller condivisi (prodotti, stock). Gli
	// schemi in linea nelle route li copre il batch catturato prima della migrazione
	// (`baseline/hono-batch-seller-products.jsonl`).
	body(
		"prodotti: body vuoto (CreateProductBody)",
		CreateProductBody,
		{},
		422,
		fail("Il nome è obbligatorio"),
	),
	body(
		"prodotti: nome di soli spazi (CreateProductBody)",
		CreateProductBody,
		{ name: "   ", price: "1.00", storeId: "s" },
		422,
		fail("Il nome è obbligatorio"),
	),
	body(
		"prodotti: prezzo senza decimali (CreateProductBody)",
		CreateProductBody,
		{ name: "X", price: "1", storeId: "s" },
		422,
		fail("Il prezzo deve essere nel formato 0.00"),
	),
	body(
		"prodotti: aliquota non ammessa (CreateProductBody)",
		CreateProductBody,
		{ name: "X", price: "1.00", storeId: "s", vatRate: "7" },
		422,
		fail("Aliquota IVA: valore non ammesso"),
	),
	body(
		"prodotti: EAN di 12 cifre (CreateProductBody)",
		CreateProductBody,
		{ name: "X", price: "1.00", storeId: "s", ean: "123456789012" },
		422,
		fail("EAN deve essere 8 o 13 cifre"),
	),
	body(
		"prodotti: valore di caratteristica non valido (CreateProductBody)",
		CreateProductBody,
		{
			name: "X",
			price: "1.00",
			storeId: "s",
			characteristicValues: [{ characteristicId: "c", value: {} }],
		},
		422,
		fail("Valore (riga 1): valore non valido"),
	),
	// Unione con più rami non nulli: Zod dà solo l'errore del ramo che combacia
	// col tipo (stringa troppo lunga), TypeBox «valore non valido».
	body(
		"prodotti: valore di caratteristica oltre 2000 caratteri (CreateProductBody)",
		CreateProductBody,
		{
			name: "X",
			price: "1.00",
			storeId: "s",
			characteristicValues: [
				{ characteristicId: "c", value: "y".repeat(2001) },
			],
		},
		422,
		fail("Valore (riga 1): valore non valido"),
	),
	body(
		"prodotti: valore oltre 2000 caratteri nella riga 2 (campo del PATCH)",
		z.object({ characteristicValues: CharacteristicValuesField.optional() }),
		{
			characteristicValues: [
				{ characteristicId: "c", value: "x" },
				{ characteristicId: "d", value: "y".repeat(2001) },
			],
		},
		422,
		fail("Valore (riga 2): valore non valido"),
	),
	body(
		"prodotti: default IVA, trim, campi ignoti tolti (CreateProductBody)",
		CreateProductBody,
		{
			name: " Pane ",
			price: "1.00",
			storeId: "s",
			ean: "",
			productCategoryId: null,
			characteristicValues: [
				{ characteristicId: "c", value: " x ", extra: 1 },
				{ characteristicId: "d", value: 5 },
				{ characteristicId: "e", value: null },
			],
			sellerProfileId: "altro",
		},
		200,
		{
			ok: {
				name: "Pane",
				price: "1.00",
				vatRate: "22",
				productCategoryId: null,
				ean: "",
				characteristicValues: [
					{ characteristicId: "c", value: "x" },
					{ characteristicId: "d", value: 5 },
					{ characteristicId: "e", value: null },
				],
				storeId: "s",
			},
		},
	),
	body(
		"prodotti: stato mancante (ProductStatusBody)",
		ProductStatusBody,
		{},
		422,
		fail("Stato: campo obbligatorio"),
	),
	body(
		"prodotti: stato non ammesso (ProductStatusBody)",
		ProductStatusBody,
		{ status: "deleted" },
		422,
		fail("Stato: valore non ammesso"),
	),
	body(
		"prodotti: lista vuota (BulkStatusBody)",
		BulkStatusBody,
		{ productIds: [], status: "active" },
		422,
		fail("Prodotti: almeno 1 elemento"),
	),
	body(
		"prodotti: più di 100 ID (BulkDeleteBody)",
		BulkDeleteBody,
		{ productIds: Array.from({ length: 101 }, (_, i) => `p${i}`) },
		422,
		fail("Prodotti: al massimo 100 elementi"),
	),
	body(
		"stock: delta mancante (StockAdjustBody)",
		StockAdjustBody,
		{},
		422,
		fail("Variazione di scorta: campo obbligatorio"),
	),
	body(
		"stock: delta come stringa oltre il massimo (StockAdjustBody)",
		StockAdjustBody,
		{ delta: "5000" },
		422,
		fail("Valore non valido: deve essere al massimo 1000"),
	),
	body(
		"stock: delta come stringa valido (StockAdjustBody)",
		StockAdjustBody,
		{ delta: "-3" },
		200,
		{ ok: { delta: -3 } },
	),
	// t.Integer non ha i limiti dei safe integer di `z.number().int()`.
	{
		name: "stock: delta oltre i safe integer (StockAdjustBody)",
		target: "json",
		zod: StockAdjustBody,
		req: { raw: '{"delta":9007199254740993}', contentType: "application/json" },
		status: 422,
		body: fail("Variazione di scorta: deve essere al massimo 1000"),
	},
	{
		name: "stock: delta infinito (StockAdjustBody)",
		target: "json",
		zod: StockAdjustBody,
		req: { raw: '{"delta":1e400}', contentType: "application/json" },
		status: 422,
		body: fail("Variazione di scorta: deve essere un numero intero"),
	},
	// ── gemelli di U6: negozi, impostazioni, team, onboarding, chiusure ──
	body(
		"negozio: body vuoto (CreateStoreBody)",
		CreateStoreBody,
		{},
		422,
		fail("Il nome è obbligatorio"),
	),
	body(
		"negozio: posizione mancante (CreateStoreBody)",
		CreateStoreBody,
		{ ...STORE, location: undefined },
		422,
		fail("La posizione del negozio sulla mappa è obbligatoria"),
	),
	body(
		"negozio: posizione del telefono come stringa (CreateStoreBody)",
		CreateStoreBody,
		{ ...STORE, phoneNumbers: [{ number: "051123456", position: "1" }] },
		422,
		fail("Posizione (riga 1): deve essere un numero intero"),
	),
	{
		name: "negozio: giorno oltre i safe integer (CreateStoreBody)",
		target: "json",
		zod: CreateStoreBody,
		req: {
			raw: JSON.stringify({ ...STORE, openingHours: "@" }).replace(
				'"@"',
				'[{"dayOfWeek":9007199254740993,"slots":[{"open":"09:00","close":"13:00"}]}]',
			),
			contentType: "application/json",
		},
		status: 422,
		body: fail("openingHours: deve essere al massimo 6"),
	},
	// Zod chiude gli errori del ramo in un invalid_union: la regola resta quella
	// dell'intero (`collapse()` in issues.ts).
	body(
		"negozio: giorno come stringa e orario sbagliato (CreateStoreBody)",
		CreateStoreBody,
		{
			...STORE,
			openingHours: [
				{ dayOfWeek: "1", slots: [{ open: "9", close: "13:00" }] },
			],
		},
		422,
		fail("openingHours: deve essere un numero intero"),
	),
	// 501 unità UTF-16 ma 257 code point: TypeBox controlla maxLength prima del formato.
	body(
		"negozio: sito oltre 500 unità UTF-16 con emoji (CreateStoreBody)",
		CreateStoreBody,
		{ ...STORE, websiteUrl: `https://x.it/${"😀".repeat(244)}` },
		422,
		fail("Sito web: al massimo 500 caratteri"),
	),
	body(
		"negozio: valido, con sito null, orari null e campi ignoti (CreateStoreBody)",
		CreateStoreBody,
		{
			...STORE,
			name: "  Bottega  ",
			websiteUrl: null,
			openingHours: null,
			phoneNumbers: [{ number: "051123456", position: 1e21, extra: 1 }],
			sellerProfileId: "x",
		},
		200,
		{
			ok: {
				...STORE,
				name: "Bottega",
				websiteUrl: null,
				openingHours: null,
				phoneNumbers: [{ number: "051123456", position: 1e21 }],
			},
		},
	),
	body(
		"negozio: sito non valido (CreateStoreBody)",
		CreateStoreBody,
		{ ...STORE, websiteUrl: "not a url" },
		422,
		fail("Sito web: indirizzo web non valido"),
	),
	body(
		"anagrafica: body vuoto (PersonalInfoBody)",
		PersonalInfoBody,
		{},
		422,
		fail("Il nome è obbligatorio"),
	),
	body(
		"anagrafica: data che non esiste (PersonalInfoBody)",
		PersonalInfoBody,
		{ ...PERSONAL, birthDate: "1990-02-30" },
		422,
		fail("Data non valida (AAAA-MM-GG)"),
	),
	body(
		"anagrafica: valida (PersonalInfoBody)",
		PersonalInfoBody,
		{ ...PERSONAL, firstName: " Mario " },
		200,
		{ ok: PERSONAL },
	),
	body(
		"documento: tipo non ammesso (DocumentBody)",
		DocumentBody,
		{ ...DOCUMENT, documentType: "badge" },
		422,
		fail("Seleziona il tipo di documento"),
	),
	body(
		"documento: scadenza nel formato sbagliato (DocumentBody)",
		DocumentBody,
		{ ...DOCUMENT, documentExpiry: "01/01/2030" },
		422,
		fail("Data non valida (AAAA-MM-GG)"),
	),
	body(
		"azienda: body vuoto (CompanyBody)",
		CompanyBody,
		{},
		422,
		fail("La ragione sociale è obbligatoria"),
	),
	body(
		"azienda: partita IVA corta (CompanyBody)",
		CompanyBody,
		{ ...COMPANY, vatNumber: "1" },
		422,
		fail("La partita IVA deve essere di 11 cifre"),
	),
	body(
		"impostazioni azienda: la partita IVA è un campo ignoto (CompanySettingsBody)",
		CompanySettingsBody,
		{ ...COMPANY, vatNumber: "12345678901" },
		200,
		{ ok: COMPANY },
	),
	body(
		"partita IVA: nel formato sbagliato (VatChangeBody)",
		VatChangeBody,
		{ vatNumber: "123" },
		422,
		fail("La partita IVA deve essere di 11 cifre"),
	),
	body(
		"invito: email non valida (TeamInviteBody)",
		TeamInviteBody,
		{ email: "bad", storeIds: ["a"] },
		422,
		fail("Inserisci un indirizzo email valido"),
	),
	...["a@b.c", "mario#rossi@test.it", "info@negozio.123", "x{y}@test.it"].map(
		(email) =>
			body(
				`invito: ${email} rifiutata come dall'app composta (TeamInviteBody)`,
				TeamInviteBody,
				{ email, storeIds: ["a"] },
				422,
				fail("Inserisci un indirizzo email valido"),
			),
	),
	body(
		"invito: nessun negozio (TeamInviteBody)",
		TeamInviteBody,
		{ email: " a@b.it ", storeIds: [] },
		422,
		fail("Seleziona almeno un negozio"),
	),
	body(
		"chiusure: data nel formato sbagliato (PutClosuresBody)",
		PutClosuresBody,
		{ optOutIds: [], customClosures: [{ startDate: "2026-1-1" }] },
		422,
		fail("Data di inizio (riga 1): formato non valido"),
	),
	body(
		"chiusure: valide, con la nota trimmata (PutClosuresBody)",
		PutClosuresBody,
		{
			optOutIds: ["h"],
			customClosures: [{ startDate: "2026-12-24", note: " Ferie ", x: 1 }],
		},
		200,
		{
			ok: {
				optOutIds: ["h"],
				customClosures: [{ startDate: "2026-12-24", note: "Ferie" }],
			},
		},
	),
	body(
		"t.Integer: 1e21 come numero e come stringa",
		z.object({ n: zInteger({ minimum: 0 }), s: zInteger({ minimum: 0 }) }),
		{ n: 1e21, s: "1e21" },
		200,
		{ ok: { n: 1e21, s: 1e21 } },
	),
	query(
		"paginazione: pagina oltre i safe integer (PaginationQuery)",
		PaginationQuery,
		"?page=9007199254740993",
		200,
		{ ok: { page: 9007199254740992, limit: 20 } },
	),
	query(
		"paginazione: limite oltre i safe integer (PaginationQuery)",
		PaginationQuery,
		"?limit=9007199254740993",
		422,
		fail("Valore non valido: deve essere al massimo 100"),
	),
	// Come prima, il frammento non si taglia: il `#` resta nell'ultimo valore.
	query(
		"query: il # resta nel valore, anche negli array",
		z.object({ q: z.string(), ids: z.array(z.string()) }),
		"?ids=a,b&q=x%20y#z&ids=c#d",
		200,
		{ ok: { q: "x y#z", ids: ["a", "b", "c#d"] } },
	),

	// U8: catalogo pubblico e admin 1 (attesi catturati prima della migrazione nel batch
	// `baseline/hono-batch-admin-1.jsonl`).
	query("U8 categorie: default", CategoryListQuery, "", 200, {
		ok: { page: 1, limit: 20, sortBy: "name", sortOrder: "asc" },
	}),
	query(
		"U8 categorie: page oltre i safe-int (t.Integer non li limita)",
		CategoryListQuery,
		"?page=9007199254740992",
		200,
		{
			ok: {
				page: 9007199254740992,
				limit: 20,
				sortBy: "name",
				sortOrder: "asc",
			},
		},
	),
	query(
		"U8 categorie: ordinamento non ammesso",
		CategoryListQuery,
		"?sortBy=foo",
		422,
		fail("sortBy: valore non ammesso"),
	),
	query(
		"U8 categorie: ricerca troppo lunga",
		CategoryListQuery,
		`?search=${"x".repeat(101)}`,
		422,
		fail("Ricerca: al massimo 100 caratteri"),
	),
	query(
		"U8 sotto-categorie: filtro macro e campi ignoti",
		ProductCategoryListQuery,
		"?macroCategoryId=m&foo=1&sortOrder=desc",
		200,
		{
			ok: {
				page: 1,
				limit: 20,
				sortBy: "name",
				sortOrder: "desc",
				macroCategoryId: "m",
			},
		},
	),
	query(
		"U8 caratteristiche: tipo non ammesso",
		CharacteristicListQuery,
		"?dataType=foo",
		422,
		fail("dataType: valore non ammesso"),
	),
	query(
		"U8 anteprima festività: anno mancante",
		HolidayPreviewQuery,
		"",
		422,
		fail("year: campo obbligatorio"),
	),
	query(
		"U8 anteprima festività: anno decimale",
		HolidayPreviewQuery,
		"?year=2026.5",
		422,
		fail("year: deve essere un numero intero"),
	),
	query(
		"U8 anteprima festività: anno fuori limite",
		HolidayPreviewQuery,
		"?year=1999",
		422,
		fail("Valore non valido: deve essere almeno 2000"),
	),
	query(
		"U8 anteprima festività: anno valido",
		HolidayPreviewQuery,
		"?year=2026",
		200,
		{ ok: { year: 2026 } },
	),
	body(
		"U8 macro prodotto: aliquota di default anche se assente",
		CreateProductMacroCategoryBody,
		{ name: " x " },
		200,
		{ ok: { name: "x", suggestedVatRate: "22" } },
	),
	body(
		"U8 macro prodotto: aliquota non ammessa",
		CreateProductMacroCategoryBody,
		{ name: "x", suggestedVatRate: "7" },
		422,
		fail("suggestedVatRate: valore non ammesso"),
	),
	body(
		"U8 caratteristica: id opzione non testo",
		CreateProductCharacteristicBody,
		{
			name: "x",
			dataType: "enum",
			options: [{ value: "a" }, { id: 1, value: "b" }],
		},
		422,
		fail("options.1.id: deve essere un testo"),
	),
	body(
		"U8 caratteristica: campi ignoti tolti, unità null",
		CreateProductCharacteristicBody,
		{
			name: " x ",
			dataType: "enum",
			unit: null,
			options: [{ value: "a", extra: 1 }],
			extra: 2,
		},
		200,
		{
			ok: {
				name: "x",
				dataType: "enum",
				unit: null,
				options: [{ value: "a" }],
			},
		},
	),
	body(
		"U8 caratteristica: confirmAffected di default",
		UpdateProductCharacteristicBody,
		{},
		200,
		{ ok: { confirmAffected: 0 } },
	),
	body(
		"U8 caratteristica: confirmAffected negativo come stringa",
		UpdateProductCharacteristicBody,
		{ confirmAffected: "-1" },
		422,
		fail("Valore non valido: deve essere almeno 0"),
	),
	body(
		"U8 caratteristica: unità troppo lunga",
		UpdateProductCharacteristicBody,
		{ unit: "x".repeat(21) },
		422,
		fail("unit: al massimo 20 caratteri"),
	),
	body(
		"U8 elimina caratteristica: confirmAffected mancante",
		DeleteProductCharacteristicBody,
		{},
		422,
		fail("confirmAffected: campo obbligatorio"),
	),
	body(
		"U8 elimina caratteristica: confirmAffected decimale",
		DeleteProductCharacteristicBody,
		{ confirmAffected: 1.5 },
		422,
		fail("confirmAffected: deve essere un numero intero"),
	),
	body(
		"U8 elimina caratteristica: confirmAffected oltre i safe-int",
		DeleteProductCharacteristicBody,
		{ confirmAffected: 1e20 },
		200,
		{ ok: { confirmAffected: 1e20 } },
	),
	body(
		"U8 caratteristica: confirmAffected come stringa oltre i safe-int",
		UpdateProductCharacteristicBody,
		{ confirmAffected: "9007199254740993" },
		200,
		{ ok: { confirmAffected: 9007199254740992 } },
	),
	body(
		"U8 togli caratteristica: confirmAffected negativo",
		RemoveCategoryCharacteristicBody,
		{ confirmAffected: -1 },
		422,
		fail("confirmAffected: deve essere almeno 0"),
	),
	body(
		"U8 assegna caratteristica: required non booleano",
		SetCategoryCharacteristicBody,
		{ required: "yes" },
		422,
		fail("required: deve essere vero o falso"),
	),
	body(
		"U8 festività: attivo non booleano",
		UpdateHolidayDefinitionBody,
		{ isActive: "no" },
		422,
		fail("Attivo: deve essere vero o falso"),
	),
	body(
		"U8 festività: trim e campi ignoti",
		UpdateHolidayDefinitionBody,
		{ name: "  y  ", isActive: false, extra: 1 },
		200,
		{ ok: { name: "y", isActive: false } },
	),
	body(
		"U8 caratteristica: nome di 51 emoji (TypeBox conta le unità UTF-16)",
		CreateProductCharacteristicBody,
		{ name: "😀".repeat(51), dataType: "text" },
		422,
		fail("Nome: al massimo 100 caratteri"),
	),
	// Spedizione di U6: i gemelli di U2, U4 e U5 passano a `zString` (contavano
	// i code point con `z.string().min/max`).
	body(
		"reg: password di 4 emoji = 8 unità UTF-16, accettata",
		Register,
		{ email: "a@b.it", password: "😀".repeat(4) },
		200,
		{ ok: { email: "a@b.it", password: "😀".repeat(4) } },
	),
	body(
		"reg: password di 65 emoji = 130 unità UTF-16",
		Register,
		{ email: "a@b.it", password: "😀".repeat(65) },
		422,
		fail("Password: al massimo 128 caratteri"),
	),
	body(
		"accept-invite: password di 4 emoji, accettata",
		AcceptInviteBody,
		{
			token: "t",
			password: "😀".repeat(4),
			confirmPassword: "😀".repeat(4),
		},
		200,
		{
			ok: {
				token: "t",
				password: "😀".repeat(4),
				confirmPassword: "😀".repeat(4),
			},
		},
	),
	query(
		"geocode: q di 2 emoji = 4 unità UTF-16, accettata",
		GeocodeQuery,
		`?q=${encodeURIComponent("😀😀")}`,
		200,
		{ ok: { q: "😀😀", limit: 5 } },
	),
	body(
		"prodotti: nome di 101 emoji = 202 unità UTF-16 (CreateProductBody)",
		CreateProductBody,
		{ name: "😀".repeat(101), price: "1.00", storeId: "s" },
		422,
		fail("Il nome è obbligatorio"),
	),
	body(
		"prodotti: valore di 1001 emoji = 2002 unità UTF-16",
		z.object({ characteristicValues: CharacteristicValuesField.optional() }),
		{
			characteristicValues: [
				{ characteristicId: "c", value: "😀".repeat(1001) },
			],
		},
		422,
		fail("Valore (riga 1): valore non valido"),
	),

	// U9: admin 2 (attesi catturati prima della migrazione nel batch
	// `baseline/hono-batch-admin-2.jsonl`, più i 200 dell'eco).
	query("U9 venditori: default", SellerListQuery, "", 200, {
		ok: { page: 1, limit: 20, sortBy: "createdAt", sortOrder: "desc" },
	}),
	query(
		"U9 venditori: stato non ammesso",
		SellerListQuery,
		"?status=foo",
		422,
		fail("Stato: valore non ammesso"),
	),
	query(
		"U9 venditori: ordinamento non ammesso",
		SellerListQuery,
		"?sortBy=email",
		422,
		fail("sortBy: valore non ammesso"),
	),
	query(
		"U9 venditori: ricerca di 51 emoji (unità UTF-16)",
		SellerListQuery,
		`?search=${encodeURIComponent("😀".repeat(51))}`,
		422,
		fail("Ricerca: al massimo 100 caratteri"),
	),
	query(
		"U9 venditori: ricerca non trimmata e campi ignoti",
		SellerListQuery,
		"?search=%20x%20&status=active&foo=1",
		200,
		{
			ok: {
				page: 1,
				limit: 20,
				sortBy: "createdAt",
				sortOrder: "desc",
				search: " x ",
				status: "active",
			},
		},
	),
	query("U9 negozi: default con il tab", StoreListQuery, "", 200, {
		ok: {
			page: 1,
			limit: 20,
			status: "all",
			sortBy: "createdAt",
			sortOrder: "desc",
		},
	}),
	query(
		"U9 negozi: tab non ammesso",
		StoreListQuery,
		"?status=foo",
		422,
		fail("Stato: valore non ammesso"),
	),
	query(
		"U9 negozi: pagina non numerica",
		StoreListQuery,
		"?page=abc",
		422,
		fail("Pagina: deve essere un numero intero"),
	),
	query(
		"U9 richieste: default del tipo (t.Composite)",
		RequestListQuery,
		"?limit=2",
		200,
		{ ok: { page: 1, limit: 2, type: "all" } },
	),
	query(
		"U9 richieste: tipo non ammesso",
		RequestListQuery,
		"?type=foo",
		422,
		fail("Tipo: valore non ammesso"),
	),
	query(
		"U9 abbonamenti: niente default",
		SubscriptionsQuery,
		"?page=2&sellerEmail=a&x=1",
		200,
		{ ok: { page: 2, sellerEmail: "a" } },
	),
	query(
		"U9 abbonamenti: stato non ammesso",
		SubscriptionsQuery,
		"?status=foo",
		422,
		fail("Stato: valore non ammesso"),
	),
	query(
		"U9 abbonamenti: limite a zero",
		SubscriptionsQuery,
		"?limit=0",
		422,
		fail("Valore non valido: deve essere almeno 1"),
	),
	body(
		"U9 prezzi: corpo vuoto",
		UpdatePricingBody,
		{},
		422,
		fail("storeMonthlyFeeCents: campo obbligatorio"),
	),
	body(
		"U9 prezzi: prodotto Stripe non valido",
		UpdatePricingBody,
		{ ...pricing, productId: "prod_" },
		422,
		fail("Prodotto: formato non valido"),
	),
	body(
		"U9 prezzi: valuta di 4 lettere",
		UpdatePricingBody,
		{ ...pricing, currency: "EURO" },
		422,
		fail("currency: al massimo 3 caratteri"),
	),
	body(
		"U9 prezzi: giorni sotto il minimo",
		UpdatePricingBody,
		{ ...pricing, suspendedAutoCancelDays: 6 },
		422,
		fail("suspendedAutoCancelDays: deve essere almeno 7"),
	),
	body(
		"U9 prezzi: ore decimali",
		UpdatePricingBody,
		{ ...pricing, pendingCreationExpiryHours: 1.5 },
		422,
		fail("pendingCreationExpiryHours: deve essere un numero intero"),
	),
	body(
		"U9 prezzi: intero in stringa, trim e campi ignoti",
		UpdatePricingBody,
		{ ...pricing, storeMonthlyFeeCents: "2900", currency: " EUR ", x: 1 },
		200,
		{ ok: { ...pricing, storeMonthlyFeeCents: 2900 } },
	),
	body(
		"U9 verifica: data mancante",
		VerifySellerBody,
		{},
		422,
		fail("expectedUpdatedAt: campo obbligatorio"),
	),
	body(
		"U9 verifica: data gg/mm/aaaa",
		VerifySellerBody,
		{ expectedUpdatedAt: "24/10/2026" },
		422,
		fail("expectedUpdatedAt: data non valida"),
	),
	body("U9 verifica: epoch", VerifySellerBody, { expectedUpdatedAt: 0 }, 200, {
		ok: { expectedUpdatedAt: "1970-01-01T00:00:00.000Z" },
	}),
	body(
		"U9 rifiuto: corpo vuoto (prima il campo anyOf mancante)",
		RejectSellerRouteBody,
		{},
		422,
		fail("fixStep: campo obbligatorio"),
	),
	body(
		"U9 rifiuto: motivo di soli spazi",
		RejectSellerRouteBody,
		{ reason: "   ", fixStep: null, expectedUpdatedAt: stale },
		422,
		fail("Indica il motivo del rifiuto"),
	),
	body(
		"U9 rifiuto: motivo di 251 emoji (unità UTF-16)",
		RejectSellerRouteBody,
		{ reason: "😀".repeat(251), fixStep: null, expectedUpdatedAt: stale },
		422,
		fail("Indica il motivo del rifiuto"),
	),
	body(
		"U9 rifiuto: step non ammesso",
		RejectSellerRouteBody,
		{
			reason: "Documento illeggibile",
			fixStep: "foo",
			expectedUpdatedAt: stale,
		},
		422,
		fail("fixStep: valore non valido"),
	),
	body(
		"U9 rifiuto: step mancante",
		RejectSellerRouteBody,
		{ reason: "Documento illeggibile", expectedUpdatedAt: stale },
		422,
		fail("fixStep: campo obbligatorio"),
	),
	body(
		"U9 rifiuto: trim e data",
		RejectSellerRouteBody,
		{
			reason: " Documento illeggibile ",
			fixStep: "document",
			expectedUpdatedAt: stale,
			x: 1,
		},
		200,
		{
			ok: {
				reason: "Documento illeggibile",
				fixStep: "document",
				expectedUpdatedAt: stale,
			},
		},
	),
	body("U9 modifica rifiutata: motivo facoltativo", RejectChangeBody, {}, 200, {
		ok: {},
	}),
	body(
		"U9 modifica rifiutata: motivo di 251 emoji (unità UTF-16)",
		RejectChangeBody,
		{ reason: "😀".repeat(251) },
		422,
		fail("Motivo: al massimo 500 caratteri"),
	),
	body(
		"U9 modifica rifiutata: motivo non testo",
		RejectChangeBody,
		{ reason: 5 },
		422,
		fail("Motivo: deve essere un testo"),
	),

	// U7: gemelli di promozioni, ordini e negozio (checkout).
	body(
		"promozioni: PATCH vuoto (DiscountUpdateBody)",
		DiscountUpdateBody,
		{},
		200,
		{ ok: {} },
	),
	body(
		"promozioni: PATCH con date, intero come stringa e campi ignoti",
		DiscountUpdateBody,
		{ percent: "10", endsAt: null, startsAt: "2026-02-01", status: "x" },
		200,
		{
			ok: {
				percent: 10,
				endsAt: null,
				startsAt: "2026-02-01T00:00:00.000Z",
			},
		},
	),
	body(
		"promozioni: PATCH titolo vuoto (DiscountUpdateBody)",
		DiscountUpdateBody,
		{ title: "", percent: 0 },
		422,
		fail("Titolo: campo obbligatorio"),
	),
	body(
		"promozioni: PATCH fine con l'offset senza segno (DiscountUpdateBody)",
		DiscountUpdateBody,
		{ endsAt: "2026-01-01T12:00:00 01:00" },
		422,
		fail("Fine: data non valida"),
	),
	body(
		"promozioni: PATCH inizio con l'offset senza segno (DiscountUpdateBody)",
		DiscountUpdateBody,
		{ startsAt: "2026-01-01T12:00 01:00" },
		422,
		fail("Inizio: data non valida"),
	),
	body(
		"promozioni: prodotti vuoti (DiscountProductsBody)",
		DiscountProductsBody,
		{ productIds: [] },
		422,
		fail("Prodotti: almeno 1 elemento"),
	),
	query(
		"ordini: stato e tipo (OrderListQuery)",
		OrderListQuery,
		"?status=confirmed&type=reserve_pickup&page=2",
		200,
		{ ok: { page: 2, limit: 20, status: "confirmed", type: "reserve_pickup" } },
	),
	query(
		"ordini: stato non ammesso (OrderListQuery)",
		OrderListQuery,
		"?status=bad",
		422,
		fail("Stato: valore non ammesso"),
	),
	body(
		"negozio: vuoto (CreateStoreBody)",
		CreateStoreBody,
		{},
		422,
		fail("Il nome è obbligatorio"),
	),
	body(
		"negozio: senza posizione (CreateStoreBody)",
		CreateStoreBody,
		{
			name: "Bottega",
			addressLine1: "Via Roma 1",
			municipalityId: "m1",
			zipCode: "40100",
		},
		422,
		fail("La posizione del negozio sulla mappa è obbligatoria"),
	),
	body(
		"negozio: posizione fuori intervallo (CreateStoreBody)",
		CreateStoreBody,
		{
			name: "Bottega",
			addressLine1: "Via Roma 1",
			municipalityId: "m1",
			zipCode: "40100",
			location: { x: 11, y: 144 },
		},
		422,
		fail("location.y: deve essere al massimo 90"),
	),
	body(
		"negozio: telefono con posizione negativa (CreateStoreBody)",
		CreateStoreBody,
		{
			name: "Bottega",
			addressLine1: "Via Roma 1",
			municipalityId: "m1",
			zipCode: "40100",
			location: { x: 11, y: 44 },
			phoneNumbers: [{ number: "051123456", position: -1 }],
		},
		422,
		fail("Posizione (riga 1): deve essere almeno 0"),
	),
	body(
		"negozio: posizione del telefono come stringa (Type.Integer)",
		CreateStoreBody,
		{
			name: "Bottega",
			addressLine1: "Via Roma 1",
			municipalityId: "m1",
			zipCode: "40100",
			location: { x: 11, y: 44 },
			phoneNumbers: [{ number: "051123456", position: "1" }],
		},
		422,
		fail("Posizione (riga 1): deve essere un numero intero"),
	),
	body(
		"negozio: valido, campi ignoti tolti, orari null (CreateStoreBody)",
		CreateStoreBody,
		{
			name: " Bottega ",
			addressLine1: "Via Roma 1",
			municipalityId: "m1",
			zipCode: "40100",
			location: { x: 11, y: 44, z: 1 },
			websiteUrl: null,
			openingHours: null,
			phoneNumbers: [{ number: "051123456", position: 0, extra: 1 }],
			sellerProfileId: "altro",
		},
		200,
		{
			ok: {
				name: "Bottega",
				addressLine1: "Via Roma 1",
				municipalityId: "m1",
				zipCode: "40100",
				location: { x: 11, y: 44 },
				websiteUrl: null,
				openingHours: null,
				phoneNumbers: [{ number: "051123456", position: 0 }],
			},
		},
	),
	// zString: TypeBox conta le unità UTF-16 (501 emoji sono 1002 > 1000).
	body(
		"negozio: descrizione di emoji oltre il limite (zString)",
		CreateStoreBody,
		{
			name: "Bottega",
			description: "😀".repeat(501),
			addressLine1: "Via Roma 1",
			municipalityId: "m1",
			zipCode: "40100",
			location: { x: 11, y: 44 },
		},
		422,
		fail("Descrizione: al massimo 1000 caratteri"),
	),
	// `Type.Union([X, Type.Null()])` (non t.Nullable): l'errore del ramo non
	// nullo sta sul campo, come per t.Nullable.
	body(
		"negozio: giorno fuori intervallo (Type.Union con Null)",
		CreateStoreBody,
		{
			name: "Bottega",
			addressLine1: "Via Roma 1",
			municipalityId: "m1",
			zipCode: "40100",
			location: { x: 11, y: 44 },
			openingHours: [
				{ dayOfWeek: 7, slots: [{ open: "09:00", close: "12:00" }] },
			],
		},
		422,
		fail("openingHours: deve essere al massimo 6"),
	),
	body(
		"negozio: orario fuori formato in profondità (Type.Union con Null)",
		CreateStoreBody,
		{
			name: "Bottega",
			addressLine1: "Via Roma 1",
			municipalityId: "m1",
			zipCode: "40100",
			location: { x: 11, y: 44 },
			openingHours: [
				{ dayOfWeek: 0, slots: [{ open: "9:00", close: "12:00" }] },
			],
		},
		422,
		fail("openingHours: formato non valido"),
	),
	body(
		"negozio: orari come testo (Type.Union con Null)",
		CreateStoreBody,
		{
			name: "Bottega",
			addressLine1: "Via Roma 1",
			municipalityId: "m1",
			zipCode: "40100",
			location: { x: 11, y: 44 },
			openingHours: "abc",
		},
		422,
		fail("openingHours: deve essere un elenco"),
	),
	body(
		"negozio: sito troppo lungo (Type.Union con Null)",
		CreateStoreBody,
		{
			name: "Bottega",
			addressLine1: "Via Roma 1",
			municipalityId: "m1",
			zipCode: "40100",
			location: { x: 11, y: 44 },
			websiteUrl: `https://x.it/${"a".repeat(500)}`,
		},
		422,
		fail("Sito web: al massimo 500 caratteri"),
	),
	body(
		"negozio: orario non valido e sito non valido (Type.Union con Null)",
		CreateStoreBody,
		{
			name: "Bottega",
			addressLine1: "Via Roma 1",
			municipalityId: "m1",
			zipCode: "40100",
			location: { x: 11, y: 44 },
			websiteUrl: "nope",
			openingHours: [
				{ dayOfWeek: 0, slots: [{ open: "9:00", close: "12:00" }] },
			],
		},
		422,
		fail("Sito web: indirizzo web non valido"),
	),
	// Un errore di tipo nel ramo non nullo fa fallire entrambi i rami: Zod dà
	// una sola issue `invalid_union` sul campo, e la regola va presa dallo
	// schema del ramo (`zInt()` → «numero intero», non «numero»).
	...[
		["testo", "1"],
		["null", null],
		["booleano", true],
	].map(([what, dayOfWeek]) =>
		body(
			`negozio: giorno come ${what} (Type.Union con Null)`,
			CreateStoreBody,
			{
				name: "Bottega",
				addressLine1: "Via Roma 1",
				municipalityId: "m1",
				zipCode: "40100",
				location: { x: 11, y: 44 },
				openingHours: [
					{ dayOfWeek: 1, slots: [{ open: "09:00", close: "12:00" }] },
					{ dayOfWeek, slots: [{ open: "09:00", close: "12:00" }] },
				],
			},
			422,
			fail("openingHours: deve essere un numero intero"),
		),
	),
	// Lo stesso con l'unione sul campo stesso (nessun form la usa ancora): guardia
	// per il merge con U6, che qui dava «numero» (`collapse()` di issues.ts).
	...[
		["testo", "1"],
		["booleano", true],
	].map(([what, n]) =>
		body(
			`vm: intero o null alla radice, ${what}`,
			z.object({ n: z.union([zInt(), z.null()]) }),
			{ n },
			422,
			fail("n: deve essere un numero intero"),
		),
	),
	// maxLength prima del formato, in unità UTF-16: 14 + 244 × 2 = 502.
	body(
		"negozio: sito di emoji oltre il limite (Type.Union con Null)",
		CreateStoreBody,
		{
			name: "Bottega",
			addressLine1: "Via Roma 1",
			municipalityId: "m1",
			zipCode: "40100",
			location: { x: 11, y: 44 },
			websiteUrl: `https://e.com/${"😀".repeat(244)}`,
		},
		422,
		fail("Sito web: al massimo 500 caratteri"),
	),
	// `Type.Integer` (zInt) non ha i limiti dei safe integer di `z.int()`.
	{
		name: "Type.Integer: giorno oltre i safe integer (OpeningHoursSchema)",
		target: "json",
		zod: openingHours,
		req: {
			raw: '{"openingHours":[{"dayOfWeek":9007199254740993,"slots":[{"open":"09:00","close":"10:00"}]}]}',
			contentType: "application/json",
		},
		status: 422,
		body: fail("openingHours: deve essere al massimo 6"),
	},
	{
		name: "Type.Integer: posizione oltre i safe integer (CreateStoreBody)",
		target: "json",
		zod: CreateStoreBody,
		req: {
			raw: '{"name":"B","addressLine1":"V","municipalityId":"m","zipCode":"40100","location":{"x":1,"y":2},"phoneNumbers":[{"number":"051123456","position":9007199254740993}]}',
			contentType: "application/json",
		},
		status: 200,
		body: {
			ok: {
				name: "B",
				addressLine1: "V",
				municipalityId: "m",
				zipCode: "40100",
				location: { x: 1, y: 2 },
				phoneNumbers: [{ number: "051123456", position: 9007199254740992 }],
			},
		},
	},
];

function bigIntegers(): Case[] {
	const page = z.object({ page: zInteger({ minimum: 1 }) });
	const typeboxQuantity = z.object({ quantity: zInt().min(1).max(99) });
	const json = (
		name: string,
		zod: z.ZodType,
		raw: string,
		status: number,
		expected: unknown,
	): Case => ({
		name,
		target: "json",
		zod,
		req: { raw, contentType: "application/json" },
		status,
		body: expected,
	});
	const max99 = "Quantità: deve essere al massimo 99";
	const min1 = "Quantità: deve essere almeno 1";
	return [
		query("t.Integer in query: 1e20", page, "?page=1e20", 200, {
			ok: { page: 1e20 },
		}),
		query("t.Integer in query: 2^53+1", page, "?page=9007199254740993", 200, {
			ok: { page: 9007199254740992 },
		}),
		query(
			"t.Integer in query: 20 cifre",
			page,
			"?page=99999999999999999999",
			200,
			{ ok: { page: 1e20 } },
		),
		query(
			"t.Integer in query: -1e20",
			page,
			"?page=-99999999999999999999",
			422,
			fail("Valore non valido: deve essere almeno 1"),
		),
		query(
			"t.Integer in query: 1e20 oltre il massimo",
			quantity199,
			"?quantity=1e20",
			422,
			fail("Valore non valido: deve essere al massimo 99"),
		),
		query(
			"t.Integer in query: 2^53+1 oltre il massimo",
			quantity199,
			"?quantity=9007199254740993",
			422,
			fail("Valore non valido: deve essere al massimo 99"),
		),
		query(
			"t.Integer in query: -1e20 sotto il minimo",
			quantity199,
			"?quantity=-1e20",
			422,
			fail("Valore non valido: deve essere almeno 1"),
		),
		json("t.Integer: 1e20 nel body", page, '{"page":1e20}', 200, {
			ok: { page: 1e20 },
		}),
		json("t.Integer: 2^53+1 nel body", page, '{"page":9007199254740993}', 200, {
			ok: { page: 9007199254740992 },
		}),
		json(
			"t.Integer: 20 cifre in stringa nel body",
			page,
			'{"page":"99999999999999999999"}',
			200,
			{ ok: { page: 1e20 } },
		),
		json(
			"t.Integer: 1e20 oltre il massimo",
			quantity199,
			'{"quantity":1e20}',
			422,
			fail(max99),
		),
		json(
			"t.Integer: -1e20 sotto il minimo",
			quantity199,
			'{"quantity":-1e20}',
			422,
			fail(min1),
		),
		json(
			"t.Integer: 2^53 oltre il massimo",
			quantity199,
			'{"quantity":9007199254740992}',
			422,
			fail(max99),
		),
		json(
			"t.Integer: 20 cifre in stringa oltre il massimo",
			quantity199,
			'{"quantity":"99999999999999999999"}',
			422,
			fail("Valore non valido: deve essere al massimo 99"),
		),
		json(
			"Type.Integer: 1e20 oltre il massimo",
			typeboxQuantity,
			'{"quantity":1e20}',
			422,
			fail(max99),
		),
		json(
			"Type.Integer: -1e20 sotto il minimo",
			typeboxQuantity,
			'{"quantity":-1e20}',
			422,
			fail(min1),
		),
		json(
			"Type.Integer: 2^53+1 oltre il massimo",
			typeboxQuantity,
			'{"quantity":9007199254740993}',
			422,
			fail(max99),
		),
		json(
			"Type.Integer: 20 cifre in stringa",
			typeboxQuantity,
			'{"quantity":"99999999999999999999"}',
			422,
			fail("Quantità: deve essere un numero intero"),
		),
		json(
			"Type.Integer: 1e20 senza massimo",
			z.object({ n: zInt().min(0) }),
			'{"n":1e20}',
			200,
			{ ok: { n: 1e20 } },
		),
	];
}
