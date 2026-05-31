import { z } from "zod";

export const holidayFormSchema = z
	.object({
		type: z.enum(["fixed", "easter_relative", "one_off"]),
		name: z.string().min(1, "Il nome è obbligatorio"),
		month: z.string().optional(),
		day: z.string().optional(),
		easterOffsetDays: z.string().optional(),
		oneOffDate: z.string().optional(),
	})
	.superRefine((v, ctx) => {
		if (v.type === "fixed") {
			const m = Number(v.month);
			const d = Number(v.day);
			if (!v.month || m < 1 || m > 12)
				ctx.addIssue({
					code: "custom",
					path: ["month"],
					message: "Mese non valido",
				});
			if (!v.day || d < 1 || d > 31)
				ctx.addIssue({
					code: "custom",
					path: ["day"],
					message: "Giorno non valido",
				});
		} else if (v.type === "easter_relative") {
			if (v.easterOffsetDays === undefined || v.easterOffsetDays === "")
				ctx.addIssue({
					code: "custom",
					path: ["easterOffsetDays"],
					message: "Offset obbligatorio",
				});
		} else if (v.type === "one_off") {
			if (!v.oneOffDate || !/^\d{4}-\d{2}-\d{2}$/.test(v.oneOffDate))
				ctx.addIssue({
					code: "custom",
					path: ["oneOffDate"],
					message: "Data obbligatoria",
				});
		}
	});

export type HolidayFormData = z.infer<typeof holidayFormSchema>;

export const MONTHS = [
	"Gennaio",
	"Febbraio",
	"Marzo",
	"Aprile",
	"Maggio",
	"Giugno",
	"Luglio",
	"Agosto",
	"Settembre",
	"Ottobre",
	"Novembre",
	"Dicembre",
] as const;
