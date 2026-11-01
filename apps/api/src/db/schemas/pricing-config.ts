import { sql } from "drizzle-orm";
import {
	boolean,
	integer,
	pgTable,
	text,
	uniqueIndex,
	varchar,
} from "drizzle-orm/pg-core";
import { createdAt, id } from "../columns";
import { user } from "./auth";

export const pricingConfig = pgTable(
	"pricing_config",
	{
		id: id(),
		storeMonthlyFeeCents: integer("store_monthly_fee_cents").notNull(),
		currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
		stripePriceId: text("stripe_price_id").notNull(),
		// Il Product Stripe del Price: il prossimo aggiornamento lo riusa, quindi
		// l'admin lo ritrova precompilato. Null sulle righe create prima (seed).
		stripeProductId: text("stripe_product_id"),
		suspendedAutoCancelDays: integer("suspended_auto_cancel_days")
			.notNull()
			.default(60),
		pendingCreationExpiryHours: integer("pending_creation_expiry_hours")
			.notNull()
			.default(24),
		isActive: boolean("is_active").notNull().default(true),
		createdAt: createdAt(),
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
