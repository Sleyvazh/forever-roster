CREATE TABLE "loot_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"delta" smallint NOT NULL,
	"note" text NOT NULL,
	"created_by" uuid,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loot_corrections_delta_chk" CHECK ("loot_corrections"."delta" between -20 and 20 and "loot_corrections"."delta" <> 0)
);
--> statement-breakpoint
CREATE TABLE "loot_exclusions" (
	"raid_id" uuid NOT NULL,
	"item_id" integer NOT NULL,
	"recipient" text NOT NULL,
	"at" integer NOT NULL,
	"created_by" uuid,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loot_exclusions_raid_id_item_id_recipient_at_pk" PRIMARY KEY("raid_id","item_id","recipient","at")
);
--> statement-breakpoint
ALTER TABLE "loot_corrections" ADD CONSTRAINT "loot_corrections_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_corrections" ADD CONSTRAINT "loot_corrections_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_corrections" ADD CONSTRAINT "loot_corrections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_exclusions" ADD CONSTRAINT "loot_exclusions_raid_id_raids_id_fk" FOREIGN KEY ("raid_id") REFERENCES "public"."raids"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_exclusions" ADD CONSTRAINT "loot_exclusions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loot_corrections_group_idx" ON "loot_corrections" USING btree ("group_id","created_at");