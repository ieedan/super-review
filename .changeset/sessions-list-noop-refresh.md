---
'@super-review/desktop': patch
---

Stop the Sessions list from flashing and shifting on a no-op focus/poll refresh — loadSessions now only swaps in the fetched list when it actually differs
