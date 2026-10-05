import { z } from "zod";
import { m } from "@/paraglide/messages";

export const productMacroCategoryFormSchema = z.object({
	name: z.string().min(1, { error: () => m.common_name_required() }),
	suggestedVatRate: z.enum(["22", "10", "5", "4", "0"]),
});

export type ProductMacroCategoryFormData = z.infer<
	typeof productMacroCategoryFormSchema
>;
