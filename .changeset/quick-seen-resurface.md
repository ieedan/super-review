---
'@super-review/desktop': patch
---

feat: unmark seen files when they change, and show a checked comment icon for resolved threads

In the review view, a file you marked as "seen" is now automatically unmarked when its content changes (new commits pushed to a branch, or further working-tree edits), so it resurfaces for re-review. This works in both the branch and unstaged views and can be turned off under Behavior → Reviewing. The sidebar comment icon also switches to a checked variant once every thread on a file is resolved.
