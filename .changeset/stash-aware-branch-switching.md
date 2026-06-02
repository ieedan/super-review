---
"@super-review/desktop": minor
---

Add stash-aware branch switching and creation with GitHub Desktop parity. When
you switch to — or create — a branch with a dirty working tree, the app now asks
what to do with your in-progress work: leave it stashed on the branch you're
leaving (the existing "Stashed Changes" row handles restore/discard on return),
or bring it along to the target (a conflicted carry routes to the existing
conflict-resolution flow). Both choices build on the managed-stash and checkout
primitives, so no new git behavior is introduced. Also hides the "Create branch
based on…" selector when you're on the default branch, where the only option was
itself.
