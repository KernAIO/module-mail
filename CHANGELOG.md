# @kernhq/module-mail

## 0.6.2

### Patch Changes

- 7863592: Peer `@kernhq/contracts@^0.8.0`, which adds `archivedAt` to `WorkspaceSummary`. A caret on 0.x does
  not cross a minor, so the previous `^0.7.0` could not reach it.

## 0.6.1

### Patch Changes

- fdaa1ae: Peer `@kernhq/kernel` at `^0.10.0`.

  A caret on 0.x does not cross a minor, so `^0.9.1` stopped reaching the framework the moment 0.10.0
  was published — `check-ranges.mjs` fails on it, and CI stops at the lint step before a single test
  runs. The module builds and tests against 0.10.0 unchanged.

## 0.6.0

### Minor Changes

- f3ec9bc: Send a message that carries only plain text in the shared paper layout.

  Five branded MJML templates shipped in this package and nothing rendered them: every email the
  platform sends is built by its caller, and a caller that names no template got whatever HTML it
  brought — or, for core's notification digest, no HTML at all. The digest is the email most people
  here actually open and it arrived as bare text.

  `buildMessage` now wraps text with no HTML beside it in `templates/_layout.mjml`, escaping and
  linking each paragraph, so it looks like the rest of the platform without the caller knowing a
  template name. A caller's own HTML is left exactly as it arrived, and the text part is untouched.

  `src/server/templates.test.ts` compiles every shipped template against one sample and asserts the
  branding, which nothing did before.

- 94c38d1: See the blocked addresses, and take one off the list.

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

- d3411cd: Send the test message inside the handler and answer what actually happened.

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

## 0.5.2

### Patch Changes

- ac8a952: Published again with no code change. npm's CDN kept serving the abbreviated package document from
  before 0.5.1 existed for more than twelve hours, so `pnpm install` in every host that reached
  `^0.5.1` failed with "no matching version" and the nightly release could not advance the services.
  A new publish is what refreshes that document.

## 0.5.1

### Patch Changes

- chore(deps): take @kernhq/testing ^0.1.12, which has permissionMatrixDiff

## 0.5.0

### Minor Changes

- 00be15c: Row-level security on every table in `mod_mail`. There was none: the delivery log, the suppression
  list and the inbound-route placeholder all carried `workspace_id` and every query filtered by hand,
  so one forgotten `where` would have shown a workspace another's delivery log — the addresses it
  writes to and the subjects it sends.

  The policy admits a row for its own workspace or for the `'*'` binding, which the send job, the
  provider webhooks and the suppression check now use for their legitimately instance-wide work
  (`ALL_WORKSPACES` is exported from `./server`). A transaction that binds nothing sees nothing.
  `deliveries.list` is bound to the workspace it is asked about. Two tests guard it: the migration
  folder applied twice to a database created from nothing, and a cross-tenant probe under a role that
  cannot bypass the policy.

## 0.4.7

### Patch Changes

- 5208dd4: Accept `@kernhq/ui` 0.14, so the module is no longer held back from a platform release whose shell already runs it.

## 0.4.6

### Patch Changes

- 5befb0f: Peer @kernhq/kernel ^0.9.1 — the framework published; the module's range follows so one install resolves a single consistent kernel.

## 0.4.5

### Patch Changes

- 1d13893: Reach the published `@kernhq/ui`, and refresh the lockfile the range edit invalidates.

  `^0.10.0` cannot install 0.12.5 — a caret on 0.x never crosses a minor — so a host resolving this
  module from the registry is told it needs a framework two minors behind the one every service runs.
  The lockfile moves in the same commit because `--frozen-lockfile` compares specifiers, so a range
  edit on its own fails install having built nothing.

## 0.4.4

### Patch Changes

- f8a1048: Declare the framework this is built against: `@kernhq/contracts@0.7.0`.

  `^0.6.1` cannot install 0.7.0 — a caret on 0.x never crosses a minor — so a host resolving this
  module from the registry would be told it needs a contracts two releases behind the one every
  service now runs. Typechecked against 0.7.0 in the workspace before the range moved, which is the
  only order that means anything: the umbrella pins contracts to `workspace:*`, so raising a range
  first and compiling second compiles against the old copy and proves nothing.

  The lockfile is refreshed in the same change, because `--frozen-lockfile` compares specifiers and
  a range edit alone fails install before anything is built.

## 0.4.3

### Patch Changes

- 9388cb6: fix: raise @kernhq ranges to what is published

  A caret on 0.x never crosses a minor, so `@kernhq/ui: ^0.8.0` and `@kernhq/contracts: ^0.5.1` could not install the published 0.9.0 and 0.6.1. Raised both to `^0.9.0` and `^0.6.1`.

- bbc0764: Reach the published framework, and refresh the lockfile that the range edit invalidated.

  `^0.9.0` cannot install `@kernhq/ui@0.10.0` — a caret on 0.x never crosses a minor — so a consumer
  installing this module from the registry resolved a framework it was not built against. Raising the
  range then leaves the committed `pnpm-lock.yaml` out of date with the manifest, and
  `--frozen-lockfile` compares specifiers, so the next publish dies at install having built nothing.
  Both halves are here because one without the other is not a fix.

  `scripts/check-ranges.mjs` now checks the lockfile as well, so the second half cannot be forgotten
  again — and checks this package's hosts against its peers, which `pnpm install` does not: pnpm 10
  resolved a `^0.6.1` peer against `contracts@0.5.2` and exited 0 without a warning.

## 0.4.2

### Patch Changes

- fix: declare @kernhq/kernel and @kernhq/contracts as peerDependencies

## 0.4.1

### Patch Changes

- fix: nodemailer belongs to the module, not the service

## 0.4.0

### Minor Changes

- Merge remote-tracking branch 'origin/main'

## 0.3.2

### Patch Changes

- chore: refresh the lockfile for the changesets dependency

## 0.3.1

### Patch Changes

- fix(deps): reach the framework that was just published

## 0.3.0

### Minor Changes

- 0f779a7: Mail ships its own screens.

  The settings page, both dashboard cards, the module's strings in all five locales, its permissions
  and its API instance now live in this package instead of in the app. The shell mounts whatever the
  manifest declares, so deleting this package now removes the feature completely — which is what makes
  it a module rather than a server half plus a hand-written page somebody has to keep in step.

  Two things changed shape while moving:

  - **Permissions are derived from the contract, not re-typed.** The app kept its own copy of
    `mail.settings.manage`, which type-checks perfectly while being wrong: a mistyped key silently
    hides a control or offers one the server refuses, and nothing reports it.
  - **The settings page takes `workspaceId` as a prop** rather than reading `$app/state`. A module
    package is type-checked on its own, and the router alias does not resolve there — it only appeared
    to work because the app compiled it.

  `typecheck` now runs `svelte-check` over `src/client`. Without it this package's own CI checked the
  server half and nothing else, which is most of the package now.

## 0.2.2

### Patch Changes

- 5137cc7: Report the version of the package the module ships in.

  The version in `defineModule` was a string literal, and nothing bumped it when changesets released
  the package: chat shipped as 0.2.0 and told every admin it was 0.1.0, and that literal is what the
  modules screen renders and what `workspace_modules.installed_version` records. It now comes from
  `packageVersion(import.meta.url)`, and `pnpm check:versions` fails the build if the two ever
  disagree again.

## 0.2.1

### Patch Changes

- 666c23a: Fix a block comment in `src/client/index.ts` that a glob closed early, leaving the rest of the
  sentence as code. `./client` exports TypeScript source rather than built JavaScript, so the file is
  compiled by whatever imports it — an unparseable comment shipped in 0.2.0 breaks the consumer's
  build, not this package's.

## 0.2.0

### Minor Changes

- efdb31c: Mail now ships `createMailClient`, the typed oRPC client for `/api/mail`, the way the tracker and
  chat modules do. Without it nothing could call the module: its settings and delivery log had a
  server and no way to reach it.

  Removes the client module and settings component that lived here. The app composes its own client
  modules and owns its screens, so neither was ever registered or rendered — a `defineClientModule`
  in a module package is dead code by the app's architecture.

## 0.1.2

### Patch Changes

- 90f5fbc: Ship the sources the published client imports, and stop advertising a client that does not exist.

  0.1.1 fixed the unresolvable client by having it import its own package's entry points. That works
  for a consumer but not for the module repository itself, where the packages are type-checked before
  they are built — the entry points resolve to `dist`, which does not exist yet. The client goes back
  to relative imports and the tarball now carries `src/contract` (and `src/kql` for the tracker),
  which is what those imports point at.

  `@kernhq/module-chat` declared a `./client` export pointing at a file that was never written, so
  importing it always failed. The export is gone until the chat client lands.

  `pnpm check:pack` packs each module for real and walks every import from the published client entry,
  so neither can come back unnoticed.

## 0.1.1

### Patch Changes

- b6e9f16: Make the published client source resolvable.

  A module ships `src/client` as source so consumers build the Svelte components with their own
  toolchain, but that source imported `../contract/…` and `../kql/…` — paths under `src/` that the
  tarball does not contain. It worked in the development workspace, where the whole repository is
  linked, and failed in any real install with `Could not resolve '../kql/ast.js'`. The client now
  refers to its own package's entry points, the way any other consumer would, and those entries carry
  a `default` condition so resolvers that do not ask for `import` can find them too.
