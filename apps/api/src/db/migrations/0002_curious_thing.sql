CREATE TABLE "cart_items" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_profile_id" text NOT NULL,
	"store_product_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_item_quantity_range" CHECK ("cart_items"."quantity" BETWEEN 1 AND 99)
);
--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_customer_profile_id_customer_profiles_id_fk" FOREIGN KEY ("customer_profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_store_product_id_store_products_id_fk" FOREIGN KEY ("store_product_id") REFERENCES "public"."store_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_item_customer_store_product_idx" ON "cart_items" USING btree ("customer_profile_id","store_product_id");--> statement-breakpoint
CREATE INDEX "cart_item_store_product_id_idx" ON "cart_items" USING btree ("store_product_id");