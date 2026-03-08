import { z } from "zod";

export const productCategoryFormSchema = z.object({
	name: z.string().min(1, "Il nome è obbligatorio"),
});

export type ProductCategoryFormData = z.infer<typeof productCategoryFormSchema>;
