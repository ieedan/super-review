# Plan: Extract the CLI into a standalone package

## Goal

Today the `super-review` CLI is built as a second Rollup entry of the Electron
app (`apps/desktop/src/cli/index.ts` → `apps/desktop/out/main/cli.js`). That
means you must build the entire desktop app to get the CLI, you can't `npm i -g`
or `npx` it, and the document-session skill has to fall back to invoking a
hand-built path (`node .../out/main/cli.js`).

Extract the session-authoring logic into a shared **`packages/core`** and make
the CLI its own publishable **`packages/cli`**. The Electron app consumes the
same core for its read paths. End state: the CLI is independent of Electron and
distributable on npm, with a single source of truth for the session/JSON format.

This is a **mechanical, behavior-preserving refactor**. Do not change the CLI's
commands, flags, output, or the on-disk session format. The session JSON still
lives in `.super-review/sessions/<id>.json` in the target repo.

## Key facts about the current code (verified — trust these)

- The desktop app **never writes** sessions. `apps/desktop/src/main/ipc.ts` only
  *reads*: `getSession`, `listSessions`, `clearSessions`, `getDiff`,
  `listChangedFiles`. `captureSession`/`writeSession` are called **only** by the
  CLI. So the "produce a session" path is genuinely CLI-only.
- The session layer is **already Electron-free**:
  - `apps/desktop/src/main/session-capture.ts` imports only `simple-git`,
    `./git-service.js` (4 functions), and `@shared/types`.
  - `apps/desktop/src/main/session-store.ts` imports only node `fs`/`path` and
    `@shared/types`.
- `apps/desktop/src/main/git-service.ts` (≈1997 lines) is the only seam. It is
  used heavily by `ipc.ts` (commit/push/pull/conflicts/repo-create/icons) but
  the CLI path needs just **four** exports: `repoIdFromPath`,
  `getCurrentBranch`, `listChangedFiles`, `getDiff`.
- git-service is **already designed to be plain-node-importable**: its only
  Electron touch is a single lazy `await import('electron')` inside the
  `discardChanges` function (for `shell.trashItem`), an app-only "discard
  changes" operation the CLI never calls. Everything else is `simple-git` +
  node builtins. Its non-node imports are `@shared/types`, `@shared/media`, and
  `./repo-templates.js` (a pure string-template module with no imports).
- Import-site counts in `apps/desktop/src` (the churn surface):
  - `@shared/types`: 30 files
  - `@shared/media`: 2 files
  - `git-service`: only `ipc.ts` (besides `session-capture.ts`)
  - Other `@shared/*` modules — `diff-context`, `diff-defer`, `diff-staging`,
    `hotkeys` — are UI-only and **stay in the desktop app**.

## Target structure

```
packages/
  core/                         # @super-review/core — pure-node session + git layer
    package.json
    tsconfig.json
    src/
      index.ts                  # barrel: re-exports the public API
      types.ts                  # moved from apps/desktop/src/shared/types.ts
      media.ts                  # moved from apps/desktop/src/shared/media.ts
      git-service.ts            # moved from apps/desktop/src/main/git-service.ts
      repo-templates.ts         # moved from apps/desktop/src/main/repo-templates.ts
      session-capture.ts        # moved from apps/desktop/src/main/session-capture.ts
      session-store.ts          # moved from apps/desktop/src/main/session-store.ts
  cli/                          # @super-review/cli — thin argparse wrapper, publishable
    package.json                # bin: { "super-review": "dist/index.js" }
    tsconfig.json
    src/
      index.ts                  # moved from apps/desktop/src/cli/index.ts
apps/desktop/                   # unchanged except: imports core, drops cli entry/bin
```

`pnpm-workspace.yaml` already globs `packages/*`, so no workspace change is
needed.

## The Electron seam (decide once, up front)

`git-service.ts` must move to core, but its `discardChanges` function lazily
imports `electron` for `shell.trashItem`. To keep core 100% Electron-free,
**replace the lazy import with dependency injection**:

- Change `discardChanges(repoPath, filePath, oldPath?)` to accept an extra
  optional parameter `trash?: (absPath: string) => Promise<void>`.
- In core, when the file isn't in HEAD: if `trash` is provided, call
  `await trash(absPath)`; otherwise fall back to `fs.rm(absPath, { force: true })`.
- In `apps/desktop/src/main/ipc.ts`, pass
  `(p) => import('electron').then(({ shell }) => shell.trashItem(p))` as `trash`
  at the one call site, preserving today's move-to-OS-trash behavior.

This removes the only `electron` reference from core entirely — the CLI bundle
then never references electron, and no build needs to externalize it.

(Alternative if injection is awkward: leave `discardChanges` in the desktop app
instead of core, exporting its private helper `pathExistsInHead` from core.
Injection is preferred — it keeps all git logic in one place.)

## Migration steps

### 1. Create `packages/core`

1. Make the directory tree and move these files (use `git mv` to preserve
   history):
   - `apps/desktop/src/shared/types.ts` → `packages/core/src/types.ts`
   - `apps/desktop/src/shared/media.ts` → `packages/core/src/media.ts`
   - `apps/desktop/src/main/git-service.ts` → `packages/core/src/git-service.ts`
   - `apps/desktop/src/main/repo-templates.ts` → `packages/core/src/repo-templates.ts`
   - `apps/desktop/src/main/session-capture.ts` → `packages/core/src/session-capture.ts`
   - `apps/desktop/src/main/session-store.ts` → `packages/core/src/session-store.ts`
2. Fix the moved files' internal imports: `@shared/types` → `./types.js`,
   `@shared/media` → `./media.js`, `./git-service.js` / `./repo-templates.js`
   stay relative (now siblings in `core/src`).
3. Apply the `discardChanges` injection change (see seam section above).
4. Write `packages/core/src/index.ts` as a barrel re-exporting the public API —
   at minimum everything `ipc.ts` and the CLI consume:
   - all types from `./types.js`
   - `imageMimeForPath` from `./media.js`
   - the full git-service surface used by `ipc.ts` (re-export `*` from
     `./git-service.js` is fine)
   - `captureSession`, `SessionMeta`, `TourStepInput` from `./session-capture.js`
   - `clearSessions`, `findSessionByKey`, `getSession`, `listSessions`,
     `writeSession` from `./session-store.js`
5. `packages/core/package.json`:
   ```json
   {
     "name": "@super-review/core",
     "version": "0.0.0",
     "type": "module",
     "private": true,
     "exports": { ".": "./src/index.ts" },
     "dependencies": { "simple-git": "^3.27.0" }
   }
   ```
   Consume core as source (`./src/index.ts`) so there's no separate build step
   to wire into the Electron pipeline — `electron-vite` bundles it like any
   workspace TS source. (If a build is preferred later, add `tsup` and point
   `exports` at `dist`.)
6. `packages/core/tsconfig.json`: mirror the strict settings from
   `apps/desktop/tsconfig.node.json` (`target ES2022`, `module ESNext`,
   `moduleResolution Bundler`, `strict`, `isolatedModules`, etc.). `types`:
   `["node"]` only — **not** `electron-vite/node`. Include `src/**/*.ts`.

### 2. Repoint the desktop app at core (minimize churn with re-export shims)

The 30 `@shared/types` and 2 `@shared/media` import sites should **not** be
hand-edited. Instead leave the `@shared` alias in place and replace the two
moved shared files with thin re-export shims:

- `apps/desktop/src/shared/types.ts` → `export * from '@super-review/core';`
- `apps/desktop/src/shared/media.ts` →
  `export { imageMimeForPath } from '@super-review/core';`

(The other `@shared/*` files stay as real modules.) This keeps all existing
`@shared/...` imports resolving while making core the single source of truth.

Then fix the modules whose real files moved out of `src/main`:

- `apps/desktop/src/main/ipc.ts`: change its `git-service`, `session-capture`,
  and `session-store` imports to `@super-review/core`, and update the
  `discardChanges` call site to pass the `trash` callback (seam section).
- Delete the now-empty originals already handled by `git mv`. Confirm nothing
  else in `src/main` imported `git-service`/`repo-templates`/`session-*`
  (verified: only `ipc.ts` and the moved `session-capture.ts`).
- Add `"@super-review/core": "workspace:*"` to
  `apps/desktop/package.json` dependencies.

### 3. Create `packages/cli`

1. `git mv apps/desktop/src/cli/index.ts packages/cli/src/index.ts`.
2. Rewrite its imports: drop the `../main/...` and `@shared/...` paths and
   import everything from `@super-review/core`
   (`captureSession`, `SessionMeta`, `TourStepInput`, the four store functions,
   `HarnessKind`). No logic changes.
3. `packages/cli/package.json`:
   ```json
   {
     "name": "@super-review/cli",
     "version": "0.0.0",
     "type": "module",
     "bin": { "super-review": "dist/index.js" },
     "files": ["dist"],
     "scripts": {
       "build": "tsup src/index.ts --format esm --target node20 --clean",
       "dev": "node dist/index.js"
     },
     "dependencies": {
       "@super-review/core": "workspace:*",
       "simple-git": "^3.27.0"
     },
     "devDependencies": { "tsup": "^8", "typescript": "^5.7.3" }
   }
   ```
   Keep the `#!/usr/bin/env node` shebang on `src/index.ts`. If publishing to
   npm publicly, set `"private": false`, add `repository`/`license`/`description`,
   and have the build bundle core in (tsup bundles workspace deps by default for
   esm when they're listed as deps — confirm `dist/index.js` runs standalone via
   `node packages/cli/dist/index.js session --help`).
4. `packages/cli/tsconfig.json`: same strict base as core, `types: ["node"]`.

### 4. Update the Electron build config

In `apps/desktop/electron.vite.config.ts`:

- Remove the `cli` entry from `main.build.rollupOptions.input` (leave only
  `index`). Drop the comment about `cli`.
- The `@shared` alias stays (the shim files still live under `src/shared`).

In `apps/desktop/package.json`:

- Remove the `"bin": { "super-review": "out/main/cli.js" }` block — the CLI is
  no longer produced by the desktop build.

In `apps/desktop/tsconfig.node.json`:

- Remove `"src/cli/**/*.ts"` from `include` (the dir is gone).

### 5. Wire up root scripts

In the root `package.json`, add:

- `"build:cli": "pnpm --filter @super-review/cli build"`
- include core/cli in `typecheck` (already `pnpm -r typecheck`, so just ensure
  each package has a `typecheck` script: `"typecheck": "tsc --noEmit"`).

### 6. Update docs to the new invocation

- **`AGENTS.md`** (repo root): the command block currently shows
  `super-review session save ...`. Keep that as the published-CLI form, but make
  the link target current: it points at
  `.agent/skills/document-session/SKILL.md`. No path change needed if the skill
  stays there; just ensure the fallback wording matches step below.
- **`.agent/skills/document-session/SKILL.md`**: update the "If the `super-review`
  command isn't on `PATH`" fallback. Replace
  `node /path/to/super-review/apps/desktop/out/main/cli.js session save ...`
  with the package path: `node /path/to/super-review/packages/cli/dist/index.js
  session save ...`, and mention `pnpm --filter @super-review/cli build` produces
  it (and that `npx super-review` works once published).
- **`README.md`** (lines ~103–107): replace the
  `apps/desktop/out/main/cli.js` reference with `packages/cli` / the published
  command.

## Verification

Run from the repo root after the move:

1. `pnpm install` — resolves the new workspace packages.
2. `pnpm --filter @super-review/cli build` — CLI builds to `dist/`.
3. `node packages/cli/dist/index.js session --help` — usage prints; exits 0.
4. In a scratch git repo with an uncommitted change:
   `node packages/cli/dist/index.js session save --key test --name n --description d`
   → writes `.super-review/sessions/<id>.json`; re-running with the same `--key`
   **updates** (doesn't duplicate); `... session clear` removes them. Confirm the
   JSON shape is byte-for-byte what the old CLI produced.
5. `pnpm -r typecheck` — core, cli, and desktop all pass.
6. `pnpm --filter @super-review/desktop build` — Electron app builds with **no**
   `cli` entry and resolves `@super-review/core`.
7. Smoke-test the desktop app: open a repo, view a session's diffs (exercises
   `getDiff`/`listChangedFiles` from core), and discard a file (exercises the
   injected `trash` callback → still goes to OS trash, not hard-deleted).
8. Grep guard: `grep -rn "out/main/cli.js" .` returns nothing outside this plan;
   `grep -rn "import('electron')\|from 'electron'" packages/core` returns nothing.

## Risks & notes

- **`@shared/types` churn** is sidestepped by the re-export shim. If a fully
  clean tree is wanted later, do a follow-up commit rewriting `@shared/types` →
  `@super-review/core` across the 30 sites and deleting the shim — but keep it
  out of this PR to keep the diff reviewable.
- **git-service in "core" is broad.** Moving all 1997 lines (commit/push/pull/
  conflicts/repo-create/icon-detection) into a package called *core* is
  pragmatic but not minimal. Do it whole here (lower risk, as the user
  requested); a later refactor can split `git-read` (the 4 CLI functions) from
  `git-app` (the rest) if core's surface feels too large. Note: icon detection
  reads `electron-builder.*` filenames as **string constants only** — that is
  not an Electron dependency.
- **Publishing** is out of scope for this PR unless asked. Leave packages
  `private` and just prove `node packages/cli/dist/index.js` works standalone.
  Flipping to a public npm publish is a separate, small follow-up (`private:
  false` + `npm publish --access public`, or a changeset).
- **Behavior parity is the bar.** No flag, command, output string, or session
  JSON field may change. The diff should read as "files moved + imports
  repointed + one DI seam," nothing more.
