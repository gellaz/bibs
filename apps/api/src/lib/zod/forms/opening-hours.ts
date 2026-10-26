import { z } from "zod";
import { zInt } from "../t";

// Gemelli Zod di `lib/schemas/forms/opening-hours.ts` (D3 del piano Hono),
// stessi nomi. `Type.Integer` di TypeBox è `zInt`, non `zInteger` (che accetta
// le stringhe come il `t.Integer` di Elysia) né `z.int()` (limiti safe-int).

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const TimeSlotSchema = z.object({
	open: z.string().regex(HHMM).meta({
		description: "Orario di apertura (HH:mm)",
		error: "Formato orario non valido (HH:mm)",
	}),
	close: z.string().regex(HHMM).meta({
		description: "Orario di chiusura (HH:mm)",
		error: "Formato orario non valido (HH:mm)",
	}),
});

export const DayScheduleSchema = z.object({
	dayOfWeek: zInt({
		minimum: 0,
		maximum: 6,
		description: "Giorno della settimana (0=Lunedì, 6=Domenica)",
	}),
	slots: z
		.array(TimeSlotSchema)
		.min(1)
		.max(4)
		.meta({ description: "Fasce orarie del giorno" }),
});

export const OpeningHoursSchema = z
	.array(DayScheduleSchema)
	.max(7)
	.meta({ description: "Orari di apertura del negozio" });
