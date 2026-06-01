---
"@super-review/desktop": patch
---

Refresh open diffs when files change outside the app.

Returning to the window (or the periodic origin poll) refreshed the file list but served each file's diff from an in-memory cache that was only ever invalidated by in-app git operations. An already-open diff could stay frozen on stale content no matter how many times you switched away and back. Focus and poll refreshes now re-validate open diffs against disk in the background, swapping in the new content only when it actually changed — so edits made in another editor or the CLI show up without a loading flicker.
