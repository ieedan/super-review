# @super-review/ui

## 0.3.0

### Minor Changes

- [#192](https://github.com/ieedan/super-review/pull/192) [`80eb5bf`](https://github.com/ieedan/super-review/commit/80eb5bfdcc85718f0a911cca566c0f2d82ed1f80) Thanks [@ieedan](https://github.com/ieedan)! - feat: test regex literals inline in the diff

  Hovering a regex literal in a JS/TS diff now hints that it can be tested, and
  clicking it opens a small popup: type a test string and see live whether it
  matches, with the matched runs highlighted in place and the character range
  called out. A global literal highlights every match; a literal that does not
  compile shows the engine's error instead, which makes a broken pattern obvious
  during review rather than after it ships.

  Detection is a real scanner, not a search for slashes: division, comments,
  strings and template text are left alone, and a literal split across several
  syntax-highlighted tokens still resolves as one.

## 0.2.2

### Patch Changes

- [`ee8e155`](https://github.com/ieedan/super-review/commit/ee8e155983341648a37c4bcb2e6f8eb6ed535d7a) Thanks [@ieedan](https://github.com/ieedan)! - chore: remove subscription based pricing
- Updated dependencies [[`ee8e155`](https://github.com/ieedan/super-review/commit/ee8e155983341648a37c4bcb2e6f8eb6ed535d7a)]:
  - @super-review/core@0.3.1

## 0.2.1

### Patch Changes

- [#188](https://github.com/ieedan/super-review/pull/188) [`367bb69`](https://github.com/ieedan/super-review/commit/367bb698023d5d7edfd3c161a208920ea02140e6) Thanks [@ieedan](https://github.com/ieedan)! - fix: count local comments in the file list when a PR is open

  The per-file comment count in the sidebar zeroed out local comments in a PR
  context, so on the Branch tab with an open PR a file's local threads rendered in
  the diff but were missing from its count. Same mutually-exclusive gate that hid
  the comments themselves, in one more spot.

## 0.2.0

### Minor Changes

- [#181](https://github.com/ieedan/super-review/pull/181) [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9) Thanks [@ieedan](https://github.com/ieedan)! - feat(changeset): generate changesets via agent CLIs with customizable prompts

- [`1d1b0b2`](https://github.com/ieedan/super-review/commit/1d1b0b2afcdc6e81c430fa65db71366e627884aa) Thanks [@ieedan](https://github.com/ieedan)! - Add harness CLI authentication detection and recovery flow.

  When a commit message generation or changeset run reaches a harness CLI with no active session, the app now detects this upfront (via auth probes that run the CLI's own status commands) and shows a recovery dialog with the exact login command instead of failing mid-run. Each harness is re-checked when Settings opens (so the user sees live state) and when they dismiss the recovery dialog and come back after signing in. The Agents settings now display each CLI's auth state and signed-in identity.

- [#181](https://github.com/ieedan/super-review/pull/181) [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9) Thanks [@ieedan](https://github.com/ieedan)! - feat(commit-message): generate commit messages via harness CLIs with streaming and reveal animation

- [#181](https://github.com/ieedan/super-review/pull/181) [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9) Thanks [@ieedan](https://github.com/ieedan)! - feat(ui): add Settings → Agents panel for selecting harness CLI and model for commit message generation

- [#181](https://github.com/ieedan/super-review/pull/181) [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9) Thanks [@ieedan](https://github.com/ieedan)! - feat(ui): add Settings → Prompts panel for customizing commit message and changeset generation instructions

### Patch Changes

- [#177](https://github.com/ieedan/super-review/pull/177) [`6f617ac`](https://github.com/ieedan/super-review/commit/6f617acd35cb0321e2c0ec5a21ec496cc9bead1a) Thanks [@ieedan](https://github.com/ieedan)! - update in app components

- [`bd918e9`](https://github.com/ieedan/super-review/commit/bd918e9e3b1d12be02f9fd90ce49798e8aef7dfe) Thanks [@ieedan](https://github.com/ieedan)! - fix: keep local comments visible on the Branch tab after a PR is opened

  Opening a PR for a branch used to hide every local comment written before it
  existed. Two causes, both fixed: the Branch tab swapped its comment source over
  to GitHub wholesale, and the base half of the `branch:<base>..<head>` storage key
  gets repinned to `pr/<n>/base` once a PR exists, so the lookup no longer matched
  the rows. Local threads now render alongside the PR's own, and branch comments
  are looked up by head ref (matching what the CLI already did).

- [`8eaf3a8`](https://github.com/ieedan/super-review/commit/8eaf3a881f91ba6bc77e8c2a9501c7905497d442) Thanks [@ieedan](https://github.com/ieedan)! - fix(DiffFileHeader): prevent 1px code bleed through sticky header during scroll

- [#175](https://github.com/ieedan/super-review/pull/175) [`0a1ed73`](https://github.com/ieedan/super-review/commit/0a1ed73179a7be67d022eb109f22d44ecf208340) Thanks [@ieedan](https://github.com/ieedan)! - feat(desktop): GitHub Desktop-style Windows title bar menu

- [`bfc78d7`](https://github.com/ieedan/super-review/commit/bfc78d7a9ff0c3b7b3e76c638088b59c7190d739) Thanks [@ieedan](https://github.com/ieedan)! - fix: Windows editors and sharp Diff settings preview

- [`daff664`](https://github.com/ieedan/super-review/commit/daff66406c401719ed597bfe4450b5f3abde344a) Thanks [@ieedan](https://github.com/ieedan)! - feat: redesign Updates settings with Apple-style status flow

- [`3741ff7`](https://github.com/ieedan/super-review/commit/3741ff78902c19e6d03e0d1a3cb7d9bcf6e607d5) Thanks [@ieedan](https://github.com/ieedan)! - fix: Windows editors and sharp Diff settings preview

- [#158](https://github.com/ieedan/super-review/pull/158) [`8cdc255`](https://github.com/ieedan/super-review/commit/8cdc25530fa7b23c4a78ca4af5d41b3300a80c2c) Thanks [@ieedan](https://github.com/ieedan)! - pre-release updates

- [#161](https://github.com/ieedan/super-review/pull/161) [`8d3da92`](https://github.com/ieedan/super-review/commit/8d3da9264f4506704a4503d6d42389a1b3425a06) Thanks [@ieedan](https://github.com/ieedan)! - chore: a few fixes

- [#178](https://github.com/ieedan/super-review/pull/178) [`74a067b`](https://github.com/ieedan/super-review/commit/74a067b04eae624c6389955a899258f71e656af2) Thanks [@ieedan](https://github.com/ieedan)! - Don't run a push when there's nothing to push. The Push menu item (and its ⌘P accelerator) is now greyed out unless the branch is ahead of its remote or has no upstream yet, and the push action bails early instead of spinning the header button through "Fetching…/Pushing…" for a no-op.
- Updated dependencies [[`6f617ac`](https://github.com/ieedan/super-review/commit/6f617acd35cb0321e2c0ec5a21ec496cc9bead1a), [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9), [`bd918e9`](https://github.com/ieedan/super-review/commit/bd918e9e3b1d12be02f9fd90ce49798e8aef7dfe), [`97e5a74`](https://github.com/ieedan/super-review/commit/97e5a74d04db085bc5f9abb1bf65403ed93404b4), [`0a1ed73`](https://github.com/ieedan/super-review/commit/0a1ed73179a7be67d022eb109f22d44ecf208340), [`1d1b0b2`](https://github.com/ieedan/super-review/commit/1d1b0b2afcdc6e81c430fa65db71366e627884aa), [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9), [`bfbacbd`](https://github.com/ieedan/super-review/commit/bfbacbd3d6410a69d21c325d02e8ceb7dd83319b), [`daff664`](https://github.com/ieedan/super-review/commit/daff66406c401719ed597bfe4450b5f3abde344a), [`8cdc255`](https://github.com/ieedan/super-review/commit/8cdc25530fa7b23c4a78ca4af5d41b3300a80c2c), [`8d3da92`](https://github.com/ieedan/super-review/commit/8d3da9264f4506704a4503d6d42389a1b3425a06), [`74a067b`](https://github.com/ieedan/super-review/commit/74a067b04eae624c6389955a899258f71e656af2), [`a3b7a66`](https://github.com/ieedan/super-review/commit/a3b7a66db896fffb9e16ed0b1cd3470d760e98d9)]:
  - @super-review/core@0.3.0

## 0.2.0-beta.9

### Minor Changes

- [`1d1b0b2`](https://github.com/ieedan/super-review/commit/1d1b0b2afcdc6e81c430fa65db71366e627884aa) Thanks [@ieedan](https://github.com/ieedan)! - Add harness CLI authentication detection and recovery flow.

  When a commit message generation or changeset run reaches a harness CLI with no active session, the app now detects this upfront (via auth probes that run the CLI's own status commands) and shows a recovery dialog with the exact login command instead of failing mid-run. Each harness is re-checked when Settings opens (so the user sees live state) and when they dismiss the recovery dialog and come back after signing in. The Agents settings now display each CLI's auth state and signed-in identity.

### Patch Changes

- Updated dependencies [[`97e5a74`](https://github.com/ieedan/super-review/commit/97e5a74d04db085bc5f9abb1bf65403ed93404b4), [`1d1b0b2`](https://github.com/ieedan/super-review/commit/1d1b0b2afcdc6e81c430fa65db71366e627884aa)]:
  - @super-review/core@0.3.0-beta.6

## 0.2.0-beta.8

### Patch Changes

- [`8eaf3a8`](https://github.com/ieedan/super-review/commit/8eaf3a881f91ba6bc77e8c2a9501c7905497d442) Thanks [@ieedan](https://github.com/ieedan)! - fix(DiffFileHeader): prevent 1px code bleed through sticky header during scroll

## 0.2.0-beta.7

### Minor Changes

- [#181](https://github.com/ieedan/super-review/pull/181) [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9) Thanks [@ieedan](https://github.com/ieedan)! - feat(changeset): generate changesets via agent CLIs with customizable prompts

- [#181](https://github.com/ieedan/super-review/pull/181) [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9) Thanks [@ieedan](https://github.com/ieedan)! - feat(commit-message): generate commit messages via harness CLIs with streaming and reveal animation

- [#181](https://github.com/ieedan/super-review/pull/181) [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9) Thanks [@ieedan](https://github.com/ieedan)! - feat(ui): add Settings → Agents panel for selecting harness CLI and model for commit message generation

- [#181](https://github.com/ieedan/super-review/pull/181) [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9) Thanks [@ieedan](https://github.com/ieedan)! - feat(ui): add Settings → Prompts panel for customizing commit message and changeset generation instructions

### Patch Changes

- [`daff664`](https://github.com/ieedan/super-review/commit/daff66406c401719ed597bfe4450b5f3abde344a) Thanks [@ieedan](https://github.com/ieedan)! - feat: redesign Updates settings with Apple-style status flow
- Updated dependencies [[`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9), [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9), [`daff664`](https://github.com/ieedan/super-review/commit/daff66406c401719ed597bfe4450b5f3abde344a)]:
  - @super-review/core@0.3.0-beta.5

## 0.1.5-beta.6

### Patch Changes

- [#177](https://github.com/ieedan/super-review/pull/177) [`6f617ac`](https://github.com/ieedan/super-review/commit/6f617acd35cb0321e2c0ec5a21ec496cc9bead1a) Thanks [@ieedan](https://github.com/ieedan)! - update in app components

- [#178](https://github.com/ieedan/super-review/pull/178) [`74a067b`](https://github.com/ieedan/super-review/commit/74a067b04eae624c6389955a899258f71e656af2) Thanks [@ieedan](https://github.com/ieedan)! - Don't run a push when there's nothing to push. The Push menu item (and its ⌘P accelerator) is now greyed out unless the branch is ahead of its remote or has no upstream yet, and the push action bails early instead of spinning the header button through "Fetching…/Pushing…" for a no-op.
- Updated dependencies [[`6f617ac`](https://github.com/ieedan/super-review/commit/6f617acd35cb0321e2c0ec5a21ec496cc9bead1a), [`74a067b`](https://github.com/ieedan/super-review/commit/74a067b04eae624c6389955a899258f71e656af2)]:
  - @super-review/core@0.2.3-beta.4

## 0.1.5-beta.5

### Patch Changes

- [#175](https://github.com/ieedan/super-review/pull/175) [`0a1ed73`](https://github.com/ieedan/super-review/commit/0a1ed73179a7be67d022eb109f22d44ecf208340) Thanks [@ieedan](https://github.com/ieedan)! - feat(desktop): GitHub Desktop-style Windows title bar menu
- Updated dependencies [[`0a1ed73`](https://github.com/ieedan/super-review/commit/0a1ed73179a7be67d022eb109f22d44ecf208340)]:
  - @super-review/core@0.2.3-beta.3

## 0.1.5-beta.4

### Patch Changes

- [`bfc78d7`](https://github.com/ieedan/super-review/commit/bfc78d7a9ff0c3b7b3e76c638088b59c7190d739) Thanks [@ieedan](https://github.com/ieedan)! - fix: Windows editors and sharp Diff settings preview

## 0.1.5-beta.3

### Patch Changes

- Updated dependencies [[`bfbacbd`](https://github.com/ieedan/super-review/commit/bfbacbd3d6410a69d21c325d02e8ceb7dd83319b), [`a3b7a66`](https://github.com/ieedan/super-review/commit/a3b7a66db896fffb9e16ed0b1cd3470d760e98d9)]:
  - @super-review/core@0.2.3-beta.2

## 0.1.5-beta.2

### Patch Changes

- [`3741ff7`](https://github.com/ieedan/super-review/commit/3741ff78902c19e6d03e0d1a3cb7d9bcf6e607d5) Thanks [@ieedan](https://github.com/ieedan)! - fix: Windows editors and sharp Diff settings preview

## 0.1.5-beta.1

### Patch Changes

- [#161](https://github.com/ieedan/super-review/pull/161) [`8d3da92`](https://github.com/ieedan/super-review/commit/8d3da9264f4506704a4503d6d42389a1b3425a06) Thanks [@ieedan](https://github.com/ieedan)! - chore: a few fixes
- Updated dependencies [[`8d3da92`](https://github.com/ieedan/super-review/commit/8d3da9264f4506704a4503d6d42389a1b3425a06)]:
  - @super-review/core@0.2.3-beta.1

## 0.1.5-beta.0

### Patch Changes

- [#158](https://github.com/ieedan/super-review/pull/158) [`8cdc255`](https://github.com/ieedan/super-review/commit/8cdc25530fa7b23c4a78ca4af5d41b3300a80c2c) Thanks [@ieedan](https://github.com/ieedan)! - pre-release updates
- Updated dependencies [[`8cdc255`](https://github.com/ieedan/super-review/commit/8cdc25530fa7b23c4a78ca4af5d41b3300a80c2c)]:
  - @super-review/core@0.2.3-beta.0

## 0.1.4

### Patch Changes

- [#155](https://github.com/ieedan/super-review/pull/155) [`7f0ef08`](https://github.com/ieedan/super-review/commit/7f0ef0827a27b9d0f35d64c055edfb60bf41af50) Thanks [@ieedan](https://github.com/ieedan)! - fix: a few things

## 0.1.3

### Patch Changes

- [`3b8c411`](https://github.com/ieedan/super-review/commit/3b8c411e6d524a5ccaf3db517d1e8a1669906067) Thanks [@ieedan](https://github.com/ieedan)! - feat: diff view improvements
- Updated dependencies [[`3b8c411`](https://github.com/ieedan/super-review/commit/3b8c411e6d524a5ccaf3db517d1e8a1669906067)]:
  - @super-review/core@0.2.2

## 0.1.2

### Patch Changes

- [`ce9423c`](https://github.com/ieedan/super-review/commit/ce9423c1213b1ee67e58b22ffa183f154ee0c852) Thanks [@ieedan](https://github.com/ieedan)! - consistency: don't show a number on the comments tab when all comments are resolved/outdated

## 0.1.1

### Patch Changes

- [`df72e3b`](https://github.com/ieedan/super-review/commit/df72e3b214325b79e0323668e7351369e604730e) Thanks [@ieedan](https://github.com/ieedan)! - fix: don't re-render everything when discarding lines
- Updated dependencies [[`df72e3b`](https://github.com/ieedan/super-review/commit/df72e3b214325b79e0323668e7351369e604730e)]:
  - @super-review/core@0.2.1

## 0.1.0

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

### Patch Changes

- [#150](https://github.com/ieedan/super-review/pull/150) [`7c85bfb`](https://github.com/ieedan/super-review/commit/7c85bfb3ce5a97b93af1f041c9d28362e6fa961a) Thanks [@ieedan](https://github.com/ieedan)! - feat: automatically try to sync with origin when switching to default branch
- Updated dependencies [[`7c85bfb`](https://github.com/ieedan/super-review/commit/7c85bfb3ce5a97b93af1f041c9d28362e6fa961a)]:
  - @super-review/core@0.2.0

## 0.0.9

### Patch Changes

- [`e02765f`](https://github.com/ieedan/super-review/commit/e02765fc46f30dfe12f885dfab4777176d4259ed) Thanks [@ieedan](https://github.com/ieedan)! - fix: change command menu so it doesn't conflict with the push hotkey

- [`9dbfef1`](https://github.com/ieedan/super-review/commit/9dbfef114bd4652de3312dc010cc025eaac7fd18) Thanks [@ieedan](https://github.com/ieedan)! - feat: gitignore files from the sidebar
- Updated dependencies [[`e02765f`](https://github.com/ieedan/super-review/commit/e02765fc46f30dfe12f885dfab4777176d4259ed), [`9dbfef1`](https://github.com/ieedan/super-review/commit/9dbfef114bd4652de3312dc010cc025eaac7fd18)]:
  - @super-review/core@0.1.15

## 0.0.8

### Patch Changes

- [`7224d20`](https://github.com/ieedan/super-review/commit/7224d2083ddadf65b81f22f74d7affb07fff80c8) Thanks [@ieedan](https://github.com/ieedan)! - fix: discard multiple files in one batched git operation
- Updated dependencies [[`7224d20`](https://github.com/ieedan/super-review/commit/7224d2083ddadf65b81f22f74d7affb07fff80c8)]:
  - @super-review/core@0.1.14

## 0.0.7

### Patch Changes

- [`7d1e33b`](https://github.com/ieedan/super-review/commit/7d1e33bae80c837d5e00f9ee2c3629ca52153d33) Thanks [@ieedan](https://github.com/ieedan)! - feat: GitHub #references and @mentions in the markdown composer
- Updated dependencies [[`7d1e33b`](https://github.com/ieedan/super-review/commit/7d1e33bae80c837d5e00f9ee2c3629ca52153d33)]:
  - @super-review/core@0.1.13

## 0.0.6

### Patch Changes

- [`03fcc5c`](https://github.com/ieedan/super-review/commit/03fcc5c691671164789202aac2f95a58ce216c85) Thanks [@ieedan](https://github.com/ieedan)! - fix: render checkboxes in markdown correctly

- [`d87527a`](https://github.com/ieedan/super-review/commit/d87527ae68ca38979f4b06f1419df2a0396c2479) Thanks [@ieedan](https://github.com/ieedan)! - fix: geist mono ligatures & more
- Updated dependencies [[`d87527a`](https://github.com/ieedan/super-review/commit/d87527ae68ca38979f4b06f1419df2a0396c2479)]:
  - @super-review/core@0.1.12

## 0.0.5

### Patch Changes

- [`48e3bea`](https://github.com/ieedan/super-review/commit/48e3bea188dcb3ee73ae44e9939bfca0d33f0f39) Thanks [@ieedan](https://github.com/ieedan)! - fix: recover managed-stash restore from untracked-file collisions

- [`a24f7c2`](https://github.com/ieedan/super-review/commit/a24f7c29d6cb4ee77310cfde3f9a6340c39a8165) Thanks [@ieedan](https://github.com/ieedan)! - fix: if a file is marked seen on unstaged and on the branch tab then when it gets pushed the file will stay seen

- [`a14fee2`](https://github.com/ieedan/super-review/commit/a14fee27e526c3800cafc98aaa0d80edad8fca53) Thanks [@ieedan](https://github.com/ieedan)! - fix: prevent users from creating repos that already exist on remote

- [#140](https://github.com/ieedan/super-review/pull/140) [`b98b67f`](https://github.com/ieedan/super-review/commit/b98b67f049b0a76d676f29a4674f7a04394d356e) Thanks [@ieedan](https://github.com/ieedan)! - fix: stop losing "seen" marks after a new commit. The seen signature stored git's abbreviated blob OID, and git grows that abbreviation as the repo gains objects, so the same unchanged file looked "changed" on the next refresh and its mark was cleared. Diffs now record full blob OIDs, and the change detector tolerates abbreviation-length drift so existing marks survive the upgrade.
- Updated dependencies [[`48e3bea`](https://github.com/ieedan/super-review/commit/48e3bea188dcb3ee73ae44e9939bfca0d33f0f39), [`a24f7c2`](https://github.com/ieedan/super-review/commit/a24f7c29d6cb4ee77310cfde3f9a6340c39a8165), [`a14fee2`](https://github.com/ieedan/super-review/commit/a14fee27e526c3800cafc98aaa0d80edad8fca53), [`b98b67f`](https://github.com/ieedan/super-review/commit/b98b67f049b0a76d676f29a4674f7a04394d356e)]:
  - @super-review/core@0.1.11

## 0.0.4

### Patch Changes

- [`c4e4164`](https://github.com/ieedan/super-review/commit/c4e4164f0da49ce1beb451745cf84c2cfd51756a) Thanks [@ieedan](https://github.com/ieedan)! - fix: render markdown in PackageHoverCard

- [`c2512de`](https://github.com/ieedan/super-review/commit/c2512de5701143228d86697b0f949f5f70144e72) Thanks [@ieedan](https://github.com/ieedan)! - feat: allow users to configure AI files in new configuration dialog and view and reconfigure them in settings

- [#143](https://github.com/ieedan/super-review/pull/143) [`5d6312c`](https://github.com/ieedan/super-review/commit/5d6312c259924e29f93b15a3598121215ca71595) Thanks [@ieedan](https://github.com/ieedan)! - feat: improve agent files settings

- [`b58c6f3`](https://github.com/ieedan/super-review/commit/b58c6f3f408000b2119c6a279eb0ab926d554833) Thanks [@ieedan](https://github.com/ieedan)! - fix: refactor diff navigation to be more robust

- [`b58c6f3`](https://github.com/ieedan/super-review/commit/b58c6f3f408000b2119c6a279eb0ab926d554833) Thanks [@ieedan](https://github.com/ieedan)! - fix: fix an issue where the bring changes to main dialog overflowed with long branch names

- [`e2c259b`](https://github.com/ieedan/super-review/commit/e2c259b5317a83d9ece99ca70f587233cfae1e79) Thanks [@ieedan](https://github.com/ieedan)! - feat: switch back to the baseRef once a PR has been merged instead of just switching back to the default branch

- [`f678fa6`](https://github.com/ieedan/super-review/commit/f678fa6ba622facc05ba053c8fc5bfd7951329d0) Thanks [@ieedan](https://github.com/ieedan)! - feat: allow users to further customize left-sidebar tabs

- [`5f07d7d`](https://github.com/ieedan/super-review/commit/5f07d7d003bafc85f46c18f1188b30679626f3e5) Thanks [@ieedan](https://github.com/ieedan)! - fix: ensure stats update when you switch repos

- [`f678fa6`](https://github.com/ieedan/super-review/commit/f678fa6ba622facc05ba053c8fc5bfd7951329d0) Thanks [@ieedan](https://github.com/ieedan)! - feat: carry seen state across contexts for byte-identical diffs

- [`6333c9f`](https://github.com/ieedan/super-review/commit/6333c9f5764a95066dbb9fc8c782eb76aba02e82) Thanks [@ieedan](https://github.com/ieedan)! - fix: mark the topmost non-seen change as seen with Cmd+Enter
- Updated dependencies [[`c4e4164`](https://github.com/ieedan/super-review/commit/c4e4164f0da49ce1beb451745cf84c2cfd51756a), [`67c9d99`](https://github.com/ieedan/super-review/commit/67c9d9942b6f261f149d46aafe7386814cb8bcbc), [`c2512de`](https://github.com/ieedan/super-review/commit/c2512de5701143228d86697b0f949f5f70144e72), [`5d6312c`](https://github.com/ieedan/super-review/commit/5d6312c259924e29f93b15a3598121215ca71595), [`b58c6f3`](https://github.com/ieedan/super-review/commit/b58c6f3f408000b2119c6a279eb0ab926d554833), [`b58c6f3`](https://github.com/ieedan/super-review/commit/b58c6f3f408000b2119c6a279eb0ab926d554833), [`f678fa6`](https://github.com/ieedan/super-review/commit/f678fa6ba622facc05ba053c8fc5bfd7951329d0), [`f678fa6`](https://github.com/ieedan/super-review/commit/f678fa6ba622facc05ba053c8fc5bfd7951329d0)]:
  - @super-review/core@0.1.10

## 0.0.3

### Patch Changes

- fix: the comment editor now renders on a single uniform background. The Write/Preview toolbar previously used a lighter shade than the editor body, and on the Write tab the syntax-highlight overlay painted a darker box behind the typed text. Both now match the editor background. ([#133](https://github.com/ieedan/super-review/pull/133))

- Updated dependencies [[`f1a6012`](https://github.com/ieedan/super-review/commit/f1a601214651e57304316fe97d06ffe4f8bbde9f)]:
  - @super-review/core@0.1.9

## 0.0.2

### Patch Changes

- feat: pre-fill the commit box from a session's suggested title ([`56953c6`](https://github.com/ieedan/super-review/commit/56953c65d9dcc3c4ecfe2be3f94d20cb35dd40bf))

- tweak: add some guidance in the skill for how to speak to users ([`5bedb36`](https://github.com/ieedan/super-review/commit/5bedb360ab9a2ff959c2a5e3a0f5233175c8bc57))

- Fix the Cmd/Ctrl+P command palette not navigating to a chosen file while the "You've seen it all" completion state is up. Picking a file now dismisses the overlay before scrolling, just like the sidebar. ([#127](https://github.com/ieedan/super-review/pull/127))

- feat: add a collapse-all-seen button to the sidebar ([#130](https://github.com/ieedan/super-review/pull/130))

- feat: add `--pr` flag to view PR comments ([`eeceb6d`](https://github.com/ieedan/super-review/commit/eeceb6de4efc1dc2a4495c0f2e5d1e29351b0d33))

- fix: fallback to repo owner avatar when no icon can be found ([`c6b504a`](https://github.com/ieedan/super-review/commit/c6b504af36f8d0a610cbb1e855de133b13c25b80))

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

- fix: ensure stash shows up below notifications ([`17a1643`](https://github.com/ieedan/super-review/commit/17a164324d5e3b481367339b30c8cc5dcd48cded))

- style: tighten dropdown menus, pickers, and dialogs ([`41c4066`](https://github.com/ieedan/super-review/commit/41c4066907455d93a7af077a28e1d02d3e44d7df))

  Menu/picker text is smaller (`text-xs`) and separators are now inset from the menu
  edges instead of bleeding to them. Applies across dropdown menus, the repo/branch
  pickers (popover + command), and dialogs.

- fix: ensure markdown composers and renders for comments are the same between all tabs ([`5bedb36`](https://github.com/ieedan/super-review/commit/5bedb360ab9a2ff959c2a5e3a0f5233175c8bc57))

- fix: make ctrl+f actually work properly ([`7d2830a`](https://github.com/ieedan/super-review/commit/7d2830a66ab7b2346bb0a2cee4bc07464e0bef16))

- Updated dependencies [[`56953c6`](https://github.com/ieedan/super-review/commit/56953c65d9dcc3c4ecfe2be3f94d20cb35dd40bf), [`cc24068`](https://github.com/ieedan/super-review/commit/cc24068ac47342f8e6b10a50059df1360ab4b38b), [`eeceb6d`](https://github.com/ieedan/super-review/commit/eeceb6de4efc1dc2a4495c0f2e5d1e29351b0d33), [`7b9db69`](https://github.com/ieedan/super-review/commit/7b9db692c41f8905739a81c56dd70bc92fdcac2b)]:
  - @super-review/core@0.1.8
