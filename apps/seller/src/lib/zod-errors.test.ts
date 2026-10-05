import { afterAll, afterEach, describe, expect, it } from "vitest";
import { type ZodType, z } from "zod";
import { loginFormSchema } from "@/features/auth/schemas/login";
import { registerFormSchema } from "@/features/auth/schemas/register";
import { businessInfoSchema } from "@/features/profile/components/business-info-card";
import { discountFormSchema } from "@/features/promotions/components/discount-form";
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

const discount = {
	title: "Saldi",
	percent: 10,
	startsAt: "2026-10-10T09:00",
	endsAt: "",
	noEndDate: true,
};

const company = {
	businessName: "Bottega Srl",
	legalForm: "SRL",
	addressLine1: "Via Roma 1",
	zipCode: "40100",
	municipalityId: "m1",
	country: "IT",
};

// Gli schemi importano il resolver da `zod-resolver.ts`, che registra l'error
// map: nessuna registrazione esplicita qui, come nell'app.
describe("default zod messages in the seller forms", () => {
	it("promotion: empty title, percent and start", () => {
		const value = { ...discount, title: "", percent: "abc", startsAt: "" };
		expect(messages("it", discountFormSchema, value)).toEqual({
			title: "Campo obbligatorio",
			percent: "Deve essere un numero",
			startsAt: "Campo obbligatorio",
		});
		expect(messages("en", discountFormSchema, value)).toEqual({
			title: "Required",
			percent: "Must be a number",
			startsAt: "Required",
		});
	});

	it("promotion: title too long, percent out of range or not whole", () => {
		const long = { ...discount, title: "a".repeat(81), percent: 100 };
		expect(messages("it", discountFormSchema, long)).toEqual({
			title: "Al massimo 80 caratteri",
			percent: "Deve essere al massimo 99",
		});
		expect(messages("en", discountFormSchema, long)).toEqual({
			title: "At most 80 characters",
			percent: "Must be at most 99",
		});
		expect(
			messages("it", discountFormSchema, { ...discount, percent: 0 }),
		).toEqual({ percent: "Deve essere almeno 1" });
		expect(
			messages("en", discountFormSchema, { ...discount, percent: "1.5" }),
		).toEqual({ percent: "Must be a whole number" });
	});

	it("profile: country of the wrong length", () => {
		expect(
			messages("it", businessInfoSchema, { ...company, country: "I" }),
		).toEqual({ country: "Almeno 2 caratteri" });
		expect(
			messages("en", businessInfoSchema, { ...company, country: "ITA" }),
		).toEqual({ country: "At most 2 characters" });
	});

	it("profile: a missing field is required", () => {
		const { country: _, ...withoutCountry } = company;
		expect(messages("it", businessInfoSchema, withoutCountry)).toEqual({
			country: "Campo obbligatorio",
		});
	});
});

describe("messages written on the schemas win", () => {
	it("keeps the profile and auth messages", () => {
		expect(
			messages("it", businessInfoSchema, {
				...company,
				businessName: "",
				zipCode: "12a",
			}),
		).toEqual({
			businessName: "Ragione sociale obbligatoria",
			zipCode: "CAP deve essere 5 cifre",
		});
		expect(
			messages("en", loginFormSchema, { email: "a@b", password: "" }),
		).toEqual({ email: "Invalid email", password: "Password is required" });
		expect(
			messages("it", registerFormSchema, {
				email: "a@b.it",
				password: "password123",
				confirmPassword: "password124",
			}),
		).toEqual({ confirmPassword: "Le password non corrispondono" });
	});

	it("keeps the promotion end-date message", () => {
		const value = { ...discount, noEndDate: false, endsAt: "2026-10-05T09:00" };
		expect(messages("it", discountFormSchema, value)).toEqual({
			endsAt: "La data di fine deve essere successiva all'inizio",
		});
	});
});

describe("fallbacks", () => {
	it("formats, options and refinements without a message", () => {
		expect(messages("it", z.object({ a: z.email() }), { a: "x" })).toEqual({
			a: "Indirizzo email non valido",
		});
		expect(
			messages("en", z.object({ a: z.enum(["x", "y"]) }), { a: "z" }),
		).toEqual({ a: "Value not allowed" });
		expect(
			messages("it", z.object({ a: z.string().refine(() => false) }), {
				a: "x",
			}),
		).toEqual({ a: "Valore non valido" });
		expect(
			messages("en", z.object({ a: z.string().regex(/^\d+$/) }), { a: "x" }),
		).toEqual({ a: "Invalid format" });
	});

	it("formats the limits with the current language", () => {
		const big = z.object({ n: z.number().max(10000) });
		expect(messages("it", big, { n: 20000 })).toEqual({
			n: "Deve essere al massimo 10.000",
		});
		expect(messages("en", big, { n: 20000 })).toEqual({
			n: "Must be at most 10,000",
		});
	});
});

describe("zodResolver", () => {
	it("shows the translated rule in the form errors", async () => {
		overwriteGetLocale(() => "it");
		const result = await zodResolver(discountFormSchema)(
			{ ...discount, title: "" },
			undefined,
			{ fields: {}, shouldUseNativeValidation: false },
		);
		expect(result.errors.title?.message).toBe("Campo obbligatorio");
	});
});
