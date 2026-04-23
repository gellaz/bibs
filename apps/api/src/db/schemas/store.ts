import { relations, sql } from "drizzle-orm";
import {
	geometry,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";
import { storeProduct } from "./product";
import { sellerProfile } from "./seller";
import { storeCategory } from "./store-category";
import { storeImage } from "./store-image";

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
		categoryId: text("category_id").references(() => storeCategory.id, {
			onDelete: "set null",
		}),
		openingHours:
			jsonb("opening_hours").$type<
				Array<{
					dayOfWeek: number;
					slots: Array<{ open: string; close: string }>;
				}>
			>(),
		websiteUrl: text("website_url"),
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

export const storePhoneNumber = pgTable(
	"store_phone_numbers",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		storeId: text("store_id")
			.notNull()
			.references(() => store.id, { onDelete: "cascade" }),
		label: text("label"),
		number: text("number").notNull(),
		position: integer("position").notNull().default(0),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(t) => [index("store_phone_number_store_id_idx").on(t.storeId)],
);

export const storeRelations = relations(store, ({ one, many }) => ({
	sellerProfile: one(sellerProfile, {
		fields: [store.sellerProfileId],
		references: [sellerProfile.id],
	}),
	category: one(storeCategory, {
		fields: [store.categoryId],
		references: [storeCategory.id],
	}),
	storeProducts: many(storeProduct),
	phoneNumbers: many(storePhoneNumber),
	images: many(storeImage),
}));

export const storePhoneNumberRelations = relations(
	storePhoneNumber,
	({ one }) => ({
		store: one(store, {
			fields: [storePhoneNumber.storeId],
			references: [store.id],
		}),
	}),
);
