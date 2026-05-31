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
CREATE TABLE "store_holiday_optouts" (
	"store_id" text NOT NULL,
	"holiday_definition_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_holiday_optouts_store_id_holiday_definition_id_pk" PRIMARY KEY("store_id","holiday_definition_id")
);
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "closures" jsonb;--> statement-breakpoint
ALTER TABLE "holiday_definitions" ADD CONSTRAINT "holiday_definitions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_holiday_optouts" ADD CONSTRAINT "store_holiday_optouts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_holiday_optouts" ADD CONSTRAINT "store_holiday_optouts_holiday_definition_id_holiday_definitions_id_fk" FOREIGN KEY ("holiday_definition_id") REFERENCES "public"."holiday_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "holiday_definition_unique_idx" ON "holiday_definitions" USING btree ("type","month","day","easter_offset_days","one_off_date");--> statement-breakpoint
CREATE INDEX "store_holiday_optout_definition_idx" ON "store_holiday_optouts" USING btree ("holiday_definition_id");