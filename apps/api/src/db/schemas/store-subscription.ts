import { relations, sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";
import { store } from "./store";

export const storeSubscriptionStatuses = [
	"active",
	"past_due",
	"canceling",
	"suspended",
	"canceled",
] as const;
export type StoreSubscriptionStatus =
	(typeof storeSubscriptionStatuses)[number];

export const storeSubscription = pgTable(
	"store_subscriptions",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		storeId: text("store_id")
			.notNull()
			.unique()
			.references(() => store.id, { onDelete: "restrict" }),
		stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
		stripeCustomerId: text("stripe_customer_id").notNull(),
		stripePriceId: text("stripe_price_id").notNull(),
		feeAmountCents: integer("fee_amount_cents").notNull(),
		currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
		status: varchar("status", { enum: storeSubscriptionStatuses }).notNull(),
		currentPeriodEnd: timestamp("current_period_end", {
			withTimezone: true,
		}).notNull(),
		cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
		cancelReason: text("cancel_reason"),
		suspendedAt: timestamp("suspended_at", { withTimezone: true }),
		canceledAt: timestamp("canceled_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [
		index("store_subscription_status_idx").on(t.status),
		index("store_subscription_period_end_idx").on(t.currentPeriodEnd),
		index("store_subscription_suspended_idx")
			.on(t.suspendedAt)
			.where(sql`${t.status} = 'suspended'`),
		check(
			"store_subscription_status_valid",
			sql`${t.status} IN ('active','past_due','canceling','suspended','canceled')`,
		),
	],
);

export const storeSubscriptionRelations = relations(
	storeSubscription,
	({ one }) => ({
		store: one(store, {
			fields: [storeSubscription.storeId],
			references: [store.id],
		}),
	}),
);
