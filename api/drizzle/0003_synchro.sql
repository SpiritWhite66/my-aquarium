CREATE TABLE "aqua"."records" (
	"user_id" uuid NOT NULL,
	"tbl" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb,
	"deleted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"seq" bigserial NOT NULL,
	CONSTRAINT "records_user_id_tbl_id_pk" PRIMARY KEY("user_id","tbl","id")
);
--> statement-breakpoint
ALTER TABLE "aqua"."records" ADD CONSTRAINT "records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "records_user_seq_idx" ON "aqua"."records" USING btree ("user_id","seq");