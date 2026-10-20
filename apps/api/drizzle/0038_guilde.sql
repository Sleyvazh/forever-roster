CREATE TABLE "game_guilds" (
	"group_id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"realm" text DEFAULT '' NOT NULL,
	"faction" text DEFAULT '' NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"linked_by" uuid,
	"linked_by_name" text NOT NULL,
	"auto" boolean DEFAULT true NOT NULL,
	"roster_at" timestamp with time zone,
	"roster_by" text DEFAULT '' NOT NULL,
	"roster_complete" boolean DEFAULT false NOT NULL,
	"roster_total" integer DEFAULT 0 NOT NULL,
	"first_roster_at" timestamp with time zone,
	"journal_at" timestamp with time zone,
	"journal_by" text DEFAULT '' NOT NULL,
	"podium" jsonb
);
--> statement-breakpoint
CREATE TABLE "guild_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"type" text NOT NULL,
	"player1" text DEFAULT '' NOT NULL,
	"player2" text DEFAULT '' NOT NULL,
	"rank_index" smallint,
	"rank_name" text,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_events_type_chk" CHECK ("guild_events"."type" in ('invite', 'join', 'promote', 'demote', 'remove', 'quit'))
);
--> statement-breakpoint
CREATE TABLE "guild_levels" (
	"group_id" uuid NOT NULL,
	"guid" text NOT NULL,
	"level" smallint NOT NULL,
	"reached_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"announced_at" timestamp with time zone,
	CONSTRAINT "guild_levels_group_id_guid_level_pk" PRIMARY KEY("group_id","guid","level"),
	CONSTRAINT "guild_levels_source_chk" CHECK ("guild_levels"."source" in ('exact', 'roster', 'seen'))
);
--> statement-breakpoint
CREATE TABLE "guild_link_proposals" (
	"group_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"realm" text DEFAULT '' NOT NULL,
	"faction" text DEFAULT '' NOT NULL,
	"members" integer DEFAULT 0 NOT NULL,
	"proposed_by" uuid NOT NULL,
	"proposed_by_name" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_link_proposals_group_id_key_pk" PRIMARY KEY("group_id","key")
);
--> statement-breakpoint
CREATE TABLE "guild_links" (
	"group_id" uuid NOT NULL,
	"guid" text NOT NULL,
	"player_id" uuid NOT NULL,
	"source" text NOT NULL,
	"confirmed" boolean,
	"by_id" uuid,
	"by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_links_group_id_guid_pk" PRIMARY KEY("group_id","guid"),
	CONSTRAINT "guild_links_source_chk" CHECK ("guild_links"."source" in ('note', 'officer', 'declared'))
);
--> statement-breakpoint
CREATE TABLE "guild_members" (
	"group_id" uuid NOT NULL,
	"guid" text NOT NULL,
	"name" text NOT NULL,
	"cls" text DEFAULT '' NOT NULL,
	"level" smallint NOT NULL,
	"rank" text DEFAULT '' NOT NULL,
	"rank_index" smallint DEFAULT 0 NOT NULL,
	"online" boolean DEFAULT false NOT NULL,
	"last_online_at" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"officer_note" text DEFAULT '' NOT NULL,
	"xp" integer,
	"xp_max" integer,
	"xp_level" smallint,
	"xp_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	"joined_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_members_group_id_guid_pk" PRIMARY KEY("group_id","guid")
);
--> statement-breakpoint
CREATE TABLE "guild_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid,
	"main_guid" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "guid" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "level_announces" text DEFAULT 'sixty' NOT NULL;--> statement-breakpoint
ALTER TABLE "game_guilds" ADD CONSTRAINT "game_guilds_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_guilds" ADD CONSTRAINT "game_guilds_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_events" ADD CONSTRAINT "guild_events_group_id_game_guilds_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."game_guilds"("group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_levels" ADD CONSTRAINT "guild_levels_group_id_game_guilds_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."game_guilds"("group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_link_proposals" ADD CONSTRAINT "guild_link_proposals_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_link_proposals" ADD CONSTRAINT "guild_link_proposals_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_links" ADD CONSTRAINT "guild_links_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_links" ADD CONSTRAINT "guild_links_player_id_guild_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."guild_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_links" ADD CONSTRAINT "guild_links_by_id_users_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_group_id_game_guilds_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."game_guilds"("group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_players" ADD CONSTRAINT "guild_players_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_players" ADD CONSTRAINT "guild_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_players" ADD CONSTRAINT "guild_players_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_guilds_key_idx" ON "game_guilds" USING btree ("key");--> statement-breakpoint
CREATE INDEX "guild_events_group_idx" ON "guild_events" USING btree ("group_id","at");--> statement-breakpoint
CREATE INDEX "guild_events_at_idx" ON "guild_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "guild_levels_reached_idx" ON "guild_levels" USING btree ("reached_at");--> statement-breakpoint
CREATE INDEX "guild_link_proposals_created_idx" ON "guild_link_proposals" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "guild_links_player_idx" ON "guild_links" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "guild_members_left_idx" ON "guild_members" USING btree ("left_at") WHERE "guild_members"."left_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "guild_players_user_uq" ON "guild_players" USING btree ("group_id","user_id") WHERE "guild_players"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "guild_players_group_idx" ON "guild_players" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "characters_guid_idx" ON "characters" USING btree ("guid") WHERE "characters"."guid" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_level_announces_chk" CHECK ("groups"."level_announces" in ('none', 'sixty', 'tens'));