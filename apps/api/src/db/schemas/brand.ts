import { relations, sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { id, timestamps } from "../columns";
import { product } from "./product";
import { sellerProfile } from "./seller";

export const brand = pgTable(
	"brands",
	{
		id: id(),
		sellerProfileId: text("seller_profile_id")
			.notNull()
			.references(() => sellerProfile.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		...timestamps,
	},
	(table) => [
		uniqueIndex("brands_seller_name_unique").on(
			table.sellerProfileId,
			sql`lower(${table.name})`,
		),
		index("brands_seller_profile_id_idx").on(table.sellerProfileId),
		index("brands_name_trgm_idx").using(
			"gin",
			sql`lower(${table.name}) gin_trgm_ops`,
		),
	],
);

export const brandRelations = relations(brand, ({ many, one }) => ({
	sellerProfile: one(sellerProfile, {
		fields: [brand.sellerProfileId],
		references: [sellerProfile.id],
	}),
	products: many(product),
}));
