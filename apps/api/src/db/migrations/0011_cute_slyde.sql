UPDATE seller_profiles
SET onboarding_status = 'pending_review'
WHERE onboarding_status IN ('pending_store', 'pending_team', 'pending_payment');
--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_stripe_customer_id_unique" UNIQUE("stripe_customer_id");