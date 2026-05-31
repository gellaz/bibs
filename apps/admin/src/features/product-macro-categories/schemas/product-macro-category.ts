import { z } from "zod";

export const productMacroCategoryFormSchema = z.object({
	name: z.string().min(1, "Il nome è obbligatorio"),
	suggestedVatRate: z.enum(["22", "10", "5", "4", "0"]),
});

export type ProductMacroCategoryFormData = z.infer<
	typeof productMacroCategoryFormSchema
>;
