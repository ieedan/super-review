# super-local-review

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

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts the Vite dev server for the renderer and launches Electron
pointed at it (with HMR). The renderer imports `@pierre/diffs`'s
`<diffs-container>` custom element for side effects.

## Build

```bash
pnpm build           # type-check + build to ./out
pnpm package         # produce a distributable in ./release
pnpm package:dir     # unpacked build (faster for smoke tests)
```

## Project layout

```
src/
├── main/            # Electron main process (Node.js)
│   ├── index.ts     # app + window lifecycle
│   ├── ipc.ts       # IPC handler registration
│   ├── store.ts     # electron-store wrapper
│   ├── git-service.ts    # simple-git wrapper
│   └── github-service.ts # Octokit + device flow
├── preload/         # contextBridge exposing typed `window.api`
├── renderer/        # Svelte app (no Node access)
│   └── src/
│       ├── App.svelte
│       ├── main.ts
│       ├── app.css
│       └── lib/
│           ├── store.svelte.ts   # global runes state
│           ├── utils.ts
│           └── components/       # UI
└── shared/          # type defs shared between main & renderer
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

## Known limitations (v1)

- Files >2 MB are skipped from rendering.
- GitHub PR base ref is pinned at the moment you open the PR — re-open to refresh.
- Browser/mobile build comes in a later iteration (architecture supports it).
