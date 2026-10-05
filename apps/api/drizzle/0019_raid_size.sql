ALTER TABLE "raid_templates" ADD COLUMN "size" smallint DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE "raids" ADD COLUMN "size" smallint DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE "raids" ADD COLUMN "targets" jsonb;--> statement-breakpoint
ALTER TABLE "raids" ADD CONSTRAINT "raids_size_chk" CHECK ("raids"."size" in (10, 20, 40));