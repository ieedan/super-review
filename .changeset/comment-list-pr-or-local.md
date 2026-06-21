---
'@super-review/core': minor
'super-review': minor
---

feat: simplify `comment list` to two intuitive scopes — the branch you're on (the default; the branch is read from git, so you never name it) or a pull request via `--pr <number>`. Replaces the lower-level `--context <key>` / `--all` flags. Backed by new `listLocalComments` / `listCommentsForPR` helpers in core.
