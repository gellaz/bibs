import { z } from "zod";

export const vatFormSchema = z.object({
	vatNumber: z
		.string()
		.regex(/^\d{11}$/, "La partita IVA deve essere di 11 cifre numeriche"),
});

export type VatFormData = z.infer<typeof vatFormSchema>;
