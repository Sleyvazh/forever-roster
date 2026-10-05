-- « Fury Tank » n'existera pas sur Forever : les guerriers concernés passent en Protection (ils restent tanks).
UPDATE "characters" SET "spec1" = 'Protection' WHERE "cls" = 'Warrior' AND "spec1" = 'Fury Tank';--> statement-breakpoint
UPDATE "characters" SET "spec2" = CASE WHEN "spec1" = 'Protection' THEN '' ELSE 'Protection' END WHERE "cls" = 'Warrior' AND "spec2" = 'Fury Tank';--> statement-breakpoint
UPDATE "characters" SET "spec2" = '' WHERE "cls" = 'Warrior' AND "spec2" = "spec1";--> statement-breakpoint
UPDATE "raid_signups" SET "spec" = 'Protection' WHERE "cls" = 'Warrior' AND "spec" = 'Fury Tank';--> statement-breakpoint
UPDATE "raid_asks" SET "spec" = 'Protection' WHERE "spec" = 'Fury Tank';
