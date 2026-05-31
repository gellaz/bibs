import { relations, sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	numeric,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { brand } from "./brand";
import { productCategory } from "./category";
import { productImage } from "./product-image";
import { sellerProfile } from "./seller";
import { store } from "./store";

export const productStatuses = ["active", "disabled", "trashed"] as const;
export type ProductStatus = (typeof productStatuses)[number];

export const product = pgTable(
	"products",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		sellerProfileId: text("seller_profile_id")
			.notNull()
			.references(() => sellerProfile.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		ean: text("ean"),
		brandId: text("brand_id").references(() => brand.id, {
			onDelete: "set null",
		}),
		price: numeric("price", { precision: 10, scale: 2 }).notNull(),
		vatRate: text("vat_rate", { enum: ["22", "10", "5", "4", "0"] })
			.default("22")
			.notNull(),
		status: text("status", { enum: productStatuses })
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
		index("product_seller_profile_id_idx").on(table.sellerProfileId),
		index("product_search_idx").using(
			"gin",
			sql`(
        setweight(to_tsvector('italian', ${table.name}), 'A') ||
        setweight(to_tsvector('italian', coalesce(${table.description}, '')), 'B')
      )`,
		),
		check("product_price_non_negative", sql`${table.price} >= 0`),
		check(
			"product_vat_rate_valid",
			sql`${table.vatRate} IN ('22','10','5','4','0')`,
		),
		uniqueIndex("product_seller_ean_unique")
			.on(table.sellerProfileId, table.ean)
			.where(sql`${table.ean} IS NOT NULL AND ${table.status} != 'trashed'`),
		index("product_ean_idx").on(table.ean),
		index("product_brand_id_idx").on(table.brandId),
		index("product_status_idx").on(table.status),
		index("product_name_trgm_idx").using(
			"gin",
			sql`lower(${table.name}) gin_trgm_ops`,
		),
		check(
			"product_ean_format",
			sql`${table.ean} IS NULL OR ${table.ean} ~ '^(\\d{8}|\\d{13})$'`,
		),
		check(
			"product_status_valid",
			sql`${table.status} IN ('active','disabled','trashed')`,
		),
	],
);

export const productRelations = relations(product, ({ one, many }) => ({
	sellerProfile: one(sellerProfile, {
		fields: [product.sellerProfileId],
		references: [sellerProfile.id],
	}),
	brand: one(brand, {
		fields: [product.brandId],
		references: [brand.id],
	}),
	productCategoryAssignments: many(productCategoryAssignment),
	storeProducts: many(storeProduct),
	images: many(productImage),
}));

export const productCategoryAssignment = pgTable(
	"product_category_assignments",
	{
		productId: text("product_id")
			.notNull()
			.references(() => product.id, { onDelete: "cascade" }),
		productCategoryId: text("product_category_id")
			.notNull()
			.references(() => productCategory.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.productId, table.productCategoryId] }),
		index("product_category_assignments_category_id_idx").on(
			table.productCategoryId,
		),
	],
);

export const productCategoryAssignmentRelations = relations(
	productCategoryAssignment,
	({ one }) => ({
		product: one(product, {
			fields: [productCategoryAssignment.productId],
			references: [product.id],
		}),
		category: one(productCategory, {
			fields: [productCategoryAssignment.productCategoryId],
			references: [productCategory.id],
		}),
	}),
);

export const storeProduct = pgTable(
	"store_products",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		productId: text("product_id")
			.notNull()
			.references(() => product.id, { onDelete: "cascade" }),
		storeId: text("store_id")
			.notNull()
			.references(() => store.id, { onDelete: "cascade" }),
		stock: integer("stock").default(0).notNull(),
	},
	(table) => [
		uniqueIndex("store_product_product_store_idx").on(
			table.productId,
			table.storeId,
		),
		check("store_product_stock_non_negative", sql`${table.stock} >= 0`),
	],
);

export const storeProductRelations = relations(storeProduct, ({ one }) => ({
	product: one(product, {
		fields: [storeProduct.productId],
		references: [product.id],
	}),
	store: one(store, {
		fields: [storeProduct.storeId],
		references: [store.id],
	}),
}));
