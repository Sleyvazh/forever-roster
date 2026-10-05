CREATE TABLE "feedback_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"inbox_channel_id" text NOT NULL,
	"panel_channel_id" text,
	"panel_message_id" text,
	"allow_anonymous" boolean DEFAULT true NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedbacks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"anonymous" boolean NOT NULL,
	"author_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "feedbacks_created_idx" ON "feedbacks" USING btree ("created_at");