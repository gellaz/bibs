import { relations, sql } from "drizzle-orm";
import {
	geometry,
	index,
	pgTable,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";
import { storeProduct } from "./product";
import { sellerProfile } from "./seller";

export const store = pgTable(
	"stores",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		sellerProfileId: text("seller_profile_id")
			.notNull()
			.references(() => sellerProfile.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		addressLine1: text("address_line1").notNull(),
		addressLine2: text("address_line2"),
		city: text("city").notNull(),
		zipCode: text("zip_code").notNull(),
		province: text("province"),
		country: varchar("country", { length: 2 }).notNull().default("IT"),
		location: geometry("location", { type: "point", mode: "xy", srid: 4326 }),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [
		index("store_location_idx").using("gist", t.location),
		index("store_seller_profile_id_idx").on(t.sellerProfileId),
		index("store_active_idx")
			.on(t.sellerProfileId)
			.where(sql`${t.deletedAt} IS NULL`),
	],
);

export const storeRelations = relations(store, ({ one, many }) => ({
	sellerProfile: one(sellerProfile, {
		fields: [store.sellerProfileId],
		references: [sellerProfile.id],
	}),
	storeProducts: many(storeProduct),
}));
