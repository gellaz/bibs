import { relations } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { id, timestamps } from "../columns";
import { storeCategory } from "./store-category";

export const storeMacroCategory = pgTable("store_macro_categories", {
	id: id(),
	name: text("name").notNull().unique(),
	...timestamps,
});

export const storeMacroCategoryRelations = relations(
	storeMacroCategory,
	({ many }) => ({
		storeCategories: many(storeCategory),
	}),
);
