import { Type } from "@sinclair/typebox";
import { OpeningHoursSchema } from "./opening-hours";

const PhoneNumber = Type.Object({
	label: Type.Optional(
		Type.String({
			maxLength: 50,
			description: "Etichetta (es. 'Principale')",
		}),
	),
	number: Type.String({
		minLength: 5,
		maxLength: 30,
		description: "Numero di telefono",
		error: "Il numero è obbligatorio (minimo 5 caratteri)",
	}),
	position: Type.Optional(
		Type.Number({
			minimum: 0,
			description: "Posizione di ordinamento",
		}),
	),
});

export const CreateStoreBody = Type.Object({
	name: Type.String({
		minLength: 1,
		maxLength: 100,
		description: "Nome del negozio",
		error: "Il nome è obbligatorio",
	}),
	description: Type.Optional(
		Type.String({
			maxLength: 1000,
			description: "Descrizione del negozio",
		}),
	),
	addressLine1: Type.String({
		minLength: 1,
		maxLength: 200,
		description: "Indirizzo (riga 1)",
		error: "L'indirizzo è obbligatorio",
	}),
	addressLine2: Type.Optional(
		Type.String({ maxLength: 200, description: "Indirizzo (riga 2)" }),
	),
	city: Type.String({
		minLength: 1,
		maxLength: 100,
		description: "Città",
		error: "La città è obbligatoria",
	}),
	zipCode: Type.String({
		pattern: "^\\d{5}$",
		description: "CAP italiano (5 cifre)",
		error: "Il CAP deve essere di 5 cifre",
	}),
	province: Type.Optional(
		Type.String({
			minLength: 2,
			maxLength: 5,
			description: "Provincia (sigla)",
		}),
	),
	country: Type.Optional(
		Type.String({
			minLength: 2,
			maxLength: 2,
			description: "Codice paese ISO 3166-1 alpha-2 (default: IT)",
		}),
	),
	categoryId: Type.Optional(
		Type.String({ description: "ID categoria negozio" }),
	),
	websiteUrl: Type.Optional(
		Type.String({
			format: "uri",
			maxLength: 500,
			description: "URL del sito web",
		}),
	),
	openingHours: Type.Optional(OpeningHoursSchema),
	phoneNumbers: Type.Optional(
		Type.Array(PhoneNumber, {
			description: "Numeri di telefono del negozio",
		}),
	),
});
