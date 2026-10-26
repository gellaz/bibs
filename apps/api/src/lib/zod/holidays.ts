import { z } from "zod";

// Gemelli Zod di `lib/schemas/holidays.ts` (D3 del piano Hono), stessi nomi e
// stesso ordine; ogni unità aggiunge quelli delle sue route.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const d = (description: string) => ({ description });

const HolidayTypeSchema = z
	.enum(["fixed", "easter_relative", "one_off"])
	.meta(d("Tipo di definizione festività"));

export const CustomClosureSchema = z.object({
	startDate: z.string().regex(DATE).meta(d("Data inizio YYYY-MM-DD")),
	endDate: z
		.string()
		.regex(DATE)
		.meta(d("Data fine (assente = giorno singolo)"))
		.optional(),
	note: z.string().max(200).meta(d("Nota (es. Ferie estive)")).optional(),
});

export const OpenStatusSchema = z.object({
	isOpen: z.boolean(),
	status: z
		.enum(["open", "closed", "closed_holiday", "unknown"])
		.meta(
			d(
				"Stato del negozio; unknown significa che non ha mai dichiarato orari, non che è chiuso",
			),
		),
	closesAt: z.string().meta(d("Orario chiusura odierno (HH:mm)")).optional(),
	opensAt: z.object({ date: z.string(), time: z.string() }).optional(),
});

export const SellerClosuresResponse = z.object({
	holidays: z.array(
		z.object({
			definitionId: z.string(),
			name: z.string(),
			type: HolidayTypeSchema,
			nextDate: z.string().meta(d("Prossima occorrenza YYYY-MM-DD")).nullable(),
			observed: z.boolean().meta(d("Se il negozio osserva questa festività")),
		}),
	),
	customClosures: z.array(CustomClosureSchema),
});

export const PutClosuresBody = z.object({
	optOutIds: z
		.array(z.string())
		.meta(d("ID festività NON osservate dal negozio")),
	customClosures: z
		.array(CustomClosureSchema)
		.meta(d("Chiusure custom del negozio")),
});
