import { relations } from "drizzle-orm";
import {
	index,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { sellerProfile } from "./seller";
import { store } from "./store";

export const employeeStatuses = ["active", "banned", "removed"] as const;
export type EmployeeStatus = (typeof employeeStatuses)[number];

export const storeEmployee = pgTable(
	"store_employees",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		sellerProfileId: text("seller_profile_id")
			.notNull()
			.references(() => sellerProfile.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		status: varchar("status", { enum: employeeStatuses })
			.default("active")
			.notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("store_employee_seller_profile_id_idx").on(table.sellerProfileId),
		index("store_employee_user_id_idx").on(table.userId),
		uniqueIndex("store_employee_seller_user_idx").on(
			table.sellerProfileId,
			table.userId,
		),
	],
);

export const storeEmployeeRelations = relations(
	storeEmployee,
	({ one, many }) => ({
		sellerProfile: one(sellerProfile, {
			fields: [storeEmployee.sellerProfileId],
			references: [sellerProfile.id],
		}),
		user: one(user, {
			fields: [storeEmployee.userId],
			references: [user.id],
		}),
		storeAssignments: many(storeEmployeeStores),
	}),
);

export const storeEmployeeStores = pgTable(
	"store_employee_stores",
	{
		storeEmployeeId: text("store_employee_id")
			.notNull()
			.references(() => storeEmployee.id, { onDelete: "cascade" }),
		storeId: text("store_id")
			.notNull()
			.references(() => store.id, { onDelete: "cascade" }),
	},
	(t) => [
		primaryKey({ columns: [t.storeEmployeeId, t.storeId] }),
		index("store_employee_stores_store_id_idx").on(t.storeId),
	],
);

export const storeEmployeeStoresRelations = relations(
	storeEmployeeStores,
	({ one }) => ({
		storeEmployee: one(storeEmployee, {
			fields: [storeEmployeeStores.storeEmployeeId],
			references: [storeEmployee.id],
		}),
		store: one(store, {
			fields: [storeEmployeeStores.storeId],
			references: [store.id],
		}),
	}),
);
