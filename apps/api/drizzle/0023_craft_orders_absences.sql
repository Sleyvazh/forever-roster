CREATE TABLE "absences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"start_date" date,
	"end_date" date,
	"weekdays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"reason_visibility" text DEFAULT 'officers' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "absences_kind_chk" CHECK (("absences"."start_date" is not null and "absences"."end_date" is not null and "absences"."end_date" >= "absences"."start_date") or jsonb_array_length("absences"."weekdays") > 0),
	CONSTRAINT "absences_visibility_chk" CHECK ("absences"."reason_visibility" in ('officers', 'group'))
);
--> statement-breakpoint
CREATE TABLE "craft_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"spell_id" integer NOT NULL,
	"recipe_name" text NOT NULL,
	"item_id" integer,
	"item_name" text,
	"quantity" smallint DEFAULT 1 NOT NULL,
	"requester_id" uuid NOT NULL,
	"character_id" uuid,
	"reagents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"taker_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"taken_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"discord_channel_id" text,
	"discord_message_id" text,
	"discord_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"discord_synced_at" timestamp with time zone,
	CONSTRAINT "craft_orders_status_chk" CHECK ("craft_orders"."status" in ('open', 'taken', 'done')),
	CONSTRAINT "craft_orders_qty_chk" CHECK ("craft_orders"."quantity" between 1 and 99)
);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "orders_guild_id" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "orders_channel_id" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "orders_link_code_hash" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "orders_link_code_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "craft_orders" ADD CONSTRAINT "craft_orders_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "craft_orders" ADD CONSTRAINT "craft_orders_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "craft_orders" ADD CONSTRAINT "craft_orders_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "craft_orders" ADD CONSTRAINT "craft_orders_taker_id_users_id_fk" FOREIGN KEY ("taker_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absences_user_idx" ON "absences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "craft_orders_group_idx" ON "craft_orders" USING btree ("group_id","status");