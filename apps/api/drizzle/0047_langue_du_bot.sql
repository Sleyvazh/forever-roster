ALTER TABLE "groups" ADD COLUMN "lang" text DEFAULT 'fr' NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_lang" CHECK ("groups"."lang" IN ('fr', 'en'));