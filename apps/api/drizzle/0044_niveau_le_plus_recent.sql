ALTER TABLE "guild_members" ADD COLUMN "level_at" timestamp with time zone;--> statement-breakpoint
-- Niveau gardé avant ce lot (le plus haut vu) : daté de la dernière liste ou XP ; la prochaine observation plus récente fait foi
UPDATE "guild_members" SET "level_at" = GREATEST("seen_at", COALESCE("xp_at", "seen_at"));
