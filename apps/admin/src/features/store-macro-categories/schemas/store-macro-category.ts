import { z } from "zod";

export const storeMacroCategoryFormSchema = z.object({
	name: z.string().min(1, "Il nome è obbligatorio"),
});

export type StoreMacroCategoryFormData = z.infer<
	typeof storeMacroCategoryFormSchema
>;
