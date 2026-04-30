import { relations, sql } from "drizzle-orm";
import {
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { product } from "./product";
import { sellerProfile } from "./seller";

export const brand = pgTable(
	"brands",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		sellerProfileId: text("seller_profile_id")
			.notNull()
			.references(() => sellerProfile.id, { onDelete: "cascade" }),
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
		uniqueIndex("brands_seller_name_unique").on(
			table.sellerProfileId,
			sql`lower(${table.name})`,
		),
		index("brands_seller_profile_id_idx").on(table.sellerProfileId),
	],
);

export const brandRelations = relations(brand, ({ many, one }) => ({
	sellerProfile: one(sellerProfile, {
		fields: [brand.sellerProfileId],
		references: [sellerProfile.id],
	}),
	products: many(product),
}));
