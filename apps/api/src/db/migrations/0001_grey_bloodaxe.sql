CREATE TABLE "product_macro_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_macro_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "product_categories" DROP CONSTRAINT "product_categories_name_unique";--> statement-breakpoint
ALTER TABLE "product_categories" ADD COLUMN "macro_category_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_macro_category_id_product_macro_categories_id_fk" FOREIGN KEY ("macro_category_id") REFERENCES "public"."product_macro_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_categories_macro_id_idx" ON "product_categories" USING btree ("macro_category_id");--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_macro_name_unique" UNIQUE("macro_category_id","name");