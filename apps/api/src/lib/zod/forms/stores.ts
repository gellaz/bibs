import { z } from "zod";
import { zFormat, zInt } from "../t";
import { OpeningHoursSchema } from "./opening-hours";

// Gemelli Zod di `lib/schemas/forms/stores.ts` (D3 del piano Hono), stessi
// nomi; si aggiungono quando una route migrata li usa. In U11b prendono il
// posto del file TypeBox (`@bibs/api/schemas`).

const PhoneNumber = z.object({
	label: z
		.string()
		.max(50)
		.meta({ description: "Etichetta (es. 'Principale')" })
		.optional(),
	number: z.string().min(5).max(30).meta({
		description: "Numero di telefono",
		error: "Il numero è obbligatorio (minimo 5 caratteri)",
	}),
	position: zInt({
		minimum: 0,
		description: "Posizione di ordinamento",
	}).optional(),
});

// Obbligatoria alla creazione: senza coordinate il negozio non compare nelle
// ricerche per prossimità. La sceglie il seller (suggerimento + pin), non la
// deduce il server.
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
	name: z.string().min(1).max(100).meta({
		description: "Nome del negozio",
		error: "Il nome è obbligatorio",
	}),
	description: z
		.string()
		.max(1000)
		.meta({ description: "Descrizione del negozio" })
		.optional(),
	addressLine1: z.string().min(1).max(200).meta({
		description: "Indirizzo (riga 1)",
		error: "L'indirizzo è obbligatorio",
	}),
	addressLine2: z
		.string()
		.max(200)
		.meta({ description: "Indirizzo (riga 2)" })
		.optional(),
	municipalityId: z.string().min(1).meta({
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
	country: z
		.string()
		.min(2)
		.max(2)
		.meta({
			description: "Codice paese ISO 3166-1 alpha-2 (default: IT)",
		})
		.optional(),
	categoryId: z
		.string()
		.meta({ description: "ID categoria negozio" })
		.optional(),
	// `Type.Union([X, Type.Null()])`, non `t.Nullable`: niente `nullable: true`
	// in /openapi, quindi `z.union` e non `.nullable()`.
	websiteUrl: z
		.union([
			zFormat("uri")
				.max(500)
				.meta({ description: "URL del sito web. null per assenza esplicita" }),
			z.null(),
		])
		.optional(),
	openingHours: z.union([OpeningHoursSchema, z.null()]).optional(),
	phoneNumbers: z
		.array(PhoneNumber)
		.meta({ description: "Numeri di telefono del negozio" })
		.optional(),
});
