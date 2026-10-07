CREATE TABLE "feedback_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"feedback_id" uuid NOT NULL,
	"from" text NOT NULL,
	"name" text,
	"text" text NOT NULL,
	"source" text NOT NULL,
	"delivered" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_messages_from" CHECK ("feedback_messages"."from" IN ('team', 'author')),
	CONSTRAINT "feedback_messages_source" CHECK ("feedback_messages"."source" IN ('discord', 'site'))
);
--> statement-breakpoint
CREATE TABLE "feedback_seen" (
	"user_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_seen_user_id_group_id_pk" PRIMARY KEY("user_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "feedback_settings" ADD COLUMN "guild_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_settings" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD COLUMN "text" text;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD COLUMN "author_name" text;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD COLUMN "status" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD COLUMN "author_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD COLUMN "discord_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD COLUMN "discord_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_messages" ADD CONSTRAINT "feedback_messages_feedback_id_feedbacks_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedbacks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_seen" ADD CONSTRAINT "feedback_seen_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_seen" ADD CONSTRAINT "feedback_seen_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_messages_idx" ON "feedback_messages" USING btree ("feedback_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_messages_pending_idx" ON "feedback_messages" USING btree ("created_at") WHERE "feedback_messages"."source" = 'site' AND "feedback_messages"."delivered" IS NULL;--> statement-breakpoint
ALTER TABLE "feedback_settings" ADD CONSTRAINT "feedback_settings_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_settings_group_idx" ON "feedback_settings" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "feedbacks_group_idx" ON "feedbacks" USING btree ("group_id","author_at");--> statement-breakpoint
CREATE INDEX "groups_discord_guild_idx" ON "groups" USING btree ("discord_guild_id");--> statement-breakpoint
CREATE INDEX "groups_orders_guild_idx" ON "groups" USING btree ("orders_guild_id");--> statement-breakpoint
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_status" CHECK ("feedbacks"."status" IN ('new', 'wip', 'done', 'refused'));