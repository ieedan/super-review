# super-review

Review tools are so bad you don't even want to look at the code. This fixes that.

A desktop UI (Electron + Svelte 5) for reviewing agent-written code: split/unified
diffs, branch switching, GitHub PR review, "mark as seen" to collapse files, and
a per-repo dropdown with auto-detected favicons.

## Stack

- **Electron** + **electron-vite** (build tool)
- **Svelte 5** (runes) + **TypeScript**
- **Tailwind v4** + shadcn-svelte-inspired primitives
- **[@pierre/diffs](https://diffs.com)** for diff rendering (split + stacked)
- **simple-git** for local git operations
- **electron-store** for persistence
- **@octokit/auth-oauth-device** for GitHub Device Flow auth

## Development

This is a [pnpm workspace](https://pnpm.io/workspaces). The desktop app lives in
`apps/desktop`. Run scripts from the repo root (they delegate to the app) or from
within `apps/desktop`.

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts the Vite dev server for the renderer and launches Electron
pointed at it (with HMR). The renderer imports `@pierre/diffs`'s
`<diffs-container>` custom element for side effects.

## Build

```bash
pnpm build           # type-check + build to apps/desktop/out
pnpm package         # produce a distributable in apps/desktop/release
pnpm package:dir     # unpacked build (faster for smoke tests)
```

## Releases

Tagged releases are built by CI and published to GitHub Releases for **Windows
(x64)** and **macOS (Apple silicon)**, and the app auto-updates from them. Push a
`v*` tag to cut one — see [PUBLISHING.md](PUBLISHING.md) for the full walkthrough
(including optional code signing / notarization).

## Project layout

```
.
├── apps/
│   └── desktop/         # Electron + Svelte 5 desktop app (@super-review/desktop)
│       └── src/
│           ├── main/            # Electron main process (Node.js)
│           │   ├── index.ts     # app + window lifecycle
│           │   ├── ipc.ts       # IPC handler registration
│           │   ├── store.ts     # electron-store wrapper
│           │   ├── git-service.ts    # simple-git wrapper
│           │   └── github-service.ts # Octokit + device flow
│           ├── preload/         # contextBridge exposing typed `window.api`
│           ├── renderer/        # Svelte app (no Node access)
│           │   └── src/
│           │       ├── App.svelte
│           │       ├── main.ts
│           │       ├── app.css
│           │       └── lib/
│           │           ├── store.svelte.ts   # global runes state
│           │           ├── utils.ts
│           │           └── components/       # UI
│           └── shared/          # type defs shared between main & renderer
├── pnpm-workspace.yaml
└── package.json         # workspace root
```

## Features

- Open a repository via OS picker; persists across runs in a dropdown.
- Auto-detects a project favicon (checks `favicon.*`, `public/favicon.*`,
  `static/favicon.*`, etc.) to show next to the repo name.
- Three "diff contexts": working tree, branch compare (`base...head`), and PR.
- Toggle split / unified view from the toolbar.
- Per-repo, per-context "seen file" tracking — seen files collapse and dim out.
- GitHub PR list via Device Flow auth; selecting a PR fetches `refs/pr/<n>/head`
  and pins `refs/pr/<n>/base` to the PR base branch tip, then diffs locally.
- **Sessions** — agent-documented collections of changes (see below).

## Sessions

A **session** is a frozen, agent-documented snapshot of the changes a coding
agent made: a name, a description, the harness that produced it (shown with a
logo, and an optional link back to the run), and the diff of every changed file.
Sessions let you review one agent run in isolation instead of one
undifferentiated pile of unstaged changes.

The **Sessions** tab lists the documented sessions for the active repo; pick one
to open its frozen diff in the sidebar + diff view, and use the back arrow to
return to the list.

### Documenting a session (CLI)

Agents record a session with the standalone `super-review` CLI (the
`@super-review/cli` package; once published, `npx super-review`, or build it
locally with `pnpm --filter @super-review/cli build`):

```bash
super-review session save \
  --key "<conversation id>" \
  --name "What I changed" \
  --description "Details" \
  --harness claude-code \
  [--harness-url "<resume/permalink>"]
```

Re-running with the same `--key` **updates** the existing session with the
latest working-tree changes rather than creating a duplicate. The snapshot is
taken from the current working tree (changes need not be committed). Manifests
are stored in the repo under `.super-review/sessions/<sessionId>.json`, so they
can be committed and travel with a branch/PR — a reviewer can pull the branch
and open the documented tour without having authored it locally. Clear them all
from the Sessions tab ("Clear all") to tidy up before merging.

A ready-to-use Claude Code skill lives at
`.claude/skills/document-session/SKILL.md`; agents can invoke it when they
finish a task.

## Known limitations (v1)

- Files >2 MB are skipped from rendering.
- GitHub PR base ref is pinned at the moment you open the PR — re-open to refresh.
- Browser/mobile build comes in a later iteration (architecture supports it).
