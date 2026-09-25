import { relations, sql } from "drizzle-orm";
import {
	boolean,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { sellerProfile } from "./seller";

export const paymentMethod = pgTable(
	"payment_methods",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		sellerProfileId: text("seller_profile_id")
			.notNull()
			.references(() => sellerProfile.id, { onDelete: "cascade" }),
		stripeAccountId: text("stripe_account_id").unique(
			"payment_method_stripe_account_id_unique",
		),
		// Stato del conto Connect, copiato da Stripe (webhook account.updated o
		// sync al ritorno dall'onboarding). Mai scritto da input dell'utente.
		// Con Accounts v2 (configurazione recipient) `charges_enabled` significa
		// "può ricevere i trasferimenti di bibs" (stripe_balance.stripe_transfers
		// attivo): è ciò che serve alla PR2, non un incasso diretto del seller.
		// `details_submitted` = nessun requisito in attesa del seller.
		chargesEnabled: boolean("charges_enabled").default(false).notNull(),
		payoutsEnabled: boolean("payouts_enabled").default(false).notNull(),
		detailsSubmitted: boolean("details_submitted").default(false).notNull(),
		isDefault: boolean("is_default").default(true).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("payment_method_seller_profile_id_idx").on(table.sellerProfileId),
		uniqueIndex("payment_method_single_default_idx")
			.on(table.sellerProfileId)
			.where(sql`${table.isDefault} = true`),
	],
);

export const paymentMethodRelations = relations(paymentMethod, ({ one }) => ({
	sellerProfile: one(sellerProfile, {
		fields: [paymentMethod.sellerProfileId],
		references: [sellerProfile.id],
	}),
}));
