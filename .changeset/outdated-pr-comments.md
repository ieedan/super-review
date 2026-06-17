---
'@super-review/desktop': patch
---

Show an "Outdated" badge on PR review comments whose anchored line or file is gone from the current diff, rendering their code context (via the same `@pierre/diffs` engine as the live diffs) from GitHub's captured diff hunk — so comments on changed/deleted lines and deleted files still show syntax-highlighted context. Outdated detection keys off GitHub's live `line` going null, and outdated comments are included in the copy-as-prompt output flagged `(outdated)`. PR review comment threads are now collapsible — one toggle on the thread root (a standalone comment counts as a thread of one), on the right of the header. Collapsing folds the whole conversation down to its header; resolved or outdated threads collapse by default and are dimmed in the comments sidebar. Clicking a thread in the sidebar expands it and scrolls to it.
