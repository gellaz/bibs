import { relations, sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from "drizzle-orm/pg-core";
import { customerProfile } from "./customer";
import { order } from "./order";

export const pointTransactionTypes = [
	"earned",
	"redeemed",
	"refunded",
] as const;
export type PointTransactionType = (typeof pointTransactionTypes)[number];

export const pointTransaction = pgTable(
	"point_transactions",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		customerProfileId: text("customer_profile_id")
			.notNull()
			.references(() => customerProfile.id, { onDelete: "cascade" }),
		orderId: text("order_id").references(() => order.id, {
			onDelete: "set null",
		}),
		amount: integer("amount").notNull(),
		type: varchar("type", { enum: pointTransactionTypes }).notNull(),
		description: text("description"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("point_transaction_customer_profile_id_idx").on(
			table.customerProfileId,
		),
		index("point_transaction_order_id_idx").on(table.orderId),
		check("point_transaction_amount_positive", sql`${table.amount} > 0`),
		check(
			"point_transaction_type_valid",
			sql`${table.type} IN ('earned','redeemed','refunded')`,
		),
		// Backstop against double-award / double-refund / double-redeem: at most one
		// transaction of each type per order. The application also guards via a
		// compare-and-swap on the order status, but this makes it impossible at the
		// DB level even under concurrency.
		uniqueIndex("point_transaction_order_type_unique_idx")
			.on(table.orderId, table.type)
			.where(
				sql`${table.orderId} IS NOT NULL AND ${table.type} IN ('earned', 'refunded', 'redeemed')`,
			),
	],
);

export const pointTransactionRelations = relations(
	pointTransaction,
	({ one }) => ({
		customerProfile: one(customerProfile, {
			fields: [pointTransaction.customerProfileId],
			references: [customerProfile.id],
		}),
		order: one(order, {
			fields: [pointTransaction.orderId],
			references: [order.id],
		}),
	}),
);
