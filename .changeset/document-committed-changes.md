---
'super-review': patch
'@super-review/core': patch
'@super-review/desktop': patch
---

Add `session save --committed` to document changes that have already been committed: it captures the current branch diffed against its base (auto-detected default branch, overridable with `--base`/`--head`) instead of only the working tree. Also fixes `revExists` reporting a missing ref (e.g. `origin/main` in a remote-less repo) as existing.
