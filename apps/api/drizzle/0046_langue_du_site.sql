ALTER TABLE "users" ADD COLUMN "lang" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_lang" CHECK ("users"."lang" IN ('auto', 'fr', 'en'));