import { afterAll, afterEach, describe, expect, it } from "vitest";
import { type ZodType, z } from "zod";
import { loginFormSchema } from "@/features/auth/schemas/login";
import { holidayFormSchema } from "@/features/holidays/schemas/holiday";
import { productCategoryFormSchema } from "@/features/product-categories/schemas/product-category";
import { productCharacteristicFormSchema } from "@/features/product-characteristics/schemas/product-characteristic";
import { productMacroCategoryFormSchema } from "@/features/product-macro-categories/schemas/product-macro-category";
import { storeCategoryFormSchema } from "@/features/store-categories/schemas/store-category";
import { storeMacroCategoryFormSchema } from "@/features/store-macro-categories/schemas/store-macro-category";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { zodResolver } from "./zod-resolver";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

afterAll(() => {
	z.config(z.locales.en());
});

/** Messaggio per campo (path completo), nella lingua indicata. */
function messages(
	locale: "it" | "en",
	schema: ZodType,
	value: unknown,
): Record<string, string> {
	overwriteGetLocale(() => locale);
	const result = schema.safeParse(value);
	if (result.success) throw new Error("expected a validation error");
	return Object.fromEntries(
		result.error.issues.map((i) => [i.path.join("."), i.message]),
	);
}

// L'error map è registrata dall'import di `zod-resolver.ts`, come nell'app.
describe("default zod messages on the admin schemas", () => {
	it("characteristic name over 100 characters", () => {
		const value = {
			name: "a".repeat(101),
			dataType: "text",
			unit: "",
			options: [],
		};
		expect(messages("it", productCharacteristicFormSchema, value)).toEqual({
			name: "Al massimo 100 caratteri",
		});
		expect(messages("en", productCharacteristicFormSchema, value)).toEqual({
			name: "At most 100 characters",
		});
	});

	it("options outside the select", () => {
		expect(
			messages("it", productCharacteristicFormSchema, {
				name: "Colore",
				dataType: "date",
				unit: "",
				options: [],
			}),
		).toEqual({ dataType: "Valore non ammesso" });
		expect(
			messages("en", productMacroCategoryFormSchema, {
				name: "Alimentari",
				suggestedVatRate: "7",
			}),
		).toEqual({ suggestedVatRate: "Value not allowed" });
		expect(
			messages("it", holidayFormSchema, { type: "weekly", name: "Festa" }),
		).toEqual({ type: "Valore non ammesso" });
	});

	it("missing fields are required", () => {
		expect(messages("it", loginFormSchema, {})).toEqual({
			email: "Campo obbligatorio",
			password: "Campo obbligatorio",
		});
		expect(messages("en", storeMacroCategoryFormSchema, {})).toEqual({
			name: "Required",
		});
	});

	it("wrong types and other issues", () => {
		expect(
			messages("it", productCharacteristicFormSchema, {
				name: "Colore",
				dataType: "enum",
				unit: "",
				options: "Rosso",
			}),
		).toEqual({ options: "Deve essere un elenco" });
		expect(
			messages("en", productCategoryFormSchema, {
				name: 3,
				macroCategoryId: "x",
			}),
		).toEqual({ name: "Must be text" });
		// Un'issue senza regola dedicata (chiave non ammessa) cade sul generico.
		expect(
			messages("it", storeCategoryFormSchema.strict(), {
				name: "Bar",
				macroCategoryId: "x",
				extra: 1,
			}),
		).toEqual({ "": "Valore non valido" });
	});
});

describe("messages written on the schemas win", () => {
	it("login", () => {
		expect(
			messages("it", loginFormSchema, { email: "a@b", password: "" }),
		).toEqual({
			email: "Email non valida",
			password: "La password è obbligatoria",
		});
		expect(
			messages("en", loginFormSchema, { email: "", password: "" }),
		).toEqual({
			email: "Invalid email",
			password: "Password is required",
		});
	});

	it("categories", () => {
		const empty = { name: "", macroCategoryId: "" };
		expect(messages("it", productCategoryFormSchema, empty)).toEqual({
			name: "Il nome è obbligatorio",
			macroCategoryId: "La macro categoria è obbligatoria",
		});
		expect(messages("en", storeCategoryFormSchema, empty)).toEqual({
			name: "Name is required",
			macroCategoryId: "Macro category is required",
		});
		expect(
			messages("it", productMacroCategoryFormSchema, {
				name: "",
				suggestedVatRate: "22",
			}),
		).toEqual({ name: "Il nome è obbligatorio" });
		expect(messages("en", storeMacroCategoryFormSchema, { name: "" })).toEqual({
			name: "Name is required",
		});
	});

	it("holidays", () => {
		expect(
			messages("it", holidayFormSchema, {
				type: "fixed",
				name: "",
				month: "",
				day: "40",
			}),
		).toEqual({
			name: "Il nome è obbligatorio",
			month: "Mese non valido",
			day: "Giorno non valido",
		});
	});

	it("characteristics", () => {
		expect(
			messages("it", productCharacteristicFormSchema, {
				name: "   ",
				dataType: "number",
				unit: "x".repeat(21),
				options: [],
			}),
		).toEqual({
			name: "Il nome è obbligatorio",
			unit: "L'unità di misura non può superare 20 caratteri",
		});
		expect(
			messages("en", productCharacteristicFormSchema, {
				name: "Colore",
				dataType: "enum",
				unit: "",
				options: [{ value: "Rosso" }, { value: "Rosso" }],
			}),
		).toEqual({ options: 'Duplicate option: "Rosso"' });
	});
});

describe("zodResolver", () => {
	it("shows the translated rule in the form errors", async () => {
		overwriteGetLocale(() => "en");
		const result = await zodResolver(productCharacteristicFormSchema)(
			{ name: "a".repeat(101), dataType: "text", unit: "", options: [] },
			undefined,
			{ fields: {}, shouldUseNativeValidation: false },
		);
		expect(result.errors.name?.message).toBe("At most 100 characters");
	});
});
