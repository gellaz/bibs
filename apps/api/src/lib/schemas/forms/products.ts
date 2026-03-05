import { Type } from "@sinclair/typebox";

export const CreateProductBody = Type.Object({
	name: Type.String({
		minLength: 1,
		maxLength: 200,
		description: "Nome del prodotto",
		error: "Il nome è obbligatorio",
	}),
	description: Type.Optional(
		Type.String({
			maxLength: 2000,
			description: "Descrizione del prodotto",
		}),
	),
	price: Type.String({
		pattern: "^\\d+\\.\\d{2}$",
		description: "Prezzo (formato decimale, es. '9.99')",
		error: "Il prezzo deve essere nel formato 0.00",
	}),
	categoryIds: Type.Array(Type.String({ description: "ID categoria" }), {
		minItems: 1,
		description: "Almeno una categoria obbligatoria",
		error: "Seleziona almeno una categoria",
	}),
});
