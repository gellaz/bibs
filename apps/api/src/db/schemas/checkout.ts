import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { customerProfile } from "./customer";
import { order } from "./order";

/**
 * Un checkout = una conferma del cliente, che produce un ordine per negozio.
 * Porta l'idempotenza (doppio click, retry di rete) e, dalla PR F, il
 * PaymentIntent unico degli ordini da pagare online.
 */
export const checkout = pgTable(
	"checkouts",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		customerProfileId: text("customer_profile_id")
			.notNull()
			.references(() => customerProfile.id, { onDelete: "cascade" }),
		idempotencyKey: text("idempotency_key").notNull().unique(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(t) => [index("checkout_customer_profile_id_idx").on(t.customerProfileId)],
);

export const checkoutRelations = relations(checkout, ({ one, many }) => ({
	customerProfile: one(customerProfile, {
		fields: [checkout.customerProfileId],
		references: [customerProfile.id],
	}),
	orders: many(order),
}));
