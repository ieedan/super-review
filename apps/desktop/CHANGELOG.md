# @super-review/desktop

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
