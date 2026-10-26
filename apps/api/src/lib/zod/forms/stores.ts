import { z } from "zod";
import { utf16Length, zFormat, zInt, zString } from "../t";
import { OpeningHoursSchema } from "./opening-hours";

// Gemello Zod di `lib/schemas/forms/stores.ts` (D3 del piano Hono). Le unioni
// con `Type.Null()` sono `z.union([…, z.null()])`, non `.nullable()`: in
// /openapi solo il t.Nullable di Elysia porta `nullable: true`.

const PhoneNumber = z.object({
	label: zString({
		maxLength: 50,
		description: "Etichetta (es. 'Principale')",
	}).optional(),
	number: zString({
		minLength: 5,
		maxLength: 30,
		description: "Numero di telefono",
		error: "Il numero è obbligatorio (minimo 5 caratteri)",
	}),
	position: zInt()
		.min(0)
		.meta({ description: "Posizione di ordinamento" })
		.optional(),
});

// Obbligatoria alla creazione: senza coordinate il negozio non compare nelle
// ricerche per prossimità.
const StoreLocation = z
	.object({
		x: z.number().min(-180).max(180).meta({ description: "Longitudine" }),
		y: z.number().min(-90).max(90).meta({ description: "Latitudine" }),
	})
	.meta({
		description: "Posizione del negozio (PostGIS point)",
		error: "La posizione del negozio sulla mappa è obbligatoria",
	});

export const CreateStoreBody = z.object({
	name: zString({
		minLength: 1,
		maxLength: 100,
		description: "Nome del negozio",
		error: "Il nome è obbligatorio",
	}),
	description: zString({
		maxLength: 1000,
		description: "Descrizione del negozio",
	}).optional(),
	addressLine1: zString({
		minLength: 1,
		maxLength: 200,
		description: "Indirizzo (riga 1)",
		error: "L'indirizzo è obbligatorio",
	}),
	addressLine2: zString({
		maxLength: 200,
		description: "Indirizzo (riga 2)",
	}).optional(),
	municipalityId: zString({
		minLength: 1,
		description: "ID del comune del negozio",
		error: "Il comune è obbligatorio",
	}),
	zipCode: z
		.string()
		.regex(/^\d{5}$/)
		.meta({
			description: "CAP italiano (5 cifre)",
			error: "Il CAP deve essere di 5 cifre",
		}),
	location: StoreLocation,
	country: zString({
		minLength: 2,
		maxLength: 2,
		description: "Codice paese ISO 3166-1 alpha-2 (default: IT)",
	}).optional(),
	categoryId: z
		.string()
		.meta({ description: "ID categoria negozio" })
		.optional(),
	websiteUrl: z
		.union([
			// `.max()` scrive maxLength in /openapi ma conta i code point:
			// `utf16Length` conta come TypeBox.
			zFormat("uri")
				.max(500)
				.check(utf16Length({ maxLength: 500 }))
				.meta({
					description: "URL del sito web. null per assenza esplicita",
				}),
			z.null(),
		])
		.optional(),
	openingHours: z.union([OpeningHoursSchema, z.null()]).optional(),
	phoneNumbers: z
		.array(PhoneNumber)
		.meta({ description: "Numeri di telefono del negozio" })
		.optional(),
});
