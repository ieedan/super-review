# @super-review/desktop

## 0.0.3

### Patch Changes

- Fix the desktop release pipeline and upgrade the toolchain to Node 24. ([#10](https://github.com/ieedan/super-review/pull/10))
  - Pin `electronVersion` so electron-builder no longer fails to detect the Electron version under pnpm.
  - Use pnpm's `onlyBuiltDependencies` so Electron/esbuild native binaries actually download in CI.
  - Only pass `CSC_LINK`/`CSC_KEY_PASSWORD` when a signing certificate is present, fixing the macOS "not a file" packaging crash on unsigned builds.
  - Bump the project to Node 24 (engines, CI/release workflows, `@types/node`).

## 0.0.2

### Patch Changes

- Switch releases to a changesets-driven autorelease workflow. Versioning and the ([#8](https://github.com/ieedan/super-review/pull/8))
  changelog are now produced from `.changeset/*` files, and merging the generated
  "Version Packages" PR builds and publishes the GitHub Release automatically.
