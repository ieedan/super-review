---
'@super-review/core': patch
'super-review': patch
---

feat: `comment list` now shows the review comments on the branch you're on — the branch is read from git, so you never name it, and there are no `--context`/`--pr` flags to reason about. Backed by a new `listLocalComments` helper in core. (These comments live on the reviewer's machine, so a remote/cloud agent finds none.)
