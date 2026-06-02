# @super-review/core

## 0.1.0

### Minor Changes

- Add a native context menu to discard a hunk or an individual line. ([#27](https://github.com/ieedan/super-review/pull/27))

  Previously you could stage individual lines but only discard whole files. Right-clicking a staging gutter control in the Unstaged working-tree diff now opens a native discard menu: the hunk button offers "Discard modified lines" (the whole section) and a line button offers "Discard modified line". The discard builds a working-tree-based patch — removing the discarded additions and restoring the discarded deletions — and applies it to the working tree only, leaving your index untouched. Discards stay recoverable since the removed lines remain in HEAD.

- Offer to fork a repository when you don't have write access to its GitHub remote. ([#25](https://github.com/ieedan/super-review/pull/25))
  A banner in the commit box explains the missing access, and committing or pushing
  (or clicking the banner link) prompts to create a fork — matching GitHub Desktop.
  Confirming creates the fork under your account, repoints `origin` at it, and
  resumes the commit/push against your fork. You choose how to use the fork — "to
  contribute to the parent project" (keeps the original as `upstream`, so the PR
  list and "Create PR" target the parent) or "for my own purposes" (works the fork
  standalone). "Create PR" on a fork now opens the compare against the right repo.

- Add a **Repository** menu (Push/Pull/Fetch, Remove, View on GitHub, Open in ([#25](https://github.com/ieedan/super-review/pull/25))
  editor/terminal, Show in Finder, Create Issue on GitHub, Repository Settings…) and
  a **Repository Settings** dialog whose Fork Behavior pane lets you change a fork's
  contribution target after the fact — switch between contributing to the parent
  (upstream wired up; PRs / View on GitHub / Create Issue target the parent) and
  working on the fork for your own purposes. Repository Settings is also reachable
  from the repo context menu. App settings and repo settings now share one dialog
  shell.

- Add stash management with GitHub Desktop parity. When a pull is blocked by ([#26](https://github.com/ieedan/super-review/pull/26))
  uncommitted local changes that would be overwritten, the app now offers to
  "Stash Changes and Continue" instead of surfacing a raw error. It keeps one
  managed stash per branch (tagged so user-created stashes are never touched),
  shows a "Stashed Changes" entry in the sidebar, and lets you review its diff
  (including untracked files) and Restore or Discard it. Restoring reuses the
  existing conflict-resolution flow when the pop conflicts.

### Patch Changes

- Extract the session-authoring CLI into a standalone `super-review` package, backed by a shared `@super-review/core` (the pure-node session + git layer). The desktop app no longer bundles the CLI or exposes the `super-review` bin — it consumes `@super-review/core` for its session/diff read paths. Behavior is unchanged; this is a structural refactor that makes the CLI independently buildable and publishable. ([#25](https://github.com/ieedan/super-review/pull/25))
