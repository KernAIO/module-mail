---
'@kernhq/module-mail': minor
---

Send a message that carries only plain text in the shared paper layout.

Five branded MJML templates shipped in this package and nothing rendered them: every email the
platform sends is built by its caller, and a caller that names no template got whatever HTML it
brought — or, for core's notification digest, no HTML at all. The digest is the email most people
here actually open and it arrived as bare text.

`buildMessage` now wraps text with no HTML beside it in `templates/_layout.mjml`, escaping and
linking each paragraph, so it looks like the rest of the platform without the caller knowing a
template name. A caller's own HTML is left exactly as it arrived, and the text part is untouched.

`src/server/templates.test.ts` compiles every shipped template against one sample and asserts the
branding, which nothing did before.
