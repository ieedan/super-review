# @super-review/core

## 0.5.1

### Patch Changes

- [`4065306`](https://github.com/ieedan/super-review/commit/406530661974b4442815845fd4b2e57a396b4840) Thanks [@ieedan](https://github.com/ieedan)! - feat: Add support for reviewing code in linked git worktrees

  Allow the app to enter a linked worktree so an agent's checked-out branch reviews like any other branch, with its uncommitted changes and staging area. Worktree branches are marked read-only in the picker; selecting one enters the worktree instead of attempting an impossible checkout. The app re-targets all working-tree operations (status, staging, commit, pull, sessions, comments) to the active worktree while inside one. Ref reads remain identical (worktrees share the object database and refs). Real checkouts always target the main checkout and implicitly leave any active worktree.

## 0.5.0

### Minor Changes

- [`2b0801b`](https://github.com/ieedan/super-review/commit/2b0801bc39fa7e12635488da7c222685b986f9c2) Thanks [@ieedan](https://github.com/ieedan)! - feat: summarize the commits waiting to be pushed

  The commit box only ever showed the tip commit, so a stack of local work read as
  one line and an Undo button. Anything below it meant leaving for the History tab
  and opening commits one at a time.

  There's now a row under Undo when more than one commit is waiting: "3 more
  commits". Hovering it opens a panel with the whole stack, newest first, each
  commit showing when it landed, its line counts, and the files it touched. A
  commit lists ten files up front and the rest are one click away, so a wide commit
  doesn't bury the ones below it. The list scrolls, and commit headers stick as you
  go so you always know which commit the files belong to. Click the row to pin the
  panel and scroll it from the keyboard; Escape puts it away.

  The set is the same one Undo works on: commits on HEAD that aren't on any remote
  yet. Push, and the row goes with it.

## 0.4.0

### Minor Changes

- [#196](https://github.com/ieedan/super-review/pull/196) [`38f1eb6`](https://github.com/ieedan/super-review/commit/38f1eb6aebf92b88271f6240ca7104027002c918) Thanks [@ieedan](https://github.com/ieedan)! - feat: mark a single file seen from its right-click menu

  Right-clicking one file offered copy/reveal/open and nothing about review state.
  Marking several at once has always been there, so the omission read as a rule
  about single files rather than the gap it was. The single-file menu now carries
  one item that flips the file's mark, labelled for the direction it moves: "Mark
  as Seen", or "Mark as Unseen" on a file already cleared.

  It matters most on the Unstaged tab, where the row's checkbox is the
  commit-inclusion one and the seen state isn't surfaced at all. Before this the
  only way to mark a single unstaged file seen was to open it and use the diff
  header's button or the hotkey; now the file list can do it too.

  Both menus mark exactly the set they name, so the two actions behind them are no
  longer specific to a selection.

## 0.3.1

### Patch Changes

- [`ee8e155`](https://github.com/ieedan/super-review/commit/ee8e155983341648a37c4bcb2e6f8eb6ed535d7a) Thanks [@ieedan](https://github.com/ieedan)! - chore: remove subscription based pricing

## 0.3.0

### Minor Changes

- [#181](https://github.com/ieedan/super-review/pull/181) [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9) Thanks [@ieedan](https://github.com/ieedan)! - feat(changeset): generate changesets via agent CLIs with customizable prompts

- [`1d1b0b2`](https://github.com/ieedan/super-review/commit/1d1b0b2afcdc6e81c430fa65db71366e627884aa) Thanks [@ieedan](https://github.com/ieedan)! - Add harness CLI authentication detection and recovery flow.

  When a commit message generation or changeset run reaches a harness CLI with no active session, the app now detects this upfront (via auth probes that run the CLI's own status commands) and shows a recovery dialog with the exact login command instead of failing mid-run. Each harness is re-checked when Settings opens (so the user sees live state) and when they dismiss the recovery dialog and come back after signing in. The Agents settings now display each CLI's auth state and signed-in identity.

- [#181](https://github.com/ieedan/super-review/pull/181) [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9) Thanks [@ieedan](https://github.com/ieedan)! - feat(commit-message): generate commit messages via harness CLIs with streaming and reveal animation

### Patch Changes

- [#177](https://github.com/ieedan/super-review/pull/177) [`6f617ac`](https://github.com/ieedan/super-review/commit/6f617acd35cb0321e2c0ec5a21ec496cc9bead1a) Thanks [@ieedan](https://github.com/ieedan)! - update in app components

- [`bd918e9`](https://github.com/ieedan/super-review/commit/bd918e9e3b1d12be02f9fd90ce49798e8aef7dfe) Thanks [@ieedan](https://github.com/ieedan)! - fix: keep local comments visible on the Branch tab after a PR is opened

  Opening a PR for a branch used to hide every local comment written before it
  existed. Two causes, both fixed: the Branch tab swapped its comment source over
  to GitHub wholesale, and the base half of the `branch:<base>..<head>` storage key
  gets repinned to `pr/<n>/base` once a PR exists, so the lookup no longer matched
  the rows. Local threads now render alongside the PR's own, and branch comments
  are looked up by head ref (matching what the CLI already did).

- [`97e5a74`](https://github.com/ieedan/super-review/commit/97e5a74d04db085bc5f9abb1bf65403ed93404b4) Thanks [@ieedan](https://github.com/ieedan)! - fix: fall back to pull/<n>/head when PR head branch was deleted after merge

- [#175](https://github.com/ieedan/super-review/pull/175) [`0a1ed73`](https://github.com/ieedan/super-review/commit/0a1ed73179a7be67d022eb109f22d44ecf208340) Thanks [@ieedan](https://github.com/ieedan)! - feat(desktop): GitHub Desktop-style Windows title bar menu

- [`bfbacbd`](https://github.com/ieedan/super-review/commit/bfbacbd3d6410a69d21c325d02e8ceb7dd83319b) Thanks [@ieedan](https://github.com/ieedan)! - fix: ensure untracked files don't cause app errors

- [`daff664`](https://github.com/ieedan/super-review/commit/daff66406c401719ed597bfe4450b5f3abde344a) Thanks [@ieedan](https://github.com/ieedan)! - feat: redesign Updates settings with Apple-style status flow

- [#158](https://github.com/ieedan/super-review/pull/158) [`8cdc255`](https://github.com/ieedan/super-review/commit/8cdc25530fa7b23c4a78ca4af5d41b3300a80c2c) Thanks [@ieedan](https://github.com/ieedan)! - pre-release updates

- [#161](https://github.com/ieedan/super-review/pull/161) [`8d3da92`](https://github.com/ieedan/super-review/commit/8d3da9264f4506704a4503d6d42389a1b3425a06) Thanks [@ieedan](https://github.com/ieedan)! - chore: a few fixes

- [#178](https://github.com/ieedan/super-review/pull/178) [`74a067b`](https://github.com/ieedan/super-review/commit/74a067b04eae624c6389955a899258f71e656af2) Thanks [@ieedan](https://github.com/ieedan)! - Don't run a push when there's nothing to push. The Push menu item (and its ⌘P accelerator) is now greyed out unless the branch is ahead of its remote or has no upstream yet, and the push action bails early instead of spinning the header button through "Fetching…/Pushing…" for a no-op.

- [`a3b7a66`](https://github.com/ieedan/super-review/commit/a3b7a66db896fffb9e16ed0b1cd3470d760e98d9) Thanks [@ieedan](https://github.com/ieedan)! - fix: authentication fixes

## 0.3.0-beta.6

### Minor Changes

- [`1d1b0b2`](https://github.com/ieedan/super-review/commit/1d1b0b2afcdc6e81c430fa65db71366e627884aa) Thanks [@ieedan](https://github.com/ieedan)! - Add harness CLI authentication detection and recovery flow.

  When a commit message generation or changeset run reaches a harness CLI with no active session, the app now detects this upfront (via auth probes that run the CLI's own status commands) and shows a recovery dialog with the exact login command instead of failing mid-run. Each harness is re-checked when Settings opens (so the user sees live state) and when they dismiss the recovery dialog and come back after signing in. The Agents settings now display each CLI's auth state and signed-in identity.

### Patch Changes

- [`97e5a74`](https://github.com/ieedan/super-review/commit/97e5a74d04db085bc5f9abb1bf65403ed93404b4) Thanks [@ieedan](https://github.com/ieedan)! - fix: fall back to pull/<n>/head when PR head branch was deleted after merge

## 0.3.0-beta.5

### Minor Changes

- [#181](https://github.com/ieedan/super-review/pull/181) [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9) Thanks [@ieedan](https://github.com/ieedan)! - feat(changeset): generate changesets via agent CLIs with customizable prompts

- [#181](https://github.com/ieedan/super-review/pull/181) [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9) Thanks [@ieedan](https://github.com/ieedan)! - feat(commit-message): generate commit messages via harness CLIs with streaming and reveal animation

### Patch Changes

- [`daff664`](https://github.com/ieedan/super-review/commit/daff66406c401719ed597bfe4450b5f3abde344a) Thanks [@ieedan](https://github.com/ieedan)! - feat: redesign Updates settings with Apple-style status flow

## 0.2.3-beta.4

### Patch Changes

- [#177](https://github.com/ieedan/super-review/pull/177) [`6f617ac`](https://github.com/ieedan/super-review/commit/6f617acd35cb0321e2c0ec5a21ec496cc9bead1a) Thanks [@ieedan](https://github.com/ieedan)! - update in app components

- [#178](https://github.com/ieedan/super-review/pull/178) [`74a067b`](https://github.com/ieedan/super-review/commit/74a067b04eae624c6389955a899258f71e656af2) Thanks [@ieedan](https://github.com/ieedan)! - Don't run a push when there's nothing to push. The Push menu item (and its ⌘P accelerator) is now greyed out unless the branch is ahead of its remote or has no upstream yet, and the push action bails early instead of spinning the header button through "Fetching…/Pushing…" for a no-op.

## 0.2.3-beta.3

### Patch Changes

- [#175](https://github.com/ieedan/super-review/pull/175) [`0a1ed73`](https://github.com/ieedan/super-review/commit/0a1ed73179a7be67d022eb109f22d44ecf208340) Thanks [@ieedan](https://github.com/ieedan)! - feat(desktop): GitHub Desktop-style Windows title bar menu

## 0.2.3-beta.2

### Patch Changes

- [`bfbacbd`](https://github.com/ieedan/super-review/commit/bfbacbd3d6410a69d21c325d02e8ceb7dd83319b) Thanks [@ieedan](https://github.com/ieedan)! - fix: ensure untracked files don't cause app errors

- [`a3b7a66`](https://github.com/ieedan/super-review/commit/a3b7a66db896fffb9e16ed0b1cd3470d760e98d9) Thanks [@ieedan](https://github.com/ieedan)! - fix: authentication fixes

## 0.2.3-beta.1

### Patch Changes

- [#161](https://github.com/ieedan/super-review/pull/161) [`8d3da92`](https://github.com/ieedan/super-review/commit/8d3da9264f4506704a4503d6d42389a1b3425a06) Thanks [@ieedan](https://github.com/ieedan)! - chore: a few fixes

## 0.2.3-beta.0

### Patch Changes

- [#158](https://github.com/ieedan/super-review/pull/158) [`8cdc255`](https://github.com/ieedan/super-review/commit/8cdc25530fa7b23c4a78ca4af5d41b3300a80c2c) Thanks [@ieedan](https://github.com/ieedan)! - pre-release updates

## 0.2.2

### Patch Changes

- [`3b8c411`](https://github.com/ieedan/super-review/commit/3b8c411e6d524a5ccaf3db517d1e8a1669906067) Thanks [@ieedan](https://github.com/ieedan)! - feat: diff view improvements

## 0.2.1

### Patch Changes

- [`df72e3b`](https://github.com/ieedan/super-review/commit/df72e3b214325b79e0323668e7351369e604730e) Thanks [@ieedan](https://github.com/ieedan)! - fix: don't re-render everything when discarding lines

## 0.2.0

### Minor Changes

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

## 0.1.15

### Patch Changes

- [`e02765f`](https://github.com/ieedan/super-review/commit/e02765fc46f30dfe12f885dfab4777176d4259ed) Thanks [@ieedan](https://github.com/ieedan)! - fix: change command menu so it doesn't conflict with the push hotkey

- [`9dbfef1`](https://github.com/ieedan/super-review/commit/9dbfef114bd4652de3312dc010cc025eaac7fd18) Thanks [@ieedan](https://github.com/ieedan)! - feat: gitignore files from the sidebar

## 0.1.14

### Patch Changes

- [`7224d20`](https://github.com/ieedan/super-review/commit/7224d2083ddadf65b81f22f74d7affb07fff80c8) Thanks [@ieedan](https://github.com/ieedan)! - fix: discard multiple files in one batched git operation

## 0.1.13

### Patch Changes

- [`7d1e33b`](https://github.com/ieedan/super-review/commit/7d1e33bae80c837d5e00f9ee2c3629ca52153d33) Thanks [@ieedan](https://github.com/ieedan)! - feat: GitHub #references and @mentions in the markdown composer

## 0.1.12

### Patch Changes

- [`d87527a`](https://github.com/ieedan/super-review/commit/d87527ae68ca38979f4b06f1419df2a0396c2479) Thanks [@ieedan](https://github.com/ieedan)! - fix: geist mono ligatures & more

## 0.1.11

### Patch Changes

- [`48e3bea`](https://github.com/ieedan/super-review/commit/48e3bea188dcb3ee73ae44e9939bfca0d33f0f39) Thanks [@ieedan](https://github.com/ieedan)! - fix: recover managed-stash restore from untracked-file collisions

- [`a24f7c2`](https://github.com/ieedan/super-review/commit/a24f7c29d6cb4ee77310cfde3f9a6340c39a8165) Thanks [@ieedan](https://github.com/ieedan)! - fix: if a file is marked seen on unstaged and on the branch tab then when it gets pushed the file will stay seen

- [`a14fee2`](https://github.com/ieedan/super-review/commit/a14fee27e526c3800cafc98aaa0d80edad8fca53) Thanks [@ieedan](https://github.com/ieedan)! - fix: prevent users from creating repos that already exist on remote

- [#140](https://github.com/ieedan/super-review/pull/140) [`b98b67f`](https://github.com/ieedan/super-review/commit/b98b67f049b0a76d676f29a4674f7a04394d356e) Thanks [@ieedan](https://github.com/ieedan)! - fix: stop losing "seen" marks after a new commit. The seen signature stored git's abbreviated blob OID, and git grows that abbreviation as the repo gains objects, so the same unchanged file looked "changed" on the next refresh and its mark was cleared. Diffs now record full blob OIDs, and the change detector tolerates abbreviation-length drift so existing marks survive the upgrade.

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
