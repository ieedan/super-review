# @super-review/desktop

## 0.1.2

### Patch Changes

- [#188](https://github.com/ieedan/super-review/pull/188) [`367bb69`](https://github.com/ieedan/super-review/commit/367bb698023d5d7edfd3c161a208920ea02140e6) Thanks [@ieedan](https://github.com/ieedan)! - fix: count local comments in the file list when a PR is open

  The per-file comment count in the sidebar zeroed out local comments in a PR
  context, so on the Branch tab with an open PR a file's local threads rendered in
  the diff but were missing from its count. Same mutually-exclusive gate that hid
  the comments themselves, in one more spot.

- Updated dependencies [[`367bb69`](https://github.com/ieedan/super-review/commit/367bb698023d5d7edfd3c161a208920ea02140e6)]:
  - @super-review/ui@0.2.1

## 0.1.1

### Patch Changes

- [#186](https://github.com/ieedan/super-review/pull/186) [`964ede2`](https://github.com/ieedan/super-review/commit/964ede2138f07bb6979f5c7f6ff412cff2a6431f) Thanks [@ieedan](https://github.com/ieedan)! - chore: bump past 0.1.0, which collides with an existing release

  Leaving prerelease mode landed the desktop app on 0.1.0, but a `v0.1.0` release
  from 2026-06-02 already exists with published artifacts. The release workflow
  gates on `git rev-parse "v$VERSION"`, saw the old tag, and skipped the build —
  so 0.1.0 never shipped. Moving to 0.1.1 releases normally without rewriting
  published history.

## 0.1.0

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

- [#175](https://github.com/ieedan/super-review/pull/175) [`0a1ed73`](https://github.com/ieedan/super-review/commit/0a1ed73179a7be67d022eb109f22d44ecf208340) Thanks [@ieedan](https://github.com/ieedan)! - feat(desktop): GitHub Desktop-style Windows title bar menu

- [`bfc78d7`](https://github.com/ieedan/super-review/commit/bfc78d7a9ff0c3b7b3e76c638088b59c7190d739) Thanks [@ieedan](https://github.com/ieedan)! - fix: Windows editors and sharp Diff settings preview

- [`daff664`](https://github.com/ieedan/super-review/commit/daff66406c401719ed597bfe4450b5f3abde344a) Thanks [@ieedan](https://github.com/ieedan)! - feat: redesign Updates settings with Apple-style status flow

- [`3741ff7`](https://github.com/ieedan/super-review/commit/3741ff78902c19e6d03e0d1a3cb7d9bcf6e607d5) Thanks [@ieedan](https://github.com/ieedan)! - fix: Windows editors and sharp Diff settings preview

- [#158](https://github.com/ieedan/super-review/pull/158) [`8cdc255`](https://github.com/ieedan/super-review/commit/8cdc25530fa7b23c4a78ca4af5d41b3300a80c2c) Thanks [@ieedan](https://github.com/ieedan)! - pre-release updates

- [#161](https://github.com/ieedan/super-review/pull/161) [`8d3da92`](https://github.com/ieedan/super-review/commit/8d3da9264f4506704a4503d6d42389a1b3425a06) Thanks [@ieedan](https://github.com/ieedan)! - chore: a few fixes

- [#178](https://github.com/ieedan/super-review/pull/178) [`74a067b`](https://github.com/ieedan/super-review/commit/74a067b04eae624c6389955a899258f71e656af2) Thanks [@ieedan](https://github.com/ieedan)! - Don't run a push when there's nothing to push. The Push menu item (and its ⌘P accelerator) is now greyed out unless the branch is ahead of its remote or has no upstream yet, and the push action bails early instead of spinning the header button through "Fetching…/Pushing…" for a no-op.

- [`a3b7a66`](https://github.com/ieedan/super-review/commit/a3b7a66db896fffb9e16ed0b1cd3470d760e98d9) Thanks [@ieedan](https://github.com/ieedan)! - fix: authentication fixes
- Updated dependencies [[`6f617ac`](https://github.com/ieedan/super-review/commit/6f617acd35cb0321e2c0ec5a21ec496cc9bead1a), [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9), [`bd918e9`](https://github.com/ieedan/super-review/commit/bd918e9e3b1d12be02f9fd90ce49798e8aef7dfe), [`97e5a74`](https://github.com/ieedan/super-review/commit/97e5a74d04db085bc5f9abb1bf65403ed93404b4), [`8eaf3a8`](https://github.com/ieedan/super-review/commit/8eaf3a881f91ba6bc77e8c2a9501c7905497d442), [`0a1ed73`](https://github.com/ieedan/super-review/commit/0a1ed73179a7be67d022eb109f22d44ecf208340), [`1d1b0b2`](https://github.com/ieedan/super-review/commit/1d1b0b2afcdc6e81c430fa65db71366e627884aa), [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9), [`bfc78d7`](https://github.com/ieedan/super-review/commit/bfc78d7a9ff0c3b7b3e76c638088b59c7190d739), [`bfbacbd`](https://github.com/ieedan/super-review/commit/bfbacbd3d6410a69d21c325d02e8ceb7dd83319b), [`daff664`](https://github.com/ieedan/super-review/commit/daff66406c401719ed597bfe4450b5f3abde344a), [`3741ff7`](https://github.com/ieedan/super-review/commit/3741ff78902c19e6d03e0d1a3cb7d9bcf6e607d5), [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9), [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9), [`8cdc255`](https://github.com/ieedan/super-review/commit/8cdc25530fa7b23c4a78ca4af5d41b3300a80c2c), [`8d3da92`](https://github.com/ieedan/super-review/commit/8d3da9264f4506704a4503d6d42389a1b3425a06), [`74a067b`](https://github.com/ieedan/super-review/commit/74a067b04eae624c6389955a899258f71e656af2), [`a3b7a66`](https://github.com/ieedan/super-review/commit/a3b7a66db896fffb9e16ed0b1cd3470d760e98d9)]:
  - @super-review/core@0.3.0
  - @super-review/ui@0.2.0

## 0.1.0-beta.9

### Minor Changes

- [`1d1b0b2`](https://github.com/ieedan/super-review/commit/1d1b0b2afcdc6e81c430fa65db71366e627884aa) Thanks [@ieedan](https://github.com/ieedan)! - Add harness CLI authentication detection and recovery flow.

  When a commit message generation or changeset run reaches a harness CLI with no active session, the app now detects this upfront (via auth probes that run the CLI's own status commands) and shows a recovery dialog with the exact login command instead of failing mid-run. Each harness is re-checked when Settings opens (so the user sees live state) and when they dismiss the recovery dialog and come back after signing in. The Agents settings now display each CLI's auth state and signed-in identity.

### Patch Changes

- Updated dependencies [[`97e5a74`](https://github.com/ieedan/super-review/commit/97e5a74d04db085bc5f9abb1bf65403ed93404b4), [`1d1b0b2`](https://github.com/ieedan/super-review/commit/1d1b0b2afcdc6e81c430fa65db71366e627884aa)]:
  - @super-review/core@0.3.0-beta.6
  - @super-review/ui@0.2.0-beta.9

## 0.1.0-beta.8

### Patch Changes

- Updated dependencies [[`8eaf3a8`](https://github.com/ieedan/super-review/commit/8eaf3a881f91ba6bc77e8c2a9501c7905497d442)]:
  - @super-review/ui@0.2.0-beta.8

## 0.1.0-beta.7

### Minor Changes

- [#181](https://github.com/ieedan/super-review/pull/181) [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9) Thanks [@ieedan](https://github.com/ieedan)! - feat(changeset): generate changesets via agent CLIs with customizable prompts

- [#181](https://github.com/ieedan/super-review/pull/181) [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9) Thanks [@ieedan](https://github.com/ieedan)! - feat(commit-message): generate commit messages via harness CLIs with streaming and reveal animation

### Patch Changes

- [`daff664`](https://github.com/ieedan/super-review/commit/daff66406c401719ed597bfe4450b5f3abde344a) Thanks [@ieedan](https://github.com/ieedan)! - feat: redesign Updates settings with Apple-style status flow
- Updated dependencies [[`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9), [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9), [`daff664`](https://github.com/ieedan/super-review/commit/daff66406c401719ed597bfe4450b5f3abde344a), [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9), [`1fc6e75`](https://github.com/ieedan/super-review/commit/1fc6e75b248ee840b68e241779919ee7dc3bdff9)]:
  - @super-review/core@0.3.0-beta.5
  - @super-review/ui@0.2.0-beta.7

## 0.0.1-beta.6

### Patch Changes

- [#177](https://github.com/ieedan/super-review/pull/177) [`6f617ac`](https://github.com/ieedan/super-review/commit/6f617acd35cb0321e2c0ec5a21ec496cc9bead1a) Thanks [@ieedan](https://github.com/ieedan)! - update in app components

- [#178](https://github.com/ieedan/super-review/pull/178) [`74a067b`](https://github.com/ieedan/super-review/commit/74a067b04eae624c6389955a899258f71e656af2) Thanks [@ieedan](https://github.com/ieedan)! - Don't run a push when there's nothing to push. The Push menu item (and its ⌘P accelerator) is now greyed out unless the branch is ahead of its remote or has no upstream yet, and the push action bails early instead of spinning the header button through "Fetching…/Pushing…" for a no-op.
- Updated dependencies [[`6f617ac`](https://github.com/ieedan/super-review/commit/6f617acd35cb0321e2c0ec5a21ec496cc9bead1a), [`74a067b`](https://github.com/ieedan/super-review/commit/74a067b04eae624c6389955a899258f71e656af2)]:
  - @super-review/core@0.2.3-beta.4
  - @super-review/ui@0.1.5-beta.6

## 0.0.1-beta.5

### Patch Changes

- [#175](https://github.com/ieedan/super-review/pull/175) [`0a1ed73`](https://github.com/ieedan/super-review/commit/0a1ed73179a7be67d022eb109f22d44ecf208340) Thanks [@ieedan](https://github.com/ieedan)! - feat(desktop): GitHub Desktop-style Windows title bar menu
- Updated dependencies [[`0a1ed73`](https://github.com/ieedan/super-review/commit/0a1ed73179a7be67d022eb109f22d44ecf208340)]:
  - @super-review/core@0.2.3-beta.3
  - @super-review/ui@0.1.5-beta.5

## 0.0.1-beta.4

### Patch Changes

- [`bfc78d7`](https://github.com/ieedan/super-review/commit/bfc78d7a9ff0c3b7b3e76c638088b59c7190d739) Thanks [@ieedan](https://github.com/ieedan)! - fix: Windows editors and sharp Diff settings preview
- Updated dependencies [[`bfc78d7`](https://github.com/ieedan/super-review/commit/bfc78d7a9ff0c3b7b3e76c638088b59c7190d739)]:
  - @super-review/ui@0.1.5-beta.4

## 0.0.1-beta.3

### Patch Changes

- [`a3b7a66`](https://github.com/ieedan/super-review/commit/a3b7a66db896fffb9e16ed0b1cd3470d760e98d9) Thanks [@ieedan](https://github.com/ieedan)! - fix: authentication fixes
- Updated dependencies [[`bfbacbd`](https://github.com/ieedan/super-review/commit/bfbacbd3d6410a69d21c325d02e8ceb7dd83319b), [`a3b7a66`](https://github.com/ieedan/super-review/commit/a3b7a66db896fffb9e16ed0b1cd3470d760e98d9)]:
  - @super-review/core@0.2.3-beta.2
  - @super-review/ui@0.1.5-beta.3

## 0.0.1-beta.2

### Patch Changes

- [`3741ff7`](https://github.com/ieedan/super-review/commit/3741ff78902c19e6d03e0d1a3cb7d9bcf6e607d5) Thanks [@ieedan](https://github.com/ieedan)! - fix: Windows editors and sharp Diff settings preview
- Updated dependencies [[`3741ff7`](https://github.com/ieedan/super-review/commit/3741ff78902c19e6d03e0d1a3cb7d9bcf6e607d5)]:
  - @super-review/ui@0.1.5-beta.2

## 0.0.1-beta.1

### Patch Changes

- [#161](https://github.com/ieedan/super-review/pull/161) [`8d3da92`](https://github.com/ieedan/super-review/commit/8d3da9264f4506704a4503d6d42389a1b3425a06) Thanks [@ieedan](https://github.com/ieedan)! - chore: a few fixes
- Updated dependencies [[`8d3da92`](https://github.com/ieedan/super-review/commit/8d3da9264f4506704a4503d6d42389a1b3425a06)]:
  - @super-review/core@0.2.3-beta.1
  - @super-review/ui@0.1.5-beta.1

## 0.0.1-beta.0

### Patch Changes

- [#158](https://github.com/ieedan/super-review/pull/158) [`8cdc255`](https://github.com/ieedan/super-review/commit/8cdc25530fa7b23c4a78ca4af5d41b3300a80c2c) Thanks [@ieedan](https://github.com/ieedan)! - pre-release updates
- Updated dependencies [[`8cdc255`](https://github.com/ieedan/super-review/commit/8cdc25530fa7b23c4a78ca4af5d41b3300a80c2c)]:
  - @super-review/core@0.2.3-beta.0
  - @super-review/ui@0.1.5-beta.0
