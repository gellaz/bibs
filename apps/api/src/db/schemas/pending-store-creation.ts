import { relations, sql } from "drizzle-orm";
import {
	check,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from "drizzle-orm/pg-core";
import { sellerProfile } from "./seller";

export const pendingStoreCreationStatuses = [
	"open",
	"consumed",
	"expired",
	"canceled",
] as const;
export type PendingStoreCreationStatus =
	(typeof pendingStoreCreationStatuses)[number];

export const pendingStoreCreation = pgTable(
	"pending_store_creations",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		sellerProfileId: text("seller_profile_id")
			.notNull()
			.references(() => sellerProfile.id, { onDelete: "cascade" }),
		formData: jsonb("form_data").notNull(),
		stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
		stripeSubscriptionId: text("stripe_subscription_id"),
		feeAmountCents: integer("fee_amount_cents").notNull(),
		currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
		status: varchar("status", { enum: pendingStoreCreationStatuses })
			.notNull()
			.default("open"),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		consumedAt: timestamp("consumed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		uniqueIndex("pending_store_creation_one_open_idx")
			.on(t.sellerProfileId)
			.where(sql`${t.status} = 'open'`),
		check(
			"pending_store_creation_status_valid",
			sql`${t.status} IN ('open','consumed','expired','canceled')`,
		),
	],
);

export const pendingStoreCreationRelations = relations(
	pendingStoreCreation,
	({ one }) => ({
		sellerProfile: one(sellerProfile, {
			fields: [pendingStoreCreation.sellerProfileId],
			references: [sellerProfile.id],
		}),
	}),
);
