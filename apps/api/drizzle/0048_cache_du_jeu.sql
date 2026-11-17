CREATE TABLE "game_cache_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"device_id" uuid,
	"via" text DEFAULT 'site' NOT NULL,
	"build" integer NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"rows" integer NOT NULL,
	"new_rows" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_hotfixes" (
	"table_hash" bigint NOT NULL,
	"row_id" integer NOT NULL,
	"push" integer NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"data" "bytea" NOT NULL,
	"build" integer NOT NULL,
	"contributor_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_hotfixes_table_hash_row_id_pk" PRIMARY KEY("table_hash","row_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "game_data_contributor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "game_cache_uploads" ADD CONSTRAINT "game_cache_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_cache_uploads" ADD CONSTRAINT "game_cache_uploads_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_hotfixes" ADD CONSTRAINT "game_hotfixes_contributor_id_users_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_cache_uploads_user_idx" ON "game_cache_uploads" USING btree ("user_id","received_at");--> statement-breakpoint
CREATE INDEX "game_cache_uploads_received_idx" ON "game_cache_uploads" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "game_hotfixes_received_idx" ON "game_hotfixes" USING btree ("received_at");