import { z } from "zod";

export const productFormSchema = z.object({
	name: z.string().min(1, "Il nome è obbligatorio"),
	description: z.string().optional(),
	price: z
		.string()
		.min(1, "Il prezzo è obbligatorio")
		.refine((val) => !Number.isNaN(Number(val)) && Number(val) > 0, {
			message: "Il prezzo deve essere maggiore di 0",
		})
		.transform((val) => {
			const trimmed = val.trim();
			return trimmed.includes(".")
				? trimmed
						.replace(/^(\d+\.\d{0,2}).*$/, "$1")
						.padEnd(trimmed.indexOf(".") + 3, "0")
				: `${trimmed}.00`;
		}),
	categoryIds: z.array(z.string()).min(1, "Seleziona almeno una categoria"),
});

export type ProductFormData = z.infer<typeof productFormSchema>;
