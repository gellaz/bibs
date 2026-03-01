import { relations, sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { customerAddress } from "./address";
import { user } from "./auth";

export const customerProfile = pgTable(
	"customer_profiles",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" })
			.unique(),
		points: integer("points").default(0).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [check("customer_points_non_negative", sql`${table.points} >= 0`)],
);

export const customerProfileRelations = relations(
	customerProfile,
	({ one, many }) => ({
		user: one(user, {
			fields: [customerProfile.userId],
			references: [user.id],
		}),
		addresses: many(customerAddress),
	}),
);
