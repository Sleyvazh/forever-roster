ALTER TABLE "raid_logs" ADD COLUMN "encounters" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "raid_logs" ADD COLUMN "difficulty" text;