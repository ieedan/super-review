# @super-review/storybook

A [Storybook](https://storybook.js.org) workbench for the `@super-review/ui`
component library. It consumes the **real** UI components (the same source the
desktop app and docs site use), so what you see here is what ships.

## Commands

Run from this directory (or with `pnpm --filter @super-review/storybook <script>`
from the repo root):

| Task                       | Command          |
| -------------------------- | ---------------- |
| Run Storybook in dev       | `pnpm storybook` |
| Run Storybook (no browser) | `pnpm dev`       |
| Build the static site      | `pnpm build`     |

Dev serves on http://localhost:6006.

## How it's wired

- **Framework**: `@storybook/svelte-vite` with `@storybook/addon-svelte-csf`, so
  stories are authored as `*.stories.svelte` files (native Svelte snippets/slots).
- **Vite config** (`vite.config.ts`): the framework consumes the project Vite
  config, so the Svelte plugin, Tailwind v4 plugin, the `@super-review/ui` source
  alias and the ES-module worker setting live there. The Svelte plugin must sit
  ahead of the CSF addon in the plugin order, which is why it's here and not in
  a `viteFinal`.
- **Theme** (`.storybook/preview.css`): imports the desktop renderer's `app.css`
  verbatim, so the Tailwind theme tokens, the light/dark palettes and the brand
  styling match the app exactly. A toolbar control toggles light/dark and the
  flame/mono accent.
- **The Electron bridge** (`.storybook/api-stub.ts`): the components call
  `window.api` (the preload bridge) on mount; Storybook has no preload, so a
  permissive stub stands in for it.

## Story conventions

Each critical component has a default/overview story plus a **performance** story
that renders it at scale (e.g. the diff view with 300 differently-sized files,
the file tree with 5,000 files, the branch picker with 500 branches). The
performance stories exist to prove the components stay responsive on large
inputs.

Several components (file tree, diff view, branch picker, repo picker) are driven
by the global `app` store rather than props. Their stories seed that store via
the helpers in `src/lib/` (`store-harness.ts` + `fixtures.ts`) and the
`StoreScope.svelte` wrapper before mounting the component.
