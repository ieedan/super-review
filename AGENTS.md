# AGENTS.md

## Document your work after every checkpoint

After every checkpoint you reach in a coding task (a feature done, a bug fixed,
a logical unit of work completed), create a super-review session locally so a
human can review your changes as a guided tour.

Run (use the same `--key` for the whole conversation so re-runs update the same
session instead of creating duplicates):

```bash
pnpx super-review session save --key "<your conversation/run id>" --tour '<tour json>'
```

For the tour JSON shape, callouts, and all flags, see
[.agents/skills/document-session/SKILL.md](.agents/skills/document-session/SKILL.md).

## Use native context menus

Right-click / context menus must use Electron's native `Menu` API, not
HTML/CSS popups (e.g. the `DropdownMenu` component). Follow the existing IPC
pattern: define the params/result types in `packages/core/src/types.ts`, add a
`menu:show*ContextMenu` handler in `apps/desktop/src/main/ipc.ts` that builds
the menu with `Menu.buildFromTemplate` and resolves via `menu.popup`, expose it
in `apps/desktop/src/preload/index.ts`, and call it from the renderer's
`oncontextmenu` handler. The renderer performs the chosen action itself so it
can refresh afterward; the main process only renders the menu.
