// apps/api/src/db/schemas/store-holiday-optout.ts
import { relations } from "drizzle-orm";
import {
	index,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { holidayDefinition } from "./holiday-definition";
import { store } from "./store";

export const storeHolidayOptout = pgTable(
	"store_holiday_optouts",
	{
		storeId: text("store_id")
			.notNull()
			.references(() => store.id, { onDelete: "cascade" }),
		holidayDefinitionId: text("holiday_definition_id")
			.notNull()
			.references(() => holidayDefinition.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.storeId, t.holidayDefinitionId] }),
		index("store_holiday_optout_definition_idx").on(t.holidayDefinitionId),
	],
);

export const storeHolidayOptoutRelations = relations(
	storeHolidayOptout,
	({ one }) => ({
		store: one(store, {
			fields: [storeHolidayOptout.storeId],
			references: [store.id],
		}),
		holidayDefinition: one(holidayDefinition, {
			fields: [storeHolidayOptout.holidayDefinitionId],
			references: [holidayDefinition.id],
		}),
	}),
);
