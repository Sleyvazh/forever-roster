-- Lot E : un perso est rangé dans un seul groupe. Reprise : chaque perso garde le groupe où il est main
-- (le plus ancien s'il l'est dans plusieurs), sinon le premier groupe où il a été ajouté. Ses inscriptions restent.
DELETE FROM "group_characters" gc
USING (
  SELECT "group_id", "character_id",
    row_number() OVER (PARTITION BY "character_id" ORDER BY "is_main" DESC, "created_at", "group_id") AS rk
  FROM "group_characters"
) ranked
WHERE gc."group_id" = ranked."group_id" AND gc."character_id" = ranked."character_id" AND ranked.rk > 1;--> statement-breakpoint
-- Un joueur qui a perdu son main dans un groupe : son premier perso restant (ordre de Mes persos) le devient
UPDATE "group_characters" gc SET "is_main" = true
FROM (
  SELECT DISTINCT ON (g."group_id", g."user_id") g."group_id", g."character_id"
  FROM "group_characters" g JOIN "characters" c ON c."id" = g."character_id"
  WHERE NOT EXISTS (SELECT 1 FROM "group_characters" m WHERE m."group_id" = g."group_id" AND m."user_id" = g."user_id" AND m."is_main")
  ORDER BY g."group_id", g."user_id", c."sort_order", c."created_at"
) pick
WHERE gc."group_id" = pick."group_id" AND gc."character_id" = pick."character_id";--> statement-breakpoint
CREATE UNIQUE INDEX "group_characters_char_uq" ON "group_characters" USING btree ("character_id");
