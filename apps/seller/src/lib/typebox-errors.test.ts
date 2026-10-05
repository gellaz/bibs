import {
	CompanyBody,
	CreateStoreBody,
	DocumentBody,
	PersonalInfoBody,
} from "@bibs/api/schemas";

import { type TSchema, Type } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { Value } from "@sinclair/typebox/value";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CreateProductFormBody } from "@/features/products/lib/product-form-schema";
import "@/lib/typebox-formats";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { registerTypeboxErrors } from "./typebox-errors";
import { typeboxResolver } from "./typebox-resolver";

const originalGetLocale = getLocale;

beforeAll(() => {
	registerTypeboxErrors();
});

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

/** Il messaggio del primo errore, come lo prende il resolver. */
function first(schema: TSchema, value: unknown, locale: "it" | "en" = "it") {
	overwriteGetLocale(() => locale);
	return Value.Errors(schema, value).First()?.message;
}

const field = (schema: TSchema, value: unknown, locale?: "it" | "en") =>
	first(
		Type.Object({ f: schema }),
		value === undefined ? {} : { f: value },
		locale,
	);

describe("regola senza `error:` sullo schema", () => {
	it("campo assente, undefined o vuoto: obbligatorio", () => {
		expect(field(Type.String(), undefined)).toBe("Campo obbligatorio");
		expect(first(Type.Object({ f: Type.String() }), { f: undefined })).toBe(
			"Campo obbligatorio",
		);
		expect(field(Type.String({ minLength: 1 }), "")).toBe("Campo obbligatorio");
		expect(field(Type.String(), undefined, "en")).toBe("Required");
	});

	it("tipi", () => {
		expect(field(Type.String(), 3)).toBe("Deve essere un testo");
		expect(field(Type.Number(), "x")).toBe("Deve essere un numero");
		expect(field(Type.Integer(), 1.5)).toBe("Deve essere un numero intero");
		expect(field(Type.Boolean(), "x")).toBe("Deve essere vero o falso");
		expect(field(Type.Array(Type.String()), "x")).toBe("Deve essere un elenco");
		expect(field(Type.Integer(), 1.5, "en")).toBe("Must be a whole number");
	});

	it("lunghezze dei testi, con il singolare", () => {
		expect(field(Type.String({ minLength: 5 }), "abc")).toBe(
			"Almeno 5 caratteri",
		);
		expect(field(Type.String({ maxLength: 200 }), "a".repeat(201))).toBe(
			"Al massimo 200 caratteri",
		);
		expect(field(Type.String({ maxLength: 1 }), "ab")).toBe(
			"Al massimo 1 carattere",
		);
		expect(
			field(Type.String({ maxLength: 1000 }), "a".repeat(1001), "en"),
		).toBe("At most 1,000 characters");
		expect(field(Type.String({ maxLength: 1000 }), "a".repeat(1001))).toBe(
			"Al massimo 1000 caratteri",
		);
	});

	it("pattern e formati", () => {
		expect(field(Type.String({ pattern: "^\\d{5}$" }), "12a")).toBe(
			"Formato non valido",
		);
		expect(field(Type.String({ format: "calendar-date" }), "2024-02-30")).toBe(
			"Data non valida (AAAA-MM-GG)",
		);
		expect(
			field(Type.String({ format: "calendar-date" }), "2024-02-30", "en"),
		).toBe("Invalid date (YYYY-MM-DD)");
		expect(field(Type.String({ format: "uri" }), "ftp://x")).toBe(
			"Indirizzo web non valido",
		);
		// Formato sconosciuto a TypeBox: la regola generica.
		expect(field(Type.String({ format: "boh" }), "x")).toBe(
			"Formato non valido",
		);
	});

	it("limiti numerici", () => {
		expect(field(Type.Number({ minimum: 0 }), -1)).toBe("Deve essere almeno 0");
		expect(field(Type.Integer({ maximum: 6 }), 7)).toBe(
			"Deve essere al massimo 6",
		);
		expect(field(Type.Number({ exclusiveMinimum: 0 }), 0)).toBe(
			"Deve essere maggiore di 0",
		);
		expect(field(Type.Number({ exclusiveMaximum: 100 }), 100)).toBe(
			"Deve essere minore di 100",
		);
		expect(field(Type.Number({ minimum: 0.5 }), 0)).toBe(
			"Deve essere almeno 0,5",
		);
		expect(field(Type.Number({ minimum: 0.5 }), 0, "en")).toBe(
			"Must be at least 0.5",
		);
	});

	it("elenchi, con il singolare", () => {
		const list = (opts: object) => Type.Array(Type.String(), opts);
		expect(field(list({ minItems: 1 }), [])).toBe("Almeno 1 elemento");
		expect(field(list({ minItems: 2 }), ["a"])).toBe("Almeno 2 elementi");
		expect(field(list({ maxItems: 1 }), ["a", "b"])).toBe(
			"Al massimo 1 elemento",
		);
		expect(field(list({ maxItems: 4 }), ["a", "b", "c", "d", "e"], "en")).toBe(
			"At most 4 items",
		);
		expect(field(list({ uniqueItems: true }), ["a", "a"])).toBe(
			"Elementi duplicati",
		);
	});

	it("union: letterali, nullable col ramo vero, date", () => {
		const vat = Type.Union([Type.Literal("22"), Type.Literal("10")]);
		expect(field(vat, "7")).toBe("Valore non ammesso");
		expect(field(Type.Literal("x"), "y")).toBe("Valore non ammesso");
		const website = Type.Union([
			Type.String({ format: "uri", maxLength: 500 }),
			Type.Null(),
		]);
		expect(field(website, "ftp://x")).toBe("Indirizzo web non valido");
		expect(field(website, "ftp://x", "en")).toBe("Invalid web address");
		expect(field(Type.Union([Type.Date(), Type.String()]), 3)).toBe(
			"Data non valida",
		);
	});

	it("fallback: valore non valido", () => {
		expect(field(Type.Null(), "x")).toBe("Valore non valido");
		expect(field(Type.Union([Type.String(), Type.Number()]), true, "en")).toBe(
			"Invalid value",
		);
	});
});

describe("`error:` dello schema", () => {
	it("vince sulla regola, tradotto nella lingua corrente", () => {
		const name = Type.String({
			minLength: 1,
			maxLength: 200,
			error: "Il nome è obbligatorio",
		});
		expect(field(name, "")).toBe("Il nome è obbligatorio");
		expect(field(name, undefined)).toBe("Il nome è obbligatorio");
		expect(field(name, "", "en")).toBe("Name is required");
	});

	it("non sulla lunghezza massima, dove direbbe il falso", () => {
		const name = Type.String({
			minLength: 1,
			maxLength: 200,
			error: "Il nome è obbligatorio",
		});
		expect(field(name, "a".repeat(201))).toBe("Al massimo 200 caratteri");
		expect(field(name, "a".repeat(201), "en")).toBe("At most 200 characters");
	});

	it("senza traduzione: com'è in italiano, la regola nelle altre lingue", () => {
		const s = Type.String({ minLength: 3, error: "Messaggio solo italiano" });
		expect(field(s, "ab")).toBe("Messaggio solo italiano");
		expect(field(s, "ab", "en")).toBe("At least 3 characters");
	});

	// Il dizionario è per stringa: se un `error:` cambia o se ne aggiunge uno
	// senza traduzione, l'inglese ricadrebbe sulla regola generica.
	it("ogni `error:` degli schemi dei form TypeBox ha la sua traduzione", () => {
		const errors = new Set<string>();
		const walk = (node: unknown) => {
			if (!node || typeof node !== "object") return;
			const error = (node as { error?: unknown }).error;
			if (typeof error === "string") errors.add(error);
			for (const child of Object.values(node)) walk(child);
		};
		for (const schema of [
			CreateProductFormBody,
			CreateStoreBody,
			PersonalInfoBody,
			DocumentBody,
			CompanyBody,
		])
			walk(schema);

		expect(errors.size).toBeGreaterThan(15);
		for (const error of errors) {
			const s = Type.String({ minLength: 1, error });
			// In italiano il testo dello schema, identico; in inglese un altro.
			expect(field(s, "")).toBe(error);
			expect(field(s, "", "en"), error).not.toBe(error);
			expect(field(s, "", "en"), error).not.toBe("Required");
		}
	});
});

describe("nel resolver dei form", () => {
	const resolve = async (locale: "it" | "en") => {
		overwriteGetLocale(() => locale);
		const resolver = typeboxResolver(TypeCompiler.Compile(CreateStoreBody));
		const { errors } = await resolver(
			{
				name: "",
				addressLine1: "Via Roma 1",
				municipalityId: "m",
				zipCode: "12a",
				websiteUrl: "ftp://x",
				phoneNumbers: [{ label: "", number: "12" }],
			} as never,
			undefined,
			{ fields: {}, shouldUseNativeValidation: false },
		);
		const e = errors as Record<string, { message?: string }> & {
			phoneNumbers?: { number?: { message?: string } }[];
		};
		return {
			name: e.name?.message,
			zipCode: e.zipCode?.message,
			websiteUrl: e.websiteUrl?.message,
			location: e.location?.message,
			phone: e.phoneNumbers?.[0]?.number?.message,
		};
	};

	it("lo stesso schema compilato segue la lingua al momento della validazione", async () => {
		expect(await resolve("it")).toEqual({
			name: "Il nome è obbligatorio",
			zipCode: "Il CAP deve essere di 5 cifre",
			websiteUrl: "Indirizzo web non valido",
			location: "La posizione del negozio sulla mappa è obbligatoria",
			phone: "Il numero è obbligatorio (minimo 5 caratteri)",
		});
		expect(await resolve("en")).toEqual({
			name: "Name is required",
			zipCode: "Postcode must be 5 digits",
			websiteUrl: "Invalid web address",
			location: "The store's position on the map is required",
			phone: "Number is required (at least 5 characters)",
		});
	});
});
