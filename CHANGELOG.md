# @kernhq/module-mail

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
