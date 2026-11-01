import { relations } from "drizzle-orm";
import { index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, id } from "../columns";
import { product } from "./product";

export const productImage = pgTable(
	"product_images",
	{
		id: id(),
		productId: text("product_id")
			.notNull()
			.references(() => product.id, { onDelete: "cascade" }),
		url: text("url").notNull(),
		key: text("key").notNull().unique(),
		position: integer("position").default(0).notNull(),
		createdAt: createdAt(),
	},
	(table) => [index("product_image_product_id_idx").on(table.productId)],
);

export const productImageRelations = relations(productImage, ({ one }) => ({
	product: one(product, {
		fields: [productImage.productId],
		references: [product.id],
	}),
}));
