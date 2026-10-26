import { z } from "zod";
import { zDate, zInteger, zString } from "./t";

// Gemelli Zod di `lib/schemas/holidays.ts` (D3 del piano Hono), nello stesso
// ordine e con gli stessi nomi; per ora solo quelli delle route migrate.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const d = (description: string) => ({ description });

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
// ramo dal discriminante e dà errori che prima non c'erano).
const holidayName = zString({
	minLength: 1,
	maxLength: 100,
	description: "Nome festività",
});
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
	name: zString({
		minLength: 1,
		maxLength: 100,
		description: "Nuovo nome",
	}).optional(),
	isActive: z.boolean().meta({ description: "Attiva/disattiva" }).optional(),
});

export const CustomClosureSchema = z.object({
	startDate: z.string().regex(DATE_PATTERN).meta(d("Data inizio YYYY-MM-DD")),
	endDate: z
		.string()
		.regex(DATE_PATTERN)
		.meta(d("Data fine (assente = giorno singolo)"))
		.optional(),
	note: zString({
		maxLength: 200,
		...d("Nota (es. Ferie estive)"),
	}).optional(),
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
