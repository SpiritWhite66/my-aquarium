CREATE SCHEMA "aqua";
--> statement-breakpoint
CREATE SCHEMA "ref";
--> statement-breakpoint
CREATE TABLE "ref"."consumable" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"type" text NOT NULL,
	"brand" text NOT NULL,
	"name" text NOT NULL,
	"unit" text
);
--> statement-breakpoint
CREATE TABLE "ref"."equipment" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"type" text NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"specs" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref"."species" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"kind" text NOT NULL,
	"scientific_name" text NOT NULL,
	"common_names" text[] DEFAULT '{}' NOT NULL,
	"difficulty" text,
	"temp" jsonb,
	"ph" jsonb,
	"gh" jsonb,
	"kh" jsonb,
	"fauna" jsonb,
	"flora" jsonb,
	"notes" text
);
--> statement-breakpoint
CREATE INDEX "consumable_updated_at_idx" ON "ref"."consumable" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "equipment_updated_at_idx" ON "ref"."equipment" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "species_updated_at_idx" ON "ref"."species" USING btree ("updated_at");