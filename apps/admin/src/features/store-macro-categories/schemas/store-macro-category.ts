import { z } from "zod";
import { m } from "@/paraglide/messages";

export const storeMacroCategoryFormSchema = z.object({
	name: z.string().min(1, { error: () => m.common_name_required() }),
});

export type StoreMacroCategoryFormData = z.infer<
	typeof storeMacroCategoryFormSchema
>;
