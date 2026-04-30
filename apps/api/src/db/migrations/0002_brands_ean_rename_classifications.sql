CREATE TABLE "brands" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_profile_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_classifications" RENAME TO "product_category_assignments";--> statement-breakpoint
ALTER TABLE "product_category_assignments" DROP CONSTRAINT "product_classifications_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "product_category_assignments" DROP CONSTRAINT "product_classifications_product_category_id_product_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "product_category_assignments" DROP CONSTRAINT "product_classifications_product_id_product_category_id_pk";
--> statement-breakpoint
ALTER INDEX "product_classification_category_id_idx" RENAME TO "product_category_assignments_category_id_idx";--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "ean" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "brand_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category_assignments" ADD CONSTRAINT "product_category_assignments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category_assignments" ADD CONSTRAINT "product_category_assignments_product_category_id_product_categories_id_fk" FOREIGN KEY ("product_category_id") REFERENCES "public"."product_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category_assignments" ADD CONSTRAINT "product_category_assignments_product_id_product_category_id_pk" PRIMARY KEY("product_id","product_category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_seller_name_unique" ON "brands" USING btree ("seller_profile_id",lower("name"));--> statement-breakpoint
CREATE INDEX "brands_seller_profile_id_idx" ON "brands" USING btree ("seller_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_seller_ean_unique" ON "products" USING btree ("seller_profile_id","ean") WHERE "ean" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "product_ean_idx" ON "products" USING btree ("ean");--> statement-breakpoint
CREATE INDEX "product_brand_id_idx" ON "products" USING btree ("brand_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "product_ean_format" CHECK ("products"."ean" IS NULL OR "products"."ean" ~ '^(\d{8}|\d{13})$');
