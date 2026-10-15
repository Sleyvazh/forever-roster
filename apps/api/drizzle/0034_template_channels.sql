ALTER TABLE "raid_templates" ADD COLUMN "discord_guild_id" text;--> statement-breakpoint
ALTER TABLE "raid_templates" ADD COLUMN "discord_channel_id" text;--> statement-breakpoint
ALTER TABLE "raid_templates" ADD COLUMN "discord_link_code_hash" text;--> statement-breakpoint
ALTER TABLE "raid_templates" ADD COLUMN "discord_link_code_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "raid_templates" ADD COLUMN "discord_rename" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "raid_templates" ADD COLUMN "discord_channel_name" text;--> statement-breakpoint
ALTER TABLE "raid_templates" ADD COLUMN "discord_rename_error" text;--> statement-breakpoint
CREATE UNIQUE INDEX "raid_templates_discord_channel_uq" ON "raid_templates" USING btree ("discord_channel_id") WHERE "raid_templates"."discord_channel_id" is not null;