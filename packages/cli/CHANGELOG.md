# super-review

## 0.0.9-beta.0

### Patch Changes

- [#158](https://github.com/ieedan/super-review/pull/158) [`8cdc255`](https://github.com/ieedan/super-review/commit/8cdc25530fa7b23c4a78ca4af5d41b3300a80c2c) Thanks [@ieedan](https://github.com/ieedan)! - pre-release updates

## 0.0.8

### Patch Changes

- [#150](https://github.com/ieedan/super-review/pull/150) [`7c85bfb`](https://github.com/ieedan/super-review/commit/7c85bfb3ce5a97b93af1f041c9d28362e6fa961a) Thanks [@ieedan](https://github.com/ieedan)! - feat: branch task lists

  Add a per-branch task list for tracking work before opening a pull request. Tasks
  live under `.super-review/tasks/` and are committed with the branch. Manage them
  from the new Tasks tab in the right sidebar (Cmd/Ctrl+T) or the `super-review task`
  CLI (`add` / `list` / `done` / `undone` / `edit` / `remove` / `clear`). Tasks are
  ordered (new tasks append to the bottom) and can be reordered by dragging their
  grab handle. Tasks can have subtasks (one level), added from the row's overflow menu
  or `task add --parent <id>`. A task can be put on hold from the overflow menu (or
  `task hold`), which dims it as upcoming-but-not-ready without marking it done. Each
  task records who created it and who checked it off, including an agent's
  harness, so the UI can show the same logo or avatar it uses for review comments. The
  tasks file also renders as a checklist card in the diff view instead of raw JSON.

## 0.0.7

### Patch Changes

- [`67c9d99`](https://github.com/ieedan/super-review/commit/67c9d9942b6f261f149d46aafe7386814cb8bcbc) Thanks [@ieedan](https://github.com/ieedan)! - feat: resolve pr comments from the CLI

- [`53c6121`](https://github.com/ieedan/super-review/commit/53c61218937215256487b77fe8c7790ddf7b6915) Thanks [@ieedan](https://github.com/ieedan)! - fix: ensure unresolved and outdated comments are handled correctly by the CLI

## 0.0.6

### Patch Changes

- fix: `comment list --pr` now matches the desktop app's GitHub account per repo. It finds the app's config across dev and packaged installs, and honors the app's per-repo account pin, so a private repo owned by a secondary (non-default) account resolves instead of 404ing. ([`f1a6012`](https://github.com/ieedan/super-review/commit/f1a601214651e57304316fe97d06ffe4f8bbde9f))

## 0.0.5

### Patch Changes

- feat: pre-fill the commit box from a session's suggested title ([`56953c6`](https://github.com/ieedan/super-review/commit/56953c65d9dcc3c4ecfe2be3f94d20cb35dd40bf))

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

## 0.0.4

### Patch Changes

- feat: `comment list` now shows the review comments on the branch you're on — the branch is read from git, so you never name it, and there are no `--context`/`--pr` flags to reason about. Backed by a new `listLocalComments` helper in core. (These comments live on the reviewer's machine, so a remote/cloud agent finds none.) ([#82](https://github.com/ieedan/super-review/pull/82))

## 0.0.3

### Patch Changes

- feat: add local review comments — per-line notes kept in a local, app-wide SQLite database (`~/.super-review/comments.db`), never committed to the repo. Author and resolve them in a new right-hand Comments sidebar (and inline in the diff), copy them as agent-ready prompts, and let agents read (`super-review comment list`) and resolve (`super-review comment resolve`) them, optionally linking the session that addressed the feedback. The sidebar also surfaces PR review comments when reviewing a pull request. ([#59](https://github.com/ieedan/super-review/pull/59))

## 0.0.2

### Patch Changes

- Add `session save --committed` to document changes that have already been committed: it captures the current branch diffed against its base (auto-detected default branch, overridable with `--base`/`--head`) instead of only the working tree. Also fixes `revExists` reporting a missing ref (e.g. `origin/main` in a remote-less repo) as existing. ([#38](https://github.com/ieedan/super-review/pull/38))

## 0.0.1

### Patch Changes

- Parse the CLI's commands and flags with `commander` instead of a hand-rolled ([#25](https://github.com/ieedan/super-review/pull/25))
  argv parser. This gives consistent, auto-generated `--help` menus at every level
  (`super-review`, `super-review session`, `super-review session save/clear`),
  a `--version` flag, plus unknown-command/flag detection with suggestions. The
  command and flag signature is unchanged — `session save` and `session clear`
  and all their options behave exactly as before.

- Extract the session-authoring CLI into a standalone `super-review` package, backed by a shared `@super-review/core` (the pure-node session + git layer). The desktop app no longer bundles the CLI or exposes the `super-review` bin — it consumes `@super-review/core` for its session/diff read paths. Behavior is unchanged; this is a structural refactor that makes the CLI independently buildable and publishable. ([#25](https://github.com/ieedan/super-review/pull/25))
