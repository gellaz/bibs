import { z } from "zod";
import { zInteger, zString } from "./t";

// Query di /locations/geocode (fino a U2 scritta nella route): qui, senza
// effetti all'import, perché la usano anche i casi di parità
// (`tests/unit/http/parity-cases.ts`).

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
