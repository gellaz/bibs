import { relations } from "drizzle-orm";
import {
	boolean,
	geometry,
	index,
	pgTable,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";
import { customerProfile } from "./customer";

export const customerAddress = pgTable(
	"customer_addresses",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		label: text("label"),
		recipientName: text("recipient_name"),
		phone: text("phone"),
		addressLine1: text("address_line1").notNull(),
		addressLine2: text("address_line2"),
		city: text("city").notNull(),
		zipCode: text("zip_code").notNull(),
		province: text("province"),
		country: varchar("country", { length: 2 }).notNull().default("IT"),
		location: geometry("location", { type: "point", mode: "xy", srid: 4326 }),
		isDefault: boolean("is_default").notNull().default(false),
		customerProfileId: text("customer_profile_id")
			.notNull()
			.references(() => customerProfile.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [
		index("customer_address_location_idx").using("gist", t.location),
		index("customer_address_profile_id_idx").on(t.customerProfileId),
	],
);

export const customerAddressRelations = relations(
	customerAddress,
	({ one }) => ({
		customerProfile: one(customerProfile, {
			fields: [customerAddress.customerProfileId],
			references: [customerProfile.id],
		}),
	}),
);
