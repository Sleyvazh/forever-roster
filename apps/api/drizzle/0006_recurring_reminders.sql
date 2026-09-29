CREATE TABLE "raid_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"weekday" smallint NOT NULL,
	"time" text NOT NULL,
	"lead_days" smallint DEFAULT 7 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"generated_until" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raid_templates_weekday_chk" CHECK ("raid_templates"."weekday" between 1 and 7),
	CONSTRAINT "raid_templates_lead_chk" CHECK ("raid_templates"."lead_days" between 1 and 28),
	CONSTRAINT "raid_templates_time_chk" CHECK ("raid_templates"."time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
ALTER TABLE "raids" ADD COLUMN "reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "raids" ADD COLUMN "roster_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "raids" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "discord_reminders" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "raid_templates" ADD CONSTRAINT "raid_templates_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raid_templates" ADD CONSTRAINT "raid_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "raid_templates_group_idx" ON "raid_templates" USING btree ("group_id");--> statement-breakpoint
ALTER TABLE "raids" ADD CONSTRAINT "raids_template_id_raid_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."raid_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "raids_template_occurrence_uq" ON "raids" USING btree ("template_id","scheduled_at");