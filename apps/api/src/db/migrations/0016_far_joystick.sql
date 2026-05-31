ALTER TABLE "orders" ADD COLUMN "vat_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "vat_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "vat_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "vat_rate" text DEFAULT '22' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_macro_categories" ADD COLUMN "suggested_vat_rate" text DEFAULT '22' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_item_vat_amount_non_negative" CHECK ("order_items"."vat_amount" IS NULL OR "order_items"."vat_amount" >= 0);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "product_vat_rate_valid" CHECK ("products"."vat_rate" IN ('22','10','5','4','0'));--> statement-breakpoint
ALTER TABLE "product_macro_categories" ADD CONSTRAINT "product_macro_suggested_vat_rate_valid" CHECK ("product_macro_categories"."suggested_vat_rate" IN ('22','10','5','4','0'));