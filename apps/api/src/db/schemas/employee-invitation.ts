import { relations, sql } from "drizzle-orm";
import {
	check,
	index,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from "drizzle-orm/pg-core";
import { sellerProfile } from "./seller";
import { store } from "./store";

export const invitationStatuses = ["pending", "accepted", "expired"] as const;
export type InvitationStatus = (typeof invitationStatuses)[number];

export const employeeInvitation = pgTable(
	"employee_invitations",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		sellerProfileId: text("seller_profile_id")
			.notNull()
			.references(() => sellerProfile.id, { onDelete: "cascade" }),
		email: text("email").notNull(),
		invitationToken: text("invitation_token")
			.notNull()
			.$defaultFn(() => crypto.randomUUID()),
		status: varchar("status", { enum: invitationStatuses })
			.default("pending")
			.notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("employee_invitation_seller_profile_id_idx").on(
			table.sellerProfileId,
		),
		index("employee_invitation_email_idx").on(table.email),
		uniqueIndex("employee_invitation_token_idx").on(table.invitationToken),
		uniqueIndex("employee_invitation_pending_unique_idx")
			.on(table.sellerProfileId, table.email)
			.where(sql`${table.status} = 'pending'`),
		check(
			"employee_invitation_status_valid",
			sql`${table.status} IN ('pending','accepted','expired')`,
		),
	],
);

export const employeeInvitationRelations = relations(
	employeeInvitation,
	({ one, many }) => ({
		sellerProfile: one(sellerProfile, {
			fields: [employeeInvitation.sellerProfileId],
			references: [sellerProfile.id],
		}),
		storeAssignments: many(employeeInvitationStores),
	}),
);

export const employeeInvitationStores = pgTable(
	"employee_invitation_stores",
	{
		invitationId: text("invitation_id")
			.notNull()
			.references(() => employeeInvitation.id, { onDelete: "cascade" }),
		storeId: text("store_id")
			.notNull()
			.references(() => store.id, { onDelete: "cascade" }),
	},
	(t) => [
		primaryKey({ columns: [t.invitationId, t.storeId] }),
		index("employee_invitation_stores_store_id_idx").on(t.storeId),
	],
);

export const employeeInvitationStoresRelations = relations(
	employeeInvitationStores,
	({ one }) => ({
		invitation: one(employeeInvitation, {
			fields: [employeeInvitationStores.invitationId],
			references: [employeeInvitation.id],
		}),
		store: one(store, {
			fields: [employeeInvitationStores.storeId],
			references: [store.id],
		}),
	}),
);
