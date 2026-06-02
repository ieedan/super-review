---
"@super-review/desktop": minor
"@super-review/core": minor
---

Add stash management with GitHub Desktop parity. When a pull is blocked by
uncommitted local changes that would be overwritten, the app now offers to
"Stash Changes and Continue" instead of surfacing a raw error. It keeps one
managed stash per branch (tagged so user-created stashes are never touched),
shows a "Stashed Changes" entry in the sidebar, and lets you review its diff
(including untracked files) and Restore or Discard it. Restoring reuses the
existing conflict-resolution flow when the pop conflicts.
