import { relations, sql } from "drizzle-orm";
import {
	boolean,
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
import { productCategory } from "./category";
import { productImage } from "./product-image";
import { sellerProfile } from "./seller";
import { store } from "./store";

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
		price: numeric("price", { precision: 10, scale: 2 }).notNull(),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("product_search_idx").using(
			"gin",
			sql`(
        setweight(to_tsvector('italian', ${table.name}), 'A') ||
        setweight(to_tsvector('italian', coalesce(${table.description}, '')), 'B')
      )`,
		),
	],
);

export const productRelations = relations(product, ({ one, many }) => ({
	sellerProfile: one(sellerProfile, {
		fields: [product.sellerProfileId],
		references: [sellerProfile.id],
	}),
	productClassifications: many(productClassification),
	storeProducts: many(storeProduct),
	images: many(productImage),
}));

export const productClassification = pgTable(
	"product_classifications",
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
		index("product_classification_category_id_idx").on(table.productCategoryId),
	],
);

export const productClassificationRelations = relations(
	productClassification,
	({ one }) => ({
		product: one(product, {
			fields: [productClassification.productId],
			references: [product.id],
		}),
		category: one(productCategory, {
			fields: [productClassification.productCategoryId],
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
