import { relations } from "drizzle-orm";
import { index, pgTable, text, unique } from "drizzle-orm/pg-core";
import { id, timestamps } from "../columns";
import { productCategoryCharacteristic } from "./product-characteristic";
import { productMacroCategory } from "./product-macro-category";

export const productCategory = pgTable(
	"product_categories",
	{
		id: id(),
		macroCategoryId: text("macro_category_id")
			.notNull()
			.references(() => productMacroCategory.id, { onDelete: "restrict" }),
		name: text("name").notNull(),
		...timestamps,
	},
	(table) => [
		unique("product_categories_macro_name_unique").on(
			table.macroCategoryId,
			table.name,
		),
		index("product_categories_macro_id_idx").on(table.macroCategoryId),
	],
);

export const productCategoryRelations = relations(
	productCategory,
	({ one, many }) => ({
		macroCategory: one(productMacroCategory, {
			fields: [productCategory.macroCategoryId],
			references: [productMacroCategory.id],
		}),
		characteristics: many(productCategoryCharacteristic),
	}),
);
