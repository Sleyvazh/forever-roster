ALTER TABLE "raid_signups" ADD COLUMN "status_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "raid_signups" SET "status_at" = "updated_at";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "game_relay" boolean DEFAULT true NOT NULL;