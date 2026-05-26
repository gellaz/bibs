import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const stripeEvent = pgTable("stripe_events", {
	eventId: text("event_id").primaryKey(),
	eventType: text("event_type").notNull(),
	receivedAt: timestamp("received_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
	processedAt: timestamp("processed_at", { withTimezone: true }),
});
