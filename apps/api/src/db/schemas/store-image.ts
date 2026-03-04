import { relations } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { store } from "./store";

export const storeImage = pgTable(
	"store_images",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		storeId: text("store_id")
			.notNull()
			.references(() => store.id, { onDelete: "cascade" }),
		url: text("url").notNull(),
		key: text("key").notNull().unique(),
		position: integer("position").default(0).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [index("store_image_store_id_idx").on(table.storeId)],
);

export const storeImageRelations = relations(storeImage, ({ one }) => ({
	store: one(store, {
		fields: [storeImage.storeId],
		references: [store.id],
	}),
}));
