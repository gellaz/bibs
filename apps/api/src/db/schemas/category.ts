import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { productClassification } from "./product";
import { productMacroCategory } from "./product-macro-category";

export const productCategory = pgTable(
	"product_categories",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		macroCategoryId: text("macro_category_id")
			.notNull()
			.references(() => productMacroCategory.id, { onDelete: "restrict" }),
		name: text("name").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
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
	({ many, one }) => ({
		macroCategory: one(productMacroCategory, {
			fields: [productCategory.macroCategoryId],
			references: [productMacroCategory.id],
		}),
		productClassifications: many(productClassification),
	}),
);
