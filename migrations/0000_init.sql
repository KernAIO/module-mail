-- Every statement here is idempotent, and that is not decoration. A module's migrations are the
-- first thing the kernel runs, so one that throws on replay does not break its own module — it
-- stops the `mail` service binding its port, and with it every sign-in link the platform sends.
-- Drizzle keys applied migrations by content hash, so editing any file in this folder replays the
-- whole folder against schemas that already have these objects. `src/server/migrations.test.ts`
-- applies the folder twice to a database created from nothing and is what proves this.
CREATE SCHEMA IF NOT EXISTS "mod_mail";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mod_mail"."deliveries" (
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
CREATE TABLE IF NOT EXISTS "mod_mail"."inbound_routes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"token" text NOT NULL,
	"target" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_routes_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mod_mail"."suppressions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid,
	"email" text NOT NULL,
	"reason" text NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deliveries_ws_idx" ON "mod_mail"."deliveries" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deliveries_pmid_idx" ON "mod_mail"."deliveries" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_routes_ws_idx" ON "mod_mail"."inbound_routes" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "suppressions_email_idx" ON "mod_mail"."suppressions" USING btree ("email","workspace_id");
