-- Row-level security for every tenant table in mod_mail. There was none: `deliveries`,
-- `suppressions` and `inbound_routes` all carry `workspace_id` and every query filtered by hand.
-- A hand-written `where` is one forgotten clause from a workspace reading another's delivery log —
-- the addresses it writes to, the subjects it sends — and nothing in the database stood behind it.
--
-- The policy is the chat module's shape rather than the kernel's `rlsPolicySql`, because this
-- module has legitimately instance-wide work: the send job, the provider webhooks and the
-- suppression check all run outside any one workspace, and an instance-level message has no
-- workspace at all (`workspace_id is null`). Those paths bind `app.workspace_id = '*'`, which the
-- policy admits. Binding nothing admits nothing — a query that forgets to bind is refused rather
-- than let through, which is the failure mode you want.
--
-- Every statement is idempotent: `create policy` has no `if not exists`, so each is preceded by a
-- drop. A module migration that throws on replay takes down the whole `mail` service.

alter table "mod_mail"."deliveries" enable row level security;--> statement-breakpoint
alter table "mod_mail"."deliveries" force row level security;--> statement-breakpoint
drop policy if exists "deliveries_ws_isolation" on "mod_mail"."deliveries";--> statement-breakpoint
create policy "deliveries_ws_isolation" on "mod_mail"."deliveries"
  using (current_setting('app.workspace_id', true) = '*' or workspace_id::text = current_setting('app.workspace_id', true))
  with check (current_setting('app.workspace_id', true) = '*' or workspace_id::text = current_setting('app.workspace_id', true));--> statement-breakpoint

alter table "mod_mail"."suppressions" enable row level security;--> statement-breakpoint
alter table "mod_mail"."suppressions" force row level security;--> statement-breakpoint
drop policy if exists "suppressions_ws_isolation" on "mod_mail"."suppressions";--> statement-breakpoint
create policy "suppressions_ws_isolation" on "mod_mail"."suppressions"
  using (current_setting('app.workspace_id', true) = '*' or workspace_id::text = current_setting('app.workspace_id', true))
  with check (current_setting('app.workspace_id', true) = '*' or workspace_id::text = current_setting('app.workspace_id', true));--> statement-breakpoint

alter table "mod_mail"."inbound_routes" enable row level security;--> statement-breakpoint
alter table "mod_mail"."inbound_routes" force row level security;--> statement-breakpoint
drop policy if exists "inbound_routes_ws_isolation" on "mod_mail"."inbound_routes";--> statement-breakpoint
create policy "inbound_routes_ws_isolation" on "mod_mail"."inbound_routes"
  using (current_setting('app.workspace_id', true) = '*' or workspace_id::text = current_setting('app.workspace_id', true))
  with check (current_setting('app.workspace_id', true) = '*' or workspace_id::text = current_setting('app.workspace_id', true));
