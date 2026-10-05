import { z } from "zod";
import { m } from "@/paraglide/messages";

export const storeCategoryFormSchema = z.object({
	name: z.string().min(1, { error: () => m.common_name_required() }),
	macroCategoryId: z
		.string()
		.min(1, { error: () => m.categories_macro_required() }),
});

export type StoreCategoryFormData = z.infer<typeof storeCategoryFormSchema>;
