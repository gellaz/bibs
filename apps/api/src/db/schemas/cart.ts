import { relations, sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { customerProfile } from "./customer";
import { storeProduct } from "./product";

/** Tetto per riga: tiene fuori le quantità assurde senza inventare un dominio. */
export const MAX_CART_ITEM_QUANTITY = 99;

export const cartItem = pgTable(
	"cart_items",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		customerProfileId: text("customer_profile_id")
			.notNull()
			.references(() => customerProfile.id, { onDelete: "cascade" }),
		// storeProduct, non product: pinna prodotto E negozio in una colonna sola,
		// ed è l'identificatore che POST /customer/orders si aspetta. Il cascade è
		// voluto: se il venditore toglie il prodotto dal negozio, la riga sparisce
		// (al contrario di order_items, che snapshotta per restare leggibile).
		storeProductId: text("store_product_id")
			.notNull()
			.references(() => storeProduct.id, { onDelete: "cascade" }),
		quantity: integer("quantity").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		// Una riga per (cliente, prodotto-in-negozio): il secondo "aggiungi" somma.
		uniqueIndex("cart_item_customer_store_product_idx").on(
			table.customerProfileId,
			table.storeProductId,
		),
		// Niente indice su customer_profile_id da solo: è il prefisso sinistro
		// dell'unique qui sopra. Questo invece serve, perché il cascade della FK
		// su store_products non può usare quell'unique (product-leading).
		index("cart_item_store_product_id_idx").on(table.storeProductId),
		check(
			"cart_item_quantity_range",
			sql`${table.quantity} BETWEEN 1 AND ${sql.raw(String(MAX_CART_ITEM_QUANTITY))}`,
		),
	],
);

export const cartItemRelations = relations(cartItem, ({ one }) => ({
	customerProfile: one(customerProfile, {
		fields: [cartItem.customerProfileId],
		references: [customerProfile.id],
	}),
	storeProduct: one(storeProduct, {
		fields: [cartItem.storeProductId],
		references: [storeProduct.id],
	}),
}));
