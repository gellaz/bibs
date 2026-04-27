import { z } from "zod";

export const productCategoryFormSchema = z.object({
	name: z.string().min(1, "Il nome è obbligatorio"),
	macroCategoryId: z.string().min(1, "La macro categoria è obbligatoria"),
});

export type ProductCategoryFormData = z.infer<typeof productCategoryFormSchema>;
