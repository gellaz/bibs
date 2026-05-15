CREATE TABLE "discounts" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_profile_id" text NOT NULL,
	"title" text NOT NULL,
	"percent" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_percent_range" CHECK ("discounts"."percent" BETWEEN 1 AND 99),
	CONSTRAINT "discount_period_valid" CHECK ("discounts"."ends_at" IS NULL OR "discounts"."ends_at" > "discounts"."starts_at"),
	CONSTRAINT "discount_status_valid" CHECK ("discounts"."status" IN ('active','paused','archived')),
	CONSTRAINT "discount_title_non_empty" CHECK (length(trim("discounts"."title")) > 0)
);
--> statement-breakpoint
CREATE TABLE "discount_products" (
	"discount_id" text NOT NULL,
	"product_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_products_discount_id_product_id_pk" PRIMARY KEY("discount_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_products" ADD CONSTRAINT "discount_products_discount_id_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_products" ADD CONSTRAINT "discount_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discount_seller_profile_id_idx" ON "discounts" USING btree ("seller_profile_id");--> statement-breakpoint
CREATE INDEX "discount_status_idx" ON "discounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "discount_period_idx" ON "discounts" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "discount_products_product_id_idx" ON "discount_products" USING btree ("product_id");