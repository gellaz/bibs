import { relations, sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { productCategory } from "./category";

export const productMacroCategory = pgTable(
	"product_macro_categories",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: text("name").notNull().unique(),
		suggestedVatRate: text("suggested_vat_rate", {
			enum: ["22", "10", "5", "4", "0"],
		})
			.default("22")
			.notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
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
