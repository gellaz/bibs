import { text, timestamp } from "drizzle-orm/pg-core";

// Colonne comuni alle tabelle («column helpers» di Drizzle): una sola definizione da cambiare per tutte.
export const id = () =>
	text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());

export const createdAt = () =>
	timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

export const timestamps = {
	createdAt: createdAt(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
};
