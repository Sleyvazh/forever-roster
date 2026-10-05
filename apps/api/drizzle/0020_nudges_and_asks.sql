CREATE TABLE "raid_asks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raid_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"spec" text NOT NULL,
	"asked_by" uuid,
	"asked_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"failed" boolean DEFAULT false NOT NULL,
	"answer" text,
	"answered_at" timestamp with time zone,
	CONSTRAINT "raid_asks_answer_chk" CHECK ("raid_asks"."answer" is null or "raid_asks"."answer" in ('yes', 'no'))
);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "nudge_hours" smallint DEFAULT 48;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "nudge_officers" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "raids" ADD COLUMN "nudge_auto_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "raids" ADD COLUMN "nudge_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "raids" ADD COLUMN "nudge_manual_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "raid_asks" ADD CONSTRAINT "raid_asks_raid_id_raids_id_fk" FOREIGN KEY ("raid_id") REFERENCES "public"."raids"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raid_asks" ADD CONSTRAINT "raid_asks_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raid_asks" ADD CONSTRAINT "raid_asks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raid_asks" ADD CONSTRAINT "raid_asks_asked_by_users_id_fk" FOREIGN KEY ("asked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "raid_asks_char_uq" ON "raid_asks" USING btree ("raid_id","character_id");--> statement-breakpoint
CREATE INDEX "raid_asks_pending_idx" ON "raid_asks" USING btree ("sent_at");--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_nudge_hours_chk" CHECK ("groups"."nudge_hours" is null or "groups"."nudge_hours" in (24, 48, 72));