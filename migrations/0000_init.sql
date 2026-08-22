CREATE SCHEMA IF NOT EXISTS "mod_mail";
--> statement-breakpoint
CREATE TABLE "mod_mail"."deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid,
	"to" text[] NOT NULL,
	"subject" text NOT NULL,
	"provider" text NOT NULL,
	"template" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_mail"."inbound_routes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"token" text NOT NULL,
	"target" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_routes_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "mod_mail"."suppressions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid,
	"email" text NOT NULL,
	"reason" text NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "deliveries_ws_idx" ON "mod_mail"."deliveries" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "deliveries_pmid_idx" ON "mod_mail"."deliveries" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "inbound_routes_ws_idx" ON "mod_mail"."inbound_routes" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "suppressions_email_idx" ON "mod_mail"."suppressions" USING btree ("email","workspace_id");