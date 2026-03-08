import { z } from "zod";

export const storeCategoryFormSchema = z.object({
	name: z.string().min(1, "Il nome è obbligatorio"),
});

export type StoreCategoryFormData = z.infer<typeof storeCategoryFormSchema>;
