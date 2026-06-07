ALTER TABLE "order_items" ADD COLUMN "list_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "discount_percent" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_item_list_price_non_negative" CHECK ("order_items"."list_price" IS NULL OR "order_items"."list_price" >= 0);--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_item_discount_percent_range" CHECK ("order_items"."discount_percent" IS NULL OR "order_items"."discount_percent" BETWEEN 1 AND 99);