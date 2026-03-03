import { relations, sql } from "drizzle-orm";
import {
	index,
	integer,
	numeric,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from "drizzle-orm/pg-core";
import { customerAddress } from "./address";
import { customerProfile } from "./customer";
import { storeProduct } from "./product";
import { store } from "./store";

export const orderTypes = [
	"direct",
	"reserve_pickup",
	"pay_pickup",
	"pay_deliver",
] as const;
export type OrderType = (typeof orderTypes)[number];

export const orderStatuses = [
	"pending",
	"confirmed",
	"ready_for_pickup",
	"shipped",
	"delivered",
	"completed",
	"cancelled",
	"expired",
] as const;
export type OrderStatus = (typeof orderStatuses)[number];

export const order = pgTable(
	"orders",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		customerProfileId: text("customer_profile_id")
			.notNull()
			.references(() => customerProfile.id, { onDelete: "cascade" }),
		storeId: text("store_id")
			.notNull()
			.references(() => store.id, { onDelete: "restrict" }),
		type: varchar("type", { enum: orderTypes }).notNull(),
		status: varchar("status", { enum: orderStatuses }).notNull(),
		total: numeric("total", { precision: 10, scale: 2 }).notNull(),
		shippingAddressId: text("shipping_address_id").references(
			() => customerAddress.id,
		),
		shippingCost: numeric("shipping_cost", { precision: 10, scale: 2 }),
		reservationExpiresAt: timestamp("reservation_expires_at", {
			withTimezone: true,
		}),
		pointsEarned: integer("points_earned").default(0).notNull(),
		pointsSpent: integer("points_spent").default(0).notNull(),
		idempotencyKey: text("idempotency_key"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("order_customer_profile_id_idx").on(table.customerProfileId),
		index("order_store_id_idx").on(table.storeId),
		index("order_status_idx").on(table.status),
		index("order_type_status_idx").on(table.type, table.status),
		index("order_active_reservation_idx")
			.on(table.reservationExpiresAt)
			.where(
				sql`${table.type} = 'reserve_pickup' AND ${table.status} IN ('confirmed', 'ready_for_pickup') AND ${table.reservationExpiresAt} IS NOT NULL`,
			),
		uniqueIndex("order_idempotency_key_idx")
			.on(table.idempotencyKey)
			.where(sql`${table.idempotencyKey} IS NOT NULL`),
	],
);

export const orderRelations = relations(order, ({ one, many }) => ({
	customerProfile: one(customerProfile, {
		fields: [order.customerProfileId],
		references: [customerProfile.id],
	}),
	store: one(store, {
		fields: [order.storeId],
		references: [store.id],
	}),
	shippingAddress: one(customerAddress, {
		fields: [order.shippingAddressId],
		references: [customerAddress.id],
	}),
	items: many(orderItem),
}));

export const orderItem = pgTable(
	"order_items",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		orderId: text("order_id")
			.notNull()
			.references(() => order.id, { onDelete: "cascade" }),
		storeProductId: text("store_product_id")
			.notNull()
			.references(() => storeProduct.id, { onDelete: "restrict" }),
		quantity: integer("quantity").notNull(),
		unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
	},
	(table) => [
		index("order_item_order_id_idx").on(table.orderId),
		index("order_item_store_product_id_idx").on(table.storeProductId),
	],
);

export const orderItemRelations = relations(orderItem, ({ one }) => ({
	order: one(order, {
		fields: [orderItem.orderId],
		references: [order.id],
	}),
	storeProduct: one(storeProduct, {
		fields: [orderItem.storeProductId],
		references: [storeProduct.id],
	}),
}));
