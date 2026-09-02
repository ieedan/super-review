---
'@super-review/core': patch
'@super-review/desktop': patch
'@super-review/ui': patch
---

feat: Add support for reviewing code in linked git worktrees

Allow the app to enter a linked worktree so an agent's checked-out branch reviews like any other branch, with its uncommitted changes and staging area. Worktree branches are marked read-only in the picker; selecting one enters the worktree instead of attempting an impossible checkout. The app re-targets all working-tree operations (status, staging, commit, pull, sessions, comments) to the active worktree while inside one. Ref reads remain identical (worktrees share the object database and refs). Real checkouts always target the main checkout and implicitly leave any active worktree.
