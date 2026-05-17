CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "brands_name_trgm_idx" ON "brands" USING gin (lower("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "product_name_trgm_idx" ON "products" USING gin (lower("name") gin_trgm_ops);