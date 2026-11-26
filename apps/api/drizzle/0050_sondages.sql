CREATE TABLE "poll_votes" (
	"poll_id" uuid NOT NULL,
	"voter_key" text NOT NULL,
	"user_id" uuid,
	"discord_user_id" text,
	"name" text NOT NULL,
	"role" text,
	"yes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"maybe" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_votes_poll_id_voter_key_pk" PRIMARY KEY("poll_id","voter_key")
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"question" text NOT NULL,
	"options" jsonb NOT NULL,
	"multi" boolean DEFAULT false NOT NULL,
	"anonymous" boolean DEFAULT false NOT NULL,
	"results" text DEFAULT 'live' NOT NULL,
	"raid_name" text DEFAULT '' NOT NULL,
	"closes_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	"creator_name" text NOT NULL,
	"raid_id" uuid,
	"channel_id" text,
	"discord_channel_id" text,
	"discord_message_id" text,
	"discord_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"discord_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "polls_kind_chk" CHECK ("polls"."kind" in ('choice', 'dates')),
	CONSTRAINT "polls_results_chk" CHECK ("polls"."results" in ('live', 'end')),
	CONSTRAINT "polls_question_chk" CHECK (char_length("polls"."question") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "poll_creators" text DEFAULT 'officers' NOT NULL;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_raid_id_raids_id_fk" FOREIGN KEY ("raid_id") REFERENCES "public"."raids"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "polls_group_idx" ON "polls" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX "polls_open_idx" ON "polls" USING btree ("closed_at","closes_at");--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_poll_creators_chk" CHECK ("groups"."poll_creators" in ('officers', 'members'));