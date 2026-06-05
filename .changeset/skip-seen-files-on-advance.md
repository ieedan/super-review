---
'@super-review/desktop': patch
---

fix: skip already-seen files when advancing after marking a file seen so the walk lands on the next change that still needs review instead of re-opening a cleared file
