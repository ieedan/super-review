---
'@super-review/desktop': patch
'@super-review/core': patch
---

fix: diff view polish — center the gutter `+` comment button in its own lane between the line numbers and code, render deleted files as an all-removed diff (GitHub-style) with a compact `FileMinus`/`FileEdit` status icon instead of a wide text badge, and show "The diff for this file is too large to render" for oversized files (including ones with a single pathologically long line that previously painted blank)
