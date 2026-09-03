---
'@kernhq/module-mail': minor
---

Row-level security on every table in `mod_mail`. There was none: the delivery log, the suppression
list and the inbound-route placeholder all carried `workspace_id` and every query filtered by hand,
so one forgotten `where` would have shown a workspace another's delivery log — the addresses it
writes to and the subjects it sends.

The policy admits a row for its own workspace or for the `'*'` binding, which the send job, the
provider webhooks and the suppression check now use for their legitimately instance-wide work
(`ALL_WORKSPACES` is exported from `./server`). A transaction that binds nothing sees nothing.
`deliveries.list` is bound to the workspace it is asked about. Two tests guard it: the migration
folder applied twice to a database created from nothing, and a cross-tenant probe under a role that
cannot bypass the policy.
