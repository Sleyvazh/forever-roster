CREATE TABLE "guild_bank" (
	"group_id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"by" text DEFAULT '' NOT NULL,
	"money" bigint,
	"money_at" timestamp with time zone,
	"tabs" smallint DEFAULT 0 NOT NULL,
	"sent_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_bank_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"tab" smallint,
	"type" text NOT NULL,
	"who" text DEFAULT '' NOT NULL,
	"item_id" integer,
	"count" integer,
	"tab1" smallint,
	"tab2" smallint,
	"amount" bigint,
	"at" timestamp with time zone NOT NULL,
	"sent_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_bank_log_kind_chk" CHECK ("guild_bank_log"."kind" in ('item', 'money'))
);
--> statement-breakpoint
CREATE TABLE "guild_bank_tabs" (
	"group_id" uuid NOT NULL,
	"tab" smallint NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"read_at" timestamp with time zone,
	"read_by" text DEFAULT '' NOT NULL,
	"sent_by" uuid,
	"slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "guild_bank_tabs_group_id_tab_pk" PRIMARY KEY("group_id","tab")
);
--> statement-breakpoint
ALTER TABLE "guild_bank" ADD CONSTRAINT "guild_bank_group_id_game_guilds_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."game_guilds"("group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_bank" ADD CONSTRAINT "guild_bank_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_bank_log" ADD CONSTRAINT "guild_bank_log_group_id_game_guilds_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."game_guilds"("group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_bank_log" ADD CONSTRAINT "guild_bank_log_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_bank_tabs" ADD CONSTRAINT "guild_bank_tabs_group_id_game_guilds_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."game_guilds"("group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_bank_tabs" ADD CONSTRAINT "guild_bank_tabs_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guild_bank_log_group_idx" ON "guild_bank_log" USING btree ("group_id","kind","at");--> statement-breakpoint
CREATE INDEX "guild_bank_log_at_idx" ON "guild_bank_log" USING btree ("at");