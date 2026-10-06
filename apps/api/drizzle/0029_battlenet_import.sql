CREATE TABLE "bnet_imports" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"characters" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "bnet_id" bigint;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "realm_slug" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "ilvl" integer;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "active_spec" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "bnet_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bnet_imports" ADD CONSTRAINT "bnet_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "characters_bnet_uq" ON "characters" USING btree ("user_id","bnet_id");