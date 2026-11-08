ALTER TABLE "characters" ADD COLUMN "origin_kind" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "origin_by" uuid;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "origin_by_name" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "origin_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_origin_by_users_id_fk" FOREIGN KEY ("origin_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;