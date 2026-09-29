CREATE TABLE "discord_deletions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "discord_guild_id" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "discord_channel_id" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "discord_link_code_hash" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "discord_link_code_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "raids" ADD COLUMN "discord_channel_id" text;--> statement-breakpoint
ALTER TABLE "raids" ADD COLUMN "discord_message_id" text;--> statement-breakpoint
ALTER TABLE "raids" ADD COLUMN "discord_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "raids" ADD COLUMN "discord_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "discord_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "discord_username" text;--> statement-breakpoint
CREATE UNIQUE INDEX "users_discord_uq" ON "users" USING btree ("discord_id");