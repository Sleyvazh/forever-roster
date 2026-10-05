ALTER TABLE "characters" ADD COLUMN "consumables" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "consumables_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "raid_logs" ADD COLUMN "consumable_call" jsonb;--> statement-breakpoint
ALTER TABLE "raids" ADD COLUMN "council" jsonb;--> statement-breakpoint
ALTER TABLE "raids" ADD COLUMN "prep" jsonb DEFAULT '{"instance":null,"consumables":[],"bosses":[]}'::jsonb NOT NULL;