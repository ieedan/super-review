---
'@super-review/ui': patch
---

Fix the Cmd/Ctrl+P command palette not navigating to a chosen file while the "You've seen it all" completion state is up. Picking a file now dismisses the overlay before scrolling, just like the sidebar.
