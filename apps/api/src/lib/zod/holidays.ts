import { z } from "zod";

// Gemelli Zod di `lib/schemas/holidays.ts` (D3 del piano Hono), nello stesso
// ordine e con gli stessi nomi; per ora solo quelli delle route migrate.

export const OpenStatusSchema = z.object({
	isOpen: z.boolean(),
	status: z.enum(["open", "closed", "closed_holiday", "unknown"]).meta({
		description:
			"Stato del negozio; unknown significa che non ha mai dichiarato orari, non che è chiuso",
	}),
	closesAt: z
		.string()
		.meta({ description: "Orario chiusura odierno (HH:mm)" })
		.optional(),
	opensAt: z.object({ date: z.string(), time: z.string() }).optional(),
});
