import { z } from "zod";

// ── Step 1: Personal Info ───────────────────

export const personalInfoSchema = z.object({
	firstName: z.string().min(1, "Il nome è obbligatorio"),
	lastName: z.string().min(1, "Il cognome è obbligatorio"),
	citizenship: z.string().min(1, "La cittadinanza è obbligatoria"),
	birthCountry: z.string().min(1, "Il paese di nascita è obbligatorio"),
	birthDate: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, "Formato data non valido (AAAA-MM-GG)"),
	residenceCountry: z.string().min(1, "Il paese di residenza è obbligatorio"),
	residenceCity: z.string().min(1, "La città di residenza è obbligatoria"),
	residenceAddress: z
		.string()
		.min(1, "L'indirizzo di residenza è obbligatorio"),
	residenceZipCode: z.string().min(1, "Il CAP è obbligatorio"),
});

export type PersonalInfoFormData = z.infer<typeof personalInfoSchema>;

// ── Step 2: Document ────────────────────────

export const documentSchema = z.object({
	documentNumber: z.string().min(1, "Il numero del documento è obbligatorio"),
	documentExpiry: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, "Formato data non valido (AAAA-MM-GG)"),
	documentIssuedMunicipality: z
		.string()
		.min(1, "Il comune di rilascio è obbligatorio"),
});

export type DocumentFormData = z.infer<typeof documentSchema>;

// ── Step 3: Company ─────────────────────────

export const companySchema = z.object({
	businessName: z.string().min(1, "La ragione sociale è obbligatoria"),
	vatNumber: z
		.string()
		.regex(/^\d{11}$/, "La partita IVA deve essere di 11 cifre"),
	legalForm: z.string().min(1, "La forma giuridica è obbligatoria"),
	addressLine1: z.string().min(1, "L'indirizzo è obbligatorio"),
	country: z.string().optional(),
	province: z.string().optional(),
	city: z.string().min(1, "La città è obbligatoria"),
	zipCode: z.string().min(1, "Il CAP è obbligatorio"),
});

export type CompanyFormData = z.infer<typeof companySchema>;

// ── Step 4: Store ───────────────────────────

export const storeSchema = z.object({
	name: z.string().min(1, "Il nome del negozio è obbligatorio"),
	description: z.string().optional(),
	addressLine1: z.string().min(1, "L'indirizzo è obbligatorio"),
	province: z.string().optional(),
	city: z.string().min(1, "La città è obbligatoria"),
	zipCode: z.string().min(1, "Il CAP è obbligatorio"),
	categoryId: z.string().optional(),
	useCompanyAddress: z.boolean().optional(),
});

export type StoreFormData = z.infer<typeof storeSchema>;

// ── Step 5: Payment ─────────────────────────

export const paymentSchema = z.object({
	stripeAccountId: z.string().optional(),
});

export type PaymentFormData = z.infer<typeof paymentSchema>;
