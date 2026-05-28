-- Drop old city / province columns
ALTER TABLE "organizations" DROP COLUMN "city";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "province";--> statement-breakpoint
ALTER TABLE "stores" DROP COLUMN "city";--> statement-breakpoint
ALTER TABLE "stores" DROP COLUMN "province";--> statement-breakpoint
ALTER TABLE "customer_addresses" DROP COLUMN "city";--> statement-breakpoint
ALTER TABLE "customer_addresses" DROP COLUMN "province";--> statement-breakpoint
ALTER TABLE "seller_profiles" DROP COLUMN "residence_city";--> statement-breakpoint
ALTER TABLE "seller_profiles" DROP COLUMN "document_issued_municipality";--> statement-breakpoint

-- Add new municipality_id FK columns
ALTER TABLE "organizations" ADD COLUMN "municipality_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "municipality_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD COLUMN "municipality_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "residence_municipality_id" text;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "document_issued_municipality_id" text;--> statement-breakpoint

-- Add foreign key constraints
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_municipality_id_municipalities_id_fk" FOREIGN KEY ("municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_residence_municipality_id_municipalities_id_fk" FOREIGN KEY ("residence_municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_document_issued_municipality_id_municipalities_id_fk" FOREIGN KEY ("document_issued_municipality_id") REFERENCES "public"."municipalities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- Create indexes
CREATE INDEX "organization_municipality_id_idx" ON "organizations" USING btree ("municipality_id");--> statement-breakpoint
CREATE INDEX "store_municipality_id_idx" ON "stores" USING btree ("municipality_id");--> statement-breakpoint
CREATE INDEX "customer_address_municipality_id_idx" ON "customer_addresses" USING btree ("municipality_id");--> statement-breakpoint
CREATE INDEX "seller_profile_residence_municipality_idx" ON "seller_profiles" USING btree ("residence_municipality_id");--> statement-breakpoint
CREATE INDEX "seller_profile_document_municipality_idx" ON "seller_profiles" USING btree ("document_issued_municipality_id");
