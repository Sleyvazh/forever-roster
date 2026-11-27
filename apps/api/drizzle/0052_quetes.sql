CREATE TABLE "quest_notices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"discord_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "quest_takers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quest_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"state" text DEFAULT 'taken' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"reject_note" text DEFAULT '' NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"turned_in_at" timestamp with time zone,
	"validated_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"disputed_at" timestamp with time zone,
	"reminded_validate_at" timestamp with time zone,
	"reminded_pay_at" timestamp with time zone,
	"reminded_receive_at" timestamp with time zone,
	CONSTRAINT "quest_takers_state_chk" CHECK ("quest_takers"."state" in ('taken', 'turned_in', 'validated', 'paid', 'received', 'abandoned', 'removed', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "quests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"objective_item_id" integer,
	"objective_qty" smallint,
	"objective_text" text DEFAULT '' NOT NULL,
	"reward_copper" integer DEFAULT 0 NOT NULL,
	"reward_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reward_text" text DEFAULT '' NOT NULL,
	"places" smallint DEFAULT 1 NOT NULL,
	"min_level" smallint,
	"profession" text DEFAULT '' NOT NULL,
	"due_at" timestamp with time zone,
	"created_by" uuid,
	"creator_name" text NOT NULL,
	"closed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"expiry_notified_at" timestamp with time zone,
	"channel_id" text,
	"discord_channel_id" text,
	"discord_message_id" text,
	"discord_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"discord_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quests_type_chk" CHECK ("quests"."type" in ('collect', 'craft', 'dungeon', 'help', 'other')),
	CONSTRAINT "quests_title_chk" CHECK (char_length("quests"."title") between 1 and 60),
	CONSTRAINT "quests_places_chk" CHECK ("quests"."places" between 1 and 40),
	CONSTRAINT "quests_objective_qty_chk" CHECK ("quests"."objective_qty" is null or "quests"."objective_qty" between 1 and 999),
	CONSTRAINT "quests_reward_copper_chk" CHECK ("quests"."reward_copper" >= 0)
);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "quests_guild_id" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "quests_channel_id" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "quests_channel_name" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "quests_link_code_hash" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "quests_link_code_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "quest_creators" text DEFAULT 'members' NOT NULL;--> statement-breakpoint
ALTER TABLE "quest_takers" ADD CONSTRAINT "quest_takers_quest_id_quests_id_fk" FOREIGN KEY ("quest_id") REFERENCES "public"."quests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_takers" ADD CONSTRAINT "quest_takers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quest_notices_pending_idx" ON "quest_notices" USING btree ("created_at") WHERE "quest_notices"."claimed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "quest_takers_quest_user_uq" ON "quest_takers" USING btree ("quest_id","user_id");--> statement-breakpoint
CREATE INDEX "quest_takers_user_idx" ON "quest_takers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "quests_group_idx" ON "quests" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX "groups_quests_guild_idx" ON "groups" USING btree ("quests_guild_id");--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_quest_creators_chk" CHECK ("groups"."quest_creators" in ('officers', 'members'));