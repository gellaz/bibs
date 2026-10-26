import { CloneType, Type } from "@sinclair/typebox";
import { Elysia, type TSchema, t } from "elysia";
import { z } from "zod";
// Come `src/index.ts`: al load sovrascrive email, uuid e date nel FormatRegistry
// di TypeBox. Senza, il lato Elysia avrebbe i formati di Elysia nudo.
import "@elysiajs/openapi";
import "@/lib/schemas/forms/formats";
import { moduleApp } from "@/http/app";
import { type Target, v } from "@/http/validator";
import { PaginationQuery as TbPaginationQuery } from "@/lib/pagination";
import {
	CategoryListQuery as TbCategoryListQuery,
	CharacteristicListQuery as TbCharacteristicListQuery,
	ProductCategoryListQuery as TbProductCategoryListQuery,
	ProductSearchQuery as TbProductSearchQuery,
} from "@/lib/queries";
import {
	BulkDeleteBody as TbBulkDeleteBody,
	BulkStatusBody as TbBulkStatusBody,
	DiscountCreateBody as TbDiscountCreateBody,
	DiscountListQuery as TbDiscountListQuery,
	ProductStatusBody as TbProductStatusBody,
} from "@/lib/schemas";
import { VatRateSchema as TbVatRateSchema } from "@/lib/schemas/forms";
import {
	AcceptInviteBody as TbAcceptInviteBody,
	CompanyBody as TbCompanyBody,
	DocumentBody as TbDocumentBody,
	PersonalInfoBody as TbPersonalInfoBody,
	TeamInviteBody as TbTeamInviteBody,
} from "@/lib/schemas/forms/onboarding";
import { OpeningHoursSchema as TbOpeningHours } from "@/lib/schemas/forms/opening-hours";
import {
	CharacteristicValuesField as TbCharacteristicValuesField,
	CreateProductBody as TbCreateProductBody,
} from "@/lib/schemas/forms/products";
import {
	CompanySettingsBody as TbCompanySettingsBody,
	VatChangeBody as TbVatChangeBody,
} from "@/lib/schemas/forms/settings";
import { CreateStoreBody as TbCreateStoreBody } from "@/lib/schemas/forms/stores";
import {
	CreateHolidayDefinitionBody as TbCreateHolidayDefinitionBody,
	PutClosuresBody as TbPutClosuresBody,
	UpdateHolidayDefinitionBody as TbUpdateHolidayDefinitionBody,
} from "@/lib/schemas/holidays";
import {
	StockAdjustBody as TbStockAdjustBody,
	StockBulkAdjustBody as TbStockBulkAdjustBody,
} from "@/lib/schemas/stock";
import {
	BulkDeleteBody,
	BulkStatusBody,
	ProductStatusBody,
} from "@/lib/zod/entities";
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
	CreateHolidayDefinitionBody,
	PutClosuresBody,
	UpdateHolidayDefinitionBody,
} from "@/lib/zod/holidays";
import { GeocodeQuery, MunicipalitiesQuery } from "@/lib/zod/locations";
import { PaginationQuery } from "@/lib/zod/pagination";
import {
	CategoryListQuery,
	CharacteristicListQuery,
	ProductCategoryListQuery,
	ProductSearchQuery,
} from "@/lib/zod/queries";
import { RegisterBody, SignInBody } from "@/lib/zod/registration";
import { StockAdjustBody, StockBulkAdjustBody } from "@/lib/zod/stock";
import {
	zDate,
	zFile,
	zFiles,
	zFormat,
	zInt,
	zInteger,
	zString,
} from "@/lib/zod/t";
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
	// Una copia: compilando, Elysia scrive `additionalProperties: false` nello
	// schema, e `openapi.test.ts` (stesso processo) vuole la spec «a freddo».
	const tb = CloneType(c.tb);
	return c.target === "query"
		? app.get("/", ({ query }) => ({ ok: query }), { query: tb })
		: app.post("/", ({ body }) => ({ ok: body }), { body: tb });
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
const Register = RegisterBody;

// POST /register/sign-in
const TbSignIn = t.Object({
	email: t.String({ format: "email", description: "Indirizzo email" }),
	password: t.String({ description: "Password" }),
});

// GET /locations/geocode, /locations/municipalities (query scritte nella route)
const TbGeocodeQuery = t.Object({
	q: t.String({
		minLength: 3,
		maxLength: 200,
		description: "Testo dell'indirizzo da cercare",
	}),
	limit: t.Optional(
		t.Integer({
			minimum: 1,
			maximum: 10,
			default: 5,
			title: "Numero di suggerimenti",
			description: "Numero massimo di suggerimenti (default 5)",
		}),
	),
	lat: t.Optional(
		t.Number({
			minimum: -90,
			maximum: 90,
			description:
				"Latitudine da cui cercare: i risultati vicini vengono primi",
		}),
	),
	lng: t.Optional(
		t.Number({
			minimum: -180,
			maximum: 180,
			description: "Longitudine da cui cercare",
		}),
	),
});
const TbMunicipalitiesQuery = t.Composite([
	TbPaginationQuery,
	t.Object({
		provinceId: t.Optional(
			t.String({ description: "Filtra per ID provincia" }),
		),
	}),
]);

const DiscountCreateBody = z.object({
	title: zString({
		minLength: 1,
		maxLength: 80,
		description: "Titolo della promozione",
	}),
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
	search: zString({ maxLength: 80 }).optional(),
});

// Gemello di `ProductSearchQuery`: `lib/zod/queries.ts` (U3).

// ── i casi ──────────────────────────────────────────────────────────────────

// `OpeningHoursSchema` è in `lib/zod/forms/opening-hours.ts` da U6:
// `Type.Integer` di TypeBox è `zInt`, il `t.Integer` di Elysia è `zInteger`.
const OpeningHours = OpeningHoursSchema;

// Gemelli delle unioni alla radice: `z.union`, non `z.discriminatedUnion`
// (che sceglie il ramo dal discriminante e dà errori che TypeBox non dà).
// `StockBulkAdjustBody` è in `lib/zod/stock.ts` da U5.
// `CreateHolidayDefinitionBody` è in `lib/zod/holidays.ts` da U8.

// Gli schemi TypeBox delle route di U8 (catalogo e admin 1) che stavano dentro
// le route Elysia, copiati da lì: il confronto dal vivo resta fino a U11.
const tbOptions = t.Array(
	t.Object({
		id: t.Optional(
			t.String({
				description:
					"ID di un'opzione esistente: tenerlo permette di rinominarla senza perdere i valori dei prodotti",
			}),
		),
		value: t.String({ maxLength: 100, description: "Valore ammesso" }),
	}),
	{ description: "Opzioni della lista chiusa, nell'ordine di presentazione" },
);
const tbUnit = t.Optional(
	t.Nullable(
		t.String({
			maxLength: 20,
			description: "Unità di misura, solo per il tipo number",
		}),
	),
);
const tbDataType = t.Union(
	[
		t.Literal("text"),
		t.Literal("number"),
		t.Literal("boolean"),
		t.Literal("enum"),
	],
	{
		description:
			"Tipo di dato: text (testo libero), number (numero, con unità facoltativa), boolean (sì/no), enum (lista chiusa di opzioni)",
	},
);
const TbCreateProductCharacteristicBody = t.Object({
	name: t.String({
		minLength: 1,
		maxLength: 100,
		description: "Nome della caratteristica, univoco nel dizionario",
	}),
	dataType: tbDataType,
	unit: tbUnit,
	options: t.Optional(tbOptions),
});
const TbUpdateProductCharacteristicBody = t.Object({
	name: t.Optional(
		t.String({
			minLength: 1,
			maxLength: 100,
			description: "Nuovo nome della caratteristica",
		}),
	),
	dataType: t.Optional(tbDataType),
	unit: tbUnit,
	options: t.Optional(tbOptions),
	confirmAffected: t.Optional(
		t.Integer({
			minimum: 0,
			default: 0,
			description:
				"Numero di prodotti con un valore che l'interfaccia ha mostrato nella conferma. Serve quando la modifica rimuove opzioni in uso o cambia il tipo: se i prodotti coinvolti sono di più, 409 e nulla cambia.",
		}),
	),
});
const TbDeleteProductCharacteristicBody = t.Object({
	confirmAffected: t.Integer({
		minimum: 0,
		description:
			"Numero di prodotti con un valore che l'interfaccia ha mostrato nella conferma. Se i prodotti coinvolti sono di più, la richiesta è respinta con 409 e nulla viene cancellato.",
	}),
});
const TbRemoveCategoryCharacteristicBody = t.Object({
	confirmAffected: t.Integer({
		minimum: 0,
		description:
			"Numero di prodotti della sotto-categoria con un valore che l'interfaccia ha mostrato nella conferma. Se sono di più, 409 e nulla viene cancellato.",
	}),
});
const TbSetCategoryCharacteristicBody = t.Object({
	required: t.Boolean({ description: "Il venditore deve compilarla" }),
});
const TbCreateProductMacroCategoryBody = t.Object({
	name: t.String({
		minLength: 1,
		maxLength: 100,
		description: "Nome della macro categoria",
	}),
	suggestedVatRate: t.Optional(TbVatRateSchema),
});
const TbHolidayPreviewQuery = t.Object({
	year: t.Integer({
		minimum: 2000,
		maximum: 2100,
		description: "Anno da risolvere",
	}),
});

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
const quantity1e20 = [
	t.Object({ quantity: t.Integer() }),
	z.object({ quantity: zInteger() }),
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
const name200 = [
	t.Object({ name: t.String({ maxLength: 200 }) }),
	z.object({ name: zString({ maxLength: 200 }) }),
] as const;
const country2 = [
	t.Object({
		country: t.String({ minLength: 2, maxLength: 2, title: "Codice" }),
	}),
	z.object({
		country: zString({ minLength: 2, maxLength: 2, title: "Codice" }),
	}),
] as const;
const phone = [
	t.Object({
		phone: t.String({
			maxLength: 5,
			pattern: "^(.{2,})?$",
			description: "Telefono",
		}),
	}),
	z.object({
		phone: zString({
			maxLength: 5,
			pattern: "^(.{2,})?$",
			description: "Telefono",
		}),
	}),
] as const;
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
		"vm: email che solo Elysia nudo accetta (TLD di una lettera)",
		...fmt("email", zFormat("email")),
		{ x: "a@b.c" },
		422,
		fail("x: indirizzo email non valido"),
	),
	body(
		"vm: uuid fuori da RFC 9562",
		...fmt("uuid", zFormat("uuid")),
		{ x: "11111111-1111-1111-1111-111111111111" },
		422,
		fail("x: identificativo non valido"),
	),
	body(
		"vm: uuid v4 maiuscolo",
		...fmt("uuid", zFormat("uuid")),
		{ x: "3F1C2A4E-8B5D-4C6E-9F7A-1B2C3D4E5F60" },
		200,
		{ ok: { x: "3F1C2A4E-8B5D-4C6E-9F7A-1B2C3D4E5F60" } },
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
		"vm: t.Date con l'offset senza segno (il «+» di una query)",
		t.Object({ startsAt: t.Date() }),
		z.object({ startsAt: zDate() }),
		{ startsAt: "2026-01-01T12:00:00 01:00" },
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
		"reg: email che solo Elysia nudo accetta",
		TbRegister,
		Register,
		{ email: "mario#rossi@test.it", password: "12345678" },
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
		"reg: email trimmata, campi ignoti tolti",
		TbRegister,
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
		TbSignIn,
		SignInBody,
		{ email: "mario@example.it" },
		422,
		fail("Password: campo obbligatorio"),
	),
	body(
		"sign-in: vuoto",
		TbSignIn,
		SignInBody,
		{},
		422,
		fail("Email: campo obbligatorio"),
	),
	body(
		"accept-invite: vuoto → error dello schema",
		TbAcceptInviteBody,
		AcceptInviteBody,
		{},
		422,
		fail("Token mancante"),
	),
	body(
		"accept-invite: password corta",
		TbAcceptInviteBody,
		AcceptInviteBody,
		{ token: "x", password: "short", confirmPassword: "short" },
		422,
		fail("La password deve avere almeno 8 caratteri"),
	),
	body(
		"accept-invite: conferma corta",
		TbAcceptInviteBody,
		AcceptInviteBody,
		{ token: "x", password: "password123", confirmPassword: "short" },
		422,
		fail("La conferma password deve avere almeno 8 caratteri"),
	),
	body(
		"accept-invite: valido, campi ignoti tolti",
		TbAcceptInviteBody,
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
		TbGeocodeQuery,
		GeocodeQuery,
		"?q=Via%20Roma&limit=2.5",
		422,
		fail("Numero di suggerimenti: deve essere un numero intero"),
	),
	query(
		"geocode: q corta",
		TbGeocodeQuery,
		GeocodeQuery,
		"?q=ab",
		422,
		fail("q: almeno 3 caratteri"),
	),
	query(
		"geocode: q mancante",
		TbGeocodeQuery,
		GeocodeQuery,
		"",
		422,
		fail("q: campo obbligatorio"),
	),
	query(
		"geocode: lat non numerica",
		TbGeocodeQuery,
		GeocodeQuery,
		"?q=Via%20Roma&lat=abc",
		422,
		fail("Latitudine: valore non valido"),
	),
	query(
		"geocode: lat fuori intervallo (decodifica, etichetta persa)",
		TbGeocodeQuery,
		GeocodeQuery,
		"?q=Via%20Roma&lat=100",
		422,
		fail("Valore non valido: deve essere al massimo 90"),
	),
	query(
		"geocode: limit oltre il massimo",
		TbGeocodeQuery,
		GeocodeQuery,
		"?q=Via%20Roma&limit=11",
		422,
		fail("Valore non valido: deve essere al massimo 10"),
	),
	query(
		"geocode: default, coercizione, campi ignoti tolti",
		TbGeocodeQuery,
		GeocodeQuery,
		"?q=%20Via%20Roma&lat=45.4&lng=9.1&x=1",
		200,
		{ ok: { q: " Via Roma", lat: 45.4, lng: 9.1, limit: 5 } },
	),
	query(
		"municipalities: paginazione composta con provinceId",
		TbMunicipalitiesQuery,
		MunicipalitiesQuery,
		"?page=2&limit=3&page=1&provinceId=p&x=1",
		200,
		{ ok: { page: 1, limit: 3, provinceId: "p" } },
	),
	query(
		"municipalities: page=0",
		TbMunicipalitiesQuery,
		MunicipalitiesQuery,
		"?page=0",
		422,
		fail("Valore non valido: deve essere almeno 1"),
	),
	query(
		"municipalities: page oltre i safe-int (t.Integer non li limita)",
		TbMunicipalitiesQuery,
		MunicipalitiesQuery,
		"?page=9007199254740993",
		200,
		{ ok: { page: 9007199254740992, limit: 20 } },
	),
	query(
		"municipalities: limit oltre i safe-int → massimo 100",
		TbMunicipalitiesQuery,
		MunicipalitiesQuery,
		"?limit=9007199254740993",
		422,
		fail("Valore non valido: deve essere al massimo 100"),
	),
	body(
		"t.Integer: numero oltre i safe-int nel JSON",
		...quantity1e20,
		{ quantity: 1e20 },
		200,
		{ ok: { quantity: 1e20 } },
	),
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

	// Pulizia delle unioni (handleUnion di exact-mirror): se nessun ramo
	// accetta il valore, vince il primo ramo che accetta il valore pulito; se
	// la pulizia di un ramo lancia, Elysia controlla il body com'era.
	body(
		"unione pulita: una stringa vuota diventa [] (openingHours)",
		...openingHours,
		{ openingHours: "   " },
		200,
		{ ok: { openingHours: [] } },
	),
	body(
		"unione pulita: la pulizia lancia, primo errore sul body com'era",
		t.Object({
			name: t.String({ minLength: 1, error: "Il nome è obbligatorio" }),
			address: t.String({
				minLength: 1,
				error: "L'indirizzo è obbligatorio",
			}),
			openingHours: t.Optional(t.Nullable(TbOpeningHours)),
		}),
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
		t.Object({
			location: t.Optional(t.Object({ x: t.Number(), y: t.Number() })),
			openingHours: t.Optional(t.Nullable(TbOpeningHours)),
		}),
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
		t.Object({ n: Type.Integer({ minimum: 0 }) }),
		z.object({ n: zInt().min(0) }),
		{ n: "1" },
		422,
		fail("n: deve essere un numero intero"),
	),
	// `zInt()` non ha i limiti dei safe integer di `z.int()` (U3, U6).
	{
		name: "Type.Integer: oltre i safe integer cita il massimo dello schema",
		target: "json",
		tb: t.Object({ n: Type.Integer({ minimum: 0, maximum: 6 }) }),
		zod: z.object({ n: zInt().min(0).max(6) }),
		req: { raw: '{"n":9007199254740993}', contentType: "application/json" },
		status: 422,
		body: fail("n: deve essere al massimo 6"),
	},
	body(
		"Type.Integer: 1e21 senza massimo passa, 2.5 no",
		t.Object({ n: Type.Integer({ minimum: 0 }) }),
		z.object({ n: zInt().min(0) }),
		{ n: 1e21 },
		200,
		{ ok: { n: 1e21 } },
	),
	body(
		"Type.Integer: 2.5 è «deve essere un numero intero»",
		t.Object({ n: Type.Integer({ minimum: 0 }) }),
		z.object({ n: zInt().min(0) }),
		{ n: 2.5 },
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

	// t.String conta le unità UTF-16, `z.string().min/max` i code point:
	// `zString` (giro di correzione di U3).
	body(
		"zString: maxLength in unità UTF-16 (101 emoji = 202)",
		...name200,
		{ name: "😀".repeat(101) },
		422,
		fail("Nome: al massimo 200 caratteri"),
	),
	body(
		"zString: 100 emoji = 200 unità, al limite",
		...name200,
		{ name: "😀".repeat(100) },
		200,
		{ ok: { name: "😀".repeat(100) } },
	),
	body(
		"zString: un emoji rispetta minLength 2 e maxLength 2",
		...country2,
		{ country: "😀" },
		200,
		{ ok: { country: "😀" } },
	),
	body(
		"zString: minLength con title",
		...country2,
		{ country: "a" },
		422,
		fail("Codice: almeno 2 caratteri"),
	),
	body(
		"zString: maxLength prima di pattern",
		...phone,
		{ phone: "😀😀😀" },
		422,
		fail("Telefono: al massimo 5 caratteri"),
	),
	body(
		"zString: pattern",
		...phone,
		{ phone: "a" },
		422,
		fail("Telefono: formato non valido"),
	),
	body(
		"zString: nullable, regola del ramo non nullo",
		t.Object({ note: t.Nullable(t.String({ maxLength: 3 })) }),
		z.object({ note: zString({ maxLength: 3 }).nullable() }),
		{ note: "😀😀" },
		422,
		fail("Note: al massimo 3 caratteri"),
	),
	query(
		"zString in query: maxLength in unità UTF-16",
		t.Object({ storeIds: t.String({ maxLength: 4 }) }),
		z.object({ storeIds: zString({ maxLength: 4 }) }),
		`?storeIds=${encodeURIComponent("😀😀😀")}`,
		422,
		fail("Negozi: al massimo 4 caratteri"),
	),

	// Numeri non finiti (`1e400` nel JSON è Infinity).
	{
		name: "t.Integer: 1e400 è «numero intero»",
		target: "json",
		tb: quantity199[0],
		zod: quantity199[1],
		req: { raw: '{"quantity":1e400}', contentType: "application/json" },
		status: 422,
		body: fail("Quantità: deve essere un numero intero"),
	},
	{
		name: "t.Integer: -1e400 è «numero intero»",
		target: "json",
		tb: quantity199[0],
		zod: quantity199[1],
		req: { raw: '{"quantity":-1e400}', contentType: "application/json" },
		status: 422,
		body: fail("Quantità: deve essere un numero intero"),
	},
	{
		name: "t.Number: 1e400 nel body",
		target: "json",
		tb: t.Object({ price: t.Number() }),
		zod: z.object({ price: z.number() }),
		req: { raw: '{"price":1e400}', contentType: "application/json" },
		status: 422,
		body: fail("Prezzo: deve essere un numero"),
	},
	query(
		"t.Number in query: 1e400",
		t.Object({ price: t.Number() }),
		z.object({ price: z.number() }),
		"?price=1e400",
		422,
		fail("Valore non valido: deve essere un numero"),
	),

	// Interi oltre ±2^53: TypeBox controlla `Number.isInteger`, `z.int()` di
	// Zod anche i limiti dei safe integer (422 «al massimo 9007199254740991»).
	...bigIntegers(),
	// U5: gemelli dei form e dei body seller condivisi (prodotti, stock). Gli
	// schemi in linea nelle route li copre il batch catturato su Elysia
	// (`baseline/hono-batch-seller-products.jsonl`).
	body(
		"prodotti: body vuoto (CreateProductBody)",
		TbCreateProductBody,
		CreateProductBody,
		{},
		422,
		fail("Il nome è obbligatorio"),
	),
	body(
		"prodotti: nome di soli spazi (CreateProductBody)",
		TbCreateProductBody,
		CreateProductBody,
		{ name: "   ", price: "1.00", storeId: "s" },
		422,
		fail("Il nome è obbligatorio"),
	),
	body(
		"prodotti: prezzo senza decimali (CreateProductBody)",
		TbCreateProductBody,
		CreateProductBody,
		{ name: "X", price: "1", storeId: "s" },
		422,
		fail("Il prezzo deve essere nel formato 0.00"),
	),
	body(
		"prodotti: aliquota non ammessa (CreateProductBody)",
		TbCreateProductBody,
		CreateProductBody,
		{ name: "X", price: "1.00", storeId: "s", vatRate: "7" },
		422,
		fail("Aliquota IVA: valore non ammesso"),
	),
	body(
		"prodotti: EAN di 12 cifre (CreateProductBody)",
		TbCreateProductBody,
		CreateProductBody,
		{ name: "X", price: "1.00", storeId: "s", ean: "123456789012" },
		422,
		fail("EAN deve essere 8 o 13 cifre"),
	),
	body(
		"prodotti: valore di caratteristica non valido (CreateProductBody)",
		TbCreateProductBody,
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
		TbCreateProductBody,
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
		t.Object({ characteristicValues: t.Optional(TbCharacteristicValuesField) }),
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
		TbCreateProductBody,
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
		TbProductStatusBody,
		ProductStatusBody,
		{},
		422,
		fail("Stato: campo obbligatorio"),
	),
	body(
		"prodotti: stato non ammesso (ProductStatusBody)",
		TbProductStatusBody,
		ProductStatusBody,
		{ status: "deleted" },
		422,
		fail("Stato: valore non ammesso"),
	),
	body(
		"prodotti: lista vuota (BulkStatusBody)",
		TbBulkStatusBody,
		BulkStatusBody,
		{ productIds: [], status: "active" },
		422,
		fail("Prodotti: almeno 1 elemento"),
	),
	body(
		"prodotti: più di 100 ID (BulkDeleteBody)",
		TbBulkDeleteBody,
		BulkDeleteBody,
		{ productIds: Array.from({ length: 101 }, (_, i) => `p${i}`) },
		422,
		fail("Prodotti: al massimo 100 elementi"),
	),
	body(
		"stock: delta mancante (StockAdjustBody)",
		TbStockAdjustBody,
		StockAdjustBody,
		{},
		422,
		fail("Variazione di scorta: campo obbligatorio"),
	),
	body(
		"stock: delta come stringa oltre il massimo (StockAdjustBody)",
		TbStockAdjustBody,
		StockAdjustBody,
		{ delta: "5000" },
		422,
		fail("Valore non valido: deve essere al massimo 1000"),
	),
	body(
		"stock: delta come stringa valido (StockAdjustBody)",
		TbStockAdjustBody,
		StockAdjustBody,
		{ delta: "-3" },
		200,
		{ ok: { delta: -3 } },
	),
	// t.Integer non ha i limiti dei safe integer di `z.number().int()`.
	{
		name: "stock: delta oltre i safe integer (StockAdjustBody)",
		target: "json",
		tb: TbStockAdjustBody,
		zod: StockAdjustBody,
		req: { raw: '{"delta":9007199254740993}', contentType: "application/json" },
		status: 422,
		body: fail("Variazione di scorta: deve essere al massimo 1000"),
	},
	{
		name: "stock: delta infinito (StockAdjustBody)",
		target: "json",
		tb: TbStockAdjustBody,
		zod: StockAdjustBody,
		req: { raw: '{"delta":1e400}', contentType: "application/json" },
		status: 422,
		body: fail("Variazione di scorta: deve essere un numero intero"),
	},
	// ── gemelli di U6: negozi, impostazioni, team, onboarding, chiusure ──
	body(
		"negozio: body vuoto (CreateStoreBody)",
		TbCreateStoreBody,
		CreateStoreBody,
		{},
		422,
		fail("Il nome è obbligatorio"),
	),
	body(
		"negozio: posizione mancante (CreateStoreBody)",
		TbCreateStoreBody,
		CreateStoreBody,
		{ ...STORE, location: undefined },
		422,
		fail("La posizione del negozio sulla mappa è obbligatoria"),
	),
	body(
		"negozio: posizione del telefono come stringa (CreateStoreBody)",
		TbCreateStoreBody,
		CreateStoreBody,
		{ ...STORE, phoneNumbers: [{ number: "051123456", position: "1" }] },
		422,
		fail("Posizione (riga 1): deve essere un numero intero"),
	),
	{
		name: "negozio: giorno oltre i safe integer (CreateStoreBody)",
		target: "json",
		tb: TbCreateStoreBody,
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
		TbCreateStoreBody,
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
		TbCreateStoreBody,
		CreateStoreBody,
		{ ...STORE, websiteUrl: `https://x.it/${"😀".repeat(244)}` },
		422,
		fail("Sito web: al massimo 500 caratteri"),
	),
	body(
		"negozio: valido, con sito null, orari null e campi ignoti (CreateStoreBody)",
		TbCreateStoreBody,
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
		TbCreateStoreBody,
		CreateStoreBody,
		{ ...STORE, websiteUrl: "not a url" },
		422,
		fail("Sito web: indirizzo web non valido"),
	),
	body(
		"anagrafica: body vuoto (PersonalInfoBody)",
		TbPersonalInfoBody,
		PersonalInfoBody,
		{},
		422,
		fail("Il nome è obbligatorio"),
	),
	body(
		"anagrafica: data che non esiste (PersonalInfoBody)",
		TbPersonalInfoBody,
		PersonalInfoBody,
		{ ...PERSONAL, birthDate: "1990-02-30" },
		422,
		fail("Data non valida (AAAA-MM-GG)"),
	),
	body(
		"anagrafica: valida (PersonalInfoBody)",
		TbPersonalInfoBody,
		PersonalInfoBody,
		{ ...PERSONAL, firstName: " Mario " },
		200,
		{ ok: PERSONAL },
	),
	body(
		"documento: tipo non ammesso (DocumentBody)",
		TbDocumentBody,
		DocumentBody,
		{ ...DOCUMENT, documentType: "badge" },
		422,
		fail("Seleziona il tipo di documento"),
	),
	body(
		"documento: scadenza nel formato sbagliato (DocumentBody)",
		TbDocumentBody,
		DocumentBody,
		{ ...DOCUMENT, documentExpiry: "01/01/2030" },
		422,
		fail("Data non valida (AAAA-MM-GG)"),
	),
	body(
		"azienda: body vuoto (CompanyBody)",
		TbCompanyBody,
		CompanyBody,
		{},
		422,
		fail("La ragione sociale è obbligatoria"),
	),
	body(
		"azienda: partita IVA corta (CompanyBody)",
		TbCompanyBody,
		CompanyBody,
		{ ...COMPANY, vatNumber: "1" },
		422,
		fail("La partita IVA deve essere di 11 cifre"),
	),
	body(
		"impostazioni azienda: la partita IVA è un campo ignoto (CompanySettingsBody)",
		TbCompanySettingsBody,
		CompanySettingsBody,
		{ ...COMPANY, vatNumber: "12345678901" },
		200,
		{ ok: COMPANY },
	),
	body(
		"partita IVA: nel formato sbagliato (VatChangeBody)",
		TbVatChangeBody,
		VatChangeBody,
		{ vatNumber: "123" },
		422,
		fail("La partita IVA deve essere di 11 cifre"),
	),
	body(
		"invito: email non valida (TeamInviteBody)",
		TbTeamInviteBody,
		TeamInviteBody,
		{ email: "bad", storeIds: ["a"] },
		422,
		fail("Inserisci un indirizzo email valido"),
	),
	...["a@b.c", "mario#rossi@test.it", "info@negozio.123", "x{y}@test.it"].map(
		(email) =>
			body(
				`invito: ${email} rifiutata come dall'app composta (TeamInviteBody)`,
				TbTeamInviteBody,
				TeamInviteBody,
				{ email, storeIds: ["a"] },
				422,
				fail("Inserisci un indirizzo email valido"),
			),
	),
	body(
		"invito: nessun negozio (TeamInviteBody)",
		TbTeamInviteBody,
		TeamInviteBody,
		{ email: " a@b.it ", storeIds: [] },
		422,
		fail("Seleziona almeno un negozio"),
	),
	body(
		"chiusure: data nel formato sbagliato (PutClosuresBody)",
		TbPutClosuresBody,
		PutClosuresBody,
		{ optOutIds: [], customClosures: [{ startDate: "2026-1-1" }] },
		422,
		fail("Data di inizio (riga 1): formato non valido"),
	),
	body(
		"chiusure: valide, con la nota trimmata (PutClosuresBody)",
		TbPutClosuresBody,
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
		t.Object({ n: t.Integer({ minimum: 0 }), s: t.Integer({ minimum: 0 }) }),
		z.object({ n: zInteger({ minimum: 0 }), s: zInteger({ minimum: 0 }) }),
		{ n: 1e21, s: "1e21" },
		200,
		{ ok: { n: 1e21, s: 1e21 } },
	),
	query(
		"paginazione: pagina oltre i safe integer (PaginationQuery)",
		TbPaginationQuery,
		PaginationQuery,
		"?page=9007199254740993",
		200,
		{ ok: { page: 9007199254740992, limit: 20 } },
	),
	query(
		"paginazione: limite oltre i safe integer (PaginationQuery)",
		TbPaginationQuery,
		PaginationQuery,
		"?limit=9007199254740993",
		422,
		fail("Valore non valido: deve essere al massimo 100"),
	),
	// Elysia non taglia il frammento: il `#` resta nell'ultimo valore.
	query(
		"query: il # resta nel valore, anche negli array",
		t.Object({ q: t.String(), ids: t.Array(t.String()) }),
		z.object({ q: z.string(), ids: z.array(z.string()) }),
		"?ids=a,b&q=x%20y#z&ids=c#d",
		200,
		{ ok: { q: "x y#z", ids: ["a", "b", "c#d"] } },
	),

	// U8: catalogo pubblico e admin 1 (attesi catturati su Elysia nel batch
	// `baseline/hono-batch-admin-1.jsonl`).
	query(
		"U8 categorie: default",
		TbCategoryListQuery,
		CategoryListQuery,
		"",
		200,
		{
			ok: { page: 1, limit: 20, sortBy: "name", sortOrder: "asc" },
		},
	),
	query(
		"U8 categorie: page oltre i safe-int (t.Integer non li limita)",
		TbCategoryListQuery,
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
		TbCategoryListQuery,
		CategoryListQuery,
		"?sortBy=foo",
		422,
		fail("sortBy: valore non ammesso"),
	),
	query(
		"U8 categorie: ricerca troppo lunga",
		TbCategoryListQuery,
		CategoryListQuery,
		`?search=${"x".repeat(101)}`,
		422,
		fail("Ricerca: al massimo 100 caratteri"),
	),
	query(
		"U8 sotto-categorie: filtro macro e campi ignoti",
		TbProductCategoryListQuery,
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
		TbCharacteristicListQuery,
		CharacteristicListQuery,
		"?dataType=foo",
		422,
		fail("dataType: valore non ammesso"),
	),
	query(
		"U8 anteprima festività: anno mancante",
		TbHolidayPreviewQuery,
		HolidayPreviewQuery,
		"",
		422,
		fail("year: campo obbligatorio"),
	),
	query(
		"U8 anteprima festività: anno decimale",
		TbHolidayPreviewQuery,
		HolidayPreviewQuery,
		"?year=2026.5",
		422,
		fail("year: deve essere un numero intero"),
	),
	query(
		"U8 anteprima festività: anno fuori limite",
		TbHolidayPreviewQuery,
		HolidayPreviewQuery,
		"?year=1999",
		422,
		fail("Valore non valido: deve essere almeno 2000"),
	),
	query(
		"U8 anteprima festività: anno valido",
		TbHolidayPreviewQuery,
		HolidayPreviewQuery,
		"?year=2026",
		200,
		{ ok: { year: 2026 } },
	),
	body(
		"U8 macro prodotto: aliquota di default anche se assente",
		TbCreateProductMacroCategoryBody,
		CreateProductMacroCategoryBody,
		{ name: " x " },
		200,
		{ ok: { name: "x", suggestedVatRate: "22" } },
	),
	body(
		"U8 macro prodotto: aliquota non ammessa",
		TbCreateProductMacroCategoryBody,
		CreateProductMacroCategoryBody,
		{ name: "x", suggestedVatRate: "7" },
		422,
		fail("suggestedVatRate: valore non ammesso"),
	),
	body(
		"U8 caratteristica: id opzione non testo",
		TbCreateProductCharacteristicBody,
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
		TbCreateProductCharacteristicBody,
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
		TbUpdateProductCharacteristicBody,
		UpdateProductCharacteristicBody,
		{},
		200,
		{ ok: { confirmAffected: 0 } },
	),
	body(
		"U8 caratteristica: confirmAffected negativo come stringa",
		TbUpdateProductCharacteristicBody,
		UpdateProductCharacteristicBody,
		{ confirmAffected: "-1" },
		422,
		fail("Valore non valido: deve essere almeno 0"),
	),
	body(
		"U8 caratteristica: unità troppo lunga",
		TbUpdateProductCharacteristicBody,
		UpdateProductCharacteristicBody,
		{ unit: "x".repeat(21) },
		422,
		fail("unit: al massimo 20 caratteri"),
	),
	body(
		"U8 elimina caratteristica: confirmAffected mancante",
		TbDeleteProductCharacteristicBody,
		DeleteProductCharacteristicBody,
		{},
		422,
		fail("confirmAffected: campo obbligatorio"),
	),
	body(
		"U8 elimina caratteristica: confirmAffected decimale",
		TbDeleteProductCharacteristicBody,
		DeleteProductCharacteristicBody,
		{ confirmAffected: 1.5 },
		422,
		fail("confirmAffected: deve essere un numero intero"),
	),
	body(
		"U8 elimina caratteristica: confirmAffected oltre i safe-int",
		TbDeleteProductCharacteristicBody,
		DeleteProductCharacteristicBody,
		{ confirmAffected: 1e20 },
		200,
		{ ok: { confirmAffected: 1e20 } },
	),
	body(
		"U8 caratteristica: confirmAffected come stringa oltre i safe-int",
		TbUpdateProductCharacteristicBody,
		UpdateProductCharacteristicBody,
		{ confirmAffected: "9007199254740993" },
		200,
		{ ok: { confirmAffected: 9007199254740992 } },
	),
	body(
		"U8 togli caratteristica: confirmAffected negativo",
		TbRemoveCategoryCharacteristicBody,
		RemoveCategoryCharacteristicBody,
		{ confirmAffected: -1 },
		422,
		fail("confirmAffected: deve essere almeno 0"),
	),
	body(
		"U8 assegna caratteristica: required non booleano",
		TbSetCategoryCharacteristicBody,
		SetCategoryCharacteristicBody,
		{ required: "yes" },
		422,
		fail("required: deve essere vero o falso"),
	),
	body(
		"U8 festività: attivo non booleano",
		TbUpdateHolidayDefinitionBody,
		UpdateHolidayDefinitionBody,
		{ isActive: "no" },
		422,
		fail("Attivo: deve essere vero o falso"),
	),
	body(
		"U8 festività: trim e campi ignoti",
		TbUpdateHolidayDefinitionBody,
		UpdateHolidayDefinitionBody,
		{ name: "  y  ", isActive: false, extra: 1 },
		200,
		{ ok: { name: "y", isActive: false } },
	),
	body(
		"U8 caratteristica: nome di 51 emoji (TypeBox conta le unità UTF-16)",
		TbCreateProductCharacteristicBody,
		CreateProductCharacteristicBody,
		{ name: "😀".repeat(51), dataType: "text" },
		422,
		fail("Nome: al massimo 100 caratteri"),
	),
];

function bigIntegers(): Case[] {
	const page = [
		t.Object({ page: t.Integer({ minimum: 1 }) }),
		z.object({ page: zInteger({ minimum: 1 }) }),
	] as const;
	const typeboxQuantity = [
		t.Object({ quantity: Type.Integer({ minimum: 1, maximum: 99 }) }),
		z.object({ quantity: zInt().min(1).max(99) }),
	] as const;
	const json = (
		name: string,
		[tb, zod]: readonly [TSchema, z.ZodType],
		raw: string,
		status: number,
		expected: unknown,
	): Case => ({
		name,
		target: "json",
		tb,
		zod,
		req: { raw, contentType: "application/json" },
		status,
		body: expected,
	});
	const max99 = "Quantità: deve essere al massimo 99";
	const min1 = "Quantità: deve essere almeno 1";
	return [
		query("t.Integer in query: 1e20", ...page, "?page=1e20", 200, {
			ok: { page: 1e20 },
		}),
		query(
			"t.Integer in query: 2^53+1",
			...page,
			"?page=9007199254740993",
			200,
			{
				ok: { page: 9007199254740992 },
			},
		),
		query(
			"t.Integer in query: 20 cifre",
			...page,
			"?page=99999999999999999999",
			200,
			{ ok: { page: 1e20 } },
		),
		query(
			"t.Integer in query: -1e20",
			...page,
			"?page=-99999999999999999999",
			422,
			fail("Valore non valido: deve essere almeno 1"),
		),
		query(
			"t.Integer in query: 1e20 oltre il massimo",
			...quantity199,
			"?quantity=1e20",
			422,
			fail("Valore non valido: deve essere al massimo 99"),
		),
		query(
			"t.Integer in query: 2^53+1 oltre il massimo",
			...quantity199,
			"?quantity=9007199254740993",
			422,
			fail("Valore non valido: deve essere al massimo 99"),
		),
		query(
			"t.Integer in query: -1e20 sotto il minimo",
			...quantity199,
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
			[
				t.Object({ n: Type.Integer({ minimum: 0 }) }),
				z.object({ n: zInt().min(0) }),
			],
			'{"n":1e20}',
			200,
			{ ok: { n: 1e20 } },
		),
	];
}
