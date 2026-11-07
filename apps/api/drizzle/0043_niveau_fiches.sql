ALTER TABLE "characters" ADD COLUMN "level_fixed_by" uuid;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "level_fixed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "level_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_level_fixed_by_users_id_fk" FOREIGN KEY ("level_fixed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Niveau lu en jeu par l'addon avant ce lot : la dernière synchro de l'addon en tient lieu
UPDATE "characters" SET "level_synced_at" = "addon_synced_at" WHERE "addon_synced_at" IS NOT NULL AND "game" = 'forever';