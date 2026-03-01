import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { storeEmployee } from "./employee";

export const vatStatuses = ["pending", "verified", "rejected"] as const;
export type VatStatus = (typeof vatStatuses)[number];

export const sellerProfile = pgTable("seller_profiles", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" })
		.unique(),
	vatNumber: text("vat_number").notNull().unique(),
	vatStatus: varchar("vat_status", { enum: vatStatuses })
		.default("pending")
		.notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

export const sellerProfileRelations = relations(
	sellerProfile,
	({ one, many }) => ({
		user: one(user, {
			fields: [sellerProfile.userId],
			references: [user.id],
		}),
		employees: many(storeEmployee),
	}),
);
