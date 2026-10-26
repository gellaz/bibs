import {
	CompanyBody,
	CreateStoreBody,
	DocumentBody,
	PersonalInfoBody,
} from "@bibs/api/schemas";

import { afterEach, describe, expect, it } from "vitest";
import { type ZodType, z } from "zod";
import { CreateProductFormBody } from "@/features/products/lib/product-form-schema";
import { storeFormSchema } from "@/features/stores/components/store-form";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { schemaErrorMessage, schemaResolver } from "./schema-errors";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

/** Il messaggio del primo errore, come lo prende il resolver. */
function first(schema: ZodType, value: unknown, locale: "it" | "en" = "it") {
	overwriteGetLocale(() => locale);
	return schema.safeParse(value, { error: schemaErrorMessage }).error?.issues[0]
		?.message;
}

const field = (schema: ZodType, value: unknown, locale?: "it" | "en") =>
	first(
		z.object({ f: schema }),
		value === undefined ? {} : { f: value },
		locale,
	);

/** Un formato che rifiuta tutto: qui conta solo il suo nome nel messaggio. */
const format = (name: string) => z.stringFormat(name, () => false);

describe("regola senza `error` sullo schema", () => {
	it("campo assente, undefined o vuoto: obbligatorio", () => {
		expect(field(z.string(), undefined)).toBe("Campo obbligatorio");
		expect(first(z.object({ f: z.string() }), { f: undefined })).toBe(
			"Campo obbligatorio",
		);
		expect(field(z.string().min(1), "")).toBe("Campo obbligatorio");
		expect(field(z.string(), undefined, "en")).toBe("Required");
	});

	it("tipi", () => {
		expect(field(z.string(), 3)).toBe("Deve essere un testo");
		expect(field(z.number(), "x")).toBe("Deve essere un numero");
		expect(field(z.int(), 1.5)).toBe("Deve essere un numero intero");
		expect(field(z.boolean(), "x")).toBe("Deve essere vero o falso");
		expect(field(z.array(z.string()), "x")).toBe("Deve essere un elenco");
		expect(field(z.int(), 1.5, "en")).toBe("Must be a whole number");
	});

	it("lunghezze dei testi, con il singolare", () => {
		expect(field(z.string().min(5), "abc")).toBe("Almeno 5 caratteri");
		expect(field(z.string().max(200), "a".repeat(201))).toBe(
			"Al massimo 200 caratteri",
		);
		expect(field(z.string().max(1), "ab")).toBe("Al massimo 1 carattere");
		expect(field(z.string().max(1000), "a".repeat(1001), "en")).toBe(
			"At most 1,000 characters",
		);
		expect(field(z.string().max(1000), "a".repeat(1001))).toBe(
			"Al massimo 1000 caratteri",
		);
	});

	it("pattern e formati", () => {
		expect(field(z.string().regex(/^\d{5}$/), "12a")).toBe(
			"Formato non valido",
		);
		expect(field(format("calendar-date"), "2024-02-30")).toBe(
			"Data non valida (AAAA-MM-GG)",
		);
		expect(field(format("calendar-date"), "2024-02-30", "en")).toBe(
			"Invalid date (YYYY-MM-DD)",
		);
		expect(field(format("uri"), "ftp://x")).toBe("Indirizzo web non valido");
		// Formato senza una regola sua: la regola generica.
		expect(field(format("boh"), "x")).toBe("Formato non valido");
	});

	it("limiti numerici", () => {
		expect(field(z.number().min(0), -1)).toBe("Deve essere almeno 0");
		expect(field(z.int().max(6), 7)).toBe("Deve essere al massimo 6");
		expect(field(z.number().gt(0), 0)).toBe("Deve essere maggiore di 0");
		expect(field(z.number().lt(100), 100)).toBe("Deve essere minore di 100");
		expect(field(z.number().min(0.5), 0)).toBe("Deve essere almeno 0,5");
		expect(field(z.number().min(0.5), 0, "en")).toBe("Must be at least 0.5");
	});

	it("elenchi, con il singolare", () => {
		const list = z.array(z.string());
		expect(field(list.min(1), [])).toBe("Almeno 1 elemento");
		expect(field(list.min(2), ["a"])).toBe("Almeno 2 elementi");
		expect(field(list.max(1), ["a", "b"])).toBe("Al massimo 1 elemento");
		expect(field(list.max(4), ["a", "b", "c", "d", "e"], "en")).toBe(
			"At most 4 items",
		);
		const unique = list.refine((a) => new Set(a).size === a.length, {
			params: { rule: { kind: "uniqueItems" } },
		});
		expect(field(unique, ["a", "a"])).toBe("Elementi duplicati");
	});

	it("union: letterali, nullable col ramo vero, date", () => {
		const vat = z.union([z.literal("22"), z.literal("10")]);
		expect(field(vat, "7")).toBe("Valore non ammesso");
		expect(field(z.literal("x"), "y")).toBe("Valore non ammesso");
		const website = z.union([format("uri").max(500), z.null()]);
		expect(field(website, "ftp://x")).toBe("Indirizzo web non valido");
		expect(field(website, "ftp://x", "en")).toBe("Invalid web address");
		expect(field(z.union([z.date(), z.string()]), 3)).toBe("Data non valida");
	});

	it("fallback: valore non valido", () => {
		expect(field(z.null(), "x")).toBe("Valore non valido");
		expect(field(z.union([z.string(), z.number()]), true, "en")).toBe(
			"Invalid value",
		);
	});
});

describe("`error` dello schema", () => {
	it("vince sulla regola, tradotto nella lingua corrente", () => {
		const name = z
			.string()
			.min(1)
			.max(200)
			.meta({ error: "Il nome è obbligatorio" });
		expect(field(name, "")).toBe("Il nome è obbligatorio");
		expect(field(name, undefined)).toBe("Il nome è obbligatorio");
		expect(field(name, "", "en")).toBe("Name is required");
	});

	it("non sulla lunghezza massima, dove direbbe il falso", () => {
		const name = z
			.string()
			.min(1)
			.max(200)
			.meta({ error: "Il nome è obbligatorio" });
		expect(field(name, "a".repeat(201))).toBe("Al massimo 200 caratteri");
		expect(field(name, "a".repeat(201), "en")).toBe("At most 200 characters");
	});

	it("senza traduzione: com'è in italiano, la regola nelle altre lingue", () => {
		const s = z.string().min(3).meta({ error: "Messaggio solo italiano" });
		expect(field(s, "ab")).toBe("Messaggio solo italiano");
		expect(field(s, "ab", "en")).toBe("At least 3 characters");
	});

	// Il dizionario è per stringa: se un `error` cambia o se ne aggiunge uno
	// senza traduzione, l'inglese ricadrebbe sulla regola generica.
	it("ogni `error` degli schemi dei form ha la sua traduzione", () => {
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
			walk(z.toJSONSchema(schema, { unrepresentable: "any" }));

		expect(errors.size).toBeGreaterThan(15);
		for (const error of errors) {
			const s = z.string().min(1).meta({ error });
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
		const resolver = schemaResolver(storeFormSchema);
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

	it("lo stesso schema segue la lingua al momento della validazione", async () => {
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
