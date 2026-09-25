CREATE TABLE "checkouts" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_profile_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkouts_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "checkout_id" text;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_customer_profile_id_customer_profiles_id_fk" FOREIGN KEY ("customer_profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkout_customer_profile_id_idx" ON "checkouts" USING btree ("customer_profile_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_checkout_id_checkouts_id_fk" FOREIGN KEY ("checkout_id") REFERENCES "public"."checkouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_checkout_id_idx" ON "orders" USING btree ("checkout_id");