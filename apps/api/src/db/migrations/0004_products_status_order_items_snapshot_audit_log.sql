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
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_store_product_id_store_products_id_fk";
--> statement-breakpoint
DROP INDEX "product_seller_ean_unique";--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "store_product_id" DROP NOT NULL;--> statement-breakpoint
-- Aggiunta come nullable: il backfill popola il valore prima del SET NOT NULL.
ALTER TABLE "order_items" ADD COLUMN "product_name" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "product_ean" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "brand_name" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "product_image_url" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
-- Backfill snapshot dei product_name/EAN/brand/immagine dai prodotti correnti.
-- Best-effort in dev; in prod la prima migrazione dovrà avvenire prima che order_items abbia righe orfane.
UPDATE "order_items" oi
SET
	"product_name" = COALESCE(p.name, ''),
	"product_ean" = p.ean,
	"brand_name" = b.name,
	"product_image_url" = (
		SELECT pi.url FROM "product_images" pi
		WHERE pi.product_id = p.id
		ORDER BY pi.position ASC
		LIMIT 1
	),
	"product_id" = p.id
FROM "store_products" sp
LEFT JOIN "products" p ON p.id = sp.product_id
LEFT JOIN "brands" b ON b.id = p.brand_id
WHERE oi.store_product_id = sp.id;--> statement-breakpoint
-- Per gli order_items eventualmente già senza store_product collegato (rara in dev), garantisci comunque NOT NULL.
UPDATE "order_items" SET "product_name" = '' WHERE "product_name" IS NULL;--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "product_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "product_audit_log" ADD CONSTRAINT "product_audit_log_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_audit_log" ADD CONSTRAINT "product_audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_audit_product_occurred_idx" ON "product_audit_log" USING btree ("product_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "product_audit_actor_idx" ON "product_audit_log" USING btree ("actor_user_id");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_store_product_id_store_products_id_fk" FOREIGN KEY ("store_product_id") REFERENCES "public"."store_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_item_product_id_idx" ON "order_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "product_seller_ean_unique" ON "products" USING btree ("seller_profile_id","ean") WHERE "products"."ean" IS NOT NULL AND "products"."status" != 'trashed';--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "is_active";--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "product_status_valid" CHECK ("products"."status" IN ('active','disabled','trashed'));
