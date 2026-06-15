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
import { municipality } from "./location";
import { storeProduct } from "./product";
import { sellerProfile } from "./seller";
import { storeCategory } from "./store-category";
import { storeHolidayOptout } from "./store-holiday-optout";
import { storeImage } from "./store-image";
import { storeSubscription } from "./store-subscription";

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
		municipalityId: text("municipality_id")
			.notNull()
			.references(() => municipality.id, { onDelete: "restrict" }),
		zipCode: text("zip_code").notNull(),
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
		closures:
			jsonb("closures").$type<
				Array<{ startDate: string; endDate?: string; note?: string }>
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
		index("store_municipality_id_idx").on(t.municipalityId),
		// Backs the categoryId FK (ON DELETE SET NULL): without it, deleting a store
		// category seq-scans stores to null out the references.
		index("store_category_id_idx").on(t.categoryId),
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
	municipality: one(municipality, {
		fields: [store.municipalityId],
		references: [municipality.id],
	}),
	category: one(storeCategory, {
		fields: [store.categoryId],
		references: [storeCategory.id],
	}),
	subscription: one(storeSubscription, {
		fields: [store.id],
		references: [storeSubscription.storeId],
	}),
	storeProducts: many(storeProduct),
	phoneNumbers: many(storePhoneNumber),
	images: many(storeImage),
	holidayOptOuts: many(storeHolidayOptout),
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
