ALTER TABLE "characters" DROP CONSTRAINT "characters_level";--> statement-breakpoint
ALTER TABLE "raids" DROP CONSTRAINT "raids_size_chk";--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "realm" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "raid_templates" ADD COLUMN "difficulty" text;--> statement-breakpoint
ALTER TABLE "raids" ADD COLUMN "difficulty" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "game_lang" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "roster_preview" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_level" CHECK ("characters"."level" BETWEEN 1 AND 90);--> statement-breakpoint
ALTER TABLE "raids" ADD CONSTRAINT "raids_difficulty_chk" CHECK ("raids"."difficulty" is null or "raids"."difficulty" in ('normal', 'heroic', 'mythic'));--> statement-breakpoint
ALTER TABLE "raids" ADD CONSTRAINT "raids_size_chk" CHECK ("raids"."size" between 5 and 40);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_game_lang" CHECK ("users"."game_lang" IN ('auto', 'fr', 'en'));