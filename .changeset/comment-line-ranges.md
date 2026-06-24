---
'@super-review/desktop': patch
---

Comments can now span a range of lines. Drag-select lines in the gutter before opening the composer and the comment is anchored to the whole range — for both local (Unstaged/branch/session) comments and PR review comments, which post as GitHub multi-line comments (`start_line`). The selected range is shown in the composer and on the comment, and a plain single-line click is unchanged.
