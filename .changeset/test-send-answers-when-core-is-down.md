---
'@kernhq/module-mail': patch
---

Answer "Send test" with the failure when core cannot be reached, rather than a 500.

Reading the workspace's provider config is a call to core, and it sat outside the handler's `try`.
Core is a different service, so a restart, a rolling deploy or a dropped connection made the whole
procedure throw. Measured against a stub whose `core.settings.getIntegration` fails, the endpoint
answered `500 {"code":"INTERNAL_SERVER_ERROR","message":"Internal server error"}` and the screen
showed that as the toast. It answers `200 {"ok":false,"error":"…","status":"refused"}` now — the
same shape as every other way this control can fail, which matters more here than usual, because the
control's entire job is to tell an administrator the truth about whether mail works.

Two things that changed quietly when the test send became synchronous are written down rather than
reverted. `sendAndWait` enqueues no job, so the `send` job's retries and backoff do not apply to a
test send and a restart between the delivery row being written and the provider answering leaves
that row `queued` with nothing to sweep it; the reason to accept that, and the reason not to add a
sweeper, are in its comment. And `mail.delivery.failed` now says on the event definition that it
fires per *attempt*, not per message — an instance with no provider configured emits one for each of
the job's six tries, so a subscriber counting them is counting attempts.

`test-send.test.ts` covers both new cases: core unreachable, and an instance with no provider
configured at all.
