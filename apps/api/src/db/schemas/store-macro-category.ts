import { relations } from "drizzle-orm";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { storeCategory } from "./store-category";

export const storeMacroCategory = pgTable("store_macro_categories", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text("name").notNull().unique(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
});

export const storeMacroCategoryRelations = relations(
	storeMacroCategory,
	({ many }) => ({
		storeCategories: many(storeCategory),
	}),
);
