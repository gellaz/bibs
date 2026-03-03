import { z } from "zod";

export const categoryFormSchema = z.object({
	name: z.string().min(1, "Il nome è obbligatorio"),
});

export type CategoryFormData = z.infer<typeof categoryFormSchema>;
