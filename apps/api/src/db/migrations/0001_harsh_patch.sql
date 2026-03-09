ALTER TABLE "orders" DROP CONSTRAINT "orders_shipping_address_id_customer_addresses_id_fk";
--> statement-breakpoint
DROP INDEX "order_customer_profile_id_idx";--> statement-breakpoint
DROP INDEX "order_store_id_idx";--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "store_employees" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipping_address_id_customer_addresses_id_fk" FOREIGN KEY ("shipping_address_id") REFERENCES "public"."customer_addresses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_address_single_default_idx" ON "customer_addresses" USING btree ("customer_profile_id") WHERE "customer_addresses"."is_default" = true;--> statement-breakpoint
CREATE INDEX "employee_invitation_email_idx" ON "employee_invitations" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_invitation_pending_unique_idx" ON "employee_invitations" USING btree ("seller_profile_id","email") WHERE "employee_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "order_customer_created_at_idx" ON "orders" USING btree ("customer_profile_id","created_at");--> statement-breakpoint
CREATE INDEX "order_store_id_created_at_idx" ON "orders" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_method_single_default_idx" ON "payment_methods" USING btree ("seller_profile_id") WHERE "payment_methods"."is_default" = true;--> statement-breakpoint
CREATE INDEX "point_transaction_order_id_idx" ON "point_transactions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "product_seller_profile_id_idx" ON "products" USING btree ("seller_profile_id");--> statement-breakpoint
CREATE INDEX "seller_profile_onboarding_status_idx" ON "seller_profiles" USING btree ("onboarding_status");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_profile_change_pending_unique_idx" ON "seller_profile_changes" USING btree ("seller_profile_id","change_type") WHERE "seller_profile_changes"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "order_total_non_negative" CHECK ("orders"."total" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "order_shipping_cost_non_negative" CHECK ("orders"."shipping_cost" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "order_points_earned_non_negative" CHECK ("orders"."points_earned" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "order_points_spent_non_negative" CHECK ("orders"."points_spent" >= 0);--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_item_quantity_positive" CHECK ("order_items"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_item_unit_price_non_negative" CHECK ("order_items"."unit_price" >= 0);--> statement-breakpoint
ALTER TABLE "point_transactions" ADD CONSTRAINT "point_transaction_amount_positive" CHECK ("point_transactions"."amount" > 0);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "product_price_non_negative" CHECK ("products"."price" >= 0);