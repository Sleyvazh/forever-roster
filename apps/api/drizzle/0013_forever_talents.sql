CREATE TABLE "game_talents" (
	"id" integer PRIMARY KEY NOT NULL,
	"cls" text NOT NULL,
	"tree" smallint NOT NULL,
	"tier" smallint NOT NULL,
	"col" smallint NOT NULL,
	"link_index" smallint NOT NULL,
	"max_rank" smallint NOT NULL,
	"name" text NOT NULL,
	"spell_id" integer NOT NULL,
	"icon" text,
	"icon_id" integer,
	"prereq" integer,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "game_talents_cls_idx" ON "game_talents" USING btree ("cls");