CREATE TABLE "character_recipes" (
	"character_id" uuid NOT NULL,
	"spell_id" integer NOT NULL,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_recipes_character_id_spell_id_pk" PRIMARY KEY("character_id","spell_id"),
	CONSTRAINT "character_recipes_status" CHECK ("character_recipes"."status" IN ('known', 'wanted'))
);
--> statement-breakpoint
CREATE TABLE "game_items" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"quality" smallint NOT NULL,
	"item_level" integer NOT NULL,
	"req_level" integer NOT NULL,
	"class_id" integer NOT NULL,
	"subclass_id" integer NOT NULL,
	"inventory_type" integer NOT NULL,
	"kind" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_recipes" (
	"spell_id" integer PRIMARY KEY NOT NULL,
	"skill_line" integer NOT NULL,
	"name" text NOT NULL,
	"req_skill" integer NOT NULL,
	"trivial_low" integer NOT NULL,
	"trivial_high" integer NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"created_item_id" integer,
	"created_count" integer DEFAULT 1 NOT NULL,
	"enchant" text,
	"reagents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"taught_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"from_item" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "character_recipes" ADD CONSTRAINT "character_recipes_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_recipes_spell_idx" ON "character_recipes" USING btree ("spell_id");--> statement-breakpoint
CREATE INDEX "game_items_inv_idx" ON "game_items" USING btree ("inventory_type");--> statement-breakpoint
CREATE INDEX "game_recipes_skill_idx" ON "game_recipes" USING btree ("skill_line");