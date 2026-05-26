CREATE TABLE "store_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_price_id" text NOT NULL,
	"fee_amount_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"status" varchar NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancel_reason" text,
	"suspended_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_subscriptions_store_id_unique" UNIQUE("store_id"),
	CONSTRAINT "store_subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
ALTER TABLE "store_subscriptions" ADD CONSTRAINT "store_subscriptions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_subscription_status_idx" ON "store_subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "store_subscription_period_end_idx" ON "store_subscriptions" USING btree ("current_period_end");--> statement-breakpoint
CREATE INDEX "store_subscription_suspended_idx" ON "store_subscriptions" USING btree ("suspended_at") WHERE "store_subscriptions"."status" = 'suspended';