ALTER TABLE "products" ADD COLUMN "product_category_id" text;--> statement-breakpoint
UPDATE "products" p SET "product_category_id" = (
	SELECT pca."product_category_id"
	FROM "product_category_assignments" pca
	WHERE pca."product_id" = p."id"
	ORDER BY pca."product_category_id"
	LIMIT 1
);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_product_category_id_product_categories_id_fk" FOREIGN KEY ("product_category_id") REFERENCES "public"."product_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_product_category_id_idx" ON "products" USING btree ("product_category_id");