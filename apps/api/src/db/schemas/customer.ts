import { relations, sql } from "drizzle-orm";
import { check, integer, pgTable, text } from "drizzle-orm/pg-core";
import { id, timestamps } from "../columns";
import { customerAddress } from "./address";
import { user } from "./auth";

export const customerProfile = pgTable(
	"customer_profiles",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" })
			.unique(),
		points: integer("points").default(0).notNull(),
		...timestamps,
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
