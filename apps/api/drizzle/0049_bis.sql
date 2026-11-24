CREATE TABLE "bis_weights" (
	"scope" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"profile" text NOT NULL,
	"weights" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bis_weights_scope_scope_id_profile_pk" PRIMARY KEY("scope","scope_id","profile")
);
--> statement-breakpoint
CREATE TABLE "item_overrides" (
	"item_id" integer PRIMARY KEY NOT NULL,
	"unobtainable" boolean DEFAULT false NOT NULL,
	"faction" text,
	"source" jsonb,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bis_weights" ADD CONSTRAINT "bis_weights_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_overrides" ADD CONSTRAINT "item_overrides_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;