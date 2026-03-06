import { relations } from "drizzle-orm";
import {
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { sellerProfile } from "./seller";

export const changeTypes = ["vat", "document", "payment"] as const;
export type ChangeType = (typeof changeTypes)[number];

export const changeStatuses = ["pending", "approved", "rejected"] as const;
export type ChangeStatus = (typeof changeStatuses)[number];

export const sellerProfileChange = pgTable(
	"seller_profile_changes",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		sellerProfileId: text("seller_profile_id")
			.notNull()
			.references(() => sellerProfile.id, { onDelete: "cascade" }),
		changeType: varchar("change_type", { enum: changeTypes }).notNull(),
		changeData: jsonb("change_data").notNull(),
		status: varchar("status", { enum: changeStatuses })
			.default("pending")
			.notNull(),
		reviewedBy: text("reviewed_by").references(() => user.id, {
			onDelete: "set null",
		}),
		reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
		rejectionReason: text("rejection_reason"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		index("seller_profile_change_seller_id_idx").on(t.sellerProfileId),
		index("seller_profile_change_status_idx").on(t.status),
	],
);

export const sellerProfileChangeRelations = relations(
	sellerProfileChange,
	({ one }) => ({
		sellerProfile: one(sellerProfile, {
			fields: [sellerProfileChange.sellerProfileId],
			references: [sellerProfile.id],
		}),
		reviewer: one(user, {
			fields: [sellerProfileChange.reviewedBy],
			references: [user.id],
		}),
	}),
);
