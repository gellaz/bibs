// apps/api/src/db/schemas/holiday-definition.ts
import { relations, sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { storeHolidayOptout } from "./store-holiday-optout";

export const holidayDefinition = pgTable(
	"holiday_definitions",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: text("name").notNull(),
		type: text("type", {
			enum: ["fixed", "easter_relative", "one_off"] as const,
		}).notNull(),
		month: integer("month"),
		day: integer("day"),
		easterOffsetDays: integer("easter_offset_days"),
		oneOffDate: date("one_off_date"),
		isActive: boolean("is_active").notNull().default(true),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		createdByUserId: text("created_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(t) => [
		check(
			"holiday_definition_shape_valid",
			sql`(
				(${t.type} = 'fixed' AND ${t.month} IS NOT NULL AND ${t.day} IS NOT NULL AND ${t.easterOffsetDays} IS NULL AND ${t.oneOffDate} IS NULL) OR
				(${t.type} = 'easter_relative' AND ${t.easterOffsetDays} IS NOT NULL AND ${t.month} IS NULL AND ${t.day} IS NULL AND ${t.oneOffDate} IS NULL) OR
				(${t.type} = 'one_off' AND ${t.oneOffDate} IS NOT NULL AND ${t.month} IS NULL AND ${t.day} IS NULL AND ${t.easterOffsetDays} IS NULL)
			)`,
		),
		check(
			"holiday_definition_type_valid",
			sql`${t.type} IN ('fixed','easter_relative','one_off')`,
		),
		check(
			"holiday_definition_month_range",
			sql`${t.month} IS NULL OR (${t.month} BETWEEN 1 AND 12)`,
		),
		check(
			"holiday_definition_day_range",
			sql`${t.day} IS NULL OR (${t.day} BETWEEN 1 AND 31)`,
		),
		// Prevent duplicate definitions of the same shape.
		uniqueIndex("holiday_definition_unique_idx").on(
			t.type,
			t.month,
			t.day,
			t.easterOffsetDays,
			t.oneOffDate,
		),
	],
);

export const holidayDefinitionRelations = relations(
	holidayDefinition,
	({ many }) => ({
		optOuts: many(storeHolidayOptout),
	}),
);
