CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"author" text NOT NULL,
	"game" text NOT NULL,
	"kind" text NOT NULL,
	"area" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"page" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"addon_version" text,
	"image" "bytea",
	"status" text DEFAULT 'new' NOT NULL,
	"reply" text DEFAULT '' NOT NULL,
	"replied_at" timestamp with time zone,
	"replied_by" text,
	"reply_seen_at" timestamp with time zone,
	"discord_channel_id" text,
	"discord_message_id" text,
	"discord_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"discord_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_kind" CHECK ("reports"."kind" IN ('bug', 'idea', 'question')),
	CONSTRAINT "reports_area" CHECK ("reports"."area" IN ('site', 'addon', 'bot', 'companion')),
	CONSTRAINT "reports_status" CHECK ("reports"."status" IN ('new', 'wip', 'done', 'refused'))
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "site_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "addon_version" text;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_user_idx" ON "reports" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status","created_at");