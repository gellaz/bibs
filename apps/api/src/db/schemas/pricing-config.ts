import { sql } from "drizzle-orm";
import {
	boolean,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const pricingConfig = pgTable(
	"pricing_config",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		storeMonthlyFeeCents: integer("store_monthly_fee_cents").notNull(),
		currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
		stripePriceId: text("stripe_price_id").notNull(),
		suspendedAutoCancelDays: integer("suspended_auto_cancel_days")
			.notNull()
			.default(60),
		pendingCreationExpiryHours: integer("pending_creation_expiry_hours")
			.notNull()
			.default(24),
		isActive: boolean("is_active").notNull().default(true),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		createdByUserId: text("created_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
	},
	(t) => [
		uniqueIndex("pricing_config_single_active_idx")
			.on(t.isActive)
			.where(sql`${t.isActive} = true`),
	],
);
