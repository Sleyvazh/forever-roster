CREATE TABLE "addon_ignored" (
	"user_id" uuid NOT NULL,
	"game" text NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "addon_ignored_user_id_game_key_pk" PRIMARY KEY("user_id","game","key")
);
--> statement-breakpoint
CREATE TABLE "device_pairings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_hash" text NOT NULL,
	"user_code" text NOT NULL,
	"name" text NOT NULL,
	"platform" text DEFAULT '' NOT NULL,
	"app_version" text DEFAULT '' NOT NULL,
	"ip" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" uuid,
	"last_poll_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"platform" text DEFAULT '' NOT NULL,
	"app_version" text DEFAULT '' NOT NULL,
	"token_hash" text NOT NULL,
	"last_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "addon_key" text;--> statement-breakpoint
ALTER TABLE "raid_logs" ADD COLUMN "lead" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "addon_ignored" ADD CONSTRAINT "addon_ignored_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_pairings" ADD CONSTRAINT "device_pairings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_pairings_hash_uq" ON "device_pairings" USING btree ("pair_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "device_pairings_code_uq" ON "device_pairings" USING btree ("user_code");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_token_uq" ON "devices" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "characters_addon_key_uq" ON "characters" USING btree ("user_id","game","addon_key");