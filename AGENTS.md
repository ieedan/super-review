# AGENTS.md

> `CLAUDE.md` is a symlink to this file. Edit `AGENTS.md`.

Super Review is a desktop app for reviewing agent-written code locally as a
guided tour. This file orients you in the codebase and records the conventions
to follow.

## Project layout

pnpm monorepo (`pnpm@11.7.0`, Node >= 24). Workspaces are `apps/*` and
`packages/*`.

```
apps/
  desktop/   Electron app (the product) — electron-vite, Svelte 5 renderer
  docs/      SvelteKit marketing/download site (embeds the real UI components)
packages/
  core/      Node-only session + git layer; shared by the CLI and the desktop main process
  ui/        @super-review/ui — Svelte renderer components, stores, diff/find logic
  cli/       super-review — published npm CLI for authoring sessions & review comments
```

### apps/desktop — `@super-review/desktop`

Electron + electron-vite, with the standard three-config split:

- `src/main/` — Electron main process (Node). Entry `index.ts`; IPC handlers in
  `ipc.ts`; native menus in `menu.ts`; services: `git-service.ts`,
  `github-service.ts` (Octokit + device-flow auth), `editor-service.ts`,
  `npm-service.ts`, `skill-service.ts`, `signing-service.ts`; config in
  `store.ts` (electron-store with a write-through cache); `updater.ts`.
- `src/preload/index.ts` — type-safe `contextBridge` exposing main → renderer.
- `src/renderer/src/` — Svelte app. Entry `main.ts` mounts `App.svelte`;
  global styles in `app.css`. Consumes `@super-review/ui` and
  `@super-review/core`.
- `src/shared/` — types/helpers shared between main, preload, and renderer
  (`@shared/...`).

### apps/docs — `@super-review/docs`

SvelteKit 2 site (Vercel adapter) for the landing/download page and waitlist
(Upstash Redis). Imports the **real** `@super-review/ui` components.

### packages/core — `@super-review/core`

Pure-Node session authoring and git operations. **No browser/UI deps.**
Key modules: `types.ts` (the IPC/renderer contract — branch/commit/diff/account
types), `git-service.ts` (simple-git wrapper), `session-store.ts` /
`session-capture.ts`, `comment-schema.ts` / `comment-store.ts`,
`changesets.ts`, `hotkeys.ts`, `media.ts`. Browser-safe pieces are re-exported
via subpaths (`./types`, `./media`, `./hotkeys`, `./diff-context`, etc.) so the
renderer can import them without pulling in Node code.

### packages/ui — `@super-review/ui`

The renderer component library and most renderer state.

- `src/components/ui/` — shadcn-svelte primitives (dialog, dropdown-menu,
  popover, tabs, sidebar, ...).
- `src/components/` — app components: diff rendering (`DiffView.svelte`,
  `DiffFileSection.svelte`), comments, sessions/tours, file list, git UI
  (branch/commit pickers, `CommitBox.svelte`), `TopBar`, `FindBar`,
  `CommandPalette`.
- Renderer state/logic (`src/*.svelte.ts`, `src/*.ts`): `store.svelte.ts`
  (central app state), `diff-find.svelte.ts` (find-in-diff + DOM highlighting),
  `diff-worker-pool.ts`, `render-scheduler.ts` (throttles `@pierre/diffs`
  renders via IntersectionObserver + rAF), `carta.ts`/`markdown.ts`.

Stack: Svelte 5 (runes + `runed`), Tailwind 4, shadcn-svelte, `@pierre/diffs`
(diff rendering, Shadow DOM), `carta-md` (markdown), `paneforge` (resizable
panes), `svelte-tiny-virtual-list` (virtual scrolling), `bits-ui`/`@lucide`.

### packages/cli — `super-review`

The published npm CLI (`bin` → `super-review`). Authors sessions and manages
review comments; depends on `@super-review/core`, not `ui`.
Commands: `session save`, `session clear`, `comment list|reply|resolve`.
Source: `src/cli.ts` (commander program), `src/commands/session/*`,
`src/commands/comment/*`.

## Commands (run from repo root)

| Task                         | Command            |
| ---------------------------- | ------------------ |
| Run desktop + docs in dev    | `pnpm dev`         |
| Desktop only                 | `pnpm dev:desktop` |
| Docs only                    | `pnpm dev:docs`    |
| Build the desktop app        | `pnpm build`       |
| Build the CLI for publishing | `pnpm build:cli`   |
| Typecheck all packages       | `pnpm typecheck`   |
| Test all packages            | `pnpm test`        |
| Lint (prettier + eslint)     | `pnpm lint`        |
| Format                       | `pnpm format`      |

Tests use **vitest**. Browser tests live in `*.browser.test.ts` and run against
real Chromium via `@vitest/browser` (Playwright); other `*.test.ts` run in Node.

## Conventions

### No em-dashes in prose

Avoid em-dashes in comments, UI strings, docs, and session tours you write. (The
existing codebase style is exempt unless you're asked to change it.)

### Document your work after every checkpoint

After every checkpoint you reach in a coding task (a feature done, a bug fixed,
a logical unit of work completed), create a super-review session locally so a
human can review your changes as a guided tour.

Run (use the same `--key` for the whole conversation so re-runs update the same
session instead of creating duplicates):

```bash
pnpx super-review session save --key "<your conversation/run id>" --tour '<tour json>'
```

For the tour JSON shape, callouts, and all flags, see
[.agents/skills/super-review/document-session.md](.agents/skills/super-review/document-session.md).

### Use native context menus

Right-click / context menus must use Electron's native `Menu` API, not
HTML/CSS popups (e.g. the `DropdownMenu` component). Follow the existing IPC
pattern: define the params/result types in `packages/core/src/types.ts`, add a
`menu:show*ContextMenu` handler in `apps/desktop/src/main/ipc.ts` that builds
the menu with `Menu.buildFromTemplate` and resolves via `menu.popup`, expose it
in `apps/desktop/src/preload/index.ts`, and call it from the renderer's
`oncontextmenu` handler. The renderer performs the chosen action itself so it
can refresh afterward; the main process only renders the menu.
