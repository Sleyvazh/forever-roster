ALTER TABLE "characters" ADD COLUMN "talents2" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "talent_link2" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Spés à variantes : l'ancien intitulé devient la variante habituelle (le rôle ne change pas).
UPDATE "characters" SET "spec1" = 'Holy Heal' WHERE "cls" = 'Paladin' AND "spec1" = 'Holy';--> statement-breakpoint
UPDATE "characters" SET "spec2" = 'Holy Heal' WHERE "cls" = 'Paladin' AND "spec2" = 'Holy';--> statement-breakpoint
UPDATE "characters" SET "spec1" = 'Discipline Heal' WHERE "cls" = 'Priest' AND "spec1" = 'Discipline';--> statement-breakpoint
UPDATE "characters" SET "spec2" = 'Discipline Heal' WHERE "cls" = 'Priest' AND "spec2" = 'Discipline';--> statement-breakpoint
UPDATE "characters" SET "spec1" = 'Enhancement DPS' WHERE "cls" = 'Shaman' AND "spec1" = 'Enhancement';--> statement-breakpoint
UPDATE "characters" SET "spec2" = 'Enhancement DPS' WHERE "cls" = 'Shaman' AND "spec2" = 'Enhancement';
