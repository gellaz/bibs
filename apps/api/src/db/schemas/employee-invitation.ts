import { relations } from "drizzle-orm";
import {
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from "drizzle-orm/pg-core";
import { sellerProfile } from "./seller";

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
		uniqueIndex("employee_invitation_token_idx").on(table.invitationToken),
	],
);

export const employeeInvitationRelations = relations(
	employeeInvitation,
	({ one }) => ({
		sellerProfile: one(sellerProfile, {
			fields: [employeeInvitation.sellerProfileId],
			references: [sellerProfile.id],
		}),
	}),
);
