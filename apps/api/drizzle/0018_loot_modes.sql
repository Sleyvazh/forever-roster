CREATE TABLE "loot_catalog" (
	"instance" text NOT NULL,
	"boss" text DEFAULT '' NOT NULL,
	"item_id" integer NOT NULL,
	"seen" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loot_catalog_instance_boss_item_id_pk" PRIMARY KEY("instance","boss","item_id")
);
--> statement-breakpoint
CREATE TABLE "soft_reserves" (
	"raid_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "soft_reserves_raid_id_character_id_item_id_pk" PRIMARY KEY("raid_id","character_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "loot_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "raid_templates" ADD COLUMN "loot_mode" text DEFAULT 'journal' NOT NULL;--> statement-breakpoint
ALTER TABLE "raid_templates" ADD COLUMN "sr_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "raids" ADD COLUMN "loot_mode" text DEFAULT 'journal' NOT NULL;--> statement-breakpoint
ALTER TABLE "raids" ADD COLUMN "sr_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "soft_reserves" ADD CONSTRAINT "soft_reserves_raid_id_raids_id_fk" FOREIGN KEY ("raid_id") REFERENCES "public"."raids"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soft_reserves" ADD CONSTRAINT "soft_reserves_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soft_reserves" ADD CONSTRAINT "soft_reserves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "soft_reserves_char_idx" ON "soft_reserves" USING btree ("character_id","item_id");