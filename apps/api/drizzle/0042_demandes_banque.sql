CREATE TABLE "bank_request_notices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	CONSTRAINT "bank_request_notices_kind" CHECK ("bank_request_notices"."kind" IN ('prepared', 'refused'))
);
--> statement-breakpoint
CREATE TABLE "bank_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"handled_by" uuid,
	"handled_by_name" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "bank_requests_status_chk" CHECK ("bank_requests"."status" IN ('pending', 'prepared', 'done', 'refused', 'cancelled')),
	CONSTRAINT "bank_requests_quantity_chk" CHECK ("bank_requests"."quantity" >= 1)
);
--> statement-breakpoint
ALTER TABLE "group_members" ADD COLUMN "banker" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_request_notices" ADD CONSTRAINT "bank_request_notices_request_id_bank_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."bank_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_requests" ADD CONSTRAINT "bank_requests_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_requests" ADD CONSTRAINT "bank_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_requests" ADD CONSTRAINT "bank_requests_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_request_notices_pending_idx" ON "bank_request_notices" USING btree ("id") WHERE "bank_request_notices"."claimed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "bank_request_notices_request_idx" ON "bank_request_notices" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "bank_requests_group_status_idx" ON "bank_requests" USING btree ("group_id","status");