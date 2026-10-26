import { z } from "zod";
import { zInt } from "../t";

// Gemello Zod di `lib/schemas/forms/opening-hours.ts` (D3 del piano Hono).
// `Type.Integer` di TypeBox è `zInt`, non `zInteger` (niente stringhe).

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const time = (description: string) =>
	z
		.string()
		.regex(HHMM)
		.meta({ description, error: "Formato orario non valido (HH:mm)" });

export const TimeSlotSchema = z.object({
	open: time("Orario di apertura (HH:mm)"),
	close: time("Orario di chiusura (HH:mm)"),
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
