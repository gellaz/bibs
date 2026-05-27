CREATE TABLE "pending_store_creations" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_profile_id" text NOT NULL,
	"form_data" jsonb NOT NULL,
	"stripe_checkout_session_id" text,
	"stripe_subscription_id" text,
	"fee_amount_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"status" varchar DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_store_creations_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id")
);
--> statement-breakpoint
ALTER TABLE "pending_store_creations" ADD CONSTRAINT "pending_store_creations_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_store_creation_one_open_idx" ON "pending_store_creations" USING btree ("seller_profile_id") WHERE "pending_store_creations"."status" = 'open';