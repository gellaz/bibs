import { z } from "zod";
import { zDate, zInteger } from "./t";

// Gemelli Zod di `lib/schemas/holidays.ts` (D3 del piano Hono), nello stesso
// ordine e con gli stessi nomi; per ora solo quelli delle route migrate.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const HolidayTypeSchema = z
	.enum(["fixed", "easter_relative", "one_off"])
	.meta({ description: "Tipo di definizione festività" });

export const HolidayDefinitionSchema = z.object({
	id: z.string(),
	name: z.string().meta({ description: "Nome della festività" }),
	type: HolidayTypeSchema,
	month: zInteger({ description: "Mese (1-12), per tipo fixed" }).nullable(),
	day: zInteger({ description: "Giorno (1-31), per tipo fixed" }).nullable(),
	easterOffsetDays: zInteger({
		description: "Offset dalla Pasqua, per easter_relative",
	}).nullable(),
	oneOffDate: z
		.string()
		.meta({ description: "Data YYYY-MM-DD, per one_off" })
		.nullable(),
	isActive: z.boolean().meta({ description: "Se la festività è attiva" }),
	createdAt: zDate(),
	updatedAt: zDate(),
});

export const HolidayPreviewSchema = z.object({
	definitionId: z.string(),
	name: z.string(),
	date: z.string().meta({ description: "Data risolta YYYY-MM-DD" }),
});

// Unione alla radice: `z.union`, non `z.discriminatedUnion` (che sceglie il
// ramo dal discriminante e dà errori che TypeBox non dà).
const holidayName = z
	.string()
	.min(1)
	.max(100)
	.meta({ description: "Nome festività" });
export const CreateHolidayDefinitionBody = z.union([
	z.object({
		type: z.literal("fixed"),
		name: holidayName,
		month: zInteger({ minimum: 1, maximum: 12, description: "Mese (1-12)" }),
		day: zInteger({ minimum: 1, maximum: 31, description: "Giorno (1-31)" }),
	}),
	z.object({
		type: z.literal("easter_relative"),
		name: holidayName,
		easterOffsetDays: zInteger({
			minimum: -60,
			maximum: 60,
			description: "Offset dalla Pasqua (Pasqua=0, Pasquetta=1)",
		}),
	}),
	z.object({
		type: z.literal("one_off"),
		name: holidayName,
		oneOffDate: z
			.string()
			.regex(DATE_PATTERN)
			.meta({ description: "Data YYYY-MM-DD" }),
	}),
]);

export const UpdateHolidayDefinitionBody = z.object({
	name: z
		.string()
		.min(1)
		.max(100)
		.meta({ description: "Nuovo nome" })
		.optional(),
	isActive: z.boolean().meta({ description: "Attiva/disattiva" }).optional(),
});
