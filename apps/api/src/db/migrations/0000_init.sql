CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text,
	"recipient_name" text,
	"phone" text,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"municipality_id" text NOT NULL,
	"zip_code" text NOT NULL,
	"country" varchar(2) DEFAULT 'IT' NOT NULL,
	"location" geometry(point),
	"is_default" boolean DEFAULT false NOT NULL,
	"customer_profile_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	"first_name" text,
	"last_name" text,
	"birth_date" text,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_profile_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"macro_category_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_categories_macro_name_unique" UNIQUE("macro_category_id","name")
);
--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "customer_points_non_negative" CHECK ("customer_profiles"."points" >= 0)
);
--> statement-breakpoint
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
CREATE TABLE "employee_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_profile_id" text NOT NULL,
	"email" text NOT NULL,
	"invitation_token" text NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_invitation_stores" (
	"invitation_id" text NOT NULL,
	"store_id" text NOT NULL,
	CONSTRAINT "employee_invitation_stores_invitation_id_store_id_pk" PRIMARY KEY("invitation_id","store_id")
);
--> statement-breakpoint
CREATE TABLE "store_employees" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_profile_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" varchar DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_employee_stores" (
	"store_employee_id" text NOT NULL,
	"store_id" text NOT NULL,
	CONSTRAINT "store_employee_stores_store_employee_id_store_id_pk" PRIMARY KEY("store_employee_id","store_id")
);
--> statement-breakpoint
CREATE TABLE "holiday_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"month" integer,
	"day" integer,
	"easter_offset_days" integer,
	"one_off_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	CONSTRAINT "holiday_definition_unique_idx" UNIQUE NULLS NOT DISTINCT("type","month","day","easter_offset_days","one_off_date"),
	CONSTRAINT "holiday_definition_shape_valid" CHECK ((
				("holiday_definitions"."type" = 'fixed' AND "holiday_definitions"."month" IS NOT NULL AND "holiday_definitions"."day" IS NOT NULL AND "holiday_definitions"."easter_offset_days" IS NULL AND "holiday_definitions"."one_off_date" IS NULL) OR
				("holiday_definitions"."type" = 'easter_relative' AND "holiday_definitions"."easter_offset_days" IS NOT NULL AND "holiday_definitions"."month" IS NULL AND "holiday_definitions"."day" IS NULL AND "holiday_definitions"."one_off_date" IS NULL) OR
				("holiday_definitions"."type" = 'one_off' AND "holiday_definitions"."one_off_date" IS NOT NULL AND "holiday_definitions"."month" IS NULL AND "holiday_definitions"."day" IS NULL AND "holiday_definitions"."easter_offset_days" IS NULL)
			)),
	CONSTRAINT "holiday_definition_type_valid" CHECK ("holiday_definitions"."type" IN ('fixed','easter_relative','one_off')),
	CONSTRAINT "holiday_definition_month_range" CHECK ("holiday_definitions"."month" IS NULL OR ("holiday_definitions"."month" BETWEEN 1 AND 12)),
	CONSTRAINT "holiday_definition_day_range" CHECK ("holiday_definitions"."day" IS NULL OR ("holiday_definitions"."day" BETWEEN 1 AND 31))
);
--> statement-breakpoint
CREATE TABLE "municipalities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"istat_code" varchar(6) NOT NULL,
	"province_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "municipalities_istat_code_unique" UNIQUE("istat_code")
);
--> statement-breakpoint
CREATE TABLE "provinces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"acronym" varchar(2) NOT NULL,
	"istat_code" varchar(3) NOT NULL,
	"region_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provinces_name_unique" UNIQUE("name"),
	CONSTRAINT "provinces_acronym_unique" UNIQUE("acronym"),
	CONSTRAINT "provinces_istat_code_unique" UNIQUE("istat_code")
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"istat_code" varchar(2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regions_name_unique" UNIQUE("name"),
	CONSTRAINT "regions_istat_code_unique" UNIQUE("istat_code")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_profile_id" text NOT NULL,
	"store_id" text NOT NULL,
	"type" varchar NOT NULL,
	"status" varchar NOT NULL,
	"total" numeric(10, 2) NOT NULL,
	"shipping_address_id" text,
	"shipping_cost" numeric(10, 2),
	"vat_breakdown" jsonb,
	"reservation_expires_at" timestamp with time zone,
	"points_earned" integer DEFAULT 0 NOT NULL,
	"points_spent" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_total_non_negative" CHECK ("orders"."total" >= 0),
	CONSTRAINT "order_shipping_cost_non_negative" CHECK ("orders"."shipping_cost" >= 0),
	CONSTRAINT "order_points_earned_non_negative" CHECK ("orders"."points_earned" >= 0),
	CONSTRAINT "order_points_spent_non_negative" CHECK ("orders"."points_spent" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"product_name" text NOT NULL,
	"product_ean" text,
	"brand_name" text,
	"product_image_url" text,
	"product_id" text,
	"store_product_id" text,
	"quantity" integer NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"list_price" numeric(10, 2),
	"discount_percent" integer,
	"vat_rate" numeric(5, 2),
	"vat_amount" numeric(10, 2),
	CONSTRAINT "order_item_quantity_positive" CHECK ("order_items"."quantity" > 0),
	CONSTRAINT "order_item_unit_price_non_negative" CHECK ("order_items"."unit_price" >= 0),
	CONSTRAINT "order_item_vat_amount_non_negative" CHECK ("order_items"."vat_amount" IS NULL OR "order_items"."vat_amount" >= 0),
	CONSTRAINT "order_item_list_price_non_negative" CHECK ("order_items"."list_price" IS NULL OR "order_items"."list_price" >= 0),
	CONSTRAINT "order_item_discount_percent_range" CHECK ("order_items"."discount_percent" IS NULL OR "order_items"."discount_percent" BETWEEN 1 AND 99)
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_profile_id" text NOT NULL,
	"business_name" text NOT NULL,
	"vat_number" text NOT NULL,
	"legal_form" text NOT NULL,
	"address_line1" text NOT NULL,
	"country" varchar(2) DEFAULT 'IT' NOT NULL,
	"municipality_id" text NOT NULL,
	"zip_code" text NOT NULL,
	"vat_status" varchar DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_seller_profile_id_unique" UNIQUE("seller_profile_id"),
	CONSTRAINT "organizations_vat_number_unique" UNIQUE("vat_number")
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_profile_id" text NOT NULL,
	"stripe_account_id" text,
	"is_default" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_store_creations" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_profile_id" text NOT NULL,
	"form_data" jsonb NOT NULL,
	"stripe_checkout_session_id" text,
	"stripe_subscription_id" text,
	"fee_amount_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"status" varchar DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_store_creations_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id")
);
--> statement-breakpoint
CREATE TABLE "point_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_profile_id" text NOT NULL,
	"order_id" text,
	"amount" integer NOT NULL,
	"type" varchar NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_transaction_amount_positive" CHECK ("point_transactions"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "pricing_config" (
	"id" text PRIMARY KEY NOT NULL,
	"store_monthly_fee_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"stripe_price_id" text NOT NULL,
	"suspended_auto_cancel_days" integer DEFAULT 60 NOT NULL,
	"pending_creation_expiry_hours" integer DEFAULT 24 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_profile_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"ean" text,
	"brand_id" text,
	"price" numeric(10, 2) NOT NULL,
	"vat_rate" text DEFAULT '22' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_price_non_negative" CHECK ("products"."price" >= 0),
	CONSTRAINT "product_vat_rate_valid" CHECK ("products"."vat_rate" IN ('22','10','5','4','0')),
	CONSTRAINT "product_ean_format" CHECK ("products"."ean" IS NULL OR "products"."ean" ~ '^(\d{8}|\d{13})$'),
	CONSTRAINT "product_status_valid" CHECK ("products"."status" IN ('active','disabled','trashed'))
);
--> statement-breakpoint
CREATE TABLE "product_category_assignments" (
	"product_id" text NOT NULL,
	"product_category_id" text NOT NULL,
	CONSTRAINT "product_category_assignments_product_id_product_category_id_pk" PRIMARY KEY("product_id","product_category_id")
);
--> statement-breakpoint
CREATE TABLE "store_products" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"store_id" text NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "store_product_stock_non_negative" CHECK ("store_products"."stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_audit_action_valid" CHECK ("product_audit_log"."action" IN ('created','updated','disabled','enabled','trashed','restored'))
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"url" text NOT NULL,
	"key" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_images_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "product_macro_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"suggested_vat_rate" text DEFAULT '22' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_macro_categories_name_unique" UNIQUE("name"),
	CONSTRAINT "product_macro_suggested_vat_rate_valid" CHECK ("product_macro_categories"."suggested_vat_rate" IN ('22','10','5','4','0'))
);
--> statement-breakpoint
CREATE TABLE "seller_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"onboarding_status" varchar DEFAULT 'pending_email' NOT NULL,
	"first_name" text,
	"last_name" text,
	"citizenship" text,
	"birth_country" text,
	"birth_date" date,
	"residence_country" text,
	"residence_municipality_id" text,
	"residence_address" text,
	"residence_zip_code" text,
	"document_number" text,
	"document_expiry" date,
	"document_issued_municipality_id" text,
	"document_image_key" text,
	"document_image_url" text,
	"vat_change_blocked" boolean DEFAULT false NOT NULL,
	"stripe_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "seller_profiles_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "seller_profile_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_profile_id" text NOT NULL,
	"change_type" varchar NOT NULL,
	"change_data" jsonb NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_profile_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"municipality_id" text NOT NULL,
	"zip_code" text NOT NULL,
	"country" varchar(2) DEFAULT 'IT' NOT NULL,
	"location" geometry(point),
	"category_id" text,
	"opening_hours" jsonb,
	"closures" jsonb,
	"website_url" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_phone_numbers" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"label" text,
	"number" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "store_holiday_optouts" (
	"store_id" text NOT NULL,
	"holiday_definition_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_holiday_optouts_store_id_holiday_definition_id_pk" PRIMARY KEY("store_id","holiday_definition_id")
);
--> statement-breakpoint
CREATE TABLE "store_images" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"url" text NOT NULL,
	"key" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_images_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "store_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_price_id" text NOT NULL,
	"fee_amount_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"status" varchar NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancel_reason" text,
	"suspended_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_subscriptions_store_id_unique" UNIQUE("store_id"),
	CONSTRAINT "store_subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_profile_id_customer_profiles_id_fk" FOREIGN KEY ("customer_profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_macro_category_id_product_macro_categories_id_fk" FOREIGN KEY ("macro_category_id") REFERENCES "public"."product_macro_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_products" ADD CONSTRAINT "discount_products_discount_id_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_products" ADD CONSTRAINT "discount_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_invitations" ADD CONSTRAINT "employee_invitations_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_invitation_stores" ADD CONSTRAINT "employee_invitation_stores_invitation_id_employee_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."employee_invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_invitation_stores" ADD CONSTRAINT "employee_invitation_stores_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_employees" ADD CONSTRAINT "store_employees_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_employees" ADD CONSTRAINT "store_employees_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_employee_stores" ADD CONSTRAINT "store_employee_stores_store_employee_id_store_employees_id_fk" FOREIGN KEY ("store_employee_id") REFERENCES "public"."store_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_employee_stores" ADD CONSTRAINT "store_employee_stores_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_definitions" ADD CONSTRAINT "holiday_definitions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "municipalities" ADD CONSTRAINT "municipalities_province_id_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provinces" ADD CONSTRAINT "provinces_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_profile_id_customer_profiles_id_fk" FOREIGN KEY ("customer_profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipping_address_id_customer_addresses_id_fk" FOREIGN KEY ("shipping_address_id") REFERENCES "public"."customer_addresses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_store_product_id_store_products_id_fk" FOREIGN KEY ("store_product_id") REFERENCES "public"."store_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_store_creations" ADD CONSTRAINT "pending_store_creations_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_transactions" ADD CONSTRAINT "point_transactions_customer_profile_id_customer_profiles_id_fk" FOREIGN KEY ("customer_profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_transactions" ADD CONSTRAINT "point_transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_config" ADD CONSTRAINT "pricing_config_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category_assignments" ADD CONSTRAINT "product_category_assignments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category_assignments" ADD CONSTRAINT "product_category_assignments_product_category_id_product_categories_id_fk" FOREIGN KEY ("product_category_id") REFERENCES "public"."product_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_products" ADD CONSTRAINT "store_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_products" ADD CONSTRAINT "store_products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_audit_log" ADD CONSTRAINT "product_audit_log_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_audit_log" ADD CONSTRAINT "product_audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_residence_municipality_id_municipalities_id_fk" FOREIGN KEY ("residence_municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_document_issued_municipality_id_municipalities_id_fk" FOREIGN KEY ("document_issued_municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_profile_changes" ADD CONSTRAINT "seller_profile_changes_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_profile_changes" ADD CONSTRAINT "seller_profile_changes_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_seller_profile_id_seller_profiles_id_fk" FOREIGN KEY ("seller_profile_id") REFERENCES "public"."seller_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_category_id_store_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."store_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_phone_numbers" ADD CONSTRAINT "store_phone_numbers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_holiday_optouts" ADD CONSTRAINT "store_holiday_optouts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_holiday_optouts" ADD CONSTRAINT "store_holiday_optouts_holiday_definition_id_holiday_definitions_id_fk" FOREIGN KEY ("holiday_definition_id") REFERENCES "public"."holiday_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_images" ADD CONSTRAINT "store_images_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_subscriptions" ADD CONSTRAINT "store_subscriptions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_address_location_idx" ON "customer_addresses" USING gist ("location");--> statement-breakpoint
CREATE INDEX "customer_address_profile_id_idx" ON "customer_addresses" USING btree ("customer_profile_id");--> statement-breakpoint
CREATE INDEX "customer_address_municipality_id_idx" ON "customer_addresses" USING btree ("municipality_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_address_single_default_idx" ON "customer_addresses" USING btree ("customer_profile_id") WHERE "customer_addresses"."is_default" = true;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_seller_name_unique" ON "brands" USING btree ("seller_profile_id",lower("name"));--> statement-breakpoint
CREATE INDEX "brands_seller_profile_id_idx" ON "brands" USING btree ("seller_profile_id");--> statement-breakpoint
CREATE INDEX "brands_name_trgm_idx" ON "brands" USING gin (lower("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "product_categories_macro_id_idx" ON "product_categories" USING btree ("macro_category_id");--> statement-breakpoint
CREATE INDEX "discount_seller_profile_id_idx" ON "discounts" USING btree ("seller_profile_id");--> statement-breakpoint
CREATE INDEX "discount_status_idx" ON "discounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "discount_period_idx" ON "discounts" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "discount_products_product_id_idx" ON "discount_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "employee_invitation_seller_profile_id_idx" ON "employee_invitations" USING btree ("seller_profile_id");--> statement-breakpoint
CREATE INDEX "employee_invitation_email_idx" ON "employee_invitations" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_invitation_token_idx" ON "employee_invitations" USING btree ("invitation_token");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_invitation_pending_unique_idx" ON "employee_invitations" USING btree ("seller_profile_id","email") WHERE "employee_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "employee_invitation_stores_store_id_idx" ON "employee_invitation_stores" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "store_employee_seller_profile_id_idx" ON "store_employees" USING btree ("seller_profile_id");--> statement-breakpoint
CREATE INDEX "store_employee_user_id_idx" ON "store_employees" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_employee_seller_user_idx" ON "store_employees" USING btree ("seller_profile_id","user_id");--> statement-breakpoint
CREATE INDEX "store_employee_stores_store_id_idx" ON "store_employee_stores" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "municipality_province_id_idx" ON "municipalities" USING btree ("province_id");--> statement-breakpoint
CREATE INDEX "province_region_id_idx" ON "provinces" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "order_customer_created_at_idx" ON "orders" USING btree ("customer_profile_id","created_at");--> statement-breakpoint
CREATE INDEX "order_store_id_created_at_idx" ON "orders" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "order_active_reservation_idx" ON "orders" USING btree ("reservation_expires_at") WHERE "orders"."type" = 'reserve_pickup' AND "orders"."status" IN ('confirmed', 'ready_for_pickup') AND "orders"."reservation_expires_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "order_idempotency_key_idx" ON "orders" USING btree ("idempotency_key") WHERE "orders"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "order_item_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_item_store_product_id_idx" ON "order_items" USING btree ("store_product_id");--> statement-breakpoint
CREATE INDEX "order_item_product_id_idx" ON "order_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "organization_municipality_id_idx" ON "organizations" USING btree ("municipality_id");--> statement-breakpoint
CREATE INDEX "payment_method_seller_profile_id_idx" ON "payment_methods" USING btree ("seller_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_method_single_default_idx" ON "payment_methods" USING btree ("seller_profile_id") WHERE "payment_methods"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_store_creation_one_open_idx" ON "pending_store_creations" USING btree ("seller_profile_id") WHERE "pending_store_creations"."status" = 'open';--> statement-breakpoint
CREATE INDEX "point_transaction_customer_profile_id_idx" ON "point_transactions" USING btree ("customer_profile_id");--> statement-breakpoint
CREATE INDEX "point_transaction_order_id_idx" ON "point_transactions" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "point_transaction_order_type_unique_idx" ON "point_transactions" USING btree ("order_id","type") WHERE "point_transactions"."order_id" IS NOT NULL AND "point_transactions"."type" IN ('earned', 'refunded');--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_config_single_active_idx" ON "pricing_config" USING btree ("is_active") WHERE "pricing_config"."is_active" = true;--> statement-breakpoint
CREATE INDEX "product_seller_profile_id_idx" ON "products" USING btree ("seller_profile_id");--> statement-breakpoint
CREATE INDEX "product_search_idx" ON "products" USING gin ((
        setweight(to_tsvector('italian', "name"), 'A') ||
        setweight(to_tsvector('italian', coalesce("description", '')), 'B')
      ));--> statement-breakpoint
CREATE UNIQUE INDEX "product_seller_ean_unique" ON "products" USING btree ("seller_profile_id","ean") WHERE "products"."ean" IS NOT NULL AND "products"."status" != 'trashed';--> statement-breakpoint
CREATE INDEX "product_ean_idx" ON "products" USING btree ("ean");--> statement-breakpoint
CREATE INDEX "product_brand_id_idx" ON "products" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "product_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "product_name_trgm_idx" ON "products" USING gin (lower("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "product_category_assignments_category_id_idx" ON "product_category_assignments" USING btree ("product_category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_product_product_store_idx" ON "store_products" USING btree ("product_id","store_id");--> statement-breakpoint
CREATE INDEX "store_product_store_id_idx" ON "store_products" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "product_audit_product_occurred_idx" ON "product_audit_log" USING btree ("product_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "product_audit_actor_idx" ON "product_audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "product_image_product_id_idx" ON "product_images" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "seller_profile_onboarding_status_idx" ON "seller_profiles" USING btree ("onboarding_status");--> statement-breakpoint
CREATE INDEX "seller_profile_residence_municipality_idx" ON "seller_profiles" USING btree ("residence_municipality_id");--> statement-breakpoint
CREATE INDEX "seller_profile_document_municipality_idx" ON "seller_profiles" USING btree ("document_issued_municipality_id");--> statement-breakpoint
CREATE INDEX "seller_profile_change_seller_id_idx" ON "seller_profile_changes" USING btree ("seller_profile_id");--> statement-breakpoint
CREATE INDEX "seller_profile_change_status_idx" ON "seller_profile_changes" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_profile_change_pending_unique_idx" ON "seller_profile_changes" USING btree ("seller_profile_id","change_type") WHERE "seller_profile_changes"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "store_location_idx" ON "stores" USING gist ("location");--> statement-breakpoint
CREATE INDEX "store_seller_profile_id_idx" ON "stores" USING btree ("seller_profile_id");--> statement-breakpoint
CREATE INDEX "store_municipality_id_idx" ON "stores" USING btree ("municipality_id");--> statement-breakpoint
CREATE INDEX "store_category_id_idx" ON "stores" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "store_active_idx" ON "stores" USING btree ("seller_profile_id") WHERE "stores"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "store_phone_number_store_id_idx" ON "store_phone_numbers" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "store_holiday_optout_definition_idx" ON "store_holiday_optouts" USING btree ("holiday_definition_id");--> statement-breakpoint
CREATE INDEX "store_image_store_id_idx" ON "store_images" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "store_subscription_status_idx" ON "store_subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "store_subscription_period_end_idx" ON "store_subscriptions" USING btree ("current_period_end");--> statement-breakpoint
CREATE INDEX "store_subscription_suspended_idx" ON "store_subscriptions" USING btree ("suspended_at") WHERE "store_subscriptions"."status" = 'suspended';