import { relations, sql } from "drizzle-orm";
import {
	check,
	index,
	numeric,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { customerProfile } from "./customer";
import { order } from "./order";

/**
 * Un checkout = una conferma del cliente, che produce un ordine per negozio.
 * Porta l'idempotenza (doppio click, retry di rete) e il PaymentIntent unico
 * degli ordini da pagare online.
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
		// PaymentIntent unico per gli ordini pay_pickup del checkout; NULL se il
		// checkout ha solo prenotazioni.
		stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
		// Σ total degli ordini pay_pickup, l'importo del PaymentIntent.
		amountDueOnline: numeric("amount_due_online", { precision: 10, scale: 2 })
			.default("0")
			.notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(t) => [
		index("checkout_customer_profile_id_idx").on(t.customerProfileId),
		check(
			"checkout_amount_due_online_non_negative",
			sql`${t.amountDueOnline} >= 0`,
		),
	],
);

export const checkoutRelations = relations(checkout, ({ one, many }) => ({
	customerProfile: one(customerProfile, {
		fields: [checkout.customerProfileId],
		references: [customerProfile.id],
	}),
	orders: many(order),
}));
