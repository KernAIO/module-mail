---
'@kernhq/module-mail': patch
---

Reach the published `@kernhq/ui`, and refresh the lockfile the range edit invalidates.

`^0.10.0` cannot install 0.12.5 — a caret on 0.x never crosses a minor — so a host resolving this
module from the registry is told it needs a framework two minors behind the one every service runs.
The lockfile moves in the same commit because `--frozen-lockfile` compares specifiers, so a range
edit on its own fails install having built nothing.
