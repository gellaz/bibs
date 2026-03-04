import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
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
		stripeAccountId: text("stripe_account_id"),
		isDefault: boolean("is_default").default(true).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("payment_method_seller_profile_id_idx").on(table.sellerProfileId),
	],
);

export const paymentMethodRelations = relations(paymentMethod, ({ one }) => ({
	sellerProfile: one(sellerProfile, {
		fields: [paymentMethod.sellerProfileId],
		references: [sellerProfile.id],
	}),
}));
