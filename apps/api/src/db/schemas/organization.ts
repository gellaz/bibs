import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { sellerProfile } from "./seller";

export const vatStatuses = ["pending", "verified", "rejected"] as const;
export type VatStatus = (typeof vatStatuses)[number];

export const organization = pgTable("organizations", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	sellerProfileId: text("seller_profile_id")
		.notNull()
		.references(() => sellerProfile.id, { onDelete: "cascade" })
		.unique(),
	businessName: text("business_name").notNull(),
	vatNumber: text("vat_number").notNull().unique(),
	legalForm: text("legal_form").notNull(),
	addressLine1: text("address_line1").notNull(),
	country: varchar("country", { length: 2 }).notNull().default("IT"),
	province: text("province"),
	city: text("city").notNull(),
	zipCode: text("zip_code").notNull(),
	vatStatus: varchar("vat_status", { enum: vatStatuses })
		.default("pending")
		.notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
});

export const organizationRelations = relations(organization, ({ one }) => ({
	sellerProfile: one(sellerProfile, {
		fields: [organization.sellerProfileId],
		references: [sellerProfile.id],
	}),
}));
