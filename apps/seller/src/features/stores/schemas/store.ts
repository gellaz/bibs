import { z } from "zod";

const phoneNumberSchema = z.object({
	label: z.string().optional(),
	number: z.string().min(1, "Il numero è obbligatorio"),
});

export const storeFormSchema = z.object({
	name: z.string().min(1, "Il nome è obbligatorio"),
	description: z.string().optional(),
	addressLine1: z.string().min(1, "L'indirizzo è obbligatorio"),
	addressLine2: z.string().optional(),
	city: z.string().min(1, "La città è obbligatoria"),
	zipCode: z.string().min(1, "Il CAP è obbligatorio"),
	province: z.string().max(2, "Massimo 2 caratteri").optional(),
	websiteUrl: z.string().url("URL non valido").optional().or(z.literal("")),
	phoneNumbers: z.array(phoneNumberSchema).optional(),
});

export type StoreFormData = z.infer<typeof storeFormSchema>;
