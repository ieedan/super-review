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
  core/       Node-only session + git layer; shared by the CLI and the desktop main process
  ui/         @super-review/ui — Svelte renderer components, stores, diff/find logic
  cli/        super-review — published npm CLI for authoring sessions & review comments
  storybook/  @super-review/storybook — Storybook workbench for the ui components
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

### packages/storybook — `@super-review/storybook`

A Storybook workbench (Storybook 10 + `@storybook/svelte-vite` +
`@storybook/addon-svelte-csf`) that consumes the **real** `@super-review/ui`
components. Stories are `*.stories.svelte` files under `src/stories/`, covering
the critical components (file tree, diff view, comment box, branch picker, repo
picker) and the shadcn-svelte primitives. Each critical component has a
performance story that renders it at scale.

- `vite.config.ts` carries the Svelte + Tailwind plugins and the
  `@super-review/ui` source alias (the framework consumes the project Vite
  config; the Svelte plugin must precede the CSF addon in plugin order).
- `.storybook/preview.css` imports the desktop app's `app.css` so the theme
  matches exactly; `.storybook/api-stub.ts` stands in for the Electron
  `window.api` preload bridge.
- `src/lib/` holds the fixtures + `store-harness`/`StoreScope` that seed the
  global `app` store for the store-driven components.

## Commands (run from repo root)

| Task                         | Command            |
| ---------------------------- | ------------------ |
| Run desktop + docs in dev    | `pnpm dev`         |
| Desktop only                 | `pnpm dev:desktop` |
| Docs only                    | `pnpm dev:docs`    |
| Build the desktop app        | `pnpm build`       |
| Build the CLI for publishing | `pnpm build:cli`   |
| Run Storybook                | `pnpm storybook`   |
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
a logical unit of work completed), run the **`document-session`** skill to
create or update a super-review session locally. The skill inspects the diff,
writes the tour, and runs the `super-review` CLI.

When you run it, keep these in mind:

- **`--key`**: your conversation/run id. Use the same id for the whole
  conversation so re-runs update the same session instead of creating duplicates.
- **Checkpoint summary**: what you accomplished, the approach you took, and
  anything a reviewer should scrutinize.
- **Commit state**: whether changes are still uncommitted (default) or already
  committed on a branch (pass `--committed`).

### Use native context menus

Right-click / context menus must use Electron's native `Menu` API, not
HTML/CSS popups (e.g. the `DropdownMenu` component). Follow the existing IPC
pattern: define the params/result types in `packages/core/src/types.ts`, add a
`menu:show*ContextMenu` handler in `apps/desktop/src/main/ipc.ts` that builds
the menu with `Menu.buildFromTemplate` and resolves via `menu.popup`, expose it
in `apps/desktop/src/preload/index.ts`, and call it from the renderer's
`oncontextmenu` handler. The renderer performs the chosen action itself so it
can refresh afterward; the main process only renders the menu.
