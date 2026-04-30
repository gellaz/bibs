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
	categoryIds: Type.Optional(
		Type.Array(Type.String({ description: "ID categoria" }), {
			description:
				"Categorie del prodotto (opzionali). Se più di una, devono appartenere alla stessa macro-categoria",
		}),
	),
	ean: Type.Optional(
		Type.String({
			pattern: "^$|^(\\d{8}|\\d{13})$",
			description:
				"Codice EAN-8 (8 cifre) o EAN-13 (13 cifre). Stringa vuota equivale a omesso.",
			error: "EAN deve essere 8 o 13 cifre",
		}),
	),
	brandId: Type.Optional(
		Type.String({ description: "ID di un brand esistente del venditore" }),
	),
	brandName: Type.Optional(
		Type.String({
			minLength: 1,
			maxLength: 120,
			description:
				"Nome di un brand da creare (ignorato se brandId è valorizzato)",
		}),
	),
});
