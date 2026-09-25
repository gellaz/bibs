import { relations, sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from "drizzle-orm/pg-core";
import type { CastellettoLine } from "@/lib/vat";
import { customerAddress } from "./address";
import { checkout } from "./checkout";
import { customerProfile } from "./customer";
import { product, storeProduct } from "./product";
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

/** Copia dell'indirizzo di spedizione al momento dell'ordine. */
export interface ShippingAddressSnapshot {
	recipientName: string | null;
	phone: string | null;
	addressLine1: string;
	addressLine2: string | null;
	zipCode: string;
	municipalityName: string;
	provinceAcronym: string;
	country: string;
}

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
			{ onDelete: "set null" },
		),
		// Snapshot dell'indirizzo al momento dell'ordine: la FK qui sopra va a NULL
		// se il cliente cancella l'indirizzo dalla rubrica, lo snapshot resta.
		shippingAddressSnapshot: jsonb(
			"shipping_address_snapshot",
		).$type<ShippingAddressSnapshot>(),
		shippingCost: numeric("shipping_cost", { precision: 10, scale: 2 }),
		vatBreakdown: jsonb("vat_breakdown").$type<CastellettoLine[]>(),
		reservationExpiresAt: timestamp("reservation_expires_at", {
			withTimezone: true,
		}),
		pointsEarned: integer("points_earned").default(0).notNull(),
		pointsSpent: integer("points_spent").default(0).notNull(),
		idempotencyKey: text("idempotency_key"),
		// Checkout che ha prodotto l'ordine; NULL per ordini creati da
		// POST /customer/orders.
		checkoutId: text("checkout_id").references(() => checkout.id, {
			onDelete: "set null",
		}),
		// Codice di ritiro al banco (lib/pickup-code.ts): solo per gli ordini da
		// ritirare, unico tra gli ordini aperti dello stesso negozio.
		pickupCode: text("pickup_code"),
		// Solo pay_*: oltre questa data un ordine ancora `pending` si annulla da
		// solo (cron expireUnpaidOrders) e lo stock torna disponibile.
		paymentExpiresAt: timestamp("payment_expires_at", { withTimezone: true }),
		// Commissione bibs (lib/platform-fee.ts), fissata alla creazione; 0 per
		// ogni ordine che non è pay_pickup.
		platformFee: numeric("platform_fee", { precision: 10, scale: 2 })
			.default("0")
			.notNull(),
		// Trasferimento al conto Connect del negozio (settleCheckoutPayment) e
		// rimborso al cliente (refundOrderPayment): mai due volte.
		stripeTransferId: text("stripe_transfer_id"),
		stripeRefundId: text("stripe_refund_id"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("order_customer_created_at_idx").on(
			table.customerProfileId,
			table.createdAt,
		),
		index("order_store_id_created_at_idx").on(table.storeId, table.createdAt),
		index("order_checkout_id_idx").on(table.checkoutId),
		// order_status_idx (status alone) and order_type_status_idx (type, status)
		// were dropped: no query uses them as an access path. Status/type filters are
		// always secondary to customerProfileId/storeId (covered by the composite
		// idxs above) or are PK-keyed CAS guards; the reservation sweep is served by
		// the partial order_active_reservation_idx below.
		index("order_active_reservation_idx")
			.on(table.reservationExpiresAt)
			.where(
				sql`${table.type} = 'reserve_pickup' AND ${table.status} IN ('confirmed', 'ready_for_pickup') AND ${table.reservationExpiresAt} IS NOT NULL`,
			),
		// Sweep dei pagamenti scaduti (expireUnpaidOrders), ogni minuto.
		index("order_unpaid_expiry_idx")
			.on(table.paymentExpiresAt)
			.where(
				sql`${table.status} = 'pending' AND ${table.paymentExpiresAt} IS NOT NULL`,
			),
		uniqueIndex("order_idempotency_key_idx")
			.on(table.idempotencyKey)
			.where(sql`${table.idempotencyKey} IS NOT NULL`),
		uniqueIndex("order_open_pickup_code_idx")
			.on(table.storeId, table.pickupCode)
			.where(
				sql`${table.pickupCode} IS NOT NULL AND ${table.status} IN ('pending','confirmed','ready_for_pickup')`,
			),
		check("order_total_non_negative", sql`${table.total} >= 0`),
		check("order_shipping_cost_non_negative", sql`${table.shippingCost} >= 0`),
		check("order_points_earned_non_negative", sql`${table.pointsEarned} >= 0`),
		check("order_points_spent_non_negative", sql`${table.pointsSpent} >= 0`),
		check(
			"order_platform_fee_range",
			sql`${table.platformFee} >= 0 AND ${table.platformFee} <= ${table.total}`,
		),
		// DB-level domain guard for the state-machine columns: the varchar({enum})
		// helper emits a bare varchar, so without these CHECKs an out-of-domain
		// status/type could be persisted and silently bypass every CAS transition
		// guard and the partial reservation index predicate.
		check(
			"order_type_valid",
			sql`${table.type} IN ('direct','reserve_pickup','pay_pickup','pay_deliver')`,
		),
		check(
			"order_status_valid",
			sql`${table.status} IN ('pending','confirmed','ready_for_pickup','shipped','delivered','completed','cancelled','expired')`,
		),
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
	checkout: one(checkout, {
		fields: [order.checkoutId],
		references: [checkout.id],
	}),
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

		// === snapshot al momento dell'ordine (NUOVO) ===
		productName: text("product_name").notNull(),
		productEan: text("product_ean"),
		brandName: text("brand_name"),
		productImageUrl: text("product_image_url"),

		// === soft FK (CAMBIATO da NOT NULL/restrict a nullable/set null) ===
		productId: text("product_id").references(() => product.id, {
			onDelete: "set null",
		}),
		storeProductId: text("store_product_id").references(() => storeProduct.id, {
			onDelete: "set null",
		}),

		// === esistenti invariati ===
		quantity: integer("quantity").notNull(),
		unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),

		// === snapshot sconto venditore (NULL su ordini storici / nessuno sconto) ===
		listPrice: numeric("list_price", { precision: 10, scale: 2 }),
		discountPercent: integer("discount_percent"),

		// === snapshot fiscale IVA (NUOVO) — nullable: ordini storici restano NULL ===
		vatRate: numeric("vat_rate", { precision: 5, scale: 2 }),
		vatAmount: numeric("vat_amount", { precision: 10, scale: 2 }),
	},
	(table) => [
		index("order_item_order_id_idx").on(table.orderId),
		index("order_item_store_product_id_idx").on(table.storeProductId),
		index("order_item_product_id_idx").on(table.productId),
		check("order_item_quantity_positive", sql`${table.quantity} > 0`),
		check("order_item_unit_price_non_negative", sql`${table.unitPrice} >= 0`),
		check(
			"order_item_vat_amount_non_negative",
			sql`${table.vatAmount} IS NULL OR ${table.vatAmount} >= 0`,
		),
		check(
			"order_item_list_price_non_negative",
			sql`${table.listPrice} IS NULL OR ${table.listPrice} >= 0`,
		),
		check(
			"order_item_discount_percent_range",
			sql`${table.discountPercent} IS NULL OR ${table.discountPercent} BETWEEN 1 AND 99`,
		),
		// Mirror products.vat_rate's allowed set on the snapshot column (nullable on
		// historical rows). Bounds the castelletto against an impossible rate.
		check(
			"order_item_vat_rate_valid",
			sql`${table.vatRate} IS NULL OR ${table.vatRate} IN (22,10,5,4,0)`,
		),
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
	product: one(product, {
		fields: [orderItem.productId],
		references: [product.id],
	}),
}));
