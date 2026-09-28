ALTER TABLE "checkouts" ADD COLUMN "stripe_payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "checkouts" ADD COLUMN "amount_due_online" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "platform_fee" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stripe_transfer_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stripe_refund_id" text;--> statement-breakpoint
CREATE INDEX "order_unpaid_expiry_idx" ON "orders" USING btree ("payment_expires_at") WHERE "orders"."status" = 'pending' AND "orders"."payment_expires_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id");--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkout_amount_due_online_non_negative" CHECK ("checkouts"."amount_due_online" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "order_platform_fee_range" CHECK ("orders"."platform_fee" >= 0 AND "orders"."platform_fee" <= "orders"."total");