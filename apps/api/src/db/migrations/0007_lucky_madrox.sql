CREATE TABLE "pricing_config" (
	"id" text PRIMARY KEY NOT NULL,
	"store_monthly_fee_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"stripe_price_id" text NOT NULL,
	"suspended_auto_cancel_days" integer DEFAULT 60 NOT NULL,
	"pending_creation_expiry_hours" integer DEFAULT 24 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text
);
--> statement-breakpoint
ALTER TABLE "pricing_config" ADD CONSTRAINT "pricing_config_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_config_single_active_idx" ON "pricing_config" USING btree ("is_active") WHERE "pricing_config"."is_active" = true;