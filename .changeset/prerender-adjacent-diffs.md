---
"@super-review/desktop": patch
---

Make navigating between files instant in the "One at a time" diff layout.

The previous and next file's diffs are now rendered off-screen ahead of time, so stepping to either no longer waits on a fetch and re-render — the diff is already there when you switch to it.
