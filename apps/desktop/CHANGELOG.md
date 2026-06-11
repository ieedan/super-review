# @super-review/desktop

## 0.1.8

### Patch Changes

- fix: select the first expanded change visible on the page in the sidebar, so a collapsed file's pinned header no longer claims active while an expanded file below it is the one on screen ([#64](https://github.com/ieedan/super-review/pull/64))

- feat: GitHub-style markdown editor for PR comments via carta-md — Write/Preview tabs, formatting toolbar, slash commands, emoji picker, and a syntax-highlighted preview, plus comment bodies now render as GitHub-Flavored Markdown ([#61](https://github.com/ieedan/super-review/pull/61))

- fix: center-truncate the diff sticky header file path so the filename stays visible on long paths, matching the sidebar changes list ([#60](https://github.com/ieedan/super-review/pull/60))

- feat: add local review comments — per-line notes kept in a local, app-wide SQLite database (`~/.super-review/comments.db`), never committed to the repo. Author and resolve them in a new right-hand Comments sidebar (and inline in the diff), copy them as agent-ready prompts, and let agents read (`super-review comment list`) and resolve (`super-review comment resolve`) them, optionally linking the session that addressed the feedback. The sidebar also surfaces PR review comments when reviewing a pull request. ([#59](https://github.com/ieedan/super-review/pull/59))

- fix: skip already-seen files when advancing after marking a file seen so the walk lands on the next change that still needs review instead of re-opening a cleared file ([#63](https://github.com/ieedan/super-review/pull/63))

- Updated dependencies [[`f05d1a1`](https://github.com/ieedan/super-review/commit/f05d1a160a489041c347371ac1174418f449049a)]:
  - @super-review/core@0.1.4

## 0.1.7

### Patch Changes

- feat: add a configurable "mark seen & next" shortcut, defaulting to Cmd/Ctrl+Enter, that marks the current change as seen and jumps to the next one ([#55](https://github.com/ieedan/super-review/pull/55))

- Preload the pull requests list when hovering the Pull Requests tab, so it's ready by the time you click into the tab. ([#57](https://github.com/ieedan/super-review/pull/57))

- Fix the sidebar leaving a stale highlight when you click a file and scroll past it — a single selection now follows the scroll while a deliberate multi-selection stays put. Also add a bulk "Mark/Unmark Selected Files as Seen" action to the multi-file context menu. ([#56](https://github.com/ieedan/super-review/pull/56))

- Updated dependencies [[`5784097`](https://github.com/ieedan/super-review/commit/578409721694aa0185b9e4248351a3ec43944656)]:
  - @super-review/core@0.1.3

## 0.1.6

### Patch Changes

- feat: add a configurable Open settings shortcut, defaulting to Cmd/Ctrl+Comma (the macOS convention) ([#52](https://github.com/ieedan/super-review/pull/52))

## 0.1.5

### Patch Changes

- feat: badge `.super-review/sessions/*.json` files with the app logo instead of the generic JSON icon across the file list, diff headers, command palette, and session tour ([#48](https://github.com/ieedan/super-review/pull/48))

- Stop the Sessions view from flashing and shifting on a no-op refresh. loadSessions now only swaps in the fetched list when it actually differs, and only re-opens an open session (which reloads its diff, resets the view to the tour and clears the file search) when that session was actually re-captured. ([#50](https://github.com/ieedan/super-review/pull/50))

## 0.1.4

### Patch Changes

- fix: clear the repo and branch picker search filter on every close path (selecting an item, context-menu/dialog actions), not just interaction-driven closes ([#44](https://github.com/ieedan/super-review/pull/44))

- feat: add a Diff theme setting to change the syntax-highlighting theme of diff code blocks, with a live per-theme preview in Appearance settings ([#43](https://github.com/ieedan/super-review/pull/43))

- feat: add red-green-color-blind diff themes — "Pierre Deuteranopia" (blue/orange, CVD-safe) and "Pierre High Contrast" presets in Appearance settings ([#47](https://github.com/ieedan/super-review/pull/47))

- fix: seed the find bar with the current text selection when opening it with Cmd/Ctrl+F, including selections inside the diff's shadow DOM ([#42](https://github.com/ieedan/super-review/pull/42))

- fix: advance "Mark seen" along the tour's reading order in a session's Tour view, so it steps to the next file the reviewer is actually looking at instead of jumping around in the changes-view order ([#46](https://github.com/ieedan/super-review/pull/46))

- fix: show the viewed branch's sessions when reviewing a branch or PR read-only, instead of the checked-out branch's working-tree sessions (read the sessions committed on the viewed branch's git ref) ([#45](https://github.com/ieedan/super-review/pull/45))

- fix: show relative timestamps for dates older than a month (e.g. "1mo ago", "2y ago") instead of falling back to an absolute date ([#40](https://github.com/ieedan/super-review/pull/40))

- Updated dependencies [[`b600a49`](https://github.com/ieedan/super-review/commit/b600a49be20ce62398feed785d605f39fa5cf1de), [`c19a885`](https://github.com/ieedan/super-review/commit/c19a885d161ba0a63c2de336a08d6eb98d09b901), [`e5d7f6c`](https://github.com/ieedan/super-review/commit/e5d7f6c5ce153f809935d1225c690206bd556833)]:
  - @super-review/core@0.1.2

## 0.1.3

### Patch Changes

- Add `session save --committed` to document changes that have already been committed: it captures the current branch diffed against its base (auto-detected default branch, overridable with `--base`/`--head`) instead of only the working tree. Also fixes `revExists` reporting a missing ref (e.g. `origin/main` in a remote-less repo) as existing. ([#38](https://github.com/ieedan/super-review/pull/38))

- Fix: Escape now closes the find bar from anywhere, not just while its input is focused ([#35](https://github.com/ieedan/super-review/pull/35))

- feat: unmark seen files when they change, and show a checked comment icon for resolved threads ([#37](https://github.com/ieedan/super-review/pull/37))

  In the review view, a file you marked as "seen" is now automatically unmarked when its content changes (new commits pushed to a branch, or further working-tree edits), so it resurfaces for re-review. This works in both the branch and unstaged views and can be turned off under Behavior → Reviewing. The sidebar comment icon also switches to a checked variant once every thread on a file is resolved.

- Updated dependencies [[`373a17d`](https://github.com/ieedan/super-review/commit/373a17d43ab3f51e9a7369a1143575b4dc9617c6)]:
  - @super-review/core@0.1.1

## 0.1.2

### Patch Changes

- fix: fix paths with `fix-path` ([`e3a23b3`](https://github.com/ieedan/super-review/commit/e3a23b3987467caf2c3845be6870079fed6c2032))

## 0.1.1

### Patch Changes

- fix: fix release workflow to "sign" binaries ([`8df64f6`](https://github.com/ieedan/super-review/commit/8df64f6c31f663fc7aae32954fb8e55374bbcea6))

- fix: ensure files without icons for them show a fallback icon ([`8df64f6`](https://github.com/ieedan/super-review/commit/8df64f6c31f663fc7aae32954fb8e55374bbcea6))

## 0.1.0

### Minor Changes

- Add line- and hunk-level staging (checkbox-per-line) to the Unstaged tab. ([#18](https://github.com/ieedan/super-review/pull/18))

  Previously a commit could only include or exclude whole files. You can now carve up a file: every changed line in a modified file's diff has a checkbox in the gutter, and each hunk has a toggle, so you can commit just the lines you want and leave the rest as working-tree changes — like GitHub Desktop. The sidebar file checkbox becomes tri-state (checked / partial / unchecked) to reflect a partial selection, and committing a subset builds a reduced patch that's applied through a scratch index, leaving your real index and the unselected changes untouched. Whole-file staging is unchanged for added/untracked, deleted, renamed and binary files.

- Add a diff layout setting to choose between scrolling through all file diffs at once or reviewing one file at a time. ([#17](https://github.com/ieedan/super-review/pull/17))

  A new "Diff layout" option under Settings → Appearance lets you pick between the default "Scrollable" layout (every file's diff stacked in one continuous scroll) and "One at a time", which shows only the selected file's diff and switches as you pick files in the sidebar — similar to GitHub Desktop.

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

- Render image diffs side by side, and add a Code/Image toggle for SVGs. ([#16](https://github.com/ieedan/super-review/pull/16))

  Image files (`png`, `jpg`, `gif`, `webp`, `avif`, `bmp`, `ico`, `svg`) now show their old and new versions side by side — like GitHub — instead of the "Binary file — diff not shown" placeholder. Raster images show only this side-by-side view; SVGs, being text, default to their source diff and gain a Markdown-preview-style "Image"/"Code" toggle so you can flip between the rendered image and the source. Image bytes up to 10 MB are embedded; larger files fall back to an "unavailable" note. Captured sessions freeze the image data so their image diffs render offline.

- Offer to switch back to the default branch when a branch's PR merges. ([#24](https://github.com/ieedan/super-review/pull/24))

  When you're on a non-default branch and its PR is observed going from unmerged → merged, a dialog asks whether to switch the working tree back to the default branch, do nothing, or remember either choice via an "Always do this automatically" checkbox. After switching, a second dialog offers to remove the now-merged branch locally (remote untouched), with an "Always remove merged branches locally" checkbox. Both prompts only fire on a live merge transition we observed — never when navigating to an already-merged PR. Behavior settings expose the matching controls: a three-way "Merged branches" choice (Ask each time / Switch back / Do nothing) and the auto-remove toggle.

- Add a "Publish to GitHub" flow for repositories with no remote. ([#24](https://github.com/ieedan/super-review/pull/24))

  When the active repository has no `origin` remote, the top-bar primary action now shows **Publish** instead of nothing — fixing the dead end where a freshly created/committed repo offered no way to push. Clicking it opens a GitHub-Desktop-style **Publish Repository** dialog (Name defaulting to the folder, Description, a "Keep this code private" checkbox, and an Organization dropdown). Publishing makes the initial commit if the repo has none yet (so a freshly seeded README is committed rather than failing the push), creates the repository on GitHub via the signed-in account (under the chosen org or the account itself), wires it up as `origin`, and pushes the current branch — using the system git credential helper, never writing a token into the repo config. The flow is retryable: if the GitHub repo already exists (e.g. a prior attempt created it but the push failed), it's reused instead of erroring.

- Review any branch or pull request read-only without checking it out. ([#30](https://github.com/ieedan/super-review/pull/30))

  Right-click a branch — or a pull request, in the picker's Pull Requests tab — and choose **View Read-Only** to review its diff without touching the working tree, so an agent (or your own in-progress work) on another branch is never disrupted. A PR shows the same diff a checkout would (its head vs. the default branch), but nothing is checked out. The picker labels whatever's on screen; a pill in the top bar surfaces the branch that's actually checked out and clicks back to it.

  While reviewing read-only the header follows the view rather than the checkout: the Unstaged tab is hidden (no working tree to commit against), the PR button opens the _viewed_ branch/PR's pull request, Refresh re-reads the viewed diff (no "Pull"), and the open-in-editor/terminal buttons are hidden (they'd open the checked-out branch's files). Branch and PR diffs also now compare against `origin/<default>` rather than the local default branch, so they match GitHub even when your local default is behind the remote.

- Add a **Repository** menu (Push/Pull/Fetch, Remove, View on GitHub, Open in ([#25](https://github.com/ieedan/super-review/pull/25))
  editor/terminal, Show in Finder, Create Issue on GitHub, Repository Settings…) and
  a **Repository Settings** dialog whose Fork Behavior pane lets you change a fork's
  contribution target after the fact — switch between contributing to the parent
  (upstream wired up; PRs / View on GitHub / Create Issue target the parent) and
  working on the fork for your own purposes. Repository Settings is also reachable
  from the repo context menu. App settings and repo settings now share one dialog
  shell.

- Add stash-aware branch switching and creation with GitHub Desktop parity. When ([#26](https://github.com/ieedan/super-review/pull/26))
  you switch to — or create — a branch with a dirty working tree, the app now asks
  what to do with your in-progress work: leave it stashed on the branch you're
  leaving (the existing "Stashed Changes" row handles restore/discard on return),
  or bring it along to the target (a conflicted carry routes to the existing
  conflict-resolution flow). Both choices build on the managed-stash and checkout
  primitives, so no new git behavior is introduced. Also hides the "Create branch
  based on…" selector when you're on the default branch, where the only option was
  itself.

- Add stash management with GitHub Desktop parity. When a pull is blocked by ([#26](https://github.com/ieedan/super-review/pull/26))
  uncommitted local changes that would be overwritten, the app now offers to
  "Stash Changes and Continue" instead of surfacing a raw error. It keeps one
  managed stash per branch (tagged so user-created stashes are never touched),
  shows a "Stashed Changes" entry in the sidebar, and lets you review its diff
  (including untracked files) and Restore or Discard it. Restoring reuses the
  existing conflict-resolution flow when the pop conflicts.

- Add window startup settings under Settings → App. You can now set the window's default open size and choose to start maximized. ([#31](https://github.com/ieedan/super-review/pull/31))

  A new "App" tab exposes a width/height for the initial window size (clamped to the window's minimum) and a "Start maximized" toggle. The default open size is now 1250×825, and the window opens centered on the current display. These apply on the next launch — when Start maximized is on, the width/height serve as the restored (un-maximized) size.

### Patch Changes

- Render diffs on a @pierre/diffs worker pool so syntax highlighting and diff-AST ([#22](https://github.com/ieedan/super-review/pull/22))
  generation run off the main thread. Scrolling, typing in comment composers, and
  tab switches stay responsive while large diffs paint; diffs show plain text
  first and upgrade to highlighted output as the workers finish. If the worker
  pool can't start, rendering transparently falls back to the main thread.

- Extract the session-authoring CLI into a standalone `super-review` package, backed by a shared `@super-review/core` (the pure-node session + git layer). The desktop app no longer bundles the CLI or exposes the `super-review` bin — it consumes `@super-review/core` for its session/diff read paths. Behavior is unchanged; this is a structural refactor that makes the CLI independently buildable and publishable. ([#25](https://github.com/ieedan/super-review/pull/25))

- Hide the GitHub CI status indicator on the primary action button while a push/fetch/pull is in progress, so it no longer renders alongside the "Working…" state. ([#23](https://github.com/ieedan/super-review/pull/23))

- Make navigating between files instant in the "One at a time" diff layout. ([#17](https://github.com/ieedan/super-review/pull/17))

  The previous and next file's diffs are now rendered off-screen ahead of time, so stepping to either no longer waits on a fetch and re-render — the diff is already there when you switch to it.

- Reword user-facing UI copy to drop em-dashes. Dialogs, tooltips, and empty states now read as plain sentences without the dash, keeping the information that mattered and trimming filler where it didn't. ([#29](https://github.com/ieedan/super-review/pull/29))

- Refresh open diffs when files change outside the app. ([#21](https://github.com/ieedan/super-review/pull/21))

  Returning to the window (or the periodic origin poll) refreshed the file list but served each file's diff from an in-memory cache that was only ever invalidated by in-app git operations. An already-open diff could stay frozen on stale content no matter how many times you switched away and back. Focus and poll refreshes now re-validate open diffs against disk in the background, swapping in the new content only when it actually changed — so edits made in another editor or the CLI show up without a loading flicker.

- Separate the header button loading states so only one spinner shows at a time. ([#32](https://github.com/ieedan/super-review/pull/32))

  The Refresh, Update branch, and Create PR/Push buttons all read the shared push state, distinguished only by the coarse `intent` field. Any pull-shaped operation (pull, update-from-default, upstream sync) lit up multiple buttons at once, the Create PR/Push button spun for any in-progress operation even though opening the create-PR page does no push work, and every operation's trailing file/branch refresh spun the Refresh icon on top of the owning button. A precise `op` discriminator now attributes each spinner to exactly one button, so the header never shows two spinners for a single operation.

- Publish release artifacts under stable, version-less filenames ([#19](https://github.com/ieedan/super-review/pull/19))
  (`Super-Review-mac-arm64.dmg`, `Super-Review-win-x64.exe`) so the download site
  can link straight to `releases/latest/download/<name>` and always serve the
  newest build.

- Require `--tour` to be passed as inline JSON. ([#14](https://github.com/ieedan/super-review/pull/14))

  The `session save --tour` flag no longer accepts a path to a JSON file (or `-` for stdin); the tour document is now passed directly as the argument's value. This trims an unnecessary file-read round-trip and the associated error cases. For a large tour, expand the JSON inline via the shell (e.g. `--tour "$(cat tour.json)"`).

- Updated dependencies [[`12dd89f`](https://github.com/ieedan/super-review/commit/12dd89ff8627d8da1774dc58083f6cbcd94a3b69), [`0926681`](https://github.com/ieedan/super-review/commit/0926681c5c51834d9c7c94b59401e322d057bdbe), [`0926681`](https://github.com/ieedan/super-review/commit/0926681c5c51834d9c7c94b59401e322d057bdbe), [`0926681`](https://github.com/ieedan/super-review/commit/0926681c5c51834d9c7c94b59401e322d057bdbe), [`6aa4d11`](https://github.com/ieedan/super-review/commit/6aa4d11557e1b879dcb81f56373b4b1a47eb53b8)]:
  - @super-review/core@0.1.0

## 0.0.4

### Patch Changes

- Populate GitHub Release notes from the changelog. The `publish-release` job now extracts the current version's section from `CHANGELOG.md` (notes + PR links) and sets it as the release body when flipping the draft live, instead of leaving it blank. ([#12](https://github.com/ieedan/super-review/pull/12))

## 0.0.3

### Patch Changes

- Fix the desktop release pipeline and upgrade the toolchain to Node 24. ([#10](https://github.com/ieedan/super-review/pull/10))
  - Pin `electronVersion` so electron-builder no longer fails to detect the Electron version under pnpm.
  - Use pnpm's `onlyBuiltDependencies` so Electron/esbuild native binaries actually download in CI.
  - Only pass `CSC_LINK`/`CSC_KEY_PASSWORD` when a signing certificate is present, fixing the macOS "not a file" packaging crash on unsigned builds.
  - Bump the project to Node 24 (engines, CI/release workflows, `@types/node`).

## 0.0.2

### Patch Changes

- Switch releases to a changesets-driven autorelease workflow. Versioning and the ([#8](https://github.com/ieedan/super-review/pull/8))
  changelog are now produced from `.changeset/*` files, and merging the generated
  "Version Packages" PR builds and publishes the GitHub Release automatically.
