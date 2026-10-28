CREATE TABLE "aqua"."push_subscriptions" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"time" text NOT NULL,
	"time_zone" text NOT NULL,
	"tasks" boolean NOT NULL,
	"follow_ups" boolean NOT NULL,
	"last_sent_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aqua"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_user_idx" ON "aqua"."push_subscriptions" USING btree ("user_id");