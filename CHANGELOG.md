# @kernhq/module-mail

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
