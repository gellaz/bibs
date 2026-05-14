import { relations, sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { product } from "./product";
import { sellerProfile } from "./seller";

export const discountStatuses = ["active", "paused", "archived"] as const;
export type DiscountStatus = (typeof discountStatuses)[number];

export const discount = pgTable(
	"discounts",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		sellerProfileId: text("seller_profile_id")
			.notNull()
			.references(() => sellerProfile.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		percent: integer("percent").notNull(),
		startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
		endsAt: timestamp("ends_at", { withTimezone: true }),
		status: text("status", { enum: discountStatuses })
			.default("active")
			.notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("discount_seller_profile_id_idx").on(table.sellerProfileId),
		index("discount_status_idx").on(table.status),
		index("discount_period_idx").on(table.startsAt, table.endsAt),
		check("discount_percent_range", sql`${table.percent} BETWEEN 1 AND 99`),
		check(
			"discount_period_valid",
			sql`${table.endsAt} IS NULL OR ${table.endsAt} > ${table.startsAt}`,
		),
		check(
			"discount_status_valid",
			sql`${table.status} IN ('active','paused','archived')`,
		),
		check("discount_title_non_empty", sql`length(trim(${table.title})) > 0`),
	],
);

export const discountRelations = relations(discount, ({ one, many }) => ({
	sellerProfile: one(sellerProfile, {
		fields: [discount.sellerProfileId],
		references: [sellerProfile.id],
	}),
	discountProducts: many(discountProduct),
}));

export const discountProduct = pgTable(
	"discount_products",
	{
		discountId: text("discount_id")
			.notNull()
			.references(() => discount.id, { onDelete: "cascade" }),
		productId: text("product_id")
			.notNull()
			.references(() => product.id, { onDelete: "cascade" }),
		addedAt: timestamp("added_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.discountId, table.productId] }),
		index("discount_products_product_id_idx").on(table.productId),
	],
);

export const discountProductRelations = relations(
	discountProduct,
	({ one }) => ({
		discount: one(discount, {
			fields: [discountProduct.discountId],
			references: [discount.id],
		}),
		product: one(product, {
			fields: [discountProduct.productId],
			references: [product.id],
		}),
	}),
);
