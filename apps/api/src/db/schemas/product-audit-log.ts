import { relations, sql } from "drizzle-orm";
import {
	check,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { product } from "./product";

// Esclude 'deleted_permanently' perché l'audit row verrebbe cancellato a cascata
// col prodotto: il delete fisico è registrato solo nei log Pino.
export const productAuditActions = [
	"created",
	"updated",
	"disabled",
	"enabled",
	"trashed",
	"restored",
] as const;
export type ProductAuditAction = (typeof productAuditActions)[number];

export const productAuditLog = pgTable(
	"product_audit_log",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		productId: text("product_id")
			.notNull()
			.references(() => product.id, { onDelete: "cascade" }),
		actorUserId: text("actor_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		action: text("action", { enum: productAuditActions }).notNull(),
		metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
		occurredAt: timestamp("occurred_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("product_audit_product_occurred_idx").on(
			table.productId,
			table.occurredAt.desc(),
		),
		index("product_audit_actor_idx").on(table.actorUserId),
		check(
			"product_audit_action_valid",
			sql`${table.action} IN ('created','updated','disabled','enabled','trashed','restored')`,
		),
	],
);

export const productAuditLogRelations = relations(
	productAuditLog,
	({ one }) => ({
		product: one(product, {
			fields: [productAuditLog.productId],
			references: [product.id],
		}),
		actor: one(user, {
			fields: [productAuditLog.actorUserId],
			references: [user.id],
		}),
	}),
);
