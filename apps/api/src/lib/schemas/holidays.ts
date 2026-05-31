import { t } from "elysia";

const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

const HolidayTypeSchema = t.Union(
	[t.Literal("fixed"), t.Literal("easter_relative"), t.Literal("one_off")],
	{ description: "Tipo di definizione festività" },
);

export const HolidayDefinitionSchema = t.Object({
	id: t.String(),
	name: t.String({ description: "Nome della festività" }),
	type: HolidayTypeSchema,
	month: t.Nullable(t.Integer({ description: "Mese (1-12), per tipo fixed" })),
	day: t.Nullable(t.Integer({ description: "Giorno (1-31), per tipo fixed" })),
	easterOffsetDays: t.Nullable(
		t.Integer({ description: "Offset dalla Pasqua, per easter_relative" }),
	),
	oneOffDate: t.Nullable(
		t.String({ description: "Data YYYY-MM-DD, per one_off" }),
	),
	isActive: t.Boolean({ description: "Se la festività è attiva" }),
	createdAt: t.Date(),
	updatedAt: t.Date(),
});

export const HolidayPreviewSchema = t.Object({
	definitionId: t.String(),
	name: t.String(),
	date: t.String({ description: "Data risolta YYYY-MM-DD" }),
});

export const CreateHolidayDefinitionBody = t.Union([
	t.Object({
		type: t.Literal("fixed"),
		name: t.String({
			minLength: 1,
			maxLength: 100,
			description: "Nome festività",
		}),
		month: t.Integer({ minimum: 1, maximum: 12, description: "Mese (1-12)" }),
		day: t.Integer({ minimum: 1, maximum: 31, description: "Giorno (1-31)" }),
	}),
	t.Object({
		type: t.Literal("easter_relative"),
		name: t.String({
			minLength: 1,
			maxLength: 100,
			description: "Nome festività",
		}),
		easterOffsetDays: t.Integer({
			minimum: -60,
			maximum: 60,
			description: "Offset dalla Pasqua (Pasqua=0, Pasquetta=1)",
		}),
	}),
	t.Object({
		type: t.Literal("one_off"),
		name: t.String({
			minLength: 1,
			maxLength: 100,
			description: "Nome festività",
		}),
		oneOffDate: t.String({
			pattern: DATE_PATTERN,
			description: "Data YYYY-MM-DD",
		}),
	}),
]);

export const UpdateHolidayDefinitionBody = t.Object({
	name: t.Optional(
		t.String({ minLength: 1, maxLength: 100, description: "Nuovo nome" }),
	),
	isActive: t.Optional(t.Boolean({ description: "Attiva/disattiva" })),
});

export const CustomClosureSchema = t.Object({
	startDate: t.String({
		pattern: DATE_PATTERN,
		description: "Data inizio YYYY-MM-DD",
	}),
	endDate: t.Optional(
		t.String({
			pattern: DATE_PATTERN,
			description: "Data fine (assente = giorno singolo)",
		}),
	),
	note: t.Optional(
		t.String({ maxLength: 200, description: "Nota (es. Ferie estive)" }),
	),
});

export const OpenStatusSchema = t.Object({
	isOpen: t.Boolean(),
	status: t.Union([
		t.Literal("open"),
		t.Literal("closed"),
		t.Literal("closed_holiday"),
	]),
	closesAt: t.Optional(
		t.String({ description: "Orario chiusura odierno (HH:mm)" }),
	),
	opensAt: t.Optional(t.Object({ date: t.String(), time: t.String() })),
});

export const SellerClosuresResponse = t.Object({
	holidays: t.Array(
		t.Object({
			definitionId: t.String(),
			name: t.String(),
			type: HolidayTypeSchema,
			nextDate: t.Nullable(
				t.String({ description: "Prossima occorrenza YYYY-MM-DD" }),
			),
			observed: t.Boolean({
				description: "Se il negozio osserva questa festività",
			}),
		}),
	),
	customClosures: t.Array(CustomClosureSchema),
});

export const PutClosuresBody = t.Object({
	optOutIds: t.Array(t.String(), {
		description: "ID festività NON osservate dal negozio",
	}),
	customClosures: t.Array(CustomClosureSchema, {
		description: "Chiusure custom del negozio",
	}),
});
