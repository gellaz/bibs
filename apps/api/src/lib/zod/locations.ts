import { z } from "zod";
import { PaginationQuery } from "./pagination";
import { zInteger, zString } from "./t";

// Query di /locations (in Elysia erano scritte nella route): qui, senza
// effetti all'import, perché le usano anche i casi di parità
// (`tests/http/parity-cases.ts`).

export const ProvincesQuery = z.object({
	regionId: z
		.string()
		.meta({ description: "Filtra per ID regione" })
		.optional(),
});

export const MunicipalitiesQuery = PaginationQuery.extend({
	provinceId: z
		.string()
		.meta({ description: "Filtra per ID provincia" })
		.optional(),
});

export const GeocodeQuery = z.object({
	q: zString({
		minLength: 3,
		maxLength: 200,
		description: "Testo dell'indirizzo da cercare",
	}),
	limit: zInteger({
		minimum: 1,
		maximum: 10,
		default: 5,
		title: "Numero di suggerimenti",
		description: "Numero massimo di suggerimenti (default 5)",
	}).optional(),
	lat: z
		.number()
		.min(-90)
		.max(90)
		.meta({
			description:
				"Latitudine da cui cercare: i risultati vicini vengono primi",
		})
		.optional(),
	lng: z
		.number()
		.min(-180)
		.max(180)
		.meta({ description: "Longitudine da cui cercare" })
		.optional(),
});
