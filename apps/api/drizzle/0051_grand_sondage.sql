ALTER TABLE "groups" ADD COLUMN "polls_guild_id" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "polls_channel_id" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "polls_channel_name" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "polls_link_code_hash" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "polls_link_code_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "polls" ADD COLUMN "max_choices" smallint;--> statement-breakpoint
ALTER TABLE "polls" ADD COLUMN "runoff_id" uuid;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_runoff_id_polls_id_fk" FOREIGN KEY ("runoff_id") REFERENCES "public"."polls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "groups_polls_guild_idx" ON "groups" USING btree ("polls_guild_id");--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_max_choices_chk" CHECK ("polls"."max_choices" is null or "polls"."max_choices" between 2 and 100);