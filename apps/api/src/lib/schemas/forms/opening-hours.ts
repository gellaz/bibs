import { Type } from "@sinclair/typebox";

export const TimeSlotSchema = Type.Object({
	open: Type.String({
		pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
		description: "Orario di apertura (HH:mm)",
		error: "Formato orario non valido (HH:mm)",
	}),
	close: Type.String({
		pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
		description: "Orario di chiusura (HH:mm)",
		error: "Formato orario non valido (HH:mm)",
	}),
});

export const DayScheduleSchema = Type.Object({
	dayOfWeek: Type.Integer({
		minimum: 0,
		maximum: 6,
		description: "Giorno della settimana (0=Lunedì, 6=Domenica)",
	}),
	slots: Type.Array(TimeSlotSchema, {
		minItems: 1,
		maxItems: 4,
		description: "Fasce orarie del giorno",
	}),
});

export const OpeningHoursSchema = Type.Array(DayScheduleSchema, {
	maxItems: 7,
	description: "Orari di apertura del negozio",
});
