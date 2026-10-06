ALTER TABLE "orders" DROP CONSTRAINT "order_platform_fee_range";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "points_discount" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stripe_points_transfer_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "order_points_discount_non_negative" CHECK ("orders"."points_discount" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "order_platform_fee_range" CHECK ("orders"."platform_fee" >= 0 AND "orders"."platform_fee" <= "orders"."total" + "orders"."points_discount");