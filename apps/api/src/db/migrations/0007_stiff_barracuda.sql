CREATE TABLE "product_category_characteristics" (
	"product_category_id" text NOT NULL,
	"characteristic_id" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "product_category_characteristics_product_category_id_characteristic_id_pk" PRIMARY KEY("product_category_id","characteristic_id")
);
--> statement-breakpoint
CREATE TABLE "product_characteristics" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data_type" text NOT NULL,
	"unit" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_characteristics_name_unique" UNIQUE("name"),
	CONSTRAINT "product_characteristic_id_data_type_unique" UNIQUE("id","data_type"),
	CONSTRAINT "product_characteristic_data_type_valid" CHECK ("product_characteristics"."data_type" IN ('text','number','boolean','enum')),
	CONSTRAINT "product_characteristic_unit_only_for_number" CHECK ("product_characteristics"."unit" IS NULL OR "product_characteristics"."data_type" = 'number')
);
--> statement-breakpoint
CREATE TABLE "product_characteristic_options" (
	"id" text PRIMARY KEY NOT NULL,
	"characteristic_id" text NOT NULL,
	"value" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "product_characteristic_option_value_unique" UNIQUE("characteristic_id","value")
);
--> statement-breakpoint
CREATE TABLE "product_characteristic_values" (
	"product_id" text NOT NULL,
	"characteristic_id" text NOT NULL,
	"data_type" text NOT NULL,
	"value_text" text,
	"value_number" numeric(14, 4),
	"value_boolean" boolean,
	"option_id" text,
	CONSTRAINT "product_characteristic_values_product_id_characteristic_id_pk" PRIMARY KEY("product_id","characteristic_id"),
	CONSTRAINT "product_characteristic_value_matches_data_type" CHECK ((
				CASE WHEN "product_characteristic_values"."value_text" IS NOT NULL THEN 1 ELSE 0 END +
				CASE WHEN "product_characteristic_values"."value_number" IS NOT NULL THEN 1 ELSE 0 END +
				CASE WHEN "product_characteristic_values"."value_boolean" IS NOT NULL THEN 1 ELSE 0 END +
				CASE WHEN "product_characteristic_values"."option_id" IS NOT NULL THEN 1 ELSE 0 END
			) = 1 AND (
				("product_characteristic_values"."data_type" = 'text' AND "product_characteristic_values"."value_text" IS NOT NULL) OR
				("product_characteristic_values"."data_type" = 'number' AND "product_characteristic_values"."value_number" IS NOT NULL) OR
				("product_characteristic_values"."data_type" = 'boolean' AND "product_characteristic_values"."value_boolean" IS NOT NULL) OR
				("product_characteristic_values"."data_type" = 'enum' AND "product_characteristic_values"."option_id" IS NOT NULL)
			))
);
--> statement-breakpoint
ALTER TABLE "product_category_characteristics" ADD CONSTRAINT "product_category_characteristics_product_category_id_product_categories_id_fk" FOREIGN KEY ("product_category_id") REFERENCES "public"."product_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category_characteristics" ADD CONSTRAINT "product_category_characteristics_characteristic_id_product_characteristics_id_fk" FOREIGN KEY ("characteristic_id") REFERENCES "public"."product_characteristics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_characteristic_options" ADD CONSTRAINT "product_characteristic_options_characteristic_id_product_characteristics_id_fk" FOREIGN KEY ("characteristic_id") REFERENCES "public"."product_characteristics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_characteristic_values" ADD CONSTRAINT "product_characteristic_values_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_characteristic_values" ADD CONSTRAINT "product_characteristic_values_option_id_product_characteristic_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."product_characteristic_options"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_category_characteristic_characteristic_id_idx" ON "product_category_characteristics" USING btree ("characteristic_id");--> statement-breakpoint
CREATE INDEX "product_characteristic_value_characteristic_id_idx" ON "product_characteristic_values" USING btree ("characteristic_id");
--> statement-breakpoint
ALTER TABLE "product_characteristic_values"
	ADD CONSTRAINT "product_characteristic_value_characteristic_data_type_fk"
	FOREIGN KEY ("characteristic_id","data_type")
	REFERENCES "public"."product_characteristics"("id","data_type")
	ON DELETE restrict ON UPDATE no action;