import { relations, sql } from "drizzle-orm";
import { check, pgTable, text } from "drizzle-orm/pg-core";
import { DEFAULT_VAT_RATE, VAT_RATES } from "@/domain/pricing/vat";
import { id, timestamps } from "../columns";
import { productCategory } from "./category";

export const productMacroCategory = pgTable(
	"product_macro_categories",
	{
		id: id(),
		name: text("name").notNull().unique(),
		suggestedVatRate: text("suggested_vat_rate", { enum: VAT_RATES })
			.default(DEFAULT_VAT_RATE)
			.notNull(),
		...timestamps,
	},
	(table) => [
		check(
			"product_macro_suggested_vat_rate_valid",
			sql`${table.suggestedVatRate} IN ('22','10','5','4','0')`,
		),
	],
);

export const productMacroCategoryRelations = relations(
	productMacroCategory,
	({ many }) => ({
		productCategories: many(productCategory),
	}),
);
