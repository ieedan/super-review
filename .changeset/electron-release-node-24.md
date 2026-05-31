---
"@super-review/desktop": patch
---

Fix the desktop release pipeline and upgrade the toolchain to Node 24.

- Pin `electronVersion` so electron-builder no longer fails to detect the Electron version under pnpm.
- Use pnpm's `onlyBuiltDependencies` so Electron/esbuild native binaries actually download in CI.
- Only pass `CSC_LINK`/`CSC_KEY_PASSWORD` when a signing certificate is present, fixing the macOS "not a file" packaging crash on unsigned builds.
- Bump the project to Node 24 (engines, CI/release workflows, `@types/node`).
