# @super-review/core

## 0.1.10

### Patch Changes

- [`c4e4164`](https://github.com/ieedan/super-review/commit/c4e4164f0da49ce1beb451745cf84c2cfd51756a) Thanks [@ieedan](https://github.com/ieedan)! - fix: render markdown in PackageHoverCard

- [`67c9d99`](https://github.com/ieedan/super-review/commit/67c9d9942b6f261f149d46aafe7386814cb8bcbc) Thanks [@ieedan](https://github.com/ieedan)! - feat: resolve pr comments from the CLI

- [`c2512de`](https://github.com/ieedan/super-review/commit/c2512de5701143228d86697b0f949f5f70144e72) Thanks [@ieedan](https://github.com/ieedan)! - feat: allow users to configure AI files in new configuration dialog and view and reconfigure them in settings

- [#143](https://github.com/ieedan/super-review/pull/143) [`5d6312c`](https://github.com/ieedan/super-review/commit/5d6312c259924e29f93b15a3598121215ca71595) Thanks [@ieedan](https://github.com/ieedan)! - feat: improve agent files settings

- [`b58c6f3`](https://github.com/ieedan/super-review/commit/b58c6f3f408000b2119c6a279eb0ab926d554833) Thanks [@ieedan](https://github.com/ieedan)! - fix: refactor diff navigation to be more robust

- [`b58c6f3`](https://github.com/ieedan/super-review/commit/b58c6f3f408000b2119c6a279eb0ab926d554833) Thanks [@ieedan](https://github.com/ieedan)! - fix: fix an issue where the bring changes to main dialog overflowed with long branch names

- [`f678fa6`](https://github.com/ieedan/super-review/commit/f678fa6ba622facc05ba053c8fc5bfd7951329d0) Thanks [@ieedan](https://github.com/ieedan)! - feat: allow users to further customize left-sidebar tabs

- [`f678fa6`](https://github.com/ieedan/super-review/commit/f678fa6ba622facc05ba053c8fc5bfd7951329d0) Thanks [@ieedan](https://github.com/ieedan)! - feat: carry seen state across contexts for byte-identical diffs

## 0.1.9

### Patch Changes

- fix: `comment list --pr` now matches the desktop app's GitHub account per repo. It finds the app's config across dev and packaged installs, and honors the app's per-repo account pin, so a private repo owned by a secondary (non-default) account resolves instead of 404ing. ([`f1a6012`](https://github.com/ieedan/super-review/commit/f1a601214651e57304316fe97d06ffe4f8bbde9f))

## 0.1.8

### Patch Changes

- feat: pre-fill the commit box from a session's suggested title ([`56953c6`](https://github.com/ieedan/super-review/commit/56953c65d9dcc3c4ecfe2be3f94d20cb35dd40bf))

- feat: add a collapse-all-seen button to the sidebar ([#130](https://github.com/ieedan/super-review/pull/130))

- feat: add `--pr` flag to view PR comments ([`eeceb6d`](https://github.com/ieedan/super-review/commit/eeceb6de4efc1dc2a4495c0f2e5d1e29351b0d33))

- feat: reply to local review comments ([`7b9db69`](https://github.com/ieedan/super-review/commit/7b9db692c41f8905739a81c56dd70bc92fdcac2b))

  Local review comments can now hold threaded replies. Agents reply from the CLI
  with `super-review comment reply <id> <body>` (authored via `--harness`), and
  humans reply from the desktop with the same Write/Preview composer used for new
  comments. Replies inherit the thread root's anchor, resolution stays
  thread-level (on the root), and the sidebar/file-count badges count threads, not
  individual replies. `comment list` now groups replies under their root and
  `--unresolved` filters by the root's state.

  A new "Copy thread" control copies a whole thread (root + replies) as markdown
  for an agent, on both PR and local comments. The resolve toggle now lives in a
  thread-level action bar below the conversation on both PR and local comments
  (previously local put it in the comment header), so the two are consistent.

## 0.1.7

### Patch Changes

- feat: Show when current branch diverged from default in the history view ([`ad0d518`](https://github.com/ieedan/super-review/commit/ad0d5184e55213b20c7cf9943c1cd610813a831f))

- feat: Feedback dialog and issue triage workflow ([`7b78701`](https://github.com/ieedan/super-review/commit/7b78701e06e13fe741ee3280e38af0b34a2ee875))

- feat: one-click copy commit hash in history view ([#89](https://github.com/ieedan/super-review/pull/89))

## 0.1.6

### Patch Changes

- feat: Add PR conversation view to right sidebar ([#77](https://github.com/ieedan/super-review/pull/77))

- feat: allow users to have custom file extensions ([#78](https://github.com/ieedan/super-review/pull/78))

- feat: `comment list` now shows the review comments on the branch you're on — the branch is read from git, so you never name it, and there are no `--context`/`--pr` flags to reason about. Backed by a new `listLocalComments` helper in core. (These comments live on the reviewer's machine, so a remote/cloud agent finds none.) ([#82](https://github.com/ieedan/super-review/pull/82))

- feat: add a History tab that lists the branch's commits and opens each commit's changed files for review. The Sessions and History tabs can be shown/hidden from the tab strip's right-click native context menu. ([#80](https://github.com/ieedan/super-review/pull/80))

- feat: hover details in package.json files ([#75](https://github.com/ieedan/super-review/pull/75))

- feat: Add ui for creating a changeset in the app ([`3138873`](https://github.com/ieedan/super-review/commit/31388730e05e4caf275cf4a0fb2058a44865d757))

- feat: warn users of useless changesets ([`1676785`](https://github.com/ieedan/super-review/commit/167678559dbf578845406e6a7ea308d9efe48d81))

- feat: signed commits by default ([`5673aa2`](https://github.com/ieedan/super-review/commit/5673aa22973838bb7f5ed27c6d0d9469b8ea8743))

- fix: improve logo detection & detect light/dark variants ([`fcb9a16`](https://github.com/ieedan/super-review/commit/fcb9a16ebd7ca0a741b53a5c65b59caa258a9c1f))

- feat: better transition settings ([`e1d7ac2`](https://github.com/ieedan/super-review/commit/e1d7ac27ee15d30c92bfd9facf0817391e5099a3))

- feat: allow for customization of header items ([#76](https://github.com/ieedan/super-review/pull/76))

## 0.1.5

### Patch Changes

- fix: diff view polish — center the gutter `+` comment button in its own lane between the line numbers and code, render deleted files as an all-removed diff (GitHub-style) with a compact `FileMinus`/`FileEdit` status icon instead of a wide text badge, and show "The diff for this file is too large to render" for oversized files (including ones with a single pathologically long line that previously painted blank) ([`68d083a`](https://github.com/ieedan/super-review/commit/68d083a48d3f1a4dac0fa17823352257ba936107))

## 0.1.4

### Patch Changes

- feat: add local review comments — per-line notes kept in a local, app-wide SQLite database (`~/.super-review/comments.db`), never committed to the repo. Author and resolve them in a new right-hand Comments sidebar (and inline in the diff), copy them as agent-ready prompts, and let agents read (`super-review comment list`) and resolve (`super-review comment resolve`) them, optionally linking the session that addressed the feedback. The sidebar also surfaces PR review comments when reviewing a pull request. ([#59](https://github.com/ieedan/super-review/pull/59))

## 0.1.3

### Patch Changes

- feat: add a configurable "mark seen & next" shortcut, defaulting to Cmd/Ctrl+Enter, that marks the current change as seen and jumps to the next one ([#55](https://github.com/ieedan/super-review/pull/55))

## 0.1.2

### Patch Changes

- feat: add a Diff theme setting to change the syntax-highlighting theme of diff code blocks, with a live per-theme preview in Appearance settings ([#43](https://github.com/ieedan/super-review/pull/43))

- feat: add red-green-color-blind diff themes — "Pierre Deuteranopia" (blue/orange, CVD-safe) and "Pierre High Contrast" presets in Appearance settings ([#47](https://github.com/ieedan/super-review/pull/47))

- fix: show the viewed branch's sessions when reviewing a branch or PR read-only, instead of the checked-out branch's working-tree sessions (read the sessions committed on the viewed branch's git ref) ([#45](https://github.com/ieedan/super-review/pull/45))

## 0.1.1

### Patch Changes

- Add `session save --committed` to document changes that have already been committed: it captures the current branch diffed against its base (auto-detected default branch, overridable with `--base`/`--head`) instead of only the working tree. Also fixes `revExists` reporting a missing ref (e.g. `origin/main` in a remote-less repo) as existing. ([#38](https://github.com/ieedan/super-review/pull/38))

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
