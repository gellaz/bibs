import { afterAll, afterEach, describe, expect, it } from "vitest";
import { type ZodType, z } from "zod";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { zodResolver } from "./zod-resolver";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

afterAll(() => {
	z.config(z.locales.en());
});

/** Messaggio per campo (primo segmento del path), nella lingua indicata. */
function messages(
	locale: "it" | "en",
	schema: ZodType,
	value: unknown,
): Record<string, string> {
	overwriteGetLocale(() => locale);
	const result = schema.safeParse(value);
	if (result.success) throw new Error("expected a validation error");
	return Object.fromEntries(
		result.error.issues.map((i) => [String(i.path[0] ?? ""), i.message]),
	);
}

// L'error map è registrata dall'import di `zod-resolver.ts`, come nell'app.
describe("default zod messages", () => {
	const form = z.object({
		name: z.string().min(1).max(40),
		code: z.string().length(5),
		email: z.email(),
		zip: z.string().regex(/^\d{5}$/),
		age: z.coerce.number().int().min(18).max(120),
		kind: z.enum(["home", "work"]),
		ok: z.boolean(),
		when: z.iso.date(),
		site: z.url(),
		tags: z.array(z.string()).min(1).max(3),
		accept: z.string().refine((v) => v === "yes"),
	});
	const invalid = {
		name: "",
		code: "123",
		email: "x",
		zip: "12a",
		age: "abc",
		kind: "other",
		ok: "x",
		when: "x",
		site: "x",
		tags: [],
		accept: "no",
	};

	it("says the rule in Italian", () => {
		expect(messages("it", form, invalid)).toEqual({
			name: "Campo obbligatorio",
			code: "Almeno 5 caratteri",
			email: "Indirizzo email non valido",
			zip: "Formato non valido",
			age: "Deve essere un numero",
			kind: "Valore non ammesso",
			ok: "Deve essere vero o falso",
			when: "Data non valida (AAAA-MM-GG)",
			site: "Indirizzo web non valido",
			tags: "Almeno 1 elemento",
			accept: "Valore non valido",
		});
	});

	it("says the rule in English, read at validation time", () => {
		expect(messages("en", form, invalid)).toEqual({
			name: "Required",
			code: "At least 5 characters",
			email: "Invalid email address",
			zip: "Invalid format",
			age: "Must be a number",
			kind: "Value not allowed",
			ok: "Must be true or false",
			when: "Invalid date (YYYY-MM-DD)",
			site: "Invalid web address",
			tags: "At least 1 item",
			accept: "Invalid value",
		});
	});

	it("maps limits, whole numbers and missing fields", () => {
		const value = {
			...invalid,
			name: "a".repeat(41),
			age: "1.5",
			tags: ["a", "b", "c", "d"],
		};
		const { email: _, ...withoutEmail } = value;
		expect(messages("it", form, withoutEmail)).toMatchObject({
			name: "Al massimo 40 caratteri",
			age: "Deve essere un numero intero",
			tags: "Al massimo 3 elementi",
			email: "Campo obbligatorio",
		});
		expect(messages("en", form, { ...invalid, age: "200" })).toMatchObject({
			age: "Must be at most 120",
		});
		expect(messages("en", form, { ...invalid, age: "2" })).toMatchObject({
			age: "Must be at least 18",
		});
	});
});

describe("messages written on the schemas win", () => {
	// Le due forme usate dai form: stringa risolta alla costruzione (register)
	// e funzione letta alla validazione.
	const register = z
		.object({
			email: z
				.string()
				.min(1, "L'email è obbligatoria")
				.email({ error: () => "Email non valida" }),
			password: z.string().min(8, "Almeno 8, scritto"),
			confirmPassword: z.string(),
		})
		.refine((d) => d.password === d.confirmPassword, {
			message: "Le password non corrispondono",
			path: ["confirmPassword"],
		});

	it("keeps them in every language", () => {
		const value = { email: "", password: "123", confirmPassword: "456" };
		const expected = {
			email: "Email non valida",
			password: "Almeno 8, scritto",
			confirmPassword: "Le password non corrispondono",
		};
		expect(messages("en", register, value)).toEqual(expected);
		expect(messages("it", register, value)).toEqual(expected);
	});
});

describe("zodResolver", () => {
	it("shows the translated rule in the form errors", async () => {
		overwriteGetLocale(() => "en");
		const result = await zodResolver(z.object({ name: z.string().min(1) }))(
			{ name: "" },
			undefined,
			{ fields: {}, shouldUseNativeValidation: false },
		);
		expect(result.errors.name?.message).toBe("Required");
	});
});
