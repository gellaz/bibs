import { relations } from "drizzle-orm";
import { index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, id } from "../columns";
import { store } from "./store";

export const storeImage = pgTable(
	"store_images",
	{
		id: id(),
		storeId: text("store_id")
			.notNull()
			.references(() => store.id, { onDelete: "cascade" }),
		url: text("url").notNull(),
		key: text("key").notNull().unique(),
		position: integer("position").default(0).notNull(),
		createdAt: createdAt(),
	},
	(table) => [index("store_image_store_id_idx").on(table.storeId)],
);

export const storeImageRelations = relations(storeImage, ({ one }) => ({
	store: one(store, {
		fields: [storeImage.storeId],
		references: [store.id],
	}),
}));
