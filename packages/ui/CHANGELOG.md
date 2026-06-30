# @super-review/ui

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
