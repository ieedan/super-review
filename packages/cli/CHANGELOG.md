# super-review

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
