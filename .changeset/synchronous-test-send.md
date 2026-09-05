---
'@kernhq/module-mail': minor
---

Send the test message inside the handler and answer what actually happened.

"Send test" on Settings → Email enqueued a job and reported success, so an administrator saw a
green toast for credentials that could not connect, for a recipient on the blocked list, and for an
instance with no provider configured at all. The one control whose job is to prove that mail works
proved nothing.

The provider is now built and used before the handler answers, and the answer is the delivery's own
outcome: `ok` only when the provider accepted the message, `error` in the provider's own words, and
a new optional `status` (`refused`, `suppressed`, `timeout`) so the screen can say something a
person can act on. The screen also refreshes the delivery log after every test, whatever the answer.

Two things the delivery log was getting wrong are fixed with it: building the provider now happens
inside `processSend`'s try, so a wrong host or a missing key leaves the row `failed` with the reason
rather than `queued` for ever; and the test message renders with the provider's name in it, which
was blank.
