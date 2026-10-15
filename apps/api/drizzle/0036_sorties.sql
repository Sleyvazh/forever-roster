CREATE TABLE "outing_notices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"discord_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	CONSTRAINT "outing_notices_kind" CHECK ("outing_notices"."kind" IN ('full', 'soon', 'moved', 'cancelled', 'promoted'))
);
--> statement-breakpoint
CREATE TABLE "outing_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outing_id" uuid NOT NULL,
	"user_id" uuid,
	"discord_user_id" text,
	"display_name" text NOT NULL,
	"character_id" uuid,
	"character_name" text DEFAULT '' NOT NULL,
	"cls" text DEFAULT '' NOT NULL,
	"spec" text DEFAULT '' NOT NULL,
	"role" text NOT NULL,
	"waiting_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outing_signups_who" CHECK ("outing_signups"."user_id" IS NOT NULL OR "outing_signups"."discord_user_id" IS NOT NULL),
	CONSTRAINT "outing_signups_role" CHECK ("outing_signups"."role" IN ('Tank', 'Heal', 'DPS'))
);
--> statement-breakpoint
CREATE TABLE "outings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"dungeon" text NOT NULL,
	"title" text NOT NULL,
	"min_level" smallint,
	"max_level" smallint,
	"day" date NOT NULL,
	"scheduled_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"tanks" smallint DEFAULT 1 NOT NULL,
	"heals" smallint DEFAULT 1 NOT NULL,
	"dps" smallint DEFAULT 3 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"creator_name" text NOT NULL,
	"full_notified_at" timestamp with time zone,
	"soon_notified_at" timestamp with time zone,
	"discord_channel_id" text,
	"discord_message_id" text,
	"discord_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"discord_synced_at" timestamp with time zone,
	"discord_rendered_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outings_places_chk" CHECK ("outings"."tanks" between 0 and 5 and "outings"."heals" between 0 and 5 and "outings"."dps" between 0 and 5 and "outings"."tanks" + "outings"."heals" + "outings"."dps" = 5),
	CONSTRAINT "outings_note_chk" CHECK (char_length("outings"."note") <= 80)
);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "outings_guild_id" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "outings_channel_id" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "outings_channel_name" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "outings_link_code_hash" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "outings_link_code_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "raid_creators" text DEFAULT 'officers' NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "outing_creators" text DEFAULT 'members' NOT NULL;--> statement-breakpoint
ALTER TABLE "outing_signups" ADD CONSTRAINT "outing_signups_outing_id_outings_id_fk" FOREIGN KEY ("outing_id") REFERENCES "public"."outings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outing_signups" ADD CONSTRAINT "outing_signups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outing_signups" ADD CONSTRAINT "outing_signups_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outings" ADD CONSTRAINT "outings_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outings" ADD CONSTRAINT "outings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outing_notices_pending_idx" ON "outing_notices" USING btree ("created_at") WHERE "outing_notices"."claimed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "outing_signups_user_uq" ON "outing_signups" USING btree ("outing_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outing_signups_discord_uq" ON "outing_signups" USING btree ("outing_id","discord_user_id");--> statement-breakpoint
CREATE INDEX "outing_signups_outing_idx" ON "outing_signups" USING btree ("outing_id");--> statement-breakpoint
CREATE INDEX "outings_group_idx" ON "outings" USING btree ("group_id","expires_at");--> statement-breakpoint
CREATE INDEX "outings_expires_idx" ON "outings" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "groups_outings_guild_idx" ON "groups" USING btree ("outings_guild_id");--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_raid_creators_chk" CHECK ("groups"."raid_creators" in ('officers', 'members'));--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_outing_creators_chk" CHECK ("groups"."outing_creators" in ('officers', 'members'));