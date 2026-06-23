---
'@super-review/desktop': patch
---

Unstaged view: clicking a line's gutter checkbox to include/exclude it from a commit no longer also opens the comment composer. The staging gutter click is now intercepted in the capture phase so it doesn't fall through to Pierre's line-number click handler.
