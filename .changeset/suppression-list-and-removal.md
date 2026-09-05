---
'@kernhq/module-mail': minor
---

See the blocked addresses, and take one off the list.

An address that bounced once was blocked from every Kern email for ever. A full mailbox, a
corporate relay answering 550 during a misconfiguration, or one press of "report spam" on a digest
stopped that person receiving password resets, sign-in links and invitations — and nothing in the
product could read the list or change it. The administrator saw "failed — all recipients
suppressed" and had no way to act; only SQL released the address.

`suppressions.list` and `suppressions.remove` are new on the mail contract, behind
`mail.settings.manage`, and Settings → Email now has a **Blocked addresses** section with a search
box and a Remove action per row. A workspace sees its own rows and the instance-wide ones — the
instance-wide rows are the account mail, so leaving them out would have left the worst case
unreachable — and a row that belongs to the whole instance is marked as such on screen and in the
confirmation. Every removal is written to the log and to the workspace's activity feed.
