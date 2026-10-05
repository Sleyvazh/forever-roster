CREATE TABLE "group_characters" (
	"group_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_main" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_characters_group_id_character_id_pk" PRIMARY KEY("group_id","character_id")
);
--> statement-breakpoint
ALTER TABLE "group_characters" ADD CONSTRAINT "group_characters_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_characters" ADD CONSTRAINT "group_characters_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_characters" ADD CONSTRAINT "group_characters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_characters_main_uq" ON "group_characters" USING btree ("group_id","user_id") WHERE "group_characters"."is_main";--> statement-breakpoint
CREATE INDEX "group_characters_user_idx" ON "group_characters" USING btree ("user_id");--> statement-breakpoint
-- Reprise de l'existant : chaque perso reste dans les groupes de son joueur (rien ne disparaît des compos),
-- et le premier perso de « Mes persos » devient le main du joueur dans chacun de ses groupes.
INSERT INTO "group_characters" ("group_id", "character_id", "user_id", "is_main")
SELECT gm."group_id", c."id", c."user_id",
  row_number() OVER (PARTITION BY gm."group_id", c."user_id" ORDER BY c."sort_order", c."created_at", c."id") = 1
FROM "characters" c
JOIN "group_members" gm ON gm."user_id" = c."user_id";
