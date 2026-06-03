---
'@super-review/desktop': patch
---

Stop the Sessions view from flashing and shifting on a no-op refresh. loadSessions now only swaps in the fetched list when it actually differs, and only re-opens an open session (which reloads its diff, resets the view to the tour and clears the file search) when that session was actually re-captured.
