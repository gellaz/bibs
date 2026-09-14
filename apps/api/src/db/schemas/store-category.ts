import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { store } from "./store";
import { storeMacroCategory } from "./store-macro-category";

export const storeCategory = pgTable(
	"store_categories",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		macroCategoryId: text("macro_category_id")
			.notNull()
			.references(() => storeMacroCategory.id, { onDelete: "restrict" }),
		name: text("name").notNull().unique(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index("store_categories_macro_id_idx").on(table.macroCategoryId)],
);

export const storeCategoryRelations = relations(
	storeCategory,
	({ many, one }) => ({
		macroCategory: one(storeMacroCategory, {
			fields: [storeCategory.macroCategoryId],
			references: [storeMacroCategory.id],
		}),
		stores: many(store),
	}),
);
