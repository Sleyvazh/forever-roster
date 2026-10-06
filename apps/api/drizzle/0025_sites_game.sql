ALTER TABLE "characters" ADD COLUMN "game" text DEFAULT 'forever' NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "game" text DEFAULT 'forever' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_game" CHECK ("characters"."game" IN ('forever', 'retail'));--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_game" CHECK ("groups"."game" IN ('forever', 'retail'));