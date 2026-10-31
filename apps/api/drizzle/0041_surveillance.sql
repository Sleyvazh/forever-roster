CREATE TABLE "site_alerts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"emailed_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	CONSTRAINT "site_alerts_kind" CHECK ("site_alerts"."kind" IN ('bot_down', 'bot_up', 'backup_late', 'backup_ok'))
);
