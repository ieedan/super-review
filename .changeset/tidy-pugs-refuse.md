---
'@super-review/core': patch
'@super-review/desktop': patch
'@super-review/ui': patch
---

Don't run a push when there's nothing to push. The Push menu item (and its ⌘P accelerator) is now greyed out unless the branch is ahead of its remote or has no upstream yet, and the push action bails early instead of spinning the header button through "Fetching…/Pushing…" for a no-op.
