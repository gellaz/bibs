ALTER TABLE "seller_profile_changes" DROP CONSTRAINT "seller_profile_change_type_valid";--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "charges_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "payouts_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "details_submitted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
DELETE FROM "seller_profile_changes" WHERE "change_type" = 'payment';--> statement-breakpoint
UPDATE "payment_methods" SET "stripe_account_id" = NULL;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_method_stripe_account_id_unique" UNIQUE("stripe_account_id");--> statement-breakpoint
ALTER TABLE "seller_profile_changes" ADD CONSTRAINT "seller_profile_change_type_valid" CHECK ("seller_profile_changes"."change_type" IN ('vat','document'));