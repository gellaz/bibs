import { relations } from "drizzle-orm";
import { index, pgTable, text } from "drizzle-orm/pg-core";
import { id, timestamps } from "../columns";
import { store } from "./store";
import { storeMacroCategory } from "./store-macro-category";

export const storeCategory = pgTable(
	"store_categories",
	{
		id: id(),
		macroCategoryId: text("macro_category_id")
			.notNull()
			.references(() => storeMacroCategory.id, { onDelete: "restrict" }),
		name: text("name").notNull().unique(),
		...timestamps,
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
