import { z } from "zod";

export const productMacroCategoryFormSchema = z.object({
	name: z.string().min(1, "Il nome è obbligatorio"),
});

export type ProductMacroCategoryFormData = z.infer<
	typeof productMacroCategoryFormSchema
>;
