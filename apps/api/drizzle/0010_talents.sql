CREATE TABLE "game_talent_trees" (
	"cls" text NOT NULL,
	"tree" smallint NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"icon_id" integer,
	CONSTRAINT "game_talent_trees_cls_tree_pk" PRIMARY KEY("cls","tree")
);
--> statement-breakpoint
CREATE TABLE "game_talents" (
	"id" integer PRIMARY KEY NOT NULL,
	"cls" text NOT NULL,
	"tree" smallint NOT NULL,
	"tier" smallint NOT NULL,
	"col" smallint NOT NULL,
	"link_index" smallint NOT NULL,
	"max_rank" smallint NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"icon_id" integer,
	"prereq" jsonb,
	"ranks" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "game_talents_cls_idx" ON "game_talents" USING btree ("cls");