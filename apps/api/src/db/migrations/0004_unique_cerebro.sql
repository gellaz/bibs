CREATE TABLE "geocoding_lookups" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"query" text NOT NULL,
	"bias_cell" text NOT NULL,
	"results" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "geocoding_lookup_key_unique" UNIQUE("provider","query","bias_cell"),
	CONSTRAINT "geocoding_provider_valid" CHECK ("geocoding_lookups"."provider" IN ('photon', 'google'))
);
