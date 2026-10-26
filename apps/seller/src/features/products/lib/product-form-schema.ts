import { CreateProductBody } from "@bibs/api/schemas";
import { z } from "zod";

// storeId is injected by the route at submit time — exclude it from form validation.
// price uses a looser pattern than the API's strict `^\d+\.\d{2}$`: a seller may
// type `9` or `9.9` in the number input, and onFormSubmit normalizes the value to
// exactly two decimals before it is sent on. Validating against the strict pattern
// here would reject those valid inputs outright (the normalization never runs).
export const CreateProductFormBody = CreateProductBody.omit({
	storeId: true,
	price: true,
	characteristicValues: true,
}).extend({
	price: z
		.string()
		.regex(/^\d+(\.\d{1,2})?$/)
		.meta({
			description: "Prezzo (max 2 decimali, es. '9', '9.9' o '9.99')",
			error: "Inserisci un prezzo valido (max 2 decimali)",
		}),
});
export type ProductFormData = z.infer<typeof CreateProductFormBody>;
