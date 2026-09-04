---
'@kernhq/module-mail': patch
---

Published again with no code change. npm's CDN kept serving the abbreviated package document from
before 0.5.1 existed for more than twelve hours, so `pnpm install` in every host that reached
`^0.5.1` failed with "no matching version" and the nightly release could not advance the services.
A new publish is what refreshes that document.
