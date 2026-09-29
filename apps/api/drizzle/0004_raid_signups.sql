CREATE TABLE "raid_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raid_id" uuid NOT NULL,
	"user_id" uuid,
	"discord_user_id" text,
	"display_name" text NOT NULL,
	"character_id" uuid,
	"cls" text DEFAULT '' NOT NULL,
	"spec" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raid_signups_who" CHECK ("raid_signups"."user_id" IS NOT NULL OR "raid_signups"."discord_user_id" IS NOT NULL),
	CONSTRAINT "raid_signups_status" CHECK ("raid_signups"."status" IN ('present', 'late', 'tentative', 'alt', 'bench', 'absent'))
);
--> statement-breakpoint
ALTER TABLE "raids" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "raid_signups" ADD CONSTRAINT "raid_signups_raid_id_raids_id_fk" FOREIGN KEY ("raid_id") REFERENCES "public"."raids"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raid_signups" ADD CONSTRAINT "raid_signups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raid_signups" ADD CONSTRAINT "raid_signups_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "raid_signups_user_uq" ON "raid_signups" USING btree ("raid_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "raid_signups_discord_uq" ON "raid_signups" USING btree ("raid_id","discord_user_id");--> statement-breakpoint
CREATE INDEX "raid_signups_raid_idx" ON "raid_signups" USING btree ("raid_id");